/**
 * FINANCEIRO CORE ROUTES — Extracted from server.js
 *
 * Contains: checkFinanceiroPermission middleware + financeiro permission endpoint
 * + contas-pagar/receber CRUD + categorias + contas-bancarias + transações
 *
 * Factory pattern: module.exports = function(deps) { ... return router; }
 */

const express = require('express');
const { auditTrail } = require('../middleware/audit-trail');
const { idempotency } = require('../middleware/idempotency');
const { safeAdd, safeSub, gte } = require('../services/financial-math');

module.exports = function createFinanceiroCoreRoutes(deps) {
    const { pool, jwt, JWT_SECRET, authenticateToken, authorizeArea, writeAuditLog, cacheMiddleware, CACHE_CONFIG, writeGuard } = deps;
    const router = express.Router();
    // AUDIT-FIX: Ensure all financeiro-core routes are protected
    router.use(authenticateToken);
    router.use(authorizeArea('financeiro'));
    router.use(writeGuard || ((req, res, next) => next()));
    // Audit trail for all mutation operations in financeiro
    router.use(auditTrail('financeiro'));
    // Idempotency protection for POST requests
    router.use(idempotency());

    // ============================================================
    // MIDDLEWARE: Verificar permissões financeiras (SINGLE definition)
    // AUDIT-FIX CRIT-001/002: This is the ONLY authoritative definition.
    // ============================================================
    function checkFinanceiroPermission(requiredPermission) {
        return async (req, res, next) => {
            const authHeader = req.headers['authorization'];
            let token = null;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const ht = authHeader.split(' ')[1];
                if (ht && ht !== 'null' && ht !== 'undefined') token = ht;
            }
            if (!token) token = req.cookies?.authToken || req.cookies?.token;

            if (!token) {
                return res.status(401).json({ message: 'Não autenticado' });
            }

            try {
                const user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

                // Busca por email primeiro (evita colisão de IDs entre tabelas)
                const [users] = await pool.query(
                    'SELECT permissoes_financeiro, role, nome_completo FROM funcionarios WHERE email = ?',
                    [user.email]
                );

                let userData = users[0];
                if (!userData) {
                    const [usuarios] = await pool.query(
                        'SELECT permissoes_financeiro, role, nome as nome_completo FROM usuarios WHERE email = ?',
                        [user.email]
                    );
                    if (usuarios && usuarios.length > 0) {
                        userData = usuarios[0];
                    }
                }
                // Fallback: busca por ID se email não encontrado
                if (!userData && user.id) {
                    const [byId] = await pool.query(
                        'SELECT permissoes_financeiro, role, nome_completo FROM funcionarios WHERE id = ?',
                        [user.id]
                    );
                    if (byId && byId[0]) { userData = byId[0]; }
                    else {
                        const [byId2] = await pool.query(
                            'SELECT permissoes_financeiro, role, nome as nome_completo FROM usuarios WHERE id = ?',
                            [user.id]
                        );
                        if (byId2 && byId2[0]) userData = byId2[0];
                    }
                }
                if (!userData) {
                    return res.status(403).json({ message: 'Usuário não encontrado' });
                }

                // Admins têm acesso total
                const isAdmin = userData.role === 'admin' || userData.role === 'Admin' ||
                               userData.role === 'administrador' || userData.role === 'Administrador' ||
                               user.role === 'admin' || user.role === 'Admin';

                if (isAdmin) {
                    req.user = user;
                    req.userPermissions = {
                        acesso: 'total', contas_receber: true, contas_pagar: true,
                        fluxo_caixa: true, relatorios: true, visualizar: true,
                        criar: true, editar: true, excluir: true
                    };
                    return next();
                }

                // AUDIT-FIX: No hardcoded users — all permissions from DB
                let permissoes = {};
                if (userData.permissoes_financeiro) {
                    // Coluna tipo JSON: driver mysql2 já parseia automaticamente
                    if (typeof userData.permissoes_financeiro === 'string') {
                        try {
                            permissoes = JSON.parse(userData.permissoes_financeiro);
                        } catch (e) {
                            console.error('[FINANCEIRO] Erro ao parsear permissões:', e);
                            return res.status(500).json({ message: 'Erro ao verificar permissões' });
                        }
                    } else {
                        permissoes = userData.permissoes_financeiro;
                    }
                } else {
                    // Se permissoes_financeiro não está setado mas o usuário já passou
                    // pelo authorizeArea('financeiro') no router, conceder acesso padrão
                    console.log(`[FINANCEIRO] Usuário ${user.email} sem permissoes_financeiro no DB, concedendo acesso padrão (authorizeArea já validou)`);
                    permissoes = {
                        contas_receber: true, contas_pagar: true,
                        fluxo_caixa: true, relatorios: true,
                        visualizar: true, criar: true, editar: true, excluir: true
                    };
                }

                // Suporta tanto formato array ["contas_pagar"] quanto objeto {contas_pagar: true}
                let hasPermission = true;
                if (requiredPermission) {
                    if (Array.isArray(permissoes)) {
                        hasPermission = permissoes.includes(requiredPermission);
                    } else {
                        hasPermission = !!permissoes[requiredPermission];
                    }
                }

                if (!hasPermission) {
                    return res.status(403).json({
                        message: `Acesso negado. Você não tem permissão para acessar ${requiredPermission.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}.`
                    });
                }

                req.user = user;
                req.userPermissions = permissoes;
                next();

            } catch (err) {
                console.error('[FINANCEIRO] Erro ao verificar permissões:', err);
                return res.status(401).json({ message: 'Token inválido' });
            }
        };
    }

    // Export middleware for other route files that need it
    router.checkFinanceiroPermission = checkFinanceiroPermission;

    // ============================================================
    // PERMISSÕES DO USUÁRIO NO FINANCEIRO
    // ============================================================
    router.get('/permissoes', authenticateToken, async (req, res) => {
        const token = req.cookies?.authToken || req.cookies?.token || req.headers['authorization']?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ message: 'Não autenticado' });

        try {
            const user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            const [users] = await pool.query(
                'SELECT id, nome_completo as nome, nome_completo as apelido, role, permissoes_financeiro FROM funcionarios WHERE id = ? OR email = ?',
                [user.id, user.email]
            );
            let userData = users[0];
            if (!userData) {
                try {
                    const [usuarios] = await pool.query(
                        'SELECT id, nome, role, is_admin FROM usuarios WHERE id = ? OR email = ?',
                        [user.id, user.email]
                    );
                    if (usuarios && usuarios.length > 0) userData = usuarios[0];
                } catch (e) { /* tabela pode não existir */ }
            }

            const isAdmin = user.role === 'admin' || user.role === 'Admin' ||
                            userData?.role === 'admin' || userData?.role === 'Admin' ||
                            userData?.role === 'administrador' || userData?.role === 'Administrador';

            if (isAdmin) {
                return res.json({
                    success: true,
                    permissoes: {
                        acesso: 'total', contas_receber: true, contas_pagar: true,
                        fluxo_caixa: true, bancos: true, relatorios: true,
                        visualizar: true, criar: true, editar: true, excluir: true, aprovar: true
                    },
                    usuario: { id: userData?.id, nome: userData?.nome || user.nome, role: 'admin' }
                });
            }

            let permissoes = {};
            if (userData?.permissoes_financeiro) {
                try {
                    permissoes = typeof userData.permissoes_financeiro === 'string'
                        ? JSON.parse(userData.permissoes_financeiro)
                        : userData.permissoes_financeiro;
                } catch (e) { permissoes = {}; }
            } else {
                // Sem permissões granulares no DB — se chegou até aqui, authorizeArea já validou
                permissoes = {
                    contas_receber: true, contas_pagar: true,
                    fluxo_caixa: true, bancos: true, relatorios: true,
                    visualizar: true, criar: true, editar: true, excluir: true
                };
            }

            res.json({
                success: true,
                permissoes: permissoes,
                usuario: { id: userData?.id, nome: userData?.nome || user.nome, role: userData?.role }
            });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar permissões:', err);
            res.status(500).json({ message: 'Erro ao buscar permissões' });
        }
    });

    // ============================================================
    // CATEGORIAS FINANCEIRAS
    // ============================================================
    router.get('/categorias', authenticateToken, async (req, res) => {
        try {
            const { tipo, ativo } = req.query;
            let query = 'SELECT id, nome, tipo, cor, icone, orcamento_mensal, descricao, ativo, created_at FROM categorias_financeiras WHERE 1=1';
            const params = [];
            if (tipo && tipo !== 'todos') { query += ' AND (tipo = ? OR tipo = "ambos")'; params.push(tipo); }
            if (ativo !== undefined) { query += ' AND ativo = ?'; params.push(ativo === 'true' || ativo === '1'); }
            query += ' ORDER BY nome ASC';
            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            query += ' LIMIT ? OFFSET ?';
            params.push(limit, offset);
            const [categorias] = await pool.query(query, params);
            res.json(categorias);
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao listar categorias:', err);
            res.status(500).json({ message: 'Erro ao listar categorias' });
        }
    });

    router.post('/categorias', authenticateToken, async (req, res) => {
        try {
            const { nome, tipo, cor, icone, orcamento_mensal, descricao } = req.body;
            if (!nome || !tipo) return res.status(400).json({ message: 'Nome e tipo são obrigatórios' });
            const [result] = await pool.query(
                'INSERT INTO categorias_financeiras (nome, tipo, cor, icone, orcamento_mensal, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [nome, tipo, cor || '#6c757d', icone || 'fas fa-tag', orcamento_mensal || 0, descricao || '']
            );
            res.status(201).json({ success: true, id: result.insertId, message: 'Categoria criada com sucesso' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao criar categoria:', err);
            res.status(500).json({ message: 'Erro ao criar categoria' });
        }
    });

    router.put('/categorias/:id', authenticateToken, async (req, res) => {
        try {
            const { nome, tipo, cor, icone, orcamento_mensal, descricao, ativo } = req.body;
            await pool.query(
                'UPDATE categorias_financeiras SET nome = ?, tipo = ?, cor = ?, icone = ?, orcamento_mensal = ?, descricao = ?, ativo = ? WHERE id = ?',
                [nome, tipo, cor, icone, orcamento_mensal, descricao, ativo !== undefined ? ativo : 1, req.params.id]
            );
            res.json({ success: true, message: 'Categoria atualizada' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao atualizar categoria:', err);
            res.status(500).json({ message: 'Erro ao atualizar categoria' });
        }
    });

    router.delete('/categorias/:id', authenticateToken, async (req, res) => {
        try {
            await pool.query('UPDATE categorias_financeiras SET ativo = 0 WHERE id = ?', [req.params.id]);
            res.json({ success: true, message: 'Categoria desativada' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao desativar categoria:', err);
            res.status(500).json({ message: 'Erro ao desativar categoria' });
        }
    });

    // ============================================================
    // CONTAS A PAGAR — CRUD
    // ============================================================
    router.get('/contas-pagar', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            let where = 'WHERE 1=1';
            const params = [];

            if (req.query.status) { where += ' AND cp.status = ?'; params.push(req.query.status); }
            if (req.query.fornecedor_id) { where += ' AND cp.fornecedor_id = ?'; params.push(req.query.fornecedor_id); }

            const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM contas_pagar cp ${where}`, params);
            const [rows] = await pool.query(
                `SELECT cp.*, f.razao_social as fornecedor_nome FROM contas_pagar cp LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id ${where} ORDER BY cp.vencimento ASC LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar contas a pagar:', err);
            res.status(500).json({ message: 'Erro ao buscar contas a pagar' });
        }
    });

    router.get('/contas-pagar/:id', checkFinanceiroPermission('contas_pagar'), async (req, res, next) => {
        // Guard: pular para rotas específicas nomeadas
        if (['vencidas', 'vencendo', 'estatisticas', 'resumo', 'lote'].includes(req.params.id)) return next();
        try {
            const [rows] = await pool.query('SELECT * FROM contas_pagar WHERE id = ?', [req.params.id]);
            if (!rows.length) return res.status(404).json({ message: 'Conta não encontrada' });
            res.json(rows[0]);
        } catch (err) {
            console.error('[FINANCEIRO] Erro:', err);
            res.status(500).json({ message: 'Erro ao buscar conta' });
        }
    });

    router.post('/contas-pagar', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const {
                descricao,
                valor,
                valor_total,
                vencimento,
                data_vencimento,
                data_vencimento_original,
                fornecedor_id,
                fornecedor_nome,
                fornecedor,
                categoria,
                categoria_id,
                numero_documento,
                nota_fiscal,
                data_emissao,
                data_registro,
                projeto,
                banco_id,
                conta_bancaria_id,
                observacoes,
                tipo_documento,
                numero_pedido,
                chave_nfe,
                codigo_barras,
                status
            } = req.body;

            const valorConta = valor || valor_total;
            const dataVenc = data_vencimento || vencimento || data_vencimento_original;
            const descricaoConta = descricao || fornecedor_nome || fornecedor || 'Conta a pagar';

            if (!descricaoConta || !valorConta || !dataVenc) {
                return res.status(400).json({ message: 'Campos obrigatórios: descricao, valor, vencimento' });
            }

            let result;
            try {
                [result] = await pool.query(
                    `INSERT INTO contas_pagar (
                        descricao, valor, vencimento, data_vencimento, data_vencimento_original,
                        fornecedor_id, fornecedor_nome, categoria_id,
                        numero_documento, nota_fiscal, data_emissao, projeto,
                        banco_id, observacoes,
                        tipo_documento, numero_pedido, chave_nfe, codigo_barras_boleto, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        descricaoConta,
                        valorConta,
                        dataVenc,
                        dataVenc,
                        data_vencimento_original || dataVenc,
                        fornecedor_id || null,
                        fornecedor_nome || fornecedor || null,
                        categoria_id || null,
                        numero_documento || nota_fiscal || null,
                        nota_fiscal || numero_documento || null,
                        data_emissao || null,
                        projeto || null,
                        banco_id || conta_bancaria_id || null,
                        observacoes || null,
                        tipo_documento || null,
                        numero_pedido || null,
                        chave_nfe || null,
                        codigo_barras || null,
                        status || 'pendente'
                    ]
                );
            } catch (insertErr) {
                if (insertErr?.code !== 'ER_BAD_FIELD_ERROR') throw insertErr;
                [result] = await pool.query(
                    'INSERT INTO contas_pagar (descricao, valor, vencimento, fornecedor_id, categoria_id, observacoes, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [descricaoConta, valorConta, dataVenc, fornecedor_id || null, categoria_id || null, observacoes || '', status || 'pendente']
                );
            }
            res.status(201).json({ success: true, id: result.insertId });
        } catch (err) {
            console.error('[FINANCEIRO] Erro:', err);
            res.status(500).json({ message: 'Erro ao criar conta a pagar' });
        }
    });

    router.put('/contas-pagar/:id', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const {
                descricao,
                valor,
                valor_total,
                vencimento,
                data_vencimento,
                data_vencimento_original,
                fornecedor_id,
                fornecedor_nome,
                fornecedor,
                categoria,
                categoria_id,
                numero_documento,
                nota_fiscal,
                data_emissao,
                data_registro,
                projeto,
                banco_id,
                conta_bancaria_id,
                observacoes,
                tipo_documento,
                numero_pedido,
                chave_nfe,
                codigo_barras,
                status
            } = req.body;

            const valorConta = valor || valor_total;
            const dataVenc = data_vencimento || vencimento || data_vencimento_original;
            const descricaoConta = descricao || fornecedor_nome || fornecedor || 'Conta a pagar';

            try {
                await pool.query(
                    `UPDATE contas_pagar SET
                        descricao = ?, valor = ?, vencimento = ?, data_vencimento = ?, data_vencimento_original = ?,
                        fornecedor_id = ?, fornecedor_nome = ?, categoria_id = ?,
                        numero_documento = ?, nota_fiscal = ?, data_emissao = ?, projeto = ?,
                        banco_id = ?, observacoes = ?,
                        tipo_documento = ?, numero_pedido = ?, chave_nfe = ?, codigo_barras_boleto = ?, status = ?
                     WHERE id = ?`,
                    [
                        descricaoConta,
                        valorConta,
                        dataVenc,
                        dataVenc,
                        data_vencimento_original || dataVenc,
                        fornecedor_id || null,
                        fornecedor_nome || fornecedor || null,
                        categoria_id || null,
                        numero_documento || nota_fiscal || null,
                        nota_fiscal || numero_documento || null,
                        data_emissao || null,
                        projeto || null,
                        banco_id || conta_bancaria_id || null,
                        observacoes || null,
                        tipo_documento || null,
                        numero_pedido || null,
                        chave_nfe || null,
                        codigo_barras || null,
                        status || 'pendente',
                        req.params.id
                    ]
                );
            } catch (updateErr) {
                if (updateErr?.code !== 'ER_BAD_FIELD_ERROR') throw updateErr;
                await pool.query(
                    'UPDATE contas_pagar SET descricao = ?, valor = ?, vencimento = ?, fornecedor_id = ?, categoria_id = ?, observacoes = ?, status = ? WHERE id = ?',
                    [descricaoConta, valorConta, dataVenc, fornecedor_id || null, categoria_id || null, observacoes || null, status || 'pendente', req.params.id]
                );
            }
            res.json({ success: true, message: 'Conta atualizada' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro:', err);
            res.status(500).json({ message: 'Erro ao atualizar conta' });
        }
    });

    router.delete('/contas-pagar/:id', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const [existing] = await pool.query('SELECT * FROM contas_pagar WHERE id = ?', [req.params.id]);
            if (!existing.length) return res.status(404).json({ message: 'Conta não encontrada' });
            writeAuditLog({ userId: req.user?.id, action: 'DELETE', module: 'financeiro', description: `Conta a pagar #${req.params.id} excluída`, previousData: existing[0], ip: req.ip, userAgent: req.headers['user-agent'] });
            await pool.query('DELETE FROM contas_pagar WHERE id = ?', [req.params.id]);
            res.json({ success: true, message: 'Conta excluída' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro:', err);
            res.status(500).json({ message: 'Erro ao excluir conta' });
        }
    });

    // ============================================================
    // CONTAS A RECEBER — CRUD
    // ============================================================
    router.get('/contas-receber', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            let where = 'WHERE 1=1';
            const params = [];

            if (req.query.status) { where += ' AND cr.status = ?'; params.push(req.query.status); }
            if (req.query.cliente_id) { where += ' AND cr.cliente_id = ?'; params.push(req.query.cliente_id); }

            const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM contas_receber cr ${where}`, params);
            const [rows] = await pool.query(
                `SELECT cr.* FROM contas_receber cr ${where} ORDER BY cr.vencimento ASC LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar contas a receber:', err);
            res.status(500).json({ message: 'Erro ao buscar contas a receber' });
        }
    });

    router.get('/contas-receber/:id', checkFinanceiroPermission('contas_receber'), async (req, res, next) => {
        // Guard: pular para rotas específicas nomeadas
        if (['vencidas', 'inadimplentes', 'estatisticas', 'resumo'].includes(req.params.id)) return next();
        try {
            const [rows] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [req.params.id]);
            if (!rows.length) return res.status(404).json({ message: 'Conta não encontrada' });
            res.json(rows[0]);
        } catch (err) {
            console.error('[FINANCEIRO] Erro:', err);
            res.status(500).json({ message: 'Erro ao buscar conta' });
        }
    });

    router.post('/contas-receber', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const {
                descricao,
                valor,
                valor_total,
                vencimento,
                data_vencimento,
                cliente_id,
                cliente_nome,
                cliente,
                categoria,
                categoria_id,
                observacoes,
                numero_documento,
                nota_fiscal,
                data_emissao,
                data_registro,
                projeto,
                banco_id,
                conta_bancaria_id,
                tipo_documento,
                numero_pedido,
                chave_nfe,
                codigo_barras,
                vendedor,
                vendedor_id,
                status,
                valor_pis, reter_pis,
                valor_cofins, reter_cofins,
                valor_csll, reter_csll,
                valor_ir, reter_ir,
                valor_iss, reter_iss,
                valor_inss, reter_inss
            } = req.body;

            const dataVenc = vencimento || data_vencimento;
            const valorConta = valor || valor_total;
            const descricaoConta = descricao || cliente_nome || cliente || 'Conta a receber';

            if (!descricaoConta || !valorConta || !dataVenc) {
                return res.status(400).json({ message: 'Campos obrigatórios: descricao, valor, vencimento' });
            }

            let result;
            try {
                [result] = await pool.query(
                    `INSERT INTO contas_receber (
                        descricao, valor, vencimento, data_vencimento,
                        cliente_id, cliente_nome, categoria_id,
                        observacoes, numero_documento, nota_fiscal,
                        data_emissao, projeto,
                        banco_id,
                        tipo_documento, numero_pedido, chave_nfe, codigo_barras,
                        vendedor, status,
                        valor_pis, reter_pis, valor_cofins, reter_cofins,
                        valor_csll, reter_csll, valor_ir, reter_ir,
                        valor_iss, reter_iss, valor_inss, reter_inss
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        descricaoConta,
                        valorConta,
                        dataVenc,
                        dataVenc,
                        cliente_id || null,
                        cliente_nome || cliente || null,
                        categoria_id || null,
                        observacoes || null,
                        numero_documento || nota_fiscal || null,
                        nota_fiscal || numero_documento || null,
                        data_emissao || null,
                        projeto || null,
                        banco_id || conta_bancaria_id || null,
                        tipo_documento || null,
                        numero_pedido || null,
                        chave_nfe || null,
                        codigo_barras || null,
                        vendedor || null,
                        status || 'pendente',
                        parseFloat(valor_pis) || 0,
                        reter_pis ? 1 : 0,
                        parseFloat(valor_cofins) || 0,
                        reter_cofins ? 1 : 0,
                        parseFloat(valor_csll) || 0,
                        reter_csll ? 1 : 0,
                        parseFloat(valor_ir) || 0,
                        reter_ir ? 1 : 0,
                        parseFloat(valor_iss) || 0,
                        reter_iss ? 1 : 0,
                        parseFloat(valor_inss) || 0,
                        reter_inss ? 1 : 0
                    ]
                );
            } catch (insertErr) {
                if (insertErr?.code !== 'ER_BAD_FIELD_ERROR') throw insertErr;
                [result] = await pool.query(
                    'INSERT INTO contas_receber (descricao, valor, vencimento, cliente_id, categoria_id, observacoes, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [descricaoConta, valorConta, dataVenc, cliente_id || null, categoria_id || null, observacoes || '', status || 'pendente']
                );
            }
            res.status(201).json({ success: true, id: result.insertId });
        } catch (err) {
            console.error('[FINANCEIRO] Erro:', err);
            res.status(500).json({ message: 'Erro ao criar conta a receber' });
        }
    });

    router.put('/contas-receber/:id', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const {
                descricao,
                valor,
                valor_total,
                vencimento,
                data_vencimento,
                cliente_id,
                cliente_nome,
                cliente,
                categoria,
                categoria_id,
                observacoes,
                numero_documento,
                nota_fiscal,
                data_emissao,
                data_registro,
                projeto,
                banco_id,
                conta_bancaria_id,
                tipo_documento,
                numero_pedido,
                chave_nfe,
                codigo_barras,
                vendedor,
                vendedor_id,
                status,
                valor_pis, reter_pis,
                valor_cofins, reter_cofins,
                valor_csll, reter_csll,
                valor_ir, reter_ir,
                valor_iss, reter_iss,
                valor_inss, reter_inss
            } = req.body;

            const dataVenc = vencimento || data_vencimento;
            const valorConta = valor || valor_total;
            const descricaoConta = descricao || cliente_nome || cliente || 'Conta a receber';

            try {
                await pool.query(
                    `UPDATE contas_receber SET
                        descricao = ?, valor = ?, vencimento = ?, data_vencimento = ?,
                        cliente_id = ?, cliente_nome = ?, categoria_id = ?,
                        observacoes = ?, numero_documento = ?, nota_fiscal = ?,
                        data_emissao = ?, projeto = ?,
                        banco_id = ?,
                        tipo_documento = ?, numero_pedido = ?, chave_nfe = ?, codigo_barras = ?,
                        vendedor = ?, status = ?,
                        valor_pis = ?, reter_pis = ?, valor_cofins = ?, reter_cofins = ?,
                        valor_csll = ?, reter_csll = ?, valor_ir = ?, reter_ir = ?,
                        valor_iss = ?, reter_iss = ?, valor_inss = ?, reter_inss = ?
                     WHERE id = ?`,
                    [
                        descricaoConta,
                        valorConta,
                        dataVenc,
                        dataVenc,
                        cliente_id || null,
                        cliente_nome || cliente || null,
                        categoria_id || null,
                        observacoes || null,
                        numero_documento || nota_fiscal || null,
                        nota_fiscal || numero_documento || null,
                        data_emissao || null,
                        projeto || null,
                        banco_id || conta_bancaria_id || null,
                        tipo_documento || null,
                        numero_pedido || null,
                        chave_nfe || null,
                        codigo_barras || null,
                        vendedor || null,
                        status || 'pendente',
                        parseFloat(valor_pis) || 0,
                        reter_pis ? 1 : 0,
                        parseFloat(valor_cofins) || 0,
                        reter_cofins ? 1 : 0,
                        parseFloat(valor_csll) || 0,
                        reter_csll ? 1 : 0,
                        parseFloat(valor_ir) || 0,
                        reter_ir ? 1 : 0,
                        parseFloat(valor_iss) || 0,
                        reter_iss ? 1 : 0,
                        parseFloat(valor_inss) || 0,
                        reter_inss ? 1 : 0,
                        req.params.id
                    ]
                );
            } catch (updateErr) {
                if (updateErr?.code !== 'ER_BAD_FIELD_ERROR') throw updateErr;
                await pool.query(
                    'UPDATE contas_receber SET descricao = ?, valor = ?, vencimento = ?, cliente_id = ?, categoria_id = ?, observacoes = ?, status = ? WHERE id = ?',
                    [descricaoConta, valorConta, dataVenc, cliente_id || null, categoria_id || null, observacoes || null, status || 'pendente', req.params.id]
                );
            }
            res.json({ success: true, message: 'Conta atualizada' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro:', err);
            res.status(500).json({ message: 'Erro ao atualizar conta' });
        }
    });

    router.delete('/contas-receber/:id', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const [existing] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [req.params.id]);
            if (!existing.length) return res.status(404).json({ message: 'Conta não encontrada' });
            writeAuditLog({ userId: req.user?.id, action: 'DELETE', module: 'financeiro', description: `Conta a receber #${req.params.id} excluída`, previousData: existing[0], ip: req.ip, userAgent: req.headers['user-agent'] });
            await pool.query('DELETE FROM contas_receber WHERE id = ?', [req.params.id]);
            res.json({ success: true, message: 'Conta excluída' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro:', err);
            res.status(500).json({ message: 'Erro ao excluir conta' });
        }
    });

    // ============================================================
    // CONTAS A PAGAR — AVANÇADO (pagar, vencidas, vencendo, stats, lote)
    // ============================================================
    router.post('/contas-pagar/:id/pagar', checkFinanceiroPermission('contas_pagar'), async (req, res, next) => {
        // Guard: pular para rota de pagamento em lote
        if (req.params.id === 'lote') return next();
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { id } = req.params;
            const { valor_pago, data_pagamento, banco_id, forma_pagamento, observacoes } = req.body;
            const [conta] = await connection.query('SELECT * FROM contas_pagar WHERE id = ? FOR UPDATE', [id]);
            if (!conta || conta.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: 'Conta não encontrada' });
            }
            const valorTotal = safeSub(safeAdd(conta[0].valor, conta[0].valor_juros || 0, conta[0].valor_multa || 0), conta[0].valor_desconto || 0);
            const status = gte(valor_pago, valorTotal) ? 'pago' : 'pendente';
            await connection.query(
                `UPDATE contas_pagar SET status = ?, valor_pago = ?, data_pagamento = ?, banco_id = ?, forma_pagamento = ?, observacoes = ? WHERE id = ?`,
                [status, valor_pago, data_pagamento || new Date().toISOString().split('T')[0], banco_id, forma_pagamento, observacoes, id]
            );
            if (banco_id && status === 'pago') {
                await connection.query(
                    `INSERT INTO movimentacoes_bancarias (banco_id, tipo, valor, cliente_fornecedor, data, observacoes) VALUES (?, 'saida', ?, ?, ?, ?)`,
                    [banco_id, valor_pago, conta[0].descricao || 'Pagamento conta a pagar', data_pagamento || new Date().toISOString().split('T')[0], observacoes || '']
                );
            }
            await connection.commit();
            res.json({ success: true, message: 'Pagamento registrado com sucesso' });
        } catch (err) {
            try { await connection.rollback(); } catch (_) {}
            console.error('[FINANCEIRO] Erro ao marcar como pago:', err);
            res.status(500).json({ message: 'Erro ao registrar pagamento' });
        } finally {
            connection.release();
        }
    });

    router.get('/contas-pagar/vencidas', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const [contas] = await pool.query(`SELECT *, DATEDIFF(CURDATE(), vencimento) as dias_vencido FROM contas_pagar WHERE status IN ('pendente', 'vencido') AND vencimento < CURDATE() ORDER BY vencimento ASC`);
            res.json(contas);
        } catch (err) { res.status(500).json({ message: 'Erro ao buscar contas vencidas' }); }
    });

    router.get('/contas-pagar/vencendo', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const prazo = req.query.dias || 7;
            const [contas] = await pool.query(
                `SELECT *, DATEDIFF(vencimento, CURDATE()) as dias_para_vencer FROM contas_pagar WHERE status = 'pendente' AND vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY) ORDER BY vencimento ASC`,
                [prazo]
            );
            res.json(contas);
        } catch (err) { res.status(500).json({ message: 'Erro ao buscar contas vencendo' }); }
    });

    router.get('/contas-pagar/estatisticas', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const [stats] = await pool.query(`
                SELECT COUNT(*) as total_contas,
                    SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) as pendentes,
                    SUM(CASE WHEN status = 'pago' THEN 1 ELSE 0 END) as pagas,
                    SUM(CASE WHEN status = 'vencido' THEN 1 ELSE 0 END) as vencidas,
                    SUM(valor) as valor_total,
                    SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END) as valor_pendente,
                    SUM(CASE WHEN status = 'pago' THEN valor_pago ELSE 0 END) as valor_pago,
                    SUM(CASE WHEN vencimento < CURDATE() AND status = 'pendente' THEN valor ELSE 0 END) as valor_vencido
                FROM contas_pagar
            `);
            res.json(stats[0]);
        } catch (err) { res.status(500).json({ message: 'Erro ao buscar estatísticas' }); }
    });

    // Pagamento em lote — AUDIT-FIX CRIT-006: wrapped in transaction
    router.post('/contas-pagar/lote/pagar', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        let connection;
        try {
            const { contas, data_pagamento, banco_id, forma_pagamento } = req.body;
            if (!contas || !Array.isArray(contas) || contas.length === 0) {
                return res.status(400).json({ message: 'Nenhuma conta selecionada' });
            }
            connection = await pool.getConnection();
            await connection.beginTransaction();
            let totalPago = 0;
            const dataPgto = data_pagamento || new Date().toISOString().split('T')[0];
            for (const contaId of contas) {
                const [conta] = await connection.query('SELECT valor FROM contas_pagar WHERE id = ? FOR UPDATE', [contaId]);
                if (conta && conta.length > 0) {
                    await connection.query(
                        `UPDATE contas_pagar SET status = 'pago', valor_pago = valor, data_pagamento = ?, banco_id = ?, forma_pagamento = ? WHERE id = ?`,
                        [dataPgto, banco_id, forma_pagamento, contaId]
                    );
                    totalPago = safeAdd(totalPago, conta[0].valor);
                    if (banco_id) {
                        await connection.query(
                            `INSERT INTO movimentacoes_bancarias (banco_id, tipo, valor, cliente_fornecedor, data, observacoes) VALUES (?, 'saida', ?, 'Pagamento em lote', ?, '')`,
                            [banco_id, conta[0].valor, dataPgto]
                        );
                    }
                }
            }
            await connection.commit();
            res.json({ success: true, message: `${contas.length} contas pagas com sucesso`, total_pago: totalPago });
        } catch (err) {
            if (connection) try { await connection.rollback(); } catch (_) {}
            console.error('[FINANCEIRO] Erro ao pagar em lote:', err);
            res.status(500).json({ message: 'Erro ao pagar em lote' });
        } finally {
            if (connection) connection.release();
        }
    });

    // ============================================================
    // CONTAS A RECEBER — AVANÇADO
    // ============================================================
    router.post('/contas-receber/:id/receber', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { id } = req.params;
            const { valor_recebido, data_recebimento, banco_id, forma_recebimento, observacoes } = req.body;
            const [conta] = await connection.query('SELECT * FROM contas_receber WHERE id = ? FOR UPDATE', [id]);
            if (!conta || conta.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: 'Conta não encontrada' });
            }
            const status = gte(valor_recebido, conta[0].valor) ? 'recebido' : 'parcial';
            await connection.query(
                `UPDATE contas_receber SET status = ?, valor_recebido = ?, data_recebimento = ?, banco_id = ?, forma_recebimento = ?, observacoes = ? WHERE id = ?`,
                [status, valor_recebido, data_recebimento || new Date().toISOString().split('T')[0], banco_id, forma_recebimento, observacoes, id]
            );
            if (banco_id) {
                await connection.query(
                    `INSERT INTO movimentacoes_bancarias (banco_id, tipo, valor, cliente_fornecedor, data, observacoes) VALUES (?, 'entrada', ?, ?, ?, ?)`,
                    [banco_id, valor_recebido, conta[0].descricao || 'Recebimento conta a receber', data_recebimento || new Date().toISOString().split('T')[0], observacoes || '']
                );
            }
            await connection.commit();
            res.json({ success: true, message: 'Recebimento registrado com sucesso' });
        } catch (err) {
            try { await connection.rollback(); } catch (_) {}
            console.error('[FINANCEIRO] Erro:', err);
            res.status(500).json({ message: 'Erro ao registrar recebimento' });
        } finally {
            connection.release();
        }
    });

    router.get('/contas-receber/vencidas', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const [contas] = await pool.query(`SELECT *, DATEDIFF(CURDATE(), vencimento) as dias_vencido FROM contas_receber WHERE status IN ('pendente', 'vencido') AND vencimento < CURDATE() ORDER BY vencimento ASC`);
            res.json(contas);
        } catch (err) { res.status(500).json({ message: 'Erro ao buscar contas vencidas' }); }
    });

    router.get('/contas-receber/inadimplentes', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const [clientes] = await pool.query(`
                SELECT cr.cliente_id, COUNT(*) as total_pendentes, SUM(valor) as valor_total_pendente,
                    MIN(vencimento) as vencimento_mais_antigo, MAX(DATEDIFF(CURDATE(), vencimento)) as max_dias_atraso
                FROM contas_receber cr WHERE cr.status IN ('pendente', 'vencido') AND cr.vencimento < CURDATE()
                GROUP BY cr.cliente_id ORDER BY valor_total_pendente DESC
            `);
            res.json(clientes);
        } catch (err) { res.status(500).json({ message: 'Erro ao buscar inadimplentes' }); }
    });

    router.get('/contas-receber/estatisticas', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const [stats] = await pool.query(`
                SELECT COUNT(*) as total_contas,
                    SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) as pendentes,
                    SUM(CASE WHEN status = 'recebido' THEN 1 ELSE 0 END) as recebidas,
                    SUM(valor) as valor_total,
                    SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END) as valor_pendente,
                    SUM(CASE WHEN status = 'recebido' THEN valor_recebido ELSE 0 END) as valor_recebido,
                    SUM(CASE WHEN vencimento < CURDATE() AND status = 'pendente' THEN valor ELSE 0 END) as valor_vencido
                FROM contas_receber
            `);
            res.json(stats[0]);
        } catch (err) { res.status(500).json({ message: 'Erro ao buscar estatísticas' }); }
    });

    // Export both router and middleware for use by other financeiro modules
    return { router, checkFinanceiroPermission };
};
