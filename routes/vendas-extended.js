/**
 * VENDAS EXTENDED ROUTES - Extracted from server.js (Lines 25776-27054)
 * Dashboard admin/vendedor, top-vendedores, pedidos, relatorios
 * NOTE: Uses separate vendasPool connecting to aluforce_vendas database
 * @module routes/vendas-extended
 */
const express = require('express');
const mysql = require('mysql2/promise');

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

    // Separate pool for vendas database
    let vendasPool;
    try {
        vendasPool = mysql.createPool(VENDAS_DB_CONFIG || {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER || 'aluforce',
            password: process.env.DB_PASSWORD || '',
            database: 'aluforce_vendas',
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
    router.get('/dashboard/admin', authorizeArea('vendas'), cacheMiddleware('vendas_dash_admin', CACHE_CONFIG.dashboardVendas), async (req, res) => {
        try {
            const [results] = await vendasPool.query(`
                SELECT
                    COUNT(p.id) as total_pedidos,
                    SUM(CASE WHEN p.status = 'convertido' THEN 1 ELSE 0 END) as total_vendas,
                    SUM(CASE WHEN p.status = 'convertido' THEN p.valor_total ELSE 0 END) as faturamento_total,
                    COUNT(DISTINCT p.cliente_id) as total_clientes,
                    COUNT(DISTINCT p.empresa_id) as total_empresas
                FROM pedidos p
                WHERE p.data_criacao >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            `);
            res.json(results[0]);
        } catch (error) {
            console.error('Erro dashboard vendas:', error);
            res.status(500).json({ error: 'Erro ao carregar dashboard' });
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
                    COUNT(CASE WHEN status = 'orçamento' THEN 1 END) as total_orcamentos,
                    SUM(CASE WHEN status = 'orçamento' THEN valor ELSE 0 END) as valor_orcamentos,
                    COUNT(CASE WHEN status = 'analise' THEN 1 END) as total_analise,
                    COUNT(CASE WHEN status = 'cancelado' THEN 1 END) as total_cancelado,
                    COUNT(*) as total_pedidos,
                    AVG(valor) as ticket_medio
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
                    COUNT(p.id) as vendas,
                    COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END), 0) AS valor
                 GROUP BY u.id, u.nome
                 ORDER BY valor DESC
                 LIMIT ?`,
                 [periodDays, limit]
            );
            res.json(rows.map(r => ({
                id: r.id,
                nome: r.nome,
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
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome, 'Cliente não informado') as cliente_nome,
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
    
            const emp = {
                razao: 'I. M. DOS REIS - ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES',
                cnpj: '08.192.479/0001-60', ie: '103.385.861-110',
                end: 'Rua Ernestina, 270 - Vila Sao Joao',
                cidUf: 'Ferraz de Vasconcelos/SP', cep: '08527-400',
                tel: '(11) 94723-8729', email: 'contato@aluforce.com.br'
            };
    
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
                info: { Title: nomeArquivo, Author: 'ALUFORCE', Creator: 'ALUFORCE ERP V.2', Producer: 'ALUFORCE', Subject: 'Proposta Comercial / Orcamento' }
            });
    
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(nomeArquivoSafe)}.pdf"`);
            doc.pipe(res);
    
            // ===== PALETA CORPORATIVA PREMIUM =====
            const C = {
                navy:       '#0A1929',    // azul marinho profundo
                navyMid:    '#132F4C',    // azul medio
                navyLight:  '#1E4976',    // azul claro
                gold:       '#C8A951',    // dourado principal
                goldDark:   '#9E8234',    // dourado escuro
                goldLight:  '#E8D48B',    // dourado claro
                text:       '#1A202C',    // texto principal
                textMid:    '#4A5568',    // texto secundario
                textLight:  '#A0AEC0',    // texto suave
                bg:         '#F8F9FB',    // fundo alternado
                border:     '#CBD5E0',    // borda
                borderLight:'#E2E8F0',    // borda suave
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
            // Faixa azul marinho grossa
            doc.rect(0, 0, PW, 8).fillColor(C.navy).fill();
            // Filete dourado elegante
            doc.rect(0, 8, PW, 1.5).fillColor(C.gold).fill();
    
            y = 20;
    
            // ================================================================
            //  CABECALHO - Logo | Empresa | Documento
            // ================================================================
            const logoPath = path.join(__dirname, '..', 'public', 'images', 'Logo Monocromatico - Azul - Aluforce.png');
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
               .text('ORCAMENTO', dbX, y + 8, { width: dbW, align: 'center' });
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
            const tipoFrete = pedido.tipo_frete === 'CIF' ? 'CIF (Remetente)' : pedido.tipo_frete === 'FOB' ? 'FOB (Destinatario)' : pedido.tipo_frete || '--';
    
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
               .text('ALUFORCE - Industria e Comercio de Condutores  |  Sistema de Gestao Empresarial V.2  |  Documento sem valor fiscal', ML, fY + 25, { width: MW, align: 'center' });
    
            doc.end();
            console.log('[PDF] Documento gerado: ' + nomeArquivo);
    
        } catch (error) {
            console.error('[PDF] Erro:', error);
            res.status(500).json({ success: false, message: 'Erro ao gerar PDF', error: error.message });
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
                       c.nome as cliente_nome, c.email as cliente_email, c.telefone as cliente_telefone,
                       c.cnpj as cliente_cnpj, c.endereco as cliente_endereco,
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
                prazo_entrega, endereco_entrega, municipio_entrega, metodo_envio
            } = req.body;
            const vendedor_id = req.user.id;
    
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
                 frete, prioridade, produtos_preview, prazo_entrega, endereco_entrega,
                 municipio_entrega, metodo_envio, cliente_nome, vendedor_nome, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                cliente_id, empresaIdFinal, vendedor_id, valor || 0, descricao || '',
                status, frete, prioridade, JSON.stringify(produtos || []),
                prazo_entrega, endereco_entrega, municipio_entrega, metodo_envio,
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
    
    // Alias para /api/vendas/pedidos/novo -> cria novo pedido com itens
    router.post('/pedidos/novo', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const {
                cliente_id, empresa_id, produtos, valor, descricao,
                status = 'orcamento', frete = 0, prioridade = 'normal',
                prazo_entrega, endereco_entrega, municipio_entrega, metodo_envio,
                parcelas, condicao_pagamento, cenario_fiscal, observacao, itens
            } = req.body;
            const vendedor_id = req.user.id;
    
            // Usar itens se disponivel, senao produtos
            const produtosData = itens || produtos || [];
    
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
                 frete, prioridade, produtos_preview, prazo_entrega, endereco_entrega,
                 municipio_entrega, metodo_envio, parcelas, condicao_pagamento,
                 cenario_fiscal, observacao, cliente_nome, vendedor_nome, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                cliente_id || null, empresaIdFinal, vendedor_id, valor || 0, descricao || 'Novo Orçamento',
                status, frete, prioridade, JSON.stringify(produtosData),
                prazo_entrega || null, endereco_entrega || null, municipio_entrega || null, metodo_envio || null,
                parcelas ? JSON.stringify(parcelas) : null, condicao_pagamento || null,
                cenario_fiscal || null, observacao || null,
                clienteNome, vendedorNome
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
            const {
                cliente_id, empresa_id, produtos, valor, descricao, status,
                frete, prioridade, prazo_entrega, endereco_entrega,
                municipio_entrega, metodo_envio, observacao
            } = req.body;
    
            // Construir query dinâmica apenas com campos fornecidos
            const updates = [];
            const params = [];
    
            if (cliente_id !== undefined) { updates.push('cliente_id = ?'); params.push(cliente_id); }
            if (empresa_id !== undefined) { updates.push('empresa_id = ?'); params.push(empresa_id); }
            if (valor !== undefined) { updates.push('valor = ?'); params.push(valor); }
            if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }
            if (observacao !== undefined) { updates.push('observacao = ?'); params.push(observacao); }
            if (status !== undefined) { updates.push('status = ?'); params.push(status); }
            if (frete !== undefined) { updates.push('frete = ?'); params.push(frete); }
            if (prioridade !== undefined) { updates.push('prioridade = ?'); params.push(prioridade); }
            if (prazo_entrega !== undefined) { updates.push('prazo_entrega = ?'); params.push(prazo_entrega); }
            if (endereco_entrega !== undefined) { updates.push('endereco_entrega = ?'); params.push(endereco_entrega); }
            if (municipio_entrega !== undefined) { updates.push('municipio_entrega = ?'); params.push(municipio_entrega); }
            if (metodo_envio !== undefined) { updates.push('metodo_envio = ?'); params.push(metodo_envio); }
            if (produtos !== undefined) { updates.push('produtos_preview = ?'); params.push(JSON.stringify(produtos)); }
    
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
            let query = 'SELECT id, nome, razao_social, nome_fantasia, cnpj, cnpj_cpf, email, telefone, celular, cidade, estado, vendedor_responsavel, vendedor_id, status, ativo FROM clientes';
            const params = [];
    
            if (search) {
                query += ' WHERE nome LIKE ? OR email LIKE ? OR telefone LIKE ?';
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm);
            }
    
            query += ' ORDER BY nome LIMIT 100';
    
            const [clientes] = await vendasPool.query(query, params);
            res.json(clientes);
        } catch (error) {
            console.error('Erro ao listar clientes:', error);
            res.status(500).json({ error: 'Erro ao listar clientes' });
        }
    });
    
    router.get('/clientes/:id', authorizeArea('vendas'), async (req, res) => {
        try {
            const { id } = req.params;
            const [clientes] = await vendasPool.query('SELECT * FROM clientes WHERE id = ?', [id]);
    
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
            const months = Math.max(parseInt(req.query.months || '12'), 1);
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
            const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;

            const [rows] = await vendasPool.query(
                `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, 
                 COALESCE(SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS total
                 FROM pedidos
                 WHERE created_at >= ?
                 GROUP BY ym
                 ORDER BY ym ASC`,
                [startStr]
            );

            const map = new Map();
            for (const r of rows) map.set(r.ym, Number(r.total || 0));

            const labels = [];
            const values = [];
            for (let i = 0; i < months; i++) {
                const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
                const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                labels.push(d.toLocaleString('pt-BR', { month: 'short', year: 'numeric' }));
                values.push(map.has(ym) ? map.get(ym) : 0);
            }
            res.json({ labels, values });
        } catch (err) { next(err); }
    });

    // ========================================
    // RELATÓRIOS PDF
    // ========================================
    function criarPdfRelatorio(titulo, colunas, linhas, filtrosTexto) {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
        const buffers = [];
        doc.on('data', b => buffers.push(b));

        doc.fontSize(20).font('Helvetica-Bold').fillColor('#1a1a2e').text('ALUFORCE', 40, 30);
        doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('Sistema de Gestão Empresarial', 40, 55);
        doc.moveTo(40, 72).lineTo(doc.page.width - 40, 72).strokeColor('#e5e7eb').stroke();

        doc.moveDown(0.5);
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e293b').text(titulo, { align: 'center' });
        if (filtrosTexto) {
            doc.fontSize(9).font('Helvetica').fillColor('#6b7280').text(filtrosTexto, { align: 'center' });
        }
        doc.fontSize(8).fillColor('#94a3b8').text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { align: 'center' });
        doc.moveDown(1);

        const tableTop = doc.y;
        const pageW = doc.page.width - 80;
        const colW = pageW / colunas.length;

        doc.rect(40, tableTop, pageW, 24).fill('#f1f5f9');
        colunas.forEach((col, i) => {
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151')
               .text(col, 44 + i * colW, tableTop + 7, { width: colW - 8, align: 'left' });
        });

        let y = tableTop + 28;
        linhas.forEach((linha, idx) => {
            if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
            if (idx % 2 === 0) doc.rect(40, y - 2, pageW, 20).fill('#fafafa');
            linha.forEach((val, i) => {
                doc.fontSize(8).font('Helvetica').fillColor('#374151')
                   .text(String(val || '-'), 44 + i * colW, y + 2, { width: colW - 8, align: 'left' });
            });
            y += 20;
        });

        doc.fontSize(8).fillColor('#94a3b8').text(`Total de registros: ${linhas.length}`, 40, y + 16);
        doc.end();
        return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(buffers))));
    }

    function formatarMoedaPdf(valor) {
        return 'R$ ' + (parseFloat(valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatarDataPdf(data) {
        if (!data) return '-';
        return new Date(data).toLocaleDateString('pt-BR');
    }

    // PDF: Vendas por Período
    router.get('/relatorios/vendas-periodo/pdf', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim, vendedor_id, status } = req.query;
            let query = `SELECT p.numero_pedido, p.cliente_nome, p.vendedor_nome, p.valor, p.status, p.created_at
                         FROM pedidos p WHERE 1=1`;
            const params = [];
            if (data_inicio) { query += ' AND p.created_at >= ?'; params.push(data_inicio); }
            if (data_fim) { query += ' AND p.created_at <= ?'; params.push(data_fim + ' 23:59:59'); }
            if (vendedor_id) { query += ' AND p.vendedor_id = ?'; params.push(vendedor_id); }
            if (status && status !== 'todos') { query += ' AND p.status = ?'; params.push(status); }
            query += ' ORDER BY p.created_at DESC';

            const [rows] = await vendasPool.query(query, params);
            const filtro = `Período: ${data_inicio || 'início'} a ${data_fim || 'hoje'}${vendedor_id ? ' | Vendedor filtrado' : ''}${status && status !== 'todos' ? ` | Status: ${status}` : ''}`;
            const colunas = ['Nº Pedido', 'Cliente', 'Vendedor', 'Valor', 'Status', 'Data'];
            const linhas = rows.map(r => [
                r.numero_pedido || '-', r.cliente_nome || '-', r.vendedor_nome || '-',
                formatarMoedaPdf(r.valor), r.status || '-', formatarDataPdf(r.created_at)
            ]);

            const pdfBuffer = await criarPdfRelatorio('Relatório de Vendas por Período', colunas, linhas, filtro);
            res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename=relatorio-vendas.pdf' });
            res.send(pdfBuffer);
        } catch (err) {
            console.error('Erro ao gerar PDF vendas-periodo:', err);
            res.status(500).json({ error: 'Erro ao gerar PDF' });
        }
    });

    // PDF: Comissões
    router.get('/relatorios/comissoes/pdf', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim, vendedor_id, percentual_comissao } = req.query;
            const pct = parseFloat(percentual_comissao) || 1;
            let query = `SELECT p.vendedor_nome, COUNT(*) as qtd, SUM(p.valor) as total_vendas,
                         SUM(p.valor * ${pct} / 100) as comissao
                         FROM pedidos p WHERE p.status IN ('faturado','entregue','aprovado')`;
            const params = [];
            if (data_inicio) { query += ' AND p.created_at >= ?'; params.push(data_inicio); }
            if (data_fim) { query += ' AND p.created_at <= ?'; params.push(data_fim + ' 23:59:59'); }
            if (vendedor_id) { query += ' AND p.vendedor_id = ?'; params.push(vendedor_id); }
            query += ' GROUP BY p.vendedor_id, p.vendedor_nome ORDER BY comissao DESC';

            const [rows] = await vendasPool.query(query, params);
            const filtro = `Período: ${data_inicio || 'início'} a ${data_fim || 'hoje'} | Percentual: ${pct}%`;
            const colunas = ['Vendedor', 'Qtd Vendas', 'Total Vendido', 'Comissão'];
            const linhas = rows.map(r => [
                r.vendedor_nome || '-', r.qtd || 0,
                formatarMoedaPdf(r.total_vendas), formatarMoedaPdf(r.comissao)
            ]);

            const pdfBuffer = await criarPdfRelatorio('Relatório de Comissões', colunas, linhas, filtro);
            res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename=relatorio-comissoes.pdf' });
            res.send(pdfBuffer);
        } catch (err) {
            console.error('Erro ao gerar PDF comissoes:', err);
            res.status(500).json({ error: 'Erro ao gerar PDF' });
        }
    });

    // PDF: Clientes
    router.get('/relatorios/clientes/pdf', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { cliente_id, status, cidade, estado, ordenar_por } = req.query;
            let query = `SELECT c.nome, c.email, c.telefone, c.cidade, c.estado, c.ativo,
                         (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) as qtd_pedidos,
                         (SELECT SUM(p.valor) FROM pedidos p WHERE p.cliente_id = c.id) as total_compras
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
            const filtro = `${cidade ? `Cidade: ${cidade} | ` : ''}${estado ? `Estado: ${estado} | ` : ''}Ordenado por: ${ordenar_por || 'nome'}`;
            const colunas = ['Nome', 'Email', 'Telefone', 'Cidade', 'UF', 'Pedidos', 'Total Compras'];
            const linhas = rows.map(r => [
                r.nome || '-', r.email || '-', r.telefone || '-',
                r.cidade || '-', r.estado || '-', r.qtd_pedidos || 0, formatarMoedaPdf(r.total_compras)
            ]);

            const pdfBuffer = await criarPdfRelatorio('Relatório de Clientes', colunas, linhas, filtro);
            res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename=relatorio-clientes.pdf' });
            res.send(pdfBuffer);
        } catch (err) {
            console.error('Erro ao gerar PDF clientes:', err);
            res.status(500).json({ error: 'Erro ao gerar PDF' });
        }
    });

    // PDF: Produtos
    router.get('/relatorios/produtos/pdf', authenticateToken, authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim, ordenar_por } = req.query;
            let query = `SELECT pi.descricao, pi.codigo, SUM(pi.quantidade) as qtd_total,
                         SUM(pi.preco_unitario * pi.quantidade) as valor_total,
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
            const filtro = `Período: ${data_inicio || 'início'} a ${data_fim || 'hoje'} | Ordenado por: ${ordenar_por || 'valor'}`;
            const colunas = ['Código', 'Descrição', 'Qtd Vendida', 'Nº Pedidos', 'Valor Total'];
            const linhas = rows.map(r => [
                r.codigo || '-', r.descricao || '-', r.qtd_total || 0,
                r.qtd_pedidos || 0, formatarMoedaPdf(r.valor_total)
            ]);

            const pdfBuffer = await criarPdfRelatorio('Relatório de Produtos Mais Vendidos', colunas, linhas, filtro);
            res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename=relatorio-produtos.pdf' });
            res.send(pdfBuffer);
        } catch (err) {
            console.error('Erro ao gerar PDF produtos:', err);
            res.status(500).json({ error: 'Erro ao gerar PDF' });
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
        const status = cdrScraper.getStatus();
        res.json(status);
    });

    // GET /ligacoes/dispositivos
    router.get('/ligacoes/dispositivos', authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;
            const ramais = await cdrScraper.listarRamais(data_inicio, data_fim);
            res.json(ramais);
        } catch (error) {
            console.error('Erro ao listar ramais CDR:', error.message);
            // Fallback: retornar lista estática de ramais quando scraper falha
            const RAMAL_NOMES = cdrScraper.RAMAL_NOMES || {};
            const fallback = Object.entries(RAMAL_NOMES).map(([id, name]) => ({
                username: id, name, callerid: `${name} (${id})`, id
            }));
            res.json(fallback);
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
            res.status(500).json({ error: error.message });
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
            
            res.json(resumo);
        } catch (error) {
            console.error('Erro ao gerar resumo de ligações:', error.message);
            // Fallback: retornar resumo vazio em vez de 500
            res.json({
                total: 0, realizadas: 0, atendidas: 0, nao_atendidas: 0,
                duracao_total: '00:00:00', por_ramal: [],
                periodo: { inicio: data_inicio || new Date().toISOString().split('T')[0], fim: data_fim || new Date().toISOString().split('T')[0] },
                erro: error.message
            });
        }
    });

    // ======================================
    // FIM DAS ROTAS DO MÓDULO VENDAS
    // ======================================
    
    
    return router;
};
