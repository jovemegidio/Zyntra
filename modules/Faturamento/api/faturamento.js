const express = require('express');
const router = express.Router();
const path = require('path');
const archiver = require('archiver');

// BUG-FAT-018: rejeitar :id malformado (ex.: "1'or'1'='1") em vez de coagir p/ inteiro e
// responder 200. Aceita id inteiro positivo OU chave de acesso NF-e (44 dígitos). Endurece a
// superfície de entrada — a parametrização já evita SQLi, mas lixo não deve ser aceito.
router.param('id', (req, res, next, value) => {
    const v = String(value).trim();
    if (/^[1-9]\d*$/.test(v) || /^\d{44}$/.test(v)) return next();
    return res.status(400).json({ success: false, code: 'ID_INVALIDO', message: 'Identificador inválido.' });
});

// VULN-013 FIX: Audit trail para operações fiscais críticas
const { logAuditEvent } = require('../../../middleware/audit-trail');

// Serviços
const CalculoTributosService = require('../services/calculo-tributos.service');
const FiscalProfileService = require('../services/fiscal-profile.service');
const XmlNFeService = require('../services/xml-nfe.service');
const { auditarContraPedido } = require('../services/nfe-divergencia-pedido.service');
const NFePedidoMapper = require('../../_shared/services/nfe-pedido.mapper');
const certificadoService = require('../services/certificado.service');
const sefazService = require('../services/sefaz.service');
const nfeConfig = require('../config/nfe.config');
const danfeService = require('../services/danfe.service');
const FinanceiroIntegracaoService = require('../services/financeiro-integracao.service');
const VendasEstoqueIntegracaoService = require('../services/vendas-estoque-integracao.service');
const PixGatewayService = require('../services/pix-gateway.service');
const ReguaCobrancaService = require('../services/regua-cobranca.service');
const { enviarEmail, isConfigured: isEmailConfigured } = require('../../../utils/email');
const { templateNotaFiscalEmitida, REMETENTE_NOTIFICACOES } = require('../../../services/email-templates');
const { emitirNFePedido } = require('../../../services/nfe-emitter.service');
const { resolverNaturezaOperacao, aplicarPerfilCfop } = require('../../../services/cfop-operacao.service');
const EtiquetaExpedicaoService = require('../services/etiqueta-expedicao.service');
const FiscalAccessService = require('../services/fiscal-access.service');
const NfeCorrecaoService = require('../services/nfe-correcao.service');
const FiscalReadinessService = require('../services/fiscal-readiness.service');

/**
 * MÓDULO DE FATURAMENTO NF-e COMPLETO
 * Sistema completo de faturamento com integração NFe, SEFAZ, Financeiro, Vendas e PCP
 */

// Helpers fiscais puros (testáveis isoladamente em tests/faturamento-fiscal.test.js):
// mensagemSegura (BUG-FAT-003), pedidoIdValido (BUG-FAT-005), regimeParaLabel (BUG-FAT-001).
const {
    mensagemSegura,
    pedidoIdValido,
    regimeParaLabel,
    ajustarAlcanceCFOP,
    resolverCodigoMunicipioCliente,
    podeGerarDanfe,
    resolverIndicadorIE
} = require('../services/fiscal-helpers');

module.exports = (pool, authenticateToken) => {

    // Deixa o emitter de NF-e saber quem disparou a ação (log de não repúdio do envio).
    router.use(require('../../../services/request-context').middleware);

    // Vigilância do log fiscal de NF-e: reverifica cadeia, âncoras e espelho a cada 15 min desde
    // o BOOT (antes só começava na primeira emissão depois de cada restart) e alerta se algo
    // divergir. Nunca lança; NFE_AUDIT_VIGILANCIA=off desliga.
    try { require('../../../services/nfe-confirmacao-audit.service').iniciarVigilancia(pool); }
    catch (e) { console.error('[FATURAMENTO] vigilância do log fiscal não iniciou:', e.message); }

    // `pedidos.parcelas` guarda ora um JSON ({"parcela":[...]}), ora um texto simples
    // ("30", "30/60", "À vista"), conforme a origem do pedido. Quem consome (a ficha do
    // pedido) não deve adivinhar o formato: JSON vira objeto, texto continua texto.
    const normalizarParcelas = (valor) => {
        if (!valor) return null;
        if (typeof valor === 'object') return valor;
        const texto = String(valor).trim();
        if (!texto) return null;
        try { return JSON.parse(texto); } catch (_) { return texto; }
    };

    // PM2 reinicia o processo, mas o PFX permanece no banco/arquivo. Reidrata o
    // singleton fiscal no startup e repete a garantia antes de cada uso crítico.
    const garantirCertificadoPersistido = () => certificadoService.carregarCertificadoPersistido(pool, 1);
    garantirCertificadoPersistido().catch(error => {
        console.warn('[FATURAMENTO] Certificado persistido não carregado no startup:', error.message);
    });

    // Serviço compartilhado de faturamento (configuração centralizada, numeração, CFOP, admin check)
    const { getFaturamentoSharedService } = require('../../../services/faturamento-shared.service');
    const faturamentoShared = getFaturamentoSharedService(pool);

    // BUG-FAT-003: o código gravava/lia a coluna nfes.numero_protocolo, que não existe nas
    // bases em produção (o schema real usa protocolo_autorizacao) — o PUT respondia 500 com
    // vazamento do erro SQL e o enviar-sefaz quebraria exatamente no momento da autorização.
    // O código foi padronizado em protocolo_autorizacao; aqui garantimos as colunas auxiliares
    // que os fluxos de autorização/cancelamento gravam (mesmo padrão ensure de vendas-routes).
    const nfesColumnsEnsure = [
        ['protocolo_autorizacao', 'VARCHAR(20) NULL'],
        ['data_autorizacao', 'DATETIME NULL'],
        ['xml_assinado', 'LONGTEXT NULL'],
        ['xml_protocolo', 'LONGTEXT NULL'],
        ['autorizado_por', 'INT NULL'],
        ['emitente_uf', 'VARCHAR(2) NULL'],
        ['emitente_cnpj', 'VARCHAR(14) NULL'],
        ['motivo_cancelamento', 'VARCHAR(255) NULL'],
        ['data_cancelamento', 'DATETIME NULL'],
        ['cancelada_por', 'INT NULL'],
        ['estoque_baixado', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['data_baixa_estoque', 'DATETIME NULL'],
        ['data_estorno_estoque', 'DATETIME NULL'],
        // Último retorno da autorização. Mantemos estes dados na própria NF-e para a
        // listagem conseguir sinalizar a falha e explicar o retorno mesmo após um reload.
        ['sefaz_codigo_status', 'VARCHAR(40) NULL'],
        ['sefaz_motivo', 'VARCHAR(500) NULL'],
        ['sefaz_data_retorno', 'DATETIME NULL'],
        ['sefaz_ambiente', 'VARCHAR(20) NULL'],
        ['sefaz_tipo_retorno', 'VARCHAR(40) NULL'],
        // ICMS-ST e FCP nao tinham NENHUMA coluna em `nfes` nem em `nfe_itens` — o valor
        // existia so dentro do XML. Por isso o painel de rejeicao, a conferencia fiscal e
        // os relatorios nunca conseguiram mostrar o ST de uma nota, e a regeracao nao
        // tinha como ser auditada. Criadas em 11/09/2026 junto com a correcao da NF-e 919.
        ['base_calculo_icms_st', 'DECIMAL(15,2) NOT NULL DEFAULT 0'],
        ['valor_icms_st', 'DECIMAL(15,2) NOT NULL DEFAULT 0'],
        ['valor_fcp', 'DECIMAL(15,2) NOT NULL DEFAULT 0'],
        ['valor_fcp_st', 'DECIMAL(15,2) NOT NULL DEFAULT 0']
    ];
    // Mesmas informacoes no nivel do item: e por item que a SEFAZ valida o somatorio
    // (cStat 610), entao e por item que precisamos conseguir conferir.
    const nfeItensColumnsEnsure = [
        ['cfop', 'VARCHAR(4) NULL'],
        ['cst_icms', 'VARCHAR(3) NULL'],
        ['csosn_icms', 'VARCHAR(3) NULL'],
        ['base_calculo_icms_st', 'DECIMAL(15,2) NOT NULL DEFAULT 0'],
        ['valor_icms_st', 'DECIMAL(15,2) NOT NULL DEFAULT 0'],
        ['aliquota_icms_st', 'DECIMAL(7,4) NOT NULL DEFAULT 0'],
        ['mva_st', 'DECIMAL(7,4) NOT NULL DEFAULT 0'],
        ['valor_fcp', 'DECIMAL(15,2) NOT NULL DEFAULT 0'],
        ['valor_fcp_st', 'DECIMAL(15,2) NOT NULL DEFAULT 0']
    ];
    const nfesColumnsReady = (async () => {
        for (const [column, definition] of nfesColumnsEnsure) {
            try {
                const [existing] = await pool.query('SHOW COLUMNS FROM nfes LIKE ?', [column]);
                if (existing.length === 0) {
                    await pool.query(`ALTER TABLE nfes ADD COLUMN \`${column}\` ${definition}`);
                    console.log(`[FATURAMENTO] Coluna nfes.${column} criada (ensure de schema)`);
                }
            } catch (err) {
                if (err.code !== 'ER_DUP_FIELDNAME') {
                    console.error(`[FATURAMENTO] Ensure de coluna nfes.${column} falhou:`, err.message);
                }
            }
        }

        // O catálogo fiscal contém naturezas válidas acima de 60 caracteres
        // (por exemplo, CFOP 5401). Bases antigas ainda usavam VARCHAR(60), embora
        // pedidos.natureza_operacao já aceite 120, e a emissão falhava antes de
        // gravar a NF-e. Mantém as duas superfícies com o mesmo limite.
        try {
            const [[naturezaColumn]] = await pool.query(`
                SELECT CHARACTER_MAXIMUM_LENGTH AS max_length
                  FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'nfes'
                   AND COLUMN_NAME = 'natureza_operacao'
                 LIMIT 1
            `);
            if (naturezaColumn && Number(naturezaColumn.max_length) < 120) {
                await pool.query('ALTER TABLE nfes MODIFY COLUMN natureza_operacao VARCHAR(120) NOT NULL');
                console.log('[FATURAMENTO] Coluna nfes.natureza_operacao ampliada para VARCHAR(120)');
            }
        } catch (err) {
            console.error('[FATURAMENTO] Ajuste de nfes.natureza_operacao falhou:', err.message);
        }

        for (const [column, definition] of nfeItensColumnsEnsure) {
            try {
                const [existing] = await pool.query('SHOW COLUMNS FROM nfe_itens LIKE ?', [column]);
                if (existing.length === 0) {
                    await pool.query(`ALTER TABLE nfe_itens ADD COLUMN \`${column}\` ${definition}`);
                    console.log(`[FATURAMENTO] Coluna nfe_itens.${column} criada (ensure de schema)`);
                }
            } catch (err) {
                if (err.code !== 'ER_DUP_FIELDNAME') {
                    console.error(`[FATURAMENTO] Ensure de coluna nfe_itens.${column} falhou:`, err.message);
                }
            }
        }

        // Algumas autorizações legadas persistiram o XML protocolado, mas deixaram
        // chave/protocolo fora das colunas de consulta. A listagem então rebaixava a
        // NF-e para "pendente" e os endpoints de evento impediam CC-e/cancelamento,
        // embora o <protNFe> trouxesse cStat 100. Reconciliar no startup torna o XML
        // autorizado a fonte de recuperação sem aceitar registros meramente editados.
        try {
            const [candidatas] = await pool.query(`
                SELECT id, status, chave_acesso, protocolo_autorizacao, xml_protocolo, xml_nfe
                  FROM nfes
                 WHERE LOWER(COALESCE(status, '')) IN ('autorizada', 'authorized', 'emitida', 'pendente')
                   AND (COALESCE(xml_protocolo, '') <> '' OR COALESCE(xml_nfe, '') <> '')
                   AND (COALESCE(chave_acesso, '') = ''
                        OR COALESCE(protocolo_autorizacao, '') = ''
                        OR LOWER(COALESCE(status, '')) <> 'autorizada')
            `);
            let reconciliadas = 0;
            for (const nota of candidatas) {
                const xml = [nota.xml_protocolo, nota.xml_nfe].filter(Boolean).join('\n');
                const autorizadaNoXml = /<(?:\w+:)?cStat(?:\s[^>]*)?>\s*100\s*<\/(?:\w+:)?cStat>/i.test(xml);
                const protocolo = (xml.match(/<(?:\w+:)?nProt(?:\s[^>]*)?>\s*(\d+)\s*<\/(?:\w+:)?nProt>/i) || [])[1];
                const chave = (xml.match(/<(?:\w+:)?chNFe(?:\s[^>]*)?>\s*(\d{44})\s*<\/(?:\w+:)?chNFe>/i) || [])[1];
                const chaveFinal = String(nota.chave_acesso || '').replace(/\D/g, '') || chave;
                const protocoloFinal = String(nota.protocolo_autorizacao || '').trim() || protocolo;
                if (!autorizadaNoXml || !protocoloFinal || !/^\d{44}$/.test(chaveFinal || '')) continue;

                await pool.query(`
                    UPDATE nfes
                       SET status = 'autorizada', chave_acesso = ?, protocolo_autorizacao = ?
                     WHERE id = ?
                `, [chaveFinal, protocoloFinal, nota.id]);
                reconciliadas += 1;
            }
            if (reconciliadas) {
                console.log(`[FATURAMENTO] ${reconciliadas} NF-e(s) autorizada(s) reconciliada(s) a partir do XML protocolado`);
            }
        } catch (err) {
            console.error('[FATURAMENTO] Reconciliação de autorizações legadas falhou:', err.message);
        }
    })();

    // As três bases em produção nasceram com descricao_evento/protocolo_evento,
    // enquanto o módulo atual usa descricao/protocolo/sequencia. Mantemos as colunas
    // canônicas e migramos o histórico legado sem apagar os campos antigos.
    const nfeEventosColumnsReady = (async () => {
        try {
            const [tabelas] = await pool.query("SHOW TABLES LIKE 'nfe_eventos'");
            if (tabelas.length === 0) return;

            const [colunasAtuais] = await pool.query('SHOW COLUMNS FROM nfe_eventos');
            const nomes = new Set(colunasAtuais.map(coluna => coluna.Field));
            const colunasNecessarias = [
                ['sequencia', 'INT NULL'],
                ['descricao', 'TEXT NULL'],
                ['protocolo', 'VARCHAR(20) NULL']
            ];
            for (const [coluna, definicao] of colunasNecessarias) {
                if (!nomes.has(coluna)) {
                    await pool.query(`ALTER TABLE nfe_eventos ADD COLUMN \`${coluna}\` ${definicao}`);
                    nomes.add(coluna);
                    console.log(`[FATURAMENTO] Coluna nfe_eventos.${coluna} criada (compatibilidade de schema)`);
                }
            }

            if (nomes.has('descricao_evento')) {
                await pool.query(`UPDATE nfe_eventos SET descricao = descricao_evento
                                  WHERE descricao IS NULL AND descricao_evento IS NOT NULL`);
            }
            if (nomes.has('protocolo_evento')) {
                await pool.query(`UPDATE nfe_eventos SET protocolo = protocolo_evento
                                  WHERE protocolo IS NULL AND protocolo_evento IS NOT NULL`);
            }

            // Um evento fiscal é identificado pela nota, tipo e sequência. O índice
            // transforma reenvios/reconciliações em operações idempotentes e impede
            // duas linhas locais para o mesmo evento homologado pela SEFAZ.
            const [indices] = await pool.query('SHOW INDEX FROM nfe_eventos WHERE Key_name = ?', ['uk_nfe_evento_seq']);
            if (indices.length === 0) {
                await pool.query(`ALTER TABLE nfe_eventos
                                  ADD UNIQUE KEY uk_nfe_evento_seq (nfe_id, tipo_evento, sequencia)`);
                console.log('[FATURAMENTO] Índice único nfe_eventos.uk_nfe_evento_seq criado');
            }
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                console.error('[FATURAMENTO] Falha ao compatibilizar nfe_eventos:', err.message);
                throw err;
            }
        }
    })();

    const ambienteSefazAtual = Number(nfeConfig.ambiente) === 1 ? 'producao' : 'homologacao';
    const NFE_DETAIL_QUERY_TIMEOUT_MS = 8000;
    const consultarDetalheNfe = (sql, params) => pool.query({
        sql,
        timeout: NFE_DETAIL_QUERY_TIMEOUT_MS
    }, params);

    async function registrarFalhaSefaz(connection, nfeId, dados = {}) {
        const status = dados.status === 'rejeitada' ? 'rejeitada' : 'erro';
        const codigo = String(dados.codigo || 'SEFAZ_ERRO').slice(0, 40);
        const motivo = String(dados.motivo || 'Falha não detalhada pela SEFAZ').slice(0, 500);
        const tipo = String(dados.tipo || (status === 'rejeitada' ? 'rejeicao' : 'comunicacao')).slice(0, 40);
        await connection.query(`
            UPDATE nfes
               SET status = ?, sefaz_codigo_status = ?, sefaz_motivo = ?,
                   sefaz_data_retorno = NOW(), sefaz_ambiente = ?, sefaz_tipo_retorno = ?
             WHERE id = ?
        `, [status, codigo, motivo, ambienteSefazAtual, tipo, nfeId]);
    }

    // Inicializar serviços de integração
    const financeiroService = new FinanceiroIntegracaoService(pool);
    const vendasEstoqueService = new VendasEstoqueIntegracaoService(pool);
    const pixService = new PixGatewayService(pool);
    const reguaService = new ReguaCobrancaService(pool);

    // A autorização fiscal é o gatilho operacional da expedição. O espelho é
    // atualizado de forma idempotente para que reconsultas ou retransmissões não
    // criem uma segunda expedição nem regridam uma etapa já avançada.
    async function sincronizarExpedicaoAposAutorizacao(nfe) {
        if (!nfe || !nfe.pedido_id) return { sincronizada: false, motivo: 'sem_pedido' };
        try {
            const [[pedido]] = await pool.query(`
                SELECT p.id, p.empresa_id, p.nf, p.numero_nf, p.cliente_nome, p.transportadora_id,
                       p.endereco_entrega, p.data_prevista, p.frete, p.prioridade,
                       COALESCE(t.nome_fantasia, t.razao_social) AS transportadora_nome
                FROM pedidos p
                LEFT JOIN transportadoras t ON t.id = p.transportadora_id
                WHERE p.id = ?
            `, [nfe.pedido_id]);
            if (!pedido) return { sincronizada: false, motivo: 'pedido_nao_encontrado' };
            const empresaId = nfe.empresa_id || pedido.empresa_id || 1;

            await pool.query(`
                UPDATE pedidos
                   SET status_logistica = CASE
                       WHEN status_logistica IS NULL OR status_logistica IN ('', 'pendente', 'aguardando')
                       THEN 'aguardando_separacao' ELSE status_logistica END
                 WHERE id = ? AND empresa_id = ?
            `, [nfe.pedido_id, empresaId]);

            await pool.query(`
                INSERT INTO expedicoes (
                    empresa_id, pedido_id, nfe_numero, cliente_nome, transportadora_id,
                    transportadora, endereco_entrega, data_entrega_prevista, custo_frete,
                    status, prioridade
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando_separacao', ?)
                ON DUPLICATE KEY UPDATE
                    nfe_numero = VALUES(nfe_numero),
                    cliente_nome = COALESCE(VALUES(cliente_nome), expedicoes.cliente_nome),
                    transportadora_id = COALESCE(VALUES(transportadora_id), expedicoes.transportadora_id),
                    transportadora = COALESCE(VALUES(transportadora), expedicoes.transportadora),
                    endereco_entrega = COALESCE(VALUES(endereco_entrega), expedicoes.endereco_entrega),
                    data_entrega_prevista = COALESCE(VALUES(data_entrega_prevista), expedicoes.data_entrega_prevista),
                    custo_frete = VALUES(custo_frete),
                    status = CASE
                        WHEN expedicoes.status IS NULL OR expedicoes.status IN ('', 'pendente', 'aguardando')
                        THEN 'aguardando_separacao' ELSE expedicoes.status END,
                    prioridade = COALESCE(VALUES(prioridade), expedicoes.prioridade)
            `, [
                empresaId,
                pedido.id,
                nfe.numero || nfe.numero_nfe || pedido.nf || pedido.numero_nf || null,
                pedido.cliente_nome || null,
                pedido.transportadora_id || null,
                pedido.transportadora_nome || null,
                pedido.endereco_entrega || null,
                pedido.data_prevista || null,
                pedido.frete || 0,
                pedido.prioridade || 'normal'
            ]);
            return { sincronizada: true, status: 'aguardando_separacao' };
        } catch (error) {
            // A NF-e autorizada não deve ser desfeita por uma indisponibilidade
            // operacional. A pendência fica explícita na resposta e no log.
            console.error('[FATURAMENTO→LOGISTICA] Expedição não sincronizada:', error.message);
            return { sincronizada: false, motivo: mensagemSegura(error) };
        }
    }

    // Criar tabelas PIX na inicialização
    pixService.criarTabelas().catch(err => console.error('[PIX] Erro ao criar tabelas:', err));

    // Criar tabelas e iniciar serviço da Régua
    reguaService.criarTabelas().then(() => {
        reguaService.configurarEmailTransporter();
        reguaService.iniciarServico();
    }).catch(err => console.error('[RÉGUA] Erro ao inicializar:', err));

    // ============================================================
    // HELPER: Enviar DANFE por email ao cliente
    // ============================================================
    // Emails fixos que SEMPRE recebem DANFE
    // Definido pela operação em 14/08/2026: SÓ a logística recebe nota fiscal e eventos.
    // Antes a lista trazia `aluforce@aluforce.ind.br` e o código ainda somava, sozinho, o
    // e-mail do CLIENTE e o de quem emitiu — foi assim que um envio da NF-e 4299 saiu para
    // 4 endereços, incluindo um gmail pessoal e um `ti@`. Além de indesejado, isso derrubava
    // a entrega: os destinatários vão num único e-mail, então um endereço que bounça faz o
    // Resend suprimir a mensagem INTEIRA e ninguém recebe.
    const DANFE_DESTINATARIOS_FIXOS = ['logistica@aluforce.ind.br', 'logistica@laboreletric.com.br'];

    // ------------------------------------------------------------------
    // PAUSA TEMPORÁRIA DE ENVIO — remover quando o desbloqueio sair.
    //
    // 14/08/2026: o MX da aluforce (host3074.hospedameusite.net) recusa com
    //   550 5.7.1 SPFBL BLOCKED
    // porque `zyntraerp.com.br` não tem registro SPF publicado. Cada tentativa vira
    // hard bounce, e o SPFBL avisa explicitamente: "aguarde pelo desbloqueio sem enviar
    // novas mensagens" — continuar tentando prejudica a reputação do domínio durante a
    // própria análise do pedido de desbloqueio.
    //
    // Pausar é melhor que remover da lista fixa: o endereço continua declarado como
    // destinatário legítimo, o log diz em toda tentativa por que não foi, e restaurar é
    // apagar UMA linha — em vez de alguém precisar lembrar de recadastrar.
    //
    // PARA RESTAURAR (nesta ordem):
    //   1. publicar SPF na raiz de zyntraerp.com.br (v=spf1 include:amazonses.com ~all)
    //   2. confirmar o desbloqueio no SPFBL (o e-mail de confirmação vai para a caixa)
    //   3. esvaziar este array e reiniciar o PM2 nas 3 instâncias
    // ------------------------------------------------------------------
    const DESTINATARIOS_PAUSADOS = [
        { email: 'logistica@aluforce.ind.br', motivo: 'SPFBL BLOCKED — aguardando desbloqueio (desde 14/08/2026)' }
    ];

    function filtrarPausados(lista, contexto) {
        return lista.filter((endereco) => {
            const pausa = DESTINATARIOS_PAUSADOS.find(
                (p) => p.email.toLowerCase() === String(endereco).toLowerCase()
            );
            if (!pausa) return true;
            // Em voz alta, sempre: pausa silenciosa vira "o e-mail sumiu" daqui a um mês.
            console.warn(`[FATURAMENTO-EMAIL] ⏸ ${contexto}: envio a ${endereco} PAUSADO — ${pausa.motivo}`);
            return false;
        });
    }

    /**
     * Reúne os dados que o e-mail de "nota fiscal emitida" mostra.
     * Lê da própria nfes (que já guarda destinatário, série e valores no
     * momento da geração) e completa com o cadastro do cliente.
     */
    async function carregarDadosNotaParaEmail(nfeId) {
        const [[nota]] = await pool.query(`
            SELECT n.id, n.numero, n.serie, n.status, n.chave_acesso, n.protocolo_autorizacao,
                   n.data_autorizacao, n.valor_total, n.natureza_operacao, n.pedido_id,
                   n.destinatario_nome, n.destinatario_cnpj_cpf, n.xml_protocolo, n.xml_nfe,
                   c.email AS cliente_email, c.email_nfe AS cliente_email_nfe,
                   COALESCE(c.nome, c.razao_social, n.destinatario_nome) AS cliente_nome,
                   COALESCE(c.cnpj, c.cnpj_cpf, c.cpf, n.destinatario_cnpj_cpf) AS cliente_documento,
                   u.nome AS autorizado_por_nome, u.email AS autorizado_por_email
            FROM nfes n
            LEFT JOIN clientes c ON n.cliente_id = c.id
            LEFT JOIN usuarios u ON n.autorizado_por = u.id
            WHERE n.id = ?
        `, [nfeId]);

        if (!nota) return null;

        // Itens: enriquecem o corpo do e-mail, mas nenhum deles é
        // obrigatório — base sem pedido vinculado só manda os totais.
        let itens = [];
        if (nota.pedido_id) {
            try {
                const [linhas] = await pool.query(
                    `SELECT descricao, quantidade, unidade FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC LIMIT 50`,
                    [nota.pedido_id]
                );
                itens = linhas || [];
            } catch (_) { /* pedido_itens ausente nesta base */ }
        }

        return { ...nota, itens };
    }

    /**
     * Envia o aviso de nota emitida com DANFE (PDF) e XML autorizado.
     *
     * @param {number} nfeId
     * @param {object} [opcoes]
     * @param {string} [opcoes.emitidoPorEmail]    e-mail de quem autorizou — só para log, NÃO recebe
     * @param {string} [opcoes.destinatarioExtra]  endereço avulso (envio manual pela tela)
     */
    /**
     * Espelha o envio no histórico do PEDIDO, na tabela `emails_enviados` — que é o que o
     * modal "Emails Enviados" da tela de Vendas lê (GET /api/vendas/pedidos/:id/emails).
     *
     * Até 19/08/2026 os e-mails deste módulo saíam SEM registrar: reenviar a nota pela
     * listagem de NF-e (POST /api/faturamento/nfes/:id/enviar-email) mandava o DANFE+XML ao
     * destinatário e o pedido continuava mostrando "Nenhum email enviado". Só o caminho de
     * services/nfe-notificacao.service.js registrava.
     *
     * Best-effort e silencioso, de propósito: quando isto roda o e-mail JÁ saiu, e falhar o
     * registro não pode derrubar nem mascarar o envio. O helper reaproveitado também não lança.
     */
    async function registrarNoHistoricoDoPedido({ pedidoId, destinatario, assunto, corpo, ok, usuarioNome }) {
        if (!pedidoId || !destinatario) return;
        try {
            const { registrarEmailEnviado } = require('../../../services/nfe-notificacao.service');
            await registrarEmailEnviado(pool, {
                pedidoId,
                destinatario,
                assunto,
                corpo,
                status: ok ? 'enviado' : 'erro',
                usuarioNome: usuarioNome || 'Sistema (faturamento)'
            });
        } catch (e) {
            console.warn('[FATURAMENTO-EMAIL] histórico do pedido não registrado:', e.message);
        }
    }

    async function enviarDanfeEmail(nfeId, opcoes = {}) {
        if (!isEmailConfigured()) {
            console.log(`[FATURAMENTO-EMAIL] Email não enviado: SMTP não configurado`);
            return { enviado: false, motivo: 'SMTP não configurado' };
        }

        try {
            const nota = await carregarDadosNotaParaEmail(nfeId);
            if (!nota) return { enviado: false, motivo: 'NF-e não encontrada' };

            // DANFE/XML só podem seguir para a logística depois da autorização.
            // A NF-e 906 comprovou a falha anterior: o XML foi criado, enviado por
            // e-mail e depois rejeitado pela SEFAZ (cStat 302). Sem status autorizado
            // E protocolo não existe documento fiscal válido para expedição.
            const autorizada = String(nota.status || '').toLowerCase() === 'autorizada';
            const protocolo = String(nota.protocolo_autorizacao || '').trim();
            if (!autorizada || !protocolo) {
                console.warn(`[FATURAMENTO-EMAIL] NF-e ${nota.numero} não enviada: `
                    + `status=${nota.status || 'sem status'}, protocolo ausente.`);
                return {
                    enviado: false,
                    bloqueado: true,
                    motivo: 'NF-e ainda não autorizada pela SEFAZ'
                };
            }

            // Destinatários: SOMENTE as caixas da logística. O e-mail do cliente e o de
            // quem emitiu eram somados aqui automaticamente e deixaram de ser — a nota
            // fiscal não deve sair para terceiros por efeito colateral do faturamento.
            // `destinatarioExtra` sobrevive porque é ato explícito: alguém abriu a tela e
            // digitou o endereço em "enviar por e-mail". Nenhum envio automático o usa.
            const destinatarios = new Set(DANFE_DESTINATARIOS_FIXOS.map((e) => e.toLowerCase()));
            if (opcoes.destinatarioExtra) destinatarios.add(String(opcoes.destinatarioExtra).toLowerCase().trim());

            const DANFEService = require('../../../src/nfe/services/DANFEService');
            const danfeSvc = new DANFEService(pool);
            const pdfBuffer = await danfeSvc.gerarDANFE(nfeId);

            const anexos = [{
                filename: `DANFE-${nota.numero}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }];

            // O XML autorizado (com protNFe) é o documento que tem validade
            // fiscal — a DANFE é só a representação impressa.
            const xmlAutorizado = nota.xml_protocolo || nota.xml_nfe;
            if (xmlAutorizado) {
                anexos.push({
                    filename: `NFe-${nota.chave_acesso || nota.numero}.xml`,
                    content: Buffer.from(String(xmlAutorizado), 'utf8'),
                    contentType: 'application/xml'
                });
            }

            const mensagem = templateNotaFiscalEmitida({
                numero: nota.numero,
                serie: nota.serie,
                chave: nota.chave_acesso,
                protocolo: nota.protocolo_autorizacao,
                dataAutorizacao: nota.data_autorizacao,
                clienteNome: nota.cliente_nome || nota.destinatario_nome,
                clienteDocumento: nota.cliente_documento || nota.destinatario_cnpj_cpf,
                valorTotal: nota.valor_total,
                naturezaOperacao: nota.natureza_operacao,
                numeroPedido: nota.pedido_id,
                // tpAmb da emissão (1 produção / 2 homologação): a nota não
                // guarda a coluna, o ambiente é o da instância.
                ambiente: require('../config/nfe.config').ambiente,
                emitidoPor: nota.autorizado_por_nome,
                itens: nota.itens,
                autorizada: String(nota.status || '').toLowerCase() === 'autorizada' || !!nota.protocolo_autorizacao,
                comAnexo: true
            });

            const listaDestinatarios = [...destinatarios];
            // UMA MENSAGEM POR DESTINATÁRIO, de propósito.
            // Com todos no mesmo `para`, basta UM endereço na lista de supressão do Resend
            // (por bounce anterior) para a mensagem INTEIRA ser suprimida — ninguém recebe.
            // Foi exatamente o que aconteceu com a NF-e 4299 em 14/08/2026: o endereço da
            // aluforce estava bloqueado e derrubou a entrega para todos os outros junto.
            // Separando, um destinatário problemático não contamina os demais.
            const entregas = [];
            for (const destino of filtrarPausados(listaDestinatarios, `NF-e ${nota.numero}`)) {
                const r = await enviarEmail({
                    rota: 'sistema',
                    de: REMETENTE_NOTIFICACOES,
                    para: destino,
                    assunto: mensagem.assunto,
                    html: mensagem.html,
                    texto: mensagem.texto,
                    anexos
                });
                entregas.push({ destino, ok: !!r.success, messageId: r.messageId, erro: r.error });
                await registrarNoHistoricoDoPedido({
                    pedidoId: nota.pedido_id, destinatario: destino,
                    assunto: mensagem.assunto, corpo: mensagem.html,
                    ok: !!r.success, usuarioNome: opcoes.emitidoPorEmail || 'Sistema (faturamento)'
                });
                if (r.success) console.log(`[FATURAMENTO-EMAIL] ✅ NF-e ${nota.numero} → ${destino}`);
                else console.warn(`[FATURAMENTO-EMAIL] ⚠ NF-e ${nota.numero} NÃO foi para ${destino}: ${r.error || 'sem detalhe'}`);
            }

            const entregues = entregas.filter((e) => e.ok);
            return {
                // "enviado" = pelo menos um destinatário aceito. Falha parcial não pode ser
                // reportada como sucesso total nem como fracasso total.
                enviado: entregues.length > 0,
                destinatarios: entregues.map((e) => e.destino),
                falhas: entregas.filter((e) => !e.ok).map((e) => ({ destino: e.destino, erro: e.erro })),
                messageId: entregues[0] && entregues[0].messageId,
                erro: entregues.length ? null : (entregas[0] && entregas[0].erro)
            };
        } catch (err) {
            console.error(`[FATURAMENTO-EMAIL] ❌ Erro ao enviar NF-e por email:`, err.message);
            return { enviado: false, motivo: err.message };
        }
    }

    /**
     * Aviso de EVENTO fiscal (cancelamento, CC-e) para as caixas fixas da operação.
     *
     * A emissão já avisava (enviarDanfeEmail); o resto do ciclo de vida da nota, não —
     * uma NF-e podia ser cancelada na SEFAZ sem que a logística soubesse, e é justamente
     * o cancelamento que muda o que pode sair com a carga.
     *
     * Regras que este helper respeita de propósito:
     *  - NUNCA lança. É chamado depois de o evento já estar homologado e gravado; falhar
     *    o e-mail não pode desfazer nem mascarar uma operação fiscal concluída.
     *  - Só é chamado APÓS confirmação da SEFAZ, nunca na tentativa — avisar
     *    "cancelada" para uma nota que a SEFAZ recusou seria pior que não avisar.
     */
    async function enviarAvisoEventoFiscal({ nfeId, evento, detalhes = {}, emitidoPorEmail = null }) {
        try {
            if (!isEmailConfigured()) {
                console.log('[FATURAMENTO-EVENTO] E-mail não enviado: SMTP não configurado');
                return { enviado: false, motivo: 'SMTP não configurado' };
            }

            const [[nota]] = await pool.query(
                // `pedido_id` entra aqui para o aviso do evento também poder ser registrado no
                // histórico de e-mails do pedido — sem ele o registro vira um no-op silencioso.
                `SELECT numero, serie, chave_acesso, status, valor_total,
                        destinatario_nome, data_emissao, pedido_id
                   FROM nfes WHERE id = ?`, [nfeId]
            );
            if (!nota) return { enviado: false, motivo: 'NF-e não encontrada' };

            // Mesma regra do envio da nota: só a logística. O parâmetro `emitidoPorEmail`
            // continua sendo recebido para o log/auditoria, mas não vira destinatário.
            const destinatarios = new Set(DANFE_DESTINATARIOS_FIXOS.map((e) => e.toLowerCase()));

            const numeroFmt = String(nota.numero || '').padStart(9, '0');
            const linhas = Object.entries(detalhes)
                .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
                .map(([k, v]) => `<tr><td style="padding:4px 10px 4px 0;color:#64748b;">${k}</td>`
                               + `<td style="padding:4px 0;color:#0f172a;"><strong>${String(v)}</strong></td></tr>`)
                .join('');

            const assunto = `[${evento}] NF-e ${numeroFmt} — ${nota.destinatario_nome || 'sem destinatário'}`;
            const html = `
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;">
                  <h2 style="margin:0 0 4px;font-size:17px;">${evento} — NF-e ${numeroFmt}</h2>
                  <p style="margin:0 0 14px;color:#64748b;">Série ${nota.serie || 1} · destinatário ${nota.destinatario_nome || '—'}</p>
                  <table style="border-collapse:collapse;font-size:13px;">
                    <tr><td style="padding:4px 10px 4px 0;color:#64748b;">Chave de acesso</td>
                        <td style="padding:4px 0;font-family:monospace;">${nota.chave_acesso || '—'}</td></tr>
                    <tr><td style="padding:4px 10px 4px 0;color:#64748b;">Situação atual</td>
                        <td style="padding:4px 0;"><strong>${String(nota.status || '—').toUpperCase()}</strong></td></tr>
                    ${linhas}
                  </table>
                  <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;">
                    Aviso automático do Zyntra — evento fiscal registrado na SEFAZ.</p>
                </div>`;

            // Uma mensagem por destinatário — mesmo motivo do envio da nota: endereço
            // suprimido no Resend derruba a mensagem inteira se todos forem no mesmo `para`.
            const lista = [...destinatarios];
            const texto = `${evento} — NF-e ${numeroFmt}\nChave: ${nota.chave_acesso || '—'}\n`
                        + Object.entries(detalhes).map(([k, v]) => `${k}: ${v}`).join('\n');

            const entregues = [];
            for (const destino of filtrarPausados(lista, `${evento} da NF-e ${numeroFmt}`)) {
                const r = await enviarEmail({
                    rota: 'sistema', de: REMETENTE_NOTIFICACOES, para: destino, assunto, html, texto
                });
                // O aviso de evento (cancelamento, CC-e) também é comunicação sobre o pedido —
                // some do histórico se não for registrado, igual ao envio da nota.
                await registrarNoHistoricoDoPedido({
                    pedidoId: nota.pedido_id, destinatario: destino,
                    assunto, corpo: html, ok: !!r.success,
                    usuarioNome: emitidoPorEmail || 'Sistema (evento fiscal)'
                });
                if (r.success) {
                    entregues.push(destino);
                    console.log(`[FATURAMENTO-EVENTO] ✅ ${evento} da NF-e ${numeroFmt} → ${destino}`);
                } else {
                    console.warn(`[FATURAMENTO-EVENTO] ⚠ ${evento} da NF-e ${numeroFmt} NÃO foi para ${destino}: ${r.error || 'sem detalhe'}`);
                }
            }
            return { enviado: entregues.length > 0, destinatarios: entregues };
        } catch (err) {
            // Engolir é correto AQUI: o evento fiscal já aconteceu e está gravado.
            console.error('[FATURAMENTO-EVENTO] ❌ Falha ao avisar evento:', err.message);
            return { enviado: false, motivo: err.message };
        }
    }

    async function montarDanfePedidoFaturado(pedidoId) {
        const [[pedido]] = await pool.query(`
            SELECT p.*, p.valor as valor_total,
                   COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, p.cliente) AS cliente_nome,
                   COALESCE(c.razao_social, c.nome, p.cliente_nome, p.cliente) AS cliente_razao_social,
                   COALESCE(c.cnpj, c.cnpj_cpf) AS cliente_cnpj,
                   COALESCE(c.cpf) AS cliente_cpf,
                   c.inscricao_estadual AS cliente_ie,
                   COALESCE(c.email, p.email_cliente) AS cliente_email,
                   c.telefone AS cliente_telefone,
                   c.endereco AS cliente_endereco, c.bairro AS cliente_bairro,
                   c.cidade AS cliente_cidade, c.estado AS cliente_estado,
                   c.cep AS cliente_cep,
                   e.nome_fantasia AS empresa_nome, e.razao_social AS empresa_razao_social,
                   e.cnpj AS empresa_cnpj, e.inscricao_estadual AS empresa_ie,
                   e.endereco AS empresa_endereco, e.bairro AS empresa_bairro,
                   e.cidade AS empresa_cidade, e.estado AS empresa_uf, e.cep AS empresa_cep,
                   e.telefone AS empresa_telefone,
                   t.razao_social AS transportadora_razao_social,
                   t.nome_fantasia AS transportadora_nome_fantasia,
                   t.cnpj_cpf AS transportadora_cnpj_cpf,
                   t.inscricao_estadual AS transportadora_inscricao_estadual,
                   t.endereco AS transportadora_endereco,
                   t.cidade AS transportadora_cidade,
                   t.estado AS transportadora_estado
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN empresas e ON p.empresa_id = e.id
            LEFT JOIN transportadoras t ON p.transportadora_id = t.id
            WHERE p.id = ? AND p.status = 'faturado'
        `, [pedidoId]);

        if (!pedido) return null;

        try {
            const [[cfgEmpresa]] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
            if (cfgEmpresa) {
                pedido.empresa_razao_social = cfgEmpresa.razao_social;
                pedido.empresa_nome = cfgEmpresa.nome_fantasia;
                pedido.empresa_cnpj = cfgEmpresa.cnpj;
                pedido.empresa_ie = cfgEmpresa.inscricao_estadual;
                pedido.empresa_endereco = cfgEmpresa.endereco + (cfgEmpresa.numero ? ', ' + cfgEmpresa.numero : '');
                pedido.empresa_bairro = cfgEmpresa.bairro;
                pedido.empresa_cidade = cfgEmpresa.cidade;
                pedido.empresa_uf = cfgEmpresa.estado;
                pedido.empresa_cep = cfgEmpresa.cep;
                pedido.empresa_telefone = cfgEmpresa.telefone;
            }
        } catch (_) {}

        const [[cfgFiscal]] = await pool.query('SELECT * FROM config_fiscal_empresa LIMIT 1').catch(() => [[]]);

        let itens = [];
        try {
            const [rows] = await pool.query(`
                SELECT pi.codigo, pi.descricao, pi.quantidade, pi.unidade, pi.preco_unitario,
                       pi.desconto, pi.subtotal, pi.produto_id,
                       pi.icms_percent, pi.icms_value, pi.aliquota_icms, pi.aliquota_ipi,
                       pi.valor_ipi, pi.valor_icms_st, pi.cfop,
                       COALESCE(pr_id.ncm, pr_cod.ncm) AS ncm,
                       COALESCE(pr_id.cfop_saida_interna, pr_cod.cfop_saida_interna) AS produto_cfop,
                       COALESCE(pr_id.cst_icms, pr_cod.cst_icms) AS produto_cst_icms,
                       COALESCE(pr_id.csosn_icms, pr_cod.csosn_icms) AS produto_csosn_icms,
                       COALESCE(pr_id.aliquota_icms, pr_cod.aliquota_icms) AS produto_aliquota_icms,
                       COALESCE(pr_id.aliquota_ipi, pr_cod.aliquota_ipi) AS produto_aliquota_ipi
                FROM pedido_itens pi
                LEFT JOIN produtos pr_id ON pi.produto_id = pr_id.id
                LEFT JOIN produtos pr_cod ON pi.produto_id IS NULL AND pr_cod.codigo = pi.codigo
                WHERE pi.pedido_id = ? ORDER BY pi.id ASC
            `, [pedidoId]);
            itens = rows;
        } catch (_) {}

        if (itens.length === 0) {
            try {
                itens = JSON.parse(pedido.produtos_preview || '[]').map(item => ({
                    codigo: item.codigo || '-',
                    descricao: item.descricao || item.nome || '-',
                    quantidade: parseFloat(item.quantidade) || 1,
                    unidade: item.unidade || 'UN',
                    preco_unitario: parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0,
                    desconto: parseFloat(item.desconto) || 0,
                    subtotal: parseFloat(item.subtotal || item.total) || 0
                }));
            } catch (_) {
                itens = [];
            }
        }

        const { renderDanfe, buildDanfeCtx } = require(path.resolve(__dirname, '../../../routes/danfe-renderer'));
        const preview = !pedido.nfe_chave && !pedido.chave_acesso;
        return renderDanfe(buildDanfeCtx(pedido, itens, { preview, cfgFiscal }));
    }

    // ============================================================
    // LISTAR PEDIDOS APROVADOS (para selector no modal "Nova NF-e")
    // ============================================================

    router.get('/pedidos-aprovados', authenticateToken, async (req, res) => {
        try {
            const [pedidos] = await pool.query(`
                SELECT
                    p.id,
                    p.numero_pedido,
                    p.cliente_nome,
                    COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome) as cliente,
                    c.razao_social AS cliente_razao,
                    COALESCE(NULLIF(p.estado_destino, ''), c.estado) AS uf,
                    COALESCE(NULLIF(TRIM(p.vendedor_nome), ''), u.nome) AS vendedor,
                    p.valor,
                    p.created_at as data_pedido,
                    p.data_previsao,
                    p.status,
                    p.cenario_fiscal,
                    (SELECT COUNT(*) FROM pedido_itens pi WHERE pi.pedido_id = p.id) AS total_itens
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN usuarios u ON u.id = p.vendedor_id
                -- 25/06/2026: exibe pedidos do status "Aguardando Faturamento" em diante
                -- (aprovado/pedido-aprovado mantidos p/ retrocompat; 'faturar' = etapa de ação).
                WHERE LOWER(TRIM(p.status)) IN ('aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar')
                  AND p.id NOT IN (SELECT COALESCE(pedido_id, 0) FROM nfes WHERE pedido_id IS NOT NULL)
                ORDER BY p.created_at DESC
                LIMIT 500
            `);

            res.json({ success: true, data: pedidos });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao listar pedidos aprovados:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // ESTEIRA DE FATURAMENTO (grid da tela /Faturamento/index.html)
    // ============================================================
    // Diferente de /pedidos-aprovados — que só alimenta o <select> do modal
    // "Nova NF-e" e é limitado a 50 — este endpoint devolve TODOS os pedidos
    // parados aguardando faturamento, para serem faturados direto da tela do
    // módulo (mesmo fluxo do Kanban de Vendas: espelho da NF-e -> SEFAZ).
    const STATUS_ESTEIRA_FATURAMENTO = ['aguardando-faturamento', 'faturar'];
    const LIMITE_ESTEIRA_FATURAMENTO = 500;


    // ============================================================
    // FICHA DO PEDIDO (conferência antes de faturar)
    // ============================================================
    // Devolve o pedido como o vendedor preencheu — os mesmos campos do modal
    // "Novo Orçamento de Venda". Existe para a logística conferir SEM sair do
    // Faturamento: antes era preciso abrir o pedido no módulo Vendas, e trocar de
    // módulo no meio do faturamento é exatamente onde se erra a nota.
    router.get('/pedidos/:id/ficha', authenticateToken, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'Pedido inválido.' });
            }

            const [[p]] = await pool.query(`
                SELECT p.*,
                       COALESCE(c.razao_social, c.nome_fantasia, c.nome, p.cliente_nome, p.cliente) AS cliente_resolvido,
                       c.cnpj AS cliente_cnpj, c.cpf AS cliente_cpf, c.inscricao_estadual AS cliente_ie,
                       c.email AS cliente_email, c.telefone AS cliente_telefone,
                       c.endereco AS cliente_endereco, c.numero AS cliente_numero, c.bairro AS cliente_bairro,
                       c.cidade AS cliente_cidade, c.estado AS cliente_estado, c.cep AS cliente_cep,
                       COALESCE(NULLIF(TRIM(p.vendedor_nome), ''), NULLIF(TRIM(u.nome), '')) AS vendedor_resolvido
                  FROM pedidos p
                  LEFT JOIN clientes c ON c.id = p.cliente_id
                  LEFT JOIN usuarios u ON u.id = p.vendedor_id
                 WHERE p.id = ? LIMIT 1
            `, [id]);
            if (!p) return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });

            // Os impostos vêm junto com o item: a conferência antes de faturar é
            // justamente onde o ICMS-ST/FCP-ST errado precisa aparecer, e conferir isso
            // fora da ficha significa abrir o pedido no módulo Vendas no meio do
            // faturamento — que é onde se erra a nota.
            // `valor_icms`/`icms_value` e `aliquota_icms`/`icms_percent` são o mesmo dado
            // gravado por caminhos diferentes (pedido nativo x importação Omie): o item
            // preenche um par ou o outro, nunca garantidamente os dois.
            const [itens] = await pool.query(`
                SELECT id, codigo, descricao, quantidade, unidade, preco_unitario, desconto, subtotal,
                       embalagem, lances, cfop, observacoes,
                       COALESCE(valor_icms, icms_value) AS valor_icms,
                       COALESCE(aliquota_icms, icms_percent) AS aliquota_icms,
                       base_calculo_icms,
                       valor_icms_st, aliquota_icms_st, base_calculo_icms_st, mva_st,
                       valor_fcp_st, aliquota_fcp_st, base_calculo_fcp_st, valor_fcp_destino,
                       valor_ipi, aliquota_ipi,
                       pis_value, pis_percent, cofins_value, cofins_percent
                  FROM pedido_itens WHERE pedido_id = ? ORDER BY id
            `, [id]);

            // Quem pode editar a ficha é decidido AQUI, com a mesma regra que a rota de
            // gravação (PUT /api/vendas/pedidos/:id) aplica: nos status travados só passam
            // as contas ti@ e logistica@ — comparadas pela parte local do e-mail, porque
            // nas instâncias Labor as contas são ti@energy.com.br e ti@labor.com.br.
            // Calcular no servidor evita o pior caso: a tela oferecer edição e o servidor
            // recusar o save depois que o usuário já digitou tudo.
            const STATUS_TRAVADOS = ['analise-credito', 'análise-crédito', 'analise', 'análise',
                'faturado', 'recibo', 'entregue'];
            const contaLocal = String(req.user?.email || '').toLowerCase().trim().split('@')[0];
            const contaLiberada = contaLocal === 'ti' || contaLocal === 'logistica';
            const statusTravado = STATUS_TRAVADOS.includes(String(p.status || '').toLowerCase());
            const podeEditar = !statusTravado || contaLiberada;

            // `parcelas` e `parcelas_conta_receber` são texto/JSON conforme a origem do
            // pedido. Normaliza aqui para a tela não ter que adivinhar o formato.
            const lerParcelas = (valor) => {
                if (!valor) return null;
                if (typeof valor === 'object') return valor;
                const texto = String(valor).trim();
                if (!texto) return null;
                try { return JSON.parse(texto); } catch (_) { return texto; }
            };

            res.json({
                success: true,
                pode_editar: podeEditar,
                motivo_bloqueio: podeEditar ? null
                    : `Pedido com status "${p.status}" só pode ser editado pelas contas TI ou Logística.`,
                pedido: {
                    id: p.id,
                    // `version` alimenta o bloqueio otimista do PUT: sem ele, duas pessoas
                    // com a ficha aberta sobrescrevem uma à outra sem aviso.
                    version: p.version ?? null,
                    numero_pedido: p.numero_pedido,
                    status: p.status,
                    created_at: p.created_at,
                    data_previsao: p.data_previsao,
                    prazo_entrega: p.prazo_entrega,
                    valor: parseFloat(p.valor) || 0,
                    frete: parseFloat(p.frete) || 0,
                    desconto: parseFloat(p.desconto) || 0,
                    desconto_pct: parseFloat(p.desconto_pct) || 0,
                    tipo_frete: p.tipo_frete || '',
                    tipo_entrega: p.tipo_entrega || '',
                    condicao_pagamento: p.condicao_pagamento || p.condicoes_pagamento || '',
                    condicoes_pagamento: p.condicoes_pagamento || '',
                    parcelas: lerParcelas(p.parcelas),
                    parcelas_conta_receber: lerParcelas(p.parcelas_conta_receber),
                    observacao: p.observacao || '',
                    observacao_cliente: p.observacao_cliente || '',
                    observacao_producao: p.observacao_producao || '',
                    endereco_entrega: p.endereco_entrega || '',
                    municipio_entrega: p.municipio_entrega || '',
                    transportadora: p.transportadora_nome || p.transportadora || '',
                    prioridade: p.prioridade || '',
                    qtd_volumes: p.qtd_volumes ?? null,
                    peso_bruto: p.peso_bruto ?? null,
                    peso_liquido: p.peso_liquido ?? null,
                    vendedor: p.vendedor_resolvido || '',
                    total_icms: parseFloat(p.total_icms) || 0,
                    total_icms_st: parseFloat(p.total_icms_st) || 0,
                    total_fcp_st: parseFloat(p.total_fcp_st) || 0,
                    total_ipi: parseFloat(p.total_ipi) || 0
                },
                cliente: {
                    id: p.cliente_id,
                    nome: p.cliente_resolvido || '',
                    documento: p.cliente_cnpj || p.cliente_cpf || '',
                    inscricao_estadual: p.cliente_ie || '',
                    email: p.cliente_email || '',
                    telefone: p.cliente_telefone || '',
                    endereco: [p.cliente_endereco, p.cliente_numero, p.cliente_bairro].filter(Boolean).join(', '),
                    cidade: p.cliente_cidade || '',
                    estado: p.cliente_estado || '',
                    cep: p.cliente_cep || ''
                },
                itens: itens.map((it) => ({
                    id: it.id,
                    codigo: it.codigo || '',
                    descricao: it.descricao || '',
                    quantidade: parseFloat(it.quantidade) || 0,
                    unidade: it.unidade || 'UN',
                    preco_unitario: parseFloat(it.preco_unitario) || 0,
                    desconto: parseFloat(it.desconto) || 0,
                    subtotal: parseFloat(it.subtotal) || 0,
                    embalagem: it.embalagem || '',
                    lances: it.lances || '',
                    cfop: it.cfop || '',
                    observacoes: it.observacoes || '',
                    valor_icms: parseFloat(it.valor_icms) || 0,
                    aliquota_icms: parseFloat(it.aliquota_icms) || 0,
                    base_calculo_icms: parseFloat(it.base_calculo_icms) || 0,
                    valor_icms_st: parseFloat(it.valor_icms_st) || 0,
                    aliquota_icms_st: parseFloat(it.aliquota_icms_st) || 0,
                    base_calculo_icms_st: parseFloat(it.base_calculo_icms_st) || 0,
                    mva_st: parseFloat(it.mva_st) || 0,
                    valor_fcp_st: parseFloat(it.valor_fcp_st) || 0,
                    aliquota_fcp_st: parseFloat(it.aliquota_fcp_st) || 0,
                    base_calculo_fcp_st: parseFloat(it.base_calculo_fcp_st) || 0,
                    valor_fcp_destino: parseFloat(it.valor_fcp_destino) || 0,
                    valor_ipi: parseFloat(it.valor_ipi) || 0,
                    aliquota_ipi: parseFloat(it.aliquota_ipi) || 0,
                    valor_pis: parseFloat(it.pis_value) || 0,
                    aliquota_pis: parseFloat(it.pis_percent) || 0,
                    valor_cofins: parseFloat(it.cofins_value) || 0,
                    aliquota_cofins: parseFloat(it.cofins_percent) || 0
                }))
            });
        } catch (error) {
            console.error('[FATURAMENTO/FICHA] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao carregar a ficha do pedido.' });
        }
    });

    router.get('/pedidos-para-faturar', authenticateToken, async (req, res) => {
        try {
            const statusParam = String(req.query.status || '').trim().toLowerCase();
            const statuses = STATUS_ESTEIRA_FATURAMENTO.includes(statusParam)
                ? [statusParam]
                : STATUS_ESTEIRA_FATURAMENTO;

            // Pedido já com NF-e vinculada saiu da esteira — não deve ser refaturado aqui.
            //
            // O vendedor precisa do JOIN: `vendedor_nome` está vazia em 7 de 7
            // pedidos da esteira (e em 14 de 15 no total), enquanto `vendedor_id`
            // está preenchido em 100% deles — era o que deixava a coluna VENDEDOR
            // inteira em "-". O id casa com `usuarios`, não com `vendedores`: essa
            // outra tabela casa 12/15 na aluforce e 0/2 e 0/4 nas Labor, ou seja,
            // coincidência de id.
            //
            // A ORDEM do COALESCE segue o repositório de pedidos e o endpoint de
            // detalhe: nome gravado no pedido primeiro, JOIN depois. `vendedor_id`
            // pode apontar para um usuário duplicado (o auto-provisionamento por CPF
            // cria conta repetida), e aí o JOIN exibe outra pessoa — o nome gravado
            // é o autoritativo quando existe.
            const filtro = `
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN usuarios u ON u.id = p.vendedor_id
                WHERE LOWER(TRIM(p.status)) IN (${statuses.map(() => '?').join(',')})
                  AND p.id NOT IN (SELECT COALESCE(pedido_id, 0) FROM nfes WHERE pedido_id IS NOT NULL)
            `;

            const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${filtro}`, statuses);

            const [rows] = await pool.query(`
                SELECT p.*,
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, p.cliente) AS cliente_resolvido,
                       COALESCE(NULLIF(TRIM(p.vendedor_nome), ''), NULLIF(TRIM(u.nome), ''), NULLIF(TRIM(u.apelido), '')) AS vendedor_resolvido,
                       (SELECT COUNT(*) FROM pedido_itens pi WHERE pi.pedido_id = p.id) AS total_itens
                ${filtro}
                ORDER BY p.created_at DESC
                LIMIT ${LIMITE_ESTEIRA_FATURAMENTO}
            `, statuses);

            // Payload enxuto: a tabela de pedidos não precisa das ~100 colunas de `pedidos`.
            const data = rows.map(p => ({
                id: p.id,
                numero_pedido: p.numero_pedido || null,
                cliente: p.cliente_resolvido || '',
                cliente_id: p.cliente_id || null,
                valor: parseFloat(p.valor) || 0,
                status: (p.status || '').trim(),
                vendedor: p.vendedor_resolvido || '',
                vendedor_id: p.vendedor_id || null,
                condicao_pagamento: p.condicao_pagamento || p.condicoes_pagamento || '',
                // A consulta já traz `p.*`; o que faltava era DEVOLVER. Sem estes campos a
                // logística tinha de abrir o pedido em Vendas só para ler a observação ou
                // conferir o parcelamento — sair do módulo no meio do faturamento é
                // justamente onde se erra a nota.
                condicoes_pagamento: p.condicoes_pagamento || '',
                // Normaliza igual à rota de detalhe (`lerParcelas`): a coluna guarda ora um
                // JSON, ora um texto simples ("30", "À vista"). Devolver o JSON cru fazia a
                // ficha do pedido imprimir o objeto inteiro na tela em vez da tabela.
                parcelas: normalizarParcelas(p.parcelas),
                parcelas_conta_receber: normalizarParcelas(p.parcelas_conta_receber),
                observacao: p.observacao || '',
                observacao_cliente: p.observacao_cliente || '',
                observacao_producao: p.observacao_producao || '',
                tipo_frete: p.tipo_frete || '',
                tipo_entrega: p.tipo_entrega || '',
                frete: parseFloat(p.frete) || 0,
                desconto: parseFloat(p.desconto) || 0,
                desconto_pct: parseFloat(p.desconto_pct) || 0,
                prazo_entrega: p.prazo_entrega ?? null,
                data_previsao: p.data_previsao || null,
                // Previsão de Faturamento definida no pedido: ordena a fila da esteira.
                previsao_faturamento: p.previsao_faturamento || null,
                endereco_entrega: p.endereco_entrega || '',
                municipio_entrega: p.municipio_entrega || '',
                transportadora: p.transportadora_nome || p.transportadora || '',
                prioridade: p.prioridade || '',
                qtd_volumes: p.qtd_volumes ?? null,
                peso_bruto: p.peso_bruto ?? null,
                peso_liquido: p.peso_liquido ?? null,
                total_itens: Number(p.total_itens) || 0,
                created_at: p.created_at || null
            }));

            res.json({
                success: true,
                data,
                total,
                // Sinaliza truncamento p/ a UI — nunca mostrar "todos" quando não são todos.
                truncado: total > data.length
            });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao listar pedidos para faturar:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // DADOS DA ETIQUETA DE EXPEDIÇÃO
    // ============================================================
    // Emitente da etiqueta. O logo é resolvido AQUI (e não no navegador) porque
    // empresa_config.logo_path aponta para arquivos que nem sempre existem: a instância
    // labor-energy referencia logo-danfe.jpg (só existe .png) e a labor-eletric está com o
    // campo nulo. Sem a checagem, a etiqueta sairia com imagem quebrada.
    const fsEtiqueta = require('fs');
    const RAIZ_PUBLICA = path.resolve(__dirname, '../../../public');

    function logoExiste(url) {
        if (!url || typeof url !== 'string' || !url.startsWith('/')) return false;
        const limpo = url.split('?')[0].replace(/^\/+/, '');
        // Impede que um logo_path malicioso/errado escape de public/.
        const alvo = path.resolve(RAIZ_PUBLICA, limpo);
        if (!alvo.startsWith(RAIZ_PUBLICA)) return false;
        try { return fsEtiqueta.statSync(alvo).isFile(); } catch (_) { return false; }
    }

    async function carregarEmpresaEtiqueta() {
        try {
            const [[e]] = await pool.query('SELECT * FROM empresa_config WHERE id = 1');
            return e || {};
        } catch (_) {
            try {
                const [[e2]] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
                return e2 || {};
            } catch (__) { return {}; }
        }
    }

    function resolverEmpresaEtiqueta(e) {
        e = e || {};
        const marca = String(process.env.BRAND || '').toLowerCase();
        const candidatos = [
            // Aluforce (BRAND vazio): a arte oficial da etiqueta e a monocromatica azul.
            // Vem ANTES de `logo_path` porque o cadastro aponta para `logo-danfe.png`, um
            // arquivo generico — depender do conteudo dele e depender de acidente.
            // Nome sem espacos de proposito: o src da <img> e montado por concatenacao,
            // sem encode de URL.
            (!marca || marca === 'aluforce') ? '/images/aluforce-logo-etiqueta.png' : null,
            e.logo_path,
            marca === 'labor-energy' ? '/images/labor-energy-logo.png' : null,
            marca === 'labor-eletric' ? '/images/labor-eletric-logo.png' : null,
            '/images/logo-danfe.png'
        ].filter(Boolean);
        return {
            nome: e.nome_fantasia || e.razao_social || '',
            razao_social: e.razao_social || '',
            cnpj: e.cnpj || '',
            cidade_uf: [e.cidade, e.estado].filter(Boolean).join(', '),
            logo_url: candidatos.find(logoExiste) || null
        };
    }

    // Exposto para a Logística montar a mesma etiqueta sem duplicar a resolução de emitente.
    router.get('/etiqueta-emitente', authenticateToken, async (req, res) => {
        try {
            res.json({ success: true, data: resolverEmpresaEtiqueta(await carregarEmpresaEtiqueta()) });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao resolver emitente da etiqueta:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // Alimenta /_shared/etiqueta.js (mesma etiqueta do módulo Logística). Volumes, pesos,
    // transportadora e prioridade só existem em `pedidos` — a tabela `nfes` não tem essas
    // colunas —, então a NF-e resolve o pedido de origem por n.pedido_id.
    router.get('/etiqueta-dados', authenticateToken, async (req, res) => {
        try {
            const origem = String(req.query.origem || 'pedido').toLowerCase();
            const id = parseInt(req.query.id, 10);
            if (!id || id < 1) {
                return res.status(400).json({ success: false, message: 'ID inválido.' });
            }

            await EtiquetaExpedicaoService.ensureInfrastructure(pool);

            let linha = null;
            if (origem === 'nfe') {
                const [[r]] = await pool.query(`
                    SELECT n.numero AS nfe_numero, n.pedido_id,
                           -- Razao social na frente: a etiqueta identifica o destinatario para
                           -- transportadora e portaria, e nome fantasia ("NM-ENGENHARIA") nao
                           -- confere com a nota nem com o CNPJ.
                           COALESCE(c.razao_social, p.cliente_nome, p.cliente, n.destinatario_nome, c.nome) AS cliente,
                           COALESCE(n.destinatario_cidade, c.cidade) AS cidade,
                           COALESCE(n.destinatario_uf, c.estado) AS uf,
                           p.transportadora_nome, p.transportadora, p.prioridade,
                           p.qtd_volumes, p.peso_bruto, p.peso_liquido, p.data_previsao
                      FROM nfes n
                      LEFT JOIN pedidos p ON p.id = n.pedido_id
                      LEFT JOIN clientes c ON c.id = n.cliente_id
                     WHERE n.id = ? LIMIT 1
                `, [id]);
                linha = r;
            } else {
                // O número sai do pedido, mas cai para a NF-e vinculada (p.nfe_id) quando a
                // coluna está vazia: pedidos faturados antes de /gerar-nfe passar a gravar o
                // número no pedido continuariam com o campo "Nota Fiscal" em branco. Nota
                // cancelada não conta — a etiqueta não pode carimbar número inválido.
                const [[r]] = await pool.query(`
                    SELECT COALESCE(NULLIF(p.nfe_faturamento_numero, ''), NULLIF(p.numero_nf, ''),
                                    NULLIF(p.nf, ''), NULLIF(p.nfe_remessa_numero, ''), n.numero) AS nfe_numero,
                           p.id AS pedido_id,
                           -- Idem: razao social manda; fantasia so entra se nao houver razao.
                           COALESCE(c.razao_social, c.nome, p.cliente_nome, p.cliente, c.nome_fantasia) AS cliente,
                           COALESCE(c.cidade, '') AS cidade,
                           COALESCE(c.estado, p.estado_destino, '') AS uf,
                           p.transportadora_nome, p.transportadora, p.prioridade,
                           p.qtd_volumes, p.peso_bruto, p.peso_liquido, p.data_previsao
                      FROM pedidos p
                      LEFT JOIN clientes c ON c.id = p.cliente_id
                      LEFT JOIN nfes n ON n.id = p.nfe_id
                                      AND LOWER(COALESCE(n.status, '')) NOT LIKE 'cancel%'
                     WHERE p.id = ? LIMIT 1
                `, [id]);
                linha = r;
            }

            if (!linha) {
                return res.status(404).json({ success: false, message: 'Registro não encontrado.' });
            }

            const pedidoId = linha.pedido_id || (origem === 'pedido' ? id : null);

            // Itens: descrição/quantidade/embalagem vêm do pedido; peso unitário do cadastro do
            // produto. O lote vive em `rastreabilidade` (nfe_id + produto_id) — a tabela existe e
            // está modelada, mas hoje nada a popula, então o campo sai vazio para preenchimento.
            let itens = [];
            if (pedidoId) {
                const [linhas] = await pool.query(`
                    SELECT i.id AS pedido_item_id, i.codigo, i.descricao, i.quantidade, i.unidade, i.produto_id,
                           i.lances,
                           COALESCE(NULLIF(i.embalagem, ''), NULLIF(pr.embalagem, '')) AS embalagem,
                           pr.peso_bruto AS peso_bruto_unit, pr.peso_liquido AS peso_liquido_unit,
                           r.lote AS lote_rastreabilidade,
                           ei.id AS etiqueta_dados_id,
                           ei.lote AS etiqueta_lote,
                           ei.peso_bruto AS etiqueta_peso_bruto,
                           ei.peso_liquido AS etiqueta_peso_liquido
                      FROM pedido_itens i
                      LEFT JOIN produtos pr ON pr.id = i.produto_id
                      LEFT JOIN rastreabilidade r
                             ON r.produto_id = i.produto_id
                             AND (? IS NULL OR r.nfe_id = ?)
                      LEFT JOIN etiqueta_expedicao_itens ei
                             ON ei.pedido_id = i.pedido_id
                            AND ei.pedido_item_id = i.id
                     WHERE i.pedido_id = ?
                     ORDER BY i.id
                `, [origem === 'nfe' ? id : null, origem === 'nfe' ? id : null, pedidoId]);

                const total = (unit, qtd) => {
                    const u = parseFloat(unit);
                    const q = parseFloat(qtd);
                    if (!u || u <= 0 || !q || q <= 0) return null;
                    return u * q;
                };

                itens = linhas.map(l => {
                    const dadosSalvos = l.etiqueta_dados_id != null;
                    return {
                    pedido_item_id: l.pedido_item_id,
                    produto_id: l.produto_id || null,
                    codigo: l.codigo || '',
                    descricao: l.descricao || '',
                    quantidade: parseFloat(l.quantidade) || 0,
                    unidade: l.unidade || '',
                    lances: l.lances || '',
                    embalagem: l.embalagem || '',
                    lote: dadosSalvos ? (l.etiqueta_lote || '') : (l.lote_rastreabilidade || ''),
                    peso_bruto: dadosSalvos ? (parseFloat(l.etiqueta_peso_bruto) || null) : total(l.peso_bruto_unit, l.quantidade),
                    peso_liquido: dadosSalvos ? (parseFloat(l.etiqueta_peso_liquido) || null) : total(l.peso_liquido_unit, l.quantidade),
                    dados_etiqueta_salvos: dadosSalvos
                };
                });
            }

            // Peso da aba "Frete e Outras Despesas" do pedido (pedidos.peso_bruto/peso_liquido).
            // É a fonte que o usuário preenche na tela, e hoje a ÚNICA com dado: o cadastro de
            // produtos está com peso zerado em toda a base. Vale para todos os itens — quando o
            // pedido tem mais de um item, esse peso é o TOTAL do pedido e sai igual em cada
            // etiqueta, porque não existe peso por item em lugar nenhum do schema.
            const pesoPedidoBruto = parseFloat(linha.peso_bruto);
            const pesoPedidoLiquido = parseFloat(linha.peso_liquido);
            itens.forEach(it => {
                // Uma linha salva é autoritativa inclusive quando o usuário apagou o campo.
                // Só aplicar o fallback do pedido quando nunca houve conferência salva.
                if (!it.dados_etiqueta_salvos && !it.peso_bruto && pesoPedidoBruto > 0) it.peso_bruto = pesoPedidoBruto;
                if (!it.dados_etiqueta_salvos && !it.peso_liquido && pesoPedidoLiquido > 0) it.peso_liquido = pesoPedidoLiquido;
            });

            res.json({
                success: true,
                data: {
                    empresa: resolverEmpresaEtiqueta(await carregarEmpresaEtiqueta()),
                    pedido_id: pedidoId || id,
                    nfe_numero: linha.nfe_numero || null,
                    cliente: linha.cliente || '',
                    cidade_uf: [linha.cidade, linha.uf].filter(Boolean).join('/'),
                    transportadora: linha.transportadora_nome || linha.transportadora || '',
                    previsao: linha.data_previsao || null,
                    prioridade: linha.prioridade || 'normal',
                    volumes: Math.max(1, parseInt(linha.qtd_volumes, 10) || 1),
                    peso_bruto: linha.peso_bruto || null,
                    peso_liquido: linha.peso_liquido || null,
                    itens
                }
            });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao montar dados da etiqueta:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // Persiste lote e pesos digitados no painel compartilhado antes da impressão.
    router.put('/etiqueta-dados/:pedidoId', authenticateToken, async (req, res) => {
        try {
            const resultado = await EtiquetaExpedicaoService.salvar(
                pool,
                req.params.pedidoId,
                req.body && req.body.itens,
                req.user && req.user.id
            );
            res.json({ success: true, data: resultado, message: 'Dados da etiqueta salvos.' });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao salvar dados da etiqueta:', error);
            res.status(error.statusCode || 500).json({
                success: false,
                message: error.statusCode ? error.message : mensagemSegura(error)
            });
        }
    });

    // ============================================================
    // GERAR NF-e A PARTIR DE PEDIDO (COMPLETO)
    // ============================================================

    router.post('/gerar-nfe', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const {
                pedido_id,
                gerar_danfe = true,
                enviar_email = false,
                numeroParcelas = 1,
                diaVencimento = 30,
                intervalo = 30,
                autoIntegrarFinanceiro = true,
                autoReservarEstoque = true,
                autoValidarEstoque = true
            } = req.body;
            const usuario_id = req.user.id;

            // AUDITORIA ENTERPRISE: RBAC - Geração de NFe requer permissão fiscal.
            // Perfis fiscais legados continuam liberados; os demais respeitam a permissão
            // granular `faturamento.criar`. A lista fixa de roles barrava logistica@
            // (role 'user') mesmo com a concessão individual correta em permissoes_modulos.
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();

            if (!await FiscalAccessService.podeGerarNfe(pool, req.user)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuario_id} (${userRole || 'sem perfil'}) tentou gerar NF-e sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Permissão insuficiente',
                    message: 'Seu perfil não possui permissão para gerar NF-e. É necessário ter permissão para criar no Faturamento.',
                    errorCode: 'RBAC_DENIED'
                });
            }

            // BUG-FAT-005: inteiro ESTRITO — parseInt aceitava lixo com prefixo numérico
            // ("10 OR 1=1" → 10), contornando a validação. A query é parametrizada, mas
            // entrada malformada não deve ser aceita nem coagida.
            if (typeof pedido_id !== 'number' && typeof pedido_id !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'ID do pedido é obrigatório e deve ser um inteiro positivo'
                });
            }
            if (!pedidoIdValido(pedido_id)) {
                return res.status(400).json({
                    success: false,
                    message: 'ID do pedido é obrigatório e deve ser um inteiro positivo'
                });
            }

            console.log(`[FATURAMENTO] Usuário ${usuario_id} iniciando geração de NF-e para pedido ${pedido_id}`);

            // Regerar o XML de uma nota já emitida exige aceitar o pedido nos status de
            // DEPOIS do faturamento: quem vai ser regerado já foi faturado, então nunca
            // está em 'aprovado'/'faturar'. Sem isto o modo regeração morria na consulta
            // com "Pedido não encontrado ou não está em status faturável" — e como
            // 'parcial' é o estado da meia-nota, a regeração precisa dele explicitamente.
            const querRegerar = req.body?.regerar === true || req.body?.regerar === 'true';
            const statusFaturaveis = querRegerar
                ? ['aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar', 'faturado', 'parcial']
                : ['aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar'];

            // Opcional: validar estoque antes de seguir
            // Regenerar reaproveita a NF-e já numerada de um pedido faturado: não cria
            // venda nem baixa estoque novamente. Cobrar saldo aqui torna impossível
            // corrigir o XML justamente depois que a baixa original já aconteceu.
            if (autoValidarEstoque && !querRegerar) {
                const estoqueOk = await vendasEstoqueService.validarEstoqueParaFaturamento(pedido_id);
                if (!estoqueOk.valido) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Estoque insuficiente para faturar', ...estoqueOk });
                }
            }

            // 1. Buscar dados do pedido
            const [pedidos] = await connection.query(`
                SELECT
                    p.*,
                    c.nome as cliente_nome,
                    c.cnpj as cliente_cnpj,
                    c.cpf as cliente_cpf,
                    c.endereco as cliente_endereco,
                    c.numero as cliente_numero,
                    c.bairro as cliente_bairro,
                    c.cidade as cliente_cidade,
                    c.estado as cliente_estado,
                    c.cep as cliente_cep,
                    c.codigo_ibge as cliente_codigo_ibge,
                    c.codigo_municipio as cliente_codigo_municipio,
                    c.inscricao_estadual as cliente_ie,
                    c.fiscal_contribuinte_icms as cliente_contribuinte_icms,
                    c.email as cliente_email,
                    c.email_nfe as cliente_email_nfe
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.id = ? AND LOWER(TRIM(p.status)) IN (${statusFaturaveis.map(() => '?').join(', ')})
            `, [pedido_id, ...statusFaturaveis]);

            if (pedidos.length === 0) {
                // BUG-FAT-001: o contrato divergia de /pedidos-aprovados, que oferece pedidos em
                // status 'faturar'/'aguardando-faturamento' — mas gerar-nfe só aceitava 'aprovado',
                // rejeitando pedidos que a própria lista apresentava como faturáveis. Alinhado.
                // LEFT JOIN (antes INNER): pedido com cliente_id nulo não some mais silenciosamente.
                throw new Error('Pedido não encontrado ou não está em status faturável.');
            }

            const pedido = pedidos[0];

            // ── TRAVA DE CRÉDITO DO CLIENTE ─────────────────────────────────────────
            // Mesma regra das outras portas (criar/aprovar/mandar faturar), aplicada aqui
            // porque esta rota emite a NF-e direto, sem passar pelo Kanban de Vendas: um
            // pedido aprovado ontem pode ter o cliente vencendo boleto hoje.
            // Admin segue com `forcar_credito: true` e a liberação fica no histórico.
            // Regerar NÃO passa pela trava: ela existe para impedir VENDA NOVA a quem está
            // devendo, e regerar não vende nada — o documento já foi emitido, nenhum título
            // novo é criado e o valor a receber é exatamente o mesmo.
            //
            // Pior: aplicá-la aqui trava por conta do título que a PRÓPRIA nota gerou.
            // Foi o que aconteceu com a NF-e 906: o título 8994 (R$ 2.985,00, vencido em
            // 04/09) nasceu do faturamento parcial dessa nota, e passou a impedir que a
            // nota fosse corrigida — um impasse circular em que a única saída seria dar
            // baixa num título que o cliente não pode pagar, porque a nota nunca foi
            // autorizada.
            if (pedido.cliente_id && !querRegerar) {
                const creditoCliente = require('../../../services/credito-cliente.service');
                const avaliacaoCredito = await creditoCliente.avaliarCreditoCliente(connection, {
                    clienteId: pedido.cliente_id, valorPedido: parseFloat(pedido.valor || 0), pedidoId: pedido_id, porta: 'faturar'
                });
                if (avaliacaoCredito.bloqueado) {
                    const forcar = req.body?.forcar_credito === true || req.body?.forcar_credito === 'true';
                    if (!(faturamentoShared.isAdmin(req.user) && forcar)) {
                        // O `finally` desta rota já devolve a conexão ao pool — soltar aqui
                        // também derrubaria a próxima requisição que a pegasse.
                        await connection.rollback();
                        return res.status(409).json(creditoCliente.respostaBloqueio(avaliacaoCredito, 'gerar a NF-e deste pedido'));
                    }
                    await creditoCliente.registrarLiberacaoForcada(connection, {
                        pedidoId: pedido_id, usuario: req.user, avaliacao: avaliacaoCredito, acao: 'geração da NF-e'
                    });
                    console.warn(`[CREDITO-GATE] Admin ${req.user?.nome || req.user?.email} gerou NF-e do pedido #${pedido_id} com pendência de crédito.`);
                }
            }

            // Transportadora do pedido, para o bloco <transporta> do XML. Best-effort: o
            // pedido pode ter só o nome digitado, sem vínculo — nesse caso o mapper emite
            // apenas o xNome, que é o que a NF-e exige de mínimo.
            // A coluna `nome` NÃO existe em `transportadoras` (a tabela tem razao_social e
            // nome_fantasia). Com ela no SELECT a query morria em ER_BAD_FIELD_ERROR e o
            // `.catch` devolvia lista vazia — o vínculo era descartado em silêncio e a nota
            // saía com apenas o <xNome> digitado no pedido, sem CNPJ, IE, endereço nem UF da
            // transportadora. O erro agora aparece no log em vez de virar "sem transportadora".
            let transportadoraNFe = null;
            if (pedido.transportadora_id) {
                try {
                    const [tRows] = await connection.query(
                        `SELECT razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual,
                                endereco, numero, complemento, cidade, estado, fiscal_situacao
                           FROM transportadoras WHERE id = ? LIMIT 1`,
                        [pedido.transportadora_id]
                    );
                    transportadoraNFe = (tRows && tRows[0]) || null;
                } catch (erroTransportadora) {
                    console.error('[FATURAMENTO] Falha ao resolver transportadora '
                        + `${pedido.transportadora_id} do pedido ${pedido_id}: ${erroTransportadora.message}`);
                    throw new Error('Cadastro da transportadora indisponível: ' + erroTransportadora.message);
                }
                if (!transportadoraNFe) throw new Error('Transportadora vinculada não encontrada. Corrija o pedido antes de gerar a NF-e.');
            }

            // 2. Verificar se já existe NF-e para este pedido (lock pessimista para evitar duplicata)
            const [nfeExistente] = await connection.query(`
                SELECT id, numero AS numero_nfe, status FROM nfes WHERE pedido_id = ? FOR UPDATE
            `, [pedido_id]);

            // MODO REGERAÇÃO — o XML de uma nota rejeitada é um retrato CONGELADO dos
            // dados de quando ela foi emitida. Se a rejeição veio de cadastro errado
            // (destinatário sem IE marcado como contribuinte, CFOP incoerente, DIFAL
            // faltando), corrigir o cadastro depois não muda nada: `enviar-sefaz` só
            // retransmite o mesmo XML, `/correcao` não edita CFOP/ICMS (exigiria
            // recalcular a base) e esta rota recusava criar outra nota. A nota ficava
            // irrecuperável sem mexer no banco à mão.
            //
            // Com `regerar: true` o MESMO caminho de emissão roda de novo sobre os dados
            // ATUAIS do pedido e sobrescreve o XML da nota existente — sem consumir novo
            // número, sem duplicar título no financeiro e sem re-executar as integrações.
            //
            // Só vale para nota que a SEFAZ nunca autorizou: `pendente|rejeitada|erro` e
            // sem protocolo. Nota autorizada ou cancelada é documento fiscal definitivo.
            // `querRegerar` já foi lido no início do handler (ele decide os status de
            // pedido aceitos na consulta acima).
            let nfeRegerando = null;

            if (nfeExistente.length > 0) {
                const existente = nfeExistente[0];
                const statusExistente = String(existente.status || '').toLowerCase();
                const podeRegerar = ['pendente', 'rejeitada', 'erro'].includes(statusExistente);

                if (!querRegerar || !podeRegerar) {
                    throw new Error(`NF-e já existe para este pedido (Número: ${existente.numero_nfe}, Status: ${existente.status})`);
                }

                // Protocolo é a prova de que a SEFAZ autorizou. Se existir, o documento é
                // definitivo e não pode ser reescrito por baixo — só cancelamento.
                const [[protocoloExistente]] = await connection.query(
                    `SELECT protocolo_autorizacao, xml_protocolo FROM nfes WHERE id = ? LIMIT 1`,
                    [existente.id]
                );
                if (protocoloExistente
                    && (protocoloExistente.protocolo_autorizacao
                        || String(protocoloExistente.xml_protocolo || '').trim())) {
                    throw new Error(
                        `A NF-e ${existente.numero_nfe} tem protocolo de autorização da SEFAZ e não pode ser regerada. ` +
                        `Documento autorizado só sai por cancelamento.`
                    );
                }

                nfeRegerando = existente;
                console.log(`[FATURAMENTO] ♻️ Regerando XML da NF-e ${existente.numero_nfe} (id ${existente.id}, status ${existente.status}) com os dados atuais do pedido ${pedido_id}`);
            }

            // 3. Buscar itens do pedido
            // Resolve o produto por ID **e**, como fallback, pelo CÓDIGO: pedidos legados têm
            // linhas com `produto_id` NULL mas `codigo` válido (ex.: 'POT10'). Com o JOIN só
            // por id, esses itens vinham SEM ncm/origem/CST/CFOP/alíquotas e a emissão morria
            // em "produto(s) sem NCM válido" — mesmo com o produto cadastrado e correto.
            // O JOIN por código replica o que a consulta do espelho/DANFE já fazia
            // (COALESCE(pr_id..., pr_cod...)). Preferência sempre do id; o código só entra
            // quando o id não resolve. Comprovado em homologação 23/07/2026 (aluforce, pedido 18).
            const [itens] = await connection.query(`
                SELECT
                    pi.*,
                    COALESCE(NULLIF(pi.codigo,''), pr_id.codigo, pr_cod.codigo) AS codigo,
                    COALESCE(NULLIF(pi.descricao,''), pr_id.descricao, pr_cod.descricao) AS descricao,
                    COALESCE(pr_id.ncm, pr_cod.ncm) AS ncm,
                    COALESCE(pr_id.cest, pr_cod.cest) AS produto_cest,
                    COALESCE(pr_id.unidade_medida, pr_cod.unidade_medida, NULLIF(pi.unidade,'')) AS unidade_medida,
                    COALESCE(pr_id.origem, pr_cod.origem) AS produto_origem,
                    COALESCE(pr_id.cst_icms, pr_cod.cst_icms) AS produto_cst_icms,
                    COALESCE(pr_id.csosn_icms, pr_cod.csosn_icms) AS produto_csosn_icms,
                    COALESCE(pr_id.aliquota_icms, pr_cod.aliquota_icms) AS produto_aliquota_icms,
                    COALESCE(pr_id.reducao_bc_icms, pr_cod.reducao_bc_icms) AS produto_reducao_bc_icms,
                    COALESCE(pr_id.aliquota_credito_sn, pr_cod.aliquota_credito_sn) AS produto_aliquota_credito_sn,
                    COALESCE(pr_id.calcular_icms_st, pr_cod.calcular_icms_st) AS produto_calcular_icms_st,
                    COALESCE(pr_id.mva_st, pr_cod.mva_st) AS produto_mva_st,
                    COALESCE(pr_id.aliquota_ipi, pr_cod.aliquota_ipi) AS produto_aliquota_ipi,
                    COALESCE(pr_id.cst_ipi, pr_cod.cst_ipi) AS produto_cst_ipi,
                    COALESCE(pr_id.calcular_ipi, pr_cod.calcular_ipi) AS produto_calcular_ipi,
                    COALESCE(pr_id.cst_reforma, pr_cod.cst_reforma) AS produto_cst_reforma,
                    COALESCE(pr_id.classe_tributaria_cbs, pr_cod.classe_tributaria_cbs) AS produto_classe_cbs,
                    COALESCE(pr_id.classe_tributaria_ibs, pr_cod.classe_tributaria_ibs) AS produto_classe_ibs,
                    COALESCE(pr_id.cbenef, pr_cod.cbenef) AS produto_cbenef,
                    COALESCE(pr_id.fcp_aliquota, pr_cod.fcp_aliquota) AS produto_fcp_aliquota,
                    COALESCE(pr_id.cst_pis, pr_cod.cst_pis) AS produto_cst_pis,
                    COALESCE(pr_id.aliquota_pis, pr_cod.aliquota_pis) AS produto_aliquota_pis,
                    COALESCE(pr_id.cst_cofins, pr_cod.cst_cofins) AS produto_cst_cofins,
                    COALESCE(pr_id.aliquota_cofins, pr_cod.aliquota_cofins) AS produto_aliquota_cofins,
                    COALESCE(pr_id.cfop_saida_interna, pr_cod.cfop_saida_interna) AS produto_cfop_interna,
                    COALESCE(pr_id.cfop_saida_interestadual, pr_cod.cfop_saida_interestadual) AS produto_cfop_interestadual,
                    -- Lote/validade do item. O CalculoTributosService repassa o item inteiro
                    -- (faz spread do objeto), entao basta trazer a coluna aqui para o grupo
                    -- rastro sair no XML. Sem este SELECT a coluna existiria no banco, a tela
                    -- gravaria nela, e a nota sairia sem rastro nenhum.
                    -- (sem crase no comentario: a query e template literal e a crase a encerra)
                    pi.rastro_json
                FROM pedido_itens pi
                LEFT JOIN produtos pr_id  ON pr_id.id = pi.produto_id
                LEFT JOIN produtos pr_cod ON pr_id.id IS NULL
                                         AND NULLIF(pi.codigo,'') IS NOT NULL
                                         AND pr_cod.codigo = pi.codigo
                WHERE pi.pedido_id = ?
            `, [pedido_id]);

            if (itens.length === 0) {
                throw new Error('Pedido sem itens');
            }

            // VALIDAÇÃO: Quantidade e preço devem ser positivos
            for (const item of itens) {
                if (!item.quantidade || item.quantidade <= 0) {
                    throw new Error(`Item "${item.descricao}" possui quantidade inválida (${item.quantidade}). Deve ser > 0.`);
                }
                if (!item.preco_unitario || item.preco_unitario <= 0) {
                    throw new Error(`Item "${item.descricao}" possui preço unitário inválido (${item.preco_unitario}). Deve ser > 0.`);
                }
            }

            // VALIDAÇÃO FISCAL: NCM obrigatório (8 dígitos).
            // Emitir NF-e com NCM ausente/inválido gera classificação fiscal incorreta
            // (antes o sistema substituía silenciosamente por um NCM-fallback genérico,
            // o que é irregular perante o Fisco). Bloqueia a emissão e lista os produtos.
            const _itensSemNcm = itens.filter(it => String(it.ncm || '').replace(/\D/g, '').length !== 8);
            if (_itensSemNcm.length > 0) {
                const _lista = _itensSemNcm
                    .map(it => `• ${it.descricao || ('produto #' + (it.produto_id || it.id || '?'))}`)
                    .join('\n');
                const _err = new Error(
                    `Emissão bloqueada: ${_itensSemNcm.length} produto(s) sem NCM válido (8 dígitos). ` +
                    `Cadastre o NCM correto no cadastro de produtos antes de faturar:\n${_lista}`
                );
                _err.code = 'NCM_AUSENTE';
                throw _err;
            }
            const _itensSemOrigem = itens.filter(it =>
                !/^[0-8]$/.test(String(it.origem ?? it.produto_origem ?? '').trim()));
            if (_itensSemOrigem.length > 0) {
                const _lista = _itensSemOrigem
                    .map(it => `• ${it.descricao || ('produto #' + (it.produto_id || it.id || '?'))}`)
                    .join('\n');
                const _err = new Error(
                    `Emissão bloqueada: ${_itensSemOrigem.length} produto(s) sem origem fiscal confirmada (0 a 8):\n${_lista}`
                );
                _err.code = 'ORIGEM_FISCAL_AUSENTE';
                throw _err;
            }

            // VALIDAÇÃO: CNPJ/CPF do destinatário
            const cnpjCliente = (pedido.cliente_cnpj || '').replace(/\D/g, '');
            const cpfCliente = (pedido.cliente_cpf || '').replace(/\D/g, '');
            if (!cnpjCliente && !cpfCliente) {
                throw new Error('Cliente sem CNPJ ou CPF cadastrado. Corrija o cadastro antes de faturar.');
            }
            if (cnpjCliente && cnpjCliente.length !== 14) {
                throw new Error(`CNPJ do cliente inválido (${cnpjCliente.length} dígitos). Deve ter 14 dígitos.`);
            }
            if (!cnpjCliente && cpfCliente && cpfCliente.length !== 11) {
                throw new Error(`CPF do cliente inválido (${cpfCliente.length} dígitos). Deve ter 11 dígitos.`);
            }

            // 4. Gerar número da NF-e usando serviço compartilhado (série configurável)
            // O serviço verifica MAX entre nfe, pedidos faturamento e pedidos remessa, com FOR UPDATE
            // Regerando: mantém o número e a série da nota que já existe. Consumir um
            // número novo abriria um vão na numeração, e vão de numeração só se resolve
            // com inutilização.
            //
            // ⚠️ EXCEÇÃO: número dentro de faixa JÁ INUTILIZADA na SEFAZ. A regra acima
            // nasceu quando a inutilização não funcionava nesta base (o comentário
            // original dizia isso), então reaproveitar era sempre seguro. Depois que a
            // inutilização passou a ser homologada, o mesmo caminho virou defeito: o
            // número foi declarado à SEFAZ como NÃO utilizado, e transmiti-lo depois é
            // duplicidade/uso de faixa morta — a nota volta rejeitada e a numeração
            // "anda para trás". Nesse caso a regeração pega um número NOVO; o vão que
            // ela deixaria já está formalmente fechado pela própria inutilização.
            let nfNumero = null;
            let proximoNumero;
            let serieConfig;
            // Guarda o número que a nota tinha ANTES da regeração. Fica nulo no caso
            // normal (número reaproveitado); só é preenchido quando a faixa estava
            // inutilizada e a nota precisou trocar de número — aí várias linhas que
            // apontam para o número antigo têm de ser reescritas junto.
            let numeroAnteriorRegeracao = null;
            if (nfeRegerando) {
                const [[dadosNota]] = await connection.query(
                    `SELECT numero, serie FROM nfes WHERE id = ? LIMIT 1`, [nfeRegerando.id]
                );
                const numeroAntigo = parseInt(dadosNota.numero, 10);
                const serieAntiga = dadosNota.serie;

                let faixaInutilizada = false;
                try {
                    const [[bateu]] = await connection.query(`
                        SELECT COUNT(*) AS n
                          FROM nfe_inutilizacoes
                         WHERE serie = ?
                           AND status = 'processado'
                           AND ? BETWEEN numero_inicial AND numero_final
                    `, [serieAntiga, numeroAntigo]);
                    faixaInutilizada = Number(bateu?.n || 0) > 0;
                } catch (_) {
                    // Base sem a tabela: mantém o comportamento antigo (reaproveita).
                }

                if (faixaInutilizada) {
                    console.log(`[FATURAMENTO] ⛔ NF-e ${numeroAntigo}/série ${serieAntiga} está em faixa inutilizada `
                        + `na SEFAZ — a regeração vai consumir um número novo em vez de reaproveitá-la.`);
                    nfNumero = await faturamentoShared.gerarProximoNumeroNFe(connection, serieAntiga);
                    proximoNumero = parseInt(nfNumero.numero, 10);
                    serieConfig = nfNumero.serie;
                    numeroAnteriorRegeracao = numeroAntigo;
                } else {
                    proximoNumero = numeroAntigo;
                    serieConfig = serieAntiga;
                }
            } else {
                nfNumero = await faturamentoShared.gerarProximoNumeroNFe(connection);
                proximoNumero = parseInt(nfNumero.numero);
                serieConfig = nfNumero.serie;
            }

            // 5. Calcular totais usando CalculoTributosService (aritmética Decimal segura)
            // Buscar dados do emitente para cálculo correto de tributos
            const nfeConfig = require('../config/nfe.config');

            // Dados do emitente via FiscalProfileService — mesma fonte canônica usada pelo
            // espelho/DANFE (routes/nfe-api.js), evitando que a emissão real use dados
            // diferentes (desatualizados) dos que a tela mostra ao usuário.
            const FiscalProfileService = require('../services/fiscal-profile.service');
            let emitente;
            try {
                emitente = await FiscalProfileService.carregar(connection);
            } catch (perfilErr) {
                // Deixa o pre-flight de camposFaltantes abaixo reportar de forma estruturada
                emitente = { cnpj: '', razaoSocial: '', nomeFantasia: '', ie: '', regimeTributario: 3, uf: '', logradouro: '', numero: '', complemento: '', bairro: '', codigoMunicipio: '', municipio: '', cep: '', telefone: '' };
            }

            // indIEDest resolvido pelo cadastro, sem depender da grafia da IE
            // (fiscal-helpers.resolverIndicadorIE): 1 = contribuinte com IE,
            // 2 = contribuinte isento de inscrição, 9 = não contribuinte.
            // `fiscalDest.ie` já vem só com dígitos e só quando o indicador é 1 —
            // nos casos 2 e 9 o XML não pode levar a tag <IE>.
            const fiscalDest = resolverIndicadorIE({
                ie: pedido.cliente_ie,
                contribuinteIcms: pedido.cliente_contribuinte_icms
            });

            const destinatario = {
                cnpj: pedido.cliente_cnpj || null,
                cpf: pedido.cliente_cpf || null,
                nome: pedido.cliente_nome,
                ie: fiscalDest.ie,
                // Contribuinte inclui o ISENTO de inscrição (indIEDest=2): é ele quem
                // decide o sufixo do CFOP interestadual (101/102 x 107/108) mais abaixo.
                contribuinteICMS: fiscalDest.contribuinte,
                uf: pedido.cliente_estado,
                logradouro: pedido.cliente_endereco || '',
                numero: pedido.cliente_numero || 'S/N',
                bairro: pedido.cliente_bairro || '',
                // codigo_ibge é canônico; codigo_municipio permanece como fallback legado.
                codigoMunicipio: resolverCodigoMunicipioCliente(pedido) || '',
                municipio: pedido.cliente_cidade || '',
                cep: pedido.cliente_cep || '',
                email: pedido.cliente_email || ''
            };

            const tipoVendaInformado = String(pedido.tipo_venda || '').trim().toLowerCase();
            const usoConsumo = tipoVendaInformado === 'uso_consumo';
            const tipoVendaFiscal = ['revenda', 'revenda_mercadoria', 'comercializacao']
                .includes(tipoVendaInformado)
                ? 'revenda' : 'consumidor';
            destinatario.indicadorIE = fiscalDest.indicadorIE;
            // Não contribuinte (indIEDest=9) OBRIGA indFinal=1: a combinação 9 + indFinal=0
            // é rejeitada com cStat 696 "Operação com não contribuinte deve indicar operação
            // com consumidor final". Um pedido marcado como revenda para um destinatário sem
            // IE cairia exatamente aí.
            destinatario.consumidorFinal = tipoVendaFiscal === 'consumidor'
                || fiscalDest.indicadorIE === '9';
            // Uso/consumo continua sendo consumidor final (indFinal=1), mas pode exigir
            // DIFAL-ST quando o destinatário é contribuinte e o produto está sujeito a ST.
            // Esta flag explícita impede que a exceção libere ST para todo consumidor final.
            destinatario.usoConsumo = usoConsumo;

            // HOTFIX: PRE-FLIGHT — Validar dados fiscais obrigatórios (IBGE, UF, CEP) antes de prosseguir
            const camposFaltantes = [];
            if (!emitente.codigoMunicipio || String(emitente.codigoMunicipio).replace(/\D/g, '').length !== 7) {
                camposFaltantes.push('Código IBGE do município do emitente (deve ter 7 dígitos)');
            }
            if (!emitente.uf || emitente.uf.length !== 2) {
                camposFaltantes.push('UF do emitente');
            }
            if (!emitente.cnpj || emitente.cnpj.replace(/\D/g, '').length !== 14) {
                camposFaltantes.push('CNPJ do emitente');
            }
            if (!emitente.cep || emitente.cep.replace(/\D/g, '').length !== 8) {
                camposFaltantes.push('CEP do emitente');
            }
            if (!destinatario.codigoMunicipio || String(destinatario.codigoMunicipio).replace(/\D/g, '').length !== 7) {
                camposFaltantes.push(`Código IBGE do município do cliente "${destinatario.nome}". Atualize o cadastro do cliente.`);
            }
            if (!destinatario.uf || destinatario.uf.length !== 2) {
                camposFaltantes.push(`UF do cliente "${destinatario.nome}"`);
            }
            if (!destinatario.cep || destinatario.cep.replace(/\D/g, '').length !== 8) {
                camposFaltantes.push(`CEP do cliente "${destinatario.nome}"`);
            }
            const operacaoInterestadual = String(emitente.uf || '').toUpperCase()
                !== String(destinatario.uf || '').toUpperCase();
            if (operacaoInterestadual && tipoVendaFiscal === 'revenda'
                && fiscalDest.indicadorIE !== '1') {
                camposFaltantes.push('Venda para revenda interestadual exige destinatário contribuinte de ICMS com IE válida');
            }
            // Uso/consumo também é válido dentro do estado; nesse caso há ICMS-ST
            // normal, sem DIFAL. As exigências específicas de DIFAL-ST só se
            // aplicam quando emitente e destinatário estão em UFs diferentes.
            if (usoConsumo && operacaoInterestadual
                && !['1', '2'].includes(String(fiscalDest.indicadorIE))) {
                camposFaltantes.push('Uso e consumo com DIFAL-ST exige destinatário contribuinte de ICMS (indIEDest 1 ou 2)');
            }
            // CNPJ sem IE não pode ser classificado automaticamente como consumidor:
            // a operação pode ser para contribuinte dispensado de IE, e isso muda o
            // CFOP, indIEDest e eventual DIFAL. CPF pode seguir como não contribuinte.
            // Testa o indicador RESOLVIDO, não o texto cru: uma IE gravada como 'N/A' ou
            // '000000000' não é inscrição e antes escapava desta confirmação só por não
            // estar vazia — a nota saía classificada sozinha como não contribuinte.
            if (operacaoInterestadual && pedido.cliente_cnpj
                && pedido.cliente_contribuinte_icms == null
                && fiscalDest.indicadorIE === '9') {
                camposFaltantes.push('Confirmação fiscal do destinatário CNPJ (contribuinte ou não contribuinte de ICMS)');
            }
            if (camposFaltantes.length > 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    errorCode: 'IBGE_PREFLIGHT',
                    message: 'Dados fiscais incompletos. Corrija antes de gerar a NF-e.',
                    camposFaltantes
                });
            }

            // BUG-FAT-011: o item ia para o motor de tributos SEM alíquotas (aliquotaICMS/
            // aliquotaPIS/aliquotaCOFINS ausentes) — o ICMS próprio saía zerado (ou o motor
            // rejeitava a emissão) mesmo com CST 00 e alíquota 18% no produto.
            // Prioridade das alíquotas: item do pedido → cadastro do produto → perfil fiscal
            // da empresa (config_fiscal_empresa) → padrão do regime (PIS/COFINS).
            const numeroPositivo = (v) => {
                const n = parseFloat(v);
                return Number.isFinite(n) && n > 0 ? n : null;
            };
            // PIS/COFINS padrão por regime: cumulativo (Simples/Presumido) 0,65/3,00;
            // não-cumulativo (Lucro Real) 1,65/7,60. Usado só como último fallback.
            const regimeFiscalStr = String(emitente.regimeFiscal || '').toLowerCase();
            const pisCofinsRegime = regimeFiscalStr.includes('real')
                ? { pis: 1.65, cofins: 7.60 }
                : { pis: 0.65, cofins: 3.00 };

            // Config da Reforma Tributária (IBS/CBS). Em 2026 vale CBS 0,9% e IBS 0,1%.
            // `destacar_documentos = 0` desliga o grupo na nota sem precisar mexer no código.
            let reformaCfg = { aliq_cbs: 0.9, aliq_ibs: 0.1, aliq_ibs_mun: 0, destacar: false, cst_padrao: '000', classificacao_padrao: null };
            try {
                const [[rc]] = await connection.query(
                    'SELECT aliq_cbs, aliq_ibs, destacar_documentos,cst_padrao,classificacao_padrao FROM reforma_tributaria_config ORDER BY id LIMIT 1'
                );
                if (rc) {
                    reformaCfg = {
                        aliq_cbs: Number(rc.aliq_cbs ?? 0.9),
                        // Em 2026 o IBS é informado integralmente na parcela estadual;
                        // a parcela municipal fica zerada até a partilha entrar em vigor.
                        aliq_ibs: Number(rc.aliq_ibs ?? 0.1),
                        aliq_ibs_mun: 0,
                        destacar: !!rc.destacar_documentos,
                        cst_padrao: rc.cst_padrao || '000', classificacao_padrao: rc.classificacao_padrao || null
                    };
                }
            } catch (_) { /* tabela ausente nesta instância: mantém o padrão */ }

            // Matriz por par de UFs: FCP só entra quando foi configurado
            // explicitamente para a operação/produto. A tabela geral não deve
            // transformar o adicional estadual em default para toda mercadoria.
            let matrizDestino = null;
            try {
                const [[linhaMatriz]] = await connection.query(
                    `SELECT aliquota_interna, aliquota_interestadual, fcp_aliquota
                       FROM aliquotas_icms_uf
                      WHERE uf_origem = ? AND uf_destino = ?
                      ORDER BY id LIMIT 1`,
                    [emitente.uf, destinatario.uf]
                );
                matrizDestino = linhaMatriz || null;
            } catch (_) { /* instalação antiga sem matriz: defaults seguros */ }

            // As sete opções do Cenário de Impostos são resolvidas uma única vez por
            // emissão, pela empresa do pedido e UF do destinatário. O objeto segue em
            // cada item até o CalculoTributosService, que é o motor canônico usado para
            // montar o XML; portanto uma troca salva na tela afeta a próxima geração ou
            // regeração da NF-e, sem duplicar cálculo no frontend.
            let regrasIcmsUf = null;
            try {
                const [[linhaRegra]] = await connection.query(
                    `SELECT somar_frete_seguro, subtrair_desconto, base_mva_revenda,
                            base_consumo_final, valor_imposto_consumo_final,
                            base_difal, valor_difal
                       FROM fiscal_icms_regras_uf
                      WHERE empresa_id = ? AND uf = ? LIMIT 1`,
                    [Number(pedido.empresa_id) || Number(req.user?.empresa_id) || 1,
                        String(destinatario.uf || '').trim().toUpperCase()]
                );
                regrasIcmsUf = linhaRegra || null;
            } catch (erroRegra) {
                // Compatibilidade durante rollout: o motor conserva os padrões anteriores
                // se a tabela ainda não existir, mas registra claramente o motivo.
                console.warn(`[FATURAMENTO] Regras ICMS por UF indisponíveis: ${erroRegra.message}`);
            }
            let recomendacoesFiscais = {};
            try {
                const [[row]] = await connection.query(`SELECT o.opcoes_json,c.icms_desonerado_deduz_total,c.icms_desonerado_motivo FROM fiscal_recomendacoes_config c LEFT JOIN fiscal_recomendacoes_opcoes o ON o.empresa_id=c.empresa_id WHERE c.empresa_id=? LIMIT 1`, [Number(pedido.empresa_id) || Number(req.user?.empresa_id) || 1]);
                const extras = typeof row?.opcoes_json === 'string' ? JSON.parse(row.opcoes_json) : (row?.opcoes_json || {});
                recomendacoesFiscais = {...extras,...(row||{})};
            } catch (_) { /* configuração opcional */ }

            const itensParaCalculo = itens.map((item, index) => {
                const aliquotaICMS = numeroPositivo(item.aliquota_icms)
                    ?? numeroPositivo(item.icms_percent)
                    ?? numeroPositivo(item.produto_aliquota_icms)
                    ?? numeroPositivo(emitente.aliquotaICMSPadrao);
                const aliquotaIPI = numeroPositivo(item.aliquota_ipi)
                    ?? numeroPositivo(item.produto_aliquota_ipi)
                    ?? 0;

                // ------------------------------------------------------------
                // ICMS-ST: decidir ANTES do CST, porque o CST depende disso.
                // ------------------------------------------------------------
                // Ate 11/09/2026 o ST era decidido so pelas flags `calcula_icms_st`
                // (pedido) / `produto_calcular_icms_st` (cadastro), e o CST vinha do
                // cadastro — tipicamente '00'. Resultado: o motor calculava o ST,
                // `calcularTotaisNFe` somava em <vST>, mas o item saia no grupo
                // ICMS00, que NAO tem campos de ST. O ST era descartado do item e
                // sobrevivia so no total: <vST>567,00</vST> com Sum(itens)=0.
                // A SEFAZ valida o total contra o somatorio dos itens e rejeita com
                // cStat 610 ("Total do ICMS ST difere do somatorio dos itens").
                // Constatado na NF-e 919 da Aluforce (pedido 3619, CFOP 5401).
                //
                // O CFOP e a fonte mais confiavel de todas: 5401/5402/5403 e
                // 6401/6402/6403 SAO, por definicao, operacoes com substituicao
                // tributaria. Mesma lista ja usada no motor de vendas
                // (routes/vendas-routes.js), para os dois calculos nao divergirem.
                const CFOPS_COM_ST = ['5401', '5402', '5403', '6401', '6402', '6403'];
                const cfopDaLinha = String(item.cfop || '').replace(/\D/g, '');
                const cfopExigeST = CFOPS_COM_ST.includes(cfopDaLinha);

                const calcularICMSST = (!destinatario.consumidorFinal || destinatario.usoConsumo) && (
                    cfopExigeST
                    || Number(item.valor_icms_st || 0) > 0
                    || (item.calcula_icms_st !== undefined && item.calcula_icms_st !== null
                        ? !!item.calcula_icms_st
                        : !!item.produto_calcular_icms_st)
                );

                // Promocao do CST/CSOSN quando ha ST. Sem isto o grupo emitido nao
                // comporta os campos de ST e o valor some do item (ver acima).
                //   Regime normal: 00 (tributada integralmente) -> 10 (tributada COM ST)
                //                  20 (com reducao de base)     -> 70 (reducao + ST)
                //   Simples Nac.:  102/103/300/400              -> 201 (com ST)
                //                  101 (com credito)            -> 201
                // CSTs que ja preveem ST (10/70/30/60/90) ou situacoes especiais
                // (40/41/50 isentas) ficam INTACTOS — promover cegamente mudaria a
                // declaracao fiscal do item.
                const cstOriginal = item.cst || item.produto_cst_icms
                    || (emitente.regimeTributario === 1 ? '102' : '00');
                const csosnOriginal = item.csosn || item.produto_csosn_icms || '102';

                const cstComST = (!calcularICMSST || emitente.regimeTributario === 1)
                    ? cstOriginal
                    : (String(cstOriginal) === '00' ? '10'
                        : String(cstOriginal) === '20' ? '70'
                            : cstOriginal);

                const csosnComST = (!calcularICMSST || emitente.regimeTributario !== 1)
                    ? csosnOriginal
                    : (['101', '102', '103', '300', '400'].includes(String(csosnOriginal))
                        ? '201' : csosnOriginal);

                if (calcularICMSST && (cstComST !== cstOriginal || csosnComST !== csosnOriginal)) {
                    console.warn(
                        `[FATURAMENTO] pedido ${pedido_id} item ${index + 1} (${item.codigo}): `
                        + `operacao com ICMS-ST (CFOP ${cfopDaLinha || 's/ CFOP'}) — `
                        + `CST/CSOSN promovido de ${cstOriginal}/${csosnOriginal} `
                        + `para ${cstComST}/${csosnComST} para que o ST caiba no grupo do XML.`
                    );
                }

                const itemParaCalculo = {
                    _index: index + 1,
                    codigo: item.codigo,
                    descricao: item.descricao,
                    ncm: item.ncm,
                    cest: item.cest || item.produto_cest || null,
                    // O 1o digito do CFOP indica o ALCANCE da operacao (5=interna, 6=inter-
                    // estadual, 7=exterior) e precisa casar com o idDest da nota, senao a SEFAZ
                    // rejeita com cStat 733 "CFOP de operacao interna e idDest <> 1".
                    // ATENCAO: `item.cfop` e o CFOP CONGELADO na linha do pedido na epoca em que
                    // ele foi criado — se o pedido nasceu como interno (5101) e o cliente e de
                    // outro estado, ele curto-circuitava a escolha correta abaixo e ia 5101 para
                    // uma nota interestadual. Por isso o alcance e reavaliado NA EMISSAO, mantendo
                    // o restante do codigo (101=producao propria, 102=revenda etc), que carrega
                    // significado fiscal proprio e nao deve ser perdido.
                    // Comprovado em homologacao 23/07/2026 (labor-energy SP->BA, pedido 3).
                    // O 3o argumento corrige tambem o SUFIXO quando o destinatario NAO e
                    // contribuinte de ICMS (sem IE): 101->107 e 102->108. Manter 101/102 para
                    // nao contribuinte e rejeitado — e o mesmo criterio que ja define
                    // indIEDest=9 no XML, entao as duas informacoes ficam coerentes.
                    // Padrao das 3 empresas: producao propria (sufixo 101) — 5101 dentro de SP
                    // e 6101 para fora. So vale como FALLBACK: o CFOP da linha do pedido e o
                    // do cadastro do produto continuam mandando quando existem.
                    cfop: ajustarAlcanceCFOP(
                        item.cfop
                            || (emitente.uf === destinatario.uf
                                ? (item.produto_cfop_interna || '5101')
                                : (item.produto_cfop_interestadual || '6101')),
                        emitente.uf === destinatario.uf,
                        // Contribuinte = TEM IE (inclusive 'ISENTO', que e indIEDest=2 —
                        // contribuinte ISENTO de inscricao, e nao "nao contribuinte").
                        // Sem IE nenhuma = indIEDest=9 = nao contribuinte -> 107/108.
                        destinatario.contribuinteICMS === true
                    ),
                    unidade: item.unidade_medida || 'UN',
                    quantidade: item.quantidade,
                    valorUnitario: item.preco_unitario,
                    desconto: item.desconto || 0,
                    acessoriosBaseICMS: recomendacoesFiscais.acessorios_base_icms !== false,
                    acessoriosBaseIPI: recomendacoesFiscais.acessorios_base_ipi !== false,
                    acessoriosBasePIS: recomendacoesFiscais.acessorios_base_pis !== false,
                    acessoriosBaseCOFINS: recomendacoesFiscais.acessorios_base_cofins !== false,
                    descontoBaseICMS: recomendacoesFiscais.desconto_base_icms !== false,
                    descontoBaseIPI: recomendacoesFiscais.desconto_base_ipi !== false,
                    descontoBasePIS: recomendacoesFiscais.desconto_base_pis !== false,
                    descontoBaseCOFINS: recomendacoesFiscais.desconto_base_cofins !== false,
                    deduzICMSDesonerado: recomendacoesFiscais.icms_desonerado_deduz_total !== 0,
                    motivoDesoneracao: item.motivo_desoneracao || recomendacoesFiscais.icms_desonerado_motivo || undefined,
                    ean: item.ean || 'SEM GTIN',
                    origem: item.origem ?? item.produto_origem,
                    cst: cstComST,
                    csosn: csosnComST,
                    aliquotaICMS,
                    aliquotaICMSInternaDestino: numeroPositivo(item.aliquota_icms_interna_destino)
                        ?? numeroPositivo(matrizDestino?.aliquota_interna)
                        ?? undefined,
                    aliquotaICMSInterestadual: numeroPositivo(item.aliquota_icms_interestadual)
                        ?? numeroPositivo(matrizDestino?.aliquota_interestadual)
                        ?? undefined,
                    aliquotaCredito: numeroPositivo(item.aliquota_credito_sn)
                        ?? numeroPositivo(item.produto_aliquota_credito_sn)
                        ?? undefined,
                    cstPIS: (() => {
                        const informado = String(item.cst_pis || item.produto_cst_pis || '').trim().padStart(2, '0');
                        return [1, 2].includes(Number(emitente.regimeTributario))
                            && (!informado || ['01', '02'].includes(informado)) ? '49' : (informado || '01');
                    })(),
                    aliquotaPIS: [1, 2].includes(Number(emitente.regimeTributario))
                        && !item.cst_pis && !item.produto_cst_pis ? 0 : numeroPositivo(item.aliquota_pis)
                        ?? numeroPositivo(item.produto_aliquota_pis)
                        ?? numeroPositivo(emitente.aliquotaPISPadrao)
                        ?? pisCofinsRegime.pis,
                    cstCOFINS: (() => {
                        const informado = String(item.cst_cofins || item.produto_cst_cofins || '').trim().padStart(2, '0');
                        return [1, 2].includes(Number(emitente.regimeTributario))
                            && (!informado || ['01', '02'].includes(informado)) ? '49' : (informado || '01');
                    })(),
                    aliquotaCOFINS: [1, 2].includes(Number(emitente.regimeTributario))
                        && !item.cst_cofins && !item.produto_cst_cofins ? 0 : numeroPositivo(item.aliquota_cofins)
                        ?? numeroPositivo(item.produto_aliquota_cofins)
                        ?? numeroPositivo(emitente.aliquotaCOFINSPadrao)
                        ?? pisCofinsRegime.cofins,
                    // IPI (comportamento validado na auditoria — preservado): quando o pedido
                    // não traz a flag calcula_ipi, deriva da existência de alíquota > 0.
                    calcularIPI: item.calcula_ipi !== undefined && item.calcula_ipi !== null
                        ? !!item.calcula_ipi
                        : (item.produto_calcular_ipi !== undefined && item.produto_calcular_ipi !== null
                            ? !!item.produto_calcular_ipi
                            : aliquotaIPI > 0),
                    aliquotaIPI,
                    // CST do IPI: sem este mapeamento o cálculo caía no default '99'
                    // ("outras saídas") e TODA nota declarava 99 mesmo com o produto
                    // cadastrado como 50 (saída tributada) — passa no schema, mas é
                    // declaração fiscal incorreta. Corrigido em 23/07/2026.
                    cstIPI: item.cst_ipi || item.produto_cst_ipi || '99',
                    // Remessa de insumos ao executor de industrialização por encomenda:
                    // enquadramento 108 (art. 43, VI, Decreto 7.212/2010), compatível com CST 55.
                    codigoEnquadramentoIPI: ['5901', '6901'].includes(String(cfopDaLinha || '').replace(/\D/g, ''))
                        ? '108' : null,
                    calcularICMSST,
                    usoConsumo: destinatario.usoConsumo,
                    // ST: MVA e alíquota interna do destino nunca são adivinhadas.
                    mvaST: item.mva_st ?? item.mva ?? item.produto_mva_st ?? 0,
                    mvaJaAjustada: Number(item.mva_ja_ajustada) === 1,
                    aliquotaICMSST: numeroPositivo(item.aliquota_icms_st)
                        ?? numeroPositivo(item.aliquota_icms_interna_destino)
                        ?? numeroPositivo(matrizDestino?.aliquota_interna)
                        ?? undefined,
                    reducaoBCST: item.reducao_bc_st || 0,
                    // Código de benefício fiscal (cBenef) — exigido pela SEFAZ nos CST
                    // com benefício (40/41/50, 20, 70...). Sem ele: rejeição cStat 930.
                    codigoBeneficioFiscal: item.codigo_beneficio_fiscal || item.cbenef || item.produto_cbenef || null,
                    // Em suspensão/isenção com cBenef, informar o ICMS que deixou de ser
                    // cobrado. O pedido já guarda esse cálculo; não deduzir do total da NF.
                    valorICMSDesonerado: ['40', '41', '50'].includes(String(cstComST).padStart(2, '0'))
                        ? Number(item.valor_icms || 0) : 0,
                    motivoDesoneracao: 9,
                    deduzICMSDesonerado: false,
                    // Reforma Tributária (IBS/CBS, NT 2025.002). O grupo só é emitido quando
                    // há classificação tributária cadastrada — a SEFAZ exige o cClassTrib.
                    cstReforma: item.cst_reforma || item.produto_cst_reforma || reformaCfg.cst_padrao || '000',
                    classeTributariaCBS: reformaCfg.destacar
                        ? (item.cclasstrib_cbs || item.produto_classe_cbs || reformaCfg.classificacao_padrao || null) : null,
                    classeTributariaIBS: reformaCfg.destacar
                        ? (item.cclasstrib_ibs || item.produto_classe_ibs || reformaCfg.classificacao_padrao || null) : null,
                    aliquotaCBS: numeroPositivo(item.cbs_aliquota) ?? reformaCfg.aliq_cbs,
                    aliquotaIBSUF: numeroPositivo(item.ibs_aliquota) ?? reformaCfg.aliq_ibs,
                    aliquotaIBSMun: reformaCfg.aliq_ibs_mun,
                    aliquotaFCPUFDestino: numeroPositivo(item.fcp_aliquota)
                        ?? numeroPositivo(item.aliquota_fcp_destino)
                        ?? numeroPositivo(item.produto_fcp_aliquota)
                        ?? numeroPositivo(matrizDestino?.fcp_aliquota)
                        ?? 0,
                    aliquotaFCPST: numeroPositivo(item.fcp_st_aliquota)
                        ?? numeroPositivo(item.fcp_aliquota)
                        ?? numeroPositivo(item.produto_fcp_aliquota)
                        ?? numeroPositivo(matrizDestino?.fcp_aliquota)
                        ?? 0,
                    mva: item.mva || 0,
                    reducaoBC: item.reducao_bc ?? item.produto_reducao_bc_icms ?? 0,
                    regrasIcmsUf
                };

                aplicarPerfilCfop(itemParaCalculo, emitente.regimeTributario, emitente.uf);
                if (itemParaCalculo.calcularICMSST
                    && !String(itemParaCalculo.cest || '').replace(/\D/g, '')) {
                    const erro = new Error(`Item ${index + 1} (${itemParaCalculo.codigo}) sujeito a ICMS-ST sem CEST. `
                        + 'Cadastre a classificação fiscal antes de faturar; o sistema não pode inventar o CEST.');
                    erro.code = 'CEST_OBRIGATORIO_ST';
                    erro.status = 422;
                    throw erro;
                }
                return itemParaCalculo;
            });
            const naturezaOperacaoEfetiva = resolverNaturezaOperacao(
                itensParaCalculo.map(item => item.cfop), 'Venda de Produtos'
            );

            // Frete/seguro/outras despesas do pedido sao de CABECALHO; a NF-e os quer por item
            // (o <vFrete> do total e a soma deles). Sem este rateio o vFrete saia 0,00 mesmo com
            // frete cobrado. Roda ANTES do calculo: essas verbas entram na base de calculo.
            NFePedidoMapper.ratearDespesasNosItens(itensParaCalculo, pedido);

            const itensCalculados = itensParaCalculo.map(itemParaCalculo =>
                CalculoTributosService.calcularTributosItem(
                    itemParaCalculo, emitente, destinatario, naturezaOperacaoEfetiva
                )
            );

            require('../../../services/nfe-fiscal-totals.service').validarAritmeticaFiscal(itensCalculados);
            // Calcular totais da NF-e usando Decimal seguro
            const totaisNFe = CalculoTributosService.aplicarSomatoriosImportacao(
                CalculoTributosService.calcularTotaisNFe(itensCalculados), recomendacoesFiscais,
                itensParaCalculo.map(item => item.cfop)
            );
            // Retencoes na fonte (grupo retTrib) vem do PEDIDO, nao do item: o XSD as
            // posiciona em <total>, ao lado de ICMSTot. XmlNFeService.lerRetencoes valida
            // os pares exigidos (vIRRF precisa de vBCIRRF) e devolve null quando nao ha
            // retencao — que e o caso normal em venda de produto.
            totaisNFe.retencoes = pedido.retencoes_json || null;

            const frete = parseFloat(pedido.frete) || 0;
            const desconto = parseFloat(pedido.desconto) || 0;

            // Usar valores calculados pelo motor de tributos
            const valorProdutos = totaisNFe.valorProdutos;
            const baseICMS = totaisNFe.baseCalculoICMS;
            const valorICMS = totaisNFe.valorICMS;
            const valorIPI = totaisNFe.valorIPI;
            const valorPIS = totaisNFe.valorPIS;
            const valorCOFINS = totaisNFe.valorCOFINS;
            // ST/FCP: ja eram somados pelo motor e iam para o <ICMSTot> do XML, mas nao
            // tinham onde ser gravados (ver ensure de colunas no topo do arquivo).
            const baseICMSST = totaisNFe.baseCalculoST || 0;
            const valorICMSST = totaisNFe.valorST || 0;
            const valorFCP = totaisNFe.valorFCP || 0;
            const valorFCPST = totaisNFe.valorFCPST || 0;
            // Aritmética segura: Math.round evita floating point drift
            // Ex: 1234.56 + 0.1 - 0.2 poderia dar 1234.4599999...
            // `calcularTotaisNFe` já soma o frete rateado e subtrai o desconto dos
            // itens. Aplicá-los outra vez aqui fazia o registro financeiro divergir
            // do XML (e da própria totalização da NF-e).
            const valorTotal = Math.round(totaisNFe.valorTotal * 100) / 100;

            // Datas do quadro de identificação da DANFE, escolhidas no editor de NF-e
            // (`pedidos.data_emissao` / `pedidos.data_saida`). O mapper valida contra as
            // regras da SEFAZ e devolve a data do envio quando o que foi digitado
            // derrubaria a nota — ver NFePedidoMapper.mapearDatas.
            const datasNFe = NFePedidoMapper.mapearDatas(pedido);
            for (const avisoData of datasNFe.avisos) {
                console.warn(`[FATURAMENTO] pedido ${pedido_id}: ${avisoData}`);
            }

            // 6. Criar registro da NF-e
            // Regerando: a linha em `nfes` já existe e é reaproveitada (mesmo id, mesmo
            // número). O XML novo entra pelo UPDATE do passo 7.5, logo abaixo.
            const [nfe] = nfeRegerando ? [{ insertId: nfeRegerando.id }] : await connection.query(`
                INSERT INTO nfes (
                    pedido_id,
                    numero,
                    serie,
                    modelo,
                    tipo_emissao,
                    finalidade,
                    natureza_operacao,
                    cliente_id,
                    destinatario_nome,
                    destinatario_cnpj_cpf,
                    destinatario_endereco,
                    destinatario_cidade,
                    destinatario_uf,
                    destinatario_cep,
                    valor_produtos,
                    valor_frete,
                    valor_desconto,
                    base_calculo_icms,
                    valor_icms,
                    valor_ipi,
                    valor_pis,
                    valor_cofins,
                    valor_total,
                    base_calculo_icms_st,
                    valor_icms_st,
                    valor_fcp,
                    valor_fcp_st,
                    cfop,
                    status,
                    data_emissao,
                    usuario_id,
                    created_at
                ) VALUES (
                    ?, ?, ?, '55', 1, 1, ?,
                    ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    'pendente', ?, ?, NOW()
                )
            `, [
                pedido_id,
                proximoNumero,
                serieConfig,
                naturezaOperacaoEfetiva,
                pedido.cliente_id,
                pedido.cliente_nome,
                pedido.cliente_cnpj || pedido.cliente_cpf,
                pedido.cliente_endereco,
                pedido.cliente_cidade,
                pedido.cliente_estado,
                pedido.cliente_cep,
                valorProdutos,
                frete,
                desconto,
                baseICMS,
                valorICMS,
                valorIPI,
                valorPIS,
                valorCOFINS,
                valorTotal,
                baseICMSST,
                valorICMSST,
                valorFCP,
                valorFCPST,
                (itensCalculados[0] && itensCalculados[0].item
                    && itensCalculados[0].item.cfop) || null,
                datasNFe.dataEmissao,
                usuario_id
            ]);

            const nfe_id = nfeRegerando ? nfeRegerando.id : nfe.insertId;

            // REGERACAO: o INSERT acima e pulado (a linha ja existe), e ate 11/09/2026 nada
            // atualizava os totais do cabecalho. A nota era regerada com tributos novos, o
            // XML saia com os valores corretos, e `nfes` continuava exibindo os ANTIGOS —
            // painel, listagem e relatorios divergindo do que foi transmitido. Como a
            // regeneracao existe justamente para corrigir valores, os totais tem de vir junto.
            if (nfeRegerando) {
                await connection.query(`
                    UPDATE nfes
                       SET valor_produtos = ?, valor_frete = ?, valor_desconto = ?,
                           base_calculo_icms = ?, valor_icms = ?, valor_ipi = ?,
                           valor_pis = ?, valor_cofins = ?, valor_total = ?,
                           base_calculo_icms_st = ?, valor_icms_st = ?,
                           valor_fcp = ?, valor_fcp_st = ?, cfop = COALESCE(?, cfop),
                           destinatario_nome = ?, destinatario_cnpj_cpf = ?,
                           destinatario_uf = ?, destinatario_cidade = ?
                     WHERE id = ?
                `, [
                    valorProdutos, frete, desconto,
                    baseICMS, valorICMS, valorIPI,
                    valorPIS, valorCOFINS, valorTotal,
                    baseICMSST, valorICMSST, valorFCP, valorFCPST,
                    // `nfes.cfop` nunca era preenchido — coluna vazia na listagem fiscal.
                    (itensCalculados[0] && itensCalculados[0].item
                        && itensCalculados[0].item.cfop) || null,
                    pedido.cliente_nome, pedido.cliente_cnpj || pedido.cliente_cpf,
                    pedido.cliente_estado, pedido.cliente_cidade,
                    nfe_id
                ]);
            }

            // A regeração normal reaproveita o número, então a linha de `nfes` não muda
            // de numeração e o INSERT acima é pulado. Quando a faixa estava inutilizada
            // o número TROCOU: sem este UPDATE a linha ficaria com o número velho
            // (inutilizado) enquanto o XML e a chave levam o novo — a nota sairia
            // autorizada na SEFAZ e o ERP continuaria exibindo o número morto.
            if (numeroAnteriorRegeracao !== null) {
                await connection.query(
                    `UPDATE nfes SET numero = ?, serie = ? WHERE id = ?`,
                    [String(proximoNumero), serieConfig, nfe_id]
                );
            }

            // Regerando: os tributos foram recalculados, então os itens antigos saem.
            // Sem isso o nfe_itens ficaria com as duas versões e os relatórios fiscais
            // passariam a contar o dobro.
            if (nfeRegerando) {
                await connection.query('DELETE FROM nfe_itens WHERE nfe_id = ?', [nfe_id]);
            }

            // 7. Inserir itens da NF-e com tributos calculados
            for (let i = 0; i < itens.length; i++) {
                const item = itens[i];
                const itemCalc = itensCalculados[i];
                await connection.query(`
                    INSERT INTO nfe_itens (
                        nfe_id,
                        produto_id,
                        codigo_produto,
                        descricao,
                        ncm,
                        unidade,
                        quantidade,
                        valor_unitario,
                        valor_total,
                        valor_desconto,
                        base_calculo_icms,
                        valor_icms,
                        aliquota_icms,
                        valor_ipi,
                        valor_pis,
                        valor_cofins,
                        cfop,
                        cst_icms,
                        csosn_icms,
                        base_calculo_icms_st,
                        valor_icms_st,
                        aliquota_icms_st,
                        mva_st,
                        valor_fcp,
                        valor_fcp_st
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    nfe_id,
                    item.produto_id,
                    item.codigo,
                    item.descricao,
                    item.ncm,
                    item.unidade_medida || 'UN',
                    item.quantidade,
                    item.preco_unitario,
                    itemCalc.totais.valorBruto,
                    itemCalc.totais.valorDesconto || 0,
                    itemCalc.icms.baseCalculo || 0,
                    itemCalc.icms.valorICMS || 0,
                    itemCalc.icms.aliquota || 0,
                    itemCalc.ipi.valorIPI || 0,
                    itemCalc.pis.valorPIS || 0,
                    itemCalc.cofins.valorCOFINS || 0,
                    // Fiscal do item: ate 11/09/2026 o `cfop` ficava NULL na nota (a coluna
                    // existia e nunca era preenchida) e o ST nao tinha coluna alguma. O que
                    // vai para a SEFAZ e o que fica gravado agora sao a mesma coisa.
                    (itemCalc.item && itemCalc.item.cfop) || item.cfop || null,
                    itemCalc.icms.cst || null,
                    itemCalc.icms.csosn || null,
                    itemCalc.icms.baseCalculoST || 0,
                    itemCalc.icms.valorICMSST || 0,
                    itemCalc.icms.aliquotaST || 0,
                    itemCalc.icms.mvaST || 0,
                    itemCalc.icms.valorFCP || 0,
                    itemCalc.icms.valorFCPST || 0
                ]);
            }

            // 7.5. Gerar XML da NF-e usando XmlNFeService
            const codigoUF = nfeConfig.estados[emitente.uf]?.codigo || 35;
            let xmlNfe = null;
            let chaveAcesso = null;
            try {
                const dadosNFe = {
                    codigoUF: codigoUF,
                    naturezaOperacao: naturezaOperacaoEfetiva,
                    modelo: '55',
                    serie: String(serieConfig),
                    numeroNFe: proximoNumero,
                    dataEmissao: datasNFe.dataEmissao,
                    dataSaida: datasNFe.dataSaida,
                    tipoOperacao: '1', // Saída
                    tipoEmissao: '1',  // Normal
                    ambiente: nfeConfig.ambiente,
                    finalidade: '1',   // Normal
                    // Chaves do modal "Notas ou Cupons Relacionados" do pedido.
                    nfRef: NFePedidoMapper.mapearNotasReferenciadas(pedido),
                    // <entrega>/<retirada> — endereços alternativos do modal do pedido.
                    entrega: NFePedidoMapper.mapearEnderecoEntrega(pedido),
                    retirada: NFePedidoMapper.mapearEnderecoRetirada(pedido),
                    consumidorFinal: destinatario.consumidorFinal ? '1' : '0',
                    indicadorPresenca: NFePedidoMapper.mapearIndicadorPresenca(pedido),
                    emitente,
                    destinatario,
                    itens: itensCalculados,
                    totais: totaisNFe,
                    // Transporte e cobrança pelo mapper compartilhado (o mesmo do espelho e do
                    // "Faturar Agora" do Vendas). Antes só ia `modalidade_frete` — coluna que a
                    // tela não escreve —, então toda nota saía como '9 - Sem Frete', sem
                    // transportadora, sem placa, sem volumes/pesos e sem duplicatas.
                    transporte: NFePedidoMapper.mapearTransporte(pedido, transportadoraNFe),
                    // O ST DESTA nota (não o do pedido) decide quanto vai na 1ª duplicata
                    // — ver concentrarStNaPrimeira em duplicatas-pedido.service.js.
                    cobranca: NFePedidoMapper.mapearCobranca(pedido, valorTotal, proximoNumero,
                        {
                            icmsSt: valorICMSST || 0,
                            cfops: itensCalculados.map(item => item.item && item.item.cfop)
                        }),
                    pagamento: [{
                        forma: pedido.forma_pagamento || '01', // Dinheiro
                        valor: valorTotal
                    }],
                    // "Dados Adicionais para a Nota Fiscal" do pedido (`info_complementar`;
                    // `dados_adicionais_nf` é o alias do modal de novo orçamento). A montagem
                    // do texto vive no mapper para não divergir do espelho nem do outro
                    // caminho de emissão — já divergiu uma vez, quando isto aqui foi corrigido
                    // e o `nfe-emitter.service.js` continuou lendo `observacoes_nfe`, coluna
                    // que nem existe em `pedidos`.
                    // Obs.: o schema aceita 5000 no infCpl, mas XmlNFeService.sanitizarTextoXML
                    // corta em 2000 e achata as quebras de linha — o corte real é lá.
                    informacoesAdicionais: NFePedidoMapper.mapearInformacoesAdicionais(pedido)
                };

                // <agropecuario> é por item no XSD, mas o modal do pedido só guarda um
                // conjunto — aplicado a todos os itens da nota quando presente. Mesma lógica
                // do outro caminho de emissão (services/nfe-emitter.service.js), pra não
                // divergir quando o pedido é faturado por aqui em vez do Kanban de Vendas.
                const agropecuario = NFePedidoMapper.mapearAgropecuario(pedido);
                if (agropecuario) {
                    itensCalculados.forEach(item => { item.agropecuario = agropecuario; });
                }

                const resultadoXml = XmlNFeService.gerarXML(dadosNFe);
                xmlNfe = resultadoXml.xml;
                chaveAcesso = resultadoXml.chaveAcesso;

                // Salvar XML e chave de acesso no registro da NF-e
                await connection.query(`
                    UPDATE nfes SET xml_nfe = ?, chave_acesso = ?, emitente_uf = ?, emitente_cnpj = ?,
                                    data_emissao = ? WHERE id = ?
                `, [xmlNfe, chaveAcesso, emitente.uf, emitente.cnpj.replace(/\D/g, ''),
                    // Regerando: a linha em `nfes` é reaproveitada, e o dhEmi do XML novo
                    // entra na chave de acesso. Sem atualizar a coluna, a tela mostraria a
                    // data da primeira tentativa e o XML transmitido, outra.
                    datasNFe.dataEmissao, nfe_id]);

                console.log(`[FATURAMENTO] ✅ XML NF-e gerado com sucesso. Chave: ${chaveAcesso}`);
            } catch (xmlError) {
                console.error(`[FATURAMENTO] ❌ Erro ao gerar XML NF-e: ${xmlError.message}`);
                throw new Error(`Falha na geração do XML da NF-e: ${mensagemSegura(xmlError)}. Verifique os dados fiscais (emitente, destinatário, NCM, CFOP) e tente novamente.`);
            }

            // 8. Atualizar pedido com NF-e gerada (status → 'faturado' para logística capturar)
            // O NÚMERO da nota também é gravado no pedido: a etiqueta de expedição
            // (/_shared/etiqueta.js, via /etiqueta-dados) lê `nfe_faturamento_numero`, e sem
            // isso o campo "Nota Fiscal" saía em branco mesmo com o pedido já faturado.
            if (nfeRegerando) {
                // Regerando: o pedido JÁ foi faturado quando a nota nasceu, e forçar
                // `status = 'faturado'` aqui destruiria o estado de faturamento PARCIAL
                // (meia-nota) — um pedido 'parcial' passaria a constar como totalmente
                // faturado, com metade do valor sem nota. Só a chave muda, porque o XML
                // novo tem chave nova (o dhEmi entra na composição).
                // Quando a faixa estava inutilizada o número trocou, e as colunas de
                // número do pedido (lidas pela etiqueta de expedição e pelos relatórios)
                // continuariam apontando para o número morto. Só são tocadas nesse caso:
                // na regeração comum o número é o mesmo e reescrevê-las seria ruído.
                if (numeroAnteriorRegeracao !== null) {
                    await connection.query(
                        `UPDATE pedidos
                            SET nfe_chave = ?,
                                nfe_faturamento_numero = ?,
                                numero_nf = ?,
                                nf = ?
                          WHERE id = ?`,
                        [chaveAcesso || null, String(proximoNumero), String(proximoNumero),
                         String(proximoNumero), pedido_id]
                    );
                } else {
                    await connection.query(
                        `UPDATE pedidos SET nfe_chave = ? WHERE id = ?`,
                        [chaveAcesso || null, pedido_id]
                    );
                }

                // O registro do faturamento parcial guarda a chave e o CFOP da nota. Sem
                // atualizar aqui, a meia-nota continuaria apontando para a chave antiga
                // (que não existe mais) e para o CFOP anterior à correção.
                try {
                    // `calcularTributosItem` devolve o item de entrada em `.item` — o CFOP
                    // nunca esteve na raiz, entao isto era sempre null e o COALESCE abaixo
                    // preservava o CFOP ANTIGO da linha do pedido a cada regeracao.
                    // Era exatamente o que mantinha 5102 gravado numa nota regerada com 5401.
                    const cfopRegerado = (itensCalculados[0] && itensCalculados[0].item
                        && itensCalculados[0].item.cfop) || null;
                    // O WHERE precisa casar pelo número ANTIGO — é ele que está gravado na
                    // linha. Com o número novo o UPDATE não casaria nada e a meia-nota
                    // ficaria com a chave morta, calada.
                    const numeroNaLinha = String(numeroAnteriorRegeracao !== null ? numeroAnteriorRegeracao : proximoNumero);
                    await connection.query(
                        `UPDATE pedido_faturamentos
                            SET nfe_chave = ?, nfe_cfop = COALESCE(?, nfe_cfop), nfe_numero = ?
                          WHERE pedido_id = ? AND nfe_numero = ?`,
                        [chaveAcesso || null, cfopRegerado, String(proximoNumero), pedido_id, numeroNaLinha]
                    );
                } catch (errFat) {
                    // Instalação sem a tabela/colunas não impede a regeração da nota.
                    console.warn('[FATURAMENTO] Não foi possível sincronizar pedido_faturamentos na regeração:', errFat.code || errFat.message);
                }
            } else {
                await connection.query(`
                    UPDATE pedidos
                    SET nfe_id = ?,
                        nfe_faturamento_numero = ?,
                        numero_nf = ?,
                        nf = ?,
                        nfe_chave = ?,
                        data_faturamento = COALESCE(data_faturamento, CURDATE()),
                        faturado_em = NOW(),
                        status = 'faturado'
                    WHERE id = ?
                `, [nfe_id, String(proximoNumero), String(proximoNumero), String(proximoNumero),
                    chaveAcesso || null, pedido_id]);
            }

            // 9. Integrações PRÉ-COMMIT (dentro da transação para garantir ACID)
            // VULN-011 FIX: Integrações são MANDATÓRIAS quando solicitadas — falha causa ROLLBACK
            const integracoes = { financeiro: null, estoque: null, avisos: [] };

            // Regerando: estoque e financeiro JÁ foram processados quando a nota nasceu.
            // Repetir aqui reservaria o estoque duas vezes e criaria um segundo título no
            // contas a receber para a mesma nota — o dobro do valor a cobrar do cliente.
            if (autoReservarEstoque && pedido_id && !nfeRegerando) {
                try {
                    integracoes.estoque = await vendasEstoqueService.reservarEstoque(pedido_id, usuario_id);
                } catch (err) {
                    console.error(`[FATURAMENTO] ❌ Falha CRÍTICA ao reservar estoque para pedido ${pedido_id}:`, err.message);
                    throw new Error(`Falha na reserva de estoque: ${mensagemSegura(err)}. NF-e não gerada — rollback executado.`);
                }
            }

            if (autoIntegrarFinanceiro && !nfeRegerando) {
                try {
                    integracoes.financeiro = await financeiroService.gerarContasReceber(nfe_id, {
                        numeroParcelas,
                        diaVencimento,
                        intervalo
                    });
                } catch (err) {
                    console.error(`[FATURAMENTO] ❌ Falha CRÍTICA ao gerar contas a receber para NF-e ${nfe_id}:`, err.message);
                    throw new Error(`Falha na integração financeira: ${mensagemSegura(err)}. NF-e não gerada — rollback executado.`);
                }
            }

            await connection.commit();

            // VULN-013 FIX: Audit trail explícito para geração de NF-e
            logAuditEvent(pool, {
                userId: usuario_id,
                action: 'GERAR_NFE',
                module: 'faturamento',
                description: `NF-e ${proximoNumero} gerada para pedido ${pedido_id}. Valor: R$ ${valorTotal.toFixed(2)}`,
                newData: { nfe_id, numero_nfe: proximoNumero, pedido_id, valor_total: valorTotal, chave_acesso: chaveAcesso },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            // AUDITORIA ENTERPRISE: Log de geração de NF-e fiscal
            console.log(`[FATURAMENTO-AUDIT] ✅ NF-e ${proximoNumero} gerada por usuário ${usuario_id} para pedido ${pedido_id}. Valor: R$ ${valorTotal.toFixed(2)}`);

            // Não enviar DANFE nesta etapa: aqui existe somente um XML gerado, ainda
            // sem validade fiscal. O envio ocorre exclusivamente após cStat 100 na
            // rota /nfes/:id/enviar-sefaz.

            res.json({
                success: true,
                message: integracoes.avisos.length === 0 ? 'NF-e gerada com sucesso' : 'NF-e gerada com avisos de integração',
                data: {
                    nfe_id,
                    numero_nfe: proximoNumero,
                    serie: 1,
                    chave_acesso: chaveAcesso || null,
                    xml_gerado: !!xmlNfe,
                    valor_total: valorTotal,
                    tributos: {
                        base_icms: baseICMS,
                        valor_icms: valorICMS,
                        valor_ipi: valorIPI,
                        valor_pis: valorPIS,
                        valor_cofins: valorCOFINS,
                        // BUG-FAT-001: CRT 2 = Simples (excesso de sublimite); CRT 3 = Regime
                        // Normal, cujo detalhe (presumido/real) vem do cadastro da empresa.
                        regime_tributario: regimeParaLabel(emitente.regimeTributario, emitente.regimeFiscal)
                    },
                    status: 'pendente',
                    proximos_passos: xmlNfe
                        ? ['Enviar para SEFAZ (XML já gerado)', 'Gerar DANFE em PDF']
                        : ['Corrigir dados para geração do XML', 'Enviar para SEFAZ', 'Gerar DANFE em PDF'],
                    integracoes
                }
            });

        } catch (error) {
            await connection.rollback();
            console.error('[FATURAMENTO] Erro ao gerar NF-e:', error?.message || error, error?.stack || '');
            // HOTFIX: Diferenciar causa raiz para mensagens granulares
            const msg = (error.message || '').toLowerCase();
            let statusCode = 500;
            let errorCode = 'GERAR_NFE_ERRO';
            if (msg.includes('certificado') || msg.includes('certificate') || msg.includes('pfx')) {
                statusCode = 401;
                errorCode = 'CERTIFICADO_INVALIDO';
            } else if (msg.includes('estoque')) {
                statusCode = 400;
                errorCode = 'ESTOQUE_INSUFICIENTE';
            } else if (msg.includes('já existe')) {
                statusCode = 409;
                errorCode = 'NFE_DUPLICADA';
            } else if (
                msg.includes('não encontrado') || msg.includes('nao encontrado') ||
                msg.includes('sem itens') || msg.includes('sem cnpj') || msg.includes('sem cpf') ||
                msg.includes('quantidade inv') || msg.includes('quantidade inválida') ||
                msg.includes('cnpj do cliente') || msg.includes('cpf do cliente') ||
                msg.includes('obrigatório') || msg.includes('obrigatorio')
            ) {
                statusCode = 400;
                errorCode = 'VALIDACAO_ERRO';
            }
            res.status(statusCode).json({
                success: false,
                errorCode,
                message: mensagemSegura(error)
            });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // APOIO À EMISSÃO MANUAL — BUSCA DE DESTINATÁRIO E DE PRODUTO
    // ============================================================
    // Ficam aqui, e não em /api/vendas, de propósito: quem emite NF-e tem permissão
    // de Faturamento, não necessariamente da área Vendas — apontar o modal para
    // /api/vendas/clientes devolveria 403 para o pessoal do fiscal.
    router.get('/destinatarios', authenticateToken, async (req, res) => {
        try {
            const termo = String(req.query.q || '').trim();
            if (termo.length < 2) return res.json({ success: true, data: [] });
            const like = `%${termo}%`;
            const soDigitos = termo.replace(/\D/g, '');
            const [rows] = await pool.query(`
                SELECT c.id, COALESCE(NULLIF(TRIM(c.razao_social), ''), c.nome) AS nome,
                       c.cnpj, c.cpf, c.inscricao_estadual, c.endereco, c.numero, c.complemento,
                       c.bairro, c.cidade, c.estado, c.codigo_ibge, c.codigo_municipio, c.cep, c.telefone, c.email,
                       c.fiscal_contribuinte_icms,
                       (SELECT p.tipo_venda FROM pedidos p WHERE p.cliente_id = c.id
                         AND p.tipo_venda IS NOT NULL AND TRIM(p.tipo_venda) <> ''
                         ORDER BY p.id DESC LIMIT 1) AS ultimo_tipo_venda
                  FROM clientes
                 WHERE nome LIKE ?
                    ${soDigitos ? "OR REPLACE(REPLACE(REPLACE(COALESCE(cnpj,''),'.',''),'/',''),'-','') LIKE ? OR REPLACE(REPLACE(COALESCE(cpf,''),'.',''),'-','') LIKE ?" : ''}
                 ORDER BY nome
                 LIMIT 20
            `, soDigitos ? [like, `%${soDigitos}%`, `%${soDigitos}%`] : [like]);
            return res.json({
                success: true,
                data: rows.map(c => ({
                    id: c.id,
                    nome: c.nome,
                    documento: String(c.cnpj || c.cpf || '').replace(/\D/g, ''),
                    ie: c.inscricao_estadual || '',
                    endereco: c.endereco || '',
                    numero: c.numero || '',
                    complemento: c.complemento || '',
                    bairro: c.bairro || '',
                    municipio: c.cidade || '',
                    // `codigo_ibge` é a coluna preferida; `codigo_municipio` é o nome antigo,
                    // ainda populado em parte da base — a mesma ordem que o emissor usa.
                    codigoMunicipio: String(c.codigo_ibge || c.codigo_municipio || '').replace(/\D/g, ''),
                    uf: c.estado || '',
                    cep: String(c.cep || '').replace(/\D/g, ''),
                    telefone: String(c.telefone || '').replace(/\D/g, ''),
                    email: c.email || ''
                    ,contribuinteICMS: Number(c.fiscal_contribuinte_icms) === 1
                    ,consumidorFinal: ['consumidor', 'consumidor_final', 'consumo'].includes(String(c.ultimo_tipo_venda || '').trim().toLowerCase())
                }))
            });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao buscar destinatários:', error?.message || error);
            return res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    router.get('/produtos-fiscais', authenticateToken, async (req, res) => {
        try {
            const termo = String(req.query.q || '').trim();
            if (termo.length < 1) return res.json({ success: true, data: [] });
            const like = `%${termo}%`;
            const [rows] = await pool.query(`
                SELECT codigo, descricao, ncm, unidade_medida,
                       COALESCE(NULLIF(preco_venda, 0), preco, 0) AS preco,
                       cfop_saida_interna, cfop_saida_interestadual
                  FROM produtos
                 WHERE codigo LIKE ? OR descricao LIKE ?
                 ORDER BY codigo
                 LIMIT 20
            `, [like, like]);
            return res.json({
                success: true,
                data: rows.map(p => ({
                    codigo: p.codigo,
                    descricao: p.descricao || '',
                    ncm: String(p.ncm || '').replace(/\D/g, ''),
                    unidade: p.unidade_medida || 'UN',
                    preco: parseFloat(p.preco) || 0,
                    cfop_interna: p.cfop_saida_interna || '',
                    cfop_interestadual: p.cfop_saida_interestadual || ''
                }))
            });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao buscar produtos fiscais:', error?.message || error);
            return res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // Prévia autoritativa do perfil: a tela não presume a UF do emitente nem deixa
    // um CFOP incompatível escondido no select. A emissão repete a validação abaixo.
    router.get('/perfil-operacao-avulsa', authenticateToken, async (req, res) => {
        try {
            const operacao = String(req.query.operacao || 'VENDA').trim().toUpperCase();
            const ufDestino = String(req.query.uf_destino || '').trim().toUpperCase();
            if (!/^[A-Z]{2}$/.test(ufDestino)) {
                return res.status(400).json({ success: false, message: 'UF de destino inválida.' });
            }
            const emitente = await FiscalProfileService.carregar(pool);
            const interestadual = emitente.uf !== ufDestino;
            if (operacao === 'DEVOLUCAO_COMPRA') {
                return res.json({ success: true, data: {
                    ufOrigem: emitente.uf, ufDestino, interestadual,
                    cfop: null, naturezaOperacao: 'Devolução de compra',
                    cfopsPermitidos: interestadual ? ['6201', '6202', '6411'] : ['5201', '5202', '5411']
                } });
            }
            const { resolverPerfilOperacao } = require('../../../services/nfe-operation-profile.service');
            const perfil = resolverPerfilOperacao({ operacao, ufOrigem: emitente.uf, ufDestino });
            return res.json({ success: true, data: {
                ufOrigem: emitente.uf, ufDestino, interestadual,
                cfop: perfil.cfop, naturezaOperacao: perfil.naturezaOperacao || 'Definida pelos itens',
                cfopsPermitidos: []
            } });
        } catch (error) {
            return res.status(error.status || 422).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // EMISSÃO MANUAL (AVULSA) — ATALHO RÁPIDO, SEM PEDIDO
    // ============================================================
    // O modal "Gerar NF-e" do Faturamento tem duas vias: a partir de um pedido
    // aprovado (rota acima) e esta, avulsa. A avulsa NÃO cria pedido artificial,
    // não movimenta estoque, não gera título no Contas a Receber e não toca no
    // kanban de Vendas: grava a NF-e com pedido_id/cliente_id nulos e transmite.
    // A tributação continua saindo do CADASTRO DE PRODUTOS (o operador informa o
    // código) — CST, CSOSN e alíquotas nunca vêm do frontend. NCM e CFOP podem ser
    // sobrescritos na tela porque são dados da operação, não do regime.
    router.post('/gerar-nfe-manual', authenticateToken, async (req, res) => {
        try {
            if (!await FiscalAccessService.podeGerarNfe(pool, req.user)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${req.user.id} tentou emitir NF-e avulsa sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Permissão insuficiente',
                    message: 'Seu perfil não possui permissão para gerar NF-e. É necessário ter permissão para criar no Faturamento.',
                    errorCode: 'RBAC_DENIED'
                });
            }

            const body = req.body || {};
            const dest = body.destinatario || {};
            const itensBody = Array.isArray(body.itens) ? body.itens : [];
            const digitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');

            const faltando = [];
            if (!String(dest.nome || '').trim()) faltando.push('nome/razão social do destinatário');
            const documento = digitos(dest.documento);
            if (documento.length !== 11 && documento.length !== 14) {
                faltando.push('CNPJ (14 dígitos) ou CPF (11 dígitos) do destinatário');
            }
            if (digitos(dest.codigoMunicipio).length !== 7) faltando.push('código IBGE do município (7 dígitos)');
            if (String(dest.uf || '').trim().length !== 2) faltando.push('UF do destinatário');
            if (dest.contribuinteICMS === true && !String(dest.ie || '').trim()) {
                faltando.push('inscrição estadual para destinatário contribuinte');
            }
            if (digitos(dest.cep).length !== 8) faltando.push('CEP do destinatário (8 dígitos)');
            if (!String(dest.endereco || dest.logradouro || '').trim()) faltando.push('logradouro do destinatário');
            if (!String(dest.numero || '').trim()) faltando.push('número do endereço');
            if (!String(dest.bairro || '').trim()) faltando.push('bairro do destinatário');
            if (!String(dest.municipio || '').trim()) faltando.push('município do destinatário');
            if (itensBody.length === 0) faltando.push('ao menos um item');

            const itens = [];
            itensBody.forEach((it, i) => {
                const codigo = String(it.codigo || '').trim();
                const quantidade = Number(it.quantidade);
                const valorUnitario = Number(it.valor_unitario != null ? it.valor_unitario : it.valorUnitario);
                if (!codigo) faltando.push(`código do produto no item ${i + 1}`);
                if (!(quantidade > 0)) faltando.push(`quantidade válida no item ${i + 1}`);
                if (!(valorUnitario > 0)) faltando.push(`preço unitário válido no item ${i + 1}`);
                itens.push({
                    codigo,
                    descricao: String(it.descricao || '').trim() || null,
                    ncm: digitos(it.ncm) || null,
                    cfop: digitos(it.cfop) || null,
                    unidade: String(it.unidade || '').trim() || null,
                    quantidade,
                    valor_unitario: valorUnitario,
                    desconto: Number(it.desconto) || 0
                });
            });

            if (faltando.length) {
                return res.status(400).json({
                    success: false,
                    errorCode: 'VALIDACAO_ERRO',
                    message: 'Dados obrigatórios ausentes: ' + faltando.join(', ') + '.'
                });
            }

            const operacaoFiscal = String(body.operacao_fiscal || 'VENDA').trim().toUpperCase();
            const naturezaOperacao = operacaoFiscal === 'VENDA'
                ? 'Venda de Produtos'
                : (String(body.natureza_operacao || '').trim() || 'Saída de mercadorias');
            const { resolverPerfilOperacao } = require('../../../services/nfe-operation-profile.service');
            const emitenteOperacao = await FiscalProfileService.carregar(pool);
            const perfilOperacao = resolverPerfilOperacao({
                operacao: operacaoFiscal,
                ufOrigem: emitenteOperacao.uf,
                ufDestino: dest.uf,
                cfop: body.cfop_operacao || (itens.length === 1 ? itens[0].cfop : null),
                nfRef: body.nfe_referenciada
            });
            if (perfilOperacao.cfop) itens.forEach(item => { item.cfop = perfilOperacao.cfop; });
            console.log(`[FATURAMENTO] Usuário ${req.user.id} iniciando emissão MANUAL de NF-e `
                + `(${itens.length} item(ns), destinatário ${documento})`);

            const { emitirNFePedido } = require('../../../services/nfe-emitter.service');
            const emissao = await emitirNFePedido(pool, {
                itens,
                usuarioId: req.user.id,
                auditoriaEnvio: require('../../../services/nfe-confirmacao-audit.service').identidadeConfirmada(req),
                naturezaOperacao: perfilOperacao.naturezaOperacao || naturezaOperacao,
                cfopOverride: perfilOperacao.cfop,
                finalidade: perfilOperacao.finalidade,
                tipoOperacao: perfilOperacao.tipoOperacao,
                nfRef: perfilOperacao.nfRef,
                indicadorPresenca: perfilOperacao.indicadorPresenca,
                semCobranca: perfilOperacao.semCobranca,
                // transmitir=false grava a NF-e em 'pendente' para conferência antes do envio.
                transmitir: body.transmitir !== false,
                dadosManuais: {
                    formaPagamento: perfilOperacao.formaPagamento || String(body.forma_pagamento || '01'),
                    informacoesAdicionais: String(body.informacoes_adicionais || ''),
                    destinatario: {
                        clienteId: Number(dest.clienteId) || null,
                        nome: String(dest.nome || '').trim(),
                        tipoDocumento: documento.length === 11 ? 'CPF' : 'CNPJ',
                        documento,
                        ie: String(dest.ie || '').trim(),
                        contribuinteICMS: dest.contribuinteICMS === true,
                        consumidorFinal: dest.consumidorFinal !== false,
                        endereco: String(dest.endereco || dest.logradouro || '').trim(),
                        numero: String(dest.numero || '').trim(),
                        complemento: String(dest.complemento || '').trim(),
                        bairro: String(dest.bairro || '').trim(),
                        municipio: String(dest.municipio || '').trim(),
                        codigoMunicipio: digitos(dest.codigoMunicipio),
                        uf: String(dest.uf || '').trim().toUpperCase(),
                        cep: digitos(dest.cep),
                        telefone: digitos(dest.telefone),
                        email: String(dest.email || '').trim()
                    }
                }
            });

            return res.json({
                success: true,
                message: emissao.autorizado
                    ? `NF-e ${emissao.numero} autorizada pela SEFAZ.`
                    : (emissao.status === 'pendente'
                        ? `NF-e ${emissao.numero} gravada como pendente (não transmitida).`
                        : `NF-e ${emissao.numero} ${emissao.status}: ${emissao.motivo || 'sem motivo informado'}`),
                data: {
                    nfe_id: emissao.nfeId,
                    numero: emissao.numero,
                    serie: emissao.serie,
                    chave_acesso: emissao.chaveAcesso,
                    cfop: emissao.cfop,
                    valor_total: emissao.valorTotal,
                    autorizado: emissao.autorizado,
                    status: emissao.status,
                    protocolo: emissao.protocolo,
                    sefaz_codigo: emissao.codigoStatus,
                    sefaz_motivo: emissao.motivo,
                    pedido_id: null
                }
            });
        } catch (error) {
            console.error('[FATURAMENTO] Erro na emissão manual de NF-e:',
                error?.message || error, error?.stack || '');
            const msg = String(error?.message || '').toLowerCase();
            let statusCode = 500;
            let errorCode = 'GERAR_NFE_ERRO';
            if (error?.code === 'IBGE_PREFLIGHT') {
                statusCode = 400;
                errorCode = 'IBGE_PREFLIGHT';
            } else if (msg.includes('certificado') || msg.includes('pfx')) {
                statusCode = 401;
                errorCode = 'CERTIFICADO_INVALIDO';
            } else if (
                msg.includes('não encontrado') || msg.includes('nao encontrado') ||
                msg.includes('sem ncm') || msg.includes('inválid') || msg.includes('invalid') ||
                msg.includes('obrigatório') || msg.includes('obrigatorio')
            ) {
                statusCode = 400;
                errorCode = 'VALIDACAO_ERRO';
            }
            return res.status(statusCode).json({
                success: false,
                errorCode,
                message: mensagemSegura(error),
                nfe_id: error?.nfeId || null,
                chave_acesso: error?.chaveAcesso || null
            });
        }
    });

    // ============================================================
    // LISTAR NF-es
    // ============================================================

    // A tabela é criada sob demanda pelo serviço de faturamento parcial; numa instância
    // que nunca faturou parcial ela pode não existir, e a Listagem não pode quebrar por isso.
    let _temTabelaFatParciais = null;
    async function temTabelaFaturamentosParciais() {
        if (_temTabelaFatParciais === true) return true;
        try {
            const [cols] = await pool.query("SHOW COLUMNS FROM pedido_faturamentos LIKE 'nfe_erro'");
            _temTabelaFatParciais = cols.length > 0;
            if (!_temTabelaFatParciais) {
                await pool.query('ALTER TABLE pedido_faturamentos ADD COLUMN nfe_erro VARCHAR(500) NULL');
                _temTabelaFatParciais = true;
            }
        } catch (_) { _temTabelaFatParciais = false; }
        return _temTabelaFatParciais;
    }

    // pedidos.nfe_erro: motivo da última falha de emissão do faturamento integral
    // (gravado por POST /api/vendas/pedidos/:id/faturar).
    let _temNfeErroPedidos = null;
    async function temColunaNfeErroPedidos() {
        if (_temNfeErroPedidos === true) return true;
        try {
            const [cols] = await pool.query("SHOW COLUMNS FROM pedidos LIKE 'nfe_erro'");
            if (!cols.length) await pool.query('ALTER TABLE pedidos ADD COLUMN nfe_erro VARCHAR(500) NULL');
            _temNfeErroPedidos = true;
        } catch (_) { _temNfeErroPedidos = false; }
        return _temNfeErroPedidos;
    }

    router.get('/nfes', authenticateToken, async (req, res) => {
        try {
            await nfesColumnsReady;
            // BUG-FAT-012: sem query params a rota retornava 502 (query pesada + params
            // undefined). Defaults defensivos: strings vazias/whitespace são ignoradas
            // (não viram filtro), cliente_id só entra se inteiro, e o LIMIT é sempre
            // aplicado. A rota nunca deve derrubar o processo por ausência de filtros.
            const limpar = (v) => (typeof v === 'string' && v.trim() !== '') ? v.trim() : undefined;
            const status = limpar(req.query.status);
            const data_inicio = limpar(req.query.data_inicio);
            const data_fim = limpar(req.query.data_fim);
            const busca = limpar(req.query.busca);
            const chaveAcesso = limpar(req.query.chave_acesso);
            const numeroExato = limpar(req.query.numero);
            const clienteIdRaw = limpar(req.query.cliente_id);
            const cliente_id = clienteIdRaw && /^\d+$/.test(clienteIdRaw) ? clienteIdRaw : undefined;
            const limite = Math.min(Math.max(parseInt(req.query.limite) || 100, 1), 500);

            if (chaveAcesso && !/^\d{44}$/.test(chaveAcesso)) {
                return res.status(400).json({ success: false, message: 'Chave de acesso deve conter 44 dígitos.' });
            }
            if (numeroExato && !/^\d+$/.test(numeroExato)) {
                return res.status(400).json({ success: false, message: 'Número da NF-e inválido.' });
            }

            // UNION: NF-es formais (tabela nfes) + Pedidos faturados sem NF-e formal
            let query = `
                SELECT * FROM (
                    SELECT
                        n.id,
                        'nfe' COLLATE utf8mb4_general_ci as origem,
                        n.numero COLLATE utf8mb4_general_ci as numero,
                        COALESCE(n.serie, 1) as serie,
                        n.cliente_id,
                        COALESCE(n.destinatario_nome, c.nome) COLLATE utf8mb4_general_ci as cliente_nome,
                        COALESCE(n.destinatario_nome, c.nome) COLLATE utf8mb4_general_ci as destinatario,
                        COALESCE(n.valor_total, 0) as valor,
                        CASE
                            WHEN n.status COLLATE utf8mb4_general_ci = 'autorizada'
                                 AND (n.chave_acesso IS NULL OR n.chave_acesso = ''
                                      OR n.protocolo_autorizacao IS NULL OR n.protocolo_autorizacao = '')
                            THEN 'pendente'
                            ELSE n.status COLLATE utf8mb4_general_ci
                        END as status,
                        n.data_emissao,
                        n.natureza_operacao COLLATE utf8mb4_general_ci as observacoes,
                        n.chave_acesso COLLATE utf8mb4_general_ci as chave_acesso,
                        n.protocolo_autorizacao COLLATE utf8mb4_general_ci as protocolo,
                        n.sefaz_codigo_status COLLATE utf8mb4_general_ci as sefaz_codigo_status,
                        n.sefaz_motivo COLLATE utf8mb4_general_ci as sefaz_motivo,
                        n.sefaz_data_retorno,
                        n.sefaz_ambiente COLLATE utf8mb4_general_ci as sefaz_ambiente,
                        n.sefaz_tipo_retorno COLLATE utf8mb4_general_ci as sefaz_tipo_retorno,
                        n.pedido_id,
                        (SELECT MAX(ne.sequencia)
                           FROM nfe_eventos ne
                          WHERE ne.nfe_id = n.id
                            AND ne.tipo_evento = '110110'
                            AND ne.status = 'registrado') AS cce_sequencia
                    FROM nfes n
                    LEFT JOIN clientes c ON n.cliente_id = c.id

                    UNION ALL

                    SELECT
                        p.id,
                        'pedido' as origem,
                        COALESCE(p.numero_nf, LPAD(p.id, 9, '0')) as numero,
                        1 as serie,
                        p.cliente_id,
                        COALESCE(p.cliente_nome, c.nome) as cliente_nome,
                        COALESCE(p.cliente_nome, c.nome) as destinatario,
                        COALESCE(p.valor, 0) as valor,
                        CASE WHEN p.nfe_chave IS NOT NULL AND p.nfe_chave <> '' AND p.nfe_protocolo IS NOT NULL AND p.nfe_protocolo <> '' THEN 'autorizada'
                             ${await temColunaNfeErroPedidos() ? "WHEN p.nfe_erro IS NOT NULL AND p.nfe_erro <> '' THEN 'erro'" : ''}
                             ELSE 'pendente' END as status,
                        COALESCE(p.data_faturamento, p.created_at) as data_emissao,
                        'VENDA DE MERCADORIA' as observacoes,
                        p.nfe_chave as chave_acesso,
                        p.nfe_protocolo as protocolo,
                        NULL as sefaz_codigo_status,
                        ${await temColunaNfeErroPedidos() ? 'p.nfe_erro' : 'NULL'} as sefaz_motivo,
                        NULL as sefaz_data_retorno,
                        NULL as sefaz_ambiente,
                        NULL as sefaz_tipo_retorno,
                        p.id as pedido_id,
                        NULL as cce_sequencia
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    WHERE p.status = 'faturado'
                      AND p.id NOT IN (SELECT COALESCE(pedido_id, 0) FROM nfes WHERE pedido_id IS NOT NULL)
                    ${await temTabelaFaturamentosParciais() ? `
                    UNION ALL

                    -- Faturamentos (parcial/F9/remessa) com NF-e solicitada que não tem nota
                    -- válida: a emissão falhou antes de numerar (preflight, cadastro) ou a nota
                    -- foi cancelada/inutilizada. Antes eles não apareciam em lugar nenhum — o
                    -- pedido ficava "faturado" sem NF-e (pedido 3663 da IM, 24/09/2026).
                    SELECT
                        pf.id,
                        'faturamento' as origem,
                        COALESCE(pf.nfe_numero, '') COLLATE utf8mb4_general_ci as numero,
                        1 as serie,
                        p.cliente_id,
                        COALESCE(p.cliente_nome, c.nome) COLLATE utf8mb4_general_ci as cliente_nome,
                        COALESCE(p.cliente_nome, c.nome) COLLATE utf8mb4_general_ci as destinatario,
                        COALESCE(pf.valor, 0) as valor,
                        'erro' as status,
                        pf.created_at as data_emissao,
                        CONCAT(CASE WHEN pf.tipo = 'remessa' THEN 'Remessa' ELSE 'Faturamento' END,
                               ' ', TRIM(TRAILING '.00' FROM pf.percentual), '% do pedido — NF-e não emitida')
                            COLLATE utf8mb4_general_ci as observacoes,
                        NULL as chave_acesso,
                        NULL as protocolo,
                        NULL as sefaz_codigo_status,
                        COALESCE(pf.nfe_erro, 'Emissão da NF-e não concluída — corrija o cadastro e reemita.')
                            COLLATE utf8mb4_general_ci as sefaz_motivo,
                        NULL as sefaz_data_retorno,
                        NULL as sefaz_ambiente,
                        NULL as sefaz_tipo_retorno,
                        pf.pedido_id,
                        NULL as cce_sequencia
                    FROM pedido_faturamentos pf
                    JOIN pedidos p ON p.id = pf.pedido_id
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    WHERE pf.gerar_nfe_solicitado = 1
                      AND COALESCE(pf.nfe_emitida, 0) = 0
                      AND COALESCE(pf.status, 'ativo') = 'ativo'
                      AND COALESCE(pf.nfe_status, 'pendente') NOT IN ('autorizada', 'cancelada')
                      AND NOT EXISTS (
                          SELECT 1 FROM nfes n2
                           WHERE n2.pedido_id = pf.pedido_id
                             AND n2.numero = pf.nfe_numero
                             AND LOWER(COALESCE(n2.status, '')) NOT IN ('cancelada', 'inutilizada')
                      )` : ''}
                ) AS unificado
                WHERE 1=1
            `;

            const params = [];

            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }

            if (data_inicio) {
                query += ' AND DATE(data_emissao) >= ?';
                params.push(data_inicio);
            }

            if (data_fim) {
                query += ' AND DATE(data_emissao) <= ?';
                params.push(data_fim);
            }

            if (cliente_id) {
                query += ' AND cliente_id = ?';
                params.push(cliente_id);
            }

            // Filtros exatos usados pela tela de Eventos. Antes estes parâmetros eram
            // ignorados; uma busca por chave podia devolver a primeira nota do LIMIT,
            // criando risco de cancelamento/CC-e no documento errado.
            if (chaveAcesso) {
                query += ' AND chave_acesso = ?';
                params.push(chaveAcesso);
            }

            if (numeroExato) {
                query += ' AND CAST(numero AS UNSIGNED) = ?';
                params.push(Number(numeroExato));
            }

            if (busca) {
                query += ' AND (cliente_nome LIKE ? OR numero LIKE ? OR destinatario LIKE ?)';
                const term = `%${busca}%`;
                params.push(term, term, term);
            }

            query += ' ORDER BY data_emissao DESC LIMIT ?';
            params.push(limite);

            const [nfes] = await pool.query(query, params);

            res.json({
                success: true,
                data: nfes
            });

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao listar NF-es:', error);
            res.status(500).json({
                success: false,
                message: mensagemSegura(error)
            });
        }
    });

    // ============================================================
    // DOCUMENTOS DE NF-e EM LOTE
    // ============================================================

    router.post('/nfes/documentos-lote', authenticateToken, async (req, res) => {
        try {
            const idsRecebidos = Array.isArray(req.body?.ids) ? req.body.ids : [];
            const ids = [...new Set(idsRecebidos.map(Number))]
                .filter(id => Number.isSafeInteger(id) && id > 0);
            const tipo = String(req.body?.tipo || 'xml').toLowerCase();

            if (!ids.length) {
                return res.status(400).json({ success: false, message: 'Selecione ao menos uma NF-e.' });
            }
            if (ids.length > 25) {
                return res.status(400).json({ success: false, message: 'Baixe no máximo 25 NF-e por vez.' });
            }
            if (!['xml', 'danfe', 'ambos'].includes(tipo)) {
                return res.status(400).json({ success: false, message: 'Tipo de documento inválido.' });
            }

            await nfesColumnsReady;
            const placeholders = ids.map(() => '?').join(',');
            const [rows] = await pool.query(
                `SELECT id, numero, status, chave_acesso, protocolo_autorizacao,
                        xml_nfe, xml_assinado, xml_protocolo
                   FROM nfes WHERE id IN (${placeholders})`,
                ids
            );
            const porId = new Map(rows.map(nfe => [Number(nfe.id), nfe]));
            const arquivos = [];
            const falhas = [];
            const nomeSeguro = valor => String(valor || '')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'sem-numero';

            for (const id of ids) {
                const nfe = porId.get(id);
                if (!nfe) {
                    falhas.push(`ID ${id}: NF-e não encontrada.`);
                    continue;
                }
                const numero = nomeSeguro(nfe.numero || id);

                if (tipo === 'xml' || tipo === 'ambos') {
                    const nfeAssinada = (String(nfe.xml_assinado || '').match(/<NFe[\s>][\s\S]*<\/NFe>/) || [])[0];
                    const protocolo = (String(nfe.xml_protocolo || '').match(/<protNFe[\s\S]*?<\/protNFe>/) || [])[0];
                    const nfeProc = nfeAssinada && protocolo
                        ? '<?xml version="1.0" encoding="UTF-8"?>'
                          + '<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">'
                          + nfeAssinada + protocolo + '</nfeProc>'
                        : null;
                    const xml = nfeProc || nfe.xml_assinado || nfe.xml_nfe;
                    if (xml) {
                        const chave = String(nfe.chave_acesso || '').replace(/\D/g, '');
                        arquivos.push({ nome: `XML/${chave || `nfe_${numero}`}.xml`, conteudo: xml });
                    } else {
                        falhas.push(`NF-e ${nfe.numero || id}: XML não disponível.`);
                    }
                }

                if (tipo === 'danfe' || tipo === 'ambos') {
                    if (!podeGerarDanfe(nfe)) {
                        falhas.push(`NF-e ${nfe.numero || id}: DANFE indisponível; nota sem autorização válida.`);
                    } else {
                        try {
                            const { montarDanfeNfe } = require(path.resolve(__dirname, '../../../services/danfe-nfe-document.service'));
                            const { htmlParaPdf } = require(path.resolve(__dirname, '../../../services/pdf-render.service'));
                            const { html } = await montarDanfeNfe(pool, id);
                            const pdf = await htmlParaPdf(html);
                            arquivos.push({ nome: `DANFE/NF_${numero}.pdf`, conteudo: pdf });
                        } catch (error) {
                            console.warn(`[FATURAMENTO] DANFE em lote indisponível para NF-e ${id}:`, error.message);
                            falhas.push(`NF-e ${nfe.numero || id}: falha ao gerar DANFE.`);
                        }
                    }
                }
            }

            if (!arquivos.length) {
                return res.status(422).json({
                    success: false,
                    message: falhas[0] || 'Nenhum documento disponível para as NF-e selecionadas.',
                    detalhes: falhas
                });
            }

            if (falhas.length) {
                arquivos.push({
                    nome: 'LEIA-ME-resultados.txt',
                    conteudo: 'Alguns documentos não foram incluídos:\r\n\r\n' + falhas.join('\r\n') + '\r\n'
                });
            }

            const data = new Date().toISOString().slice(0, 10);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="documentos-nfe-${data}.zip"`);
            res.setHeader('X-Zyntra-Arquivos', String(arquivos.length - (falhas.length ? 1 : 0)));
            res.setHeader('X-Zyntra-Falhas', String(falhas.length));
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Zyntra-Arquivos, X-Zyntra-Falhas');

            const archive = archiver('zip', { zlib: { level: 6 } });
            archive.on('warning', error => console.warn('[FATURAMENTO] Aviso no ZIP de NF-e:', error.message));
            archive.on('error', error => {
                console.error('[FATURAMENTO] Erro no ZIP de NF-e:', error.message);
                if (!res.headersSent) res.status(500).end();
                else res.destroy(error);
            });
            archive.pipe(res);
            arquivos.forEach(arquivo => archive.append(arquivo.conteudo, { name: arquivo.nome }));
            await archive.finalize();
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao baixar documentos em lote:', error);
            if (!res.headersSent) res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // CONTRATOS — base para os relatórios gerenciais de Contratos
    // (Ativos, A Vencer, Vencidos, Receita, por Cliente)
    // ============================================================

    // Garante que a tabela exista antes de qualquer operação.
    let _contratosTabelaPronta = false;
    async function ensureContratosTable() {
        if (_contratosTabelaPronta) return;
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contratos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                numero VARCHAR(50),
                cliente_id INT NULL,
                cliente_nome VARCHAR(255),
                descricao VARCHAR(255),
                valor DECIMAL(15,2) NOT NULL DEFAULT 0,
                periodicidade VARCHAR(20) NOT NULL DEFAULT 'mensal',
                data_inicio DATE NULL,
                data_fim DATE NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'ativo',
                observacoes TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_contratos_cliente (cliente_id),
                INDEX idx_contratos_status (status),
                INDEX idx_contratos_data_fim (data_fim)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        _contratosTabelaPronta = true;
    }

    // LISTAR contratos — usado pelos 5 relatórios (agregação feita no front).
    // Filtros opcionais: status, cliente_id, busca, data_inicio/data_fim (vigência).
    router.get('/contratos', authenticateToken, async (req, res) => {
        try {
            await ensureContratosTable();
            const { status, cliente_id, busca, data_inicio, data_fim } = req.query;

            let query = `
                SELECT
                    ct.id, ct.numero, ct.cliente_id,
                    COALESCE(ct.cliente_nome, c.nome) AS cliente_nome,
                    ct.descricao, ct.valor, ct.periodicidade,
                    ct.data_inicio, ct.data_fim, ct.status, ct.observacoes,
                    ct.created_at
                FROM contratos ct
                LEFT JOIN clientes c ON ct.cliente_id = c.id
                WHERE 1=1
            `;
            const params = [];

            if (status) { query += ' AND ct.status = ?'; params.push(status); }
            if (cliente_id) { query += ' AND ct.cliente_id = ?'; params.push(cliente_id); }
            if (data_inicio) { query += ' AND (ct.data_fim IS NULL OR ct.data_fim >= ?)'; params.push(data_inicio); }
            if (data_fim) { query += ' AND (ct.data_inicio IS NULL OR ct.data_inicio <= ?)'; params.push(data_fim); }
            if (busca) {
                query += ' AND (COALESCE(ct.cliente_nome, c.nome) LIKE ? OR ct.numero LIKE ? OR ct.descricao LIKE ?)';
                const term = `%${busca}%`;
                params.push(term, term, term);
            }

            query += ' ORDER BY ct.data_fim IS NULL, ct.data_fim ASC, ct.id DESC';

            const [contratos] = await pool.query(query, params);
            res.json({ success: true, data: contratos });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao listar contratos:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // CRIAR contrato
    router.post('/contratos', authenticateToken, async (req, res) => {
        try {
            await ensureContratosTable();
            const {
                numero, cliente_id, cliente_nome, descricao,
                valor, periodicidade, data_inicio, data_fim, status, observacoes
            } = req.body || {};

            const [result] = await pool.query(
                `INSERT INTO contratos
                    (numero, cliente_id, cliente_nome, descricao, valor, periodicidade, data_inicio, data_fim, status, observacoes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    numero || null,
                    cliente_id || null,
                    cliente_nome || null,
                    descricao || null,
                    Number(valor) || 0,
                    periodicidade || 'mensal',
                    data_inicio || null,
                    data_fim || null,
                    status || 'ativo',
                    observacoes || null
                ]
            );
            res.status(201).json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao criar contrato:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ATUALIZAR contrato
    router.put('/contratos/:id', authenticateToken, async (req, res) => {
        try {
            await ensureContratosTable();
            const campos = [];
            const valores = [];
            const permitidos = ['numero', 'cliente_id', 'cliente_nome', 'descricao', 'valor', 'periodicidade', 'data_inicio', 'data_fim', 'status', 'observacoes'];
            for (const campo of permitidos) {
                if (req.body && req.body[campo] !== undefined) {
                    campos.push(`${campo} = ?`);
                    valores.push(req.body[campo] === '' ? null : req.body[campo]);
                }
            }
            if (!campos.length) {
                return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
            }
            valores.push(req.params.id);
            await pool.query(`UPDATE contratos SET ${campos.join(', ')} WHERE id = ?`, valores);
            res.json({ success: true });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao atualizar contrato:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // EXCLUIR contrato
    router.delete('/contratos/:id', authenticateToken, async (req, res) => {
        try {
            await ensureContratosTable();
            await pool.query('DELETE FROM contratos WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao excluir contrato:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // DETALHES DA NF-e
    // ============================================================

    router.get('/nfes/:id', authenticateToken, async (req, res) => {
        const inicioConsulta = Date.now();
        try {
            await nfesColumnsReady;
            const { id } = req.params;
            const origem = req.query.origem || 'nfe';
            res.set('Cache-Control', 'private, no-store');

            // Se origem=pedido, buscar dados do pedido faturado
            if (origem === 'pedido') {
                const [pedidos] = await consultarDetalheNfe(`
                    SELECT
                        p.id,
                        'pedido' as origem,
                        COALESCE(p.numero_nf, LPAD(p.id, 9, '0')) as numero,
                        1 as serie,
                        p.cliente_id,
                        COALESCE(p.cliente_nome, c.nome) as cliente_nome,
                        COALESCE(p.cliente_nome, c.nome) as destinatario,
                        COALESCE(c.cnpj, c.cpf, '') as destinatario_cnpj_cpf,
                        COALESCE(p.valor, 0) as valor_total,
                        COALESCE(p.valor, 0) as valor,
                        CASE
                            WHEN p.nfe_chave IS NOT NULL AND p.nfe_chave <> '' AND p.nfe_protocolo IS NOT NULL AND p.nfe_protocolo <> '' THEN 'autorizada'
                            ${await temColunaNfeErroPedidos() ? "WHEN p.nfe_erro IS NOT NULL AND p.nfe_erro <> '' THEN 'erro'" : ''}
                            ELSE 'pendente'
                        END as status,
                        COALESCE(p.data_faturamento, p.created_at) as data_emissao,
                        'VENDA DE MERCADORIA' as natureza_operacao,
                        p.nfe_chave as chave_acesso,
                        p.nfe_protocolo as protocolo,
                        NULL as sefaz_codigo_status,
                        ${await temColunaNfeErroPedidos() ? 'p.nfe_erro' : 'NULL'} as sefaz_motivo,
                        NULL as sefaz_data_retorno,
                        NULL as sefaz_ambiente,
                        'emissao' as sefaz_tipo_retorno,
                        p.observacao as observacoes,
                        c.email as cliente_email,
                        p.id as pedido_id
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    WHERE p.id = ? AND p.status = 'faturado'
                `, [id]);

                if (pedidos.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: 'Pedido faturado não encontrado'
                    });
                }

                // Buscar itens do pedido
                const [itens] = await consultarDetalheNfe(`
                    SELECT
                        pi.id,
                        pi.descricao as descricao,
                        COALESCE(pr.descricao, pi.descricao) as produto_nome,
                        pi.quantidade,
                        pi.preco_unitario as valor_unitario,
                        pi.subtotal as valor_total,
                        pi.codigo,
                        pi.unidade,
                        pi.cfop
                    FROM pedido_itens pi
                    LEFT JOIN produtos pr ON pi.produto_id = pr.id
                    WHERE pi.pedido_id = ?
                `, [id]);

                res.set('Server-Timing', `nfe-detail;dur=${Date.now() - inicioConsulta}`);
                const pedidoDetalhe = pedidos[0];
                pedidoDetalhe.natureza_operacao = resolverNaturezaOperacao(
                    itens.map(item => item.cfop), pedidoDetalhe.natureza_operacao
                );
                return res.json({
                    success: true,
                    data: {
                        ...pedidoDetalhe,
                        itens
                    }
                });
            }

            // Busca padrão na tabela nfes
            // Não transportar XML assinado/protocolado para um modal que não os usa.
            // Além de reduzir a resposta, isso evita serialização e compressão de LONGTEXT
            // no caminho crítico de quem precisa editar e faturar.
            const [nfes] = await consultarDetalheNfe(`
                SELECT
                    n.id, n.numero, n.serie, n.cliente_id, n.pedido_id,
                    n.destinatario_nome, n.destinatario_cnpj_cpf,
                    n.valor_total, n.status, n.data_emissao, n.natureza_operacao,
                    n.chave_acesso, n.protocolo_autorizacao,
                    NULL AS observacoes,
                    n.sefaz_codigo_status, n.sefaz_motivo, n.sefaz_data_retorno,
                    n.sefaz_ambiente, n.sefaz_tipo_retorno,
                    'nfe' as origem,
                    n.destinatario_nome as cliente_nome,
                    c.email as cliente_email
                FROM nfes n
                LEFT JOIN clientes c ON n.cliente_id = c.id
                WHERE n.id = ?
            `, [id]);

            if (nfes.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'NF-e não encontrada'
                });
            }

            const [itens] = await consultarDetalheNfe(`
                SELECT id, produto_id, descricao, quantidade, unidade,
                       valor_unitario, valor_total
                  FROM nfe_itens
                 WHERE nfe_id = ?
                 ORDER BY id
            `, [id]);

            // FISC: NF-e só é "autorizada" com chave de acesso + protocolo reais.
            // Registros legados/importados sem esses dados não podem exibir status autorizado.
            const nfeRow = nfes[0];
            if (nfeRow && String(nfeRow.status || '').toLowerCase() === 'autorizada'
                && (!nfeRow.chave_acesso || !nfeRow.protocolo_autorizacao)) {
                nfeRow.status = 'pendente';
            }

            res.set('Server-Timing', `nfe-detail;dur=${Date.now() - inicioConsulta}`);
            res.json({
                success: true,
                data: {
                    ...nfeRow,
                    itens
                }
            });

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao buscar NF-e:', error);
            res.status(500).json({
                success: false,
                message: mensagemSegura(error)
            });
        }
    });

    // ============================================================
    // ATUALIZAR NF-e (PUT)
    // ============================================================

    router.put('/nfes/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const usuario_id = req.user.id;

            // Verificar se NF-e existe (BUG-FAT-003: coluna correta é protocolo_autorizacao)
            const [[nfeExistente]] = await pool.query('SELECT id, status, chave_acesso, protocolo_autorizacao FROM nfes WHERE id = ?', [id]);
            if (!nfeExistente) {
                return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            }

            // BUG-FAT-003 (imutabilidade fiscal): NF-e autorizada pela SEFAZ ou cancelada é um
            // documento fiscal imutável — correções exigem Carta de Correção (CC-e) ou
            // cancelamento, nunca edição direta do registro.
            const statusAtualNfe = String(nfeExistente.status || '').toLowerCase().trim();
            if (['autorizada', 'cancelada'].includes(statusAtualNfe)) {
                return res.status(409).json({
                    success: false,
                    code: 'NFE_IMUTAVEL',
                    message: statusAtualNfe === 'autorizada'
                        ? 'NF-e autorizada pela SEFAZ não pode ser editada. Use a Carta de Correção (CC-e) para corrigir dados acessórios ou o cancelamento (até 24h) para desfazer a emissão.'
                        : 'NF-e cancelada não pode ser editada.'
                });
            }

            const {
                numero, serie, cliente_id,
                valor_total, status, data_emissao,
                natureza_operacao, chave_acesso, destinatario_nome,
                observacoes, protocolo,
                // Campos do quadro DESTINATÁRIO e do CÁLCULO DO IMPOSTO da DANFE, que o modal
                // passou a oferecer. Todos já tinham coluna em `nfes` e simplesmente não eram
                // aceitos aqui — dava para editá-los em nenhum lugar do sistema.
                destinatario_cnpj_cpf, destinatario_endereco, destinatario_cidade,
                destinatario_uf, destinatario_cep, cfop,
                valor_produtos, base_calculo_icms, valor_icms, valor_ipi,
                valor_pis, valor_cofins, valor_frete, valor_desconto
            } = req.body;

            // FISC-003: status 'autorizada' só pode ser definido via SEFAZ (rota /enviar-sefaz),
            // que grava chave_acesso e protocolo_autorizacao reais. Editar manualmente para 'autorizada'
            // sem esses dados cria NF-e "autorizada" sem respaldo fiscal (chave/protocolo ausentes).
            if (status === 'autorizada' && nfeExistente.status !== 'autorizada') {
                const chaveFinal = chave_acesso !== undefined ? chave_acesso : nfeExistente.chave_acesso;
                const protocoloFinal = protocolo !== undefined ? protocolo : nfeExistente.protocolo_autorizacao;
                if (!chaveFinal || !protocoloFinal) {
                    return res.status(400).json({
                        success: false,
                        message: 'NF-e não pode ser marcada como "autorizada" manualmente sem chave de acesso e protocolo de autorização. Use o envio à SEFAZ.'
                    });
                }
            }

            const campos = [];
            const valores = [];

            if (numero !== undefined) { campos.push('numero = ?'); valores.push(numero); }
            if (serie !== undefined) { campos.push('serie = ?'); valores.push(serie); }
            if (destinatario_nome !== undefined) { campos.push('destinatario_nome = ?'); valores.push(destinatario_nome); }
            if (cliente_id !== undefined) { campos.push('cliente_id = ?'); valores.push(cliente_id); }
            if (valor_total !== undefined) { campos.push('valor_total = ?'); valores.push(valor_total); }
            if (status !== undefined) { campos.push('status = ?'); valores.push(status); }
            if (data_emissao !== undefined) { campos.push('data_emissao = ?'); valores.push(data_emissao); }
            if (natureza_operacao !== undefined) { campos.push('natureza_operacao = ?'); valores.push(natureza_operacao); }
            if (chave_acesso !== undefined) { campos.push('chave_acesso = ?'); valores.push(chave_acesso); }
            if (observacoes !== undefined) { campos.push('observacoes = ?'); valores.push(observacoes); }
            if (protocolo !== undefined) { campos.push('protocolo_autorizacao = ?'); valores.push(protocolo); }

            // Destinatário e totais. Mesmo padrão `!== undefined` das linhas acima: campo que o
            // front não mandou não entra no UPDATE e o valor do banco fica intacto.
            const _dig = (v) => String(v == null ? '' : v).replace(/\D/g, '');
            const _num = (v) => {
                const n = parseFloat(String(v).replace(',', '.'));
                return Number.isFinite(n) ? n : 0;
            };
            if (destinatario_cnpj_cpf !== undefined) { campos.push('destinatario_cnpj_cpf = ?'); valores.push(_dig(destinatario_cnpj_cpf) || null); }
            if (destinatario_endereco !== undefined) { campos.push('destinatario_endereco = ?'); valores.push(destinatario_endereco); }
            if (destinatario_cidade !== undefined) { campos.push('destinatario_cidade = ?'); valores.push(destinatario_cidade); }
            // UF sempre em 2 letras maiúsculas: a DANFE e o XML não aceitam "sp" nem "São Paulo".
            if (destinatario_uf !== undefined) { campos.push('destinatario_uf = ?'); valores.push(String(destinatario_uf || '').toUpperCase().slice(0, 2) || null); }
            if (destinatario_cep !== undefined) { campos.push('destinatario_cep = ?'); valores.push(_dig(destinatario_cep) || null); }
            if (cfop !== undefined) { campos.push('cfop = ?'); valores.push(_dig(cfop) || null); }
            if (valor_produtos !== undefined) { campos.push('valor_produtos = ?'); valores.push(_num(valor_produtos)); }
            if (base_calculo_icms !== undefined) { campos.push('base_calculo_icms = ?'); valores.push(_num(base_calculo_icms)); }
            if (valor_icms !== undefined) { campos.push('valor_icms = ?'); valores.push(_num(valor_icms)); }
            if (valor_ipi !== undefined) { campos.push('valor_ipi = ?'); valores.push(_num(valor_ipi)); }
            if (valor_pis !== undefined) { campos.push('valor_pis = ?'); valores.push(_num(valor_pis)); }
            if (valor_cofins !== undefined) { campos.push('valor_cofins = ?'); valores.push(_num(valor_cofins)); }
            if (valor_frete !== undefined) { campos.push('valor_frete = ?'); valores.push(_num(valor_frete)); }
            if (valor_desconto !== undefined) { campos.push('valor_desconto = ?'); valores.push(_num(valor_desconto)); }

            // Descarta campos que não existem nesta base antes de montar o UPDATE.
            // Sem isso, UM campo ausente derruba o salvamento INTEIRO com 500: era o que
            // acontecia com `observacoes` (a tela sempre manda, a coluna não existia), e
            // o efeito prático é que nenhuma edição de NF-e persistia — nem as que só
            // mexiam em campos válidos. As bases das 4 instâncias divergem em coluna, então
            // filtrar pelo schema real é mais seguro que confiar na lista do código.
            let camposFinais = campos;
            let valoresFinais = valores;
            try {
                const [colunasNfes] = await pool.query(
                    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nfes'`
                );
                const existentes = new Set((colunasNfes || []).map(c => c.COLUMN_NAME));
                const ignorados = [];
                camposFinais = [];
                valoresFinais = [];
                campos.forEach((expr, i) => {
                    const coluna = String(expr).split('=')[0].trim();
                    if (existentes.has(coluna)) {
                        camposFinais.push(expr);
                        valoresFinais.push(valores[i]);
                    } else {
                        ignorados.push(coluna);
                    }
                });
                if (ignorados.length) {
                    console.warn(`[FATURAMENTO] NF-e ${id}: coluna(s) inexistente(s) nesta base ignorada(s) no UPDATE: ${ignorados.join(', ')}`);
                }
            } catch (errSchema) {
                // Não conseguiu ler o schema: segue com a lista original (comportamento antigo).
                console.warn('[FATURAMENTO] Não foi possível validar as colunas de nfes:', errSchema.code || errSchema.message);
            }

            if (camposFinais.length === 0) {
                return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
            }

            valoresFinais.push(id);
            await pool.query(`UPDATE nfes SET ${camposFinais.join(', ')} WHERE id = ?`, valoresFinais);

            // Audit trail
            if (typeof logAuditEvent === 'function') {
                logAuditEvent(pool, {
                    usuario_id,
                    acao: 'EDITAR_NFE',
                    recurso: 'nfe',
                    recurso_id: id,
                    detalhes: `NF-e ${nfeExistente.id} editada`
                });
            }

            console.log(`[FATURAMENTO] NF-e ${id} atualizada por usuário ${usuario_id}`);
            res.json({ success: true, message: 'NF-e atualizada com sucesso' });

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao atualizar NF-e:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // EXCLUIR NF-e (DELETE)
    // ============================================================

    router.delete('/nfes/:id', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { id } = req.params;
            const usuario_id = req.user.id;

            const [[nfe]] = await connection.query('SELECT id, numero, status FROM nfes WHERE id = ?', [id]);
            if (!nfe) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            }

            // Não permitir excluir NF-e autorizada
            if (nfe.status === 'autorizada') {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'NF-e autorizada não pode ser excluída. Utilize o cancelamento.' });
            }

            // Excluir itens e depois a NF-e
            await connection.query('DELETE FROM nfe_itens WHERE nfe_id = ?', [id]);
            await connection.query('DELETE FROM nfes WHERE id = ?', [id]);

            await connection.commit();

            if (typeof logAuditEvent === 'function') {
                logAuditEvent(pool, {
                    usuario_id,
                    acao: 'EXCLUIR_NFE',
                    recurso: 'nfe',
                    recurso_id: id,
                    detalhes: `NF-e ${nfe.numero || id} excluída`
                });
            }

            console.log(`[FATURAMENTO] NF-e ${id} excluída por usuário ${usuario_id}`);
            res.json({ success: true, message: 'NF-e excluída com sucesso' });

        } catch (error) {
            await connection.rollback();
            console.error('[FATURAMENTO] Erro ao excluir NF-e:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // EVENTOS DA NF-e (histórico: emissão, autorização, cancelamento, CC-e)
    // ============================================================

    router.get('/nfes/:id/eventos', authenticateToken, async (req, res) => {
        try {
            await Promise.all([nfesColumnsReady, nfeEventosColumnsReady]);
            const { id } = req.params;
            const [[nfe]] = await pool.query(
                `SELECT id, numero, status, data_emissao, created_at,
                        data_autorizacao, protocolo_autorizacao,
                        data_cancelamento, motivo_cancelamento
                   FROM nfes WHERE id = ?`,
                [id]
            );
            if (!nfe) return res.status(404).json({ success: false, message: 'NF-e não encontrada' });

            const eventos = [];

            // Evento de emissão
            eventos.push({ tipo: 'Emissão', codigo: 'emissao', data: nfe.data_emissao || nfe.created_at, descricao: `NF-e ${nfe.numero} emitida`, protocolo: null });

            // Evento de autorização SEFAZ
            if (nfe.data_autorizacao) {
                eventos.push({ tipo: 'Autorização SEFAZ', codigo: 'autorizacao', data: nfe.data_autorizacao, descricao: 'NF-e autorizada', protocolo: nfe.protocolo_autorizacao || null });
            }

            // Eventos registrados (CC-e, cancelamento eletrônico, etc.)
            const [rows] = await pool.query(
                `SELECT id, tipo_evento AS codigo, sequencia, status,
                        CASE tipo_evento
                            WHEN '110110' THEN 'Carta de Correção (CC-e)'
                            WHEN '110111' THEN 'Cancelamento'
                            ELSE tipo_evento
                        END AS tipo,
                        COALESCE(data_evento, created_at) AS data, descricao, protocolo
                 FROM nfe_eventos WHERE nfe_id = ? ORDER BY data ASC`,
                [id]
            );
            rows.forEach(r => eventos.push(r));

            // Compatibilidade com cancelamentos legados que não possuem linha em nfe_eventos.
            if (nfe.status === 'cancelada' && nfe.data_cancelamento && !rows.some(r => r.codigo === '110111')) {
                eventos.push({ tipo: 'Cancelamento', codigo: '110111', data: nfe.data_cancelamento, descricao: nfe.motivo_cancelamento || 'NF-e cancelada', protocolo: null });
            }

            eventos.sort((a, b) => new Date(a.data) - new Date(b.data));
            res.json({ success: true, data: eventos });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao buscar eventos:', error);
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [] });
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // Log de não repúdio do envio à SEFAZ: quem confirmou, categoria, horário e hash do XML.
    router.get('/nfes/:id/confirmacoes', authenticateToken, async (req, res) => {
        try {
            if (!await FiscalAccessService.podeReemitirNfe(pool, req.user)) {
                return res.status(403).json({ success: false, errorCode: 'RBAC_DENIED', message: 'Permissão insuficiente para consultar o log de emissão.' });
            }
            const dados = await require('../../../services/nfe-confirmacao-audit.service')
                .listarPorNfe(pool, req.params.id, req.user?.empresa_id || 1);
            res.json({ success: true, data: dados });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao listar confirmações de emissão:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // Integridade do log de não repúdio — só administrador.
    const ehAdminFiscal = (req) => ['admin', 'administrador', 'superadmin']
        .includes(String(req.user?.role || req.user?.cargo || '').toLowerCase());
    const negarNaoAdmin = (res) => res.status(403).json({ success: false, errorCode: 'RBAC_DENIED', message: 'Apenas administradores podem consultar a integridade do log.' });

    // Recalcula a cadeia de hashes, as âncoras e o espelho (detecta linha apagada ou alterada).
    router.get('/confirmacoes/verificar-cadeia', authenticateToken, async (req, res) => {
        try {
            if (!ehAdminFiscal(req)) return negarNaoAdmin(res);
            const r = await require('../../../services/nfe-confirmacao-audit.service')
                .verificarCadeia(pool, req.user?.empresa_id || 1);
            res.json({ success: true, ...r });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao verificar cadeia do log de emissão:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // Resumo enxuto para a faixa de alerta da tela (cache de 60 s: a verificação relê a tabela).
    const statusLogFiscalCache = new Map();
    router.get('/confirmacoes/status', authenticateToken, async (req, res) => {
        try {
            if (!ehAdminFiscal(req)) return negarNaoAdmin(res);
            const empresa = Number(req.user?.empresa_id) || 1;
            const em_cache = statusLogFiscalCache.get(empresa);
            if (em_cache && Date.now() - em_cache.ts < 60000) return res.json({ success: true, ...em_cache.dados });
            const r = await require('../../../services/nfe-confirmacao-audit.service').verificarCadeia(pool, empresa);
            const dados = {
                integra: r.integra, motivo: r.motivo, primeiroInvalidoId: r.primeiroInvalidoId, registros: r.registros,
                chave: r.chave, protecaoBanco: r.protecaoBanco,
                ancora: r.ancora && { existe: r.ancora.existe, ancoras: r.ancora.ancoras, problemas: r.ancora.problemas.length },
                espelho: r.espelho && { existe: r.espelho.existe, linhas: r.espelho.linhas, recuperaveis: r.espelho.recuperaveis },
                testemunhaExterna: require('../../../services/nfe-audit-testemunha.service').config().ativa
            };
            statusLogFiscalCache.set(empresa, { ts: Date.now(), dados });
            res.json({ success: true, ...dados });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao obter status do log de emissão:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // Reconstitui as linhas do log a partir do ESPELHO (autênticas pelo MAC) — para recuperar
    // a evidência se o banco foi apagado ou adulterado.
    router.get('/confirmacoes/espelho', authenticateToken, async (req, res) => {
        try {
            if (!ehAdminFiscal(req)) return negarNaoAdmin(res);
            const rec = require('../../../services/nfe-confirmacao-audit.service')
                .recuperarDoEspelho(Number(req.user?.empresa_id) || 1);
            res.json({ success: true, total: rec.linhas.length, adulteradas: rec.adulteradas, ilegiveis: rec.ilegiveis, data: rec.linhas });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao ler o espelho do log de emissão:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ROLLBACK do faturamento de uma NF-e que falhou na SEFAZ (services/nfe-rollback.service.js).
    // GET = simulação: mostra o que seria desfeito, sem alterar nada (alimenta a confirmação).
    // POST = executa; exige confirmar:true. Resultado incerto consulta a chave na SEFAZ antes.
    const responderRollback = (res, error) => {
        const conhecido = error && error.code && /^[A-Z_]+$/.test(error.code) && error.status;
        if (conhecido) return res.status(error.status).json({ success: false, errorCode: error.code, message: error.message });
        console.error('[FATURAMENTO] Erro no rollback da NF-e:', error);
        return res.status(500).json({ success: false, errorCode: 'ROLLBACK_ERRO', message: mensagemSegura(error) });
    };

    router.get('/nfes/:id/rollback', authenticateToken, async (req, res) => {
        try {
            if (!await FiscalAccessService.podeReemitirNfe(pool, req.user)) {
                return res.status(403).json({ success: false, errorCode: 'RBAC_DENIED', message: 'Permissão insuficiente para reverter faturamento.' });
            }
            const plano = await require('../../../services/nfe-rollback.service').simular(pool, req.params.id);
            res.json({ success: true, data: plano });
        } catch (error) {
            responderRollback(res, error);
        }
    });

    router.post('/nfes/:id/rollback', authenticateToken, async (req, res) => {
        try {
            if (!await FiscalAccessService.podeReemitirNfe(pool, req.user)) {
                return res.status(403).json({ success: false, errorCode: 'RBAC_DENIED', message: 'Permissão insuficiente para reverter faturamento.' });
            }
            if (req.body?.confirmar !== true) {
                return res.status(400).json({ success: false, errorCode: 'CONFIRMACAO_NECESSARIA', message: 'Confirme o rollback (confirmar: true) após conferir o que será desfeito.' });
            }
            const rollbackService = require('../../../services/nfe-rollback.service');
            const resultado = await rollbackService.executar(pool, req.params.id, {
                origem: 'manual',
                usuario: { id: req.user.id, nome: req.user.nome || req.user.name || null },
                motivo: req.body?.motivo ? String(req.body.motivo).slice(0, 255) : null,
                req,
                // Só usada quando o retorno é incerto (timeout/comunicação): confere a chave na SEFAZ.
                consultar: async (chave, uf, tpAmb) => {
                    await garantirCertificadoPersistido();
                    return sefazService.consultarAutorizacaoSilenciosa(chave, uf, tpAmb);
                }
            });
            res.json({
                success: true,
                message: resultado.escopo === 'FATURAMENTO_INTEGRAL'
                    ? `Faturamento revertido. O pedido voltou para "${resultado.plano.statusAnterior}". O número ${resultado.plano.numeroLacuna.numero} ficou como lacuna: inutilize-o em Inutilização de Numeração.`
                    : `NF-e ${resultado.plano.nfe.numero} encerrada. O pedido não foi alterado. O número ficou como lacuna: inutilize-o em Inutilização de Numeração.`,
                data: { escopo: resultado.escopo, plano: resultado.plano }
            });
        } catch (error) {
            responderRollback(res, error);
        }
    });

    // Representação impressa da CC-e. O documento fiscal oficial permanece sendo
    // o XML do evento homologado pela SEFAZ; esta rota oferece a via operacional A4.
    router.get('/nfes/:id/carta-correcao/:sequencia/imprimir', authenticateToken, async (req, res) => {
        try {
            await Promise.all([nfesColumnsReady, nfeEventosColumnsReady]);
            const { id, sequencia } = req.params;
            if (!/^\d+$/.test(sequencia)) return res.status(400).send('Sequência de CC-e inválida.');

            const [[dados]] = await pool.query(`
                SELECT n.numero, n.serie, n.chave_acesso, n.data_emissao,
                       n.destinatario_nome, n.destinatario_cnpj_cpf,
                       c.endereco AS dest_endereco, c.numero AS dest_numero,
                       c.bairro AS dest_bairro, c.cidade AS dest_cidade,
                       c.estado AS dest_uf, c.cep AS dest_cep, c.telefone AS dest_telefone,
                       c.inscricao_estadual AS dest_ie, ne.sequencia, ne.descricao,
                       ne.protocolo, ne.status AS evento_status,
                       COALESCE(ne.data_evento, ne.created_at) AS data_evento
                  FROM nfes n
                  JOIN nfe_eventos ne ON ne.nfe_id = n.id AND ne.tipo_evento = '110110'
                  LEFT JOIN clientes c ON c.id = n.cliente_id
                 WHERE n.id = ? AND ne.sequencia = ? LIMIT 1
            `, [id, sequencia]);
            if (!dados) return res.status(404).send('Carta de Correção não encontrada.');

            let empresa = {};
            try { [[empresa]] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1'); }
            catch (_) { try { [[empresa]] = await pool.query('SELECT * FROM empresa_config LIMIT 1'); } catch (__) { empresa = {}; } }

            const { resolverLogoDanfeDataUri, gerarCodigoBarrasDataUri } = require('../../../routes/danfe-renderer');
            const logo = resolverLogoDanfeDataUri();
            const barras = gerarCodigoBarrasDataUri(dados.chave_acesso);
            const esc = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
            const digitos = valor => String(valor || '').replace(/\D/g, '');
            const doc = valor => { const n = digitos(valor); return n.length === 14 ? n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : n.length === 11 ? n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : (valor || '-'); };
            const dataHora = valor => valor ? new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-';
            const data = valor => valor ? new Date(valor).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-';
            const juntar = (...partes) => partes.filter(Boolean).join(', ');
            const enderecoEmitente = juntar(empresa.endereco, empresa.numero, empresa.bairro, empresa.cidade && empresa.estado ? `${empresa.cidade}-${empresa.estado}` : (empresa.cidade || empresa.estado), empresa.cep);
            const enderecoDest = juntar(dados.dest_endereco, dados.dest_numero, dados.dest_bairro, dados.dest_cep);
            const statusEvento = String(dados.evento_status || '').toLowerCase() === 'registrado' ? '135' : esc(dados.evento_status || '-');
            const legal = 'A Carta de Correção é disciplinada pelo § 1º-A do art. 7º do Convênio SINIEF s/n, de 15 de dezembro de 1970 e pode ser utilizada para regularização de erro ocorrido na emissão de documento fiscal, desde que o erro não esteja relacionado com: I - as variáveis que determinam o valor do imposto, tais como: base de cálculo, alíquota, diferença de preço, quantidade, valor da operação ou da prestação; II - a correção de dados cadastrais que implique mudança do remetente ou do destinatário; III - a data de emissão ou de saída.';

            res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>CC-e ${esc(dados.numero)} - sequência ${esc(dados.sequencia)}</title><style>
@page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{margin:0;background:#ececec;color:#000;font-family:"Times New Roman",serif;font-size:11px}.toolbar{position:sticky;z-index:10;top:0;padding:8px;text-align:center;background:#1f2937;box-shadow:0 2px 6px #0003}.toolbar button{min-width:190px;border:0;border-radius:6px;background:#fff;color:#111827;padding:9px 18px;font:600 14px Arial;cursor:pointer}.toolbar button:hover{background:#f3f4f6}.toolbar button:focus-visible{outline:3px solid #60a5fa;outline-offset:2px}.page{width:194mm;min-height:279mm;margin:12px auto;background:#fff;padding:2mm}.title{border:1px solid #000;text-align:center;font-size:17px;font-weight:bold;padding:2px;margin-bottom:3px}.grid{display:grid;border-top:1px solid #000;border-left:1px solid #000}.cell{border-right:1px solid #000;border-bottom:1px solid #000;padding:3px;min-height:27px}.label{display:block;font-size:10px;font-weight:bold}.value{font-size:11px;overflow-wrap:anywhere}.issuer{grid-template-columns:1fr 1fr}.issuer-id{grid-row:span 3;text-align:center;min-height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center}.logo{max-width:150px;max-height:70px;margin:4px}.barcode{width:100%;height:54px;object-fit:fill;margin-top:3px}.nfe{grid-template-columns:repeat(5,1fr);margin-top:3px;text-align:center}.recipient{grid-template-columns:1fr 1fr;margin-top:3px}.span2{grid-column:span 2}.legal{border:1px solid #000;margin-top:6px;padding:4px;font-size:10px;font-style:italic;text-align:justify}.events{border:1px solid #000;margin-top:6px;min-height:138mm;padding:4px}.events-title{font-size:12px;font-weight:bold;margin-bottom:4px}.event-head,.event-row{display:grid;grid-template-columns:70px 55px 130px 1fr;gap:4px}.event-head{font-weight:bold;border-bottom:1px solid #000}.correction{font-size:12px;white-space:pre-wrap;margin-top:7px}.footer{font:9px Arial,sans-serif;margin-top:5px;text-align:center}.key{font-family:monospace;font-size:10px}.strong{font-weight:bold}@media print{html,body{width:210mm;min-height:297mm;background:#fff}.toolbar{display:none!important}.page{margin:0;width:194mm;min-height:281mm;padding:0;box-shadow:none;break-inside:avoid}}
</style></head><body><div class="toolbar" role="toolbar" aria-label="Ações da Carta de Correção"><button type="button" id="btn-imprimir-cce">Imprimir Carta de Correção</button> <button type="button" id="btn-pdf-cce">Salvar em PDF</button> <button type="button" id="btn-email-cce">Enviar para Logística</button><span id="status-email-cce" role="status" aria-live="polite" style="display:block;margin-top:6px;color:#fff;font:12px Arial"></span></div><main class="page"><div class="title">Carta de Correção - CC-e</div>
<section class="grid issuer"><div class="cell issuer-id"><span class="label">Identificação do Emitente</span>${logo ? `<img class="logo" src="${logo}" alt="Logo do emitente">` : ''}<div class="strong">${esc(empresa.razao_social || empresa.nome_fantasia || 'EMITENTE')}</div><div>${esc(enderecoEmitente || '-')}</div></div><div class="cell"><span class="label">Inscrição Estadual</span><span class="value">${esc(empresa.inscricao_estadual || '-')}</span></div><div class="cell"><span class="label">CNPJ</span><span class="value">${esc(doc(empresa.cnpj))}</span></div><div class="cell span2"><span class="label">Chave de Acesso</span><span class="value key">${esc(digitos(dados.chave_acesso))}</span></div><div class="cell span2"><span class="label">Código de Barras</span>${barras ? `<img class="barcode" src="${barras}" alt="Código de barras da chave de acesso">` : ''}<div class="key" style="text-align:center">${esc(digitos(dados.chave_acesso))}</div></div></section>
<section class="grid nfe"><div class="cell"><span class="label">Número da NF-e</span>${esc(dados.numero)}</div><div class="cell"><span class="label">Série</span>${esc(dados.serie || '1')}</div><div class="cell"><span class="label">Modelo</span>55</div><div class="cell"><span class="label">Data de Emissão</span>${esc(data(dados.data_emissao))}</div><div class="cell"><span class="label">Página</span>1 / 1</div></section>
<section class="grid recipient"><div class="cell"><span class="label">Nome/Razão Social</span>${esc(dados.destinatario_nome || '-')}</div><div class="cell"><span class="label">CNPJ/CPF</span>${esc(doc(dados.destinatario_cnpj_cpf))}</div><div class="cell"><span class="label">Endereço</span>${esc(enderecoDest || '-')}</div><div class="cell"><span class="label">Bairro/Distrito</span>${esc(dados.dest_bairro || '-')}</div><div class="cell"><span class="label">Município</span>${esc(dados.dest_cidade || '-')}</div><div class="cell"><span class="label">UF / Telefone / Inscrição Estadual</span>${esc([dados.dest_uf, dados.dest_telefone, dados.dest_ie].filter(Boolean).join(' / ') || '-')}</div></section>
<div class="legal">${esc(legal)}</div><section class="events"><div class="events-title">Eventos/Correções</div><div class="event-head"><span>Sequência</span><span>Status</span><span>Data de Registro</span><span>Número do Protocolo</span></div><div class="event-row"><span>${esc(String(dados.sequencia || 1).padStart(2, '0'))}</span><span>${statusEvento}</span><span>${esc(dataHora(dados.data_evento))}</span><span>${esc(dados.protocolo || '-')}</span></div><div class="correction">${esc(dados.descricao || '-')}</div></section><div class="footer">Representação impressa da Carta de Correção Eletrônica. A validade fiscal é comprovada pelo XML do evento autorizado e respectivo protocolo SEFAZ.</div></main><script src="/Faturamento/js/cce-print.js?v=20260910-2" defer></script></body></html>`);
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao imprimir CC-e:', error);
            res.status(500).send('Não foi possível gerar a impressão da Carta de Correção.');
        }
    });

    // PDF da representação impressa da CC-e, para o usuário salvar localmente
    // (mesmo HTML da rota /imprimir, convertido no servidor via Puppeteer).
    router.get('/nfes/:id/carta-correcao/:sequencia/pdf', authenticateToken, async (req, res) => {
        try {
            await Promise.all([nfesColumnsReady, nfeEventosColumnsReady]);
            const { id, sequencia } = req.params;
            if (!/^\d+$/.test(sequencia)) return res.status(400).send('Sequência de CC-e inválida.');

            const [[cce]] = await pool.query(`
                SELECT n.numero, ne.sequencia
                  FROM nfes n
                  JOIN nfe_eventos ne ON ne.nfe_id = n.id AND ne.tipo_evento = '110110'
                 WHERE n.id = ? AND ne.sequencia = ? LIMIT 1
            `, [id, sequencia]);
            if (!cce) return res.status(404).send('Carta de Correção não encontrada.');

            const { buscarDocumentoInterno, htmlParaPdf } = require('../../../services/pdf-render.service');
            const documento = await buscarDocumentoInterno(
                `/api/faturamento/nfes/${encodeURIComponent(id)}/carta-correcao/${encodeURIComponent(sequencia)}/imprimir`,
                { cookie: req.headers.cookie, authorization: req.headers.authorization }
            );
            const pdf = await htmlParaPdf(documento.buffer.toString('utf8'), {
                margens: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' }
            });

            const numero = String(cce.numero || id);
            const seq = String(cce.sequencia || sequencia).padStart(2, '0');
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="CCe-${numero}-${seq}.pdf"`);
            res.setHeader('Content-Length', pdf.length);
            return res.end(pdf);
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao gerar PDF da CC-e:', error);
            res.status(error.status || 500).send('Não foi possível gerar o PDF da Carta de Correção.');
        }
    });

    // Envia a representação A4 da CC-e e o XML homologado para a logística
    // vinculada à marca da instância.
    router.post('/nfes/:id/carta-correcao/:sequencia/enviar-email', authenticateToken, async (req, res) => {
        try {
            if (!isEmailConfigured()) return res.status(503).json({ success: false, message: 'O serviço de e-mail não está configurado.' });
            await Promise.all([nfesColumnsReady, nfeEventosColumnsReady]);
            const { id, sequencia } = req.params;
            if (!/^\d+$/.test(sequencia)) return res.status(400).json({ success: false, message: 'Sequência de CC-e inválida.' });

            const [[cce]] = await pool.query(`
                SELECT n.numero, n.serie, n.chave_acesso, n.pedido_id, n.destinatario_nome,
                       ne.sequencia, ne.protocolo, ne.xml_evento, ne.status AS evento_status
                  FROM nfes n
                  JOIN nfe_eventos ne ON ne.nfe_id = n.id AND ne.tipo_evento = '110110'
                 WHERE n.id = ? AND ne.sequencia = ? LIMIT 1
            `, [id, sequencia]);
            if (!cce) return res.status(404).json({ success: false, message: 'Carta de Correção não encontrada.' });
            if (!cce.protocolo || !cce.xml_evento) {
                return res.status(409).json({ success: false, message: 'A CC-e ainda não possui XML e protocolo autorizados pela SEFAZ.' });
            }

            const brand = String(process.env.BRAND || '').toLowerCase();
            const emailConfigurado = String(process.env.EMAIL_LOGISTICA || '').split(/[,;\s]+/).find(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
            const destinatario = ['labor-energy', 'labor-eletric'].includes(brand)
                ? 'logistica@laboreletric.com.br'
                : brand === 'cobal' && emailConfigurado
                    ? emailConfigurado
                    : 'logistica@aluforce.ind.br';

            const { buscarDocumentoInterno, htmlParaPdf } = require('../../../services/pdf-render.service');
            const documento = await buscarDocumentoInterno(
                `/api/faturamento/nfes/${encodeURIComponent(id)}/carta-correcao/${encodeURIComponent(sequencia)}/imprimir`,
                { cookie: req.headers.cookie, authorization: req.headers.authorization }
            );
            const pdf = await htmlParaPdf(documento.buffer.toString('utf8'), {
                margens: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' }
            });
            const numero = String(cce.numero || id);
            const seq = String(cce.sequencia || sequencia).padStart(2, '0');
            const assunto = `Carta de Correção CC-e ${seq} — NF-e ${numero}`;
            const escaparEmail = valor => String(valor ?? '').replace(/[&<>"']/g, caractere => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caractere]);
            const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5"><h2>Carta de Correção Eletrônica autorizada</h2><p>A CC-e <strong>${escaparEmail(seq)}</strong> da NF-e <strong>${escaparEmail(numero)}</strong>, referente a <strong>${escaparEmail(cce.destinatario_nome || 'destinatário')}</strong>, foi registrada na SEFAZ.</p><p><strong>Protocolo:</strong> ${escaparEmail(cce.protocolo)}<br><strong>Chave de acesso:</strong> ${escaparEmail(cce.chave_acesso || '')}</p><p>A representação para impressão e o XML autorizado seguem anexos.</p></div>`;
            const resultado = await enviarEmail({
                rota: 'sistema', de: REMETENTE_NOTIFICACOES, para: destinatario, assunto, html,
                anexos: [
                    { filename: `CCe-${numero}-${seq}.pdf`, content: pdf, contentType: 'application/pdf' },
                    { filename: `CCe-${numero}-${seq}.xml`, content: Buffer.from(String(cce.xml_evento), 'utf8'), contentType: 'application/xml' }
                ]
            });
            if (!resultado.success) return res.status(502).json({ success: false, message: `O provedor recusou o envio: ${resultado.error || 'motivo não informado'}` });

            await registrarNoHistoricoDoPedido({
                pedidoId: cce.pedido_id, destinatario, assunto, corpo: html, ok: true,
                usuarioNome: req.user?.nome || req.user?.email || 'Sistema (CC-e)'
            });
            return res.json({ success: true, message: `Carta de Correção enviada para ${destinatario}.`, destinatario, messageId: resultado.messageId });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao enviar CC-e:', error);
            return res.status(error.status || 500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // DOWNLOAD XML DA NF-e
    // ============================================================

    router.get('/nfes/:id/xml', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const origem = req.query.origem || 'nfe';

            // Pedidos faturados não possuem XML formal
            if (origem === 'pedido') {
                return res.json({
                    success: false,
                    available: false,
                    message: 'XML não disponível: este registro é um pedido faturado sem NF-e formal emitida.'
                });
            }

            const [[nfe]] = await pool.query(
                'SELECT numero, chave_acesso, xml_nfe, xml_assinado, xml_protocolo FROM nfes WHERE id = ?', [id]);
            if (!nfe) return res.status(404).json({ success: false, message: 'NF-e não encontrada' });

            // O banco guarda TRÊS peças e nenhuma delas é, sozinha, o documento fiscal:
            //   xml_nfe       -> a NF-e gerada, SEM assinatura
            //   xml_assinado  -> a NF-e assinada, que foi transmitida
            //   xml_protocolo -> o envelope SOAP da resposta da SEFAZ, onde vive o <protNFe>
            // Quem tem validade fiscal é o `nfeProc`: a NF-e assinada COM o protocolo de
            // autorização em volta. Até 19/08/2026 esta rota devolvia `xml_nfe` — o XML sem
            // assinatura nem protocolo, que a contabilidade não consegue usar.
            const nfeAssinada = (String(nfe.xml_assinado || '').match(/<NFe[\s>][\s\S]*<\/NFe>/) || [])[0];
            const protocolo = (String(nfe.xml_protocolo || '').match(/<protNFe[\s\S]*?<\/protNFe>/) || [])[0];
            const nfeProc = (nfeAssinada && protocolo)
                ? '<?xml version="1.0" encoding="UTF-8"?>'
                  + '<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">'
                  + nfeAssinada + protocolo + '</nfeProc>'
                : null;

            // Degrada na ordem do que é mais completo: autorizado > assinado > gerado. Uma
            // nota rejeitada não tem protocolo, e ainda assim o XML assinado é útil para
            // diagnosticar a rejeição.
            const conteudo = nfeProc || nfe.xml_assinado || nfe.xml_nfe;
            if (!conteudo) return res.status(404).json({ success: false, message: 'XML não disponível para esta NF-e' });

            // A contabilidade espera o arquivo nomeado pela chave de acesso.
            const chave = String(nfe.chave_acesso || '').replace(/\D/g, '');
            const nomeArquivo = chave ? `${chave}.xml` : `nfe_${nfe.numero || id}.xml`;

            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.setHeader('X-Zyntra-Xml-Tipo', nfeProc ? 'autorizado' : (nfe.xml_assinado ? 'assinado' : 'gerado'));
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Zyntra-Xml-Tipo');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
            res.send(conteudo);
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao baixar XML:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // CANCELAR NF-e
    // ============================================================

    router.post('/nfes/:id/cancelar', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            const { motivo, confirmar_extemporaneo } = req.body;
            const usuario_id = req.user.id;

            // AUDITORIA ENTERPRISE: RBAC - Cancelamento é evento fiscal irreversível.
            // Gerência continua liberada por role; as demais contas precisam da permissão
            // granular `faturamento.excluir`, ligada de propósito na tela de usuários.
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();

            if (!await FiscalAccessService.podeCancelarNfe(pool, req.user)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuario_id} (${userRole || 'sem perfil'}) tentou cancelar NF-e ${id} sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Seu perfil não possui permissão para cancelar NF-e. É necessário ser gerente/administrador ou ter permissão para excluir no Faturamento.'
                });
            }

            // Erros de validação de negócio carregam statusCode 400 para o catch final não
            // devolvê-los como 500 (BUG-FAT-014: erro de regra vazava como falha interna).
            // `errorCode` não é decoração: sem ele a tela não distingue "fora do prazo, confirme"
            // de "não pode cancelar", e o cancelamento extemporâneo ficava impossível pela
            // interface — o backend pedia confirmação que a tela não tinha como enviar.
            const erroNegocio = (msg, statusCode = 400, errorCode = null) => {
                const e = new Error(msg);
                e.statusCode = statusCode;
                e.errorCode = errorCode;
                return e;
            };
            const motivoLimpo = String(motivo || '').trim();

            // VALIDAÇÃO FISCAL: Motivo deve ter entre 15 e 255 caracteres (SEFAZ)
            if (motivoLimpo.length < 15) {
                throw erroNegocio('Motivo do cancelamento deve ter no mínimo 15 caracteres');
            }
            if (motivoLimpo.length > 255) {
                throw erroNegocio('Motivo do cancelamento excede o limite de 255 caracteres');
            }

            await Promise.all([nfesColumnsReady, nfeEventosColumnsReady]);
            await connection.beginTransaction();

            // Bloqueia a NF-e durante toda a transmissão para impedir dois cancelamentos
            // concorrentes com a mesma sequência de evento.
            const [nfes] = await connection.query(`
                SELECT * FROM nfes WHERE id = ? FOR UPDATE
            `, [id]);

            if (nfes.length === 0) {
                throw erroNegocio('NF-e não encontrada');
            }

            const nfe = nfes[0];

            const statusNfe = String(nfe.status || '').toLowerCase().trim();
            if (statusNfe === 'cancelada') {
                throw erroNegocio('NF-e já está cancelada');
            }

            // Cancelamento fiscal exige Autorização de Uso real. Rascunhos/legados sem
            // chave devem ser excluídos, nunca marcados como "cancelados na SEFAZ".
            const chaveAcesso = String(nfe.chave_acesso || '').replace(/\D/g, '');
            const protocoloAutorizacao = String(nfe.protocolo_autorizacao || '').trim();
            const cnpjEmitente = String(nfe.emitente_cnpj || '').replace(/\D/g, '');
            const ufEmitente = String(nfe.emitente_uf || '').trim().toUpperCase();
            const temAutorizacaoReal = statusNfe === 'autorizada'
                && chaveAcesso.length === 44
                && protocoloAutorizacao.length > 0;
            if (!temAutorizacaoReal) {
                throw erroNegocio('Somente NF-e autorizada, com chave e protocolo de autorização, pode ser cancelada. Para rascunhos utilize a exclusão.', 409, 'NFE_NAO_AUTORIZADA');
            }
            if (!/^[A-Z]{2}$/.test(ufEmitente) || cnpjEmitente.length !== 14) {
                throw erroNegocio('Dados fiscais do emitente incompletos (UF/CNPJ). Corrija a configuração fiscal antes de cancelar.', 409);
            }

            // O prazo regulamentar é contado da Autorização de Uso — nunca da criação
            // local do registro. Sem esta data não há como validar o prazo com segurança.
            const dataAutorizacao = nfe.data_autorizacao ? new Date(nfe.data_autorizacao) : null;
            if (!dataAutorizacao || Number.isNaN(dataAutorizacao.getTime())) {
                throw erroNegocio('NF-e sem data de autorização válida. Consulte a situação na SEFAZ antes de cancelar.', 409);
            }
            const horasDesdeAutorizacao = (Date.now() - dataAutorizacao.getTime()) / (1000 * 60 * 60);
            if (horasDesdeAutorizacao < -1) {
                throw erroNegocio('Data de autorização futura ou inconsistente. Consulte a situação na SEFAZ antes de cancelar.', 409);
            }
            // Em SP, 24h é o prazo regulamentar; a SRE 80/2025 permite recepção
            // extemporânea pelo sistema até 480h. Exigimos confirmação inequívoca
            // porque a recepção fora do prazo pode trazer consequências fiscais.
            const cancelamentoExtemporaneo = horasDesdeAutorizacao > 24;
            if (horasDesdeAutorizacao > 480) {
                throw erroNegocio(`Prazo máximo de recepção eletrônica em SP excedido (${Math.floor(horasDesdeAutorizacao)}h desde a autorização). Solicite orientação à contabilidade.`, 409, 'PRAZO_CANCELAMENTO_EXCEDIDO');
            }
            if (cancelamentoExtemporaneo && confirmar_extemporaneo !== true) {
                throw erroNegocio(`Esta NF-e foi autorizada há ${Math.floor(horasDesdeAutorizacao)}h — fora do prazo regulamentar de 24h. `
                    + 'A SEFAZ ainda aceita o cancelamento (SRE 80/2025, até 480h), mas a recepção extemporânea '
                    + 'pode ter consequências fiscais. Confirme para transmitir.', 409, 'CANCELAMENTO_EXTEMPORANEO');
            }
            if (cancelamentoExtemporaneo) {
                console.warn(`[FATURAMENTO] Cancelamento extemporâneo confirmado para NF-e ${id}: ${Math.floor(horasDesdeAutorizacao)}h após autorização`);
            }

            // ── TRANSMISSÃO DO CANCELAMENTO À SEFAZ (evento 110111) ──
            let cancelamentoSefaz;
            try {
                cancelamentoSefaz = await sefazService.cancelarNFe(
                    chaveAcesso,
                    protocoloAutorizacao,
                    motivoLimpo,
                    ufEmitente,
                    cnpjEmitente
                );
            } catch (sefazErr) {
                await connection.rollback();
                console.error(`[FATURAMENTO] Falha SEFAZ ao cancelar NF-e ${id}:`, sefazErr.message);
                return res.status(502).json({
                    success: false,
                    error: 'SEFAZ_INDISPONIVEL',
                    errorCode: 'SEFAZ_INDISPONIVEL',
                    message: `Não foi possível transmitir o cancelamento à SEFAZ: ${sefazErr.message}`
                });
            }
            // 135 = evento registrado e vinculado; 155 = cancelamento fora de prazo
            // homologado. 136 NÃO altera o estado local porque não houve vínculo à NF-e.
            const cStat = String(cancelamentoSefaz?.codigoStatus || '');
            if (!['135', '155'].includes(cStat)) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    error: 'SEFAZ_REJEITOU',
                    errorCode: 'SEFAZ_REJEITOU',
                    message: `SEFAZ não homologou o cancelamento (cStat ${cStat || '?'}: ${cancelamentoSefaz?.motivo || 'sem retorno'}). A NF-e continua válida.`
                });
            }

            // Persistir o estado fiscal e os metadados que alimentam histórico/auditoria.
            await connection.query(`
                UPDATE nfes
                SET status = 'cancelada', data_cancelamento = NOW(),
                    motivo_cancelamento = ?, cancelada_por = ?
                WHERE id = ?
            `, [motivoLimpo, usuario_id, id]);

            // A linha de auditoria faz parte da mesma transação do estado cancelado.
            // Não engolir falha aqui: isso foi o que deixou cancelamentos homologados
            // sem protocolo no histórico local. O UPSERT torna reconciliação/reenvio
            // seguro sem duplicar o evento.
            await connection.query(`
                INSERT INTO nfe_eventos (
                    nfe_id, tipo_evento, sequencia, descricao, descricao_evento,
                    protocolo, protocolo_evento,
                    xml_evento, status, data_evento, created_at
                ) VALUES (?, '110111', 1, ?, ?, ?, ?, ?, 'registrado', NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    descricao = VALUES(descricao),
                    descricao_evento = VALUES(descricao_evento),
                    protocolo = VALUES(protocolo),
                    protocolo_evento = VALUES(protocolo_evento),
                    xml_evento = VALUES(xml_evento),
                    status = 'registrado',
                    data_evento = VALUES(data_evento)
            `, [id, motivoLimpo.substring(0, 255), motivoLimpo.substring(0, 255),
                cancelamentoSefaz.numeroProtocolo || null, cancelamentoSefaz.numeroProtocolo || null,
                cancelamentoSefaz.xmlCompleto || null]);

            // Limpar os dados fiscais do pedido — a etiqueta continuaria imprimindo o
            // número de uma NF-e cancelada.
            //
            // O STATUS, porém, continua 'faturado': o pedido FOI faturado, e cancelar a nota
            // não desfaz esse fato comercial. Antes daqui ele voltava para 'aprovado' e sumia
            // da aba "Faturado" do Vendas, reaparecendo no meio dos pedidos que nunca foram
            // faturados. Sem NF-e ativa o pedido volta a ser movível para "Faturar" e pode ser
            // refaturado — a exceção está em VALID_STATUS_TRANSITIONS
            // (routes/vendas-routes.js) e no destravamento da lista/kanban do Vendas.
            // Pedido já entregue/com recibo mantém o status adiantado.
            if (nfe.pedido_id) {
                await connection.query(`
                    UPDATE pedidos
                    SET nfe_id = NULL,
                        nfe_faturamento_numero = NULL,
                        numero_nf = NULL,
                        nf = NULL,
                        nfe_chave = NULL,
                        status = CASE WHEN status IN ('entregue', 'recibo', 'finalizado', 'concluido')
                                      THEN status ELSE 'faturado' END
                    WHERE id = ?
                `, [nfe.pedido_id]);
            }

            // A SEFAZ já homologou o evento: o estado fiscal local precisa ser confirmado
            // antes das integrações secundárias. Isso também evita deadlock, pois estoque e
            // financeiro usam conexões próprias e precisam ler a mesma NF-e.
            await connection.commit();

            const integracoes = { financeiro: null, estoque: null, avisos: [] };

            try {
                integracoes.financeiro = await financeiroService.estornarNFeCancelada(id, motivoLimpo);
                // Título já recebido não é cancelado (o dinheiro entrou) — quem cancelou
                // a nota precisa saber que sobrou receita lançada sem documento fiscal.
                const recebidos = integracoes.financeiro?.recebidos || [];
                if (recebidos.length > 0) {
                    const total = recebidos.reduce((s, t) => s + t.valor, 0);
                    integracoes.avisos.push(
                        `${recebidos.length} título(s) já recebido(s) (R$ ${total.toFixed(2)}) foram mantidos `
                        + 'em Contas a Receber — trate a devolução com o cliente.'
                    );
                }
                if (integracoes.financeiro?.estornados === 0 && recebidos.length === 0) {
                    integracoes.avisos.push('Nenhum título encontrado em Contas a Receber para esta NF-e — confira manualmente.');
                }
            } catch (err) {
                console.warn(`[FATURAMENTO] Aviso estorno financeiro: ${err.message}`);
                integracoes.avisos.push(`Financeiro não estornado: ${err.message}`);
            }

            try {
                integracoes.estoque = await vendasEstoqueService.estornarEstoque(id, usuario_id);
            } catch (err) {
                console.warn(`[FATURAMENTO] Aviso estorno estoque: ${err.message}`);
                integracoes.avisos.push(`Estoque não estornado: ${err.message}`);
            }

            // VULN-013 FIX: Audit trail para cancelamento de NF-e (operação fiscal crítica)
            logAuditEvent(pool, {
                userId: usuario_id,
                action: 'CANCELAR_NFE',
                module: 'faturamento',
                description: `NF-e ${nfe.numero} cancelada. Motivo: ${motivoLimpo.substring(0, 100)}`,
                previousData: { nfe_id: id, numero_nfe: nfe.numero, status: nfe.status, valor_total: nfe.valor_total },
                newData: { status: 'cancelada', motivo: motivoLimpo, integracoes },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            // Aviso à operação. Vem DEPOIS da homologação (cStat 135/155 já validado acima) e
            // do commit: a logística precisa saber que a nota caiu, porque é o cancelamento
            // que muda o que pode sair com a carga. Sem await — o cancelamento já está
            // concluído e a resposta não deve esperar o SMTP.
            enviarAvisoEventoFiscal({
                nfeId: parseInt(id),
                evento: 'CANCELAMENTO',
                emitidoPorEmail: req.user?.email,
                detalhes: {
                    'Motivo': motivoLimpo,
                    'Protocolo do evento': cancelamentoSefaz?.numeroProtocolo || '—',
                    'Retorno SEFAZ': cancelamentoSefaz ? `${cancelamentoSefaz.codigoStatus} — ${cancelamentoSefaz.motivo}` : '—',
                    'Extemporâneo': cancelamentoExtemporaneo ? 'Sim (fora das 24h)' : 'Não',
                    'Cancelado por': req.user?.nome || req.user?.email || usuario_id
                }
            }).catch(() => {});

            res.json({
                success: true,
                message: integracoes.avisos.length === 0
                    ? `NF-e cancelada${cancelamentoExtemporaneo ? ' extemporaneamente' : ''} na SEFAZ (protocolo ${cancelamentoSefaz.numeroProtocolo || 'sem protocolo'}).`
                    : `NF-e cancelada na SEFAZ com ${integracoes.avisos.length} aviso(s) de integração.`,
                data: {
                    nfe_id: id,
                    status: 'cancelada',
                    extemporaneo: cancelamentoExtemporaneo,
                    sefaz: cancelamentoSefaz ? { protocolo: cancelamentoSefaz.numeroProtocolo, cStat: cancelamentoSefaz.codigoStatus, motivo: cancelamentoSefaz.motivo } : null,
                    integracoes
                }
            });

        } catch (error) {
            await connection.rollback();
            // BUG-FAT-014: erro de validação de negócio → 400; só falha inesperada → 500.
            const httpStatus = error.statusCode || 500;
            if (httpStatus >= 500) console.error('[FATURAMENTO] Erro ao cancelar NF-e:', error?.message || error, error?.stack || '');
            res.status(httpStatus).json({
                success: false,
                errorCode: error.errorCode,
                message: mensagemSegura(error)
            });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // ESTATÍSTICAS
    // ============================================================

    router.get('/estatisticas', authenticateToken, async (req, res) => {
        try {
            // Estatísticas combinadas: nfes formais + pedidos faturados sem NF-e formal
            const [stats] = await pool.query(`
                SELECT
                    COALESCE(SUM(total_nfes), 0) as total_nfes,
                    COALESCE(SUM(autorizadas), 0) as autorizadas,
                    COALESCE(SUM(pendentes), 0) as pendentes,
                    COALESCE(SUM(canceladas), 0) as canceladas,
                    COALESCE(SUM(valor_total_faturado), 0) as valor_total_faturado,
                    COALESCE(SUM(valor_mes_atual), 0) as valor_mes_atual
                FROM (
                    SELECT
                        COUNT(*) as total_nfes,
                        SUM(CASE WHEN status COLLATE utf8mb4_general_ci = 'autorizada'
                                 AND chave_acesso IS NOT NULL AND chave_acesso <> ''
                                 AND protocolo_autorizacao IS NOT NULL AND protocolo_autorizacao <> ''
                            THEN 1 ELSE 0 END) as autorizadas,
                        SUM(CASE WHEN status COLLATE utf8mb4_general_ci = 'cancelada' THEN 0
                                 WHEN status COLLATE utf8mb4_general_ci = 'autorizada'
                                      AND chave_acesso IS NOT NULL AND chave_acesso <> ''
                                      AND protocolo_autorizacao IS NOT NULL AND protocolo_autorizacao <> ''
                                 THEN 0
                                 ELSE 1 END) as pendentes,
                        SUM(CASE WHEN status COLLATE utf8mb4_general_ci = 'cancelada' THEN 1 ELSE 0 END) as canceladas,
                        SUM(CASE WHEN status COLLATE utf8mb4_general_ci = 'autorizada'
                                 AND chave_acesso IS NOT NULL AND chave_acesso <> ''
                                 AND protocolo_autorizacao IS NOT NULL AND protocolo_autorizacao <> ''
                            THEN COALESCE(valor_total, 0) ELSE 0 END) as valor_total_faturado,
                        SUM(CASE WHEN status COLLATE utf8mb4_general_ci = 'autorizada'
                                 AND chave_acesso IS NOT NULL AND chave_acesso <> ''
                                 AND protocolo_autorizacao IS NOT NULL AND protocolo_autorizacao <> ''
                                 AND MONTH(data_emissao) = MONTH(NOW()) AND YEAR(data_emissao) = YEAR(NOW())
                            THEN COALESCE(valor_total, 0) ELSE 0 END) as valor_mes_atual
                    FROM nfes

                    UNION ALL

                    SELECT
                        COUNT(*) as total_nfes,
                        SUM(CASE WHEN p.nfe_chave IS NOT NULL AND p.nfe_chave <> '' AND p.nfe_protocolo IS NOT NULL AND p.nfe_protocolo <> '' THEN 1 ELSE 0 END) as autorizadas,
                        SUM(CASE WHEN p.nfe_chave IS NOT NULL AND p.nfe_chave <> '' AND p.nfe_protocolo IS NOT NULL AND p.nfe_protocolo <> '' THEN 0 ELSE 1 END) as pendentes,
                        0 as canceladas,
                        SUM(COALESCE(p.valor, 0)) as valor_total_faturado,
                        SUM(CASE WHEN MONTH(COALESCE(p.data_faturamento, p.created_at)) = MONTH(NOW()) AND YEAR(COALESCE(p.data_faturamento, p.created_at)) = YEAR(NOW()) THEN COALESCE(p.valor, 0) ELSE 0 END) as valor_mes_atual
                    FROM pedidos p
                    WHERE p.status = 'faturado'
                      AND p.id NOT IN (SELECT COALESCE(pedido_id, 0) FROM nfes WHERE pedido_id IS NOT NULL)
                ) combined
            `);

            // BUG-FAT-013: garantir tipos numéricos consistentes (MySQL retorna COUNT/SUM
            // como string ou null dependendo do driver) — o front não deve receber "0"/null.
            const s = stats[0] || {};
            const numero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
            res.json({
                success: true,
                data: {
                    total_nfes: numero(s.total_nfes),
                    autorizadas: numero(s.autorizadas),
                    pendentes: numero(s.pendentes),
                    canceladas: numero(s.canceladas),
                    valor_total_faturado: numero(s.valor_total_faturado),
                    valor_mes_atual: numero(s.valor_mes_atual)
                }
            });

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao buscar estatísticas:', error);
            res.status(500).json({
                success: false,
                message: mensagemSegura(error)
            });
        }
    });

    // ============================================================
    // REEMITIR NF-e DE PEDIDO FATURADO SEM REGISTRO FORMAL
    // ============================================================

    router.post('/pedidos/:id/reemitir-nfe', authenticateToken, async (req, res) => {
        const pedidoId = parseInt(req.params.id, 10);
        const usuarioId = req.user.id;
        const nomeLock = `nfe_reemit_pedido_${pedidoId}`;
        let lockConnection = null;
        let lockAdquirido = false;

        try {
            await Promise.all([nfesColumnsReady, nfeEventosColumnsReady]);
            const userRole = String(req.user.role || req.user.cargo || '').toLowerCase();
            const podeReemitir = await FiscalAccessService.podeReemitirNfe(pool, req.user);
            if (!podeReemitir) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuarioId} (${userRole || 'sem perfil'}) tentou reemitir NF-e do pedido ${pedidoId} sem permissão`);
                return res.status(403).json({
                    success: false,
                    errorCode: 'RBAC_DENIED',
                    message: 'Seu perfil não possui permissão para reemitir NF-e para a SEFAZ. É necessário ter permissão para criar no Faturamento.'
                });
            }

            // Lock nomeado no MySQL protege também quando o Node está em cluster/PM2:
            // dois workers nunca reservam duas numerações para o mesmo pedido.
            lockConnection = await pool.getConnection();
            const [[lockRow]] = await lockConnection.query(
                'SELECT GET_LOCK(?, 0) AS adquirido',
                [nomeLock]
            );
            lockAdquirido = Number(lockRow?.adquirido) === 1;
            if (!lockAdquirido) {
                return res.status(409).json({
                    success: false,
                    errorCode: 'REEMISSAO_EM_ANDAMENTO',
                    message: 'Já existe uma reemissão em andamento para este pedido.'
                });
            }

            // Nunca cria uma segunda NF-e para o mesmo pedido. Se um registro formal já
            // existe, o frontend passa a usar a rota idempotente de retransmissão dele.
            const [[nfeExistente]] = await pool.query(`
                SELECT id, numero, status
                  FROM nfes
                 WHERE pedido_id = ?
                 ORDER BY id DESC
                 LIMIT 1
            `, [pedidoId]);
            if (nfeExistente) {
                return res.status(409).json({
                    success: false,
                    errorCode: 'NFE_EXISTENTE',
                    message: 'O pedido já possui uma NF-e formal. O registro existente será retransmitido.',
                    data: { nfe_id: nfeExistente.id, numero: nfeExistente.numero, status: nfeExistente.status }
                });
            }

            const [[pedido]] = await pool.query(
                `SELECT id, status FROM pedidos WHERE id = ? LIMIT 1`,
                [pedidoId]
            );
            if (!pedido) {
                return res.status(404).json({ success: false, message: 'Pedido faturado não encontrado.' });
            }
            if (String(pedido.status || '').toLowerCase() !== 'faturado') {
                return res.status(400).json({
                    success: false,
                    errorCode: 'PEDIDO_NAO_FATURADO',
                    message: `O pedido está com status "${pedido.status}" e não pode ser reemitido por este fluxo.`
                });
            }

            const [itensRows] = await pool.query(`
                SELECT produto_id, quantidade,
                       COALESCE(preco_unitario, 0) AS valor_unitario
                  FROM pedido_itens
                 WHERE pedido_id = ?
            `, [pedidoId]);
            const itens = itensRows
                .map(item => ({
                    produto_id: Number(item.produto_id),
                    quantidade: Number(item.quantidade),
                    valor_unitario: Number(item.valor_unitario)
                }))
                .filter(item => item.produto_id > 0 && item.quantidade > 0 && item.valor_unitario > 0);
            if (itens.length === 0) {
                return res.status(400).json({
                    success: false,
                    errorCode: 'ITENS_INVALIDOS',
                    message: 'O pedido não possui itens vinculados a produtos com quantidade e valor válidos.'
                });
            }

            let resultado;
            try {
                resultado = await emitirNFePedido(pool, {
                    pedidoId,
                    itens,
                    usuarioId,
                    transmitir: true,
                    auditoriaEnvio: require('../../../services/nfe-confirmacao-audit.service').identidadeConfirmada(req)
                });
            } catch (emitErr) {
                // Falha antes de numerar (cadastro/preflight): o motivo fica no pedido para a
                // Listagem de NF-e continuar mostrando o pedido com status "erro".
                if (await temColunaNfeErroPedidos()) {
                    await pool.query('UPDATE pedidos SET nfe_erro = ? WHERE id = ?',
                        [String(emitErr.message || 'Falha na emissão da NF-e').slice(0, 500), pedidoId]).catch(() => {});
                }
                throw emitErr;
            }
            if (await temColunaNfeErroPedidos()) {
                await pool.query('UPDATE pedidos SET nfe_erro = ? WHERE id = ?',
                    [resultado.autorizado ? null : String(resultado.motivo || 'NF-e não autorizada pela SEFAZ').slice(0, 500), pedidoId]).catch(() => {});
            }

            await pool.query(`
                UPDATE pedidos
                   SET nfe_id = ?, nf = ?, numero_nf = ?, nfe_faturamento_numero = ?,
                       nfe_chave = ?, nfe_protocolo = ?, updated_at = NOW()
                 WHERE id = ?
            `, [
                resultado.nfeId,
                String(resultado.numero),
                String(resultado.numero),
                String(resultado.numero),
                resultado.chaveAcesso || null,
                resultado.protocolo || null,
                pedidoId
            ]);

            logAuditEvent(pool, {
                userId: usuarioId,
                action: 'REEMITIR_NFE',
                module: 'faturamento',
                description: `Reemissão da NF-e ${resultado.numero} para o pedido ${pedidoId}`,
                newData: { pedido_id: pedidoId, nfe_id: resultado.nfeId, status: resultado.status },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            // Aviso de "nota fiscal emitida" (DANFE + XML), igual ao que /enviar-sefaz já
            // faz. Só quando a SEFAZ AUTORIZOU: avisar cliente de uma nota rejeitada seria
            // anunciar documento que não existe. Não duplica — nem /gerar-nfe nem
            // /enviar-sefaz passam pelo emitter, e são as outras duas portas que mandam.
            const emailReemissao = { enviado: false };
            if (resultado.autorizado) {
                try {
                    const envio = await enviarDanfeEmail(parseInt(resultado.nfeId, 10), {
                        emitidoPorEmail: req.user?.email
                    });
                    emailReemissao.enviado = !!(envio && envio.enviado);
                    emailReemissao.destinatarios = envio && envio.destinatarios;
                } catch (emailErr) {
                    // O e-mail é aviso, não o documento fiscal: a nota já está autorizada e
                    // a resposta não pode virar erro por causa do SMTP.
                    console.warn(`[FATURAMENTO-EMAIL] ⚠ Aviso de reemissão falhou: ${emailErr.message}`);
                }
            }

            const payload = {
                success: !!resultado.autorizado,
                message: resultado.autorizado
                    ? 'NF-e reemitida e autorizada pela SEFAZ.'
                    : 'A NF-e foi reemitida, mas a SEFAZ rejeitou o documento.',
                codigo: resultado.codigoStatus,
                motivo: resultado.motivo,
                email: emailReemissao,
                data: {
                    nfe_id: resultado.nfeId,
                    numero: resultado.numero,
                    status: resultado.status,
                    chave_acesso: resultado.chaveAcesso,
                    protocolo: resultado.protocolo
                }
            };
            return res.status(resultado.autorizado ? 200 : 400).json(payload);
        } catch (error) {
            console.error(`[FATURAMENTO] Erro ao reemitir NF-e do pedido ${pedidoId}:`, error);
            return res.status(500).json({
                success: false,
                errorCode: error.code || 'REEMISSAO_ERRO',
                message: mensagemSegura(error),
                data: error.nfeId ? { nfe_id: error.nfeId } : undefined
            });
        } finally {
            if (lockConnection) {
                if (lockAdquirido) {
                    await lockConnection.query('SELECT RELEASE_LOCK(?)', [nomeLock]).catch(() => {});
                }
                lockConnection.release();
            }
        }
    });

    // ============================================================
    // MEUS RELATÓRIOS (fixar relatório no mega-menu)
    // ============================================================
    // Fica neste router — e não num `/api/meus-relatorios` próprio — porque montar rota nova
    // exige mexer em `routes/index.js`, que diverge entre as 3 instâncias (local ≠ aluforce ≠
    // Labor). Este arquivo é deployado inteiro com segurança. O recurso é agnóstico de módulo:
    // `modulo` vem no corpo, então Vendas, Faturamento e o que vier usam o mesmo endpoint.

    let tabelaFixadosPronta = null;
    function garantirTabelaFixados() {
        if (!tabelaFixadosPronta) {
            tabelaFixadosPronta = pool.query(`
                CREATE TABLE IF NOT EXISTS relatorios_fixados (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    usuario_id INT NOT NULL,
                    modulo VARCHAR(40) NOT NULL,
                    relatorio_id VARCHAR(80) NOT NULL,
                    nome VARCHAR(120) NOT NULL,
                    href VARCHAR(255) NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_fixado (usuario_id, modulo, relatorio_id),
                    KEY idx_fixado_usuario (usuario_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `).catch((e) => {
                console.error('[MEUS-RELATORIOS] Falha ao criar tabela:', e.message);
                tabelaFixadosPronta = null;
                throw e;
            });
        }
        return tabelaFixadosPronta;
    }

    // Só os módulos que têm catálogo de relatórios com id. Lista fechada porque `href` é
    // gravado e depois vira link no menu: aceitar caminho arbitrário seria deixar o usuário
    // plantar uma URL qualquer no próprio menu.
    const MODULOS_RELATORIO = {
        faturamento: '/Faturamento/relatorios.html',
        vendas: '/Vendas/relatorios.html',
        compras: '/Compras/relatorios.html',
        // O Financeiro usa o catálogo neutro (public/js/relatorios-neutros.js); o id fixado
        // é o slug, com sufixo '--cp'/'--cr' na família CPR, que tem duas versões por slug.
        financeiro: '/Financeiro/relatorios.html',
        pcp: '/PCP/central-relatorios.html',
        rh: '/RH/pages/relatorios.html',
        logistica: '/Logistica/relatorios.html',
        qualidade: '/Qualidade/relatorios.html'
    };

    router.get('/meus-relatorios', authenticateToken, async (req, res) => {
        try {
            await garantirTabelaFixados();
            const [linhas] = await pool.query(
                `SELECT modulo, relatorio_id, nome, href
                   FROM relatorios_fixados WHERE usuario_id = ?
                  ORDER BY created_at ASC`,
                [req.user.id]
            );
            return res.json({ success: true, data: linhas });
        } catch (error) {
            console.error('[MEUS-RELATORIOS] Erro ao listar:', error.message);
            // Lista vazia em vez de 500: o card do menu não pode derrubar a navegação.
            return res.json({ success: true, data: [] });
        }
    });

    router.post('/meus-relatorios', authenticateToken, async (req, res) => {
        try {
            await garantirTabelaFixados();
            const modulo = String(req.body?.modulo || '').toLowerCase().trim();
            const relatorioId = String(req.body?.relatorio_id || '').trim();
            const nome = String(req.body?.nome || '').trim().slice(0, 120);

            const base = MODULOS_RELATORIO[modulo];
            if (!base) {
                return res.status(400).json({ success: false, message: 'Módulo de relatório desconhecido.' });
            }
            if (!/^[a-z0-9-]{2,80}$/.test(relatorioId)) {
                return res.status(400).json({ success: false, message: 'Identificador de relatório inválido.' });
            }
            if (!nome) {
                return res.status(400).json({ success: false, message: 'Nome do relatório é obrigatório.' });
            }

            // O href é MONTADO aqui a partir da base do módulo — nunca aceito do cliente.
            const href = `${base}?rel=${encodeURIComponent(relatorioId)}`;

            const [[{ total }]] = await pool.query(
                'SELECT COUNT(*) AS total FROM relatorios_fixados WHERE usuario_id = ?', [req.user.id]
            );
            if (total >= 12) {
                return res.status(409).json({
                    success: false,
                    message: 'Você já tem 12 relatórios fixados. Desafixe algum antes de incluir outro.'
                });
            }

            await pool.query(
                `INSERT INTO relatorios_fixados (usuario_id, modulo, relatorio_id, nome, href)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE nome = VALUES(nome), href = VALUES(href)`,
                [req.user.id, modulo, relatorioId, nome, href]
            );
            return res.json({ success: true, message: `"${nome}" fixado em Meus Relatórios.`, data: { modulo, relatorio_id: relatorioId, nome, href } });
        } catch (error) {
            console.error('[MEUS-RELATORIOS] Erro ao fixar:', error.message);
            return res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    router.delete('/meus-relatorios/:modulo/:relatorioId', authenticateToken, async (req, res) => {
        try {
            await garantirTabelaFixados();
            const [r] = await pool.query(
                'DELETE FROM relatorios_fixados WHERE usuario_id = ? AND modulo = ? AND relatorio_id = ?',
                [req.user.id, String(req.params.modulo).toLowerCase(), String(req.params.relatorioId)]
            );
            return res.json({ success: true, removido: r.affectedRows > 0 });
        } catch (error) {
            console.error('[MEUS-RELATORIOS] Erro ao desafixar:', error.message);
            return res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // CORRIGIR NF-e REJEITADA (editar o XML e reemitir)
    // ============================================================
    // O "Salvar Alterações" do modal grava nas colunas de `nfes`, mas /enviar-sefaz transmite
    // `nfes.xml_nfe` — então corrigir pela tela e reemitir devolvia a MESMA rejeição. Estas duas
    // rotas editam o documento em si: a chave de acesso, a numeração e o restante do XML são
    // preservados; a assinatura é descartada e refeita no envio.

    /** Estados em que a nota ainda pode ser corrigida (documento fiscal não definitivo). */
    const STATUS_CORRIGIVEL = ['pendente', 'rejeitada', 'erro'];

    async function carregarNfeParaCorrecao(id, res) {
        const [[nfe]] = await pool.query(
            `SELECT id, numero, serie, cliente_id, status, xml_nfe, xml_assinado,
                    sefaz_codigo_status, sefaz_motivo, sefaz_tipo_retorno, sefaz_ambiente
               FROM nfes WHERE id = ?`,
            [id]
        );
        if (!nfe) {
            res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            return null;
        }
        const statusAtual = String(nfe.status || '').toLowerCase();
        if (!STATUS_CORRIGIVEL.includes(statusAtual)) {
            res.status(409).json({
                success: false,
                errorCode: 'NFE_IMUTAVEL',
                message: `NF-e com status "${nfe.status}" não pode ser corrigida. `
                    + 'Documento fiscal já definitivo exige Carta de Correção ou cancelamento.'
            });
            return null;
        }
        if (!nfe.xml_nfe && !nfe.xml_assinado) {
            res.status(400).json({
                success: false,
                errorCode: 'XML_AUSENTE',
                message: 'Esta NF-e ainda não tem XML gerado. Gere a nota antes de corrigir.'
            });
            return null;
        }
        return nfe;
    }

    // Devolve o diagnóstico da rejeição + os campos editáveis com o valor que está HOJE no XML.
    router.get('/nfes/:id/correcao', authenticateToken, async (req, res) => {
        try {
            await nfesColumnsReady;
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID da NF-e inválido' });
            }

            if (!await FiscalAccessService.podeReemitirNfe(pool, req.user)) {
                return res.status(403).json({
                    success: false,
                    errorCode: 'RBAC_DENIED',
                    message: 'Seu perfil não possui permissão para corrigir NF-e. '
                        + 'É necessário ter permissão para criar no Faturamento.'
                });
            }

            const nfe = await carregarNfeParaCorrecao(id, res);
            if (!nfe) return;

            const painel = NfeCorrecaoService.montarPainelCorrecao(nfe);
            return res.json({
                success: true,
                data: {
                    nfe: { id: nfe.id, numero: nfe.numero, serie: nfe.serie, status: nfe.status },
                    ...painel
                }
            });
        } catch (error) {
            console.error(`[FATURAMENTO] Erro ao montar correção da NF-e ${req.params.id}:`, error);
            return res.status(error.code === 'XML_INVALIDO' || error.code === 'XML_VAZIO' ? 400 : 500).json({
                success: false,
                errorCode: error.code || 'CORRECAO_ERRO',
                message: mensagemSegura(error)
            });
        }
    });

    // Aplica as correções dentro do XML. Não transmite: a tela chama /enviar-sefaz em seguida,
    // mantendo um único caminho de transmissão (com o lock e a auditoria que ele já tem).
    router.put('/nfes/:id/correcao', authenticateToken, async (req, res) => {
        try {
            await nfesColumnsReady;
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID da NF-e inválido' });
            }

            if (!await FiscalAccessService.podeReemitirNfe(pool, req.user)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${req.user.id} tentou corrigir NF-e ${id} sem permissão`);
                return res.status(403).json({
                    success: false,
                    errorCode: 'RBAC_DENIED',
                    message: 'Seu perfil não possui permissão para corrigir NF-e. '
                        + 'É necessário ter permissão para criar no Faturamento.'
                });
            }

            const nfe = await carregarNfeParaCorrecao(id, res);
            if (!nfe) return;

            // Parte do XML NÃO assinado quando ele existe: é o documento canônico. O assinado só
            // entra como origem se a nota nunca teve a versão limpa persistida.
            const xmlOrigem = nfe.xml_nfe || nfe.xml_assinado;
            const correcoes = req.body?.correcoes;
            const reclassificarNaoContribuinte = req.body?.confirmarNaoContribuinte === true;
            if (reclassificarNaoContribuinte && !(correcoes
                && String(correcoes['dest.indIEDest']) === '9'
                && Object.prototype.hasOwnProperty.call(correcoes, 'dest.IE')
                && String(correcoes['dest.IE'] || '').trim() === '')) {
                return res.status(400).json({
                    success: false,
                    errorCode: 'CONFIRMACAO_FISCAL_INVALIDA',
                    message: 'Para reclassificar como não contribuinte, confirme o indicador 9 e remova a IE.'
                });
            }
            const { xml, alteracoes } = NfeCorrecaoService.aplicarCorrecoes(xmlOrigem, correcoes);

            // A assinatura e o protocolo antigos morrem junto com o conteúdo que assinavam.
            await pool.query(
                `UPDATE nfes
                    SET xml_nfe = ?,
                        xml_assinado = NULL,
                        xml_protocolo = NULL,
                        sefaz_codigo_status = ?,
                        sefaz_motivo = ?,
                        sefaz_tipo_retorno = ?,
                        status = ?
                  WHERE id = ?`,
                [xml, String(nfe.sefaz_codigo_status) === '302' ? '302' : null,
                    String(nfe.sefaz_codigo_status) === '302' ? nfe.sefaz_motivo : null,
                    String(nfe.sefaz_codigo_status) === '302' ? nfe.sefaz_tipo_retorno : null,
                    String(nfe.sefaz_codigo_status) === '302' ? 'rejeitada' : 'pendente', id]
            );

            // Espelha na tabela o que a tela mostra fora do XML, senão a listagem continua
            // exibindo o nome antigo do destinatário depois da correção.
            const valores = NfeCorrecaoService.lerCamposDoXml(xml);
            await pool.query(
                `UPDATE nfes SET destinatario_nome = COALESCE(NULLIF(?, ''), destinatario_nome),
                                 natureza_operacao = COALESCE(NULLIF(?, ''), natureza_operacao),
                                 destinatario_uf = COALESCE(NULLIF(?, ''), destinatario_uf)
                   WHERE id = ?`,
                [valores['dest.xNome'] || '', valores['ide.natOp'] || '', valores['enderDest.UF'] || '', id]
            );

            if (reclassificarNaoContribuinte && nfe.cliente_id) {
                const [[clienteAntes]] = await pool.query(
                    'SELECT id, inscricao_estadual, fiscal_contribuinte_icms FROM clientes WHERE id = ? LIMIT 1',
                    [nfe.cliente_id]
                );
                await pool.query(
                    'UPDATE clientes SET inscricao_estadual = NULL, fiscal_contribuinte_icms = 0 WHERE id = ?',
                    [nfe.cliente_id]
                );
                await logAuditEvent(pool, {
                    userId: req.user.id,
                    action: 'RECLASSIFICAR_DESTINATARIO_NAO_CONTRIBUINTE',
                    module: 'faturamento',
                    description: `NF-e ${nfe.numero}: destinatário reclassificado expressamente como não contribuinte`,
                    previousData: clienteAntes || null,
                    newData: { cliente_id: nfe.cliente_id, inscricao_estadual: null, fiscal_contribuinte_icms: 0 },
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                });
            }

            console.log(`[FATURAMENTO-CORRECAO] NF-e ${nfe.numero} corrigida por ${req.user.id}: `
                + alteracoes.map(a => `${a.campo}: "${a.de}" → "${a.para}"`).join(' | '));

            const statusResposta = String(nfe.sefaz_codigo_status) === '302' ? 'rejeitada' : 'pendente';
            return res.json({
                success: true,
                message: `${alteracoes.length} ${alteracoes.length === 1 ? 'campo corrigido' : 'campos corrigidos'}. `
                    + (reclassificarNaoContribuinte
                        ? 'Destinatário registrado como não contribuinte; a SEFAZ fará a validação final no reenvio.'
                        : 'A nota está pronta para nova validação.'),
                data: { nfe_id: id, alteracoes, status: statusResposta, reclassificadoNaoContribuinte: reclassificarNaoContribuinte }
            });
        } catch (error) {
            const esperado = ['CORRECAO_INVALIDA', 'CAMPO_BLOQUEADO', 'XML_INVALIDO', 'XML_VAZIO'];
            if (!esperado.includes(error.code)) {
                console.error(`[FATURAMENTO] Erro ao corrigir NF-e ${req.params.id}:`, error);
            }
            return res.status(esperado.includes(error.code) ? 400 : 500).json({
                success: false,
                errorCode: error.code || 'CORRECAO_ERRO',
                message: mensagemSegura(error)
            });
        }
    });

    // ============================================================
    // ITENS FISCAIS DA NF-e (NCM/CFOP/preço) — correção de rejeição por item
    // ============================================================
    // NCM/CFOP/alíquotas não vêm de `pedido_itens` — são resolvidos ao vivo do cadastro do
    // produto (`produtos`) a cada emissão/regeneração (ver JOIN em /gerar-nfe, ~linha 1297).
    // Por isso "corrigir" aqui edita o CADASTRO DO PRODUTO (vale para pedidos futuros também,
    // não só esta nota) — e o único caminho para a nota pegar o valor novo é "Regerar XML"
    // (que já recalcula os impostos do zero), nunca um patch de nó dentro do XML como as
    // rotas /correcao acima fazem para os campos de cabeçalho.

    router.get('/nfes/:id/itens-fiscais', authenticateToken, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID da NF-e inválido' });
            }
            if (!await FiscalAccessService.podeReemitirNfe(pool, req.user)) {
                return res.status(403).json({
                    success: false,
                    errorCode: 'RBAC_DENIED',
                    message: 'Seu perfil não possui permissão para corrigir NF-e.'
                });
            }

            const [[nfe]] = await pool.query(
                'SELECT id, numero, serie, pedido_id, status FROM nfes WHERE id = ?', [id]
            );
            if (!nfe) return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            if (!nfe.pedido_id) {
                return res.status(409).json({
                    success: false,
                    errorCode: 'SEM_PEDIDO',
                    message: 'Esta NF-e não está vinculada a um pedido — não é possível editar itens por aqui.'
                });
            }
            const statusAtual = String(nfe.status || '').toLowerCase();
            if (!STATUS_CORRIGIVEL.includes(statusAtual)) {
                return res.status(409).json({
                    success: false,
                    errorCode: 'NFE_IMUTAVEL',
                    message: `NF-e com status "${nfe.status}" não pode ser corrigida.`
                });
            }

            const [itens] = await pool.query(`
                SELECT
                    pi.id AS item_id, pi.produto_id, pi.codigo, pi.descricao, pi.quantidade,
                    pi.preco_unitario,
                    COALESCE(pr_id.ncm, pr_cod.ncm) AS ncm,
                    COALESCE(pr_id.cfop_saida_interna, pr_cod.cfop_saida_interna) AS cfop_saida_interna,
                    COALESCE(pr_id.cfop_saida_interestadual, pr_cod.cfop_saida_interestadual) AS cfop_saida_interestadual,
                    COALESCE(pr_id.id, pr_cod.id) AS produto_resolvido_id
                FROM pedido_itens pi
                LEFT JOIN produtos pr_id  ON pr_id.id = pi.produto_id
                LEFT JOIN produtos pr_cod ON pr_id.id IS NULL
                                         AND NULLIF(pi.codigo,'') IS NOT NULL
                                         AND pr_cod.codigo = pi.codigo
                WHERE pi.pedido_id = ?
                ORDER BY pi.id
            `, [nfe.pedido_id]);

            return res.json({
                success: true,
                data: {
                    nfe: { id: nfe.id, numero: nfe.numero, serie: nfe.serie, pedido_id: nfe.pedido_id },
                    itens: itens.map(it => ({
                        item_id: it.item_id,
                        produto_id: it.produto_resolvido_id || it.produto_id,
                        codigo: it.codigo,
                        descricao: it.descricao,
                        quantidade: it.quantidade,
                        preco_unitario: it.preco_unitario,
                        ncm: it.ncm || '',
                        cfop_saida_interna: it.cfop_saida_interna || '',
                        cfop_saida_interestadual: it.cfop_saida_interestadual || ''
                    }))
                }
            });
        } catch (error) {
            console.error(`[FATURAMENTO] Erro ao carregar itens fiscais da NF-e ${req.params.id}:`, error);
            return res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    router.put('/nfes/:id/itens-fiscais', authenticateToken, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID da NF-e inválido' });
            }
            if (!await FiscalAccessService.podeReemitirNfe(pool, req.user)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${req.user.id} tentou corrigir itens fiscais da NF-e ${id} sem permissão`);
                return res.status(403).json({
                    success: false,
                    errorCode: 'RBAC_DENIED',
                    message: 'Seu perfil não possui permissão para corrigir NF-e.'
                });
            }

            const [[nfe]] = await pool.query(
                'SELECT id, numero, pedido_id, status FROM nfes WHERE id = ?', [id]
            );
            if (!nfe) return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            if (!nfe.pedido_id) {
                return res.status(409).json({
                    success: false, errorCode: 'SEM_PEDIDO',
                    message: 'Esta NF-e não está vinculada a um pedido.'
                });
            }
            const statusAtual = String(nfe.status || '').toLowerCase();
            if (!STATUS_CORRIGIVEL.includes(statusAtual)) {
                return res.status(409).json({
                    success: false, errorCode: 'NFE_IMUTAVEL',
                    message: `NF-e com status "${nfe.status}" não pode ser corrigida.`
                });
            }

            const itensBody = Array.isArray(req.body?.itens) ? req.body.itens : [];
            if (!itensBody.length) {
                return res.status(400).json({ success: false, message: 'Nenhum item enviado.' });
            }

            // Valida tudo ANTES de gravar qualquer coisa — não queremos meio pedido corrigido.
            const validados = [];
            for (const it of itensBody) {
                const itemId = parseInt(it.item_id, 10);
                if (!Number.isInteger(itemId) || itemId <= 0) {
                    return res.status(400).json({ success: false, message: 'item_id inválido em um dos itens.' });
                }
                const entrada = { item_id: itemId, produto_id: it.produto_id ? parseInt(it.produto_id, 10) : null };
                try {
                    if (it.ncm != null && String(it.ncm).trim() !== '') {
                        entrada.ncm = CalculoTributosService.ValidacaoFiscal.validarNCM(it.ncm);
                    }
                    if (it.cfop_saida_interna != null && String(it.cfop_saida_interna).trim() !== '') {
                        entrada.cfop_saida_interna = CalculoTributosService.ValidacaoFiscal.validarCFOP(it.cfop_saida_interna);
                    }
                    if (it.cfop_saida_interestadual != null && String(it.cfop_saida_interestadual).trim() !== '') {
                        entrada.cfop_saida_interestadual = CalculoTributosService.ValidacaoFiscal.validarCFOP(it.cfop_saida_interestadual);
                    }
                } catch (eValidacao) {
                    return res.status(400).json({ success: false, errorCode: 'CAMPO_FISCAL_INVALIDO', message: eValidacao.message });
                }
                if (it.preco_unitario != null && String(it.preco_unitario).trim() !== '') {
                    const preco = Number(String(it.preco_unitario).replace(',', '.'));
                    if (!Number.isFinite(preco) || preco <= 0) {
                        return res.status(400).json({
                            success: false, errorCode: 'PRECO_INVALIDO',
                            message: `Preço unitário inválido: "${it.preco_unitario}".`
                        });
                    }
                    entrada.preco_unitario = preco;
                }
                validados.push(entrada);
            }

            const connection = await pool.getConnection();
            const alteracoes = [];
            try {
                await connection.beginTransaction();
                for (const it of validados) {
                    const [[itemAtual]] = await connection.query(
                        'SELECT produto_id, quantidade FROM pedido_itens WHERE id = ? AND pedido_id = ?',
                        [it.item_id, nfe.pedido_id]
                    );
                    if (!itemAtual) {
                        throw Object.assign(
                            new Error(`Item ${it.item_id} não pertence ao pedido desta NF-e.`),
                            { code: 'ITEM_FORA_DO_PEDIDO' }
                        );
                    }
                    const produtoId = it.produto_id || itemAtual.produto_id;
                    const mexeuFiscal = it.ncm || it.cfop_saida_interna || it.cfop_saida_interestadual;

                    if (mexeuFiscal && !produtoId) {
                        throw Object.assign(
                            new Error(`Item ${it.item_id} não tem produto vinculado — cadastre o produto antes de corrigir NCM/CFOP.`),
                            { code: 'PRODUTO_AUSENTE' }
                        );
                    }

                    if (mexeuFiscal && produtoId) {
                        const sets = [];
                        const vals = [];
                        if (it.ncm) { sets.push('ncm = ?'); vals.push(it.ncm); }
                        if (it.cfop_saida_interna) { sets.push('cfop_saida_interna = ?'); vals.push(it.cfop_saida_interna); }
                        if (it.cfop_saida_interestadual) { sets.push('cfop_saida_interestadual = ?'); vals.push(it.cfop_saida_interestadual); }
                        vals.push(produtoId);
                        await connection.query(`UPDATE produtos SET ${sets.join(', ')} WHERE id = ?`, vals);
                        alteracoes.push({
                            item_id: it.item_id, produto_id: produtoId, ncm: it.ncm || undefined,
                            cfop_saida_interna: it.cfop_saida_interna || undefined,
                            cfop_saida_interestadual: it.cfop_saida_interestadual || undefined
                        });
                    }

                    if (it.preco_unitario) {
                        const subtotal = Math.round(it.preco_unitario * Number(itemAtual.quantidade) * 100) / 100;
                        await connection.query(
                            'UPDATE pedido_itens SET preco_unitario = ?, subtotal = ? WHERE id = ?',
                            [it.preco_unitario, subtotal, it.item_id]
                        );
                        alteracoes.push({ item_id: it.item_id, preco_unitario: it.preco_unitario });
                    }
                }
                await connection.commit();
            } catch (erroTx) {
                await connection.rollback();
                throw erroTx;
            } finally {
                connection.release();
            }

            console.log(`[FATURAMENTO-CORRECAO-ITENS] NF-e ${nfe.numero} — itens fiscais corrigidos por ${req.user.id}: ${JSON.stringify(alteracoes)}`);

            return res.json({
                success: true,
                message: `${validados.length} ${validados.length === 1 ? 'item corrigido' : 'itens corrigidos'}. `
                    + 'Use "Regerar XML" para a nota assumir os novos dados fiscais.',
                data: { nfe_id: id, alteracoes }
            });
        } catch (error) {
            const esperado = ['ITEM_FORA_DO_PEDIDO', 'PRODUTO_AUSENTE', 'CAMPO_FISCAL_INVALIDO', 'PRECO_INVALIDO'];
            if (!esperado.includes(error.code)) {
                console.error(`[FATURAMENTO] Erro ao corrigir itens fiscais da NF-e ${req.params.id}:`, error);
            }
            return res.status(esperado.includes(error.code) ? 400 : 500).json({
                success: false,
                errorCode: error.code || 'ITENS_FISCAIS_ERRO',
                message: mensagemSegura(error)
            });
        }
    });


    // ============================================================
    // CONFERIR NF-e EM HOMOLOGAÇÃO (ensaio, sem valor fiscal)
    // ============================================================
    //
    // Submete a nota ao ambiente de homologação da SEFAZ e devolve o mesmo cStat que a
    // produção devolveria — sem gravar nada, sem consumir numeração e sem contar no guard
    // de consumo indevido. É a alternativa ao ciclo "emitir em produção → rejeitar ou
    // cancelar → emitir de novo", que queima numeração a cada tentativa.
    // Ver modules/Faturamento/services/nfe-homologacao.service.js.
    router.post('/nfes/:id/conferir-homologacao', authenticateToken, async (req, res) => {
        try {
            await nfesColumnsReady;
            const { conferirEmHomologacao } = require('../services/nfe-homologacao.service');
            const resultado = await conferirEmHomologacao(pool, req.params.id);

            console.log(`[HOMOLOGACAO] NF-e ${resultado.numero}/${resultado.serie} conferida por `
                + `${req.user?.nome || req.user?.email || 'usuario'}: `
                + `cStat ${resultado.codigoStatus} — ${resultado.motivo}`);

            return res.json({
                success: true,
                ...resultado,
                mensagem: resultado.aprovado
                    ? `Conferência OK: a SEFAZ autorizaria esta nota (cStat ${resultado.codigoStatus}). `
                      + 'Nada foi gravado — envie em produção para valer.'
                    : `A SEFAZ REJEITARIA esta nota: ${resultado.codigoStatus} — ${resultado.motivo}. `
                      + 'Corrija antes de enviar em produção.'
            });
        } catch (error) {
            console.error('[HOMOLOGACAO] Falha na conferência:', error.message);
            return res.status(400).json({
                success: false,
                errorCode: 'CONFERENCIA_HOMOLOGACAO_ERRO',
                message: mensagemSegura(error)
            });
        }
    });

    // ============================================================
    // ENVIAR NF-e PARA SEFAZ
    // ============================================================

    router.post('/nfes/:id/enviar-sefaz', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await nfesColumnsReady;
            const { id } = req.params;
            const usuario_id = req.user.id;

            // AUDITORIA ENTERPRISE: RBAC - Envio à SEFAZ é operação fiscal crítica.
            // Mesma decisão de /pedidos/:id/reemitir-nfe: perfis fiscais legados continuam
            // liberados e os demais respeitam a permissão granular `faturamento.criar`. Esta é
            // a rota que RETRANSMITE uma nota rejeitada, então travá-la só por role deixava
            // logistica@ (role 'user', com faturamento.criar=1) sem conseguir reemitir.
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();
            const podeTransmitir = await FiscalAccessService.podeReemitirNfe(pool, req.user);

            if (!podeTransmitir) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuario_id} (${userRole || 'sem perfil'}) tentou enviar NFe ${id} à SEFAZ sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Permissão insuficiente',
                    message: 'Seu perfil não possui permissão para enviar NF-e à SEFAZ. É necessário ter permissão para criar no Faturamento.',
                    errorCode: 'RBAC_DENIED'
                });
            }

            // Buscar NFe
            const [nfes] = await connection.query(`SELECT * FROM nfes WHERE id = ?`, [id]);

            if (nfes.length === 0) {
                return res.status(404).json({ success: false, message: 'NFe não encontrada' });
            }

            const nfe = nfes[0];

            // Nota cujo faturamento foi revertido (rollback) é um registro encerrado: retransmiti-la
            // autorizaria um documento fiscal sem pedido, sem estoque e sem título.
            if (nfe.rollback_em) {
                return res.status(409).json({
                    success: false,
                    errorCode: 'NFE_REVERTIDA',
                    message: `A NF-e ${nfe.numero} teve o faturamento revertido e não pode ser enviada à SEFAZ. Fature o pedido novamente.`
                });
            }

            // Rejeições e falhas de comunicação podem ser corrigidas e reenviadas.
            // Estados fiscais finais continuam bloqueados.
            const statusAtual = String(nfe.status || '').toLowerCase();
            if (!['pendente', 'rejeitada', 'erro'].includes(statusAtual)) {
                return res.status(400).json({
                    success: false,
                    message: `NFe não pode ser enviada. Status atual: ${nfe.status}`
                });
            }

            // Gate equivalente ao preflight de ERPs fiscais maduros: cadastro,
            // identidade do A1, ambiente, endpoints, persistência e XSD precisam
            // estar coerentes antes de assinar/transmitir. A consulta online fica
            // fora daqui para não transformar oscilação do status em dupla chamada;
            // a própria autorização continua sendo a fonte de verdade da SEFAZ.
            const prontidao = await FiscalReadinessService.auditar(pool, { consultarSefaz: false });
            if (!prontidao.prontoEmitir) {
                return res.status(409).json({
                    success: false,
                    errorCode: 'FISCAL_NAO_PRONTO',
                    message: 'A configuração fiscal não passou no diagnóstico de pré-emissão.',
                    diagnostico: prontidao
                });
            }

            console.log(`[FATURAMENTO-SEFAZ] Usuário ${usuario_id} enviando NFe ${nfe.numero_nfe} à SEFAZ`);

            // Verificar se XML existe
            if (!nfe.xml_nfe) {
                return res.status(400).json({
                    success: false,
                    message: 'XML da NF-e não foi gerado. Regenere a NF-e antes de enviar à SEFAZ.'
                });
            }

            // Rejeição 302: só reenviar após a SEFAZ confirmar regularização.
            // Preserva o retorno original e não tenta alterar IE/indicador para contorná-lo.
            if (String(nfe.sefaz_codigo_status) === '302') {
                try {
                    const valoresDestinatario = NfeCorrecaoService.lerCamposDoXml(nfe.xml_nfe);
                    const naoContribuinteConfirmado = req.body?.confirmarNaoContribuinte === true
                        && valoresDestinatario['dest.indIEDest'] === '9'
                        && !String(valoresDestinatario['dest.IE'] || '').trim();
                    await garantirCertificadoPersistido();
                    await require('../../../services/nfe-cadastro-preflight').validarAntesTransmissao(nfe.xml_nfe, {
                        pemCert: certificadoService.getCertificadoPEM(), pemKey: certificadoService.getChavePrivadaPEM()
                    }, {
                        exigirDestinatarioHabilitado: true,
                        permitirDestinatarioNaoContribuinteDeclarado: naoContribuinteConfirmado
                    });
                } catch (error) {
                    return res.status(422).json({ success: false, errorCode: 'DESTINATARIO_IRREGULAR', message: error.message });
                }
            }

            // A data de emissão da nota rejeitada é a do XML persistido — esta rota não
            // regenera o documento, e o `dhEmi` não é corrigível: o mês/ano dele compõe a
            // chave de acesso já numerada (trocar um sem o outro dá rejeição 502). Auditar
            // ANTES de assinar evita queimar uma transmissão para colher 228/703 e força a
            // revisão consciente quando a nota é de outro dia.
            const auditoriaData = XmlNFeService.auditarDataEmissao(nfe.xml_nfe);
            if (['expirada', 'futura', 'ausente'].includes(auditoriaData.situacao)) {
                console.warn(`[FATURAMENTO-SEFAZ] NF-e ${nfe.numero} barrada por data de emissão ${auditoriaData.situacao} (${auditoriaData.dataBR})`);
                return res.status(422).json({
                    success: false,
                    errorCode: 'DATA_EMISSAO_INVALIDA',
                    message: auditoriaData.mensagem,
                    dataEmissao: auditoriaData
                });
            }
            if (auditoriaData.situacao === 'antiga' && req.body?.confirmarDataAntiga !== true) {
                return res.status(409).json({
                    success: false,
                    errorCode: 'DATA_EMISSAO_ANTIGA',
                    message: auditoriaData.mensagem,
                    dataEmissao: auditoriaData
                });
            }

            // Corrige XMLs legados que possuem <dup> mas não possuem o grupo <fat>.
            // A SEFAZ rejeita esse formato com cStat 851 porque não há vLiq para
            // comparar com a soma das parcelas. A transformação é idempotente e
            // preserva chave, número e todos os demais dados fiscais da NF-e.
            const xmlIeCorrigido = XmlNFeService.normalizarInscricoesEstaduais(nfe.xml_nfe);
            // Rejeição 853: venda à vista não pode levar <cobr>. Corrigir aqui (e não só
            // no gerador) porque esta rota REAPROVEITA o `xml_nfe` já gravado — sem isso a
            // nota rejeitada antes da correção seria rejeitada de novo, igual.
            const xmlSemCobrancaAVista = XmlNFeService.removerCobrancaAVista(xmlIeCorrigido);
            const xmlCobrancaCorrigida = XmlNFeService.garantirFaturaParaDuplicatas(xmlSemCobrancaAVista);
            if (xmlCobrancaCorrigida !== nfe.xml_nfe) {
                nfe.xml_nfe = xmlCobrancaCorrigida;
                await connection.query(
                    `UPDATE nfes SET xml_nfe = ? WHERE id = ?`,
                    [xmlCobrancaCorrigida, id]
                );
                console.log(`[FATURAMENTO-SEFAZ] XML da NF-e ${nfe.numero} foi normalizado antes da retransmissão`);
            }

            // O `xml_nfe` é um retrato do pedido no instante em que a nota foi gerada. Se o
            // pedido mudou depois, retransmitir autoriza o retrato velho em silêncio — foi
            // isso que deixou a NF-e 4300 (gerada "A VISTA", pedido hoje em 4 parcelas)
            // parada esperando revisão manual. A conferência roda DEPOIS dos corretores,
            // porque é este XML que vai para a SEFAZ.
            if (nfe.pedido_id) {
                const [pedidoDaNfe] = await connection.query(
                    `SELECT * FROM pedidos WHERE id = ? LIMIT 1`,
                    [nfe.pedido_id]
                );
                const divergencia = auditarContraPedido(nfe.xml_nfe, pedidoDaNfe[0]);
                if (divergencia.divergente && req.body?.confirmarDivergencia !== true) {
                    console.warn(`[FATURAMENTO-SEFAZ] NF-e ${nfe.numero} diverge do pedido ${nfe.pedido_id}: `
                        + divergencia.divergencias.map(d => d.campo).join(', '));
                    return res.status(409).json({
                        success: false,
                        errorCode: 'XML_DIVERGENTE_DO_PEDIDO',
                        message: divergencia.mensagem,
                        divergencias: divergencia.divergencias
                    });
                }
            }

            // NÃO REPÚDIO + OBRIGATORIEDADE POR CATEGORIA: confere no XML que vai de fato à
            // SEFAZ os campos que a categoria da nota é obrigada a informar e grava
            // usuário + categoria + horário ANTES de transmitir. Roda depois dos corretores
            // acima, porque é este XML que segue. Sem o log gravado, a nota não é enviada.
            let autorizacaoEnvio;
            try {
                autorizacaoEnvio = await require('../../../services/nfe-envio-gate.service')
                    .autorizarEnvio(pool, nfe.xml_nfe, { req, nfe, empresaId: req.user?.empresa_id });
            } catch (gateError) {
                if (gateError.code === 'CAMPOS_OBRIGATORIOS_CATEGORIA') {
                    console.warn(`[FATURAMENTO-SEFAZ] NF-e ${nfe.numero} barrada por campos obrigatórios (${gateError.categoria}): `
                        + gateError.pendencias.map(p => p.campo).join(', '));
                    return res.status(422).json({
                        success: false,
                        errorCode: 'CAMPOS_OBRIGATORIOS_CATEGORIA',
                        categoria: gateError.categoria,
                        message: gateError.message,
                        pendencias: gateError.pendencias.map(p => ({ campo: p.campo, item: p.item?.indice ?? null, mensagem: p.mensagem }))
                    });
                }
                if (gateError.code === 'AUDITORIA_INDISPONIVEL') {
                    return res.status(503).json({ success: false, errorCode: 'AUDITORIA_INDISPONIVEL', message: gateError.message });
                }
                throw gateError;
            }

            // Assinar XML com certificado digital antes de enviar
            // [FIX] Nunca enviar XML sem assinatura — falha de assinatura = abortar envio
            let xmlAssinado;
            try {
                await garantirCertificadoPersistido();
                xmlAssinado = await certificadoService.assinarXML(nfe.xml_nfe, 'infNFe');
                await connection.query(
                    `UPDATE nfes SET xml_assinado = ? WHERE id = ?`,
                    [xmlAssinado, id]
                );
            } catch (certError) {
                console.error(`[FATURAMENTO] ✗ Assinatura falhou: ${certError.message}`);
                const mensagemCertificado = 'Não foi possível assinar o XML com o certificado digital. '
                    + (certError.message.includes('não carregado')
                        ? 'Nenhum certificado foi configurado. Acesse Configurações → Fiscal para enviar o arquivo .pfx.'
                        : 'Verifique se o certificado está válido e a senha está correta. Detalhe: ' + certError.message);
                await registrarFalhaSefaz(connection, id, {
                    codigo: 'CERTIFICADO_INVALIDO',
                    motivo: mensagemCertificado,
                    tipo: 'certificado'
                });
                return res.status(401).json({
                    success: false,
                    errorCode: 'CERTIFICADO_INVALIDO',
                    message: mensagemCertificado
                });
            }

            // Enviar para SEFAZ
            const resultado = await sefazService.autorizarNFe(xmlAssinado, nfe.emitente_uf);

            if (resultado.autorizado) {
                await connection.beginTransaction();

                await connection.query(`
                    UPDATE nfes
                    SET status = 'autorizada',
                        protocolo_autorizacao = ?,
                        chave_acesso = COALESCE(chave_acesso, ?),
                        data_autorizacao = NOW(),
                        xml_protocolo = ?,
                        autorizado_por = ?,
                        sefaz_codigo_status = NULL,
                        sefaz_motivo = NULL,
                        sefaz_data_retorno = NOW(),
                        sefaz_ambiente = ?,
                        sefaz_tipo_retorno = 'autorizacao'
                    WHERE id = ?
                `, [resultado.numeroProtocolo, resultado.chaveAcesso, resultado.xmlCompleto, usuario_id, ambienteSefazAtual, id]);

                await connection.commit();

                await require('../../../services/nfe-envio-gate.service').registrarDesfecho(
                    pool, autorizacaoEnvio, 'AUTORIZADA',
                    { codigo: '100', motivo: `Protocolo ${resultado.numeroProtocolo}`, chaveAcesso: resultado.chaveAcesso });

                // AUDITORIA ENTERPRISE: Log de autorização SEFAZ
                console.log(`[FATURAMENTO-AUDIT] ✅ NFe ${nfe.numero_nfe} AUTORIZADA pela SEFAZ. Protocolo: ${resultado.numeroProtocolo}. Usuário: ${usuario_id}`);

                // FIX: Baixar estoque efetivamente após autorização SEFAZ
                const integracoesSefaz = { estoque: null, logistica: null, avisos: [] };
                try {
                    integracoesSefaz.estoque = await vendasEstoqueService.baixarEstoque(parseInt(id), usuario_id);
                    console.log(`[FATURAMENTO-AUDIT] ✅ Estoque baixado para NFe ${nfe.numero_nfe}`);
                } catch (estoqueErr) {
                    integracoesSefaz.avisos.push(`Baixa de estoque não concluída: ${estoqueErr.message}`);
                    console.warn(`[FATURAMENTO] ⚠ Estoque não baixado para NFe ${id}: ${estoqueErr.message}`);
                }

                integracoesSefaz.logistica = await sincronizarExpedicaoAposAutorizacao(nfe);
                if (!integracoesSefaz.logistica.sincronizada) {
                    integracoesSefaz.avisos.push('Expedição não sincronizada automaticamente; revisar na Logística.');
                }

                // Aviso de "nota fiscal emitida" (DANFE + XML) logo após a
                // autorização — vai para a operação, para o cliente e para
                // quem emitiu.
                const emailDanfe = { enviado: false };
                try {
                    const r = await enviarDanfeEmail(parseInt(id), { emitidoPorEmail: req.user?.email });
                    emailDanfe.enviado = r.enviado;
                    emailDanfe.destinatarios = r.destinatarios;
                } catch (emailErr) {
                    console.warn(`[FATURAMENTO-EMAIL] ⚠ Aviso de NF-e emitida falhou: ${emailErr.message}`);
                }

                res.json({
                    success: true,
                    message: integracoesSefaz.avisos.length === 0
                        ? 'NFe autorizada pela SEFAZ e estoque baixado'
                        : 'NFe autorizada pela SEFAZ (com avisos)',
                    protocolo: resultado.numeroProtocolo,
                    chaveAcesso: resultado.chaveAcesso,
                    integracoes: integracoesSefaz,
                    email: emailDanfe
                });
            } else {
                await registrarFalhaSefaz(connection, id, {
                    status: 'rejeitada',
                    codigo: resultado.codigoStatus || 'SEFAZ_REJEITADA',
                    motivo: resultado.motivo || 'NF-e rejeitada sem motivo detalhado',
                    tipo: 'rejeicao'
                });
                await require('../../../services/nfe-envio-gate.service').registrarDesfecho(
                    pool, autorizacaoEnvio, 'REJEITADA_SEFAZ',
                    { codigo: resultado.codigoStatus, motivo: resultado.motivo });
                res.status(400).json({
                    success: false,
                    message: 'NFe rejeitada pela SEFAZ',
                    codigo: resultado.codigoStatus,
                    motivo: resultado.motivo,
                    ambiente: ambienteSefazAtual,
                    dataRetorno: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao enviar NFe:', error);
            // HOTFIX: Diferenciar causa raiz — certificado/credencial vs erro genérico
            const msg = (error.message || '').toLowerCase();
            if (msg.includes('certificado') || msg.includes('certificate') || msg.includes('pfx') || msg.includes('pkcs12')) {
                await registrarFalhaSefaz(connection, req.params.id, {
                    codigo: 'CERTIFICADO_INVALIDO',
                    motivo: 'Certificado digital inválido, expirado ou não encontrado. Verifique o arquivo .pfx e a senha nas configurações do sistema.',
                    tipo: 'certificado'
                }).catch(() => {});
                return res.status(401).json({
                    success: false,
                    errorCode: 'CERTIFICADO_INVALIDO',
                    message: 'Certificado digital inválido, expirado ou não encontrado. Verifique o arquivo .pfx e a senha nas configurações do sistema.'
                });
            }
            if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('credencial') || msg.includes('credential')) {
                await registrarFalhaSefaz(connection, req.params.id, {
                    codigo: 'CREDENCIAL_SEFAZ',
                    motivo: 'Credenciais de acesso à SEFAZ inválidas. Verifique o certificado digital e as configurações de integração.',
                    tipo: 'credencial'
                }).catch(() => {});
                return res.status(401).json({
                    success: false,
                    errorCode: 'CREDENCIAL_SEFAZ',
                    message: 'Credenciais de acesso à SEFAZ inválidas. Verifique o certificado digital e as configurações de integração.'
                });
            }
            if (msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('enotfound') || msg.includes('socket')) {
                await registrarFalhaSefaz(connection, req.params.id, {
                    codigo: 'SEFAZ_INDISPONIVEL',
                    motivo: 'Não foi possível conectar à SEFAZ. O serviço pode estar temporariamente indisponível. Tente novamente em alguns minutos.',
                    tipo: 'comunicacao'
                }).catch(() => {});
                return res.status(502).json({
                    success: false,
                    errorCode: 'SEFAZ_INDISPONIVEL',
                    message: 'Não foi possível conectar à SEFAZ. O serviço pode estar temporariamente indisponível. Tente novamente em alguns minutos.'
                });
            }
            // [GUARD consumo indevido] Barrado ANTES de transmitir — não é uma rejeição da
            // SEFAZ, é a blindagem local (nfe-transmissao-guard.service.js) impedindo mais uma
            // tentativa em cima de rejeições recentes. Não sobrescreve sefaz_motivo com um erro
            // genérico de comunicação — a nota mantém o motivo da rejeição real anterior.
            if (error.code === 'TRANSMISSAO_BLOQUEADA_GUARD') {
                console.warn(`[FATURAMENTO] Transmissão bloqueada pela blindagem local (NF-e ${req.params.id}): ${error.message}`);
                return res.status(429).json({
                    success: false,
                    errorCode: 'TRANSMISSAO_BLOQUEADA',
                    message: error.message
                });
            }
            await registrarFalhaSefaz(connection, req.params.id, {
                codigo: 'SEFAZ_ERRO',
                motivo: mensagemSegura(error),
                tipo: 'comunicacao'
            }).catch(() => {});
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // ENVIAR DANFE POR EMAIL (MANUAL)
    // ============================================================

    router.post('/nfes/:id/enviar-email', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { email: emailOverride } = req.body;

            const [[nfeData]] = await pool.query(
                `SELECT n.numero, n.valor_total, n.cliente_id, n.destinatario_nome,
                        c.email, c.email_nfe, c.nome as cliente_nome
                 FROM nfes n LEFT JOIN clientes c ON n.cliente_id = c.id
                 WHERE n.id = ?`, [id]
            );

            if (!nfeData) {
                return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            }

            // A nota vai SEMPRE para a logística (DANFE_DESTINATARIOS_FIXOS). O endereço do
            // cliente NÃO é mais usado como padrão: antes, clicar "enviar" sem digitar nada
            // mandava a NF-e para o e-mail cadastrado do cliente sem ninguém decidir isso.
            // Agora só sai para terceiro se alguém digitar o endereço explicitamente.
            const result = await enviarDanfeEmail(parseInt(id), {
                destinatarioExtra: emailOverride || null,
                emitidoPorEmail: req.user?.email
            });

            if (result.enviado) {
                res.json({ success: true, message: `DANFE enviada para ${(result.destinatarios || [emailDest]).join(', ')}` });
            } else {
                res.status(500).json({ success: false, message: result.motivo || 'Falha ao enviar email' });
            }
        } catch (error) {
            console.error('[FATURAMENTO-EMAIL] Erro:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // ESPELHO DE NOTA — Pré-visualização DANFE oficial com dados reais
    // Usa o mesmo template danfe.html (layout oficial) do danfe-renderer
    // ============================================================

    router.get('/nfes/:id/espelho', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            if (req.query.origem === 'pedido') {
                const htmlPedido = await montarDanfePedidoFaturado(id);
                if (!htmlPedido) {
                    return res.status(404).json({ success: false, message: 'Pedido faturado não encontrado' });
                }
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.send(htmlPedido);
            }

            const { renderDanfe, resolverLogoDanfeDataUri, gerarCodigoBarrasDataUri } =
                require(path.resolve(__dirname, '../../../routes/danfe-renderer'));

            // Buscar NF-e completa com dados do cliente
            const [nfes] = await pool.query(`
                SELECT n.*,
                       c.nome AS cli_nome, c.razao_social AS cli_razao_social,
                       COALESCE(c.cnpj, c.cnpj_cpf) AS cli_cnpj, c.inscricao_estadual AS cli_ie,
                       c.endereco AS cli_endereco, c.bairro AS cli_bairro,
                       c.cidade AS cli_cidade, c.estado AS cli_uf, c.cep AS cli_cep,
                       c.telefone AS cli_telefone, c.email AS cli_email,
                       -- A tabela nfes nao guarda informacoes adicionais; o texto vive no pedido
                       -- de origem. Sem este JOIN o DANFE da nota emitida saia com o quadro vazio.
                       p.info_complementar AS ped_info_complementar,
                       p.dados_adicionais_nf AS ped_dados_adicionais_nf,
                       p.condicao_pagamento AS ped_condicao_pagamento,
                       p.parcelas AS ped_parcelas
                FROM nfes n
                LEFT JOIN clientes c ON c.id = n.cliente_id
                LEFT JOIN pedidos p ON p.id = n.pedido_id
                WHERE n.id = ?
            `, [id]);

            if (!nfes.length) return res.status(404).json({ success: false, message: 'NF-e não encontrada' });

            const nfe = nfes[0];
            const [itens] = await pool.query('SELECT * FROM nfe_itens WHERE nfe_id = ?', [id]);

            // Dados do emitente — prioridade: configuracoes_empresa → configuracoes → env
            let emit = {
                razaoSocial: 'ALUFORCE INDÚSTRIA E COMÉRCIO LTDA',
                nomeFantasia: 'ALUFORCE',
                cnpj: process.env.EMITENTE_CNPJ || '',
                ie: process.env.EMITENTE_IE || '',
                logradouro: '', numero: '', bairro: '', cidade: '',
                uf: process.env.EMITENTE_UF || 'SP',
                cep: '', telefone: '', email: '', logoPath: ''
            };
            try {
                const [ceRows] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
                if (ceRows && ceRows[0] && (ceRows[0].cnpj || ceRows[0].razao_social)) {
                    const e = ceRows[0];
                    emit = { razaoSocial: e.razao_social || emit.razaoSocial, nomeFantasia: e.nome_fantasia || emit.nomeFantasia, cnpj: e.cnpj || '', ie: e.inscricao_estadual || '', logradouro: e.endereco || '', numero: e.numero || '', bairro: e.bairro || '', cidade: e.cidade || '', uf: e.estado || 'SP', cep: e.cep || '', telefone: e.telefone || '', email: e.email || '', logoPath: e.logo_path || '' };
                } else {
                    const [cfgRows] = await pool.query(`SELECT * FROM configuracoes WHERE chave = 'empresa_emitente' LIMIT 1`);
                    const cfg = cfgRows.length ? JSON.parse(cfgRows[0].valor || '{}') : {};
                    if (cfg.cnpj) emit = { ...emit, ...cfg, cidade: cfg.cidade || cfg.municipio || '', logradouro: cfg.logradouro || cfg.endereco || '' };
                }
            } catch (_) {}
            // Logo oficial da instância (na Aluforce, a arte azul atual do diretório images).
            // Caminhos antigos persistidos no banco não podem substituir a marca do espelho.
            const emitLogoUrl = resolverLogoDanfeDataUri()
                || emit.logoPath
                || '/images/Logo Monocromatico - Azul - Aluforce.png';

            const fmtMoney = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const fmtQty   = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
            const fmtDate  = d => { if (!d) return ''; const dt = new Date(d); return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('pt-BR'); };
            const fmtTime  = d => { if (!d) return ''; const dt = new Date(d); return isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };

            // Uma rejeição pode possuir chave calculada, mas não protocolo. Ela continua sendo
            // PRÉVIA e precisa do aviso "sem valor fiscal"; chave isolada nunca a torna DANFE.
            const isPreview = !podeGerarDanfe(nfe);
            const chave     = nfe.chave_acesso || '';
            const valorTotal = parseFloat(nfe.valor || nfe.valor_total || 0);
            const frete     = parseFloat(nfe.valor_frete || 0);
            const desconto  = parseFloat(nfe.valor_desconto || 0);
            const seguro    = parseFloat(nfe.valor_seguro || 0);
            const outras    = parseFloat(nfe.outras_despesas || 0);
            const valorNF   = valorTotal || ((itens || []).reduce((s, i) => s + parseFloat(i.valor_total || 0), 0)) + frete + seguro + outras - desconto;

            // Duplicatas da NF-e: as que o XML gravado REALMENTE carrega (<cobr>), a mesma fonte
            // que a DANFE da nota autorizada usa. Antes vinham só de `nfe_duplicatas` — tabela que
            // nenhum código grava e que nem existe na produção — e o try/catch engolia o erro: o
            // espelho de uma NF-e já gerada saía sem parcelas, enquanto o XML tinha as duplicatas.
            // A data é lida do texto AAAA-MM-DD (sem `new Date`, que a interpretaria em UTC e
            // poderia voltar um dia).
            let dups = [];
            const cobrXml = String(nfe.xml_nfe || nfe.xml_assinado || '').match(/<cobr>[\s\S]*?<\/cobr>/);
            if (cobrXml) {
                dups = [...cobrXml[0].matchAll(/<dup>([\s\S]*?)<\/dup>/g)].map((m, i) => {
                    const tag = (nome) => { const r = m[1].match(new RegExp(`<${nome}>([^<]*)</${nome}>`)); return r ? r[1].trim() : ''; };
                    const [ano, mes, dia] = tag('dVenc').slice(0, 10).split('-');
                    return {
                        nDup: tag('nDup') || String(i + 1).padStart(3, '0'),
                        dVenc: (ano && mes && dia) ? `${dia}/${mes}/${ano}` : '',
                        vDup: fmtMoney(tag('vDup'))
                    };
                });
            }
            if (!dups.length) {
                try {
                    const [dupRows] = await pool.query('SELECT * FROM nfe_duplicatas WHERE nfe_id = ? ORDER BY numero', [id]);
                    dups = dupRows.map(d => ({
                        nDup: d.numero || '',
                        dVenc: fmtDate(d.vencimento),
                        vDup: fmtMoney(d.valor)
                    }));
                } catch (e) { /* tabela pode não existir */ }
            }

            // Destinatário — separar logradouro/numero
            const splitEnd = str => { const m = (str || '').match(/^(.+?),\s*(\S+.*)$/); return m ? [m[1].trim(), m[2].trim()] : [(str || ''), '']; };
            const [dstLgr, dstNro] = splitEnd(nfe.cli_endereco || nfe.endereco_destinatario || '');

            // Montar contexto no formato NFe.infNFe (mesmo utilizado pelo danfe-renderer)
            const ctx = {
                marcaAguaClasse: isPreview ? '' : 'hidden',
                avisoTopo: isPreview ? 'DOCUMENTO DE PRÉVIA — NÃO POSSUI VALOR FISCAL' : '',
                paginaAtual: '1',
                paginaTotal: '1',
                codigoBarrasUrl: gerarCodigoBarrasDataUri(chave),
                emitenteLogoUrl: emitLogoUrl,
                portalConsultaUrl: 'www.nfe.fazenda.gov.br/portal',
                NFe: {
                    infNFe: {
                        ide: {
                            nNF: nfe.numero || nfe.numero_nfe || '',
                            serie: nfe.serie || '1',
                            tpNF: nfe.tipo_operacao || '1',
                            natOp: nfe.natureza_operacao || 'Venda de Mercadoria',
                            dhEmi: fmtDate(nfe.data_emissao),
                            dhSaiEnt: fmtDate(nfe.data_saida || nfe.data_emissao),
                            _danfeHoraSaida: fmtTime(nfe.data_saida || nfe.data_emissao)
                        },
                        emit: {
                            xNome: emit.razaoSocial,
                            xFant: emit.nomeFantasia,
                            CNPJ: emit.cnpj,
                            CPF: '',
                            IE: emit.ie,
                            IEST: '',
                            CRT: nfe.crt || '',
                            IM: '',
                            email: emit.email,
                            enderEmit: {
                                xLgr: emit.logradouro,
                                nro: emit.numero,
                                xCpl: '',
                                xBairro: emit.bairro,
                                xMun: emit.cidade,
                                UF: emit.uf,
                                CEP: emit.cep,
                                fone: emit.telefone
                            }
                        },
                        dest: {
                            xNome: nfe.destinatario || nfe.cli_razao_social || nfe.cli_nome || '',
                            CNPJ: (nfe.cli_cnpj || '').length > 11 ? (nfe.cli_cnpj || '') : '',
                            CPF: (nfe.cli_cnpj || '').length <= 11 ? (nfe.cli_cnpj || '') : '',
                            IE: nfe.cli_ie || '',
                            // Mesmo helper da emissão — o espelho não pode dizer '1' onde
                            // o XML leva '2' (isento de inscrição) ou '9'.
                            indIEDest: resolverIndicadorIE({ ie: nfe.cli_ie }).indicadorIE,
                            enderDest: {
                                xLgr: dstLgr,
                                nro: dstNro,
                                xCpl: '',
                                xBairro: nfe.cli_bairro || '',
                                xMun: nfe.cli_cidade || '',
                                UF: nfe.cli_uf || '',
                                CEP: nfe.cli_cep || '',
                                fone: nfe.cli_telefone || ''
                            }
                        },
                        cobr: {
                            fat: {
                                nFat: nfe.numero || nfe.numero_nfe || '',
                                vOrig: fmtMoney(valorNF),
                                vLiq: fmtMoney(valorNF - desconto)
                            },
                            dup: dups
                        },
                        det: (itens || []).map((item, i) => ({
                            prod: {
                                cProd: item.codigo_produto || item.codigo || String(i + 1).padStart(3, '0'),
                                xProd: item.descricao || '',
                                NCM: item.ncm || '',
                                CFOP: item.cfop || '',
                                uCom: item.unidade || 'UN',
                                qCom: fmtQty(item.quantidade),
                                vUnCom: fmtMoney(item.valor_unitario),
                                vProd: fmtMoney(item.valor_total)
                            },
                            _danfeCstCsosn: item.cst || item.csosn || '',
                            _danfeBcIcms: fmtMoney(item.base_icms || item.valor_total || 0),
                            _danfeVIcms: fmtMoney(item.valor_icms || 0),
                            _danfePIcms: item.aliquota_icms ? fmtMoney(item.aliquota_icms) : '',
                            _danfeVIpi: fmtMoney(item.valor_ipi || 0),
                            _danfePIpi: item.aliquota_ipi ? fmtMoney(item.aliquota_ipi) : ''
                        })),
                        total: {
                            ICMSTot: {
                                vBC: fmtMoney(nfe.base_calculo_icms || 0),
                                vICMS: fmtMoney(nfe.valor_icms || 0),
                                vBCST: fmtMoney(nfe.base_calculo_st || 0),
                                vST: fmtMoney(nfe.valor_icms_st || 0),
                                vTotTrib: fmtMoney(nfe.valor_tributos || 0),
                                vProd: fmtMoney((itens || []).reduce((s, i) => s + parseFloat(i.valor_total || 0), 0)),
                                vFCPSTRet: '0,00',
                                vFrete: fmtMoney(frete),
                                vSeg: fmtMoney(seguro),
                                vDesc: fmtMoney(desconto),
                                vOutro: fmtMoney(outras),
                                vIPI: fmtMoney(nfe.valor_ipi || 0),
                                vNF: fmtMoney(valorNF),
                                vII: '0,00'
                            },
                            ISSQNtot: { vServ: '', vBC: '', vISS: '', cMunFG: '' }
                        },
                        transp: {
                            modFrete: require(path.resolve(__dirname, '../../_shared/services/nfe-pedido.mapper')).rotuloModFreteDanfe(nfe.modalidade_frete),
                            transporta: {
                                xNome: nfe.transportadora_nome || '',
                                CNPJ: nfe.transportadora_cnpj || '',
                                CPF: '', IE: '', xEnder: '', xMun: '', UF: ''
                            },
                            veicTransp: { placa: nfe.placa_veiculo || '', UF: '', RNTC: '' },
                            _danfeQVol: nfe.qtd_volumes || '',
                            _danfeEsp: nfe.especie_volumes || '',
                            _danfeMarca: '', _danfeNVol: '',
                            _danfePesoB: nfe.peso_bruto ? fmtMoney(nfe.peso_bruto) : '',
                            _danfePesoL: nfe.peso_liquido ? fmtMoney(nfe.peso_liquido) : ''
                        },
                        infAdProd: '',
                        infAdic: {
                            // Mesmo texto montado na emissão (gerar-nfe) e no espelho, para o DANFE
                            // da nota emitida não divergir do que foi efetivamente ao SEFAZ.
                            infCpl: (function () {
                                const adicionais = String(
                                    nfe.ped_info_complementar || nfe.ped_dados_adicionais_nf || ''
                                ).trim();
                                if (!nfe.pedido_id) return adicionais;
                                const prefixo = `Pedido Nº ${nfe.pedido_id} | Condição: ${
                                    nfe.ped_condicao_pagamento || nfe.ped_parcelas || 'A Vista'
                                }`;
                                return adicionais ? `${prefixo}\n${adicionais}` : prefixo;
                            })(),
                            infAdFisco: ''
                        }
                    }
                },
                protNFe: {
                    infProt: {
                        chNFe: chave,
                        nProt: nfe.protocolo_autorizacao || (isPreview ? 'Pré-autorização' : ''),
                        dhRecbto: fmtDate(nfe.data_autorizacao || nfe.data_emissao)
                    }
                }
            };

            const html = renderDanfe(ctx);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao gerar espelho:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // GERAR E BAIXAR DANFE
    // ============================================================

    // [FIX] DANFE usa o mesmo template HTML do espelho (danfe-renderer.js / danfe.html)
    // O PDFKit gerava layout diferente do modelo oficial definido em danfe.html.
    // Solução: retornar HTML do template oficial — usuário imprime via browser (Ctrl+P).
    router.get('/nfes/:id/danfe', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;

            // Origem = pedido faturado
            if (req.query.origem === 'pedido') {
                const htmlPedido = await montarDanfePedidoFaturado(id);
                if (!htmlPedido) return res.status(404).json({ success: false, message: 'Pedido faturado não encontrado' });
                // Este ramo sai ANTES do bloco de PDF lá embaixo, então precisa tratar
                // `formato=pdf` por conta própria — senão o botão "Salvar PDF" de um DANFE
                // aberto por `origem=pedido` continuaria recebendo HTML.
                if (String(req.query.formato || '').toLowerCase() === 'pdf') {
                    const { htmlParaPdf } = require(path.resolve(__dirname, '../../../services/pdf-render.service'));
                    const pdfPedido = await htmlParaPdf(htmlPedido);
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
                    res.setHeader('Content-Disposition', `attachment; filename="DANFE pedido ${id} - ERP.pdf"`);
                    return res.send(pdfPedido);
                }
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Content-Disposition', `inline; filename="danfe-pedido-${id}.html"`);
                return res.send(htmlPedido);
            }

            const { montarDanfeNfe } =
                require(path.resolve(__dirname, '../../../services/danfe-nfe-document.service'));

            const [nfes] = await pool.query(`
                SELECT n.*,
                       c.nome AS cli_nome, c.razao_social AS cli_razao_social,
                       COALESCE(c.cnpj, c.cnpj_cpf) AS cli_cnpj, c.inscricao_estadual AS cli_ie,
                       c.endereco AS cli_endereco, c.bairro AS cli_bairro,
                       c.cidade AS cli_cidade, c.estado AS cli_uf, c.cep AS cli_cep,
                       c.telefone AS cli_telefone, c.email AS cli_email
                FROM nfes n LEFT JOIN clientes c ON c.id = n.cliente_id
                WHERE n.id = ?
            `, [id]);

            if (!nfes.length) return res.status(404).json({ success: false, message: 'NFe não encontrada' });

            const nfe = nfes[0];

            // BUG-FAT-005: o DANFE é o Documento Auxiliar de uma NF-e AUTORIZADA pela SEFAZ.
            // Não gerar DANFE para nota em rascunho/pendente (não tem chave nem protocolo). Para
            // conferência antes da emissão, usar o espelho (?origem=pedido ou a rota /espelho).
            if (!podeGerarDanfe(nfe)) {
                // Navegação humana (window.open/link) deve cair no espelho em vez de mostrar
                // JSON cru. Integrações continuam recebendo 409 estruturado para não mascarar
                // que DANFE fiscal não existe.
                const aceitaHtml = String(req.headers.accept || '').toLowerCase().includes('text/html');
                if (aceitaHtml) {
                    return res.redirect(302, `/api/faturamento/nfes/${encodeURIComponent(id)}/espelho`);
                }
                return res.status(409).json({
                    success: false,
                    code: 'NFE_NAO_AUTORIZADA',
                    message: 'DANFE disponível apenas para NF-e autorizada. Esta nota está em "' + (nfe.status || 'rascunho') + '". Use o espelho para pré-visualização.'
                });
            }

            // Esta é a mesma fonte usada pelo anexo de e-mail. Qualquer ajuste visual ou
            // fiscal passa a aparecer de forma idêntica na tela, no download e no PDF enviado.
            const { html } = await montarDanfeNfe(pool, id);

            // `?formato=pdf` devolve o MESMO documento em PDF. Antes só existia HTML, e o
            // visualizador (report-viewer.js) mandava "Salvar PDF" para esta rota esperando
            // `application/pdf` — recebia text/html e morria em "O servidor não retornou um
            // arquivo PDF". O nome definitivo vai no Content-Disposition: é dele que o
            // visualizador tira o nome, então "Salvar PDF" e "Download" gravam o mesmo arquivo.
            if (String(req.query.formato || '').toLowerCase() === 'pdf') {
                const { htmlParaPdf } = require(path.resolve(__dirname, '../../../services/pdf-render.service'));
                const pdf = await htmlParaPdf(html);
                // ASCII no `filename` e a versão UTF-8 no `filename*` (RFC 5987): nome de
                // cliente com acento quebra o cabeçalho simples em alguns navegadores.
                const cliente = String(nfe.destinatario_nome || nfe.cli_razao_social || nfe.cli_nome || 'Cliente').trim();
                // ̀-ͯ escrito por escape, não pelos caracteres combinantes
                // literais: no literal, qualquer reencode do arquivo apaga a classe em silêncio.
                const limpo = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Cliente';
                const base = `NF ${nfe.numero || id} - ${limpo(cliente)} - ERP.pdf`;
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
                res.setHeader('Content-Disposition',
                    `attachment; filename="${base}"; filename*=UTF-8''`
                    + encodeURIComponent(`NF ${nfe.numero || id} - ${cliente} - ERP.pdf`));
                return res.send(pdf);
            }

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `inline; filename="DANFE-NF${nfe.numero || id}.html"`);
            res.send(html);

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao gerar DANFE:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // CARTA DE CORREÇÃO
    // ============================================================

    router.post('/nfes/:id/carta-correcao', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        let transacaoAberta = false;
        try {
            const { id } = req.params;
            const { correcao } = req.body;
            const usuario_id = req.user.id;

            // AUDITORIA ENTERPRISE: RBAC - Carta de Correção é evento fiscal, porém corretivo
            // e não destrutivo: perfis fiscais legados seguem liberados e os demais respondem
            // pela permissão granular `faturamento.editar`.
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();

            if (!await FiscalAccessService.podeEmitirCartaCorrecao(pool, req.user)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuario_id} (${userRole || 'sem perfil'}) tentou emitir CC-e para NFe ${id} sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Seu perfil não possui permissão para emitir Carta de Correção. É necessário ter permissão para editar no Faturamento.'
                });
            }

            const correcaoLimpa = String(correcao || '').trim();

            if (correcaoLimpa.length < 15) {
                return res.status(400).json({
                    success: false,
                    message: 'Correção deve ter no mínimo 15 caracteres'
                });
            }

            // VALIDAÇÃO FISCAL: Limite máximo de 1000 caracteres
            if (correcaoLimpa.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'Correção não pode exceder 1000 caracteres conforme regra SEFAZ'
                });
            }

            await Promise.all([nfesColumnsReady, nfeEventosColumnsReady]);
            await connection.beginTransaction();
            transacaoAberta = true;

            // Serializa a sequência da CC-e. Sem o lock, dois cliques simultâneos
            // poderiam transmitir o mesmo nSeqEvento à SEFAZ.
            const [nfes] = await connection.query(`SELECT * FROM nfes WHERE id = ? FOR UPDATE`, [id]);

            if (nfes.length === 0) {
                const erro = new Error('NF-e não encontrada');
                erro.statusCode = 404;
                throw erro;
            }

            const nfe = nfes[0];
            const statusNfe = String(nfe.status || '').toLowerCase().trim();
            const chaveAcesso = String(nfe.chave_acesso || '').replace(/\D/g, '');
            const protocoloAutorizacao = String(nfe.protocolo_autorizacao || '').trim();
            const cnpjEmitente = String(nfe.emitente_cnpj || '').replace(/\D/g, '');
            const ufEmitente = String(nfe.emitente_uf || '').trim().toUpperCase();

            if (statusNfe !== 'autorizada' || chaveAcesso.length !== 44 || !protocoloAutorizacao) {
                const erro = new Error('Somente NF-e autorizada, com chave e protocolo de autorização, pode receber Carta de Correção.');
                erro.statusCode = 409;
                throw erro;
            }
            if (!/^[A-Z]{2}$/.test(ufEmitente) || cnpjEmitente.length !== 14) {
                const erro = new Error('Dados fiscais do emitente incompletos (UF/CNPJ). Corrija a configuração fiscal antes de registrar a CC-e.');
                erro.statusCode = 409;
                throw erro;
            }

            // Contar sequência de CC-e — nas DUAS origens. A tela de Vendas emite CC-e pelo
            // próprio caminho e grava em `pedido_cce`; contando só `nfe_eventos` a sequência
            // se repetiria e a SEFAZ recusaria por duplicidade de evento.
            const [cces] = await connection.query(`
                SELECT COUNT(*) as total FROM nfe_eventos
                WHERE nfe_id = ? AND tipo_evento = '110110'
            `, [id]);
            const [[ccesPedido]] = nfe.pedido_id
                ? await connection.query(
                    'SELECT COUNT(*) AS total FROM pedido_cce WHERE pedido_id = ?', [nfe.pedido_id]
                ).catch(() => [[{ total: 0 }]])
                : [[{ total: 0 }]];

            const sequencia = Number(cces[0].total) + Number(ccesPedido?.total || 0) + 1;
            if (sequencia > 20) {
                const erro = new Error('Limite de 20 Cartas de Correção atingido para esta NF-e.');
                erro.statusCode = 409;
                throw erro;
            }

            // Enviar CC-e
            const resultado = await sefazService.cartaCorrecao(
                chaveAcesso,
                correcaoLimpa,
                ufEmitente,
                cnpjEmitente,
                sequencia
            );

            // Para CC-e, apenas 135 comprova registro E vínculo com a NF-e.
            const cStat = String(resultado?.codigoStatus || '');
            if (cStat !== '135') {
                await connection.rollback();
                transacaoAberta = false;
                return res.status(400).json({
                    success: false,
                    error: 'SEFAZ_REJEITOU',
                    errorCode: 'SEFAZ_REJEITOU',
                    message: `SEFAZ não vinculou a CC-e à NF-e (cStat ${cStat || '?'}: ${resultado?.motivo || 'sem retorno'}).`,
                    codigo: cStat || null
                });
            }

            await connection.query(`
                INSERT INTO nfe_eventos (
                    nfe_id, tipo_evento, sequencia, descricao, descricao_evento,
                    protocolo, protocolo_evento, xml_evento, status, data_evento, created_at
                ) VALUES (?, '110110', ?, ?, ?, ?, ?, ?, 'registrado', NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    descricao = VALUES(descricao),
                    descricao_evento = VALUES(descricao_evento),
                    protocolo = VALUES(protocolo),
                    protocolo_evento = VALUES(protocolo_evento),
                    xml_evento = VALUES(xml_evento),
                    status = 'registrado',
                    data_evento = VALUES(data_evento)
            `, [id, sequencia, correcaoLimpa, correcaoLimpa.substring(0, 255),
                resultado.numeroProtocolo || null, resultado.numeroProtocolo || null,
                resultado.xmlCompleto || null]);

            await connection.commit();
            transacaoAberta = false;

            logAuditEvent(pool, {
                userId: usuario_id,
                action: 'CARTA_CORRECAO_NFE',
                module: 'faturamento',
                description: `CC-e ${sequencia} registrada para NF-e ${nfe.numero}`,
                previousData: { nfe_id: id, numero_nfe: nfe.numero, sequencia_anterior: sequencia - 1 },
                newData: { sequencia, protocolo: resultado.numeroProtocolo || null },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            // A CC-e altera o que está declarado na nota que acompanha a carga — quem separa
            // e quem expede precisa ver o texto da correção, não descobrir na conferência.
            enviarAvisoEventoFiscal({
                nfeId: parseInt(id),
                evento: 'CARTA DE CORREÇÃO',
                emitidoPorEmail: req.user?.email,
                detalhes: {
                    'Sequência da CC-e': sequencia,
                    'Correção': correcaoLimpa,
                    'Protocolo do evento': resultado.numeroProtocolo || '—',
                    'Registrada por': req.user?.nome || req.user?.email || usuario_id
                }
            }).catch(() => {});

            res.json({
                success: true,
                message: `Carta de Correção nº ${sequencia} registrada e vinculada à NF-e.`,
                protocolo: resultado.numeroProtocolo,
                sequencia,
                impressao_url: `/api/faturamento/nfes/${id}/carta-correcao/${sequencia}/imprimir`
            });

        } catch (error) {
            if (transacaoAberta) await connection.rollback();
            console.error('[FATURAMENTO] Erro na carta de correção:', error);
            const status = error.statusCode || (/Erro ao enviar evento/i.test(error.message || '') ? 502 : 500);
            res.status(status).json({ success: false, message: mensagemSegura(error) });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // INUTILIZAR NUMERAÇÃO
    // ============================================================

    router.post('/inutilizar-numeracao', authenticateToken, async (req, res) => {
        try {
            const { serie, numeroInicial, numeroFinal, justificativa } = req.body;
            const usuario_id = req.user.id;

            // AUDITORIA ENTERPRISE: RBAC - Inutilização queima faixa de numeração e é
            // irreversível. Mesmo critério do cancelamento: roles fiscais legadas OU a
            // permissão granular `faturamento.excluir`.
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();

            if (!await FiscalAccessService.podeInutilizarNumeracao(pool, req.user)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuario_id} (${userRole || 'sem perfil'}) tentou inutilizar numeração sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Inutilização de numeração é uma operação fiscal crítica. É necessário perfil fiscal ou permissão para excluir no Faturamento.'
                });
            }

            // VALIDAÇÃO FISCAL: Justificativa obrigatória (15-255 caracteres)
            if (!justificativa || justificativa.trim().length < 15) {
                return res.status(400).json({
                    success: false,
                    message: 'Justificativa deve ter no mínimo 15 caracteres conforme exigência SEFAZ'
                });
            }
            if (justificativa.length > 255) {
                return res.status(400).json({
                    success: false,
                    message: 'Justificativa excede o limite de 255 caracteres'
                });
            }

            // VALIDAÇÃO: Range de numeração válido
            if (!numeroInicial || !numeroFinal || numeroInicial > numeroFinal) {
                return res.status(400).json({
                    success: false,
                    message: 'Range de numeração inválido. O número inicial deve ser menor ou igual ao final.'
                });
            }

            // VALIDAÇÃO: Limite máximo de 1000 números por inutilização
            if ((numeroFinal - numeroInicial) > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'Não é permitido inutilizar mais de 1000 números por operação'
                });
            }

            console.log(`[FATURAMENTO] Usuário ${usuario_id} solicitando inutilização: série ${serie}, ${numeroInicial}-${numeroFinal}`);

            const resultado = await sefazService.inutilizarNumeracao({
                ano: new Date().getFullYear().toString().substring(2),
                cnpj: req.user.empresa_cnpj,
                modelo: '55',
                serie,
                numeroInicial,
                numeroFinal,
                justificativa
            }, req.user.empresa_uf);

            if (resultado.sucesso) {
                // FISCAL-03: Extrair protocolo SEFAZ do resultado e persistir
                const protocolo_sefaz = resultado.protocolo || resultado.nProt || resultado.numProtocolo || null;
                const anoInut = new Date().getFullYear().toString().substring(2);
                const empresa_id_inut = req.user?.empresa_id || 1;

                // Registrar inutilização com auditoria + protocolo SEFAZ
                await pool.query(`
                    INSERT INTO nfe_inutilizacoes (
                        empresa_id, serie, numero_inicial, numero_final, ano, modelo,
                        justificativa, protocolo, xml_inutilizacao, status, data_inutilizacao, usuario_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, '55', ?, ?, ?, 'processado', NOW(), ?, NOW())
                `, [empresa_id_inut, serie, numeroInicial, numeroFinal, anoInut, justificativa, protocolo_sefaz, resultado.xmlCompleto, usuario_id]);

                await marcarNfesDaFaixaComoInutilizadas(
                    Number(serie), Number(numeroInicial), Number(numeroFinal), new Date().getFullYear()
                );

                res.json({
                    success: true,
                    message: 'Numeração inutilizada',
                    protocolo: protocolo_sefaz
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Inutilização rejeitada'
                });
            }

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao inutilizar:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // INUTILIZAÇÕES — GET e POST /inutilizacoes
    // Frontend: modules/Faturamento/public/inutilizacao.html
    // ============================================================

    router.get('/inutilizacoes', authenticateToken, async (req, res) => {
        try {
            const { serie, ano } = req.query;
            let sql = `
                SELECT id, serie, numero_inicial, numero_final, ano, modelo, justificativa,
                       protocolo, status, codigo_status, motivo_status,
                       data_inutilizacao, created_at
                FROM nfe_inutilizacoes
                WHERE 1=1
            `;
            const params = [];
            if (serie !== undefined && serie !== '') { sql += ' AND serie = ?'; params.push(serie); }
            if (ano) {
                // O histórico grava o ano com 4 dígitos; instalações antigas podem ter
                // gravado 2. O filtro aceita as duas formas.
                const dig = String(ano).replace(/\D/g, '');
                const completo = dig.length === 2 ? 2000 + Number(dig) : Number(dig);
                sql += ' AND ano IN (?, ?)';
                params.push(completo, completo % 100);
            }
            sql += ' ORDER BY created_at DESC LIMIT 200';

            const [rows] = await pool.query(sql, params);
            res.json(rows);
        } catch (error) {
            console.error('[FATURAMENTO/INUTILIZACOES] Erro ao listar:', error);
            res.json([]);
        }
    });

    // Inutilizar numeração é operação fiscal crítica: mesmo gate do endpoint legado
    // /inutilizar-numeracao. As roles fiscais vivem no fiscal-access.service junto com o
    // fallback por `faturamento.excluir` — sem ele a tela ficava utilizável só por admin,
    // já que nenhuma das instâncias tem usuário 'gerente_fiscal' ou 'contador'.
    const podeInutilizar = (req) =>
        FiscalAccessService.podeInutilizarNumeracao(pool, req.user);

    // O formulário manda o ano com 2 ou 4 dígitos. O <ano> do inutNFe exige 2 dígitos;
    // o histórico grava 4 para não misturar "26" e "2026" na mesma coluna.
    // Antes: String(parseInt('26')).substring(2) devolvia string VAZIA e o XML saía
    // com <ano></ano> — rejeição por schema em toda inutilização.
    const normalizarAnoInut = (valor) => {
        const hoje = new Date().getFullYear();
        const dig = String(valor === undefined || valor === null ? '' : valor).replace(/\D/g, '');
        if (!dig) return { completo: hoje, sefaz: String(hoje).slice(-2) };
        if (dig.length === 2) return { completo: 2000 + Number(dig), sefaz: dig };
        if (dig.length === 4) return { completo: Number(dig), sefaz: dig.slice(-2) };
        return null;
    };

    // Transmite a faixa usando o MESMO perfil fiscal do emissor de NF-e.
    // req.user.empresa_cnpj / empresa_uf não existem em nenhum token emitido pelo
    // sistema (ver a rota /sefaz/status, que já contornava isso): o CNPJ ia vazio
    // dentro do Id do <infInut> e a UF caía sempre no default 'SP'.
    async function transmitirInutilizacao({ anoSefaz, serie, numeroInicial, numeroFinal, justificativa }) {
        const FiscalProfile = require('../services/fiscal-profile.service');
        const perfil = await FiscalProfile.carregar(pool);
        const cnpj = String(perfil?.cnpj || '').replace(/\D/g, '');
        const uf = String(perfil?.uf || '').toUpperCase();
        if (cnpj.length !== 14) {
            const e = new Error('CNPJ do emitente não está cadastrado (Configurações › Empresa) — a SEFAZ rejeita a inutilização sem ele.');
            e.statusCode = 400;
            throw e;
        }
        if (uf.length !== 2) {
            const e = new Error('UF do emitente não está cadastrada (Configurações › Empresa).');
            e.statusCode = 400;
            throw e;
        }

        const r = await sefazService.inutilizarNumeracao({
            ano: anoSefaz,
            cnpj,
            modelo: '55',
            serie: String(serie),
            numeroInicial,
            numeroFinal,
            justificativa
        }, uf);

        const xmlRetorno = r?.xmlCompleto || null;
        return {
            sucesso: !!r?.sucesso,
            codigo: r?.codigoStatus ? String(r.codigoStatus) : null,
            motivo: r?.motivo || null,
            // O serviço não devolvia nProt: o protocolo da inutilização homologada
            // era gravado NULL e o histórico mostrava "-" mesmo com sucesso.
            protocolo: r?.protocolo || (String(xmlRetorno || '').match(/<nProt>(\d+)<\/nProt>/) || [])[1] || null,
            xmlEnvio: r?.xmlEnvio || null,
            xmlRetorno
        };
    }

    // Grava a tentativa. `status` reflete o que a SEFAZ respondeu de fato:
    // processado (cStat 102), rejeitado (respondeu e recusou) ou pendente (não deu
    // para falar com ela). 'pendente_sefaz' — usado antes — não existe no enum da
    // coluna e derrubava o INSERT.
    async function registrarInutilizacao(dados) {
        const [ins] = await pool.query(`
            INSERT INTO nfe_inutilizacoes (
                empresa_id, serie, numero_inicial, numero_final, ano, modelo,
                justificativa, protocolo, xml_inutilizacao, xml_retorno,
                status, codigo_status, motivo_status, data_inutilizacao, usuario_id, created_at
            ) VALUES (?, ?, ?, ?, ?, '55', ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW())
        `, [
            dados.empresa_id, dados.serie, dados.ini, dados.fim, dados.ano,
            dados.justificativa, dados.protocolo || null, dados.xmlEnvio || null, dados.xmlRetorno || null,
            dados.status, dados.codigo ? String(dados.codigo).slice(0, 10) : null, dados.motivo ? String(dados.motivo).slice(0, 2000) : null,
            dados.usuario_id
        ]);
        return ins.insertId;
    }

    // Numeração inutilizada não pode voltar a ser distribuída pelo emissor.
    async function avancarSequenciaNFe(serie, numeroFinal) {
        try {
            await pool.query(
                `INSERT INTO nfe_sequences (serie, current_value) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE current_value = GREATEST(current_value, VALUES(current_value))`,
                [serie, numeroFinal]
            );
            // Há telas/fluxos legados que ainda leem estas duas fontes. Mantê-las
            // sincronizadas evita sugerir 904 depois de a faixa 906 ser inutilizada.
            await pool.query(
                `UPDATE empresa_config
                    SET nfe_proximo_numero = GREATEST(COALESCE(nfe_proximo_numero, 1), ?)
                  WHERE COALESCE(nfe_serie, 1) = ?`,
                [numeroFinal + 1, serie]
            ).catch(err => console.warn('[FATURAMENTO/INUTILIZACOES] empresa_config legada não sincronizada:', err.message));
            await pool.query(
                `UPDATE nfe_configuracoes
                    SET ultimo_numero = GREATEST(COALESCE(ultimo_numero, 0), ?)
                  WHERE serie = ?`,
                [numeroFinal, serie]
            ).catch(err => console.warn('[FATURAMENTO/INUTILIZACOES] nfe_configuracoes legada não sincronizada:', err.message));
        } catch (seqErr) {
            console.warn('[FATURAMENTO/INUTILIZACOES] não foi possível sincronizar a numeração:', seqErr.message);
            throw seqErr;
        }
    }

    // A inutilização é da numeração, mas tentativas rejeitadas dessa mesma faixa
    // continuam na tabela `nfes`. Sem sincronizá-las, a listagem mostrava
    // "Rejeitada" mesmo depois de a SEFAZ homologar a inutilização.
    async function marcarNfesDaFaixaComoInutilizadas(serie, numeroInicial, numeroFinal, anoCompleto) {
        await pool.query(`
            UPDATE nfes
               SET status = 'inutilizada'
             WHERE serie = ?
               AND CAST(numero AS UNSIGNED) BETWEEN ? AND ?
               AND (data_emissao IS NULL OR YEAR(data_emissao) = ?)
               AND LOWER(COALESCE(status, '')) NOT IN ('autorizada', 'cancelada', 'denegada')
               AND NOT (COALESCE(protocolo_autorizacao, '') <> '' AND COALESCE(chave_acesso, '') <> '')
        `, [serie, numeroInicial, numeroFinal, anoCompleto]);
    }

    router.post('/inutilizacoes', authenticateToken, async (req, res) => {
        try {
            if (!await podeInutilizar(req)) {
                return res.status(403).json({
                    success: false,
                    error: 'Inutilização de numeração é uma operação fiscal crítica. Apenas administradores, responsáveis fiscais ou o financeiro podem executar.'
                });
            }

            const { ano, serie, numero_inicial, numero_final, justificativa } = req.body;
            const usuario_id = req.user?.id || null;
            const empresa_id = req.user?.empresa_id || 1;

            if (!serie || !numero_inicial || !numero_final || !justificativa) {
                return res.status(400).json({ success: false, error: 'Série, faixa de números e justificativa são obrigatórios' });
            }

            const just = String(justificativa).trim();
            if (just.length < 15) {
                return res.status(400).json({ success: false, error: 'Justificativa deve ter no mínimo 15 caracteres conforme exigência SEFAZ' });
            }
            if (just.length > 255) {
                return res.status(400).json({ success: false, error: 'Justificativa excede o limite de 255 caracteres' });
            }

            const serieNum = Number(String(serie).replace(/\D/g, ''));
            const ini = Number(numero_inicial);
            const fim = Number(numero_final);
            if (!Number.isInteger(serieNum) || serieNum < 0 || serieNum > 999) {
                return res.status(400).json({ success: false, error: 'Série inválida (0 a 999)' });
            }
            if (!Number.isInteger(ini) || ini < 1 || ini > 999999999 || !Number.isInteger(fim) || fim < 1 || fim > 999999999) {
                return res.status(400).json({ success: false, error: 'Faixa inválida (1 a 999999999)' });
            }
            if (fim < ini) {
                return res.status(400).json({ success: false, error: 'Número final deve ser maior ou igual ao inicial' });
            }
            if ((fim - ini + 1) > 10000) {
                return res.status(400).json({ success: false, error: 'Não é permitido inutilizar mais de 10.000 números por operação' });
            }

            const anoInfo = normalizarAnoInut(ano);
            if (!anoInfo || anoInfo.completo < 2000 || anoInfo.completo > 2099) {
                return res.status(400).json({ success: false, error: 'Ano inválido — informe 4 dígitos (ex.: 2026).' });
            }

            // Só um número REALMENTE autorizado impede a inutilização. A checagem
            // anterior barrava qualquer linha de `nfes`, inclusive as rejeitadas —
            // que são exatamente o caso de uso da inutilização.
            const [nfesUsadas] = await pool.query(`
                SELECT numero FROM nfes
                 WHERE serie = ?
                   AND CAST(numero AS UNSIGNED) BETWEEN ? AND ?
                   AND (data_emissao IS NULL OR YEAR(data_emissao) = ?)
                   AND (LOWER(COALESCE(status, '')) IN ('autorizada', 'cancelada', 'denegada')
                        OR (COALESCE(protocolo_autorizacao, '') <> '' AND COALESCE(chave_acesso, '') <> ''))
                 LIMIT 1
            `, [serieNum, ini, fim, anoInfo.completo]);
            if (nfesUsadas.length) {
                return res.status(400).json({
                    success: false,
                    error: `O número ${nfesUsadas[0].numero} da série ${serieNum} já tem autorização na SEFAZ e não pode ser inutilizado.`
                });
            }

            // Sobreposição real de intervalos. A versão anterior só olhava as pontas:
            // uma faixa já inutilizada que CONTIVESSE a nova passava batido. E só
            // faixa homologada bloqueia — tentativa rejeitada/pendente pode ser refeita.
            const [inutilExist] = await pool.query(`
                SELECT id, numero_inicial, numero_final FROM nfe_inutilizacoes
                 WHERE serie = ? AND ano IN (?, ?) AND COALESCE(modelo, '55') = '55'
                   AND status = 'processado'
                   AND numero_inicial <= ? AND numero_final >= ?
                 LIMIT 1
            `, [serieNum, anoInfo.completo, anoInfo.completo % 100, fim, ini]);
            if (inutilExist.length) {
                return res.status(400).json({
                    success: false,
                    error: `A faixa ${inutilExist[0].numero_inicial}-${inutilExist[0].numero_final} já foi inutilizada e homologada nesta série/ano.`
                });
            }

            let envio;
            try {
                envio = await transmitirInutilizacao({
                    anoSefaz: anoInfo.sefaz, serie: serieNum,
                    numeroInicial: ini, numeroFinal: fim, justificativa: just
                });
            } catch (sefazErr) {
                if (sefazErr.statusCode === 400) {
                    return res.status(400).json({ success: false, error: sefazErr.message });
                }
                // Não deu para falar com a SEFAZ: a faixa NÃO foi inutilizada em lugar
                // nenhum. Registra a tentativa como pendente para reenvio pelo histórico.
                console.warn('[FATURAMENTO/INUTILIZACOES] SEFAZ inacessível:', sefazErr.message);
                const idPend = await registrarInutilizacao({
                    empresa_id, serie: serieNum, ini, fim, ano: anoInfo.completo,
                    justificativa: just, status: 'pendente',
                    codigo: 'SEM_SEFAZ', motivo: sefazErr.message, usuario_id
                });
                return res.status(502).json({
                    success: false,
                    id: idPend,
                    sefaz_confirmado: false,
                    sefaz_indisponivel: true,
                    error: 'Não foi possível falar com a SEFAZ: ' + sefazErr.message
                        + ' — a faixa ficou registrada como PENDENTE e pode ser reenviada pelo histórico.'
                });
            }

            const idInut = await registrarInutilizacao({
                empresa_id, serie: serieNum, ini, fim, ano: anoInfo.completo,
                justificativa: just, status: envio.sucesso ? 'processado' : 'rejeitado',
                protocolo: envio.protocolo, xmlEnvio: envio.xmlEnvio, xmlRetorno: envio.xmlRetorno,
                codigo: envio.codigo, motivo: envio.motivo, usuario_id
            });

            if (!envio.sucesso) {
                return res.status(400).json({
                    success: false,
                    id: idInut,
                    sefaz_confirmado: false,
                    codigo_status: envio.codigo,
                    motivo_status: envio.motivo,
                    error: `SEFAZ rejeitou a inutilização${envio.codigo ? ' (cStat ' + envio.codigo + ')' : ''}: ${envio.motivo || 'motivo não informado'}`
                });
            }

            await avancarSequenciaNFe(serieNum, fim);
            await marcarNfesDaFaixaComoInutilizadas(serieNum, ini, fim, anoInfo.completo);

            logAuditEvent(pool, {
                userId: usuario_id,
                action: 'INUTILIZAR_NUMERACAO_NFE',
                module: 'faturamento',
                description: `Faixa ${ini}-${fim} da série ${serieNum} (${anoInfo.completo}) inutilizada na SEFAZ`,
                newData: { id: idInut, protocolo: envio.protocolo, codigo_status: envio.codigo },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            res.json({
                success: true,
                id: idInut,
                message: `Faixa ${ini}-${fim} (série ${serieNum}) inutilizada e homologada pela SEFAZ.`,
                protocolo: envio.protocolo,
                codigo_status: envio.codigo,
                motivo_status: envio.motivo,
                sefaz_confirmado: true
            });
        } catch (error) {
            console.error('[FATURAMENTO/INUTILIZACOES] Erro ao inutilizar:', error);
            res.status(500).json({ success: false, error: 'Erro ao registrar inutilização: ' + mensagemSegura(error) });
        }
    });

    // Reenvia à SEFAZ uma tentativa que não foi homologada (pendente ou rejeitada).
    // Sem isso, uma faixa que caiu por indisponibilidade ficava parada no histórico
    // sem nenhum caminho de retomada.
    router.post('/inutilizacoes/:id/reenviar', authenticateToken, async (req, res) => {
        try {
            if (!await podeInutilizar(req)) {
                return res.status(403).json({
                    success: false,
                    error: 'Inutilização de numeração é uma operação fiscal crítica. Apenas administradores, responsáveis fiscais ou o financeiro podem executar.'
                });
            }

            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id < 1) {
                return res.status(400).json({ success: false, error: 'Identificador inválido' });
            }

            const [[linha]] = await pool.query('SELECT * FROM nfe_inutilizacoes WHERE id = ? LIMIT 1', [id]);
            if (!linha) {
                return res.status(404).json({ success: false, error: 'Inutilização não encontrada' });
            }
            if (linha.status === 'processado') {
                return res.status(400).json({ success: false, error: 'Esta faixa já foi homologada pela SEFAZ — não há o que reenviar.' });
            }

            const anoInfo = normalizarAnoInut(linha.ano);
            let envio;
            try {
                envio = await transmitirInutilizacao({
                    anoSefaz: anoInfo.sefaz,
                    serie: linha.serie,
                    numeroInicial: linha.numero_inicial,
                    numeroFinal: linha.numero_final,
                    justificativa: linha.justificativa
                });
            } catch (sefazErr) {
                if (sefazErr.statusCode === 400) {
                    return res.status(400).json({ success: false, error: sefazErr.message });
                }
                await pool.query(
                    'UPDATE nfe_inutilizacoes SET status = ?, codigo_status = ?, motivo_status = ? WHERE id = ?',
                    ['pendente', 'SEM_SEFAZ', String(sefazErr.message).slice(0, 2000), id]
                );
                return res.status(502).json({
                    success: false,
                    sefaz_indisponivel: true,
                    error: 'Não foi possível falar com a SEFAZ: ' + sefazErr.message
                });
            }

            await pool.query(`
                UPDATE nfe_inutilizacoes
                   SET status = ?, protocolo = ?, codigo_status = ?, motivo_status = ?,
                       xml_inutilizacao = COALESCE(?, xml_inutilizacao),
                       xml_retorno = ?, data_inutilizacao = NOW()
                 WHERE id = ?
            `, [
                envio.sucesso ? 'processado' : 'rejeitado',
                envio.protocolo || null,
                envio.codigo ? String(envio.codigo).slice(0, 10) : null,
                envio.motivo ? String(envio.motivo).slice(0, 2000) : null,
                envio.xmlEnvio || null,
                envio.xmlRetorno || null,
                id
            ]);

            if (!envio.sucesso) {
                return res.status(400).json({
                    success: false,
                    id,
                    sefaz_confirmado: false,
                    codigo_status: envio.codigo,
                    motivo_status: envio.motivo,
                    error: `SEFAZ rejeitou a inutilização${envio.codigo ? ' (cStat ' + envio.codigo + ')' : ''}: ${envio.motivo || 'motivo não informado'}`
                });
            }

            await avancarSequenciaNFe(linha.serie, linha.numero_final);
            const anoCompleto = Number(linha.ano) < 100 ? 2000 + Number(linha.ano) : Number(linha.ano);
            await marcarNfesDaFaixaComoInutilizadas(
                Number(linha.serie), Number(linha.numero_inicial), Number(linha.numero_final), anoCompleto
            );

            logAuditEvent(pool, {
                userId: req.user?.id || null,
                action: 'INUTILIZAR_NUMERACAO_NFE_REENVIO',
                module: 'faturamento',
                description: `Reenvio da faixa ${linha.numero_inicial}-${linha.numero_final} da série ${linha.serie} homologado na SEFAZ`,
                previousData: { status_anterior: linha.status, codigo_anterior: linha.codigo_status },
                newData: { id, protocolo: envio.protocolo, codigo_status: envio.codigo },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            res.json({
                success: true,
                id,
                message: `Faixa ${linha.numero_inicial}-${linha.numero_final} inutilizada e homologada pela SEFAZ.`,
                protocolo: envio.protocolo,
                codigo_status: envio.codigo,
                sefaz_confirmado: true
            });
        } catch (error) {
            console.error('[FATURAMENTO/INUTILIZACOES] Erro ao reenviar:', error);
            res.status(500).json({ success: false, error: 'Erro ao reenviar inutilização: ' + mensagemSegura(error) });
        }
    });

    // ============================================================
    // CONSULTAR STATUS SEFAZ
    // ============================================================

    router.get('/fiscal/readiness', authenticateToken, async (req, res) => {
        try {
            const resultado = await FiscalReadinessService.auditar(pool, {
                consultarSefaz: String(req.query?.sefaz || '1') !== '0'
            });
            return res.status(resultado.prontoEmitir ? 200 : 503).json({
                success: resultado.prontoEmitir,
                ...resultado
            });
        } catch (error) {
            console.error('[FATURAMENTO] Erro no diagnóstico fiscal:', error);
            return res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    router.get('/sefaz/status', authenticateToken, async (req, res) => {
        try {
            // A UF não faz parte de todos os tokens emitidos pelo sistema. Consultar
            // apenas req.user.empresa_uf fazia a tela de faturamento falhar com 500
            // mesmo quando a empresa já estava corretamente cadastrada.
            let uf = req.user?.empresa_uf;
            if (!uf) {
                const [[empresa]] = await pool.query(`
                    SELECT estado
                    FROM configuracoes_empresa
                    WHERE estado IS NOT NULL AND TRIM(estado) <> ''
                    ORDER BY id ASC
                    LIMIT 1
                `);
                uf = empresa?.estado;
            }

            // SP é a UF histórica das instâncias que ainda não possuem o endereço
            // fiscal completo. A preferência continua sendo sempre o cadastro real.
            uf = String(uf || 'SP').trim().toUpperCase();
            const resultado = await sefazService.consultarStatusServico(uf);

            res.json({
                success: true,
                online: resultado.online,
                mensagem: resultado.motivo,
                uf
            });

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao consultar status:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // INTEGRAÇÃO FINANCEIRO - GERAR CONTAS A RECEBER
    // ============================================================

    router.post('/nfes/:id/gerar-financeiro', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { numeroParcelas, diaVencimento, intervalo } = req.body;

            const resultado = await financeiroService.gerarContasReceber(id, {
                numeroParcelas: numeroParcelas || 1,
                diaVencimento: diaVencimento || 30,
                intervalo: intervalo || 30
            });

            res.json({
                success: true,
                message: 'Contas a receber geradas',
                ...resultado
            });

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao gerar financeiro:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // RELATÓRIO DE FATURAMENTO
    // ============================================================

    router.get('/relatorios/faturamento', authenticateToken, async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;

            const [faturamento] = await pool.query(`
                SELECT
                    DATE(n.data_emissao) as data,
                    COUNT(*) as total_nfes,
                    SUM(COALESCE(n.valor_total, 0)) as valor_total,
                    SUM(COALESCE(n.valor_produtos, 0)) as valor_produtos,
                    SUM(COALESCE(n.valor_icms, 0)) as total_icms,
                    SUM(COALESCE(n.pis, 0)) as total_pis,
                    SUM(COALESCE(n.cofins, 0)) as total_cofins
                FROM nfes n
                WHERE n.status = 'autorizada'
                AND n.data_emissao >= ?
                AND n.data_emissao <= ?
                GROUP BY DATE(n.data_emissao)
                ORDER BY data DESC
            `, [data_inicio, data_fim]);

            res.json({
                success: true,
                data: faturamento
            });

        } catch (error) {
            console.error('[FATURAMENTO] Erro no relatório:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // VALIDAR ESTOQUE ANTES DE FATURAR
    // ============================================================

    router.get('/pedidos/:id/validar-estoque', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;

            const resultado = await vendasEstoqueService.validarEstoqueParaFaturamento(id);

            res.json({
                success: true,
                ...resultado
            });

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao validar estoque:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // PRODUTOS MAIS FATURADOS
    // ============================================================

    router.get('/relatorios/produtos-mais-faturados', authenticateToken, async (req, res) => {
        try {
            const { data_inicio, data_fim, limite } = req.query;

            const produtos = await vendasEstoqueService.relatorioProdutosMaisFaturados({
                data_inicio,
                data_fim,
                limite
            });

            res.json({
                success: true,
                data: produtos
            });

        } catch (error) {
            console.error('[FATURAMENTO] Erro no relatório:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // CONFIGURAR CERTIFICADO DIGITAL
    // ============================================================

    router.post('/configuracao/certificado', authenticateToken, async (req, res) => {
        try {
            const { caminhoArquivo, senha } = req.body;
            const usuario_id = req.user.id;

            // AUDITORIA ENTERPRISE: RBAC - Configuração de certificado é operação ultra-crítica
            const rolesPermitidas = ['admin', 'administrador'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();

            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[FATURAMENTO-SEGURANÇA] ⚠️ Usuário ${usuario_id} (${userRole}) tentou carregar certificado digital sem permissão!`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Configuração de certificado digital é uma operação de segurança máxima. Apenas administradores podem executar.'
                });
            }

            // VALIDAÇÃO: Campos obrigatórios
            if (!caminhoArquivo || !senha) {
                return res.status(400).json({
                    success: false,
                    message: 'Caminho do arquivo e senha são obrigatórios'
                });
            }

            // SEGURANÇA: Path traversal protection
            const path = require('path');
            const normalizedPath = path.normalize(caminhoArquivo);
            if (normalizedPath.includes('..') || normalizedPath.includes('//')) {
                console.log(`[FATURAMENTO-SEGURANÇA] ⚠️ Tentativa de path traversal por usuário ${usuario_id}: ${caminhoArquivo}`);
                return res.status(400).json({
                    success: false,
                    message: 'Caminho de arquivo inválido'
                });
            }

            console.log(`[FATURAMENTO] Usuário ${usuario_id} carregando certificado digital`);

            const perfilFiscal = await FiscalProfileService.carregar(pool);
            const resultado = await certificadoService.carregarCertificadoA1(caminhoArquivo, senha, {
                cnpjEsperado: perfilFiscal.cnpj
            });

            console.log(`[FATURAMENTO] ✅ Certificado carregado com sucesso por usuário ${usuario_id}. Validade: ${resultado.validade?.fim}`);

            res.json({
                success: true,
                message: 'Certificado carregado com sucesso',
                ...resultado
            });

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao carregar certificado:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // VERIFICAR VALIDADE DO CERTIFICADO
    // ============================================================

    router.get('/configuracao/certificado/validade', authenticateToken, async (req, res) => {
        try {
            await garantirCertificadoPersistido();
            const validade = certificadoService.verificarValidade();
            const info = certificadoService.getInfoCertificado();

            res.json({
                success: true,
                ...validade,
                ...info
            });

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao verificar certificado:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // ============ GATEWAY PIX - COBRANÇAS AUTOMÁTICAS ============
    // ============================================================

    /**
     * Listar provedores PIX disponíveis
     */
    router.get('/pix/provedores', authenticateToken, async (req, res) => {
        try {
            res.json({
                success: true,
                provedores: [
                    { id: 'mercadopago', nome: 'Mercado Pago', logo: '💰' },
                    { id: 'pagseguro', nome: 'PagSeguro', logo: '💳' },
                    { id: 'gerencianet', nome: 'Gerencianet/EfiBank', logo: '🏦' },
                    { id: 'picpay', nome: 'PicPay', logo: '💚' },
                    { id: 'simulacao', nome: 'Simulação (Dev)', logo: '🧪' }
                ]
            });
        } catch (error) {
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Obter configuração atual do PIX
     */
    router.get('/pix/config', authenticateToken, async (req, res) => {
        try {
            const [configs] = await pool.query('SELECT id, provedor, ativo, chave_pix, tipo_chave, ambiente, criado_em FROM pix_config');
            const ativo = configs.find(c => c.ativo);

            res.json({
                success: true,
                configuracoes: configs,
                ativo: ativo || null
            });
        } catch (error) {
            console.error('[PIX] Erro ao buscar config:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Salvar configuração PIX
     * AUDITORIA ENTERPRISE: Configuração financeira crítica
     */
    router.post('/pix/config', authenticateToken, async (req, res) => {
        try {
            const usuario_id = req.user.id;

            // RBAC - Apenas administradores e gerentes financeiros podem configurar PIX
            const rolesPermitidas = ['admin', 'administrador', 'gerente', 'gerente_financeiro'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();

            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[PIX-RBAC] Usuário ${usuario_id} (${userRole}) tentou alterar configuração PIX sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Apenas administradores ou gerentes financeiros podem configurar gateway PIX.'
                });
            }

            console.log(`[PIX] Usuário ${usuario_id} alterando configuração PIX`);
            const resultado = await pixService.salvarConfiguracao(req.body);
            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro ao salvar config:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Criar cobrança PIX
     */
    router.post('/pix/cobranca', authenticateToken, async (req, res) => {
        try {
            const resultado = await pixService.criarCobranca(req.body);
            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro ao criar cobrança:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Criar cobrança PIX para NF-e
     */
    router.post('/pix/cobranca/nfe/:nfeId', authenticateToken, async (req, res) => {
        try {
            const { nfeId } = req.params;

            // Buscar dados da NF-e
            const [nfe] = await pool.query(`
                SELECT n.*, c.nome as cliente_nome, c.cnpj as cliente_cnpj, c.cpf as cliente_cpf, c.email as cliente_email
                FROM nfes n
                LEFT JOIN clientes c ON n.cliente_id = c.id
                WHERE n.id = ?
            `, [nfeId]);

            if (!nfe.length) {
                return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            }

            const dados = nfe[0];
            const resultado = await pixService.criarCobranca({
                origem_tipo: 'nfe',
                origem_id: nfeId,
                cliente_id: dados.cliente_id,
                cliente_nome: dados.cliente_nome,
                cliente_cpf_cnpj: dados.cliente_cnpj || dados.cliente_cpf,
                email: dados.cliente_email,
                valor: parseFloat(dados.valor_total),
                descricao: `NF-e ${dados.numero_nfe} - ALUFORCE`,
                expiracao: req.body.expiracao || 3600
            });

            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro ao criar cobrança NF-e:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Criar cobrança PIX para conta a receber
     */
    router.post('/pix/cobranca/conta/:contaId', authenticateToken, async (req, res) => {
        try {
            const { contaId } = req.params;

            const [conta] = await pool.query(`
                SELECT cr.*, c.nome as cliente_nome, c.cnpj, c.cpf, c.email
                FROM contas_receber cr
                LEFT JOIN clientes c ON cr.cliente_id = c.id
                WHERE cr.id = ?
            `, [contaId]);

            if (!conta.length) {
                return res.status(404).json({ success: false, message: 'Conta não encontrada' });
            }

            const dados = conta[0];
            const resultado = await pixService.criarCobranca({
                origem_tipo: 'conta_receber',
                origem_id: contaId,
                cliente_id: dados.cliente_id,
                cliente_nome: dados.cliente_nome,
                cliente_cpf_cnpj: dados.cnpj || dados.cpf,
                email: dados.email,
                valor: parseFloat(dados.valor),
                descricao: dados.descricao || `Cobrança ${contaId} - ALUFORCE`,
                expiracao: req.body.expiracao || 3600
            });

            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro ao criar cobrança conta:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Consultar cobrança PIX
     */
    router.get('/pix/cobranca/:txid', authenticateToken, async (req, res) => {
        try {
            const cobranca = await pixService.consultarCobranca(req.params.txid);
            res.json({ success: true, cobranca });
        } catch (error) {
            console.error('[PIX] Erro ao consultar:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Cancelar cobrança PIX
     */
    router.delete('/pix/cobranca/:txid', authenticateToken, async (req, res) => {
        try {
            const resultado = await pixService.cancelarCobranca(req.params.txid);
            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro ao cancelar:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Listar cobranças PIX
     */
    router.get('/pix/cobrancas', authenticateToken, async (req, res) => {
        try {
            const cobrancas = await pixService.listarCobrancas(req.query);
            res.json({ success: true, cobrancas });
        } catch (error) {
            console.error('[PIX] Erro ao listar:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Dashboard PIX
     */
    router.get('/pix/dashboard', authenticateToken, async (req, res) => {
        try {
            const dashboard = await pixService.getDashboard(req.query.periodo || 30);
            res.json({ success: true, ...dashboard });
        } catch (error) {
            console.error('[PIX] Erro no dashboard:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // WEBHOOK NFe — Recebe callbacks de provedores externos (SEFAZ/Focus NFe)
    // Resiliência: não quebra se o registro não existir no banco
    // ============================================================

    router.post('/nfe/webhook/status', async (req, res) => {
        try {
            const { chave_acesso, numero_protocolo, status, motivo, xml_retorno, referencia_id } = req.body;

            // Identificar o registro: por chave_acesso (44 dígitos) ou referencia_id
            const identificador = chave_acesso || referencia_id;
            if (!identificador) {
                console.warn('[NFe-WEBHOOK] ⚠️ Evento recebido sem identificador (chave_acesso ou referencia_id). Payload descartado.');
                // Retorna 200 para evitar re-envios infinitos do provedor
                return res.status(200).json({ received: true, processed: false, reason: 'Identificador ausente' });
            }

            // RESILIÊNCIA: Verificar existência ANTES de atualizar (previne "Record not found")
            let nfeQuery, nfeParams;
            if (chave_acesso && /^\d{44}$/.test(chave_acesso)) {
                nfeQuery = 'SELECT id, status, numero FROM nfes WHERE chave_acesso = ?';
                nfeParams = [chave_acesso];
            } else {
                nfeQuery = 'SELECT id, status, numero FROM nfes WHERE id = ?';
                nfeParams = [referencia_id];
            }

            const [nfes] = await pool.query(nfeQuery, nfeParams);

            if (nfes.length === 0) {
                // Registro não encontrado — Race condition ou mapeamento incorreto
                console.warn(`[NFe-WEBHOOK] ⚠️ Registro não encontrado para webhook. Identificador: ${identificador}. Status recebido: ${status || 'N/A'}`);
                // Retorna 200 OK para que o provedor pare de re-enviar
                return res.status(200).json({ received: true, processed: false, reason: 'Registro não encontrado' });
            }

            const nfe = nfes[0];

            // Mapear status do provedor para status interno
            const statusMap = {
                'autorizada': 'autorizada',
                'aprovada': 'autorizada',
                'cancelada': 'cancelada',
                'rejeitada': 'rejeitada',
                'denegada': 'rejeitada',
                'processando': 'processando'
            };

            const statusInterno = statusMap[(status || '').toLowerCase()] || status;

            if (statusInterno) {
                // updateMany pattern: não quebra se 0 rows afetadas
                const [result] = await pool.query(`
                    UPDATE nfes
                    SET status = ?,
                        protocolo_autorizacao = COALESCE(?, protocolo_autorizacao)
                    WHERE id = ?
                `, [statusInterno, numero_protocolo, nfe.id]);

                console.log(`[NFe-WEBHOOK] ✅ NFe #${nfe.numero || nfe.id} atualizada: ${nfe.status} → ${statusInterno} (${result.affectedRows} linha(s) afetada(s))`);
            }

            res.status(200).json({ received: true, processed: true, nfe_id: nfe.id });
        } catch (error) {
            console.error('[NFe-WEBHOOK] ❌ Erro ao processar webhook:', error);
            // Ainda retorna 200 para evitar retries infinitos do provedor
            res.status(200).json({ received: true, processed: false, reason: 'Erro interno' });
        }
    });

    /**
     * Webhook PIX (público - recebe notificações dos provedores)
     * AUDITORIA ENTERPRISE: Validação de assinatura HMAC para segurança
     */
    router.post('/pix/webhook/:provedor', async (req, res) => {
        try {
            const { provedor } = req.params;
            const crypto = require('crypto');

            // SEGURANÇA: Validar assinatura HMAC do webhook
            const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'];

            // Buscar secret do provedor para validação
            const [configs] = await pool.query(
                'SELECT webhook_secret FROM pix_config WHERE provedor = ? AND ativo = 1',
                [provedor]
            );

            if (configs.length > 0 && configs[0].webhook_secret) {
                const webhookSecret = configs[0].webhook_secret;
                const payload = JSON.stringify(req.body);
                const expectedSignature = crypto
                    .createHmac('sha256', webhookSecret)
                    .update(payload)
                    .digest('hex');

                // Validar assinatura (se fornecida)
                if (signature && signature !== expectedSignature && signature !== `sha256=${expectedSignature}`) {
                    console.log(`[PIX] ⚠️ Webhook com assinatura inválida de ${provedor}. IP: ${req.ip}`);
                    return res.status(401).json({
                        success: false,
                        message: 'Assinatura do webhook inválida'
                    });
                }
            }

            // Rate limiting básico - máx 100 webhooks/minuto por provedor
            const rateLimitKey = `pix_webhook_${provedor}`;
            if (!global.pixWebhookRateLimit) global.pixWebhookRateLimit = {};
            const now = Date.now();
            const windowStart = now - 60000; // 1 minuto

            if (!global.pixWebhookRateLimit[rateLimitKey]) {
                global.pixWebhookRateLimit[rateLimitKey] = [];
            }

            // Limpar registros antigos
            global.pixWebhookRateLimit[rateLimitKey] = global.pixWebhookRateLimit[rateLimitKey].filter(t => t > windowStart);

            if (global.pixWebhookRateLimit[rateLimitKey].length >= 100) {
                console.log(`[PIX] ⚠️ Rate limit excedido para webhook ${provedor}. IP: ${req.ip}`);
                return res.status(429).json({
                    success: false,
                    message: 'Limite de requisições excedido'
                });
            }

            global.pixWebhookRateLimit[rateLimitKey].push(now);

            console.log(`[PIX] Webhook recebido de ${provedor}:`, JSON.stringify(req.body).substring(0, 500));

            const resultado = await pixService.processarWebhook(provedor, req.body);
            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro no webhook:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Simular pagamento (apenas para desenvolvimento)
     */
    router.post('/pix/simular-pagamento/:txid', authenticateToken, async (req, res) => {
        try {
            if (process.env.NODE_ENV === 'production') {
                return res.status(403).json({ success: false, message: 'Não disponível em produção' });
            }

            const { txid } = req.params;
            const resultado = await pixService.processarWebhook('simulacao', {
                txid,
                endToEndId: `E${Date.now()}`,
                valor: req.body.valor
            });

            res.json({ success: true, message: 'Pagamento simulado', ...resultado });
        } catch (error) {
            console.error('[PIX] Erro na simulação:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // ========== RÉGUA DE COBRANÇA AUTOMATIZADA ==================
    // ============================================================

    /**
     * Obter configuração da régua
     */
    router.get('/regua/config', authenticateToken, async (req, res) => {
        try {
            const config = await reguaService.getConfig();
            res.json({ success: true, config });
        } catch (error) {
            console.error('[RÉGUA] Erro ao buscar config:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Salvar configuração da régua
     * AUDITORIA ENTERPRISE: Configuração de cobrança automática
     */
    router.post('/regua/config', authenticateToken, async (req, res) => {
        try {
            const usuario_id = req.user.id;

            // RBAC - Apenas administradores e gerentes podem configurar régua
            const rolesPermitidas = ['admin', 'administrador', 'gerente', 'gerente_financeiro', 'gerente_vendas'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();

            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[RÉGUA-RBAC] Usuário ${usuario_id} (${userRole}) tentou alterar configuração da régua sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Apenas administradores ou gerentes podem configurar régua de cobrança.'
                });
            }

            console.log(`[RÉGUA] Usuário ${usuario_id} alterando configuração da régua`);
            const resultado = await reguaService.salvarConfig(req.body);
            res.json(resultado);
        } catch (error) {
            console.error('[RÉGUA] Erro ao salvar config:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Listar templates de mensagens
     */
    router.get('/regua/templates', authenticateToken, async (req, res) => {
        try {
            const templates = await reguaService.listarTemplates();
            res.json({ success: true, templates });
        } catch (error) {
            console.error('[RÉGUA] Erro ao listar templates:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Salvar template
     * AUDITORIA ENTERPRISE: Templates afetam comunicação automática com clientes
     */
    router.post('/regua/templates', authenticateToken, async (req, res) => {
        try {
            const usuario_id = req.user.id;

            // RBAC - Apenas administradores e gerentes podem alterar templates
            const rolesPermitidas = ['admin', 'administrador', 'gerente', 'gerente_financeiro'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();

            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[RÉGUA-RBAC] Usuário ${usuario_id} (${userRole}) tentou alterar template sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Apenas administradores ou gerentes podem alterar templates de cobrança.'
                });
            }

            console.log(`[RÉGUA] Usuário ${usuario_id} alterando template`);
            const resultado = await reguaService.salvarTemplate(req.body);
            res.json(resultado);
        } catch (error) {
            console.error('[RÉGUA] Erro ao salvar template:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Executar régua manualmente
     */
    router.post('/regua/executar', authenticateToken, async (req, res) => {
        try {
            const resultado = await reguaService.executarRegua();
            res.json({ success: true, ...resultado });
        } catch (error) {
            console.error('[RÉGUA] Erro ao executar:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Histórico de cobranças enviadas
     */
    router.get('/regua/historico', authenticateToken, async (req, res) => {
        try {
            const historico = await reguaService.getHistorico(req.query);
            res.json({ success: true, historico });
        } catch (error) {
            console.error('[RÉGUA] Erro ao buscar histórico:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Dashboard da régua
     */
    router.get('/regua/dashboard', authenticateToken, async (req, res) => {
        try {
            const dashboard = await reguaService.getDashboard(req.query.periodo || 30);
            res.json({ success: true, ...dashboard });
        } catch (error) {
            console.error('[RÉGUA] Erro no dashboard:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    /**
     * Enviar cobrança individual manualmente
     */
    router.post('/regua/enviar/:contaId', authenticateToken, async (req, res) => {
        try {
            const { contaId } = req.params;
            const { tipo = 'dia', dias = 0 } = req.body;

            // Buscar conta
            const [contas] = await pool.query(`
                SELECT cr.*, c.nome as cliente_nome, c.email as cliente_email, c.telefone as cliente_telefone
                FROM contas_receber cr
                LEFT JOIN clientes c ON cr.cliente_id = c.id
                WHERE cr.id = ?
            `, [contaId]);

            if (!contas.length) {
                return res.status(404).json({ success: false, message: 'Conta não encontrada' });
            }

            const config = await reguaService.getConfig();
            const resultado = await reguaService.enviarCobranca(contas[0], tipo, dias, config);

            res.json({ success: true, ...resultado });
        } catch (error) {
            console.error('[RÉGUA] Erro ao enviar cobrança:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // ============================================================
    // ATIVIDADES RECENTES (Audit Log contextual do Faturamento)
    // ============================================================

    router.get('/atividades', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);

            // Busca atividades de tabelas do domínio Faturamento via auditoria_logs
            // + eventos de NF-e (nfe_eventos) — união cronológica reversa
            const [rows] = await pool.query(`
                (
                    SELECT
                        al.id,
                        al.operacao AS tipo,
                        al.tabela,
                        al.registro_id,
                        al.descricao,
                        al.created_at AS data,
                        u.nome AS usuario_nome
                    FROM auditoria_logs al
                    LEFT JOIN usuarios u ON u.id = al.usuario_id
                    WHERE al.tabela IN ('nfe', 'nfe_itens', 'contas_receber', 'contas_receber_parcelas', 'faturamento_config')
                    ORDER BY al.created_at DESC
                    LIMIT ?
                )
                UNION ALL
                (
                    SELECT
                        ne.id,
                        ne.tipo_evento AS tipo,
                        'nfe_eventos' AS tabela,
                        ne.nfe_id AS registro_id,
                        ne.descricao,
                        COALESCE(ne.data_evento, ne.created_at) AS data,
                        u2.nome AS usuario_nome
                    FROM nfe_eventos ne
                    LEFT JOIN usuarios u2 ON u2.id = ne.usuario_id
                    ORDER BY COALESCE(ne.data_evento, ne.created_at) DESC
                    LIMIT ?
                )
                ORDER BY data DESC
                LIMIT ?
            `, [limit, limit, limit]);

            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao buscar atividades:', error.message);
            // Fallback: se as tabelas não existem, retorna vazio graciosamente
            if (error.code === 'ER_NO_SUCH_TABLE') {
                return res.json({ success: true, data: [] });
            }
            res.status(500).json({ success: false, message: 'Erro ao buscar atividades recentes' });
        }
    });

    // ============================================================
    // CONFIGURAÇÕES DE FATURAMENTO (Centralizadas)
    // ============================================================

    // GET /api/faturamento/config - Obter configurações atuais
    router.get('/config', authenticateToken, async (req, res) => {
        try {
            const config = await faturamentoShared.getConfigForAPI();
            res.json({ success: true, config });
        } catch (error) {
            console.error('[FATURAMENTO_CONFIG] Erro ao obter config:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    // PUT /api/faturamento/config - Atualizar configurações (admin only)
    router.put('/config', authenticateToken, async (req, res) => {
        try {
            const isAdmin = faturamentoShared.isAdmin(req.user);
            if (!isAdmin) {
                return res.status(403).json({ success: false, message: 'Apenas administradores podem alterar configurações de faturamento' });
            }
            const resultado = await faturamentoShared.updateConfig(req.body);
            res.json({ success: true, message: 'Configurações atualizadas', config: resultado });
        } catch (error) {
            console.error('[FATURAMENTO_CONFIG] Erro ao atualizar config:', error);
            res.status(500).json({ success: false, message: mensagemSegura(error) });
        }
    });

    return router;
};
