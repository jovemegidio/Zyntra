/**
 * VENDAS EXTENDED ROUTES - Extracted from server.js (Lines 25776-27054)
 * Dashboard admin/vendedor, top-vendedores, pedidos, relatorios
 * NOTE: usa um vendasPool separado (VENDAS_DB_CONFIG / VENDAS_DB_NAME, com fallback para DB_NAME)
 * @module routes/vendas-extended
 */
const express = require('express');
const mysql = require('mysql2/promise');
const { buscarConfiguracoesEmpresa, formatarDadosParaPDF, resolverCaminhoLogo, montarIdentidadeCabecalho } = require('../modules/_shared/services/empresa-config.service');
const { buildEmpresaTemplateData, renderHtmlRelatorio, resolveRelatorioTemplate, statusBadgeClass } = require('../src/services/html-relatorio-renderer');
const { montarVencimentos } = require('../src/services/orcamento-vencimentos');
const { canonizarIdentidade } = require('../middleware/identidade-canonica');
const { htmlParaPdf } = require('../services/pdf-render.service');
const { nomeVendedorParaOrcamento } = require('../utils/orcamento-vendedor');
const { podeVerTodosPedidosVendas } = require('../utils/vendas-pedidos-visibilidade');
const { createVendasAccessProfile, blockVendasReadOnly } = require('../utils/vendas-readonly-access');
const { formatStateRegistration } = require('../services/fiscal-client.service');
const { siglaModalidadeFrete } = require('../modules/_shared/services/nfe-pedido.mapper');
const { ufCobraFcp } = require('../utils/vendas-fiscal');
let lgpdCrypto = null;
try { lgpdCrypto = require('../lgpd-crypto'); } catch (_) { /* PII sem criptografia nesta base */ }
const {
    obterColunasCliente,
    localizarConflitoCliente,
    montarTransferenciaCliente,
    registrarClienteGlobal
} = require('../utils/cliente-proprietario');

module.exports = function createVendasExtendedRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeAdmin, writeAuditLog, cacheMiddleware, CACHE_CONFIG, VENDAS_DB_CONFIG } = deps;
    const recalcularImpostosPedidoVenda = deps.recalcularImpostosPedidoVenda;
    const router = express.Router();
    const activeVendasAccessProfile = deps.vendasAccessProfile || createVendasAccessProfile(pool);
    const authorizeVendasDocumentos = authorizeArea(['vendas', 'compras']);
    const activeWriteGuard = deps.writeGuard || ((req, res, next) => {
        if (!blockVendasReadOnly(req, res)) next();
    });
    router.use(authenticateToken, activeVendasAccessProfile, activeWriteGuard);

    // --- Standard requires for extracted routes ---
    const { body, param, query, validationResult } = require('express-validator');
    const path = require('path');
    const multer = require('multer');
    const fs = require('fs');
    const upload = multer({ dest: path.join(__dirname, '..', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 } });
    const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    const validate = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: 'Dados inválidos', errors: errors.array() });
        next();
    };

    const safeParseJSON = (str, fallback = []) => { try { return JSON.parse(str); } catch (_) { return fallback; } };
    const normalizarCodigoCondicaoPagamento = (valor) => {
        if (valor == null || valor === '') return null;
        const raw = String(valor).trim();
        const lower = raw.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ');
        if (['a vista', 'a_vista', 'avista', 'av', '0'].includes(lower)) return 'a_vista';
        const onlyNumbers = raw.replace(/[^\d/_-]+/g, '').replace(/[-_]+/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
        if (/^\d+(\/\d+)*$/.test(onlyNumbers)) return onlyNumbers;
        return raw.replace(/_/g, '/');
    };
    const formatarDescricaoCondicaoPagamento = (valor) => {
        const codigo = normalizarCodigoCondicaoPagamento(valor);
        if (!codigo) return 'A combinar';
        if (codigo === 'a_vista') return 'À Vista';
        if (/^\d+$/.test(codigo)) return `${codigo} dias`;
        if (/^\d+(\/\d+)+$/.test(codigo)) return `${codigo} dias`;
        return codigo;
    };
    // Separate pool for vendas database
    let vendasPool;
    try {
        vendasPool = mysql.createPool(VENDAS_DB_CONFIG || {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER || 'aluforce',
            password: process.env.DB_PASSWORD || '',
            database: process.env.VENDAS_DB_NAME || process.env.DB_NAME || 'aluforce_vendas',
            waitForConnections: true,
            connectionLimit: 10,
            charset: 'utf8mb4'
        });
    } catch (e) {
        console.error('[VENDAS-EXT] Erro ao criar vendasPool:', e.message);
        vendasPool = pool; // fallback to main pool
    }
    // ======================================


    // === DASHBOARD VENDAS ===

    // Dashboard Admin: métricas completas e avançadas
    router.get('/dashboard/admin', authorizeArea('vendas'), cacheMiddleware('vendas_dash_admin', CACHE_CONFIG.dashboardVendas, true), async (req, res) => {
        try {
            const user = req.user;
            const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
            if (!isAdmin) return res.status(403).json({ message: 'Acesso negado: apenas administradores.' });

            const periodo = req.query.periodo || req.query.período || '30';
            const dias = parseInt(periodo) || 30;

            // Métricas gerais
            const [metricsRows] = await pool.query(`
                SELECT
                    COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END) as total_faturado,
                    SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END) as valor_faturado,
                    COUNT(CASE WHEN status = 'orcamento' THEN 1 END) as total_orcamentos,
                    SUM(CASE WHEN status = 'orcamento' THEN valor ELSE 0 END) as valor_orcamentos,
                    COUNT(CASE WHEN status = 'analise' THEN 1 END) as total_analise,
                    SUM(CASE WHEN status = 'analise' THEN valor ELSE 0 END) as valor_analise,
                    COUNT(CASE WHEN status = 'cancelado' THEN 1 END) as total_cancelado,
                    COUNT(*) as total_pedidos,
                    CASE WHEN COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END) > 0
                         THEN SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END) / COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END)
                         ELSE 0 END as ticket_medio
                FROM pedidos
                WHERE created_at >= CURDATE() - INTERVAL ? DAY
            `, [dias]);

            // Top vendedores (faturamento)
            const [topVendedores] = await pool.query(`
                SELECT
                    u.id, u.nome, u.email,
                    COUNT(p.id) as total_vendas,
                    SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END) as valor_faturado,
                    SUM(p.valor) as valor_total
                FROM usuarios u
                LEFT JOIN pedidos p ON u.id = p.vendedor_id AND p.created_at >= CURDATE() - INTERVAL ? DAY
                WHERE u.role = 'comercial'
                GROUP BY u.id, u.nome, u.email
                HAVING valor_faturado > 0
                ORDER BY valor_faturado DESC
                LIMIT 10
            `, [dias]);

            // Faturamento mensal (últimos 12 meses)
            const [faturamentoMensal] = await pool.query(`
                SELECT
                    DATE_FORMAT(created_at, '%Y-%m') as mes,
                    COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END) as qtd_faturado,
                    SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END) as valor_faturado
                FROM pedidos
                WHERE created_at >= CURDATE() - INTERVAL 12 MONTH
                GROUP BY DATE_FORMAT(created_at, '%Y-%m')
                ORDER BY mes ASC
            `);

            // Conversão por status
            const [conversao] = await pool.query(`
                SELECT
                    status,
                    COUNT(*) as quantidade,
                    SUM(valor) as valor_total
                FROM pedidos
                WHERE created_at >= CURDATE() - INTERVAL ? DAY
                GROUP BY status
            `, [dias]);

            // Pedidos por empresa (top 10)
            const [topEmpresas] = await pool.query(`
                SELECT
                    e.id, e.nome_fantasia, e.cnpj,
                    COUNT(p.id) as total_pedidos,
                    SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END) as valor_faturado
                FROM empresas e
                LEFT JOIN pedidos p ON e.id = p.empresa_id AND p.created_at >= CURDATE() - INTERVAL ? DAY
                GROUP BY e.id, e.nome_fantasia, e.cnpj
                ORDER BY valor_faturado DESC
                LIMIT 10
            `, [dias]);

            // Taxa de conversão
            const totalOrcamentos = metricsRows[0].total_orcamentos || 0;
            const totalFaturado = metricsRows[0].total_faturado || 0;
            const taxaConversao = totalOrcamentos > 0 ? ((totalFaturado / totalOrcamentos) * 100).toFixed(2) : 0;

            res.json({
                periodo: dias,
                metricas: metricsRows[0],
                taxaConversao: parseFloat(taxaConversao),
                topVendedores,
                faturamentoMensal,
                conversaoPorStatus: conversao,
                topEmpresas
            });
        } catch (error) {
            console.error('Erro dashboard admin:', error);
            res.status(500).json({ error: 'Erro ao carregar dashboard admin' });
        }
    });

    router.get('/dashboard/vendedor', authorizeArea('vendas'), cacheMiddleware('vendas_dash_vend', CACHE_CONFIG.dashboardVendas, true), async (req, res) => {
        try {
            const vendedorId = req.user.id;
            // AUDIT-FIX: o frontend envia "?periodo=" (sem acento) — o parâmetro acentuado
            // nunca era preenchido pelo Express, então o período sempre caía no default de
            // 30 dias, ignorando o que a tela realmente pedia.
            const período = req.query.periodo || req.query.período || '30'; // dias

            // Métricas pessoais do vendedor
            const [metricsRows] = await pool.query(`
                SELECT
                    COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END) as total_faturado,
                    SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END) as valor_faturado,
                    COUNT(CASE WHEN status = 'orcamento' THEN 1 END) as total_orcamentos,
                    SUM(CASE WHEN status = 'orcamento' THEN valor ELSE 0 END) as valor_orcamentos,
                    COUNT(CASE WHEN status = 'analise' THEN 1 END) as total_analise,
                    COUNT(CASE WHEN status = 'cancelado' THEN 1 END) as total_cancelado,
                    COUNT(*) as total_pedidos,
                    CASE WHEN COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END) > 0
                         THEN SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END) / COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END)
                         ELSE 0 END as ticket_medio
                FROM pedidos
                WHERE vendedor_id = ? AND created_at >= CURDATE() - INTERVAL ? DAY
            `, [vendedorId, parseInt(período)]);

            // Pipeline do vendedor (valor por status)
            const [pipeline] = await pool.query(`
                SELECT
                    status,
                    COUNT(*) as quantidade,
                    SUM(valor) as valor_total
                FROM pedidos
                WHERE vendedor_id = ? AND created_at >= CURDATE() - INTERVAL ? DAY
                GROUP BY status
            `, [vendedorId, parseInt(período)]);

            // Histórico mensal do vendedor (últimos 6 meses)
            const [históricoMensal] = await pool.query(`
                SELECT
                    DATE_FORMAT(created_at, '%Y-%m') as mes,
                    COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END) as qtd_faturado,
                    SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END) as valor_faturado
                FROM pedidos
                WHERE vendedor_id = ? AND created_at >= CURDATE() - INTERVAL 6 MONTH
                GROUP BY DATE_FORMAT(created_at, '%Y-%m')
                ORDER BY mes ASC
            `, [vendedorId]);

            // Meus clientes (empresas com mais pedidos)
            // AUDIT-FIX HIGH-001: Fixed broken SQL — added FROM/JOIN/WHERE, removed trailing comma
            const [meusClientes] = await pool.query(`
                SELECT
                    e.id, e.nome_fantasia,
                    COUNT(p.id) as total_pedidos,
                    SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END) as valor_faturado
                FROM empresas e
                JOIN pedidos p ON p.empresa_id = e.id
                WHERE p.vendedor_id = ? AND p.created_at >= CURDATE() - INTERVAL ? DAY
                GROUP BY e.id, e.nome_fantasia
                ORDER BY valor_faturado DESC
                LIMIT 10
            `, [vendedorId, parseInt(período) || 30]);

            // Taxa de conversão pessoal
            const totalOrcamentos = metricsRows[0]?.total_orcamentos || 0;
            const totalFaturado = metricsRows[0]?.total_faturado || 0;
            const taxaConversao = totalOrcamentos > 0 ? ((totalFaturado / totalOrcamentos) * 100).toFixed(2) : 0;

            // Buscar meta do vendedor. AUDIT-FIX: não inventar mais um valor padrão de
            // R$32.500 quando não existe meta real cadastrada — isso fazia o dashboard
            // mostrar uma "meta" fictícia como se fosse real para qualquer vendedor sem
            // meta configurada. Sem meta real, valor fica 0 e "definida:false" avisa o front.
            // AUDIT-FIX 2: a query original usava colunas que não existem no schema real
            // (mes/valor/atingido) — o schema real é periodo/valor_meta/categoria, usado por
            // /metas, /metas/ranking e /metas/lote. A busca aqui sempre falhava silenciosamente
            // (try/catch), então nenhum vendedor via a própria meta real, mesmo já cadastrada.
            let metaAtual = { valor: 0, atingido: metricsRows[0]?.valor_faturado || 0, percentual: 0, definida: false };
            try {
                const periodoAtual = new Date().toISOString().substring(0, 7);
                const [metaRows] = await pool.query(`
                    SELECT valor_meta
                    FROM metas_vendas
                    WHERE vendedor_id = ? AND periodo = ? AND categoria = 'faturamento'
                      AND (ativo = 1 OR ativo IS NULL)
                    LIMIT 1
                `, [vendedorId, periodoAtual]);
                if (metaRows && metaRows.length > 0 && Number(metaRows[0].valor_meta) > 0) {
                    metaAtual.valor = metaRows[0].valor_meta;
                    metaAtual.definida = true;
                    metaAtual.percentual = ((metaAtual.atingido / metaAtual.valor) * 100).toFixed(1);
                }
            } catch (err) { /* metas_vendas pode não existir — mantém meta indefinida */ }

            res.json({
                metricas: metricsRows[0] || {},
                pipeline,
                históricoMensal,
                meusClientes,
                taxaConversao,
                meta: metaAtual
            });
        } catch (error) {
            console.error('Erro dashboard vendedor:', error);
            res.status(500).json({ error: 'Erro ao carregar dashboard do vendedor' });
        }
    });

    // GET: top vendedores by faturamento
    router.get('/dashboard/top-vendedores', authenticateToken, cacheMiddleware('vendas_top_vend', CACHE_CONFIG.dashboardVendas), async (req, res) => {
        try {
            const limit = Math.max(parseInt(req.query.limit || '5'), 1);
            const periodDays = Math.max(parseInt(req.query.period || req.query.days || '30'), 1);

            const [rows] = await pool.query(
                `SELECT
                    u.id,
                    u.nome,
                    COALESCE(f.foto_perfil_url, u.foto, u.avatar) AS foto,
                    COUNT(p.id) as vendas,
                    COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END), 0) AS valor
                 FROM usuarios u
                 LEFT JOIN funcionarios f ON f.email = u.email
                 LEFT JOIN pedidos p ON p.vendedor_id = u.id AND p.created_at >= CURDATE() - INTERVAL ? DAY
                 WHERE JSON_CONTAINS(COALESCE(u.areas, '[]'), '"vendas"') OR u.role = 'vendedor'
                 GROUP BY u.id, u.nome, f.foto_perfil_url, u.foto, u.avatar
                 HAVING valor > 0
                 ORDER BY valor DESC
                 LIMIT ?`,
                 [periodDays, limit]
            );
            res.json(rows.map(r => ({
                id: r.id,
                nome: r.nome,
                foto: r.foto || null,
                vendas: Number(r.vendas || 0),
                valor: Number(r.valor || 0)
            })));
        } catch (error) {
            console.error('Erro ao buscar top vendedores:', error);
            res.json([]);
        }
    });

    // GET: top produtos mais vendidos
    router.get('/dashboard/top-produtos', authenticateToken, cacheMiddleware('vendas_top_prod', CACHE_CONFIG.dashboardVendas), async (req, res) => {
        try {
            const limit = Math.max(parseInt(req.query.limit || '5'), 1);
            const periodDays = Math.max(parseInt(req.query.period || req.query.days || '30'), 1);

            try {
                const [rows] = await pool.query(
                    `SELECT
                        COALESCE(pi.descricao, pi.codigo, 'Produto') as nome,
                        pi.codigo,
                        SUM(pi.quantidade) as quantidade,
                        SUM(pi.quantidade * pi.preco_unitario) as valor
                     FROM pedido_itens pi
                     JOIN pedidos p ON pi.pedido_id = p.id
                     WHERE p.created_at >= CURDATE() - INTERVAL ? DAY
                     GROUP BY pi.codigo, pi.descricao
                     ORDER BY quantidade DESC
                     LIMIT ?`,
                     [periodDays, limit]
                );
                return res.json(rows.map(r => ({
                    nome: r.nome || 'Produto',
                    codigo: r.codigo,
                    quantidade: Number(r.quantidade || 0),
                    valor: Number(r.valor || 0)
                })));
            } catch (err) {
                // Fallback se tabela não existir
                return res.json([]);
            }
        } catch (error) {
            console.error('Erro ao buscar top produtos:', error);
            res.json([]);
        }
    });

    // === PEDIDOS ===
    router.get('/pedidos', authorizeArea('vendas'), async (req, res) => {
        try {
            const { status, limite = 100 } = req.query;
            let query = `
                SELECT p.*,
                       p.valor as valor_total,
                       p.created_at as data_pedido,
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, p.cliente, 'Cliente não informado') as cliente_nome,
                       c.email as cliente_email,
                       c.telefone as cliente_telefone,
                       e.nome_fantasia as empresa_nome,
                       u.nome as vendedor_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
            `;

            const params = [];
            if (status) {
                query += ' WHERE p.status = ?';
                params.push(status);
            }

            query += ' ORDER BY p.id DESC LIMIT ?';
            params.push(parseInt(limite));

            const [pedidos] = await pool.query(query, params);
            res.json(pedidos);
        } catch (error) {
            console.error('Erro ao listar pedidos:', error);
            res.status(500).json({ error: 'Erro ao listar pedidos' });
        }
    });

    // ========================================
    // ORÇAMENTO / PEDIDO — documento do cliente
    // ========================================
    // Rota alternativa para /imprimir (redireciona para /pdf)
    router.get('/pedidos/:id/imprimir', authenticateToken, authorizeVendasDocumentos, (req, res, next) => {
        // A querystring vai junto: é ela que carrega `impostos=0` (orçamento sem impostos).
        const inicioQuery = req.originalUrl.indexOf('?');
        const query = inicioQuery >= 0 ? req.originalUrl.slice(inicioQuery) : '';
        req.url = `/api/vendas/pedidos/${req.params.id}/pdf${query}`;
        next('route');
    });

    // ============================================================
    // OBSERVAÇÕES — de muro de texto para bloco estruturado.
    //
    // O texto chega em dois formatos, conforme a instância: separado por '|'
    // (Energy/Aluforce, sem \n nenhum) ou por '\n' com itens numerados
    // (Eletric/Cobal). Os dois saíam ilegíveis: o '|' aparecia cru e o '\n'
    // virava espaço dentro do <p>.
    //
    // Devolve HTML JÁ ESCAPADO. Se não houver o que estruturar (menos de 2 itens),
    // devolve o texto escapado como antes — nunca piora o que já funcionava.
    // O orçamento não pode passar de DUAS páginas A4. As Observações são a única
    // parte de tamanho livre do documento (vêm digitadas no pedido), então é nelas
    // que o teto é aplicado: acima deste número de caracteres VISÍVEIS o texto é
    // cortado no último item que cabe e o documento avisa o leitor, em vez de
    // empurrar rodapé/assinaturas para uma terceira página.
    //
    // Calibragem (01/09/2026): a maior observação real das 4 bases tem 3.279
    // caracteres (aluforce; energy 3.146, eletric 2.877, cobal 2.847). O teto fica
    // acima disso de propósito — nenhum documento de hoje é truncado por ele; a
    // trava existe para o texto colado sem limite.
    const LIMITE_OBSERVACOES = 4500;
    const AVISO_CORTE_OBSERVACOES = 'Observações truncadas para manter o documento em ' +
        '2 páginas. O texto completo permanece registrado no pedido.';

    function formatarObservacoes(txt, esc, semCorte = false) {
        const bruto = String(txt == null ? '' : txt);
        const limite = semCorte ? Number.MAX_SAFE_INTEGER : LIMITE_OBSERVACOES;
        if (!bruto.trim()) return '';

        const cru = bruto.replace(/\r\n?/g, '\n').split(/\n|\|/).map(s => s.trim())
            // Divisor decorativo ('___', '---') vira linha VAZIA antes da emenda: como
            // texto, ele seria colado na frase seguinte ("___ Estou ciente...") e ela
            // deixaria de ser reconhecida como declaração de ciência.
            .map(s => /^[_\-.…=*·—–\s]+$/.test(s) ? '' : s);

        // O '|' também aparece NO MEIO da frase, como quebra de linha do documento de
        // origem ("...DE 5% PARA MAIS OU PARA|MENOS;"). Emenda quando a linha anterior
        // não fechou em pontuação E a atual não abre item novo (marcador ou numeração).
        const abreItem = (s) => /^([-•*]\s|\(?\d{1,2}[.)]\s)/.test(s);
        const fechada = (s) => /[;:.!?)]$/.test(s);
        const unidas = [];
        for (const l of cru) {
            const ant = unidas.length ? unidas[unidas.length - 1] : null;
            if (ant && ant !== '' && l !== '' && !fechada(ant) && !abreItem(l)) {
                unidas[unidas.length - 1] = ant + ' ' + l;
            } else {
                unidas.push(l);
            }
        }

        let itens = unidas
            .map(s => s.replace(/^[-•*]\s+/, '').trim())
            .filter(s => s && !/^[_\-.…=*·—–\s]+$/.test(s));

        if (itens.length < 2) {
            if (bruto.length <= limite) return esc(bruto);
            return esc(bruto.slice(0, limite).replace(/\s+\S*$/, '')) +
                '<p class="note-corte">' + esc(AVISO_CORTE_OBSERVACOES) + '</p>';
        }

        // Frase final em 1ª pessoa é declaração de ciência, não condição de fornecimento.
        let ciencia = '';
        if (/^(estou ciente|declaro|li e |estou de acordo)/i.test(itens[itens.length - 1])) {
            ciencia = itens.pop();
        }

        // Teto de 2 páginas: derruba os itens que não cabem. A declaração de ciência
        // fica FORA do orçamento de corte — é curta e é a parte que o cliente assina,
        // então some por último (e o piso de 500 evita que uma ciência anormalmente
        // longa zere o espaço dos itens).
        let observacoesCortadas = false;
        {
            const orcamento = Math.max(500, limite - ciencia.length);
            const cabem = [];
            let usado = 0;
            for (const s of itens) {
                const resto = orcamento - usado;
                if (resto <= 0) { observacoesCortadas = true; break; }
                if (s.length > resto) {
                    // Item único maior que o teto inteiro: corta o texto dele, senão
                    // o documento sairia sem observação nenhuma.
                    if (!cabem.length) cabem.push(s.slice(0, resto).replace(/\s+\S*$/, ''));
                    observacoesCortadas = true;
                    break;
                }
                cabem.push(s);
                usado += s.length;
            }
            if (observacoesCortadas) itens = cabem;
        }

        const ehSubtitulo = (s) => /:$/.test(s) && s.length <= 90;
        const temSubtitulo = itens.some(ehSubtitulo);
        // Numeração própria ("1. Proposta comercial: ...") pede lista ordenada, senão o
        // marcador do <ul> duplicaria o número que já está escrito no texto.
        const numerados = itens.filter(s => /^\(?\d{1,2}[.)]\s/.test(s)).length;
        const ordenada = numerados >= Math.max(2, Math.ceil((itens.length - 1) / 2));

        function corpo(s) {
            const semNum = s.replace(/^\(?(\d{1,2})[.)]\s*/, '');
            const m = semNum.match(/^([^:]{2,40}):\s+([\s\S]+)$/);
            if (m) return '<strong>' + esc(m[1]) + ':</strong> ' + esc(m[2]);
            return esc(semNum);
        }

        const partes = [];
        let lista = [];
        const fecharLista = () => {
            if (!lista.length) return;
            const tag = ordenada ? 'ol' : 'ul';
            partes.push('<' + tag + ' class="note-list">' + lista.join('') + '</' + tag + '>');
            lista = [];
        };

        itens.forEach((s, i) => {
            if (ehSubtitulo(s)) { fecharLista(); partes.push('<p class="note-sub">' + esc(s) + '</p>'); return; }
            // Linha de abertura só vira introdução quando há subtítulo adiante — senão
            // ela é um item como os outros (a aluforce abre direto em "- FRETE: CIF").
            if (i === 0 && temSubtitulo) { partes.push('<p class="note-intro">' + corpo(s) + '</p>'); return; }
            lista.push('<li>' + corpo(s.replace(/;+$/, '')) + '</li>');
        });
        fecharLista();

        if (observacoesCortadas) partes.push('<p class="note-corte">' + esc(AVISO_CORTE_OBSERVACOES) + '</p>');
        if (ciencia) partes.push('<p class="note-ciencia">' + esc(ciencia) + '</p>');
        return partes.join('');
    }

    // ============================================================
    // ORÇAMENTO — um único documento para tela, impressão e download.
    // Monta o HTML do template novo (relatorios/orcamento.html) com os
    // dados reais do pedido. A rota /orcamento devolve esse HTML e a
    // rota /pdf devolve o MESMO HTML impresso em PDF pelo Chromium.
    // ============================================================
    // ============================================================
    // ORÇAMENTO COM x SEM IMPOSTOS
    // ============================================================
    // O mesmo documento sai em duas versões, escolhidas no modal "Exportar
    // Documento" de Vendas:
    //
    //   com impostos (padrão) — quadro de totais completo, Total = `pedidos.valor`,
    //                           que o backend já fecha como subtotal + IPI + ICMS-ST + frete;
    //   sem impostos          — as linhas de IPI e ICMS ST somem do quadro e o Total cai
    //                           para a mercadoria: subtotal − descontos + frete.
    //
    // Os itens NÃO mudam entre as duas: o valor unitário da linha já é o líquido
    // (ver o histórico de `Vlr. Unit.`), e IPI/ICMS-ST só existem no quadro de totais.
    //
    // O padrão é COM impostos — omitir o parâmetro tem de dar exatamente o documento
    // que já saía antes desta opção existir.
    function orcamentoComImpostos(req) {
        let bruto = req && req.query ? req.query.impostos : undefined;
        if (bruto === undefined && req && req.body) bruto = req.body.impostos;
        // `/imprimir` reescreve `req.url` para cair em `/pdf` via next('route'), então
        // a querystring original fica em `originalUrl` — vale como segunda fonte.
        if (bruto === undefined && req && req.originalUrl && req.originalUrl.includes('?')) {
            try {
                bruto = new URLSearchParams(req.originalUrl.slice(req.originalUrl.indexOf('?') + 1)).get('impostos');
            } catch (_) { /* querystring inválida: segue no padrão */ }
        }
        if (bruto === undefined || bruto === null || String(bruto).trim() === '') return true;
        return !/^(0|nao|não|sem|false|off|no)$/i.test(String(bruto).trim());
    }

    function parametroImpressaoAtivo(req, nome, padrao = false) {
        let bruto = req?.query?.[nome];
        if (bruto === undefined && req?.body) bruto = req.body[nome];
        if (bruto === undefined && req?.originalUrl?.includes('?')) {
            try { bruto = new URLSearchParams(req.originalUrl.slice(req.originalUrl.indexOf('?') + 1)).get(nome); } catch (_) { /* padrão */ }
        }
        if (bruto === undefined || bruto === null || String(bruto).trim() === '') return padrao;
        return !/^(0|nao|não|sem|false|off|no)$/i.test(String(bruto).trim());
    }

    function opcoesImpressaoPedido(req) {
        const valores = parametroImpressaoAtivo(req, 'valores', true);
        return {
            valores,
            semCodigo: parametroImpressaoAtivo(req, 'sem_codigo'),
            transportadora: parametroImpressaoAtivo(req, 'transportadora'),
            volumes: parametroImpressaoAtivo(req, 'volumes'),
            descricaoFotos: parametroImpressaoAtivo(req, 'descricao_fotos'),
            localEntrega: parametroImpressaoAtivo(req, 'local_entrega'),
            localRetirada: parametroImpressaoAtivo(req, 'local_retirada'),
            simboloRs: parametroImpressaoAtivo(req, 'simbolo_rs'),
            icmsIpi: parametroImpressaoAtivo(req, 'icms_ipi'),
            icmsPisCofins: parametroImpressaoAtivo(req, 'icms_pis_cofins'),
            projeto: parametroImpressaoAtivo(req, 'projeto'),
            vencimentos: parametroImpressaoAtivo(req, 'vencimentos', true),
            nomeCondicaoPagamento: parametroImpressaoAtivo(req, 'nome_condicao_pagamento')
        };
    }

    // Nome do arquivo pedido pelo usuário (02/09/2026):
    // "<nº do orçamento> - <cliente> - <FOB|CIF> - ERP.pdf".
    // Sai do MESMO `doc` que gerou o PDF, então bate com o que está impresso.
    function nomeArquivoOrcamento(doc, id, sufixo = '') {
        const numero = doc.numero || String(id).padStart(5, '0');
        // Sem barra, dois-pontos e afins: Windows e Linux recusam no nome do arquivo.
        const limpar = (texto, padrao) => String(texto || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60) || padrao;
        const partes = [numero, limpar(doc.cliente, 'Cliente')];
        const frete = siglaModalidadeFrete(doc.tipoFrete, '');
        if (frete) partes.push(frete);
        // "ERP" fica SEMPRE por último — é o formato pedido. Uma variação
        // (ex.: sem impostos) entra antes dele, não depois.
        if (sufixo) partes.push(String(sufixo).trim());
        partes.push('ERP');
        return partes.filter(Boolean).join(' - ') + '.pdf';
    }

    async function montarOrcamentoHtml(req, id) {
        const [pedidos] = await vendasPool.query(`
            SELECT p.*,
                   c.nome as cliente_nome_real,
                   c.razao_social as cliente_razao_social,
                   c.nome_fantasia as cliente_nome_fantasia,
                   COALESCE(c.cnpj, c.cnpj_cpf) as cliente_cnpj,
                   c.inscricao_estadual as cliente_ie,
                   c.contato as cliente_contato,
                   c.email as cliente_email,
                   c.telefone as cliente_telefone,
                   c.endereco as cliente_endereco,
                   c.bairro as cliente_bairro,
                   c.cidade as cliente_cidade,
                   c.estado as cliente_estado,
                   c.cep as cliente_cep,
                   u.nome as vendedor_nome,
                   u.apelido as vendedor_apelido
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.id = ?
        `, [id]);

        if (pedidos.length === 0) return { erro: { status: 404, mensagem: 'Pedido nao encontrado' } };
        const pedido = pedidos[0];

        // O pedido guarda o vínculo da transportadora, mas o documento deve
        // imprimir também os dados cadastrais completos quando essa opção for
        // solicitada. O SELECT principal permanece compatível com bases antigas;
        // este enriquecimento opcional cai silenciosamente se a tabela/colunas
        // ainda não existirem na instância.
        let transportadoraCadastro = null;
        try {
            const transpId = Number(pedido.transportadora_id);
            const nomeTransp = pedido.transportadora_nome || pedido.transportadora || '';
            const [transportadoras] = await vendasPool.query(
                transpId > 0
                    ? 'SELECT * FROM transportadoras WHERE id = ? LIMIT 1'
                    : 'SELECT * FROM transportadoras WHERE razao_social = ? OR nome_fantasia = ? LIMIT 1',
                transpId > 0 ? [transpId] : [nomeTransp, nomeTransp]
            );
            transportadoraCadastro = transportadoras[0] || null;
        } catch (_) { /* dados opcionais: mantém o nome gravado no pedido */ }
        const decPII = valor => {
            if (!valor) return '';
            try { return lgpdCrypto?.decryptPII ? (lgpdCrypto.decryptPII(valor) || '') : valor; }
            catch (_) { return valor; }
        };

        // A impressão segue a mesma política de leitura da carteira de pedidos.
        // Compras, PCP, Logística e supervisores consultam documentos de toda a equipe.
        const isOwner = Number(pedido.vendedor_id) === Number(req.user?.id);
        if (!podeVerTodosPedidosVendas(req.user) && pedido.vendedor_id && req.user && !isOwner) {
            return { erro: { status: 403, mensagem: 'Acesso negado' } };
        }

        // O tipo/status de faturamento não muda a identidade do documento pedido.
        // Orçamento e romaneio possuem ações e rotas distintas: esta função atende
        // somente /orcamento e /pdf. Antes, pedidos parciais/meia-nota retornavam
        // { recibo: true }; a rota então redirecionava silenciosamente para /recibo,
        // deixando o viewer com título "Orçamento" e conteúdo "ROMANEIO".

        let [itens] = await vendasPool.query('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC', [id]);
        if (itens.length === 0 && pedido.produtos_preview) {
            const preview = safeParseJSON(pedido.produtos_preview, []);
            if (Array.isArray(preview)) {
                itens = preview.map(it => ({
                    codigo: it.codigo || '',
                    descricao: it.descricao || it.nome || '',
                    quantidade: parseFloat(it.quantidade) || 0,
                    unidade: it.unidade || 'UN',
                    preco_unitario: parseFloat(it.preco_unitario || it.valor_unitario || it.preco) || 0,
                    desconto: parseFloat(it.desconto) || 0,
                    subtotal: parseFloat(it.total || it.subtotal) || 0
                }));
            }
        }

        // Auditoria de 22/09/2026: 3 pedidos em status "orçamento" (3491, 3627, 3634) não têm
        // NENHUM item em `pedido_itens` nem em `produtos_preview` — nada aqui os impedia de
        // virar um documento "impresso": tabela de itens vazia, valor R$ 0,00 em tudo. Bloqueia
        // ANTES de montar o HTML, com a mesma mensagem clara que outras validações do módulo já
        // usam (NCM ausente, quantidade/preço inválidos) — o rascunho continua editável em
        // Vendas, só a impressão/e-mail/PDF é que não pode sair vazia.
        if (itens.length === 0) {
            return { erro: { status: 422, mensagem: `Pedido #${pedido.id} não tem itens lançados — não é possível gerar o orçamento. Adicione ao menos um item em Vendas antes de imprimir/enviar.` } };
        }

        const opcoes = opcoesImpressaoPedido(req);
        // Descrição detalhada e foto são opcionais e variam entre bases antigas.
        // Descobrimos as colunas existentes antes da consulta para manter o PDF
        // compatível com todas as quatro instâncias.
        if (opcoes.descricaoFotos && itens.length) {
            try {
                const [colunas] = await vendasPool.query('SHOW COLUMNS FROM produtos');
                const nomes = new Set(colunas.map(c => c.Field));
                const colunaImagem = ['imagem_url', 'foto_url', 'imagem', 'foto', 'image_url'].find(c => nomes.has(c));
                const colunaDescricao = ['descricao_detalhada', 'descricao_completa', 'observacoes'].find(c => nomes.has(c));
                if (colunaImagem || colunaDescricao) {
                    const codigos = [...new Set(itens.map(it => it.codigo).filter(Boolean))];
                    if (codigos.length) {
                        const campos = ['codigo'];
                        if (colunaImagem) campos.push('`' + colunaImagem + '` AS __imagem');
                        if (colunaDescricao) campos.push('`' + colunaDescricao + '` AS __descricao');
                        const [produtos] = await vendasPool.query(`SELECT ${campos.join(', ')} FROM produtos WHERE codigo IN (?)`, [codigos]);
                        const porCodigo = new Map(produtos.map(p => [String(p.codigo), p]));
                        itens = itens.map(it => ({ ...it, ...(porCodigo.get(String(it.codigo)) || {}) }));
                    }
                }
            } catch (_) { /* recurso opcional: o pedido continua imprimível sem foto */ }
        }

        // Fallback: pedido criado com o NOME do cliente digitado (sem cliente_id
        // vinculado) → o JOIN não traz os dados cadastrais. Resolver pelo nome.
        if (!pedido.cliente_cnpj && (pedido.cliente_nome || pedido.cliente)) {
            try {
                const nomeBusca = pedido.cliente_nome || pedido.cliente;
                const [[cli]] = await vendasPool.query(
                    `SELECT COALESCE(cnpj, cnpj_cpf) AS cnpj, inscricao_estadual, contato, telefone, email,
                            endereco, bairro, cidade, estado, cep, razao_social, nome_fantasia, nome
                     FROM clientes WHERE razao_social = ? OR nome = ? OR nome_fantasia = ? LIMIT 1`,
                    [nomeBusca, nomeBusca, nomeBusca]
                );
                if (cli) {
                    pedido.cliente_cnpj          = pedido.cliente_cnpj          || cli.cnpj;
                    pedido.cliente_ie            = pedido.cliente_ie            || cli.inscricao_estadual;
                    pedido.cliente_contato       = pedido.cliente_contato       || cli.contato;
                    pedido.cliente_telefone      = pedido.cliente_telefone      || cli.telefone;
                    pedido.cliente_email         = pedido.cliente_email         || cli.email;
                    pedido.cliente_endereco      = pedido.cliente_endereco      || cli.endereco;
                    pedido.cliente_bairro        = pedido.cliente_bairro        || cli.bairro;
                    pedido.cliente_cidade        = pedido.cliente_cidade        || cli.cidade;
                    pedido.cliente_estado        = pedido.cliente_estado        || cli.estado;
                    pedido.cliente_cep           = pedido.cliente_cep           || cli.cep;
                    pedido.cliente_razao_social  = pedido.cliente_razao_social  || cli.razao_social;
                    pedido.cliente_nome_fantasia = pedido.cliente_nome_fantasia || cli.nome_fantasia;
                }
            } catch (_e) { /* best-effort: mantém o que veio do JOIN */ }
        }

        // Empresa (configuracoes_empresa da instancia) + logo por marca
        const empresaConfig = await buscarConfiguracoesEmpresa(pool);
        const dados = formatarDadosParaPDF(empresaConfig);
        const identidadeCabecalho = montarIdentidadeCabecalho(dados.nome, dados.nomeFantasia);
        const BRAND = (process.env.BRAND || '').toLowerCase();
        const BRAND_LOGOS = {
            'labor-eletric': '/images/labor-eletric-logo.png',
            'labor-energy': '/images/labor-energy-logo.png',
            'cobal': '/images/cobal-logo.png',
            'agencia-japa': '/images/agencia-japa-logo.png',
            'zyntra': '/images/zyntra-sem-fundo.png'
        };
        const empresaLogo = BRAND_LOGOS[BRAND] || empresaConfig.logo_url || '/images/Logo Monocromatico - Azul - Aluforce.png';

        // Helpers
        const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const moeda = (v) => 'R$ ' + (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const numBR = (v) => (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        // Unitario liquido: 2 casas no caso comum, 4 quando o desconto produz fracao de
        // centavo — senao `unitario x qtd` nao bate com o total impresso na mesma linha.
        const moedaUnit = (v) => {
            const n = parseFloat(v) || 0;
            const casas = Math.abs(n - Math.round(n * 100) / 100) < 0.000005 ? 2 : 4;
            return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
        };
        const fmtData = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

        // Status -> rotulo + classe de badge do template
        const statusMap = {
            'orcamento':'Orçamento','em-analise':'Em Análise','negociacao':'Negociação',
            'pedido-aprovado':'Pedido Aprovado','em-producao':'Em Produção','aguardando':'Aguardando',
            'faturado':'Faturado','cancelado':'Cancelado','recibo':'Recibo','entregue':'Entregue','finalizado':'Finalizado','pronto':'Pronto'
        };
        const statusRaw = (pedido.status || 'orcamento').toLowerCase().trim();
        const statusNome = statusMap[statusRaw] || statusRaw.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const badgeMap = {
            'orcamento':'badge-amber','em-analise':'badge-amber','negociacao':'badge-amber','aguardando':'badge-amber',
            'pedido-aprovado':'badge-green','faturado':'badge-green','entregue':'badge-green','finalizado':'badge-green','pronto':'badge-green','recibo':'badge-green',
            'cancelado':'badge-red'
        };
        const statusClasse = badgeMap[statusRaw] || 'badge-blue';

        // Título do documento: reflete o estágio real do pedido — evita mostrar
        // "ORÇAMENTO" junto de um status como "Aprovado"/"Faturado", que é contraditório.
        const tituloMap = {
            'orcamento':'Orçamento','em-analise':'Orçamento','negociacao':'Orçamento','aguardando':'Orçamento',
            'pedido-aprovado':'Pedido de Venda','em-producao':'Pedido de Venda','pronto':'Pedido de Venda',
            'faturado':'Pedido Faturado','recibo':'Pedido Faturado','entregue':'Pedido Faturado','finalizado':'Pedido Faturado',
            'cancelado':'Pedido Cancelado'
        };
        const documentoTitulo = tituloMap[statusRaw] || 'Orçamento';

        // Itens + totais
        // "Vlr. Unit." imprime o unitario JA COM O DESCONTO do item: o percentual digitado no
        // modal de item vira valor em `pedido_itens.desconto`. O documento NAO tem coluna de
        // desconto — o abatimento vive dentro do unitario, e a linha fecha (unitario x qtd = total).
        // Por isso o Subtotal aqui e a soma dos totais JA LIQUIDOS das linhas.
        let subtotal = 0;
        const itensTpl = itens.map((it, i) => {
            const qtd = parseFloat(it.quantidade) || 0;
            const unit = parseFloat(it.preco_unitario) || 0;
            const desc = parseFloat(it.desconto) || 0;
            const total = parseFloat(it.subtotal || it.preco_total) || (qtd * unit - desc);
            const bruto = qtd * unit;
            const unitLiquido = qtd > 0 ? (bruto - desc) / qtd : Math.max(unit - desc, 0);
            subtotal += total;
            const imagemRaw = it.__imagem || it.imagem_url || it.foto_url || it.imagem || it.foto || '';
            const imagem = /^(https?:\/\/|\/)/i.test(String(imagemRaw))
                ? `<img class="product-thumb" src="${esc(imagemRaw)}" alt="" />` : '';
            const descricaoBase = opcoes.descricaoFotos
                ? (it.__descricao || it.descricao_detalhada || it.descricao_completa || it.descricao || '—')
                : (it.descricao || it.nome || '—');
            const descricao = esc(descricaoBase) + imagem;
            const valorIcmsSt = parseFloat(it.valor_icms_st || it.icms_st || it.icms_st_valor) || 0;
            const valorIpi = parseFloat(it.valor_ipi || it.ipi_valor || it.ipi) || 0;
            const valorIcms = parseFloat(it.valor_icms || it.icms_valor || it.icms) || 0;
            const valorPis = parseFloat(it.valor_pis || it.pis_valor || it.pis) || 0;
            const valorCofins = parseFloat(it.valor_cofins || it.cofins_valor || it.cofins) || 0;
            return {
                num: String(i + 1).padStart(2, '0'),
                codigo: esc(it.codigo || '—'), descricao,
                qtd: numBR(qtd),
                unidade: esc(it.unidade || 'UN'),
                valor_unit: moedaUnit(unitLiquido),
                total: moeda(total),
                icms_st_item: moeda(valorIcmsSt), ipi_item: moeda(valorIpi),
                icms_item: moeda(valorIcms), pis_item: moeda(valorPis), cofins_item: moeda(valorCofins)
            };
        });

        const comImpostos = opcoes.valores && orcamentoComImpostos(req);
        const tituloValor = opcoes.simboloRs ? 'R$ Vlr. Unit.' : 'Vlr. Unit.';
        const tituloTotal = opcoes.simboloRs ? 'R$ Total' : 'Total';
        const cabecalhoItens = [
            '<th class="text-center col-seq">#</th>',
            ...(opcoes.semCodigo ? [] : ['<th class="col-code">Código</th>']),
            '<th class="col-desc">Descrição</th><th class="text-center col-qtd">Qtd.</th><th class="text-center col-un">UN</th>',
            ...(opcoes.valores ? [`<th class="text-right col-money">${tituloValor}</th>`, `<th class="text-right col-money">${tituloTotal}</th>`] : []),
            ...(opcoes.valores && opcoes.icmsIpi ? ['<th class="text-right">ICMS ST</th><th class="text-right">IPI</th>'] : []),
            ...(opcoes.valores && opcoes.icmsPisCofins ? ['<th class="text-right">ICMS</th><th class="text-right">PIS</th><th class="text-right">COFINS</th>'] : [])
        ].join('');
        const linhasItens = itensTpl.map(it => {
            const celulas = [
                `<td class="text-center num-cell col-seq">${it.num}</td>`,
                ...(opcoes.semCodigo ? [] : [`<td class="col-code">${it.codigo}</td>`]),
                `<td class="col-desc">${it.descricao}</td><td class="text-center num-cell col-qtd">${it.qtd}</td><td class="text-center num-cell col-un">${it.unidade}</td>`,
                ...(opcoes.valores ? [`<td class="text-right num-cell col-money">${it.valor_unit}</td>`, `<td class="text-right num-cell col-money"><strong>${it.total}</strong></td>`] : []),
                ...(opcoes.valores && opcoes.icmsIpi ? [`<td class="text-right num-cell">${it.icms_st_item}</td>`, `<td class="text-right num-cell">${it.ipi_item}</td>`] : []),
                ...(opcoes.valores && opcoes.icmsPisCofins ? [`<td class="text-right num-cell">${it.icms_item}</td>`, `<td class="text-right num-cell">${it.pis_item}</td>`, `<td class="text-right num-cell">${it.cofins_item}</td>`] : [])
            ];
            return `<tr>${celulas.join('')}</tr>`;
        }).join('');

        if (subtotal === 0) subtotal = parseFloat(pedido.valor) || 0;
        // Desconto de CABECALHO (`pedidos.desconto_pct` / `pedidos.desconto`) — esse nao esta
        // embutido no unitario dos itens, entao continua aparecendo na caixa de totais.
        const descontoPctPedido = parseFloat(pedido.desconto_pct) || 0;
        const totalDesc = parseFloat(pedido.desconto) || (descontoPctPedido > 0 ? subtotal * (descontoPctPedido / 100) : 0);
        const frete = parseFloat(pedido.frete) || 0;
        const ipi = parseFloat(pedido.total_ipi || pedido.ipi) || 0;
        // ICMS ST entra no documento: `pedidos.valor` JA o inclui (o backend fecha
        // valor = subtotais + IPI + ICMS-ST + frete), entao sem esta linha as parcelas
        // do quadro de totais nao somavam o Total impresso logo abaixo delas.
        const icmsSt = parseFloat(pedido.total_icms_st || pedido.icms_st) || 0;
        // ICMS próprio: destacado abaixo do Total porque JÁ ESTA no preço — somá-lo
        // duplicaria o documento. Sai da tela quando o pedido não tem ICMS destacado
        // (Simples Nacional, por exemplo).
        const icmsProprio = parseFloat(pedido.total_icms) || 0;
        // Tributos ESTADUAIS que entram no valor cobrado, além do ICMS-ST:
        // FCP-ST (Fundo de Combate à Pobreza sobre a Substituição Tributária — 2% no RJ,
        // também escrito FECP-ST) e o DIFAL de venda a não-contribuinte.
        // `total_fcp` é o FCP DESTINO (do DIFAL, venda interestadual a não contribuinte);
        // o FCP-ST tem coluna própria. Somá-los na mesma linha misturaria dois tributos.
        // O FCP só é devido quando a UF do DESTINATÁRIO instituiu o fundo. Pará, Amapá e
        // Santa Catarina não o possuem: destacar a linha para um cliente desses cobraria
        // um tributo que o estado não criou. A alíquota cadastrada em `aliquotas_icms_uf`
        // manda; sem linha para a UF vale a tabela versionada de utils/vendas-fiscal.
        // Vale para os DOIS tributos de FCP (o FCP-ST e o FCP destino do DIFAL) — o DIFAL
        // em si continua, porque ele é devido mesmo onde não há FCP.
        let fcpAliquotaCadastrada;
        try {
            const [[linhaFcp]] = await vendasPool.query(
                'SELECT fcp_aliquota FROM aliquotas_icms_uf WHERE uf_destino = ? ORDER BY id LIMIT 1',
                [String(pedido.cliente_estado || '').trim().toUpperCase()]
            );
            if (linhaFcp) fcpAliquotaCadastrada = linhaFcp.fcp_aliquota;
        } catch (_) { /* base sem a tabela fiscal: decide pela tabela versionada */ }
        // `false` só sai quando dá para PROVAR que a UF não cobra. Pedido sem UF preenchida
        // devolve null e nada é zerado — sumir com tributo por falta de cadastro seria pior.
        const clienteTemFcp = ufCobraFcp(pedido.cliente_estado, fcpAliquotaCadastrada) !== false;
        const fcpSt = clienteTemFcp ? (parseFloat(pedido.total_fcp_st) || 0) : 0;
        const fcpDestino = clienteTemFcp ? (parseFloat(pedido.total_fcp) || 0) : 0;
        const difal = (parseFloat(pedido.total_difal) || 0) + fcpDestino;

        // O Total é SEMPRE a soma das parcelas mostradas no quadro. Antes ele vinha de
        // `pedidos.valor`, que DIVERGE: medido em 03/09/2026, 258 pedidos da aluforce (7%)
        // e 171 da Energy (11%) tinham ali um valor sem o ICMS-ST somado — o documento
        // imprimia "ICMS ST R$ 472,53" e um Total idêntico ao Subtotal, sem fechar.
        // Subtotal continua SEM impostos (o Vlr. Unit. do item já é o líquido).
        const totalComImpostos = subtotal - totalDesc + frete + ipi + icmsSt + fcpSt + difal;
        const totalSemImpostos = Math.max(0, subtotal - totalDesc + frete);
        const totalGeral = totalComImpostos;
        const totalDocumento = comImpostos ? totalComImpostos : totalSemImpostos;
        const vencimentos = opcoes.valores && opcoes.vencimentos
            ? montarVencimentos(pedido, totalDocumento, { icmsSt: comImpostos ? icmsSt : 0 })
            : null;
        const nomeCondicaoPagamentoHtml = vencimentos && opcoes.nomeCondicaoPagamento
            ? `<span>Condição de pagamento: ${esc(vencimentos.titulo)}</span>`
            : '';
        const vencimentosHtml = vencimentos ? `<section class="vencimentos avoid-break">
            <h2>Vencimentos ${nomeCondicaoPagamentoHtml}</h2>
            <table class="vencimentos-table"><tbody>
              <tr><th>Parcela</th>${vencimentos.parcelas.map(p => `<td>${p.numero}</td>`).join('')}</tr>
              <tr><th>Vencimento</th>${vencimentos.parcelas.map(p => `<td>${esc(p.vencimento)}</td>`).join('')}</tr>
              <tr><th>Valor</th>${vencimentos.parcelas.map(p => `<td>${numBR(p.valor)}</td>`).join('')}</tr>
            </tbody></table></section>` : '';

        const validade = pedido.data_validade
            ? fmtData(pedido.data_validade)
            : (() => { const b = pedido.created_at ? new Date(pedido.created_at) : new Date(); b.setDate(b.getDate() + 7); return b.toLocaleDateString('pt-BR'); })();

        const enderecoCliente = [pedido.cliente_endereco, pedido.cliente_bairro].filter(Boolean).join(', ');
        const cidadeCliente = [pedido.cliente_cidade, pedido.cliente_estado].filter(Boolean).join('/');
        const nomeCliente = pedido.cliente_razao_social || pedido.cliente_nome_fantasia || pedido.cliente_nome_real || pedido.cliente_nome || 'Cliente nao informado';
        let observacoes = pedido.observacao || pedido.observacoes || pedido.descricao || '';
        if (BRAND === 'agencia-japa' && (!String(observacoes).trim() || /cabos de alum[ií]nio|cobre \(LME/i.test(observacoes))) {
            observacoes = fs.readFileSync(path.join(__dirname, '..', 'public', 'relatorios', 'agencia-japa-condicoes.txt'), 'utf8').trim();
        }
        const condicoes = pedido.condicoes_pagamento || pedido.condicao_pagamento || pedido.forma_pagamento || (pedido.parcelas ? `${pedido.parcelas} dias` : 'A combinar');
        const nomeVendedor = nomeVendedorParaOrcamento(
            pedido.vendedor_orcamento_nome,
            pedido.vendedor_apelido || pedido.vendedor_nome
        );
        // O rodape identifica quem emitiu o documento. Em acessos administrativos,
        // o vendedor do pedido continua no quadro comercial, mas o emissor e o
        // usuario autenticado; pedidos legados sem vendedor usam esse mesmo fallback.
        const identidadeEmissor = req.user?.nome || req.user?.name || req.user?.apelido ||
            (req.user?.email ? String(req.user.email).split('@')[0] : '');
        const nomeEmissor = identidadeEmissor
            ? nomeVendedorParaOrcamento(null, identidadeEmissor)
            : nomeVendedor;
        // Prazo de entrega: sai "A combinar" so quando o pedido realmente nao possui prazo.
        // `prazo_entrega` e INT (dias), `data_previsao` e a data gravada pelo pedido atual e
        // `data_prevista` cobre os pedidos legados/importados. Parte dos orcamentos antigos
        // guarda o prazo apenas nas observacoes (ex.: "FRETE FOB-25 DIAS"); esse fallback
        // aceita somente expressoes explicitamente ligadas a frete/entrega para nao capturar
        // percentuais, parcelas ou outros numeros soltos.
        const prazoEntrega = (() => {
            const dias = parseInt(pedido.prazo_entrega, 10);
            if (Number.isFinite(dias) && dias > 0) return `${dias} dia${dias > 1 ? 's' : ''}`;
            const previsao = pedido.data_previsao || pedido.data_prevista || pedido.data_previsao_entrega;
            if (previsao) {
                const d = new Date(previsao);
                if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
            }

            const texto = String(observacoes || '').replace(/\s+/g, ' ').trim();
            const padroes = [
                /\bFRETE\s+(?:CIF|FOB)\s*[-–—:]?\s*(AT[EÉ]\s+)?(\d{1,3})\s*DIAS?(?:\s+(?:PARA\s+)?ENTREGA)?\b/i,
                /\b(AT[EÉ]\s+)?(\d{1,3})\s*DIAS?\s+(?:PARA\s+)?ENTREGA\b/i,
                /\bPRAZO\s+(?:DE\s+)?ENTREGA\s*(?:DE|:|-)?\s*(AT[EÉ]\s+)?(\d{1,3})\s*DIAS?\b/i
            ];
            for (const padrao of padroes) {
                const match = texto.match(padrao);
                if (!match) continue;
                const diasTexto = parseInt(match[2], 10);
                if (Number.isFinite(diasTexto) && diasTexto > 0) {
                    const prefixo = match[1] ? 'Até ' : '';
                    return `${prefixo}${diasTexto} dia${diasTexto > 1 ? 's' : ''}`;
                }
            }
            return 'A combinar';
        })();

        const textoEndereco = (prefixo, campos) => {
            const valor = campos.filter(Boolean).join(', ');
            return valor ? `<div class="note-box optional-note"><p class="note-title">${prefixo}</p><p>${esc(valor)}</p></div>` : '';
        };
        const entrega = [pedido.endereco_entrega || pedido.local_entrega, pedido.bairro_entrega, pedido.cidade_entrega || pedido.municipio_entrega, pedido.estado_entrega, pedido.cep_entrega && `CEP ${pedido.cep_entrega}`];
        const retirada = [dados.endereco, dados.numero, dados.bairro, dados.cidade, dados.estado, dados.cep && `CEP ${dados.cep}`];
        const transporte = [
            transportadoraCadastro?.nome_fantasia || transportadoraCadastro?.razao_social
                || transportadoraCadastro?.nome || pedido.transportadora_nome || pedido.transportadora,
            transportadoraCadastro?.cnpj_cpf && `CNPJ ${decPII(transportadoraCadastro.cnpj_cpf)}`,
            transportadoraCadastro?.inscricao_estadual && `IE ${decPII(transportadoraCadastro.inscricao_estadual)}`,
            transportadoraCadastro?.contato && `Contato ${transportadoraCadastro.contato}`,
            transportadoraCadastro?.telefone && `Telefone ${transportadoraCadastro.telefone}`,
            transportadoraCadastro?.email && `E-mail ${transportadoraCadastro.email}`,
            [transportadoraCadastro?.endereco, transportadoraCadastro?.bairro,
                transportadoraCadastro?.cidade, transportadoraCadastro?.estado || transportadoraCadastro?.uf,
                transportadoraCadastro?.cep && `CEP ${transportadoraCadastro.cep}`].filter(Boolean).join(', '),
            pedido.tipo_frete && `Frete ${pedido.tipo_frete}`,
            pedido.placa_veiculo && `Placa ${pedido.placa_veiculo}`,
            pedido.veiculo_uf && `UF ${pedido.veiculo_uf}`,
            pedido.rntrc && `RNTRC ${pedido.rntrc}`
        ];
        const volumes = [pedido.quantidade_volumes || pedido.qtd_volumes, pedido.especie_volumes, pedido.marca_volumes, pedido.numeracao_volumes, pedido.peso_bruto && `Peso bruto ${pedido.peso_bruto}`, pedido.peso_liquido && `Peso líquido ${pedido.peso_liquido}`];
        const adicionais = [
            opcoes.transportadora && textoEndereco('Transportadora', transporte),
            opcoes.volumes && textoEndereco('Volumes transportados', volumes),
            opcoes.localEntrega && textoEndereco('Local de entrega', entrega),
            opcoes.localRetirada && textoEndereco('Local de retirada', retirada),
            opcoes.projeto && (pedido.projeto || pedido.projeto_nome || pedido.projeto_id) && textoEndereco('Sobre o projeto', [pedido.projeto || pedido.projeto_nome || `Projeto #${pedido.projeto_id}`])
        ].filter(Boolean).join('');

        const data = {
            report_classe: BRAND === 'agencia-japa' ? (itens.length <= 1 ? 'agency-report agency-one-item' : 'agency-report') : '',
            empresa_logo: empresaLogo,
            empresa_nome: esc(dados.nomeFantasia || 'ALUFORCE'),
            // Cabeçalho por marca: na Cobal o destaque é a fantasia e a razão social
            // desce para a linha discreta. O renderizador logo abaixo NÃO escapa nada
            // (por isso o `esc` em todo campo), então os dois valores passam por ele.
            empresa_razao_social: esc(identidadeCabecalho.empresa_razao_social),
            empresa_razao_social_linha: identidadeCabecalho.empresa_razao_social_linha
                .map(l => ({ texto: esc(l.texto) })),
            empresa_cnpj: esc(dados.cnpj),
            empresa_ie: esc(dados.inscricaoEstadual),
            empresa_endereco: esc([dados.endereco, dados.numero].filter(Boolean).join(', ') + (dados.bairro ? ' - ' + dados.bairro : '')),
            empresa_cidade: esc(`${dados.cidade}/${dados.estado} - CEP ${dados.cep}`),
            empresa_telefone: esc(dados.telefone),
            empresa_email: esc(dados.email || ''),
            empresa_site: esc(dados.site || ''),
            // Sufixo pronto pro rodapé: sem isso, empresa sem site cadastrado (ex.: Labor
            // Energy depois de corrigido o "aluforce.ind.br" herdado do clone) imprimia
            // "Nome &bull;" com marcador solto e nada depois.
            empresa_site_sufixo: dados.site ? ` &bull; ${esc(dados.site)}` : '',

            // O numero impresso e `numero_pedido` — o sequencial por instancia que a lista de
            // pedidos ja mostra. O `id` e a PK da tabela e nao reinicia quando a base e clonada
            // e os pedidos apagados (na Cobal o 2o pedido tem id 34), o que dava um numero absurdo.
            numero_orcamento: String(pedido.numero_pedido || pedido.id).padStart(5, '0'),
            documento_titulo: esc(documentoTitulo),
            status: esc(statusNome),
            status_classe: statusClasse,
            data_emissao: fmtData(pedido.created_at),
            vendedor: esc(nomeVendedor),
            validade: validade,

            cliente_nome: esc(nomeCliente),
            cliente_cnpj: esc(pedido.cliente_cnpj || '—'),
            cliente_ie: esc(formatStateRegistration(pedido.cliente_ie)),
            cliente_telefone: esc(pedido.cliente_telefone || '—'),
            cliente_email: esc(pedido.cliente_email || '—'),
            cliente_contato: esc(pedido.cliente_contato || '—'),
            cliente_endereco: esc(enderecoCliente || '—'),
            cliente_cidade: esc(cidadeCliente || '—'),
            cliente_cep: esc(pedido.cliente_cep || '—'),
            tipo_frete: esc(siglaModalidadeFrete(pedido.tipo_frete)),
            prazo_entrega: esc(prazoEntrega),

            itens: itensTpl,
            itens_cabecalho: cabecalhoItens,
            itens_linhas: linhasItens,
            itens_tabela_classe: (opcoes.icmsIpi || opcoes.icmsPisCofins) ? 'tax-columns' : '',
            informacoes_adicionais: adicionais,
            informacoes_adicionais_display: adicionais ? '' : 'display:none',

            subtotal: moeda(subtotal),
            totais_display: opcoes.valores ? '' : 'display:none',
            desconto: moeda(totalDesc),
            desconto_display: totalDesc > 0 ? '' : 'display:none',
            frete: moeda(frete),
            frete_display: frete > 0 ? '' : 'display:none',
            ipi: moeda(ipi),
            ipi_display: comImpostos ? '' : 'display:none',
            icms_st: moeda(icmsSt),
            icms_st_display: comImpostos ? '' : 'display:none',
            // Tributo estadual só aparece quando existe: linha zerada polui o documento.
            fcp_st: moeda(fcpSt),
            fcp_st_display: (comImpostos && fcpSt > 0) ? '' : 'display:none',
            difal: moeda(difal),
            difal_display: (comImpostos && difal > 0) ? '' : 'display:none',
            icms: moeda(icmsProprio),
            icms_display: (comImpostos && icmsProprio > 0) ? '' : 'display:none',
            total: moeda(totalDocumento),

            condicoes_pagamento: esc(condicoes),
            vencimentos_html: vencimentosHtml,
            observacoes_classe: BRAND === 'agencia-japa' ? 'agency-terms' : '',
            observacoes: formatarObservacoes(observacoes, esc, BRAND === 'agencia-japa'),
            observacoes_display: observacoes ? '' : 'display:none',

            sistema_nome: 'ZYNTRA',
            gerado_por: esc(nomeEmissor || 'Usuário do sistema'),
            gerado_em: new Date().toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            })
        };

        // Renderizar o template (secoes {{#itens}}...{{/itens}} + {{chave}})
        // O orçamento usa o template publicado em public/relatorios. O resolvedor
        // genérico prefere uma cópia antiga em Templates - Sistema, que não contém
        // o quadro de vencimentos nem os ajustes de paginação da agência.
        const tplPath = path.join(__dirname, '..', 'public', 'relatorios', 'orcamento.html');
        let html = fs.readFileSync(tplPath, 'utf8');
        html = html.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => {
            const arr = data[key];
            if (!Array.isArray(arr) || arr.length === 0) return '';
            return arr.map(item => inner.replace(/\{\{([^#/}][^}]*)\}\}/g, (_m, k) => {
                const v = item[k.trim()];
                return v !== undefined && v !== null ? String(v) : '';
            })).join('');
        });
        html = html.replace(/\{\{([^#/}][^}]*)\}\}/g, (_m, k) => {
            const v = data[k.trim()];
            return v !== undefined && v !== null ? String(v) : '';
        });

        return {
            html,
            numero: data.numero_orcamento,
            comImpostos,
            // Usados para montar o nome do arquivo — mesmos valores do documento.
            cliente: nomeCliente,
            tipoFrete: pedido.tipo_frete,
            // Identidade do documento, para o e-mail falar a MESMA lingua do PDF.
            // `numero` vai zero-preenchido (nome do arquivo); `numeroExibicao` e o
            // numero como o usuario le ("Nº 1218").
            documentoTitulo,
            numeroExibicao: String(pedido.numero_pedido || pedido.id),
            clienteNome: nomeCliente,
            empresaNome: identidadeCabecalho.empresa_razao_social,
            empresaFantasia: dados.nomeFantasia || '',
            empresaLogo,
            empresaConfig
        };
    }

    router.get('/pedidos/:id/orcamento', authenticateToken, authorizeVendasDocumentos, async (req, res) => {
        const { id } = req.params;
        try {
            const doc = await montarOrcamentoHtml(req, id);
            if (doc.erro) return res.status(doc.erro.status).send('<h1>' + doc.erro.mensagem + '</h1>');

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(doc.html);
        } catch (err) {
            console.error('[ORCAMENTO-HTML] Erro:', err);
            return res.status(500).send('<h1>Erro ao gerar o orcamento</h1><p>' + (err.message || '') + '</p>');
        }
    });

    // PDF do orçamento — é o MESMO documento da tela, impresso pelo Chromium
    // (services/pdf-render.service). Antes esta rota desenhava um layout
    // próprio em PDFKit: o botão "Salvar PDF" do Report Viewer baixava um
    // documento diferente do que o "Imprimir" gerava para o mesmo pedido.
    router.get('/pedidos/:id/pdf', authenticateToken, authorizeVendasDocumentos, async (req, res) => {
        const { id } = req.params;
        try {
            const doc = await montarOrcamentoHtml(req, id);
            if (doc.erro) return res.status(doc.erro.status).json({ success: false, message: doc.erro.mensagem });

            // O template traz @page A4 dentro do @media print; preferCSSPageSize
            // faz o Chromium respeitar essas margens.
            const pdf = await htmlParaPdf(doc.html, {
                ajustarOrcamento: true,
                credenciais: {
                    cookie: req.headers.cookie,
                    authorization: req.headers.authorization
                }
            });

            // Mesmo numero impresso no documento (`numero_pedido`), nao o id da tabela.
            const sufixoVersao = doc.comImpostos === false ? 'sem impostos' : '';
            const nomeArquivo = nomeArquivoOrcamento(doc, id, sufixoVersao);
            res.setHeader('Content-Type', 'application/pdf');
            // O visor usa `inline` para exibir o PDF. Já o botão "Salvar PDF"
            // chama a mesma rota com `download=1`: nesse caminho o navegador
            // recebe um download HTTP real, com nome definido pelo servidor,
            // sem passar por uma URL blob (que o Chromium nomeia com UUID).
            const disposicao = req.query.download === '1' ? 'attachment' : 'inline';
            res.setHeader('Content-Disposition', `${disposicao}; filename="${nomeArquivo}"`);
            res.setHeader('Content-Length', pdf.length);
            console.log('[PDF-ORCAMENTO] Documento gerado: ' + nomeArquivo);
            return res.end(pdf);
        } catch (erro) {
            console.error('[PDF-ORCAMENTO] Erro:', erro);
            return res.status(erro.status || 500).json({
                success: false,
                message: erro.message || 'Erro ao gerar o PDF do orçamento'
            });
        }
    });

    // ================================================================
    // Corpo do e-mail que acompanha o pedido de venda / orcamento.
    //
    // A previa exibida no modal e o HTML realmente enviado saem DAQUI, com a
    // unica diferenca sendo a origem da logo: na previa e o caminho web
    // (/images/...), no envio e um anexo inline `cid:` -- caminho relativo nao
    // carrega dentro de cliente de e-mail, e data: URI costuma ser bloqueado.
    // ================================================================
    const LOGO_CID_ORCAMENTO = 'logo-documento-zyntra';

    function montarCorpoEmailOrcamento(dados) {
        const esc = (v) => String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const documento = dados.documento || 'Orcamento';
        const numero = dados.numeroExibicao || '';
        const empresa = dados.empresaNome || '';
        const complemento = String(dados.textoComplementar || '').trim();

        // Prefixo do assunto: a MARCA, nao a razao social inteira. As 4 instancias
        // guardam um `nome_fantasia` descritivo ("ALUFORCE INDUSTRIA E COMERCIO DE
        // CONDUTORES ELETRICOS"), que faria um assunto ilegivel na caixa de entrada.
        // Corta no primeiro termo generico de ramo ou tipo societario; se sobrar nada
        // (nome que COMECA por um desses termos), mantem o nome inteiro.
        const marcaCurta = (nome) => {
            const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
            const generico = /^(ind[uú]stria|ind|com[eé]rcio|com|distribuidora|servi[cç]os|materiais|produtos|condutores|el[eé]tricos|eletricos|unipessoal|ltda|s\/?a|sa|eireli|me|epp|e|de|da|do)$/i;
            const marca = [];
            for (const parte of partes) {
                if (generico.test(parte.replace(/[.,]/g, ''))) break;
                marca.push(parte);
                if (marca.length >= 3) break;
            }
            return (marca.length ? marca.join(' ') : String(nome || '')).toUpperCase();
        };
        const assunto = (dados.assunto && String(dados.assunto).trim())
            || `${marcaCurta(dados.empresaFantasia || empresa) || 'DOCUMENTO'} - ${documento} Nº ${numero}`;

        const linhas = [
            'Prezado Cliente,',
            `Anexo o arquivo PDF com o(a) ${documento} Nº ${numero}.`
        ];
        if (complemento) linhas.push(complemento);
        linhas.push('Obrigado!');
        if (empresa) linhas.push(empresa);
        const texto = linhas.join('\n\n');

        const logo = dados.logoSrc
            ? `<img src="${esc(dados.logoSrc)}" alt="${esc(empresa)}" style="max-height:64px;max-width:220px;display:block;margin-bottom:26px;">`
            : '';
        const paragrafo = (conteudo, extra) =>
            `<p style="margin:0 0 18px;font-size:14px;color:#334155;line-height:1.6;${extra || ''}">${conteudo}</p>`;

        const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:28px 24px;background:#ffffff;">`
            + logo
            + paragrafo('Prezado Cliente,')
            + paragrafo(`Anexo o arquivo PDF com o(a) ${esc(documento)} Nº ${esc(numero)}.`)
            + (complemento ? paragrafo(esc(complemento), 'white-space:pre-wrap;') : '')
            + paragrafo('Obrigado!')
            + (empresa ? paragrafo(`<span style="color:#1e3a8a;font-weight:600;">${esc(empresa)}</span>`) : '')
            + `</div>`;

        return { assunto, html, texto };
    }

    // Le a logo de documentos do disco para anexar inline. Best-effort: sem a
    // logo o e-mail sai igual, so sem a imagem no topo -- nao e motivo para
    // derrubar o envio.
    async function anexoLogoOrcamento() {
        try {
            const empresaConfig = await buscarConfiguracoesEmpresa(pool);
            const caminho = resolverCaminhoLogo(empresaConfig);
            if (!caminho || !fs.existsSync(caminho)) return null;
            const conteudo = fs.readFileSync(caminho);
            if (!conteudo || !conteudo.length) return null;
            const ext = String(path.extname(caminho) || '.png').toLowerCase().replace('.', '');
            return {
                filename: `logo.${ext === 'jpg' ? 'jpeg' : ext}`,
                content: conteudo,
                contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
                cid: LOGO_CID_ORCAMENTO
            };
        } catch (erro) {
            console.warn('[ORCAMENTO-EMAIL] Logo nao anexada:', erro.message);
            return null;
        }
    }

    // GET /pedidos/:id/orcamento-email-preparo -- enche o compositor.
    // Aceita ?impostos=0 para que assunto/previa sigam a versao escolhida no
    // modal de impressao.
    // As opcoes da impressao (valores, transportadora, volumes...) viajam na
    // querystring. No POST elas chegam em `pdf_params` -- a MESMA querystring que
    // gerou o documento na tela -- e sao devolvidas para `req.query`, para que o
    // anexo seja exatamente o arquivo que o usuario acabou de conferir. Sem isto o
    // e-mail levaria o documento no formato padrao, diferente do impresso.
    function aplicarParametrosDoPdf(req) {
        const bruto = req.body && req.body.pdf_params;
        if (!bruto) return;
        const extra = new URLSearchParams(String(bruto).replace(/^\?/, ''));
        const mesclado = Object.assign({}, req.query);
        for (const [chave, valor] of extra.entries()) mesclado[chave] = valor;
        req.query = mesclado;
    }

    router.get('/pedidos/:id/orcamento-email-preparo', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        const { id } = req.params;
        try {
            const doc = await montarOrcamentoHtml(req, id);
            if (doc.erro) {
                return res.status(doc.erro.status).json({ success: false, message: doc.erro.mensagem });
            }

            const [[pedido]] = await vendasPool.query(
                `SELECT p.id, p.numero_pedido, p.email_cliente, c.email AS cliente_email
                   FROM pedidos p
                   LEFT JOIN clientes c ON c.id = p.cliente_id
                  WHERE p.id = ? LIMIT 1`,
                [id]
            );

            const corpo = montarCorpoEmailOrcamento({
                documento: doc.documentoTitulo,
                numeroExibicao: doc.numeroExibicao,
                empresaNome: doc.empresaNome,
                empresaFantasia: doc.empresaFantasia,
                logoSrc: doc.empresaLogo
            });

            const sufixo = doc.comImpostos === false ? '-sem-impostos' : '';
            return res.json({
                success: true,
                documento: doc.documentoTitulo,
                numero: doc.numeroExibicao,
                cliente: doc.clienteNome,
                empresa: doc.empresaNome,
                com_impostos: doc.comImpostos !== false,
                destinatario_sugerido: (pedido && (pedido.email_cliente || pedido.cliente_email)) || '',
                assunto_sugerido: corpo.assunto,
                conteudo_html: corpo.html,
                arquivo: nomeArquivoOrcamento(doc, id, sufixo ? 'sem impostos' : '')
            });
        } catch (erro) {
            console.error('[ORCAMENTO-EMAIL] Preparo falhou:', erro);
            return res.status(erro.status || 500).json({
                success: false,
                message: erro.message || 'Erro ao preparar o e-mail.'
            });
        }
    });

    // Envia o orçamento ao cliente com o mesmo PDF exibido no Report Viewer.
    // É uma rota específica do pedido (com ownership), portanto não usa o endpoint
    // genérico de relatórios — aquele entrega cópias internas ao usuário logado.
    router.post('/pedidos/:id/enviar-orcamento-email', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        const { id } = req.params;
        try {
            aplicarParametrosDoPdf(req);
            const doc = await montarOrcamentoHtml(req, id);
            if (doc.erro) {
                return res.status(doc.erro.status).json({ success: false, message: doc.erro.mensagem });
            }

            const [[pedido]] = await vendasPool.query(
                `SELECT p.id, p.numero_pedido, p.cliente_nome, p.cliente, p.email_cliente, p.nfe_id,
                        COALESCE(c.razao_social, c.nome_fantasia, c.nome, p.cliente_nome, p.cliente) AS cliente_nome_resolvido,
                        c.email AS cliente_email
                   FROM pedidos p
                   LEFT JOIN clientes c ON c.id = p.cliente_id
                  WHERE p.id = ? LIMIT 1`,
                [id]
            );
            if (!pedido) return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });

            const listarEmails = valor => String(valor || '')
                .split(/[,;\s]+/)
                .map(email => email.trim().toLowerCase())
                .filter(email => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
            const destinatarios = [...new Set(listarEmails(
                req.body?.destinatario || pedido.email_cliente || pedido.cliente_email
            ))].slice(0, 5);
            const copias = [...new Set(listarEmails(req.body?.cc))]
                .filter(email => !destinatarios.includes(email))
                .slice(0, 5);
            // Cco + "Quero receber uma cópia deste e-mail". A cópia do remetente entra
            // como Cco de propósito: o cliente não precisa ver o endereço interno.
            const ocultas = [...new Set(listarEmails(req.body?.cco))]
                .filter(email => !destinatarios.includes(email) && !copias.includes(email))
                .slice(0, 5);
            const querCopia = req.body?.copia_para_mim === true || req.body?.copia_para_mim === 'true';
            const emailUsuario = listarEmails(req.user?.email)[0];
            if (querCopia && emailUsuario
                && !destinatarios.includes(emailUsuario)
                && !copias.includes(emailUsuario)
                && !ocultas.includes(emailUsuario)) {
                ocultas.push(emailUsuario);
            }
            if (!destinatarios.length) {
                return res.status(400).json({
                    success: false,
                    message: 'O cliente não possui e-mail válido. Cadastre ou informe o endereço antes de enviar.'
                });
            }

            const pdf = await htmlParaPdf(doc.html, {
                credenciais: {
                    cookie: req.headers.cookie,
                    authorization: req.headers.authorization
                }
            });
            const arquivo = nomeArquivoOrcamento(doc, id);
            const anexos = [{ filename: arquivo, content: pdf, contentType: 'application/pdf' }];
            const avisos = [];

            // O orçamento é sempre o primeiro anexo. Se o modal também oferecer DANFE/XML,
            // preserve esses anexos adicionais sem transformar a existência da NF-e em pré-
            // requisito para o envio do documento comercial.
            const querDanfe = req.body?.anexar_danfe === true || req.body?.anexar_danfe === 'true';
            const querXml = req.body?.anexar_xml === true || req.body?.anexar_xml === 'true';
            if (querDanfe || querXml) {
                const [[nfe]] = await vendasPool.query(
                    `SELECT id, numero, chave_acesso, xml_assinado, xml_nfe, xml_protocolo
                       FROM nfes
                      WHERE (id = ? OR pedido_id = ?) AND COALESCE(status, '') <> 'rejeitada'
                      ORDER BY id DESC LIMIT 1`,
                    [pedido.nfe_id || 0, id]
                ).catch(() => [[null]]);

                if (!nfe) {
                    avisos.push('A NF-e não foi encontrada; o PDF do orçamento foi enviado normalmente.');
                } else {
                    if (querXml) {
                        const assinada = (String(nfe.xml_assinado || '').match(/<NFe[\s>][\s\S]*<\/NFe>/) || [])[0];
                        const protocolo = (String(nfe.xml_protocolo || '').match(/<protNFe[\s\S]*?<\/protNFe>/) || [])[0];
                        const xml = (assinada && protocolo)
                            ? '<?xml version="1.0" encoding="UTF-8"?>'
                              + '<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">'
                              + assinada + protocolo + '</nfeProc>'
                            : (nfe.xml_assinado || nfe.xml_nfe);
                        if (xml) {
                            const chave = String(nfe.chave_acesso || '').replace(/\D/g, '');
                            anexos.push({
                                filename: (chave || `nfe_${nfe.numero || id}`) + '.xml',
                                content: Buffer.from(String(xml), 'utf8'),
                                contentType: 'application/xml'
                            });
                        } else {
                            avisos.push('O XML da NF-e ainda não está disponível.');
                        }
                    }

                    if (querDanfe) {
                        try {
                            const DANFEService = require('../src/nfe/services/DANFEService');
                            const danfe = await new DANFEService(pool).gerarDANFE(nfe.id);
                            anexos.push({
                                filename: `DANFE-${nfe.numero || id}.pdf`,
                                content: danfe,
                                contentType: 'application/pdf'
                            });
                        } catch (error) {
                            console.warn('[ORCAMENTO-EMAIL] DANFE não anexada:', error.message);
                            avisos.push('Não foi possível gerar a DANFE; o PDF do orçamento foi enviado normalmente.');
                        }
                    }
                }
            }
            // Anexo extra escolhido no compositor. É UM só (o limite que a tela anuncia)
            // e chega em base64 dentro do JSON, por isso o teto conservador: o parser do
            // app aceita 2 MB de corpo e base64 infla ~33%.
            const LIMITE_ANEXO_BYTES = 1258291; // 1,2 MB
            const extra = req.body?.anexo_extra;
            if (extra && extra.conteudo_base64) {
                const bruto = String(extra.conteudo_base64).replace(/^data:[^;]*;base64,/, '');
                const conteudo = Buffer.from(bruto, 'base64');
                if (!conteudo.length) {
                    return res.status(400).json({ success: false, message: 'O anexo enviado está vazio ou corrompido.' });
                }
                if (conteudo.length > LIMITE_ANEXO_BYTES) {
                    return res.status(413).json({
                        success: false,
                        message: 'O anexo excede 1,2 MB. Envie um arquivo menor.'
                    });
                }
                anexos.push({
                    // `path.basename` corta qualquer diretório vindo do cliente: o nome do
                    // anexo não pode carregar caminho.
                    filename: path.basename(String(extra.nome || 'anexo')).slice(0, 120),
                    content: conteudo,
                    contentType: String(extra.tipo || 'application/octet-stream').slice(0, 100)
                });
            }

            const clienteNome = pedido.cliente_nome_resolvido || 'Cliente';
            // DOIS formatos de corpo convivem de propósito:
            //  - `mensagem` (modal antigo de composição, fluxo da NF-e) mantém o layout
            //    que já saía, para não mudar e-mail que alguém já usa;
            //  - sem ela, vale o corpo do compositor novo (logo + "Prezado Cliente" +
            //    texto complementar), o MESMO que a prévia da tela mostra.
            const escEmail = value => String(value == null ? '' : value)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const mensagemLegada = req.body?.mensagem;
            let assunto;
            let mensagemTexto;
            let mensagemHtml;
            let logoInline = null;

            if (mensagemLegada) {
                assunto = String(req.body?.assunto || `Orçamento nº ${doc.numero || pedido.numero_pedido || id}`).trim();
                mensagemTexto = String(mensagemLegada);
                mensagemHtml = `
                <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#334155;line-height:1.6;">
                    <h2 style="margin:0 0 18px;color:#0f172a;">${escEmail(assunto)}</h2>
                    <div style="white-space:pre-wrap;">${escEmail(mensagemTexto)}</div>
                    <div style="margin-top:22px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
                        O orçamento está anexado em PDF: <strong>${escEmail(arquivo)}</strong>
                    </div>
                </div>`;
            } else {
                logoInline = await anexoLogoOrcamento();
                if (logoInline) anexos.push(logoInline);
                const corpo = montarCorpoEmailOrcamento({
                    documento: doc.documentoTitulo,
                    numeroExibicao: doc.numeroExibicao,
                    empresaNome: doc.empresaNome,
                    empresaFantasia: doc.empresaFantasia,
                    assunto: req.body?.assunto,
                    textoComplementar: req.body?.texto_complementar,
                    logoSrc: logoInline ? `cid:${LOGO_CID_ORCAMENTO}` : null
                });
                assunto = corpo.assunto;
                mensagemTexto = corpo.texto;
                mensagemHtml = corpo.html;
            }

            const { enviarEmail } = require('../utils/email');
            const { registrarEmailEnviado } = require('../services/nfe-notificacao.service');
            const envios = [];
            for (const destinatario of destinatarios) {
                const resultado = await enviarEmail({
                    rota: 'fiscal',
                    para: destinatario,
                    cc: copias.length ? copias.join(', ') : undefined,
                    bcc: ocultas.length ? ocultas.join(', ') : undefined,
                    assunto,
                    html: mensagemHtml,
                    texto: mensagemTexto,
                    anexos
                });
                envios.push({ destinatario, success: !!resultado.success, erro: resultado.error });
                await registrarEmailEnviado(pool, {
                    pedidoId: Number(id),
                    destinatario,
                    assunto,
                    corpo: mensagemHtml,
                    status: resultado.success ? 'enviado' : 'erro',
                    usuarioId: req.user?.id || null,
                    usuarioNome: req.user?.nome || req.user?.email || 'Usuário'
                }).catch(error => console.warn('[ORCAMENTO-EMAIL] Histórico não registrado:', error.message));
            }

            const enviados = envios.filter(envio => envio.success);
            if (!enviados.length) {
                return res.status(502).json({
                    success: false,
                    message: `Não foi possível enviar o orçamento: ${envios[0]?.erro || 'falha no serviço de e-mail'}`
                });
            }
            console.log(`[ORCAMENTO-EMAIL] Orçamento #${id} (${Math.round(pdf.length / 1024)} KB) enviado para ${enviados.map(e => e.destinatario).join(', ')}`);
            return res.json({
                success: true,
                message: `Orçamento enviado para ${enviados.map(e => e.destinatario).join(', ')}.`,
                destinatarios: enviados.map(e => e.destinatario),
                copias,
                ocultas,
                arquivo,
                anexos: anexos.map(anexo => anexo.filename),
                avisos,
                falhas: envios.filter(envio => !envio.success)
            });
        } catch (error) {
            console.error('[ORCAMENTO-EMAIL] Falha:', error);
            return res.status(error.status || 500).json({
                success: false,
                message: error.message || 'Erro ao enviar o orçamento por e-mail.'
            });
        }
    });

    router.get('/pedidos/:id', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { id } = req.params;
            const [pedidos] = await vendasPool.query(`
                SELECT p.*,
                       p.valor as valor_total,
                       p.descricao as observacoes,
                       p.created_at as data_criacao,
                       p.transportadora_id,
                       p.transportadora_nome,
                       COALESCE(c.nome, c.razao_social, c.nome_fantasia, e.nome_fantasia, e.razao_social) as cliente_nome_resolved,
                       c.razao_social as cliente_razao_social,
                       c.nome_fantasia as cliente_nome_fantasia,
                       COALESCE(c.cnpj, c.cnpj_cpf, e.cnpj) as cliente_cnpj,
                       COALESCE(c.inscricao_estadual, e.inscricao_estadual) as cliente_ie,
                       COALESCE(c.email, e.email) as cliente_email,
                       COALESCE(c.telefone, e.telefone) as cliente_telefone,
                       COALESCE(c.contato, e.contato) as cliente_contato,
                       COALESCE(c.endereco, e.endereco) as cliente_endereco,
                       COALESCE(c.bairro, e.bairro) as cliente_bairro,
                       COALESCE(c.cidade, e.cidade) as cliente_cidade,
                       COALESCE(c.estado, e.estado) as cliente_estado,
                       COALESCE(c.cep, e.cep) as cliente_cep,
                       e.nome_fantasia as empresa_nome, e.cnpj as empresa_cnpj,
                       u.nome as vendedor_nome,
                       t.razao_social as transp_razao_social,
                       t.cnpj_cpf as transp_cnpj,
                       t.telefone as transp_telefone,
                       t.email as transp_email,
                       t.cidade as transp_cidade,
                       t.estado as transp_estado,
                       t.bairro as transp_bairro
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                LEFT JOIN transportadoras t ON p.transportadora_id = t.id
                WHERE p.id = ?
            `, [id]);

            if (pedidos.length === 0) {
                return res.status(404).json({ error: 'Pedido não encontrado' });
            }

            // Formatar o pedido para compatibilidade com o frontend
            const pedido = pedidos[0];

            // Garantir que cliente_nome use o valor armazenado (p.cliente_nome) com fallback para JOIN
            if (!pedido.cliente_nome && pedido.cliente_nome_resolved) {
                pedido.cliente_nome = pedido.cliente_nome_resolved;
            }
            // Alias: frontend também usa pedido.cliente
            if (!pedido.cliente) {
                pedido.cliente = pedido.cliente_nome || pedido.cliente_nome_resolved || '';
            }

            // Buscar itens da tabela pedido_itens
            let itensDB = [];
            try {
                const [rows] = await vendasPool.query('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC', [id]);
                itensDB = rows;
            } catch (e) { console.log('[GET pedido] Erro ao buscar itens:', e.message); }

            // Auto-repair: se pedido_itens vazio mas produtos_preview tem dados, inserir automaticamente
            // AUDIT-FIX HIGH-007: Wrapped auto-repair in transaction to prevent partial inserts
            const previewItens = safeParseJSON(pedido.produtos_preview, []);
            if (itensDB.length === 0 && previewItens.length > 0) {
                console.log(`[VENDAS] Auto-repair: inserindo ${previewItens.length} itens do preview para pedido #${id}`);
                const repairConn = await vendasPool.getConnection();
                try {
                    await repairConn.beginTransaction();
                    for (const item of previewItens) {
                        const qty = parseFloat(item.quantidade) || 1;
                        const preco = parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0;
                        const desc = parseFloat(item.desconto) || 0;
                        const subtotal = (qty * preco) - desc;
                        await repairConn.query(
                            `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [id, item.codigo || '', item.descricao || item.nome || '', qty, parseFloat(item.quantidade_parcial) || 0,
                             item.unidade || 'UN', item.local_estoque || 'PADRAO - Local de Estoque Padrão', preco, desc, subtotal]
                        );
                    }
                    await repairConn.commit();
                    // Recarregar itens após auto-repair
                    const [rows2] = await vendasPool.query('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC', [id]);
                    itensDB = rows2;
                } catch (e) {
                    await repairConn.rollback();
                    console.log('[VENDAS] Erro no auto-repair (rollback):', e.message);
                } finally {
                    repairConn.release();
                }
            }

            const pedidoFormatado = {
                ...pedido,
                numero: `Pedido Nº ${pedido.id}`,
                cliente: pedido.cliente_nome || '',
                vendedor: pedido.vendedor_nome || '',
                valor: parseFloat(pedido.valor) || 0,
                data: pedido.created_at ? new Date(pedido.created_at).toISOString().slice(0, 10) : '',
                frete: parseFloat(pedido.frete) || 0,
                origem: 'Sistema',
                tipo: pedido.prioridade || 'normal',
                produtos: itensDB.length > 0 ? itensDB : previewItens,
                itens: itensDB
            };

            res.json(pedidoFormatado);
        } catch (error) {
            console.error('Erro ao buscar pedido:', error);
            res.status(500).json({ error: 'Erro ao buscar pedido' });
        }
    });

    router.post('/pedidos', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        const connection = await vendasPool.getConnection();
        try {
            await connection.beginTransaction();
            const {
                cliente_id, empresa_id, produtos, valor, descricao,
                status = 'orcamento', frete = 0, prioridade = 'normal',
                prazo_entrega, endereco_entrega, municipio_entrega, metodo_envio,
                parcelas, condicao_pagamento
            } = req.body;
            const vendedor_id = req.user.id;
            const condicaoCodigo = normalizarCodigoCondicaoPagamento(condicao_pagamento || req.body.condicoes_pagamento || parcelas) || 'a_vista';

            // empresa_id padrão = 1 (ALUFORCE) se não fornecido
            const empresaIdFinal = empresa_id || 1;

            // Buscar nomes do cliente e vendedor
            let clienteNome = null;
            let vendedorNome = null;
            try {
                if (cliente_id) {
                    const [cRows] = await connection.query('SELECT COALESCE(nome_fantasia, razao_social, nome) as nome FROM clientes WHERE id = ?', [cliente_id]);
                    if (cRows.length > 0) clienteNome = cRows[0].nome;
                }
                const [vRows] = await connection.query('SELECT nome FROM usuarios WHERE id = ?', [vendedor_id]);
                if (vRows.length > 0) vendedorNome = vRows[0].nome;
            } catch (e) { /* nomes opcionais */ }

            const [result] = await connection.query(`
                INSERT INTO pedidos
                (cliente_id, empresa_id, vendedor_id, valor, descricao, status,
                 numero_pedido, frete, prioridade, produtos_preview, prazo_entrega, endereco_entrega,
                 municipio_entrega, metodo_envio, parcelas, condicao_pagamento, condicoes_pagamento,
                 cliente_nome, vendedor_nome, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                cliente_id, empresaIdFinal, vendedor_id, valor || 0, descricao || '',
                status, null, frete, prioridade, JSON.stringify(produtos || []),
                prazo_entrega, endereco_entrega, municipio_entrega, metodo_envio,
                condicaoCodigo, condicaoCodigo, formatarDescricaoCondicaoPagamento(condicaoCodigo),
                clienteNome, vendedorNome
            ]);

            const pedidoId = result.insertId;
            await connection.query('UPDATE pedidos SET numero_pedido = ? WHERE id = ?', [pedidoId, pedidoId]);

            // Inserir itens na tabela pedido_itens (dentro da mesma transação)
            const itensArray = produtos || [];
            if (itensArray.length > 0) {
                for (const item of itensArray) {
                    const qty = parseFloat(item.quantidade) || 1;
                    const preco = parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0;
                    const desc = parseFloat(item.desconto) || 0;
                    const subtotal = (qty * preco) - desc;
                    await connection.query(
                        `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [pedidoId, item.codigo || '', item.descricao || item.nome || '', qty, parseFloat(item.quantidade_parcial) || 0,
                         item.unidade || 'UN', item.local_estoque || 'PADRAO - Local de Estoque Padrão', preco, desc, subtotal]
                    );
                }
            }

            if (itensArray.length > 0 && typeof recalcularImpostosPedidoVenda === 'function') {
                await recalcularImpostosPedidoVenda(pedidoId, connection, req.body.cenario_fiscal || null);
            }

            await connection.commit();
            res.json({ success: true, id: pedidoId, message: 'Pedido criado com sucesso' });
        } catch (error) {
            await connection.rollback();
            console.error('Erro ao criar pedido:', error);
            res.status(500).json({ error: 'Erro ao criar pedido' });
        } finally {
            connection.release();
        }
    });

    // Alias para /api/vendas/pedidos/novo -> cria novo pedido com itens (TODOS OS CAMPOS)
    router.post('/pedidos/novo', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const sanitize = (val) => (val === 'null' || val === 'undefined' || val === '' ? null : val);
            const sanitizeNum = (val) => {
                if (val === 'null' || val === 'undefined' || val === '' || val === null || val === undefined) return null;
                const num = parseFloat(val);
                return isNaN(num) ? null : num;
            };

            const {
                cliente_id, empresa_id, produtos, valor, descricao, cliente,
                status = 'orcamento', frete = 0, prioridade = 'normal',
                prazo_entrega, endereco_entrega, municipio_entrega, metodo_envio,
                parcelas, condicao_pagamento, cenario_fiscal, observacao, itens,
                // Campos de transporte e entrega
                transportadora, tipo_frete, placa_veiculo, veiculo_uf, rntrc,
                qtd_volumes, especie_volumes, marca_volumes, numeracao_volumes,
                peso_liquido, peso_bruto, valor_seguro, outras_despesas, tipo_entrega,
                // Campos adicionais
                desconto_pct, vendedor_nome: vendedorNomeBody, origem, observacao_cliente, observacao_producao,
                nf
            } = req.body;

            // O modal envia algumas chaves com nomes alternativos — aceitar todas as variações
            const condicaoPagamentoFinal = normalizarCodigoCondicaoPagamento(sanitize(condicao_pagamento) || sanitize(req.body.condicoes_pagamento) || sanitize(parcelas)) || 'a_vista';
            const observacaoFinal = sanitize(observacao) || sanitize(req.body['observação']) || sanitize(req.body.observacoes);
            const transportadoraFinal = sanitize(transportadora) || sanitize(req.body.transportadora_nome);

            // Vendedor: admin pode atribuir o pedido a OUTRO vendedor; não-admin é sempre
            // o próprio usuário logado (regra reforçada no servidor — não confia no front).
            const isAdminReq = req.user && (req.user.is_admin === 1 || req.user.is_admin === true ||
                ['admin', 'administrador', 'ti', 'diretoria', 'super_admin'].includes((req.user.role || '').toLowerCase()));
            let vendedor_id = req.user.id;
            if (isAdminReq) {
                const vid = sanitizeNum(req.body.vendedor_id);
                if (vid) {
                    vendedor_id = parseInt(vid);
                } else if (sanitize(vendedorNomeBody)) {
                    try {
                        const [vByName] = await connection.query('SELECT id FROM usuarios WHERE nome = ? LIMIT 1', [vendedorNomeBody]);
                        if (vByName.length > 0) vendedor_id = vByName[0].id;
                    } catch (_) { /* mantém req.user.id */ }
                }
            }

            // Usar itens se disponível, senão produtos
            const produtosData = itens || produtos || [];

            // empresa_id padrão = 1 (ALUFORCE) se não fornecido
            const empresaIdFinal = empresa_id || 1;

            // Buscar nomes do cliente e vendedor
            let clienteNome = sanitize(cliente) || null;
            let vendedorNome = sanitize(vendedorNomeBody) || null;
            try {
                if (cliente_id) {
                    const [cRows] = await connection.query('SELECT COALESCE(nome_fantasia, razao_social, nome) as nome FROM clientes WHERE id = ?', [cliente_id]);
                    if (cRows.length > 0) clienteNome = cRows[0].nome;
                }
                const [vRows] = await connection.query('SELECT nome FROM usuarios WHERE id = ?', [vendedor_id]);
                if (vRows.length > 0) vendedorNome = vRows[0].nome;
            } catch (e) { /* nomes opcionais */ }

            const [result] = await connection.query(`
                INSERT INTO pedidos
                (cliente_id, empresa_id, vendedor_id, valor, descricao, status,
                 frete, prioridade, produtos_preview, prazo_entrega, endereco_entrega,
                 municipio_entrega, metodo_envio, parcelas, condicao_pagamento,
                 condicoes_pagamento, cenario_fiscal, observacao, cliente_nome, vendedor_nome,
                 transportadora_nome, transportadora, tipo_frete, placa_veiculo, veiculo_uf, rntrc,
                 qtd_volumes, especie_volumes, marca_volumes, numeracao_volumes,
                 peso_liquido, peso_bruto, valor_seguro, outras_despesas,
                 desconto_pct, origem, observacao_cliente, observacao_producao, nf, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                cliente_id || null, empresaIdFinal, vendedor_id, valor || 0, descricao || 'Novo Orçamento',
                status, sanitizeNum(frete) || 0, prioridade, JSON.stringify(produtosData),
                sanitize(prazo_entrega), sanitize(endereco_entrega), sanitize(municipio_entrega), sanitize(metodo_envio),
                parcelas ? (typeof parcelas === 'string' ? parcelas : JSON.stringify(parcelas)) : null,
                condicaoPagamentoFinal, formatarDescricaoCondicaoPagamento(condicaoPagamentoFinal), sanitize(cenario_fiscal), observacaoFinal,
                clienteNome, vendedorNome,
                transportadoraFinal, transportadoraFinal, sanitize(tipo_frete),
                sanitize(placa_veiculo), sanitize(veiculo_uf), sanitize(rntrc),
                sanitizeNum(qtd_volumes), sanitize(especie_volumes), sanitize(marca_volumes), sanitize(numeracao_volumes),
                sanitizeNum(peso_liquido), sanitizeNum(peso_bruto), sanitizeNum(valor_seguro), sanitizeNum(outras_despesas),
                sanitizeNum(desconto_pct) || 0, sanitize(origem), sanitize(observacao_cliente), sanitize(observacao_producao), sanitize(nf)
            ]);

            const pedidoId = result.insertId;
            await connection.query('UPDATE pedidos SET numero_pedido = ? WHERE id = ?', [pedidoId, pedidoId]);

            // Inserir itens na tabela pedido_itens (dentro da mesma transação)
            if (produtosData.length > 0) {
                // Piso do preço — mesmo motivo do POST /pedidos: o preço chega pelo
                // corpo, sem passar pelo POST /itens.
                if (typeof global.__validarPisoPrecoItem === 'function') {
                    for (const item of produtosData) {
                        const _erroPiso = await global.__validarPisoPrecoItem({
                            produtoId: item.produto_id,
                            codigo: item.codigo || '',
                            preco: parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0,
                            quantidade: parseFloat(item.quantidade) || 1,
                            desconto: parseFloat(item.desconto) || 0,
                            token: item.autorizacao_desconto_token || item.autorizacao_preco_token
                                || req.body?.autorizacao_desconto_token || req.body?.autorizacao_preco_token,
                            // O token do piso é reutilizável dentro do mesmo pedido; o id é o que
                            // impede a autorização de escorregar para outro documento.
                            pedidoId
                        });
                        if (_erroPiso) {
                            await connection.rollback();
                            connection.release();
                            return res.status(_erroPiso.status).json({ success: false, message: _erroPiso.message, code: _erroPiso.code });
                        }
                    }
                }
                for (const item of produtosData) {
                    const qty = parseFloat(item.quantidade) || 1;
                    const preco = parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0;
                    const desc = parseFloat(item.desconto) || 0;
                    const subtotal = (qty * preco) - desc;
                    await connection.query(
                        `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [pedidoId, item.codigo || '', item.descricao || item.nome || '', qty, parseFloat(item.quantidade_parcial) || 0,
                         item.unidade || 'UN', item.local_estoque || 'PADRAO - Local de Estoque Padrão', preco, desc, subtotal]
                    );
                }
            }

            // O alias também precisa fechar o pedido com os mesmos impostos do
            // fluxo principal. O executor é a conexão da transação para que
            // itens e cabeçalho fiscal sejam confirmados juntos.
            if (produtosData.length > 0 && typeof recalcularImpostosPedidoVenda === 'function') {
                await recalcularImpostosPedidoVenda(pedidoId, connection, cenario_fiscal || null);
            }

            await connection.commit();

            // ── Persistência best-effort dos campos das abas Informações Adicionais / E-mail / NF-e.
            //    Executado APÓS o commit e filtrando por colunas existentes (information_schema),
            //    para NUNCA quebrar a criação do pedido caso alguma coluna não exista na instância.
            try {
                const toFlag = (v) => (v === 1 || v === '1' || v === true || v === 'true') ? 1 : 0;
                const richCandidates = {
                    transportadora_id: sanitizeNum(req.body.transportadora_id),
                    redespacho: toFlag(req.body.redespacho),
                    info_complementar: sanitize(req.body.info_complementar),
                    categoria: sanitize(req.body.categoria),
                    conta_corrente: sanitize(req.body.conta_corrente),
                    etapa: sanitize(req.body.etapa),
                    pedido_cliente: sanitize(req.body.pedido_cliente),
                    contrato_venda: sanitize(req.body.contrato_venda),
                    contato: sanitize(req.body.contato),
                    projeto: sanitize(req.body.projeto),
                    origem_pedido: sanitize(req.body.origem_pedido),
                    email_boleto: toFlag(req.body.email_boleto),
                    email_pix: toFlag(req.body.email_pix),
                    nota_fiscal_consumo_final: toFlag(req.body.nota_fiscal_consumo_final),
                    dados_adicionais_nf: sanitize(req.body.dados_adicionais_nf),
                    campos_obs_nfe: sanitize(req.body.campos_obs_nfe),
                    endereco_entrega_nfe: sanitize(req.body.endereco_entrega_nfe),
                    previsao_faturamento: sanitize(req.body.previsao_faturamento)
                };
                const provided = Object.keys(richCandidates).filter(k => richCandidates[k] !== null && richCandidates[k] !== undefined);
                if (provided.length > 0) {
                    const [colRows] = await pool.query(
                        "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'pedidos'"
                    );
                    const existing = new Set(colRows.map(r => r.COLUMN_NAME || r.column_name));
                    const setCols = provided.filter(k => existing.has(k));
                    if (setCols.length > 0) {
                        const setClause = setCols.map(c => `\`${c}\` = ?`).join(', ');
                        const setVals = setCols.map(c => richCandidates[c]);
                        setVals.push(pedidoId);
                        await pool.query(`UPDATE pedidos SET ${setClause} WHERE id = ?`, setVals);
                    }
                }
            } catch (richErr) {
                console.warn('Aviso: campos adicionais do pedido', pedidoId, 'não persistidos:', richErr.message);
            }

            res.json({ success: true, id: pedidoId, message: 'Pedido criado com sucesso' });
        } catch (error) {
            await connection.rollback();
            console.error('Erro ao criar pedido /novo:', error);
            res.status(500).json({ error: 'Erro ao criar pedido', details: error.message });
        } finally {
            connection.release();
        }
    });

    router.put('/pedidos/:id', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { id } = req.params;

            // Lock comercial: vendedor só fica bloqueado durante Análise de Crédito.
            const STATUS_BLOQUEADO = ['analise', 'análise', 'analise-credito', 'análise-crédito'];
            const [[pedidoLock]] = await vendasPool.query('SELECT status FROM pedidos WHERE id = ?', [parseInt(id)]);
            if (pedidoLock && STATUS_BLOQUEADO.includes((pedidoLock.status || '').toLowerCase())) {
                // Mesma regra do vendas-routes.js: compara a PARTE LOCAL do e-mail, senão as
                // contas das instâncias Labor (ti@energy.com.br, ti@labor.com.br) ficam de fora.
                const conta = String((req.user && req.user.email) || '').toLowerCase().trim().split('@')[0];
                if (!['ti', 'logistica'].includes(conta)) {
                    return res.status(403).json({ error: `Pedido em Análise de Crédito não pode ser editado por vendedor.` });
                }
            }

            const {
                cliente_id, empresa_id, produtos, valor, descricao, status,
                frete, prioridade, prazo_entrega, endereco_entrega,
                municipio_entrega, metodo_envio, observacao, observacao_producao,
                condicao_pagamento, condicoes_pagamento, parcelas,
                transportadora_nome, transportadora, tipo_frete,
                placa_veiculo, veiculo_uf, rntrc, qtd_volumes, especie_volumes,
                marca_volumes, numeracao_volumes, peso_liquido, peso_bruto,
                valor_seguro, outras_despesas, tipo_entrega, numero_lacre,
                codigo_rastreio, veiculo_proprio, data_previsao_entrega
            } = req.body;

            // Construir query dinâmica apenas com campos fornecidos
            const updates = [];
            const params = [];

            if (cliente_id !== undefined) { updates.push('cliente_id = ?'); params.push(cliente_id); }
            if (empresa_id !== undefined) { updates.push('empresa_id = ?'); params.push(empresa_id); }
            if (valor !== undefined) { updates.push('valor = ?'); params.push(valor); }
            if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }
            if (observacao !== undefined) { updates.push('observacao = ?'); params.push(observacao); }
            if (observacao_producao !== undefined) { updates.push('observacao_producao = ?'); params.push(observacao_producao); }
            if (status !== undefined) { updates.push('status = ?'); params.push(status); }
            if (frete !== undefined) { updates.push('frete = ?'); params.push(frete); }
            if (prioridade !== undefined) { updates.push('prioridade = ?'); params.push(prioridade); }
            if (prazo_entrega !== undefined) { updates.push('prazo_entrega = ?'); params.push(prazo_entrega); }
            if (endereco_entrega !== undefined) { updates.push('endereco_entrega = ?'); params.push(endereco_entrega); }
            if (municipio_entrega !== undefined) { updates.push('municipio_entrega = ?'); params.push(municipio_entrega); }
            if (metodo_envio !== undefined) { updates.push('metodo_envio = ?'); params.push(metodo_envio); }
            if (produtos !== undefined) { updates.push('produtos_preview = ?'); params.push(JSON.stringify(produtos)); }
            if (condicao_pagamento !== undefined || condicoes_pagamento !== undefined || parcelas !== undefined) {
                const condicao = condicao_pagamento || condicoes_pagamento || parcelas || null;
                updates.push('condicao_pagamento = ?'); params.push(condicao);
                updates.push('condicoes_pagamento = ?'); params.push(condicao);
                updates.push('parcelas = ?'); params.push(condicao);
            }
            if (transportadora_nome !== undefined || transportadora !== undefined) { updates.push('transportadora_nome = ?'); params.push(transportadora_nome || transportadora || null); }
            if (tipo_frete !== undefined) { updates.push('tipo_frete = ?'); params.push(tipo_frete); }
            if (placa_veiculo !== undefined) { updates.push('placa_veiculo = ?'); params.push(placa_veiculo); }
            if (veiculo_uf !== undefined) { updates.push('veiculo_uf = ?'); params.push(veiculo_uf); }
            if (rntrc !== undefined) { updates.push('rntrc = ?'); params.push(rntrc); }
            if (qtd_volumes !== undefined) { updates.push('qtd_volumes = ?'); params.push(qtd_volumes); }
            if (especie_volumes !== undefined) { updates.push('especie_volumes = ?'); params.push(especie_volumes); }
            if (marca_volumes !== undefined) { updates.push('marca_volumes = ?'); params.push(marca_volumes); }
            if (numeracao_volumes !== undefined) { updates.push('numeracao_volumes = ?'); params.push(numeracao_volumes); }
            if (peso_liquido !== undefined) { updates.push('peso_liquido = ?'); params.push(peso_liquido); }
            if (peso_bruto !== undefined) { updates.push('peso_bruto = ?'); params.push(peso_bruto); }
            if (valor_seguro !== undefined) { updates.push('valor_seguro = ?'); params.push(valor_seguro); }
            if (outras_despesas !== undefined) { updates.push('outras_despesas = ?'); params.push(outras_despesas); }
            if (tipo_entrega !== undefined) { updates.push('tipo_entrega = ?'); params.push(tipo_entrega); }
            if (numero_lacre !== undefined) { updates.push('numero_lacre = ?'); params.push(numero_lacre); }
            if (codigo_rastreio !== undefined) { updates.push('codigo_rastreio = ?'); params.push(codigo_rastreio); }
            if (veiculo_proprio !== undefined) { updates.push('veiculo_proprio = ?'); params.push(veiculo_proprio === '1' || veiculo_proprio === 1 || veiculo_proprio === true ? 1 : 0); }
            if (data_previsao_entrega !== undefined) { updates.push('data_previsao = ?'); params.push(data_previsao_entrega); }

            if (updates.length === 0) {
                return res.status(400).json({ error: 'Nenhum campo para atualizar' });
            }

            params.push(id);
            await vendasPool.query(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = ?`, params);

            res.json({ success: true, message: 'Pedido atualizado com sucesso' });
        } catch (error) {
            console.error('Erro ao atualizar pedido:', error);
            res.status(500).json({ error: 'Erro ao atualizar pedido' });
        }
    });

    // ROTA DUPLICADA REMOVIDA - /api/vendas/pedidos/:id/status já existe no apiVendasRouter

    // AUDIT-FIX: REMOVED dangerous duplicate DELETE route that did NOT clean up child tables
    // (pedido_itens, pedido_anexos, pedido_historico) and had no transaction.
    // The correct DELETE handler is in apiVendasRouter at /pedidos/:id which uses proper
    // transaction, cascading deletes, and linked order/financial validation.
    // router.delete('/pedidos/:id', ...) — REMOVED

    // === CLIENTES ===
    router.get('/clientes', authorizeArea('vendas'), async (req, res) => {
        try {
            const { search } = req.query;
            const limitParam = Math.min(Math.max(1, parseInt(req.query.limit) || 500), 2000);
            // As três instâncias possuem versões históricas diferentes da tabela clientes.
            // Montar o SELECT conforme as colunas reais evita que uma coluna opcional derrube
            // toda a central de clientes (ex.: data_criacao x data_cadastro x created_at).
            const [columnRows] = await pool.query('SHOW COLUMNS FROM clientes');
            const columns = new Set(columnRows.map(column => column.Field));
            const requestedFields = [
                'id', 'nome', 'razao_social', 'nome_fantasia', 'cnpj', 'cnpj_cpf',
                'cpf', 'inscricao_estadual', 'contato', 'email', 'telefone', 'cidade', 'estado', 'uf',
                'vendedor_responsavel', 'ativo'
            ];
            const selectFields = requestedFields.map(field =>
                columns.has(field) ? `\`${field}\`` : `NULL AS \`${field}\``
            );
            const dateColumn = ['data_criacao', 'data_cadastro', 'created_at'].find(field => columns.has(field));
            selectFields.push(dateColumn ? `\`${dateColumn}\` AS data_criacao` : 'NULL AS data_criacao');
            let query = `SELECT ${selectFields.join(', ')} FROM clientes`;
            const params = [];

            if (search) {
                const searchable = ['nome', 'razao_social', 'email', 'telefone', 'cnpj_cpf', 'cnpj', 'cpf']
                    .filter(field => columns.has(field));
                const searchTerm = `%${search}%`;
                if (searchable.length) {
                    query += ` WHERE ${searchable.map(field => `\`${field}\` LIKE ?`).join(' OR ')}`;
                    params.push(...searchable.map(() => searchTerm));
                }
            }

            query += ` ORDER BY ${columns.has('nome') ? '`nome`' : '`id`'} LIMIT ?`;
            params.push(limitParam);

            const [clientes] = await pool.query(query, params);
            res.json(clientes);
        } catch (error) {
            console.error('Erro ao listar clientes:', error);
            res.status(500).json({ error: 'Erro ao listar clientes' });
        }
    });

    router.get('/clientes/:id', authorizeArea('vendas'), async (req, res) => {
        try {
            const { id } = req.params;
            if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'ID inválido' });
            const [clientes] = await pool.query('SELECT * FROM clientes WHERE id = ? LIMIT 1', [id]);

            if (clientes.length === 0) {
                return res.status(404).json({ error: 'Cliente não encontrado' });
            }

            res.json(clientes[0]);
        } catch (error) {
            console.error('Erro ao buscar cliente:', error);
            res.status(500).json({ error: 'Erro ao buscar cliente' });
        }
    });

    router.post('/clientes', authorizeArea('vendas'), async (req, res) => {
        try {
            const { nome, email, telefone, cpf, endereco } = req.body;
            const empresaId = Number(req.user?.empresa_id) || 1;
            const colunasCliente = await obterColunasCliente(vendasPool);
            const conflito = await localizarConflitoCliente({
                pool: vendasPool,
                colunasCliente,
                empresaId,
                dados: { nome, cpf, email, telefone },
                usuario: req.user
            });
            if (conflito && !conflito.podeAssumir) {
                if (conflito.mesmoProprietario) {
                    return res.status(200).json({
                        success: true,
                        id: conflito.cliente.id,
                        existente: true,
                        compartilhado: true,
                        message: 'Cliente já cadastrado na carteira compartilhada desta vendedora.'
                    });
                }
                return res.status(409).json({
                    success: false,
                    code: 'CLIENTE_RESERVADO',
                    message: `Cadastro bloqueado: este cliente já está sob responsabilidade de ${conflito.proprietarioNome}.`,
                    motivo: 'cliente_reservado_a_outro_vendedor',
                    clienteId: conflito.cliente.id,
                    vendedorResponsavel: conflito.proprietarioNome,
                    correspondencia: conflito.correspondencia
                });
            }
            if (conflito && conflito.podeAssumir) {
                const transferencia = montarTransferenciaCliente({
                    colunasCliente,
                    usuario: req.user,
                    motivo: conflito.motivo,
                    empresaId
                });
                if (transferencia.campos.length) {
                    await vendasPool.query(
                        `UPDATE clientes SET ${transferencia.campos.join(', ')} WHERE id = ?`,
                        [...transferencia.valores, conflito.cliente.id]
                    );
                }
                await registrarClienteGlobal({
                    dados: { nome, cpf, email, telefone },
                    usuario: req.user,
                    clienteId: conflito.cliente.id,
                    instancia: req.brand,
                    ativo: 1,
                    forcar: true
                });
                return res.status(200).json({
                    success: true,
                    id: conflito.cliente.id,
                    existente: true,
                    transferido: true,
                    motivo: conflito.motivo,
                    message: `Cliente liberado e vinculado a ${transferencia.nome}.`
                });
            }

            const novoCliente = {
                nome,
                email,
                telefone,
                cpf,
                endereco,
                data_criacao: new Date(),
                ativo: 1,
                empresa_id: empresaId,
                vendedor_id: req.user?.id || null,
                usuario_id: req.user?.id || null,
                vendedor_responsavel: req.user?.nome || null,
                vendedor_proprietario: req.user?.nome || null,
                incluido_por: req.user?.nome || null
            };
            const insertColumns = Object.keys(novoCliente).filter(campo => colunasCliente.has(campo));
            const [result] = await vendasPool.query(
                `INSERT INTO clientes (${insertColumns.map(campo => `\`${campo}\``).join(', ')}) VALUES (${insertColumns.map(() => '?').join(', ')})`,
                insertColumns.map(campo => novoCliente[campo])
            );
            await registrarClienteGlobal({
                dados: { nome, cpf, email, telefone },
                usuario: req.user,
                clienteId: result.insertId,
                instancia: req.brand,
                ativo: 1,
                forcar: true
            });

            res.json({ success: true, id: result.insertId, message: 'Cliente criado com sucesso' });
        } catch (error) {
            console.error('Erro ao criar cliente:', error);
            res.status(500).json({ error: 'Erro ao criar cliente' });
        }
    });

    // === EMPRESAS ===
    router.get('/empresas', authorizeArea('vendas'), async (req, res) => {
        try {
            const { search } = req.query;
            let query = 'SELECT * FROM empresas';
            const params = [];

            if (search) {
                query += ' WHERE nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ?';
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm);
            }

            query += ' ORDER BY nome_fantasia LIMIT 100';

            const [empresas] = await vendasPool.query(query, params);
            res.json(empresas);
        } catch (error) {
            console.error('Erro ao listar empresas:', error);
            res.status(500).json({ error: 'Erro ao listar empresas' });
        }
    });

    router.get('/empresas/:id', authorizeArea('vendas'), async (req, res) => {
        try {
            const { id } = req.params;
            const [empresas] = await vendasPool.query('SELECT * FROM empresas WHERE id = ?', [id]);

            if (empresas.length === 0) {
                return res.status(404).json({ error: 'Empresa não encontrada' });
            }

            res.json(empresas[0]);
        } catch (error) {
            console.error('Erro ao buscar empresa:', error);
            res.status(500).json({ error: 'Erro ao buscar empresa' });
        }
    });

    router.post('/empresas', authorizeArea('vendas'), async (req, res) => {
        try {
            const { nome_fantasia, razao_social, cnpj, email, telefone, endereco } = req.body;
            const vendedor_id = req.user?.id || null;

            const [result] = await vendasPool.query(`
                INSERT INTO empresas (nome_fantasia, razao_social, cnpj, email, telefone, endereco, data_criacao, vendedor_id, ultima_movimentacao, status_cliente)
                VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), 'ativo')
            `, [nome_fantasia, razao_social, cnpj, email, telefone, endereco, vendedor_id]);

            res.json({ success: true, id: result.insertId, message: 'Empresa criada com sucesso' });
        } catch (error) {
            console.error('Erro ao criar empresa:', error);
            res.status(500).json({ error: 'Erro ao criar empresa' });
        }
    });

    // === API para reativar cliente inativo (permite outro vendedor "conquistar") ===
    router.post('/empresas/:id/reativar', authorizeArea('vendas'), async (req, res) => {
        try {
            const { id } = req.params;
            const vendedor_id = req.user?.id;

            // Verificar se empresa está inativa
            const [empresa] = await vendasPool.query('SELECT status_cliente, vendedor_id FROM empresas WHERE id = ?', [id]);

            if (!empresa || empresa.length === 0) {
                return res.status(404).json({ error: 'Empresa não encontrada' });
            }

            // Se está ativa e pertence a outro vendedor, não pode reativar
            if (empresa[0].status_cliente === 'ativo' && empresa[0].vendedor_id && empresa[0].vendedor_id !== vendedor_id) {
                return res.status(403).json({ error: 'Esta empresa pertence a outro vendedor' });
            }

            // Reativar empresa e atribuir ao novo vendedor
            await vendasPool.query(`
                UPDATE empresas
                SET status_cliente = 'ativo',
                    vendedor_id = ?,
                    ultima_movimentacao = NOW(),
                    data_inativacao = NULL
                WHERE id = ?
            `, [vendedor_id, id]);

            res.json({ success: true, message: 'Cliente reativado com sucesso' });
        } catch (error) {
            console.error('Erro ao reativar empresa:', error);
            res.status(500).json({ error: 'Erro ao reativar empresa' });
        }
    });

    // === NOTIFICAÇÕES ===
    router.get('/notificacoes', authorizeArea('vendas'), async (req, res) => {
        try {
            const userId = req.user.id;

            // Verificar estrutura da tabela e usar coluna correta de data
            let orderColumn = 'criado_em';
            try {
                const [cols] = await pool.query(`SHOW COLUMNS FROM notificacoes LIKE 'created_at'`);
                if (cols.length > 0) orderColumn = 'created_at';
            } catch(e) { /* usa criado_em como fallback */ }

            const [notificacoes] = await pool.query(`
                SELECT * FROM notificacoes
                WHERE usuario_id = ? OR usuario_id IS NULL
                ORDER BY ${orderColumn} DESC
                LIMIT 20
            `, [userId]);

            res.json(notificacoes);
        } catch (error) {
            console.error('Erro ao listar notificações:', error);
            // Se a tabela não existir ou outro erro, retornar array vazio
            res.json([]);
        }
    });

    // === DASHBOARD GRÁFICOS ===
    router.get('/dashboard/graficos', authorizeArea('vendas'), cacheMiddleware('vendas_graficos', CACHE_CONFIG.dashboardVendas), async (req, res) => {
        try {
            const { periodo } = req.query;
            const periodoAtual = periodo || new Date().toISOString().substring(0, 7);

            // Vendas por status
            const [vendasPorStatus] = await pool.query(`
                SELECT status, COUNT(*) as quantidade, COALESCE(SUM(valor), 0) as valor
                FROM pedidos
                WHERE DATE_FORMAT(created_at, '%Y-%m') = ?
                GROUP BY status
            `, [periodoAtual]);

            // Vendas por vendedor
            const [vendasPorVendedor] = await pool.query(`
                SELECT u.nome as vendedor, COUNT(*) as quantidade, COALESCE(SUM(p.valor), 0) as valor
                FROM pedidos p
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE DATE_FORMAT(p.created_at, '%Y-%m') = ?
                GROUP BY p.vendedor_id, u.nome
                ORDER BY valor DESC
                LIMIT 10
            `, [periodoAtual]);

            // Evolução mensal (últimos 6 meses)
            const [evolucaoMensal] = await pool.query(`
                SELECT
                    DATE_FORMAT(created_at, '%Y-%m') as mes,
                    COUNT(*) as quantidade,
                    COALESCE(SUM(valor), 0) as valor
                FROM pedidos
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
                GROUP BY DATE_FORMAT(created_at, '%Y-%m')
                ORDER BY mes
            `);

            res.json({
                vendasPorStatus,
                vendasPorVendedor,
                evolucaoMensal,
                periodo: periodoAtual
            });
        } catch (error) {
            console.error('Erro ao carregar gráficos:', error);
            res.status(500).json({ error: 'Erro ao carregar gráficos' });
        }
    });

    console.log('✅ Rotas do módulo Vendas carregadas com sucesso');

    // ======================================
    // ROTAS ADICIONAIS — Migradas do legacy server.js
    // ======================================

    // ========================================
    // PROXY CEP (evita CORS no client)
    // ========================================
    router.get('/proxy/cep/:cep', async (req, res) => {
        try {
            const { cep } = req.params;
            const cleanCep = cep.replace(/\D/g, '');
            if (cleanCep.length !== 8) return res.status(400).json({ error: 'CEP inválido' });

            const https = require('https');
            const data = await new Promise((resolve, reject) => {
                https.get(`https://brasilapi.com.br/api/cep/v2/${cleanCep}`, (resp) => {
                    let body = '';
                    resp.on('data', chunk => body += chunk);
                    resp.on('end', () => {
                        try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
                    });
                }).on('error', reject);
            });
            res.json(data);
        } catch (err) {
            console.error('Erro proxy CEP:', err.message);
            res.status(500).json({ error: 'Erro ao consultar CEP' });
        }
    });

    // ========================================
    // DASHBOARD MONTHLY (evolução mensal)
    // ========================================
    router.get('/dashboard/monthly', authorizeArea('vendas'), async (req, res, next) => {
        try {
            let startStr, endStr, months;

            if (req.query.data_inicio && req.query.data_fim) {
                // Use explicit date range from filter
                startStr = req.query.data_inicio;
                endStr = req.query.data_fim;
                const startDate = new Date(startStr);
                const endDate = new Date(endStr);
                const diffMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth()) + 1;
                months = Math.max(1, diffMonths);
            } else {
                months = Math.max(parseInt(req.query.months || '12'), 1);
                const now = new Date();
                const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
                startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
                endStr = null;
            }

            const queryParams = endStr ? [startStr, endStr] : [startStr];
            const whereClause = endStr
                ? `WHERE created_at >= ? AND created_at <= ?`
                : `WHERE created_at >= ?`;

            const [rows] = await vendasPool.query(
                `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
                 COALESCE(SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS total
                 FROM pedidos
                 ${whereClause}
                 GROUP BY ym
                 ORDER BY ym ASC`,
                queryParams
            );

            const map = new Map();
            for (const r of rows) map.set(r.ym, Number(r.total || 0));

            const labels = [];
            const values = [];
            const iterStart = new Date(startStr);
            for (let i = 0; i < months; i++) {
                const d = new Date(iterStart.getFullYear(), iterStart.getMonth() + i, 1);
                const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                labels.push(d.toLocaleString('pt-BR', { month: 'short', year: 'numeric' }));
                values.push(map.has(ym) ? map.get(ym) : 0);
            }
            res.json({ labels, values });
        } catch (err) { next(err); }
    });

    // ========================================
    // RELATÓRIOS PDF - Template Profissional
    // ========================================

    // Categorias de comissão por tipo de produto
    const COMISSAO_CATEGORIAS = {
        'POTENCIA': { nome: 'Cabos de Potência (Power)', percentual: 2.0, keywords: ['POTENCIA', 'POWER', 'NBR 7285', 'NBR 7286', '0,6/1KV', '1KV'] },
        'MULTIPLEX': { nome: 'Cabos Multiplexados', percentual: 1.0, keywords: ['TRIPLEX', 'DUPLEX', 'QUADRUPLEX', 'MULTIPLEX', 'NEUTRO ISOLADO'] },
        'OUTROS': { nome: 'Outros Produtos', percentual: 1.0, keywords: [] }
    };

    function classificarProdutoComissao(descricao) {
        if (!descricao) return COMISSAO_CATEGORIAS['OUTROS'];
        const desc = descricao.toUpperCase();
        if (COMISSAO_CATEGORIAS['POTENCIA'].keywords.some(k => desc.includes(k)) &&
            !COMISSAO_CATEGORIAS['MULTIPLEX'].keywords.some(k => desc.includes(k))) {
            return COMISSAO_CATEGORIAS['POTENCIA'];
        }
        if (COMISSAO_CATEGORIAS['MULTIPLEX'].keywords.some(k => desc.includes(k))) {
            return COMISSAO_CATEGORIAS['MULTIPLEX'];
        }
        return COMISSAO_CATEGORIAS['OUTROS'];
    }

    async function criarPdfRelatorio(titulo, colunas, linhas, filtrosTexto, opcoes = {}) {
        const generatePdfRelatorio = require('../src/services/pdf-relatorio');
        const colAligns = opcoes.colAligns || [];
        const colsFormatadas = colunas.map((col, i) => ({
            label: col,
            align: colAligns[i] || 'left'
        }));
        const relatorioData = {
            relatorio: {
                titulo,
                filtros: filtrosTexto,
                data_geracao: new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
            },
            resumo: (opcoes.resumo || []).map(r => ({ label: r.label, valor: r.valor })),
            colunas: colsFormatadas,
            linhas: opcoes.secoes ? [] : linhas,
            secoes: opcoes.secoes ? opcoes.secoes.map(s => ({
                titulo: s.titulo,
                info: s.info,
                linhas: s.linhas,
                subtotal: s.subtotal
            })) : null,
            totais: opcoes.totais,
            total_registros: opcoes.totalRegistros != null ? opcoes.totalRegistros : linhas.length
        };
        return generatePdfRelatorio(relatorioData);
    }

    function formatarMoedaPdf(valor) {
        return 'R$ ' + (parseFloat(valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatarDataPdf(data) {
        if (!data) return '-';
        return new Date(data).toLocaleDateString('pt-BR');
    }

    function formatarQtd(valor) {
        const num = parseFloat(valor) || 0;
        return num % 1 === 0 ? num.toString() : num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }

    function formatarPeriodoRelatorio(dataInicio, dataFim) {
        const ini = dataInicio ? formatarDataPdf(dataInicio) : 'início';
        const fim = dataFim ? formatarDataPdf(dataFim) : 'hoje';
        return `Período: ${ini} a ${fim}`;
    }

    async function dadosEmpresaRelatorio() {
        const empresaConfig = await buscarConfiguracoesEmpresa(pool);
        const dados = formatarDadosParaPDF(empresaConfig);
        return buildEmpresaTemplateData(empresaConfig, dados, path.join(__dirname, '..'));
    }

    function enviarRelatorioHtml(res, nomeArquivo, html) {
        res.set({
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': `inline; filename="${nomeArquivo}.html"`
        });
        res.send(html);
    }

    // PDF: Vendas por Período
    router.get('/relatorios/vendas-periodo/pdf', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim, vendedor_id, vendedor, status } = req.query;
            let query = `SELECT p.id, COALESCE(p.omie_numero_pedido, p.id) as numero, p.cliente_nome, p.vendedor_nome, p.valor, p.status, p.created_at
                         FROM pedidos p WHERE 1=1`;
            const params = [];
            if (data_inicio) { query += ' AND p.created_at >= ?'; params.push(data_inicio); }
            if (data_fim) { query += ' AND p.created_at <= ?'; params.push(data_fim + ' 23:59:59'); }
            if (vendedor_id) { query += ' AND p.vendedor_id = ?'; params.push(vendedor_id); }
            else if (vendedor) { query += ' AND p.vendedor_nome = ?'; params.push(vendedor); }
            if (status && status !== 'todos') { query += ' AND p.status = ?'; params.push(status); }
            query += ' ORDER BY p.created_at DESC';

            const [rows] = await vendasPool.query(query, params);

            const totalValor = rows.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
            const statusMap = {};
            rows.forEach(r => { statusMap[r.status || 'N/A'] = (statusMap[r.status || 'N/A'] || 0) + 1; });
            const statusResumo = Object.entries(statusMap).map(([k, v]) => `${k}: ${v}`).join(' | ');

            const filtro = `${formatarPeriodoRelatorio(data_inicio, data_fim)}${(vendedor_id || vendedor) ? ' | Vendedor filtrado' : ''}${status && status !== 'todos' ? ` | Status: ${status}` : ''}`;
            const emAberto = rows.filter(r => !['faturado', 'recibo', 'finalizado', 'entregue'].includes(String(r.status || '').toLowerCase())).length;
            const html = renderHtmlRelatorio(path.join(__dirname, '..'), 'pedidos.html', {
                ...(await dadosEmpresaRelatorio()),
                periodo: filtro,
                pedidos_emitidos: rows.length,
                valor_total: formatarMoedaPdf(totalValor),
                em_aberto: emAberto,
                linhas: rows.map(r => ({
                    numero: String(r.numero || r.id || '-'),
                    cliente: r.cliente_nome || '-',
                    data: formatarDataPdf(r.created_at),
                    valor: formatarMoedaPdf(r.valor),
                    status: (r.status || '-').replace(/-/g, ' '),
                    status_cor: statusBadgeClass(r.status)
                }))
            });
            return enviarRelatorioHtml(res, 'relatorio-pedidos', html);
        } catch (err) {
            console.error('Erro ao gerar PDF vendas-periodo:', err);
            res.status(500).json({ error: 'Erro ao gerar PDF', detalhe: err.message });
        }
    });

    // PDF: Comissões (com categorias: 2% cabos power, 1% multiplexado)
    router.get('/relatorios/comissoes/pdf', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim, vendedor_id, vendedor } = req.query;

            // Buscar itens dos pedidos com informação do vendedor
            let query = `SELECT p.vendedor_nome, p.vendedor_id, pi.descricao, pi.codigo,
                         pi.quantidade, pi.preco_unitario, pi.subtotal
                         FROM pedido_itens pi
                         INNER JOIN pedidos p ON pi.pedido_id = p.id
                         WHERE p.status IN ('faturado','entregue','aprovado','recibo')`;
            const params = [];
            if (data_inicio) { query += ' AND p.created_at >= ?'; params.push(data_inicio); }
            if (data_fim) { query += ' AND p.created_at <= ?'; params.push(data_fim + ' 23:59:59'); }
            if (vendedor_id) { query += ' AND p.vendedor_id = ?'; params.push(vendedor_id); }
            else if (vendedor) { query += ' AND p.vendedor_nome = ?'; params.push(vendedor); }
            query += ' ORDER BY p.vendedor_nome, pi.descricao';

            const [rows] = await vendasPool.query(query, params);

            // Agrupar por vendedor e categoria
            const vendedores = {};
            rows.forEach(r => {
                const vend = r.vendedor_nome || 'Sem vendedor';
                if (!vendedores[vend]) vendedores[vend] = { power: [], multiplex: [], outros: [], totalVendas: 0, totalComissao: 0 };
                const cat = classificarProdutoComissao(r.descricao);
                const subtotal = parseFloat(r.subtotal) || (parseFloat(r.preco_unitario) * parseFloat(r.quantidade)) || 0;
                const comissao = subtotal * cat.percentual / 100;
                const item = { descricao: r.descricao, codigo: r.codigo, qtd: parseFloat(r.quantidade), subtotal, comissao, percentual: cat.percentual };
                vendedores[vend].totalVendas += subtotal;
                vendedores[vend].totalComissao += comissao;

                if (cat === COMISSAO_CATEGORIAS['POTENCIA']) vendedores[vend].power.push(item);
                else if (cat === COMISSAO_CATEGORIAS['MULTIPLEX']) vendedores[vend].multiplex.push(item);
                else vendedores[vend].outros.push(item);
            });

            const filtro = `Período: ${data_inicio || 'início'} a ${data_fim || 'hoje'} | Cabos Power: 2% | Multiplexado: 1% | Outros: 1%`;
            const colunas = ['Vendedor', 'Produto', 'Código', 'Qtd', 'Valor Venda', '% Com.', 'Comissão'];
            const pageW = 842 - 80;
            const colWidths = [pageW * 0.16, pageW * 0.26, pageW * 0.10, pageW * 0.08, pageW * 0.15, pageW * 0.09, pageW * 0.16];
            const colAligns = ['left', 'left', 'center', 'right', 'right', 'center', 'right'];

            const secoes = [];
            let grandTotalVendas = 0;
            let grandTotalComissao = 0;
            let totalRegistros = 0;

            Object.entries(vendedores).sort((a, b) => b[1].totalComissao - a[1].totalComissao).forEach(([vendNome, vend]) => {
                grandTotalVendas += vend.totalVendas;
                grandTotalComissao += vend.totalComissao;

                const secaoLinhas = [];
                const addItems = (items, catNome) => {
                    items.forEach(item => {
                        secaoLinhas.push([
                            vendNome, item.descricao || '-', item.codigo || '-',
                            formatarQtd(item.qtd), formatarMoedaPdf(item.subtotal),
                            `${item.percentual}%`, formatarMoedaPdf(item.comissao)
                        ]);
                        totalRegistros++;
                    });
                };
                addItems(vend.power, 'Power');
                addItems(vend.multiplex, 'Multiplex');
                addItems(vend.outros, 'Outros');

                if (secaoLinhas.length > 0) {
                    const powerTotal = vend.power.reduce((s, i) => s + i.comissao, 0);
                    const muxTotal = vend.multiplex.reduce((s, i) => s + i.comissao, 0);
                    const outrosTotal = vend.outros.reduce((s, i) => s + i.comissao, 0);
                    let detalhes = [];
                    if (vend.power.length) detalhes.push(`Power 2%: ${formatarMoedaPdf(powerTotal)}`);
                    if (vend.multiplex.length) detalhes.push(`Multiplex 1%: ${formatarMoedaPdf(muxTotal)}`);
                    if (vend.outros.length) detalhes.push(`Outros 1%: ${formatarMoedaPdf(outrosTotal)}`);

                    secoes.push({
                        titulo: `${vendNome}`,
                        info: `Vendas: ${formatarMoedaPdf(vend.totalVendas)}`,
                        cor: '#eff6ff',
                        corTexto: '#1e40af',
                        linhas: secaoLinhas,
                        subtotal: `${detalhes.join('  •  ')}  │  Total Comissão: ${formatarMoedaPdf(vend.totalComissao)}`
                    });
                }
            });

            const html = renderHtmlRelatorio(path.join(__dirname, '..'), 'comissoes.html', {
                ...(await dadosEmpresaRelatorio()),
                competencia: formatarPeriodoRelatorio(data_inicio, data_fim),
                data_pagamento: 'A definir',
                total_base: formatarMoedaPdf(grandTotalVendas),
                total_comissao: formatarMoedaPdf(grandTotalComissao),
                qtd_vendedores: Object.keys(vendedores).length,
                observacoes: 'Relatório gerado a partir dos pedidos de venda no período selecionado.',
                linhas: Object.entries(vendedores)
                    .sort((a, b) => b[1].totalComissao - a[1].totalComissao)
                    .map(([vendNome, vend]) => ({
                        vendedor: vendNome,
                        plano: 'Comercial',
                        plano_classe: 'badge-blue',
                        base: formatarMoedaPdf(vend.totalVendas),
                        taxa: 'por categoria',
                        comissao: formatarMoedaPdf(vend.totalComissao)
                    }))
            });
            return enviarRelatorioHtml(res, 'relatorio-comissoes', html);
        } catch (err) {
            console.error('Erro ao gerar PDF comissoes:', err);
            res.status(500).json({ error: 'Erro ao gerar PDF', detalhe: err.message });
        }
    });

    // PDF: Clientes
    router.get('/relatorios/clientes/pdf', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { cliente_id, status, cidade, estado, ordenar_por } = req.query;
            let query = `SELECT c.nome, c.email, c.telefone, c.cidade, c.estado, c.ativo,
                         (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) as qtd_pedidos,
                         (SELECT COALESCE(SUM(p.valor), 0) FROM pedidos p WHERE p.cliente_id = c.id) as total_compras,
                         (SELECT MAX(p.created_at) FROM pedidos p WHERE p.cliente_id = c.id) as ultima_compra
                         FROM clientes c WHERE 1=1`;
            const params = [];
            if (cliente_id) { query += ' AND c.id = ?'; params.push(cliente_id); }
            if (status === 'ativo') { query += ' AND c.ativo = 1'; }
            else if (status === 'inativo') { query += ' AND c.ativo = 0'; }
            if (cidade) { query += ' AND c.cidade LIKE ?'; params.push(`%${cidade}%`); }
            if (estado) { query += ' AND c.estado = ?'; params.push(estado); }
            const orderMap = { nome: 'c.nome ASC', pedidos: 'qtd_pedidos DESC', valor: 'total_compras DESC' };
            query += ` ORDER BY ${orderMap[ordenar_por] || 'c.nome ASC'}`;

            const [rows] = await vendasPool.query(query, params);

            const totalClientes = rows.length;
            const totalCompras = rows.reduce((s, r) => s + (parseFloat(r.total_compras) || 0), 0);
            const totalPedidos = rows.reduce((s, r) => s + (parseInt(r.qtd_pedidos) || 0), 0);
            const clientesComPedido = rows.filter(r => parseInt(r.qtd_pedidos) > 0).length;

            const filtro = `${cidade ? `Cidade: ${cidade} | ` : ''}${estado ? `Estado: ${estado} | ` : ''}Ordenado por: ${ordenar_por || 'nome'}`;
            const ordenados = rows.slice().sort((a, b) => (parseFloat(b.total_compras) || 0) - (parseFloat(a.total_compras) || 0));
            const limiteClasseA = Math.max(1, Math.ceil(ordenados.length * 0.2));
            const limiteClasseB = Math.max(limiteClasseA, Math.ceil(ordenados.length * 0.5));
            const classeAReceita = ordenados.slice(0, limiteClasseA)
                .reduce((s, r) => s + (parseFloat(r.total_compras) || 0), 0);
            const html = renderHtmlRelatorio(path.join(__dirname, '..'), 'analise-clientes.html', {
                ...(await dadosEmpresaRelatorio()),
                periodo: filtro,
                clientes_ativos: totalClientes,
                receita_total: formatarMoedaPdf(totalCompras),
                classe_a_pct: ordenados.length ? `${Math.round((limiteClasseA / ordenados.length) * 100)}%` : '0%',
                classe_a_receita: formatarMoedaPdf(classeAReceita),
                recencia_media: '-',
                linhas: ordenados.map((r, idx) => ({
                    cliente: r.nome || '-',
                    classe: idx < limiteClasseA ? 'A' : (idx < limiteClasseB ? 'B' : 'C'),
                    classe_cor: idx < limiteClasseA ? 'badge-green' : (idx < limiteClasseB ? 'badge-blue' : 'badge-gray'),
                    pedidos: String(r.qtd_pedidos || 0),
                    receita: formatarMoedaPdf(r.total_compras),
                    ultima_compra: formatarDataPdf(r.ultima_compra)
                }))
            });
            return enviarRelatorioHtml(res, 'relatorio-clientes', html);
        } catch (err) {
            console.error('Erro ao gerar PDF clientes:', err);
            res.status(500).json({ error: 'Erro ao gerar PDF', detalhe: err.message });
        }
    });

    // PDF: Produtos Mais Vendidos
    router.get('/relatorios/produtos/pdf', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim, ordenar_por } = req.query;
            let query = `SELECT pi.descricao, pi.codigo, SUM(pi.quantidade) as qtd_total,
                         SUM(pi.subtotal) as valor_total,
                         COUNT(DISTINCT pi.pedido_id) as qtd_pedidos
                         FROM pedido_itens pi
                         INNER JOIN pedidos p ON pi.pedido_id = p.id
                         WHERE 1=1`;
            const params = [];
            if (data_inicio) { query += ' AND p.created_at >= ?'; params.push(data_inicio); }
            if (data_fim) { query += ' AND p.created_at <= ?'; params.push(data_fim + ' 23:59:59'); }
            query += ' GROUP BY pi.descricao, pi.codigo';
            const orderMap = { quantidade: 'qtd_total DESC', valor: 'valor_total DESC', nome: 'pi.descricao ASC' };
            query += ` ORDER BY ${orderMap[ordenar_por] || 'valor_total DESC'}`;

            const [rows] = await vendasPool.query(query, params);

            const totalQtd = rows.reduce((s, r) => s + (parseFloat(r.qtd_total) || 0), 0);
            const totalValor = rows.reduce((s, r) => s + (parseFloat(r.valor_total) || 0), 0);

            const filtro = `${formatarPeriodoRelatorio(data_inicio, data_fim)} | Ordenado por: ${ordenar_por || 'valor'}`;
            const html = renderHtmlRelatorio(path.join(__dirname, '..'), 'performance-produtos.html', {
                ...(await dadosEmpresaRelatorio()),
                periodo: filtro,
                skus_ativos: rows.length,
                receita_top: formatarMoedaPdf(totalValor),
                margem_media: '-',
                linhas: rows.map(r => {
                    const receita = parseFloat(r.valor_total) || 0;
                    return {
                        produto: [r.codigo, r.descricao].filter(Boolean).join(' - ') || '-',
                        qtd: formatarQtd(r.qtd_total),
                        receita: formatarMoedaPdf(receita),
                        margem: '-',
                        participacao: totalValor > 0 ? `${((receita / totalValor) * 100).toFixed(1)}%` : '0%'
                    };
                })
            });
            return enviarRelatorioHtml(res, 'relatorio-produtos', html);
        } catch (err) {
            console.error('Erro ao gerar PDF produtos:', err);
            res.status(500).json({ error: 'Erro ao gerar PDF', detalhe: err.message });
        }
    });

    // ========================================
    // COMISSÕES EXPORTAR (CSV)
    // ========================================
    router.get('/comissoes/exportar', authorizeArea('vendas'), async (req, res, next) => {
        try {
            const { periodo, formato } = req.query;
            const periodoAtual = periodo || new Date().toISOString().substring(0, 7);

            const [rows] = await vendasPool.query(`
                SELECT
                    u.nome as 'Vendedor',
                    u.email as 'Email',
                    COUNT(CASE WHEN p.status IN ('faturado', 'recibo') THEN 1 END) as 'Qtd Vendas',
                    SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END) as 'Valor Total',
                    COALESCE(u.comissao_percentual, 1.0) as 'Percentual',
                    SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) ELSE 0 END) as 'Comissao'
                FROM usuarios u
                LEFT JOIN departamentos d ON u.departamento_id = d.id
                LEFT JOIN pedidos p ON u.id = p.vendedor_id AND DATE_FORMAT(p.created_at, '%Y-%m') = ?
                WHERE d.nome = 'Comercial' AND u.status = 'ativo'
                GROUP BY u.id, u.nome, u.email, u.comissao_percentual
                ORDER BY u.nome
            `, [periodoAtual]);

            if (formato === 'csv') {
                const headers = Object.keys(rows[0] || {}).join(';');
                const csvRows = rows.map(r => Object.values(r).join(';'));
                const csv = [headers, ...csvRows].join('\n');

                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename=comissoes_${periodoAtual}.csv`);
                return res.send('\uFEFF' + csv);
            }

            res.json(rows);
        } catch (error) { next(error); }
    });

    // ========================================
    // METAS EM LOTE
    // ========================================
    router.post('/metas/lote', authenticateToken, authorizeArea('vendas'), async (req, res, next) => {
        try {
            const user = req.user;
            const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
            if (!isAdmin) {
                return res.status(403).json({ message: 'Apenas administradores podem definir metas.' });
            }

            const { periodo, valor_meta_padrao, metas_individuais } = req.body;
            const METAS_CATEGORIAS_VALIDAS = ['faturamento', 'clientes', 'ticket_medio', 'conversao'];
            const categoria = METAS_CATEGORIAS_VALIDAS.includes(req.body.categoria) ? req.body.categoria : 'faturamento';

            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodo || '').trim())) {
                return res.status(400).json({ message: 'Período inválido. Use o formato AAAA-MM.' });
            }

            // A query original era `LEFT JOIN departamentos d ON u.departamento_id = d.id
            // WHERE d.nome = 'Comercial'` — `usuarios.departamento_id` NÃO EXISTE em nenhuma
            // das 4 bases (só `usuarios.departamento`, VARCHAR(100)), então esta rota morria
            // com ER_BAD_FIELD_ERROR sempre: a opção "Meta da Equipe" da tela nunca gravou uma
            // linha em instância nenhuma. Recorte de "quem é vendedor" copiado de
            // GET /api/vendas/vendedores para a equipe da meta ser a MESMA equipe do ranking.
            const [colunasUsuarios] = await vendasPool.query('SHOW COLUMNS FROM usuarios');
            const cols = new Set(colunasUsuarios.map(c => c.Field));
            const ativoChecks = [];
            if (cols.has('ativo')) ativoChecks.push('(u.ativo = 1 OR u.ativo IS NULL)');
            if (cols.has('status')) ativoChecks.push("(u.status IS NULL OR LOWER(u.status) NOT IN ('inativo','bloqueado','desativado','excluido'))");
            if (cols.has('deleted_at')) ativoChecks.push('u.deleted_at IS NULL');
            ativoChecks.push("NOT EXISTS (SELECT 1 FROM funcionarios f WHERE f.email = u.email AND (LOWER(f.status) = 'demitido' OR f.ativo = 0 OR f.data_demissao IS NOT NULL))");
            const vendedorChecks = [];
            if (cols.has('role')) vendedorChecks.push("LOWER(COALESCE(u.role,'')) IN ('comercial','vendedor','sales')");
            if (cols.has('departamento')) vendedorChecks.push("LOWER(COALESCE(u.departamento,'')) LIKE '%comercial%' OR LOWER(COALESCE(u.departamento,'')) LIKE '%vendas%'");
            if (cols.has('cargo')) vendedorChecks.push("LOWER(COALESCE(u.cargo,'')) LIKE '%vendedor%' OR LOWER(COALESCE(u.cargo,'')) LIKE '%consultor%' OR LOWER(COALESCE(u.cargo,'')) LIKE '%comercial%'");
            if (cols.has('setor')) vendedorChecks.push("LOWER(COALESCE(u.setor,'')) LIKE '%comercial%' OR LOWER(COALESCE(u.setor,'')) LIKE '%vendas%'");
            if (cols.has('perfil')) vendedorChecks.push("LOWER(COALESCE(u.perfil,'')) LIKE '%vendedor%' OR LOWER(COALESCE(u.perfil,'')) LIKE '%comercial%'");
            // Mesma inclusão nominal de GET /vendedores — sem ela a meta da equipe pularia
            // alguém que o ranking lista, e o card "Abaixo da Meta" nunca fecharia.
            vendedorChecks.push("LOWER(COALESCE(u.nome,'')) LIKE '%lorena%silva%'");
            vendedorChecks.push("LOWER(COALESCE(u.nome,'')) LIKE '%melissa%navarro%'");

            const [vendedores] = await vendasPool.query(`
                SELECT DISTINCT u.id, u.nome FROM usuarios u
                 WHERE ${ativoChecks.join(' AND ')}
                   AND (${vendedorChecks.map(c => `(${c})`).join(' OR ')})
                 ORDER BY u.nome ASC
            `);

            if (!vendedores.length) {
                return res.status(404).json({ message: 'Nenhum vendedor ativo encontrado para receber a meta.' });
            }

            let criadas = 0;
            let atualizadas = 0;
            let duplicatasDesativadas = 0;
            const semValor = [];

            for (const vendedor of vendedores) {
                const metaIndividual = metas_individuais?.find(m => m.vendedor_id === vendedor.id);
                const valorMeta = parseFloat(metaIndividual ? metaIndividual.valor_meta : valor_meta_padrao);

                if (!Number.isFinite(valorMeta) || valorMeta <= 0) { semValor.push(vendedor.nome); continue; }

                // AUDIT-FIX: casar também por categoria — senão uma meta de "clientes" pra um
                // vendedor sobrescrevia a meta de "faturamento" já cadastrada pro mesmo período.
                // ORDER BY id DESC + desativação das anteriores: metas_vendas não tem UNIQUE
                // nesse recorte e acumulava uma linha por regravação (13 no 03/2026 da aluforce).
                const [existing] = await vendasPool.query(
                    'SELECT id FROM metas_vendas WHERE vendedor_id = ? AND periodo = ? AND categoria = ? ORDER BY id DESC',
                    [vendedor.id, periodo, categoria]
                );

                if (existing.length > 0) {
                    await vendasPool.query(
                        'UPDATE metas_vendas SET valor_meta = ?, tipo = ?, ativo = 1 WHERE id = ?',
                        [valorMeta, 'mensal', existing[0].id]
                    );
                    atualizadas++;
                    const antigas = existing.slice(1).map(r => r.id);
                    if (antigas.length) {
                        await vendasPool.query(
                            `UPDATE metas_vendas SET ativo = 0 WHERE id IN (${antigas.map(() => '?').join(',')})`,
                            antigas
                        );
                        duplicatasDesativadas += antigas.length;
                    }
                } else {
                    await vendasPool.query(
                        'INSERT INTO metas_vendas (vendedor_id, periodo, tipo, categoria, valor_meta) VALUES (?, ?, ?, ?, ?)',
                        [vendedor.id, periodo, 'mensal', categoria, valorMeta]
                    );
                    criadas++;
                }
            }

            res.json({
                message: `Metas processadas: ${criadas} criadas, ${atualizadas} atualizadas`
                    + (semValor.length ? ` — ${semValor.length} sem valor informado` : ''),
                total_vendedores: vendedores.length,
                criadas,
                atualizadas,
                sem_valor: semValor,
                duplicatas_desativadas: duplicatasDesativadas
            });
        } catch (error) { next(error); }
    });

    // ========================================
    // EMPRESAS BUSCAR (autocomplete para prospecção)
    // ========================================
    router.get('/empresas/buscar', authorizeArea('vendas'), async (req, res, next) => {
        try {
            const search = req.query.search || req.query.q || req.query.termo || '';
            let query = `SELECT id, nome_fantasia, razao_social, cnpj, telefone, email
                         FROM empresas WHERE 1=1`;
            const params = [];

            if (search) {
                query += ` AND (nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            query += ' ORDER BY nome_fantasia LIMIT 30';

            const [rows] = await vendasPool.query(query, params);
            res.json(rows);
        } catch (error) { next(error); }
    });

    // ========================================
    // LIGAÇÕES - CDR Scraper via Puppeteer
    // ========================================
    const cdrScraper = require('../services/cdr-scraper');

    // GET /ligacoes/status
    router.get('/ligacoes/status', authorizeArea('vendas'), async (req, res) => {
        try {
            const status = cdrScraper.getStatus();
            res.json(status);
        } catch (error) {
            res.json({ configurado: false, erro: error.message });
        }
    });

    // GET /ligacoes/dispositivos
    router.get('/ligacoes/dispositivos', authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;
            const ramais = await cdrScraper.listarRamais(data_inicio, data_fim);
            return res.json(ramais);
        } catch (error) {
            console.error('Erro ao listar ramais CDR:', error.message);
            // Fallback: retornar lista estática de ramais quando scraper falha
            const RAMAL_NOMES = cdrScraper.RAMAL_NOMES || {};
            const fallback = Object.entries(RAMAL_NOMES).map(([id, name]) => ({
                username: id, name, callerid: `${name} (${id})`, id
            }));
            return res.json(fallback);
        }
    });

    // GET /ligacoes/cdr
    router.get('/ligacoes/cdr', authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim, ramal, tipo } = req.query;

            const hoje = new Date().toISOString().split('T')[0];
            const di = data_inicio || hoje;
            const df = data_fim || hoje;

            let chamadas = await cdrScraper.fetchCDRData(di, df);

            if (ramal) {
                chamadas = chamadas.filter(c => c.ramal === ramal || c.origem === ramal);
            }
            if (tipo === 'movel') {
                chamadas = chamadas.filter(c => c.subtipo === 'movel');
            } else if (tipo === 'fixo') {
                chamadas = chamadas.filter(c => c.subtipo === 'fixo');
            }

            res.json({
                total: chamadas.length,
                chamadas,
                periodo: { inicio: di, fim: df }
            });
        } catch (error) {
            console.error('Erro ao buscar CDR:', error.message);
            const hoje = new Date().toISOString().split('T')[0];
            res.json({
                total: 0, chamadas: [],
                periodo: { inicio: req.query.data_inicio || hoje, fim: req.query.data_fim || hoje },
                erro: error.message
            });
        }
    });

    // GET /ligacoes/online
    router.get('/ligacoes/online', authorizeArea('vendas'), async (req, res) => {
        res.json({ total: 0, chamadas: [] });
    });

    // GET /ligacoes/resumo
    router.get('/ligacoes/resumo', authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;

            const hoje = new Date().toISOString().split('T')[0];
            const di = data_inicio || hoje;
            const df = data_fim || hoje;

            const chamadas = await cdrScraper.fetchCDRData(di, df);
            const resumo = cdrScraper.gerarResumo(chamadas);
            resumo.periodo = { inicio: di, fim: df };

            // Buscar meta mensal de ligações (se existir)
            try {
                const periodo = new Date().toISOString().substring(0, 7);
                const [metaRows] = await pool.query(
                    "SELECT valor_meta FROM metas_vendas WHERE tipo = 'ligacoes' AND periodo = ? AND vendedor_id IS NULL LIMIT 1",
                    [periodo]
                );
                resumo.meta_mensal = metaRows.length > 0 ? Number(metaRows[0].valor_meta) : 0;
            } catch (_) { resumo.meta_mensal = 0; }

            res.json(resumo);
        } catch (error) {
            console.error('Erro ao gerar resumo de ligações:', error.message);
            // Fallback: retornar resumo vazio em vez de 500
            // NOTE: di/df are scoped to try block — use req.query here
            const hoje = new Date().toISOString().split('T')[0];
            res.json({
                total: 0, realizadas: 0, atendidas: 0, nao_atendidas: 0,
                duracao_total: '00:00:00', por_ramal: [],
                periodo: {
                    inicio: req.query.data_inicio || hoje,
                    fim: req.query.data_fim || hoje
                },
                erro: error.message
            });
        }
    });


    // ===== ROUND3-ALU: kanban/pedidos =====
    // canonizarIdentidade: o claim `email` do JWT pode vir com o LOGIN — sem isto a
    // identidade usada por podeVerTodosPedidosVendas (compras/logistica/pcp por login)
    // compara a string errada e o Kanban volta vazio, sem erro.
    router.get('/kanban/pedidos', authenticateToken, canonizarIdentidade(pool), async (req, res) => {
        try {
            const {
                dataInclusao, dataInclusaoInicio, dataInclusaoFim,
                dataPrevisao, dataFaturamento,
                vendedor, projeto,
                q,
                exibirCancelados = 'false',
                exibirDenegados  = 'false',
                exibirEncerrados = 'false'
            } = req.query;

            const where  = [];
            const params = [];
            // A busca da barra consulta o historico inteiro. O recorte de data da tela
            // continua valendo quando a busca esta vazia; durante a pesquisa ele faria
            // clientes antigos parecerem inexistentes. Limite protege a consulta e a UI.
            const termoBusca = String(q || '').trim().slice(0, 120);
            const buscaAtiva = termoBusca.length >= 2 || /^#?\d+$/.test(termoBusca);

            // Soft-delete: nunca exibir pedidos excluidos (status='excluido' + deleted_at).
            // A rota /pedidos ja filtra isso; o kanban precisa do mesmo filtro senao o
            // front mapeia o status desconhecido 'excluido' para a coluna Orcamento.
            where.push("LOWER(COALESCE(p.status,'')) NOT LIKE 'exclu%'");
            where.push("(p.deleted_at IS NULL OR CAST(p.deleted_at AS CHAR) = '0000-00-00 00:00:00')");

            const excluidos = [];
            if (exibirCancelados !== 'true')  excluidos.push("'cancelado'", "'cancelada'");
            if (exibirDenegados  !== 'true')  excluidos.push("'denegado'",  "'negado'");
            if (exibirEncerrados !== 'true')  excluidos.push("'encerrado'");
            if (excluidos.length) {
                where.push('LOWER(COALESCE(p.status,\'\')) NOT IN (' + excluidos.join(',') + ')');
            }

            // Janela de datas do kanban.
            // ATENÇÃO: o código antigo fazia `parseInt(dataInclusao) || 30` — como o front
            // manda rótulos ('hoje', 'ultimos-7'), o parseInt dava NaN e TODO filtro virava
            // "30 dias" em silêncio. Aqui os rótulos são interpretados de verdade.
            const janelaInclusao = (valor) => {
                const v = String(valor || '').trim().toLowerCase();
                // O padrão do Kanban cobre o mês corrente e o imediatamente anterior.
                // Isso preserva os pedidos do mês recém-encerrado na virada do calendário
                // (ex.: pedidos de agosto continuam visíveis em 1º de setembro).
                if (v === 'mes-atual-e-anterior') {
                    return { sql: "p.created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')", dias: null };
                }
                if (v === 'mes-atual') return { sql: "p.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')", dias: null };
                if (v === 'hoje')      return { sql: 'DATE(p.created_at) = CURDATE()', dias: null };
                if (v === 'ontem')     return { sql: 'DATE(p.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)', dias: null };
                const n = parseInt(v.replace(/^ultimos-?/, ''), 10);
                return { sql: 'p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)', dias: Number.isFinite(n) ? n : 30 };
            };
            // "Periodo especifico" (De/Ate do seletor da barra): nenhum rotulo de
            // `dataInclusao` exprime um intervalo arbitrario, entao o front manda as
            // duas pontas e elas tem precedencia sobre o rotulo. Sem isto o menu so
            // conseguia peneirar no browser o que o servidor ja havia cortado -- e um
            // periodo anterior a janela padrao voltava sempre vazio.
            const _dataIso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : null);
            const _incIni = _dataIso(dataInclusaoInicio);
            const _incFim = _dataIso(dataInclusaoFim);
            if (!buscaAtiva && _incIni && _incFim) {
                // Fim INCLUSIVO: `created_at` e datetime, e `<= '2026-08-31'` cortaria
                // fora tudo o que foi criado depois da meia-noite do ultimo dia.
                where.push('p.created_at >= ? AND p.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
                params.push(_incIni, _incFim);
            } else if (!buscaAtiva && dataInclusao && dataInclusao !== 'tudo') {
                const j = janelaInclusao(dataInclusao);
                where.push(j.sql);
                if (j.dias !== null) params.push(j.dias);
            }
            if (!buscaAtiva && dataPrevisao && dataPrevisao !== 'tudo') {
                where.push('COALESCE(p.data_previsao, p.data_prevista) <= DATE_ADD(NOW(), INTERVAL ? DAY)');
                params.push(parseInt(dataPrevisao) || 30);
            }
            if (!buscaAtiva && dataFaturamento && dataFaturamento !== 'tudo') {
                where.push('p.data_faturamento >= DATE_SUB(NOW(), INTERVAL ? DAY)');
                params.push(parseInt(dataFaturamento) || 30);
            }
            if (vendedor && vendedor !== 'todos') { where.push('p.vendedor_id = ?'); params.push(vendedor); }
            if (projeto && projeto !== 'todos')   { where.push('p.projeto_id = ?'); params.push(projeto); }

            if (buscaAtiva) {
                // A collation utf8mb4 das bases e case/accent insensitive. Para documentos,
                // comparamos tambem so os digitos: 12.345.678/0001-90 encontra o mesmo
                // cadastro armazenado como 12345678000190 (e vice-versa).
                const termoComparavel = termoBusca
                    .replace(/^(?:pedido|ped|nf-e|nfe|nf)\s*#?\s*/i, '')
                    .replace(/^#\s*/, '')
                    .trim() || termoBusca;
                const textoLike = `%${termoComparavel}%`;
                const digitos = termoBusca.replace(/\D/g, '');
                const busca = [
                    'CAST(p.id AS CHAR) LIKE ?',
                    "CAST(COALESCE(p.numero_pedido, '') AS CHAR) LIKE ?",
                    "COALESCE(c.nome_fantasia, '') LIKE ?",
                    "COALESCE(c.razao_social, '') LIKE ?",
                    "COALESCE(c.nome, '') LIKE ?",
                    "COALESCE(p.cliente_nome, '') LIKE ?",
                    "COALESCE(p.vendedor_nome, '') LIKE ?",
                    "COALESCE(vu.nome, '') LIKE ?",
                    "COALESCE(t.nome_fantasia, '') LIKE ?",
                    "COALESCE(t.razao_social, '') LIKE ?",
                    "CAST(COALESCE(p.numero_nf, '') AS CHAR) LIKE ?",
                    `EXISTS (
                        SELECT 1 FROM nfes n_busca
                         WHERE n_busca.pedido_id = p.id
                           AND (CAST(COALESCE(n_busca.numero, '') AS CHAR) LIKE ?
                                OR COALESCE(n_busca.chave_acesso, '') LIKE ?)
                    )`
                ];
                const valoresBusca = Array(13).fill(textoLike);

                if (digitos.length >= 3) {
                    const somenteDigitosCnpj = "REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c.cnpj, ''), '.', ''), '/', ''), '-', ''), ' ', '')";
                    const somenteDigitosCpf = "REPLACE(REPLACE(REPLACE(COALESCE(c.cpf, ''), '.', ''), '-', ''), ' ', '')";
                    busca.push(`${somenteDigitosCnpj} LIKE ?`, `${somenteDigitosCpf} LIKE ?`);
                    valoresBusca.push(`%${digitos}%`, `%${digitos}%`);
                }

                where.push('(' + busca.join(' OR ') + ')');
                params.push(...valoresBusca);
            }

            // Escopo por vendedor: não-admin vê apenas os SEUS pedidos (igual à lista /pedidos,
            // usando idx_pedidos_vendedor_status). Garante que representantes — cujos pedidos
            // REPRESENTANTE têm vendedor_id vinculado — vejam só os deles também no kanban.
            // EXCEÇÕES: PCP (produção) fatura pedidos de toda a equipe, Compras aprova o crédito,
            // Consultoria acompanha a carteira (somente leitura) e os supervisores comerciais
            // Augusto/Renata acompanham a carteira completa.
            // AUDIT-FIX: reaproveita podeVerTodosPedidosVendas (mesma regra de GET /pedidos) em
            // vez de reimplementar a checagem aqui — a cópia local que existia antes tinha
            // esquecido a role 'consultoria', deixando o Kanban vazio para esse perfil mesmo
            // com o módulo Vendas liberado.
            const _kanbanVeTudo = podeVerTodosPedidosVendas(req.user);
            if (!_kanbanVeTudo && req.user?.id) { where.push('p.vendedor_id = ?'); params.push(req.user.id); }

            // Vendedor não-admin não acompanha o pós-faturamento — quem cuida daqui em
            // diante é o supervisor/PCP/Compras/Logística (todos cobertos por
            // `_kanbanVeTudo`). Sem isto o vendedor filtrava e ainda via os próprios
            // pedidos já em Faturar/Faturado/Recibo; para ele o fluxo "termina" em
            // Aguardando Faturamento.
            if (!_kanbanVeTudo) {
                where.push("LOWER(COALESCE(p.status,'')) NOT IN ('faturar','faturado','recibo')");
            }

            // Dado vivo do Kanban: nunca deixar o browser revalidar contra um corpo antigo.
            // Sem isso, uma mudança de escopo (ex.: Compras passando a ver tudo) fica mascarada
            // por um 304 em cima do "[]" que o navegador guardou.
            res.set('Cache-Control', 'no-store');

            const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

            const [rows] = await pool.query(`
                SELECT p.id,
                    COALESCE(p.numero_pedido, p.id) AS numero_pedido,
                    p.status, COALESCE(p.valor, 0) AS valor,
                    p.created_at AS data_inclusao, p.created_at,
                    COALESCE(p.data_previsao, p.data_prevista) AS data_previsao,
                    p.data_faturamento,
                    COALESCE(p.condicoes_pagamento, p.condicao_pagamento, '') AS condicoes_pagamento,
                    COALESCE(p.tipo_frete, '') AS tipo_frete,
                    COALESCE(p.frete, 0) AS frete,
                    COALESCE(p.observacao_cliente, '') AS observacao_cliente,
                    COALESCE(p.observacao_producao, '') AS observacao_producao,
                    COALESCE(p.tipo_faturamento, 'integral') AS tipo_faturamento,
                    COALESCE(p.percentual_faturado, 0) AS percentual_faturado,
                    COALESCE(p.valor_faturado, 0) AS valor_faturado,
                    COALESCE(p.valor, 0) - COALESCE(p.valor_faturado, 0) AS valor_pendente,
                    p.numero_nf, p.origem, p.cliente_id,
                    -- O card do Kanban precisa do numero da NF-e mesmo depois de um
                    -- cancelamento: p.numero_nf e ZERADO quando a nota e cancelada, entao o
                    -- numero tem de vir da tabela nfes. Autorizada na frente, porque pode
                    -- existir uma rejeitada mais nova que a valida. Mesma leitura do
                    -- GET /pedidos/:id em vendas-routes.js.
                    (SELECT n2.numero FROM nfes n2 WHERE n2.pedido_id = p.id
                      ORDER BY (LOWER(COALESCE(n2.status, '')) = 'autorizada') DESC, n2.id DESC LIMIT 1) AS nfe_doc_numero,
                    (SELECT n2.status FROM nfes n2 WHERE n2.pedido_id = p.id
                      ORDER BY (LOWER(COALESCE(n2.status, '')) = 'autorizada') DESC, n2.id DESC LIMIT 1) AS nfe_doc_status,
                    -- Ordem de producao do pedido, para o selo de OP na visualizacao de LISTA.
                    -- O vinculo confiavel e pedido_vinculado_id (e o gemeo pedido_id):
                    -- ordens_producao.numero_pedido costuma espelhar o proprio codigo da OP
                    -- (ex.: 202602094), nao o numero do pedido de venda - usa-lo aqui casaria
                    -- OP com pedido errado. Cancelada nao conta como OP do pedido.
                    -- (sem crase nos comentarios: a query inteira e um template literal JS)
                    (SELECT op.codigo FROM ordens_producao op
                      WHERE (op.pedido_vinculado_id = p.id OR op.pedido_id = p.id)
                        AND LOWER(COALESCE(op.status, '')) NOT IN ('cancelada', 'cancelado')
                      ORDER BY op.id DESC LIMIT 1) AS op_codigo,
                    (SELECT LOWER(COALESCE(op.status, '')) FROM ordens_producao op
                      WHERE (op.pedido_vinculado_id = p.id OR op.pedido_id = p.id)
                        AND LOWER(COALESCE(op.status, '')) NOT IN ('cancelada', 'cancelado')
                      ORDER BY op.id DESC LIMIT 1) AS op_status,
                    COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, '') AS cliente_nome,
                    COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, '') AS cliente,
                    c.nome_fantasia AS cliente_nome_fantasia,
                    c.razao_social AS cliente_razao_social,
                    c.nome AS cliente_nome_cadastro,
                    COALESCE(c.cnpj, c.cpf, '') AS cliente_cnpj,
                    p.empresa_id, p.vendedor_id,
                    -- BUG-VEND-012: vendedor_id referencia usuarios.id, nao vendedores.id.
                    -- A tabela vendedores e uma tabela paralela (legado/sync Omie) com IDs
                    -- proprios que colidem por coincidencia com usuarios.id (ex.: id=5 =
                    -- Augusto em usuarios mas Fabiano em vendedores) - por isso pedidos do
                    -- Augusto apareciam com o nome do Fabiano. Prioriza o nome GRAVADO no pedido
                    -- (autoritativo) e o JOIN correto (usuarios); vendedores fica so como ultimo
                    -- fallback. Mesma logica ja aplicada em repositories/pedido-repository.js.
                    COALESCE(
                        NULLIF(CASE WHEN LOWER(TRIM(COALESCE(p.vendedor_nome, ''))) = 'mel' THEN 'Melissa Navarro' ELSE TRIM(p.vendedor_nome) END, ''),
                        vu.nome, v.nome, uc.nome, ''
                    ) AS vendedor_nome,
                    p.transportadora_id,
                    COALESCE(t.nome_fantasia, t.razao_social, p.transportadora_nome, '') AS transportadora_nome
                FROM pedidos p
                LEFT JOIN clientes       c ON c.id = p.cliente_id
                LEFT JOIN vendedores     v  ON v.id = p.vendedor_id
                LEFT JOIN usuarios       vu ON vu.id = p.vendedor_id
                LEFT JOIN usuarios       uc ON uc.id = p.usuario_id
                LEFT JOIN transportadoras t ON t.id = p.transportadora_id
                ${whereClause}
                -- A lista comercial e numerada por numero_pedido. Importacoes podem manter
                -- a data original do Omie; ordenar por created_at escondia pedidos novos
                -- (ex.: 3653-3655) abaixo de numeros menores criados hoje.
                ORDER BY COALESCE(p.numero_pedido, p.id) DESC, p.id DESC
                LIMIT 8000
            `, params);

            res.json(rows.map(r => ({ ...r, itens: [] })));
        } catch (err) {
            console.error('[VENDAS/kanban/pedidos]', err.message);
            res.status(500).json([]);
        }
    });

    // ======================================
    // FIM DAS ROTAS DO MÓDULO VENDAS
    // ======================================


    return router;
};
