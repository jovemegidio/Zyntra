/**
 * SCHEDULER SERVICE — Extracted cron jobs from server.js
 * AUDIT-FIX ARCH-002: Single Responsibility — cron logic in dedicated module
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
 * 11. Audit log rotation — 90 day retention (3:30am)
 * 
 * @module services/scheduler
 */

const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

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

    logger.info('⏰ Inicializando cron jobs (scheduler service)...');

    // 1. Relatório diário de vendas por email (7h)
    cron.schedule('0 7 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            const [rows] = await pool.query('SELECT COUNT(*) AS total, COALESCE(SUM(valor), 0) AS faturado FROM pedidos WHERE DATE(created_at) = CURDATE()');
            const texto = `Relatório diário:\nTotal de vendas: ${rows[0].total}\nFaturamento: R$ ${rows[0].faturado}`;
            const destinatario = process.env.EMAIL_RELATORIO_DIARIO || process.env.EMAIL_ADMIN;
            if (destinatario && enviarEmail) {
                await enviarEmail(destinatario, 'Relatório Diário de Vendas', texto);
                logger.info('Relatório diário enviado por email.');
            } else {
                logger.info('Relatório diário gerado mas sem destinatário configurado.');
            }
        } catch (err) {
            logger.warn('Erro no cron diário:', err?.message || err);
        }
    });

    // 2. Backup automático do banco de dados (2h)
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
            logger.info(`✅ Backup DB realizado: ${backupFile}`);
        } catch (err) {
            logger.warn('Erro no cron de backup:', err?.message || err);
        }
    });

    // 3. Notificação automática de cobranças (8h)
    cron.schedule('0 8 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            const [rows] = await pool.query('SELECT email, nome, valor FROM contas_receber WHERE status = "pendente" AND vencimento = CURDATE()');
            for (const cliente of rows) {
                if (enviarEmail) await enviarEmail(cliente.email, 'Cobrança Pendente', `Olá ${cliente.nome}, sua cobrança de R$ ${cliente.valor} vence hoje.`);
            }
            logger.info('Notificações de cobrança enviadas.');
        } catch (err) {
            logger.warn('Erro no cron de cobranças:', err?.message || err);
        }
    });

    // 4. Verificar estoque mínimo (a cada 6h)
    cron.schedule('0 */6 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando estoque mínimo...');
            // Verificar se a procedure existe antes de chamar
            const [procs] = await pool.query("SELECT 1 FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = 'sp_verificar_estoque_minimo' LIMIT 1");
            if (procs.length > 0) {
                await pool.query('CALL sp_verificar_estoque_minimo()');
                logger.info('[COMPRAS-CRON] ✅ Verificação de estoque concluída');
            } else {
                logger.warn('[COMPRAS-CRON] sp_verificar_estoque_minimo não existe - pulando');
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
                     `O pedido ${pedido.numero_pedido} do fornecedor ${pedido.fornecedor} está ${pedido.dias_atraso} dias atrasado.`,
                     pedido.id]
                );
                if (pedido.solicitante_email && sendEmail) {
                    await sendEmail(pedido.solicitante_email, 'Alerta: Pedido de compra atrasado',
                        `<h2>Pedido Atrasado</h2><p>O pedido <strong>${pedido.numero_pedido}</strong> está com <strong>${pedido.dias_atraso} dias</strong> de atraso.</p>`);
                }
            }
            logger.info(`[COMPRAS-CRON] ✅ Verificados ${pedidosAtrasados.length} pedidos atrasados`);
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao verificar pedidos atrasados:', err);
        }
    });

    // 6. Documentação de fornecedores vencendo (segundas 8h)
    cron.schedule('0 8 * * 1', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando documentação de fornecedores...');
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
                        [comprador[0].id, 'Documentação de fornecedor vencendo',
                         `Fornecedor ${fornecedor.razao_social} com documentação vencendo em até 30 dias`,
                         fornecedor.id]
                    );
                }
            }
            logger.info(`[COMPRAS-CRON] ✅ Verificados ${fornecedores.length} fornecedores com doc vencendo`);
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao verificar documentação:', err);
        }
    });

    // 7. Lembretes de aprovações pendentes (10h)
    cron.schedule('0 10 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando aprovações pendentes...');
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
                    await sendEmail(aprovacao.aprovador_email, 'Lembrete: Aprovação pendente',
                        `<h2>Aprovação Pendente</h2><p>Pendente há <strong>${aprovacao.dias_pendente} dias</strong>. Pedido: ${aprovacao.numero_pedido}</p>`);
                }
                // Marcar como notificado via dados_extras (coluna lembrete_enviado não existe)
                await pool.execute('UPDATE workflow_aprovacoes SET dados_extras = JSON_SET(COALESCE(dados_extras, "{}" ), "$.lembrete_enviado", true, "$.data_lembrete", NOW()) WHERE id = ?', [aprovacao.id]);
            }
            logger.info(`[COMPRAS-CRON] ✅ Enviados ${aprovacoesAtrasadas.length} lembretes de aprovação`);
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao enviar lembretes:', err);
        }
    });

    // 8. Atualizar avaliações médias dos fornecedores (domingos 3h)
    cron.schedule('0 3 * * 0', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[COMPRAS-CRON] Atualizando avaliações de fornecedores...');
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
            logger.info('[COMPRAS-CRON] ✅ Avaliações de fornecedores atualizadas');
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao atualizar avaliações:', err);
        }
    });

    // 9. Expirar reservas e alertas de estoque baixo (3h)
    cron.schedule('0 3 * * *', async () => {
        try {
            logger.info('[ESTOQUE-CRON] Executando jobs de estoque...');
            const { expirarReservas, alertasEstoqueBaixo } = require('../cron_jobs_estoque');
            await expirarReservas();
            await alertasEstoqueBaixo();
            logger.info('[ESTOQUE-CRON] ✅ Jobs de estoque executados');
        } catch (err) {
            logger.error('[ESTOQUE-CRON] Erro ao executar jobs de estoque:', err);
        }
    });

    // 10. Auto-inativar clientes sem movimentação (>90 dias) às 4h
    cron.schedule('0 4 * * *', async () => {
        if (!isDbAvailable()) return;
        try {
            logger.info('[CLIENTES-CRON] Verificando clientes para inativação automática...');
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
                logger.info(`[CLIENTES-CRON] ✅ ${result.affectedRows} clientes inativados`);
            } else {
                logger.info('[CLIENTES-CRON] ✅ Nenhum cliente para inativar');
            }
        } catch (err) {
            logger.error('[CLIENTES-CRON] Erro ao inativar clientes:', err);
        }
    });

    // 11. Rotação de audit logs — remove registros > 90 dias (3h30)
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
                // Tabela pode não existir em todos os ambientes
                if (err.code !== 'ER_NO_SUCH_TABLE') {
                    logger.warn(`[AUDIT-ROTATION] ${table}: ${err.message}`);
                }
            }
        }
    });

    logger.info('✅ Todos os 11 cron jobs configurados via scheduler service');
}

module.exports = { initScheduler };
