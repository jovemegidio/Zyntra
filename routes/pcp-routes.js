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
    const { pool, authenticateToken, authorizeArea, authorizeAdmin, writeAuditLog, cacheMiddleware, CACHE_CONFIG, jwt, JWT_SECRET, writeGuard } = deps;
    const router = express.Router();

    // --- Standard requires for extracted routes ---
    const { body, param, query, validationResult } = require('express-validator');
    const SAFE_MIMES = new Set(['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/csv','text/plain','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/xml','text/xml']);
    const safeFileFilter = (req, file, cb) => SAFE_MIMES.has(file.mimetype) ? cb(null, true) : cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    const upload = multer({ dest: path.join(__dirname, '..', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: safeFileFilter });
    const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

    // LGPD Crypto - descriptografia PII (pode não existir)
    let lgpdCrypto = null;
    try { lgpdCrypto = require('../lgpd-crypto'); } catch (_) {}

    const validate = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: 'Dados inválidos', errors: errors.array() });
        next();
    };

    // Registra baixa de materiais em estoque_movimentos ao concluir OP
    // Alimenta K235 (via itens_ordem_producao) e K270 (ajuste de inventário)
    async function registrarBaixaEstoqueOP(pool, opId, usuarioId) {
        const [itens] = await pool.query(
            `SELECT io.id, io.codigo_material, io.quantidade_utilizada, io.quantidade_necessaria,
                    p.id AS produto_id
             FROM itens_ordem_producao io
             LEFT JOIN produtos p ON p.codigo = io.codigo_material
             WHERE io.ordem_producao_id = ?`,
            [opId]
        );
        if (!itens.length) return;

        const now = new Date();
        const rows = itens
            .filter(i => i.produto_id)
            .map(i => [
                i.produto_id,
                'saida_producao',
                Math.abs(parseFloat(i.quantidade_utilizada || i.quantidade_necessaria) || 0),
                'ordem_producao',
                opId,
                `Baixa automática OP #${opId}`,
                usuarioId || null,
                now
            ]);

        if (!rows.length) return;

        await pool.query(
            `INSERT INTO estoque_movimentos
             (produto_id, tipo_movimento, quantidade, documento_tipo, documento_id, observacoes, usuario_id, data_movimento)
             VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?)').join(',')}`,
            rows.flat()
        );

        // Debitar saldo — ignora erros (pode não ter saldo cadastrado por codigo)
        for (const i of itens) {
            const qtd = parseFloat(i.quantidade_utilizada || i.quantidade_necessaria) || 0;
            if (qtd > 0) {
                await pool.query(
                    `UPDATE estoque_saldos SET quantidade_fisica = GREATEST(0, quantidade_fisica - ?)
                     WHERE codigo_material = ?`,
                    [qtd, i.codigo_material]
                ).catch(() => {});
            }
        }
    }

    router.use(authenticateToken);
    // PCP module serves Compras, Estoque and Produção
    // Accept users with 'pcp' OR 'compras' area permission (FIX 28/02/2026)
    router.use(async (req, res, next) => {
        if (req.path.startsWith('/api/configuracoes')) {
            return next(); // Configurações são globais, não restritas ao PCP
        }
        if (req.path.startsWith('/api/transportadoras')) {
            return next(); // Transportadoras são usadas por Vendas, Logística e PCP
        }
        // Árvore de produto (GET somente-leitura) é usada pelo módulo Vendas para parâmetros fiscais (DIFAL/ICMS-ST)
        if (req.path === '/arvore-produto' && req.method === 'GET') {
            return next();
        }
        // Helper: tenta autorizar por uma área sem enviar resposta de erro
        const tryAuth = (area) => new Promise((resolve) => {
            const fakeRes = {
                status: () => ({ json: () => resolve(false) })
            };
            authorizeArea(area)(req, fakeRes, () => resolve(true)).catch(() => resolve(false));
        });

        if (await tryAuth('pcp') || await tryAuth('compras')) {
            return next();
        }

        return res.status(403).json({
            message: 'Acesso negado. Você não tem permissão para acessar este módulo (PCP/Compras).'
        });
    });
    // AUDIT-FIX PERM-004: Block mutations for consultoria/restricted roles
    router.use(writeGuard || ((req, res, next) => next()));
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

    const getTableColumnsSet = async (tableName) => {
        const [columns] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        `, [tableName]);
        return new Set(columns.map(col => col.COLUMN_NAME));
    };

    function parseOrdemProducaoItems(body) {
        if (Array.isArray(body.produtos)) return body.produtos;
        if (Array.isArray(body.items)) return body.items;
        if (body.items_json) {
            try {
                const parsed = typeof body.items_json === 'string' ? JSON.parse(body.items_json) : body.items_json;
                if (Array.isArray(parsed)) return parsed;
            } catch (_) {}
        }
        if (body.codigo_produto || body.descricao_produto || body.produto_nome) {
            return [{
                codigo: body.codigo_produto || body.codigo || '',
                descricao: body.descricao_produto || body.produto_nome || body.produto || '',
                quantidade: body.quantidade || 0,
                valor_unitario: body.valor_unitario || body.preco_unitario || 0,
                unidade: body.unidade || 'UN'
            }];
        }
        return [];
    }

    function normalizarDadosOrdemProducao(body) {
        const dados = Object.assign({}, body || {});
        const transportadora = dados.transportadora && typeof dados.transportadora === 'object'
            ? dados.transportadora
            : {};

        dados.transportadora_nome = dados.transportadora_nome || transportadora.nome || '';
        dados.transportadora_fone = dados.transportadora_fone || dados.transportadora_telefone || transportadora.fone || '';
        dados.transportadora_cep = dados.transportadora_cep || transportadora.cep || '';
        dados.transportadora_endereco = dados.transportadora_endereco || transportadora.endereco || '';
        dados.transportadora_cpf_cnpj = dados.transportadora_cpf_cnpj || transportadora.cpf_cnpj || '';
        dados.transportadora_email_nfe = dados.transportadora_email_nfe || transportadora.email_nfe || '';
        dados.numero_pedido = dados.numero_pedido || dados.num_pedido || dados.pedido_referencia || '';
        dados.prazo_entrega = dados.prazo_entrega || dados.data_previsao_entrega || null;
        dados.tipo_frete = dados.tipo_frete || dados.frete || '';
        dados.produtos = parseOrdemProducaoItems(dados).map(item => ({
            ...item,
            quantidade: parseFloat(item.quantidade) || 0,
            valor_unitario: parseFloat(item.valor_unitario || item.preco_unitario || item.preco) || 0,
            unidade: item.unidade || item.unidade_medida || 'UN'
        }));
        return dados;
    }

    async function persistirOrdemProducaoGerada(dados, usuario, arquivoXlsx) {
        const columns = await getTableColumnsSet('ordens_producao');
        const insertColumns = [];
        const values = [];
        const used = new Set();
        const add = (column, value) => {
            if (!columns.has(column) || used.has(column)) return;
            insertColumns.push(`\`${column}\``);
            values.push(value === undefined ? null : value);
            used.add(column);
        };

        const itens = dados.produtos || [];
        const primeiroItem = itens[0] || {};
        const quantidadeTotal = parseFloat(dados.quantidade_total)
            || itens.reduce((sum, item) => sum + (parseFloat(item.quantidade) || 0), 0);
        const valorTotal = parseFloat(dados.valor_total)
            || itens.reduce((sum, item) => {
                const qtd = parseFloat(item.quantidade) || 0;
                const unit = parseFloat(item.valor_unitario || item.preco_unitario || item.preco) || 0;
                return sum + (parseFloat(item.total) || qtd * unit);
            }, 0);
        const numeroOrdem = dados.numero_ordem || dados.codigo || `OP-${Date.now()}`;
        const numeroPedido = dados.numero_pedido || dados.pedido_referencia || dados.num_pedido || null;
        const pedidoId = dados.pedido_id || dados.pedido_vinculado_id || null;
        const produtosJson = JSON.stringify(itens);

        add('codigo', numeroOrdem);
        add('numero_ordem', numeroOrdem);
        add('codigo_produto', primeiroItem.codigo || dados.codigo_produto || dados.codigo || null);
        add('descricao_produto', primeiroItem.descricao || primeiroItem.nome || dados.descricao_produto || dados.produto_nome || null);
        add('produto_nome', primeiroItem.descricao || primeiroItem.nome || dados.produto || dados.produto_nome || dados.cliente || null);
        add('quantidade', quantidadeTotal || 0);
        add('unidade', primeiroItem.unidade || dados.unidade || 'UN');
        add('status', dados.status || 'pendente');
        add('prioridade', dados.prioridade || 'media');
        add('progresso', 0);
        add('quantidade_produzida', 0);
        add('pedido_id', pedidoId);
        add('pedido_vinculado_id', pedidoId);
        add('numero_pedido', numeroPedido);
        add('num_pedido', numeroPedido);
        add('pedido_referencia', dados.pedido_referencia || numeroPedido);
        add('numero_orcamento', dados.numero_orcamento || dados.num_orcamento || dados['num_orçamento'] || null);
        add('revisao', dados.revisao || '00');
        add('data_liberacao', dados.data_liberacao || null);
        add('data_previsao_entrega', dados.data_previsao_entrega || null);
        add('data_prevista', dados.data_previsao_entrega || dados.prazo_entrega || null);
        add('cliente_id', dados.cliente_id || null);
        add('cliente', dados.cliente || dados.cliente_nome || null);
        add('cliente_nome', dados.cliente || dados.cliente_nome || null);
        add('contato', dados.contato || dados.contato_cliente || null);
        add('cliente_contato', dados.contato || dados.contato_cliente || null);
        add('telefone', dados.telefone || dados.fone_cliente || null);
        add('cliente_telefone', dados.telefone || dados.fone_cliente || null);
        add('email', dados.email || dados.email_cliente || null);
        add('cliente_email', dados.email || dados.email_cliente || null);
        add('vendedor', dados.vendedor || dados.vendedor_nome || null);
        add('vendedor_nome', dados.vendedor || dados.vendedor_nome || null);
        add('frete', dados.frete || dados.tipo_frete || null);
        add('tipo_frete', dados.tipo_frete || dados.frete || null);
        add('condicoes_pagamento', dados.condicoes_pagamento || null);
        add('forma_pagamento', dados.forma_pagamento || null);
        add('metodo_pagamento', dados.metodo_pagamento || null);
        add('valor_total', valorTotal || 0);
        add('total_geral', valorTotal || 0);
        add('quantidade_produtos', itens.length);
        add('transportadora_nome', dados.transportadora_nome || null);
        add('transportadora_fone', dados.transportadora_fone || null);
        add('transportadora_telefone', dados.transportadora_fone || dados.transportadora_telefone || null);
        add('transportadora_cep', dados.transportadora_cep || null);
        add('transportadora_endereco', dados.transportadora_endereco || null);
        add('transportadora_cpf_cnpj', dados.transportadora_cpf_cnpj || null);
        add('transportadora_email_nfe', dados.transportadora_email_nfe || null);
        add('observacoes', dados.observacoes || null);
        add('observacoes_pedido', dados.observacoes_pedido || null);
        add('produtos', produtosJson);
        add('produtos_json', produtosJson);
        add('arquivo_xlsx', arquivoXlsx || null);
        add('caminho_arquivo', null);
        add('criado_por', usuario?.id || null);
        add('created_by', usuario?.id || null);
        add('created_by_name', usuario?.nome || usuario?.name || usuario?.email || null);

        if (!insertColumns.length) {
            throw new Error('Schema de ordens_producao sem colunas compatíveis para gravação');
        }

        const placeholders = insertColumns.map(() => '?').join(', ');
        const [result] = await pool.query(
            `INSERT INTO ordens_producao (${insertColumns.join(', ')}) VALUES (${placeholders})`,
            values
        );
        return result.insertId;
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

            // Produtos COM estoque (estoque_atual > 0, com fallback para quantidade_estoque)
            // Exclui categoria 'GERAL' (suprimentos, limpeza, escritório) — não são itens de produção PCP
            const [[produtosComEstoqueResult]] = await pool.query(
                `SELECT COUNT(*) as total FROM produtos
                 WHERE COALESCE(estoque_atual, quantidade_estoque, 0) > 0
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
            let produtosCriticos = [];
            try {
                [produtosCriticos] = await pool.query(`
                    SELECT codigo, nome,
                        COALESCE(estoque_atual, quantidade_estoque, 0) as estoque_atual,
                        COALESCE(estoque_minimo, 0) as estoque_minimo,
                        COALESCE(unidade_medida, unidade, 'UN') as unidade, categoria
                    FROM produtos
                    WHERE COALESCE(estoque_atual, quantidade_estoque, 0) <= 0
                    AND (ativo = 1 OR ativo IS NULL OR status = 'ativo')
                    AND (categoria IS NULL OR categoria != 'GERAL')
                    ORDER BY nome ASC
                    LIMIT 50
                `);
            } catch (e) { console.log('[PCP/ALERTAS] Query produtos críticos falhou:', e.message); }

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
            let produtosBaixo = [];
            try {
                [produtosBaixo] = await pool.query(`
                    SELECT codigo, nome,
                        COALESCE(estoque_atual, quantidade_estoque, 0) as estoque_atual,
                        COALESCE(estoque_minimo, 0) as estoque_minimo,
                        COALESCE(unidade_medida, unidade, 'UN') as unidade, categoria
                    FROM produtos
                    WHERE COALESCE(estoque_atual, quantidade_estoque, 0) > 0
                    AND COALESCE(estoque_atual, quantidade_estoque, 0) < COALESCE(estoque_minimo, 10)
                    AND COALESCE(estoque_minimo, 10) > 0
                    AND (ativo = 1 OR ativo IS NULL OR status = 'ativo')
                    AND (categoria IS NULL OR categoria != 'GERAL')
                    ORDER BY estoque_atual ASC
                    LIMIT 50
                `);
            } catch (e) { console.log('[PCP/ALERTAS] Query produtos baixo falhou:', e.message); }

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
            let ordensAtraso = [];
            try {
                [ordensAtraso] = await pool.query(`
                    SELECT id, codigo, produto_nome, data_previsao_entrega, status, cliente
                    FROM ordens_producao
                    WHERE data_previsao_entrega < CURDATE()
                    AND status NOT IN ('concluida', 'Concluída', 'cancelada', 'Cancelada', 'entregue', 'finalizada')
                    ORDER BY data_previsao_entrega ASC
                    LIMIT 20
                `);
            } catch (e) { console.log('[PCP/ALERTAS] Query ordens atraso falhou:', e.message); }

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
            let ordensPendentes = [];
            try {
                [ordensPendentes] = await pool.query(`
                    SELECT id, codigo, produto_nome, created_at, status, cliente
                    FROM ordens_producao
                    WHERE status IN ('pendente', 'a_produzir', 'A Fazer')
                    AND created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                    ORDER BY created_at ASC
                    LIMIT 20
                `);
            } catch (e) { console.log('[PCP/ALERTAS] Query ordens pendentes falhou:', e.message); }

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
                error: 'Erro interno no servidor. Tente novamente.',
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
            const [rows] = await pool.query('SELECT id, codigo, produto_nome, quantidade, status, data_previsao_entrega, numero_pedido, cliente, observacoes, time_producao, created_at, updated_at FROM ordens_producao ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.post('/ordens', [
        body('codigo').trim().notEmpty().withMessage('Código do produto é obrigatório')
            .isLength({ max: 50 }).withMessage('Código muito longo (máx 50 caracteres)'),
        body('produto_nome').trim().notEmpty().withMessage('Nome do produto é obrigatório')
            .isLength({ max: 255 }).withMessage('Nome muito longo (máx 255 caracteres)'),
        body('quantidade').isFloat({ min: 0.01 }).withMessage('Quantidade deve ser um número positivo'),
        body('data_previsao_entrega').optional({ nullable: true, checkFalsy: true }).isDate().withMessage('Data de previsão inválida'),
        body('observacoes').optional().trim().isLength({ max: 1000 }).withMessage('Observações muito longas (máx 1000 caracteres)'),
        validate
    ], async (req, res, next) => {
        try {
            const { codigo, produto_nome, quantidade, observacoes } = req.body;
            const data_previsao_entrega = req.body.data_previsao_entrega || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const sql = 'INSERT INTO ordens_producao (codigo, produto_nome, quantidade, data_previsao_entrega, observacoes, status) VALUES (?, ?, ?, ?, ?, \'pendente\')';
            const [result] = await pool.query(sql, [codigo, produto_nome, quantidade, data_previsao_entrega, observacoes]);
            res.status(201).json({ message: 'Ordem criada com sucesso!', id: result.insertId });
        } catch (error) { next(error); }
    });
    router.put('/ordens/:id/status', [
        param('id').isInt({ min: 1 }).withMessage('ID da ordem inválido'),
        body('status').isIn(['ativa', 'em_producao', 'pendente', 'concluida', 'cancelada'])
            .withMessage('Status inválido. Use: ativa, em_producao, pendente, concluida ou cancelada'),
        validate
    ], async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const updates = ['status = ?'];
            const values = [status];
            if (status === 'concluida') {
                updates.push('data_conclusao = NOW()');
            }
            updates.push('updated_at = NOW()');
            values.push(id);
            const [result] = await pool.query(
                `UPDATE ordens_producao SET ${updates.join(', ')} WHERE id = ?`,
                values
            );
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Ordem não encontrada.' });
            }
            if (status === 'concluida') {
                // Pipeline: OP concluída → pedido para "faturar"
                const pipeConn = await pool.getConnection();
                try {
                    await pipeConn.beginTransaction();
                    const [opData] = await pipeConn.query(
                        'SELECT COALESCE(pedido_vinculado_id, pedido_id) AS pedido_id FROM ordens_producao WHERE id = ?', [id]
                    );
                    if (opData.length > 0 && opData[0].pedido_id) {
                        const pedidoId = opData[0].pedido_id;
                        const [pedido] = await pipeConn.query(
                            'SELECT status FROM pedidos WHERE id = ? FOR UPDATE', [pedidoId]
                        );
                        if (pedido.length > 0 && pedido[0].status === 'pedido-aprovado') {
                            await pipeConn.query(
                                'UPDATE pedidos SET status = "faturar", updated_at = NOW() WHERE id = ?',
                                [pedidoId]
                            );
                            console.log(`[PIPELINE_AUTO] Pedido #${pedidoId} movido para "faturar" (OP #${id} concluída via PUT status)`);
                        }
                    }
                    await pipeConn.commit();
                } catch (pipeErr) {
                    await pipeConn.rollback();
                    console.error(`[PIPELINE_AUTO] Erro ao atualizar pedido após conclusão OP #${id}:`, pipeErr.message);
                } finally {
                    pipeConn.release();
                }
                // K235: registra baixa de materiais em estoque_movimentos
                registrarBaixaEstoqueOP(pool, id, req.user?.id).catch(e =>
                    console.error(`[BLOCO_K] Erro ao registrar baixa OP #${id}:`, e.message)
                );
            }
            res.json({ message: 'Status atualizado com sucesso!' });
        } catch (error) { next(error); }
    });

    // MATERIAIS (com fallback para tabela produtos se materiais não existir)
    router.get('/materiais', async (req, res, next) => {
        try {
            const limit = parseInt(req.query.limit) || 1000;
            const offset = parseInt(req.query.offset) || 0;

            // Detectar qual tabela existe
            let tabela = 'materiais';
            let colunas = 'id, codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao, tipo, custo_unitario, ncm, gtin, ativo';
            try {
                await pool.query("SELECT 1 FROM materiais LIMIT 1");
            } catch (e) {
                // Tabela materiais não existe — usar produtos
                tabela = 'produtos';
                colunas = '*';
            }

            const [rows] = await pool.query(`SELECT ${colunas} FROM ${tabela} ORDER BY descricao ASC LIMIT ? OFFSET ?`, [limit, offset]);
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

    // ORDENS DE COMPRA - Buscar por ID
    router.get('/ordens-compra/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(
                `SELECT oc.*, m.codigo_material, m.descricao AS material_nome
                 FROM ordens_compra oc
                 LEFT JOIN materiais m ON oc.material_id = m.id
                 WHERE oc.id = ?`,
                [id]
            );
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Ordem de compra não encontrada' });
            }
            res.json(rows[0]);
        } catch (error) { next(error); }
    });

    // ORDENS DE COMPRA - Atualizar
    router.put('/ordens-compra/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { fornecedor, status, previsao_entrega, observacoes, quantidade, material_id, valor_total } = req.body;

            const fields = [];
            const params = [];

            if (fornecedor !== undefined) { fields.push('fornecedor = ?'); params.push(fornecedor); }
            if (status !== undefined) { fields.push('status = ?'); params.push(status); }
            if (previsao_entrega !== undefined) { fields.push('previsao_entrega = ?'); params.push(previsao_entrega); }
            if (observacoes !== undefined) { fields.push('observacoes = ?'); params.push(observacoes); }
            if (quantidade !== undefined) { fields.push('quantidade = ?'); params.push(quantidade); }
            if (material_id !== undefined) { fields.push('material_id = ?'); params.push(material_id); }
            if (valor_total !== undefined) { fields.push('valor_total = ?'); params.push(valor_total); }

            if (fields.length === 0) {
                return res.status(400).json({ message: 'Nenhum campo para atualizar' });
            }

            params.push(id);
            const [result] = await pool.query(
                `UPDATE ordens_compra SET ${fields.join(', ')} WHERE id = ?`,
                params
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Ordem de compra não encontrada' });
            }

            res.json({ success: true, message: 'Ordem de compra atualizada com sucesso' });
        } catch (error) { next(error); }
    });

    // ORDENS DE COMPRA - Deletar
    router.delete('/ordens-compra/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [result] = await pool.query('DELETE FROM ordens_compra WHERE id = ?', [id]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Ordem de compra não encontrada' });
            }

            res.json({ success: true, message: 'Ordem de compra excluída com sucesso' });
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

    // Alias: /produtos/autocomplete → mesma lógica de /produtos/search (__FIX_AUTOCOMPLETE_ALIAS__)
    router.get('/produtos/autocomplete', async (req, res, next) => {
        try {
            const query = req.query.q || req.query.termo || req.query.search || '';
            const limit = parseInt(req.query.limit) || 15;
            if (!query) {
                const [rows] = await pool.query('SELECT id, codigo, nome, descricao, sku, unidade_medida as unidade, preco_venda, estoque_atual, quantidade_estoque, estoque_minimo, categoria, status FROM produtos WHERE status = "ativo" LIMIT ?', [limit]);
                return res.json(rows);
            }
            const sp = '%' + query + '%';
            const [rows] = await pool.query(
                'SELECT id, codigo, nome, descricao, sku, unidade_medida as unidade, preco_venda, estoque_atual, quantidade_estoque, estoque_minimo, categoria, status FROM produtos WHERE status = "ativo" AND (codigo LIKE ? OR nome LIKE ? OR sku LIKE ?) ORDER BY CASE WHEN codigo = ? THEN 1 WHEN codigo LIKE ? THEN 2 WHEN nome LIKE ? THEN 3 ELSE 4 END LIMIT ?',
                [sp, sp, sp, query, query + '%', query + '%', limit]
            );
            res.json(rows);
        } catch (error) { next(error); }
    });

    // PRODUTOS - Buscar produto por ID (regex \\d+ garante que só números são capturados)
    router.get('/produtos/:id(\\d+)', async (req, res, next) => {
        try {
            const { id } = req.params;
            // Usar SELECT * para evitar ER_BAD_FIELD_ERROR em colunas que podem não existir
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
        const connection = await pool.getConnection();
        try {
            const {
                cliente, produto, codigo, quantidade, unidade,
                data_previsao_entrega, vendedor, observacoes, observacoes_pedido, prioridade,
                numero_orcamento, tipo_frete, prazo_entrega,
                pedido_id, // Sprint 2 (P-01): vínculo real pedido→OP
                produtos // Array de produtos do modal
            } = req.body;

            await connection.beginTransaction();

            // Sprint 2 (P-02): Validar status do pedido antes de gerar OP
            let pedidoVinculado = null;
            if (pedido_id) {
                const [pedidoRows] = await connection.query(
                    'SELECT id, status, cliente_nome, valor FROM pedidos WHERE id = ? FOR UPDATE', [pedido_id]
                );
                if (pedidoRows.length === 0) {
                    await connection.rollback();
                    return res.status(404).json({ message: `Pedido #${pedido_id} não encontrado.` });
                }
                pedidoVinculado = pedidoRows[0];
                const statusPermitidos = ['pedido-aprovado', 'faturar', 'aprovado'];
                if (!statusPermitidos.includes(pedidoVinculado.status)) {
                    await connection.rollback();
                    return res.status(400).json({
                        message: `Pedido #${pedido_id} está no status "${pedidoVinculado.status}". OP só pode ser gerada para pedidos com status: ${statusPermitidos.join(', ')}.`,
                        status_atual: pedidoVinculado.status,
                        status_permitidos: statusPermitidos
                    });
                }
                // Verificar se já existe OP para este pedido
                const [opExistente] = await connection.query(
                    'SELECT id, codigo FROM ordens_producao WHERE pedido_id = ? AND status NOT IN ("cancelada") LIMIT 1', [pedido_id]
                );
                if (opExistente.length > 0) {
                    await connection.rollback();
                    return res.status(409).json({
                        message: `Já existe uma OP ativa (${opExistente[0].codigo}) para o pedido #${pedido_id}.`,
                        op_existente: opExistente[0]
                    });
                }
            }

            // Gerar código da ordem (com FOR UPDATE para evitar race condition P-04)
            const [ultimaOrdem] = await connection.query(`
                SELECT codigo FROM ordens_producao
                WHERE codigo LIKE 'OP N° %'
                ORDER BY id DESC LIMIT 1
                FOR UPDATE
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

            const [result] = await connection.query(`
                INSERT INTO ordens_producao (
                    codigo, produto_nome, quantidade, unidade,
                    status, prioridade, data_prevista, responsavel, observacoes,
                    progresso, quantidade_produzida, pedido_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'ativa', ?, ?, ?, ?, 0, 0, ?, NOW(), NOW())
            `, [
                codigoOrdem,
                `${nomeProduto}${codigoProduto ? ' - ' + codigoProduto : ''}`,
                qtd,
                und,
                prioridade || 'media',
                data_previsao_entrega || null,
                vendedor || null,
                obs,
                pedido_id || null
            ]);

            // Sprint 2 (P-01): Marcar pedido com produção iniciada
            if (pedido_id) {
                try {
                    await connection.query(
                        'UPDATE pedidos SET producao_iniciada = 1 WHERE id = ?', [pedido_id]
                    );
                } catch (colErr) {
                    // Coluna producao_iniciada pode não existir — ignorar silenciosamente
                    console.warn('⚠️ Não foi possível marcar producao_iniciada no pedido:', colErr.message);
                }
            }

            await connection.commit();

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
                prioridade: prioridade || 'media',
                pedido_id: pedido_id || null
            };

            console.log('✅ Ordem de produção criada:', codigoOrdem, pedido_id ? `(Pedido #${pedido_id})` : '');
            res.status(201).json(novaOrdem);
        } catch (error) {
            await connection.rollback();
            console.error('❌ Erro ao criar ordem Kanban:', error);
            next(error);
        } finally {
            connection.release();
        }
    });

    // PUT - Atualizar ordem de produção (Kanban)
    router.put('/ordens-kanban/:id', async (req, res) => {
        const { id } = req.params;
        const { status, statusKanban, produzido, quantidade_produzida, progresso, observacoes } = req.body;

        console.log(`[API_PCP] Atualizando ordem de produção ${id}...`);

        try {
            // Sprint 4.4: Usar mapKanbanToStatus centralizado (aceita kanban e DB status)
            const rawStatus = status || statusKanban;
            let dbStatus = rawStatus ? mapKanbanToStatus(rawStatus) : null;

            const updates = [];
            const values = [];

            if (dbStatus) {
                updates.push('status = ?');
                values.push(dbStatus);
                // Se concluída, registrar data
                if (dbStatus === 'concluida') {
                    updates.push('data_conclusao = NOW()');
                }
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

                if (dbStatus === 'concluida') {
                    // Pipeline: OP concluída → pedido para "faturar"
                    const pipeConn = await pool.getConnection();
                    try {
                        await pipeConn.beginTransaction();
                        const [opData] = await pipeConn.query('SELECT COALESCE(pedido_vinculado_id, pedido_id) AS pedido_id FROM ordens_producao WHERE id = ?', [id]);
                        if (opData.length > 0 && opData[0].pedido_id) {
                            const pedidoId = opData[0].pedido_id;
                            const [pedido] = await pipeConn.query('SELECT status FROM pedidos WHERE id = ? FOR UPDATE', [pedidoId]);
                            if (pedido.length > 0 && pedido[0].status === 'pedido-aprovado') {
                                await pipeConn.query('UPDATE pedidos SET status = "faturar", updated_at = NOW() WHERE id = ?', [pedidoId]);
                                console.log(`[PIPELINE_AUTO] Pedido #${pedidoId} movido para "faturar" (OP #${id} concluída)`);
                            }
                        }
                        await pipeConn.commit();
                    } catch (pipeErr) {
                        await pipeConn.rollback();
                        console.error(`[PIPELINE_AUTO] Erro ao atualizar pedido após conclusão OP #${id}:`, pipeErr.message);
                    } finally {
                        pipeConn.release();
                    }

                    // BLOCO K: registra baixa de materiais em estoque_movimentos (K235/K270)
                    registrarBaixaEstoqueOP(pool, id, req.user?.id).catch(e =>
                        console.error(`[BLOCO_K] Erro ao registrar baixa OP #${id}:`, e.message)
                    );
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

            if (status) {
                const statusDBPatch = mapKanbanToStatus(status);
                if (statusDBPatch === 'concluida') {
                    const pipeConn = await pool.getConnection();
                    try {
                        await pipeConn.beginTransaction();
                        const [opDataPatch] = await pipeConn.query('SELECT COALESCE(pedido_vinculado_id, pedido_id) AS pedido_id FROM ordens_producao WHERE id = ?', [id]);
                        if (opDataPatch.length > 0 && opDataPatch[0].pedido_id) {
                            const pedidoIdPatch = opDataPatch[0].pedido_id;
                            const [pedidoPatch] = await pipeConn.query('SELECT status FROM pedidos WHERE id = ? FOR UPDATE', [pedidoIdPatch]);
                            if (pedidoPatch.length > 0 && pedidoPatch[0].status === 'pedido-aprovado') {
                                await pipeConn.query('UPDATE pedidos SET status = "faturar", updated_at = NOW() WHERE id = ?', [pedidoIdPatch]);
                                console.log(`[PIPELINE_AUTO] Pedido #${pedidoIdPatch} movido para "faturar" (OP #${id} concluída via PATCH)`);
                            }
                        }
                        await pipeConn.commit();
                    } catch (pipeErr) {
                        await pipeConn.rollback();
                        console.error(`[PIPELINE_AUTO] Erro ao atualizar pedido após conclusão OP #${id}:`, pipeErr.message);
                    } finally {
                        pipeConn.release();
                    }

                    // BLOCO K: registra baixa de materiais em estoque_movimentos (K235/K270)
                    registrarBaixaEstoqueOP(pool, id, req.user?.id).catch(e =>
                        console.error(`[BLOCO_K] Erro ao registrar baixa OP #${id}:`, e.message)
                    );
                }
            }

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
            // Kanban → DB
            'a_produzir': 'ativa',
            'produzindo': 'em_producao',
            'qualidade': 'pendente',
            'conferido': 'pendente',
            'concluido': 'concluida',
            'armazenado': 'concluida',
            'cancelado': 'cancelada',
            // Identity (já é DB status)
            'ativa': 'ativa',
            'em_producao': 'em_producao',
            'pendente': 'pendente',
            'concluida': 'concluida',
            'cancelada': 'cancelada'
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

    router.post(['/ordens-producao', '/gerar-ordem-excel'], async (req, res, next) => {
        try {
            const dadosOrdem = normalizarDadosOrdemProducao(req.body);

            if (!dadosOrdem.cliente && !dadosOrdem.cliente_nome) {
                return res.status(400).json({ message: 'Cliente é obrigatório para gerar a ordem de produção.' });
            }

            if (!dadosOrdem.produtos.length) {
                return res.status(400).json({ message: 'Informe ao menos um item para gerar a ordem de produção.' });
            }

            if (dadosOrdem.transportadora_email_nfe && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dadosOrdem.transportadora_email_nfe)) {
                return res.status(400).json({ message: 'E-mail NFe da transportadora inválido.' });
            }

            if (dadosOrdem.transportadora_cpf_cnpj) {
                const doc = String(dadosOrdem.transportadora_cpf_cnpj).replace(/\D/g, '');
                if (doc && !(doc.length === 11 || doc.length === 14)) {
                    return res.status(400).json({ message: 'CPF/CNPJ da transportadora inválido.' });
                }
            }

            const ExcelJS = require('exceljs');
            const templatePath = path.join(__dirname, '..', 'modules', 'PCP', 'Ordem de Produção.xlsx');
            const nomeCliente = (dadosOrdem.cliente || dadosOrdem.cliente_nome || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
            const nomeArquivo = `Ordem de Produção - ${nomeCliente || 'Cliente'} - ERP.xlsx`;
            let fileBuffer;
            let contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            let downloadName = nomeArquivo;

            try {
                if (!fs.existsSync(templatePath)) throw new Error(`Template não encontrado: ${templatePath}`);
                fileBuffer = await gerarExcelOrdemProducaoCompleta(dadosOrdem, ExcelJS, templatePath);
            } catch (excelError) {
                console.warn('[PCP/OP] Fallback CSV após falha ao gerar XLSX:', excelError.message);
                fileBuffer = await gerarExcelOrdemProducaoFallback(dadosOrdem);
                contentType = 'text/csv; charset=utf-8';
                downloadName = nomeArquivo.replace(/\.xlsx$/i, '.csv');
            }

            const ordemId = await persistirOrdemProducaoGerada(dadosOrdem, req.user, downloadName);
            res.setHeader('X-Ordem-Producao-Id', String(ordemId));
            const encodedFilename = encodeURIComponent(downloadName).replace(/'/g, '%27');
            const asciiFilename = downloadName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
            const buffer = Buffer.from(fileBuffer);

            res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', buffer.length);
            res.send(buffer);
        } catch (error) {
            console.error('[PCP/OP] Erro ao gerar/persistir ordem de produção:', error);
            next(error);
        }
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
            version: (() => { try { return require('../package.json').version; } catch(e) { return '2.0.0'; } })(),
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
                name: 'Zyntra v2.0',
                version: (() => { try { return require('../package.json').version; } catch(e) { return '2.0.0'; } })(),
                environment: process.env.NODE_ENV || 'development'
            },
            database: {
                status: DB_AVAILABLE ? 'connected' : 'disconnected',
                pool_connections: DB_AVAILABLE ? 'active' : 'inactive'
            }
        };

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(`# Zyntra v2.0 Metrics
    aluforce_uptime_seconds ${metrics.process.uptime}
    aluforce_memory_used_bytes ${metrics.process.memory.heapUsed}
    aluforce_memory_total_bytes ${metrics.process.memory.heapTotal}
    aluforce_database_connected ${DB_AVAILABLE ? 1 : 0}
    aluforce_app_version_info{version="${metrics.application.version}",environment="${metrics.application.environment}"} 1
    `);
    });

    // [REFACTORED] Editor de Templates (CRUD, export/import, customizacao)
    require('./pcp/templates-routes')(router, deps);

    // [REFACTORED] Gestao de Clientes (CRUD, autocomplete, historico)
    require('./pcp/clientes-routes')(router, deps);

    // API para listar usuários (para avatar no login do PCP)
    // SECURITY: Requer autenticação
    router.get('/users-list', authenticateToken, async (req, res) => {
        try {
            // Buscar usuários de funcionários para exibir avatar no login
            const [users] = await pool.query(`
                SELECT id, nome_completo as nome, email, departamento as role, foto_perfil_url, foto_thumb_url
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
                let fotoUrl = user.foto_perfil_url || user.foto_thumb_url || avatarMap[firstName] || '/avatars/default.webp';

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

    // [REMOVIDA] Rota /dashboard duplicada com queries hardcoded para 'Aluforce'.
    // A rota principal /dashboard (linha ~138) é genérica e funciona para todas as empresas.

    // [REFACTORED] Diario de Producao (registro diario, CRUD)
    require('./pcp/diario-producao-routes')(router, deps);

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
                error: 'Erro interno no servidor. Tente novamente.'
            });
        }
    });

    // POST /estoque/movimentacao - Registrar entrada, saída ou ajuste de estoque
    // Suporta produto_id (produtos) e material_id (materiais)
    // SECURITY: Requer autenticação. Isolamento por banco de dados (pool tenant-specific)
    router.post('/estoque/movimentacao', authenticateToken, async (req, res) => {
        const { material_id, produto_id, tipo, quantidade, observacoes, observacao, local, documento } = req.body;
        const itemId = material_id || produto_id;
        if (!itemId) return res.status(400).json({ success: false, message: 'Informe produto_id ou material_id' });
        if (!quantidade || isNaN(parseFloat(quantidade))) return res.status(400).json({ success: false, message: 'Quantidade inválida' });

        const tabela = material_id ? 'materiais' : 'produtos';
        const coluna = material_id ? 'quantidade_estoque' : 'estoque_atual';
        const obs = observacoes || observacao || '';
        const tipoNorm = (tipo || 'ENTRADA').toUpperCase();
        if (!['ENTRADA', 'SAIDA', 'AJUSTE'].includes(tipoNorm)) {
            return res.status(400).json({ success: false, message: 'Tipo inválido. Use ENTRADA, SAIDA ou AJUSTE' });
        }

        try {
            const colunaSelect = tabela === 'produtos'
                ? 'COALESCE(estoque_atual, 0) as quantidade, nome, codigo'
                : 'quantidade_estoque as quantidade, descricao as nome, codigo_material as codigo';
            const [[item]] = await pool.query(`SELECT ${colunaSelect} FROM ${tabela} WHERE id = ?`, [itemId]);
            if (!item) return res.status(404).json({ success: false, message: `${tabela === 'materiais' ? 'Material' : 'Produto'} não encontrado` });

            const quantidadeAnterior = parseFloat(item.quantidade) || 0;
            let novaQuantidade;
            const qtd = parseFloat(quantidade);
            switch (tipoNorm) {
                case 'ENTRADA':  novaQuantidade = quantidadeAnterior + qtd; break;
                case 'SAIDA':    novaQuantidade = quantidadeAnterior - qtd; break;
                case 'AJUSTE':   novaQuantidade = qtd; break;
            }
            if (novaQuantidade < 0) return res.status(400).json({ success: false, message: 'Quantidade insuficiente em estoque' });

            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();
                await conn.query(`UPDATE ${tabela} SET ${coluna} = ? WHERE id = ?`, [novaQuantidade, itemId]);
                await conn.query(`
                    INSERT INTO movimentacoes_estoque
                    (material_id, produto_id, tipo, quantidade, quantidade_anterior, quantidade_atual, observacoes, local, documento, usuario_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                `, [material_id || null, produto_id || null, tipoNorm, qtd, quantidadeAnterior, novaQuantidade, obs, local || 'PRINCIPAL', documento || null, req.user?.id || null]);
                await conn.commit();
            } catch (txErr) {
                try { await conn.rollback(); } catch(e) {}
                throw txErr;
            } finally {
                conn.release();
            }

            res.json({
                success: true,
                message: 'Movimentação registrada com sucesso',
                quantidade_anterior: quantidadeAnterior,
                quantidade_atual: novaQuantidade,
                nome_item: item.nome
            });
        } catch (err) {
            console.error('[PCP] Erro ao registrar movimentação de estoque:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao registrar movimentação' });
        }
    });

    // POST /materiais/movimentacao - Registrar movimentação de material
    router.post('/materiais/movimentacao', authenticateToken, async (req, res) => {
        const { material_id, produto_id, tipo, quantidade, observacoes, observacao, local, documento } = req.body;
        const matId = material_id || produto_id;
        if (!matId) return res.status(400).json({ success: false, message: 'Informe material_id' });
        if (!quantidade || isNaN(parseFloat(quantidade))) return res.status(400).json({ success: false, message: 'Quantidade inválida' });

        const obs = observacoes || observacao || '';
        const tipoNorm = (tipo || 'ENTRADA').toUpperCase();
        if (!['ENTRADA', 'SAIDA', 'AJUSTE'].includes(tipoNorm)) {
            return res.status(400).json({ success: false, message: 'Tipo inválido' });
        }

        try {
            const [[item]] = await pool.query(
                'SELECT quantidade_estoque as quantidade, descricao as nome FROM materiais WHERE id = ?',
                [matId]
            );
            if (!item) return res.status(404).json({ success: false, message: 'Material não encontrado' });

            const quantidadeAnterior = parseFloat(item.quantidade) || 0;
            let novaQuantidade;
            const qtd = parseFloat(quantidade);
            switch (tipoNorm) {
                case 'ENTRADA':  novaQuantidade = quantidadeAnterior + qtd; break;
                case 'SAIDA':    novaQuantidade = quantidadeAnterior - qtd; break;
                case 'AJUSTE':   novaQuantidade = qtd; break;
            }
            if (novaQuantidade < 0) return res.status(400).json({ success: false, message: 'Quantidade insuficiente em estoque' });

            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();
                await conn.query('UPDATE materiais SET quantidade_estoque = ? WHERE id = ?', [novaQuantidade, matId]);
                await conn.query(`
                    INSERT INTO movimentacoes_estoque
                    (material_id, tipo, quantidade, quantidade_anterior, quantidade_atual, observacoes, local, documento, usuario_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                `, [matId, tipoNorm, qtd, quantidadeAnterior, novaQuantidade, obs, local || 'PRINCIPAL', documento || null, req.user?.id || null]);
                await conn.commit();
            } catch (txErr) {
                try { await conn.rollback(); } catch(e) {}
                throw txErr;
            } finally {
                conn.release();
            }

            res.json({ success: true, message: 'Movimentação registrada com sucesso', quantidade_anterior: quantidadeAnterior, quantidade_atual: novaQuantidade, nome_item: item.nome });
        } catch (err) {
            console.error('[PCP] Erro ao registrar movimentação de material:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao registrar movimentação' });
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
            res.status(500).json({ message: 'Erro ao buscar produtos.', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
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

            // AUDIT-FIX S1.4: Validar nomes de coluna contra regex seguro (defesa em profundidade)
            const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
            const setClauses = Object.keys(camposParaAtualizar).map(campo => {
                if (!SAFE_IDENTIFIER.test(campo)) {
                    throw new Error(`Campo inválido rejeitado: ${campo}`);
                }
                return `\`${campo}\` = ?`;
            });
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
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // ========================================
    // API: BUSCAR PRODUTO POR ID (GET)
    // ========================================
    router.get('/api/produtos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;

            const [produtos] = await pool.query('SELECT id, codigo, codigo_produto, nome, descricao, unidade, preco, preco_custo, preco_venda, ncm, cfop, cst, categoria, estoque_atual, estoque_minimo, peso_liquido, peso_bruto, ativo, created_at, updated_at FROM produtos WHERE id = ?', [id]);

            if (produtos.length === 0) {
                return res.status(404).json({ error: 'Produto não encontrado' });
            }

            res.json(produtos[0]);

        } catch (error) {
            console.error('❌ Erro ao buscar produto:', error);
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
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

    // [REFACTORED] Configuracoes do Sistema (empresa, impostos, vendedores, certificados, etc.)
    require('./pcp/configuracoes-routes')(router, deps);

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
            res.status(500).json({ success: false, error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, error: 'Erro interno no servidor. Tente novamente.' });
        } finally {
            connection.release();
        }
    });

    // [REFACTORED] Sistema de Impressao (fila, impressoras, configuracoes)
    require('./pcp/print-routes')(router, deps);

    // API PARA BUSCAR ÚLTIMO NÚMERO DE PEDIDO
    router.get('/ultimo-pedido', authenticateToken, async (req, res) => {
        try {
            console.log('🔍 Buscando último número de pedido...');

            const connection = await pool.getConnection();
            try {
                // AUDIT-FIX S1.1: Usar sequence table ou fallback para MAX com FOR UPDATE
                let ultimoNumero = '0002025000';

                // Tentar sequence table primeiro (atômico)
                try {
                    const [seqRows] = await connection.query(
                        'SELECT current_val FROM sequences WHERE seq_name = ? FOR UPDATE',
                        ['pedido_op']
                    );
                    if (seqRows.length > 0 && seqRows[0].current_val > 0) {
                        ultimoNumero = String(seqRows[0].current_val);
                    }
                } catch (_) {
                    // Fallback: MAX query (tabela sequences pode não existir ainda)
                    const [rows] = await connection.query(`
                        SELECT MAX(CAST(numero_pedido AS UNSIGNED)) as ultimo_numero
                        FROM ordens_producao
                        WHERE numero_pedido IS NOT NULL
                        AND numero_pedido REGEXP '^[0-9]+$'
                    `);
                    if (rows && rows.length > 0 && rows[0].ultimo_numero) {
                        ultimoNumero = String(rows[0].ultimo_numero);
                    }
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

            // 🔧 FIX BUG-OP-01: Normalizar nomes de campos com cedilha (ç) enviados pelo frontend
            if (!dadosOrdem.numero_orcamento && dadosOrdem['num_orçamento']) {
                dadosOrdem.numero_orcamento = dadosOrdem['num_orçamento'];
            }
            if (!dadosOrdem.numero_orcamento && dadosOrdem.num_orcamento) {
                dadosOrdem.numero_orcamento = dadosOrdem.num_orcamento;
            }
            if (!dadosOrdem.numero_pedido && dadosOrdem.num_pedido) {
                dadosOrdem.numero_pedido = dadosOrdem.num_pedido;
            }

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

            // 🔧 FIX: Buscar dados completos do cliente no banco quando faltam campos
            if (dadosOrdem.cliente && (!dadosOrdem.cpf_cnpj || !dadosOrdem.contato_cliente || !dadosOrdem.fone_cliente)) {
                try {
                    const [clienteRows] = await pool.query(
                        'SELECT cnpj_cpf, contato, telefone, email, endereco, bairro, cidade, estado, cep FROM clientes WHERE (nome = ? OR razao_social = ? OR nome_fantasia = ?) AND ativo = 1 LIMIT 1',
                        [dadosOrdem.cliente, dadosOrdem.cliente, dadosOrdem.cliente]
                    );
                    if (clienteRows.length > 0) {
                        const cli = clienteRows[0];
                        if (!dadosOrdem.cpf_cnpj) dadosOrdem.cpf_cnpj = cli.cnpj_cpf || '';
                        if (!dadosOrdem.contato_cliente) dadosOrdem.contato_cliente = cli.contato || '';
                        if (!dadosOrdem.fone_cliente) dadosOrdem.fone_cliente = cli.telefone || '';
                        if (!dadosOrdem.email_cliente) dadosOrdem.email_cliente = cli.email || '';
                        if (!dadosOrdem.endereco) dadosOrdem.endereco = [cli.endereco, cli.bairro, cli.cidade, cli.estado].filter(Boolean).join(', ');
                        if (!dadosOrdem.cep) dadosOrdem.cep = cli.cep || '';
                        console.log('✅ Dados do cliente enriquecidos via banco:', cli.cnpj_cpf);
                    }
                } catch (dbErr) {
                    console.warn('⚠️ Erro ao buscar dados do cliente:', dbErr.message);
                }
            }

            // 🔧 FIX: Buscar dados completos da transportadora no banco quando faltam campos
            if (dadosOrdem.transportadora_nome && (!dadosOrdem.transportadora_fone || !dadosOrdem.transportadora_cep)) {
                try {
                    const [transpRows] = await pool.query(
                        'SELECT cnpj_cpf, telefone, email, bairro, cidade, estado, cep FROM transportadoras WHERE (razao_social = ? OR nome_fantasia = ?) LIMIT 1',
                        [dadosOrdem.transportadora_nome, dadosOrdem.transportadora_nome]
                    );
                    if (transpRows.length > 0) {
                        const tr = transpRows[0];
                        if (!dadosOrdem.transportadora_fone) dadosOrdem.transportadora_fone = tr.telefone || '';
                        if (!dadosOrdem.transportadora_cpf_cnpj) dadosOrdem.transportadora_cpf_cnpj = tr.cnpj_cpf || '';
                        if (!dadosOrdem.transportadora_email_nfe) dadosOrdem.transportadora_email_nfe = tr.email || '';
                        if (!dadosOrdem.transportadora_cep) dadosOrdem.transportadora_cep = tr.cep || '';
                        if (!dadosOrdem.transportadora_endereco) dadosOrdem.transportadora_endereco = [tr.bairro, tr.cidade, tr.estado].filter(Boolean).join(', ');
                        console.log('✅ Dados da transportadora enriquecidos via banco:', tr.cnpj_cpf);
                    }
                } catch (dbErr) {
                    console.warn('⚠️ Erro ao buscar dados da transportadora:', dbErr.message);
                }
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

                // FIX BUG-17: Content-Disposition com RFC 5987 encoding para Unicode + prevenir header injection
                const encodedFilename = encodeURIComponent(nomeArquivo).replace(/'/g, '%27');
                const asciiFilename = nomeArquivo.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
                res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Length', fileBuffer.length);

                res.send(fileBuffer);

                console.log(`✅ Excel gerado com sucesso usando template: ${nomeArquivo}`);

            } catch (excelError) {
                console.error('[XLSX] Erro ao gerar:', excelError.message);

                // 🔧 FIX BUG-R5-31: Wrap CSV fallback em try/catch para não crashar silenciosamente
                try {
                    const csvBuffer = await gerarExcelOrdemProducaoFallback(dadosOrdem);

                    const nomeCliente = (dadosOrdem.cliente || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
                    const nomeArquivo = `Ordem de Produção - ${nomeCliente} - ERP.csv`;
                    const encodedCsvName = encodeURIComponent(nomeArquivo).replace(/'/g, '%27');
                    const asciiCsvName = nomeArquivo.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

                    res.setHeader('Content-Disposition', `attachment; filename="${asciiCsvName}"; filename*=UTF-8''${encodedCsvName}`);
                    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                    res.setHeader('Content-Length', csvBuffer.length);

                    res.send(csvBuffer);

                    console.log(`✅ CSV gerado com sucesso como fallback: ${nomeArquivo}`);
                } catch (csvError) {
                    console.error('[CSV Fallback] Também falhou:', csvError.message);
                    res.status(500).json({
                        error: 'Erro ao gerar Excel e CSV. Contate o suporte.',
                        detalhe: excelError.message
                    });
                }
            }

        } catch (error) {
            console.error('❌ Erro ao gerar Excel da ordem de produção:', error);
            res.status(500).json({
                error: 'Erro interno do servidor ao gerar Excel'
            });
        }
    });

    // ==================== ORDEM DE PRODUÇÃO → PDF (XSL-FO / Apache FOP) ====================
    // Pipeline: dados → XML (xmlbuilder2) → XSLT transforma em XSL-FO → Apache FOP gera PDF
    const { gerarOrdemXML } = require('../services/ordem-xml-generator');
    const { gerarPdfComFop, verificarFop } = require('../services/fop-pdf-service');
    const { buscarConfiguracoesEmpresa, formatarDadosParaPDF } = require('../modules/_shared/services/empresa-config.service');

    // GET /api/ordem-pdf/status - Verifica se FOP está disponível
    router.get('/api/ordem-pdf/status', authenticateToken, (req, res) => {
        const status = verificarFop();
        res.json({ fop: status });
    });

    // POST /api/gerar-ordem-pdf - Gera PDF da Ordem de Produção via XSL-FO
    router.post('/api/gerar-ordem-pdf', authenticateToken, async (req, res) => {
        try {
            console.log('📄 Iniciando geração de Ordem de Produção em PDF (XSL-FO)...');

            const dadosOrdem = req.body;

            // Normalizar campos com cedilha (mesmo tratamento da rota Excel)
            if (!dadosOrdem.numero_orcamento && dadosOrdem['num_orçamento']) {
                dadosOrdem.numero_orcamento = dadosOrdem['num_orçamento'];
            }
            if (!dadosOrdem.numero_orcamento && dadosOrdem.num_orcamento) {
                dadosOrdem.numero_orcamento = dadosOrdem.num_orcamento;
            }
            if (!dadosOrdem.numero_pedido && dadosOrdem.num_pedido) {
                dadosOrdem.numero_pedido = dadosOrdem.num_pedido;
            }

            // Validar dados obrigatórios
            if (!dadosOrdem.numero_orcamento || !dadosOrdem.cliente) {
                return res.status(400).json({
                    error: 'Dados obrigatórios não fornecidos (numero_orcamento, cliente)'
                });
            }

            // Enriquecer dados do cliente via banco (se faltam campos)
            if (dadosOrdem.cliente && (!dadosOrdem.cpf_cnpj || !dadosOrdem.contato_cliente || !dadosOrdem.fone_cliente)) {
                try {
                    const [clienteRows] = await pool.query(
                        'SELECT cnpj_cpf, contato, telefone, email, endereco, bairro, cidade, estado, cep FROM clientes WHERE (nome = ? OR razao_social = ? OR nome_fantasia = ?) AND ativo = 1 LIMIT 1',
                        [dadosOrdem.cliente, dadosOrdem.cliente, dadosOrdem.cliente]
                    );
                    if (clienteRows.length > 0) {
                        const cli = clienteRows[0];
                        if (!dadosOrdem.cpf_cnpj) dadosOrdem.cpf_cnpj = cli.cnpj_cpf || '';
                        if (!dadosOrdem.contato_cliente) dadosOrdem.contato_cliente = cli.contato || '';
                        if (!dadosOrdem.fone_cliente) dadosOrdem.fone_cliente = cli.telefone || '';
                        if (!dadosOrdem.email_cliente) dadosOrdem.email_cliente = cli.email || '';
                        if (!dadosOrdem.endereco) dadosOrdem.endereco = [cli.endereco, cli.bairro, cli.cidade, cli.estado].filter(Boolean).join(', ');
                        if (!dadosOrdem.cep) dadosOrdem.cep = cli.cep || '';
                    }
                } catch (dbErr) {
                    console.warn('⚠️ Erro ao buscar dados do cliente para PDF:', dbErr.message);
                }
            }

            // Enriquecer dados da transportadora via banco
            if (dadosOrdem.transportadora_nome && (!dadosOrdem.transportadora_fone || !dadosOrdem.transportadora_cep)) {
                try {
                    const [transpRows] = await pool.query(
                        'SELECT cnpj_cpf, telefone, email, bairro, cidade, estado, cep FROM transportadoras WHERE (razao_social = ? OR nome_fantasia = ?) LIMIT 1',
                        [dadosOrdem.transportadora_nome, dadosOrdem.transportadora_nome]
                    );
                    if (transpRows.length > 0) {
                        const tr = transpRows[0];
                        if (!dadosOrdem.transportadora_fone) dadosOrdem.transportadora_fone = tr.telefone || '';
                        if (!dadosOrdem.transportadora_cpf_cnpj) dadosOrdem.transportadora_cpf_cnpj = tr.cnpj_cpf || '';
                        if (!dadosOrdem.transportadora_email_nfe) dadosOrdem.transportadora_email_nfe = tr.email || '';
                        if (!dadosOrdem.transportadora_cep) dadosOrdem.transportadora_cep = tr.cep || '';
                        if (!dadosOrdem.transportadora_endereco) dadosOrdem.transportadora_endereco = [tr.bairro, tr.cidade, tr.estado].filter(Boolean).join(', ');
                    }
                } catch (dbErr) {
                    console.warn('⚠️ Erro ao buscar dados da transportadora para PDF:', dbErr.message);
                }
            }

            // 0. Buscar dados da empresa do banco
            try {
                const empresaConfig = await buscarConfiguracoesEmpresa(pool);
                const dadosEmpPDF = formatarDadosParaPDF(empresaConfig);
                dadosOrdem.empresa = {
                    nome: dadosEmpPDF.nome,
                    razao_social: dadosEmpPDF.nome,
                    endereco: dadosEmpPDF.endereco,
                    bairro: dadosEmpPDF.bairro || '',
                    cep: dadosEmpPDF.cep,
                    cidade: dadosEmpPDF.cidade,
                    estado: dadosEmpPDF.estado,
                    enderecoCompleto: `${dadosEmpPDF.endereco}, ${dadosEmpPDF.numero || ''} - ${dadosEmpPDF.bairro || ''}`.replace(/ - $/, '')
                };
            } catch (empErr) {
                console.warn('⚠️ Erro ao buscar config empresa para OP PDF:', empErr.message);
            }

            // 1. Gerar XML estruturado
            const xmlContent = gerarOrdemXML(dadosOrdem);
            console.log(`📝 XML gerado: ${xmlContent.length} bytes`);

            // 2. Converter XML → PDF via Apache FOP (XSL-FO)
            const pdfBuffer = await gerarPdfComFop(xmlContent);
            console.log(`✅ PDF gerado: ${pdfBuffer.length} bytes`);

            // 3. Enviar PDF
            const nomeCliente = (dadosOrdem.cliente || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
            const nomeArquivo = `Ordem de Produção - ${nomeCliente}.pdf`;
            const encodedFilename = encodeURIComponent(nomeArquivo).replace(/'/g, '%27');
            const asciiFilename = nomeArquivo.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

            res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', pdfBuffer.length);

            res.send(pdfBuffer);
            console.log(`✅ PDF da OP enviado: ${nomeArquivo}`);

        } catch (error) {
            console.error('❌ Erro ao gerar PDF da ordem de produção:', error);
            res.status(500).json({
                error: 'Erro ao gerar PDF da Ordem de Produção',
                detalhe: error.message
            });
        }
    });

    // POST /api/gerar-ordem-xml - Exporta apenas o XML da Ordem (para debug/integração)
    router.post('/api/gerar-ordem-xml', authenticateToken, async (req, res) => {
        try {
            const dadosOrdem = req.body;
            if (!dadosOrdem.numero_orcamento && dadosOrdem['num_orçamento']) {
                dadosOrdem.numero_orcamento = dadosOrdem['num_orçamento'];
            }
            if (!dadosOrdem.numero_orcamento && dadosOrdem.num_orcamento) {
                dadosOrdem.numero_orcamento = dadosOrdem.num_orcamento;
            }

            const xmlContent = gerarOrdemXML(dadosOrdem);

            const nomeCliente = (dadosOrdem.cliente || 'Cliente').replace(/[/\\:*?"<>|]/g, '_').trim();
            const nomeArquivo = `Ordem de Produção - ${nomeCliente}.xml`;
            const encodedFilename = encodeURIComponent(nomeArquivo).replace(/'/g, '%27');
            const asciiFilename = nomeArquivo.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

            res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');

            res.send(xmlContent);
        } catch (error) {
            console.error('❌ Erro ao gerar XML da ordem:', error);
            res.status(500).json({ error: 'Erro ao gerar XML', detalhe: error.message });
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

        // 🔧 FIX BUG-OP-01: Normalizar campos com cedilha vindos do frontend
        if (!dados.numero_orcamento && dados['num_orçamento']) {
            dados.numero_orcamento = dados['num_orçamento'];
        }
        if (!dados.numero_orcamento && dados.num_orcamento) {
            dados.numero_orcamento = dados.num_orcamento;
        }
        if (!dados.numero_pedido && dados.num_pedido) {
            dados.numero_pedido = dados.num_pedido;
        }

        // C4 - Número do Orçamento (como número se possível)
        const numOrcamento = dados.numero_orcamento || '';
        // 🔧 FIX BUG-R4-23: isNaN('') → false, parseFloat('') → NaN → célula com NaN
        if (numOrcamento === '') {
            abaVendas.getCell('C4').value = '';
        } else {
            abaVendas.getCell('C4').value = isNaN(numOrcamento) ? numOrcamento : parseFloat(numOrcamento);
        }

        // 🔧 FIX BUG-OP-04: E4 - Revisão (campo existente no modal mas nunca escrito no template)
        abaVendas.getCell('E4').value = dados.revisao || '';

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
                    // 🔧 FIX BUG-R4-21: new Date('yyyy-mm-dd') cria data UTC → off-by-one em BRT
                    const [y2, m2, d2] = dataStr.split('-');
                    dataObj = new Date(parseInt(y2), parseInt(m2) - 1, parseInt(d2));
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

        // 🔧 FIX: Garantir largura mínima da coluna J para exibir data sem *******
        const colJ = abaVendas.getColumn('J');
        if (!colJ.width || colJ.width < 14) {
            colJ.width = 14;
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
            } else if (typeof dados.prazo_entrega === 'string' && dados.prazo_entrega.includes('-')) {
                // 🔧 FIX BUG-R4-22: <input type="date"> envia yyyy-mm-dd → parsear sem UTC
                const [y, m, d] = dados.prazo_entrega.split('-');
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

        // H8 - Telefone (como texto formatado, NÃO parseFloat — perde precisão em 11+ dígitos)
        const telefone = dados.telefone || dados.fone_cliente || '';
        const telefoneNum = String(telefone).replace(/\D/g, '');
        // 🔧 FIX BUG-R5-30: parseFloat('11999887766') → 11999887766 OK, mas parseFloat('119998877660') → perde dígitos
        // Manter como string para números com 11+ dígitos
        abaVendas.getCell('H8').value = telefoneNum || telefone;

        abaVendas.getCell('C9').value = dados.email || dados.email_cliente || '';
        abaVendas.getCell('J9').value = dados.frete || dados.tipo_frete || '';

        // ========================================
        // ABA VENDAS_PCP - TRANSPORTADORA (linhas 12-15)
        // ========================================

        // C12 - Nome da Transportadora
        const nomeTransp = dados.transportadora_nome || dados.transportadora?.nome || '';
        abaVendas.getCell('C12').value = nomeTransp;
        console.log(`   Transportadora Nome: ${nomeTransp}`);

        // 🔧 H12 - Telefone da transportadora (manter como string — NÃO parseFloat)
        const telefoneTransp = dados.transportadora_fone || dados.transportadora?.fone || telefone || '';
        if (telefoneTransp) {
            const telefoneTranspNum = String(telefoneTransp).replace(/\D/g, '');
            abaVendas.getCell('H12').value = telefoneTranspNum || telefoneTransp;
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

        // G14 - Email NF-e para Cobrança - NÃO PREENCHER D14 (conforme requisito)
        // D14 deve ficar vazio
        abaVendas.getCell('D14').value = '';

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
        if (cnpjStr && cnpjStr.length >= 11) {
            cellC15.value = Number(cnpjStr);
            // Formatação visual igual ao template preenchido
            cellC15.numFmt = '[<=99999999999]000.000.000-00;00.000.000/0000-00';
        } else {
            cellC15.value = ''; // Deixar vazio quando não informado (evita "TEMP" com formato)
        }

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
                // 🔧 FIX BUG-OP-05: Fallback para 'descrição' com cedilha (frontend envia com ç)
                const descricaoCatalogo = catalogoProdutos[codigoProd] || prod.descricao || prod['descrição'] || prod.nome || '';

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

                // C - Descrição do produto: SEMPRE forçar texto direto (evita "VLOOKUP" visível)
                const cellC = abaVendas.getCell(`C${linhaAtual}`);
                cellC.value = descricaoCatalogo || prod.descricao || prod['descrição'] || prod.nome || '';

                // F - Embalagem (default 'Bobina' conforme dropdown do frontend)
                abaVendas.getCell(`F${linhaAtual}`).value = prod.embalagem || 'Bobina';

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

        // 🔧 FIX BUG-R5-27: Limpar linhas de produto não utilizadas (stale template data)
        for (let i = linhaAtual; i <= LINHA_MAXIMA_PRODUTOS; i++) {
            for (const col of ['A', 'B', 'C', 'F', 'G', 'H', 'I', 'J']) {
                const cell = abaVendas.getCell(`${col}${i}`);
                // Preservar fórmulas, limpar apenas valores diretos
                if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                    cell.value = { formula: cell.value.formula, result: '' };
                } else {
                    cell.value = null;
                }
            }
        }

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
            abaVendas.getCell('A37').value = obs;
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
                // 🔧 FIX BUG-R5-28: Valor da 2ª forma de pagamento nunca era preenchido
                const valor2 = totalGeral * perc2;
                abaVendas.getCell('I46').value = valor2;
                abaVendas.getCell('I46').numFmt = 'R$ #,##0.00';
            }

            // 🔧 FIX BUG-R5-28b: 3ª forma de pagamento (frontend coleta 3, backend só escrevia 2)
            if (formasPag.length > 2) {
                // Condições extras de pagamento vão para observações (template tem apenas 2 linhas)
                const perc3 = parseFloat(formasPag[2].percentual || 0);
                const valor3 = totalGeral * (perc3 / 100);
                const pag3Texto = `3ª Pag: ${formasPag[2].forma || ''} ${perc3}% ${formasPag[2].metodo || ''} R$ ${valor3.toFixed(2)}`;
                const obsExistente = abaVendas.getCell('A37').value || '';
                abaVendas.getCell('A37').value = obsExistente ? `${obsExistente}\n${pag3Texto}` : pag3Texto;
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
            const obsExistente = abaVendas.getCell('A37').value || '';
            const condPag = `Cond. Pagamento: ${dados.condicoes_pagamento}`;
            abaVendas.getCell('A37').value = obsExistente ? `${obsExistente}\n${condPag}` : condPag;
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
            // 🔧 FIX BUG-R4-24: Usar Number() em vez de string para que numFmt funcione
            cellC15Final.value = Number(cnpjStrFinal);
            cellC15Final.numFmt = '[<=99999999999]000.000.000-00;00.000.000/0000-00';
        }
        // ========================================
        // 🔧 ABA PRODUÇÃO: Atualizar fórmulas VLOOKUP com results
        // ========================================
        if (abaProducao) {
            console.log('\n🔧 Atualizando aba PRODUÇÃO...');

            // ========================================
            // 🔧 FIX BUG-OP-PAGE2: Replicar cabeçalho/dados do cliente na aba PRODUÇÃO
            // A aba PRODUÇÃO tem cabeçalho (linhas 1-12) com fórmulas referenciando VENDAS_PCP.
            // ExcelJS NÃO recalcula fórmulas, então os "result" ficam vazios/stale.
            // Solução: atualizar o result de cada fórmula E/OU preencher diretamente.
            // ========================================
            console.log('📋 Replicando cabeçalho na aba PRODUÇÃO (FIX page 2)...');

            // Percorrer linhas 1-12 da aba PRODUÇÃO e atualizar results de fórmulas
            // 🔧 R2 FIX BUG-14: Regex expandido para suportar 'VENDAS_PCP'!$C$4, espaços, etc.
            const formulaRefRegex = /(?:'?VENDAS_PCP'?)\s*!\s*\$?([A-Z]{1,3})\$?(\d+)/i;
            for (let row = 1; row <= 12; row++) {
                for (const colLetter of ['A','B','C','D','E','F','G','H','I','J','K']) {
                    const cell = abaProducao.getCell(`${colLetter}${row}`);
                    if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                        const formula = cell.value.formula;
                        const match = formula.match(formulaRefRegex);
                        if (match) {
                            const refCol = match[1];
                            const refRow = match[2];
                            const sourceCell = abaVendas.getCell(`${refCol}${refRow}`);
                            const sourceValue = sourceCell.value;
                            // Preservar fórmula e injetar result calculado
                            cell.value = { formula: formula, result: sourceValue || '' };
                            if (sourceValue) {
                                console.log(`   📋 PRODUÇÃO ${colLetter}${row}: fórmula=${formula} → result=${String(sourceValue).substring(0, 30)}`);
                            }
                        }
                    }
                }
            }

            // Fallback direto: garantir que dados-chave estejam preenchidos APENAS se célula vazia
            // 🔧 R2 FIX BUG-15: Não sobrescrever fórmulas — só preencher células realmente vazias
            const headerMapping = [
                { cell: 'C4', value: dados.numero_orcamento || numOrcamento, desc: 'Nº Orçamento' },
                { cell: 'G4', value: numPedidoFinal, desc: 'Nº Pedido' },
                { cell: 'C6', value: dados.vendedor || '', desc: 'Vendedor' },
                { cell: 'C7', value: dados.cliente || '', desc: 'Cliente' },
                { cell: 'C8', value: dados.contato || dados.contato_cliente || '', desc: 'Contato' },
                { cell: 'H8', value: dados.telefone || dados.fone_cliente || '', desc: 'Telefone' },
                { cell: 'C9', value: dados.email || dados.email_cliente || '', desc: 'Email' },
                { cell: 'J9', value: dados.frete || dados.tipo_frete || '', desc: 'Tipo Frete' },
                { cell: 'C12', value: dados.transportadora_nome || '', desc: 'Transportadora' },
                { cell: 'H12', value: dados.transportadora_fone || '', desc: 'Transp. Fone' },
                { cell: 'C13', value: dados.transportadora_cep || '', desc: 'Transp. CEP' },
                { cell: 'F13', value: dados.transportadora_endereco || '', desc: 'Transp. Endereço' },
            ];

            for (const mapping of headerMapping) {
                const cell = abaProducao.getCell(mapping.cell);
                // 🔧 R2: Só preencher se a célula estiver REALMENTE vazia (sem valor algum)
                const val = cell.value;
                const isEmpty = !val || (typeof val === 'string' && val.trim() === '');
                if (isEmpty && mapping.value) {
                    cell.value = mapping.value;
                    console.log(`   📋 PRODUÇÃO ${mapping.cell} (${mapping.desc}): ${String(mapping.value).substring(0, 30)}`);
                }
            }

            // 🔧 R2 FIX BUG-16: Data de liberação na PRODUÇÃO — só se célula vazia
            const cellJ4Prod = abaProducao.getCell('J4');
            const j4Val = cellJ4Prod.value;
            const j4Empty = !j4Val || (typeof j4Val === 'string' && j4Val.trim() === '');
            if (j4Empty) {
                cellJ4Prod.value = abaVendas.getCell('J4').value || new Date();
                cellJ4Prod.numFmt = 'dd/mm/yyyy';
                console.log(`   📋 PRODUÇÃO J4 (Data): ${cellJ4Prod.value}`);
            }

            // 🔧 FIX: Garantir largura mínima da coluna J na PRODUÇÃO
            const colJProd = abaProducao.getColumn('J');
            if (!colJProd.width || colJProd.width < 14) {
                colJProd.width = 14;
            }

            console.log('   ✅ Cabeçalho da aba PRODUÇÃO atualizado!\n');

            // A aba PRODUÇÃO tem suas próprias fórmulas VLOOKUP na coluna C
            // As linhas de produtos são: 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52 (de 3 em 3)
            // Também precisa atualizar a coluna F (Código de Cores)

            // Pegar produtos já preenchidos na VENDAS_PCP
            const linhasProducao = [13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55];

            // Mapeamento: linha VENDAS_PCP (18,19,20...) -> linha PRODUÇÃO (13,16,19...)
            // VENDAS_PCP linha 18 = primeiro produto -> PRODUÇÃO linha 13
            // VENDAS_PCP linha 19 = segundo produto -> PRODUÇÃO linha 16
            // etc.

            produtos.forEach((prod, index) => {
                if (index < linhasProducao.length && prod) {
                    const linhaProd = linhasProducao[index];
                    const codigoProd = String(prod.codigo || '').trim().toUpperCase();
                    // 🔧 FIX BUG-OP-05: Fallback para 'descrição' com cedilha (frontend envia com ç)
                    const descricaoCatalogo = catalogoProdutos[codigoProd] || prod.descricao || prod['descrição'] || prod.nome || '';

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

                    // F - Código de Cores
                    const codigoCores = prod.codigo_cores || prod.cores || '';
                    if (codigoCores) {
                        const cellCodCores = abaProducao.getCell(`F${linhaProd}`);
                        if (cellCodCores.value && typeof cellCodCores.value === 'object' && cellCodCores.value.formula) {
                            cellCodCores.value = { formula: cellCodCores.value.formula, result: codigoCores };
                        } else {
                            cellCodCores.value = codigoCores;
                        }
                    }

                    // G - Embalagem (default 'Bobina')
                    const embalagemProd = prod.embalagem || 'Bobina';
                    const cellEmb = abaProducao.getCell(`G${linhaProd}`);
                    if (cellEmb.value && typeof cellEmb.value === 'object' && cellEmb.value.formula) {
                        cellEmb.value = { formula: cellEmb.value.formula, result: embalagemProd };
                    } else {
                        cellEmb.value = embalagemProd;
                    }

                    // H - Lance(s)
                    const lancesProd = prod.lances || '';
                    if (lancesProd) {
                        const cellLances = abaProducao.getCell(`H${linhaProd}`);
                        if (cellLances.value && typeof cellLances.value === 'object' && cellLances.value.formula) {
                            cellLances.value = { formula: cellLances.value.formula, result: lancesProd };
                        } else {
                            cellLances.value = lancesProd;
                        }
                    }

                    // Preencher LOTE na coluna G da linha seguinte (linhaProd + 1)
                    if (prod.lote) {
                        const cellLote = abaProducao.getCell(`G${linhaProd + 1}`);
                        cellLote.value = prod.lote;
                    }

                    console.log(`   📦 PRODUÇÃO Linha ${linhaProd}: ${codigoProd} = ${descricaoCatalogo.substring(0, 40)}... | CodCores=${codigoCores} | Emb=${embalagemProd} | Lances=${lancesProd}`);
                }
            });

            // 🔧 FIX BUG-R5-29: Limpar linhas de produto não utilizadas na aba PRODUÇÃO
            const prodCount = Math.min(produtos.length, linhasProducao.length);
            for (let idx = prodCount; idx < linhasProducao.length; idx++) {
                const linhaClear = linhasProducao[idx];
                for (const col of ['B', 'C', 'F', 'G', 'H', 'J']) {
                    const cell = abaProducao.getCell(`${col}${linhaClear}`);
                    if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                        cell.value = { formula: cell.value.formula, result: '' };
                    } else {
                        cell.value = null;
                    }
                }
                // Limpar também linhas +1 e +2 (peso, lote)
                for (let offset = 1; offset <= 2; offset++) {
                    for (const col of ['E', 'G']) {
                        const cellExtra = abaProducao.getCell(`${col}${linhaClear + offset}`);
                        if (cellExtra.value && typeof cellExtra.value === 'object' && cellExtra.value.formula) {
                            cellExtra.value = { formula: cellExtra.value.formula, result: '' };
                        } else if (cellExtra.value) {
                            cellExtra.value = null;
                        }
                    }
                }
            }

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
        csv.push(['ORDEM DE PRODUÇÃO ZYNTRA']);
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
                    p.valor, p.valor AS valor_total, p.status, p.prioridade,
                    p.prazo_entrega, p.condicao_pagamento, p.cenario_fiscal,
                    p.descricao, p.created_at, p.updated_at, p.version,
                    c.nome as cliente_nome,
                    COALESCE(e.nome_fantasia, e.razao_social) as empresa_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                ORDER BY p.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM pedidos');

            res.json({ pedidos: rows, total, page, limit });
        } catch (error) { next(error); }
    });

    // PEDIDOS DE VENDAS PARA PCP - aprovados em diante, sem restringir pelo vendedor logado
    router.get('/pedidos-vendas', async (req, res, next) => {
        try {
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
            const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
            const defaultStatuses = [
                'aprovado',
                'pedido-aprovado',
                'pedido_aprovado',
                'pedido aprovado',
                'faturar',
                'faturado',
                'parcial',
                'faturamento-parcial',
                'faturamento_parcial',
                'faturamento parcial',
                'recibo',
                'entregue',
                'finalizado',
                'em-producao',
                'em produção',
                'em producao',
                'em_producao'
            ];
            const includeAll = ['1', 'true', 'sim', 'all', 'todos'].includes(
                String(req.query.all || req.query.todos || req.query.include_all || '').trim().toLowerCase()
            );
            const requestedStatuses = String(req.query.statuses || '')
                .split(',')
                .map(s => s.trim().toLowerCase())
                .filter(Boolean);
            const statusList = requestedStatuses.length ? requestedStatuses : (includeAll ? [] : defaultStatuses);

            const pedidoColumns = await getTableColumnsSet('pedidos');
            const clienteColumns = await getTableColumnsSet('clientes').catch(() => new Set());
            const hasPedido = column => pedidoColumns.has(column);
            const hasCliente = column => clienteColumns.has(column);
            const selectOrNull = (column, alias) => hasPedido(column)
                ? `p.\`${column}\` AS \`${alias || column}\``
                : `NULL AS \`${alias || column}\``;
            const firstExistingExpression = (columns, fallback) => {
                const expressions = columns.filter(hasPedido).map(column => `p.\`${column}\``);
                return expressions.length ? `COALESCE(${expressions.join(', ')}, ${fallback})` : fallback;
            };

            const clienteExpressions = [];
            if (hasPedido('cliente_nome')) clienteExpressions.push('p.`cliente_nome`');
            if (hasPedido('cliente')) clienteExpressions.push('p.`cliente`');
            const joins = [];
            if (hasPedido('cliente_id') && clienteColumns.size) {
                joins.push('LEFT JOIN clientes c ON c.id = p.cliente_id');
                if (hasCliente('nome')) clienteExpressions.push('c.`nome`');
                if (hasCliente('razao_social')) clienteExpressions.push('c.`razao_social`');
                if (hasCliente('nome_fantasia')) clienteExpressions.push('c.`nome_fantasia`');
            }

            const clienteSelect = clienteExpressions.length
                ? `COALESCE(${clienteExpressions.join(', ')}, 'Cliente nao informado') AS cliente_nome`
                : `'Cliente nao informado' AS cliente_nome`;
            const numeroPedidoSelect = `${firstExistingExpression(['numero_pedido', 'num_pedido', 'numero'], 'p.id')} AS numero_pedido`;
            const valorSelect = `${firstExistingExpression(['valor', 'valor_total', 'total'], '0')} AS valor_total`;
            const dataSelect = `${firstExistingExpression(['updated_at', 'data_faturamento', 'data_aprovacao', 'data_pedido', 'created_at'], 'NULL')} AS data_referencia`;

            const where = [];
            const params = [];
            if (statusList.length) {
                where.push('LOWER(TRIM(p.`status`)) IN (?)');
                params.push(statusList);
            }
            const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

            const [rows] = await pool.query(`
                SELECT
                    p.id,
                    ${numeroPedidoSelect},
                    ${clienteSelect},
                    ${valorSelect},
                    ${selectOrNull('valor', 'valor')},
                    ${selectOrNull('status', 'status')},
                    ${selectOrNull('vendedor_id', 'vendedor_id')},
                    ${selectOrNull('vendedor_nome', 'vendedor_nome')},
                    ${selectOrNull('created_at', 'created_at')},
                    ${selectOrNull('updated_at', 'updated_at')},
                    ${selectOrNull('data_faturamento', 'data_faturamento')},
                    ${selectOrNull('prazo_entrega', 'prazo_entrega')},
                    ${dataSelect},
                    NULL AS op_id,
                    NULL AS op_codigo
                FROM pedidos p
                ${joins.join('\n')}
                ${whereSql}
                ORDER BY data_referencia DESC, p.id DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            res.json({ success: true, data: rows, total: rows.length, limit, offset });
        } catch (error) { next(error); }
    });

    // PEDIDOS FATURADOS - AUDITORIA 02/02/2026: Otimizado
    router.get('/pedidos/faturados', async (req, res, next) => {
        try {
            const [rows] = await pool.query(`
                SELECT
                    p.id, p.cliente_id, p.empresa_id, p.vendedor_id,
                    p.valor, p.valor AS valor_total, p.status, p.prioridade,
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
            const query = req.query.q || req.query.termo || '';
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
                error: 'Erro interno no servidor. Tente novamente.'
            });
        }
    });

    // Função para gerar ordem com ExcelJS (formato válido)
    async function gerarOrdemComExcelJS(workbook, worksheet, dados, outputPath) {
        console.log('\n🎯 GERANDO ORDEM COM EXCELJS...');

        // === CABEÇALHO ===
        worksheet.mergeCells('A1:K1');
        const tituloCell = worksheet.getCell('A1');
        tituloCell.value = 'ORDEM DE PRODUÇÃO ZYNTRA';
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
                erro: 'Erro interno ao processar ordem',
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
            const limit = Math.min(parseInt(req.query.limit) || 50, 200);

            if (!query) {
                const [rows] = await pool.query(`
                    SELECT id, nome_completo as nome, cargo, departamento
                    FROM funcionarios
                    WHERE status = 'ativo' AND (cargo LIKE '%vendedor%' OR cargo LIKE '%comercial%' OR cargo LIKE '%representante%' OR departamento LIKE '%vendas%' OR departamento LIKE '%comercial%')
                    ORDER BY nome_completo
                    LIMIT ?
                `, [limit]);
                return res.json(rows);
            }

            const searchPattern = `%${query}%`;
            const [rows] = await pool.query(`
                SELECT id, nome_completo as nome, cargo, departamento
                FROM funcionarios
                WHERE status = 'ativo'
                AND (cargo LIKE '%vendedor%' OR cargo LIKE '%comercial%' OR cargo LIKE '%representante%' OR departamento LIKE '%vendas%' OR departamento LIKE '%comercial%')
                AND (nome_completo LIKE ? OR cargo LIKE ?)
                ORDER BY nome_completo
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
                error: 'Erro interno no servidor. Tente novamente.'
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
            res.status(500).json({ success: false, message: 'Erro ao atualizar status', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao buscar materiais', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao buscar itens da ordem', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao listar colunas', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao listar colunas', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Criar nova coluna/etapa
    router.post('/kanban-colunas', async (req, res) => {
        const { codigo, nome, descricao, cor, icone } = req.body;
        console.log('[API_PCP] Criando nova coluna kanban:', nome);

        // AUDIT-FIX S7.5: Validar input
        if (!nome || typeof nome !== 'string' || nome.trim().length === 0 || nome.trim().length > 100) {
            return res.status(400).json({ success: false, message: 'Nome é obrigatório (máx 100 caracteres)' });
        }
        if (cor && !/^#[0-9a-fA-F]{6}$/.test(cor)) {
            return res.status(400).json({ success: false, message: 'Cor deve ser hexadecimal (#RRGGBB)' });
        }

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
            res.status(500).json({ success: false, message: 'Erro ao criar coluna', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Reordenar colunas (IMPORTANTE: deve vir ANTES das rotas com :id)
    router.put('/kanban-colunas/reordenar', async (req, res) => {
        const { ordem } = req.body; // Array de { id, ordem }
        console.log('[API_PCP] Reordenando colunas kanban');

        // AUDIT-FIX S7.1: Validar input + transaction
        if (!Array.isArray(ordem) || ordem.length === 0 || ordem.length > 100) {
            return res.status(400).json({ success: false, message: 'Dados de ordenação inválidos' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const item of ordem) {
                const id = parseInt(item.id);
                const pos = parseInt(item.ordem);
                if (!Number.isInteger(id) || !Number.isInteger(pos) || id <= 0) continue;
                await conn.query('UPDATE kanban_colunas_pcp SET ordem = ? WHERE id = ?', [pos, id]);
            }
            await conn.commit();
            res.json({ success: true, message: 'Colunas reordenadas com sucesso' });
        } catch (error) {
            await conn.rollback().catch(() => {});
            console.error('[API_PCP] Erro ao reordenar colunas:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao reordenar colunas', error: 'Erro interno no servidor. Tente novamente.' });
        } finally {
            conn.release();
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
            res.status(500).json({ success: false, message: 'Erro ao atualizar coluna', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao excluir coluna', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao excluir ordem', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao atualizar ordem', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao duplicar ordem', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao concluir ordem', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao buscar anexos', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao buscar histórico', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao buscar tarefas', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao criar tarefa', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao gerar etiqueta', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao gerar etiqueta', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao gerar PDF', error: 'Erro interno no servidor. Tente novamente.' });
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
                error: 'Erro interno no servidor. Tente novamente.'
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
            res.status(500).json({ success: false, message: 'Erro ao buscar composição', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao calcular materiais', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao atualizar composição', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao listar composições', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ error: 'Erro ao calcular materiais', message: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ message: 'Erro ao listar operadores', error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ success: false, message: 'Erro ao listar matérias-primas', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // =================== APONTAMENTOS DE PRODUÇÃO ===================

    // Cache para verificação de colunas extras (evita query a cada POST)
    let _hasExtraColumnsCache = null; // null = não verificado, true/false = resultado
    async function checkHasExtraColumns() {
        if (_hasExtraColumnsCache !== null) return _hasExtraColumnsCache;
        try {
            await pool.query('SELECT pedido_id, maquina FROM apontamentos_producao LIMIT 0');
            _hasExtraColumnsCache = true;
        } catch (e) {
            _hasExtraColumnsCache = false;
        }
        return _hasExtraColumnsCache;
    }

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
                    qtd_produzida_hoje: qtdProduzidaHoje,
                    total_segundos_hoje: qtdProduzidaHoje
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

    // Cache de detecção de colunas opcionais da tabela apontamentos_producao
    // (evita falha de SQL parse quando colunas não existem no schema)
    let _apColsCache = null;
    async function detectApontamentosColumns() {
        if (_apColsCache) return _apColsCache;
        const cols = {
            hora_inicio: false, hora_fim: false, data_apontamento: false,
            data_inicio: false, data_fim: false, created_at: false,
            duracao_segundos: false, tempo_producao: false,
            operador: false, operador_id: false, usuario_id: false,
            tipo_atividade: false, nome_atividade: false,
            pedido_id: false, produto_descricao: false, observacoes: false,
            ordem_producao_id: false, maquina: false, quantidade_produzida: false
        };
        try {
            const [rows] = await pool.query(`SHOW COLUMNS FROM apontamentos_producao`);
            for (const r of rows) {
                if (cols.hasOwnProperty(r.Field)) cols[r.Field] = true;
            }
        } catch (e) {
            // Tabela não existe - todos false
        }
        // Detectar foto/avatar em usuarios (uma vez)
        let userFoto = null;
        try {
            const [u] = await pool.query(`SHOW COLUMNS FROM usuarios`);
            const names = new Set(u.map(r => r.Field));
            if (names.has('foto')) userFoto = 'u.foto';
            else if (names.has('avatar')) userFoto = 'u.avatar';
        } catch (e) {}
        cols._userFoto = userFoto || `''`;
        _apColsCache = cols;
        return cols;
    }

    // Helper: monta expressão SQL para "data do apontamento" usando colunas
    // que realmente existem no schema. Sempre retorna uma expressão válida.
    function buildApDataExpr(c) {
        const parts = [];
        if (c.hora_inicio)        parts.push('ap.hora_inicio');
        if (c.data_apontamento)   parts.push('ap.data_apontamento');
        if (c.data_inicio)        parts.push('ap.data_inicio');
        if (c.created_at)         parts.push('ap.created_at');
        if (parts.length === 0)   return 'NULL';
        if (parts.length === 1)   return parts[0];
        return `COALESCE(${parts.join(', ')})`;
    }
    function buildApDuracaoExpr(c) {
        const parts = [];
        if (c.duracao_segundos) parts.push('ap.duracao_segundos');
        if (c.tempo_producao)   parts.push('(ap.tempo_producao * 60)'); // minutos -> segundos
        if (c.hora_inicio && c.hora_fim) parts.push('TIMESTAMPDIFF(SECOND, ap.hora_inicio, ap.hora_fim)');
        if (c.data_inicio && c.data_fim) parts.push('TIMESTAMPDIFF(SECOND, ap.data_inicio, ap.data_fim)');
        parts.push('0');
        return `COALESCE(${parts.join(', ')})`;
    }

    // Relatório de apontamentos (para supervisores/gerentes)
    router.get('/apontamentos/relatorio', async (req, res) => {
        console.log('[API_APONTAMENTOS] Gerando relatório...');
        try {
            const { dataInicio, dataFim, usuario, atividade, pedido } = req.query;

            // Detectar colunas existentes (evita SQL parse error)
            const c = await detectApontamentosColumns();
            const dataExpr = buildApDataExpr(c);
            const duracaoExpr = buildApDuracaoExpr(c);
            const userFoto = c._userFoto;

            let whereClause = 'WHERE 1=1';
            const params = [];

            if (dataInicio && dataExpr !== 'NULL') {
                whereClause += ` AND DATE(${dataExpr}) >= ?`;
                params.push(dataInicio);
            }
            if (dataFim && dataExpr !== 'NULL') {
                whereClause += ` AND DATE(${dataExpr}) <= ?`;
                params.push(dataFim);
            }
            if (usuario && (c.usuario_id || c.operador_id)) {
                whereClause += c.usuario_id ? ' AND ap.usuario_id = ?' : ' AND ap.operador_id = ?';
                params.push(usuario);
            }
            if (atividade && c.tipo_atividade) {
                whereClause += ' AND ap.tipo_atividade = ?';
                params.push(atividade);
            }
            if (pedido && c.pedido_id) {
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

            // Selects condicionais por coluna existente
            const selId          = 'ap.id';
            const selUsuarioId   = c.usuario_id ? 'ap.usuario_id' : (c.operador_id ? 'ap.operador_id' : 'NULL') + ' as usuario_id';
            const selUsuarioNome = `COALESCE(u.nome${c.operador ? ', ap.operador' : ''}, 'Desconhecido') as usuario_nome`;
            const selUsuarioFoto = `${userFoto} as usuario_foto`;
            const selTipo        = c.tipo_atividade ? `COALESCE(ap.tipo_atividade, 'outros') as tipo` : `'outros' as tipo`;
            const selNome        = c.nome_atividade
                ? `COALESCE(ap.nome_atividade${c.tipo_atividade ? ', ap.tipo_atividade' : ''}, 'Sem nome') as nome`
                : (c.tipo_atividade ? `COALESCE(ap.tipo_atividade, 'Sem nome') as nome` : `'Sem nome' as nome`);
            const selData        = `DATE(${dataExpr}) as data`;
            const selHoraIni     = c.hora_inicio ? `TIME_FORMAT(ap.hora_inicio, '%H:%i') as hora_inicio` : `NULL as hora_inicio`;
            const selHoraFim     = c.hora_fim ? `TIME_FORMAT(ap.hora_fim, '%H:%i') as hora_fim` : `NULL as hora_fim`;
            const selDuracao     = `${duracaoExpr} as duracao`;
            const selOpCodigo    = c.ordem_producao_id ? `op.codigo as op_codigo` : `NULL as op_codigo`;
            const selPedidoId    = c.pedido_id ? `ap.pedido_id` : `NULL as pedido_id`;
            const selPedidoNum   = c.pedido_id ? `COALESCE(ped.numero, ap.pedido_id) as pedido_numero` : `NULL as pedido_numero`;
            const selProdDesc    = c.produto_descricao ? `ap.produto_descricao` : `NULL as produto_descricao`;
            const selObs         = c.observacoes ? `ap.observacoes` : `NULL as observacoes`;

            const joinUsuarios = `LEFT JOIN usuarios u ON ap.${c.usuario_id ? 'usuario_id' : (c.operador_id ? 'operador_id' : 'id')} = u.id`;
            const joinOrdens   = c.ordem_producao_id ? `LEFT JOIN ordens_producao op ON ap.ordem_producao_id = op.id` : '';
            const joinPedidos  = c.pedido_id ? `LEFT JOIN pedidos ped ON ap.pedido_id = ped.id` : '';

            // Buscar apontamentos
            const [apontamentos] = await pool.query(`
                SELECT
                    ${selId},
                    ${selUsuarioId},
                    ${selUsuarioNome},
                    ${selUsuarioFoto},
                    ${selTipo},
                    ${selNome},
                    ${selData},
                    ${selHoraIni},
                    ${selHoraFim},
                    ${selDuracao},
                    ${selOpCodigo},
                    ${selPedidoId},
                    ${selPedidoNum},
                    ${selProdDesc},
                    ${selObs}
                FROM apontamentos_producao ap
                ${joinUsuarios}
                ${joinOrdens}
                ${joinPedidos}
                ${whereClause}
                ORDER BY ${dataExpr} DESC
                LIMIT 500
            `, params);

            // Buscar funcionários únicos que fizeram apontamentos
            const userIdCol = c.usuario_id ? 'ap.usuario_id' : (c.operador_id ? 'ap.operador_id' : 'NULL');
            const [funcionarios] = await pool.query(`
                SELECT DISTINCT
                    COALESCE(${userIdCol}, 0) as id,
                    COALESCE(u.nome${c.operador ? ', ap.operador' : ''}, 'Desconhecido') as nome,
                    ${userFoto} as foto,
                    '' as departamento,
                    'user' as role
                FROM apontamentos_producao ap
                ${joinUsuarios}
                ${whereClause}
            `, params);

            // Calcular estatísticas
            const totalSegundos = apontamentos.reduce((acc, a) => acc + (Number(a.duracao) || 0), 0);
            const producaoSegundos = apontamentos
                .filter(a => ['producao', '1', '1A'].includes(a.tipo))
                .reduce((acc, a) => acc + (Number(a.duracao) || 0), 0);

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
            // Fallback: retorna estrutura vazia em vez de 500 para não quebrar a UI
            res.json({
                success: true,
                apontamentos: [],
                funcionarios: [],
                totalFuncionarios: 0,
                totalHoras: 0,
                horasProducao: 0,
                totalApontamentos: 0,
                _warning: 'Apontamentos indisponíveis no momento'
            });
        }
    });

    // Salvar apontamento
    router.post('/apontamentos', async (req, res) => {
        try {
            const { tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos, ordem_producao_id, pedido_numero, produto_descricao, observacoes, maquina, turno, quantidade_produzida, quantidade_refugo } = req.body;
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

            // Verificar se colunas extras existem (com cache)
            const hasExtraColumns = await checkHasExtraColumns();

            let result;
            if (hasExtraColumns) {
                [result] = await pool.query(`
                    INSERT INTO apontamentos_producao
                    (usuario_id, operador, maquina, turno, ordem_producao_id, tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos, quantidade_produzida, quantidade_refugo, pedido_id, produto_descricao, observacoes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    usuario_id,
                    operador,
                    maquina || null,
                    turno || null,
                    ordem_producao_id || null,
                    tipo_atividade,
                    nome_atividade,
                    horaInicioFormatada,
                    horaFimFormatada,
                    duracao_segundos || 0,
                    quantidade_produzida || 0,
                    quantidade_refugo || 0,
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
            res.status(500).json({ success: false, message: 'Erro ao salvar apontamento', error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // Listar apontamentos do usuário logado
    // Handler compartilhado: apontamentos do usuário (usado em /meus e /mcvs)
    async function _listarApontamentosUsuario(req, res) {
        console.log('[API_APONTAMENTOS] Listando apontamentos do usuário...');
        try {
            const usuario_id = req.user?.id;
            const { data } = req.query;

            // Verificar se a tabela existe
            try {
                await pool.query('SELECT 1 FROM apontamentos_producao LIMIT 1');
            } catch (e) {
                return res.json({ success: true, apontamentos: [] });
            }

            let whereClause = 'WHERE ap.usuario_id = ?';
            const params = [usuario_id];

            if (data) {
                whereClause += ' AND DATE(ap.hora_inicio) = ?';
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
                    COALESCE(CAST(ped.id AS CHAR), CAST(ap.pedido_id AS CHAR)) as pedido_numero,
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
    }

    // /mcvs é alias de /meus (compatibilidade com versões anteriores do front-end)
    router.get('/apontamentos/mcvs', _listarApontamentosUsuario);

    router.get('/apontamentos/meus', _listarApontamentosUsuario);


    // ==================== ROTAS DE RELATÓRIOS PCP (extraído → routes/pcp/relatorios.js) ====================
    require('./pcp/relatorios')(router, pool);

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
            if (req.body.frete_opcoes || req.body['frete_opções']) data.parametros.frete_opcoes = req.body.frete_opcoes || req.body['frete_opções'];
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

    // Aplicar preços calculados aos produtos no MySQL
    router.post('/arvore-produto/aplicar-precos', async (req, res) => {
        try {
            const { precos } = req.body;
            if (!Array.isArray(precos) || precos.length === 0) {
                return res.status(400).json({ success: false, message: 'Nenhum preço informado.' });
            }
            // Primeiro garantir que a coluna preco_venda tenha precisão suficiente para preços por metro
            try {
                await pool.query('ALTER TABLE produtos MODIFY COLUMN preco_venda DECIMAL(15,4) DEFAULT 0');
            } catch (e) { /* coluna já pode estar com a precisão correta */ }

            let atualizados = 0;
            for (const item of precos) {
                if (!item.codigo || item.preco_venda === undefined) continue;
                const pv = parseFloat(item.preco_venda);
                if (isNaN(pv) || pv < 0) continue;
                const [result] = await pool.query(
                    'UPDATE produtos SET preco_venda = ? WHERE codigo = ? OR TRIM(codigo) = ?',
                    [pv, item.codigo, item.codigo.trim()]
                );
                atualizados += result.affectedRows;
            }
            console.log(`[PCP] Preços aplicados: ${atualizados} produtos atualizados`);
            res.json({ success: true, atualizados, total: precos.length });
        } catch (err) {
            console.error('[PCP] Erro ao aplicar preços:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao aplicar preços.' });
        }
    });

    // =====================================================
    // ROTAS ADICIONADAS — Correção de botões quebrados
    // =====================================================

    // BUSCA GLOBAL — Usado pela barra de pesquisa do dashboard PCP
    router.get('/search', async (req, res) => {
        try {
            const q = req.query.q || '';
            const type = req.query.type || '';
            const limit = parseInt(req.query.limit) || 20;

            if (!q || q.length < 2) {
                return res.json({ results: { ordens: [], materiais: [], produtos: [], pedidos: [] } });
            }

            const searchPattern = `%${q}%`;
            const results = {};

            // Buscar ordens
            if (!type || type === 'ordens' || type === 'Ordem') {
                try {
                    const [ordens] = await pool.query(
                        `SELECT id, codigo_produto, descricao_produto, cliente, status
                         FROM ordens_producao
                         WHERE codigo_produto LIKE ? OR descricao_produto LIKE ? OR cliente LIKE ? OR CAST(id AS CHAR) = ?
                         ORDER BY id DESC LIMIT ?`,
                        [searchPattern, searchPattern, searchPattern, q, limit]
                    );
                    results.ordens = ordens;
                } catch (e) { results.ordens = []; }
            }

            // Buscar materiais
            if (!type || type === 'materiais' || type === 'Material') {
                try {
                    const [materiais] = await pool.query(
                        `SELECT id, codigo_material, descricao, quantidade_estoque
                         FROM materiais
                         WHERE codigo_material LIKE ? OR descricao LIKE ?
                         ORDER BY descricao LIMIT ?`,
                        [searchPattern, searchPattern, limit]
                    );
                    results.materiais = materiais;
                } catch (e) { results.materiais = []; }
            }

            // Buscar produtos
            if (!type || type === 'produtos' || type === 'Produto') {
                try {
                    const [produtos] = await pool.query(
                        `SELECT id, codigo, nome AS descricao, estoque_atual AS quantidade_estoque
                         FROM produtos
                         WHERE codigo LIKE ? OR nome LIKE ? OR gtin LIKE ? OR sku LIKE ?
                         ORDER BY nome LIMIT ?`,
                        [searchPattern, searchPattern, searchPattern, searchPattern, limit]
                    );
                    results.produtos = produtos;
                } catch (e) { results.produtos = []; }
            }

            // Buscar pedidos
            if (!type || type === 'pedidos' || type === 'Pedido') {
                try {
                    const [pedidos] = await pool.query(
                        `SELECT id, cliente, produto_id, quantidade, status
                         FROM pedidos
                         WHERE cliente LIKE ? OR CAST(id AS CHAR) = ? OR produto_id LIKE ?
                         ORDER BY id DESC LIMIT ?`,
                        [searchPattern, q, searchPattern, limit]
                    );
                    results.pedidos = pedidos;
                } catch (e) { results.pedidos = []; }
            }

            res.json({ results });
        } catch (error) {
            console.error('[PCP/SEARCH] Erro:', error.message);
            res.status(500).json({ results: { ordens: [], materiais: [], produtos: [], pedidos: [] } });
        }
    });

    // EXPORT PDF — Produtos (gera HTML para impressão no navegador)
    router.get('/produtos/export-pdf', async (req, res) => {
        try {
            const [produtos] = await pool.query(
                `SELECT id, codigo, nome, sku, gtin, unidade_medida, estoque_atual, categoria, custo_unitario
                 FROM produtos WHERE (ativo = 1 OR ativo IS NULL)
                 ORDER BY nome`
            );

            const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Catálogo de Produtos</title>
<style>
body{font-family:Arial,sans-serif;margin:20px;color:#333}
h1{text-align:center;color:#1e40af;margin-bottom:5px}
.subtitle{text-align:center;color:#64748b;margin-bottom:20px;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#1e40af;color:#fff;padding:8px 6px;text-align:left}
td{padding:6px;border-bottom:1px solid #e2e8f0}
tr:nth-child(even){background:#f8fafc}
.footer{text-align:center;margin-top:20px;font-size:11px;color:#94a3b8}
@media print{body{margin:0}h1{font-size:18px}.no-print{display:none}}
</style></head><body>
<h1>Catálogo de Produtos — Zyntra</h1>
<p class="subtitle">Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')} — ${produtos.length} produtos</p>
<table><thead><tr><th>Código</th><th>Descrição</th><th>SKU</th><th>GTIN</th><th>Unidade</th><th>Estoque</th><th>Categoria</th><th>Custo Unit.</th></tr></thead>
<tbody>${produtos.map(p => `<tr><td>${p.codigo || ''}</td><td>${p.nome || ''}</td><td>${p.sku || ''}</td><td>${p.gtin || ''}</td><td>${p.unidade_medida || ''}</td><td>${Number(p.estoque_atual || 0).toFixed(2)}</td><td>${p.categoria || ''}</td><td>R$ ${Number(p.custo_unitario || 0).toFixed(2)}</td></tr>`).join('')}
</tbody></table>
<p class="footer">Zyntra — Sistema PCP</p>
</body></html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="catalogo_produtos_${new Date().toISOString().split('T')[0]}.html"`);
            res.send(html);
        } catch (error) {
            console.error('[PCP/EXPORT-PDF] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao gerar catálogo' });
        }
    });

    // EXPORT PDF — Materiais (gera HTML para impressão no navegador)
    router.get('/materiais/export-pdf', async (req, res) => {
        try {
            const [materiais] = await pool.query(
                `SELECT id, codigo_material, descricao, unidade_medida, quantidade_estoque, preco_unitario, fornecedor
                 FROM materiais ORDER BY descricao`
            );

            const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Catálogo de Materiais</title>
<style>
body{font-family:Arial,sans-serif;margin:20px;color:#333}
h1{text-align:center;color:#1e40af;margin-bottom:5px}
.subtitle{text-align:center;color:#64748b;margin-bottom:20px;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#1e40af;color:#fff;padding:8px 6px;text-align:left}
td{padding:6px;border-bottom:1px solid #e2e8f0}
tr:nth-child(even){background:#f8fafc}
.footer{text-align:center;margin-top:20px;font-size:11px;color:#94a3b8}
@media print{body{margin:0}h1{font-size:18px}}
</style></head><body>
<h1>Catálogo de Materiais — Zyntra</h1>
<p class="subtitle">Gerado em ${new Date().toLocaleDateString('pt-BR')} — ${materiais.length} materiais</p>
<table><thead><tr><th>Código</th><th>Descrição</th><th>Unidade</th><th>Estoque</th><th>Preço Unit.</th><th>Fornecedor</th></tr></thead>
<tbody>${materiais.map(m => `<tr><td>${m.codigo_material || ''}</td><td>${m.descricao || ''}</td><td>${m.unidade_medida || ''}</td><td>${Number(m.quantidade_estoque || 0).toFixed(2)}</td><td>R$ ${Number(m.preco_unitario || 0).toFixed(2)}</td><td>${m.fornecedor || ''}</td></tr>`).join('')}
</tbody></table>
<p class="footer">Zyntra — Sistema PCP</p>
</body></html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="catalogo_materiais_${new Date().toISOString().split('T')[0]}.html"`);
            res.send(html);
        } catch (error) {
            console.error('[PCP/EXPORT-PDF-MAT] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao gerar catálogo de materiais' });
        }
    });

    // RECEBIMENTOS — Registrar recebimento de material
    router.post('/recebimentos', async (req, res) => {
        try {
            const { data, nome, numero_nf, fornecedor, material, observacao, responsavel } = req.body;

            if (!data || !nome || !numero_nf || !fornecedor || !material) {
                return res.status(400).json({ message: 'Campos obrigatórios: data, nome, numero_nf, fornecedor, material' });
            }

            // Verificar se tabela existe, criar se não
            try {
                await pool.query('SELECT 1 FROM recebimentos_compras LIMIT 0');
            } catch (e) {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS recebimentos_compras (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        data DATE NOT NULL,
                        nome VARCHAR(255) NOT NULL,
                        numero_nf VARCHAR(100) NOT NULL,
                        fornecedor VARCHAR(255) NOT NULL,
                        material VARCHAR(255) NOT NULL,
                        observacao TEXT,
                        responsavel VARCHAR(255),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            }

            const [result] = await pool.query(
                `INSERT INTO recebimentos_compras (data, nome, numero_nf, fornecedor, material, observacao, responsavel)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [data, nome, numero_nf, fornecedor, material, observacao || null, responsavel || null]
            );

            res.status(201).json({ success: true, message: 'Recebimento registrado com sucesso', id: result.insertId });
        } catch (error) {
            console.error('[PCP/RECEBIMENTOS] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao registrar recebimento' });
        }
    });

    // EXTRUSÃO — Registrar dados de extrusão
    router.post('/extrusao', async (req, res) => {
        try {
            const { data, lote, extrusora, descricao, secao, metragem, bobinas, lote_corda,
                    lote_polimero, lote_corante, inspecao_visual, diametro, operador, observacoes } = req.body;

            if (!data || !lote || !extrusora || !descricao || !metragem || !operador) {
                return res.status(400).json({ message: 'Campos obrigatórios: data, lote, extrusora, descricao, metragem, operador' });
            }

            // Verificar/criar tabela
            try {
                await pool.query('SELECT 1 FROM extrusao_registros LIMIT 0');
            } catch (e) {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS extrusao_registros (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        data DATE NOT NULL,
                        lote VARCHAR(50) NOT NULL,
                        extrusora VARCHAR(100) NOT NULL,
                        descricao VARCHAR(255) NOT NULL,
                        secao VARCHAR(100),
                        metragem DECIMAL(12,2) NOT NULL,
                        bobinas INT,
                        lote_corda VARCHAR(100),
                        lote_polimero VARCHAR(100),
                        lote_corante VARCHAR(100),
                        inspecao_visual VARCHAR(50),
                        diametro DECIMAL(10,4),
                        operador VARCHAR(255) NOT NULL,
                        observacoes TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            }

            const [result] = await pool.query(
                `INSERT INTO extrusao_registros
                 (data, lote, extrusora, descricao, secao, metragem, bobinas, lote_corda, lote_polimero, lote_corante, inspecao_visual, diametro, operador, observacoes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [data, lote, extrusora, descricao, secao || null, metragem, bobinas || null,
                 lote_corda || null, lote_polimero || null, lote_corante || null,
                 inspecao_visual || null, diametro || null, operador, observacoes || null]
            );

            res.status(201).json({ success: true, message: 'Registro de extrusão salvo com sucesso', id: result.insertId });
        } catch (error) {
            console.error('[PCP/EXTRUSAO] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao salvar registro de extrusão' });
        }
    });

    // NOTIFICAR ATIVIDADE — Push notification de ações de apontamento (início, pausa, finalização)
    router.post('/notificar-atividade', async (req, res) => {
        try {
            const { tipo_atividade, nome_atividade, acao, duracao } = req.body;
            const operador = req.user?.nome || req.body.operador || 'Operador';

            console.log(`[PCP/NOTIFICACAO] ${operador} ${acao} ${nome_atividade} (${tipo_atividade})${duracao ? ' — Duração: ' + duracao : ''}`);

            // Emitir via WebSocket para todos os clientes PCP conectados
            if (global.io) {
                global.io.emit('pcp-atividade', {
                    tipo: tipo_atividade,
                    nome: nome_atividade,
                    operador: operador || 'Operador',
                    acao: acao,
                    duracao: duracao || null,
                    timestamp: new Date().toISOString()
                });
            }

            res.json({ success: true });
        } catch (error) {
            console.error('[PCP/NOTIFICACAO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao notificar' });
        }
    });

    // APONTAMENTOS CHÃO DE FÁBRICA — Endpoint específico para salvar registros do chão de fábrica
    router.post('/apontamentos/chao', async (req, res) => {
        try {
            const { tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos, ordem_producao_id, pedido_numero, produto_descricao, observacoes, maquina, turno, quantidade_produzida, quantidade_refugo } = req.body;
            const usuario_id = req.user?.id;
            const operador = req.user?.nome || 'Operador';

            if (!tipo_atividade || !nome_atividade) {
                return res.status(400).json({ success: false, message: 'tipo_atividade e nome_atividade são obrigatórios' });
            }

            const horaInicioFormatada = hora_inicio ? new Date(hora_inicio).toISOString().slice(0, 19).replace('T', ' ') : null;
            const horaFimFormatada = hora_fim ? new Date(hora_fim).toISOString().slice(0, 19).replace('T', ' ') : null;

            // Anti-duplicidade: rejeitar se existe registro idêntico nos últimos 30s
            if (horaInicioFormatada) {
                try {
                    const [dup] = await pool.query(
                        `SELECT id FROM apontamentos_producao
                         WHERE usuario_id = ? AND tipo_atividade = ? AND hora_inicio = ?
                         AND created_at >= DATE_SUB(NOW(), INTERVAL 30 SECOND) LIMIT 1`,
                        [usuario_id, tipo_atividade, horaInicioFormatada]
                    );
                    if (dup.length > 0) {
                        console.log('[PCP/APONTAMENTOS/CHAO] Duplicidade detectada, ignorando');
                        return res.json({ success: true, id: dup[0].id, duplicate: true });
                    }
                } catch (e) { /* coluna created_at pode não existir — prosseguir */ }
            }

            // Buscar pedido_id se pedido_numero fornecido
            let pedidoId = null;
            if (pedido_numero) {
                try {
                    const [pedidos] = await pool.query('SELECT id FROM pedidos WHERE id = ? OR numero = ? LIMIT 1', [pedido_numero, pedido_numero]);
                    if (pedidos.length > 0) pedidoId = pedidos[0].id;
                } catch (e) { /* pedido não encontrado — ok */ }
            }

            // Verificar colunas extras (com cache)
            const hasExtraColumns = await checkHasExtraColumns();

            let result;
            if (hasExtraColumns) {
                [result] = await pool.query(
                    `INSERT INTO apontamentos_producao
                     (usuario_id, operador, maquina, turno, ordem_producao_id, tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos, quantidade_produzida, quantidade_refugo, pedido_id, produto_descricao, observacoes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [usuario_id, operador, maquina || null, turno || null, ordem_producao_id || null, tipo_atividade, nome_atividade,
                     horaInicioFormatada, horaFimFormatada, duracao_segundos || 0,
                     quantidade_produzida || 0, quantidade_refugo || 0,
                     pedidoId, produto_descricao || null, observacoes || null]
                );
            } else {
                [result] = await pool.query(
                    `INSERT INTO apontamentos_producao
                     (usuario_id, operador, ordem_producao_id, tipo_atividade, nome_atividade, hora_inicio, hora_fim, duracao_segundos)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [usuario_id, operador, ordem_producao_id || null, tipo_atividade, nome_atividade,
                     horaInicioFormatada, horaFimFormatada, duracao_segundos || 0]
                );
            }

            console.log('[PCP/APONTAMENTOS/CHAO] Registro salvo, id:', result.insertId);
            res.json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('[PCP/APONTAMENTOS/CHAO] Erro:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao salvar apontamento' });
        }
    });

    // Editar apontamento
    router.put('/apontamentos/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const usuario_id = req.user?.id;
            const { tipo_atividade, nome_atividade, observacoes, pedido_numero, produto_descricao } = req.body;

            // Verificar se o apontamento pertence ao usuário
            const [existing] = await pool.query(
                'SELECT id, usuario_id FROM apontamentos_producao WHERE id = ?', [id]
            );
            if (!existing.length) {
                return res.status(404).json({ success: false, message: 'Apontamento não encontrado' });
            }
            if (existing[0].usuario_id !== usuario_id && req.user?.role !== 'admin') {
                return res.status(403).json({ success: false, message: 'Sem permissão para editar este apontamento' });
            }

            const updates = [];
            const params = [];
            if (tipo_atividade) { updates.push('tipo_atividade = ?'); params.push(tipo_atividade); }
            if (nome_atividade) { updates.push('nome_atividade = ?'); params.push(nome_atividade); }
            if (observacoes !== undefined) { updates.push('observacoes = ?'); params.push(observacoes); }
            if (produto_descricao !== undefined) { updates.push('produto_descricao = ?'); params.push(produto_descricao); }
            if (pedido_numero !== undefined) {
                let pedidoId = null;
                if (pedido_numero) {
                    try {
                        const [pedidos] = await pool.query('SELECT id FROM pedidos WHERE id = ? OR numero = ? LIMIT 1', [pedido_numero, pedido_numero]);
                        if (pedidos.length > 0) pedidoId = pedidos[0].id;
                    } catch (e) { /* ok */ }
                }
                updates.push('pedido_id = ?'); params.push(pedidoId);
            }

            if (!updates.length) {
                return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
            }

            params.push(id);
            await pool.query(`UPDATE apontamentos_producao SET ${updates.join(', ')} WHERE id = ?`, params);
            console.log('[PCP/APONTAMENTOS] Apontamento editado:', id);
            res.json({ success: true, message: 'Apontamento atualizado' });
        } catch (error) {
            console.error('[PCP/APONTAMENTOS] Erro ao editar:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao editar apontamento' });
        }
    });

    // Excluir/cancelar apontamento
    router.delete('/apontamentos/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const usuario_id = req.user?.id;

            const [existing] = await pool.query(
                'SELECT id, usuario_id FROM apontamentos_producao WHERE id = ?', [id]
            );
            if (!existing.length) {
                return res.status(404).json({ success: false, message: 'Apontamento não encontrado' });
            }
            if (existing[0].usuario_id !== usuario_id && req.user?.role !== 'admin') {
                return res.status(403).json({ success: false, message: 'Sem permissão para excluir este apontamento' });
            }

            await pool.query('DELETE FROM apontamentos_producao WHERE id = ?', [id]);
            console.log('[PCP/APONTAMENTOS] Apontamento excluído:', id);
            res.json({ success: true, message: 'Apontamento excluído' });
        } catch (error) {
            console.error('[PCP/APONTAMENTOS] Erro ao excluir:', error.message);
            res.status(500).json({ success: false, message: 'Erro ao excluir apontamento' });
        }
    });

    // ============================================================
    // QUALIDADE - Inspeções, Não Conformidades, Checklists
    // ============================================================

    // --- KPIs ---
    router.get('/qualidade/kpis', authenticateToken, asyncHandler(async (req, res) => {
        const now = new Date();
        const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const [[insp]] = await pool.query(
            `SELECT COUNT(*) as total, SUM(status='aprovado') as aprovados, SUM(status='pendente') as pendentes
             FROM qualidade_inspecoes WHERE data_inspecao >= ?`, [firstDay]);
        const [[ncs]] = await pool.query(
            `SELECT COUNT(*) as abertas FROM qualidade_nao_conformidades WHERE status IN ('aberta','em_analise','acao_corretiva')`);
        const [[cks]] = await pool.query(
            `SELECT COUNT(*) as ativos FROM qualidade_checklists WHERE ativo = 1`);
        const total = insp.total || 0;
        const aprovados = insp.aprovados || 0;
        const taxa = total > 0 ? Math.round((aprovados / total) * 100) : 0;
        res.json({ success: true, data: {
            total_inspecoes: total,
            taxa_aprovacao: taxa,
            ncs_abertas: ncs.abertas || 0,
            inspecoes_pendentes: insp.pendentes || 0,
            checklists_ativos: cks.ativos || 0
        }});
    }));

    // --- INSPEÇÕES: CRUD ---
    router.get('/qualidade/inspecoes', authenticateToken, asyncHandler(async (req, res) => {
        let sql = 'SELECT * FROM qualidade_inspecoes WHERE 1=1';
        const params = [];
        if (req.query.status) { sql += ' AND status = ?'; params.push(req.query.status); }
        if (req.query.data_inicio) { sql += ' AND data_inspecao >= ?'; params.push(req.query.data_inicio); }
        if (req.query.data_fim) { sql += ' AND data_inspecao <= ?'; params.push(req.query.data_fim); }
        sql += ' ORDER BY data_inspecao DESC, id DESC LIMIT 200';
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, data: rows });
    }));

    router.get('/qualidade/inspecoes/:id', authenticateToken, asyncHandler(async (req, res) => {
        const [rows] = await pool.query('SELECT * FROM qualidade_inspecoes WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Inspeção não encontrada' });
        res.json({ success: true, data: rows[0] });
    }));

    router.post('/qualidade/inspecoes', authenticateToken, asyncHandler(async (req, res) => {
        const { tipo, checklist_id, ordem_producao, produto, quantidade_inspecionada, quantidade_aprovada, observacoes, checklist_respostas, status, data_inspecao } = req.body;
        const inspetor_id = req.user?.id || null;
        const inspetor_nome = req.user?.nome || req.user?.username || null;
        const [result] = await pool.query(
            `INSERT INTO qualidade_inspecoes (tipo, checklist_id, ordem_producao, produto, quantidade_inspecionada, quantidade_aprovada, observacoes, checklist_respostas, status, data_inspecao, inspetor_id, inspetor_nome)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [tipo, checklist_id, ordem_producao, produto, quantidade_inspecionada, quantidade_aprovada, observacoes, checklist_respostas, status || 'pendente', data_inspecao, inspetor_id, inspetor_nome]
        );
        console.log('[PCP/QUALIDADE] Inspeção criada:', result.insertId);
        res.json({ success: true, id: result.insertId });
    }));

    router.put('/qualidade/inspecoes/:id', authenticateToken, asyncHandler(async (req, res) => {
        const { tipo, checklist_id, ordem_producao, produto, quantidade_inspecionada, quantidade_aprovada, observacoes, checklist_respostas, status, data_inspecao } = req.body;
        await pool.query(
            `UPDATE qualidade_inspecoes SET tipo=?, checklist_id=?, ordem_producao=?, produto=?, quantidade_inspecionada=?, quantidade_aprovada=?, observacoes=?, checklist_respostas=?, status=?, data_inspecao=? WHERE id=?`,
            [tipo, checklist_id, ordem_producao, produto, quantidade_inspecionada, quantidade_aprovada, observacoes, checklist_respostas, status, data_inspecao, req.params.id]
        );
        console.log('[PCP/QUALIDADE] Inspeção atualizada:', req.params.id);
        res.json({ success: true });
    }));

    router.delete('/qualidade/inspecoes/:id', authenticateToken, asyncHandler(async (req, res) => {
        await pool.query('DELETE FROM qualidade_inspecoes WHERE id = ?', [req.params.id]);
        console.log('[PCP/QUALIDADE] Inspeção excluída:', req.params.id);
        res.json({ success: true });
    }));

    // --- NÃO CONFORMIDADES: CRUD ---
    router.get('/qualidade/nao-conformidades', authenticateToken, asyncHandler(async (req, res) => {
        let sql = 'SELECT * FROM qualidade_nao_conformidades WHERE 1=1';
        const params = [];
        if (req.query.severidade) { sql += ' AND severidade = ?'; params.push(req.query.severidade); }
        if (req.query.status) { sql += ' AND status = ?'; params.push(req.query.status); }
        sql += ' ORDER BY created_at DESC LIMIT 200';
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, data: rows });
    }));

    router.get('/qualidade/nao-conformidades/:id', authenticateToken, asyncHandler(async (req, res) => {
        const [rows] = await pool.query('SELECT * FROM qualidade_nao_conformidades WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'NC não encontrada' });
        res.json({ success: true, data: rows[0] });
    }));

    router.post('/qualidade/nao-conformidades', authenticateToken, asyncHandler(async (req, res) => {
        const { descricao, severidade, origem, ordem_producao, produto, causa_raiz, acao_corretiva, responsavel, prazo } = req.body;
        const registrado_por = req.user?.id || null;
        const registrado_nome = req.user?.nome || req.user?.username || null;
        const [result] = await pool.query(
            `INSERT INTO qualidade_nao_conformidades (descricao, severidade, origem, ordem_producao, produto, causa_raiz, acao_corretiva, responsavel, prazo, registrado_por, registrado_nome)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [descricao, severidade, origem, ordem_producao, produto, causa_raiz, acao_corretiva, responsavel, prazo, registrado_por, registrado_nome]
        );
        console.log('[PCP/QUALIDADE] NC criada:', result.insertId);
        res.json({ success: true, id: result.insertId });
    }));

    router.put('/qualidade/nao-conformidades/:id', authenticateToken, asyncHandler(async (req, res) => {
        const { descricao, severidade, origem, ordem_producao, produto, causa_raiz, acao_corretiva, responsavel, prazo, status } = req.body;
        await pool.query(
            `UPDATE qualidade_nao_conformidades SET descricao=?, severidade=?, origem=?, ordem_producao=?, produto=?, causa_raiz=?, acao_corretiva=?, responsavel=?, prazo=?, status=? WHERE id=?`,
            [descricao, severidade, origem, ordem_producao, produto, causa_raiz, acao_corretiva, responsavel, prazo, status, req.params.id]
        );
        console.log('[PCP/QUALIDADE] NC atualizada:', req.params.id);
        res.json({ success: true });
    }));

    router.delete('/qualidade/nao-conformidades/:id', authenticateToken, asyncHandler(async (req, res) => {
        await pool.query('DELETE FROM qualidade_nao_conformidades WHERE id = ?', [req.params.id]);
        console.log('[PCP/QUALIDADE] NC excluída:', req.params.id);
        res.json({ success: true });
    }));

    // --- CHECKLISTS: CRUD ---
    router.get('/qualidade/checklists', authenticateToken, asyncHandler(async (req, res) => {
        let sql = `SELECT c.*, (SELECT COUNT(*) FROM qualidade_checklist_itens WHERE checklist_id = c.id) as total_itens
                    FROM qualidade_checklists c WHERE 1=1`;
        const params = [];
        if (req.query.ativo) { sql += ' AND c.ativo = ?'; params.push(req.query.ativo); }
        sql += ' ORDER BY c.nome';
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, data: rows });
    }));

    router.get('/qualidade/checklists/:id', authenticateToken, asyncHandler(async (req, res) => {
        const [rows] = await pool.query('SELECT * FROM qualidade_checklists WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Checklist não encontrado' });
        res.json({ success: true, data: rows[0] });
    }));

    router.get('/qualidade/checklists/:id/itens', authenticateToken, asyncHandler(async (req, res) => {
        const [rows] = await pool.query('SELECT * FROM qualidade_checklist_itens WHERE checklist_id = ? ORDER BY ordem', [req.params.id]);
        res.json({ success: true, data: rows });
    }));

    router.post('/qualidade/checklists', authenticateToken, asyncHandler(async (req, res) => {
        const { nome, tipo_inspecao, itens } = req.body;
        const [result] = await pool.query(
            'INSERT INTO qualidade_checklists (nome, tipo_inspecao) VALUES (?, ?)', [nome, tipo_inspecao]
        );
        const checklistId = result.insertId;
        if (itens && itens.length > 0) {
            const values = itens.map(i => [checklistId, i.descricao, i.ordem || 0]);
            await pool.query('INSERT INTO qualidade_checklist_itens (checklist_id, descricao, ordem) VALUES ?', [values]);
        }
        console.log('[PCP/QUALIDADE] Checklist criado:', checklistId);
        res.json({ success: true, id: checklistId });
    }));

    router.put('/qualidade/checklists/:id', authenticateToken, asyncHandler(async (req, res) => {
        const { nome, tipo_inspecao, itens } = req.body;
        await pool.query('UPDATE qualidade_checklists SET nome=?, tipo_inspecao=? WHERE id=?', [nome, tipo_inspecao, req.params.id]);
        // Rebuild itens
        await pool.query('DELETE FROM qualidade_checklist_itens WHERE checklist_id = ?', [req.params.id]);
        if (itens && itens.length > 0) {
            const values = itens.map(i => [req.params.id, i.descricao, i.ordem || 0]);
            await pool.query('INSERT INTO qualidade_checklist_itens (checklist_id, descricao, ordem) VALUES ?', [values]);
        }
        console.log('[PCP/QUALIDADE] Checklist atualizado:', req.params.id);
        res.json({ success: true });
    }));

    router.delete('/qualidade/checklists/:id', authenticateToken, asyncHandler(async (req, res) => {
        await pool.query('DELETE FROM qualidade_checklist_itens WHERE checklist_id = ?', [req.params.id]);
        await pool.query('DELETE FROM qualidade_checklists WHERE id = ?', [req.params.id]);
        console.log('[PCP/QUALIDADE] Checklist excluído:', req.params.id);
        res.json({ success: true });
    }));


    // ==================== ROTAS DE RELATÓRIOS PCP ====================

    // ==================== ROTAS DE RELATÓRIOS PCP ====================

    // 1. Cabos mais vendidos (ranking por quantidade e valor)
    router.get('/relatórios/cabos-mais-vendidos', async (req, res) => {
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
    router.get('/relatórios/ranking-vendas', async (req, res) => {
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
    router.get('/relatórios/metros-produzidos', async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;

            const fim = data_fim || new Date().toISOString().slice(0, 10);
            const inicio = data_inicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

            // Detecta colunas disponíveis em apontamentos_producao
            const c = await detectApontamentosColumns();
            const dataExpr = buildApDataExpr(c);
            const hasQtd = c.quantidade_produzida;
            const hasTempo = c.tempo_producao || c.duracao_segundos;

            // Apontamentos diários — usa colunas existentes
            let apontamentosDiarios = [];
            let resumoApontamentos = {};
            if (dataExpr !== 'NULL') {
                try {
                    const tempoExpr = c.tempo_producao
                        ? 'SUM(ap.tempo_producao)'
                        : (c.duracao_segundos ? 'SUM(ap.duracao_segundos)/60' : '0');
                    const qtdExpr = hasQtd ? 'SUM(ap.quantidade_produzida)' : '0';
                    const maquinaExpr = c.maquina ? `GROUP_CONCAT(DISTINCT ap.maquina SEPARATOR ', ')` : `''`;
                    const operadorExpr = c.operador ? `GROUP_CONCAT(DISTINCT ap.operador SEPARATOR ', ')` : `''`;

                    [apontamentosDiarios] = await pool.query(`
                        SELECT
                            DATE(${dataExpr}) as data,
                            ${qtdExpr} as quantidade_produzida,
                            ${tempoExpr} as tempo_total_min,
                            COUNT(*) as total_apontamentos,
                            ${maquinaExpr} as maquinas,
                            ${operadorExpr} as operadores
                        FROM apontamentos_producao ap
                        WHERE DATE(${dataExpr}) BETWEEN ? AND ?
                        GROUP BY DATE(${dataExpr})
                        ORDER BY data ASC
                    `, [inicio, fim]);

                    const qtdResumoExpr = hasQtd ? 'ap.quantidade_produzida' : '0';
                    const [resumo] = await pool.query(`
                        SELECT
                            COALESCE(SUM(${qtdResumoExpr}), 0) as total_produzido,
                            COALESCE(AVG(${qtdResumoExpr}), 0) as media_diaria,
                            COALESCE(MAX(${qtdResumoExpr}), 0) as max_dia,
                            COALESCE(MIN(${qtdResumoExpr}), 0) as min_dia,
                            ${tempoExpr} as tempo_total,
                            COUNT(DISTINCT DATE(${dataExpr})) as dias_com_producao
                        FROM apontamentos_producao ap
                        WHERE DATE(${dataExpr}) BETWEEN ? AND ?
                    `, [inicio, fim]);
                    resumoApontamentos = resumo[0] || {};
                } catch (e) {
                    console.warn('[PCP_RELATORIOS] Apontamentos indisponíveis:', e.message);
                }
            }

            // Ordens concluídas por dia — fonte primária quando apontamentos vazios
            let ordensConcluidasDia = [];
            let resumoOrdens = {};
            try {
                [ordensConcluidasDia] = await pool.query(`
                    SELECT
                        DATE(COALESCE(data_conclusao, data_inicio, created_at)) as data,
                        COALESCE(SUM(metragem), 0) as total_metragem,
                        COALESCE(SUM(quantidade), 0) as total_quantidade,
                        COUNT(*) as total_ordens,
                        GROUP_CONCAT(DISTINCT produto_nome SEPARATOR ', ') as produtos
                    FROM ordens_producao
                    WHERE deleted_at IS NULL
                      AND (
                            DATE(COALESCE(data_conclusao, data_inicio, created_at)) BETWEEN ? AND ?
                          )
                    GROUP BY DATE(COALESCE(data_conclusao, data_inicio, created_at))
                    ORDER BY data ASC
                `, [inicio, fim]);

                const [resumoOp] = await pool.query(`
                    SELECT
                        COALESCE(SUM(metragem), 0) as total_metragem,
                        COALESCE(SUM(quantidade), 0) as total_quantidade,
                        COUNT(*) as total_ordens,
                        COUNT(CASE WHEN LOWER(status) IN ('concluida','concluído','concluido','finalizada','finalizado') THEN 1 END) as ordens_concluidas,
                        COUNT(CASE WHEN LOWER(status) IN ('em_producao','em produção','produzindo','iniciada') THEN 1 END) as ordens_em_producao
                    FROM ordens_producao
                    WHERE deleted_at IS NULL
                      AND DATE(COALESCE(data_conclusao, data_inicio, created_at)) BETWEEN ? AND ?
                `, [inicio, fim]);
                resumoOrdens = resumoOp[0] || {};
            } catch (e) {
                console.warn('[PCP_RELATORIOS] Ordens indisponíveis:', e.message);
            }

            // Se apontamentos não tiveram dados, usa ordens como resumo
            const semApontamentos = !apontamentosDiarios.length
                || (Number(resumoApontamentos.total_produzido || 0) === 0 && !hasQtd);

            if (semApontamentos && ordensConcluidasDia.length) {
                const totais = ordensConcluidasDia.map(d => Number(d.total_quantidade || d.total_metragem || 0));
                const totalProd = totais.reduce((a, b) => a + b, 0);
                resumoApontamentos = {
                    total_produzido: totalProd,
                    media_diaria: totais.length ? totalProd / totais.length : 0,
                    max_dia: totais.length ? Math.max(...totais) : 0,
                    min_dia: totais.length ? Math.min(...totais) : 0,
                    tempo_total: 0,
                    dias_com_producao: ordensConcluidasDia.length
                };
            }

            res.json({
                success: true,
                apontamentos_diarios: apontamentosDiarios,
                ordens_por_dia: ordensConcluidasDia,
                resumo_apontamentos: resumoApontamentos,
                resumo_ordens: resumoOrdens,
                periodo: { data_inicio: inicio, data_fim: fim }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro metros produzidos:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de metros produzidos.' });
        }
    });

    // 4. Faturamento mensal
    router.get('/relatórios/faturamento-mensal', async (req, res) => {
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

            // Resumo anual: tenta pedidos_faturados primeiro, depois fallback
            // para pedidos (status faturado/entregue/convertido)
            const [faturamentoAnoAnteriorPF] = await pool.query(`
                SELECT
                    COALESCE(SUM(total), 0) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos_faturados
                WHERE YEAR(data_faturamento) = ?
            `, [anoFiltro - 1]);

            const [faturamentoAnoAtualPF] = await pool.query(`
                SELECT
                    COALESCE(SUM(total), 0) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos_faturados
                WHERE YEAR(data_faturamento) = ?
            `, [anoFiltro]);

            const [faturamentoAnoAtualPed] = await pool.query(`
                SELECT
                    COALESCE(SUM(p.valor), 0) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos p
                WHERE p.status IN ('faturado', 'entregue', 'convertido')
                  AND YEAR(p.created_at) = ?
            `, [anoFiltro]);

            const [faturamentoAnoAnteriorPed] = await pool.query(`
                SELECT
                    COALESCE(SUM(p.valor), 0) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos p
                WHERE p.status IN ('faturado', 'entregue', 'convertido')
                  AND YEAR(p.created_at) = ?
            `, [anoFiltro - 1]);

            // Top clientes — tenta pedidos_faturados, fallback para pedidos
            const [topClientesPF] = await pool.query(`
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

            let topClientes = topClientesPF;
            if (!topClientes || topClientes.length === 0) {
                const [topClientesPed] = await pool.query(`
                    SELECT
                        COALESCE(c.nome, p.cliente_nome, 'Cliente sem nome') as cliente,
                        COUNT(*) as total_pedidos,
                        COALESCE(SUM(p.valor), 0) as valor_total
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    WHERE p.status IN ('faturado', 'entregue', 'convertido')
                      AND YEAR(p.created_at) = ?
                    GROUP BY COALESCE(c.nome, p.cliente_nome, 'Cliente sem nome')
                    ORDER BY valor_total DESC
                    LIMIT 10
                `, [anoFiltro]).catch(() => [[]]);
                topClientes = topClientesPed;
            }

            // Escolhe a fonte que tem dados (PF preferida; senão pedidos)
            const pfAtual = Number(faturamentoAnoAtualPF[0]?.valor_total || 0);
            const pedAtual = Number(faturamentoAnoAtualPed[0]?.valor_total || 0);
            const usarPF = pfAtual >= pedAtual && pfAtual > 0;

            const totalAtual = usarPF ? pfAtual : pedAtual;
            const totalPedidosAtual = usarPF
                ? (faturamentoAnoAtualPF[0]?.total_pedidos || 0)
                : (faturamentoAnoAtualPed[0]?.total_pedidos || 0);
            const totalAnterior = usarPF
                ? Number(faturamentoAnoAnteriorPF[0]?.valor_total || 0)
                : Number(faturamentoAnoAnteriorPed[0]?.valor_total || 0);

            const variacao = totalAnterior > 0
                ? ((totalAtual - totalAnterior) / totalAnterior * 100).toFixed(2)
                : 0;

            res.json({
                success: true,
                faturamento_mensal: faturamentoPF,
                faturamento_pedidos: faturamentoPedidos,
                top_clientes: topClientes,
                resumo: {
                    ano: anoFiltro,
                    valor_total_ano: totalAtual,
                    total_pedidos_ano: totalPedidosAtual,
                    valor_ano_anterior: totalAnterior,
                    variacao_percentual: `${variacao}%`,
                    fonte: usarPF ? 'pedidos_faturados' : 'pedidos'
                }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro faturamento mensal:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de faturamento mensal.' });
        }
    });


    // CARTEIRA DE PEDIDOS
    router.get('/carteira', async (req, res, next) => {
        try {
            const { status, cliente, prioridade, data_inicio, data_fim } = req.query;
            const limit = Math.min(parseInt(req.query.limit) || 500, 1000);

            const conditions = ['p.deleted_at IS NULL'];
            const params = [];

            if (status)      { conditions.push('p.status = ?');                                   params.push(status); }
            if (cliente)     { conditions.push('(p.cliente_nome LIKE ? OR c.nome LIKE ?)');       params.push(`%${cliente}%`, `%${cliente}%`); }
            if (prioridade)  { conditions.push('p.prioridade = ?');                               params.push(prioridade); }
            if (data_inicio) { conditions.push('DATE(p.created_at) >= ?');                        params.push(data_inicio); }
            if (data_fim)    { conditions.push('DATE(p.created_at) <= ?');                        params.push(data_fim); }

            const where = `WHERE ${conditions.join(' AND ')}`;
            params.push(limit);

            const [rows] = await pool.query(`
                SELECT
                    p.id,
                    p.numero_pedido,
                    p.numero_orcamento,
                    COALESCE(c.nome, p.cliente_nome)   AS cliente,
                    p.descricao,
                    p.valor,
                    p.valor AS valor_total,
                    p.status,
                    p.prioridade,
                    p.prazo_entrega,
                    p.condicao_pagamento,
                    p.nfe_numero,
                    p.nfe_chave,
                    p.created_at,
                    op.status       AS status_producao,
                    op.quantidade,
                    op.produto_nome,
                    DATEDIFF(p.prazo_entrega, CURDATE()) AS dias_entrega
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN (
                    SELECT numero_pedido, MAX(id) AS max_id
                    FROM ordens_producao
                    WHERE deleted_at IS NULL
                    GROUP BY numero_pedido
                ) op_latest ON op_latest.numero_pedido = p.numero_pedido
                LEFT JOIN ordens_producao op ON op.id = op_latest.max_id
                ${where}
                ORDER BY p.id DESC
                LIMIT ?
            `, params);

            const emProducao = rows.filter(r => {
                const s = (r.status_producao || '').toLowerCase();
                return s.includes('produ') || s === 'iniciada' || s === 'em_producao';
            }).length;
            const atrasados = rows.filter(r =>
                r.dias_entrega != null && r.dias_entrega < 0 &&
                !['faturado', 'cancelado', 'recibo'].includes(r.status)
            ).length;
            const aFaturar = rows.filter(r => r.status === 'faturar' && !r.nfe_numero).length;

            res.json({
                success: true,
                pedidos: rows,
                kpis: { total: rows.length, emProducao, atrasados, aFaturar }
            });
        } catch (err) {
            console.error('[PCP/CARTEIRA] Erro:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao carregar carteira de pedidos.' });
        }
    });

    return router;
};
