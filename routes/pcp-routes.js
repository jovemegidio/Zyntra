/**
 * PCP ROUTES - Extracted from server.js (Lines 4022-14567)
 * Compras, Estoque, Producao, Apontamentos, Materiais, Ordens de Producao
 * LARGEST module: ~10,500 lines, ~204 routes
 * @module routes/pcp-routes
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

module.exports = function createPCPRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeAdmin, writeAuditLog, cacheMiddleware, CACHE_CONFIG, jwt, JWT_SECRET } = deps;
    const router = express.Router();

    // --- Standard requires for extracted routes ---
    const { body, param, query, validationResult } = require('express-validator');
    const path = require('path');
    const multer = require('multer');
    const fs = require('fs');
    const upload = multer({ dest: path.join(__dirname, '..', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 } });
    const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    
    // LGPD Crypto - descriptografia PII (pode não existir)
    let lgpdCrypto = null;
    try { lgpdCrypto = require('../lgpd-crypto'); } catch (_) {}

    const validate = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: 'Dados inválidos', errors: errors.array() });
        next();
    };
    router.use(authenticateToken);
    // authorizeArea('pcp') - SKIP para rotas /api/configuracoes/* que são acessadas por TODOS os módulos
    router.use((req, res, next) => {
        if (req.path.startsWith('/api/configuracoes')) {
            return next(); // Configuracoes são globais, não restritas ao PCP
        }
        authorizeArea('pcp')(req, res, next);
    });
    // ----------------- ROTAS PCP (Compras, Estoque e Produção) UNIFICADAS -----------------

    // Cache de colunas da tabela produtos (evita INFORMATION_SCHEMA a cada request)
    let _produtoColumnsCache = null;
    let _produtoColumnsCacheTime = 0;
    const COLUMNS_CACHE_TTL = 300000; // 5 min

    async function getProdutoColumns(pool) {
        const now = Date.now();
        if (_produtoColumnsCache && (now - _produtoColumnsCacheTime) < COLUMNS_CACHE_TTL) {
            return _produtoColumnsCache;
        }
        const [columns] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'produtos' AND TABLE_SCHEMA = DATABASE()
        `);
        _produtoColumnsCache = columns.map(col => col.COLUMN_NAME);
        _produtoColumnsCacheTime = now;
        return _produtoColumnsCache;
    }
    
    // Rota /me para o PCP retornar dados do usuário logado
    router.get('/me', async (req, res) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Não autenticado' });
            }
    
            // Buscar dados completos do usuário no banco com JOIN para foto do funcionário
            const [[dbUser]] = await pool.query(
                `SELECT u.id, u.nome, u.email, u.role, u.is_admin,
                        u.permissoes_pcp as permissoes, u.foto, u.avatar,
                        f.foto_perfil_url as foto_funcionario
                 FROM usuarios u
                 LEFT JOIN funcionarios f ON u.email = f.email
                 WHERE u.id = ?`,
                [req.user.id]
            );
    
            if (!dbUser) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }
    
            // Parse permissões
            let permissoes = [];
            if (dbUser.permissoes) {
                try {
                    permissoes = JSON.parse(dbUser.permissoes);
                } catch (e) {
                    console.error('[API/PCP/ME] Erro ao parsear permissoes:', e);
                    permissoes = [];
                }
            }
    
            // Determinar a foto (prioridade: avatar > foto > foto_funcionario)
            const fotoUsuario = dbUser.avatar || dbUser.foto || dbUser.foto_funcionario || "/avatars/default.webp";
    
            // Retornar dados completos do usuário
            res.json({
                user: {
                    id: dbUser.id,
                    nome: dbUser.nome,
                    email: dbUser.email,
                    role: dbUser.role,
                    avatar: fotoUsuario,
                    foto: fotoUsuario,
                    foto_perfil_url: fotoUsuario,
                    is_admin: dbUser.is_admin,
                    permissoes: permissoes
                }
            });
        } catch (error) {
            console.error('[API/PCP/ME] Erro ao buscar usuário:', error);
            res.status(500).json({ message: 'Erro ao buscar dados do usuário' });
        }
    });
    
    // DASHBOARD / STATS DO PCP
    router.get('/dashboard', async (req, res, next) => {
        try {
            // Total de produtos (ativos ou sem flag de status)
            // Exclui categoria 'GERAL' (suprimentos, limpeza, escritório) — não são itens de produção PCP
            const [[produtosResult]] = await pool.query(
                `SELECT COUNT(*) as total FROM produtos WHERE (ativo = 1 OR ativo IS NULL) AND (categoria IS NULL OR categoria != 'GERAL')`
            );
    
            // Ordens em produção (status ativa ou em_producao)
            const [[ordensResult]] = await pool.query(
                `SELECT COUNT(*) as total FROM ordens_producao
                 WHERE status IN ('ativa', 'em_producao', 'Em Produção', 'em_andamento', 'A Fazer', 'pendente')`
            );
    
            // Produtos COM estoque (estoque_atual > 0)
            // Exclui categoria 'GERAL' (suprimentos, limpeza, escritório) — não são itens de produção PCP
            const [[produtosComEstoqueResult]] = await pool.query(
                `SELECT COUNT(*) as total FROM produtos
                 WHERE estoque_atual > 0
                 AND (ativo = 1 OR ativo IS NULL)
                 AND (categoria IS NULL OR categoria != 'GERAL')`
            );
    
            // Total de Materiais cadastrados
            const [[materiaisResult]] = await pool.query(
                'SELECT COUNT(*) as total FROM materiais'
            );

            // Entregas pendentes (ordens com data de previsão de entrega esta semana)
            const [[entregasResult]] = await pool.query(
                `SELECT COUNT(*) as total FROM ordens_producao
                 WHERE status NOT IN ('concluida', 'cancelada', 'finalizada')
                 AND data_prevista IS NOT NULL
                 AND data_prevista >= CURDATE()
                 AND data_prevista <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`
            );
    
            res.json({
                totalProdutos: produtosResult?.total || 0,
                ordensEmProducao: ordensResult?.total || 0,
                produtosComEstoque: produtosComEstoqueResult?.total || 0,
                totalMateriais: materiaisResult?.total || 0,
                entregasPendentes: entregasResult?.total || 0
            });
        } catch (error) {
            console.error('[PCP/DASHBOARD] Erro:', error);
            // Retornar valores padrão em caso de erro
            res.json({
                totalProdutos: 0,
                ordensEmProducao: 0,
                produtosComEstoque: 0,
                totalMateriais: 0,
                entregasPendentes: 0
            });
        }
    });
    
    // ============================================
    // ALERTAS DO SISTEMA PCP
    // ============================================
    router.get('/alertas', async (req, res) => {
        try {
            const alertas = [];
    
            // 1. Produtos com estoque CRÍTICO (zerado)
            // Exclui categoria 'GERAL' (suprimentos, limpeza, escritório) — não são itens de produção PCP
            const [produtosCriticos] = await pool.query(`
                SELECT codigo, nome, estoque_atual, estoque_minimo, unidade_medida as unidade, categoria
                FROM produtos
                WHERE (estoque_atual <= 0 OR quantidade_estoque <= 0)
                AND (ativo = 1 OR ativo IS NULL OR status = 'ativo')
                AND (categoria IS NULL OR categoria != 'GERAL')
                ORDER BY nome ASC
                LIMIT 50
            `);
    
            if (produtosCriticos && produtosCriticos.length > 0) {
                alertas.push({
                    tipo: 'critico',
                    titulo: 'Produtos sem Estoque',
                    descricao: `${produtosCriticos.length} produto(s) com estoque zerado`,
                    icone: 'fa-exclamation-circle',
                    cor: '#ef4444',
                    detalhes: produtosCriticos.slice(0, 3).map(p => p.nome || p.codigo).join(', '),
                    total: produtosCriticos.length,
                    navegarPara: 'estoque',
                    itens: produtosCriticos.map(p => ({
                        codigo: p.codigo,
                        nome: p.nome || p.codigo,
                        estoque: parseFloat(p.estoque_atual) || 0,
                        minimo: parseFloat(p.estoque_minimo) || 0,
                        unidade: p.unidade || 'UN'
                    }))
                });
            }
    
            // 2. Produtos com estoque BAIXO (abaixo do mínimo)
            // Exclui categoria 'GERAL' (suprimentos, limpeza, escritório) — não são itens de produção PCP
            const [produtosBaixo] = await pool.query(`
                SELECT codigo, nome, estoque_atual, estoque_minimo, unidade_medida as unidade, categoria
                FROM produtos
                WHERE estoque_atual > 0
                AND estoque_atual < COALESCE(estoque_minimo, 10)
                AND COALESCE(estoque_minimo, 10) > 0
                AND (ativo = 1 OR ativo IS NULL OR status = 'ativo')
                AND (categoria IS NULL OR categoria != 'GERAL')
                ORDER BY estoque_atual ASC
                LIMIT 50
            `);
    
            if (produtosBaixo && produtosBaixo.length > 0) {
                alertas.push({
                    tipo: 'warning',
                    titulo: 'Estoque Baixo',
                    descricao: `${produtosBaixo.length} produto(s) abaixo do estoque mínimo`,
                    icone: 'fa-box-open',
                    cor: '#f59e0b',
                    detalhes: produtosBaixo.slice(0, 3).map(p => p.nome || p.codigo).join(', '),
                    total: produtosBaixo.length,
                    navegarPara: 'estoque',
                    itens: produtosBaixo.map(p => ({
                        codigo: p.codigo,
                        nome: p.nome || p.codigo,
                        estoque: parseFloat(p.estoque_atual) || 0,
                        minimo: parseFloat(p.estoque_minimo) || 0,
                        unidade: p.unidade || 'UN'
                    }))
                });
            }
    
            // 3. Ordens de Produção em atraso
            const [ordensAtraso] = await pool.query(`
                SELECT id, codigo, produto_nome, data_previsao_entrega, status, cliente
                FROM ordens_producao
                WHERE data_previsao_entrega < CURDATE()
                AND status NOT IN ('concluida', 'Concluída', 'cancelada', 'Cancelada', 'entregue', 'finalizada')
                ORDER BY data_previsao_entrega ASC
                LIMIT 20
            `);
    
            if (ordensAtraso && ordensAtraso.length > 0) {
                alertas.push({
                    tipo: 'critico',
                    titulo: 'Ordens em Atraso',
                    descricao: `${ordensAtraso.length} ordem(s) com prazo vencido`,
                    icone: 'fa-clock',
                    cor: '#ef4444',
                    detalhes: ordensAtraso.slice(0, 3).map(o => `OP #${o.id}`).join(', '),
                    total: ordensAtraso.length,
                    navegarPara: 'ordens',
                    itens: ordensAtraso.map(o => ({
                        codigo: `OP #${o.id}`,
                        nome: o.produto_nome || o.codigo || `OP #${o.id}`,
                        info: o.cliente || '',
                        data: o.data_previsao_entrega,
                        status: o.status
                    }))
                });
            }
    
            // 4. Ordens pendentes há mais de 7 dias
            const [ordensPendentes] = await pool.query(`
                SELECT id, codigo, produto_nome, created_at, status, cliente
                FROM ordens_producao
                WHERE status IN ('pendente', 'a_produzir', 'A Fazer')
                AND created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                ORDER BY created_at ASC
                LIMIT 20
            `);
    
            if (ordensPendentes && ordensPendentes.length > 0) {
                alertas.push({
                    tipo: 'warning',
                    titulo: 'Ordens Pendentes',
                    descricao: `${ordensPendentes.length} ordem(s) aguardando há mais de 7 dias`,
                    icone: 'fa-hourglass-half',
                    cor: '#f59e0b',
                    detalhes: ordensPendentes.slice(0, 3).map(o => `OP #${o.id}`).join(', '),
                    total: ordensPendentes.length,
                    navegarPara: 'ordens',
                    itens: ordensPendentes.map(o => ({
                        codigo: `OP #${o.id}`,
                        nome: o.produto_nome || o.codigo || `OP #${o.id}`,
                        info: o.cliente || '',
                        data: o.created_at,
                        status: o.status
                    }))
                });
            }
    
            // 5. Materiais com estoque baixo
            try {
                const [materiaisBaixo] = await pool.query(`
                    SELECT codigo, nome, quantidade_estoque, estoque_minimo
                    FROM materiais
                    WHERE quantidade_estoque < COALESCE(estoque_minimo, 10)
                    AND COALESCE(estoque_minimo, 10) > 0
                    ORDER BY quantidade_estoque ASC
                    LIMIT 30
                `);
    
                if (materiaisBaixo && materiaisBaixo.length > 0) {
                    alertas.push({
                        tipo: 'warning',
                        titulo: 'Matéria-Prima Baixa',
                        descricao: `${materiaisBaixo.length} material(is) abaixo do estoque mínimo`,
                        icone: 'fa-cubes',
                        cor: '#f59e0b',
                        detalhes: materiaisBaixo.slice(0, 3).map(m => m.nome || m.codigo).join(', '),
                        total: materiaisBaixo.length,
                        navegarPara: 'materiais',
                        itens: materiaisBaixo.map(m => ({
                            codigo: m.codigo,
                            nome: m.nome || m.codigo,
                            estoque: parseFloat(m.quantidade_estoque) || 0,
                            minimo: parseFloat(m.estoque_minimo) || 0,
                            unidade: 'UN'
                        }))
                    });
                }
            } catch (e) {
                console.log('[PCP/ALERTAS] Tabela materiais não encontrada:', e.message);
            }
    
            res.json({
                success: true,
                alertas: alertas,
                total: alertas.length,
                totalCriticos: alertas.filter(a => a.tipo === 'critico').length,
                totalWarnings: alertas.filter(a => a.tipo === 'warning').length
            });
        } catch (error) {
            console.error('[PCP/ALERTAS] Erro:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar alertas',
                error: error.message,
                alertas: [],
                total: 0
            });
        }
    });
    
    // ORDENS DE PRODUÇÁO
    router.get('/ordens', async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const offset = parseInt(req.query.offset) || 0;
            const [rows] = await pool.query('SELECT id, codigo_produto, descricao_produto, quantidade, status, data_previsao_entrega, num_pedido, numero_pedido, cliente, observacoes, setor, created_at, updated_at FROM ordens_producao ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.post('/ordens', [
        body('codigo_produto').trim().notEmpty().withMessage('Código do produto é obrigatório')
            .isLength({ max: 100 }).withMessage('Código muito longo (máx 100 caracteres)'),
        body('descricao_produto').trim().notEmpty().withMessage('Descrição do produto é obrigatória')
            .isLength({ max: 500 }).withMessage('Descrição muito longa (máx 500 caracteres)'),
        body('quantidade').isInt({ min: 1 }).withMessage('Quantidade deve ser um número inteiro positivo'),
        body('data_previsao_entrega').isDate().withMessage('Data de previsão inválida'),
        body('observacoes').optional().trim().isLength({ max: 1000 }).withMessage('Observações muito longas (máx 1000 caracteres)'),
        validate
    ], async (req, res, next) => {
        try {
            const { codigo_produto, descricao_produto, quantidade, data_previsao_entrega, observacoes } = req.body;
            const sql = 'INSERT INTO ordens_producao (codigo_produto, descricao_produto, quantidade, data_previsao_entrega, observacoes, status) VALUES (?, ?, ?, ?, ?, \'A Fazer\')';
            const [result] = await pool.query(sql, [codigo_produto, descricao_produto, quantidade, data_previsao_entrega, observacoes]);
            res.status(201).json({ message: 'Ordem criada com sucesso!', id: result.insertId });
        } catch (error) { next(error); }
    });
    router.put('/ordens/:id/status', [
        param('id').isInt({ min: 1 }).withMessage('ID da ordem inválido'),
        body('status').isIn(['A Fazer', 'Em Andamento', 'Concluído', 'Cancelado'])
            .withMessage('Status inválido. Use: A Fazer, Em Andamento, Concluído ou Cancelado'),
        validate
    ], async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const [result] = await pool.query('UPDATE ordens_producao SET status = ? WHERE id = ?', [status, id]);
            if (result.affectedRows > 0) {
                res.json({ message: 'Status atualizado com sucesso!' });
            } else {
                res.status(404).json({ message: 'Ordem não encontrada.' });
            }
        } catch (error) { next(error); }
    });
    
    // MATERIAIS
    router.get('/materiais', async (req, res, next) => {
        try {
            const limit = parseInt(req.query.limit) || 1000;
            const offset = parseInt(req.query.offset) || 0;
            const comRecebimento = req.query.com_recebimento === 'true';
    
            let query, params;
            if (comRecebimento) {
                // Verificar se tabela recebimentos_compras existe antes de usar
                try {
                    const [tables] = await pool.query("SHOW TABLES LIKE 'recebimentos_compras'");
                    if (tables.length === 0) {
                        // Tabela não existe ainda - retornar lista normal com aviso
                        const [rows] = await pool.query('SELECT id, codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao FROM materiais ORDER BY descricao ASC LIMIT ? OFFSET ?', [limit, offset]);
                        return res.json({ data: rows, aviso: 'Tabela recebimentos_compras ainda não foi criada. Retornando todos os materiais.' });
                    }
                } catch (checkErr) {
                    // Se falhar a verificação, seguir com query normal
                    const [rows] = await pool.query('SELECT id, codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao FROM materiais ORDER BY descricao ASC LIMIT ? OFFSET ?', [limit, offset]);
                    return res.json(rows);
                }
                // Apenas materiais com recebimento em compras
                query = `
                    SELECT DISTINCT m.id, m.codigo_material, m.descricao, m.unidade_medida, m.quantidade_estoque, m.fornecedor_padrao
                    FROM materiais m
                    INNER JOIN recebimentos_compras rc ON rc.material_id = m.id
                    ORDER BY m.descricao ASC LIMIT ? OFFSET ?
                `;
                params = [limit, offset];
            } else {
                query = 'SELECT id, codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao FROM materiais ORDER BY descricao ASC LIMIT ? OFFSET ?';
                params = [limit, offset];
            }
    
            const [rows] = await pool.query(query, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.post('/materiais', [
        body('codigo_material').trim().notEmpty().withMessage('Código do material é obrigatório')
            .isLength({ max: 100 }).withMessage('Código muito longo (máx 100 caracteres)'),
        body('descricao').trim().notEmpty().withMessage('Descrição é obrigatória')
            .isLength({ max: 500 }).withMessage('Descrição muito longa (máx 500 caracteres)'),
        body('unidade_medida').trim().notEmpty().withMessage('Unidade de medida é obrigatória')
            .isLength({ max: 20 }).withMessage('Unidade de medida muito longa (máx 20 caracteres)'),
        body('quantidade_estoque').isFloat({ min: 0 }).withMessage('Quantidade deve ser um número positivo'),
        body('fornecedor_padrao').optional().trim().isLength({ max: 255 }).withMessage('Fornecedor padrão muito longo'),
        validate
    ], async (req, res, next) => {
        try {
            const { codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao } = req.body;
            const sql = 'INSERT INTO materiais (codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao) VALUES (?, ?, ?, ?, ?)';
            const [result] = await pool.query(sql, [codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao]);
            res.status(201).json({ message: 'Material criado com sucesso!', id: result.insertId });
        } catch (error) { next(error); }
    });
    router.put('/materiais/:id', [
        param('id').isInt({ min: 1 }).withMessage('ID do material inválido'),
        body('descricao').trim().notEmpty().withMessage('Descrição é obrigatória')
            .isLength({ max: 500 }).withMessage('Descrição muito longa (máx 500 caracteres)'),
        body('unidade_medida').trim().notEmpty().withMessage('Unidade de medida é obrigatória')
            .isLength({ max: 20 }).withMessage('Unidade de medida muito longa'),
        body('quantidade_estoque').isFloat({ min: 0 }).withMessage('Quantidade deve ser um número positivo'),
        body('fornecedor_padrao').optional().trim().isLength({ max: 255 }).withMessage('Fornecedor padrão muito longo'),
        validate
    ], async (req, res, next) => {
        try {
            const { id } = req.params;
            const { descricao, unidade_medida, quantidade_estoque, fornecedor_padrao } = req.body;
            const sql = 'UPDATE materiais SET descricao = ?, unidade_medida = ?, quantidade_estoque = ?, fornecedor_padrao = ? WHERE id = ?';
            const [result] = await pool.query(sql, [descricao, unidade_medida, quantidade_estoque, fornecedor_padrao, id]);
            if (result.affectedRows > 0) {
                res.json({ message: 'Material atualizado com sucesso!' });
            } else {
                res.status(404).json({ message: 'Material não encontrado.' });
            }
        } catch (error) { next(error); }
    });
    
    // MATERIAIS - Deletar material
    router.delete('/materiais/:id', [
        param('id').isInt({ min: 1 }).withMessage('ID do material inválido')
    ], async (req, res, next) => {
        try {
            const { id } = req.params;
    
            // Verificar se material existe
            const [existing] = await pool.query('SELECT id FROM materiais WHERE id = ?', [id]);
            if (existing.length === 0) {
                return res.status(404).json({ message: 'Material não encontrado.' });
            }
    
            // Verificar se há dependências (ordens de compra)
            const [dependencies] = await pool.query('SELECT COUNT(*) as count FROM ordens_compra WHERE material_id = ?', [id]);
            if (dependencies[0].count > 0) {
                return res.status(400).json({
                    message: 'Não é possível excluir. Material possui ordens de compra associadas.'
                });
            }
    
            // Deletar material
            const [result] = await pool.query('DELETE FROM materiais WHERE id = ?', [id]);
            res.json({ message: 'Material excluído com sucesso!' });
        } catch (error) { next(error); }
    });
    
    // ORDENS DE COMPRA
    router.get('/ordens-compra', async (req, res, next) => {
        try {
            const sql = `SELECT oc.id, m.codigo_material, m.descricao, oc.quantidade, oc.data_pedido, oc.previsao_entrega, oc.status FROM ordens_compra oc JOIN materiais m ON oc.material_id = m.id ORDER BY oc.data_pedido DESC`;
            const [rows] = await pool.query(sql);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.post('/ordens-compra', [
        body('material_id').isInt({ min: 1 }).withMessage('ID do material inválido'),
        body('quantidade').isFloat({ min: 0.01 }).withMessage('Quantidade deve ser um número positivo'),
        body('previsao_entrega').isDate().withMessage('Data de previsão inválida'),
        validate
    ], async (req, res, next) => {
        try {
            const { material_id, quantidade, previsao_entrega } = req.body;
            const sql = 'INSERT INTO ordens_compra (material_id, quantidade, data_pedido, previsao_entrega, status) VALUES (?, ?, CURDATE(), ?, \'Pendente\')';
            const [result] = await pool.query(sql, [material_id, quantidade, previsao_entrega]);
            res.status(201).json({ message: 'Ordem de compra criada com sucesso!', id: result.insertId });
        } catch (error) { next(error); }
    });
    
    // PRODUTOS
    // PRODUTOS - Listar produtos (com filtros para catálogo)
    router.get('/produtos', async (req, res, next) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 1000; // Default maior para catálogo
            const offset = (page - 1) * limit;
    
            // Filtros opcionais
            const categoria = req.query.categoria;
            const estoque = req.query.estoque; // 'todos', 'com-estoque', 'baixo', 'zerado'
            const search = req.query.search || req.query.q; // Aceita ambos os parâmetros
            const apenasAluforce = req.query.aluforce === 'true' || req.query.aluforce === '1';
    
            // Construir query base
            let whereConditions = ['status = "ativo"'];
            let queryParams = [];
    
            // Filtro para mostrar apenas produtos ALUFORCE CB
            if (apenasAluforce) {
                whereConditions.push('(UPPER(nome) LIKE "%ALUFORCE CB%" OR categoria = "ALUFORCE CB")');
            }
    
            // Filtro por categoria
            if (categoria && categoria !== 'todas' && categoria !== 'Todas as Categorias') {
                whereConditions.push('categoria = ?');
                queryParams.push(categoria);
            }
    
            // Filtro por estoque
            if (estoque === 'com-estoque') {
                whereConditions.push('estoque_atual > 0');
            } else if (estoque === 'baixo') {
                whereConditions.push('estoque_atual > 0 AND estoque_atual < estoque_minimo');
            } else if (estoque === 'zerado' || estoque === 'critico') {
                whereConditions.push('estoque_atual <= 0');
            }
    
            // Filtro por busca (código, nome, EAN-13, SKU, NCM)
            if (search) {
                const searchPattern = `%${search}%`;
                whereConditions.push('(codigo LIKE ? OR nome LIKE ? OR gtin LIKE ? OR sku LIKE ? OR ncm LIKE ?)');
                queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
            }
    
            const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
            // Query principal com todos os campos necessários
            const query = `
                SELECT
                    id,
                    codigo,
                    nome,
                    descricao,
                    categoria,
                    gtin,
                    sku,
                    ncm,
                    estoque_atual,
                    estoque_cancelado,
                    estoque_minimo,
                    preco_custo,
                    preco_venda,
                    unidade_medida,
                    imagem_url,
                    status,
                    data_criacao
                FROM produtos
                ${whereClause}
                ORDER BY nome ASC
                LIMIT ? OFFSET ?
            `;
    
            queryParams.push(limit, offset);
    
            const [rows] = await pool.query(query, queryParams);
    
            // Query de contagem total
            const countQuery = `SELECT COUNT(*) as total FROM produtos ${whereClause}`;
            const [[{ total }]] = await pool.query(countQuery, queryParams.slice(0, -2)); // Remove limit e offset
    
            // Estatísticas adicionais para o catálogo (considerando filtro ALUFORCE)
            const statsWhere = apenasAluforce
                ? 'WHERE status = "ativo" AND (UPPER(nome) LIKE "%ALUFORCE CB%" OR categoria = "ALUFORCE CB")'
                : 'WHERE status = "ativo"';
    
            const [stats] = await pool.query(`
                SELECT
                    COUNT(*) as total_produtos,
                    SUM(CASE WHEN estoque_atual > 0 THEN 1 ELSE 0 END) as com_estoque,
                    SUM(CASE WHEN estoque_atual > 0 AND estoque_atual < COALESCE(estoque_minimo, 5) THEN 1 ELSE 0 END) as estoque_baixo,
                    SUM(CASE WHEN estoque_atual <= 0 OR estoque_atual IS NULL THEN 1 ELSE 0 END) as critico,
                    SUM(CASE WHEN gtin IS NOT NULL AND gtin != '' THEN 1 ELSE 0 END) as com_ean
                FROM produtos
                ${statsWhere}
            `);
    
            res.json({
                produtos: rows,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
                stats: stats[0]
            });
        } catch (error) {
            console.error('❌ Erro ao buscar produtos:', error);
            next(error);
        }
    });
    
    // PRODUTOS - Alertas de estoque baixo (DEVE VIR ANTES DA ROTA /:id)
    router.get('/produtos/estoque-baixo', async (req, res, next) => {
        try {
            const [rows] = await pool.query(`
                SELECT id, codigo, descricao, sku, unidade_medida,
                       quantidade_estoque, estoque_minimo
                FROM produtos
                WHERE quantidade_estoque <= estoque_minimo
                AND status = "ativo"
                ORDER BY
                    CASE
                        WHEN quantidade_estoque <= 0 THEN 0
                        WHEN quantidade_estoque <= (estoque_minimo * 0.5) THEN 1
                        ELSE 2
                    END,
                    quantidade_estoque ASC
                LIMIT 50
            `);
            res.json(rows);
        } catch (error) { next(error); }
    });
    
    // PRODUTOS - Autocomplete por código ou nome (DEVE VIR ANTES DA ROTA /:id)
    router.get('/produtos/search', async (req, res, next) => {
        try {
            const query = req.query.q || '';
            const limit = parseInt(req.query.limit) || 10;
    
            if (!query) {
                const [rows] = await pool.query('SELECT id, codigo, nome, descricao, sku, gtin, unidade_medida as unidade, preco_venda, estoque_atual, quantidade_estoque, estoque_minimo, categoria, status FROM produtos WHERE status = "ativo" LIMIT ?', [limit]);
                return res.json(rows);
            }
    
            const searchPattern = `%${query}%`;
            const [rows] = await pool.query(`
                SELECT id, codigo, nome, descricao, sku, gtin, unidade_medida as unidade, preco_venda, estoque_atual, quantidade_estoque, estoque_minimo, categoria, status
                FROM produtos
                WHERE status = "ativo"
                AND (codigo LIKE ? OR nome LIKE ? OR sku LIKE ? OR gtin LIKE ?)
                ORDER BY
                    CASE
                        WHEN codigo = ? THEN 1
                        WHEN codigo LIKE ? THEN 2
                        WHEN nome LIKE ? THEN 3
                        ELSE 4
                    END
                LIMIT ?
            `, [searchPattern, searchPattern, searchPattern, searchPattern, query, `${query}%`, `${query}%`, limit]);
            res.json(rows);
        } catch (error) { next(error); }
    });
    
    // PRODUTOS - Buscar produto por ID (regex \\d+ garante que só números são capturados)
    router.get('/produtos/:id(\\d+)', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
    
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Produto não encontrado' });
            }
    
            res.json(rows[0]);
        } catch (error) { next(error); }
    });
    
    // PRODUTOS - Buscar movimentações por ID do produto (regex \\d+ garante que só números são capturados)
    router.get('/produtos/:id(\\d+)/movimentacoes', async (req, res, next) => {
        try {
            const { id } = req.params;
            const limit = parseInt(req.query.limit) || 50;
    
            const [movimentacoes] = await pool.query(`
                SELECT
                    me.id,
                    me.tipo as tipo_movimentacao,
                    me.tipo as tipo,
                    me.quantidade,
                    me.quantidade_anterior,
                    me.quantidade_atual,
                    me.observacoes as observacao,
                    me.local as modulo_origem,
                    me.documento,
                    COALESCE(me.criado_em, me.data_movimento, me.created_at) as created_at,
                    COALESCE(me.criado_em, me.data_movimento, me.created_at) as data_movimento,
                    u.nome as usuario_nome
                FROM movimentacoes_estoque me
                LEFT JOIN usuarios u ON me.usuario_id = u.id
                WHERE me.produto_id = ?
                ORDER BY COALESCE(me.criado_em, me.data_movimento, me.created_at) DESC
                LIMIT ?
            `, [id, limit]);
    
            res.json({ movimentacoes: movimentacoes || [] });
        } catch (error) {
            console.error('Erro ao buscar movimentações do produto:', error);
            // Retornar vazio em caso de erro (tabela pode não existir)
            res.json({ movimentacoes: [] });
        }
    });
    
    // PRODUTOS - Criar novo produto
    router.post('/produtos', [
        body('codigo').notEmpty().withMessage('Código é obrigatório'),
        body('nome').notEmpty().withMessage('Nome é obrigatório')
    ], async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
    
            const {
                codigo, sku, gtin, nome, descricao, categoria, marca, variacao,
                embalagem, preco, preco_venda, preco_custo, custo_unitario, custo,
                estoque, estoque_minimo, localizacao, peso_bruto, peso_liquido,
                ncm, cest, status, unidade_medida, cor, margem, origem,
                cfop_saida_interna, obs_internas, info_adicional_produto,
                observacoes, tipo_produto, controle_lote, ativo
            } = req.body;
    
            const precoFinal = preco_venda || preco || 0;
            const custoFinal = custo_unitario || preco_custo || custo || 0;
            const unidadeFinal = unidade_medida || embalagem || 'UN';
            
            const [result] = await pool.query(`
                INSERT INTO produtos (
                    codigo, sku, gtin, nome, descricao, categoria, marca, variacao,
                    unidade_medida, preco_venda, preco_custo, custo_unitario,
                    estoque_atual, quantidade_estoque, estoque_minimo, localizacao,
                    peso_bruto, peso_liquido, ncm, cest, status, cor, margem, origem,
                    cfop_saida_interna, obs_internas, info_adicional_produto,
                    observacoes, tipo_produto, controle_lote, ativo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                codigo, sku || null, gtin || null, nome, descricao || null,
                categoria || 'GERAL', marca || null, variacao || null, unidadeFinal,
                precoFinal, custoFinal, custoFinal,
                estoque || 0, estoque || 0, estoque_minimo || 0, localizacao || null,
                peso_bruto || null, peso_liquido || null, ncm || null, cest || null,
                status || 'ativo', cor || null, margem || 0, origem || '0',
                cfop_saida_interna || '5102', obs_internas || null, info_adicional_produto || null,
                observacoes || null, tipo_produto || 'produto', controle_lote || 0, ativo !== undefined ? ativo : 1
            ]);
    
            // Emitir evento WebSocket para sincronização em tempo real
            const newProduct = {
                id: result.insertId,
                codigo, sku, gtin, nome, descricao, categoria: categoria || 'GERAL',
                marca, variacao, unidade_medida: unidadeFinal,
                preco_venda: precoFinal, custo_unitario: custoFinal,
                estoque_atual: estoque || 0, estoque_minimo: estoque_minimo || 0,
                localizacao, ncm, cest, status: status || 'ativo',
                cor, tipo_produto: tipo_produto || 'produto'
            };
    
            // Broadcast para todos os clientes conectados
            if (global.io) {
                global.io.emit('product-created', newProduct);
                console.log('🔄 WebSocket: Produto criado emitido para todos os clientes');
            }
    
            res.json({
                success: true,
                message: 'Produto criado com sucesso',
                id: result.insertId
            });
        } catch (error) { next(error); }
    });
    
    // PRODUTOS - Atualizar produto
    router.put('/produtos/:id', [
        body('codigo').notEmpty().withMessage('Código é obrigatório'),
        body('nome').notEmpty().withMessage('Nome é obrigatório')
    ], async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
    
            const { id } = req.params;
            const {
                codigo, sku, gtin, nome, descricao, categoria, marca, variacao,
                custo_unitario, preco, preco_custo, preco_venda, estoque, quantidade_estoque,
                estoque_minimo, estoque_maximo, localizacao, ncm, cest, status,
                unidade_medida, unidade, embalagem, peso, peso_bruto, peso_liquido,
                largura, altura, comprimento,
                tensao, secao, material_condutor, isolacao, norma, cor,
                fornecedor_principal, prazo_entrega, qtd_minima_compra,
                obs_internas, obs_fornecedor, obs_venda, observacoes, ativo, tipo_produto,
                margem, origem, cfop_saida_interna, info_adicional_produto, controle_lote
            } = req.body;
    
            // Usar valores compatíveis - priorizar campos específicos
            const custoFinal = custo_unitario || preco_custo || 0;
            const precoVendaFinal = preco_venda !== undefined ? preco_venda : (preco || 0);
            const estoqueFinal = estoque !== undefined ? estoque : (quantidade_estoque || 0);
            const unidadeFinal = unidade_medida || unidade || 'UN';
            const observacoesFinal = observacoes || null;
    
            console.log('[SERVER.JS PUT /produtos/:id] Dados recebidos:', { id, estoque, quantidade_estoque, estoqueFinal, preco_venda, preco, precoVendaFinal });
    
            const [result] = await pool.query(`
                UPDATE produtos SET
                    codigo = ?, sku = ?, gtin = ?, nome = ?, descricao = ?,
                    categoria = ?, marca = ?, variacao = ?, custo_unitario = ?,
                    preco_venda = ?, estoque_atual = ?, quantidade_estoque = ?,
                    estoque_minimo = ?, estoque_maximo = ?, localizacao = ?,
                    ncm = ?, cest = ?, status = ?, unidade_medida = ?, embalagem = ?,
                    peso = ?, peso_bruto = ?, peso_liquido = ?,
                    largura = ?, altura = ?, comprimento = ?,
                    tensao = ?, secao = ?, material_condutor = ?, isolacao = ?,
                    norma = ?, cor = ?, fornecedor_principal = ?,
                    prazo_entrega = ?, qtd_minima_compra = ?,
                    obs_internas = ?, obs_fornecedor = ?, obs_venda = ?,
                    observacoes = ?, ativo = ?, tipo_produto = ?,
                    margem = ?, origem = ?, cfop_saida_interna = ?,
                    info_adicional_produto = ?, controle_lote = ?
                WHERE id = ?
            `, [
                codigo, sku || null, gtin || null, nome, descricao || null,
                categoria || null, marca || null, variacao || null, custoFinal,
                precoVendaFinal, estoqueFinal, estoqueFinal, estoque_minimo || 0,
                estoque_maximo || null, localizacao || null, ncm || null, cest || null,
                status || 'ativo', unidadeFinal, embalagem || null,
                peso || peso_bruto || null, peso_bruto || peso || null, peso_liquido || null,
                largura || null, altura || null, comprimento || null,
                tensao || null, secao || null, material_condutor || null, isolacao || null,
                norma || null, cor || null, fornecedor_principal || null,
                prazo_entrega || 0, qtd_minima_compra || 1,
                obs_internas || null, obs_fornecedor || null, obs_venda || null,
                observacoesFinal, ativo !== undefined ? ativo : 1, tipo_produto || 'produto',
                margem || 0, origem || '0', cfop_saida_interna || '5102',
                info_adicional_produto || null, controle_lote !== undefined ? controle_lote : 0,
                id
            ]);
    
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Produto não encontrado' });
            }
    
            console.log('[SERVER.JS PUT /produtos/:id] ✅ Produto atualizado com sucesso:', { id, estoqueFinal, precoVendaFinal });
    
            // Emitir evento WebSocket para sincronização em tempo real
            const updatedProduct = {
                id, codigo, sku, gtin, nome, descricao, categoria, marca, variacao,
                custo_unitario: custoFinal, preco_venda: precoVendaFinal,
                estoque_atual: estoqueFinal, quantidade_estoque: estoqueFinal,
                status: status || 'ativo'
            };
    
            // Broadcast para todos os clientes conectados
            if (global.io) {
                global.io.emit('product-updated', updatedProduct);
                console.log(`🔄 WebSocket: Produto ${id} atualizado emitido para todos os clientes`);
            }
    
            res.json({
                success: true,
                message: 'Produto atualizado com sucesso'
            });
        } catch (error) { next(error); }
    });
    
    // PRODUTOS - Deletar produto
    router.delete('/produtos/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
    
            const [result] = await pool.query('DELETE FROM produtos WHERE id = ?', [id]);
    
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Produto não encontrado' });
            }
    
            // Emitir evento WebSocket para sincronização em tempo real
            if (global.io) {
                global.io.emit('product-deleted', { id });
                console.log(`🔄 WebSocket: Produto ${id} excluído emitido para todos os clientes`);
            }
    
            res.json({
                success: true,
                message: 'Produto excluído com sucesso'
            });
        } catch (error) { next(error); }
    });
    
    // =====================================================
    // FATURAMENTOS - ENDPOINTS
    // =====================================================
    
    // FATURAMENTOS - Listar todos
    router.get('/faturamentos', async (req, res, next) => {
        try {
            // Verificar se tabela existe
            let tableExists = false;
            try {
                await pool.query('SELECT 1 FROM programacao_faturamento LIMIT 1');
                tableExists = true;
            } catch (e) {
                console.log('[API_FATURAMENTOS] Tabela programacao_faturamento não existe');
            }
    
            if (!tableExists) {
                // Retornar array vazio para compatibilidade com frontend
                return res.json([]);
            }
    
            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const offset = parseInt(req.query.offset) || 0;
            const [rows] = await pool.query(`
                SELECT id, numero, cliente_id, cliente_nome, valor, data_programada, status, tipo, observacoes, numero_nfe, created_at
                FROM programacao_faturamento
                ORDER BY data_programada DESC, id DESC
                LIMIT ? OFFSET ?
            `, [limit, offset]);
    
            // Retornar array direto para compatibilidade com frontend antigo
            res.json(rows || []);
        } catch (error) {
            console.error('❌ Erro ao buscar faturamentos:', error);
            // Em caso de erro, retornar array vazio
            res.json([]);
        }
    });
    
    // FATURAMENTOS - Buscar por ID
    router.get('/faturamentos/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query('SELECT * FROM programacao_faturamento WHERE id = ?', [id]);
    
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Faturamento não encontrado' });
            }
    
            res.json(rows[0]);
        } catch (error) { next(error); }
    });
    
    // FATURAMENTOS - Criar novo
    router.post('/faturamentos', [
        body('cliente_nome').notEmpty().withMessage('Nome do cliente é obrigatório'),
        body('valor').isNumeric().withMessage('Valor deve ser numérico'),
        body('data_programada').notEmpty().withMessage('Data programada é obrigatória')
    ], async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
    
            const { numero, cliente_id, cliente_nome, valor, status, tipo, data_programada, data_vencimento, observacoes } = req.body;
    
            const sql = `
                INSERT INTO programacao_faturamento
                (numero, cliente_id, cliente_nome, valor, status, tipo, data_programada, data_vencimento, observacoes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;
    
            const [result] = await pool.query(sql, [
                numero || `FAT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
                cliente_id || null,
                cliente_nome,
                valor,
                status || 'pendente',
                tipo || 'nfe',
                data_programada,
                data_vencimento || null,
                observacoes || null
            ]);
    
            res.status(201).json({
                success: true,
                message: 'Faturamento criado com sucesso',
                id: result.insertId
            });
        } catch (error) { next(error); }
    });
    
    // FATURAMENTOS - Atualizar
    router.put('/faturamentos/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { cliente_nome, valor, status, tipo, data_programada, data_vencimento, numero_nfe, chave_acesso, observacoes } = req.body;
    
            const sql = `
                UPDATE programacao_faturamento
                SET cliente_nome = ?, valor = ?, status = ?, tipo = ?,
                    data_programada = ?, data_vencimento = ?, numero_nfe = ?,
                    chave_acesso = ?, observacoes = ?, updated_at = NOW()
                WHERE id = ?
            `;
    
            const [result] = await pool.query(sql, [
                cliente_nome, valor, status, tipo, data_programada,
                data_vencimento, numero_nfe, chave_acesso, observacoes, id
            ]);
    
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Faturamento não encontrado' });
            }
    
            res.json({
                success: true,
                message: 'Faturamento atualizado com sucesso'
            });
        } catch (error) { next(error); }
    });
    
    // FATURAMENTOS - Deletar
    router.delete('/faturamentos/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [result] = await pool.query('DELETE FROM programacao_faturamento WHERE id = ?', [id]);
    
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Faturamento não encontrado' });
            }
    
            res.json({
                success: true,
                message: 'Faturamento excluído com sucesso'
            });
        } catch (error) { next(error); }
    });
    
    // =====================================================
    // ORDENS DE PRODUÇÃO - KANBAN (Gestão Visual)
    // =====================================================
    
    // GET - Próximo número de OP para o Kanban
    router.get('/ordens-kanban/proximo-numero', async (req, res) => {
        try {
            const ano = new Date().getFullYear();
            const prefix = `OP Nº ${ano}/`;
    
            // Buscar o maior número sequencial do ano corrente
            const [rows] = await pool.query(
                `SELECT codigo FROM ordens_producao
                 WHERE codigo LIKE ?
                 ORDER BY CAST(SUBSTRING_INDEX(codigo, '/', -1) AS UNSIGNED) DESC
                 LIMIT 1`,
                [`${prefix}%`]
            );
    
            let proximoSeq = 1;
            if (rows && rows.length > 0) {
                const ultimo = rows[0].codigo;
                const partes = ultimo.split('/');
                const ultimoNum = parseInt(partes[partes.length - 1]) || 0;
                proximoSeq = ultimoNum + 1;
            }
    
            const numero = `${prefix}${String(proximoSeq).padStart(5, '0')}`;
            res.json({ numero, sequencial: proximoSeq, ano });
        } catch (error) {
            console.error('[PCP/PROXIMO-NUMERO] Erro:', error.message);
            // Fallback com timestamp
            const ano = new Date().getFullYear();
            const seq = String(Date.now()).slice(-5);
            res.json({ numero: `OP Nº ${ano}/${seq}`, sequencial: parseInt(seq), ano });
        }
    });
    
    // GET - Listar ordens para o Kanban
    router.get('/ordens-kanban', async (req, res, next) => {
        try {
            const [rows] = await pool.query(`
                SELECT
                    id,
                    codigo as numero,
                    produto_nome as produto,
                    quantidade,
                    quantidade_produzida as produzido,
                    unidade,
                    status,
                    prioridade,
                    data_inicio,
                    data_prevista as dataConclusao,
                    data_conclusao,
                    responsavel,
                    progresso,
                    observacoes,
                    created_at,
                    updated_at
                FROM ordens_producao
                ORDER BY
                    CASE status
                        WHEN 'ativa' THEN 1
                        WHEN 'em_producao' THEN 2
                        WHEN 'pendente' THEN 3
                        WHEN 'concluida' THEN 4
                        WHEN 'cancelada' THEN 5
                    END,
                    data_prevista ASC,
                    id DESC
            `);
    
            // Mapear status para o formato esperado pelo frontend
            const ordensFormatadas = rows.map(ordem => ({
                ...ordem,
                statusKanban: mapStatusToKanban(ordem.status),
                statusTexto: mapStatusToTexto(ordem.status),
                produzido: ordem.produzido || 0,
                unidade: ordem.unidade || 'M'
            }));
    
            res.json(ordensFormatadas);
        } catch (error) {
            console.error('❌ Erro ao listar ordens Kanban:', error);
            next(error);
        }
    });
    
    // POST - Criar nova ordem de produção (via modal)
    router.post('/ordens-kanban', async (req, res, next) => {
        try {
            const {
                cliente, produto, codigo, quantidade, unidade,
                data_previsao_entrega, vendedor, observacoes, observacoes_pedido, prioridade,
                numero_orcamento, tipo_frete, prazo_entrega,
                produtos // Array de produtos do modal
            } = req.body;
    
            // Gerar código da ordem
            const [ultimaOrdem] = await pool.query(`
                SELECT codigo FROM ordens_producao
                WHERE codigo LIKE 'OP N° %'
                ORDER BY id DESC LIMIT 1
            `);
    
            let proximoNumero = 1;
            if (ultimaOrdem.length > 0 && ultimaOrdem[0].codigo) {
                const match = ultimaOrdem[0].codigo.match(/(\d+)$/);
                if (match) proximoNumero = parseInt(match[1]) + 1;
            }
    
            const ano = new Date().getFullYear();
            const codigoOrdem = `OP N° ${ano}/${String(proximoNumero).padStart(5, '0')}`;
    
            // Nome do produto (pode vir do array ou do campo direto)
            const nomeProduto = produto || (produtos && produtos[0]?.descricao) || cliente || 'Produto não especificado';
            const codigoProduto = codigo || (produtos && produtos[0]?.codigo) || '';
            const qtd = quantidade || (produtos && produtos[0]?.quantidade) || 0;
            const und = unidade || (produtos && produtos[0]?.unidade) || 'M';
    
            // Observações - aceita ambos os campos
            const obs = observacoes || observacoes_pedido || null;
    
            const [result] = await pool.query(`
                INSERT INTO ordens_producao (
                    codigo, produto_nome, quantidade, unidade,
                    status, prioridade, data_prevista, responsavel, observacoes,
                    progresso, quantidade_produzida, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'ativa', ?, ?, ?, ?, 0, 0, NOW(), NOW())
            `, [
                codigoOrdem,
                `${nomeProduto}${codigoProduto ? ' - ' + codigoProduto : ''}`,
                qtd,
                und,
                prioridade || 'media',
                data_previsao_entrega || null,
                vendedor || null,
                obs
            ]);
    
            const novaOrdem = {
                id: result.insertId,
                numero: codigoOrdem,
                produto: nomeProduto,
                codigo: codigoProduto,
                quantidade: qtd,
                produzido: 0,
                unidade: und,
                status: 'ativa',
                statusKanban: 'a_produzir',
                statusTexto: 'Nova',
                dataConclusao: data_previsao_entrega,
                prioridade: prioridade || 'media'
            };
    
            console.log('✅ Ordem de produção criada:', codigoOrdem);
            res.status(201).json(novaOrdem);
        } catch (error) {
            console.error('❌ Erro ao criar ordem Kanban:', error);
            next(error);
        }
    });
    
    // PUT - Atualizar ordem de produção (Kanban)
    router.put('/ordens-kanban/:id', async (req, res) => {
        const { id } = req.params;
        const { status, statusKanban, produzido, quantidade_produzida, progresso, observacoes } = req.body;
    
        console.log(`[API_PCP] Atualizando ordem de produção ${id}...`);
    
        try {
            // Mapear status do Kanban para status do banco
            let dbStatus = status || statusKanban;
            const statusMap = {
                'a_produzir': 'ativa',
                'produzindo': 'em_producao',
                'qualidade': 'em_producao',
                'conferido': 'em_producao',
                'concluido': 'concluida',
                'armazenado': 'concluida'
            };
    
            if (statusMap[dbStatus]) {
                dbStatus = statusMap[dbStatus];
            }
    
            const updates = [];
            const values = [];
    
            if (dbStatus) {
                updates.push('status = ?');
                values.push(dbStatus);
            }
    
            if (produzido !== undefined || quantidade_produzida !== undefined) {
                updates.push('quantidade_produzida = ?');
                values.push(produzido || quantidade_produzida);
            }
    
            if (progresso !== undefined) {
                updates.push('progresso = ?');
                values.push(progresso);
            }
    
            if (observacoes !== undefined) {
                updates.push('observacoes = ?');
                values.push(observacoes);
            }
    
            updates.push('updated_at = NOW()');
            values.push(id);
    
            if (updates.length > 1) {
                const [result] = await pool.query(
                    `UPDATE ordens_producao SET ${updates.join(', ')} WHERE id = ?`,
                    values
                );
    
                if (result.affectedRows === 0) {
                    return res.status(404).json({ error: 'Ordem não encontrada' });
                }
    
                console.log(`✅ Ordem ${id} atualizada`);
                res.json({ success: true, message: 'Ordem atualizada com sucesso' });
            } else {
                res.json({ success: true, message: 'Nenhuma alteração necessária' });
            }
        } catch (error) {
            console.error('❌ Erro ao atualizar ordem:', error);
            res.status(500).json({ error: 'Erro ao atualizar ordem de produção' });
        }
    });
    // PATCH - Atualizar ordem (status, quantidade produzida, etc)
    router.patch('/ordens-kanban/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status, produzido, quantidade_produzida, responsavel, observacoes } = req.body;
    
            const updates = [];
            const params = [];
    
            if (status) {
                const statusDB = mapKanbanToStatus(status);
                updates.push('status = ?');
                params.push(statusDB);
    
                // Se concluída, registrar data de conclusão
                if (statusDB === 'concluida') {
                    updates.push('data_conclusao = NOW()');
                    updates.push('data_finalizacao = NOW()');
                }
            }
    
            if (produzido !== undefined || quantidade_produzida !== undefined) {
                const qtdProduzida = produzido ?? quantidade_produzida;
                updates.push('quantidade_produzida = ?');
                params.push(qtdProduzida);
    
                // Calcular progresso automaticamente
                const [ordemAtual] = await pool.query('SELECT quantidade FROM ordens_producao WHERE id = ?', [id]);
                if (ordemAtual.length > 0 && ordemAtual[0].quantidade > 0) {
                    const progresso = Math.min(100, (qtdProduzida / ordemAtual[0].quantidade) * 100);
                    updates.push('progresso = ?');
                    params.push(progresso.toFixed(2));
                }
            }
    
            if (responsavel) {
                updates.push('responsavel = ?');
                params.push(responsavel);
            }
    
            if (observacoes !== undefined) {
                updates.push('observacoes = ?');
                params.push(observacoes);
            }
    
            if (updates.length === 0) {
                return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
            }
    
            updates.push('updated_at = NOW()');
            params.push(id);
    
            await pool.query(`
                UPDATE ordens_producao SET ${updates.join(', ')} WHERE id = ?
            `, params);
    
            // Buscar ordem atualizada
            const [ordemAtualizada] = await pool.query(`
                SELECT * FROM ordens_producao WHERE id = ?
            `, [id]);
    
            console.log('✅ Ordem', id, 'atualizada');
            res.json({
                sucesso: true,
                ordem: ordemAtualizada[0]
            });
        } catch (error) {
            console.error('❌ Erro ao atualizar ordem Kanban:', error);
            next(error);
        }
    });
    
    // DELETE - Excluir ordem de produção
    // AUDIT-FIX DB-003: Added transaction + cascade cleanup for child tables
    router.delete('/ordens-kanban/:id', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            await connection.beginTransaction();
    
            // Clean up child tables first
            try { await connection.query('DELETE FROM tarefas_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM historico_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM anexos_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM apontamentos_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM itens_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
    
            const [result] = await connection.query('DELETE FROM ordens_producao WHERE id = ?', [id]);
    
            if (result.affectedRows === 0) {
                await connection.rollback();
                return res.status(404).json({ erro: 'Ordem não encontrada' });
            }
    
            await connection.commit();
            console.log('✅ Ordem', id, 'excluída com cascata');
            res.json({ sucesso: true, mensagem: 'Ordem excluída com sucesso' });
        } catch (error) {
            await connection.rollback();
            console.error('❌ Erro ao excluir ordem Kanban:', error);
            next(error);
        } finally {
            connection.release();
        }
    });
    
    // Funções auxiliares para mapeamento de status
    function mapStatusToKanban(status) {
        const map = {
            'ativa': 'a_produzir',
            'em_producao': 'produzindo',
            'pendente': 'qualidade',
            'concluida': 'concluido',
            'cancelada': 'cancelado'
        };
        return map[status] || 'a_produzir';
    }
    
    function mapStatusToTexto(status) {
        const map = {
            'ativa': 'A Produzir',
            'em_producao': 'Produzindo',
            'pendente': 'Em Qualidade',
            'concluida': 'Concluída',
            'cancelada': 'Cancelada'
        };
        return map[status] || 'Nova';
    }
    
    function mapKanbanToStatus(statusKanban) {
        const map = {
            'a_produzir': 'ativa',
            'produzindo': 'em_producao',
            'qualidade': 'pendente',
            'conferido': 'pendente',
            'concluido': 'concluida',
            'armazenado': 'concluida',
            'cancelado': 'cancelada'
        };
        return map[statusKanban] || 'ativa';
    }
    
    // ORDENS DE PRODUÇÃO - ENDPOINTS LEGADOS
    router.get('/ordens-producao', async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 300, 500);
            const offset = parseInt(req.query.offset) || 0;
            const [rows] = await pool.query(`
                SELECT id, codigo_produto, descricao_produto, quantidade, status, data_previsao_entrega, num_pedido, numero_pedido, cliente, observacoes, setor, created_at, updated_at
                FROM ordens_producao
                ORDER BY id DESC
                LIMIT ? OFFSET ?
            `, [limit, offset]);
    
            res.json({
                success: true,
                data: rows
            });
        } catch (error) { next(error); }
    });
    
    // ÚLTIMO PEDIDO - Para gerar número sequencial
    router.get('/ultimo-pedido', async (req, res, next) => {
        try {
            // Buscar último número de pedido registrado
            const [rows] = await pool.query(`
                SELECT numero_pedido, num_pedido
                FROM ordens_producao
                WHERE numero_pedido IS NOT NULL OR num_pedido IS NOT NULL
                ORDER BY id DESC
                LIMIT 1
            `);
    
            let ultimoNumero = null;
    
            if (rows.length > 0) {
                // Pegar o primeiro campo não-nulo
                ultimoNumero = rows[0].numero_pedido || rows[0].num_pedido;
    
                // Se for string, tentar converter para número
                if (typeof ultimoNumero === 'string') {
                    ultimoNumero = ultimoNumero.replace(/\D/g, ''); // Remove não-dígitos
                }
            }
    
            res.json({
                success: true,
                ultimo_numero: ultimoNumero
            });
        } catch (error) {
            console.error('❌ Erro ao buscar último pedido:', error);
            next(error);
        }
    });
    
    // ENDPOINT DE HEALTH CHECK PARA MONITORAMENTO
    router.get('/health', (req, res) => {
        const healthInfo = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
            },
            version: require('./package.json').version || '2.0.0',
            environment: process.env.NODE_ENV || 'development',
            database: DB_AVAILABLE ? 'connected' : 'disconnected',
            features: {
                excel_generation: true,
                pdf_generation: false,
                auto_backup: process.env.BACKUP_ENABLED === 'true',
                monitoring: process.env.MONITORING_ENABLED === 'true'
            }
        };
    
        res.status(200).json(healthInfo);
    });
    
    // ENDPOINT DE MÉTRICAS PARA MONITORAMENTO AVANÇADO
    // SECURITY: Requer autenticação de administrador para evitar exposição de informações do sistema
    router.get('/metrics', authenticateToken, authorizeAdmin, (req, res) => {
        const metrics = {
            timestamp: new Date().toISOString(),
            process: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage(),
                version: process.version,
                platform: process.platform
            },
            application: {
                name: 'ALUFORCE v2.0',
                version: require('./package.json').version || '2.0.0',
                environment: process.env.NODE_ENV || 'development'
            },
            database: {
                status: DB_AVAILABLE ? 'connected' : 'disconnected',
                pool_connections: DB_AVAILABLE ? 'active' : 'inactive'
            }
        };
    
        res.set('Content-Type', 'text/plain');
        res.send(`# ALUFORCE v2.0 Metrics
    aluforce_uptime_seconds ${metrics.process.uptime}
    aluforce_memory_used_bytes ${metrics.process.memory.heapUsed}
    aluforce_memory_total_bytes ${metrics.process.memory.heapTotal}
    aluforce_database_connected ${DB_AVAILABLE ? 1 : 0}
    aluforce_app_version_info{version="${metrics.application.version}",environment="${metrics.application.environment}"} 1
    `);
    });
    
    // SISTEMA DE TEMPLATES AVANÇADO
    const AdvancedTemplateManager = require('../scripts/advanced-template-manager.js');
    const templateManager = new AdvancedTemplateManager();
    
    // Servir editor de templates
    router.get('/template-editor', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'template-editor', 'index.html'));
    });
    
    // API para listar templates
    router.get('/api/templates/list', authenticateToken, async (req, res) => {
        try {
            const filters = {
                type: req.query.type,
                company: req.query.company,
                department: req.query.department
            };
    
            const templates = await templateManager.listTemplates(filters);
    
            res.json({
                success: true,
                templates,
                count: templates.length
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // API para obter detalhes de um template
    router.get('/api/templates/:id', authenticateToken, async (req, res) => {
        try {
            const template = await templateManager.getTemplate(req.params.id);
    
            res.json({
                success: true,
                template
            });
        } catch (error) {
            res.status(404).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // API para criar novo template
    router.post('/api/templates/create', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const templateInfo = req.body;
            const templateId = await templateManager.registerTemplate(templateInfo);
    
            res.json({
                success: true,
                templateId,
                message: 'Template criado com sucesso'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // API para atualizar template
    router.post('/api/templates/update', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const templateData = req.body;
    
            if (!templateData.id) {
                return res.status(400).json({
                    success: false,
                    error: 'ID do template é obrigatório'
                });
            }
    
            // Atualizar template existente
            const template = await templateManager.getTemplate(templateData.id);
            Object.assign(template, templateData);
    
            await templateManager.saveTemplateConfig();
    
            res.json({
                success: true,
                message: 'Template atualizado com sucesso'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // API para criar template personalizado
    router.post('/api/templates/customize', authenticateToken, async (req, res) => {
        try {
            const { baseTemplateId, customizations, userInfo } = req.body;
    
            const customTemplateId = await templateManager.createCustomTemplate(
                baseTemplateId,
                customizations,
                userInfo
            );
    
            res.json({
                success: true,
                customTemplateId,
                message: 'Template personalizado criado com sucesso'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // API para definir template padrão
    router.post('/api/templates/set-default', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { templateId, templateType } = req.body;
    
            await templateManager.setDefaultTemplate(templateId, templateType);
    
            res.json({
                success: true,
                message: 'Template padrão definido com sucesso'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // API para gerar Excel com template específico
    router.post('/api/templates/generate-excel', authenticateToken, async (req, res) => {
        try {
            const { templateId, data } = req.body;
    
            const workbook = await templateManager.generateExcelWithTemplate(templateId, data);
    
            // Gerar nome do arquivo
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `documento_${templateId}_${timestamp}.xlsx`;
            const filePath = path.join(__dirname, 'temp_excel', fileName);
    
            // Salvar arquivo
            await workbook.xlsx.writeFile(filePath);
    
            // Ler e enviar arquivo
            const fileBuffer = await fs.promises.readFile(filePath);
    
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Length', fileBuffer.length);
    
            res.send(fileBuffer);
    
            // Limpar arquivo temporário
            setTimeout(() => {
                fs.promises.unlink(filePath).catch(console.error);
            }, 5000);
    
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // API para obter estatísticas de templates
    router.get('/api/templates/stats', authenticateToken, async (req, res) => {
        try {
            const stats = await templateManager.getUsageStats();
    
            res.json({
                success: true,
                stats
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // API para exportar template
    router.get('/api/templates/:id/export', authenticateToken, async (req, res) => {
        try {
            const templateConfig = await templateManager.exportTemplateConfig(req.params.id);
    
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="template-${req.params.id}.json"`);
    
            res.json(templateConfig);
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // API para importar template
    // SECURITY: Requer autenticação de administrador para import de arquivos
    router.post('/api/templates/import', authenticateToken, authorizeAdmin, upload.single('templateFile'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'Arquivo de template é obrigatório'
                });
            }
    
            const templateConfig = JSON.parse(req.file.buffer.toString());
            const newFilePath = path.join(__dirname, '..', 'templates', 'custom', req.file.originalname);
    
            const templateId = await templateManager.importTemplate(templateConfig, newFilePath);
    
            res.json({
                success: true,
                templateId,
                message: 'Template importado com sucesso'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // =================== APIS PARA AUTOCOMPLETE DO MODAL PCP ===================
    
    // API para buscar clientes (suporta modo gestão com todos os campos)
    // SECURITY: Requer autenticação
    router.get('/api/clientes', authenticateToken, async (req, res) => {
        try {
            const { termo, busca, gestao, limite } = req.query;
            const termoBusca = termo || busca; // Suporta ambos os parâmetros
            // SECURITY: Limitar range de resultados para evitar abuso (1-500)
            const limiteResultados = Math.min(Math.max(parseInt(limite) || 50, 1), 500);
    
            // Modo gestão: retorna todos os campos para a página de gestão de clientes
            if (gestao === 'true' || gestao === '1') {
                let query = `SELECT id, nome, razao_social, nome_fantasia, cnpj, cnpj_cpf, cpf, inscricao_estadual, contato, email, telefone, endereco, bairro, cidade, estado, cep, vendedor_responsavel, ativo, observacoes, created_at, data_ultima_alteracao as updated_at FROM clientes ORDER BY nome LIMIT ?`;
    
                const [clientes] = await pool.query(query, [limiteResultados]);
    
                // Descriptografar campos PII (LGPD)
                const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
    
                const clientesFormatados = clientes.map(cliente => {
                    // Descriptografar campos que podem estar criptografados
                    const cnpjRaw = cliente.cnpj || cliente.cnpj_cpf || '';
                    const cpfRaw = cliente.cpf || '';
                    const cnpjDecrypted = _dec(cnpjRaw);
                    const cpfDecrypted = _dec(cpfRaw);
                    const ieRaw = cliente.inscricao_estadual || '';
                    const ieDecrypted = _dec(ieRaw);
    
                    return {
                    id: cliente.id,
                    nome: cliente.nome || cliente.razao_social || cliente.nome_fantasia || '',
                    contato: cliente.contato || '',
                    cnpj: cnpjDecrypted,
                    cpf: cpfDecrypted,
                    inscricao_estadual: ieDecrypted,
                    telefone: cliente.telefone || '',
                    celular: '',
                    email: cliente.email || '',
                    email_nfe: cliente.email || '',
                    cep: cliente.cep || '',
                    endereco: cliente.endereco || '',
                    numero: '',
                    bairro: cliente.bairro || '',
                    cidade: cliente.cidade || '',
                    uf: cliente.estado || '',
                    ativo: cliente.ativo === 1 || cliente.ativo === true,
                    data_criacao: cliente.data_cadastro || cliente.created_at,
                    data_atualizacao: cliente.data_ultima_alteracao || cliente.updated_at
                }});  // fecha return + map
    
                console.log(`✅ Gestão: Encontrados ${clientesFormatados.length} clientes`);
                return res.json(clientesFormatados);
            }
    
            // Modo autocomplete: retorna apenas campos básicos
            console.log('📋 Buscando clientes para autocomplete...');
    
            let query = `SELECT id,
                COALESCE(razao_social, nome) as razao_social,
                COALESCE(nome_fantasia, nome) as nome,
                COALESCE(cnpj_cpf, cnpj, cpf, '') as cnpj_cpf,
                COALESCE(cidade, '') as cidade,
                COALESCE(estado, '') as uf,
                telefone, email
                FROM clientes WHERE (ativo = 1 OR ativo IS NULL)`;
            let params = [];
    
            if (termoBusca && termoBusca.length >= 2) {
                query += ` AND (
                    razao_social LIKE ? OR
                    nome_fantasia LIKE ? OR
                    nome LIKE ? OR
                    cnpj_cpf LIKE ? OR
                    cnpj LIKE ?
                )`;
                const termoLike = `%${termoBusca}%`;
                params = [termoLike, termoLike, termoLike, termoLike, termoLike];
            }
    
            query += ` ORDER BY COALESCE(razao_social, nome) LIMIT ${limiteResultados}`;
    
            const [clientes] = await pool.query(query, params);
    
            // Formatar resposta (descriptografar PII)
            const _dec2 = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
            const clientesFormatados = clientes.map(cliente => ({
                id: cliente.id,
                razao_social: cliente.razao_social || cliente.nome || '',
                nome: cliente.nome || cliente.razao_social || '',
                cnpj_cpf: _dec2(cliente.cnpj_cpf || cliente.cnpj || cliente.cpf || ''),
                cidade: cliente.cidade || '',
                uf: cliente.uf || '',
                telefone: cliente.telefone || '',
                email: cliente.email || ''
            }));
    
            console.log(`✅ Encontrados ${clientesFormatados.length} clientes`);
            res.json({ success: true, data: clientesFormatados, total: clientesFormatados.length });
    
        } catch (error) {
            console.error('❌ Erro ao buscar clientes:', error.message || error, 'Code:', error.code || 'N/A', 'SQL:', error.sql || 'N/A');
            console.error('Stack:', error.stack || 'N/A');
            res.status(500).json({ error: 'Erro ao buscar clientes', message: error.message || String(error) });
        }
    });
    
    // API para criar novo cliente
    // SECURITY: Requer autenticação
    router.post('/api/clientes', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Criando novo cliente...');
            const {
                nome, contato, cnpj, cpf, inscricao_estadual,
                telefone, celular, email, email_nfe,
                cep, endereco, numero, bairro, cidade, uf, ativo
            } = req.body;
    
            if (!nome) {
                return res.status(400).json({ error: 'Nome é obrigatório' });
            }
    
            const [result] = await pool.query(`
                INSERT INTO clientes (
                    nome, contato, cnpj, cpf, inscricao_estadual,
                    telefone, celular, email, email_nfe,
                    cep, endereco, logradouro, numero, bairro, cidade, uf, estado, ativo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                nome, contato || null, cnpj || null, cpf || null, inscricao_estadual || null,
                telefone || null, celular || null, email || null, email_nfe || null,
                cep || null, endereco || null, endereco || null, numero || null, bairro || null, cidade || null, uf || null, uf || null,
                ativo !== undefined ? (ativo ? 1 : 0) : 1
            ]);
    
            console.log(`✅ Cliente criado com ID: ${result.insertId}`);
            res.status(201).json({ id: result.insertId, message: 'Cliente criado com sucesso' });
    
        } catch (error) {
            console.error('❌ Erro ao criar cliente:', error);
            res.status(500).json({ error: 'Erro ao criar cliente' });
        }
    });
    
    // API para buscar cliente por ID
    // SECURITY: Requer autenticação
    router.get('/api/clientes/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(
                `SELECT id, COALESCE(nome_fantasia, nome, razao_social) as nome_display,
                        razao_social, nome_fantasia, nome, contato,
                        cnpj, cpf, cnpj_cpf, inscricao_estadual,
                        telefone, email,
                        cep, endereco, bairro, cidade,
                        estado, ativo, data_cadastro, data_ultima_alteracao
                 FROM clientes WHERE id = ?`,
                [id]
            );
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Cliente não encontrado' });
            }
            const c = rows[0];
            res.json({
                id: c.id,
                nome: c.nome_display || '',
                razao_social: c.razao_social || c.nome || c.nome_fantasia || '',
                nome_fantasia: c.nome_fantasia || '',
                contato: c.contato || '',
                cnpj: c.cnpj || c.cnpj_cpf || '',
                cpf: c.cpf || '',
                inscricao_estadual: c.inscricao_estadual || '',
                telefone: c.telefone || '',
                celular: '',
                email: c.email || '',
                email_nfe: c.email || '',
                cep: c.cep || '',
                endereco: c.endereco || '',
                numero: '',
                bairro: c.bairro || '',
                cidade: c.cidade || '',
                uf: c.estado || '',
                ativo: c.ativo === 1 || c.ativo === true
            });
        } catch (error) {
            console.error('❌ Erro ao buscar cliente:', error);
            res.status(500).json({ error: 'Erro ao buscar cliente' });
        }
    });
    
    // API Resumo/Inteligência do Cliente
    // SECURITY: Requer autenticação
    router.get('/api/clientes/:id/resumo', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            console.log(`📊 Buscando resumo do cliente ID: ${id}...`);
    
            // Buscar dados do cliente
            const [clienteRows] = await pool.query(
                `SELECT c.*, e.nome_fantasia as empresa_nome, e.id as emp_id
                 FROM clientes c LEFT JOIN empresas e ON c.empresa_id = e.id
                 WHERE c.id = ?`, [id]
            );
            const cliente = clienteRows[0];
            if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado.' });
    
            const empresaId = cliente.empresa_id || cliente.emp_id || id;
    
            // Executar todas as queries em paralelo
            const [pedidosStats, pedidosRecentes, produtosMaisComprados, pedidosPorStatus, pedidosPorMes, financeiro] = await Promise.all([
                // 1. Estatísticas gerais de pedidos
                pool.query(`
                    SELECT
                        COUNT(*) as total_pedidos,
                        COALESCE(SUM(CASE WHEN status NOT IN ('cancelado') THEN valor ELSE 0 END), 0) as valor_total,
                        COALESCE(AVG(CASE WHEN status NOT IN ('cancelado') THEN valor ELSE NULL END), 0) as ticket_medio,
                        COALESCE(MAX(CASE WHEN status NOT IN ('cancelado') THEN valor ELSE NULL END), 0) as maior_pedido,
                        MIN(created_at) as primeiro_pedido,
                        MAX(created_at) as ultimo_pedido,
                        COUNT(CASE WHEN status IN ('faturado', 'recibo', 'entregue') THEN 1 END) as pedidos_concluidos,
                        COUNT(CASE WHEN status = 'cancelado' THEN 1 END) as pedidos_cancelados,
                        COUNT(CASE WHEN status IN ('orcamento', 'analise', 'analise-credito') THEN 1 END) as pedidos_em_aberto,
                        COUNT(CASE WHEN status IN ('aprovado', 'pedido-aprovado', 'faturar') THEN 1 END) as pedidos_aprovados
                    FROM pedidos
                    WHERE empresa_id = ? OR cliente_id = ?
                `, [empresaId, id]),
    
                // 2. Últimos 10 pedidos
                pool.query(`
                    SELECT p.id, p.valor, p.status, p.created_at, p.produtos_preview, p.descricao
                    FROM pedidos p
                    WHERE p.empresa_id = ? OR p.cliente_id = ?
                    ORDER BY p.created_at DESC
                    LIMIT 10
                `, [empresaId, id]),
    
                // 3. Produtos mais comprados (extraídos do JSON produtos_preview)
                pool.query(`
                    SELECT p.produtos_preview
                    FROM pedidos p
                    WHERE (p.empresa_id = ? OR p.cliente_id = ?) AND p.status NOT IN ('cancelado') AND p.produtos_preview IS NOT NULL
                    ORDER BY p.created_at DESC
                    LIMIT 50
                `, [empresaId, id]),
    
                // 4. Pedidos por status
                pool.query(`
                    SELECT status, COUNT(*) as total, COALESCE(SUM(valor), 0) as valor_total
                    FROM pedidos
                    WHERE empresa_id = ? OR cliente_id = ?
                    GROUP BY status
                    ORDER BY total DESC
                `, [empresaId, id]),
    
                // 5. Pedidos por mês (últimos 12 meses)
                pool.query(`
                    SELECT
                        DATE_FORMAT(created_at, '%Y-%m') as mes,
                        COUNT(*) as total,
                        COALESCE(SUM(valor), 0) as valor_total
                    FROM pedidos
                    WHERE (empresa_id = ? OR cliente_id = ?) AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
                    GROUP BY DATE_FORMAT(created_at, '%Y-%m')
                    ORDER BY mes DESC
                `, [empresaId, id]),
    
                // 6. Financeiro - contas a receber
                pool.query(`
                    SELECT
                        COUNT(*) as total_titulos,
                        COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) as valor_pendente,
                        COALESCE(SUM(CASE WHEN status = 'pago' THEN valor ELSE 0 END), 0) as valor_pago,
                        COALESCE(SUM(CASE WHEN status = 'vencido' OR (status = 'pendente' AND data_vencimento < NOW()) THEN valor ELSE 0 END), 0) as valor_vencido
                    FROM contas_receber
                    WHERE cliente_id = ? OR cliente_id = ?
                `, [id, empresaId])
            ]);
    
            // Processar produtos mais comprados
            const produtosMap = {};
            (produtosMaisComprados[0] || []).forEach(row => {
                try {
                    let produtos = row.produtos_preview;
                    if (typeof produtos === 'string') produtos = JSON.parse(produtos);
                    if (Array.isArray(produtos)) {
                        produtos.forEach(prod => {
                            const nome = prod.nome || prod.descricao || prod.produto || 'Produto sem nome';
                            if (!produtosMap[nome]) {
                                produtosMap[nome] = { nome, quantidade: 0, valor_total: 0 };
                            }
                            produtosMap[nome].quantidade += (prod.quantidade || prod.qtd || 1);
                            produtosMap[nome].valor_total += (prod.valor_total || prod.total || (prod.valor_unitario || prod.preco || 0) * (prod.quantidade || prod.qtd || 1));
                        });
                    }
                } catch(e) { /* ignore parse errors */ }
            });
            const topProdutos = Object.values(produtosMap)
                .sort((a, b) => b.quantidade - a.quantidade)
                .slice(0, 10);
    
            // Calcular tempo como cliente
            const stats = pedidosStats[0][0] || {};
            let tempoCliente = null;
            const dataCadastro = cliente.data_cadastro || cliente.created_at || stats.primeiro_pedido;
            if (dataCadastro) {
                const inicio = new Date(dataCadastro);
                const agora = new Date();
                const diffMs = agora - inicio;
                const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                const anos = Math.floor(diffDias / 365);
                const meses = Math.floor((diffDias % 365) / 30);
                const dias = diffDias % 30;
                tempoCliente = { anos, meses, dias, total_dias: diffDias, data_inicio: dataCadastro };
            }
    
            console.log(`✅ Resumo do cliente ${id}: ${stats.total_pedidos || 0} pedidos, ${topProdutos.length} produtos`);
    
            res.json({
                estatisticas: {
                    total_pedidos: stats.total_pedidos || 0,
                    valor_total: parseFloat(stats.valor_total) || 0,
                    ticket_medio: parseFloat(stats.ticket_medio) || 0,
                    maior_pedido: parseFloat(stats.maior_pedido) || 0,
                    primeiro_pedido: stats.primeiro_pedido,
                    ultimo_pedido: stats.ultimo_pedido,
                    pedidos_concluidos: stats.pedidos_concluidos || 0,
                    pedidos_cancelados: stats.pedidos_cancelados || 0,
                    pedidos_em_aberto: stats.pedidos_em_aberto || 0,
                    pedidos_aprovados: stats.pedidos_aprovados || 0
                },
                tempo_cliente: tempoCliente,
                pedidos_recentes: pedidosRecentes[0] || [],
                produtos_mais_comprados: topProdutos,
                pedidos_por_status: pedidosPorStatus[0] || [],
                pedidos_por_mes: pedidosPorMes[0] || [],
                financeiro: (financeiro[0] && financeiro[0][0]) || { total_titulos: 0, valor_pendente: 0, valor_pago: 0, valor_vencido: 0 }
            });
        } catch (error) {
            console.error('❌ Erro ao buscar resumo do cliente:', error);
            res.status(500).json({ error: 'Erro ao buscar resumo do cliente' });
        }
    });
    
    // API Histórico de Alterações do Cliente
    router.get('/api/clientes/:id/historico', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            // Tentar buscar de tabela de audit/log se existir, senão retornar dados básicos
            try {
                const [rows] = await pool.query(
                    `SELECT * FROM cliente_historico WHERE cliente_id = ? ORDER BY data_alteracao DESC LIMIT 50`, [id]
                );
                res.json({ historico: rows });
            } catch(e) {
                // Tabela não existe - retornar histórico baseado em data_ultima_alteracao do cliente
                const [cliente] = await pool.query(
                    `SELECT id, nome, data_ultima_alteracao, created_at FROM clientes WHERE id = ?`, [id]
                );
                const c = cliente[0];
                const historico = [];
                if (c) {
                    if (c.created_at) {
                        historico.push({ tipo: 'criacao', descricao: 'Cliente cadastrado no sistema', data_alteracao: c.created_at, usuario: 'Sistema' });
                    }
                    if (c.data_ultima_alteracao && c.data_ultima_alteracao !== c.created_at) {
                        historico.push({ tipo: 'atualizacao', descricao: 'Dados do cliente atualizados', data_alteracao: c.data_ultima_alteracao, usuario: 'Sistema' });
                    }
                }
                res.json({ historico });
            }
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            res.status(500).json({ error: 'Erro ao buscar histórico do cliente' });
        }
    });
    
    // API para atualizar cliente existente
    // SECURITY: Requer autenticação
    router.put('/api/clientes/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            console.log(`📋 Atualizando cliente ID: ${id}...`);
    
            const {
                nome, nome_fantasia, contato, cnpj, cpf, inscricao_estadual,
                telefone, celular, email, email_nfe, website,
                cep, endereco, numero, complemento, bairro, cidade, uf, ativo
            } = req.body;
    
            if (!nome) {
                return res.status(400).json({ error: 'Nome é obrigatório' });
            }
    
            const [result] = await pool.query(`
                UPDATE clientes SET
                    nome = ?, nome_fantasia = ?, contato = ?, cnpj = ?, cpf = ?, inscricao_estadual = ?,
                    telefone = ?, celular = ?, email = ?, email_nfe = ?, website = ?,
                    cep = ?, endereco = ?, logradouro = ?, numero = ?, complemento = ?, bairro = ?, cidade = ?, uf = ?, estado = ?, ativo = ?,
                    data_ultima_alteracao = NOW()
                WHERE id = ?
            `, [
                nome, nome_fantasia || null, contato || null, cnpj || null, cpf || null, inscricao_estadual || null,
                telefone || null, celular || null, email || null, email_nfe || null, website || null,
                cep || null, endereco || null, endereco || null, numero || null, complemento || null, bairro || null, cidade || null, uf || null, uf || null,
                ativo !== undefined ? (ativo ? 1 : 0) : 1,
                id
            ]);
    
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Cliente não encontrado' });
            }
    
            console.log(`✅ Cliente ${id} atualizado com sucesso`);
            res.json({ message: 'Cliente atualizado com sucesso' });
    
        } catch (error) {
            console.error('❌ Erro ao atualizar cliente:', error);
            res.status(500).json({ error: 'Erro ao atualizar cliente' });
        }
    });
    
    // API para listar usuários (para avatar no login do PCP)
    // SECURITY: Requer autenticação
    router.get('/users-list', authenticateToken, async (req, res) => {
        try {
            // Buscar usuários de funcionários para exibir avatar no login
            const [users] = await pool.query(`
                SELECT id, nome_completo as nome, email, departamento as role, avatar, foto_perfil_url
                FROM funcionarios
                WHERE ativo = 1 OR ativo IS NULL
                ORDER BY nome_completo
            `);
    
            // Mapear avatares por nome
            const avatarMap = {
                'douglas': '/avatars/douglas.webp',
                'andreia': '/avatars/andreia.webp',
                'ti': '/avatars/ti.webp',
                'clemerson': '/avatars/clemerson.webp',
                'thiago': '/avatars/thiago.webp',
                'guilherme': '/avatars/guilherme.webp',
                'junior': '/avatars/junior.webp',
                'hellen': '/avatars/hellen.webp',
                'antonio': '/avatars/antonio.webp',
                'egidio': '/avatars/egidio.webp'
            };
    
            // Retornar dados sanitizados (sem senhas)
            const sanitizedUsers = users.map(user => {
                const firstName = user.nome ? user.nome.split(' ')[0].toLowerCase() : '';
                let fotoUrl = user.foto_perfil_url || user.avatar || avatarMap[firstName] || '/avatars/default.webp';
    
                return {
                    id: user.id,
                    nome: user.nome,
                    email: user.email,
                    role: user.role,
                    foto_url: fotoUrl
                };
            });
    
            res.json({ users: sanitizedUsers });
        } catch (err) {
            console.error('/api/pcp/users-list error:', err && err.message ? err.message : err);
            res.status(500).json({ message: 'Erro ao obter lista de usuários.', users: [] });
        }
    });
    
    // API para dashboard do PCP - Contadores
    // SECURITY: Requer autenticação
    router.get('/dashboard', authenticateToken, async (req, res) => {
        try {
            console.log('📊 Carregando dashboard PCP...');
    
            // Total de produtos ALUFORCE (marca = 'Aluforce')
            const [produtosResult] = await pool.query("SELECT COUNT(*) as total FROM produtos WHERE marca = 'Aluforce'");
            const totalProdutos = produtosResult[0]?.total || 0;
    
            // Ordens em produção
            const [ordensResult] = await pool.query(`
                SELECT COUNT(*) as total FROM ordens_producao
                WHERE status IN ('em_producao', 'a_produzir', 'em_andamento', 'iniciado')
            `);
            const ordensEmProducao = ordensResult[0]?.total || 0;
    
            // Estoque baixo (produtos com estoque abaixo do mínimo)
            const [estoqueBaixoResult] = await pool.query(`
                SELECT COUNT(*) as total FROM produtos
                WHERE quantidade_estoque < COALESCE(estoque_minimo, 10)
                AND quantidade_estoque >= 0
                AND marca = 'Aluforce'
            `);
            const estoqueBaixo = estoqueBaixoResult[0]?.total || 0;
    
            // Entregas pendentes (esta semana) - usando data_prevista que existe na tabela
            const [entregasResult] = await pool.query(`
                SELECT COUNT(*) as total FROM ordens_producao
                WHERE status NOT IN ('entregue', 'concluido', 'cancelado', 'finalizado')
                AND data_prevista BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
            `);
            const entregasPendentes = entregasResult[0]?.total || 0;
    
            // Total de materiais
            const [materiaisResult] = await pool.query('SELECT COUNT(*) as total FROM materiais');
            const totalMateriais = materiaisResult[0]?.total || 0;
    
            console.log(`📊 Dashboard PCP: Produtos=${totalProdutos}, Ordens=${ordensEmProducao}, Estoque Baixo=${estoqueBaixo}, Entregas=${entregasPendentes}, Materiais=${totalMateriais}`);
    
            res.json({
                totalProdutos,
                ordensEmProducao,
                estoqueBaixo,
                entregasPendentes,
                totalMateriais
            });
        } catch (error) {
            console.error('❌ Erro ao carregar dashboard PCP:', error);
            res.json({
                totalProdutos: 0,
                ordensEmProducao: 0,
                estoqueBaixo: 0,
                entregasPendentes: 0,
                totalMateriais: 0
            });
        }
    });
    
    // ==========================================
    // API DIÁRIO DE PRODUÇÃO - CRUD
    // ==========================================
    
    // GET - Listar registros do diário de produção
    router.get('/diario-producao', authenticateToken, async (req, res) => {
        try {
            const { data, operador_id, status, setor } = req.query;
    
            let query = `
                SELECT dp.*, u.nome as operador_nome
                FROM diario_producao dp
                LEFT JOIN usuarios u ON dp.operador_id = u.id
                WHERE 1=1
            `;
            const params = [];
    
            if (data) {
                query += ' AND dp.data = ?';
                params.push(data);
            }
            if (operador_id) {
                query += ' AND dp.operador_id = ?';
                params.push(operador_id);
            }
            if (status) {
                query += ' AND dp.status = ?';
                params.push(status);
            }
            if (setor) {
                query += ' AND dp.setor = ?';
                params.push(setor);
            }
    
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
    
            // Count query
            const countQuery = query.replace('SELECT dp.*, u.nome as operador_nome', 'SELECT COUNT(*) as total');
            const [[{ total }]] = await pool.query(countQuery, params);
    
            query += ' ORDER BY dp.data DESC, dp.hora_inicio DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);
    
            const [rows] = await pool.query(query, params);
            res.json({ data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('❌ Erro ao listar diário de produção:', error);
            res.status(500).json({ message: 'Erro ao listar registros', error: error.message });
        }
    });
    
    // GET - Buscar registro específico
    router.get('/diario-producao/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(`
                SELECT dp.*, u.nome as operador_nome
                FROM diario_producao dp
                LEFT JOIN usuarios u ON dp.operador_id = u.id
                WHERE dp.id = ?
            `, [id]);
    
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Registro não encontrado' });
            }
            res.json(rows[0]);
        } catch (error) {
            console.error('❌ Erro ao buscar registro:', error);
            res.status(500).json({ message: 'Erro ao buscar registro', error: error.message });
        }
    });
    
    // POST - Criar novo registro
    router.post('/diario-producao', authenticateToken, async (req, res) => {
        try {
            const { titulo, descricao, data, hora_inicio, hora_fim, maquina_id, observacoes, pedido, producao, refugo, setor, tipo_registro } = req.body;
            const operador_id = req.user?.id;
    
            const [result] = await pool.query(`
                INSERT INTO diario_producao
                (titulo, descricao, data, operador_id, hora_inicio, hora_fim, maquina_id, observacoes, pedido, producao, refugo, setor, tipo_registro)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                titulo || 'Registro de Produção',
                descricao,
                data || new Date().toISOString().split('T')[0],
                operador_id,
                hora_inicio,
                hora_fim,
                maquina_id,
                observacoes,
                pedido,
                producao,
                refugo,
                setor || 'producao',
                tipo_registro || 'producao'
            ]);
    
            res.status(201).json({
                message: 'Registro criado com sucesso',
                id: result.insertId
            });
        } catch (error) {
            console.error('❌ Erro ao criar registro:', error);
            res.status(500).json({ message: 'Erro ao criar registro', error: error.message });
        }
    });
    
    // PUT - Atualizar registro
    router.put('/diario-producao/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { titulo, descricao, data, hora_inicio, hora_fim, status, maquina_id, observacoes, pedido, producao, refugo, setor, tipo_registro } = req.body;
    
            const [result] = await pool.query(`
                UPDATE diario_producao SET
                    titulo = COALESCE(?, titulo),
                    descricao = COALESCE(?, descricao),
                    data = COALESCE(?, data),
                    hora_inicio = COALESCE(?, hora_inicio),
                    hora_fim = COALESCE(?, hora_fim),
                    status = COALESCE(?, status),
                    maquina_id = COALESCE(?, maquina_id),
                    observacoes = COALESCE(?, observacoes),
                    pedido = COALESCE(?, pedido),
                    producao = COALESCE(?, producao),
                    refugo = COALESCE(?, refugo),
                    setor = COALESCE(?, setor),
                    tipo_registro = COALESCE(?, tipo_registro)
                WHERE id = ?
            `, [titulo, descricao, data, hora_inicio, hora_fim, status, maquina_id, observacoes, pedido, producao, refugo, setor, tipo_registro, id]);
    
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Registro não encontrado' });
            }
            res.json({ message: 'Registro atualizado com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao atualizar registro:', error);
            res.status(500).json({ message: 'Erro ao atualizar registro', error: error.message });
        }
    });
    
    // DELETE - Excluir registro
    router.delete('/diario-producao/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [result] = await pool.query('DELETE FROM diario_producao WHERE id = ?', [id]);
    
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Registro não encontrado' });
            }
            res.json({ message: 'Registro excluído com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao excluir registro:', error);
            res.status(500).json({ message: 'Erro ao excluir registro', error: error.message });
        }
    });
    
    // API para buscar materiais/produtos
    // SECURITY: Requer autenticação
    router.get('/materiais', authenticateToken, async (req, res) => {
        try {
            console.log('📦 Buscando materiais...');
    
            const { termo, q, tipo, limit: queryLimit } = req.query;
            const busca = termo || q || ''; // Aceitar tanto 'termo' quanto 'q'
            // SECURITY: Limitar range de resultados para evitar abuso (1-2000)
            const limit = Math.min(Math.max(parseInt(queryLimit) || 1000, 1), 2000);
    
            let query = `
                SELECT
                    id,
                    codigo_material,
                    descricao,
                    unidade_medida,
                    custo_unitario,
                    quantidade_estoque,
                    fornecedor_padrao
                FROM materiais
                WHERE 1=1
            `;
            let params = [];
    
            // Filtro por termo de busca
            if (busca && busca.length >= 2) {
                query += ` AND (codigo_material LIKE ? OR descricao LIKE ?)`;
                const termoLike = `%${busca}%`;
                params.push(termoLike, termoLike);
            }
    
            // Filtro por tipo (Veias, Cabos, Cordas, Outros)
            if (tipo) {
                const tipoLower = tipo.toLowerCase();
                if (tipoLower === 'veias') {
                    query += ` AND (descricao LIKE '%VEIA%' OR descricao LIKE '%MULTIPLEX%')`;
                } else if (tipoLower === 'cabos') {
                    query += ` AND descricao LIKE '%CABO%'`;
                } else if (tipoLower === 'cordas') {
                    query += ` AND (descricao LIKE '%CORDA%' OR descricao LIKE '%CORDINHA%')`;
                } else if (tipoLower === 'outros') {
                    query += ` AND descricao NOT LIKE '%VEIA%' AND descricao NOT LIKE '%MULTIPLEX%' AND descricao NOT LIKE '%CABO%' AND descricao NOT LIKE '%CORDA%' AND descricao NOT LIKE '%CORDINHA%'`;
                }
            }
    
            query += ` ORDER BY descricao LIMIT ${limit}`;
    
            console.log('📦 Query materiais:', query, 'Params:', params);
    
            const [materiais] = await pool.query(query, params);
    
            // Formatar resposta
            const materiaisFormatados = materiais.map(material => ({
                id: material.id,
                codigo_material: material.codigo_material || '',
                descricao: material.descricao || '',
                unidade_medida: material.unidade_medida || 'UN',
                preco_unitario: parseFloat(material.custo_unitario) || 0,
                quantidade_estoque: parseFloat(material.quantidade_estoque) || 0,
                fornecedor_padrao: material.fornecedor_padrao || '',
                categoria: 'Material'
            }));
    
            console.log(`✅ Encontrados ${materiaisFormatados.length} materiais`);
            res.json(materiaisFormatados);
    
        } catch (error) {
            console.error('❌ Erro ao buscar materiais:', error);
    
            // Fallback com dados de exemplo
            const materiaisExemplo = [
                {
                    id: 1,
                    codigo_material: 'ALU-001',
                    descricao: 'Perfil de Alumínio 20x20mm',
                    unidade_medida: 'M',
                    preco_unitario: 15.50,
                    quantidade_estoque: 100,
                    fornecedor_padrao: 'ALUFORCE',
                    categoria: 'Perfis'
                },
                {
                    id: 2,
                    codigo_material: 'ALU-002',
                    descricao: 'Chapa de Alumínio 2mm',
                    unidade_medida: 'M2',
                    preco_unitario: 85.00,
                    quantidade_estoque: 50,
                    fornecedor_padrao: 'ALUFORCE',
                    categoria: 'Chapas'
                }
            ];
    
            res.json(materiaisExemplo);
        }
    });
    
    // API para buscar produtos com entrada registrada (movimentações de estoque)
    // SECURITY: Requer autenticação
    router.get('/produtos/com-entrada', authenticateToken, async (req, res) => {
        console.log('[API_PRODUTOS_COM_ENTRADA] Requisição recebida');
        try {
            let page = parseInt(req.query.page, 10) || 1;
            let limit = parseInt(req.query.limit, 10) || 1000;
            if (page < 1) page = 1;
            if (limit < 1) limit = 10;
            const offset = (page - 1) * limit;
    
            let rows = [];
            let total = 0;
            let strategy = 'none';
    
            // Tentativa 1: tabela estoque_movimentacoes (com COLLATE para resolver mix de collations)
            if (total === 0) {
                try {
                    const sql1 = `
                        SELECT DISTINCT p.*
                        FROM produtos p
                        INNER JOIN estoque_movimentacoes em ON (
                            p.codigo COLLATE utf8mb4_general_ci = em.codigo_material COLLATE utf8mb4_general_ci
                            OR CAST(p.id AS CHAR) COLLATE utf8mb4_general_ci = em.codigo_material COLLATE utf8mb4_general_ci
                        )
                        WHERE em.tipo_movimento = 'entrada'
                        ORDER BY p.descricao ASC
                        LIMIT ? OFFSET ?
                    `;
                    [rows] = await pool.query(sql1, [limit, offset]);
    
                    const [countResult] = await pool.query(`
                        SELECT COUNT(DISTINCT p.id) as total
                        FROM produtos p
                        INNER JOIN estoque_movimentacoes em ON (
                            p.codigo COLLATE utf8mb4_general_ci = em.codigo_material COLLATE utf8mb4_general_ci
                            OR CAST(p.id AS CHAR) COLLATE utf8mb4_general_ci = em.codigo_material COLLATE utf8mb4_general_ci
                        )
                        WHERE em.tipo_movimento = 'entrada'
                    `);
                    total = countResult[0]?.total || 0;
                    if (total > 0) strategy = 'estoque_movimentacoes';
                    console.log('[API_PRODUTOS_COM_ENTRADA] Tentativa 1 (estoque_movimentacoes):', total);
                } catch (err1) {
                    console.warn('[API_PRODUTOS_COM_ENTRADA] estoque_movimentacoes falhou:', err1.message);
                }
            }

            // Tentativa 2: tabela movimentacoes_estoque (nome alternativo)
            if (total === 0) {
                try {
                    const sql2 = `
                        SELECT DISTINCT p.id, p.codigo, p.nome, p.descricao, p.categoria,
                               p.gtin, p.sku, p.estoque_atual, p.estoque_minimo,
                               p.preco_custo, p.unidade_medida, p.status
                        FROM produtos p
                        INNER JOIN movimentacoes_estoque me ON me.produto_id = p.id
                        WHERE (me.tipo = 'entrada' OR me.tipo = 'ENTRADA')
                        AND p.status = 'ativo'
                        ORDER BY p.nome ASC
                        LIMIT ? OFFSET ?
                    `;
                    [rows] = await pool.query(sql2, [limit, offset]);
    
                    const [countResult2] = await pool.query(`
                        SELECT COUNT(DISTINCT p.id) as total
                        FROM produtos p
                        INNER JOIN movimentacoes_estoque me ON me.produto_id = p.id
                        WHERE (me.tipo = 'entrada' OR me.tipo = 'ENTRADA')
                        AND p.status = 'ativo'
                    `);
                    total = countResult2[0]?.total || 0;
                    if (total > 0) strategy = 'movimentacoes_estoque';
                    console.log('[API_PRODUTOS_COM_ENTRADA] Tentativa 2 (movimentacoes_estoque):', total);
                } catch (err2) {
                    console.warn('[API_PRODUTOS_COM_ENTRADA] movimentacoes_estoque falhou:', err2.message);
                }
            }

            // Tentativa 3: produtos com estoque > 0 diretamente
            if (total === 0) {
                try {
                    const sql3 = `
                        SELECT id, codigo, nome, descricao, unidade_medida as unidade, estoque_atual, quantidade_estoque, estoque_minimo, categoria, status
                        FROM produtos
                        WHERE (estoque_atual > 0 OR quantidade_estoque > 0)
                        AND (status = 'ativo' OR status IS NULL)
                        ORDER BY COALESCE(descricao, nome) ASC
                        LIMIT ? OFFSET ?
                    `;
                    [rows] = await pool.query(sql3, [limit, offset]);
    
                    const [countResult3] = await pool.query(`
                        SELECT COUNT(*) as total FROM produtos
                        WHERE (estoque_atual > 0 OR quantidade_estoque > 0)
                        AND (status = 'ativo' OR status IS NULL)
                    `);
                    total = countResult3[0]?.total || 0;
                    if (total > 0) strategy = 'estoque_direto';
                    console.log('[API_PRODUTOS_COM_ENTRADA] Tentativa 3 (estoque > 0):', total);
                } catch (err3) {
                    console.warn('[API_PRODUTOS_COM_ENTRADA] estoque direto falhou:', err3.message);
                }
            }

            // Tentativa 4: produtos que possuem bobinas/rolos em bobinas_estoque (estoque real)
            if (total === 0) {
                try {
                    console.log('[API_PRODUTOS_COM_ENTRADA] Buscando produtos com bobinas em estoque...');
                    const sql4 = `
                        SELECT p.id, p.codigo, p.nome, p.descricao, p.unidade_medida as unidade,
                               p.estoque_atual, p.quantidade_estoque, p.estoque_minimo, p.categoria, p.status,
                               COUNT(b.id) as total_bobinas,
                               SUM(CASE WHEN b.tipo = 'bobina' THEN 1 ELSE 0 END) as qtd_bobinas,
                               SUM(CASE WHEN b.tipo = 'rolo' THEN 1 ELSE 0 END) as qtd_rolos,
                               COALESCE(SUM(b.quantidade), 0) as quantidade_total
                        FROM produtos p
                        INNER JOIN bobinas_estoque b ON b.produto_id = p.id
                        WHERE (p.status = 'ativo' OR p.status IS NULL)
                        GROUP BY p.id
                        ORDER BY COUNT(b.id) DESC, COALESCE(p.descricao, p.nome) ASC
                        LIMIT ? OFFSET ?
                    `;
                    [rows] = await pool.query(sql4, [limit, offset]);

                    const [countResult4] = await pool.query(`
                        SELECT COUNT(DISTINCT b.produto_id) as total
                        FROM bobinas_estoque b
                        INNER JOIN produtos p ON p.id = b.produto_id
                        WHERE (p.status = 'ativo' OR p.status IS NULL)
                    `);
                    total = countResult4[0]?.total || 0;
                    strategy = 'bobinas_estoque';
                    console.log('[API_PRODUTOS_COM_ENTRADA] Tentativa 4 (bobinas_estoque):', total);
                } catch (err4) {
                    console.warn('[API_PRODUTOS_COM_ENTRADA] bobinas_estoque falhou:', err4.message);
                }
            }
    
            // Calcular estatísticas
            let comEstoque = 0, estoqueBaixo = 0, critico = 0;
            rows.forEach(p => {
                const qtd = Number(p.estoque_atual || p.quantidade || p.estoque || 0);
                const min = Number(p.estoque_minimo || 10);
                if (qtd <= min * 0.25) critico++;
                else if (qtd <= min) estoqueBaixo++;
                else comEstoque++;
            });
    
            console.log('[API_PRODUTOS_COM_ENTRADA] Total:', total, 'Retornados:', rows.length, 'Strategy:', strategy);
            res.json({
                page,
                limit,
                total,
                rows,
                produtos: rows,
                strategy,
                stats: {
                    total_produtos: total,
                    com_estoque: comEstoque,
                    estoque_baixo: estoqueBaixo,
                    critico: critico
                }
            });
        } catch (error) {
            console.error('[API_PRODUTOS_COM_ENTRADA] Erro crítico:', error.message);
            // Em último caso, retornar vazio em vez de 500
            res.json({
                page: 1,
                limit: 1000,
                total: 0,
                rows: [],
                produtos: [],
                stats: { total_produtos: 0, com_estoque: 0, estoque_baixo: 0, critico: 0 }
            });
        }
    });
    
    // API para buscar movimentações de estoque de um produto
    // SECURITY: Requer autenticação
    router.get('/estoque/movimentacoes', authenticateToken, async (req, res) => {
        console.log('[API_ESTOQUE_MOVIMENTACOES] Requisição recebida:', req.query);
        try {
            const { produto_id, codigo_material, limit = 20 } = req.query;
    
            if (!produto_id && !codigo_material) {
                return res.status(400).json({
                    success: false,
                    message: 'Informe produto_id ou codigo_material'
                });
            }
    
            // Buscar código do produto se foi passado o ID
            let codigoMaterial = codigo_material;
            if (produto_id && !codigo_material) {
                const [[produto]] = await pool.query(
                    'SELECT codigo FROM produtos WHERE id = ?',
                    [produto_id]
                );
                codigoMaterial = produto?.codigo || produto_id;
            }
    
            // Buscar movimentações
            const sql = `
                SELECT em.*,
                       u.nome as usuario_nome,
                       DATE_FORMAT(em.data_movimento, '%d/%m/%Y %H:%i') as data_formatada
                FROM estoque_movimentacoes em
                LEFT JOIN usuarios u ON em.usuario_id = u.id
                WHERE em.codigo_material = ? OR em.codigo_material = ?
                ORDER BY em.data_movimento DESC
                LIMIT ?
            `;
    
            const [rows] = await pool.query(sql, [codigoMaterial, String(produto_id), parseInt(limit)]);
    
            console.log('[API_ESTOQUE_MOVIMENTACOES] Encontradas', rows.length, 'movimentações para', codigoMaterial);
    
            res.json({
                success: true,
                movimentacoes: rows,
                total: rows.length
            });
    
        } catch (error) {
            console.error('[API_ESTOQUE_MOVIMENTACOES] Erro:', error.message);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar movimentações',
                error: error.message
            });
        }
    });
    
    // API para buscar todos os produtos (PCP)
    // SECURITY: Requer autenticação
    router.get('/produtos', authenticateToken, async (req, res) => {
        try {
            let page = parseInt(req.query.page, 10) || 1;
            let limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
            if (page < 1) page = 1;
            if (limit < 1) limit = 10;
            const offset = (page - 1) * limit;
    
            const q = (req.query.q || '').trim();
            const like = `%${q}%`;
    
            let sql = 'SELECT id, codigo, nome, descricao, sku, gtin, unidade_medida as unidade, COALESCE(preco_venda, preco_custo, 0) as preco, status, familia, categoria, estoque_atual, estoque_minimo FROM produtos';
            let params = [];
    
            if (q) {
                sql += ' WHERE codigo LIKE ? OR descricao LIKE ? OR nome LIKE ?';
                params.push(like, like, like);
            }
    
            sql += ' ORDER BY descricao ASC LIMIT ? OFFSET ?';
            params.push(limit, offset);
    
            const [rows] = await pool.query(sql, params);
    
            // Contar total
            let countSql = 'SELECT COUNT(*) as total FROM produtos';
            let countParams = [];
            if (q) {
                countSql += ' WHERE codigo LIKE ? OR descricao LIKE ? OR nome LIKE ?';
                countParams.push(like, like, like);
            }
            const [countResult] = await pool.query(countSql, countParams);
            const total = countResult[0]?.total || 0;
    
            console.log('[API_PCP_PRODUTOS] Total:', total, 'Retornados:', rows.length);
            res.json({ page, limit, total, rows });
        } catch (error) {
            console.error('[API_PCP_PRODUTOS] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao buscar produtos.', error: error.message });
        }
    });
    
    // API para buscar transportadoras
    router.get('/api/transportadoras', authenticateToken, async (req, res) => {
        try {
            console.log('🚛 Buscando transportadoras para autocomplete...');
            const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
    
            const { termo } = req.query;
            let query = `
                SELECT
                    id,
                    razao_social,
                    nome_fantasia,
                    contato,
                    cnpj_cpf,
                    inscricao_estadual,
                    telefone,
                    email,
                    bairro,
                    cidade,
                    estado,
                    cep
                FROM transportadoras
                WHERE 1=1
            `;
            let params = [];
    
            if (termo && termo.length >= 2) {
                // Buscar por nome (não por cnpj_cpf que está criptografado)
                query += ` AND (razao_social LIKE ? OR nome_fantasia LIKE ?)`;
                const termoLike = `%${termo}%`;
                params = [termoLike, termoLike];
            }
    
            query += ' ORDER BY razao_social LIMIT 50';
    
            const [transportadoras] = await pool.query(query, params);
    
            // Formatar resposta com descriptografia LGPD
            const transportadorasFormatadas = transportadoras.map(transp => ({
                id: transp.id,
                nome: transp.razao_social || transp.nome_fantasia || '',
                nome_empresa: transp.razao_social || '',
                razao_social: transp.razao_social || '',
                nome_fantasia: transp.nome_fantasia || '',
                contato: transp.contato || '',
                cnpj: _dec(transp.cnpj_cpf || ''),
                inscricao_estadual: _dec(transp.inscricao_estadual || ''),
                telefone: transp.telefone || '',
                fone: transp.telefone || '',
                email: transp.email || '',
                endereco: transp.bairro && transp.cidade ? `${transp.bairro}, ${transp.cidade}/${transp.estado}` : `${transp.cidade || ''}/${transp.estado || ''}`,
                cidade: transp.cidade || '',
                estado: transp.estado || '',
                cep: transp.cep || ''
            }));
    
            console.log(`✅ Encontradas ${transportadorasFormatadas.length} transportadoras`);
            res.json(transportadorasFormatadas);
    
        } catch (error) {
            console.error('❌ Erro ao buscar transportadoras:', error);
            res.json([]);
        }
    });
    
    // =================== ENDPOINTS DE COMPATIBILIDADE ===================
    // Aliases para os endpoints esperados pelo frontend
    
    // Alias para empresas/buscar -> clientes
    router.get('/api/empresas/buscar', authenticateToken, async (req, res) => {
        try {
            console.log('🔄 Redirecionando /api/empresas/buscar para /api/clientes');
    
            const { termo } = req.query;
            let query = "SELECT id, nome, razao_social, nome_fantasia, contato, cnpj_cpf as cnpj, cnpj_cpf as cpf, telefone, telefone as celular, email, email as email_nfe, endereco, endereco as logradouro, '' as numero, bairro, cidade, estado as uf, estado, cep FROM clientes WHERE ativo = 1";
            let params = [];
    
            if (termo && termo.length >= 1) { // Funciona com 1 caractere
                query += ` AND (nome LIKE ? OR cnpj_cpf LIKE ? OR contato LIKE ?)`;
                const termoLike = `%${termo}%`;
                params = [termoLike, termoLike, termoLike];
            }
    
            query += ' ORDER BY nome LIMIT 50';
    
            const [clientes] = await pool.query(query, params);
    
            // Formatar resposta com mapeamento de campos
            const clientesFormatados = clientes.map(cliente => ({
                id: cliente.id,
                nome: cliente.nome || '',
                razao_social: cliente.nome || '', // Campo alternativo esperado
                nome_fantasia: cliente.nome || '',
                contato: cliente.contato || '',
                nome_contato: cliente.contato || '',
                cnpj: cliente.cnpj || '',
                cpf: cliente.cpf || '',
                telefone: cliente.telefone || '',
                celular: cliente.celular || '',
                fone: cliente.telefone || cliente.celular || '',
                email: cliente.email || '',
                email_nfe: cliente.email_nfe || cliente.email || '',
                endereco: cliente.endereco || '',
                logradouro: cliente.logradouro || '',
                numero: cliente.numero || '',
                bairro: cliente.bairro || '',
                cidade: cliente.cidade || '',
                uf: cliente.uf || cliente.estado || '',
                estado: cliente.estado || cliente.uf || '',
                cep: cliente.cep || ''
            }));
    
            console.log(`✅ Endpoint /api/empresas/buscar retornou ${clientesFormatados.length} registros`);
            res.json(clientesFormatados);
    
        } catch (error) {
            console.error('❌ Erro em /api/empresas/buscar:', error);
            res.status(500).json({ error: 'Erro ao buscar empresas' });
        }
    });
    
    // Backwards-compatible endpoint: /api/empresas (aceita ?limit=... e ?termo=...)
    router.get('/api/empresas', authenticateToken, async (req, res) => {
        try {
            console.log('🔄 Alias compatível /api/empresas chamado');
            const { termo } = req.query;
            const limit = req.query.limit ? Math.max(1, Math.min(1000, parseInt(req.query.limit))) : 500;
    
            let query = "SELECT id, nome, razao_social, nome_fantasia, contato, cnpj_cpf as cnpj, cnpj_cpf as cpf, telefone, telefone as celular, email, email as email_nfe, endereco, endereco as logradouro, '' as numero, bairro, cidade, estado as uf, estado, cep FROM clientes WHERE ativo = 1";
            let params = [];
            if (termo && termo.length >= 1) {
                query += ` AND (nome LIKE ? OR cnpj_cpf LIKE ? OR contato LIKE ?)`;
                const termoLike = `%${termo}%`;
                params = [termoLike, termoLike, termoLike];
            }
    
            query += ' ORDER BY nome LIMIT ' + limit;
    
            const [clientes] = await pool.query(query, params);
    
            const clientesFormatados = clientes.map(cliente => ({
                id: cliente.id,
                nome: cliente.nome || '',
                razao_social: cliente.nome || '',
                nome_fantasia: cliente.nome || '',
                contato: cliente.contato || '',
                nome_contato: cliente.contato || '',
                cnpj: cliente.cnpj || '',
                cpf: cliente.cpf || '',
                telefone: cliente.telefone || '',
                celular: cliente.celular || '',
                fone: cliente.telefone || cliente.celular || '',
                email: cliente.email || '',
                email_nfe: cliente.email_nfe || cliente.email || '',
                endereco: cliente.endereco || '',
                logradouro: cliente.logradouro || '',
                numero: cliente.numero || '',
                bairro: cliente.bairro || '',
                cidade: cliente.cidade || '',
                uf: cliente.uf || cliente.estado || '',
                estado: cliente.estado || cliente.uf || '',
                cep: cliente.cep || ''
            }));
    
            console.log(`✅ Endpoint /api/empresas retornou ${clientesFormatados.length} registros (limit=${limit})`);
            res.json(clientesFormatados);
        } catch (error) {
            console.error('❌ Erro em /api/empresas:', error);
            res.status(500).json({ error: 'Erro ao buscar empresas' });
        }
    });
    
    // Alias para transportadoras/buscar -> transportadoras
    router.get('/api/transportadoras/buscar', authenticateToken, async (req, res) => {
        try {
            console.log('🔄 Buscando transportadoras via /buscar...');
            const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
    
            const { termo } = req.query;
            let query = `
                SELECT
                    id,
                    razao_social,
                    nome_fantasia,
                    contato,
                    cnpj_cpf,
                    inscricao_estadual,
                    telefone,
                    email,
                    endereco,
                    bairro,
                    cidade,
                    estado,
                    cep
                FROM transportadoras
                WHERE 1=1
            `;
            let params = [];
    
            if (termo && termo.length >= 1) {
                // Buscar apenas por nome (cnpj está criptografado, LIKE não funciona)
                query += ` AND (razao_social LIKE ? OR nome_fantasia LIKE ?)`;
                const termoLike = `%${termo}%`;
                params = [termoLike, termoLike];
            }
    
            query += ' ORDER BY razao_social LIMIT 50';
    
            const [transportadoras] = await pool.query(query, params);
    
            // Formatar resposta com descriptografia LGPD
            const transportadorasFormatadas = transportadoras.map(transp => ({
                id: transp.id,
                nome_empresa: transp.razao_social || transp.nome_fantasia || '',
                nome: transp.razao_social || transp.nome_fantasia || '',
                contato: transp.contato || '',
                cnpj: _dec(transp.cnpj_cpf || ''),
                inscricao_estadual: _dec(transp.inscricao_estadual || ''),
                telefone: transp.telefone || '',
                email: transp.email || '',
                endereco: transp.endereco || (transp.bairro && transp.cidade ? `${transp.bairro}, ${transp.cidade}/${transp.estado}` : `${transp.cidade || ''}/${transp.estado || ''}`),
                cep: transp.cep || ''
            }));
    
            console.log(`✅ /api/transportadoras/buscar retornou ${transportadorasFormatadas.length} registros`);
            res.json(transportadorasFormatadas);
    
        } catch (error) {
            console.error('❌ Erro em /api/transportadoras/buscar:', error);
            res.json([]);
        }
    });
    
    // Alias para produtos/buscar -> busca em produtos + materiais
    router.get('/api/produtos/buscar', authenticateToken, async (req, res) => {
        try {
            console.log('🔄 Buscando em produtos e materiais...');
    
            const { termo } = req.query;
            let produtosCombinados = [];
    
            // 1. Buscar na tabela produtos
            try {
                let queryProdutos = `
                    SELECT
                        id,
                        codigo,
                        nome,
                        variacao,
                        marca,
                        descricao,
                        gtin,
                        sku
                    FROM produtos
                    WHERE 1=1
                `;
                let paramsProdutos = [];
    
                if (termo && termo.length >= 1) {
                    queryProdutos += ` AND (codigo LIKE ? OR nome LIKE ? OR descricao LIKE ?)`;
                    const termoLike = `%${termo}%`;
                    paramsProdutos = [termoLike, termoLike, termoLike];
                }
    
                queryProdutos += ' ORDER BY nome LIMIT 50';
    
                const [produtos] = await pool.query(queryProdutos, paramsProdutos);
    
                // Formatar produtos
                const produtosFormatados = produtos.map(produto => ({
                    id: `p_${produto.id}`, // Prefixo para distinguir de materiais
                    codigo: produto.codigo || '',
                    codigo_material: produto.codigo || '',
                    descricao: produto.nome || produto.descricao || '',
                    nome: produto.nome || produto.descricao || '',
                    unidade_medida: 'UN',
                    preco: 0,
                    preco_unitario: 0,
                    estoque: 0,
                    quantidade_estoque: 0,
                    fornecedor: produto.marca || '',
                    categoria: produto.marca || 'Produto',
                    tipo: 'produto',
                    variacao: produto.variacao || '',
                    gtin: produto.gtin || '',
                    sku: produto.sku || ''
                }));
    
                produtosCombinados = [...produtosCombinados, ...produtosFormatados];
                console.log(`✅ Encontrados ${produtosFormatados.length} produtos`);
    
            } catch (errorProdutos) {
                console.log(`⚠️ Erro ao buscar produtos: ${errorProdutos.message}`);
            }
    
            // 2. Buscar na tabela materiais
            try {
                let queryMateriais = `
                    SELECT
                        id,
                        codigo_material,
                        descricao,
                        unidade_medida,
                        custo_unitario,
                        quantidade_estoque,
                        fornecedor_padrao
                    FROM materiais
                    WHERE 1=1
                `;
                let paramsMateriais = [];
    
                if (termo && termo.length >= 1) {
                    queryMateriais += ` AND (codigo_material LIKE ? OR descricao LIKE ?)`;
                    const termoLike = `%${termo}%`;
                    paramsMateriais = [termoLike, termoLike];
                }
    
                queryMateriais += ' ORDER BY codigo_material LIMIT 25';
    
                const [materiais] = await pool.query(queryMateriais, paramsMateriais);
    
                // Formatar materiais
                const materiaisFormatados = materiais.map(material => ({
                    id: `m_${material.id}`, // Prefixo para distinguir de produtos
                    codigo: material.codigo_material || '',
                    codigo_material: material.codigo_material || '',
                    descricao: material.descricao || '',
                    nome: material.descricao || '',
                    unidade_medida: material.unidade_medida || 'UN',
                    preco: parseFloat(material.custo_unitario) || 0,
                    preco_unitario: parseFloat(material.custo_unitario) || 0,
                    estoque: parseFloat(material.quantidade_estoque) || 0,
                    quantidade_estoque: parseFloat(material.quantidade_estoque) || 0,
                    fornecedor: material.fornecedor_padrao || '',
                    categoria: 'Material',
                    tipo: 'material'
                }));
    
                produtosCombinados = [...produtosCombinados, ...materiaisFormatados];
                console.log(`✅ Encontrados ${materiaisFormatados.length} materiais`);
    
            } catch (errorMateriais) {
                console.log(`⚠️ Erro ao buscar materiais: ${errorMateriais.message}`);
            }
    
            // Ordenar por relevância (produtos primeiro, depois materiais)
            produtosCombinados.sort((a, b) => {
                if (a.tipo === 'produto' && b.tipo === 'material') return -1;
                if (a.tipo === 'material' && b.tipo === 'produto') return 1;
                return a.nome.localeCompare(b.nome);
            });
    
            console.log(`✅ Total de produtos+materiais encontrados: ${produtosCombinados.length}`);
            res.json(produtosCombinados);
    
        } catch (error) {
            console.error('❌ Erro em /api/produtos/buscar:', error);
    
            // Fallback com dados de exemplo
            const produtosExemplo = [
                {
                    id: 1,
                    codigo: 'CABO-01',
                    codigo_material: 'CABO-01',
                    descricao: 'Cabo de Aço Galvanizado 6mm',
                    nome: 'Cabo de Aço Galvanizado 6mm',
                    unidade_medida: 'MT',
                    preco: 15.50,
                    preco_unitario: 15.50,
                    estoque: 150,
                    quantidade_estoque: 150,
                    categoria: 'Cabos'
                }
            ];
    
            res.json(produtosExemplo);
        }
    });
    
    console.log('✅ Endpoints de compatibilidade criados:');
    console.log('   📍 /api/empresas/buscar -> /api/clientes');
    console.log('   📍 /api/transportadoras/buscar -> /api/transportadoras');
    console.log('   📍 /api/produtos/buscar -> /api/pcp/materiais');
    
    // =================== API PARA PRODUTOS REAIS DA TABELA PRODUTOS ===================
    
    // API para buscar produtos da tabela 'produtos' (diferente de materiais)
    // SECURITY: Requer autenticação
    router.get('/api/produtos', authenticateToken, async (req, res) => {
        try {
            console.log('🛍️ Buscando produtos da tabela produtos...');
    
            const { termo } = req.query;
            // permitir ?limit=NUM (padrão 1000) ou ?limit=0 para sem LIMIT
            const rawLimit = req.query.limit;
            let limitParam = typeof rawLimit !== 'undefined' ? parseInt(rawLimit) : 1000;
            if (isNaN(limitParam) || limitParam < 0) limitParam = 1000;
    
            let query = `
                SELECT
                    id,
                    codigo,
                    nome,
                    variacao,
                    marca,
                    descricao,
                    gtin,
                    sku,
                    custo_unitario
                FROM produtos
                WHERE 1=1
            `;
            let params = [];
    
            if (termo && termo.length >= 1) { // Funciona com 1 caractere
                query += ` AND (codigo LIKE ? OR nome LIKE ? OR descricao LIKE ?)`;
                const termoLike = `%${termo}%`;
                params = [termoLike, termoLike, termoLike];
            }
    
            // Se limitParam for 0 => sem LIMIT (retorna todos). Caso contrário, aplica LIMIT.
            if (limitParam === 0) {
                query += ' ORDER BY nome';
            } else {
                query += ' ORDER BY nome LIMIT ?';
                params.push(limitParam);
            }
    
            const [produtos] = await pool.query(query, params);
    
            // Formatar resposta compatível com frontend
            const produtosFormatados = produtos.map(produto => {
                // Tentar obter preço da coluna custo_unitario
                const preco = produto.custo_unitario || 0;
    
                return {
                    id: produto.id,
                    codigo: produto.codigo || '',
                    nome: produto.nome || '',
                    descricao: produto.descricao || produto.nome || '',
                    variacao: produto.variacao || '',
                    marca: produto.marca || '',
                    gtin: produto.gtin || '',
                    sku: produto.sku || '',
                    preco: parseFloat(preco) || 0,
                    preco_unitario: parseFloat(preco) || 0,
                    categoria: produto.marca || 'Produto'
                };
            });
    
            console.log(`✅ Endpoint /api/produtos retornou ${produtosFormatados.length} registros`);
    
            // Formato compatível com frontend que espera {rows: [...]}
            res.json({
                rows: produtosFormatados,
                items: produtosFormatados,
                total: produtosFormatados.length
            });
    
        } catch (error) {
            console.error('❌ Erro ao buscar produtos:', error);
    
            // Fallback com produtos reais do catálogo
            const produtosFallback = [
                {
                    id: 1,
                    codigo: 'DUN10',
                    nome: 'CABO DUPLEX NEUTRO NU 2x10mm² LABOR 0,6/1KV',
                    descricao: 'Cabo multiplexado duplex com neutro nu, condutor de alumínio',
                    variacao: 'Preto / Nu',
                    marca: 'Aluforce',
                    gtin: '789' + Date.now().toString().slice(-10),
                    sku: 'SKU-DUN10',
                    preco: 28.90,
                    preco_unitario: 28.90,
                    categoria: 'DUPLEX'
                },
                {
                    id: 2,
                    codigo: 'TRI25',
                    nome: 'CABO TRIPLEX 3x25mm² (2#25 + 1#25) LABOR 0,6/1KV',
                    descricao: 'Cabo multiplexado triplex, condutor de alumínio',
                    variacao: 'Preto / Preto / Nu',
                    marca: 'Aluforce',
                    gtin: '789' + Date.now().toString().slice(-10),
                    sku: 'SKU-TRI25',
                    preco: 65.90,
                    preco_unitario: 65.90,
                    categoria: 'TRIPLEX'
                },
                {
                    id: 3,
                    codigo: 'QDN50',
                    nome: 'CABO QUADRUPLEX NEUTRO NU 3x50mm² + 1x50mm² LABOR 0,6/1KV',
                    descricao: 'Cabo multiplexado quadruplex com neutro nu, condutor de alumínio',
                    variacao: 'Preto / Preto / Preto / Nu',
                    marca: 'Aluforce',
                    gtin: '789' + Date.now().toString().slice(-10),
                    sku: 'SKU-QDN50',
                    preco: 125.50,
                    preco_unitario: 125.50,
                    categoria: 'QUADRUPLEX'
                },
                {
                    id: 4,
                    codigo: 'DUN10_LAB',
                    nome: 'CABO DUPLEX NEUTRO NU 2x10mm² LABOR 0,6/1KV',
                    descricao: 'Cabo multiplexado duplex com neutro nu - LABOR ENERGY',
                    variacao: 'Preto / Nu',
                    marca: 'Labor Energy',
                    gtin: '789' + Date.now().toString().slice(-10),
                    sku: 'SKU-DUN10_LAB',
                    preco: 25.70,
                    preco_unitario: 25.70,
                    categoria: 'DUPLEX'
                },
                {
                    id: 5,
                    codigo: 'TRI25_LAB',
                    nome: 'CABO TRIPLEX 3x25mm² (2#25 + 1#25) LABOR 0,6/1KV',
                    descricao: 'Cabo multiplexado triplex - LABOR ENERGY',
                    variacao: 'Preto / Preto / Nu',
                    marca: 'Labor Energy',
                    gtin: '789' + Date.now().toString().slice(-10),
                    sku: 'SKU-TRI25_LAB',
                    preco: 62.70,
                    preco_unitario: 62.70,
                    categoria: 'TRIPLEX'
                }
            ];
    
            res.json(produtosFallback);
        }
    });
    
    // ========== ROTAS BOBINAS CAPACIDADE ==========
    // GET /api/pcp/bobinas/categorias - Listar categorias disponíveis
    router.get('/bobinas/categorias', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT DISTINCT categoria, norma FROM bobinas_capacidade ORDER BY categoria');
            res.json(rows);
        } catch (error) {
            console.error('[BOBINAS] Erro ao listar categorias:', error.message);
            res.status(500).json({ error: 'Erro ao listar categorias' });
        }
    });
    
    // GET /api/pcp/bobinas/secoes/:categoria - Listar seções de uma categoria
    router.get('/bobinas/secoes/:categoria', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query(
                'SELECT secao, diametro_mm FROM bobinas_capacidade WHERE categoria = ? ORDER BY CAST(secao AS UNSIGNED)',
                [req.params.categoria]
            );
            res.json(rows);
        } catch (error) {
            console.error('[BOBINAS] Erro ao listar seções:', error.message);
            res.status(500).json({ error: 'Erro ao listar seções' });
        }
    });
    
    // POST /api/pcp/bobinas/calcular - Calcular bobina ideal
    router.post('/bobinas/calcular', authenticateToken, async (req, res) => {
        try {
            const { categoria, secao, metragem } = req.body;
    
            if (!categoria || !secao || !metragem) {
                return res.status(400).json({ error: 'categoria, secao e metragem são obrigatórios' });
            }
    
            const metrosDesejados = parseFloat(metragem);
            if (isNaN(metrosDesejados) || metrosDesejados <= 0) {
                return res.status(400).json({ error: 'metragem deve ser um número positivo' });
            }
    
            const [rows] = await pool.query(
                'SELECT * FROM bobinas_capacidade WHERE categoria = ? AND secao = ?',
                [categoria, secao]
            );
    
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Combinação categoria/seção não encontrada' });
            }
    
            const dados = rows[0];
    
            // Definir bobinas disponíveis com seus nomes
            const bobinas = [
                { nome: '65/25', campo: 'bob_65_25', capacidade: parseFloat(dados.bob_65_25) || 0 },
                { nome: '630',   campo: 'bob_630',   capacidade: parseFloat(dados.bob_630) || 0 },
                { nome: '65/45', campo: 'bob_65_45', capacidade: parseFloat(dados.bob_65_45) || 0 },
                { nome: '80/45', campo: 'bob_80_45', capacidade: parseFloat(dados.bob_80_45) || 0 },
                { nome: '100/60', campo: 'bob_100_60', capacidade: parseFloat(dados.bob_100_60) || 0 },
                { nome: '125/70', campo: 'bob_125_70', capacidade: parseFloat(dados.bob_125_70) || 0 },
                { nome: '125/100', campo: 'bob_125_100', capacidade: parseFloat(dados.bob_125_100) || 0 }
            ].filter(b => b.capacidade > 0);
    
            // Calcular para cada bobina: quantas precisa e qual o aproveitamento
            const resultados = bobinas.map(b => {
                const qtdBobinas = Math.ceil(metrosDesejados / b.capacidade);
                const capacidadeTotal = qtdBobinas * b.capacidade;
                const sobra = capacidadeTotal - metrosDesejados;
                const aproveitamento = ((metrosDesejados / capacidadeTotal) * 100).toFixed(1);
                return {
                    bobina: b.nome,
                    capacidade_unitaria: Math.round(b.capacidade * 100) / 100,
                    qtd_bobinas: qtdBobinas,
                    capacidade_total: Math.round(capacidadeTotal * 100) / 100,
                    sobra_metros: Math.round(sobra * 100) / 100,
                    aproveitamento: parseFloat(aproveitamento)
                };
            });
    
            // Ordenar por melhor aproveitamento (maior primeiro)
            resultados.sort((a, b) => b.aproveitamento - a.aproveitamento);
    
            // Melhor opção = maior aproveitamento
            const melhor = resultados[0];
    
            // Bobina mínima viável = menor bobina que cabe toda a metragem em 1 unidade
            const minimaViavel = bobinas
                .filter(b => b.capacidade >= metrosDesejados)
                .sort((a, b) => a.capacidade - b.capacidade)[0] || null;
    
            res.json({
                categoria: dados.categoria,
                norma: dados.norma,
                secao: dados.secao + 'mm²',
                diametro: dados.diametro_mm + 'mm',
                metragem_solicitada: metrosDesejados,
                recomendacao: melhor ? {
                    bobina: melhor.bobina,
                    capacidade: melhor.capacidade_unitaria,
                    qtd_bobinas: melhor.qtd_bobinas,
                    aproveitamento: melhor.aproveitamento + '%',
                    sobra: melhor.sobra_metros
                } : null,
                bobina_unica: minimaViavel ? {
                    bobina: minimaViavel.nome,
                    capacidade: minimaViavel.capacidade,
                    sobra: Math.round((minimaViavel.capacidade - metrosDesejados) * 100) / 100
                } : null,
                todas_opcoes: resultados
            });
        } catch (error) {
            console.error('[BOBINAS] Erro no cálculo:', error.message);
            res.status(500).json({ error: 'Erro no cálculo de bobinas' });
        }
    });
    
    // GET /api/pcp/bobinas/tabela - Retornar tabela completa para visualização
    router.get('/bobinas/tabela', authenticateToken, async (req, res) => {
        try {
            const { categoria } = req.query;
            const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            let countQuery = 'SELECT COUNT(*) as total FROM bobinas_capacidade';
            let query = 'SELECT id, bobina, secao, categoria, capacidade_unitaria, peso_unitario, created_at FROM bobinas_capacidade';
            const params = [];
            const countParams = [];
            if (categoria) {
                query += ' WHERE categoria = ?';
                countQuery += ' WHERE categoria = ?';
                params.push(categoria);
                countParams.push(categoria);
            }
            const [[{ total }]] = await pool.query(countQuery, countParams);
            query += ' ORDER BY categoria, CAST(secao AS UNSIGNED) LIMIT ? OFFSET ?';
            params.push(limit, offset);
            const [rows] = await pool.query(query, params);
            res.json({ data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('[BOBINAS] Erro ao carregar tabela:', error.message);
            res.status(500).json({ error: 'Erro ao carregar tabela' });
        }
    });
    // ========== FIM ROTAS BOBINAS ==========
    
    
    // ========================================
    // API: CRIAR PRODUTO (POST)
    // ========================================
    // SECURITY: Requer autenticação
    router.post('/api/produtos', authenticateToken, async (req, res) => {
        try {
            console.log('➕ Criando novo produto...');
            const dados = req.body;
    
            // Validar campos obrigatórios
            if (!dados.codigo || !dados.nome) {
                return res.status(400).json({ error: 'Código e Nome são obrigatórios' });
            }
    
            // Verificar se código já existe
            const [existe] = await pool.query('SELECT id FROM produtos WHERE codigo = ?', [dados.codigo]);
            if (existe.length > 0) {
                return res.status(400).json({ error: 'Código já existe' });
            }
    
            // Construir INSERT dinamicamente com campos básicos
            const camposParaInserir = {
                codigo: dados.codigo,
                nome: dados.nome,
                descricao: dados.descricao || '',
                gtin: dados.gtin || '',
                sku: dados.sku || '',
                marca: dados.marca || 'Aluforce',
                variacao: dados.variacao || '',
                custo_unitario: parseFloat(dados.preco || 0)
            };
    
            // Adicionar campos opcionais se fornecidos
            const camposOpcionais = {
                unidade_medida: dados.unidade_medida,
                ncm: dados.ncm,
                categoria: dados.categoria,
                tensao: dados.tensao,
                secao: dados.secao,
                material_condutor: dados.material_condutor,
                isolacao: dados.isolacao,
                norma: dados.norma,
                cor: dados.cor
            };
    
            Object.keys(camposOpcionais).forEach(campo => {
                if (camposOpcionais[campo] !== undefined) {
                    camposParaInserir[campo] = camposOpcionais[campo];
                }
            });
    
            const colunas = Object.keys(camposParaInserir);
            const valores = Object.values(camposParaInserir);
            const placeholders = colunas.map(() => '?').join(', ');
    
            const query = `INSERT INTO produtos (${colunas.join(', ')}) VALUES (${placeholders})`;
    
            const [result] = await pool.query(query, valores);
    
            console.log(`✅ Produto criado com ID: ${result.insertId}`);
    
            res.json({
                success: true,
                id: result.insertId,
                codigo: dados.codigo,
                nome: dados.nome,
                message: 'Produto criado com sucesso'
            });
    
        } catch (error) {
            console.error('❌ Erro ao criar produto:', error);
            res.status(500).json({ error: 'Erro ao criar produto: ' + error.message });
        }
    });
    
    // ========================================
    // API: ATUALIZAR PRODUTO (PUT)
    // ========================================
    // SECURITY: Requer autenticação
    router.put('/api/produtos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const dados = req.body;
    
            console.log(`🔄 Atualizando produto ID: ${id}`);
    
            // Verificar se produto existe
            const [produto] = await pool.query('SELECT id FROM produtos WHERE id = ?', [id]);
            if (produto.length === 0) {
                return res.status(404).json({ error: 'Produto não encontrado' });
            }
    
            // Obter colunas existentes na tabela produtos (com cache)
            const colunasExistentes = await getProdutoColumns(pool);
            console.log('📋 Colunas disponíveis na tabela:', colunasExistentes.join(', '));
    
            // Construir query dinamicamente apenas com campos que existem na tabela
            const camposParaAtualizar = {};
    
            // Mapeamento de campos do frontend para o banco
            const mapeamentoCampos = {
                codigo: dados.codigo,
                nome: dados.nome,
                descricao: dados.descricao,
                gtin: dados.gtin,
                sku: dados.sku,
                marca: dados.marca,
                variacao: dados.variacao,
                unidade_medida: dados.unidade_medida,
                ncm: dados.ncm,
                categoria: dados.categoria,
                tensao: dados.tensao,
                secao: dados.secao,
                material_condutor: dados.material_condutor,
                isolacao: dados.isolacao,
                norma: dados.norma,
                cor: dados.cor,
                localizacao: dados.localizacao,
                fornecedor: dados.fornecedor,
                fornecedor_principal: dados.fornecedor_principal,
                prazo_entrega: dados.prazo_entrega,
                qtd_minima_compra: dados.qtd_minima_compra,
                estoque_minimo: dados.estoque_minimo,
                estoque_maximo: dados.estoque_maximo,
                estoque_atual: dados.estoque_atual,
                estoque_disponivel: dados.estoque_disponivel,
                estoque_reservado: dados.estoque_reservado,
                estoque_transito: dados.estoque_transito,
                custo_aquisicao: dados.custo_aquisicao,
                custo_adicional: dados.custo_adicional,
                custo_total: dados.custo_total,
                markup: dados.markup,
                margem_lucro: dados.margem_lucro,
                peso: dados.peso,
                largura: dados.largura,
                altura: dados.altura,
                comprimento: dados.comprimento,
                obs_internas: dados.obs_internas,
                obs_fornecedor: dados.obs_fornecedor,
                obs_venda: dados.obs_venda,
                controle_lote: dados.controle_lote,
                familia: dados.familia
            };
    
            // Adicionar campo de preço (pode ser preco, preco_venda ou custo_unitario)
            if (dados.preco !== undefined) {
                if (colunasExistentes.includes('preco')) {
                    mapeamentoCampos.preco = dados.preco;
                } else if (colunasExistentes.includes('preco_venda')) {
                    mapeamentoCampos.preco_venda = dados.preco;
                } else if (colunasExistentes.includes('custo_unitario')) {
                    mapeamentoCampos.custo_unitario = dados.preco;
                }
            }
    
            // Filtrar apenas campos que existem na tabela e têm valor
            Object.keys(mapeamentoCampos).forEach(campo => {
                if (colunasExistentes.includes(campo) && mapeamentoCampos[campo] !== undefined) {
                    camposParaAtualizar[campo] = mapeamentoCampos[campo];
                }
            });
    
            if (Object.keys(camposParaAtualizar).length === 0) {
                return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
            }
    
            console.log('📝 Campos que serão atualizados:', Object.keys(camposParaAtualizar).join(', '));
    
            // Construir SET clause
            const setClauses = Object.keys(camposParaAtualizar).map(campo => `${campo} = ?`);
            const valores = Object.values(camposParaAtualizar);
            valores.push(id); // WHERE id = ?
    
            const query = `UPDATE produtos SET ${setClauses.join(', ')} WHERE id = ?`;
    
            await pool.query(query, valores);
    
            console.log(`✅ Produto ${id} atualizado com sucesso`);
    
            res.json({
                success: true,
                id: parseInt(id),
                message: 'Produto atualizado com sucesso'
            });
    
        } catch (error) {
            console.error('❌ Erro ao atualizar produto:', error);
            res.status(500).json({ error: 'Erro ao atualizar produto: ' + error.message });
        }
    });
    
    // ========================================
    // API: BUSCAR PRODUTO POR ID (GET)
    // ========================================
    router.get('/api/produtos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
    
            const [produtos] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
    
            if (produtos.length === 0) {
                return res.status(404).json({ error: 'Produto não encontrado' });
            }
    
            res.json(produtos[0]);
    
        } catch (error) {
            console.error('❌ Erro ao buscar produto:', error);
            res.status(500).json({ error: 'Erro ao buscar produto: ' + error.message });
        }
    });
    
    // ========================================
    // API PCP: PRODUTOS (Alias para /api/produtos)
    // ========================================
    
    // ========================================
    // API VENDAS: Rotas consolidadas em seção dedicada (linhas 11245+)
    // ========================================
    
    // ========================================
    // API: ALERTAS DE ESTOQUE
    // ========================================
    router.get('/api/alertas-estoque', authenticateToken, async (req, res) => {
        try {
            console.log('⚠️ Buscando alertas de estoque...');
    
            // AUDIT-FIX R-08: Buscar dados REAIS de estoque do banco de dados
            const query = `
                SELECT
                    id,
                    codigo,
                    nome,
                    descricao,
                    marca,
                    custo_unitario,
                    gtin,
                    sku,
                    COALESCE(estoque_atual, 0) as quantidade_atual,
                    COALESCE(estoque_minimo, 10) as estoque_minimo
                FROM produtos
                WHERE ativo = 1 OR ativo IS NULL
                ORDER BY nome
                LIMIT 200
            `;
    
            const [produtos] = await pool.query(query);
    
            // AUDIT-FIX R-08: Classificar produtos por status usando dados REAIS do banco
            const alertasFormatados = produtos.map((produto) => {
                const quantidade_atual = parseInt(produto.quantidade_atual) || 0;
                const estoque_minimo = parseInt(produto.estoque_minimo) || 10;
    
                let status = 'normal';
                if (quantidade_atual === 0) {
                    status = 'critico';
                } else if (quantidade_atual < estoque_minimo * 0.5) {
                    status = 'baixo';
                } else if (quantidade_atual < estoque_minimo) {
                    status = 'baixo';
                }
    
                return {
                    id: produto.id,
                    codigo: produto.codigo || `PROD-${produto.id}`,
                    nome: produto.nome || produto.descricao,
                    quantidade_atual: quantidade_atual,
                    estoque_minimo: estoque_minimo,
                    localizacao: produto.marca || 'Não informada',
                    status: status,
                    fornecedor: produto.marca || 'Não informado',
                    custo_unitario: parseFloat(produto.custo_unitario) || 0,
                    preco: parseFloat(produto.custo_unitario) || 0
                };
            });
    
            // Filtrar apenas produtos com status baixo ou crítico
            const alertasFiltrados = alertasFormatados.filter(a => a.status === 'baixo' || a.status === 'critico');
    
            console.log(`✅ ${alertasFiltrados.length} alertas de estoque encontrados`);
            res.json({
                total: alertasFiltrados.length,
                alertas: alertasFiltrados
            });
    
        } catch (error) {
            console.error('❌ Erro ao buscar alertas de estoque:', error);
            res.status(500).json({
                error: 'Erro ao buscar alertas',
                total: 0,
                alertas: []
            });
        }
    });
    
    // ========================================
    // API: CONFIGURAÇÕES DA EMPRESA
    // ========================================
    
    // GET - Buscar configurações da empresa
    router.get('/api/configuracoes/empresa', authenticateToken, cacheMiddleware('cfg_empresa', CACHE_CONFIG.configuracoes), async (req, res) => {
        try {
            console.log('📋 Buscando configurações da empresa...');
    
            const [rows] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
    
            if (rows.length > 0) {
                res.json(rows[0]);
            } else {
                // Retorna dados padrão da Aluforce
                res.json({
                    razao_social: 'I. M. DOS REIS - ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES',
                    nome_fantasia: 'ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES ELETRICOS',
                    cnpj: '68.192.475/0001-60',
                    telefone: '(11) 91793-9089',
                    cep: '08537-400',
                    estado: 'SP',
                    cidade: 'Ferraz de Vasconcelos (SP)',
                    bairro: 'VILA SÃO JOÃO',
                    endereco: 'RUA ERNESTINA',
                    numero: '270',
                    complemento: ''
                });
            }
        } catch (error) {
            console.error('❌ Erro ao buscar configurações:', error);
            res.status(500).json({ error: 'Erro ao buscar configurações' });
        }
    });
    
    // POST - Salvar configurações da empresa
    router.post('/api/configuracoes/empresa', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('💾 Salvando configurações da empresa...');
    
            const {
                razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
                telefone, email, site, cep, estado, cidade, bairro, endereco, numero, complemento
            } = req.body;
    
            // Verificar se já existe registro
            const [existing] = await pool.query('SELECT id FROM configuracoes_empresa LIMIT 1');
    
            if (existing.length > 0) {
                // Atualizar registro existente
                await pool.query(`
                    UPDATE configuracoes_empresa
                    SET razao_social = ?, nome_fantasia = ?, cnpj = ?, inscricao_estadual = ?,
                        inscricao_municipal = ?, telefone = ?, email = ?, site = ?, cep = ?,
                        estado = ?, cidade = ?, bairro = ?, endereco = ?, numero = ?, complemento = ?
                    WHERE id = ?
                `, [razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
                    telefone, email, site, cep, estado, cidade, bairro, endereco, numero, complemento,
                    existing[0].id]);
    
                console.log('✅ Configurações atualizadas');
            } else {
                // Inserir novo registro
                await pool.query(`
                    INSERT INTO configuracoes_empresa
                    (razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
                     telefone, email, site, cep, estado, cidade, bairro, endereco, numero, complemento)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
                    telefone, email, site, cep, estado, cidade, bairro, endereco, numero, complemento]);
    
                console.log('✅ Configurações criadas');
            }
    
            res.json({
                success: true,
                message: 'Configurações salvas com sucesso!'
            });
    
        } catch (error) {
            console.error('❌ Erro ao salvar configurações:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao salvar configurações',
                message: error.message
            });
        }
    });
    
    // POST - Upload de logo da empresa
    router.post('/api/configuracoes/upload-logo', authenticateToken, authorizeAdmin, upload.single('logo'), async (req, res) => {
        try {
            console.log('🖼️ Upload de logo da empresa...');
    
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
            }
    
            const logoPath = '/uploads/empresa/' + req.file.filename;
    
            // Atualizar URL do logo no banco de dados
            const [existing] = await pool.query('SELECT id FROM configuracoes_empresa LIMIT 1');
    
            if (existing.length > 0) {
                await pool.query('UPDATE configuracoes_empresa SET logo_url = ? WHERE id = ?', [logoPath, existing[0].id]);
            } else {
                await pool.query('INSERT INTO configuracoes_empresa (logo_url) VALUES (?)', [logoPath]);
            }
    
            console.log('✅ Logo atualizado:', logoPath);
    
            res.json({
                success: true,
                url: logoPath,
                message: 'Logo atualizado com sucesso!'
            });
    
        } catch (error) {
            console.error('❌ Erro ao fazer upload do logo:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao fazer upload do logo',
                message: error.message
            });
        }
    });
    
    // POST - Upload de favicon da empresa
    router.post('/api/configuracoes/upload-favicon', authenticateToken, authorizeAdmin, upload.single('favicon'), async (req, res) => {
        try {
            console.log('🖼️ Upload de favicon da empresa...');
    
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
            }
    
            const faviconPath = '/uploads/empresa/' + req.file.filename;
    
            // Atualizar URL do favicon no banco de dados
            const [existing] = await pool.query('SELECT id FROM configuracoes_empresa LIMIT 1');
    
            if (existing.length > 0) {
                await pool.query('UPDATE configuracoes_empresa SET favicon_url = ? WHERE id = ?', [faviconPath, existing[0].id]);
            } else {
                await pool.query('INSERT INTO configuracoes_empresa (favicon_url) VALUES (?)', [faviconPath]);
            }
    
            console.log('✅ Favicon atualizado:', faviconPath);
    
            res.json({
                success: true,
                url: faviconPath,
                message: 'Favicon atualizado com sucesso!'
            });
    
        } catch (error) {
            console.error('❌ Erro ao fazer upload do favicon:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao fazer upload do favicon',
                message: error.message
            });
        }
    });
    
    // ========================================
    // API: POPULAR DADOS DE EXEMPLO
    // ========================================
    router.post('/api/admin/popular-dados', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('📝 Populando dados de exemplo...');
    
            // 1. Verificar produtos
            const [produtos] = await pool.query('SELECT COUNT(*) as total FROM produtos');
            let produtosInseridos = 0;
    
            if (produtos[0].total === 0) {
                const produtosExemplo = [
                    ['DUN10', 'CABO DUPLEX NEUTRO NU 2x10mm² LABOR 0,6/1KV', 'Preto / Nu', 'Labor Energy', 'Cabo multiplexado duplex com neutro nu', '7894567890123', 'SKU-DUN10', 28.90],
                    ['TRI25', 'CABO TRIPLEX 3x25mm² LABOR 0,6/1KV', 'Preto / Preto / Nu', 'Labor Energy', 'Cabo multiplexado triplex', '7894567890124', 'SKU-TRI25', 65.90],
                    ['QDN50', 'CABO QUADRUPLEX 3x50mm² + 1x50mm² LABOR 0,6/1KV', 'Preto / Preto / Preto / Nu', 'Labor Energy', 'Cabo multiplexado quadruplex', '7894567890125', 'SKU-QDN50', 125.50],
                    ['DUN16', 'CABO DUPLEX NEUTRO NU 2x16mm² LABOR 0,6/1KV', 'Preto / Nu', 'Aluforce', 'Cabo multiplexado duplex', '7894567890126', 'SKU-DUN16', 38.90],
                    ['TRI35', 'CABO TRIPLEX 3x35mm² LABOR 0,6/1KV', 'Preto / Preto / Nu', 'Aluforce', 'Cabo multiplexado triplex', '7894567890127', 'SKU-TRI35', 85.90],
                    ['QDN70', 'CABO QUADRUPLEX 3x70mm² + 1x70mm² LABOR 0,6/1KV', 'Preto / Preto / Preto / Nu', 'Aluforce', 'Cabo multiplexado quadruplex', '7894567890128', 'SKU-QDN70', 165.50],
                    ['DUN25', 'CABO DUPLEX NEUTRO NU 2x25mm² LABOR 0,6/1KV', 'Preto / Nu', 'Labor Energy', 'Cabo multiplexado duplex', '7894567890129', 'SKU-DUN25', 58.90],
                    ['TRI50', 'CABO TRIPLEX 3x50mm² LABOR 0,6/1KV', 'Preto / Preto / Nu', 'Labor Energy', 'Cabo multiplexado triplex', '7894567890130', 'SKU-TRI50', 105.90],
                    ['QDN95', 'CABO QUADRUPLEX 3x95mm² + 1x95mm² LABOR 0,6/1KV', 'Preto / Preto / Preto / Nu', 'Aluforce', 'Cabo multiplexado quadruplex', '7894567890131', 'SKU-QDN95', 225.50],
                    ['DUN35', 'CABO DUPLEX NEUTRO NU 2x35mm² LABOR 0,6/1KV', 'Preto / Nu', 'Aluforce', 'Cabo multiplexado duplex', '7894567890132', 'SKU-DUN35', 78.90]
                ];
    
                for (const prod of produtosExemplo) {
                    await pool.query(`
                        INSERT INTO produtos (codigo, nome, variacao, marca, descricao, gtin, sku, custo_unitario)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, prod);
                    produtosInseridos++;
                }
            }
    
            // 2. Verificar materiais
            const [materiais] = await pool.query('SELECT COUNT(*) as total FROM materiais');
            let materiaisInseridos = 0;
    
            if (materiais[0].total === 0) {
                const materiaisExemplo = [
                    ['ALU-PERFIL-20X20', 'Perfil de Alumínio 20x20mm', 'M', 15.50, 100.00, 'ALUFORCE'],
                    ['ALU-CHAPA-2MM', 'Chapa de Alumínio 2mm', 'M2', 85.00, 50.00, 'ALUFORCE'],
                    ['ALU-BARRA-30X30', 'Barra de Alumínio 30x30mm', 'M', 28.75, 75.00, 'FORNECEDOR A'],
                    ['ALU-TUBO-25MM', 'Tubo de Alumínio Redondo 25mm', 'M', 22.90, 120.00, 'FORNECEDOR B'],
                    ['ALU-CANTONEIRA-20X20', 'Cantoneira de Alumínio 20x20mm', 'M', 18.50, 80.00, 'ALUFORCE'],
                    ['ALU-PERFIL-U-30MM', 'Perfil U de Alumínio 30mm', 'M', 25.00, 60.00, 'FORNECEDOR A'],
                    ['ALU-CHAPA-3MM', 'Chapa de Alumínio 3mm', 'M2', 125.00, 30.00, 'ALUFORCE'],
                    ['ALU-BARRA-40X40', 'Barra de Alumínio 40x40mm', 'M', 38.50, 65.00, 'FORNECEDOR B'],
                    ['ALU-TUBO-32MM', 'Tubo de Alumínio Redondo 32mm', 'M', 32.90, 90.00, 'ALUFORCE'],
                    ['ALU-PERFIL-T-25MM', 'Perfil T de Alumínio 25mm', 'M', 21.75, 110.00, 'FORNECEDOR A']
                ];
    
                for (const mat of materiaisExemplo) {
                    await pool.query(`
                        INSERT INTO materiais (codigo_material, descricao, unidade_medida, custo_unitario, quantidade_estoque, fornecedor_padrao)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, mat);
                    materiaisInseridos++;
                }
            }
    
            // 3. Retornar resumo
            const [produtosTotal] = await pool.query('SELECT COUNT(*) as total FROM produtos');
            const [materiaisTotal] = await pool.query('SELECT COUNT(*) as total FROM materiais');
    
            console.log(`✅ Dados populados: ${produtosInseridos} produtos + ${materiaisInseridos} materiais`);
    
            res.json({
                success: true,
                message: 'Dados populados com sucesso',
                produtosInseridos,
                materiaisInseridos,
                totais: {
                    produtos: produtosTotal[0].total,
                    materiais: materiaisTotal[0].total
                }
            });
    
        } catch (error) {
            console.error('❌ Erro ao popular dados:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao popular dados',
                message: error.message
            });
        }
    });
    
    // ========================================
    // API: CONFIGURAÇÕES ESTENDIDAS
    // ========================================
    
    // Venda de Produtos
    router.post('/api/configuracoes/venda-produtos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { etapas, tabelas_preco, numeracao, reserva_estoque } = req.body;
    
            const [existing] = await pool.query('SELECT id FROM configuracoes_venda_produtos LIMIT 1');
    
            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_venda_produtos
                    SET etapas = ?, tabelas_preco = ?, numeracao = ?, reserva_estoque = ?
                    WHERE id = ?
                `, [JSON.stringify(etapas), JSON.stringify(tabelas_preco), JSON.stringify(numeracao), JSON.stringify(reserva_estoque), existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_venda_produtos (etapas, tabelas_preco, numeracao, reserva_estoque)
                    VALUES (?, ?, ?, ?)
                `, [JSON.stringify(etapas), JSON.stringify(tabelas_preco), JSON.stringify(numeracao), JSON.stringify(reserva_estoque)]);
            }
    
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar config venda produtos:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Venda de Serviços
    router.post('/api/configuracoes/venda-servicos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { etapas, proposta, numeracao } = req.body;
    
            const [existing] = await pool.query('SELECT id FROM configuracoes_venda_servicos LIMIT 1');
    
            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_venda_servicos
                    SET etapas = ?, proposta = ?, numeracao = ?
                    WHERE id = ?
                `, [JSON.stringify(etapas), JSON.stringify(proposta), JSON.stringify(numeracao), existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_venda_servicos (etapas, proposta, numeracao)
                    VALUES (?, ?, ?)
                `, [JSON.stringify(etapas), JSON.stringify(proposta), JSON.stringify(numeracao)]);
            }
    
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar config venda serviços:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Clientes e Fornecedores
    router.post('/api/configuracoes/clientes-fornecedores', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { validacoes, credito, tags } = req.body;
    
            const [existing] = await pool.query('SELECT id FROM configuracoes_clientes_fornecedores LIMIT 1');
    
            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_clientes_fornecedores
                    SET validacoes = ?, credito = ?, tags = ?
                    WHERE id = ?
                `, [JSON.stringify(validacoes), JSON.stringify(credito), JSON.stringify(tags), existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_clientes_fornecedores (validacoes, credito, tags)
                    VALUES (?, ?, ?)
                `, [JSON.stringify(validacoes), JSON.stringify(credito), JSON.stringify(tags)]);
            }
    
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar config clientes/fornecedores:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Finanças
    router.post('/api/configuracoes/financas', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { contas_atraso, email_remessa, juros_mes, multa_atraso } = req.body;
    
            const [existing] = await pool.query('SELECT id FROM configuracoes_financas LIMIT 1');
    
            if (existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_financas
                    SET contas_atraso = ?, email_remessa = ?, juros_mes = ?, multa_atraso = ?
                    WHERE id = ?
                `, [contas_atraso, email_remessa, juros_mes, multa_atraso, existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_financas (contas_atraso, email_remessa, juros_mes, multa_atraso)
                    VALUES (?, ?, ?, ?)
                `, [contas_atraso, email_remessa, juros_mes, multa_atraso]);
            }
    
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao salvar config finanças:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // ========================================
    // GET - Buscar etapas do processo de vendas
    // ========================================
    router.get('/api/configuracoes/venda-produtos', authenticateToken, cacheMiddleware('cfg_venda_prod', CACHE_CONFIG.configuracoes), async (req, res) => {
        try {
            // AUDIT-FIX ARCH-002: Removed duplicate CREATE TABLE (already in POST route)
    
            const [rows] = await pool.query('SELECT * FROM configuracoes_venda_produtos LIMIT 1');
    
            if (rows.length > 0) {
                const config = rows[0];
                res.json({
                    success: true,
                    etapas: config.etapas ? JSON.parse(config.etapas) : null,
                    tabelas_preco: config.tabelas_preco ? JSON.parse(config.tabelas_preco) : null,
                    numeracao: config.numeracao ? JSON.parse(config.numeracao) : null,
                    reserva_estoque: config.reserva_estoque ? JSON.parse(config.reserva_estoque) : null
                });
            } else {
                // Retornar configuração padrão
                res.json({
                    success: true,
                    etapas: [
                        { id: 'orcamento', nome: 'Orçamento', status: 'orcamento' },
                        { id: 'analise', nome: 'Análise de Crédito', status: 'analise' },
                        { id: 'aprovado', nome: 'Pedido Aprovado', status: 'aprovado' },
                        { id: 'faturar', nome: 'Faturar', status: 'faturar' },
                        { id: 'faturado', nome: 'Faturado', status: 'faturado', destaque: true },
                        { id: 'recibo', nome: 'Recibo', status: 'recibo' }
                    ],
                    tabelas_preco: null,
                    numeracao: null,
                    reserva_estoque: null
                });
            }
        } catch (error) {
            console.error('Erro ao buscar config venda produtos:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // ========================================
    // BAIXA AUTOMÁTICA DE ESTOQUE EM TEMPO REAL
    // ========================================
    /**
     * Função para baixar estoque automaticamente quando um pedido é criado/confirmado
     * Suporta divisão de lances (ex: 600m de TRN70, pedido de 300m = fica 300m)
     */
    async function baixarEstoqueAutomatico(connection, pedidoId, itens, usuarioId = null) {
        console.log(`[ESTOQUE_AUTO] Iniciando baixa automática para pedido ${pedidoId}`);
    
        const movimentacoes = [];
    
        for (const item of itens) {
            const codigoMaterial = item.codigo || item.codigo_material || item.sku;
            const quantidade = parseFloat(item.quantidade || 0);
            const unidade = item.unidade || 'm';
    
            if (!codigoMaterial || quantidade <= 0) continue;
    
            try {
                // Buscar produto no estoque
                const [produtos] = await connection.query(`
                    SELECT id, codigo, descricao, estoque_atual, unidade_medida
                    FROM produtos
                    WHERE codigo = ? OR sku = ? OR LOWER(descricao) LIKE LOWER(?)
                    LIMIT 1
                `, [codigoMaterial, codigoMaterial, `%${codigoMaterial}%`]);
    
                if (produtos.length === 0) {
                    console.log(`[ESTOQUE_AUTO] Produto não encontrado: ${codigoMaterial}`);
                    continue;
                }
    
                const produto = produtos[0];
                const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                const novoEstoque = Math.max(0, estoqueAnterior - quantidade);
    
                // Atualizar estoque do produto
                await connection.query(`
                    UPDATE produtos
                    SET estoque_atual = ?,
                        ultima_saida = NOW()
                    WHERE id = ?
                `, [novoEstoque, produto.id]);
    
                // Registrar movimentação
                await connection.query(`
                    INSERT INTO estoque_movimentacoes
                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                     documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                    VALUES (?, 'saida', 'pedido_venda', ?, ?, ?, 'pedido', ?, ?, ?, NOW())
                `, [
                    produto.codigo,
                    quantidade,
                    estoqueAnterior,
                    novoEstoque,
                    pedidoId,
                    usuarioId,
                    `Baixa automática - Pedido #${pedidoId} - ${quantidade}${unidade}`
                ]);
    
                movimentacoes.push({
                    produto: produto.codigo,
                    descricao: produto.descricao,
                    quantidade_baixada: quantidade,
                    estoque_anterior: estoqueAnterior,
                    estoque_atual: novoEstoque,
                    unidade: unidade
                });
    
                console.log(`[ESTOQUE_AUTO] Baixa realizada: ${produto.codigo} - ${quantidade}${unidade} (${estoqueAnterior} -> ${novoEstoque})`);
    
            } catch (err) {
                console.error(`[ESTOQUE_AUTO] Erro ao baixar ${codigoMaterial}:`, err.message);
            }
        }
    
        return movimentacoes;
    }
    
    // Rota para baixar estoque manualmente (admin)
    router.post('/api/estoque/baixar', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_id, itens } = req.body;
            const usuario_id = req.user?.id;
    
            if (!itens || !Array.isArray(itens) || itens.length === 0) {
                throw new Error('Itens não informados');
            }
    
            const movimentacoes = await baixarEstoqueAutomatico(connection, pedido_id || 0, itens, usuario_id);
    
            await connection.commit();
    
            res.json({
                success: true,
                message: `Estoque baixado com sucesso! ${movimentacoes.length} produtos atualizados.`,
                movimentacoes
            });
        } catch (error) {
            await connection.rollback();
            console.error('[ESTOQUE_BAIXAR] Erro:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            connection.release();
        }
    });
    
    // Rota para buscar produtos com estoque disponível (para PCP)
    router.get('/estoque/produtos', authenticateToken, async (req, res) => {
        try {
            const [produtos] = await pool.query(`
                SELECT
                    p.id,
                    p.codigo,
                    p.descricao as nome,
                    p.sku,
                    p.categoria,
                    p.unidade_medida,
                    COALESCE(p.estoque_atual, 0) as estoque_atual,
                    COALESCE(p.estoque_minimo, 10) as estoque_minimo,
                    p.preco_venda as preco,
                    CASE
                        WHEN COALESCE(p.estoque_atual, 0) <= 0 THEN 'zerado'
                        WHEN COALESCE(p.estoque_atual, 0) <= COALESCE(p.estoque_minimo, 10) THEN 'baixo'
                        ELSE 'normal'
                    END as status_estoque,
                    p.updated_at
                FROM produtos p
                WHERE p.estoque_atual > 0 OR p.id IN (
                    SELECT DISTINCT
                        CASE
                            WHEN pr.id IS NOT NULL THEN pr.id
                            ELSE NULL
                        END
                    FROM estoque_movimentacoes em
                    LEFT JOIN produtos pr ON (pr.codigo = em.codigo_material OR pr.sku = em.codigo_material)
                    WHERE em.tipo_movimento = 'entrada'
                )
                ORDER BY p.codigo ASC
            `);
    
            res.json({
                success: true,
                total: produtos.length,
                produtos: produtos
            });
        } catch (error) {
            console.error('[PCP_ESTOQUE] Erro:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // =========================
    // ETAPAS DO PROCESSO PCP
    // =========================
    
    // GET /api/pcp/etapas - Buscar etapas configuradas do processo de faturamento
    router.get('/etapas', authenticateToken, async (req, res) => {
        try {
            // Buscar etapas existentes
            const [etapas] = await pool.query(`
                SELECT id, nome, cor, icone, ordem
                FROM pcp_etapas_processo
                WHERE ativo = 1
                ORDER BY ordem ASC
            `);
    
            // Se não houver etapas, inserir as padrão
            if (etapas.length === 0) {
                const etapasPadrao = [
                    { nome: 'Orçamento', cor: '#94a3b8', icone: 'fa-file-alt', ordem: 1 },
                    { nome: 'Análise de Crédito', cor: '#f59e0b', icone: 'fa-search-dollar', ordem: 2 },
                    { nome: 'Pedido Aprovado', cor: '#3b82f6', icone: 'fa-thumbs-up', ordem: 3 },
                    { nome: 'Faturar', cor: '#f97316', icone: 'fa-file-invoice', ordem: 4 },
                    { nome: 'Faturado', cor: '#22c55e', icone: 'fa-check-circle', ordem: 5 },
                    { nome: 'Recibo', cor: '#8b5cf6', icone: 'fa-receipt', ordem: 6 }
                ];
    
                for (const etapa of etapasPadrao) {
                    await pool.query(
                        'INSERT INTO pcp_etapas_processo (nome, cor, icone, ordem) VALUES (?, ?, ?, ?)',
                        [etapa.nome, etapa.cor, etapa.icone, etapa.ordem]
                    );
                }
    
                // Buscar novamente
                const [novasEtapas] = await pool.query(`
                    SELECT id, nome, cor, icone, ordem
                    FROM pcp_etapas_processo
                    WHERE ativo = 1
                    ORDER BY ordem ASC
                `);
    
                return res.json({
                    success: true,
                    etapas: novasEtapas
                });
            }
    
            res.json({
                success: true,
                etapas: etapas
            });
        } catch (error) {
            console.error('[PCP_ETAPAS] Erro ao buscar etapas:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // POST /api/pcp/etapas - Salvar configuração de etapas
    router.post('/etapas', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { etapas, alterarNumeracao } = req.body;
    
            if (!Array.isArray(etapas) || etapas.length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'É necessário pelo menos 2 etapas'
                });
            }
    
            // Desativar todas as etapas atuais
            await connection.query('UPDATE pcp_etapas_processo SET ativo = 0');
    
            // Inserir ou atualizar cada etapa
            for (let i = 0; i < etapas.length; i++) {
                const etapa = etapas[i];
    
                if (etapa.id && typeof etapa.id === 'number' && etapa.id < 100000000) {
                    // Atualizar etapa existente
                    await connection.query(`
                        UPDATE pcp_etapas_processo
                        SET nome = ?, cor = ?, icone = ?, ordem = ?, ativo = 1
                        WHERE id = ?
                    `, [etapa.nome, etapa.cor || '#64748b', etapa.icone || 'fa-tag', i + 1, etapa.id]);
                } else {
                    // Inserir nova etapa
                    await connection.query(`
                        INSERT INTO pcp_etapas_processo (nome, cor, icone, ordem, ativo)
                        VALUES (?, ?, ?, ?, 1)
                    `, [etapa.nome, etapa.cor || '#64748b', etapa.icone || 'fa-tag', i + 1]);
                }
            }
    
            await connection.commit();
    
            // Buscar etapas atualizadas
            const [etapasAtualizadas] = await pool.query(`
                SELECT id, nome, cor, icone, ordem
                FROM pcp_etapas_processo
                WHERE ativo = 1
                ORDER BY ordem ASC
            `);
    
            console.log(`[PCP_ETAPAS] ${etapasAtualizadas.length} etapas salvas com sucesso`);
    
            res.json({
                success: true,
                message: 'Etapas atualizadas com sucesso',
                etapas: etapasAtualizadas
            });
        } catch (error) {
            await connection.rollback();
            console.error('[PCP_ETAPAS] Erro ao salvar etapas:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            connection.release();
        }
    });
    
    // =========================
    // CONFIGURAÇÕES DE IMPOSTOS
    // =========================
    
    // GET /api/configuracoes/impostos - Buscar configurações de impostos do sistema
    router.get('/api/configuracoes/impostos', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM configuracoes_impostos LIMIT 1');
    
            if (rows && rows.length > 0) {
                res.json(rows[0]);
            } else {
                // Inserir valores padrão
                await pool.query(`
                    INSERT INTO configuracoes_impostos (icms, ipi, pis, cofins, iss)
                    VALUES (18.00, 5.00, 1.65, 7.60, 5.00)
                `);
    
                res.json({
                    icms: 18.00,
                    ipi: 5.00,
                    pis: 1.65,
                    cofins: 7.60,
                    iss: 5.00,
                    csll: 9.00,
                    irpj: 15.00,
                    icms_st: 0.00,
                    mva: 0.00
                });
            }
        } catch (error) {
            console.error('Erro ao buscar config impostos:', error);
            // Retornar valores padrão em caso de erro
            res.json({
                icms: 18.00,
                ipi: 5.00,
                pis: 1.65,
                cofins: 7.60,
                iss: 5.00
            });
        }
    });
    
    // POST /api/configuracoes/impostos - Salvar configurações de impostos
    router.post('/api/configuracoes/impostos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { icms, ipi, pis, cofins, iss, csll, irpj, icms_st, mva } = req.body;
    
            const [existing] = await pool.query('SELECT id FROM configuracoes_impostos LIMIT 1');
    
            if (existing && existing.length > 0) {
                await pool.query(`
                    UPDATE configuracoes_impostos
                    SET icms = ?, ipi = ?, pis = ?, cofins = ?, iss = ?,
                        csll = ?, irpj = ?, icms_st = ?, mva = ?
                    WHERE id = ?
                `, [icms || 18, ipi || 5, pis || 1.65, cofins || 7.6, iss || 5,
                    csll || 9, irpj || 15, icms_st || 0, mva || 0, existing[0].id]);
            } else {
                await pool.query(`
                    INSERT INTO configuracoes_impostos (icms, ipi, pis, cofins, iss, csll, irpj, icms_st, mva)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [icms || 18, ipi || 5, pis || 1.65, cofins || 7.6, iss || 5,
                    csll || 9, irpj || 15, icms_st || 0, mva || 0]);
            }
    
            res.json({ success: true, message: 'Configurações de impostos salvas' });
        } catch (error) {
            console.error('Erro ao salvar config impostos:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // =========================
    // FAMÍLIAS DE PRODUTOS
    // =========================
    
    router.get('/api/configuracoes/familias-produtos', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM familias_produtos');
            const [familias] = await pool.query('SELECT id, nome, codigo, created_at, updated_at FROM familias_produtos ORDER BY nome LIMIT ? OFFSET ?', [limit, offset]);
            res.json({ data: familias, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('Erro ao buscar famílias:', error);
            res.status(500).json({ error: error.message });
        }
    });
    
    router.post('/api/configuracoes/familias-produtos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, codigo } = req.body;
            const [result] = await pool.query(
                'INSERT INTO familias_produtos (nome, codigo) VALUES (?, ?)',
                [nome, codigo]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar família:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    router.delete('/api/configuracoes/familias-produtos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM familias_produtos WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir família:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // =========================
    // CARACTERÍSTICAS DE PRODUTOS
    // =========================
    
    router.get('/api/configuracoes/caracteristicas-produtos', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM caracteristicas_produtos');
            const [caracteristicas] = await pool.query('SELECT id, nome, conteudos_possiveis, visualizar_em, preenchimento, created_at, updated_at FROM caracteristicas_produtos ORDER BY nome LIMIT ? OFFSET ?', [limit, offset]);
            res.json({ data: caracteristicas, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('Erro ao buscar características:', error);
            res.status(500).json({ error: error.message });
        }
    });
    
    router.post('/api/configuracoes/caracteristicas-produtos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, conteudos_possiveis, visualizar_em, preenchimento } = req.body;
            const [result] = await pool.query(
                'INSERT INTO caracteristicas_produtos (nome, conteudos_possiveis, visualizar_em, preenchimento) VALUES (?, ?, ?, ?)',
                [nome, conteudos_possiveis, visualizar_em, preenchimento]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar característica:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    router.delete('/api/configuracoes/caracteristicas-produtos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM caracteristicas_produtos WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir característica:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // =========================
    // VENDEDORES
    // =========================
    
    router.get('/api/configuracoes/vendedores', authenticateToken, async (req, res) => {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS vendedores (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    nome VARCHAR(255) NOT NULL,
                    email VARCHAR(255),
                    comissao DECIMAL(5,2) DEFAULT 0,
                    permissoes TEXT,
                    situacao ENUM('ativo', 'inativo') DEFAULT 'ativo',
                    usuario_id INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);
    
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM vendedores');
            const [vendedores] = await pool.query(`
                SELECT
                    id,
                    nome,
                    email,
                    comissao,
                    COALESCE(permissoes, 'vendas') as permissoes,
                    situacao,
                    usuario_id,
                    created_at as inclusao,
                    updated_at as ultima_alteracao
                FROM vendedores
                ORDER BY nome
                LIMIT ? OFFSET ?
            `, [limit, offset]);
            res.json({ data: vendedores, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('Erro ao buscar vendedores:', error);
            res.status(500).json({ error: error.message });
        }
    });
    
    router.post('/api/configuracoes/vendedores', authenticateToken, authorizeAdmin, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { nome, email, comissao, permissoes, situacao } = req.body;
    
            // Criar usuário no sistema com acesso ao módulo de vendas
            // AUDIT-FIX HIGH-010: Use crypto.randomBytes instead of Math.random for temp password
            const senhaTemp = require('crypto').randomBytes(12).toString('base64url').slice(0, 12);
            const senhaHash = await bcrypt.hash(senhaTemp, 12);
    
            const [usuario] = await connection.query(
                'INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES (?, ?, ?, ?)',
                [nome, email, senhaHash, 'vendedor']
            );
    
            // Dar permissão ao módulo de vendas
            await connection.query(
                'INSERT INTO permissoes_modulos (usuario_id, modulo) VALUES (?, ?)',
                [usuario.insertId, 'vendas']
            );
    
            // Criar registro de vendedor
            const [result] = await connection.query(
                'INSERT INTO vendedores (nome, email, comissao, permissoes, situacao, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
                [nome, email, comissao, permissoes, situacao, usuario.insertId]
            );
    
            await connection.commit();
            res.json({ success: true, id: result.insertId, senhaTemp });
        } catch (error) {
            await connection.rollback();
            console.error('Erro ao criar vendedor:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            connection.release();
        }
    });
    
    router.delete('/api/configuracoes/vendedores/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            // Buscar usuario_id do vendedor
            const [vendedor] = await connection.query('SELECT usuario_id FROM vendedores WHERE id = ?', [req.params.id]);
    
            if (vendedor.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, error: 'Vendedor não encontrado' });
            }
    
            // Verificar se vendedor tem pedidos vinculados
            const [pedidos] = await connection.query('SELECT COUNT(*) as count FROM pedidos WHERE vendedor_id = ?', [req.params.id]);
            if (pedidos[0].count > 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    error: `Vendedor possui ${pedidos[0].count} pedido(s) vinculado(s). Inative-o em vez de excluir.`
                });
            }
    
            if (vendedor[0].usuario_id) {
                // Remover permissões
                await connection.query('DELETE FROM permissoes_modulos WHERE usuario_id = ?', [vendedor[0].usuario_id]);
                // Remover usuário
                await connection.query('DELETE FROM usuarios WHERE id = ?', [vendedor[0].usuario_id]);
            }
    
            // Remover vendedor
            await connection.query('DELETE FROM vendedores WHERE id = ?', [req.params.id]);
    
            await connection.commit();
            res.json({ success: true });
        } catch (error) {
            await connection.rollback();
            console.error('Erro ao excluir vendedor:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            connection.release();
        }
    });
    
    // =========================
    // COMPRADORES
    // =========================
    
    router.get('/api/configuracoes/compradores', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM compradores');
            const [compradores] = await pool.query(`
                SELECT
                    id,
                    nome,
                    situacao,
                    COALESCE(incluido_por, 'Sistema') as incluido_por,
                    created_at as inclusao,
                    updated_at as última_alteracao
                FROM compradores
                ORDER BY nome
                LIMIT ? OFFSET ?
            `, [limit, offset]);
            res.json({ data: compradores, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('Erro ao buscar compradores:', error);
            res.status(500).json({ error: error.message });
        }
    });
    
    router.post('/api/configuracoes/compradores', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { nome, situacao, incluido_por } = req.body;
            const [result] = await pool.query(
                'INSERT INTO compradores (nome, situacao, incluido_por) VALUES (?, ?, ?)',
                [nome, situacao, incluido_por]
            );
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('Erro ao criar comprador:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    router.delete('/api/configuracoes/compradores/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM compradores WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao excluir comprador:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // =================================================================
    // ROTAS ADICIONAIS DE CONFIGURAÇÓES
    // =================================================================
    
    // GET - Listar categorias
    router.get('/api/configuracoes/categorias', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Buscando categorias...');
    
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM categorias WHERE ativo = 1');
            const [categorias] = await pool.query(`
                SELECT id, nome, descricao, created_at, updated_at
                FROM categorias
                WHERE ativo = 1
                ORDER BY nome
                LIMIT ? OFFSET ?
            `, [limit, offset]);
    
            res.json({ data: categorias, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('❌ Erro ao buscar categorias:', error);
            res.status(500).json({ error: 'Erro ao buscar categorias' });
        }
    });
    
    // POST - Criar categoria
    router.post('/api/configuracoes/categorias', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('💾 Criando categoria...');
    
            const { nome, descricao, cor } = req.body;
    
            const [result] = await pool.query(`
                INSERT INTO categorias (nome, descricao, cor, ativo, created_at, updated_at)
                VALUES (?, ?, ?, 1, NOW(), NOW())
            `, [nome, descricao, cor || '#6366f1']);
    
            console.log('✅ Categoria criada com sucesso');
            res.json({ success: true, id: result.insertId });
    
        } catch (error) {
            console.error('❌ Erro ao criar categoria:', error);
            res.status(500).json({ error: 'Erro ao criar categoria' });
        }
    });
    
    // DELETE - Excluir categoria
    router.delete('/api/configuracoes/categorias/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('🗑️ Excluindo categoria...');
    
            const { id } = req.params;
    
            await pool.query(`
                UPDATE categorias SET ativo = 0, updated_at = NOW() WHERE id = ?
            `, [id]);
    
            console.log('✅ Categoria excluída com sucesso');
            res.json({ success: true });
    
        } catch (error) {
            console.error('❌ Erro ao excluir categoria:', error);
            res.status(500).json({ error: 'Erro ao excluir categoria' });
        }
    });
    
    // GET - Buscar categoria por ID
    router.get('/api/configuracoes/categorias/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [categorias] = await pool.query(`
                SELECT id, nome, descricao, cor FROM categorias WHERE id = ? AND ativo = 1
            `, [id]);
    
            if (categorias.length === 0) {
                return res.status(404).json({ error: 'Categoria não encontrada' });
            }
    
            res.json(categorias[0]);
        } catch (error) {
            console.error('❌ Erro ao buscar categoria:', error);
            res.status(500).json({ error: 'Erro ao buscar categoria' });
        }
    });
    
    // PUT - Atualizar categoria
    router.put('/api/configuracoes/categorias/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, descricao, cor } = req.body;
    
            await pool.query(`
                UPDATE categorias SET nome = ?, descricao = ?, cor = ?, updated_at = NOW() WHERE id = ?
            `, [nome, descricao, cor, id]);
    
            console.log('✅ Categoria atualizada com sucesso');
            res.json({ success: true });
        } catch (error) {
            console.error('❌ Erro ao atualizar categoria:', error);
            res.status(500).json({ error: 'Erro ao atualizar categoria' });
        }
    });
    
    // GET - Listar departamentos
    router.get('/api/configuracoes/departamentos', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Buscando departamentos...');
    
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM departamentos WHERE ativo = 1');
            const [departamentos] = await pool.query(`
                SELECT id, nome, descricao, created_at, updated_at
                FROM departamentos
                WHERE ativo = 1
                ORDER BY nome
                LIMIT ? OFFSET ?
            `, [limit, offset]);
    
            res.json({ data: departamentos, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('❌ Erro ao buscar departamentos:', error);
            res.status(500).json({ error: 'Erro ao buscar departamentos' });
        }
    });
    
    // POST - Criar departamento
    router.post('/api/configuracoes/departamentos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('💾 Criando departamento...');
    
            const { nome, descricao, responsavel } = req.body;
    
            const [result] = await pool.query(`
                INSERT INTO departamentos (nome, descricao, responsavel, ativo, created_at, updated_at)
                VALUES (?, ?, ?, 1, NOW(), NOW())
            `, [nome, descricao, responsavel || null]);
    
            console.log('✅ Departamento criado com sucesso');
            res.json({ success: true, id: result.insertId });
    
        } catch (error) {
            console.error('❌ Erro ao criar departamento:', error);
            res.status(500).json({ error: 'Erro ao criar departamento' });
        }
    });
    
    // DELETE - Excluir departamento
    router.delete('/api/configuracoes/departamentos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('🗑️ Excluindo departamento...');
    
            const { id } = req.params;
    
            await pool.query(`
                UPDATE departamentos SET ativo = 0, updated_at = NOW() WHERE id = ?
            `, [id]);
    
            console.log('✅ Departamento excluído com sucesso');
            res.json({ success: true });
    
        } catch (error) {
            console.error('❌ Erro ao excluir departamento:', error);
            res.status(500).json({ error: 'Erro ao excluir departamento' });
        }
    });
    
    // GET - Buscar departamento por ID
    router.get('/api/configuracoes/departamentos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [departamentos] = await pool.query(`
                SELECT id, nome, descricao, responsavel FROM departamentos WHERE id = ? AND ativo = 1
            `, [id]);
    
            if (departamentos.length === 0) {
                return res.status(404).json({ error: 'Departamento não encontrado' });
            }
    
            res.json(departamentos[0]);
        } catch (error) {
            console.error('❌ Erro ao buscar departamento:', error);
            res.status(500).json({ error: 'Erro ao buscar departamento' });
        }
    });
    
    // PUT - Atualizar departamento
    router.put('/api/configuracoes/departamentos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, descricao, responsavel } = req.body;
    
            await pool.query(`
                UPDATE departamentos SET nome = ?, descricao = ?, responsavel = ?, updated_at = NOW() WHERE id = ?
            `, [nome, descricao, responsavel, id]);
    
            console.log('✅ Departamento atualizado com sucesso');
            res.json({ success: true });
        } catch (error) {
            console.error('❌ Erro ao atualizar departamento:', error);
            res.status(500).json({ error: 'Erro ao atualizar departamento' });
        }
    });
    
    // GET - Listar projetos
    router.get('/api/configuracoes/projetos', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Buscando projetos...');
    
            const [projetos] = await pool.query(`
                SELECT id, nome, descricao, created_at, updated_at
                FROM projetos
                WHERE ativo = 1
                ORDER BY nome
            `);
    
            res.json(projetos);
        } catch (error) {
            console.error('❌ Erro ao buscar projetos:', error);
            res.status(500).json({ error: 'Erro ao buscar projetos' });
        }
    });
    
    // POST - Criar projeto
    router.post('/api/configuracoes/projetos', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('💾 Criando projeto...');
    
            const { nome, descricao, data_inicio, data_fim, status } = req.body;
    
            // Mapear status do frontend para o ENUM do banco
            const statusMap = {
                'ativo': 'em_andamento',
                'pausado': 'pausado',
                'concluido': 'concluido',
                'cancelado': 'cancelado'
            };
            const dbStatus = statusMap[status] || 'em_andamento';
    
            const [result] = await pool.query(`
                INSERT INTO projetos (nome, descricao, data_inicio, data_previsao_fim, status, ativo, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())
            `, [nome, descricao, data_inicio || null, data_fim || null, dbStatus]);
    
            console.log('✅ Projeto criado com sucesso');
            res.json({ success: true, id: result.insertId });
    
        } catch (error) {
            console.error('❌ Erro ao criar projeto:', error);
            res.status(500).json({ error: 'Erro ao criar projeto' });
        }
    });
    
    // DELETE - Excluir projeto
    router.delete('/api/configuracoes/projetos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('🗑️ Excluindo projeto...');
    
            const { id } = req.params;
    
            await pool.query(`
                UPDATE projetos SET ativo = 0, updated_at = NOW() WHERE id = ?
            `, [id]);
    
            console.log('✅ Projeto excluído com sucesso');
            res.json({ success: true });
    
        } catch (error) {
            console.error('❌ Erro ao excluir projeto:', error);
            res.status(500).json({ error: 'Erro ao excluir projeto' });
        }
    });
    
    // GET - Buscar projeto por ID
    router.get('/api/configuracoes/projetos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [projetos] = await pool.query(`
                SELECT id, nome, descricao, data_inicio, data_previsao_fim as data_fim, status FROM projetos WHERE id = ? AND ativo = 1
            `, [id]);
    
            if (projetos.length === 0) {
                return res.status(404).json({ error: 'Projeto não encontrado' });
            }
    
            res.json(projetos[0]);
        } catch (error) {
            console.error('❌ Erro ao buscar projeto:', error);
            res.status(500).json({ error: 'Erro ao buscar projeto' });
        }
    });
    
    // PUT - Atualizar projeto
    router.put('/api/configuracoes/projetos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, descricao, data_inicio, data_fim, status } = req.body;
    
            // Mapear status do frontend para o ENUM do banco
            const statusMap = {
                'ativo': 'em_andamento',
                'pausado': 'pausado',
                'concluido': 'concluido',
                'cancelado': 'cancelado'
            };
            const dbStatus = statusMap[status] || 'em_andamento';
    
            await pool.query(`
                UPDATE projetos SET nome = ?, descricao = ?, data_inicio = ?, data_previsao_fim = ?, status = ?, updated_at = NOW() WHERE id = ?
            `, [nome, descricao, data_inicio || null, data_fim || null, dbStatus, id]);
    
            console.log('✅ Projeto atualizado com sucesso');
            res.json({ success: true });
        } catch (error) {
            console.error('❌ Erro ao atualizar projeto:', error);
            res.status(500).json({ error: 'Erro ao atualizar projeto' });
        }
    });
    
    // GET - Buscar dados do certificado (integrado com módulo NFe)
    router.get('/api/configuracoes/certificado', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Buscando certificado digital...');
    
            const empresaId = 1; // Empresa padrão
    
            // Primeiro tentar buscar da tabela nfe_configuracoes (mais completa)
            const [nfeConfig] = await pool.query(`
                SELECT certificado_validade as validade,
                       certificado_cnpj as cnpj,
                       certificado_nome as nome,
                       created_at,
                       updated_at,
                       CASE WHEN certificado_pfx IS NOT NULL THEN 1 ELSE 0 END as tem_certificado
                FROM nfe_configuracoes
                WHERE empresa_id = ?
                LIMIT 1
            `, [empresaId]);
    
            if (nfeConfig && nfeConfig.length > 0 && nfeConfig[0].tem_certificado) {
                const cert = nfeConfig[0];
                const diasRestantes = cert.validade ?
                    Math.ceil((new Date(cert.validade) - new Date()) / (1000 * 60 * 60 * 24)) : null;
    
                res.json({
                    configurado: true,
                    validade: cert.validade,
                    cnpj: cert.cnpj,
                    nome: cert.nome,
                    diasRestantes: diasRestantes,
                    status: diasRestantes > 30 ? 'valido' : diasRestantes > 0 ? 'expirando' : 'expirado',
                    created_at: cert.created_at,
                    updated_at: cert.updated_at
                });
                return;
            }
    
            // Fallback: buscar da tabela certificados_digitais
            const [rows] = await pool.query(`
                SELECT validade, created_at, updated_at
                FROM certificados_digitais
                ORDER BY id DESC LIMIT 1
            `);
    
            if (rows.length > 0) {
                res.json({
                    configurado: true,
                    ...rows[0]
                });
            } else {
                res.json({
                    configurado: false
                });
            }
        } catch (error) {
            console.error('❌ Erro ao buscar certificado:', error);
            res.status(500).json({ error: 'Erro ao buscar certificado' });
        }
    });
    
    // POST - Salvar certificado digital (integrado com módulo NFe)
    router.post('/api/configuracoes/certificado', authenticateToken, authorizeAdmin, upload.single('certificado'), async (req, res) => {
        try {
            console.log('💾 Salvando certificado digital...');
    
            if (!req.file) {
                return res.status(400).json({ error: 'Arquivo de certificado não enviado' });
            }
    
            const { senha } = req.body;
            if (!senha) {
                return res.status(400).json({ error: 'Senha do certificado é obrigatória' });
            }
    
            const empresaId = 1; // Empresa padrão
            const pfxBuffer = req.file.buffer;
    
            // Validar certificado usando node-forge
            let certInfo = null;
            try {
                const forge = require('node-forge');
                const pfxBase64 = pfxBuffer.toString('base64');
                const pfxAsn1 = forge.util.decode64(pfxBase64);
                const p12Asn1 = forge.asn1.fromDer(pfxAsn1);
                const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);
    
                const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
                if (certBags && certBags[forge.pki.oids.certBag] && certBags[forge.pki.oids.certBag].length > 0) {
                    const cert = certBags[forge.pki.oids.certBag][0].cert;
    
                    // Extrair informações
                    const cn = cert.subject.getField('CN');
                    const cnValue = cn ? cn.value : '';
                    const cnpjMatch = cnValue.match(/(\d{14})/);
    
                    certInfo = {
                        cnpj: cnpjMatch ? cnpjMatch[1] : '',
                        razaoSocial: cnValue.split(':')[0].trim(),
                        validade: cert.validity.notAfter,
                        emissao: cert.validity.notBefore
                    };
    
                    // Verificar se certificado está válido
                    const agora = new Date();
                    if (cert.validity.notAfter < agora) {
                        return res.status(400).json({ error: 'Certificado expirado' });
                    }
                }
            } catch (forgeError) {
                console.error('❌ Erro ao validar certificado:', forgeError.message);
                if (forgeError.message.includes('Invalid password')) {
                    return res.status(400).json({ error: 'Senha do certificado incorreta' });
                }
                return res.status(400).json({ error: 'Certificado inválido: ' + forgeError.message });
            }
    
            // Criptografar senha (base64 simples - em produção usar algo mais seguro)
            const senhaCriptografada = Buffer.from(senha).toString('base64');
    
            // Verificar se já existe configuração para a empresa na tabela nfe_configuracoes
            const [existing] = await pool.query(
                'SELECT id FROM nfe_configuracoes WHERE empresa_id = ?',
                [empresaId]
            );
    
            if (existing && existing.length > 0) {
                // Atualizar configuração existente
                await pool.query(`
                    UPDATE nfe_configuracoes
                    SET certificado_pfx = ?,
                        certificado_senha = ?,
                        certificado_validade = ?,
                        certificado_cnpj = ?,
                        certificado_nome = ?,
                        updated_at = NOW()
                    WHERE empresa_id = ?
                `, [
                    pfxBuffer,
                    senhaCriptografada,
                    certInfo ? certInfo.validade : null,
                    certInfo ? certInfo.cnpj : null,
                    certInfo ? certInfo.razaoSocial : req.file.originalname,
                    empresaId
                ]);
            } else {
                // Criar nova configuração
                await pool.query(`
                    INSERT INTO nfe_configuracoes
                    (empresa_id, certificado_pfx, certificado_senha, certificado_validade, certificado_cnpj, certificado_nome, ambiente, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'homologacao', NOW(), NOW())
                `, [
                    empresaId,
                    pfxBuffer,
                    senhaCriptografada,
                    certInfo ? certInfo.validade : null,
                    certInfo ? certInfo.cnpj : null,
                    certInfo ? certInfo.razaoSocial : req.file.originalname
                ]);
            }
    
            // Também salvar na tabela certificados_digitais para compatibilidade
            await pool.query(`
                INSERT INTO certificados_digitais (arquivo_nome, senha_hash, validade, created_at, updated_at)
                VALUES (?, ?, ?, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    arquivo_nome = VALUES(arquivo_nome),
                    senha_hash = VALUES(senha_hash),
                    validade = VALUES(validade),
                    updated_at = NOW()
            `, [
                req.file.originalname,
                senhaCriptografada,
                certInfo ? certInfo.validade : new Date(Date.now() + 365*24*60*60*1000)
            ]);
    
            console.log('✅ Certificado salvo com sucesso nas tabelas nfe_configuracoes e certificados_digitais');
    
            res.json({
                success: true,
                message: 'Certificado instalado com sucesso',
                info: certInfo ? {
                    cnpj: certInfo.cnpj,
                    razaoSocial: certInfo.razaoSocial,
                    validade: certInfo.validade,
                    diasRestantes: Math.ceil((certInfo.validade - new Date()) / (1000 * 60 * 60 * 24))
                } : null
            });
    
        } catch (error) {
            console.error('❌ Erro ao salvar certificado:', error);
            res.status(500).json({ error: 'Erro ao salvar certificado: ' + error.message });
        }
    });
    
    // GET - Buscar configuração de importação de NF-e
    router.get('/api/configuracoes/nfe-import', authenticateToken, async (req, res) => {
        try {
            console.log('📋 Buscando config de NF-e...');
    
            const [rows] = await pool.query(`
                SELECT ativo, data_ativacao, updated_at
                FROM configuracoes_nfe
                ORDER BY id DESC LIMIT 1
            `);
    
            if (rows.length > 0) {
                res.json(rows[0]);
            } else {
                res.json({ ativo: false });
            }
        } catch (error) {
            console.error('❌ Erro ao buscar config de NF-e:', error);
            res.status(500).json({ error: 'Erro ao buscar configuração' });
        }
    });
    
    // POST - Salvar configuração de importação de NF-e
    router.post('/api/configuracoes/nfe-import', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            console.log('💾 Salvando config de NF-e...');
    
            const { ativo, data_ativacao } = req.body;
    
            // Verificar se já existe registro
            const [existing] = await pool.query('SELECT id FROM configuracoes_nfe LIMIT 1');
    
            if (existing.length > 0) {
                // Atualizar
                await pool.query(`
                    UPDATE configuracoes_nfe SET
                        ativo = ?, data_ativacao = ?, updated_at = NOW()
                    WHERE id = ?
                `, [ativo, data_ativacao, existing[0].id]);
            } else {
                // Inserir
                await pool.query(`
                    INSERT INTO configuracoes_nfe (ativo, data_ativacao, created_at, updated_at)
                    VALUES (?, ?, NOW(), NOW())
                `, [ativo, data_ativacao]);
            }
    
            console.log('✅ Config de NF-e salva com sucesso');
            res.json({ success: true });
    
        } catch (error) {
            console.error('❌ Erro ao salvar config de NF-e:', error);
            res.status(500).json({ error: 'Erro ao salvar configuração' });
        }
    });
    
    // =================================================================
    // ROTAS DA API DE IMPRESSÃO
    // =================================================================
    
    // Obter fila de impressão
    // SECURITY: Requer autenticação
    router.get('/api/print/queue', authenticateToken, async (req, res) => {
        try {
            const autoPrintSystem = require('../scripts/auto-print-system');
            const queue = await autoPrintSystem.getQueue();
    
            res.json({
                success: true,
                queue: queue
            });
        } catch (error) {
            console.error('❌ Erro ao obter fila de impressão:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Obter histórico de impressões
    // SECURITY: Requer autenticação
    router.get('/api/print/queue/history', authenticateToken, async (req, res) => {
        try {
            const autoPrintSystem = require('../scripts/auto-print-system');
            const history = await autoPrintSystem.getHistory();
    
            res.json({
                success: true,
                history: history
            });
        } catch (error) {
            console.error('❌ Erro ao obter histórico:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Obter impressoras disponíveis (SECURITY: Added authenticateToken)
    router.get('/api/print/printers', authenticateToken, async (req, res) => {
        try {
            const autoPrintSystem = require('../scripts/auto-print-system');
            const printers = await autoPrintSystem.detectPrinters();
    
            res.json({
                success: true,
                printers: printers
            });
        } catch (error) {
            console.error('❌ Erro ao obter impressoras:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Detectar impressoras (SECURITY: Added authenticateToken)
    router.post('/api/print/printers/detect', authenticateToken, async (req, res) => {
        try {
            const autoPrintSystem = require('../scripts/auto-print-system');
            const printers = await autoPrintSystem.detectPrinters();
    
            res.json({
                success: true,
                count: printers.length,
                printers: printers
            });
        } catch (error) {
            console.error('❌ Erro ao detectar impressoras:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Adicionar job à fila de impressão
    // SECURITY: Requer autenticação
    router.post('/api/print/add', authenticateToken, upload.single('file'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'Nenhum arquivo fornecido'
                });
            }
    
            const settings = JSON.parse(req.body.settings || '{}');
            const autoPrintSystem = require('../scripts/auto-print-system');
    
            const job = await autoPrintSystem.addToQueue(req.file.path, {
                printer: settings.printer,
                copies: settings.copies || 1,
                paperSize: settings.paperSize || 'A4',
                orientation: settings.orientation || 'portrait',
                colorMode: settings.colorMode || 'color',
                priority: settings.priority || 'normal',
                metadata: {
                    originalName: req.file.originalname,
                    documentName: req.file.originalname,
                    fileSize: req.file.size,
                    mimeType: req.file.mimetype
                }
            });
    
            res.json({
                success: true,
                jobId: job.id,
                message: 'Arquivo adicionado à fila de impressão'
            });
        } catch (error) {
            console.error('❌ Erro ao adicionar à fila:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Cancelar job de impressão
    // SECURITY: Requer autenticação
    router.post('/api/print/cancel', authenticateToken, async (req, res) => {
        try {
            const { jobId } = req.body;
    
            if (!jobId) {
                return res.status(400).json({
                    success: false,
                    error: 'ID do job não fornecido'
                });
            }
    
            const autoPrintSystem = require('../scripts/auto-print-system');
            const result = await autoPrintSystem.cancelJob(jobId);
    
            res.json({
                success: true,
                cancelled: result
            });
        } catch (error) {
            console.error('❌ Erro ao cancelar job:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Limpar fila de impressão
    // SECURITY: Requer autenticação de administrador
    router.post('/api/print/queue/clear', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const autoPrintSystem = require('../scripts/auto-print-system');
            const result = await autoPrintSystem.clearQueue();
    
            res.json({
                success: true,
                cancelledCount: result.cancelledCount
            });
        } catch (error) {
            console.error('❌ Erro ao limpar fila:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Obter estatísticas de impressão
    router.get('/api/print/stats', async (req, res) => {
        try {
            const autoPrintSystem = require('../scripts/auto-print-system');
            const stats = await autoPrintSystem.getStatistics();
    
            res.json({
                success: true,
                stats: stats
            });
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Definir impressora padrão
    // 🔐 SECURITY AUDIT: Added authenticateToken - system settings require auth
    router.post('/api/print/settings/default-printer', authenticateToken, async (req, res) => {
        try {
            const { printerName } = req.body;
    
            if (!printerName) {
                return res.status(400).json({
                    success: false,
                    error: 'Nome da impressora não fornecido'
                });
            }
    
            const autoPrintSystem = require('../scripts/auto-print-system');
            const result = await autoPrintSystem.setDefaultPrinter(printerName);
    
            res.json({
                success: true,
                defaultPrinter: result
            });
        } catch (error) {
            console.error('❌ Erro ao definir impressora padrão:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Atualizar configurações do sistema de impressão
    // 🔐 SECURITY AUDIT: Added authenticateToken
    router.post('/api/print/settings', authenticateToken, async (req, res) => {
        try {
            const settings = req.body;
            const autoPrintSystem = require('../scripts/auto-print-system');
            const result = await autoPrintSystem.updateSettings(settings);
    
            res.json({
                success: true,
                settings: result
            });
        } catch (error) {
            console.error('❌ Erro ao atualizar configurações:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // API PARA BUSCAR ÚLTIMO NÚMERO DE PEDIDO
    router.get('/ultimo-pedido', authenticateToken, async (req, res) => {
        try {
            console.log('🔍 Buscando último número de pedido...');
    
            const connection = await pool.getConnection();
            try {
                // Buscar o maior número de pedido registrado
                const [rows] = await connection.query(`
                    SELECT MAX(CAST(numero_pedido AS UNSIGNED)) as ultimo_numero
                    FROM ordens_producao
                    WHERE numero_pedido IS NOT NULL
                    AND numero_pedido REGEXP '^[0-9]+$'
                `);
    
                let ultimoNumero = '0002025000'; // Número inicial padrão
    
                if (rows && rows.length > 0 && rows[0].ultimo_numero) {
                    ultimoNumero = String(rows[0].ultimo_numero);
                }
    
                console.log('✅ Último número de pedido:', ultimoNumero);
    
                res.json({
                    success: true,
                    ultimo_numero: ultimoNumero
                });
    
            } finally {
                connection.release();
            }
    
        } catch (error) {
            console.error('❌ Erro ao buscar último pedido:', error);
            // Retornar número padrão em caso de erro
            res.json({
                success: true,
                ultimo_numero: '0002025000'
            });
        }
    });
    
    // API PARA GERAR ORDEM DE PRODUÇÁO EM EXCEL
    router.post('/api/gerar-ordem-excel', authenticateToken, async (req, res) => {
        try {
            console.log('📊 Iniciando geração de Ordem de Produção em Excel...');
    
            const dadosOrdem = req.body;
    
            console.log('🔍 DADOS RECEBIDOS - TRANSPORTADORA:', {
                transportadora_nome: dadosOrdem.transportadora_nome,
                transportadora_fone: dadosOrdem.transportadora_fone,
                transportadora_cep: dadosOrdem.transportadora_cep,
                transportadora_endereco: dadosOrdem.transportadora_endereco,
                transportadora_cpf_cnpj: dadosOrdem.transportadora_cpf_cnpj,
                transportadora_email_nfe: dadosOrdem.transportadora_email_nfe
            });
    
            // Validar dados obrigatórios
            if (!dadosOrdem.numero_orcamento || !dadosOrdem.cliente) {
                return res.status(400).json({
                    error: 'Dados obrigatórios não fornecidos (numero_orcamento, cliente)'
                });
            }
    
            try {
                console.log('📊 Tentando gerar XLSX usando template com ExcelJS...');
    
                const ExcelJS = require('exceljs');
                const fs = require('fs');
                const path = require('path');
    
                console.log('✅ ExcelJS carregado');
    
                // Usar caminho relativo simples para evitar problemas de encoding
                // 🔧 USAR TEMPLATE ORIGINAL COMPLETO para preservar formatação e fórmulas
                const templatePath = 'modules/PCP/Ordem de Produção.xlsx';
                const dataOrdem = dadosOrdem.data_liberacao || new Date().toLocaleDateString('pt-BR');
                // Formatar nome do cliente para nome de arquivo válido
                const nomeCliente = (dadosOrdem.cliente || dadosOrdem.cliente_razao || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
                const nomeArquivo = `Ordem de Produção - ${nomeCliente} - ERP.xlsx`;
                const outputPath = path.join(__dirname, nomeArquivo);
    
                console.log('📂 Template path:', templatePath);
                console.log('📄 Output path:', outputPath);
    
                // Verificar se template existe
                if (!fs.existsSync(templatePath)) {
                    throw new Error(`Template não encontrado: ${templatePath}`);
                }
    
                // Usar função existente que carrega e preenche o template
                const fileBuffer = await gerarExcelOrdemProducaoCompleta(dadosOrdem, ExcelJS, templatePath);
    
                console.log('✅ Template processado');
                console.log(`📊 Buffer gerado: ${fileBuffer.length} bytes`);
    
                // Configurar headers para download
                res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Length', fileBuffer.length);
    
                res.send(fileBuffer);
    
                console.log(`✅ Excel gerado com sucesso usando template: ${nomeArquivo}`);
    
            } catch (excelError) {
                console.log('❌ ERRO ao gerar XLSX:', excelError.message);
                console.log('📍 Stack trace:', excelError.stack);
    
                // Fallback para CSV
                const csvBuffer = await gerarExcelOrdemProducaoFallback(dadosOrdem);
    
                const nomeCliente = (dadosOrdem.cliente || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
                const nomeArquivo = `Ordem de Produção - ${nomeCliente} - ERP.csv`;
    
                res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Length', csvBuffer.length);
    
                res.send(csvBuffer);
    
                console.log(`✅ CSV gerado com sucesso como fallback: ${nomeArquivo}`);
            }
    
        } catch (error) {
            console.error('❌ Erro ao gerar Excel da ordem de produção:', error);
            res.status(500).json({
                error: 'Erro interno do servidor ao gerar Excel',
                details: error.message
            });
        }
    });
    
    // Função para gerar Excel da Ordem de Produção usando ExcelJS COM TEMPLATE CORRETO
    async function gerarExcelOrdemProducaoCompleta(dados, ExcelJS, templatePath) {
        console.log('📂 Carregando template Excel...');
    
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
    
        // 🎯 CORREÇÃO: Usar a aba VENDAS_PCP explicitamente
        const abaVendas = workbook.getWorksheet('VENDAS_PCP') || workbook.worksheets[0];
        const abaProducao = workbook.getWorksheet('PRODUÇÃO') || workbook.getWorksheet('PRODUCAO') || workbook.worksheets[1];
    
        if (!abaVendas) {
            throw new Error('Aba VENDAS_PCP não encontrada no template!');
        }
    
        console.log(`✅ Template carregado! Abas encontradas: ${workbook.worksheets.map(w => w.name).join(', ')}`);
        console.log('🔧 Usando template PREENCHIDO - fórmulas serão preservadas!\n');
        console.log('✏️ Preenchendo aba VENDAS_PCP...\n');
    
        // ========================================
        // ABA VENDAS_PCP - CABEÇALHO (linhas 4-9)
        // ========================================
    
        console.log('📝 Preenchendo cabeçalho...');
    
        // C4 - Número do Orçamento (como número se possível)
        const numOrcamento = dados.numero_orcamento || '';
        abaVendas.getCell('C4').value = isNaN(numOrcamento) ? numOrcamento : parseFloat(numOrcamento);
    
        // G4 - Número do Pedido (como número se possível)
        const numPedido = dados.numero_pedido || dados.num_pedido || '0';
        // Se for vazio ou NaN, usar 0
        const numPedidoFinal = numPedido === '' || numPedido === null || numPedido === undefined ? '0' : numPedido;
        abaVendas.getCell('G4').value = isNaN(numPedidoFinal) ? numPedidoFinal : parseFloat(numPedidoFinal);
    
        // J4 - Data de Liberação (como objeto Date)
        if (dados.data_liberacao) {
            // Se já é Date, usa direto
            if (dados.data_liberacao instanceof Date) {
                abaVendas.getCell('J4').value = dados.data_liberacao;
            } else {
                // Tentar converter string para Date (formato dd/mm/yyyy ou yyyy-mm-dd)
                const dataStr = String(dados.data_liberacao);
                let dataObj;
    
                if (dataStr.includes('/')) {
                    const [d, m, y] = dataStr.split('/');
                    dataObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
                } else if (dataStr.includes('-')) {
                    dataObj = new Date(dataStr);
                } else {
                    dataObj = new Date();
                }
    
                abaVendas.getCell('J4').value = dataObj;
            }
            abaVendas.getCell('J4').numFmt = 'dd/mm/yyyy';
        } else {
            abaVendas.getCell('J4').value = new Date();
            abaVendas.getCell('J4').numFmt = 'dd/mm/yyyy';
        }
    
        // Vendedor (linha 6)
        abaVendas.getCell('C6').value = dados.vendedor || '';
    
        // 🔧 H6 - Calcular prazo de entrega (data liberação + dias) ao invés de usar fórmula
        if (dados.prazo_entrega) {
            // Se veio uma data específica, usar
            if (dados.prazo_entrega instanceof Date) {
                abaVendas.getCell('H6').value = dados.prazo_entrega;
            } else if (typeof dados.prazo_entrega === 'string' && dados.prazo_entrega.includes('/')) {
                // Tentar parsear data no formato dd/mm/yyyy
                const [d, m, y] = dados.prazo_entrega.split('/');
                abaVendas.getCell('H6').value = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
            } else {
                abaVendas.getCell('H6').value = dados.prazo_entrega;
            }
            abaVendas.getCell('H6').numFmt = 'dd/mm/yyyy';
        } else {
            // Calcular: data liberação + 30 dias
            const dataLib = abaVendas.getCell('J4').value;
            if (dataLib instanceof Date) {
                const prazo = new Date(dataLib);
                prazo.setDate(prazo.getDate() + 30);
                abaVendas.getCell('H6').value = prazo;
                abaVendas.getCell('H6').numFmt = 'dd/mm/yyyy';
            }
        }
    
        // Cliente (linhas 7-9)
        abaVendas.getCell('C7').value = dados.cliente || '';
        abaVendas.getCell('C8').value = dados.contato || dados.contato_cliente || '';
    
        // H8 - Telefone (como número se possível, sem formatação)
        const telefone = dados.telefone || dados.fone_cliente || '';
        const telefoneNum = String(telefone).replace(/\D/g, ''); // Remove não-dígitos
        abaVendas.getCell('H8').value = telefoneNum ? parseFloat(telefoneNum) : telefone;
    
        abaVendas.getCell('C9').value = dados.email || dados.email_cliente || '';
        abaVendas.getCell('J9').value = dados.frete || dados.tipo_frete || '';
    
        // ========================================
        // ABA VENDAS_PCP - TRANSPORTADORA (linhas 12-15)
        // ========================================
    
        // C12 - Nome da Transportadora
        const nomeTransp = dados.transportadora_nome || dados.transportadora?.nome || '';
        abaVendas.getCell('C12').value = nomeTransp;
        console.log(`   Transportadora Nome: ${nomeTransp}`);
    
        // 🔧 H12 - Telefone da transportadora (calcular ao invés de fórmula)
        const telefoneTransp = dados.transportadora_fone || dados.transportadora?.fone || telefone || '';
        if (telefoneTransp) {
            const telefoneTranspNum = String(telefoneTransp).replace(/\D/g, '');
            abaVendas.getCell('H12').value = telefoneTranspNum ? parseFloat(telefoneTranspNum) : telefoneTransp;
            console.log(`   Transportadora Fone: ${telefoneTransp}`);
        } else {
            abaVendas.getCell('H12').value = '';
        }
    
        // C13 - CEP da Transportadora
        const cepTransp = dados.transportadora_cep || dados.transportadora?.cep || '';
        abaVendas.getCell('C13').value = cepTransp;
        console.log(`   Transportadora CEP: ${cepTransp}`);
    
        // F13 - Endereço da Transportadora
        const endTransp = dados.transportadora_endereco || dados.transportadora?.endereco || '';
        abaVendas.getCell('F13').value = endTransp;
        console.log(`   Transportadora Endereço: ${endTransp}`);
    
        // ========================================
        // ABA VENDAS_PCP - DADOS PARA COBRANÇA (linha 14)
        // ========================================
    
        console.log('💰 Dados para cobrança...');
    
        // C14 - NÃO PREENCHER (conforme template original)
        // A célula C14 deve ficar vazia/em branco
        const cellC14 = abaVendas.getCell('C14');
        cellC14.value = ''; // Manter vazio conforme template
        console.log(`   C14: Mantido em branco (conforme template)`);
    
        // G14 - Email NF-e para Cobrança (PRIORIZAR EMAIL DO CLIENTE!)
        const emailNfeCobranca = dados.email_nfe_cobranca || dados.email_cliente || dados.email ||
                                 dados.email_nfe;
        if (emailNfeCobranca) {
            abaVendas.getCell('G14').value = emailNfeCobranca;
        }
    
        // C15 - CPF/CNPJ do CLIENTE (Dados para Cobrança - conforme template)
        // CORREÇÃO: Usar CNPJ do cliente, não da transportadora
        const cnpjCliente = dados.cpf_cnpj || dados.cliente_cpf_cnpj || '';
        // CRÍTICO: Não usar parseFloat() - causa notação científica (3.64086E+13)
        // Manter como string com formato de texto
        let cnpjStr = String(cnpjCliente).replace(/\D/g, ''); // Remove não-dígitos
        if (!cnpjStr || cnpjStr.length < 11) {
            cnpjStr = ''; // Deixar vazio se não informado
        }
        const cellC15 = abaVendas.getCell('C15');
        cellC15.value = cnpjStr;
        // Formatação visual igual ao template preenchido
        cellC15.numFmt = '[<=99999999999]000.000.000-00;00.000.000/0000-00';
    
        // 🔧 G15 - Email NF-e da transportadora (calcular ao invés de fórmula)
        const emailNfe = dados.transportadora_email_nfe || dados.transportadora?.email_nfe ||
                         dados.email_nfe || dados.email_cliente;
        if (emailNfe) {
            abaVendas.getCell('G15').value = emailNfe;
        }
    
        // ========================================
        // ABA VENDAS_PCP - PRODUTOS (linhas 18-32)
        // ========================================
        //
        // MAPEAMENTO CORRETO DO TEMPLATE:
        // ┌─────────┬────────────────────────────────────────────────────────┐
        // │ COLUNA  │ CAMPO                                                  │
        // ├─────────┼────────────────────────────────────────────────────────┤
        // │ A       │ # Item (1, 2, 3...)                                    │
        // │ B       │ Código do Produto (TRN10, DUN16, etc)                  │
        // │ C-E     │ Produto (VLOOKUP automático - NÃO PREENCHER!)          │
        // │ F       │ Embalagem (Bobina, Caixa, etc)                         │
        // │ G       │ Lance(s) (1x1000, 1x500, etc)                          │
        // │ H       │ Quantidade                                             │
        // │ I       │ Valor Unitário R$                                      │
        // │ J       │ Valor Total R$ (calculado)                             │
        // └─────────┴────────────────────────────────────────────────────────┘
        //
        // ⚠️ IMPORTANTE:
        // - Coluna C tem FÓRMULA VLOOKUP que busca descrição pelo código
        // - Colunas C-E estão MESCLADAS no template
        // - NÃO existe coluna de "Variação" no template VENDAS_PCP
        // - Produtos começam na LINHA 18 (não 19!)
        // ========================================
    
        console.log('📦 Preenchendo produtos...');
        let produtos = dados.produtos || dados.items || dados.itens || [];
    
        // Converter string JSON se necessário
        if (typeof produtos === 'string') {
            try {
                produtos = JSON.parse(produtos);
            } catch(e) {
                console.error('❌ Erro ao parsear produtos:', e);
                produtos = [];
            }
        }
    
        // Garantir que é array
        if (!Array.isArray(produtos)) {
            produtos = [];
        }
    
        // ⚠️ LINHA 17 É CABEÇALHO, PRODUTOS COMEÇAM NA LINHA 18!
        let linhaAtual = 18;
        const LINHA_MAXIMA_PRODUTOS = 32; // Última linha de produtos
    
        // 🔧 Construir catálogo de produtos do template (colunas N:O)
        const catalogoProdutos = {};
        for (let r = 18; r <= 180; r++) {
            const cod = abaVendas.getCell(`N${r}`).value;
            const desc = abaVendas.getCell(`O${r}`).value;
            if (cod && cod !== 'PRODUTO' && desc) {
                catalogoProdutos[String(cod).trim().toUpperCase()] = String(desc).trim();
            }
        }
        console.log(`📚 Catálogo carregado: ${Object.keys(catalogoProdutos).length} produtos`);
    
        produtos.forEach((prod, index) => {
            if (prod && linhaAtual <= LINHA_MAXIMA_PRODUTOS) {
                const codigoProd = String(prod.codigo || '').trim().toUpperCase();
                const descricaoCatalogo = catalogoProdutos[codigoProd] || prod.descricao || '';
    
                console.log(`   📦 Produto ${index + 1} → Linha ${linhaAtual}:`);
                console.log(`      Código: ${codigoProd}`);
                console.log(`      Descrição (catálogo): ${descricaoCatalogo}`);
                console.log(`      Embalagem: ${prod.embalagem}`);
                console.log(`      Lances: ${prod.lances}`);
                console.log(`      Qtd: ${prod.quantidade}`);
                console.log(`      Valor: ${prod.valor_unitario}`);
    
                // A - Número do item (sequencial)
                abaVendas.getCell(`A${linhaAtual}`).value = index + 1;
    
                // B - Código do produto (usado pelo VLOOKUP da coluna C)
                abaVendas.getCell(`B${linhaAtual}`).value = codigoProd;
    
                // C - Atualizar o RESULT da fórmula VLOOKUP para garantir que aparece a descrição
                // Preservar a fórmula mas forçar o resultado
                const cellC = abaVendas.getCell(`C${linhaAtual}`);
                if (cellC.value && typeof cellC.value === 'object' && cellC.value.formula) {
                    // Manter a fórmula e adicionar o resultado
                    cellC.value = {
                        formula: cellC.value.formula,
                        result: descricaoCatalogo
                    };
                } else {
                    // Se não tem fórmula, colocar direto
                    cellC.value = descricaoCatalogo;
                }
    
                // F - Embalagem
                abaVendas.getCell(`F${linhaAtual}`).value = prod.embalagem || '';
    
                // G - Lance(s)
                abaVendas.getCell(`G${linhaAtual}`).value = prod.lances || '';
    
                // H - Quantidade
                const quantidade = parseFloat(prod.quantidade) || 0;
                abaVendas.getCell(`H${linhaAtual}`).value = quantidade;
    
                // I - Valor Unitário
                const valorUnitario = parseFloat(prod.valor_unitario) || parseFloat(prod.preco) || 0;
                abaVendas.getCell(`I${linhaAtual}`).value = valorUnitario;
                abaVendas.getCell(`I${linhaAtual}`).numFmt = 'R$ #,##0.00';
    
                // J - Valor Total (calculado, não fórmula para garantir valor correto)
                const valorTotal = quantidade * valorUnitario;
                abaVendas.getCell(`J${linhaAtual}`).value = valorTotal;
                abaVendas.getCell(`J${linhaAtual}`).numFmt = 'R$ #,##0.00';
    
                console.log(`      ✅ Linha ${linhaAtual} preenchida!`);
                linhaAtual++;
            }
        });
        // Reforçar formatação de I18-I32 e J18-J32 após o preenchimento dos produtos
        // Linha 17 é cabeçalho, produtos começam na 18
        for (let i = 18; i <= 32; i++) {
            // Preço unitário
            abaVendas.getCell(`I${i}`).numFmt = 'R$ #,##0.00';
            const valorUnit = abaVendas.getCell(`I${i}`).value;
            if (typeof valorUnit === 'number') {
                abaVendas.getCell(`I${i}`).value = Number(valorUnit.toFixed(2));
            }
    
            // Total - calcular sempre, mesmo se estiver vazio
            const qtd = parseFloat(abaVendas.getCell(`H${i}`).value) || 0;
            const preco = parseFloat(abaVendas.getCell(`I${i}`).value) || 0;
            const total = qtd * preco;
            abaVendas.getCell(`J${i}`).value = total;
            abaVendas.getCell(`J${i}`).numFmt = 'R$ #,##0.00';
        }
    
        // Calcular e preencher TOTAL GERAL (somando todas as linhas de produtos)
        // Produtos nas linhas 18-32
        let totalGeral = 0;
        for (let i = 18; i <= 32; i++) {
            const valorLinha = parseFloat(abaVendas.getCell(`J${i}`).value) || 0;
            totalGeral += valorLinha;
        }
    
        // Preencher célula de total (I35 conforme template)
        // Template mostra: I34="Total do Pedido:$" e I35=fórmula de soma
        abaVendas.getCell('I35').value = totalGeral;
        abaVendas.getCell('I35').numFmt = 'R$ #,##0.00';
        console.log(`💰 Total Geral calculado: R$ ${totalGeral.toFixed(2)}`);
    
        console.log(`✅ ${produtos.length} produtos preenchidos!`);
    
        // ========================================
        // ABA VENDAS_PCP - OBSERVAÇÕES (linhas 36-54)
        // ========================================
    
        // Observações do Pedido (área 36-42 tem merge de células A-J)
        if (dados.observacoes || dados.observacoes_pedido) {
            console.log('📝 Preenchendo observações do pedido...');
            // Linha 37-42 são células mescladas para observações
            const obs = dados.observacoes || dados.observacoes_pedido || '';
            abaVendas.getCell('B37').value = obs;
        }
    
        // ========================================
        // CONDIÇÕES DE PAGAMENTO (linhas 44-46)
        // ========================================
    
        console.log('💳 Preenchendo condições de pagamento...');
    
        // Linha 45-46: Formas de pagamento (respeitar merged cells - preencher apenas célula principal)
        // Template: A44:D44=header, A45:D45=forma1, E45=%, F45:H45=método, I45:J45=valor
        //           A46:D46=forma2, E46=%, F46:H46=método, I45:J46=valor
        const formasPag = dados.formas_pagamento || [];
    
        if (formasPag.length > 0) {
            // Linha 45: Primeira forma de pagamento
            abaVendas.getCell('A45').value = formasPag[0].forma || dados.forma_pagamento || 'A_VISTA';
            const perc1 = parseFloat(formasPag[0].percentual || dados.percentual_pagamento || 100) / 100;
            abaVendas.getCell('E45').value = perc1;
            abaVendas.getCell('E45').numFmt = '0%';
            abaVendas.getCell('F45').value = formasPag[0].metodo || dados.metodo_pagamento || 'BOLETO';
            const valor1 = totalGeral * perc1;
            abaVendas.getCell('I45').value = valor1;
            abaVendas.getCell('I45').numFmt = 'R$ #,##0.00';
    
            // Linha 46: Segunda forma de pagamento (se houver)
            if (formasPag.length > 1) {
                abaVendas.getCell('A46').value = formasPag[1].forma || 'ENTREGA';
                const perc2 = parseFloat(formasPag[1].percentual || 0) / 100;
                abaVendas.getCell('E46').value = perc2;
                abaVendas.getCell('E46').numFmt = '0%';
                abaVendas.getCell('F46').value = formasPag[1].metodo || '';
            }
        } else {
            // Fallback: usar campos legados
            abaVendas.getCell('A45').value = dados.forma_pagamento || 'A_VISTA';
            const perc = parseFloat(dados.percentual_pagamento || 100) / 100;
            abaVendas.getCell('E45').value = perc;
            abaVendas.getCell('E45').numFmt = '0%';
            abaVendas.getCell('F45').value = dados.metodo_pagamento || 'BOLETO';
            abaVendas.getCell('I45').value = totalGeral;
            abaVendas.getCell('I45').numFmt = 'R$ #,##0.00';
    
            // Se parcelado, calcular segunda linha
            if (perc < 1) {
                abaVendas.getCell('A46').value = 'ENTREGA';
                abaVendas.getCell('E46').value = 1 - perc;
                abaVendas.getCell('E46').numFmt = '0%';
            }
        }
    
        // ========================================
        // EMBALAGEM E OBSERVAÇÕES FINAIS (linhas 48-54)
        // ========================================
    
        // E50-E54: Seção OBSERVAÇÕES do template
        // E51:J54 são merged - preencher apenas E51 (célula principal)
        // Template: C51="COMPLETO", C53="PARCIAL" (status da entrega)
        const obsEntrega = dados.observacoes_entrega || '';
        const obsGeral = dados.observacoes || dados.observacoes_pedido || '';
        const obsTexto = obsEntrega ? `${obsEntrega}${obsGeral ? '\n' + obsGeral : ''}` : obsGeral;
        if (obsTexto) {
            console.log('📝 Preenchendo observações finais (E51)...');
            abaVendas.getCell('E51').value = obsTexto;
        }
    
        // Status de entrega: COMPLETO ou PARCIAL (C51/C53)
        const statusEntrega = dados.status_entrega || 'COMPLETO';
        if (statusEntrega === 'PARCIAL') {
            abaVendas.getCell('C51').value = '';
            abaVendas.getCell('C53').value = 'X';
        } else {
            abaVendas.getCell('C51').value = 'X';
            abaVendas.getCell('C53').value = '';
        }
    
        // ========================================
        // ABA VENDAS_PCP - CONDIÇÕES DE PAGAMENTO (linhas 43-46)
        // ========================================
    
        // A43 é label fixo "CONDIÇOES DE PAGAMENTO." - NÃO sobrescrever
        // Condições extras vão na área de observações (B37) junto com as obs do pedido
        if (dados.condicoes_pagamento) {
            const obsExistente = abaVendas.getCell('B37').value || '';
            const condPag = `Cond. Pagamento: ${dados.condicoes_pagamento}`;
            abaVendas.getCell('B37').value = obsExistente ? `${obsExistente}\n${condPag}` : condPag;
        }
    
        // ========================================
        // ABA VENDAS_PCP - VOLUMES E EMBALAGEM (linha 48)
        // ========================================
    
        if (dados.qtd_volumes) {
            abaVendas.getCell('C48').value = dados.qtd_volumes;
        }
    
        if (dados.tipo_embalagem_entrega) {
            abaVendas.getCell('H48').value = dados.tipo_embalagem_entrega;
        }
    
        // ========================================
        // ========================================
        // REFORÇO FINAL: Preencher C15 (CNPJ do CLIENTE para cobrança)
        let cnpjClienteFinal = dados.cpf_cnpj || dados.cliente_cpf_cnpj || '';
        let cnpjStrFinal = String(cnpjClienteFinal).replace(/\D/g, '');
        if (cnpjStrFinal && cnpjStrFinal.length >= 11) {
            const cellC15Final = abaVendas.getCell('C15');
            cellC15Final.value = cnpjStrFinal;
            cellC15Final.numFmt = '[<=99999999999]000.000.000-00;00.000.000/0000-00';
        }
        // ========================================
        // 🔧 ABA PRODUÇÃO: Atualizar fórmulas VLOOKUP com results
        // ========================================
        if (abaProducao) {
            console.log('\n🔧 Atualizando aba PRODUÇÃO...');
    
            // A aba PRODUÇÃO tem suas próprias fórmulas VLOOKUP na coluna C
            // As linhas de produtos são: 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52 (de 3 em 3)
            // Também precisa atualizar a coluna F (Código de Cores)
    
            // Pegar produtos já preenchidos na VENDAS_PCP
            const linhasProducao = [13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52];
    
            // Mapeamento: linha VENDAS_PCP (18,19,20...) -> linha PRODUÇÃO (13,16,19...)
            // VENDAS_PCP linha 18 = primeiro produto -> PRODUÇÃO linha 13
            // VENDAS_PCP linha 19 = segundo produto -> PRODUÇÃO linha 16
            // etc.
    
            produtos.forEach((prod, index) => {
                if (index < linhasProducao.length && prod) {
                    const linhaProd = linhasProducao[index];
                    const codigoProd = String(prod.codigo || '').trim().toUpperCase();
                    const descricaoCatalogo = catalogoProdutos[codigoProd] || prod.descricao || '';
    
                    // B - Código (pode ser uma fórmula referenciando VENDAS_PCP ou valor direto)
                    const cellB = abaProducao.getCell(`B${linhaProd}`);
                    if (cellB.value && typeof cellB.value === 'object' && cellB.value.formula) {
                        // Manter fórmula mas setar o result
                        cellB.value = { formula: cellB.value.formula, result: codigoProd };
                    } else {
                        cellB.value = codigoProd;
                    }
    
                    // C - Descrição do produto (tem VLOOKUP próprio)
                    const cellC = abaProducao.getCell(`C${linhaProd}`);
                    if (cellC.value && typeof cellC.value === 'object' && cellC.value.formula) {
                        cellC.value = { formula: cellC.value.formula, result: descricaoCatalogo };
                    } else if (descricaoCatalogo) {
                        cellC.value = descricaoCatalogo;
                    }
    
                    // Também verificar se há fórmula na linha +1 e +2 (layout 3-em-3)
                    for (let offset = 1; offset <= 2; offset++) {
                        const cellCExtra = abaProducao.getCell(`C${linhaProd + offset}`);
                        if (cellCExtra.value && typeof cellCExtra.value === 'object' && cellCExtra.value.formula) {
                            // Algumas linhas intermediárias podem ter fórmulas também
                            cellCExtra.value = { formula: cellCExtra.value.formula, result: '' };
                        }
                    }
    
                    // 🔧 CORREÇÃO: Preencher QUANTIDADE na coluna J com formato NUMÉRICO (SEM R$)
                    const quantidade = parseFloat(prod.quantidade) || 0;
                    if (quantidade > 0) {
                        const cellQtd = abaProducao.getCell(`J${linhaProd}`);
                        cellQtd.value = quantidade;
                        cellQtd.numFmt = '#,##0.00'; // Formato numérico SEM R$
                        console.log(`   J${linhaProd} (QTD) = ${quantidade} (formato numérico sem R$)`);
                    }
    
                    // Preencher P.LIQUIDO na coluna E da linha seguinte (linhaProd + 1)
                    const pesoLiquido = parseFloat(prod.peso_liquido) || 0;
                    if (pesoLiquido > 0) {
                        const cellPeso = abaProducao.getCell(`E${linhaProd + 1}`);
                        cellPeso.value = pesoLiquido;
                        cellPeso.numFmt = '#,##0.00';
                    }
    
                    // Preencher LOTE na coluna G da linha seguinte (linhaProd + 1)
                    if (prod.lote) {
                        const cellLote = abaProducao.getCell(`G${linhaProd + 1}`);
                        cellLote.value = prod.lote;
                    }
    
                    console.log(`   📦 PRODUÇÃO Linha ${linhaProd}: ${codigoProd} = ${descricaoCatalogo.substring(0, 40)}...`);
                }
            });
    
            console.log(`   ✅ ${Math.min(produtos.length, linhasProducao.length)} produtos atualizados na aba PRODUÇÃO`);
        }
    
        console.log('\n✅ Excel completo gerado com sucesso!');
        console.log('📊 Estrutura:');
        console.log('   - Cabeçalho: C4, G4, J4, C6, C7-C9');
        console.log('   - Transportadora: C12, C13, F13, C15, H12, G15');
        console.log(`   - Produtos: ${produtos.length} itens (linhas 18-${linhaAtual - 1})`);
        console.log('   - Pagamento: M, N, O, P, Q preenchidos');
        console.log(`   - Total Geral: R$ ${totalGeral.toFixed(2)}`);
        console.log('   ✨ Todos os valores calculados diretamente (sem fórmulas)\n');
    
        return await workbook.xlsx.writeBuffer();
    }
    
    // Função fallback para CSV
    async function gerarExcelOrdemProducaoFallback(dados) {
        const csv = [];
    
        // Header da Ordem de Produção
        csv.push(['ORDEM DE PRODUÇÁO ALUFORCE']);
        csv.push(['']);
        csv.push(['Dados da Ordem:']);
        csv.push(['Número do Orçamento:', dados.numero_orcamento || '']);
        csv.push(['Número do Pedido:', dados.numero_pedido || '']);
        csv.push(['Data de Liberação:', dados.data_liberacao || '']);
        csv.push(['Vendedor:', dados.vendedor || '']);
        csv.push(['Prazo de Entrega:', dados.prazo_entrega || '']);
        csv.push(['']);
    
        // Dados do Cliente
        csv.push(['Dados do Cliente:']);
        csv.push(['Nome do Cliente:', dados.cliente || '']);
        csv.push(['Contato:', dados.contato_cliente || '']);
        csv.push(['Telefone:', dados.fone_cliente || '']);
        csv.push(['Email:', dados.email_cliente || '']);
        csv.push(['Tipo de Frete:', dados.tipo_frete || '']);
        csv.push(['']);
    
        // Dados da Transportadora
        csv.push(['Dados da Transportadora:']);
        csv.push(['Nome:', dados.transportadora_nome || '']);
        csv.push(['Telefone:', dados.transportadora_fone || '']);
        csv.push(['CEP:', dados.transportadora_cep || '']);
        csv.push(['Endereço:', dados.transportadora_endereco || '']);
        csv.push(['CPF/CNPJ:', dados.transportadora_cpf_cnpj || '']);
        csv.push(['Email NFe:', dados.transportadora_email_nfe || '']);
        csv.push(['']);
    
        // Produtos
        csv.push(['PRODUTOS:']);
        csv.push(['Código', 'Descrição', 'Embalagem', 'Lances', 'Quantidade', 'Valor Unitário', 'Total']);
    
        if (dados.produtos && Array.isArray(dados.produtos)) {
            dados.produtos.forEach(produto => {
                const total = (produto.quantidade || 0) * (produto.valor_unitario || 0);
                csv.push([
                    produto.codigo || '',
                    produto.descricao || '',
                    produto.embalagem || 'Padrão',
                    produto.lances || '',
                    produto.quantidade || 0,
                    `R$ ${(produto.valor_unitario || 0).toFixed(2)}`,
                    `R$ ${total.toFixed(2)}`
                ]);
            });
    
            // Total geral
            const valorTotal = dados.produtos.reduce((total, produto) => {
                return total + ((produto.quantidade || 0) * (produto.valor_unitario || 0));
            }, 0);
    
            csv.push(['', '', '', '', '', 'TOTAL GERAL:', `R$ ${valorTotal.toFixed(2)}`]);
        }
    
        csv.push(['']);
    
        // Observações
        csv.push(['OBSERVAÇÕES:']);
        csv.push([dados.observacoes_pedido || 'Nenhuma observação especial.']);
        csv.push(['']);
    
        // Dados de Pagamento e Entrega
        csv.push(['CONDIÇÕES DE PAGAMENTO:']);
        csv.push([dados.condicoes_pagamento || '30 dias após faturamento']);
        csv.push(['']);
        csv.push(['DADOS DE ENTREGA:']);
        csv.push(['Data Prevista:', dados.data_previsao_entrega || '']);
        csv.push(['Quantidade de Volumes:', dados.qtd_volumes || '']);
        csv.push(['Tipo de Embalagem:', dados.tipo_embalagem_entrega || '']);
        csv.push(['Observações de Entrega:', dados.observacoes_entrega || '']);
    
        // Converter CSV para Buffer
        const csvString = csv.map(row => row.join('\t')).join('\n');
        const buffer = Buffer.from('\ufeff' + csvString, 'utf8'); // BOM para UTF-8
    
        return buffer;
    }
    
    // PEDIDOS - AUDITORIA 02/02/2026: Otimizado com campos específicos
    router.get('/pedidos', async (req, res, next) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
    
            const [rows] = await pool.query(`
                SELECT
                    p.id, p.cliente_id, p.empresa_id, p.vendedor_id,
                    p.valor, p.valor_total, p.status, p.prioridade,
                    p.prazo_entrega, p.condicao_pagamento, p.cenario_fiscal,
                    p.descricao, p.created_at, p.updated_at, p.version,
                    c.nome as cliente_nome,
                    e.nome as empresa_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas_emissoras e ON p.empresa_id = e.id
                ORDER BY p.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM pedidos');
    
            res.json({ pedidos: rows, total, page, limit });
        } catch (error) { next(error); }
    });
    
    // PEDIDOS FATURADOS - AUDITORIA 02/02/2026: Otimizado
    router.get('/pedidos/faturados', async (req, res, next) => {
        try {
            const [rows] = await pool.query(`
                SELECT
                    p.id, p.cliente_id, p.empresa_id, p.vendedor_id,
                    p.valor, p.valor_total, p.status, p.prioridade,
                    p.prazo_entrega, p.nfe_numero, p.nfe_chave,
                    p.created_at, p.updated_at,
                    c.nome as cliente_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.status IN ('faturado', 'recibo')
                ORDER BY p.id DESC LIMIT 10`);
            res.json(rows);
        } catch (error) { next(error); }
    });
    
    // PEDIDOS PRAZOS
    router.get('/pedidos/prazos', async (req, res, next) => {
        try {
            const [rows] = await pool.query("SELECT * FROM pedidos WHERE prazo_entrega IS NOT NULL ORDER BY prazo_entrega ASC LIMIT 10");
            res.json(rows);
        } catch (error) { next(error); }
    });
    
    // ACOMPANHAMENTO
    router.get('/acompanhamento', async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const [rows] = await pool.query("SELECT id, numero, produto, produto_id, cliente, quantidade, status, prioridade, prazo_entrega, data_criacao, data_inicio, data_fim, observacoes, responsavel FROM ordens_producao WHERE status != 'Concluído' ORDER BY id DESC LIMIT ?", [limit]);
            res.json(rows);
        } catch (error) { next(error); }
    });
    
    // CLIENTES - Autocomplete
    router.get('/clientes', async (req, res, next) => {
        try {
            const query = req.query.q || '';
            const limit = parseInt(req.query.limit) || 500; // Aumentado para 500 resultados
            const empresaId = req.query.empresa_id || 1; // Default empresa 1
    
            if (!query) {
                const [rows] = await pool.query(
                    'SELECT id, nome, nome_fantasia, razao_social, cnpj, cnpj_cpf, contato, email, telefone, vendedor_responsavel FROM clientes WHERE empresa_id = ? ORDER BY nome LIMIT ?',
                    [empresaId, limit]
                );
                return res.json(rows);
            }
    
            const searchPattern = `%${query}%`;
            const [rows] = await pool.query(
                `SELECT id, nome, nome_fantasia, razao_social, cnpj, cnpj_cpf, contato, email, telefone, vendedor_responsavel
                 FROM clientes
                 WHERE empresa_id = ? AND (nome LIKE ? OR nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ? OR cnpj_cpf LIKE ?)
                 ORDER BY nome
                 LIMIT ?`,
                [empresaId, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, limit]
            );
            res.json(rows);
        } catch (error) { next(error); }
    });
    
    // TRANSPORTADORAS - Autocomplete
    router.get('/transportadoras', async (req, res, next) => {
        try {
            const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
            const query = req.query.q || '';
            const limit = parseInt(req.query.limit) || 10;
    
            let sql, params;
            if (!query) {
                sql = 'SELECT id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, contato, telefone, email, bairro, cidade, estado, cep FROM transportadoras LIMIT ?';
                params = [limit];
            } else {
                // Buscar apenas por nome (cnpj está criptografado)
                const searchPattern = `%${query}%`;
                sql = 'SELECT id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, contato, telefone, email, bairro, cidade, estado, cep FROM transportadoras WHERE razao_social LIKE ? OR nome_fantasia LIKE ? LIMIT ?';
                params = [searchPattern, searchPattern, limit];
            }
    
            const [rows] = await pool.query(sql, params);
            const resultado = rows.map(r => ({
                id: r.id,
                nome: r.razao_social || r.nome_fantasia || '',
                razao_social: r.razao_social || '',
                nome_fantasia: r.nome_fantasia || '',
                cnpj: _dec(r.cnpj_cpf || ''),
                cnpj_cpf: _dec(r.cnpj_cpf || ''),
                inscricao_estadual: _dec(r.inscricao_estadual || ''),
                contato: r.contato || '',
                telefone: r.telefone || '',
                email: r.email || '',
                endereco: [r.bairro, r.cidade, r.estado].filter(Boolean).join(', '),
                bairro: r.bairro || '',
                cidade: r.cidade || '',
                estado: r.estado || '',
                cep: r.cep || ''
            }));
            res.json(resultado);
        } catch (error) { next(error); }
    });
    
    // VENDEDORES/FUNCIONÁRIOS - Autocomplete para PCP
    
    // API para criar ordem de produção completa
    router.post('/ordem-producao-completa', async (req, res, next) => {
        try {
            console.log('📋 Criando ordem de produção completa...');
    
            const {
                vendedor = 'Vendedor Padrão',
                cliente = 'Cliente Teste',
                contato_cliente = '',
                fone_cliente = '',
                email_cliente = '',
                tipo_frete = 'FOB',
                transportadora_nome = '',
                transportadora_fone = '',
                transportadora_endereco = '',
                transportadora_cpf_cnpj = '',
                transportadora_email_nfe = '',
                produtos = [],
                observacoes_pedido = '',
                condicoes_pagamento = '30 dias',
                prazo_entrega = '15 dias úteis'
            } = req.body;
    
            // Gerar número sequencial único
            const timestamp = Date.now();
            const novoSequencial = String(timestamp).slice(-5);
            const numeroOrcamento = `ORC-${novoSequencial}`;
            const numeroPedido = `PED-${novoSequencial}`;
    
            // Calcular total
            let valorTotal = 0;
            produtos.forEach(produto => {
                valorTotal += (produto.quantidade || 0) * (produto.valor_unitario || 0);
            });
    
            console.log(`💰 Valor total calculado: R$ ${valorTotal.toFixed(2)}`);
    
            // Preparar dados para o script de geração
            const dadosCompletos = {
                numero_sequencial: novoSequencial,
                numero_orcamento: numeroOrcamento,
                numero_pedido: numeroPedido,
                data_liberacao: new Date().toLocaleDateString('pt-BR'),
                vendedor,
                prazo_entrega,
                cliente,
                contato_cliente,
                fone_cliente,
                email_cliente,
                tipo_frete,
                transportadora_nome,
                transportadora_fone,
                transportadora_endereco,
                transportadora_cpf_cnpj,
                transportadora_email_nfe,
                produtos: produtos.map(p => ({
                    codigo: p.codigo || '',
                    descricao: p.descricao || p.nome || '',
                    embalagem: p.embalagem || 'UN',
                    lances: p.lances || '1',
                    quantidade: p.quantidade || 0,
                    valor_unitario: p.valor_unitario || 0
                })),
                observacoes_pedido,
                condicoes_pagamento,
                data_previsao_entrega: prazo_entrega
            };
    
            // Gerar Excel usando novo gerador funcional
            const TemplateXlsxGenerator = require('./template-xlsx-generator');
    
            try {
                console.log('🔧 Usando novo gerador funcional...');
    
                const gerador = new TemplateXlsxGenerator();
                const filename = `ORDEM_PRODUCAO_${novoSequencial}_${Date.now()}.xlsx`;
                const outputPath = path.join(__dirname, filename);
    
                // Preparar dados no formato esperado
                const dadosFormatados = {
                    numero_orcamento: dadosCompletos.numero_orcamento,
                    data_orcamento: dadosCompletos.data_liberacao,
                    vendedor: dadosCompletos.vendedor,
                    cliente: dadosCompletos.cliente,
                    cliente_contato: dadosCompletos.contato_cliente,
                    cliente_telefone: dadosCompletos.fone_cliente,
                    cliente_email: dadosCompletos.email_cliente,
                    transportadora: dadosCompletos.transportadora_nome,
                    frete: dadosCompletos.tipo_frete,
                    prazo_entrega: dadosCompletos.prazo_entrega,
                    produtos: produtos.map(p => ({
                        codigo: p.codigo || '',
                        descricao: p.descricao || p.nome || '',
                        quantidade: p.quantidade || 0,
                        unidade: p.embalagem || 'UN',
                        preco_unitario: p.valor_unitario || 0,
                        total: (p.quantidade || 0) * (p.valor_unitario || 0)
                    })),
                    observacoes: dadosCompletos.observacoes_pedido || 'Produto conforme especificação técnica.'
                };
    
                // Gerar arquivo usando novo gerador
                const resultado = await gerador.aplicarMapeamentoCompleto(dadosFormatados, outputPath);
    
                if (resultado.sucesso) {
                    console.log(`✅ Ordem de produção gerada com novo gerador: ${filename}`);
                    console.log(`💰 Total: R$ ${resultado.totalGeral.toFixed(2)}`);
    
                    // Retornar arquivo para download
                    res.download(outputPath, `Ordem_Producao_${numeroOrcamento}.xlsx`, (err) => {
                        if (!err) {
                            // Remover arquivo após download
                            setTimeout(() => {
                                try {
                                    fs.unlinkSync(outputPath);
                                } catch (cleanupError) {
                                    console.warn('Erro ao limpar arquivo:', cleanupError);
                                }
                            }, 5000);
                        }
                    });
                } else {
                    throw new Error('Falha na geração do arquivo com novo gerador');
                }
    
            } catch (excelError) {
                console.error('❌ Erro ao gerar Excel:', excelError);
                throw new Error(`Erro na geração do arquivo Excel: ${excelError.message}`);
            }
    
        } catch (error) {
            console.error('❌ Erro ao criar ordem de produção:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao gerar ordem de produção',
                error: error.message
            });
        }
    });
    
    // Função para gerar ordem com ExcelJS (formato válido)
    async function gerarOrdemComExcelJS(workbook, worksheet, dados, outputPath) {
        console.log('\n🎯 GERANDO ORDEM COM EXCELJS...');
    
        // === CABEÇALHO ===
        worksheet.mergeCells('A1:K1');
        const tituloCell = worksheet.getCell('A1');
        tituloCell.value = 'ORDEM DE PRODUÇÁO ALUFORCE';
        tituloCell.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
        tituloCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0070C0' } };
        tituloCell.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).height = 30;
    
        // === DADOS DA ORDEM ===
        worksheet.getCell('A3').value = 'Dados da Ordem:';
        worksheet.getCell('A3').font = { bold: true };
    
        worksheet.getCell('A4').value = 'Número do Orçamento:';
        worksheet.getCell('B4').value = dados.numero_orcamento || dados.orcamento || '';
    
        worksheet.getCell('D4').value = 'Número do Pedido:';
        worksheet.getCell('E4').value = dados.numero_pedido || dados.pedido || '';
    
        worksheet.getCell('A5').value = 'Data de Liberação:';
        worksheet.getCell('B5').value = dados.data_liberacao || new Date().toLocaleDateString('pt-BR');
    
        worksheet.getCell('D5').value = 'Vendedor:';
        worksheet.getCell('E5').value = dados.vendedor_nome || dados.vendedor || '';
    
        worksheet.getCell('G5').value = 'Prazo de Entrega:';
        worksheet.getCell('H5').value = dados.prazo_entrega || '';
    
        // === DADOS DO CLIENTE ===
        worksheet.getCell('A7').value = 'Dados do Cliente:';
        worksheet.getCell('A7').font = { bold: true };
    
        worksheet.getCell('A8').value = 'Nome do Cliente:';
        worksheet.getCell('B8').value = dados.cliente_nome || dados.cliente || '';
    
        worksheet.getCell('A9').value = 'Contato:';
        worksheet.getCell('B9').value = dados.cliente_contato || '';
    
        worksheet.getCell('D9').value = 'Telefone:';
        worksheet.getCell('E9').value = dados.cliente_fone || dados.cliente_telefone || '';
    
        worksheet.getCell('A10').value = 'Email:';
        worksheet.getCell('B10').value = dados.cliente_email || '';
    
        worksheet.getCell('D10').value = 'Tipo de Frete:';
        worksheet.getCell('E10').value = dados.frete || '';
    
        // === DADOS DA TRANSPORTADORA ===
        worksheet.getCell('A12').value = 'Dados da Transportadora:';
        worksheet.getCell('A12').font = { bold: true };
    
        const transportadoraFields = [
            { label: 'Nome:', cell: 'B13', value: dados.transportadora_nome || '' },
            { label: 'Telefone:', cell: 'B14', value: dados.transportadora_fone || dados.transportadora_telefone || '' },
            { label: 'CEP:', cell: 'B15', value: dados.transportadora_cep || '' },
            { label: 'Endereço:', cell: 'B16', value: dados.transportadora_endereco || '' },
            { label: 'CPF/CNPJ:', cell: 'B17', value: dados.transportadora_cpf_cnpj || '' },
            { label: 'Email NFe:', cell: 'B18', value: dados.transportadora_email_nfe || dados.email_nfe || '' }
        ];
    
        transportadoraFields.forEach((field, index) => {
            worksheet.getCell(`A${13 + index}`).value = field.label;
            worksheet.getCell(field.cell).value = field.value;
        });
    
        // === PRODUTOS ===
        let currentRow = 20;
        worksheet.getCell(`A${currentRow}`).value = 'PRODUTOS:';
        worksheet.getCell(`A${currentRow}`).font = { bold: true };
    
        currentRow++;
        const headerRow = worksheet.getRow(currentRow);
        headerRow.values = ['Código', 'Descrição', 'Embalagem', 'Lances', 'Quantidade', 'Valor Unitário', 'Total'];
        headerRow.font = { bold: true };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    
        let produtos = dados.produtos || dados.itens || [];
        if (typeof produtos === 'string') {
            try { produtos = JSON.parse(produtos); } catch(e) { produtos = []; }
        }
    
        let totalGeral = 0;
        let produtosProcessados = 0;
    
        currentRow++;
        produtos.forEach((produto, index) => {
            const row = worksheet.getRow(currentRow + index);
            const quantidade = parseFloat(produto.quantidade) || 0;
            const valorUnitario = parseFloat(produto.valor_unitario || produto.preco_unitario || produto.preco || 0);
            const total = quantidade * valorUnitario;
    
            row.values = [
                produto.codigo || '',
                produto.descricao || produto.nome || '',
                produto.embalagem || '',
                produto.lances || '',
                quantidade,
                valorUnitario.toFixed(2),
                total.toFixed(2)
            ];
    
            totalGeral += total;
            produtosProcessados++;
        });
    
        currentRow += produtos.length + 1;
    
        // === TOTAL ===
        worksheet.getCell(`F${currentRow}`).value = 'TOTAL GERAL:';
        worksheet.getCell(`F${currentRow}`).font = { bold: true };
        worksheet.getCell(`G${currentRow}`).value = `R$ ${totalGeral.toFixed(2)}`;
        worksheet.getCell(`G${currentRow}`).font = { bold: true };
    
        // === OBSERVAÇÕES ===
        currentRow += 2;
        worksheet.getCell(`A${currentRow}`).value = 'OBSERVAÇÕES:';
        worksheet.getCell(`A${currentRow}`).font = { bold: true };
        worksheet.getCell(`A${currentRow + 1}`).value = dados.observacoes || 'Nenhuma observação especial.';
    
        // === CONDIÇÕES DE PAGAMENTO ===
        currentRow += 3;
        worksheet.getCell(`A${currentRow}`).value = 'CONDIÇÕES DE PAGAMENTO:';
        worksheet.getCell(`A${currentRow}`).font = { bold: true };
        worksheet.getCell(`A${currentRow + 1}`).value = dados.condicoes_pagamento || '30 dias após faturamento';
    
        // === DADOS DE ENTREGA ===
        currentRow += 3;
        worksheet.getCell(`A${currentRow}`).value = 'DADOS DE ENTREGA:';
        worksheet.getCell(`A${currentRow}`).font = { bold: true };
    
        worksheet.getCell(`A${currentRow + 1}`).value = 'Data Prevista:';
        worksheet.getCell(`B${currentRow + 1}`).value = dados.data_entrega || '';
    
        worksheet.getCell(`A${currentRow + 2}`).value = 'Quantidade de Volumes:';
        worksheet.getCell(`B${currentRow + 2}`).value = dados.quantidade_volumes || '';
    
        worksheet.getCell(`A${currentRow + 3}`).value = 'Tipo de Embalagem:';
        worksheet.getCell(`B${currentRow + 3}`).value = dados.tipo_embalagem || '';
    
        worksheet.getCell(`A${currentRow + 4}`).value = 'Observações de Entrega:';
        worksheet.getCell(`B${currentRow + 4}`).value = dados.observacoes_entrega || '';
    
        // Ajustar largura das colunas
        worksheet.columns = [
            { width: 15 }, { width: 40 }, { width: 15 }, { width: 10 },
            { width: 12 }, { width: 15 }, { width: 15 }, { width: 15 },
            { width: 15 }, { width: 15 }, { width: 15 }
        ];
    
        // Salvar arquivo
        await workbook.xlsx.writeFile(outputPath);
        console.log(`✅ Arquivo salvo: ${outputPath}`);
    
        return {
            sucesso: true,
            totalGeral,
            produtosProcessados,
            arquivo: outputPath
        };
    }
    
    // Nova rota otimizada para gerar ordem de produção com gerador funcional
    router.post('/gerar-ordem', async (req, res, next) => {
        try {
            console.log('🏭 Gerando ordem via rota otimizada com ExcelJS...');
    
            const ExcelJS = require('exceljs');
    
            // Preparar dados recebidos
            const dadosOrdem = req.body;
            console.log('📋 Dados recebidos:', Object.keys(dadosOrdem));
    
            // Gerar número de ordem único
            const numeroOrdem = `OP${Date.now()}`;
    
            // Gerar nome único para arquivo
            const timestamp = Date.now();
            const filename = `ordem_producao_${timestamp}.xlsx`;
            const outputPath = path.join(__dirname, filename);
    
            // Criar workbook com ExcelJS
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Ordem de Produção');
    
            // Gerar ordem usando ExcelJS
            const resultado = await gerarOrdemComExcelJS(workbook, worksheet, dadosOrdem, outputPath);
    
            if (resultado.sucesso) {
                console.log(`✅ Ordem gerada: ${filename}`);
                console.log(`💰 Total: R$ ${resultado.totalGeral.toFixed(2)}`);
                console.log(`📦 Produtos: ${resultado.produtosProcessados}`);
    
                // Salvar ordem no banco de dados
                try {
                    const [insertResult] = await pool.query(`
                        INSERT INTO ordens_producao (
                            numero_ordem, numero_orcamento, numero_pedido, data_liberacao,
                            vendedor_nome, cliente_nome, cliente_fone, cliente_email, cliente_contato,
                            transportadora_nome, transportadora_fone, transportadora_cep,
                            transportadora_endereco, transportadora_cpf_cnpj, transportadora_email_nfe,
                            frete, prazo_entrega, percentual_parcelado, metodo_parcelado,
                            produtos, total_geral, quantidade_produtos,
                            observacoes, observacoes_pedido,
                            arquivo_xlsx, caminho_arquivo,
                            status, criado_por
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        numeroOrdem,
                        dadosOrdem.numero_orcamento || dadosOrdem.orcamento || null,
                        dadosOrdem.numero_pedido || dadosOrdem.pedido || null,
                        dadosOrdem.data_liberacao || new Date(),
                        dadosOrdem.vendedor_nome || dadosOrdem.vendedor || null,
                        dadosOrdem.cliente_nome || dadosOrdem.cliente || null,
                        dadosOrdem.cliente_fone || null,
                        dadosOrdem.cliente_email || null,
                        dadosOrdem.cliente_contato || null,
                        dadosOrdem.transportadora_nome || null,
                        dadosOrdem.transportadora_fone || dadosOrdem.transportadora_telefone || null,
                        dadosOrdem.transportadora_cep || null,
                        dadosOrdem.transportadora_endereco || null,
                        dadosOrdem.transportadora_cpf_cnpj || null,
                        dadosOrdem.transportadora_email_nfe || dadosOrdem.email_nfe || null,
                        dadosOrdem.frete || null,
                        dadosOrdem.prazo_entrega || null,
                        dadosOrdem.percentual_parcelado || 100.00,
                        dadosOrdem.metodo_parcelado || 'FATURAMENTO',
                        JSON.stringify(dadosOrdem.produtos || []),
                        resultado.totalGeral,
                        resultado.produtosProcessados,
                        dadosOrdem.observacoes || null,
                        dadosOrdem.observacoes_pedido || null,
                        filename,
                        outputPath,
                        'pendente',
                        req.user ? req.user.id : null
                    ]);
    
                    console.log(`✅ Ordem salva no banco: ID ${insertResult.insertId}`);
    
                    res.json({
                        sucesso: true,
                        ordemId: insertResult.insertId,
                        numeroOrdem: numeroOrdem,
                        arquivo: filename,
                        totalGeral: resultado.totalGeral,
                        produtosProcessados: resultado.produtosProcessados,
                        mensagem: 'Ordem de produção gerada e registrada com sucesso!'
                    });
                } catch (dbError) {
                    console.error('❌ Erro ao salvar ordem no banco:', dbError);
                    // Mesmo com erro no banco, retorna sucesso do arquivo gerado
                    res.json({
                        sucesso: true,
                        arquivo: filename,
                        totalGeral: resultado.totalGeral,
                        produtosProcessados: resultado.produtosProcessados,
                        mensagem: 'Ordem de produção gerada com sucesso! (Erro ao registrar no banco)',
                        avisoDb: 'Falha ao salvar no banco de dados'
                    });
                }
            } else {
                throw new Error('Falha na geração da ordem');
            }
    
        } catch (error) {
            console.error('❌ Erro na nova rota:', error);
            res.status(500).json({
                sucesso: false,
                erro: error.message,
                mensagem: 'Erro ao gerar ordem de produção'
            });
        }
    });
    
    // LISTAR ORDENS DE PRODUÇÁO - Para página Controle de Produção
    router.get('/ordens', async (req, res, next) => {
        try {
            const { status, data_inicio, data_fim, cliente, limit = 50, offset = 0 } = req.query;
    
            let query = `
                SELECT
                    id, numero_ordem, numero_orcamento, numero_pedido,
                    data_liberacao, data_emissao,
                    vendedor_nome, cliente_nome,
                    total_geral, quantidade_produtos,
                    status, arquivo_xlsx,
                    criado_em, atualizado_em
                FROM ordens_producao
                WHERE 1=1
            `;
            const params = [];
    
            if (status) {
                query += ` AND status = ?`;
                params.push(status);
            }
    
            if (data_inicio) {
                query += ` AND data_emissao >= ?`;
                params.push(data_inicio);
            }
    
            if (data_fim) {
                query += ` AND data_emissao <= ?`;
                params.push(data_fim);
            }
    
            if (cliente) {
                query += ` AND cliente_nome LIKE ?`;
                params.push(`%${cliente}%`);
            }
    
            query += ` ORDER BY data_emissao DESC LIMIT ? OFFSET ?`;
            params.push(parseInt(limit), parseInt(offset));
    
            const [ordens] = await pool.query(query, params);
    
            // Contar total de ordens (para paginação)
            const [countResult] = await pool.query(`
                SELECT COUNT(*) as total FROM ordens_producao WHERE 1=1
                ${status ? 'AND status = ?' : ''}
            `, status ? [status] : []);
    
            res.json({
                ordens,
                total: countResult[0].total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            console.error('❌ Erro ao listar ordens:', error);
            next(error);
        }
    });
    
    // OBTER ÚLTIMO NÚMERO DE PEDIDO PCP (Auto-increment)
    router.get('/ultimo-pedido', async (req, res, next) => {
        try {
            const [result] = await pool.query(`
                SELECT numero_pedido
                FROM ordens_producao
                WHERE numero_pedido IS NOT NULL
                AND numero_pedido REGEXP '^[0-9]+$'
                ORDER BY CAST(numero_pedido AS UNSIGNED) DESC
                LIMIT 1
            `);
    
            let ultimo_numero = '0002025000'; // Valor padrão inicial
    
            if (result.length > 0 && result[0].numero_pedido) {
                ultimo_numero = result[0].numero_pedido;
            }
    
            console.log(`✅ Último pedido PCP: ${ultimo_numero}`);
            res.json({ ultimo_numero });
        } catch (error) {
            console.error('❌ Erro ao buscar último pedido PCP:', error);
            // Retorna valor padrão em caso de erro
            res.json({ ultimo_numero: '0002025000' });
        }
    });
    
    // OBTER DETALHES DE UMA ORDEM ESPECÍFICA
    router.get('/ordens/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
    
            const [ordens] = await pool.query(`
                SELECT * FROM ordens_producao WHERE id = ?
            `, [id]);
    
            if (ordens.length === 0) {
                return res.status(404).json({ erro: 'Ordem não encontrada' });
            }
    
            const ordem = ordens[0];
    
            // Parse produtos JSON
            if (ordem.produtos) {
                try {
                    ordem.produtos = JSON.parse(ordem.produtos);
                } catch (e) {
                    console.error('Erro ao parsear produtos:', e);
                    ordem.produtos = [];
                }
            }
    
            res.json(ordem);
        } catch (error) {
            console.error('❌ Erro ao buscar ordem:', error);
            next(error);
        }
    });
    
    // ATUALIZAR STATUS DE ORDEM
    router.patch('/ordens/:id/status', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status } = req.body;
    
            const statusValidos = ['pendente', 'em_producao', 'concluida', 'cancelada'];
            if (!statusValidos.includes(status)) {
                return res.status(400).json({ erro: 'Status inválido' });
            }
    
            await pool.query(`
                UPDATE ordens_producao
                SET status = ?, atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [status, id]);
    
            res.json({ sucesso: true, mensagem: 'Status atualizado com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao atualizar status:', error);
            next(error);
        }
    });
    
    // VENDEDORES/FUNCIONÁRIOS - Autocomplete para PCP
    router.get('/vendedores', async (req, res, next) => {
        try {
            const query = req.query.q || '';
            const limit = parseInt(req.query.limit) || 10;
    
            if (!query) {
                const [rows] = await pool.query(`
                    SELECT id, nome_completo as nome, cargo, departamento
                    FROM funcionarios
                    WHERE status = 'ativo' AND (cargo LIKE '%vendedor%' OR cargo LIKE '%comercial%' OR departamento LIKE '%vendas%' OR departamento LIKE '%comercial%')
                    LIMIT ?
                `, [limit]);
                return res.json(rows);
            }
    
            const searchPattern = `%${query}%`;
            const [rows] = await pool.query(`
                SELECT id, nome_completo as nome, cargo, departamento
                FROM funcionarios
                WHERE status = 'ativo'
                AND (cargo LIKE '%vendedor%' OR cargo LIKE '%comercial%' OR departamento LIKE '%vendas%' OR departamento LIKE '%comercial%')
                AND (nome_completo LIKE ? OR cargo LIKE ?)
                LIMIT ?
            `, [searchPattern, searchPattern, limit]);
            res.json(rows);
        } catch (error) { next(error); }
    });
    
    // ===================== INTEGRAÇÃO COMPRAS <-> PCP =====================
    
    // LISTAR MATERIAIS CRÍTICOS (estoque abaixo do mínimo)
    router.get('/materiais-criticos', async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const [materiais] = await pool.query(`
                SELECT * FROM vw_materiais_criticos LIMIT ?
            `, [limit]);
            res.json(materiais);
        } catch (error) {
            console.error('❌ Erro ao buscar materiais críticos:', error);
            next(error);
        }
    });
    
    // CRIAR PEDIDO DE COMPRA A PARTIR DO PCP
    // AUDIT-FIX HIGH-012: Wrapped PCP purchase order creation in transaction
    router.post('/gerar-pedido-compra', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const {
                ordem_producao_id,
                fornecedor_id,
                materiais, // Array de {produto_id, quantidade, preco_unitario}
                prioridade = 'media',
                data_entrega_prevista,
                observacoes
            } = req.body;
    
            // Validações
            if (!fornecedor_id || !materiais || materiais.length === 0) {
                connection.release();
                return res.status(400).json({
                    erro: 'fornecedor_id e materiais são obrigatórios'
                });
            }
    
            await connection.beginTransaction();
    
            // Calcular valor total
            const valorTotal = materiais.reduce((total, item) => {
                return total + (item.quantidade * item.preco_unitario);
            }, 0);
    
            // Criar pedido de compra
            const [result] = await connection.query(`
                INSERT INTO pedidos_compras (
                    fornecedor_id, valor_total, origem, origem_id,
                    prioridade, data_entrega_prevista, observacoes, usuario_id
                ) VALUES (?, ?, 'pcp', ?, ?, ?, ?, ?)
            `, [
                fornecedor_id,
                valorTotal,
                ordem_producao_id,
                prioridade,
                data_entrega_prevista,
                observacoes,
                req.user ? req.user.id : null
            ]);
    
            const pedidoId = result.insertId;
    
            // Inserir itens do pedido
            for (const material of materiais) {
                await connection.query(`
                    INSERT INTO itens_pedido_compras (
                        pedido_id, produto_id, produto_descricao,
                        quantidade, preco_unitario, subtotal
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    pedidoId,
                    material.produto_id,
                    material.descricao,
                    material.quantidade,
                    material.preco_unitario,
                    material.quantidade * material.preco_unitario
                ]);
    
                // Criar/atualizar notificação de estoque
                await connection.query(`
                    UPDATE notificacoes_estoque
                    SET status = 'em_compra', pedido_compra_id = ?
                    WHERE produto_id = ? AND status = 'pendente'
                `, [pedidoId, material.produto_id]);
            }
    
            // Atualizar ordem de produção (se informada)
            if (ordem_producao_id) {
                await connection.query(`
                    UPDATE ordens_producao
                    SET pedidos_compra_vinculados = JSON_ARRAY_APPEND(
                        COALESCE(pedidos_compra_vinculados, '[]'),
                        '$',
                        ?
                    )
                    WHERE id = ?
                `, [pedidoId, ordem_producao_id]);
            }
    
            await connection.commit();
    
            res.json({
                sucesso: true,
                pedido_id: pedidoId,
                valor_total: valorTotal,
                mensagem: 'Pedido de compra criado com sucesso'
            });
    
        } catch (error) {
            await connection.rollback();
            console.error('❌ Erro ao gerar pedido de compra:', error);
            next(error);
        } finally {
            connection.release();
        }
    });
    
    // LISTAR NOTIFICAÇÕES DE ESTOQUE
    router.get('/notificacoes-estoque', async (req, res, next) => {
        try {
            const { status = 'pendente', tipo } = req.query;
    
            let query = `
                SELECT
                    n.*,
                    p.codigo, p.descricao, p.unidade,
                    op.numero_ordem,
                    pc.id as pedido_compra_numero
                FROM notificacoes_estoque n
                INNER JOIN produtos p ON n.produto_id = p.id
                LEFT JOIN ordens_producao op ON n.ordem_producao_id = op.id
                LEFT JOIN pedidos_compras pc ON n.pedido_compra_id = pc.id
                WHERE 1=1
            `;
            const params = [];
    
            if (status) {
                query += ` AND n.status = ?`;
                params.push(status);
            }
    
            if (tipo) {
                query += ` AND n.tipo = ?`;
                params.push(tipo);
            }
    
            query += ` ORDER BY
                CASE n.tipo
                    WHEN 'estoque_zero' THEN 1
                    WHEN 'estoque_critico' THEN 2
                    WHEN 'estoque_baixo' THEN 3
                END,
                n.criado_em DESC
            `;
    
            const [notificacoes] = await pool.query(query, params);
            res.json(notificacoes);
    
        } catch (error) {
            console.error('❌ Erro ao buscar notificações:', error);
            next(error);
        }
    });
    
    // RESOLVER/IGNORAR NOTIFICAÇÃO DE ESTOQUE
    router.patch('/notificacoes-estoque/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status, observacoes } = req.body;
    
            if (!['resolvido', 'ignorado'].includes(status)) {
                return res.status(400).json({ erro: 'Status inválido' });
            }
    
            await pool.query(`
                UPDATE notificacoes_estoque
                SET status = ?,
                    resolvido_em = CURRENT_TIMESTAMP,
                    resolvido_por = ?,
                    observacoes = ?
                WHERE id = ?
            `, [status, req.user ? req.user.id : null, observacoes, id]);
    
            res.json({ sucesso: true, mensagem: 'Notificação atualizada' });
    
        } catch (error) {
            console.error('❌ Erro ao atualizar notificação:', error);
            next(error);
        }
    });
    
    // VERIFICAR MATERIAIS NECESSÁRIOS PARA UMA ORDEM
    router.get('/ordens/:id/materiais-necessarios', async (req, res, next) => {
        try {
            const { id } = req.params;
    
            // Buscar ordem
            const [ordens] = await pool.query(`
                SELECT produtos FROM ordens_producao WHERE id = ?
            `, [id]);
    
            if (ordens.length === 0) {
                return res.status(404).json({ erro: 'Ordem não encontrada' });
            }
    
            let produtosOrdem = [];
            try {
                produtosOrdem = JSON.parse(ordens[0].produtos || '[]');
            } catch (e) {
                console.error('Erro ao parsear produtos:', e);
            }
    
            // Batch: carregar todos os produtos dos códigos necessários
            const codigosProdutos = produtosOrdem.map(p => p.codigo).filter(Boolean);
            let produtosMap = {};

            if (codigosProdutos.length > 0) {
                try {
                    const [allProdutos] = await pool.query(`
                        SELECT id, codigo, descricao, estoque_atual, estoque_minimo, unidade_medida as unidade
                        FROM produtos
                        WHERE codigo IN (?)
                    `, [codigosProdutos]);
                    for (const p of allProdutos) produtosMap[p.codigo] = p;
                } catch(e) {}
            }

            const materiaisNecessarios = [];
            for (const produto of produtosOrdem) {
                const p = produtosMap[produto.codigo];
                if (p) {
                    const quantidadeNecessaria = parseFloat(produto.quantidade || 0);
                    const deficit = quantidadeNecessaria - p.estoque_atual;
                    if (deficit > 0) {
                        materiaisNecessarios.push({
                            produto_id: p.id,
                            codigo: p.codigo,
                            descricao: p.descricao,
                            unidade: p.unidade,
                            quantidade_necessaria: quantidadeNecessaria,
                            estoque_atual: p.estoque_atual,
                            deficit: deficit,
                            criticidade: p.estoque_atual === 0 ? 'critico' : 'atencao'
                        });
                    }
                }
            }
    
            res.json({
                ordem_id: id,
                materiais_necessarios: materiaisNecessarios,
                total_itens_faltando: materiaisNecessarios.length
            });
    
        } catch (error) {
            console.error('❌ Erro ao verificar materiais:', error);
            next(error);
        }
    });
    
    // ESTOQUE - Produtos disponíveis (para módulo Vendas e outros)
    // IMPORTANTE: Retorna APENAS produtos que têm movimentação registrada no PCP
    router.get('/estoque/produtos-disponiveis', async (req, res, next) => {
        try {
            const { search, categoria, status } = req.query;
    
            // Buscar APENAS produtos que têm movimentação de estoque registrada OU estoque > 0
            let sql = `
                SELECT
                    p.id,
                    p.codigo,
                    p.nome,
                    p.descricao,
                    p.sku,
                    p.gtin,
                    COALESCE(p.quantidade_estoque, 0) as estoque_atual,
                    COALESCE(p.estoque_minimo, 10) as estoque_minimo,
                    COALESCE(p.preco_venda, p.preco_custo, 0) as preco,
                    p.unidade_medida,
                    p.categoria,
                    (SELECT MAX(me.data_movimentacao) FROM movimentacoes_estoque me WHERE me.produto_id = p.id) as ultima_movimentacao,
                    (SELECT COUNT(*) FROM movimentacoes_estoque me WHERE me.produto_id = p.id) as total_movimentacoes
                FROM produtos p
                WHERE p.ativo = 1
                  AND (
                      p.quantidade_estoque > 0
                      OR EXISTS (SELECT 1 FROM movimentacoes_estoque me WHERE me.produto_id = p.id)
                  )
            `;
    
            const params = [];
    
            // Filtro de busca
            if (search) {
                sql += ` AND (p.codigo LIKE ? OR p.nome LIKE ? OR p.sku LIKE ? OR p.gtin LIKE ?)`;
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }
    
            // Filtro de categoria
            if (categoria) {
                sql += ` AND p.categoria = ?`;
                params.push(categoria);
            }
    
            // Filtro de status de estoque
            if (status === 'disponivel') {
                sql += ` AND p.quantidade_estoque > 0`;
            } else if (status === 'baixo') {
                sql += ` AND p.quantidade_estoque > 0 AND p.quantidade_estoque <= p.estoque_minimo`;
            }
    
            sql += ` ORDER BY p.nome ASC LIMIT 500`;
    
            const [produtos] = await pool.query(sql, params);
    
            // Estatísticas
            const stats = {
                total: produtos.length,
                comEstoque: produtos.filter(p => p.estoque_atual > 0).length,
                estoqueBaixo: produtos.filter(p => p.estoque_atual > 0 && p.estoque_atual <= p.estoque_minimo).length,
                semEstoque: produtos.filter(p => p.estoque_atual <= 0).length
            };
    
            res.json({
                success: true,
                produtos: produtos,
                stats: stats,
                total: produtos.length
            });
    
        } catch (error) {
            console.error('❌ Erro ao buscar produtos disponíveis:', error);
            next(error);
        }
    });
    
    // ===================== GESTÃO DE PRODUÇÃO - APIs =====================
    
    // Criar tabela de máquinas se não existir
    const criarTabelaMaquinasPrincipal = async () => {
        // Tables managed by startup migration
        console.log('[GESTAO] Tabelas maquinas_producao e historico_manutencoes gerenciadas pela migração de inicialização');
    };
    
    // Criar tabela de gestão de produção se não existir
    const criarTabelaGestaoProducaoPrincipal = async () => {
        // Table managed by startup migration
        console.log('[GESTAO] Tabela gestao_producao gerenciada pela migração de inicialização');
    };
    
    // Inicializar tabelas de gestão de produção
    setTimeout(async () => {
        await criarTabelaMaquinasPrincipal();
        await criarTabelaGestaoProducaoPrincipal();
    }, 3000);
    
    // Listar máquinas
    router.get('/maquinas', async (req, res, next) => {
        try {
            const [maquinas] = await pool.query(`
                SELECT id, codigo, nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes
                FROM maquinas_producao ORDER BY nome LIMIT 200
            `);
            res.json(maquinas);
        } catch (error) {
            console.error('[API_MAQUINAS] Erro:', error.message);
            next(error);
        }
    });
    
    // Criar nova máquina
    router.post('/maquinas', async (req, res, next) => {
        try {
            const { codigo, nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes } = req.body;
    
            // Gerar código se não fornecido
            const codigoFinal = codigo || `MAQ-${Date.now().toString().slice(-6)}`;
    
            const [result] = await pool.query(`
                INSERT INTO maquinas_producao (codigo, nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [codigoFinal, nome, setor || 'Geral', status || 'ativa', ultima_manutencao, proxima_manutencao, observacoes]);
    
            res.status(201).json({
                message: 'Máquina criada com sucesso',
                id: result.insertId,
                codigo: codigoFinal
            });
        } catch (error) {
            console.error('[API_MAQUINAS] Erro ao criar:', error.message);
            next(error);
        }
    });
    
    // Atualizar máquina
    router.put('/maquinas/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes } = req.body;
    
            await pool.query(`
                UPDATE maquinas_producao SET nome = ?, setor = ?, status = ?, ultima_manutencao = ?, proxima_manutencao = ?, observacoes = ?
                WHERE id = ?
            `, [nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes, id]);
    
            res.json({ message: 'Máquina atualizada com sucesso' });
        } catch (error) {
            console.error('[API_MAQUINAS] Erro ao atualizar:', error.message);
            next(error);
        }
    });
    
    // Excluir máquina
    router.delete('/maquinas/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM maquinas_producao WHERE id = ?', [id]);
            res.json({ message: 'Máquina excluída com sucesso' });
        } catch (error) {
            console.error('[API_MAQUINAS] Erro ao excluir:', error.message);
            next(error);
        }
    });
    
    // ===================== HISTÓRICO DE MANUTENÇÕES =====================
    
    // Listar histórico de manutenções de uma máquina
    router.get('/maquinas/:id/manutencoes', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [manutencoes] = await pool.query(`
                SELECT * FROM historico_manutencoes
                WHERE maquina_id = ?
                ORDER BY data_manutencao DESC
                LIMIT 50
            `, [id]);
            res.json(manutencoes);
        } catch (error) {
            console.error('[API_MANUTENCOES] Erro:', error.message);
            next(error);
        }
    });
    
    // Adicionar manutenção ao histórico
    router.post('/maquinas/:id/manutencoes', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { data_manutencao, tipo, descricao, pecas_trocadas, custo, responsavel, tempo_parada_horas, status } = req.body;
    
            const [result] = await pool.query(`
                INSERT INTO historico_manutencoes (maquina_id, data_manutencao, tipo, descricao, pecas_trocadas, custo, responsavel, tempo_parada_horas, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [id, data_manutencao, tipo || 'preventiva', descricao, pecas_trocadas, custo || 0, responsavel, tempo_parada_horas || 0, status || 'concluida']);
    
            // Atualizar data de última manutenção na máquina
            await pool.query(`
                UPDATE maquinas_producao SET ultima_manutencao = ? WHERE id = ?
            `, [data_manutencao, id]);
    
            res.status(201).json({
                message: 'Manutenção registrada com sucesso',
                id: result.insertId
            });
        } catch (error) {
            console.error('[API_MANUTENCOES] Erro ao criar:', error.message);
            next(error);
        }
    });
    
    // Excluir manutenção
    router.delete('/manutencoes/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM historico_manutencoes WHERE id = ?', [id]);
            res.json({ message: 'Manutenção excluída com sucesso' });
        } catch (error) {
            console.error('[API_MANUTENCOES] Erro ao excluir:', error.message);
            next(error);
        }
    });
    
    // =====================================================
    // GESTÃO DE PRODUÇÃO - API INTEGRADA COM OPs
    // =====================================================
    
    // Listar registros de gestão de produção (integrado com ordens_producao)
    router.get('/gestao-producao', async (req, res, next) => {
        try {
            const { periodo, maquina, busca, fonte } = req.query;
    
            // Se fonte = 'ordens', busca diretamente das ordens de produção
            let registros = [];
            let periodoSQL = '';
    
            // Construir filtro de período
            if (periodo && periodo !== 'todos') {
                switch(periodo) {
                    case 'hoje':
                        periodoSQL = ' AND DATE(op.created_at) = CURDATE()';
                        break;
                    case 'semana':
                        periodoSQL = ' AND op.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
                        break;
                    case 'mes':
                        periodoSQL = ' AND MONTH(op.created_at) = MONTH(CURDATE()) AND YEAR(op.created_at) = YEAR(CURDATE())';
                        break;
                    case 'ano':
                        periodoSQL = ' AND YEAR(op.created_at) = YEAR(CURDATE())';
                        break;
                }
            }
    
            // Buscar ordens de produção
            let queryOP = `
                SELECT
                    op.id,
                    op.codigo as numero_pedido,
                    op.produto_nome,
                    op.quantidade as quantidade_planejada,
                    op.quantidade_produzida,
                    op.unidade,
                    op.status,
                    op.prioridade,
                    op.data_inicio,
                    op.data_prevista,
                    op.data_conclusao,
                    op.responsavel as cliente_nome,
                    op.progresso,
                    op.observacoes,
                    op.created_at,
                    op.updated_at,
                    CASE
                        WHEN op.data_inicio IS NOT NULL AND op.data_conclusao IS NOT NULL
                        THEN TIMESTAMPDIFF(MINUTE, op.data_inicio, op.data_conclusao)
                        WHEN op.data_inicio IS NOT NULL AND op.status = 'em_producao'
                        THEN TIMESTAMPDIFF(MINUTE, op.data_inicio, NOW())
                        ELSE 0
                    END as tempo_producao_minutos,
                    CASE
                        WHEN op.quantidade > 0 AND op.quantidade_produzida > 0
                        THEN ROUND((op.quantidade_produzida / op.quantidade) * 100, 1)
                        WHEN op.progresso > 0 THEN op.progresso
                        ELSE 0
                    END as eficiencia
                FROM ordens_producao op
                WHERE 1=1 ${periodoSQL}
            `;
    
            const params = [];
    
            // Filtro por busca
            if (busca) {
                queryOP += ' AND (op.codigo LIKE ? OR op.produto_nome LIKE ? OR op.responsavel LIKE ?)';
                params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
            }
    
            queryOP += ' ORDER BY op.created_at DESC LIMIT 100';
    
            const [ordensProducao] = await pool.query(queryOP, params);
    
            // Formatar dados
            registros = ordensProducao.map(op => ({
                id: op.id,
                numero_pedido: op.numero_pedido || `OP-${op.id}`,
                cliente_nome: op.cliente_nome || 'N/A',
                produto_nome: op.produto_nome,
                tempo_producao_minutos: op.tempo_producao_minutos || 0,
                tempo_formatado: formatarTempo(op.tempo_producao_minutos || 0),
                materiais_gastos: [],
                maquinas_utilizadas: [],
                quantidade_produzida: parseFloat(op.quantidade_produzida) || 0,
                quantidade_planejada: parseFloat(op.quantidade_planejada) || 0,
                unidade: op.unidade,
                status: op.status,
                prioridade: op.prioridade,
                eficiencia: op.eficiencia || 0,
                progresso: op.progresso || 0,
                data_inicio: op.data_inicio,
                data_prevista: op.data_prevista,
                data_conclusao: op.data_conclusao,
                created_at: op.created_at,
                fonte: 'ordens_producao'
            }));
    
            // Calcular estatísticas baseadas nas OPs
            const [statsOP] = await pool.query(`
                SELECT
                    COUNT(*) as total_ordens,
                    SUM(CASE
                        WHEN data_inicio IS NOT NULL AND data_conclusao IS NOT NULL
                        THEN TIMESTAMPDIFF(MINUTE, data_inicio, data_conclusao)
                        WHEN data_inicio IS NOT NULL AND status = 'em_producao'
                        THEN TIMESTAMPDIFF(MINUTE, data_inicio, NOW())
                        ELSE 0
                    END) as tempo_total_minutos,
                    COUNT(CASE WHEN status = 'em_producao' THEN 1 END) as em_producao,
                    COUNT(CASE WHEN status = 'concluida' THEN 1 END) as concluidas,
                    COUNT(CASE WHEN status = 'pendente' THEN 1 END) as pendentes,
                    SUM(quantidade) as qtd_total_planejada,
                    SUM(quantidade_produzida) as qtd_total_produzida,
                    AVG(CASE WHEN quantidade > 0 AND quantidade_produzida > 0
                        THEN (quantidade_produzida / quantidade) * 100
                        WHEN progresso > 0 THEN progresso
                        ELSE NULL END) as eficiencia_media
                FROM ordens_producao
                WHERE status != 'cancelada'
                  AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())
            `);
    
            const [maquinasAtivas] = await pool.query(`
                SELECT COUNT(*) as total FROM maquinas_producao WHERE status = 'ativa'
            `);
    
            // Contar materiais únicos usados (estimativa baseada em produtos)
            const [materiaisCount] = await pool.query(`
                SELECT COUNT(DISTINCT produto_nome) as total
                FROM ordens_producao
                WHERE status IN ('em_producao', 'concluida')
                  AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())
            `);
    
            const tempoTotal = statsOP[0]?.tempo_total_minutos || 0;
    
            res.json({
                registros,
                estatisticas: {
                    total_ordens: statsOP[0]?.total_ordens || 0,
                    tempo_total_minutos: tempoTotal,
                    tempo_total_formatado: formatarTempo(tempoTotal),
                    materiais_utilizados: materiaisCount[0]?.total || 0,
                    maquinas_ativas: maquinasAtivas[0]?.total || 0,
                    eficiencia_media: Math.round(statsOP[0]?.eficiencia_media || 0),
                    em_producao: statsOP[0]?.em_producao || 0,
                    concluidas: statsOP[0]?.concluidas || 0,
                    pendentes: statsOP[0]?.pendentes || 0,
                    qtd_total_planejada: parseFloat(statsOP[0]?.qtd_total_planejada) || 0,
                    qtd_total_produzida: parseFloat(statsOP[0]?.qtd_total_produzida) || 0
                }
            });
        } catch (error) {
            console.error('[API_GESTAO_PRODUCAO] Erro:', error.message);
            next(error);
        }
    });
    
    // Função auxiliar para formatar tempo
    function formatarTempo(minutos) {
        if (!minutos || minutos <= 0) return '0h';
        const horas = Math.floor(minutos / 60);
        const mins = minutos % 60;
        if (horas === 0) return `${mins}min`;
        if (mins === 0) return `${horas}h`;
        return `${horas}h ${mins}min`;
    }
    
    // Dashboard de estatísticas detalhadas
    router.get('/gestao-producao/dashboard', async (req, res, next) => {
        try {
            // Estatísticas gerais
            const [statsGerais] = await pool.query(`
                SELECT
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'ativa' THEN 1 END) as ativas,
                    COUNT(CASE WHEN status = 'em_producao' THEN 1 END) as em_producao,
                    COUNT(CASE WHEN status = 'pendente' THEN 1 END) as pendentes,
                    COUNT(CASE WHEN status = 'concluida' THEN 1 END) as concluidas,
                    COUNT(CASE WHEN status = 'cancelada' THEN 1 END) as canceladas
                FROM ordens_producao
            `);
    
            // Produção por setor/máquina
            const [maquinas] = await pool.query(`
                SELECT
                    m.id, m.codigo, m.nome, m.setor, m.status,
                    m.ultima_manutencao, m.proxima_manutencao
                FROM maquinas_producao m
                ORDER BY m.setor, m.nome
            `);
    
            // Produção por dia (últimos 7 dias)
            const [producaoDiaria] = await pool.query(`
                SELECT
                    DATE(created_at) as data,
                    COUNT(*) as ordens,
                    SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as concluidas
                FROM ordens_producao
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                GROUP BY DATE(created_at)
                ORDER BY data
            `);
    
            // Ordens por prioridade
            const [porPrioridade] = await pool.query(`
                SELECT
                    prioridade,
                    COUNT(*) as total
                FROM ordens_producao
                WHERE status NOT IN ('concluida', 'cancelada')
                GROUP BY prioridade
            `);
    
            res.json({
                estatisticas: statsGerais[0],
                maquinas,
                producaoDiaria,
                porPrioridade
            });
        } catch (error) {
            console.error('[API_GESTAO_PRODUCAO_DASHBOARD] Erro:', error.message);
            next(error);
        }
    });
    
    // Criar registro de gestão de produção
    router.post('/gestao-producao', async (req, res, next) => {
        try {
            const {
                pedido_id, numero_pedido, cliente_nome, produto_nome,
                tempo_producao_minutos, materiais_gastos, maquinas_utilizadas,
                quantidade_produzida, quantidade_planejada, status,
                data_inicio, data_fim, observacoes
            } = req.body;
    
            // Calcular eficiência
            let eficiencia = 0;
            if (quantidade_planejada && quantidade_produzida) {
                eficiencia = Math.round((quantidade_produzida / quantidade_planejada) * 100);
            }
    
            const [result] = await pool.query(`
                INSERT INTO gestao_producao
                (pedido_id, numero_pedido, cliente_nome, produto_nome, tempo_producao_minutos,
                 materiais_gastos, maquinas_utilizadas, quantidade_produzida, quantidade_planejada,
                 status, data_inicio, data_fim, eficiencia, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                pedido_id, numero_pedido, cliente_nome, produto_nome, tempo_producao_minutos || 0,
                JSON.stringify(materiais_gastos || []), JSON.stringify(maquinas_utilizadas || []),
                quantidade_produzida || 0, quantidade_planejada || 0,
                status || 'planejado', data_inicio, data_fim, eficiencia, observacoes
            ]);
    
            res.status(201).json({
                message: 'Registro de produção criado',
                id: result.insertId
            });
        } catch (error) {
            console.error('[API_GESTAO_PRODUCAO] Erro ao criar:', error.message);
            next(error);
        }
    });
    
    // Atualizar registro de gestão de produção
    router.put('/gestao-producao/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const {
                tempo_producao_minutos, materiais_gastos, maquinas_utilizadas,
                quantidade_produzida, quantidade_planejada, status,
                data_inicio, data_fim, observacoes
            } = req.body;
    
            // Calcular eficiência
            let eficiencia = 0;
            if (quantidade_planejada && quantidade_produzida) {
                eficiencia = Math.round((quantidade_produzida / quantidade_planejada) * 100);
            }
    
            await pool.query(`
                UPDATE gestao_producao SET
                    tempo_producao_minutos = ?, materiais_gastos = ?, maquinas_utilizadas = ?,
                    quantidade_produzida = ?, quantidade_planejada = ?, status = ?,
                    data_inicio = ?, data_fim = ?, eficiencia = ?, observacoes = ?
                WHERE id = ?
            `, [
                tempo_producao_minutos, JSON.stringify(materiais_gastos || []),
                JSON.stringify(maquinas_utilizadas || []),
                quantidade_produzida, quantidade_planejada, status,
                data_inicio, data_fim, eficiencia, observacoes, id
            ]);
    
            res.json({ message: 'Registro atualizado' });
        } catch (error) {
            console.error('[API_GESTAO_PRODUCAO] Erro ao atualizar:', error.message);
            next(error);
        }
    });
    
    // Buscar detalhes de um registro
    router.get('/gestao-producao/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [registros] = await pool.query('SELECT * FROM gestao_producao WHERE id = ?', [id]);
    
            if (registros.length === 0) {
                return res.status(404).json({ message: 'Registro não encontrado' });
            }
    
            res.json(registros[0]);
        } catch (error) {
            console.error('[API_GESTAO_PRODUCAO] Erro:', error.message);
            next(error);
        }
    });
    
    // =================== CONTROLE PCP (ORDENS PRODUÇÃO) ===================
    
    // Função reutilizável para listar ordens de controle PCP
    async function listarOrdensPCP(req, res) {
        console.log('[API_CONTROLE_PCP] Listando ordens para controle...');
        try {
            const { busca, vendedor, extrusora, status } = req.query;
    
            let whereParts = [];
            let params = [];
    
            // Filtro de busca
            if (busca && busca.trim()) {
                const like = `%${busca.trim()}%`;
                whereParts.push('(op.codigo LIKE ? OR op.produto_nome LIKE ? OR op.cliente LIKE ?)');
                params.push(like, like, like);
            }
    
            // Filtro de vendedor/responsável
            if (vendedor && vendedor.trim()) {
                whereParts.push('op.responsavel = ?');
                params.push(vendedor.trim());
            }
    
            // Filtro de extrusora/máquina
            if (extrusora && extrusora.trim()) {
                whereParts.push('op.maquina = ?');
                params.push(extrusora.trim());
            }
    
            // Filtro de status
            if (status && status.trim()) {
                whereParts.push('op.status = ?');
                params.push(status.trim());
            }
    
            const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';
    
            const sql = `
                SELECT
                    op.id, op.codigo, op.produto_nome, op.quantidade, op.unidade,
                    op.status, op.prioridade, op.data_inicio, op.data_prevista,
                    op.responsavel, op.maquina, op.progresso, op.cliente,
                    op.created_at, op.updated_at
                FROM ordens_producao op
                ${whereClause}
                ORDER BY
                    CASE op.status
                        WHEN 'em_producao' THEN 1
                        WHEN 'pendente' THEN 2
                        WHEN 'concluida' THEN 3
                        ELSE 4
                    END,
                    op.prioridade DESC,
                    op.data_prevista ASC
                LIMIT 100
            `;
    
            const [ordens] = await pool.query(sql, params);
    
            console.log(`[API_CONTROLE_PCP] Retornando ${ordens.length} ordens`);
            res.json({
                success: true,
                data: ordens || [],
                total: ordens.length
            });
        } catch (error) {
            console.error('[API_CONTROLE_PCP] Erro:', error.message);
            res.status(500).json({
                success: false,
                message: 'Erro ao listar ordens de produção',
                error: error.message
            });
        }
    }
    
    // Rota principal: /controle-pcp
    router.get('/controle-pcp', listarOrdensPCP);
    
    // Alias para compatibilidade: /controle-producao (usa mesma função)
    router.get('/controle-producao', listarOrdensPCP);
    
    // Atualizar status de uma ordem no controle PCP
    router.put('/controle-pcp/:id/status', async (req, res) => {
        const { id } = req.params;
        const { status, observacao } = req.body;
        console.log(`[API_CONTROLE_PCP] Atualizando status da ordem ${id} para ${status}...`);
    
        try {
            if (!status) {
                return res.status(400).json({ success: false, message: 'Status é obrigatório' });
            }
    
            let updateSql = 'UPDATE ordens_producao SET status = ?, updated_at = NOW()';
            let params = [status];
    
            if (observacao) {
                updateSql += ', observacoes = ?';
                params.push(observacao);
            }
    
            // Atualizar data de conclusão se status for concluída
            if (status === 'concluida' || status === 'Concluída') {
                updateSql += ', data_conclusao = NOW(), progresso = 100';
            }
    
            updateSql += ' WHERE id = ?';
            params.push(id);
    
            const [result] = await pool.query(updateSql, params);
    
            if (result.affectedRows > 0) {
                console.log(`[API_CONTROLE_PCP] Status da ordem ${id} atualizado para ${status}`);
                res.json({ success: true, message: 'Status atualizado com sucesso' });
            } else {
                res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }
        } catch (error) {
            console.error('[API_CONTROLE_PCP] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao atualizar status', error: error.message });
        }
    });
    
    // Buscar materiais de uma ordem no controle PCP
    router.get('/controle-pcp/:id/materiais', async (req, res) => {
        const { id } = req.params;
        console.log(`[API_CONTROLE_PCP] Buscando materiais da ordem ${id}...`);
    
        try {
            // Tentar buscar materiais vinculados à ordem
            let materiais = [];
            try {
                const [rows] = await pool.query(`
                    SELECT
                        m.id, m.codigo_material, m.descricao, m.unidade_medida,
                        om.quantidade_necessaria, om.quantidade_utilizada
                    FROM ordem_materiais om
                    INNER JOIN materiais m ON om.material_id = m.id
                    WHERE om.ordem_producao_id = ?
                `, [id]);
                materiais = rows || [];
            } catch (e) {
                console.log('[API_CONTROLE_PCP] Tabela ordem_materiais não existe, retornando vazio');
            }
    
            res.json({ success: true, data: materiais, total: materiais.length });
        } catch (error) {
            console.error('[API_CONTROLE_PCP] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar materiais', error: error.message });
        }
    });
    
    // Buscar itens de uma ordem de produção
    router.get('/ordens-producao/:id/itens', async (req, res) => {
        const { id } = req.params;
        console.log(`[API_PCP] Buscando itens da ordem de produção ${id}...`);
    
        try {
            // Primeiro, buscar informações da ordem de produção
            const [opRows] = await pool.query(`
                SELECT id, codigo, produto_nome, quantidade, unidade
                FROM ordens_producao WHERE id = ?
            `, [id]);
    
            if (!opRows || opRows.length === 0) {
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }
    
            const op = opRows[0];
            const quantidadeOP = parseFloat(op.quantidade) || 0;
    
            // Buscar itens já salvos na tabela itens_ordem_producao
            let itens = [];
            try {
                const [savedItems] = await pool.query(`
                    SELECT
                        id, ordem_producao_id, material_id, codigo_material,
                        descricao_material as descricao, quantidade_necessaria as quantidade,
                        quantidade_utilizada, unidade_medida as unidade,
                        local_estoque, tipo_item, principal,
                        COALESCE(custo_unitario, 0) as custo_unitario,
                        COALESCE(custo_total, 0) as custo_total
                    FROM itens_ordem_producao
                    WHERE ordem_producao_id = ?
                    ORDER BY principal DESC, tipo_item, id ASC
                `, [id]);
    
                if (savedItems && savedItems.length > 0) {
                    // Batch: buscar estoque de todos os materiais de uma vez
                    const codigosMateriais = savedItems.map(i => i.codigo_material).filter(Boolean);

                    let estoqueMap = {};
                    let custosProdutosMap = {};
                    let custosMateriaisMap = {};

                    if (codigosMateriais.length > 0) {
                        try {
                            const [estoqueRows] = await pool.query(`
                                SELECT codigo_material, COALESCE(SUM(quantidade_disponivel), 0) as estoque
                                FROM estoque_saldos
                                WHERE codigo_material IN (?)
                                GROUP BY codigo_material
                            `, [codigosMateriais]);
                            for (const r of estoqueRows) estoqueMap[r.codigo_material] = parseFloat(r.estoque) || 0;
                        } catch(e) {}

                        try {
                            const [custoRows] = await pool.query(`
                                SELECT codigo, COALESCE(preco_custo, custo_unitario, 0) as custo
                                FROM produtos
                                WHERE codigo IN (?)
                            `, [codigosMateriais]);
                            for (const r of custoRows) custosProdutosMap[r.codigo] = parseFloat(r.custo) || 0;
                        } catch(e) {}

                        try {
                            const [matRows] = await pool.query(`
                                SELECT codigo_material, COALESCE(custo_unitario, 0) as custo
                                FROM materiais
                                WHERE codigo_material IN (?)
                            `, [codigosMateriais]);
                            for (const r of matRows) custosMateriaisMap[r.codigo_material] = parseFloat(r.custo) || 0;
                        } catch(e) {}
                    }

                    // Aplicar dados em batch
                    for (const item of savedItems) {
                        item.estoque_disponivel = estoqueMap[item.codigo_material] || 0;
                        if (!item.custo_unitario || item.custo_unitario === 0) {
                            item.custo_unitario = custosProdutosMap[item.codigo_material] || custosMateriaisMap[item.codigo_material] || 0;
                        }
                    }
                    itens = savedItems;
                }
            } catch (e) {
                console.log('[API_PCP] Tabela itens_ordem_producao não existe ou erro:', e.message);
            }
    
            // Se não há itens salvos, tentar gerar baseado na estrutura do produto
            if (itens.length === 0) {
                console.log(`[API_PCP] Buscando estrutura para produto: ${op.produto_nome}`);
    
                // Tentar encontrar estrutura correspondente ao produto
                try {
                    // Buscar por nome parcial
                    const produtoNome = (op.produto_nome || '').toUpperCase();
                    let estrutura = [];
    
                    // Buscar estruturas que correspondam ao produto
                    const [estruturas] = await pool.query(`
                        SELECT DISTINCT produto_codigo, produto_descricao
                        FROM estrutura_produto
                        WHERE ativo = 1
                    `);
    
                    // Tentar encontrar correspondência
                    let produtoEstrutura = null;
    
                    // 1. Verificar se o produto_nome contém diretamente o código (ex: "TRN70", "POT120")
                    for (const est of estruturas) {
                        const codigo = est.produto_codigo;
                        // Verificar se o código está no nome do produto
                        if (produtoNome.includes(codigo) || produtoNome.includes(codigo.replace(/([A-Z]+)(\d+)/, '$1 $2'))) {
                            produtoEstrutura = codigo;
                            console.log(`[API_PCP] Match direto por código: ${codigo}`);
                            break;
                        }
                    }
    
                    // 2. Se não encontrou, tentar extrair código do nome (ex: "TRIPLEX 70mm² NEUTRO" -> TRN70 ou TRI70)
                    if (!produtoEstrutura) {
                        // Extrair bitola (número) do nome
                        const bitolaMatch = produtoNome.match(/(\d+)\s*MM/);
                        const bitola = bitolaMatch ? bitolaMatch[1] : null;
    
                        if (bitola) {
                            // Verificar tipo de cabo
                            if (produtoNome.includes('TRIPLEX')) {
                                if (produtoNome.includes('ISOLADO') || produtoNome.includes('TRI')) {
                                    produtoEstrutura = `TRI${bitola}`;
                                } else if (produtoNome.includes('NU') || produtoNome.includes('TRN')) {
                                    produtoEstrutura = `TRN${bitola}`;
                                } else {
                                    // Default para TRIPLEX é Neutro Nu
                                    produtoEstrutura = `TRN${bitola}`;
                                }
                            } else if (produtoNome.includes('DUPLEX')) {
                                if (produtoNome.includes('ISOLADO') || produtoNome.includes('DUI')) {
                                    produtoEstrutura = `DUI${bitola}`;
                                } else {
                                    produtoEstrutura = `DUN${bitola}`;
                                }
                            } else if (produtoNome.includes('QUAD')) {
                                if (produtoNome.includes('ISOLADO') || produtoNome.includes('QDI')) {
                                    produtoEstrutura = `QDI${bitola}`;
                                } else {
                                    produtoEstrutura = `QDN${bitola}`;
                                }
                            } else if (produtoNome.includes('POT') || produtoNome.includes('POTÊNCIA') || produtoNome.includes('POTENCIA')) {
                                produtoEstrutura = `POT${bitola}`;
                            } else if (produtoNome.includes('PRO') || produtoNome.includes('PROTEGIDO')) {
                                produtoEstrutura = `PRO${bitola}`;
                            } else if (produtoNome.includes('UN') || produtoNome.includes('NBR 7285')) {
                                produtoEstrutura = `UN${bitola}`;
                            } else if (produtoNome.includes('CET') || produtoNome.includes('HEPR') || produtoNome.includes('0,6/1KV')) {
                                // Cabos de potência HEPR - formato CET{vias}.{bitola}
                                // Tentar extrair número de vias do nome (ex: "2x1,5mm²" -> 2 vias, 1.5mm²)
                                const viasMatch = produtoNome.match(/(\d+)\s*[xX]\s*(\d+[,.]?\d*)/);
                                if (viasMatch) {
                                    const vias = viasMatch[1];
                                    let bitolaHEPR = viasMatch[2].replace(',', '.');
                                    // Converter 1.5 -> 15, 2.5 -> 25, etc.
                                    if (bitolaHEPR.includes('.')) {
                                        bitolaHEPR = bitolaHEPR.replace('.', '');
                                    }
                                    produtoEstrutura = `CET${vias}.${bitolaHEPR}`;
                                } else {
                                    // Fallback para formato antigo
                                    produtoEstrutura = `CET${bitola}`;
                                }
                            }
    
                            console.log(`[API_PCP] Código extraído do nome: ${produtoEstrutura}`);
    
                            // Verificar se o código existe na tabela
                            const existe = estruturas.find(e => e.produto_codigo === produtoEstrutura);
                            if (!existe) {
                                console.log(`[API_PCP] Código ${produtoEstrutura} não encontrado na tabela estrutura_produto`);
                                produtoEstrutura = null;
                            }
                        }
                    }
    
                    // 3. Fallback: correspondência por palavras
                    if (!produtoEstrutura) {
                        for (const est of estruturas) {
                            const descUpper = (est.produto_descricao || '').toUpperCase();
                            const palavrasProduto = produtoNome.split(/[\s-_]+/).filter(p => p.length > 2);
                            const palavrasEstrutura = descUpper.split(/[\s-_]+/).filter(p => p.length > 2);
                            const matches = palavrasProduto.filter(p => palavrasEstrutura.some(e => e.includes(p) || p.includes(e)));
                            if (matches.length >= 2) {
                                produtoEstrutura = est.produto_codigo;
                                console.log(`[API_PCP] Match por palavras: ${produtoEstrutura}`);
                                break;
                            }
                        }
                    }
    
                    if (produtoEstrutura) {
                        // Buscar componentes da estrutura
                        const [componentes] = await pool.query(`
                            SELECT componente_codigo, componente_descricao, componente_tipo,
                                   quantidade_por_metro, unidade, local_estoque
                            FROM estrutura_produto
                            WHERE produto_codigo = ? AND ativo = 1
                            ORDER BY componente_tipo, id
                        `, [produtoEstrutura]);
    
                        console.log(`[API_PCP] Encontrados ${componentes.length} componentes na estrutura ${produtoEstrutura}`);
    
                        // Batch: buscar estoque de todos os componentes de uma vez
                        const codigosComp = componentes.map(c => c.componente_codigo).filter(Boolean);
                        let estoqueCompMap = {};
                        if (codigosComp.length > 0) {
                            try {
                                const [estoqueRows] = await pool.query(`
                                    SELECT codigo_material, COALESCE(SUM(quantidade_disponivel), 0) as estoque
                                    FROM estoque_saldos
                                    WHERE codigo_material IN (?)
                                    GROUP BY codigo_material
                                `, [codigosComp]);
                                for (const r of estoqueRows) estoqueCompMap[r.codigo_material] = parseFloat(r.estoque) || 0;
                            } catch(e) {}
                        }

                        for (const comp of componentes) {
                            const qtdNecessaria = quantidadeOP * parseFloat(comp.quantidade_por_metro);
                            const estoqueDisponivel = estoqueCompMap[comp.componente_codigo] || 0;

                            itens.push({
                                id: 0,
                                ordem_producao_id: id,
                                material_id: null,
                                codigo_material: comp.componente_codigo,
                                descricao: comp.componente_descricao,
                                quantidade: qtdNecessaria,
                                quantidade_utilizada: 0,
                                unidade: comp.unidade,
                                estoque_disponivel: estoqueDisponivel,
                                local_estoque: comp.local_estoque,
                                tipo_item: comp.componente_tipo.toUpperCase(),
                                principal: 0
                            });
                        }
                    }
                } catch (e) {
                    console.log('[API_PCP] Erro ao buscar estrutura:', e.message);
                }
    
                // Se ainda não há itens, mostrar apenas o produto principal
                if (itens.length === 0) {
                    itens = [{
                        id: 0,
                        ordem_producao_id: op.id,
                        material_id: null,
                        codigo_material: op.codigo,
                        descricao: op.produto_nome,
                        quantidade: op.quantidade,
                        quantidade_utilizada: 0,
                        unidade: op.unidade || 'M',
                        estoque_disponivel: 0,
                        local_estoque: 'PRODUÇÃO',
                        tipo_item: 'PRODUTO_ACABADO',
                        principal: 1
                    }];
                }
            }
    
            console.log(`[API_PCP] Retornando ${itens.length} itens da ordem ${id}`);
            res.json({ success: true, data: itens, total: itens.length });
        } catch (error) {
            console.error('[API_PCP] Erro ao buscar itens:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar itens da ordem', error: error.message });
        }
    });
    
    // ========================================
    // GERENCIAMENTO DE COLUNAS/ETAPAS DO KANBAN PCP
    // ========================================
    
    // Listar todas as colunas/etapas do kanban
    router.get('/kanban-colunas', async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT id, codigo, nome, descricao, cor, icone, ordem, ativo, permite_exclusao
                FROM kanban_colunas_pcp
                WHERE ativo = 1
                ORDER BY ordem ASC
            `);
            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('[API_PCP] Erro ao listar colunas kanban:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar colunas', error: error.message });
        }
    });
    
    // Listar todas as colunas (incluindo inativas) - para admin
    router.get('/kanban-colunas/todas', async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT id, codigo, nome, descricao, cor, icone, ordem, ativo, permite_exclusao
                FROM kanban_colunas_pcp
                ORDER BY ordem ASC
            `);
            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('[API_PCP] Erro ao listar todas colunas kanban:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar colunas', error: error.message });
        }
    });
    
    // Criar nova coluna/etapa
    router.post('/kanban-colunas', async (req, res) => {
        const { codigo, nome, descricao, cor, icone } = req.body;
        console.log('[API_PCP] Criando nova coluna kanban:', nome);
    
        try {
            // Buscar próxima ordem
            const [[maxOrdem]] = await pool.query('SELECT MAX(ordem) as max FROM kanban_colunas_pcp');
            const novaOrdem = (maxOrdem.max || 0) + 1;
    
            // Gerar código único se não fornecido
            const codigoFinal = codigo || nome.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    
            const [result] = await pool.query(`
                INSERT INTO kanban_colunas_pcp (codigo, nome, descricao, cor, icone, ordem, ativo, permite_exclusao)
                VALUES (?, ?, ?, ?, ?, ?, 1, 1)
            `, [codigoFinal, nome, descricao || '', cor || '#6b7280', icone || 'fa-circle', novaOrdem]);
    
            res.json({
                success: true,
                message: 'Coluna criada com sucesso',
                data: { id: result.insertId, codigo: codigoFinal, nome, ordem: novaOrdem }
            });
        } catch (error) {
            console.error('[API_PCP] Erro ao criar coluna kanban:', error.message);
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ success: false, message: 'Já existe uma coluna com esse código' });
            }
            res.status(500).json({ success: false, message: 'Erro ao criar coluna', error: error.message });
        }
    });
    
    // Reordenar colunas (IMPORTANTE: deve vir ANTES das rotas com :id)
    router.put('/kanban-colunas/reordenar', async (req, res) => {
        const { ordem } = req.body; // Array de { id, ordem }
        console.log('[API_PCP] Reordenando colunas kanban');
    
        try {
            for (const item of ordem) {
                await pool.query('UPDATE kanban_colunas_pcp SET ordem = ? WHERE id = ?', [item.ordem, item.id]);
            }
            res.json({ success: true, message: 'Colunas reordenadas com sucesso' });
        } catch (error) {
            console.error('[API_PCP] Erro ao reordenar colunas:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao reordenar colunas', error: error.message });
        }
    });
    
    // Atualizar coluna/etapa
    router.put('/kanban-colunas/:id', async (req, res) => {
        const { id } = req.params;
        const { nome, descricao, cor, icone, ativo } = req.body;
        console.log('[API_PCP] Atualizando coluna kanban:', id);
    
        try {
            await pool.query(`
                UPDATE kanban_colunas_pcp
                SET nome = COALESCE(?, nome),
                    descricao = COALESCE(?, descricao),
                    cor = COALESCE(?, cor),
                    icone = COALESCE(?, icone),
                    ativo = COALESCE(?, ativo)
                WHERE id = ?
            `, [nome, descricao, cor, icone, ativo, id]);
    
            res.json({ success: true, message: 'Coluna atualizada com sucesso' });
        } catch (error) {
            console.error('[API_PCP] Erro ao atualizar coluna kanban:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao atualizar coluna', error: error.message });
        }
    });
    
    // Excluir coluna/etapa
    router.delete('/kanban-colunas/:id', async (req, res) => {
        const { id } = req.params;
        console.log('[API_PCP] Excluindo coluna kanban:', id);
    
        try {
            // Verificar se permite exclusão
            const [[coluna]] = await pool.query('SELECT permite_exclusao, codigo FROM kanban_colunas_pcp WHERE id = ?', [id]);
    
            if (!coluna) {
                return res.status(404).json({ success: false, message: 'Coluna não encontrada' });
            }
    
            if (!coluna.permite_exclusao) {
                return res.status(400).json({ success: false, message: 'Esta coluna não pode ser excluída (é uma coluna do sistema)' });
            }
    
            // Verificar se há ordens nesta coluna
            const [[countOrdens]] = await pool.query('SELECT COUNT(*) as total FROM ordens_producao WHERE status = ?', [coluna.codigo]);
    
            if (countOrdens.total > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Não é possível excluir: existem ${countOrdens.total} ordens nesta etapa. Mova-as primeiro.`
                });
            }
    
            await pool.query('DELETE FROM kanban_colunas_pcp WHERE id = ?', [id]);
    
            res.json({ success: true, message: 'Coluna excluída com sucesso' });
        } catch (error) {
            console.error('[API_PCP] Erro ao excluir coluna kanban:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao excluir coluna', error: error.message });
        }
    });
    
    // Excluir ordem de produção
    // AUDIT-FIX DB-003: Added transaction for safe cascading delete
    router.delete('/ordens-producao/:id', async (req, res) => {
        const { id } = req.params;
        console.log(`[API_PCP] Excluindo ordem de produção ${id}...`);
        const connection = await pool.getConnection();
    
        try {
            await connection.beginTransaction();
            let deleted = false;
    
            // Excluir itens relacionados primeiro
            try {
                await connection.query('DELETE FROM itens_ordem_producao WHERE ordem_producao_id = ?', [id]);
            } catch (e) {
                console.log('[API_PCP] Tabela itens_ordem_producao não existe ou sem itens');
            }
            try { await connection.query('DELETE FROM tarefas_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM historico_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM anexos_ordem_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
            try { await connection.query('DELETE FROM apontamentos_producao WHERE ordem_producao_id = ?', [id]); } catch(e) {}
    
            // Tentar excluir de ordens_producao
            try {
                const [result] = await connection.query('DELETE FROM ordens_producao WHERE id = ?', [id]);
                if (result.affectedRows > 0) {
                    deleted = true;
                    console.log(`[API_PCP] Ordem ${id} excluída de ordens_producao`);
                }
            } catch (e) {
                console.log('[API_PCP] Erro ao excluir de ordens_producao:', e.message);
            }
    
            // Tentar excluir de ordens_producao_kanban também
            try {
                const [resultKanban] = await connection.query('DELETE FROM ordens_producao_kanban WHERE id = ?', [id]);
                if (resultKanban.affectedRows > 0) {
                    deleted = true;
                    console.log(`[API_PCP] Ordem ${id} excluída de ordens_producao_kanban`);
                }
            } catch (e) {
                console.log('[API_PCP] Tabela ordens_producao_kanban não existe');
            }
    
            if (deleted) {
                await connection.commit();
                res.json({ success: true, message: 'Ordem excluída com sucesso' });
            } else {
                await connection.rollback();
                res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }
        } catch (error) {
            await connection.rollback();
            console.error('[API_PCP] Erro ao excluir ordem:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao excluir ordem', error: error.message });
        } finally {
            connection.release();
        }
    });
    
    // Salvar/atualizar ordem de produção
    router.put('/ordens-producao/:id', async (req, res) => {
        const { id } = req.params;
        const dados = req.body;
        console.log(`[API_PCP] Atualizando ordem de produção ${id}...`);
    
        try {
            const updateFields = [];
            const params = [];
    
            if (dados.data_prevista) {
                updateFields.push('data_prevista = ?');
                params.push(dados.data_prevista);
            }
            if (dados.observacoes !== undefined) {
                updateFields.push('observacoes = ?');
                params.push(dados.observacoes);
            }
            if (dados.status) {
                updateFields.push('status = ?');
                params.push(dados.status);
            }
            if (dados.responsavel) {
                updateFields.push('responsavel = ?');
                params.push(dados.responsavel);
            }
            if (dados.maquina) {
                updateFields.push('maquina = ?');
                params.push(dados.maquina);
            }
            if (dados.cliente) {
                updateFields.push('cliente = ?');
                params.push(dados.cliente);
            }
            if (dados.progresso !== undefined) {
                updateFields.push('progresso = ?');
                params.push(dados.progresso);
            }
    
            if (updateFields.length === 0) {
                return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
            }
    
            updateFields.push('updated_at = NOW()');
            params.push(id);
    
            const sql = `UPDATE ordens_producao SET ${updateFields.join(', ')} WHERE id = ?`;
            const [result] = await pool.query(sql, params);
    
            if (result.affectedRows > 0) {
                res.json({ success: true, message: 'Ordem atualizada com sucesso' });
            } else {
                res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }
        } catch (error) {
            console.error('[API_PCP] Erro ao atualizar ordem:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao atualizar ordem', error: error.message });
        }
    });
    
    // Duplicar ordem de produção
    router.post('/ordens-producao/:id/duplicar', async (req, res) => {
        const { id } = req.params;
        console.log(`[API_PCP] Duplicando ordem de produção ${id}...`);
    
        try {
            // Buscar ordem original
            const [ordens] = await pool.query('SELECT * FROM ordens_producao WHERE id = ?', [id]);
    
            if (!ordens || ordens.length === 0) {
                return res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }
    
            const ordemOriginal = ordens[0];
    
            // Gerar novo código
            const [maxCodigo] = await pool.query("SELECT MAX(CAST(REPLACE(REPLACE(codigo, 'OP-', ''), 'OP Nº ', '') AS UNSIGNED)) as max FROM ordens_producao");
            const proximoNumero = (maxCodigo[0].max || 0) + 1;
            const novoCodigo = `OP-${proximoNumero}`;
    
            // Inserir cópia
            const [result] = await pool.query(`
                INSERT INTO ordens_producao
                (codigo, produto_nome, quantidade, unidade, status, prioridade, data_inicio, data_prevista, responsavel, maquina, observacoes, cliente)
                VALUES (?, ?, ?, ?, 'pendente', ?, CURDATE(), ?, ?, ?, ?, ?)
            `, [
                novoCodigo,
                ordemOriginal.produto_nome,
                ordemOriginal.quantidade,
                ordemOriginal.unidade,
                ordemOriginal.prioridade,
                ordemOriginal.data_prevista,
                ordemOriginal.responsavel,
                ordemOriginal.maquina,
                ordemOriginal.observacoes ? `[CÓPIA] ${ordemOriginal.observacoes}` : '[CÓPIA]',
                ordemOriginal.cliente
            ]);
    
            // Copiar itens se existirem
            try {
                const [itens] = await pool.query('SELECT * FROM itens_ordem_producao WHERE ordem_producao_id = ?', [id]);
                for (const item of itens) {
                    await pool.query(`
                        INSERT INTO itens_ordem_producao
                        (ordem_producao_id, material_id, codigo_material, descricao_material, quantidade_necessaria, unidade_medida, tipo_item, custo_unitario, local_estoque)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [result.insertId, item.material_id, item.codigo_material, item.descricao_material, item.quantidade_necessaria, item.unidade_medida, item.tipo_item, item.custo_unitario, item.local_estoque]);
                }
            } catch (e) {
                console.log('[API_PCP] Sem itens para copiar');
            }
    
            res.json({
                success: true,
                message: 'Ordem duplicada com sucesso',
                data: { id: result.insertId, codigo: novoCodigo }
            });
        } catch (error) {
            console.error('[API_PCP] Erro ao duplicar ordem:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao duplicar ordem', error: error.message });
        }
    });
    
    // Concluir ordem de produção
    router.post('/ordens-producao/:id/concluir', async (req, res) => {
        const { id } = req.params;
        console.log(`[API_PCP] Concluindo ordem de produção ${id}...`);
    
        try {
            const [result] = await pool.query(`
                UPDATE ordens_producao
                SET status = 'concluida',
                    progresso = 100,
                    data_conclusao = NOW(),
                    data_finalizacao = NOW(),
                    updated_at = NOW()
                WHERE id = ?
            `, [id]);
    
            if (result.affectedRows > 0) {
                res.json({ success: true, message: 'Ordem concluída com sucesso' });
            } else {
                res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }
        } catch (error) {
            console.error('[API_PCP] Erro ao concluir ordem:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao concluir ordem', error: error.message });
        }
    });
    
    // Buscar anexos de uma ordem
    router.get('/ordens-producao/:id/anexos', async (req, res) => {
        const { id } = req.params;
    
        try {
            const [anexos] = await pool.query(`
                SELECT id, nome_arquivo, tipo_arquivo, tamanho, descricao, created_at
                FROM anexos_ordem_producao
                WHERE ordem_producao_id = ?
                ORDER BY created_at DESC
            `, [id]);
    
            res.json({ success: true, data: anexos || [] });
        } catch (error) {
            console.error('[API_PCP] Erro ao buscar anexos:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar anexos', error: error.message });
        }
    });
    
    // Buscar histórico de alterações de uma ordem
    router.get('/ordens-producao/:id/historico', async (req, res) => {
        const { id } = req.params;
    
        try {
            const [historico] = await pool.query(`
                SELECT id, usuario, acao, campo_alterado, valor_anterior, valor_novo, created_at
                FROM historico_ordem_producao
                WHERE ordem_producao_id = ?
                ORDER BY created_at DESC
                LIMIT 50
            `, [id]);
    
            res.json({ success: true, data: historico || [] });
        } catch (error) {
            console.error('[API_PCP] Erro ao buscar histórico:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar histórico', error: error.message });
        }
    });
    
    // Buscar tarefas de uma ordem
    router.get('/ordens-producao/:id/tarefas', async (req, res) => {
        const { id } = req.params;
    
        try {
            const [tarefas] = await pool.query(`
                SELECT id, titulo, descricao, responsavel, status, prioridade, data_prevista, data_conclusao, created_at
                FROM tarefas_ordem_producao
                WHERE ordem_producao_id = ?
                ORDER BY
                    CASE status WHEN 'em_andamento' THEN 1 WHEN 'pendente' THEN 2 ELSE 3 END,
                    prioridade DESC,
                    data_prevista ASC
            `, [id]);
    
            res.json({ success: true, data: tarefas || [] });
        } catch (error) {
            console.error('[API_PCP] Erro ao buscar tarefas:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar tarefas', error: error.message });
        }
    });
    
    // Criar tarefa para uma ordem
    router.post('/ordens-producao/:id/tarefas', async (req, res) => {
        const { id } = req.params;
        const { titulo, descricao, responsavel, prioridade, data_prevista } = req.body;
    
        try {
            const [result] = await pool.query(`
                INSERT INTO tarefas_ordem_producao
                (ordem_producao_id, titulo, descricao, responsavel, prioridade, data_prevista)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [id, titulo, descricao, responsavel, prioridade || 'media', data_prevista]);
    
            res.json({ success: true, message: 'Tarefa criada com sucesso', data: { id: result.insertId } });
        } catch (error) {
            console.error('[API_PCP] Erro ao criar tarefa:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao criar tarefa', error: error.message });
        }
    });
    
    // =================== ETIQUETAS DE PRODUÇÃO ===================
    
    // Gerar etiqueta de Bobina usando template Excel
    router.get('/ordens-producao/:id/etiqueta-bobina', async (req, res) => {
        const { id } = req.params;
        const { formato = 'excel', cor1 = '', quantidade_etiquetas = '1' } = req.query;
        const qtdEtiquetas = parseInt(quantidade_etiquetas) || 1;
        const ExcelJS = require('exceljs');
        const path = require('path');
    
        try {
            // Buscar dados da ordem de produção
            const [[ordem]] = await pool.query(`
                SELECT op.*, p.razao_social as cliente_nome, p.nome_fantasia as cliente_fantasia
                FROM ordens_producao op
                LEFT JOIN clientes p ON op.cliente COLLATE utf8mb4_general_ci = p.razao_social COLLATE utf8mb4_general_ci
                WHERE op.id = ?
            `, [id]);
    
            if (!ordem) {
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }
    
            // Carregar template Excel preenchido como base
            const templatePath = path.join(__dirname, '..', 'modules', 'PCP', 'Etiquetas', 'Bobinas.xlsx');
            const workbook = new ExcelJS.Workbook();
    
            try {
                await workbook.xlsx.readFile(templatePath);
            } catch (e) {
                console.error('[ETIQUETA_BOBINA] Template não encontrado:', templatePath);
                return res.status(500).json({ success: false, message: 'Template de etiqueta não encontrado' });
            }
    
            const worksheet = workbook.worksheets[0];
    
            // Extrair código do cabo (número) do produto
            const produto = ordem.produto_nome || '';
            let codigoCabo = '-';
            const matchCabo = produto.match(/\b(\d+(?:[.,]\d+)?)\s*(?:mm|MM)/i);
            if (matchCabo) {
                codigoCabo = matchCabo[1].replace(',', '.');
            } else {
                // Tentar extrair primeiro número do produto
                const numMatch = produto.match(/\b(\d+)\b/);
                if (numMatch) codigoCabo = numMatch[1];
            }
    
            // Extrair cor do produto (usar cor1 do query param se fornecida)
            let cor = cor1 || '';
            if (!cor) {
                const coresMap = {
                    'PRETO': 'PT', 'CINZA': 'CZ', 'VERMELHO': 'VM', 'AZUL': 'AZ',
                    'VERDE': 'VD', 'AMARELO': 'AM', 'BRANCO': 'BR', 'MARROM': 'MR',
                    'LARANJA': 'LJ', 'NEUTRO': 'NÚ', 'NU': 'NÚ'
                };
                for (const [nome, abrev] of Object.entries(coresMap)) {
                    if (produto.toUpperCase().includes(nome)) {
                        cor = abrev;
                        break;
                    }
                }
            }
    
            // Dados para preencher
            const dataAtual = new Date();
            const dataFormatada = dataAtual.toLocaleDateString('pt-BR').replace(/\//g, '.');
            const lote = `EX75 ${dataFormatada}`; // Formato: EX75 03.02.2026
            const quantidade = parseFloat(ordem.quantidade) || 0;
            const unidade = ordem.unidade || 'METROS';
            const cliente = ordem.cliente || ordem.cliente_nome || 'Estoque';
            const numeroPedido = ordem.numero_pedido || '-';
            const pesoBruto = parseFloat(ordem.peso_bruto) || 0;
            const pesoLiquido = parseFloat(ordem.peso_liquido) || 0;
            const dimensaoBobina = ordem.dimensao_bobina || '0,80x0,45';
    
            // ============== MAPEAMENTO CORRETO BASEADO NO TEMPLATE PREENCHIDO ==============
            // C2: "CABO: 70"
            worksheet.getCell('C2').value = `CABO: ${codigoCabo}`;
    
            // F2: "  Nº  PEDIDO  236"
            worksheet.getCell('F2').value = `  Nº  PEDIDO  ${numeroPedido}`;
    
            // B5: "500               METROS"
            worksheet.getCell('B5').value = `${quantidade}               ${unidade}`;
    
            // F5: "CLIENTE:    VALTER ARAUJO NUNES"
            worksheet.getCell('F5').value = `CLIENTE:    ${cliente}`;
    
            // C8: Cores marcadas - manter template ou marcar a cor atual
            // As cores ficam no formato ( PT ) ( CZ ) ( VM ) ( AZ ) ( NÚ )
            // Vamos destacar a cor selecionada se houver
            if (cor) {
                const coresTexto = `( ${cor === 'PT' ? '●PT' : 'PT'} ) ( ${cor === 'CZ' ? '●CZ' : 'CZ'} ) ( ${cor === 'VM' ? '●VM' : 'VM'} ) ( ${cor === 'AZ' ? '●AZ' : 'AZ'} ) ( ${cor === 'NÚ' ? '●NÚ' : 'NÚ'} )`;
                worksheet.getCell('C8').value = coresTexto;
            }
    
            // B12: "PESO BRUTO: " (label) - D12: valor
            worksheet.getCell('B12').value = 'PESO BRUTO: ';
            worksheet.getCell('D12').value = pesoBruto || '';
    
            // G12: "BOBINA: " (label) - H12: dimensão
            worksheet.getCell('G12').value = 'BOBINA: ';
            worksheet.getCell('H12').value = dimensaoBobina;
    
            // B15: "PESO LIQUIDO: " (label) - D15: valor
            worksheet.getCell('B15').value = 'PESO LIQUIDO: ';
            worksheet.getCell('D15').value = pesoLiquido || '';
    
            // G15: "LOTE:" (label) - H15: lote
            worksheet.getCell('G15').value = 'LOTE:';
            worksheet.getCell('H15').value = lote;
    
            // Se formato for PDF, converter Excel para PDF
            if (formato === 'pdf') {
                const PDFDocument = require('pdfkit');
                const doc = new PDFDocument({
                    size: 'A6',
                    layout: 'landscape',
                    margin: 20
                });
    
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename=Etiqueta_Bobina_${lote.replace(/\s/g, '_')}.pdf`);
                doc.pipe(res);
    
                // Desenhar etiqueta de bobina
                const w = 380, h = 250;
                doc.rect(10, 10, w, h).stroke();
    
                // Título CABO
                doc.fontSize(16).font('Helvetica-Bold').text(`CABO: ${codigoCabo}`, 30, 25);
                doc.fontSize(12).text(`Nº PEDIDO  ${numeroPedido}`, 200, 28);
    
                // Quantidade
                doc.fontSize(20).font('Helvetica-Bold').text(`${quantidade}`, 30, 60);
                doc.fontSize(14).text(unidade, 120, 65);
    
                // Cliente
                doc.fontSize(11).font('Helvetica').text(`CLIENTE: ${cliente}`, 200, 60);
    
                // Cores
                doc.fontSize(10).text(`( PT ) ( CZ ) ( VM ) ( AZ ) ( NÚ )`, 80, 100);
                if (cor) {
                    // Destacar cor selecionada
                    doc.fontSize(10).font('Helvetica-Bold');
                }
    
                // Linha divisória
                doc.moveTo(20, 130).lineTo(380, 130).stroke();
    
                // Peso Bruto e Bobina
                doc.fontSize(10).font('Helvetica').text('PESO BRUTO:', 30, 145);
                doc.font('Helvetica-Bold').text(`${pesoBruto}`, 110, 145);
                doc.font('Helvetica').text('BOBINA:', 220, 145);
                doc.font('Helvetica-Bold').text(dimensaoBobina, 275, 145);
    
                // Peso Líquido e Lote
                doc.font('Helvetica').text('PESO LIQUIDO:', 30, 175);
                doc.font('Helvetica-Bold').text(`${pesoLiquido}`, 115, 175);
                doc.font('Helvetica').text('LOTE:', 220, 175);
                doc.font('Helvetica-Bold').text(lote, 260, 175);
    
                doc.end();
                return;
            }
    
            // Retornar Excel
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=Etiqueta_Bobina_${lote.replace(/\s/g, '_')}.xlsx`);
    
            await workbook.xlsx.write(res);
            res.end();
    
        } catch (error) {
            console.error('[ETIQUETA_BOBINA] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar etiqueta', error: error.message });
        }
    });
    
    // Gerar etiqueta de Identificação de Produto usando template Excel
    router.get('/ordens-producao/:id/etiqueta-produto', async (req, res) => {
        const { id } = req.params;
        const { formato = 'excel', cor1 = '', cor2 = '', quantidade_etiquetas = '4' } = req.query;
        const qtdEtiquetas = parseInt(quantidade_etiquetas) || 4; // 1, 2, 4 ou 6
        const ExcelJS = require('exceljs');
        const path = require('path');
    
        try {
            // Buscar dados da ordem de produção
            const [[ordem]] = await pool.query(`
                SELECT op.*, p.razao_social as cliente_nome
                FROM ordens_producao op
                LEFT JOIN clientes p ON op.cliente COLLATE utf8mb4_general_ci = p.razao_social COLLATE utf8mb4_general_ci
                WHERE op.id = ?
            `, [id]);
    
            if (!ordem) {
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }
    
            // Carregar template Excel - tentar múltiplos nomes de arquivo
            const fs = require('fs');
            const possibleNames = [
                'Identificacao_Produto_Template.xlsx',
                'Indentificação de Produto.xlsx',
                'Indentificacao de Produto.xlsx',
                'Identificacao_Produto_4x.xlsx',
                'Identificacao_Produto.xlsx',
                'identificacao_produto.xlsx'
            ];
    
            let templatePath = null;
            const etiquetasDir = path.join(__dirname, '..', 'modules', 'PCP', 'Etiquetas');
    
            for (const name of possibleNames) {
                const testPath = path.join(etiquetasDir, name);
                if (fs.existsSync(testPath)) {
                    templatePath = testPath;
                    console.log('[ETIQUETA_PRODUTO] Template encontrado:', templatePath);
                    break;
                }
            }
    
            if (!templatePath) {
                console.error('[ETIQUETA_PRODUTO] Nenhum template encontrado em:', etiquetasDir);
                const files = fs.readdirSync(etiquetasDir);
                console.error('[ETIQUETA_PRODUTO] Arquivos disponíveis:', files);
                return res.status(500).json({ success: false, message: 'Template de etiqueta não encontrado' });
            }
    
            const workbook = new ExcelJS.Workbook();
    
            try {
                await workbook.xlsx.readFile(templatePath);
            } catch (e) {
                console.error('[ETIQUETA_PRODUTO] Template não encontrado:', templatePath);
                return res.status(500).json({ success: false, message: 'Template de etiqueta não encontrado' });
            }
    
            const worksheet = workbook.worksheets[0];
    
            // Extrair código do cabo (número) do produto
            const produto = ordem.produto_nome || '';
            let codigoCabo = '-';
            const matchCabo = produto.match(/\b(\d+(?:[.,]\d+)?)\s*(?:mm|MM)/i);
            if (matchCabo) {
                codigoCabo = matchCabo[1].replace(',', '.');
            } else {
                const numMatch = produto.match(/\b(\d+)\b/);
                if (numMatch) codigoCabo = numMatch[1];
            }
    
            // Extrair cor do produto se não informada
            let corProduto = cor1 || '';
            if (!corProduto) {
                const coresMap = {
                    'PRETO': 'PT', 'CINZA': 'CZ', 'VERMELHO': 'VM', 'AZUL': 'AZ',
                    'VERDE': 'VD', 'AMARELO': 'AM', 'BRANCO': 'BR', 'MARROM': 'MR',
                    'LARANJA': 'LJ', 'NEUTRO': 'NÚ', 'NU': 'NÚ'
                };
                for (const [nome, abrev] of Object.entries(coresMap)) {
                    if (produto.toUpperCase().includes(nome)) {
                        corProduto = abrev;
                        break;
                    }
                }
            }
            const corEtiqueta2 = cor2 || corProduto;
    
            // Dados para preencher
            const dataAtual = new Date();
            const dataFormatada = dataAtual.toLocaleDateString('pt-BR').replace(/\//g, '.');
            const lote = `EX75 ${dataFormatada}`;
            const quantidade = parseFloat(ordem.quantidade) || 0;
            const unidade = ordem.unidade || 'METROS';
            const cliente = ordem.cliente || ordem.cliente_nome || 'Estoque';
            const numeroPedido = ordem.numero_pedido || '-';
            const observacoes = ordem.observacoes || '';
    
            // ============== MAPEAMENTO PARA TEMPLATE "Indentificação de Produto.xlsx" ==============
            // Template com 4 etiquetas em formato 2x2:
            // - Etiquetas 1 e 2: Linhas 1-16 (superior)
            // - Etiquetas 3 e 4: Linhas 18-33 (inferior)
            // - Colunas A-G (1-7) para etiquetas esquerda
            // - Colunas I-O (9-15) para etiquetas direita
            //
            // Estrutura de cada etiqueta:
            // - LOTE: B (col 2 ou 10) | COR: F (col 6 ou 14)
            // - CABO: B (col 2 ou 10) | Nº PEDIDO: E (col 5 ou 13)
            // - QUANT: B (col 2 ou 10)
            // - CLIENTE: B (col 2 ou 10)
            // - OBS: B (col 2 ou 10)
    
            // Função para preencher uma etiqueta baseado na posição
            const preencherEtiquetaTemplate = (baseRow, baseCol, numEtiqueta, corUsada) => {
                // baseCol: 1 para esquerda (A), 9 para direita (I)
                const col = (offset) => baseCol + offset;
    
                try {
                    // LOTE (linha 3 relativa = baseRow + 2)
                    worksheet.getRow(baseRow + 2).getCell(col(1)).value = lote;
    
                    // COR (linha 3 relativa, coluna +5)
                    worksheet.getRow(baseRow + 2).getCell(col(5)).value = corUsada;
    
                    // CABO (linha 5 relativa = baseRow + 4)
                    worksheet.getRow(baseRow + 4).getCell(col(1)).value = codigoCabo;
    
                    // Nº PEDIDO (linha 5 relativa, coluna +4)
                    worksheet.getRow(baseRow + 4).getCell(col(4)).value = numeroPedido;
    
                    // QUANT (linha 8 relativa = baseRow + 7)
                    worksheet.getRow(baseRow + 7).getCell(col(1)).value = quantidade;
    
                    // CLIENTE (linha 11 relativa = baseRow + 10)
                    worksheet.getRow(baseRow + 10).getCell(col(1)).value = cliente;
    
                    // OBS (linha 14 relativa = baseRow + 13)
                    worksheet.getRow(baseRow + 13).getCell(col(1)).value = observacoes || '';
    
                    console.log('[ETIQUETA] Etiqueta', numEtiqueta, 'preenchida - LOTE:', lote, 'COR:', corUsada, 'CABO:', codigoCabo);
                } catch (e) {
                    console.log('[ETIQUETA] Erro ao preencher etiqueta', numEtiqueta, ':', e.message);
                }
            };
    
            // -------- PREENCHER ETIQUETAS CONFORME QUANTIDADE SELECIONADA --------
            const totalRows = worksheet.rowCount;
            console.log('[ETIQUETA] Template tem', totalRows, 'linhas, quantidade solicitada:', qtdEtiquetas);
    
            // Etiqueta 1 - Superior Esquerda (base: linha 1, coluna A=1)
            if (qtdEtiquetas >= 1) {
                preencherEtiquetaTemplate(1, 1, 1, corProduto);
            }
    
            // Etiqueta 2 - Superior Direita (base: linha 1, coluna I=9)
            if (qtdEtiquetas >= 2) {
                preencherEtiquetaTemplate(1, 9, 2, corEtiqueta2);
            }
    
            // Se o template tiver mais de 20 linhas, preencher etiquetas 3 e 4
            if (totalRows > 20) {
                // Etiqueta 3 - Inferior Esquerda (base: linha 18, coluna A=1)
                if (qtdEtiquetas >= 3) {
                    preencherEtiquetaTemplate(18, 1, 3, corProduto);
                }
    
                // Etiqueta 4 - Inferior Direita (base: linha 18, coluna I=9)
                if (qtdEtiquetas >= 4) {
                    preencherEtiquetaTemplate(18, 9, 4, corEtiqueta2);
                }
            }
    
            // Se formato for PDF, converter Excel para PDF
            if (formato === 'pdf') {
                const PDFDocument = require('pdfkit');
                const doc = new PDFDocument({
                    size: 'A5',
                    layout: 'landscape',
                    margin: 15
                });
    
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename=Etiqueta_Produto_${lote.replace(/\s/g, '_')}.pdf`);
                doc.pipe(res);
    
                // Função para desenhar uma etiqueta
                const desenharEtiqueta = (x, y, num, cor) => {
                    const w = 250, h = 170;
    
                    // Borda
                    doc.rect(x, y, w, h).stroke();
    
                    // Título
                    doc.fontSize(10).font('Helvetica-Bold')
                       .text('IDENTIFICAÇÃO DE PRODUTO', x + 10, y + 8, { width: w - 40 });
                    doc.fontSize(12).text(num, x + w - 25, y + 5);
    
                    // Linha
                    doc.moveTo(x + 5, y + 25).lineTo(x + w - 5, y + 25).stroke();
    
                    // LOTE e COR
                    doc.fontSize(9).font('Helvetica-Bold').text('LOTE:', x + 10, y + 32);
                    doc.font('Helvetica').text(lote, x + 45, y + 32);
                    doc.font('Helvetica-Bold').text('COR', x + 160, y + 32);
                    doc.font('Helvetica').fontSize(10).text(cor, x + 190, y + 32);
    
                    // CABO e PEDIDO
                    doc.fontSize(9).font('Helvetica-Bold').text('CABO', x + 10, y + 55);
                    doc.font('Helvetica').fontSize(14).text(codigoCabo, x + 50, y + 52);
                    doc.fontSize(9).font('Helvetica-Bold').text('Nº PEDIDO', x + 130, y + 55);
                    doc.font('Helvetica').fontSize(12).text(numeroPedido, x + 195, y + 52);
    
                    // QUANTIDADE
                    doc.fontSize(9).font('Helvetica-Bold').text('QUANT:', x + 10, y + 80);
                    doc.font('Helvetica').fontSize(16).text(quantidade, x + 55, y + 77);
                    doc.fontSize(10).text(unidade, x + 150, y + 80);
    
                    // CLIENTE
                    doc.fontSize(9).font('Helvetica-Bold').text('CLIENTE', x + 10, y + 105);
                    doc.font('Helvetica').fontSize(9).text(cliente.substring(0, 35), x + 10, y + 118, { width: w - 20 });
    
                    // OBS
                    doc.fontSize(8).font('Helvetica-Bold').text('OBS:', x + 10, y + 140);
                    if (observacoes) {
                        doc.font('Helvetica').fontSize(7).text(observacoes.substring(0, 50), x + 35, y + 140, { width: w - 50 });
                    }
                };
    
                // Desenhar etiquetas conforme quantidade solicitada
                const posicoes = [
                    { x: 15, y: 15 },    // Superior Esquerda
                    { x: 285, y: 15 },   // Superior Direita
                    { x: 15, y: 200 },   // Inferior Esquerda
                    { x: 285, y: 200 },  // Inferior Direita
                    { x: 15, y: 385 },   // Página 2 Superior Esquerda (para 5+)
                    { x: 285, y: 385 }   // Página 2 Superior Direita (para 6)
                ];
    
                for (let i = 0; i < Math.min(qtdEtiquetas, posicoes.length); i++) {
                    if (i === 4) doc.addPage(); // Nova página para 5ª e 6ª etiqueta
                    const pos = i < 4 ? posicoes[i] : { x: posicoes[i - 4].x, y: posicoes[i - 4].y };
                    desenharEtiqueta(pos.x, pos.y, String(i + 1), corProduto);
                }
    
                doc.end();
                return;
            }
    
            // Retornar Excel
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=Etiqueta_Produto_${lote.replace(/\s/g, '_')}.xlsx`);
    
            await workbook.xlsx.write(res);
            res.end();
    
        } catch (error) {
            console.error('[ETIQUETA_PRODUTO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar etiqueta', error: error.message });
        }
    });
    
    // Gerar etiqueta de Identificação de Produto em PDF para visualização (rota legado)
    router.get('/ordens-producao/:id/etiqueta-produto-pdf', async (req, res) => {
        const { id } = req.params;
        const { cor1 = '', cor2 = '' } = req.query;
        const PDFDocument = require('pdfkit');
    
        try {
            // Buscar dados da ordem de produção
            const [[ordem]] = await pool.query(`
                SELECT op.*, p.razao_social as cliente_nome
                FROM ordens_producao op
                LEFT JOIN clientes p ON op.cliente COLLATE utf8mb4_general_ci = p.razao_social COLLATE utf8mb4_general_ci
                WHERE op.id = ?
            `, [id]);
    
            if (!ordem) {
                return res.status(404).json({ success: false, message: 'Ordem de produção não encontrada' });
            }
    
            // Extrair código do cabo (número) do produto
            const produto = ordem.produto_nome || '';
            let codigoCabo = '-';
            const matchCabo = produto.match(/\b(\d+(?:[.,]\d+)?)\s*(?:mm|MM)/i);
            if (matchCabo) {
                codigoCabo = matchCabo[1].replace(',', '.');
            } else {
                const numMatch = produto.match(/\b(\d+)\b/);
                if (numMatch) codigoCabo = numMatch[1];
            }
    
            // Extrair cor do produto se não informada
            let corProduto = cor1 || '';
            if (!corProduto) {
                const coresMap = {
                    'PRETO': 'PT', 'CINZA': 'CZ', 'VERMELHO': 'VM', 'AZUL': 'AZ',
                    'VERDE': 'VD', 'AMARELO': 'AM', 'BRANCO': 'BR', 'MARROM': 'MR',
                    'LARANJA': 'LJ', 'NEUTRO': 'NÚ', 'NU': 'NÚ'
                };
                for (const [nome, abrev] of Object.entries(coresMap)) {
                    if (produto.toUpperCase().includes(nome)) {
                        corProduto = abrev;
                        break;
                    }
                }
            }
            const corEtiqueta2 = cor2 || corProduto;
    
            // Dados para preencher
            const dataAtual = new Date();
            const dataFormatada = dataAtual.toLocaleDateString('pt-BR').replace(/\//g, '.');
            const lote = `EX75 ${dataFormatada}`;
            const quantidade = parseFloat(ordem.quantidade) || 0;
            const unidade = ordem.unidade || 'METROS';
            const cliente = ordem.cliente || ordem.cliente_nome || 'Estoque';
            const observacoes = ordem.observacoes || '';
            const numeroPedido = ordem.numero_pedido || '-';
    
            // Criar PDF com duas etiquetas lado a lado
            const doc = new PDFDocument({
                size: 'A5',
                layout: 'landscape',
                margin: 15
            });
    
            // Configurar headers
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename=Etiqueta_Produto_${lote.replace(/\s/g, '_')}.pdf`);
    
            doc.pipe(res);
    
            // Função para desenhar uma etiqueta
            const desenharEtiqueta = (x, y, num, cor) => {
                const w = 250, h = 170;
    
                // Borda
                doc.rect(x, y, w, h).stroke();
    
                // Título
                doc.fontSize(10).font('Helvetica-Bold')
                   .text('IDENTIFICAÇÃO DE PRODUTO', x + 10, y + 8, { width: w - 40 });
                doc.fontSize(12).text(num, x + w - 25, y + 5);
    
                // Linha
                doc.moveTo(x + 5, y + 25).lineTo(x + w - 5, y + 25).stroke();
    
                // LOTE e COR
                doc.fontSize(9).font('Helvetica-Bold').text('LOTE:', x + 10, y + 32);
                doc.font('Helvetica').text(lote, x + 45, y + 32);
                doc.font('Helvetica-Bold').text('COR', x + 160, y + 32);
                doc.font('Helvetica').fontSize(10).text(cor, x + 190, y + 32);
    
                // CABO e PEDIDO
                doc.fontSize(9).font('Helvetica-Bold').text('CABO', x + 10, y + 55);
                doc.font('Helvetica').fontSize(14).text(codigoCabo, x + 50, y + 52);
                doc.fontSize(9).font('Helvetica-Bold').text('Nº PEDIDO', x + 130, y + 55);
                doc.font('Helvetica').fontSize(12).text(numeroPedido, x + 195, y + 52);
    
                // QUANTIDADE
                doc.fontSize(9).font('Helvetica-Bold').text('QUANT:', x + 10, y + 80);
                doc.font('Helvetica').fontSize(16).text(quantidade, x + 55, y + 77);
                doc.fontSize(10).text(unidade, x + 150, y + 80);
    
                // CLIENTE
                doc.fontSize(9).font('Helvetica-Bold').text('CLIENTE', x + 10, y + 105);
                doc.font('Helvetica').fontSize(9).text(cliente.substring(0, 35), x + 10, y + 118, { width: w - 20 });
    
                // OBS
                doc.fontSize(8).font('Helvetica-Bold').text('OBS:', x + 10, y + 140);
                if (observacoes) {
                    doc.font('Helvetica').fontSize(7).text(observacoes.substring(0, 50), x + 35, y + 140, { width: w - 50 });
                }
            };
    
            // Desenhar as 4 etiquetas (2x2)
            // Linha superior
            desenharEtiqueta(15, 15, '1', corProduto);
            desenharEtiqueta(285, 15, '2', corProduto);
            // Linha inferior
            desenharEtiqueta(15, 200, '3', corProduto);
            desenharEtiqueta(285, 200, '4', corProduto);
    
            // Data no rodapé
            doc.fontSize(7).font('Helvetica')
               .text(`Gerado em: ${dataAtual.toLocaleDateString('pt-BR')}`, 400, 385);
    
            doc.end();
    
        } catch (error) {
            console.error('[ETIQUETA_PRODUTO_PDF] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar PDF', error: error.message });
        }
    });
    
    // =================== MULTIPLEXADO (PRODUÇÃO CABOS) ===================
    
    // Salvar ordem multiplexado
    router.post('/multiplexado', async (req, res) => {
        try {
            const dados = req.body;
    
            // Inserir dados
            const sql = `
                INSERT INTO ordens_multiplexado
                (numero_op, cliente, produtos, extrusora, time_producao, previsao_producao,
                 bobinas, qtd_bobinas, metragem, peso_bruto, peso_liquido, al_kg,
                 cores, secao, veias, semana, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
    
            const produtosJson = dados.produtos ? JSON.stringify(dados.produtos) : null;
    
            const [result] = await pool.query(sql, [
                dados.numero_op || null,
                dados.cliente || null,
                produtosJson,
                dados.extrusora || null,
                dados.time_producao || null,
                dados.previsao_producao || null,
                dados.bobinas || null,
                dados.qtd_bobinas || 0,
                dados.metragem || 0,
                dados.peso_bruto || 0,
                dados.peso_liquido || 0,
                dados.al_kg || 0,
                dados.cores || null,
                dados.secao || null,
                dados.veias || 0,
                dados.semana || null,
                dados.observacoes || null
            ]);
    
            console.log('[API_MULTIPLEXADO] Ordem multiplexado salva com sucesso, ID:', result.insertId);
            res.status(201).json({
                success: true,
                message: 'Dados multiplexado salvos com sucesso!',
                id: result.insertId
            });
    
        } catch (error) {
            console.error('[API_MULTIPLEXADO] Erro:', error && error.message ? error.message : error);
            res.status(500).json({
                success: false,
                message: 'Erro ao salvar dados multiplexado',
                error: error.message
            });
        }
    });
    
    // Listar ordens multiplexado
    router.get('/multiplexado', async (req, res) => {
        try {
            // Verificar se tabela existe
            const [tables] = await pool.query("SHOW TABLES LIKE 'ordens_multiplexado'");
    
            if (!tables || tables.length === 0) {
                return res.json([]);
            }
    
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM ordens_multiplexado');
            const [rows] = await pool.query(`
                SELECT id, numero_ordem, cliente, produto, quantidade, status, observacoes, created_at, updated_at
                FROM ordens_multiplexado
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            `, [limit, offset]);
    
            res.json({ data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    
        } catch (error) {
            console.error('[API_MULTIPLEXADO] Erro ao listar:', error && error.message ? error.message : error);
            res.status(500).json({ message: 'Erro ao buscar dados multiplexado' });
        }
    });
    
    // =================== COMPOSIÇÃO DE CABOS (Peso por Material) ===================
    
    // Buscar composição de um cabo pelo código
    router.get('/cabos-composicao/:codigo', async (req, res) => {
        try {
            const { codigo } = req.params;
    
            let [rows] = await pool.query(`
                SELECT
                    codigo,
                    descricao,
                    cores,
                    bitola,
                    peso_aluminio_kg_m,
                    peso_pe_kg_m,
                    peso_xlpe_kg_m,
                    peso_xlpe_at_kg_m,
                    peso_hepr_kg_m,
                    peso_pvc_kg_m,
                    peso_mb_pvc_kg_m,
                    peso_mbuvpe_kg_m,
                    peso_mbuvpt_kg_m,
                    peso_mbpeam_kg_m,
                    peso_mbpevd_kg_m,
                    peso_mbpeaz_kg_m,
                    peso_mbpebc_kg_m,
                    peso_mbpelj_kg_m,
                    peso_mbpemr_kg_m,
                    peso_mbpvccz_kg_m,
                    peso_mbpvcpt_kg_m,
                    peso_mbuvcz_kg_m,
                    peso_mbuvaz_kg_m,
                    peso_mbuvvm_kg_m,
                    peso_total_kg_m
                FROM cabos_composicao
                WHERE codigo = ? AND ativo = 1
            `, [codigo]);
    
            // Fallback: se não encontrou, tentar sem sufixo de variação (ex: C=Compacto, R=Redondo)
            if (rows.length === 0 && /[A-Z]$/i.test(codigo)) {
                const codigoBase = codigo.replace(/[A-Z]$/i, '');
                [rows] = await pool.query(`
                    SELECT codigo, descricao, cores, bitola,
                        peso_aluminio_kg_m, peso_pe_kg_m, peso_xlpe_kg_m, peso_xlpe_at_kg_m,
                        peso_hepr_kg_m, peso_pvc_kg_m, peso_mb_pvc_kg_m, peso_mbuvpe_kg_m,
                        peso_mbuvpt_kg_m, peso_mbpeam_kg_m, peso_mbpevd_kg_m, peso_mbpeaz_kg_m,
                        peso_mbpebc_kg_m, peso_mbpelj_kg_m, peso_mbpemr_kg_m, peso_mbpvccz_kg_m,
                        peso_mbpvcpt_kg_m, peso_mbuvcz_kg_m, peso_mbuvaz_kg_m, peso_mbuvvm_kg_m,
                        peso_total_kg_m
                    FROM cabos_composicao WHERE codigo = ? AND ativo = 1
                `, [codigoBase]);
            }
    
            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `Composição não encontrada para o código: ${codigo}`
                });
            }
    
            const cabo = rows[0];
    
            // Retornar com cálculos em gramas também
            res.json({
                success: true,
                data: {
                    ...cabo,
                    peso_aluminio_g_m: parseFloat(cabo.peso_aluminio_kg_m) * 1000,
                    peso_pe_g_m: parseFloat(cabo.peso_pe_kg_m) * 1000,
                    peso_xlpe_g_m: parseFloat(cabo.peso_xlpe_kg_m) * 1000,
                    peso_pvc_g_m: parseFloat(cabo.peso_pvc_kg_m) * 1000,
                    peso_total_g_m: parseFloat(cabo.peso_total_kg_m) * 1000
                }
            });
    
        } catch (error) {
            console.error('[API_COMPOSICAO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar composição', error: error.message });
        }
    });
    
    // Calcular materiais necessários para uma ordem de produção
    router.post('/cabos-composicao/calcular', async (req, res) => {
        try {
            const { codigo, metragem } = req.body;
    
            if (!codigo || !metragem) {
                return res.status(400).json({
                    success: false,
                    message: 'Código do produto e metragem são obrigatórios'
                });
            }
    
            const metros = parseFloat(metragem);
    
            // Buscar composição
            let [rows] = await pool.query(`
                SELECT * FROM cabos_composicao WHERE codigo = ? AND ativo = 1
            `, [codigo]);
    
            // Fallback: se não encontrou, tentar sem sufixo de variação (ex: C=Compacto, R=Redondo)
            if (rows.length === 0 && /[A-Z]$/i.test(codigo)) {
                const codigoBase = codigo.replace(/[A-Z]$/i, '');
                [rows] = await pool.query(`
                    SELECT * FROM cabos_composicao WHERE codigo = ? AND ativo = 1
                `, [codigoBase]);
            }
    
            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `Composição não encontrada para: ${codigo}`
                });
            }
    
            const cabo = rows[0];
    
            // Helper para calcular material
            const calcMat = (campo) => {
                const v = parseFloat(cabo[campo]) || 0;
                return { kg_m: v, total_kg: v * metros, total_g: v * metros * 1000 };
            };
    
            // Calcular materiais necessários (base)
            const materiais = {
                aluminio: calcMat('peso_aluminio_kg_m'),
                pe: calcMat('peso_pe_kg_m'),
                xlpe: calcMat('peso_xlpe_kg_m'),
                xlpe_at: calcMat('peso_xlpe_at_kg_m'),
                hepr: calcMat('peso_hepr_kg_m'),
                pvc: calcMat('peso_pvc_kg_m'),
                mb_pvc: calcMat('peso_mb_pvc_kg_m'),
                mbuvpe: calcMat('peso_mbuvpe_kg_m')
            };
    
            // Pigmentos individuais detalhados
            const pigmentos = {
                mbuvpt:  calcMat('peso_mbuvpt_kg_m'),   // MB UV Preto
                mbuvcz:  calcMat('peso_mbuvcz_kg_m'),   // MB UV Cinza
                mbuvaz:  calcMat('peso_mbuvaz_kg_m'),    // MB UV Azul
                mbpvccz: calcMat('peso_mbpvccz_kg_m'),   // MB PVC Cinza
                mbpvcpt: calcMat('peso_mbpvcpt_kg_m'),   // MB PVC Preto
                mbpeam:  calcMat('peso_mbpeam_kg_m'),    // MB PE Amarelo
                mbpevd:  calcMat('peso_mbpevd_kg_m'),    // MB PE Verde
                mbpevm:  calcMat('peso_mbpevm_kg_m'),    // MB PE Vermelho
                mbpeaz:  calcMat('peso_mbpeaz_kg_m'),    // MB PE Azul
                mbpebc:  calcMat('peso_mbpebc_kg_m'),    // MB PE Branco
                mbpelj:  calcMat('peso_mbpelj_kg_m'),    // MB PE Laranja
                mbpemr:  calcMat('peso_mbpemr_kg_m'),    // MB PE Marrom
                mbuvvm:  calcMat('peso_mbuvvm_kg_m')     // MB UV Vermelho
            };
    
            // Agrupar pigmentos por COR para o frontend
            const coresPigmento = {
                pt: (pigmentos.mbuvpt.total_kg + pigmentos.mbpvcpt.total_kg),   // Preto total
                cz: (pigmentos.mbuvcz.total_kg + pigmentos.mbpvccz.total_kg),  // Cinza total
                az: (pigmentos.mbuvaz.total_kg + pigmentos.mbpeaz.total_kg),   // Azul total
                am: pigmentos.mbpeam.total_kg,                                  // Amarelo
                vd: pigmentos.mbpevd.total_kg,                                  // Verde
                vm: (pigmentos.mbpevm.total_kg + pigmentos.mbuvvm.total_kg),    // Vermelho total
                bc: pigmentos.mbpebc.total_kg,                                  // Branco
                lj: pigmentos.mbpelj.total_kg,                                  // Laranja
                mr: pigmentos.mbpemr.total_kg                                   // Marrom
            };
    
            // Totais
            const peso_total_kg = parseFloat(cabo.peso_total_kg_m) * metros;
            const kg_km = parseFloat(cabo.peso_total_kg_m) * 1000; // kg por quilômetro
    
            res.json({
                success: true,
                data: {
                    codigo: cabo.codigo,
                    descricao: cabo.descricao,
                    cores: cabo.cores || '',
                    bitola: cabo.bitola,
                    metragem: metros,
                    materiais,
                    pigmentos,
                    coresPigmento,
                    totais: {
                        peso_liquido_kg: peso_total_kg,
                        peso_bruto_kg: peso_total_kg * 1.05, // +5% embalagem/bobina
                        kg_km: kg_km
                    }
                }
            });
    
        } catch (error) {
            console.error('[API_COMPOSICAO] Erro calcular:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao calcular materiais', error: error.message });
        }
    });
    
    // Atualizar campos de peso em pcp_multiplexado_completo baseado na composição
    router.post('/controle-pcp/:id/atualizar-composicao', async (req, res) => {
        try {
            const { id } = req.params;
    
            // Buscar ordem
            const [ordens] = await pool.query(`
                SELECT id, produto_codigo, metragem_producao, quantidade
                FROM pcp_multiplexado_completo WHERE id = ?
            `, [id]);
    
            if (ordens.length === 0) {
                return res.status(404).json({ success: false, message: 'Ordem não encontrada' });
            }
    
            const ordem = ordens[0];
            const metragem = parseFloat(ordem.metragem_producao) || parseFloat(ordem.quantidade) || 0;
    
            if (!ordem.produto_codigo) {
                return res.status(400).json({ success: false, message: 'Ordem sem código de produto' });
            }
    
            // Buscar composição pelo código
            const [composicao] = await pool.query(`
                SELECT * FROM cabos_composicao WHERE codigo = ? AND ativo = 1
            `, [ordem.produto_codigo]);
    
            if (composicao.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `Composição não encontrada para: ${ordem.produto_codigo}`
                });
            }
    
            const cabo = composicao[0];
    
            // Calcular totais
            const al_kg = parseFloat(cabo.peso_aluminio_kg_m) * metragem;
            const pe_kg = (parseFloat(cabo.peso_pe_kg_m) + parseFloat(cabo.peso_xlpe_kg_m) +
                           parseFloat(cabo.peso_pvc_kg_m) + parseFloat(cabo.peso_mb_pvc_kg_m)) * metragem;
            const peso_liquido = parseFloat(cabo.peso_total_kg_m) * metragem;
            const peso_bruto = peso_liquido * 1.05;
            const kg_km = parseFloat(cabo.peso_total_kg_m) * 1000;
    
            // Atualizar ordem
            await pool.query(`
                UPDATE pcp_multiplexado_completo SET
                    al_kg = ?,
                    pe_kg = ?,
                    peso_liquido = ?,
                    peso_bruto = ?,
                    kg_km_necessidade = ?,
                    necessidade_kg = ?,
                    updated_at = NOW()
                WHERE id = ?
            `, [al_kg, pe_kg, peso_liquido, peso_bruto, kg_km, peso_liquido, id]);
    
            console.log(`[API_COMPOSICAO] Ordem ${id} atualizada com composição de ${ordem.produto_codigo}`);
    
            res.json({
                success: true,
                message: 'Composição atualizada com sucesso',
                data: {
                    id,
                    produto: ordem.produto_codigo,
                    metragem,
                    al_kg: al_kg.toFixed(4),
                    pe_kg: pe_kg.toFixed(4),
                    peso_liquido: peso_liquido.toFixed(4),
                    peso_bruto: peso_bruto.toFixed(4),
                    kg_km: kg_km.toFixed(4)
                }
            });
    
        } catch (error) {
            console.error('[API_COMPOSICAO] Erro atualizar:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao atualizar composição', error: error.message });
        }
    });
    
    // Listar todos os cabos com composição cadastrada
    router.get('/cabos-composicao', async (req, res) => {
        try {
            const { busca } = req.query;
    
            let query = `
                SELECT
                    codigo,
                    descricao,
                    cores,
                    bitola,
                    ROUND(peso_aluminio_kg_m * 1000, 2) as aluminio_g_m,
                    ROUND(peso_pe_kg_m * 1000, 2) as pe_g_m,
                    ROUND(peso_pvc_kg_m * 1000, 2) as pvc_g_m,
                    ROUND(peso_xlpe_kg_m * 1000, 2) as xlpe_g_m,
                    ROUND(peso_mbuvpt_kg_m * 1000, 4) as mbuvpt_g_m,
                    ROUND(peso_mbuvcz_kg_m * 1000, 4) as mbuvcz_g_m,
                    ROUND(peso_mbuvaz_kg_m * 1000, 4) as mbuvaz_g_m,
                    ROUND(peso_mbpvccz_kg_m * 1000, 4) as mbpvccz_g_m,
                    ROUND(peso_mbpvcpt_kg_m * 1000, 4) as mbpvcpt_g_m,
                    ROUND(peso_mbpeam_kg_m * 1000, 4) as mbpeam_g_m,
                    ROUND(peso_mbpevd_kg_m * 1000, 4) as mbpevd_g_m,
                    ROUND(peso_mbpevm_kg_m * 1000, 4) as mbpevm_g_m,
                    ROUND(peso_mbpeaz_kg_m * 1000, 4) as mbpeaz_g_m,
                    ROUND(peso_mbpebc_kg_m * 1000, 4) as mbpebc_g_m,
                    ROUND(peso_mbpelj_kg_m * 1000, 4) as mbpelj_g_m,
                    ROUND(peso_mbpemr_kg_m * 1000, 4) as mbpemr_g_m,
                    ROUND(peso_mbuvvm_kg_m * 1000, 4) as mbuvvm_g_m,
                    ROUND(peso_total_kg_m * 1000, 2) as total_g_m,
                    ROUND(peso_total_kg_m, 4) as total_kg_m
                FROM cabos_composicao
                WHERE ativo = 1
            `;
            const params = [];
    
            if (busca) {
                query += ' AND (codigo LIKE ? OR descricao LIKE ? OR bitola LIKE ?)';
                params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
            }
    
            query += ' ORDER BY codigo ASC';
    
            const [rows] = await pool.query(query, params);
    
            res.json({
                success: true,
                total: rows.length,
                data: rows
            });
    
        } catch (error) {
            console.error('[API_COMPOSICAO] Erro listar:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar composições', error: error.message });
        }
    });
    
    // =================== MATERIAIS POR PEDIDO (Integração Vendas → PCP) ===================
    
    // Calcular materiais necessários para um pedido de vendas
    router.get('/pedidos/:id/materiais', async (req, res) => {
        try {
            const { id } = req.params;
            console.log(`[API_MATERIAIS_PEDIDO] Calculando materiais para pedido ${id}`);
    
            // Buscar dados do pedido
            const [pedidos] = await pool.query(`
                SELECT p.id, p.cliente_id, p.valor, p.status,
                       c.razao_social as cliente, c.nome_fantasia
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.id = ?
            `, [id]);
    
            if (pedidos.length === 0) {
                return res.status(404).json({ error: 'Pedido não encontrado' });
            }
    
            const pedido = pedidos[0];
    
            // Buscar itens do pedido na tabela correta (pedido_itens)
            const [itens] = await pool.query(`
                SELECT
                    pi.id,
                    pi.produto_id,
                    pi.codigo,
                    pi.descricao,
                    pi.quantidade as metros,
                    pi.preco_unitario,
                    pi.subtotal,
                    pi.embalagem,
                    pi.lances,
                    pr.codigo as produto_codigo
                FROM pedido_itens pi
                LEFT JOIN produtos pr ON pi.produto_id = pr.id
                WHERE pi.pedido_id = ?
            `, [id]);
    
            console.log(`[API_MATERIAIS_PEDIDO] Pedido ${id} tem ${itens.length} itens`);
    
            // Calcular materiais para cada item usando a tabela cabos_composicao
            const itensCalculados = [];
            let totalAlKg = 0;
            let totalPeKg = 0;
            let totalXlpeKg = 0;
            let totalPvcKg = 0;
            let totalPesoLiquido = 0;
            let totalPesoBruto = 0;
            let totalMetros = 0;
            // Totais de pigmentos por cor
            let totalPigPt = 0, totalPigCz = 0, totalPigAz = 0;
            let totalPigAm = 0, totalPigVd = 0, totalPigBc = 0;
            let totalPigLj = 0, totalPigMr = 0;
    
            // PERFORMANCE: Pré-carregar TODAS as composições ativas em memória (1 query em vez de 5-6 por item)
            const [allComposicoes] = await pool.query(`SELECT id, codigo, descricao, cores, bitola,
                peso_aluminio_kg_m, peso_pe_kg_m, peso_xlpe_kg_m, peso_xlpe_at_kg_m, peso_hepr_kg_m,
                peso_pvc_kg_m, peso_mb_pvc_kg_m, peso_mbuvpe_kg_m, peso_total_kg_m,
                peso_mbuvpt_kg_m, peso_mbuvcz_kg_m, peso_mbuvaz_kg_m, peso_mbuvvm_kg_m,
                peso_mbpvccz_kg_m, peso_mbpvcpt_kg_m,
                peso_mbpeam_kg_m, peso_mbpevd_kg_m, peso_mbpevm_kg_m, peso_mbpeaz_kg_m,
                peso_mbpebc_kg_m, peso_mbpelj_kg_m, peso_mbpemr_kg_m
                FROM cabos_composicao WHERE ativo = 1`);
            const composicaoMap = new Map();
            for (const comp of allComposicoes) {
                if (!composicaoMap.has(comp.codigo)) {
                    composicaoMap.set(comp.codigo, []);
                }
                composicaoMap.get(comp.codigo).push(comp);
            }
    
            for (const item of itens) {
                const codigoOriginal = item.codigo || item.produto_codigo || '';
                const metros = parseFloat(item.metros) || 0;
                totalMetros += metros;
    
                // Tentar encontrar composição com diferentes variações do código (in-memory)
                let composicao = [];
                const codigosParaTentar = [
                    codigoOriginal,
                    codigoOriginal.replace(/[A-Z]$/i, ''),
                    codigoOriginal.replace(/C$/i, ''),
                    codigoOriginal.replace(/N$/i, ''),
                    codigoOriginal.replace(/I$/i, ''),
                ];
    
                let codigoEncontrado = null;
                for (const codigoTeste of codigosParaTentar) {
                    if (!codigoTeste) continue;
                    const comp = composicaoMap.get(codigoTeste);
                    if (comp && comp.length > 0) {
                        composicao = comp;
                        codigoEncontrado = codigoTeste;
                        break;
                    }
                }
    
                // Também tenta busca parcial se não encontrou (in-memory prefix match)
                if (composicao.length === 0 && codigoOriginal.length >= 3) {
                    const prefix = codigoOriginal.substring(0, codigoOriginal.length - 1);
                    for (const [key, comp] of composicaoMap.entries()) {
                        if (key.startsWith(prefix) && comp.length > 0) {
                            composicao = [comp[0]];
                            codigoEncontrado = comp[0].codigo;
                            break;
                        }
                    }
                }
    
                let itemCalculado = {
                    id: item.id,
                    codigo: codigoOriginal,
                    codigo_composicao: codigoEncontrado,
                    descricao: item.descricao,
                    metros: metros,
                    embalagem: item.embalagem || 'Bobina',
                    lances: item.lances || '1x1000',
                    // Materiais individuais
                    al_kg: 0,
                    pe_kg: 0,
                    xlpe_kg: 0,
                    pvc_kg: 0,
                    peso_liquido: 0,
                    peso_bruto: 0,
                    // Composição kg/m
                    al_kg_m: 0,
                    pe_kg_m: 0,
                    xlpe_kg_m: 0,
                    pvc_kg_m: 0,
                    peso_total_kg_m: 0,
                    composicao_encontrada: false,
                    // Pigmentos por cor (agrupados)
                    pigmentos: { pt: 0, cz: 0, az: 0, am: 0, vd: 0, bc: 0, lj: 0, mr: 0 },
                    cores: ''
                };
    
                if (composicao.length > 0) {
                    const comp = composicao[0];
                    const alKgM = parseFloat(comp.peso_aluminio_kg_m) || 0;
                    const peKgM = parseFloat(comp.peso_pe_kg_m) || 0;
                    const xlpeKgM = parseFloat(comp.peso_xlpe_kg_m) || 0;
                    const pvcKgM = parseFloat(comp.peso_pvc_kg_m) || 0;
                    const pesoTotalKgM = parseFloat(comp.peso_total_kg_m) || 0;
    
                    itemCalculado.al_kg_m = alKgM;
                    itemCalculado.pe_kg_m = peKgM;
                    itemCalculado.xlpe_kg_m = xlpeKgM;
                    itemCalculado.pvc_kg_m = pvcKgM;
                    itemCalculado.peso_total_kg_m = pesoTotalKgM;
    
                    itemCalculado.al_kg = alKgM * metros;
                    itemCalculado.pe_kg = peKgM * metros;
                    itemCalculado.xlpe_kg = xlpeKgM * metros;
                    itemCalculado.pvc_kg = pvcKgM * metros;
                    itemCalculado.peso_liquido = pesoTotalKgM * metros;
                    itemCalculado.peso_bruto = itemCalculado.peso_liquido * 1.05;
                    itemCalculado.composicao_encontrada = true;
                    itemCalculado.cores = comp.cores || '';
    
                    // Calcular pigmentos por cor
                    const pf = (campo) => (parseFloat(comp[campo]) || 0) * metros;
                    itemCalculado.pigmentos = {
                        pt: pf('peso_mbuvpt_kg_m') + pf('peso_mbpvcpt_kg_m'),
                        cz: pf('peso_mbuvcz_kg_m') + pf('peso_mbpvccz_kg_m'),
                        az: pf('peso_mbuvaz_kg_m') + pf('peso_mbpeaz_kg_m'),
                        am: pf('peso_mbpeam_kg_m'),
                        vd: pf('peso_mbpevd_kg_m'),
                        bc: pf('peso_mbpebc_kg_m'),
                        lj: pf('peso_mbpelj_kg_m'),
                        mr: pf('peso_mbpemr_kg_m')
                    };
    
                    totalAlKg += itemCalculado.al_kg;
                    totalPeKg += itemCalculado.pe_kg;
                    totalXlpeKg += itemCalculado.xlpe_kg;
                    totalPvcKg += itemCalculado.pvc_kg;
                    totalPesoLiquido += itemCalculado.peso_liquido;
                    totalPesoBruto += itemCalculado.peso_bruto;
    
                    // Acumular pigmentos nos totais
                    totalPigPt += itemCalculado.pigmentos.pt;
                    totalPigCz += itemCalculado.pigmentos.cz;
                    totalPigAz += itemCalculado.pigmentos.az;
                    totalPigAm += itemCalculado.pigmentos.am;
                    totalPigVd += itemCalculado.pigmentos.vd;
                    totalPigBc += itemCalculado.pigmentos.bc;
                    totalPigLj += itemCalculado.pigmentos.lj;
                    totalPigMr += itemCalculado.pigmentos.mr;
    
                    console.log(`[API_MATERIAIS_PEDIDO] Item ${codigoOriginal} -> ${codigoEncontrado}: ${metros}m x ${pesoTotalKgM}kg/m = ${itemCalculado.peso_liquido.toFixed(2)}kg | Cores: ${itemCalculado.cores}`);
                } else {
                    console.log(`[API_MATERIAIS_PEDIDO] ⚠️ Composição não encontrada para: ${codigoOriginal}`);
                }
    
                itensCalculados.push(itemCalculado);
            }
    
            res.json({
                pedido: {
                    id: pedido.id,
                    cliente: pedido.cliente || pedido.nome_fantasia,
                    valor: pedido.valor,
                    status: pedido.status
                },
                itens: itensCalculados,
                totais: {
                    metros: totalMetros,
                    al_kg: totalAlKg,
                    pe_kg: totalPeKg,
                    xlpe_kg: totalXlpeKg,
                    pvc_kg: totalPvcKg,
                    peso_liquido: totalPesoLiquido,
                    peso_bruto: totalPesoBruto,
                    kg_por_km: totalMetros > 0 ? (totalPesoLiquido / totalMetros) * 1000 : 0,
                    itens_count: itensCalculados.length,
                    composicoes_encontradas: itensCalculados.filter(i => i.composicao_encontrada).length,
                    pigmentos: {
                        pt: totalPigPt, cz: totalPigCz, az: totalPigAz,
                        am: totalPigAm, vd: totalPigVd, bc: totalPigBc,
                        lj: totalPigLj, mr: totalPigMr
                    }
                }
            });
    
        } catch (error) {
            console.error('[API_MATERIAIS_PEDIDO] Erro:', error.message);
            res.status(500).json({ error: 'Erro ao calcular materiais', message: error.message });
        }
    });
    
    // =================== OPERADORES (FUNCIONÁRIOS PCP) ===================
    
    router.get('/operadores', async (req, res) => {
        console.log('[API_OPERADORES] Listando operadores...');
        try {
            // Tentar buscar da tabela funcionarios primeiro
            let funcionarios = [];
            try {
                const [rows] = await pool.query(`
                    SELECT id, nome, cargo, departamento, ativo
                    FROM funcionarios
                    WHERE ativo = 1 OR ativo IS NULL
                    ORDER BY nome ASC
                `);
                funcionarios = rows || [];
            } catch (e) {
                console.log('[API_OPERADORES] Tabela funcionarios não encontrada, tentando usuarios...');
            }
    
            // Se não encontrou funcionários, buscar de usuarios
            if (funcionarios.length === 0) {
                try {
                    const [rows] = await pool.query(`
                        SELECT id, nome, role as cargo, setor as departamento, ativo
                        FROM usuarios
                        WHERE ativo = 1 OR ativo IS NULL
                        ORDER BY nome ASC
                    `);
                    funcionarios = rows || [];
                } catch (e) {
                    console.log('[API_OPERADORES] Tabela usuarios também falhou');
                }
            }
    
            // Se ainda não encontrou, retornar lista padrão
            if (funcionarios.length === 0) {
                funcionarios = [
                    { id: 1, nome: 'Operador 1', cargo: 'Operador', departamento: 'Produção' },
                    { id: 2, nome: 'Operador 2', cargo: 'Operador', departamento: 'Produção' },
                    { id: 3, nome: 'Operador 3', cargo: 'Operador', departamento: 'Produção' }
                ];
            }
    
            console.log(`[API_OPERADORES] Retornando ${funcionarios.length} operadores`);
            res.json({ funcionarios, total: funcionarios.length });
        } catch (error) {
            console.error('[API_OPERADORES] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao listar operadores', error: error.message });
        }
    });
    
    // =================== MATÉRIAS PRIMAS ===================
    
    router.get('/materias-primas', async (req, res) => {
        console.log('[API_MATERIAS_PRIMAS] Listando matérias-primas...');
        try {
            // Tentar buscar da tabela materiais primeiro
            let materias = [];
            try {
                const [rows] = await pool.query(`
                    SELECT id, codigo_material as codigo, descricao, unidade_medida,
                           estoque_atual, estoque_minimo, preco_unitario, fornecedor
                    FROM materiais
                    ORDER BY descricao ASC
                `);
                materias = rows || [];
            } catch (e) {
                console.log('[API_MATERIAS_PRIMAS] Tabela materiais não encontrada, tentando produtos...');
            }
    
            // Se não encontrou materiais, buscar de produtos (como alternativa)
            if (materias.length === 0) {
                try {
                    const [rows] = await pool.query(`
                        SELECT id, codigo, descricao, unidade_medida as unidade,
                               estoque_atual, estoque_minimo, preco_venda as preco_unitario
                        FROM produtos
                        WHERE tipo = 'materia_prima' OR categoria LIKE '%materia%' OR categoria LIKE '%insumo%'
                        ORDER BY descricao ASC
                        LIMIT 100
                    `);
                    materias = rows || [];
                } catch (e) {
                    console.log('[API_MATERIAS_PRIMAS] Tabela produtos também falhou');
                }
            }
    
            console.log(`[API_MATERIAS_PRIMAS] Retornando ${materias.length} matérias-primas`);
            res.json({ success: true, data: materias, total: materias.length });
        } catch (error) {
            console.error('[API_MATERIAS_PRIMAS] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar matérias-primas', error: error.message });
        }
    });
    
    // =================== APONTAMENTOS DE PRODUÇÃO ===================
    
    // Estatísticas de apontamentos
    router.get('/apontamentos/stats', async (req, res) => {
        console.log('[API_APONTAMENTOS] Buscando estatísticas...');
        try {
            // OPs ativas (em produção ou pendentes)
            let opsAtivas = 0;
            let opsEmProducao = 0;
            let apontamentosHoje = 0;
            let qtdProduzidaHoje = 0;
    
            try {
                const [result] = await pool.query(`
                    SELECT COUNT(*) as total FROM ordens_producao
                    WHERE status IN ('ativa', 'em_producao', 'pendente', 'Em Produção', 'Ativa')
                `);
                opsAtivas = result[0]?.total || 0;
            } catch (e) { /* Tabela pode não existir */ }
    
            try {
                const [result] = await pool.query(`
                    SELECT COUNT(*) as total FROM ordens_producao
                    WHERE status IN ('em_producao', 'Em Produção')
                `);
                opsEmProducao = result[0]?.total || 0;
            } catch (e) { /* Tabela pode não existir */ }
    
            try {
                const [result] = await pool.query(`
                    SELECT COUNT(*) as total, COALESCE(SUM(duracao_segundos), 0) as total_segundos
                    FROM apontamentos_producao
                    WHERE DATE(hora_inicio) = CURDATE()
                `);
                apontamentosHoje = result[0]?.total || 0;
                qtdProduzidaHoje = result[0]?.total_segundos || 0;
            } catch (e) { /* Tabela pode não existir */ }
    
            res.json({
                success: true,
                stats: {
                    ops_ativas: opsAtivas,
                    ops_em_producao: opsEmProducao,
                    apontamentos_hoje: apontamentosHoje,
                    qtd_produzida_hoje: qtdProduzidaHoje
                }
            });
        } catch (error) {
            console.error('[API_APONTAMENTOS] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas' });
        }
    });
    
    // Listar OPs para apontamento
    router.get('/apontamentos/ordens', async (req, res) => {
        console.log('[API_APONTAMENTOS] Listando OPs para apontamento...');
        try {
            const { status } = req.query;
    
            let whereClause = "WHERE status NOT IN ('concluida', 'Concluída', 'cancelada')";
            if (status === 'ativas') {
                whereClause = "WHERE status IN ('ativa', 'Ativa')";
            } else if (status === 'em_producao') {
                whereClause = "WHERE status IN ('em_producao', 'Em Produção')";
            } else if (status === 'pendentes') {
                whereClause = "WHERE status IN ('pendente', 'Pendente', 'A Fazer')";
            }
    
            const [ordens] = await pool.query(`
                SELECT
                    op.id, op.codigo, op.produto_nome, op.quantidade, op.unidade,
                    op.status, op.prioridade, op.data_inicio, op.data_prevista,
                    op.responsavel, op.progresso
                FROM ordens_producao op
                ${whereClause}
                ORDER BY
                    CASE op.prioridade
                        WHEN 'critica' THEN 1
                        WHEN 'alta' THEN 2
                        WHEN 'media' THEN 3
                        ELSE 4
                    END,
                    op.data_prevista ASC
            `);
    
            res.json({ success: true, data: ordens });
        } catch (error) {
            console.error('[API_APONTAMENTOS] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar OPs' });
        }
    });
    
    // Relatório de apontamentos (para supervisores/gerentes)
    router.get('/apontamentos/relatorio', async (req, res) => {
        console.log('[API_APONTAMENTOS] Gerando relatório...');
        try {
            const { dataInicio, dataFim, usuario, atividade, pedido } = req.query;
    
            let whereClause = 'WHERE 1=1';
            const params = [];
    
            if (dataInicio) {
                whereClause += ' AND DATE(COALESCE(ap.hora_inicio, ap.data_apontamento)) >= ?';
                params.push(dataInicio);
            }
            if (dataFim) {
                whereClause += ' AND DATE(COALESCE(ap.hora_inicio, ap.data_apontamento)) <= ?';
                params.push(dataFim);
            }
            if (usuario) {
                whereClause += ' AND ap.usuario_id = ?';
                params.push(usuario);
            }
            if (atividade) {
                whereClause += ' AND ap.tipo_atividade = ?';
                params.push(atividade);
            }
            if (pedido) {
                whereClause += ' AND ap.pedido_id = ?';
                params.push(pedido);
            }
    
            // Verificar se a tabela existe
            let tableExists = false;
            try {
                await pool.query('SELECT 1 FROM apontamentos_producao LIMIT 1');
                tableExists = true;
            } catch (e) {
                console.log('[API_APONTAMENTOS] Tabela apontamentos_producao não existe');
            }
    
            if (!tableExists) {
                return res.json({
                    success: true,
                    apontamentos: [],
                    funcionarios: [],
                    totalFuncionarios: 0,
                    totalHoras: 0,
                    horasProducao: 0,
                    totalApontamentos: 0
                });
            }
    
            // Buscar apontamentos
            const [apontamentos] = await pool.query(`
                SELECT
                    ap.id,
                    ap.usuario_id,
                    COALESCE(u.nome, ap.operador, 'Desconhecido') as usuario_nome,
                    COALESCE(u.foto, u.avatar, '') as usuario_foto,
                    COALESCE(ap.tipo_atividade, 'outros') as tipo,
                    COALESCE(ap.nome_atividade, ap.tipo_atividade, 'Sem nome') as nome,
                    DATE(COALESCE(ap.hora_inicio, ap.data_apontamento)) as data,
                    TIME_FORMAT(ap.hora_inicio, '%H:%i') as hora_inicio,
                    TIME_FORMAT(ap.hora_fim, '%H:%i') as hora_fim,
                    COALESCE(ap.duracao_segundos, TIMESTAMPDIFF(SECOND, ap.hora_inicio, ap.hora_fim), 0) as duracao,
                    op.codigo as op_codigo,
                    ap.pedido_id,
                    COALESCE(ped.numero, ap.pedido_id) as pedido_numero,
                    ap.produto_descricao,
                    ap.observacoes
                FROM apontamentos_producao ap
                LEFT JOIN usuarios u ON ap.usuario_id = u.id
                LEFT JOIN ordens_producao op ON ap.ordem_producao_id = op.id
                LEFT JOIN pedidos ped ON ap.pedido_id = ped.id
                ${whereClause}
                ORDER BY COALESCE(ap.hora_inicio, ap.data_apontamento, ap.created_at) DESC
                LIMIT 500
            `, params);
    
            // Buscar funcionários únicos que fizeram apontamentos
            const [funcionarios] = await pool.query(`
                SELECT DISTINCT
                    COALESCE(ap.usuario_id, 0) as id,
                    COALESCE(u.nome, ap.operador, 'Desconhecido') as nome,
                    COALESCE(u.foto, u.avatar, '') as foto,
                    COALESCE(u.departamento, u.setor, '') as departamento,
                    COALESCE(u.role, 'user') as role
                FROM apontamentos_producao ap
                LEFT JOIN usuarios u ON ap.usuario_id = u.id
                ${whereClause}
            `, params);
    
            // Calcular estatísticas
            const totalSegundos = apontamentos.reduce((acc, a) => acc + (a.duracao || 0), 0);
            const producaoSegundos = apontamentos
                .filter(a => ['producao', '1', '1A'].includes(a.tipo))
                .reduce((acc, a) => acc + (a.duracao || 0), 0);
    
            res.json({
                success: true,
                apontamentos,
                funcionarios,
                totalFuncionarios: funcionarios.length,
                totalHoras: Math.round(totalSegundos / 3600 * 10) / 10,
                horasProducao: Math.round(producaoSegundos / 3600 * 10) / 10,
                totalApontamentos: apontamentos.length
            });
        } catch (error) {
            console.error('[API_APONTAMENTOS] Erro no relatório:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório' });
        }
    });
    
    // Salvar apontamento
    router.post('/apontamentos', async (req, res) => {
        console.log('[API_APONTAMENTOS] Salvando apontamento...', req.body);
        try {
            const { tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos, ordem_producao_id, pedido_numero, produto_descricao, observacoes } = req.body;
            const usuario_id = req.user?.id;
            const operador = req.user?.nome || 'Desconhecido';
    
            // Validação básica
            if (!tipo_atividade || !nome_atividade) {
                return res.status(400).json({
                    success: false,
                    message: 'tipo_atividade e nome_atividade são obrigatórios'
                });
            }
    
            // Formatação segura das datas
            const horaInicioFormatada = hora_inicio ? new Date(hora_inicio).toISOString().slice(0, 19).replace('T', ' ') : null;
            const horaFimFormatada = hora_fim ? new Date(hora_fim).toISOString().slice(0, 19).replace('T', ' ') : null;

            // Buscar pedido_id se pedido_numero fornecido
            let pedidoId = null;
            if (pedido_numero) {
                try {
                    const [pedidos] = await pool.query('SELECT id FROM pedidos WHERE id = ? OR numero = ? LIMIT 1', [pedido_numero, pedido_numero]);
                    if (pedidos.length > 0) pedidoId = pedidos[0].id;
                } catch (e) {
                    console.log('[API_APONTAMENTOS] Pedido não encontrado:', pedido_numero);
                }
            }

            // Verificar se colunas extras existem
            let hasExtraColumns = false;
            try {
                await pool.query("SELECT pedido_id FROM apontamentos_producao LIMIT 0");
                hasExtraColumns = true;
            } catch (e) {
                console.log('[API_APONTAMENTOS] Colunas extras não existem, usando INSERT básico');
            }

            let result;
            if (hasExtraColumns) {
                [result] = await pool.query(`
                    INSERT INTO apontamentos_producao
                    (usuario_id, operador, ordem_producao_id, tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos, pedido_id, produto_descricao, observacoes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    usuario_id,
                    operador,
                    ordem_producao_id || null,
                    tipo_atividade,
                    nome_atividade,
                    horaInicioFormatada,
                    horaFimFormatada,
                    duracao_segundos || 0,
                    pedidoId,
                    produto_descricao || null,
                    observacoes || null
                ]);
            } else {
                [result] = await pool.query(`
                    INSERT INTO apontamentos_producao
                    (usuario_id, operador, ordem_producao_id, tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    usuario_id,
                    operador,
                    ordem_producao_id || null,
                    tipo_atividade,
                    nome_atividade,
                    horaInicioFormatada,
                    horaFimFormatada,
                    duracao_segundos || 0
                ]);
            }
    
            console.log('[API_APONTAMENTOS] Apontamento salvo com sucesso, id:', result.insertId);
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('[API_APONTAMENTOS] Erro ao salvar:', error.message, error.stack);
            res.status(500).json({ success: false, message: 'Erro ao salvar apontamento', error: error.message });
        }
    });
    
    // Listar apontamentos do usuário logado
    router.get('/apontamentos/meus', async (req, res) => {
        console.log('[API_APONTAMENTOS] Listando apontamentos do usuário...');
        try {
            const usuario_id = req.user?.id;
            const { data } = req.query;
    
            let whereClause = 'WHERE usuario_id = ?';
            const params = [usuario_id];
    
            if (data) {
                whereClause += ' AND DATE(hora_inicio) = ?';
                params.push(data);
            }
    
            const [apontamentos] = await pool.query(`
                SELECT
                    ap.id,
                    ap.tipo_atividade as tipo,
                    ap.nome_atividade as nome,
                    DATE(ap.hora_inicio) as data,
                    TIME_FORMAT(ap.hora_inicio, '%H:%i') as hora_inicio,
                    TIME_FORMAT(ap.hora_fim, '%H:%i') as hora_fim,
                    ap.duracao_segundos as duracao,
                    ap.pedido_id,
                    COALESCE(ped.numero, ap.pedido_id) as pedido_numero,
                    ap.produto_descricao,
                    ap.observacoes
                FROM apontamentos_producao ap
                LEFT JOIN pedidos ped ON ap.pedido_id = ped.id
                ${whereClause}
                ORDER BY ap.hora_inicio DESC
            `, params);
    
            res.json({ success: true, apontamentos });
        } catch (error) {
            console.error('[API_APONTAMENTOS] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao listar apontamentos' });
        }
    });

    // ==================== ROTAS DE RELATÓRIOS PCP ====================

    // 1. Cabos mais vendidos (ranking por quantidade e valor)
    router.get('/relatorios/cabos-mais-vendidos', async (req, res) => {
        try {
            const { data_inicio, data_fim, limit } = req.query;
            const maxResults = parseInt(limit) || 20;
            let whereClause = '';
            let params = [];

            if (data_inicio && data_fim) {
                whereClause = 'WHERE p.created_at BETWEEN ? AND ?';
                params = [data_inicio, data_fim];
            }

            const [porQuantidade] = await pool.query(`
                SELECT 
                    pi.codigo,
                    pi.descricao,
                    SUM(pi.quantidade) as total_quantidade,
                    pi.unidade,
                    SUM(pi.subtotal) as total_valor,
                    COUNT(DISTINCT pi.pedido_id) as total_pedidos,
                    AVG(pi.preco_unitario) as preco_medio
                FROM pedido_itens pi
                LEFT JOIN pedidos p ON pi.pedido_id = p.id
                ${whereClause}
                GROUP BY pi.codigo, pi.descricao, pi.unidade
                ORDER BY total_quantidade DESC
                LIMIT ?
            `, [...params, maxResults]);

            const [porValor] = await pool.query(`
                SELECT 
                    pi.codigo,
                    pi.descricao,
                    SUM(pi.quantidade) as total_quantidade,
                    pi.unidade,
                    SUM(pi.subtotal) as total_valor,
                    COUNT(DISTINCT pi.pedido_id) as total_pedidos,
                    AVG(pi.preco_unitario) as preco_medio
                FROM pedido_itens pi
                LEFT JOIN pedidos p ON pi.pedido_id = p.id
                ${whereClause}
                GROUP BY pi.codigo, pi.descricao, pi.unidade
                ORDER BY total_valor DESC
                LIMIT ?
            `, [...params, maxResults]);

            const [resumo] = await pool.query(`
                SELECT 
                    COUNT(DISTINCT pi.codigo) as total_produtos_vendidos,
                    SUM(pi.quantidade) as quantidade_total,
                    SUM(pi.subtotal) as valor_total,
                    COUNT(DISTINCT pi.pedido_id) as total_pedidos
                FROM pedido_itens pi
                LEFT JOIN pedidos p ON pi.pedido_id = p.id
                ${whereClause}
            `, params);

            let whereOP = '';
            let paramsOP = [];
            if (data_inicio && data_fim) {
                whereOP = 'WHERE data_inicio BETWEEN ? AND ?';
                paramsOP = [data_inicio, data_fim];
            }

            const [ordensProducao] = await pool.query(`
                SELECT 
                    produto_nome,
                    codigo,
                    SUM(quantidade) as total_quantidade,
                    SUM(metragem) as total_metragem,
                    COUNT(*) as total_ordens,
                    unidade
                FROM ordens_producao
                ${whereOP}
                GROUP BY produto_nome, codigo, unidade
                ORDER BY total_quantidade DESC
                LIMIT ?
            `, [...paramsOP, maxResults]);

            res.json({
                success: true,
                ranking_por_quantidade: porQuantidade,
                ranking_por_valor: porValor,
                ordens_producao: ordensProducao,
                resumo: resumo[0] || {},
                periodo: { data_inicio, data_fim }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro cabos mais vendidos:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de cabos mais vendidos.' });
        }
    });

    // 2. Ranking de vendas (por vendedor, cliente, produto)
    router.get('/relatorios/ranking-vendas', async (req, res) => {
        try {
            const { data_inicio, data_fim, agrupar } = req.query;
            let whereClause = '';
            let params = [];

            if (data_inicio && data_fim) {
                whereClause = 'WHERE p.created_at BETWEEN ? AND ?';
                params = [data_inicio, data_fim];
            }

            const [porVendedor] = await pool.query(`
                SELECT 
                    COALESCE(p.vendedor_nome, 'Não informado') as vendedor,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio,
                    COUNT(CASE WHEN p.status = 'faturado' THEN 1 END) as pedidos_faturados,
                    COUNT(CASE WHEN p.status = 'aprovado' THEN 1 END) as pedidos_aprovados
                FROM pedidos p
                ${whereClause}
                GROUP BY p.vendedor_nome
                ORDER BY valor_total DESC
                LIMIT 20
            `, params);

            const [porCliente] = await pool.query(`
                SELECT 
                    COALESCE(p.cliente_nome, 'Não informado') as cliente,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio,
                    MAX(p.created_at) as ultimo_pedido
                FROM pedidos p
                ${whereClause}
                GROUP BY p.cliente_nome
                ORDER BY valor_total DESC
                LIMIT 20
            `, params);

            const [totais] = await pool.query(`
                SELECT 
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio,
                    COUNT(DISTINCT p.vendedor_nome) as total_vendedores,
                    COUNT(DISTINCT p.cliente_nome) as total_clientes
                FROM pedidos p
                ${whereClause}
            `, params);

            const [evolucaoMensal] = await pool.query(`
                SELECT 
                    DATE_FORMAT(p.created_at, '%Y-%m') as mes,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total
                FROM pedidos p
                ${whereClause.length > 0 ? whereClause : 'WHERE p.created_at IS NOT NULL'}
                GROUP BY DATE_FORMAT(p.created_at, '%Y-%m')
                ORDER BY mes DESC
                LIMIT 12
            `, params);

            res.json({
                success: true,
                por_vendedor: porVendedor,
                por_cliente: porCliente,
                evolucao_mensal: evolucaoMensal.reverse(),
                totais: totais[0] || {},
                periodo: { data_inicio, data_fim }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro ranking vendas:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar ranking de vendas.' });
        }
    });

    // 3. Metros produzidos por dia
    router.get('/relatorios/metros-produzidos', async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;

            const fim = data_fim || new Date().toISOString().slice(0, 10);
            const inicio = data_inicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

            const [apontamentosDiarios] = await pool.query(`
                SELECT 
                    DATE(ap.data_apontamento) as data,
                    SUM(ap.quantidade_produzida) as quantidade_produzida,
                    SUM(ap.tempo_producao) as tempo_total_min,
                    COUNT(*) as total_apontamentos,
                    GROUP_CONCAT(DISTINCT ap.maquina SEPARATOR ', ') as maquinas,
                    GROUP_CONCAT(DISTINCT ap.operador SEPARATOR ', ') as operadores
                FROM apontamentos_producao ap
                WHERE ap.data_apontamento BETWEEN ? AND ?
                GROUP BY DATE(ap.data_apontamento)
                ORDER BY data ASC
            `, [inicio, fim]);

            const [ordensConcluidasDia] = await pool.query(`
                SELECT 
                    DATE(COALESCE(data_conclusao, data_inicio)) as data,
                    SUM(metragem) as total_metragem,
                    SUM(quantidade) as total_quantidade,
                    COUNT(*) as total_ordens,
                    GROUP_CONCAT(DISTINCT produto_nome SEPARATOR ', ') as produtos
                FROM ordens_producao 
                WHERE (data_conclusao BETWEEN ? AND ? OR data_inicio BETWEEN ? AND ?)
                GROUP BY DATE(COALESCE(data_conclusao, data_inicio))
                ORDER BY data ASC
            `, [inicio, fim, inicio, fim]);

            const [resumoApontamentos] = await pool.query(`
                SELECT 
                    SUM(quantidade_produzida) as total_produzido,
                    AVG(quantidade_produzida) as media_diaria,
                    MAX(quantidade_produzida) as max_dia,
                    MIN(quantidade_produzida) as min_dia,
                    SUM(tempo_producao) as tempo_total,
                    COUNT(DISTINCT DATE(data_apontamento)) as dias_com_producao
                FROM apontamentos_producao 
                WHERE data_apontamento BETWEEN ? AND ?
            `, [inicio, fim]);

            const [resumoOrdens] = await pool.query(`
                SELECT 
                    SUM(metragem) as total_metragem,
                    SUM(quantidade) as total_quantidade,
                    COUNT(*) as total_ordens,
                    COUNT(CASE WHEN status = 'concluida' THEN 1 END) as ordens_concluidas,
                    COUNT(CASE WHEN status = 'em_producao' THEN 1 END) as ordens_em_producao
                FROM ordens_producao
                WHERE data_inicio BETWEEN ? AND ? OR data_conclusao BETWEEN ? AND ?
            `, [inicio, fim, inicio, fim]);

            res.json({
                success: true,
                apontamentos_diarios: apontamentosDiarios,
                ordens_por_dia: ordensConcluidasDia,
                resumo_apontamentos: resumoApontamentos[0] || {},
                resumo_ordens: resumoOrdens[0] || {},
                periodo: { data_inicio: inicio, data_fim: fim }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro metros produzidos:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de metros produzidos.' });
        }
    });

    // 4. Faturamento mensal
    router.get('/relatorios/faturamento-mensal', async (req, res) => {
        try {
            const { ano } = req.query;
            const anoFiltro = parseInt(ano) || new Date().getFullYear();

            const [faturamentoPF] = await pool.query(`
                SELECT 
                    DATE_FORMAT(data_faturamento, '%Y-%m') as mes,
                    MONTH(data_faturamento) as mes_num,
                    COUNT(*) as total_pedidos,
                    SUM(total) as valor_total,
                    AVG(total) as ticket_medio
                FROM pedidos_faturados 
                WHERE YEAR(data_faturamento) = ?
                GROUP BY DATE_FORMAT(data_faturamento, '%Y-%m'), MONTH(data_faturamento)
                ORDER BY mes_num ASC
            `, [anoFiltro]);

            const [faturamentoPedidos] = await pool.query(`
                SELECT 
                    DATE_FORMAT(p.created_at, '%Y-%m') as mes,
                    MONTH(p.created_at) as mes_num,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio
                FROM pedidos p
                WHERE p.status IN ('faturado', 'entregue', 'convertido')
                AND YEAR(p.created_at) = ?
                GROUP BY DATE_FORMAT(p.created_at, '%Y-%m'), MONTH(p.created_at)
                ORDER BY mes_num ASC
            `, [anoFiltro]);

            const [faturamentoAnoAnterior] = await pool.query(`
                SELECT 
                    SUM(total) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos_faturados 
                WHERE YEAR(data_faturamento) = ?
            `, [anoFiltro - 1]);

            const [faturamentoAnoAtual] = await pool.query(`
                SELECT 
                    SUM(total) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos_faturados 
                WHERE YEAR(data_faturamento) = ?
            `, [anoFiltro]);

            const [topClientes] = await pool.query(`
                SELECT 
                    cliente,
                    COUNT(*) as total_pedidos,
                    SUM(total) as valor_total
                FROM pedidos_faturados 
                WHERE YEAR(data_faturamento) = ?
                GROUP BY cliente
                ORDER BY valor_total DESC
                LIMIT 10
            `, [anoFiltro]);

            const totalAtual = faturamentoAnoAtual[0]?.valor_total || 0;
            const totalAnterior = faturamentoAnoAnterior[0]?.valor_total || 0;
            const variacao = totalAnterior > 0 ? ((totalAtual - totalAnterior) / totalAnterior * 100).toFixed(2) : 0;

            res.json({
                success: true,
                faturamento_mensal: faturamentoPF,
                faturamento_pedidos: faturamentoPedidos,
                top_clientes: topClientes,
                resumo: {
                    ano: anoFiltro,
                    valor_total_ano: totalAtual,
                    total_pedidos_ano: faturamentoAnoAtual[0]?.total_pedidos || 0,
                    valor_ano_anterior: totalAnterior,
                    variacao_percentual: `${variacao}%`
                }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro faturamento mensal:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de faturamento mensal.' });
        }
    });

    // ============================================
    // ÁRVORE DE PRODUTO COM CUSTO — CUSTOS & PRECIFICAÇÃO
    // ============================================
    router.get('/arvore-produto', async (req, res) => {
        try {
            const path = require('path');
            const fs = require('fs');
            const dataPath = path.join(__dirname, '..', 'api', 'arvore-produto-data.json');
            
            if (!fs.existsSync(dataPath)) {
                return res.status(404).json({ success: false, message: 'Dados da árvore de produto não encontrados.' });
            }
            
            const rawData = fs.readFileSync(dataPath, 'utf-8');
            const data = JSON.parse(rawData);
            
            // Apply filters if provided
            const { categoria, search } = req.query;
            let products = data.products;
            
            if (categoria && categoria !== 'todos') {
                products = products.filter(p => p.categoria === categoria);
            }
            
            if (search) {
                const term = search.toLowerCase();
                products = products.filter(p => 
                    p.codigo.toLowerCase().includes(term) || 
                    p.descricao.toLowerCase().includes(term) ||
                    (p.cores || '').toLowerCase().includes(term)
                );
            }
            
            res.json({
                success: true,
                parametros: data.parametros,
                total: data.products.length,
                categorias: [...new Set(data.products.map(p => p.categoria))].sort(),
                products
            });
        } catch (err) {
            console.error('[PCP] Erro árvore de produto:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao carregar árvore de produto.' });
        }
    });

    // Salvar parâmetros de custo (preços kg, markup, despesas)
    router.put('/arvore-produto/parametros', async (req, res) => {
        try {
            const path = require('path');
            const fs = require('fs');
            const dataPath = path.join(__dirname, '..', 'api', 'arvore-produto-data.json');
            
            if (!fs.existsSync(dataPath)) {
                return res.status(404).json({ success: false, message: 'Arquivo de dados não encontrado.' });
            }

            const rawData = fs.readFileSync(dataPath, 'utf-8');
            const data = JSON.parse(rawData);
            
            const { precos_kg, markup_pct, despesas } = req.body;
            if (precos_kg) data.parametros.precos_kg = precos_kg;
            if (markup_pct !== undefined) data.parametros.markup_pct = parseFloat(markup_pct);
            if (despesas) data.parametros.despesas = despesas;
            // Novos campos de precificação por estado
            if (req.body.icms_estados) data.parametros.icms_estados = req.body.icms_estados;
            if (req.body.frete_opcoes) data.parametros.frete_opcoes = req.body.frete_opcoes;
            if (req.body.comissao_normal !== undefined) data.parametros.comissao_normal = parseFloat(req.body.comissao_normal);
            if (req.body.comissao_representante !== undefined) data.parametros.comissao_representante = parseFloat(req.body.comissao_representante);
            if (req.body.estado_selecionado !== undefined) data.parametros.estado_selecionado = req.body.estado_selecionado;
            if (req.body.tipo_cliente !== undefined) data.parametros.tipo_cliente = req.body.tipo_cliente;
            if (req.body.is_representante !== undefined) data.parametros.is_representante = req.body.is_representante;
            if (req.body.frete_selecionado !== undefined) data.parametros.frete_selecionado = req.body.frete_selecionado;
            
            fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
            console.log('[PCP] Parâmetros de custo atualizados com sucesso');
            
            res.json({ success: true, message: 'Parâmetros salvos com sucesso.', parametros: data.parametros });
        } catch (err) {
            console.error('[PCP] Erro ao salvar parâmetros:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao salvar parâmetros.' });
        }
    });

    return router;
};
