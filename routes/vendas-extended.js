/**
 * VENDAS EXTENDED ROUTES - Extracted from server.js (Lines 25776-27054)
 * Dashboard admin/vendedor, top-vendedores, pedidos, relatorios
 * NOTE: Uses separate vendasPool connecting to aluforce_vendas database
 * @module routes/vendas-extended
 */
const express = require('express');
const mysql = require('mysql2/promise');
const { buscarConfiguracoesEmpresa, formatarDadosParaPDF, resolverCaminhoLogo } = require('../modules/_shared/services/empresa-config.service');
const { buildEmpresaTemplateData, renderHtmlRelatorio, resolveRelatorioTemplate, statusBadgeClass } = require('../src/services/html-relatorio-renderer');

module.exports = function createVendasExtendedRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeAdmin, writeAuditLog, cacheMiddleware, CACHE_CONFIG, VENDAS_DB_CONFIG } = deps;
    const router = express.Router();

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
    const isPedidoMeiaNota = (pedido) => {
        const tipo = String(pedido?.tipo_faturamento || '').toLowerCase();
        const status = String(pedido?.status || '').toLowerCase().trim();
        const valorTotal = parseFloat(pedido?.valor || pedido?.valor_total) || 0;
        const valorFaturado = parseFloat(pedido?.valor_faturado) || 0;
        const valorPendente = parseFloat(pedido?.valor_pendente) || 0;
        const percentual = parseFloat(pedido?.percentual_faturado) || 0;
        return (tipo && tipo !== 'normal' && tipo !== 'integral')
            || ['parcial', 'recibo'].includes(status)
            || percentual > 0
            || (valorPendente > 0 && valorPendente < valorTotal)
            || (valorFaturado > 0 && valorFaturado < valorTotal);
    };

    // Separate pool for vendas database
    let vendasPool;
    try {
        vendasPool = mysql.createPool(VENDAS_DB_CONFIG || {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER || 'aluforce',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'aluforce_vendas',
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
            const período = req.query.período || '30'; // dias

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
                WHERE p.vendedor_id = ? AND p.created_at >= CURDATE() - INTERVAL ? MONTH
                GROUP BY e.id, e.nome_fantasia
                ORDER BY valor_faturado DESC
                LIMIT 10
            `, [vendedorId, parseInt(período) || 6]);

            // Taxa de conversão pessoal
            const totalOrcamentos = metricsRows[0]?.total_orcamentos || 0;
            const totalFaturado = metricsRows[0]?.total_faturado || 0;
            const taxaConversao = totalOrcamentos > 0 ? ((totalFaturado / totalOrcamentos) * 100).toFixed(2) : 0;

            // Buscar meta do vendedor
            let metaAtual = { valor: 32500, atingido: 0, percentual: 0 };
            try {
                const [metaRows] = await pool.query(`
                    SELECT valor, atingido
                    FROM metas_vendas
                    WHERE vendedor_id = ? AND MONTH(mes) = MONTH(CURDATE()) AND YEAR(mes) = YEAR(CURDATE())
                    LIMIT 1
                `, [vendedorId]);
                if (metaRows && metaRows.length > 0) {
                    metaAtual.valor = metaRows[0].valor || 32500;
                    metaAtual.atingido = metricsRows[0]?.valor_faturado || 0;
                    metaAtual.percentual = metaAtual.valor > 0 ? ((metaAtual.atingido / metaAtual.valor) * 100).toFixed(1) : 0;
                } else {
                    metaAtual.atingido = metricsRows[0]?.valor_faturado || 0;
                    metaAtual.percentual = metaAtual.valor > 0 ? ((metaAtual.atingido / metaAtual.valor) * 100).toFixed(1) : 0;
                }
            } catch (err) {
                metaAtual.atingido = metricsRows[0]?.valor_faturado || 0;
                metaAtual.percentual = metaAtual.valor > 0 ? ((metaAtual.atingido / metaAtual.valor) * 100).toFixed(1) : 0;
            }

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
    // PDF GENERATION - ORÇAMENTO PROFISSIONAL INSTITUCIONAL
    // ========================================
    const PDFDocument = require('pdfkit');

    // Rota alternativa para /imprimir (redireciona para /pdf)
    router.get('/pedidos/:id/imprimir', authenticateToken, authorizeArea('vendas'), (req, res, next) => {
        req.url = `/api/vendas/pedidos/${req.params.id}/pdf`;
        next('route');
    });

    // ============================================================
    // ORÇAMENTO HTML — template novo (public/relatorios/orcamento.html)
    // Renderiza o documento com dados reais do pedido + branding por
    // instância (BRAND/empresa). É exibido inline pelo Report Viewer
    // (que intercepta o window.open). Print -> PDF A4 pelo navegador.
    // ============================================================
    router.get('/pedidos/:id/orcamento', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { id } = req.params;

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
                       u.nome as vendedor_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE p.id = ?
            `, [id]);

            if (pedidos.length === 0) return res.status(404).send('<h1>Pedido nao encontrado</h1>');
            const pedido = pedidos[0];

            // Ownership: vendedor so visualiza os proprios pedidos
            const isAdmin = req.user && (req.user.role === 'admin' || req.user.cargo === 'admin');
            if (!isAdmin && pedido.vendedor_id && req.user && pedido.vendedor_id !== req.user.id) {
                return res.status(403).send('<h1>Acesso negado</h1>');
            }

            if (isPedidoMeiaNota(pedido)) {
                return res.redirect(302, `/api/vendas/pedidos/${encodeURIComponent(id)}/recibo`);
            }

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
            const BRAND = (process.env.BRAND || '').toLowerCase();
            const BRAND_LOGOS = {
                'labor-eletric': '/images/labor-eletric-logo.png',
                'labor-energy': '/images/labor-energy-logo.png',
                'zyntra': '/images/zyntra-sem-fundo.png'
            };
            const empresaLogo = BRAND_LOGOS[BRAND] || empresaConfig.logo_url || '/images/Logo Monocromatico - Azul - Aluforce.png';

            // Helpers
            const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const moeda = (v) => 'R$ ' + (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const numBR = (v) => (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

            // Itens + totais
            let subtotal = 0, totalDesc = 0;
            const itensTpl = itens.map((it, i) => {
                const qtd = parseFloat(it.quantidade) || 0;
                const unit = parseFloat(it.preco_unitario) || 0;
                const desc = parseFloat(it.desconto) || 0;
                const total = parseFloat(it.subtotal || it.preco_total) || (qtd * unit - desc);
                subtotal += (qtd * unit);
                totalDesc += desc;
                return {
                    num: String(i + 1).padStart(2, '0'),
                    codigo: esc(it.codigo || '—'),
                    descricao: esc(it.descricao || '—'),
                    qtd: numBR(qtd),
                    unidade: esc(it.unidade || 'UN'),
                    valor_unit: moeda(unit),
                    desconto: desc > 0 ? moeda(desc) : '—',
                    total: moeda(total)
                };
            });

            if (subtotal === 0) subtotal = parseFloat(pedido.valor) || 0;
            if (totalDesc === 0) totalDesc = parseFloat(pedido.desconto) || 0;
            const frete = parseFloat(pedido.frete) || 0;
            const ipi = parseFloat(pedido.total_ipi || pedido.ipi) || 0;
            const totalGeral = parseFloat(pedido.valor) || (subtotal - totalDesc + frete + ipi);

            const validade = pedido.data_validade
                ? fmtData(pedido.data_validade)
                : (() => { const b = pedido.created_at ? new Date(pedido.created_at) : new Date(); b.setDate(b.getDate() + 7); return b.toLocaleDateString('pt-BR'); })();

            const enderecoCliente = [pedido.cliente_endereco, pedido.cliente_bairro].filter(Boolean).join(', ');
            const cidadeCliente = [pedido.cliente_cidade, pedido.cliente_estado].filter(Boolean).join('/');
            const nomeCliente = pedido.cliente_razao_social || pedido.cliente_nome_fantasia || pedido.cliente_nome_real || pedido.cliente_nome || 'Cliente nao informado';
            const observacoes = pedido.observacao || pedido.observacoes || pedido.descricao || '';
            const condicoes = pedido.condicoes_pagamento || pedido.condicao_pagamento || pedido.forma_pagamento || (pedido.parcelas ? `${pedido.parcelas} dias` : 'A combinar');
            const prazoEntrega = pedido.prazo_entrega || pedido.previsao_entrega || 'A combinar';

            const data = {
                empresa_logo: empresaLogo,
                empresa_nome: esc(dados.nomeFantasia || 'ALUFORCE'),
                empresa_razao_social: esc(dados.nome),
                empresa_cnpj: esc(dados.cnpj),
                empresa_ie: esc(dados.inscricaoEstadual),
                empresa_endereco: esc([dados.endereco, dados.numero].filter(Boolean).join(', ') + (dados.bairro ? ' - ' + dados.bairro : '')),
                empresa_cidade: esc(`${dados.cidade}/${dados.estado} - CEP ${dados.cep}`),
                empresa_telefone: esc(dados.telefone),
                empresa_email: esc(dados.email || ''),
                empresa_site: esc(dados.site || ''),

                numero_orcamento: String(pedido.id).padStart(5, '0'),
                status: esc(statusNome),
                status_classe: statusClasse,
                data_emissao: fmtData(pedido.created_at),
                vendedor: esc(pedido.vendedor_nome || '—'),
                validade: validade,

                cliente_nome: esc(nomeCliente),
                cliente_cnpj: esc(pedido.cliente_cnpj || '—'),
                cliente_ie: esc(pedido.cliente_ie || 'Isento'),
                cliente_telefone: esc(pedido.cliente_telefone || '—'),
                cliente_email: esc(pedido.cliente_email || '—'),
                cliente_contato: esc(pedido.cliente_contato || '—'),
                cliente_endereco: esc(enderecoCliente || '—'),
                cliente_cidade: esc(cidadeCliente || '—'),
                cliente_cep: esc(pedido.cliente_cep || '—'),
                prazo_entrega: esc(prazoEntrega),

                itens: itensTpl,

                subtotal: moeda(subtotal),
                desconto: moeda(totalDesc),
                desconto_display: totalDesc > 0 ? '' : 'display:none',
                frete: moeda(frete),
                frete_display: frete > 0 ? '' : 'display:none',
                ipi: moeda(ipi),
                ipi_display: ipi > 0 ? '' : 'display:none',
                total: moeda(totalGeral),

                condicoes_pagamento: esc(condicoes),
                observacoes: esc(observacoes),
                observacoes_display: observacoes ? '' : 'display:none',

                gerado_em: new Date().toLocaleString('pt-BR')
            };

            // Renderizar o template (secoes {{#itens}}...{{/itens}} + {{chave}})
            const tplPath = resolveRelatorioTemplate(path.join(__dirname, '..'), 'orcamento.html');
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

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        } catch (err) {
            console.error('[ORCAMENTO-HTML] Erro:', err);
            return res.status(500).send('<h1>Erro ao gerar o orcamento</h1><p>' + (err.message || '') + '</p>');
        }
    });

    router.get('/pedidos/:id/pdf', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        console.log('[PDF] Gerando documento para pedido:', req.params.id);
        try {
            const { id } = req.params;

            const [pedidos] = await vendasPool.query(`
                SELECT p.*,
                       p.valor as valor_total,
                       p.descricao as observacoes_internas,
                       p.observacao as observacoes,
                       p.created_at as data_criacao,
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
                       c.contribuinte_icms as cliente_contribuinte,
                       c.transportadora as cliente_transportadora,
                       u.nome as vendedor_nome,
                       u.email as vendedor_email,
                       t.razao_social as transp_razao_social,
                       t.cnpj_cpf as transp_cnpj
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                LEFT JOIN transportadoras t ON p.transportadora_id = t.id
                WHERE p.id = ?
            `, [id]);

            if (pedidos.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

            const pedido = pedidos[0];

            // Verificar ownership: vendedor só pode gerar PDF dos seus pedidos
            const isAdmin = req.user && (req.user.role === 'admin' || req.user.cargo === 'admin');
            if (!isAdmin && pedido.vendedor_id && req.user && pedido.vendedor_id !== req.user.id) {
                return res.status(403).json({ error: 'Acesso negado: este pedido pertence a outro vendedor' });
            }

            if (isPedidoMeiaNota(pedido)) {
                return res.redirect(302, `/api/vendas/pedidos/${encodeURIComponent(id)}/recibo`);
            }

            let [itens] = await vendasPool.query(`SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC`, [id]);

            if (itens.length === 0 && pedido.produtos_preview) {
                try {
                    const preview = JSON.parse(pedido.produtos_preview);
                    if (Array.isArray(preview) && preview.length > 0) {
                        itens = preview.map(item => ({
                            codigo: item.codigo || '',
                            descricao: item.descricao || item.nome || '',
                            quantidade: parseFloat(item.quantidade) || 0,
                            unidade: item.unidade || 'UN',
                            preco_unitario: parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0,
                            desconto: parseFloat(item.desconto) || 0,
                            subtotal: parseFloat(item.total || item.subtotal) || 0
                        }));
                    }
                } catch(e) {}
            }

            const emp = {};
            try {
                const empresaConfig = await buscarConfiguracoesEmpresa(pool);
                const dadosPDF = formatarDadosParaPDF(empresaConfig);
                emp.razao = dadosPDF.nome;
                emp.cnpj = dadosPDF.cnpj;
                emp.ie = dadosPDF.inscricaoEstadual;
                emp.end = `${dadosPDF.endereco}, ${dadosPDF.numero} - ${dadosPDF.bairro}`;
                emp.cidUf = `${dadosPDF.cidade}/${dadosPDF.estado}`;
                emp.cep = dadosPDF.cep;
                emp.tel = dadosPDF.telefone;
                emp.email = dadosPDF.email || '';
            } catch (cfgErr) {
                console.error('[PDF] Erro ao buscar config empresa, usando fallback:', cfgErr.message);
                emp.razao = 'Empresa não configurada';
                emp.cnpj = '--'; emp.ie = '--';
                emp.end = '--'; emp.cidUf = '--'; emp.cep = '--';
                emp.tel = '--'; emp.email = '';
            }

            let geradoPor = 'Sistema';
            if (req.user?.id) {
                const [u] = await vendasPool.query('SELECT nome FROM usuarios WHERE id = ?', [req.user.id]);
                if (u.length > 0) geradoPor = u[0].nome;
            }

            // ========== MAPEAR STATUS PARA NOME AMIGAVEL ==========
            const statusMap = {
                'orcamento': 'Orcamento', 'em-analise': 'Em Analise', 'negociacao': 'Negociacao',
                'pedido-aprovado': 'Pedido Aprovado', 'em-producao': 'Em Producao',
                'faturado': 'Faturado', 'cancelado': 'Cancelado', 'recibo': 'Recibo',
                'entregue': 'Entregue', 'finalizado': 'Finalizado'
            };
            const statusRaw = (pedido.status || 'orcamento').toLowerCase().trim();
            const statusNome = statusMap[statusRaw] || statusRaw.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const nomeCliente = pedido.cliente_razao_social || pedido.cliente_nome_fantasia || pedido.cliente_nome_real || pedido.cliente_nome || 'Cliente';

            // ========== NOME DO ARQUIVO ==========
            const nomeArquivoCliente = nomeCliente.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
            const nomeArquivo = `${statusNome} - ${nomeArquivoCliente} - N${pedido.id}`;
            const nomeArquivoSafe = nomeArquivo.replace(/[\\/:*?"<>|]/g, '_');

            // ========== HELPERS ==========
            function moeda(v) { return 'R$ ' + (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
            function fmtData(d) { return d ? new Date(d).toLocaleDateString('pt-BR') : '--'; }

            // ========== CRIAR PDF - DOCUMENTO PROFISSIONAL A4 ==========
            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 28, bottom: 28, left: 42, right: 42 },
                autoFirstPage: true,
                bufferPages: false,
                info: { Title: nomeArquivo, Author: 'Zyntra', Creator: 'Zyntra ERP V.2', Producer: 'Zyntra', Subject: 'Proposta Comercial / Orcamento' }
            });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(nomeArquivoSafe)}.pdf"`);
            doc.pipe(res);

            // ===== PALETA POR MARCA (process.env.BRAND) =====
            const PDF_BRAND = (process.env.BRAND || '').toLowerCase();
            const BRAND_PALETTES = {
                'labor-eletric': {
                    navy: '#7D2D00', navyMid: '#A03B00', navyLight: '#C94F00',
                    gold: '#F39C12', goldDark: '#D68910', goldLight: '#F8C471',
                    logoFile: 'labor-eletric-logo.png'
                },
                'labor-energy': {
                    navy: '#0B4F30', navyMid: '#1A7A50', navyLight: '#1E8449',
                    gold: '#27AE60', goldDark: '#1E8449', goldLight: '#58D68D',
                    logoFile: 'labor-energy-logo.png'
                },
                'zyntra': {
                    navy: '#2D1B69', navyMid: '#4A2B8A', navyLight: '#5A3CA8',
                    gold: '#6C5CE7', goldDark: '#5A4BD1', goldLight: '#A29BFE',
                    logoFile: 'zyntra-sem-fundo.png'
                },
            };
            const activePalette = BRAND_PALETTES[PDF_BRAND] || {};

            const C = {
                navy:        activePalette.navy       || '#0b2842',
                navyMid:     activePalette.navyMid    || '#103758',
                navyLight:   activePalette.navyLight   || '#1a5585',
                gold:        activePalette.gold       || '#18b6c8',
                goldDark:    activePalette.goldDark   || '#139bab',
                goldLight:   activePalette.goldLight  || '#a5e8ef',
                text:       '#1A202C',
                textMid:    '#4A5568',
                textLight:  '#A0AEC0',
                bg:         '#F8F9FB',
                border:     '#CBD5E0',
                borderLight:'#E2E8F0',
                white:      '#FFFFFF',
                red:        '#C53030',
                green:      '#276749'
            };

            const ML = 42;          // margem esquerda
            const MR = 553;         // margem direita
            const MW = MR - ML;     // largura util
            const PW = 595;         // largura pagina
            const PH = 842;         // altura pagina
            let y = 0;

            // ================================================================
            //  HEADER BAND - faixa topo premium
            // ================================================================
            doc.rect(0, 0, PW, 8).fillColor(C.navy).fill();
            doc.rect(0, 8, PW, 1.5).fillColor(C.gold).fill();

            y = 20;

            // ================================================================
            //  CABECALHO - Logo | Empresa | Documento
            // ================================================================
            const empresaConfigForLogo = await buscarConfiguracoesEmpresa(pool);
            const logoFallback = activePalette.logoFile
                ? path.join(__dirname, '..', 'public', 'images', activePalette.logoFile)
                : path.join(__dirname, '..', 'public', 'images', 'Logo Monocromatico - Azul - Aluforce.png');
            const logoPath = resolverCaminhoLogo(empresaConfigForLogo, path.join(__dirname, '..', 'public'))
                          || logoFallback;
            if (fs.existsSync(logoPath)) {
                try { doc.image(logoPath, ML, y, { width: 70 }); } catch(e) {}
            }

            // Dados da empresa
            const exL = ML + 78;
            doc.fontSize(6.8).fillColor(C.navy).font('Helvetica-Bold')
               .text(emp.razao, exL, y + 2, { width: 260 });
            doc.fontSize(5.5).fillColor(C.textMid).font('Helvetica')
               .text(`CNPJ: ${emp.cnpj}  |  IE: ${emp.ie}`, exL, y + 18)
               .text(`${emp.end} - ${emp.cidUf} - CEP: ${emp.cep}`, exL, y + 26)
               .text(`${emp.tel}  |  ${emp.email}`, exL, y + 34);

            // ---- Caixa tipo documento (lado direito) ----
            const dbW = 138;
            const dbX = MR - dbW;
            const dbH = 44;
            // Sombra sutil
            doc.roundedRect(dbX + 1, y, dbW, dbH, 4).fillColor('#E2E8F0').fill();
            // Caixa principal
            doc.roundedRect(dbX, y - 1, dbW, dbH, 4).fillColor(C.navy).fill();
            // Borda dourada superior da caixa
            doc.roundedRect(dbX, y - 1, dbW, 4, 4).fillColor(C.gold).fill();
            doc.rect(dbX, y + 1, dbW, 2).fillColor(C.gold).fill();

            doc.fontSize(9.5).fillColor(C.white).font('Helvetica-Bold')
               .text(statusNome.toUpperCase(), dbX, y + 8, { width: dbW, align: 'center' });
            doc.fontSize(18).fillColor(C.gold).font('Helvetica-Bold')
               .text(`N. ${pedido.id}`, dbX, y + 21, { width: dbW, align: 'center' });

            y += 52;

            // Separador dourado duplo
            doc.moveTo(ML, y).lineTo(MR, y).strokeColor(C.gold).lineWidth(1.5).stroke();
            doc.moveTo(ML, y + 3).lineTo(MR, y + 3).strokeColor(C.borderLight).lineWidth(0.3).stroke();
            y += 9;

            // ================================================================
            //  BARRA DE METADADOS
            // ================================================================
            const metaH = 24;
            // Fundo com borda
            doc.rect(ML, y, MW, metaH).fillColor(C.bg).fill();
            doc.rect(ML, y, MW, metaH).strokeColor(C.border).lineWidth(0.3).stroke();

            const dataValidade = new Date(pedido.created_at);
            dataValidade.setDate(dataValidade.getDate() + 15);

            const metaFields = [
                { label: 'EMISSAO',   value: fmtData(pedido.created_at) },
                { label: 'VENDEDOR',  value: pedido.vendedor_nome || '--' },
                { label: 'VALIDADE',  value: fmtData(dataValidade) },
                { label: 'STATUS',    value: statusNome.toUpperCase() }
            ];

            const mColW = MW / 4;
            metaFields.forEach((f, i) => {
                const fx = ML + mColW * i + 12;
                doc.fontSize(5).fillColor(C.textLight).font('Helvetica-Bold')
                   .text(f.label, fx, y + 4);
                doc.fontSize(7).fillColor(C.text).font('Helvetica')
                   .text(f.value, fx, y + 13);
                // Divisor vertical
                if (i > 0) {
                    doc.moveTo(ML + mColW * i, y + 5)
                       .lineTo(ML + mColW * i, y + metaH - 5)
                       .strokeColor(C.border).lineWidth(0.3).stroke();
                }
            });
            y += metaH + 7;

            // ================================================================
            //  DADOS DO CLIENTE
            // ================================================================
            // Titulo com icone visual (barra lateral dourada)
            doc.rect(ML, y, 3, 15).fillColor(C.gold).fill();
            doc.rect(ML + 3, y, MW - 3, 15).fillColor(C.navyMid).fill();
            doc.fontSize(7).fillColor(C.white).font('Helvetica-Bold')
               .text('DADOS DO CLIENTE', ML + 14, y + 4);
            y += 15;

            // Montar endereco completo
            const endParts = [pedido.cliente_endereco, pedido.cliente_bairro].filter(Boolean);
            const cidParts = [pedido.cliente_cidade, pedido.cliente_estado].filter(Boolean);
            let endCompleto = endParts.join(', ');
            if (cidParts.length > 0) endCompleto += (endCompleto ? ' - ' : '') + cidParts.join('/');

            // Box cliente com borda esquerda dourada sutil
            const cliH = 50;
            doc.rect(ML, y, MW, cliH).fillColor(C.white).fill();
            doc.rect(ML, y, MW, cliH).strokeColor(C.border).lineWidth(0.4).stroke();
            doc.rect(ML, y, 2, cliH).fillColor(C.goldLight).fill();

            // Razao Social em destaque
            doc.fontSize(8.5).fillColor(C.navy).font('Helvetica-Bold')
               .text(nomeCliente, ML + 12, y + 5, { width: MW - 24 });

            // Linha divisoria elegante
            doc.moveTo(ML + 12, y + 16).lineTo(MR - 12, y + 16)
               .strokeColor(C.borderLight).lineWidth(0.3).stroke();

            // Campos em grid 2 colunas
            const c1 = ML + 12;
            const c2 = ML + MW / 2 + 8;
            const lbW = 60;
            const v1W = MW / 2 - lbW - 20;
            const v2W = MW / 2 - lbW - 16;

            function campo(label, valor, cx, cy, vw) {
                doc.fontSize(5.8).fillColor(C.textMid).font('Helvetica-Bold')
                   .text(label, cx, cy, { width: lbW });
                doc.fontSize(6.2).fillColor(C.text).font('Helvetica')
                   .text(valor || '--', cx + lbW, cy, { width: vw || v1W, lineBreak: false });
            }

            campo('CNPJ/CPF:', pedido.cliente_cnpj, c1, y + 21);
            campo('IE:', pedido.cliente_ie || 'Isento', c2, y + 21, v2W);
            campo('Endereco:', endCompleto || '--', c1, y + 30, MW - lbW - 24);
            campo('Telefone:', pedido.cliente_telefone, c1, y + 39);
            campo('CEP:', pedido.cliente_cep, c2, y + 39, v2W);

            y += cliH + 6;

            // ================================================================
            //  TABELA DE ITENS
            // ================================================================
            // Titulo
            doc.rect(ML, y, 3, 15).fillColor(C.gold).fill();
            doc.rect(ML + 3, y, MW - 3, 15).fillColor(C.navyMid).fill();
            doc.fontSize(7).fillColor(C.white).font('Helvetica-Bold')
               .text('ITENS DO ORCAMENTO', ML + 14, y + 4);
            doc.fontSize(6.5).fillColor(C.goldLight).font('Helvetica-Bold')
               .text(`${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`, MR - 70, y + 4, { width: 58, align: 'right' });
            y += 15;

            // ---- Cabecalho da tabela ----
            const thH = 15;
            doc.rect(ML, y, MW, thH).fillColor(C.navy).fill();

            const col = {
                n:    { x: ML,        w: 22 },
                cod:  { x: ML + 22,   w: 70 },
                desc: { x: ML + 92,   w: 195 },
                qtd:  { x: ML + 287,  w: 44 },
                un:   { x: ML + 331,  w: 28 },
                vlr:  { x: ML + 359,  w: 62 },
                dsc:  { x: ML + 421,  w: 48 },
                tot:  { x: ML + 469,  w: 42 }
            };

            const thY = y + 4.5;
            doc.fontSize(5.8).fillColor(C.white).font('Helvetica-Bold');
            doc.text('#',          col.n.x + 2,   thY, { width: col.n.w,    align: 'center' });
            doc.text('CODIGO',     col.cod.x + 4,  thY, { width: col.cod.w });
            doc.text('DESCRICAO',  col.desc.x + 4, thY, { width: col.desc.w });
            doc.text('QTD',        col.qtd.x,       thY, { width: col.qtd.w,  align: 'center' });
            doc.text('UN',         col.un.x,        thY, { width: col.un.w,   align: 'center' });
            doc.text('VLR. UNIT.', col.vlr.x,       thY, { width: col.vlr.w,  align: 'right' });
            doc.text('DESC.',      col.dsc.x,       thY, { width: col.dsc.w,  align: 'right' });
            doc.text('TOTAL',      col.tot.x,       thY, { width: col.tot.w,  align: 'right' });
            y += thH;

            // ---- Linhas dos itens ----
            let totalProdutos = 0, totalDescontos = 0;
            const rowH = itens.length > 20 ? 10 : itens.length > 12 ? 11 : 13;

            if (itens.length > 0) {
                itens.forEach((item, idx) => {
                    const isEven = idx % 2 === 0;
                    doc.rect(ML, y, MW, rowH).fillColor(isEven ? C.white : C.bg).fill();
                    // Linhas horizontais suaves
                    doc.moveTo(ML, y + rowH).lineTo(MR, y + rowH).strokeColor(C.borderLight).lineWidth(0.15).stroke();

                    const qtd = parseFloat(item.quantidade) || 0;
                    const unit = parseFloat(item.preco_unitario) || 0;
                    const desc = parseFloat(item.desconto) || 0;
                    const tot = (qtd * unit) - desc;
                    totalProdutos += (qtd * unit);
                    totalDescontos += desc;

                    const fs = rowH <= 10 ? 5.2 : rowH <= 11 ? 5.5 : 6;
                    const ty = y + (rowH - 6) / 2;

                    doc.fontSize(fs).fillColor(C.textLight).font('Helvetica')
                       .text(String(idx + 1).padStart(2, '0'), col.n.x + 2, ty, { width: col.n.w, align: 'center' });
                    doc.fillColor(C.navy).font('Helvetica-Bold')
                       .text(item.codigo || '--', col.cod.x + 4, ty, { width: col.cod.w - 4, lineBreak: false });
                    doc.fillColor(C.text).font('Helvetica')
                       .text((item.descricao || '').substring(0, 50), col.desc.x + 4, ty, { width: col.desc.w - 4, lineBreak: false });
                    doc.text(qtd.toLocaleString('pt-BR'), col.qtd.x, ty, { width: col.qtd.w, align: 'center' });
                    doc.fillColor(C.textLight).text(item.unidade || 'UN', col.un.x, ty, { width: col.un.w, align: 'center' });
                    doc.fillColor(C.text).text(moeda(unit).replace('R$ ', ''), col.vlr.x, ty, { width: col.vlr.w, align: 'right' });
                    doc.fillColor(desc > 0 ? C.red : C.textLight)
                       .text(desc > 0 ? moeda(desc).replace('R$ ', '') : '\u2014', col.dsc.x, ty, { width: col.dsc.w, align: 'right' });
                    doc.fillColor(C.navy).font('Helvetica-Bold')
                       .text(moeda(tot).replace('R$ ', ''), col.tot.x, ty, { width: col.tot.w, align: 'right' });

                    y += rowH;
                });
            } else {
                doc.rect(ML, y, MW, 20).fillColor(C.white).fill();
                doc.rect(ML, y, MW, 20).strokeColor(C.border).lineWidth(0.3).stroke();
                doc.fontSize(6.5).fillColor(C.textLight).font('Helvetica')
                   .text('Nenhum item adicionado a este orcamento.', ML + 12, y + 7);
                y += 20;
            }

            // Borda inferior da tabela
            doc.moveTo(ML, y).lineTo(MR, y).strokeColor(C.navy).lineWidth(0.8).stroke();
            y += 2;

            // ================================================================
            //  RESUMO FINANCEIRO
            // ================================================================
            const frete = parseFloat(pedido.frete) || 0;
            const ipi = parseFloat(pedido.total_ipi) || 0;
            const totalGeral = totalProdutos - totalDescontos + frete + ipi;
            const valorFinal = totalGeral > 0 ? totalGeral : (parseFloat(pedido.valor_total) || 0);

            // Resumo de valores lado a lado com box total
            const resumoW = 210;
            const resumoX = MR - resumoW;
            let rY = y + 2;

            // Subtotal
            doc.fontSize(6).fillColor(C.textMid).font('Helvetica')
               .text('Subtotal:', resumoX, rY, { width: 80, align: 'right' });
            doc.fillColor(C.text).font('Helvetica')
               .text(moeda(totalProdutos), resumoX + 85, rY, { width: resumoW - 85, align: 'right' });
            rY += 9;

            if (totalDescontos > 0) {
                doc.fillColor(C.textMid).font('Helvetica').text('Descontos:', resumoX, rY, { width: 80, align: 'right' });
                doc.fillColor(C.red).font('Helvetica').text('- ' + moeda(totalDescontos), resumoX + 85, rY, { width: resumoW - 85, align: 'right' });
                rY += 9;
            }
            if (frete > 0) {
                doc.fillColor(C.textMid).font('Helvetica').text('Frete:', resumoX, rY, { width: 80, align: 'right' });
                doc.fillColor(C.text).font('Helvetica').text(moeda(frete), resumoX + 85, rY, { width: resumoW - 85, align: 'right' });
                rY += 9;
            }
            if (ipi > 0) {
                doc.fillColor(C.textMid).font('Helvetica').text('IPI:', resumoX, rY, { width: 80, align: 'right' });
                doc.fillColor(C.text).font('Helvetica').text(moeda(ipi), resumoX + 85, rY, { width: resumoW - 85, align: 'right' });
                rY += 9;
            }

            // Linha separadora
            rY += 1;
            doc.moveTo(resumoX, rY).lineTo(MR, rY).strokeColor(C.gold).lineWidth(1).stroke();
            rY += 4;

            // TOTAL em destaque
            doc.rect(resumoX - 5, rY - 2, resumoW + 5, 22).fillColor(C.navy).fill();
            // Barra dourada lateral
            doc.rect(resumoX - 5, rY - 2, 3, 22).fillColor(C.gold).fill();

            doc.fontSize(9).fillColor(C.white).font('Helvetica-Bold')
               .text('TOTAL:', resumoX + 8, rY + 4, { width: 55 });
            doc.fontSize(12).fillColor(C.gold).font('Helvetica-Bold')
               .text(moeda(valorFinal), resumoX + 60, rY + 2, { width: resumoW - 65, align: 'right' });

            y = rY + 28;

            // ================================================================
            //  CONDICOES COMERCIAIS
            // ================================================================
            doc.rect(ML, y, 3, 15).fillColor(C.gold).fill();
            doc.rect(ML + 3, y, MW - 3, 15).fillColor(C.navyMid).fill();
            doc.fontSize(7).fillColor(C.white).font('Helvetica-Bold')
               .text('CONDICOES COMERCIAIS', ML + 14, y + 4);
            y += 15;

            const condicaoPag = pedido.condicao_pagamento || pedido.condicoes_pagamento || '--';
            const transportadora = pedido.transportadora_nome || pedido.transp_razao_social || pedido.cliente_transportadora || '--';
            const freteMapPdf = { '0': 'CIF (Remetente)', '1': 'FOB (Destinatario)', 'CIF': 'CIF (Remetente)', 'FOB': 'FOB (Destinatario)' };
            const tipoFrete = freteMapPdf[String(pedido.tipo_frete)] || pedido.tipo_frete || '--';

            const condH = 24;
            doc.rect(ML, y, MW, condH).fillColor(C.white).fill();
            doc.rect(ML, y, MW, condH).strokeColor(C.border).lineWidth(0.4).stroke();
            doc.rect(ML, y, 2, condH).fillColor(C.goldLight).fill();

            campo('Pagamento:', condicaoPag, c1, y + 4);
            campo('Frete:', tipoFrete, c2, y + 4, v2W);
            campo('Transportadora:', transportadora, c1, y + 14);
            campo('Prazo:', pedido.prazo_entrega || 'A combinar', c2, y + 14, v2W);

            y += condH + 5;

            // ================================================================
            //  OBSERVACOES (condicional)
            // ================================================================
            const obsTexto = pedido.observacoes || pedido.observacoes_internas || '';
            if (obsTexto.trim()) {
                doc.rect(ML, y, 3, 15).fillColor(C.gold).fill();
                doc.rect(ML + 3, y, MW - 3, 15).fillColor(C.navyMid).fill();
                doc.fontSize(7).fillColor(C.white).font('Helvetica-Bold')
                   .text('OBSERVACOES', ML + 14, y + 4);
                y += 15;

                const obsH = Math.min(32, Math.max(16, Math.ceil(obsTexto.length / 110) * 9 + 8));
                doc.rect(ML, y, MW, obsH).fillColor(C.white).fill();
                doc.rect(ML, y, MW, obsH).strokeColor(C.border).lineWidth(0.4).stroke();
                doc.rect(ML, y, 2, obsH).fillColor(C.goldLight).fill();
                doc.fontSize(6).fillColor(C.text).font('Helvetica')
                   .text(obsTexto, ML + 12, y + 5, { width: MW - 24, lineBreak: true });
                y += obsH + 5;
            }

            // ================================================================
            //  TERMOS E CONDICOES
            // ================================================================
            // Caixa cinza com termos
            const termosH = 16;
            doc.rect(ML, y, MW, termosH).fillColor(C.bg).fill();
            doc.rect(ML, y, MW, termosH).strokeColor(C.borderLight).lineWidth(0.3).stroke();
            doc.fontSize(4.8).fillColor(C.textLight).font('Helvetica')
               .text('Orcamento valido por 15 dias  |  Precos sujeitos a alteracao apos a validade  |  Prazo de entrega apos confirmacao do pedido  |  Documento sem valor fiscal',
                     ML + 8, y + 5, { width: MW - 16, align: 'center' });
            y += termosH + 6;

            // ================================================================
            //  ASSINATURAS
            // ================================================================
            // Posicionar inteligentemente - minimo depois do conteudo, maximo antes do footer
            const footerStart = 790;
            const assSpace = 35;
            const assY = Math.min(Math.max(y + 8, 690), footerStart - assSpace - 10);

            // Assinatura Cliente (esquerda)
            doc.moveTo(ML + 15, assY).lineTo(ML + 230, assY)
               .strokeColor(C.navy).lineWidth(0.6).stroke();
            doc.fontSize(5.5).fillColor(C.textMid).font('Helvetica')
               .text('Assinatura / Carimbo do Cliente', ML + 15, assY + 4, { width: 215, align: 'center' });

            // Assinatura Vendedor (direita)
            doc.moveTo(MR - 230, assY).lineTo(MR - 15, assY)
               .strokeColor(C.navy).lineWidth(0.6).stroke();
            doc.fontSize(5.5).fillColor(C.textMid).font('Helvetica')
               .text('Assinatura do Vendedor', MR - 230, assY + 4, { width: 215, align: 'center' });

            // ================================================================
            //  RODAPE INSTITUCIONAL
            // ================================================================
            const fY = footerStart;
            // Filete dourado
            doc.rect(0, fY, PW, 2).fillColor(C.gold).fill();
            // Barra navy
            doc.rect(0, fY + 2, PW, 50).fillColor(C.navy).fill();

            doc.fontSize(5.2).fillColor('#7A8FA3').font('Helvetica')
               .text(`Documento gerado em ${new Date().toLocaleString('pt-BR')} por ${geradoPor}`, ML, fY + 8, { width: MW, align: 'center' });
            doc.fontSize(4.5).fillColor('#5B6E82')
               .text(`${nomeArquivo}`, ML, fY + 17, { width: MW, align: 'center' });
            doc.fontSize(4.2).fillColor('#4A5D71')
               .text('Zyntra ERP  |  Sistema de Gestão Empresarial V.2  |  Documento sem valor fiscal', ML, fY + 25, { width: MW, align: 'center' });

            doc.end();
            console.log('[PDF] Documento gerado: ' + nomeArquivo);

        } catch (error) {
            console.error('[PDF] Erro:', error);
            res.status(500).json({ success: false, message: 'Erro ao gerar PDF', error: 'Erro interno no servidor. Tente novamente.' });
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

            // Gerar numero_pedido sequencial
            const [[npRow]] = await connection.query('SELECT COALESCE(MAX(numero_pedido), 0) + 1 AS next_num FROM pedidos');
            const numeroPedido = npRow.next_num || 1;

            const [result] = await connection.query(`
                INSERT INTO pedidos
                (cliente_id, empresa_id, vendedor_id, valor, descricao, status,
                 numero_pedido, frete, prioridade, produtos_preview, prazo_entrega, endereco_entrega,
                 municipio_entrega, metodo_envio, parcelas, condicao_pagamento, condicoes_pagamento,
                 cliente_nome, vendedor_nome, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                cliente_id, empresaIdFinal, vendedor_id, valor || 0, descricao || '',
                status, numeroPedido, frete, prioridade, JSON.stringify(produtos || []),
                prazo_entrega, endereco_entrega, municipio_entrega, metodo_envio,
                condicaoCodigo, condicaoCodigo, formatarDescricaoCondicaoPagamento(condicaoCodigo),
                clienteNome, vendedorNome
            ]);

            const pedidoId = result.insertId;

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

            // Inserir itens na tabela pedido_itens (dentro da mesma transação)
            if (produtosData.length > 0) {
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
                const userEmail = (req.user && req.user.email || '').toLowerCase();
                if (userEmail !== 'ti@aluforce.ind.br') {
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
            let query = 'SELECT id, nome, razao_social, nome_fantasia, cnpj, cnpj_cpf, cpf, contato, email, telefone, cidade, estado, uf, vendedor_responsavel, ativo, data_criacao FROM clientes';
            const params = [];

            if (search) {
                query += ' WHERE nome LIKE ? OR razao_social LIKE ? OR email LIKE ? OR telefone LIKE ? OR cnpj_cpf LIKE ?';
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
            }

            query += ' ORDER BY nome LIMIT ?';
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

            const [result] = await vendasPool.query(`
                INSERT INTO clientes (nome, email, telefone, cpf, endereco, data_criacao)
                VALUES (?, ?, ?, ?, ?, NOW())
            `, [nome, email, telefone, cpf, endereco]);

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

            if (!periodo) {
                return res.status(400).json({ message: 'Período é obrigatório' });
            }

            const [vendedores] = await vendasPool.query(`
                SELECT u.id, u.nome FROM usuarios u
                LEFT JOIN departamentos d ON u.departamento_id = d.id
                WHERE d.nome = 'Comercial' AND u.status = 'ativo'
            `);

            let criadas = 0;
            let atualizadas = 0;

            for (const vendedor of vendedores) {
                const metaIndividual = metas_individuais?.find(m => m.vendedor_id === vendedor.id);
                const valorMeta = metaIndividual ? metaIndividual.valor_meta : valor_meta_padrao;

                if (!valorMeta) continue;

                const [existing] = await vendasPool.query(
                    'SELECT id FROM metas_vendas WHERE vendedor_id = ? AND periodo = ?',
                    [vendedor.id, periodo]
                );

                if (existing.length > 0) {
                    await vendasPool.query('UPDATE metas_vendas SET valor_meta = ? WHERE id = ?', [parseFloat(valorMeta), existing[0].id]);
                    atualizadas++;
                } else {
                    await vendasPool.query(
                        'INSERT INTO metas_vendas (vendedor_id, periodo, tipo, valor_meta) VALUES (?, ?, ?, ?)',
                        [vendedor.id, periodo, 'mensal', parseFloat(valorMeta)]
                    );
                    criadas++;
                }
            }

            res.json({
                message: `Metas processadas: ${criadas} criadas, ${atualizadas} atualizadas`,
                total_vendedores: vendedores.length,
                criadas,
                atualizadas
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
    router.get('/kanban/pedidos', authenticateToken, async (req, res) => {
        try {
            const {
                dataInclusao, dataPrevisao, dataFaturamento,
                vendedor, projeto,
                exibirCancelados = 'false',
                exibirDenegados  = 'false',
                exibirEncerrados = 'false'
            } = req.query;

            const where  = [];
            const params = [];

            const excluidos = [];
            if (exibirCancelados !== 'true')  excluidos.push("'cancelado'", "'cancelada'");
            if (exibirDenegados  !== 'true')  excluidos.push("'denegado'",  "'negado'");
            if (exibirEncerrados !== 'true')  excluidos.push("'encerrado'");
            if (excluidos.length) {
                where.push('LOWER(COALESCE(p.status,\'\')) NOT IN (' + excluidos.join(',') + ')');
            }

            if (dataInclusao && dataInclusao !== 'tudo') {
                where.push('p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)');
                params.push(parseInt(dataInclusao) || 30);
            }
            if (dataPrevisao && dataPrevisao !== 'tudo') {
                where.push('COALESCE(p.data_previsao, p.data_prevista) <= DATE_ADD(NOW(), INTERVAL ? DAY)');
                params.push(parseInt(dataPrevisao) || 30);
            }
            if (dataFaturamento && dataFaturamento !== 'tudo') {
                where.push('p.data_faturamento >= DATE_SUB(NOW(), INTERVAL ? DAY)');
                params.push(parseInt(dataFaturamento) || 30);
            }
            if (vendedor && vendedor !== 'todos') { where.push('p.vendedor_id = ?'); params.push(vendedor); }
            if (projeto && projeto !== 'todos')   { where.push('p.projeto_id = ?'); params.push(projeto); }

            // Escopo por vendedor: não-admin vê apenas os SEUS pedidos (igual à lista /pedidos,
            // usando idx_pedidos_vendedor_status). Garante que representantes — cujos pedidos
            // REPRESENTANTE têm vendedor_id vinculado — vejam só os deles também no kanban.
            // EXCEÇÃO: PCP (produção) fatura pedidos de toda a equipe → vê TODOS os pedidos.
            const _kanbanRole = String(req.user?.role || '').toLowerCase().trim();
            const _kanbanEmail = String(req.user?.email || '').toLowerCase().trim();
            const _kanbanIsPcp = _kanbanRole === 'pcp' || _kanbanRole === 'producao'
                || _kanbanRole === 'produção' || _kanbanEmail.startsWith('pcp@');
            const _kanbanIsAdmin = req.user?.is_admin === true || req.user?.is_admin === 1
                || _kanbanRole === 'admin';
            const _kanbanVeTudo = _kanbanIsAdmin || _kanbanIsPcp;
            if (!_kanbanVeTudo && req.user?.id) { where.push('p.vendedor_id = ?'); params.push(req.user.id); }

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
                    COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, '') AS cliente_nome,
                    COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, '') AS cliente,
                    COALESCE(c.cnpj, c.cpf, '') AS cliente_cnpj,
                    p.empresa_id, p.vendedor_id,
                    COALESCE(v.nome, vu.nome, p.vendedor_nome, uc.nome, '') AS vendedor_nome,
                    p.transportadora_id,
                    COALESCE(t.nome_fantasia, t.razao_social, p.transportadora_nome, '') AS transportadora_nome
                FROM pedidos p
                LEFT JOIN clientes       c ON c.id = p.cliente_id
                LEFT JOIN vendedores     v  ON v.id = p.vendedor_id
                LEFT JOIN usuarios       vu ON vu.id = p.vendedor_id
                LEFT JOIN usuarios       uc ON uc.id = p.usuario_id
                LEFT JOIN transportadoras t ON t.id = p.transportadora_id
                ${whereClause}
                ORDER BY p.created_at DESC
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
