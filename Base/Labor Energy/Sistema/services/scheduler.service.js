/**
 * SCHEDULER SERVICE â€” Extracted cron jobs from server.js
 * AUDIT-FIX ARCH-002: Single Responsibility â€” cron logic in dedicated module
 * 
 * Contains all 11 scheduled tasks:
 * 1. Daily sales report email (7am)
 * 2. Database backup (2am)
 * 3. Charge notifications (8am)
 * 4. Min stock check (every 6h)
 * 5. Overdue POs alert (9am)
 * 6. Vendor docs expiring (Mondays 8am)
 * 7. Pending approvals reminder (10am)
 * 8. Supplier ratings update (Sundays 3am)
 * 9. Stock expiry/low alerts (3am)
 * 10. Auto-inactivate idle customers (4am)
 * 11. Audit log rotation â€” 90 day retention (3:30am)
 * 
 * @module services/scheduler
 */

const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const COBRANCA_ALERT_TYPE = 'conta_receber_vencida_faturamento';
const COBRANCA_ALERT_RECIPIENTS = [
    'gerenciavendas@aluforce.ind.br',
    'financeiro@aluforce.ind.br',
    'aluforce@aluforce.ind.br',
    'financeiro3@aluforce.ind.br'
];

function getCobrancaRecipients() {
    const envValue = process.env.EMAIL_ALERTA_COBRANCA || process.env.COBRANCA_ALERT_RECIPIENTS;
    if (!envValue) return COBRANCA_ALERT_RECIPIENTS;
    return envValue
        .split(',')
        .map(email => email.trim())
        .filter(Boolean);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
        .format(Number(value) || 0);
}

function formatDateBR(value) {
    if (!value) return '-';
    const raw = String(value).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [year, month, day] = raw.split('-');
        return `${day}/${month}/${year}`;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function getCompanyLabel() {
    const brand = String(process.env.BRAND || 'aluforce').toLowerCase();
    const labels = {
        'aluforce': 'ALUFORCE',
        'labor-energy': 'Labor Energy',
        'labor-eletric': 'Labor Eletric'
    };
    return labels[brand] || process.env.COMPANY_NAME || brand;
}

function getSqlColumn(alias, column) {
    return `\`${alias}\`.\`${column}\``;
}

function coalesceColumns(alias, columns, candidates, fallback = 'NULL') {
    const parts = candidates
        .filter(column => columns.has(column))
        .map(column => getSqlColumn(alias, column));
    if (!parts.length) return fallback;
    return parts.length === 1 ? parts[0] : `COALESCE(${parts.join(', ')})`;
}

async function getTableColumns(pool, tableName) {
    try {
        const [rows] = await pool.query(`
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
        `, [tableName]);
        return new Set(rows.map(row => row.COLUMN_NAME));
    } catch (err) {
        return new Set();
    }
}

async function ensureCobrancaAlertTable(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS financeiro_cobranca_alertas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            conta_receber_id INT NOT NULL,
            tipo VARCHAR(80) NOT NULL,
            destinatarios TEXT NOT NULL,
            assunto VARCHAR(255) NOT NULL,
            status ENUM('processando', 'enviado', 'falha') NOT NULL DEFAULT 'processando',
            tentativas INT NOT NULL DEFAULT 1,
            erro_msg TEXT NULL,
            criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            enviado_em DATETIME NULL,
            atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_fin_cobranca_alerta (conta_receber_id, tipo),
            INDEX idx_fin_cobranca_status (status),
            INDEX idx_fin_cobranca_enviado (enviado_em)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function buscarContasReceberVencidasFaturamento(pool, logger) {
    const [crColumns, clientesColumns, pedidosColumns, nfesColumns] = await Promise.all([
        getTableColumns(pool, 'contas_receber'),
        getTableColumns(pool, 'clientes'),
        getTableColumns(pool, 'pedidos'),
        getTableColumns(pool, 'nfes')
    ]);

    if (!crColumns.has('id')) {
        logger?.warn?.('[COBRANCA-CRON] Tabela contas_receber sem coluna id; rotina ignorada.');
        return [];
    }

    const vencimentoExpr = coalesceColumns('cr', crColumns, ['data_vencimento', 'vencimento'], null);
    if (!vencimentoExpr) {
        logger?.warn?.('[COBRANCA-CRON] Nenhuma coluna de vencimento encontrada em contas_receber.');
        return [];
    }

    const valorExpr = coalesceColumns('cr', crColumns, ['a_receber', 'valor_saldo', 'valor', 'valor_total', 'valor_original'], '0');
    const valorTotalExpr = coalesceColumns('cr', crColumns, ['valor', 'valor_total', 'valor_original'], valorExpr);
    const valorRecebidoExpr = coalesceColumns('cr', crColumns, ['valor_recebido', 'recebido', 'valor_pago'], '0');
    const valorAbertoExpr = crColumns.has('a_receber') || crColumns.has('valor_saldo')
        ? valorExpr
        : `GREATEST((${valorTotalExpr}) - (${valorRecebidoExpr}), 0)`;
    const statusExpr = crColumns.has('status') ? "LOWER(COALESCE(cr.status, ''))" : "''";

    const joins = [];
    if (crColumns.has('cliente_id') && clientesColumns.has('id')) {
        joins.push('LEFT JOIN clientes c ON c.id = cr.cliente_id');
    }
    if (crColumns.has('pedido_id') && pedidosColumns.has('id')) {
        joins.push('LEFT JOIN pedidos p ON p.id = cr.pedido_id');
    }
    if (nfesColumns.has('id')) {
        if (crColumns.has('nfe_id')) {
            joins.push('LEFT JOIN nfes n ON n.id = cr.nfe_id');
        } else if (crColumns.has('pedido_id') && nfesColumns.has('pedido_id')) {
            joins.push('LEFT JOIN nfes n ON n.pedido_id = cr.pedido_id');
        }
    }

    const origemParts = [];
    if (crColumns.has('origem_integracao')) {
        origemParts.push("LOWER(COALESCE(cr.origem_integracao, '')) IN ('faturamento', 'vendas', 'nfe')");
    }
    if (crColumns.has('pedido_id')) origemParts.push('cr.pedido_id IS NOT NULL');
    if (crColumns.has('nfe_id')) origemParts.push('cr.nfe_id IS NOT NULL');
    if (crColumns.has('tipo')) origemParts.push("LOWER(COALESCE(cr.tipo, '')) LIKE 'faturamento%'");
    if (crColumns.has('descricao')) origemParts.push("LOWER(COALESCE(cr.descricao, '')) LIKE 'faturamento%' OR LOWER(COALESCE(cr.descricao, '')) LIKE 'nf-e%'");
    if (crColumns.has('observacoes')) origemParts.push("LOWER(COALESCE(cr.observacoes, '')) LIKE '%nf-e%'");
    if (crColumns.has('nota_fiscal')) origemParts.push("NULLIF(TRIM(COALESCE(cr.nota_fiscal, '')), '') IS NOT NULL");

    if (!origemParts.length) {
        logger?.warn?.('[COBRANCA-CRON] Nenhum marcador de faturamento encontrado em contas_receber.');
        return [];
    }

    const crClienteExpr = coalesceColumns('cr', crColumns, ['cliente_nome'], 'NULL');
    const clienteExpr = [
        crClienteExpr,
        coalesceColumns('c', clientesColumns, ['nome_fantasia', 'razao_social', 'nome'], 'NULL'),
        coalesceColumns('cr', crColumns, ['descricao'], 'NULL'),
        "'Cliente'"
    ].join(', ');
    const pedidoExpr = coalesceColumns('cr', crColumns, ['numero_pedido', 'pedido_id'], 'NULL');
    const pedidoFallbackExpr = coalesceColumns('p', pedidosColumns, ['numero_pedido', 'numero', 'id'], 'NULL');
    const nfeExpr = [
        coalesceColumns('cr', crColumns, ['nota_fiscal'], 'NULL'),
        coalesceColumns('n', nfesColumns, ['numero', 'numero_nfe', 'nfe_numero'], 'NULL'),
        coalesceColumns('p', pedidosColumns, ['nf_numero', 'nfe_faturamento_numero'], 'NULL')
    ].join(', ');

    const query = `
        SELECT
            cr.id,
            ${coalesceColumns('cr', crColumns, ['pedido_id'], 'NULL')} AS pedido_id,
            COALESCE(${pedidoExpr}, ${pedidoFallbackExpr}) AS numero_pedido,
            COALESCE(${clienteExpr}) AS cliente_nome,
            ${coalesceColumns('cr', crColumns, ['descricao'], 'NULL')} AS descricao,
            ${valorTotalExpr} AS valor_total,
            ${valorAbertoExpr} AS valor_aberto,
            DATE(${vencimentoExpr}) AS data_vencimento,
            ${coalesceColumns('cr', crColumns, ['status'], 'NULL')} AS status,
            COALESCE(${nfeExpr}) AS nota_fiscal,
            DATEDIFF(CURDATE(), DATE(${vencimentoExpr})) AS dias_atraso
        FROM contas_receber cr
        ${joins.join('\n        ')}
        LEFT JOIN financeiro_cobranca_alertas fca
            ON fca.conta_receber_id = cr.id
           AND fca.tipo = ?
           AND fca.status IN ('processando', 'enviado')
        WHERE DATE(${vencimentoExpr}) < CURDATE()
          AND (${valorAbertoExpr}) > 0
          AND ${statusExpr} NOT IN ('pago', 'recebido', 'recebida', 'liquidado', 'liquidada', 'cancelado', 'cancelada', 'excluida')
          AND (${origemParts.map(part => `(${part})`).join(' OR ')})
          AND fca.id IS NULL
        ORDER BY DATE(${vencimentoExpr}) ASC, cr.id ASC
        LIMIT 100
    `;

    const [rows] = await pool.query(query, [COBRANCA_ALERT_TYPE]);
    return rows;
}

function buildCobrancaAlertTemplate(conta, companyLabel = getCompanyLabel()) {
    const pedido = conta.numero_pedido || conta.pedido_id || '-';
    const notaFiscal = conta.nota_fiscal || '-';
    const cliente = conta.cliente_nome || 'Cliente';
    const valorAberto = formatCurrency(conta.valor_aberto ?? conta.valor_total);
    const vencimento = formatDateBR(conta.data_vencimento);
    const dias = Number(conta.dias_atraso) || 0;
    const atrasoTexto = dias === 1 ? '1 dia' : `${dias} dias`;
    const subject = `Aviso de cobranca vencida - Pedido ${pedido}`;
    const descricao = conta.descricao || `Conta a receber #${conta.id}`;

    const text = [
        'Aviso de cobranca vencida',
        `Empresa: ${companyLabel}`,
        `Pedido: ${pedido}`,
        `Nota fiscal: ${notaFiscal}`,
        `Cliente: ${cliente}`,
        `Valor em aberto: ${valorAberto}`,
        `Vencimento: ${vencimento}`,
        `Atraso: ${atrasoTexto}`,
        `Conta a receber: #${conta.id}`,
        '',
        'Acao sugerida: validar o recebimento e acionar o cliente pelo processo financeiro/comercial.'
    ].join('\n');

    const rows = [
        ['Empresa', companyLabel],
        ['Pedido', pedido],
        ['NF-e/NF', notaFiscal],
        ['Cliente', cliente],
        ['Conta a receber', `#${conta.id}`],
        ['Descricao', descricao],
        ['Valor em aberto', valorAberto],
        ['Vencimento', vencimento],
        ['Tempo em atraso', atrasoTexto],
        ['Status atual', conta.status || '-']
    ];

    const detailRows = rows.map(([label, value]) => `
        <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:13px;width:180px;">${escapeHtml(label)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
        </tr>
    `).join('');

    const html = `
        <div style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
            <div style="max-width:720px;margin:0 auto;padding:24px;">
                <div style="background:#0f172a;color:#fff;padding:22px 24px;border-radius:8px 8px 0 0;">
                    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1;">${escapeHtml(companyLabel)} | Contas a receber</div>
                    <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">Aviso de cobranca vencida</h1>
                </div>
                <div style="background:#fff;border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 8px 8px;">
                    <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#334155;">
                        Um pedido faturado esta com valor em aberto no contas a receber e ja passou da data prevista de recebimento.
                    </p>
                    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:18px 0;">
                        <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">
                            ${detailRows}
                        </table>
                    </div>
                    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;color:#9a3412;font-size:14px;line-height:1.5;">
                        Validar se houve baixa/compensacao pendente e, se necessario, seguir com o contato de cobranca.
                    </div>
                    <p style="margin:20px 0 0;font-size:12px;color:#64748b;">
                        Email gerado automaticamente pelo Zyntra SGE. Nao e necessario responder esta mensagem.
                    </p>
                </div>
            </div>
        </div>
    `;

    return { subject, html, text };
}

async function reservarAlertaCobranca(pool, contaId, destinatarios, subject) {
    try {
        await pool.execute(`
            INSERT INTO financeiro_cobranca_alertas
                (conta_receber_id, tipo, destinatarios, assunto, status, tentativas, criado_em, atualizado_em)
            VALUES (?, ?, ?, ?, 'processando', 1, NOW(), NOW())
        `, [contaId, COBRANCA_ALERT_TYPE, destinatarios, subject]);
        return true;
    } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        const [result] = await pool.execute(`
            UPDATE financeiro_cobranca_alertas
            SET status = 'processando',
                tentativas = tentativas + 1,
                destinatarios = ?,
                assunto = ?,
                erro_msg = NULL,
                atualizado_em = NOW()
            WHERE conta_receber_id = ?
              AND tipo = ?
              AND status = 'falha'
              AND tentativas < 3
        `, [destinatarios, subject, contaId, COBRANCA_ALERT_TYPE]);
        return result.affectedRows > 0;
    }
}

async function finalizarAlertaCobranca(pool, contaId, status, errorMessage = null) {
    await pool.execute(`
        UPDATE financeiro_cobranca_alertas
        SET status = ?,
            erro_msg = ?,
            enviado_em = NOW(),
            atualizado_em = NOW()
        WHERE conta_receber_id = ?
          AND tipo = ?
    `, [status, errorMessage ? String(errorMessage).slice(0, 1000) : null, contaId, COBRANCA_ALERT_TYPE]);
}

async function enviarAvisosCobrancaVencida(deps) {
    const { pool, logger, enviarEmail, sendEmail } = deps;
    const recipients = getCobrancaRecipients();
    const destinatarios = recipients.join(',');

    if (!recipients.length) {
        logger.warn('[COBRANCA-CRON] Nenhum destinatario configurado para aviso de cobranca.');
        return { enviados: 0, ignorados: 0, falhas: 0 };
    }

    await ensureCobrancaAlertTable(pool);
    const contas = await buscarContasReceberVencidasFaturamento(pool, logger);
    let enviados = 0;
    let ignorados = 0;
    let falhas = 0;

    for (const conta of contas) {
        const template = buildCobrancaAlertTemplate(conta);
        const reservado = await reservarAlertaCobranca(pool, conta.id, destinatarios, template.subject);
        if (!reservado) {
            ignorados++;
            continue;
        }

        try {
            let result;
            if (typeof sendEmail === 'function') {
                result = await sendEmail(destinatarios, template.subject, template.html, template.text);
            } else if (typeof enviarEmail === 'function') {
                result = await enviarEmail(destinatarios, template.subject, template.text, template.html);
            } else {
                result = { success: false, error: 'Nenhum servico de email disponivel' };
            }

            const ok = result === true || result?.success === true;
            if (!ok) {
                throw new Error(result?.error || 'Falha ao enviar email de cobranca');
            }

            await finalizarAlertaCobranca(pool, conta.id, 'enviado');
            enviados++;
        } catch (err) {
            await finalizarAlertaCobranca(pool, conta.id, 'falha', err.message || err);
            logger.warn(`[COBRANCA-CRON] Falha ao enviar aviso da conta ${conta.id}:`, err?.message || err);
            falhas++;
        }
    }

    return { enviados, ignorados, falhas };
}

/**
 * Initialize all cron jobs
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - MySQL connection pool
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.enviarEmail - Email sending function
 * @param {Function} deps.sendEmail - HTML email sending function
 * @param {Object} deps.emailTransporter - Nodemailer transporter
 * @param {Function} deps.DB_AVAILABLE_FN - Function that returns DB availability
 */
function initScheduler(deps) {
    const { pool, logger, enviarEmail, sendEmail, emailTransporter, DB_AVAILABLE_FN } = deps;
    const isDbAvailable = typeof DB_AVAILABLE_FN === 'function' ? DB_AVAILABLE_FN : () => true;

    logger.info('â° Inicializando cron jobs (scheduler service)...');

    // 1. RelatÃ³rio diÃ¡rio de vendas por email (7h)
    cron.schedule('0 7 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            const [rows] = await pool.query('SELECT COUNT(*) AS total, COALESCE(SUM(valor), 0) AS faturado FROM pedidos WHERE DATE(created_at) = CURDATE()');
            const texto = `RelatÃ³rio diÃ¡rio:\nTotal de vendas: ${rows[0].total}\nFaturamento: R$ ${rows[0].faturado}`;
            const destinatario = process.env.EMAIL_RELATORIO_DIARIO || process.env.EMAIL_ADMIN;
            if (destinatario && enviarEmail) {
                await enviarEmail(destinatario, 'RelatÃ³rio DiÃ¡rio de Vendas', texto);
                logger.info('RelatÃ³rio diÃ¡rio enviado por email.');
            } else {
                logger.info('RelatÃ³rio diÃ¡rio gerado mas sem destinatÃ¡rio configurado.');
            }
        } catch (err) {
            logger.warn('Erro no cron diÃ¡rio:', err?.message || err);
        }
    });

    // 2. Backup automÃ¡tico do banco de dados (2h)
    cron.schedule('0 2 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            const { spawnSync } = require('child_process');
            const backupDir = path.join(__dirname, '..', 'backups', 'db');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const dbHost = process.env.DB_HOST || 'localhost';
            const dbUser = process.env.DB_USER || 'aluforce';
            const dbPass = process.env.DB_PASSWORD || '';
            const dbName = process.env.DB_NAME || 'aluforce_vendas';
            const backupFile = path.join(backupDir, `${dbName}_${ts}.sql.gz`);
            const dumpEnv = { ...process.env };
            if (dbPass) {
                dumpEnv.MYSQL_PWD = dbPass;
            }
            const mysqldump = spawnSync('mysqldump', [
                '-h', dbHost, '-u', dbUser,
                '--single-transaction', '--routines', '--triggers', dbName
            ], {
                env: dumpEnv,
                timeout: 120000,
                maxBuffer: 100 * 1024 * 1024
            });
            if (mysqldump.error) throw mysqldump.error;
            if (mysqldump.status !== 0) throw new Error(`mysqldump exited with code ${mysqldump.status}`);
            const zlib = require('zlib');
            const compressed = zlib.gzipSync(mysqldump.stdout);
            fs.writeFileSync(backupFile, compressed);
            // Limpar backups com mais de 30 dias
            const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
            for (const f of fs.readdirSync(backupDir)) {
                const fp = path.join(backupDir, f);
                if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
            }
            logger.info(`âœ… Backup DB realizado: ${backupFile}`);
        } catch (err) {
            logger.warn('Erro no cron de backup:', err?.message || err);
        }
    });

    // 3. Aviso interno de cobranca para pedidos faturados vencidos (8h)
    cron.schedule('0 8 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            const resultado = await enviarAvisosCobrancaVencida({ pool, logger, enviarEmail, sendEmail });
            logger.info(`[COBRANCA-CRON] Avisos internos processados. Enviados=${resultado.enviados}, ignorados=${resultado.ignorados}, falhas=${resultado.falhas}`);
        } catch (err) {
            logger.warn('[COBRANCA-CRON] Erro no aviso interno de cobranca:', err?.message || err);
        }
    });

    // 4. Verificar estoque mÃ­nimo (a cada 6h)
    cron.schedule('0 */6 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando estoque mÃ­nimo...');
            // Verificar se a procedure existe antes de chamar
            const [procs] = await pool.query("SELECT 1 FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = 'sp_verificar_estoque_minimo' LIMIT 1");
            if (procs.length > 0) {
                await pool.query('CALL sp_verificar_estoque_minimo()');
                logger.info('[COMPRAS-CRON] âœ… VerificaÃ§Ã£o de estoque concluÃ­da');
            } else {
                logger.warn('[COMPRAS-CRON] sp_verificar_estoque_minimo nÃ£o existe - pulando');
            }
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao verificar estoque:', err);
        }
    });

    // 5. Alertar sobre pedidos de compra atrasados (9h)
    cron.schedule('0 9 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando pedidos atrasados...');
            const [pedidosAtrasados] = await pool.query(`
                SELECT pc.id, pc.numero_pedido, pc.data_entrega_prevista,
                       f.razao_social as fornecedor,
                       u.id as solicitante_id, u.email as solicitante_email,
                       DATEDIFF(CURDATE(), pc.data_entrega_prevista) as dias_atraso
                FROM pedidos_compra pc
                JOIN fornecedores f ON pc.fornecedor_id = f.id
                JOIN usuarios u ON pc.usuario_solicitante_id = u.id
                WHERE pc.data_entrega_prevista < CURDATE()
                  AND pc.status NOT IN ('recebido', 'cancelado')
            `);
            for (const pedido of pedidosAtrasados) {
                await pool.execute(
                    `INSERT INTO compras_notificacoes
                    (usuario_id, tipo, titulo, mensagem, entidade_tipo, entidade_id, prioridade, enviar_email)
                    VALUES (?, 'entrega_atrasada', ?, ?, 'pedido_compra', ?, 'alta', TRUE)`,
                    [pedido.solicitante_id, 'Pedido com entrega atrasada',
                     `O pedido ${pedido.numero_pedido} do fornecedor ${pedido.fornecedor} estÃ¡ ${pedido.dias_atraso} dias atrasado.`,
                     pedido.id]
                );
                if (pedido.solicitante_email && sendEmail) {
                    await sendEmail(pedido.solicitante_email, 'Alerta: Pedido de compra atrasado',
                        `<h2>Pedido Atrasado</h2><p>O pedido <strong>${pedido.numero_pedido}</strong> estÃ¡ com <strong>${pedido.dias_atraso} dias</strong> de atraso.</p>`);
                }
            }
            logger.info(`[COMPRAS-CRON] âœ… Verificados ${pedidosAtrasados.length} pedidos atrasados`);
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao verificar pedidos atrasados:', err);
        }
    });

    // 6. DocumentaÃ§Ã£o de fornecedores vencendo (segundas 8h)
    cron.schedule('0 8 * * 1', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando documentaÃ§Ã£o de fornecedores...');
            const [fornecedores] = await pool.query(`
                SELECT id, razao_social, cnpj
                FROM fornecedores
                WHERE status = 'ativo'
                  AND (
                      data_vencimento_certidao_federal BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                      OR data_vencimento_certidao_estadual BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                      OR data_vencimento_certidao_municipal BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                      OR data_vencimento_certidao_fgts BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                      OR data_vencimento_certidao_trabalhista BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                  )
            `);
            const [comprador] = await pool.query(`SELECT id, email FROM usuarios WHERE area = 'compras' AND ativo = 1 ORDER BY id LIMIT 1`);
            if (comprador.length > 0) {
                for (const fornecedor of fornecedores) {
                    await pool.execute(
                        `INSERT INTO compras_notificacoes
                        (usuario_id, tipo, titulo, mensagem, entidade_tipo, entidade_id, prioridade, enviar_email)
                        VALUES (?, 'documentacao_vencendo', ?, ?, 'fornecedor', ?, 'normal', TRUE)`,
                        [comprador[0].id, 'DocumentaÃ§Ã£o de fornecedor vencendo',
                         `Fornecedor ${fornecedor.razao_social} com documentaÃ§Ã£o vencendo em atÃ© 30 dias`,
                         fornecedor.id]
                    );
                }
            }
            logger.info(`[COMPRAS-CRON] âœ… Verificados ${fornecedores.length} fornecedores com doc vencendo`);
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao verificar documentaÃ§Ã£o:', err);
        }
    });

    // 7. Lembretes de aprovaÃ§Ãµes pendentes (10h)
    cron.schedule('0 10 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando aprovaÃ§Ãµes pendentes...');
            const [aprovacoesAtrasadas] = await pool.query(`
                SELECT wa.id, wa.aprovador_id, wa.referencia_tipo, wa.referencia_id,
                       u.email as aprovador_email,
                       pc.numero_pedido, pc.valor_total,
                       DATEDIFF(CURDATE(), wa.created_at) as dias_pendente
                FROM workflow_aprovacoes wa
                JOIN usuarios u ON wa.aprovador_id = u.id
                LEFT JOIN pedidos_compra pc ON wa.referencia_id = pc.id AND wa.referencia_tipo = 'pedido_compra'
                WHERE wa.status = 'pendente'
                  AND DATEDIFF(CURDATE(), wa.created_at) >= 2
            `);
            for (const aprovacao of aprovacoesAtrasadas) {
                if (aprovacao.aprovador_email && sendEmail) {
                    await sendEmail(aprovacao.aprovador_email, 'Lembrete: AprovaÃ§Ã£o pendente',
                        `<h2>AprovaÃ§Ã£o Pendente</h2><p>Pendente hÃ¡ <strong>${aprovacao.dias_pendente} dias</strong>. Pedido: ${aprovacao.numero_pedido}</p>`);
                }
                // Marcar como notificado via dados_extras (coluna lembrete_enviado nÃ£o existe)
                await pool.execute('UPDATE workflow_aprovacoes SET dados_extras = JSON_SET(COALESCE(dados_extras, "{}" ), "$.lembrete_enviado", true, "$.data_lembrete", NOW()) WHERE id = ?', [aprovacao.id]);
            }
            logger.info(`[COMPRAS-CRON] âœ… Enviados ${aprovacoesAtrasadas.length} lembretes de aprovaÃ§Ã£o`);
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao enviar lembretes:', err);
        }
    });

    // 8. Atualizar avaliaÃ§Ãµes mÃ©dias dos fornecedores (domingos 3h)
    cron.schedule('0 3 * * 0', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[COMPRAS-CRON] Atualizando avaliaÃ§Ãµes de fornecedores...');
            await pool.query(`
                UPDATE fornecedores f SET
                    nota_qualidade = (SELECT AVG(nota_qualidade) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    nota_prazo = (SELECT AVG(nota_prazo) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    nota_preco = (SELECT AVG(nota_preco) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    nota_atendimento = (SELECT AVG(nota_atendimento) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    avaliacao_geral = (SELECT AVG((nota_qualidade + nota_prazo + nota_preco + nota_atendimento) / 4)
                        FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    total_pedidos = (SELECT COUNT(*) FROM pedidos_compra WHERE fornecedor_id = f.id AND status != 'cancelado'),
                    total_compras = (SELECT SUM(valor_total) FROM pedidos_compra WHERE fornecedor_id = f.id AND status = 'recebido')
                WHERE id IN (SELECT DISTINCT fornecedor_id FROM fornecedor_avaliacoes)
            `);
            logger.info('[COMPRAS-CRON] âœ… AvaliaÃ§Ãµes de fornecedores atualizadas');
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao atualizar avaliaÃ§Ãµes:', err);
        }
    });

    // 9. Expirar reservas e alertas de estoque baixo (3h)
    cron.schedule('0 3 * * *', async () => {
        try {
            logger.info('[ESTOQUE-CRON] Executando jobs de estoque...');
            const { expirarReservas, alertasEstoqueBaixo } = require('../cron_jobs_estoque');
            await expirarReservas();
            await alertasEstoqueBaixo();
            logger.info('[ESTOQUE-CRON] âœ… Jobs de estoque executados');
        } catch (err) {
            logger.error('[ESTOQUE-CRON] Erro ao executar jobs de estoque:', err);
        }
    });

    // 10. Auto-inativar clientes sem movimentaÃ§Ã£o (>90 dias) Ã s 4h
    cron.schedule('0 4 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[CLIENTES-CRON] Verificando clientes para inativaÃ§Ã£o automÃ¡tica...');
            const [result] = await pool.query(`
                UPDATE empresas
                SET status_cliente = 'inativo', data_inativacao = NOW(), vendedor_id = NULL
                WHERE status_cliente = 'ativo'
                AND (
                    (ultima_movimentacao IS NOT NULL AND ultima_movimentacao < DATE_SUB(NOW(), INTERVAL 90 DAY))
                    OR (ultima_movimentacao IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 90 DAY))
                )
            `);
            if (result.affectedRows > 0) {
                logger.info(`[CLIENTES-CRON] âœ… ${result.affectedRows} clientes inativados`);
            } else {
                logger.info('[CLIENTES-CRON] âœ… Nenhum cliente para inativar');
            }
        } catch (err) {
            logger.error('[CLIENTES-CRON] Erro ao inativar clientes:', err);
        }
    });

    // 11. RotaÃ§Ã£o de audit logs â€” remove registros > 90 dias (3h30)
    cron.schedule('30 3 * * *', async () => {
        if (!isDbAvailable()) return;
        const RETENTION_DAYS = 90;
        const tables = ['auditoria_logs', 'audit_logs', 'audit_log'];
        for (const table of tables) {
            try {
                const [result] = await pool.query(
                    `DELETE FROM \`${table}\` WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
                    [RETENTION_DAYS]
                );
                if (result.affectedRows > 0) {
                    logger.info(`[AUDIT-ROTATION] ${table}: ${result.affectedRows} registros antigos removidos (>${RETENTION_DAYS}d)`);
                }
            } catch (err) {
                // Tabela pode nÃ£o existir em todos os ambientes
                if (err.code !== 'ER_NO_SUCH_TABLE') {
                    logger.warn(`[AUDIT-ROTATION] ${table}: ${err.message}`);
                }
            }
        }
    });

    logger.info('âœ… Todos os 11 cron jobs configurados via scheduler service');
}

module.exports = {
    initScheduler,
    enviarAvisosCobrancaVencida,
    buildCobrancaAlertTemplate,
    buscarContasReceberVencidasFaturamento,
    COBRANCA_ALERT_RECIPIENTS
};
