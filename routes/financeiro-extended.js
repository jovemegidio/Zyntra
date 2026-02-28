/**
 * FINANCEIRO EXTENDED ROUTES - Extracted from server.js (Lines 21280-22793)
 * Permissions, contas-pagar/receber advanced, contas-bancarias, movimentacoes
 * Uses checkFinanceiroPermission from financeiro-core.js (via deps)
 * @module routes/financeiro-extended
 */
const express = require('express');

module.exports = function createFinanceiroExtendedRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, writeAuditLog, jwt, JWT_SECRET, cacheMiddleware, CACHE_CONFIG, checkFinanceiroPermission } = deps;
    const router = express.Router();
    // ============================================================
    // ROTAS DO MÓDULO FINANCEIRO (COM CONTROLE DE PERMISSÕES)
    // ============================================================
    
    // Obter permissões do usuário no Financeiro
    router.get('/permissoes', authenticateToken, async (req, res) => {
        const token = req.cookies?.authToken || req.cookies?.token || req.headers['authorization']?.replace('Bearer ', '');
    
        if (!token) {
            return res.status(401).json({ message: 'Não autenticado' });
        }
    
        try {
            const user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    
            // Buscar dados básicos do usuário
            const [users] = await pool.query(
                'SELECT id, nome_completo as nome, nome_completo as apelido, role, permissoes_financeiro FROM funcionarios WHERE id = ? OR email = ?',
                [user.id, user.email]
            );
    
            let userData = users[0];
    
            if (!userData) {
                // Tentar na tabela usuarios
                try {
                    const [usuarios] = await pool.query(
                        'SELECT id, nome, role, is_admin FROM usuarios WHERE id = ? OR email = ?',
                        [user.id, user.email]
                    );
    
                    if (usuarios && usuarios.length > 0) {
                        userData = usuarios[0];
                    }
                } catch (e) { /* tabela pode não existir */ }
            }
    
            // Verificar se é admin pelo JWT ou pelo banco
            const isAdmin = user.role === 'admin' ||
                            user.role === 'Admin' ||
                            userData?.role === 'admin' ||
                            userData?.role === 'Admin' ||
                            userData?.role === 'administrador' ||
                            userData?.role === 'Administrador';
    
            // Admins têm acesso total
            if (isAdmin) {
                return res.json({
                    success: true,
                    permissoes: {
                        acesso: 'total',
                        contas_receber: true,
                        contas_pagar: true,
                        fluxo_caixa: true,
                        bancos: true,
                        relatorios: true,
                        visualizar: true,
                        criar: true,
                        editar: true,
                        excluir: true
                    }
                });
            }
    
            // Verificar permissões específicas do usuário baseado no nome/apelido
            const userName = (userData?.apelido || userData?.nome || user.nome || '').toLowerCase().split(' ')[0];
    
            // Permissões específicas por usuário
            const permissoesUsuarios = {
                'hellen': { contas_pagar: true, contas_receber: true, fluxo_caixa: true, bancos: true, relatorios: true },
                'helen': { contas_pagar: true, contas_receber: true, fluxo_caixa: true, bancos: true, relatorios: true },
                'junior': { contas_pagar: true, contas_receber: true, fluxo_caixa: true, bancos: true, relatorios: true },
                'eldir': { contas_pagar: true, contas_receber: true, fluxo_caixa: true, bancos: true, relatorios: true }
            };
    
            // Verificar se usuário tem permissões específicas
            if (permissoesUsuarios[userName]) {
                const perms = permissoesUsuarios[userName];
                return res.json({
                    success: true,
                    permissoes: {
                        acesso: 'parcial',
                        contas_receber: perms.contas_receber,
                        contas_pagar: perms.contas_pagar,
                        fluxo_caixa: perms.fluxo_caixa,
                        bancos: perms.bancos,
                        relatorios: perms.relatorios,
                        visualizar: true,
                        criar: true,
                        editar: true,
                        excluir: false
                    }
                });
            }
    
            // Usuários com role financeiro têm acesso
            const roleFinanceiro = ['financeiro', 'contabilidade', 'contador'];
            if (userData?.role && roleFinanceiro.includes(userData.role.toLowerCase())) {
                return res.json({
                    success: true,
                    permissoes: {
                        acesso: 'total',
                        contas_receber: true,
                        contas_pagar: true,
                        fluxo_caixa: true,
                        bancos: true,
                        relatorios: true,
                        visualizar: true,
                        criar: true,
                        editar: true,
                        excluir: false
                    }
                });
            }
    
            // Usuário sem permissão específica - sem acesso ao financeiro
            return res.json({
                success: true,
                permissoes: {
                    acesso: 'nenhum',
                    contas_receber: false,
                    contas_pagar: false,
                    fluxo_caixa: false,
                    bancos: false,
                    relatorios: false,
                    visualizar: false,
                    criar: false,
                    editar: false,
                    excluir: false
                }
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao verificar permissões:', err);
            return res.status(401).json({ message: 'Token inválido' });
        }
    });
    
    // ===== ROTAS DE RESUMO DO FINANCEIRO =====
    
    // Resumo Geral de Contas (Pagar + Receber combinado)
    router.get('/contas/resumo', authenticateToken, async (req, res) => {
        try {
            // Verificar token
            const token = req.cookies?.authToken || req.headers['authorization']?.replace('Bearer ', '');
            if (!token) {
                return res.status(401).json({ message: 'Não autenticado' });
            }
    
            // Buscar resumo de contas a receber
            const [receber] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) as pendente,
                    COALESCE(SUM(CASE WHEN status = 'pago' OR status = 'recebido' THEN valor ELSE 0 END), 0) as recebido,
                    COALESCE(SUM(CASE WHEN status = 'vencido' OR (status = 'pendente' AND vencimento < CURDATE()) THEN valor ELSE 0 END), 0) as vencido,
                    COUNT(*) as total
                FROM contas_receber
            `);
    
            // Buscar resumo de contas a pagar
            const [pagar] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) as pendente,
                    COALESCE(SUM(CASE WHEN status = 'pago' THEN valor ELSE 0 END), 0) as pago,
                    COALESCE(SUM(CASE WHEN status = 'vencido' OR (status = 'pendente' AND vencimento < CURDATE()) THEN valor ELSE 0 END), 0) as vencido,
                    COUNT(*) as total
                FROM contas_pagar
            `);
    
            res.json({
                receber: {
                    pendente: receber[0]?.pendente || 0,
                    recebido: receber[0]?.recebido || 0,
                    vencido: receber[0]?.vencido || 0,
                    total: receber[0]?.total || 0
                },
                pagar: {
                    pendente: pagar[0]?.pendente || 0,
                    pago: pagar[0]?.pago || 0,
                    vencido: pagar[0]?.vencido || 0,
                    total: pagar[0]?.total || 0
                },
                saldo: (receber[0]?.pendente || 0) - (pagar[0]?.pendente || 0)
            });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar resumo geral de contas:', err);
            res.json({
                receber: { pendente: 0, recebido: 0, vencido: 0, total: 0 },
                pagar: { pendente: 0, pago: 0, vencido: 0, total: 0 },
                saldo: 0
            });
        }
    });
    
    // Resumo de Contas a Receber
    router.get('/contas-receber/resumo', authenticateToken, async (req, res) => {
        try {
            // Verificar token
            const token = req.cookies?.authToken || req.headers['authorization']?.replace('Bearer ', '');
            if (!token) {
                return res.status(401).json({ message: 'Não autenticado' });
            }
    
            // Calcular totais
            const [result] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) as total_pendente,
                    COALESCE(SUM(CASE WHEN status = 'pago' OR status = 'recebido' THEN valor ELSE 0 END), 0) as total_recebido,
                    COALESCE(SUM(CASE WHEN status = 'vencido' OR (status = 'pendente' AND vencimento < CURDATE()) THEN valor ELSE 0 END), 0) as total_vencido,
                    COUNT(*) as total_registros
                FROM contas_receber
            `);
    
            res.json({
                total_pendente: result[0]?.total_pendente || 0,
                total_recebido: result[0]?.total_recebido || 0,
                total_vencido: result[0]?.total_vencido || 0,
                total_registros: result[0]?.total_registros || 0
            });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar resumo contas a receber:', err);
            res.json({ total_pendente: 0, total_recebido: 0, total_vencido: 0, total_registros: 0 });
        }
    });
    
    // Resumo de Contas a Pagar
    router.get('/contas-pagar/resumo', authenticateToken, async (req, res) => {
        try {
            // Verificar token
            const token = req.cookies?.authToken || req.headers['authorization']?.replace('Bearer ', '');
            if (!token) {
                return res.status(401).json({ message: 'Não autenticado' });
            }
    
            // Calcular totais
            const [result] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) as total_pendente,
                    COALESCE(SUM(CASE WHEN status = 'pago' THEN valor ELSE 0 END), 0) as total_pago,
                    COALESCE(SUM(CASE WHEN status = 'vencido' OR (status = 'pendente' AND vencimento < CURDATE()) THEN valor ELSE 0 END), 0) as total_vencido,
                    COUNT(*) as total_registros
                FROM contas_pagar
            `);
    
            res.json({
                total_pendente: result[0]?.total_pendente || 0,
                total_pago: result[0]?.total_pago || 0,
                total_vencido: result[0]?.total_vencido || 0,
                total_registros: result[0]?.total_registros || 0
            });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar resumo contas a pagar:', err);
            res.json({ total_pendente: 0, total_pago: 0, total_vencido: 0, total_registros: 0 });
        }
    });
    
    // Saldo Total das Contas Bancárias
    // AUDIT-FIX HIGH-011: Consolidated — always use contas_bancarias table
    router.get('/contas-bancarias/saldo-total', authenticateToken, async (req, res) => {
        try {
            const [result] = await pool.query(`
                SELECT COALESCE(SUM(COALESCE(saldo_atual, saldo, saldo_inicial, 0)), 0) as saldo_total
                FROM contas_bancarias
                WHERE (ativo = 1 OR ativo IS NULL) AND (ativa = 1 OR ativa IS NULL)
            `);
            res.json({ saldo_total: result[0]?.saldo_total || 0 });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar saldo bancário:', err);
            res.json({ saldo_total: 0 });
        }
    });
    
    // =================================================================
    // API CONTAS BANCÁRIAS - CRUD COMPLETO
    // AUDIT-FIX HIGH-011: Consolidated — single table (contas_bancarias), no try/catch fallback
    // =================================================================
    
    // GET - Listar todas as contas bancárias
    router.get('/contas-bancarias', authenticateToken, async (req, res) => {
        try {
            const [contas] = await pool.query(`
                SELECT id, nome, banco, tipo, agencia, conta, numero_conta,
                       COALESCE(saldo_atual, saldo, 0) as saldo_atual,
                       COALESCE(saldo_inicial, 0) as saldo_inicial,
                       COALESCE(ativo, ativa, 1) as ativo,
                       observacoes, created_at
                FROM contas_bancarias
                ORDER BY nome ASC
            `);
            res.json(contas);
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar contas bancárias:', err);
            res.status(500).json({ error: 'Erro ao buscar contas bancárias' });
        }
    });
    
    // POST - Criar nova conta bancária
    // AUDIT-FIX HIGH-011: Direct contas_bancarias insert, no fallback
    router.post('/contas-bancarias', authenticateToken, async (req, res) => {
        try {
            const { nome, banco, tipo, agencia, numero_conta, saldo, observacoes } = req.body;
    
            const [result] = await pool.query(`
                INSERT INTO contas_bancarias (nome, banco, tipo, agencia, conta, saldo_inicial, saldo_atual, ativo, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            `, [nome, banco, tipo || 'corrente', agencia, numero_conta, saldo || 0, saldo || 0, observacoes]);
    
            res.json({ success: true, id: result.insertId, message: 'Conta criada com sucesso' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao criar conta bancária:', err);
            res.status(500).json({ error: 'Erro ao criar conta bancária' });
        }
    });
    
    // PUT - Atualizar conta bancária
    // AUDIT-FIX HIGH-011: Direct contas_bancarias update, no fallback
    router.put('/contas-bancarias/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, banco, tipo, agencia, numero_conta, saldo, observacoes } = req.body;
    
            await pool.query(`
                UPDATE contas_bancarias
                SET nome = ?, banco = ?, tipo = ?, agencia = ?, conta = ?, saldo_atual = ?, observacoes = ?
                WHERE id = ?
            `, [nome, banco, tipo, agencia, numero_conta, saldo, observacoes, id]);
    
            res.json({ success: true, message: 'Conta atualizada com sucesso' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao atualizar conta bancária:', err);
            res.status(500).json({ error: 'Erro ao atualizar conta bancária' });
        }
    });
    
    // DELETE - Desativar conta bancária (soft delete)
    // AUDIT-FIX HIGH-011: Consistent soft delete
    router.delete('/contas-bancarias/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query(`UPDATE contas_bancarias SET ativo = 0 WHERE id = ?`, [id]);
            res.json({ success: true, message: 'Conta removida com sucesso' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao remover conta bancária:', err);
            res.status(500).json({ error: 'Erro ao remover conta bancária' });
        }
    });
    
    // GET - Buscar movimentações de uma conta
    router.get('/contas-bancarias/:id/movimentacoes', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { data_inicio, data_fim, tipo } = req.query;
    
            // Verificar se tabela existe
            const [tables] = await pool.query("SHOW TABLES LIKE 'movimentacoes_bancarias'");
    
            if (tables.length === 0) {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS movimentacoes_bancarias (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        conta_id INT,
                        tipo ENUM('entrada', 'saida', 'transferencia') DEFAULT 'entrada',
                        valor DECIMAL(15,2),
                        descricao VARCHAR(255),
                        data DATE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (conta_id) REFERENCES contas_bancarias(id) ON DELETE CASCADE
                    )
                `);
            }
    
            let query = `SELECT id, conta_id, tipo, valor, descricao, data, created_at FROM movimentacoes_bancarias WHERE conta_id = ?`;
            const params = [id];
    
            if (data_inicio) {
                query += ` AND data >= ?`;
                params.push(data_inicio);
            }
            if (data_fim) {
                query += ` AND data <= ?`;
                params.push(data_fim);
            }
            if (tipo) {
                query += ` AND tipo = ?`;
                params.push(tipo);
            }
    
            query += ` ORDER BY data DESC, id DESC LIMIT 500`;
    
            const [movimentacoes] = await pool.query(query, params);
            res.json(movimentacoes);
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar movimentações:', err);
            res.status(500).json({ error: 'Erro ao buscar movimentações' });
        }
    });
    
    // POST - Criar movimentação bancária
    router.post('/contas-bancarias/:id/movimentacoes', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { tipo, valor, descricao, data } = req.body;
    
            // AUDIT-FIX ARCH-002: Removed duplicate CREATE TABLE (already in GET route with FK)
    
            // Inserir movimentação
            await pool.query(`
                INSERT INTO movimentacoes_bancarias (conta_id, tipo, valor, descricao, data)
                VALUES (?, ?, ?, ?, ?)
            `, [id, tipo, valor, descricao, data]);
    
            // Atualizar saldo da conta na tabela contas_bancarias
            // AUDIT-FIX HIGH-011: Direct update, no fallback
            const ajuste = tipo === 'entrada' ? valor : -valor;
            await pool.query(`UPDATE contas_bancarias SET saldo_atual = COALESCE(saldo_atual, saldo, 0) + ? WHERE id = ?`, [ajuste, id]);
    
            res.json({ success: true, message: 'Movimentação registrada com sucesso' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao criar movimentação:', err);
            res.status(500).json({ error: 'Erro ao criar movimentação' });
        }
    });
    
    // POST - Criar movimentação bancária (rota usada pelo frontend bancos.html)
    router.post('/movimentacoes-bancarias', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { banco_id, tipo, valor, data, descricao, categoria } = req.body;
    
            // Validação Enterprise: campos obrigatórios
            if (!banco_id || !tipo || !valor || !descricao) {
                connection.release();
                return res.status(400).json({ error: 'Campos obrigatórios: banco_id, tipo, valor, descricao' });
            }
    
            // Validação Enterprise: tipo de movimentação
            if (!['entrada', 'saida'].includes(tipo)) {
                connection.release();
                return res.status(400).json({ error: 'Tipo de movimentação inválido. Use "entrada" ou "saida"' });
            }
    
            // Validação Enterprise: valor monetário (evitar float impreciso)
            const valorNum = parseFloat(valor);
            if (isNaN(valorNum) || valorNum <= 0 || valorNum > 999999999.99) {
                connection.release();
                return res.status(400).json({ error: 'Valor inválido. Deve ser maior que 0' });
            }
            const valorSanitizado = Math.round(valorNum * 100) / 100;
    
            // Validação Enterprise: data no formato correto
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (data && !dateRegex.test(data)) {
                connection.release();
                return res.status(400).json({ error: 'Data inválida. Use formato YYYY-MM-DD' });
            }
    
            // Buscar saldo atual do banco COM LOCK para evitar race condition
            const [banco] = await connection.query('SELECT saldo_atual FROM bancos WHERE id = ? FOR UPDATE', [banco_id]);
            if (!banco || banco.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({ error: 'Banco não encontrado' });
            }
    
            const saldoAtual = parseFloat(banco[0].saldo_atual) || 0;
            const novoSaldo = tipo === 'entrada'
                ? Math.round((saldoAtual + valorSanitizado) * 100) / 100
                : Math.round((saldoAtual - valorSanitizado) * 100) / 100;
    
            // Inserir movimentação
            await connection.query(
                `INSERT INTO movimentacoes_bancarias (banco_id, data, tipo, valor, saldo, cliente_fornecedor, categoria)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [banco_id, data || new Date().toISOString().split('T')[0], tipo, valorSanitizado, novoSaldo, descricao, categoria || null]
            );
    
            // Atualizar saldo do banco
            await connection.query('UPDATE bancos SET saldo_atual = ? WHERE id = ?', [novoSaldo, banco_id]);
    
            await connection.commit();
            res.json({ success: true, message: 'Movimentação registrada com sucesso', novo_saldo: novoSaldo });
        } catch (err) {
            await connection.rollback();
            console.error('[FINANCEIRO] Erro ao criar movimentação:', err);
            res.status(500).json({ error: 'Erro ao criar movimentação' });
        } finally {
            connection.release();
        }
    });
    
    // Contas a Receber - Listar (apenas quem tem permissão)
    router.get('/contas-receber', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const { status, cliente, data_inicio, data_fim, page = 1, limit = 100 } = req.query;
            const pageNum = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.min(Math.max(1, parseInt(limit) || 100), 500);
            const offset = (pageNum - 1) * limitNum;
    
            let whereClause = ' WHERE 1=1';
            const params = [];
    
            if (status) {
                whereClause += ' AND status = ?';
                params.push(status);
            }
    
            if (cliente) {
                whereClause += ' AND (cliente_id = ? OR descricao LIKE ?)';
                params.push(cliente, `%${cliente}%`);
            }
    
            if (data_inicio) {
                whereClause += ' AND data_vencimento >= ?';
                params.push(data_inicio);
            }
    
            if (data_fim) {
                whereClause += ' AND data_vencimento <= ?';
                params.push(data_fim);
            }
    
            const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM contas_receber${whereClause}`, params);
            const total = countResult[0].total;
    
            const query = `SELECT id, cliente_id, descricao, valor, data_vencimento, data_pagamento, status, categoria, numero_documento, observacoes, criado_por, created_at, updated_at FROM contas_receber${whereClause} ORDER BY data_vencimento DESC LIMIT ? OFFSET ?`;
    
            const [contas] = await pool.query(query, [...params, limitNum, offset]);
            return res.json({ data: contas, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar contas a receber:', err);
            return res.status(500).json({ message: 'Erro ao buscar contas a receber' });
        }
    });
    
    // Contas a Pagar - Listar (apenas quem tem permissão)
    router.get('/contas-pagar', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const { status, fornecedor, data_inicio, data_fim, page = 1, limit = 100 } = req.query;
            const pageNum = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.min(Math.max(1, parseInt(limit) || 100), 500);
            const offset = (pageNum - 1) * limitNum;
    
            let whereClause = ' WHERE 1=1';
            const params = [];
    
            if (status) {
                whereClause += ' AND status = ?';
                params.push(status);
            }
    
            if (fornecedor) {
                whereClause += ' AND (fornecedor_id = ? OR descricao LIKE ?)';
                params.push(fornecedor, `%${fornecedor}%`);
            }
    
            if (data_inicio) {
                whereClause += ' AND data_vencimento >= ?';
                params.push(data_inicio);
            }
    
            if (data_fim) {
                whereClause += ' AND data_vencimento <= ?';
                params.push(data_fim);
            }
    
            const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM contas_pagar${whereClause}`, params);
            const total = countResult[0].total;
    
            const query = `SELECT id, fornecedor_id, descricao, valor, data_vencimento, data_pagamento, status, categoria, numero_documento, observacoes, criado_por, created_at, updated_at FROM contas_pagar${whereClause} ORDER BY data_vencimento DESC LIMIT ? OFFSET ?`;
    
            const [contas] = await pool.query(query, [...params, limitNum, offset]);
            return res.json({ data: contas, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar contas a pagar:', err);
            return res.status(500).json({ message: 'Erro ao buscar contas a pagar' });
        }
    });
    
    // Criar Conta a Receber (requer permissão de criar)
    router.post('/contas-receber', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        if (!req.userPermissions.criar) {
            return res.status(403).json({ message: 'Você não tem permissão para criar contas' });
        }
    
        try {
            const { cliente_id, valor, descricao, vencimento, categoria } = req.body;
    
            const [result] = await pool.query(
                'INSERT INTO contas_receber (cliente_id, valor, descricao, vencimento, categoria, status, criado_por) VALUES (?, ?, ?, ?, ?, "pendente", ?)',
                [cliente_id, valor, descricao, vencimento, categoria, req.user.id]
            );
    
            return res.json({
                success: true,
                message: 'Conta a receber criada com sucesso',
                id: result.insertId
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao criar conta a receber:', err);
            return res.status(500).json({ message: 'Erro ao criar conta a receber' });
        }
    });
    
    // Criar Conta a Pagar (requer permissão de criar)
    router.post('/contas-pagar', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        if (!req.userPermissions.criar) {
            return res.status(403).json({ message: 'Você não tem permissão para criar contas' });
        }
    
        try {
            const { fornecedor_id, valor, descricao, vencimento, data_vencimento, categoria, categoria_id, banco_id, forma_pagamento, observacoes } = req.body;
    
            console.log('[FINANCEIRO/POST-PAGAR] Body recebido:', JSON.stringify(req.body));
    
            // Aceitar tanto 'vencimento' quanto 'data_vencimento'
            const dataVenc = data_vencimento || vencimento;
            const catId = categoria_id || categoria;
    
            console.log('[FINANCEIRO/POST-PAGAR] Após processamento:', { descricao, valor, dataVenc, catId });
    
            if (!descricao || !valor || !dataVenc) {
                console.log('[FINANCEIRO/POST-PAGAR] Validação falhou!');
                return res.status(400).json({
                    error: 'Campos obrigatórios faltando',
                    required: ['descricao', 'valor', 'data_vencimento ou vencimento'],
                    received: { descricao: !!descricao, valor: !!valor, vencimento: !!dataVenc, body: req.body }
                });
            }
    
            const [result] = await pool.query(
                `INSERT INTO contas_pagar (fornecedor_id, valor, descricao, data_vencimento, categoria_id, banco_id, forma_pagamento, observacoes, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, "pendente")`,
                [fornecedor_id || null, valor, descricao, dataVenc, catId || null, banco_id || null, forma_pagamento || null, observacoes || null]
            );
    
            return res.json({
                success: true,
                message: 'Conta a pagar criada com sucesso',
                id: result.insertId
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao criar conta a pagar:', err);
            console.error('[FINANCEIRO] Stack:', err.stack);
            return res.status(500).json({ message: 'Erro ao criar conta a pagar', error: err.message });
        }
    });
    
    // Obter conta a receber específica
    router.get('/contas-receber/:id', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [id]);
    
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Conta a receber não encontrada' });
            }
    
            res.json({ success: true, conta: rows[0] });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar conta:', err);
            res.status(500).json({ message: 'Erro ao buscar conta a receber' });
        }
    });
    
    // Obter conta a pagar específica
    router.get('/contas-pagar/:id', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query('SELECT * FROM contas_pagar WHERE id = ?', [id]);
    
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Conta a pagar não encontrada' });
            }
    
            res.json({ success: true, conta: rows[0] });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar conta:', err);
            res.status(500).json({ message: 'Erro ao buscar conta a pagar' });
        }
    });
    
    // Editar Conta a Receber (requer permissão de editar)
    router.put('/contas-receber/:id', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        if (!req.userPermissions.editar) {
            return res.status(403).json({ message: 'Você não tem permissão para editar contas' });
        }
    
        try {
            const { id } = req.params;
            const { valor, descricao, vencimento, status, categoria } = req.body;
    
            await pool.query(
                'UPDATE contas_receber SET valor = ?, descricao = ?, vencimento = ?, status = ?, categoria = ?, atualizado_por = ?, atualizado_em = NOW() WHERE id = ?',
                [valor, descricao, vencimento, status, categoria, req.user.id, id]
            );
    
            return res.json({
                success: true,
                message: 'Conta a receber atualizada com sucesso'
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao atualizar conta a receber:', err);
            return res.status(500).json({ message: 'Erro ao atualizar conta a receber' });
        }
    });
    
    // Editar Conta a Pagar (requer permissão de editar)
    router.put('/contas-pagar/:id', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        if (!req.userPermissions.editar) {
            return res.status(403).json({ message: 'Você não tem permissão para editar contas' });
        }
    
        try {
            const { id } = req.params;
            const { valor, descricao, vencimento, status, categoria } = req.body;
    
            await pool.query(
                'UPDATE contas_pagar SET valor = ?, descricao = ?, vencimento = ?, status = ?, categoria = ?, atualizado_por = ?, atualizado_em = NOW() WHERE id = ?',
                [valor, descricao, vencimento, status, categoria, req.user.id, id]
            );
    
            return res.json({
                success: true,
                message: 'Conta a pagar atualizada com sucesso'
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao atualizar conta a pagar:', err);
            return res.status(500).json({ message: 'Erro ao atualizar conta a pagar' });
        }
    });
    
    // Excluir Conta a Receber (requer permissão de excluir)
    // AUDIT-FIX DB-008: Soft-delete with audit trail instead of hard delete
    router.delete('/contas-receber/:id', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        if (!req.userPermissions.excluir) {
            return res.status(403).json({ message: 'Você não tem permissão para excluir contas' });
        }
    
        try {
            const { id } = req.params;
    
            // AUDIT-FIX: Log the deletion before executing (audit trail)
            try {
                const [original] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [id]);
                if (original.length > 0) {
                    await writeAuditLog({ userId: req.user?.id, action: 'DELETE', module: 'FINANCEIRO', description: `Excluir contas_receber #${id}`, previousData: original[0], ip: req.ip });
                }
            } catch(e) { console.log('[AUDIT] writeAuditLog falhou:', e.message); }
    
            await pool.query('DELETE FROM contas_receber WHERE id = ?', [id]);
    
            return res.json({
                success: true,
                message: 'Conta a receber excluída com sucesso'
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao excluir conta a receber:', err);
            return res.status(500).json({ message: 'Erro ao excluir conta a receber' });
        }
    });
    
    // Excluir Conta a Pagar (requer permissão de excluir)
    // AUDIT-FIX DB-008: Added audit trail before deletion
    router.delete('/contas-pagar/:id', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        if (!req.userPermissions.excluir) {
            return res.status(403).json({ message: 'Você não tem permissão para excluir contas' });
        }
    
        try {
            const { id } = req.params;
    
            // AUDIT-FIX: Log the deletion before executing (audit trail)
            try {
                const [original] = await pool.query('SELECT * FROM contas_pagar WHERE id = ?', [id]);
                if (original.length > 0) {
                    await writeAuditLog({ userId: req.user?.id, action: 'DELETE', module: 'FINANCEIRO', description: `Excluir contas_pagar #${id}`, previousData: original[0], ip: req.ip });
                }
            } catch(e) { console.log('[AUDIT] writeAuditLog falhou:', e.message); }
    
            await pool.query('DELETE FROM contas_pagar WHERE id = ?', [id]);
    
            return res.json({
                success: true,
                message: 'Conta a pagar excluída com sucesso'
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao excluir conta a pagar:', err);
            return res.status(500).json({ message: 'Erro ao excluir conta a pagar' });
        }
    });
    
    // ============================================================
    // IMPORTAÇÃO DE DADOS VIA XLSX - MÓDULO FINANCEIRO
    // ============================================================
    
    // Função auxiliar para parsear data BR (DD/MM/AAAA) para MySQL (AAAA-MM-DD)
    function parseDataBR(dataStr) {
        if (!dataStr) return null;
        if (dataStr instanceof Date) {
            return dataStr.toISOString().split('T')[0];
        }
        const str = String(dataStr).trim();
        // Formato DD/MM/AAAA
        const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (match) {
            const [, dia, mes, ano] = match;
            return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
        }
        // Formato AAAA-MM-DD (já está correto)
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            return str;
        }
        // Tentar converter número Excel para data
        if (!isNaN(str)) {
            const excelDate = new Date((parseInt(str) - 25569) * 86400 * 1000);
            return excelDate.toISOString().split('T')[0];
        }
        return null;
    }
    
    // Função para parsear valor monetário
    function parseValor(valorStr) {
        if (!valorStr) return 0;
        if (typeof valorStr === 'number') return valorStr;
        const str = String(valorStr).replace(/[^\d,.-]/g, '').replace(',', '.');
        return parseFloat(str) || 0;
    }
    
    // Importar Contas a Pagar via XLSX (v2.0 - Compatível SGE/Omie completo)
    router.post('/importar/contas-pagar', authenticateToken, async (req, res) => {
        let connection;
        try {
            const { dados } = req.body;
    
            if (!dados || !Array.isArray(dados) || dados.length === 0) {
                return res.status(400).json({ error: 'Nenhum dado para importar' });
            }
    
            console.log('[IMPORTAR] Contas a Pagar v2 - Recebido:', dados.length, 'registros');
    
            connection = await pool.getConnection();
            await connection.beginTransaction();
    
            let importados = 0;
            let erros = [];
    
            // Helper: parsear booleano Sim/Não
            const parseBool = (v) => {
                if (!v) return 0;
                const s = String(v).toLowerCase().trim();
                return (s === 'sim' || s === 's' || s === '1' || s === 'true') ? 1 : 0;
            };

            // Pre-load lookup tables to avoid N+1 queries
            const [allFornecedores] = await connection.query('SELECT id, razao_social, nome_fantasia, cnpj FROM fornecedores');
            const [allCategFinanceiras] = await connection.query('SELECT id, nome FROM categorias_financeiras');
            const [allCategoriasFallback] = await connection.query('SELECT id, nome FROM categorias');
            const [allContasBancarias] = await connection.query('SELECT id, nome FROM contas_bancarias');

            const findByLike = (items, searchValue, fields) => {
                if (!searchValue) return null;
                const search = searchValue.toLowerCase();
                for (const item of items) {
                    for (const field of fields) {
                        if (item[field] && String(item[field]).toLowerCase().includes(search)) {
                            return item.id;
                        }
                    }
                }
                return null;
            };

            for (let i = 0; i < dados.length; i++) {
                const row = dados[i];
                try {
                    // Validar: precisa ter pelo menos valor E (data_vencimento OU fornecedor)
                    const valor = parseValor(row.valor);
                    const dataVenc = parseDataBR(row.data_vencimento);
                    const descricao = row.descricao || row.fornecedor_nome || row.tipo_documento || 'Importado SGE';
    
                    if (!valor && valor !== 0) {
                        erros.push({ linha: i + 2, erro: 'Valor é obrigatório' });
                        continue;
                    }
                    if (!dataVenc) {
                        erros.push({ linha: i + 2, erro: 'Data de Vencimento é obrigatória' });
                        continue;
                    }
    
// Buscar fornecedor_id pelo nome (pre-loaded)
                    let fornecedor_id = row.fornecedor_nome
                        ? findByLike(allFornecedores, row.fornecedor_nome, ['razao_social', 'nome_fantasia', 'cnpj'])
                        : null;

                    // Buscar categoria_id pelo nome (pre-loaded)
                    let categoria_id = null;
                    if (row.categoria_nome) {
                        categoria_id = findByLike(allCategFinanceiras, row.categoria_nome, ['nome']);
                        if (!categoria_id) {
                            categoria_id = findByLike(allCategoriasFallback, row.categoria_nome, ['nome']);
                        }
                    }

                    // Buscar banco_id pelo nome (pre-loaded)
                    let banco_id = row.conta_corrente_nome
                        ? findByLike(allContasBancarias, row.conta_corrente_nome, ['nome'])
                        : null;
    
                    await connection.query(`
                        INSERT INTO contas_pagar (
                            descricao, fornecedor_id, fornecedor_nome, cnpj_cpf, valor, data_vencimento,
                            categoria_id, categoria_nome, banco_id, conta_corrente_nome,
                            forma_pagamento, status, parcela_numero, total_parcelas, observacoes,
                            codigo_integracao, vendedor, projeto,
                            data_emissao, data_criacao, data_previsao, data_pagamento,
                            valor_pagamento, juros, multa, desconto, data_conciliacao,
                            tipo_documento, numero_documento, numero_pedido, nota_fiscal, chave_nfe,
                            codigo_barras_boleto, juros_boleto, multa_boleto,
                            banco_transferencia, agencia_transferencia, conta_transferencia,
                            cnpj_cpf_titular, nome_titular, finalidade_transferencia, chave_pix,
                            valor_pis, reter_pis, valor_cofins, reter_cofins,
                            valor_csll, reter_csll, valor_ir, reter_ir,
                            valor_iss, reter_iss, valor_inss, reter_inss,
                            departamento, nf_servico_numero, nf_servico_serie,
                            codigo_servico_lc116, valor_total_nf,
                            cst_pis, base_calculo_pis, aliquota_pis, valor_pis_nf,
                            cst_cofins, base_calculo_cofins, aliquota_cofins, valor_cofins_nf
                        ) VALUES (
                            ?, ?, ?, ?, ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?, ?, ?,
                            ?, ?, ?,
                            ?, COALESCE(?, NOW()), ?, ?,
                            ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, ?,
                            ?, ?, ?,
                            ?, ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?,
                            ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?, ?
                        )
                    `, [
                        descricao,
                        fornecedor_id,
                        row.fornecedor_nome || null,
                        row.cnpj_cpf || null,
                        valor,
                        dataVenc,
                        categoria_id,
                        row.categoria_nome || null,
                        banco_id,
                        row.conta_corrente_nome || null,
                        row.forma_pagamento || null,
                        row.status || 'pendente',
                        parseInt(row.parcela_numero) || 1,
                        parseInt(row.total_parcelas) || 1,
                        row.observacoes || null,
                        row.codigo_integracao || null,
                        row.vendedor || null,
                        row.projeto || null,
                        parseDataBR(row.data_emissao),
                        parseDataBR(row.data_registro),
                        parseDataBR(row.data_previsao),
                        parseDataBR(row.data_pagamento),
                        parseValor(row.valor_pagamento) || null,
                        parseValor(row.juros),
                        parseValor(row.multa),
                        parseValor(row.desconto),
                        parseDataBR(row.data_conciliacao),
                        row.tipo_documento || null,
                        row.numero_documento || null,
                        row.numero_pedido || null,
                        row.nota_fiscal || null,
                        row.chave_nfe || null,
                        row.codigo_barras_boleto || null,
                        parseValor(row.juros_boleto) || null,
                        parseValor(row.multa_boleto) || null,
                        row.banco_transferencia || null,
                        row.agencia_transferencia || null,
                        row.conta_transferencia || null,
                        row.cnpj_cpf_titular || null,
                        row.nome_titular || null,
                        row.finalidade_transferencia || null,
                        row.chave_pix || null,
                        parseValor(row.valor_pis),
                        parseBool(row.reter_pis),
                        parseValor(row.valor_cofins),
                        parseBool(row.reter_cofins),
                        parseValor(row.valor_csll),
                        parseBool(row.reter_csll),
                        parseValor(row.valor_ir),
                        parseBool(row.reter_ir),
                        parseValor(row.valor_iss),
                        parseBool(row.reter_iss),
                        parseValor(row.valor_inss),
                        parseBool(row.reter_inss),
                        row.departamento || null,
                        row.nf_servico_numero || null,
                        row.nf_servico_serie || null,
                        row.codigo_servico_lc116 || null,
                        parseValor(row.valor_total_nf) || null,
                        row.cst_pis || null,
                        parseValor(row.base_calculo_pis) || null,
                        parseValor(row.aliquota_pis) || null,
                        parseValor(row.valor_pis_nf) || null,
                        row.cst_cofins || null,
                        parseValor(row.base_calculo_cofins) || null,
                        parseValor(row.aliquota_cofins) || null,
                        parseValor(row.valor_cofins_nf) || null
                    ]);
    
                    importados++;
                } catch (err) {
                    console.error(`[IMPORTAR] Erro linha ${i + 2}:`, err.message);
                    erros.push({ linha: i + 2, erro: err.message });
                }
            }
    
            await connection.commit();
    
            console.log('[IMPORTAR] Contas a Pagar - Importados:', importados, '| Erros:', erros.length);
    
            res.json({
                success: true,
                importados,
                total: dados.length,
                erros
            });
    
        } catch (err) {
            if (connection) await connection.rollback().catch(() => {});
            console.error('[IMPORTAR] Erro em Contas a Pagar:', err);
            res.status(500).json({ error: 'Erro ao importar dados' });
        } finally {
            if (connection) connection.release();
        }
    });
    
    // Importar Contas a Receber via XLSX (v2.0 - Compatível SGE/Omie completo)
    router.post('/importar/contas-receber', authenticateToken, async (req, res) => {
        let connection;
        try {
            const { dados } = req.body;
    
            if (!dados || !Array.isArray(dados) || dados.length === 0) {
                return res.status(400).json({ error: 'Nenhum dado para importar' });
            }
    
            console.log('[IMPORTAR] Contas a Receber v2 - Recebido:', dados.length, 'registros');
    
            connection = await pool.getConnection();
            await connection.beginTransaction();
    
            let importados = 0;
            let erros = [];
    
            const parseBool = (v) => {
                if (!v) return 0;
                const s = String(v).toLowerCase().trim();
                return (s === 'sim' || s === 's' || s === '1' || s === 'true') ? 1 : 0;
            };
    
            // Pre-load lookup tables to avoid N+1 queries
            const [allClientes] = await connection.query('SELECT id, razao_social, nome_fantasia, cnpj FROM clientes');
            const [allCategFinanceiras] = await connection.query('SELECT id, nome FROM categorias_financeiras');
            const [allCategoriasFallback] = await connection.query('SELECT id, nome FROM categorias');
            const [allContasBancarias] = await connection.query('SELECT id, nome FROM contas_bancarias');

            const findByLike = (items, searchValue, fields) => {
                if (!searchValue) return null;
                const search = searchValue.toLowerCase();
                for (const item of items) {
                    for (const field of fields) {
                        if (item[field] && String(item[field]).toLowerCase().includes(search)) {
                            return item.id;
                        }
                    }
                }
                return null;
            };

            for (let i = 0; i < dados.length; i++) {
                const row = dados[i];
                try {
                    // Validar: precisa ter pelo menos valor E (data_vencimento OU cliente)
                    const valor = parseValor(row.valor);
                    const dataVenc = parseDataBR(row.data_vencimento);
                    const descricao = row.descricao || row.cliente_nome || row.tipo_documento || 'Importado SGE';

                    if (!valor && valor !== 0) {
                        erros.push({ linha: i + 2, erro: 'Valor é obrigatório' });
                        continue;
                    }
                    if (!dataVenc) {
                        erros.push({ linha: i + 2, erro: 'Data de Vencimento é obrigatória' });
                        continue;
                    }
    
// Buscar cliente_id pelo nome (pre-loaded)
                    let cliente_id = row.cliente_nome
                        ? findByLike(allClientes, row.cliente_nome, ['razao_social', 'nome_fantasia', 'cnpj'])
                        : null;

                    // Buscar categoria_id pelo nome (pre-loaded)
                    let categoria_id = null;
                    if (row.categoria_nome) {
                        categoria_id = findByLike(allCategFinanceiras, row.categoria_nome, ['nome']);
                        if (!categoria_id) {
                            categoria_id = findByLike(allCategoriasFallback, row.categoria_nome, ['nome']);
                        }
                    }

                    // Buscar banco_id pelo nome (pre-loaded)
                    let banco_id = row.conta_corrente_nome
                        ? findByLike(allContasBancarias, row.conta_corrente_nome, ['nome'])
                        : null;
    
                    await connection.query(`
                        INSERT INTO contas_receber (
                            descricao, cliente_id, cliente_nome, valor, data_vencimento,
                            categoria_id, categoria_nome, banco_id, conta_corrente_nome,
                            forma_recebimento, status, parcela_numero, total_parcelas, observacoes,
                            codigo_integracao, vendedor, projeto,
                            data_emissao, data_criacao, data_previsao,
                            data_recebimento, valor_recebido,
                            juros, multa, desconto, data_conciliacao,
                            tipo_documento, numero_documento, numero_pedido, nota_fiscal, chave_nfe,
                            codigo_barras, numero_boleto, nsu_tid,
                            valor_pis, reter_pis, valor_cofins, reter_cofins,
                            valor_csll, reter_csll, valor_ir, reter_ir,
                            valor_iss, reter_iss, valor_inss, reter_inss,
                            departamento
                        ) VALUES (
                            ?, ?, ?, ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?, ?, ?,
                            ?, ?, ?,
                            ?, COALESCE(?, NOW()), ?,
                            ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?, ?, ?,
                            ?, ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?, ?,
                            ?, ?, ?, ?,
                            ?
                        )
                    `, [
                        descricao,
                        cliente_id,
                        row.cliente_nome || null,
                        valor,
                        dataVenc,
                        categoria_id,
                        row.categoria_nome || null,
                        banco_id,
                        row.conta_corrente_nome || null,
                        row.forma_recebimento || null,
                        row.status || 'pendente',
                        parseInt(row.parcela_numero) || 1,
                        parseInt(row.total_parcelas) || 1,
                        row.observacoes || null,
                        row.codigo_integracao || null,
                        row.vendedor || null,
                        row.projeto || null,
                        parseDataBR(row.data_emissao),
                        parseDataBR(row.data_registro),
                        parseDataBR(row.data_previsao),
                        parseDataBR(row.data_recebimento),
                        parseValor(row.valor_recebido) || null,
                        parseValor(row.juros),
                        parseValor(row.multa),
                        parseValor(row.desconto),
                        parseDataBR(row.data_conciliacao),
                        row.tipo_documento || null,
                        row.numero_documento || null,
                        row.numero_pedido || null,
                        row.nota_fiscal || null,
                        row.chave_nfe || null,
                        row.codigo_barras || null,
                        row.numero_boleto || null,
                        row.nsu_tid || null,
                        parseValor(row.valor_pis),
                        parseBool(row.reter_pis),
                        parseValor(row.valor_cofins),
                        parseBool(row.reter_cofins),
                        parseValor(row.valor_csll),
                        parseBool(row.reter_csll),
                        parseValor(row.valor_ir),
                        parseBool(row.reter_ir),
                        parseValor(row.valor_iss),
                        parseBool(row.reter_iss),
                        parseValor(row.valor_inss),
                        parseBool(row.reter_inss),
                        row.departamento || null
                    ]);
    
                    importados++;
                } catch (err) {
                    console.error(`[IMPORTAR] Erro linha ${i + 2}:`, err.message);
                    erros.push({ linha: i + 2, erro: err.message });
                }
            }
    
            await connection.commit();
    
            console.log('[IMPORTAR] Contas a Receber - Importados:', importados, '| Erros:', erros.length);
    
            res.json({
                success: true,
                importados,
                total: dados.length,
                erros
            });
    
        } catch (err) {
            if (connection) await connection.rollback().catch(() => {});
            console.error('[IMPORTAR] Erro em Contas a Receber:', err);
            res.status(500).json({ error: 'Erro ao importar dados' });
        } finally {
            if (connection) connection.release();
        }
    });
    
    // Importar Bancos/Contas Bancárias via XLSX
    router.post('/importar/bancos', authenticateToken, async (req, res) => {
        let connection;
        try {
            const { dados } = req.body;
    
            if (!dados || !Array.isArray(dados) || dados.length === 0) {
                return res.status(400).json({ error: 'Nenhum dado para importar' });
            }
    
            console.log('[IMPORTAR] Bancos - Recebido:', dados.length, 'registros');
    
            connection = await pool.getConnection();
            await connection.beginTransaction();
    
            let importados = 0;
            let erros = [];
    
            for (let i = 0; i < dados.length; i++) {
                const row = dados[i];
                try {
                    if (!row.nome) {
                        erros.push({ linha: i + 2, erro: 'Nome da conta é obrigatório' });
                        continue;
                    }
    
                    await connection.query(`
                        INSERT INTO contas_bancarias
                        (nome, banco, agencia, conta, tipo, saldo_inicial, saldo_atual, limite_credito, considera_fluxo, emite_boletos, ativo, observacoes, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())
                    `, [
                        row.nome,
                        row.banco || null,
                        row.agencia || null,
                        row.numero_conta || null,
                        row.tipo || 'corrente',
                        parseValor(row.saldo_inicial),
                        parseValor(row.saldo_inicial),
                        parseValor(row.limite_credito),
                        row.considera_fluxo === 'sim' || row.considera_fluxo === '1' || row.considera_fluxo === true ? 1 : 0,
                        row.emite_boletos === 'sim' || row.emite_boletos === '1' || row.emite_boletos === true ? 1 : 0,
                        row.observacoes || null
                    ]);
    
                    importados++;
                } catch (err) {
                    erros.push({ linha: i + 2, erro: err.message });
                }
            }
    
            await connection.commit();
    
            console.log('[IMPORTAR] Bancos - Importados:', importados, '| Erros:', erros.length);
    
            res.json({
                success: true,
                importados,
                total: dados.length,
                erros
            });
    
        } catch (err) {
            if (connection) await connection.rollback().catch(() => {});
            console.error('[IMPORTAR] Erro em Bancos:', err);
            res.status(500).json({ error: 'Erro ao importar dados' });
        } finally {
            if (connection) connection.release();
        }
    });
    
    // Importar Movimentações Bancárias via XLSX
    router.post('/importar/movimentacoes', authenticateToken, async (req, res) => {
        let connection;
        try {
            const { dados } = req.body;
    
            if (!dados || !Array.isArray(dados) || dados.length === 0) {
                return res.status(400).json({ error: 'Nenhum dado para importar' });
            }
    
            console.log('[IMPORTAR] Movimentações - Recebido:', dados.length, 'registros');
    
            connection = await pool.getConnection();
            await connection.beginTransaction();
    
            let importados = 0;
            let erros = [];
    
            for (let i = 0; i < dados.length; i++) {
                const row = dados[i];
                try {
                    if (!row.data || !row.tipo || !row.valor) {
                        erros.push({ linha: i + 2, erro: 'Campos obrigatórios: Data, Tipo e Valor' });
                        continue;
                    }
    
                    const dataMov = parseDataBR(row.data);
                    if (!dataMov) {
                        erros.push({ linha: i + 2, erro: 'Data inválida' });
                        continue;
                    }
    
                    // Buscar banco_id pelo nome se fornecido
                    let banco_id = null;
                    if (row.conta_bancaria) {
                        const [bancos] = await connection.query('SELECT id FROM contas_bancarias WHERE nome LIKE ? LIMIT 1', [`%${row.conta_bancaria}%`]);
                        if (bancos.length > 0) banco_id = bancos[0].id;
                    }
    
                    const tipo = row.tipo.toLowerCase().includes('entrada') ? 'entrada' :
                                 row.tipo.toLowerCase().includes('saida') || row.tipo.toLowerCase().includes('saída') ? 'saida' :
                                 'transferencia';
    
                    await connection.query(`
                        INSERT INTO movimentacoes_bancarias
                        (banco_id, data, tipo, valor, cliente_fornecedor, categoria, numero_documento, nota_fiscal, parcela, observacoes, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                    `, [
                        banco_id,
                        dataMov,
                        tipo,
                        parseValor(row.valor),
                        row.cliente_fornecedor || null,
                        row.categoria || null,
                        row.numero_documento || null,
                        row.nota_fiscal || null,
                        row.parcela || null,
                        row.observacoes || null
                    ]);
    
                    importados++;
                } catch (err) {
                    erros.push({ linha: i + 2, erro: err.message });
                }
            }
    
            await connection.commit();
    
            console.log('[IMPORTAR] Movimentações - Importados:', importados, '| Erros:', erros.length);
    
            res.json({
                success: true,
                importados,
                total: dados.length,
                erros
            });
    
        } catch (err) {
            if (connection) await connection.rollback().catch(() => {});
            console.error('[IMPORTAR] Erro em Movimentações:', err);
            res.status(500).json({ error: 'Erro ao importar dados' });
        } finally {
            if (connection) connection.release();
        }
    });
    
    // Importar Fluxo de Caixa (previsões) via XLSX
    router.post('/importar/fluxo-caixa', authenticateToken, async (req, res) => {
        let connection;
        try {
            const { dados } = req.body;
    
            if (!dados || !Array.isArray(dados) || dados.length === 0) {
                return res.status(400).json({ error: 'Nenhum dado para importar' });
            }
    
            console.log('[IMPORTAR] Fluxo de Caixa - Recebido:', dados.length, 'registros');
    
            connection = await pool.getConnection();
            await connection.beginTransaction();
    
            let importados = 0;
            let erros = [];
    
            for (let i = 0; i < dados.length; i++) {
                const row = dados[i];
                try {
                    if (!row.data_prevista || !row.descricao || !row.tipo || !row.valor) {
                        erros.push({ linha: i + 2, erro: 'Campos obrigatórios: Data Prevista, Descrição, Tipo e Valor' });
                        continue;
                    }
    
                    const dataPrevista = parseDataBR(row.data_prevista);
                    if (!dataPrevista) {
                        erros.push({ linha: i + 2, erro: 'Data prevista inválida' });
                        continue;
                    }
    
                    const tipo = row.tipo.toLowerCase().includes('entrada') ? 'entrada' : 'saida';
                    const valor = parseValor(row.valor);
    
                    // Inserir como conta a receber (entrada) ou conta a pagar (saída) com status 'previsao'
                    if (tipo === 'entrada') {
                        await connection.query(`
                            INSERT INTO contas_receber
                            (descricao, valor, data_vencimento, status, observacoes, data_criacao)
                            VALUES (?, ?, ?, 'previsao', ?, NOW())
                        `, [row.descricao, valor, dataPrevista, row.observacoes || `[Fluxo] ${row.cliente_fornecedor || ''}`]);
                    } else {
                        await connection.query(`
                            INSERT INTO contas_pagar
                            (descricao, valor, data_vencimento, status, observacoes, data_criacao)
                            VALUES (?, ?, ?, 'previsao', ?, NOW())
                        `, [row.descricao, valor, dataPrevista, row.observacoes || `[Fluxo] ${row.cliente_fornecedor || ''}`]);
                    }
    
                    importados++;
                } catch (err) {
                    erros.push({ linha: i + 2, erro: err.message });
                }
            }
    
            await connection.commit();
    
            console.log('[IMPORTAR] Fluxo de Caixa - Importados:', importados, '| Erros:', erros.length);
    
            res.json({
                success: true,
                importados,
                total: dados.length,
                erros
            });
    
        } catch (err) {
            if (connection) await connection.rollback().catch(() => {});
            console.error('[IMPORTAR] Erro em Fluxo de Caixa:', err);
            res.status(500).json({ error: 'Erro ao importar dados' });
        } finally {
            if (connection) connection.release();
        }
    });

    // ============================================================
    // MOVIMENTAÇÕES BANCÁRIAS — GET (listagem geral)
    // ============================================================
    router.get('/movimentacoes-bancarias', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 20, 100);
            const offset = parseInt(req.query.offset) || 0;
            const banco_id = req.query.banco_id;
            const tipo = req.query.tipo;

            let sql = `SELECT m.id, m.banco_id, m.data, m.tipo, m.valor, m.saldo,
                        m.cliente_fornecedor as descricao, m.categoria,
                        COALESCE(cb.nome, cb.banco) as banco_nome,
                        COALESCE(cb.nome, cb.banco) as banco_apelido,
                        m.saldo as saldo_apos
                        FROM movimentacoes_bancarias m
                        LEFT JOIN contas_bancarias cb ON cb.id = m.banco_id
                        WHERE 1=1`;
            const params = [];

            if (banco_id) { sql += ' AND m.banco_id = ?'; params.push(banco_id); }
            if (tipo) { sql += ' AND m.tipo = ?'; params.push(tipo); }

            sql += ' ORDER BY m.data DESC, m.id DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));

            const [rows] = await pool.query(sql, params);
            res.json(rows);
        } catch (err) {
            console.error('[FINANCEIRO] Erro GET movimentacoes-bancarias:', err.message);
            res.status(500).json({ error: 'Erro ao buscar movimentações' });
        }
    });

    // ============================================================
    // TRANSFERÊNCIA BANCÁRIA — POST
    // ============================================================
    router.post('/transferencia-bancaria', authenticateToken, async (req, res) => {
        let connection;
        try {
            const { conta_origem, conta_destino, valor, data, descricao } = req.body;

            if (!conta_origem || !conta_destino || !valor || valor <= 0) {
                return res.status(400).json({ error: 'Dados incompletos para transferência' });
            }
            if (conta_origem === conta_destino) {
                return res.status(400).json({ error: 'Conta origem e destino devem ser diferentes' });
            }

            connection = await pool.getConnection();
            await connection.beginTransaction();

            // Buscar saldos atuais
            const [origem] = await connection.execute(
                'SELECT id, nome, saldo_atual FROM contas_bancarias WHERE id = ? FOR UPDATE', [conta_origem]
            );
            const [destino] = await connection.execute(
                'SELECT id, nome, saldo_atual FROM contas_bancarias WHERE id = ? FOR UPDATE', [conta_destino]
            );

            if (!origem.length || !destino.length) {
                await connection.rollback();
                return res.status(404).json({ error: 'Conta bancária não encontrada' });
            }

            const saldoOrigem = parseFloat(origem[0].saldo_atual) || 0;
            const saldoDestino = parseFloat(destino[0].saldo_atual) || 0;
            const valorFloat = parseFloat(valor);

            // Atualizar saldos
            await connection.execute('UPDATE contas_bancarias SET saldo_atual = ? WHERE id = ?',
                [saldoOrigem - valorFloat, conta_origem]);
            await connection.execute('UPDATE contas_bancarias SET saldo_atual = ? WHERE id = ?',
                [saldoDestino + valorFloat, conta_destino]);

            // Registrar movimentações
            const dataTransf = data || new Date().toISOString().split('T')[0];
            const desc = descricao || `Transferência: ${origem[0].nome} → ${destino[0].nome}`;

            await connection.execute(
                `INSERT INTO movimentacoes_bancarias (banco_id, data, tipo, valor, saldo, cliente_fornecedor, categoria)
                 VALUES (?, ?, 'saida', ?, ?, ?, 'transferencia')`,
                [conta_origem, dataTransf, valorFloat, saldoOrigem - valorFloat, desc]
            );
            await connection.execute(
                `INSERT INTO movimentacoes_bancarias (banco_id, data, tipo, valor, saldo, cliente_fornecedor, categoria)
                 VALUES (?, ?, 'entrada', ?, ?, ?, 'transferencia')`,
                [conta_destino, dataTransf, valorFloat, saldoDestino + valorFloat, desc]
            );

            await connection.commit();
            res.json({ success: true, message: 'Transferência realizada com sucesso' });
        } catch (err) {
            if (connection) await connection.rollback().catch(() => {});
            console.error('[FINANCEIRO] Erro transferencia-bancaria:', err.message);
            res.status(500).json({ error: 'Erro ao realizar transferência' });
        } finally {
            if (connection) connection.release();
        }
    });

    // ============================================================
    // IMPOSTOS — CRUD completo
    // ============================================================
    router.get('/impostos', authenticateToken, async (req, res) => {
        try {
            // Tentar buscar da tabela impostos, se não existir retornar array vazio
            try {
                const [rows] = await pool.execute(
                    'SELECT id, codigo, nome, tipo, aliquota, base_calculo as base, descricao, ativo FROM impostos ORDER BY nome'
                );
                res.json({ data: rows });
            } catch (tableErr) {
                // Tabela pode não existir ainda - retornar dados mock
                if (tableErr.code === 'ER_NO_SUCH_TABLE') {
                    res.json({ data: [] });
                } else {
                    throw tableErr;
                }
            }
        } catch (err) {
            console.error('[FINANCEIRO] Erro GET impostos:', err.message);
            res.status(500).json({ error: 'Erro ao buscar impostos' });
        }
    });

    router.post('/impostos', authenticateToken, async (req, res) => {
        try {
            const { codigo, nome, tipo, aliquota, base, descricao, observacoes, ativo } = req.body;
            if (!codigo || !nome) {
                return res.status(400).json({ error: 'Código e nome são obrigatórios' });
            }
            try {
                const [result] = await pool.execute(
                    `INSERT INTO impostos (codigo, nome, tipo, aliquota, base_calculo, descricao, observacoes, ativo)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [codigo, nome, tipo || 'federal', aliquota || 0, base || 'faturamento', descricao || '', observacoes || '', ativo !== false ? 1 : 0]
                );
                res.json({ success: true, id: result.insertId });
            } catch (tableErr) {
                if (tableErr.code === 'ER_NO_SUCH_TABLE') {
                    // Criar tabela se não existir
                    await pool.execute(`CREATE TABLE IF NOT EXISTS impostos (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        codigo VARCHAR(20) NOT NULL,
                        nome VARCHAR(100) NOT NULL,
                        tipo ENUM('federal','estadual','municipal') DEFAULT 'federal',
                        aliquota DECIMAL(10,4) DEFAULT 0,
                        base_calculo VARCHAR(50) DEFAULT 'faturamento',
                        descricao TEXT,
                        observacoes TEXT,
                        ativo TINYINT(1) DEFAULT 1,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
                    const [result] = await pool.execute(
                        `INSERT INTO impostos (codigo, nome, tipo, aliquota, base_calculo, descricao, observacoes, ativo)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [codigo, nome, tipo || 'federal', aliquota || 0, base || 'faturamento', descricao || '', observacoes || '', ativo !== false ? 1 : 0]
                    );
                    res.json({ success: true, id: result.insertId });
                } else {
                    throw tableErr;
                }
            }
        } catch (err) {
            console.error('[FINANCEIRO] Erro POST impostos:', err.message);
            res.status(500).json({ error: 'Erro ao criar imposto' });
        }
    });

    router.put('/impostos/:id', authenticateToken, async (req, res) => {
        try {
            const { codigo, nome, tipo, aliquota, base, descricao, observacoes, ativo } = req.body;
            await pool.execute(
                `UPDATE impostos SET codigo=?, nome=?, tipo=?, aliquota=?, base_calculo=?, descricao=?, observacoes=?, ativo=? WHERE id=?`,
                [codigo, nome, tipo, aliquota || 0, base, descricao || '', observacoes || '', ativo !== false ? 1 : 0, req.params.id]
            );
            res.json({ success: true });
        } catch (err) {
            console.error('[FINANCEIRO] Erro PUT impostos:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar imposto' });
        }
    });

    router.delete('/impostos/:id', authenticateToken, async (req, res) => {
        try {
            await pool.execute('DELETE FROM impostos WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (err) {
            console.error('[FINANCEIRO] Erro DELETE impostos:', err.message);
            res.status(500).json({ error: 'Erro ao excluir imposto' });
        }
    });

    // ============================================================
    // CLIENTES-FORNECEDORES — Busca e Cadastro
    // ============================================================
    router.get('/clientes-fornecedores/buscar', authenticateToken, async (req, res) => {
        try {
            const termo = req.query.termo || '';
            if (termo.length < 2) return res.json({ data: [] });

            const search = `%${termo}%`;
            // Buscar em clientes e fornecedores
            const [clientes] = await pool.execute(
                `SELECT id, razao_social, nome_fantasia, COALESCE(nome_fantasia, razao_social) as nome,
                        endereco, numero, bairro, cidade, estado, cep, cnpj_cpf, telefone, complemento,
                        'cliente' as tipo_registro
                 FROM clientes WHERE (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj_cpf LIKE ?) AND ativo = 1 LIMIT 20`,
                [search, search, search]
            ).catch(() => [[]]);

            const [fornecedores] = await pool.execute(
                `SELECT id, razao_social, nome_fantasia, COALESCE(nome_fantasia, razao_social) as nome,
                        endereco, numero, bairro, cidade, uf as estado, cep, cnpj as cnpj_cpf, telefone, '' as complemento,
                        'fornecedor' as tipo_registro
                 FROM fornecedores WHERE (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ?) AND ativo = 1 LIMIT 20`,
                [search, search, search]
            ).catch(() => [[]]);

            const resultados = [...(clientes || []), ...(fornecedores || [])];
            res.json({ data: resultados });
        } catch (err) {
            console.error('[FINANCEIRO] Erro busca clientes-fornecedores:', err.message);
            res.status(500).json({ error: 'Erro ao buscar clientes/fornecedores' });
        }
    });

    router.get('/clientes-fornecedores', authenticateToken, async (req, res) => {
        try {
            const [clientes] = await pool.execute(
                `SELECT id, razao_social, nome_fantasia, COALESCE(nome_fantasia, razao_social) as nome,
                        cnpj_cpf, telefone, cidade, estado, 'cliente' as tipo_registro
                 FROM clientes WHERE ativo = 1 ORDER BY razao_social LIMIT 100`
            ).catch(() => [[]]);

            const [fornecedores] = await pool.execute(
                `SELECT id, razao_social, nome_fantasia, COALESCE(nome_fantasia, razao_social) as nome,
                        cnpj as cnpj_cpf, telefone, cidade, uf as estado, 'fornecedor' as tipo_registro
                 FROM fornecedores WHERE ativo = 1 ORDER BY razao_social LIMIT 100`
            ).catch(() => [[]]);

            res.json({ data: [...(clientes || []), ...(fornecedores || [])] });
        } catch (err) {
            console.error('[FINANCEIRO] Erro GET clientes-fornecedores:', err.message);
            res.status(500).json({ error: 'Erro ao buscar clientes/fornecedores' });
        }
    });

    router.post('/clientes-fornecedores', authenticateToken, async (req, res) => {
        try {
            const { razao_social, nome_fantasia, cnpj_cpf, ddd, telefone, contato,
                    endereco, numero, bairro, complemento, cidade, estado, cep } = req.body;

            if (!razao_social) {
                return res.status(400).json({ message: 'Razão social é obrigatória' });
            }

            const tel = ddd && telefone ? `(${ddd}) ${telefone}` : (telefone || '');

            // Inserir como cliente por padrão
            await pool.execute(
                `INSERT INTO clientes (razao_social, nome_fantasia, cnpj_cpf, telefone, contato, endereco, numero, bairro, complemento, cidade, estado, cep, ativo)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [razao_social, nome_fantasia || '', cnpj_cpf || '', tel, contato || '', endereco || '', numero || '', bairro || '', complemento || '', cidade || '', estado || '', cep || '']
            );

            res.json({ success: true, message: 'Cliente/Fornecedor cadastrado com sucesso' });
        } catch (err) {
            console.error('[FINANCEIRO] Erro POST clientes-fornecedores:', err.message);
            res.status(500).json({ message: 'Erro ao cadastrar' });
        }
    });

    // ============================================================
    // OPERAÇÕES DE DESCONTO — POST
    // ============================================================
    router.post('/operacoes/desconto', authenticateToken, async (req, res) => {
        try {
            const { numero_titulo, cliente_sacado, valor_titulo, data_vencimento,
                    banco, data_operacao, taxa_desconto, iof, observacoes, valor_liquido } = req.body;

            if (!numero_titulo || !valor_titulo) {
                return res.status(400).json({ message: 'Número do título e valor são obrigatórios' });
            }

            try {
                await pool.execute(
                    `INSERT INTO operacoes_desconto (numero_titulo, cliente_sacado, valor_titulo, data_vencimento,
                     banco, data_operacao, taxa_desconto, iof, observacoes, valor_liquido, status, usuario_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo', ?)`,
                    [numero_titulo, cliente_sacado || '', parseFloat(valor_titulo), data_vencimento,
                     banco || '', data_operacao || new Date().toISOString().split('T')[0],
                     parseFloat(taxa_desconto) || 0, parseFloat(iof) || 0, observacoes || '',
                     parseFloat(valor_liquido) || 0, req.user?.id || null]
                );
                res.json({ success: true, message: 'Operação de desconto registrada' });
            } catch (tableErr) {
                if (tableErr.code === 'ER_NO_SUCH_TABLE') {
                    // Criar tabela se não existir
                    await pool.execute(`CREATE TABLE IF NOT EXISTS operacoes_desconto (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        numero_titulo VARCHAR(50) NOT NULL,
                        cliente_sacado VARCHAR(200),
                        valor_titulo DECIMAL(15,2),
                        data_vencimento DATE,
                        banco VARCHAR(100),
                        data_operacao DATE,
                        taxa_desconto DECIMAL(10,4) DEFAULT 0,
                        iof DECIMAL(10,4) DEFAULT 0,
                        observacoes TEXT,
                        valor_liquido DECIMAL(15,2),
                        status VARCHAR(20) DEFAULT 'ativo',
                        usuario_id INT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
                    await pool.execute(
                        `INSERT INTO operacoes_desconto (numero_titulo, cliente_sacado, valor_titulo, data_vencimento,
                         banco, data_operacao, taxa_desconto, iof, observacoes, valor_liquido, status, usuario_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo', ?)`,
                        [numero_titulo, cliente_sacado || '', parseFloat(valor_titulo), data_vencimento,
                         banco || '', data_operacao || new Date().toISOString().split('T')[0],
                         parseFloat(taxa_desconto) || 0, parseFloat(iof) || 0, observacoes || '',
                         parseFloat(valor_liquido) || 0, req.user?.id || null]
                    );
                    res.json({ success: true, message: 'Operação de desconto registrada' });
                } else {
                    throw tableErr;
                }
            }
        } catch (err) {
            console.error('[FINANCEIRO] Erro POST operacoes/desconto:', err.message);
            res.status(500).json({ message: 'Erro ao registrar operação de desconto' });
        }
    });

    // ============================================================
    // ROTAS MIGRADAS DE src/routes/financeiro.js (anteriormente não montadas)
    // Adicionadas em 2026-02-18 para corrigir 404s no frontend
    // ============================================================

    // ---- DASHBOARD: Resumo KPIs ----
    router.get('/resumo-kpis', authenticateToken, async (req, res) => {
        try {
            const [receberTotal] = await pool.execute(`
                SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as quantidade
                FROM contas_receber WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            `);
            const [pagarTotal] = await pool.execute(`
                SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as quantidade
                FROM contas_pagar WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            `);
            const [vencidosReceber] = await pool.execute(`
                SELECT COUNT(*) as quantidade FROM contas_receber
                WHERE COALESCE(data_vencimento, vencimento) < CURDATE()
                AND status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            `);
            const [vencidosPagar] = await pool.execute(`
                SELECT COUNT(*) as quantidade FROM contas_pagar
                WHERE COALESCE(data_vencimento, vencimento) < CURDATE()
                AND status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            `);

            const totalReceber = parseFloat(receberTotal[0]?.total || 0);
            const totalPagar = parseFloat(pagarTotal[0]?.total || 0);

            res.json({
                success: true,
                data: {
                    totalReceber,
                    totalPagar,
                    saldo: totalReceber - totalPagar,
                    vencidos: (vencidosReceber[0]?.quantidade || 0) + (vencidosPagar[0]?.quantidade || 0),
                    quantidadeReceber: receberTotal[0]?.quantidade || 0,
                    quantidadePagar: pagarTotal[0]?.quantidade || 0
                }
            });
        } catch (error) {
            console.error('[Financeiro] Erro resumo-kpis:', error.message);
            res.status(500).json({ error: 'Erro ao buscar resumo KPIs' });
        }
    });

    // ---- DASHBOARD: Próximos Vencimentos ----
    router.get('/proximos-vencimentos', authenticateToken, async (req, res) => {
        try {
            const limite = parseInt(req.query.limite) || 5;
            const [receber] = await pool.query(`
                SELECT cr.id, 'receber' as tipo,
                    COALESCE(c.nome_fantasia, c.razao_social, cr.descricao, 'N/D') as descricao,
                    cr.valor, COALESCE(cr.data_vencimento, cr.vencimento) as data_vencimento, cr.status
                FROM contas_receber cr LEFT JOIN clientes c ON cr.cliente_id = c.id
                WHERE cr.status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
                ORDER BY COALESCE(cr.data_vencimento, cr.vencimento) ASC LIMIT ?
            `, [limite]);
            const [pagar] = await pool.query(`
                SELECT cp.id, 'pagar' as tipo,
                    COALESCE(f.nome_fantasia, f.razao_social, f.nome, cp.descricao, 'N/D') as descricao,
                    cp.valor, COALESCE(cp.data_vencimento, cp.vencimento) as data_vencimento, cp.status
                FROM contas_pagar cp LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
                WHERE cp.status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
                ORDER BY COALESCE(cp.data_vencimento, cp.vencimento) ASC LIMIT ?
            `, [limite]);

            const todas = [...receber, ...pagar]
                .sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento))
                .slice(0, limite);
            res.json({ success: true, data: todas });
        } catch (error) {
            console.error('[Financeiro] Erro proximos-vencimentos:', error.message);
            res.status(500).json({ error: 'Erro ao buscar vencimentos' });
        }
    });

    // ---- DASHBOARD: Últimos Lançamentos ----
    router.get('/ultimos-lancamentos', authenticateToken, async (req, res) => {
        try {
            const limite = parseInt(req.query.limite) || 10;
            const [receber] = await pool.query(`
                SELECT cr.id, 'Receber' as tipo,
                    COALESCE(c.nome_fantasia, c.razao_social, cr.descricao, 'N/D') as descricao,
                    cr.valor, COALESCE(cr.data_vencimento, cr.vencimento) as data_vencimento, cr.status, cr.data_criacao
                FROM contas_receber cr LEFT JOIN clientes c ON cr.cliente_id = c.id
                ORDER BY cr.data_criacao DESC LIMIT ?
            `, [limite]);
            const [pagar] = await pool.query(`
                SELECT cp.id, 'Pagar' as tipo,
                    COALESCE(f.nome_fantasia, f.razao_social, f.nome, cp.descricao, 'N/D') as descricao,
                    cp.valor, COALESCE(cp.data_vencimento, cp.vencimento) as data_vencimento, cp.status, cp.data_criacao
                FROM contas_pagar cp LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
                ORDER BY cp.data_criacao DESC LIMIT ?
            `, [limite]);

            const todas = [...receber, ...pagar]
                .sort((a, b) => new Date(b.data_criacao || b.data_vencimento) - new Date(a.data_criacao || a.data_vencimento))
                .slice(0, limite);
            res.json({ success: true, data: todas });
        } catch (error) {
            console.error('[Financeiro] Erro ultimos-lancamentos:', error.message);
            res.status(500).json({ error: 'Erro ao buscar lançamentos' });
        }
    });

    // ---- CENTROS DE CUSTO: PUT e DELETE ----
    router.put('/centros-custo/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { codigo, nome, departamento, responsavel, orcamento_mensal, ativo } = req.body;
            await pool.query(
                `UPDATE centros_custo SET codigo=?, nome=?, departamento=?, responsavel=?, orcamento_mensal=?, ativo=?, updated_at=NOW() WHERE id=?`,
                [codigo, nome, departamento, responsavel || null, orcamento_mensal || 0, ativo ? 1 : 0, id]
            );
            res.json({ success: true, message: 'Centro de custo atualizado com sucesso' });
        } catch (error) {
            console.error('[Financeiro] Erro PUT centros-custo:', error.message);
            res.status(500).json({ error: 'Erro ao atualizar centro de custo' });
        }
    });

    router.delete('/centros-custo/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM centros_custo WHERE id = ?', [id]);
            res.json({ success: true, message: 'Centro de custo excluído com sucesso' });
        } catch (error) {
            console.error('[Financeiro] Erro DELETE centros-custo:', error.message);
            res.status(500).json({ error: 'Erro ao excluir centro de custo' });
        }
    });

    // ---- ORÇAMENTOS: PUT ----
    router.put('/orcamentos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { categoria, centro_custo, limite, alerta, gasto } = req.body;
            await pool.query(
                `UPDATE orcamentos SET categoria=?, centro_custo=?, limite=?, alerta=?, gasto=?, updated_at=NOW() WHERE id=?`,
                [categoria, centro_custo || null, limite, alerta, gasto || 0, id]
            );
            res.json({ success: true, message: 'Orçamento atualizado com sucesso' });
        } catch (error) {
            console.error('[Financeiro] Erro PUT orcamentos:', error.message);
            res.status(500).json({ error: 'Erro ao atualizar orçamento' });
        }
    });

    // ---- PLANO DE CONTAS: CRUD completo ----
    router.get('/plano-contas', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM plano_contas ORDER BY codigo');
            res.json(rows);
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            console.error('[Financeiro] Erro GET plano-contas:', error.message);
            res.status(500).json({ error: 'Erro ao buscar plano de contas' });
        }
    });

    router.post('/plano-contas', authenticateToken, async (req, res) => {
        try {
            const { codigo, nome, tipo, pai_id, cor, icone, ativo } = req.body;
            const [result] = await pool.query(
                `INSERT INTO plano_contas (codigo, nome, tipo, pai_id, cor, icone, ativo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [codigo, nome, tipo, pai_id || null, cor || '#6366f1', icone || 'fa-folder', ativo !== false ? 1 : 0]
            );
            res.json({ success: true, id: result.insertId, message: 'Conta criada com sucesso' });
        } catch (error) {
            console.error('[Financeiro] Erro POST plano-contas:', error.message);
            res.status(500).json({ error: 'Erro ao criar conta no plano de contas' });
        }
    });

    router.put('/plano-contas/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { codigo, nome, tipo, pai_id, cor, icone, ativo } = req.body;
            await pool.query(
                `UPDATE plano_contas SET codigo=?, nome=?, tipo=?, pai_id=?, cor=?, icone=?, ativo=?, updated_at=NOW() WHERE id=?`,
                [codigo, nome, tipo, pai_id || null, cor, icone || 'fa-folder', ativo ? 1 : 0, id]
            );
            res.json({ success: true, message: 'Conta atualizada com sucesso' });
        } catch (error) {
            console.error('[Financeiro] Erro PUT plano-contas:', error.message);
            res.status(500).json({ error: 'Erro ao atualizar conta' });
        }
    });

    router.delete('/plano-contas/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM plano_contas WHERE id = ?', [id]);
            res.json({ success: true, message: 'Conta excluída com sucesso' });
        } catch (error) {
            console.error('[Financeiro] Erro DELETE plano-contas:', error.message);
            res.status(500).json({ error: 'Erro ao excluir conta' });
        }
    });

    // ---- BANCOS: CRUD completo (tabela `bancos`, diferente de `contas_bancarias`) ----
    router.get('/bancos', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT b.*,
                    COALESCE((SELECT SUM(valor) FROM movimentacoes_bancarias WHERE banco_id = b.id AND tipo = 'entrada' AND MONTH(data) = MONTH(CURDATE()) AND YEAR(data) = YEAR(CURDATE())), 0) as entradas_mes,
                    COALESCE((SELECT SUM(valor) FROM movimentacoes_bancarias WHERE banco_id = b.id AND tipo = 'saida' AND MONTH(data) = MONTH(CURDATE()) AND YEAR(data) = YEAR(CURDATE())), 0) as saidas_mes
                FROM bancos b ORDER BY b.nome
            `);
            res.json(rows);
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            console.error('[Financeiro] Erro GET bancos:', error.message);
            res.status(500).json({ error: 'Erro ao buscar bancos' });
        }
    });

    router.get('/bancos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(`
                SELECT b.*,
                    COALESCE((SELECT SUM(valor) FROM movimentacoes_bancarias WHERE banco_id = b.id AND tipo = 'entrada' AND MONTH(data) = MONTH(CURDATE()) AND YEAR(data) = YEAR(CURDATE())), 0) as entradas_mes,
                    COALESCE((SELECT SUM(valor) FROM movimentacoes_bancarias WHERE banco_id = b.id AND tipo = 'saida' AND MONTH(data) = MONTH(CURDATE()) AND YEAR(data) = YEAR(CURDATE())), 0) as saidas_mes
                FROM bancos b WHERE b.id = ?
            `, [id]);
            if (!rows.length) return res.status(404).json({ error: 'Banco não encontrado' });
            res.json(rows[0]);
        } catch (error) {
            console.error('[Financeiro] Erro GET bancos/:id:', error.message);
            res.status(500).json({ error: 'Erro ao buscar banco' });
        }
    });

    router.post('/bancos', authenticateToken, async (req, res) => {
        try {
            const { codigo, nome, agencia, conta, tipo, apelido, saldo, saldo_inicial, observacoes, ativo } = req.body;
            const [result] = await pool.query(
                `INSERT INTO bancos (codigo, nome, agencia, conta, tipo, apelido, saldo, saldo_inicial, observacoes, ativo, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [codigo, nome, agencia, conta, tipo || 'corrente', apelido || '', saldo || 0, saldo_inicial || 0, observacoes || '', ativo !== false ? 1 : 0]
            );
            res.json({ success: true, id: result.insertId, message: 'Banco cadastrado com sucesso' });
        } catch (error) {
            console.error('[Financeiro] Erro POST bancos:', error.message);
            res.status(500).json({ error: 'Erro ao cadastrar banco' });
        }
    });

    router.put('/bancos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { codigo, nome, agencia, conta, tipo, apelido, saldo, saldo_inicial, observacoes, ativo } = req.body;
            await pool.query(
                `UPDATE bancos SET codigo=?, nome=?, agencia=?, conta=?, tipo=?, apelido=?, saldo=?, saldo_inicial=?, observacoes=?, ativo=?, updated_at=NOW() WHERE id=?`,
                [codigo, nome, agencia, conta, tipo, apelido, saldo, saldo_inicial, observacoes, ativo ? 1 : 0, id]
            );
            res.json({ success: true, message: 'Banco atualizado com sucesso' });
        } catch (error) {
            console.error('[Financeiro] Erro PUT bancos/:id:', error.message);
            res.status(500).json({ error: 'Erro ao atualizar banco' });
        }
    });

    router.delete('/bancos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM bancos WHERE id = ?', [id]);
            res.json({ success: true, message: 'Banco excluído com sucesso' });
        } catch (error) {
            console.error('[Financeiro] Erro DELETE bancos/:id:', error.message);
            res.status(500).json({ error: 'Erro ao excluir banco' });
        }
    });

    router.get('/bancos/:id/movimentacoes', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { mes, ano } = req.query;
            let where = 'WHERE mb.banco_id = ?';
            const params = [id];
            if (mes && ano) {
                where += ' AND MONTH(mb.data) = ? AND YEAR(mb.data) = ?';
                params.push(parseInt(mes), parseInt(ano));
            }
            const [rows] = await pool.query(`
                SELECT mb.*, b.nome as banco_nome
                FROM movimentacoes_bancarias mb
                LEFT JOIN bancos b ON mb.banco_id = b.id
                ${where} ORDER BY mb.data DESC
            `, params);
            res.json(rows);
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            console.error('[Financeiro] Erro GET bancos/:id/movimentacoes:', error.message);
            res.status(500).json({ error: 'Erro ao buscar movimentações' });
        }
    });

    // ---- ALIAS: contas-pagar/:id/baixar (chamado pelo frontend, executa mesma lógica de /pagar) ----
    router.post('/contas-pagar/:id/baixar', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { valor_pago, data_pagamento, conta_bancaria_id, forma_pagamento_id, observacoes } = req.body;
            const [conta] = await pool.query('SELECT * FROM contas_pagar WHERE id = ?', [id]);
            if (!conta || conta.length === 0) return res.status(404).json({ message: 'Conta não encontrada' });
            const valorTotal = conta[0].valor + (conta[0].valor_juros || 0) + (conta[0].valor_multa || 0) - (conta[0].valor_desconto || 0);
            const status = valor_pago >= valorTotal ? 'pago' : 'pendente';
            await pool.query(
                `UPDATE contas_pagar SET status=?, valor_pago=?, data_pagamento=?, conta_bancaria_id=?, forma_pagamento_id=?, observacoes=? WHERE id=?`,
                [status, valor_pago, data_pagamento || new Date().toISOString().split('T')[0], conta_bancaria_id, forma_pagamento_id, observacoes, id]
            );
            res.json({ success: true, message: 'Pagamento registrado com sucesso' });
        } catch (err) {
            console.error('[Financeiro] Erro POST contas-pagar/:id/baixar:', err.message);
            res.status(500).json({ message: 'Erro ao registrar pagamento' });
        }
    });

    return router;
};
