/**
 * POST-EXPORTS ROUTES - Extracted from server.js (Lines 27098-30494)
 * These routes were originally AFTER module.exports (architectural issue now fixed).
 * Contains: categorias, bancos, formas-pagamento, parcelas, estoque, vendas relatorios
 * @module routes/post-exports-routes
 */
const express = require('express');
let logger;
try { logger = require('../src/logger'); } catch(_) { logger = console; }

module.exports = function createPostExportsRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeAdmin, writeAuditLog, jwt, JWT_SECRET, cacheMiddleware, CACHE_CONFIG, checkFinanceiroPermission } = deps;
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
    // If this file is run directly, start the server normally
    // ============================================================
    // MÓDULO FINANCEIRO COMPLETO - TODAS AS APIs
    // Sistema ALUFORCE v2.0
    // AUDIT-FIX CRIT-001/002: Duplicate checkFinanceiroPermission REMOVED.
    // The single authoritative definition is at ~L21237 (fail-closed, DB-driven).
    // ============================================================
    
    // ============================================================
    // CATEGORIAS FINANCEIRAS
    // ============================================================
    
    // Listar todas as categorias
    router.get('/financeiro/categorias', authenticateToken, async (req, res) => {
        try {
            const { tipo, ativo } = req.query;
    
            let query = 'SELECT id, nome, tipo, cor, icone, orcamento_mensal, descricao, ativo, created_at FROM categorias_financeiras WHERE 1=1';
            const params = [];
    
            if (tipo && tipo !== 'todos') {
                query += ' AND (tipo = ? OR tipo = "ambos")';
                params.push(tipo);
            }
    
            if (ativo !== undefined) {
                query += ' AND ativo = ?';
                params.push(ativo === 'true' || ativo === '1');
            }
    
            query += ' ORDER BY nome ASC';
    
            // Add pagination
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
    
    // Criar categoria
    router.post('/financeiro/categorias', authenticateToken, async (req, res) => {
        try {
            const { nome, tipo, cor, icone, orcamento_mensal, descricao } = req.body;
    
            if (!nome || !tipo) {
                return res.status(400).json({ message: 'Nome e tipo são obrigatórios' });
            }
    
            const [result] = await pool.query(
                `INSERT INTO categorias_financeiras (nome, tipo, cor, icone, orcamento_mensal, descricao)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [nome, tipo, cor || '#3b82f6', icone || 'fa-folder', orcamento_mensal || 0, descricao]
            );
    
            res.status(201).json({
                success: true,
                message: 'Categoria criada com sucesso',
                id: result.insertId
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao criar categoria:', err);
            res.status(500).json({ message: 'Erro ao criar categoria' });
        }
    });
    
    // Atualizar categoria
    router.put('/financeiro/categorias/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, tipo, cor, icone, orcamento_mensal, descricao, ativo } = req.body;
    
            await pool.query(
                `UPDATE categorias_financeiras
                 SET nome = ?, tipo = ?, cor = ?, icone = ?, orcamento_mensal = ?, descricao = ?, ativo = ?
                 WHERE id = ?`,
                [nome, tipo, cor, icone, orcamento_mensal, descricao, ativo, id]
            );
    
            res.json({ success: true, message: 'Categoria atualizada com sucesso' });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao atualizar categoria:', err);
            res.status(500).json({ message: 'Erro ao atualizar categoria' });
        }
    });
    
    // Deletar categoria
    router.delete('/financeiro/categorias/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
    
            // Verificar se categoria está sendo usada
            const [usoPagar] = await pool.query('SELECT COUNT(*) as total FROM contas_pagar WHERE categoria = (SELECT nome FROM categorias_financeiras WHERE id = ?)', [id]);
            const [usoReceber] = await pool.query('SELECT COUNT(*) as total FROM contas_receber WHERE categoria = (SELECT nome FROM categorias_financeiras WHERE id = ?)', [id]);
    
            if (usoPagar[0].total > 0 || usoReceber[0].total > 0) {
                return res.status(400).json({
                    message: 'Esta categoria está sendo usada e não pode ser excluída. Desative-a ao invés disso.'
                });
            }
    
            await pool.query('DELETE FROM categorias_financeiras WHERE id = ?', [id]);
            res.json({ success: true, message: 'Categoria excluída com sucesso' });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao excluir categoria:', err);
            res.status(500).json({ message: 'Erro ao excluir categoria' });
        }
    });
    
    // Obter categoria específica
    router.get('/financeiro/categorias/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query('SELECT * FROM categorias_financeiras WHERE id = ?', [id]);
    
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Categoria não encontrada' });
            }
    
            res.json({ success: true, categoria: rows[0] });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar categoria:', err);
            res.status(500).json({ message: 'Erro ao buscar categoria' });
        }
    });
    
    // Estatísticas por categoria
    router.get('/financeiro/categorias/estatisticas', authenticateToken, async (req, res) => {
        try {
            const { mes } = req.query;
            let dataInicio, dataFim;
    
            if (mes) {
                dataInicio = `${mes}-01`;
                dataFim = `${mes}-31`;
            } else {
                const data = new Date();
                dataInicio = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-01`;
                dataFim = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-31`;
            }
    
            const [stats] = await pool.query(`
                SELECT
                    c.id,
                    c.nome,
                    c.tipo,
                    c.cor,
                    c.orcamento_mensal,
                    COALESCE(SUM(CASE WHEN p.tipo = 'pagar' THEN p.valor ELSE 0 END), 0) as total_despesas,
                    COALESCE(SUM(CASE WHEN p.tipo = 'receber' THEN p.valor ELSE 0 END), 0) as total_receitas
                FROM categorias_financeiras c
                LEFT JOIN (
                    SELECT categoria_id, valor, 'pagar' as tipo
                    FROM contas_pagar
                    WHERE data_vencimento BETWEEN ? AND ? AND status != 'cancelada'
                    UNION ALL
                    SELECT categoria_id, valor, 'receber' as tipo
                    FROM contas_receber
                    WHERE vencimento BETWEEN ? AND ? AND status != 'cancelado'
                ) p ON c.nome = p.categoria
                WHERE c.ativo = TRUE
                GROUP BY c.id, c.nome, c.tipo, c.cor, c.orcamento_mensal
                ORDER BY c.nome
            `, [dataInicio, dataFim, dataInicio, dataFim]);
    
            res.json(stats);
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar estatísticas:', err);
            res.status(500).json({ message: 'Erro ao buscar estatísticas' });
        }
    });
    
    // ============================================================
    // CONTAS BANCÁRIAS
    // ============================================================
    
    // Listar contas bancárias
    router.get('/financeiro/bancos', authenticateToken, async (req, res) => {
        try {
            const { ativo } = req.query;
    
            let query = 'SELECT id, nome, banco, agencia, conta, tipo, saldo_inicial, saldo_atual, ativo, observacoes, created_at FROM contas_bancarias WHERE 1=1';
            const params = [];
    
            if (ativo !== undefined) {
                query += ' AND ativo = ?';
                params.push(ativo === 'true' || ativo === '1');
            }
    
            query += ' ORDER BY ativo DESC, nome ASC';
    
            // Add pagination
            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            query += ' LIMIT ? OFFSET ?';
            params.push(limit, offset);
    
            const [contas] = await pool.query(query, params);
            res.json(contas);
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao listar contas bancárias:', err);
            res.status(500).json({ message: 'Erro ao listar contas bancárias' });
        }
    });
    
    // Criar conta bancária
    router.post('/financeiro/bancos', authenticateToken, async (req, res) => {
        try {
            const { nome, banco, agencia, conta, tipo, saldo_inicial, observacoes } = req.body;
    
            const nomeBanco = nome || banco; // Aceitar ambos
            if (!nomeBanco) {
                return res.status(400).json({ message: 'Nome do banco é obrigatório' });
            }
    
            // Validar tipo se fornecido
            const tipoValido = ['corrente', 'poupanca', 'investimento', 'caixa'];
            const tipoFinal = tipo && tipoValido.includes(tipo) ? tipo : 'corrente';
    
            console.log('[FINANCEIRO] Criando banco:', { nome: nomeBanco, banco, tipo: tipoFinal });
    
            const [result] = await pool.query(
                `INSERT INTO contas_bancarias (nome, banco, agencia, conta, tipo, saldo_inicial, saldo_atual, ativo)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
                [nomeBanco, banco || null, agencia || null, conta || null, tipoFinal, saldo_inicial || 0, saldo_inicial || 0]
            );
    
            console.log('[FINANCEIRO] Banco criado com ID:', result.insertId);
    
            res.status(201).json({
                success: true,
                message: 'Conta bancária criada com sucesso',
                id: result.insertId
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao criar conta bancária:', err.message);
            console.error('[FINANCEIRO] Stack:', err.stack);
            res.status(500).json({ message: 'Erro ao criar conta bancária', error: err.message });
        }
    });
    
    // Atualizar conta bancária
    router.put('/financeiro/bancos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { nome, banco, agencia, conta, tipo, saldo_inicial, ativo, observacoes } = req.body;
    
            const nomeBanco = nome || banco;
    
            await pool.query(
                `UPDATE contas_bancarias
                 SET nome = ?, banco = ?, agencia = ?, conta = ?, tipo = ?, saldo_inicial = ?, ativo = ?, observacoes = ?
                 WHERE id = ?`,
                [nomeBanco, banco, agencia, conta, tipo, saldo_inicial, ativo, observacoes, id]
            );
    
            res.json({ success: true, message: 'Conta bancária atualizada com sucesso' });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao atualizar conta bancária:', err);
            res.status(500).json({ message: 'Erro ao atualizar conta bancária' });
        }
    });
    
    // Deletar conta bancária (soft delete for consistency)
    // AUDIT-FIX HIGH-011: Changed from hard DELETE to soft delete
    router.delete('/financeiro/bancos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
    
            // Verificar se tem movimentações
            try {
                const [movs] = await pool.query('SELECT COUNT(*) as total FROM movimentacoes_bancarias WHERE conta_bancaria_id = ?', [id]);
                if (movs[0].total > 0) {
                    return res.status(400).json({
                        message: 'Esta conta tem movimentações e não pode ser excluída. Desative-a ao invés disso.'
                    });
                }
            } catch (e) { /* movimentacoes_bancarias may not have conta_bancaria_id column */ }
    
            await pool.query('UPDATE contas_bancarias SET ativo = 0 WHERE id = ?', [id]);
            res.json({ success: true, message: 'Conta bancária desativada com sucesso' });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao excluir conta bancária:', err);
            res.status(500).json({ message: 'Erro ao excluir conta bancária' });
        }
    });
    
    // Obter banco específico
    router.get('/financeiro/bancos/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query('SELECT * FROM contas_bancarias WHERE id = ?', [id]);
    
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Conta bancária não encontrada' });
            }
    
            res.json({ success: true, banco: rows[0] });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar banco:', err);
            res.status(500).json({ message: 'Erro ao buscar banco' });
        }
    });
    
    // Extrato bancário
    router.get('/financeiro/bancos/:id/extrato', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { inicio, fim } = req.query;
    
            // Buscar movimentações de contas pagas e recebidas
            const [pagas] = await pool.query(
                `SELECT 'despesa' as tipo, fornecedor as descricao, valor, data_pagamento as data
                 FROM contas_pagar
                 WHERE banco_id = ? AND status = 'paga'
                 ${inicio ? 'AND data_pagamento >= ?' : ''}
                 ${fim ? 'AND data_pagamento <= ?' : ''}`,
                [id, inicio, fim].filter(Boolean)
            );
    
            const [recebidas] = await pool.query(
                `SELECT 'receita' as tipo, cliente as descricao, valor, data_recebimento as data
                 FROM contas_receber
                 WHERE banco_id = ? AND status = 'recebida'
                 ${inicio ? 'AND data_recebimento >= ?' : ''}
                 ${fim ? 'AND data_recebimento <= ?' : ''}`,
                [id, inicio, fim].filter(Boolean)
            );
    
            const extrato = [...pagas, ...recebidas].sort((a, b) =>
                new Date(b.data) - new Date(a.data)
            );
    
            res.json({ success: true, extrato });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar extrato:', err);
            res.status(500).json({ message: 'Erro ao buscar extrato' });
        }
    });
    
    // ============================================================
    // FORMAS DE PAGAMENTO
    // ============================================================
    
    // Listar formas de pagamento
    router.get('/financeiro/formas-pagamento', authenticateToken, async (req, res) => {
        try {
            const { ativo } = req.query;
    
let query = 'SELECT id, nome, tipo, icone, ativo FROM formas_pagamento WHERE 1=1';
            const params = [];

            if (ativo !== undefined) {
                query += ' AND ativo = ?';
                params.push(ativo === 'true' || ativo === '1');
            }

            query += ' ORDER BY nome ASC LIMIT 500';
    
            const [formas] = await pool.query(query, params);
            res.json(formas);
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao listar formas de pagamento:', err);
            res.status(500).json({ message: 'Erro ao listar formas de pagamento' });
        }
    });
    
    // Criar forma de pagamento
    router.post('/financeiro/formas-pagamento', authenticateToken, async (req, res) => {
        try {
            const { nome, tipo, icone } = req.body;
    
            if (!nome) {
                return res.status(400).json({ message: 'Nome é obrigatório' });
            }
    
            const [result] = await pool.query(
                'INSERT INTO formas_pagamento (nome, tipo, icone) VALUES (?, ?, ?)',
                [nome, tipo || 'outros', icone || 'fa-money-bill']
            );
    
            res.status(201).json({
                success: true,
                message: 'Forma de pagamento criada com sucesso',
                id: result.insertId
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao criar forma de pagamento:', err);
            res.status(500).json({ message: 'Erro ao criar forma de pagamento' });
        }
    });
    
    // ============================================================
    // PARCELAS
    // ============================================================
    
    // Gerar parcelas para uma conta
    router.post('/financeiro/parcelas/gerar', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { conta_id, tipo, total_parcelas, valor_total, primeira_parcela } = req.body;
    
            if (!conta_id || !tipo || !total_parcelas || !valor_total || !primeira_parcela) {
                connection.release();
                return res.status(400).json({ message: 'Dados incompletos' });
            }
    
            const valorParcela = (valor_total / total_parcelas).toFixed(2);
            const parcelas = [];
    
            for (let i = 1; i <= total_parcelas; i++) {
                const vencimento = new Date(primeira_parcela);
                vencimento.setMonth(vencimento.getMonth() + (i - 1));
    
                // Última parcela ajusta diferença de arredondamento
                const valor = i === total_parcelas
                    ? (valor_total - (valorParcela * (total_parcelas - 1))).toFixed(2)
                    : valorParcela;
    
                parcelas.push([
                    conta_id,
                    tipo,
                    i,
                    total_parcelas,
                    valor,
                    vencimento.toISOString().split('T')[0]
                ]);
            }
    
            await connection.query(
                `INSERT INTO parcelas (conta_origem_id, tipo, numero_parcela, total_parcelas, valor, vencimento)
                 VALUES ?`,
                [parcelas]
            );
    
            // Atualizar conta original
            const updateQuery = tipo === 'pagar'
                ? `UPDATE contas_pagar SET parcela_total = ? WHERE id = ?`
                : `UPDATE contas_receber SET parcela_total = ? WHERE id = ?`;
    
            await connection.query(updateQuery, [total_parcelas, conta_id]);
    
            await connection.commit();
            res.json({
                success: true,
                message: `${total_parcelas} parcelas geradas com sucesso`,
                parcelas: parcelas.length
            });
    
        } catch (err) {
            await connection.rollback();
            console.error('[FINANCEIRO] Erro ao gerar parcelas:', err);
            res.status(500).json({ message: 'Erro ao gerar parcelas' });
        } finally {
            connection.release();
        }
    });
    
    // Listar parcelas de uma conta (rota corrigida)
    router.get('/financeiro/parcelas/conta/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { tipo } = req.query; // 'pagar' ou 'receber'
    
            const [parcelas] = await pool.query(
                'SELECT * FROM parcelas WHERE conta_id = ? AND tipo_conta = ? ORDER BY numero_parcela ASC',
                [id, tipo || 'pagar']
            );
    
            res.json({ success: true, parcelas });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao listar parcelas:', err);
            res.status(500).json({ message: 'Erro ao listar parcelas' });
        }
    });
    
    // Listar parcelas de uma conta (rota alternativa)
    router.get('/financeiro/parcelas/:conta_id/:tipo', authenticateToken, async (req, res) => {
        try {
            const { conta_id, tipo } = req.params;
    
            const [parcelas] = await pool.query(
                'SELECT * FROM parcelas WHERE conta_id = ? AND tipo_conta = ? ORDER BY numero_parcela ASC',
                [conta_id, tipo]
            );
    
            res.json({ success: true, parcelas });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao listar parcelas:', err);
            res.status(500).json({ message: 'Erro ao listar parcelas' });
        }
    });
    
    // Marcar parcela como paga
    router.post('/financeiro/parcelas/:id/pagar', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { valor_pago, data_pagamento } = req.body;
    
            await pool.query(
                `UPDATE parcelas
                 SET status = ?, valor_pago = ?, data_pagamento = ?
                 WHERE id = ?`,
                [
                    valor_pago >= (await pool.query('SELECT valor FROM parcelas WHERE id = ?', [id]))[0][0].valor ? 'pago' : 'pendente',
                    valor_pago,
                    data_pagamento || new Date().toISOString().split('T')[0],
                    id
                ]
            );
    
            res.json({ success: true, message: 'Parcela atualizada com sucesso' });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao atualizar parcela:', err);
            res.status(500).json({ message: 'Erro ao atualizar parcela' });
        }
    });
    
    // ============================================================
    // RECORRÊNCIAS
    // ============================================================
    
    // Listar recorrências
    router.get('/financeiro/recorrencias', authenticateToken, async (req, res) => {
        try {
            const { tipo, ativa } = req.query;
    
            let query = 'SELECT r.*, c.nome as categoria_nome FROM recorrencias r LEFT JOIN categorias_financeiras c ON r.categoria_id = c.id WHERE 1=1';
            const params = [];
    
            if (tipo) {
                query += ' AND r.tipo = ?';
                params.push(tipo);
            }
    
            if (ativa !== undefined) {
                query += ' AND r.ativa = ?';
                params.push(ativa === 'true' || ativa === '1');
            }
    
            query += ' ORDER BY r.descricao ASC';
    
            const [recorrencias] = await pool.query(query, params);
            res.json(recorrencias);
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao listar recorrências:', err);
            res.status(500).json({ message: 'Erro ao listar recorrências' });
        }
    });
    
    // Criar recorrência
    router.post('/financeiro/recorrencias', authenticateToken, async (req, res) => {
        try {
            const {
                descricao, tipo, valor, categoria_id, fornecedor_id, cliente_id,
                dia_vencimento, forma_pagamento_id, conta_bancaria_id,
                data_inicio, data_fim, observacoes
            } = req.body;
    
            if (!descricao || !tipo || !valor || !dia_vencimento || !data_inicio) {
                return res.status(400).json({ message: 'Dados obrigatórios faltando' });
            }
    
            // Calcular próxima geração
            const proximaGeracao = new Date(data_inicio);
            proximaGeracao.setDate(dia_vencimento);
            if (proximaGeracao < new Date()) {
                proximaGeracao.setMonth(proximaGeracao.getMonth() + 1);
            }
    
            const [result] = await pool.query(
                `INSERT INTO recorrencias
                 (descricao, tipo, valor, categoria_id, fornecedor_id, cliente_id, dia_vencimento,
                  forma_pagamento_id, conta_bancaria_id, data_inicio, data_fim, observacoes, proxima_geracao)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [descricao, tipo, valor, categoria_id, fornecedor_id, cliente_id, dia_vencimento,
                 forma_pagamento_id, conta_bancaria_id, data_inicio, data_fim, observacoes,
                 proximaGeracao.toISOString().split('T')[0]]
            );
    
            res.status(201).json({
                success: true,
                message: 'Recorrência criada com sucesso',
                id: result.insertId
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao criar recorrência:', err);
            res.status(500).json({ message: 'Erro ao criar recorrência' });
        }
    });
    
    // Atualizar recorrência
    router.put('/financeiro/recorrencias/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const {
                descricao, tipo, valor, categoria_id, fornecedor_id, cliente_id,
                dia_vencimento, forma_pagamento_id, conta_bancaria_id,
                ativa, data_fim, observacoes
            } = req.body;
    
            await pool.query(
                `UPDATE recorrencias
                 SET descricao = ?, tipo = ?, valor = ?, categoria_id = ?, fornecedor_id = ?, cliente_id = ?,
                     dia_vencimento = ?, forma_pagamento_id = ?, conta_bancaria_id = ?,
                     ativa = ?, data_fim = ?, observacoes = ?
                 WHERE id = ?`,
                [descricao, tipo, valor, categoria_id, fornecedor_id, cliente_id, dia_vencimento,
                 forma_pagamento_id, conta_bancaria_id, ativa, data_fim, observacoes, id]
            );
    
            res.json({ success: true, message: 'Recorrência atualizada com sucesso' });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao atualizar recorrência:', err);
            res.status(500).json({ message: 'Erro ao atualizar recorrência' });
        }
    });
    
    // Deletar recorrência
    router.delete('/financeiro/recorrencias/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM recorrencias WHERE id = ?', [id]);
            res.json({ success: true, message: 'Recorrência excluída com sucesso' });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao excluir recorrência:', err);
            res.status(500).json({ message: 'Erro ao excluir recorrência' });
        }
    });
    
    // Obter recorrência específica
    router.get('/financeiro/recorrencias/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query('SELECT * FROM recorrencias_financeiras WHERE id = ?', [id]);
    
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Recorrência não encontrada' });
            }
    
            res.json({ success: true, recorrencia: rows[0] });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar recorrência:', err);
            res.status(500).json({ message: 'Erro ao buscar recorrência' });
        }
    });
    
    // Pausar/Reativar recorrência
    router.post('/financeiro/recorrencias/:id/pausar', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { ativo } = req.body; // true ou false
    
            await pool.query(
                'UPDATE recorrencias_financeiras SET ativo = ? WHERE id = ?',
                [ativo ? 1 : 0, id]
            );
    
            res.json({
                success: true,
                message: ativo ? 'Recorrência reativada' : 'Recorrência pausada'
            });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao pausar/reativar recorrência:', err);
            res.status(500).json({ message: 'Erro ao atualizar recorrência' });
        }
    });
    
    // Gerar contas de recorrências (executar manualmente ou por cron)
    router.post('/financeiro/recorrencias/processar', authenticateToken, async (req, res) => {
        try {
            const hoje = new Date().toISOString().split('T')[0];
    
            // Buscar recorrências ativas que devem gerar conta hoje
            const [recorrencias] = await pool.query(
                `SELECT id, tipo, descricao, valor, dia_vencimento, periodo, categoria_id,
                        forma_pagamento_id, conta_bancaria_id, fornecedor_id, cliente_id,
                        observacoes, ativa, proxima_geracao, data_fim
                 FROM recorrencias
                 WHERE ativa = TRUE
                 AND (data_fim IS NULL OR data_fim >= ?)
                 AND (proxima_geracao IS NULL OR proxima_geracao <= ?)`,
                [hoje, hoje]
            );
    
            let geradas = 0;
    
            for (const rec of recorrencias) {
                const vencimento = new Date();
                vencimento.setDate(rec.dia_vencimento);
    
                // Inserir conta a pagar ou receber
                if (rec.tipo === 'pagar') {
                    await pool.query(
                        `INSERT INTO contas_pagar
                         (fornecedor_id, descricao, valor, vencimento, categoria, forma_pagamento_id,
                          conta_bancaria_id, recorrente, recorrencia_id, status, observacoes)
                         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?, 'pendente', ?)`,
                        [rec.fornecedor_id, rec.descricao, rec.valor, vencimento.toISOString().split('T')[0],
                         rec.categoria_id, rec.forma_pagamento_id, rec.conta_bancaria_id, rec.id, rec.observacoes]
                    );
                } else {
                    await pool.query(
                        `INSERT INTO contas_receber
                         (cliente_id, descricao, valor, vencimento, categoria, forma_recebimento_id,
                          conta_bancaria_id, status, observacoes)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`,
                        [rec.cliente_id, rec.descricao, rec.valor, vencimento.toISOString().split('T')[0],
                         rec.categoria_id, rec.forma_pagamento_id, rec.conta_bancaria_id, rec.observacoes]
                    );
                }
    
                // Atualizar próxima geração
                const proximaGeracao = new Date(vencimento);
                proximaGeracao.setMonth(proximaGeracao.getMonth() + 1);
    
                await pool.query(
                    'UPDATE recorrencias SET ultima_geracao = ?, proxima_geracao = ? WHERE id = ?',
                    [hoje, proximaGeracao.toISOString().split('T')[0], rec.id]
                );
    
                geradas++;
            }
    
            res.json({
                success: true,
                message: `${geradas} contas geradas de recorrências`,
                total: geradas
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao processar recorrências:', err);
            res.status(500).json({ message: 'Erro ao processar recorrências' });
        }
    });
    
    // Continua no próximo arquivo...
    
    
    // ============================================================
    // MÓDULO FINANCEIRO COMPLETO - APIs AVANÇADAS (Parte 2)
    // Sistema ALUFORCE v2.0
    // ============================================================
    
    // ============================================================
    // CONTAS A PAGAR - FUNÇÕES AVANÇADAS
    // ============================================================
    
    // Marcar conta como paga
    router.post('/financeiro/contas-pagar/:id/pagar', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const { id } = req.params;
            const { valor_pago, data_pagamento, conta_bancaria_id, forma_pagamento_id, observacoes } = req.body;
    
            const [conta] = await pool.query('SELECT * FROM contas_pagar WHERE id = ?', [id]);
            if (!conta || conta.length === 0) {
                return res.status(404).json({ message: 'Conta não encontrada' });
            }
    
            const valorTotal = conta[0].valor + (conta[0].valor_juros || 0) + (conta[0].valor_multa || 0) - (conta[0].valor_desconto || 0);
            const status = valor_pago >= valorTotal ? 'pago' : 'pendente';
    
            await pool.query(
                `UPDATE contas_pagar
                 SET status = ?, valor_pago = ?, data_pagamento = ?, conta_bancaria_id = ?, forma_pagamento_id = ?, observacoes = ?
                 WHERE id = ?`,
                [status, valor_pago, data_pagamento || new Date().toISOString().split('T')[0], conta_bancaria_id, forma_pagamento_id, observacoes, id]
            );
    
            // Se tiver conta bancária, criar movimentação
            if (conta_bancaria_id && status === 'pago') {
                await pool.query(
                    `INSERT INTO movimentacoes_bancarias
                     (conta_bancaria_id, tipo, valor, descricao, data_movimento, conta_pagar_id, forma_pagamento_id)
                     VALUES (?, 'saida', ?, ?, ?, ?, ?)`,
                    [conta_bancaria_id, valor_pago, conta[0].descricao, data_pagamento || new Date().toISOString().split('T')[0], id, forma_pagamento_id]
                );
            }
    
            res.json({ success: true, message: 'Pagamento registrado com sucesso' });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao marcar como pago:', err);
            res.status(500).json({ message: 'Erro ao registrar pagamento' });
        }
    });
    
    // Listar contas vencidas
    router.get('/financeiro/contas-pagar/vencidas', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const [contas] = await pool.query(
                `SELECT id, fornecedor_id, descricao, valor, valor_pago, valor_juros, valor_multa, valor_desconto,
                        vencimento, data_pagamento, status, categoria, categoria_id, forma_pagamento_id,
                        conta_bancaria_id, documento, observacoes, created_at,
                        DATEDIFF(CURDATE(), vencimento) as dias_vencido
                 FROM contas_pagar
                 WHERE status IN ('pendente', 'vencido') AND vencimento < CURDATE()
                 ORDER BY vencimento ASC
                 LIMIT 500`
            );

            res.json(contas);

        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar contas vencidas:', err);
            res.status(500).json({ message: 'Erro ao buscar contas vencidas' });
        }
    });
    
    // Listar contas vencendo
    router.get('/financeiro/contas-pagar/vencendo', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const { dias } = req.query;
            const prazo = dias || 7;
    
            const [contas] = await pool.query(
                `SELECT id, fornecedor_id, descricao, valor, valor_pago, valor_juros, valor_multa, valor_desconto,
                        vencimento, data_pagamento, status, categoria, categoria_id, forma_pagamento_id,
                        conta_bancaria_id, documento, observacoes, created_at,
                        DATEDIFF(vencimento, CURDATE()) as dias_para_vencer
                 FROM contas_pagar
                 WHERE status = 'pendente'
                 AND vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
                 ORDER BY vencimento ASC
                 LIMIT 500`,
                [prazo]
            );
    
            res.json(contas);
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar contas vencendo:', err);
            res.status(500).json({ message: 'Erro ao buscar contas vencendo' });
        }
    });
    
    // Estatísticas de contas a pagar
    router.get('/financeiro/contas-pagar/estatisticas', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        try {
            const [stats] = await pool.query(`
                SELECT
                    COUNT(*) as total_contas,
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
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar estatísticas:', err);
            res.status(500).json({ message: 'Erro ao buscar estatísticas' });
        }
    });
    
    // Pagamento em lote — AUDIT-FIX CRIT-006: wrapped in transaction
    router.post('/financeiro/contas-pagar/lote/pagar', checkFinanceiroPermission('contas_pagar'), async (req, res) => {
        let connection;
        try {
            const { contas, data_pagamento, conta_bancaria_id, forma_pagamento_id } = req.body;
    
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
                        `UPDATE contas_pagar
                         SET status = 'pago', valor_pago = valor, data_pagamento = ?, conta_bancaria_id = ?, forma_pagamento_id = ?
                         WHERE id = ?`,
                        [dataPgto, conta_bancaria_id, forma_pagamento_id, contaId]
                    );
                    totalPago += conta[0].valor;
    
                    // Criar movimentação bancária
                    if (conta_bancaria_id) {
                        await connection.query(
                            `INSERT INTO movimentacoes_bancarias
                             (conta_bancaria_id, tipo, valor, descricao, data_movimento, conta_pagar_id, forma_pagamento_id)
                             VALUES (?, 'saida', ?, 'Pagamento em lote', ?, ?, ?)`,
                            [conta_bancaria_id, conta[0].valor, dataPgto, contaId, forma_pagamento_id]
                        );
                    }
                }
            }
    
            await connection.commit();
    
            res.json({
                success: true,
                message: `${contas.length} contas pagas com sucesso`,
                total_pago: totalPago
            });
    
        } catch (err) {
            if (connection) try { await connection.rollback(); } catch (_) {}
            console.error('[FINANCEIRO] Erro ao pagar em lote:', err);
            res.status(500).json({ message: 'Erro ao pagar em lote' });
        } finally {
            if (connection) connection.release();
        }
    });
    
    // ============================================================
    // CONTAS A RECEBER - FUNÇÕES AVANÇADAS
    // ============================================================
    
    // Marcar conta como recebida
    router.post('/financeiro/contas-receber/:id/receber', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const { id } = req.params;
            const { valor_recebido, data_recebimento, conta_bancaria_id, forma_recebimento_id, observacoes } = req.body;
    
            const [conta] = await pool.query('SELECT * FROM contas_receber WHERE id = ?', [id]);
            if (!conta || conta.length === 0) {
                return res.status(404).json({ message: 'Conta não encontrada' });
            }
    
            const valorTotal = conta[0].valor + (conta[0].valor_juros || 0) + (conta[0].valor_multa || 0) - (conta[0].valor_desconto || 0);
            const status = valor_recebido >= valorTotal ? 'recebido' : 'pendente';
    
            await pool.query(
                `UPDATE contas_receber
                 SET status = ?, valor_recebido = ?, data_recebimento = ?, conta_bancaria_id = ?, forma_recebimento_id = ?, observacoes = ?
                 WHERE id = ?`,
                [status, valor_recebido, data_recebimento || new Date().toISOString().split('T')[0], conta_bancaria_id, forma_recebimento_id, observacoes, id]
            );
    
            // Se tiver conta bancária, criar movimentação
            if (conta_bancaria_id && status === 'recebido') {
                await pool.query(
                    `INSERT INTO movimentacoes_bancarias
                     (conta_bancaria_id, tipo, valor, descricao, data_movimento, conta_receber_id, forma_pagamento_id)
                     VALUES (?, 'entrada', ?, ?, ?, ?, ?)`,
                    [conta_bancaria_id, valor_recebido, conta[0].descricao, data_recebimento || new Date().toISOString().split('T')[0], id, forma_recebimento_id]
                );
            }
    
            res.json({ success: true, message: 'Recebimento registrado com sucesso' });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao marcar como recebido:', err);
            res.status(500).json({ message: 'Erro ao registrar recebimento' });
        }
    });
    
    // Listar contas vencidas
    router.get('/financeiro/contas-receber/vencidas', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const [contas] = await pool.query(
                `SELECT id, cliente_id, descricao, valor, valor_recebido, valor_juros, valor_multa, valor_desconto,
                        vencimento, data_recebimento, status, categoria, categoria_id, forma_recebimento_id,
                        conta_bancaria_id, documento, observacoes, created_at,
                        DATEDIFF(CURDATE(), vencimento) as dias_vencido
                 FROM contas_receber
                 WHERE status IN ('pendente', 'vencido') AND vencimento < CURDATE()
                 ORDER BY vencimento ASC
                 LIMIT 500`
            );

            res.json(contas);

        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar contas vencidas:', err);
            res.status(500).json({ message: 'Erro ao buscar contas vencidas' });
        }
    });

    // Clientes inadimplentes
    router.get('/financeiro/contas-receber/inadimplentes', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const [clientes] = await pool.query(`
                SELECT
                    cliente_id,
                    COUNT(*) as total_contas_vencidas,
                    SUM(valor) as valor_total_vencido,
                    MIN(vencimento) as vencimento_mais_antigo,
                    MAX(DATEDIFF(CURDATE(), vencimento)) as dias_max_atraso
                FROM contas_receber
                WHERE status IN ('pendente', 'vencido') AND vencimento < CURDATE() AND cliente_id IS NOT NULL
                GROUP BY cliente_id
                ORDER BY valor_total_vencido DESC
            `);
    
            res.json(clientes);
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar inadimplentes:', err);
            res.status(500).json({ message: 'Erro ao buscar inadimplentes' });
        }
    });
    
    // Estatísticas de contas a receber
    router.get('/financeiro/contas-receber/estatisticas', checkFinanceiroPermission('contas_receber'), async (req, res) => {
        try {
            const [stats] = await pool.query(`
                SELECT
                    COUNT(*) as total_contas,
                    SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) as pendentes,
                    SUM(CASE WHEN status = 'recebido' THEN 1 ELSE 0 END) as recebidas,
                    SUM(CASE WHEN status = 'vencido' THEN 1 ELSE 0 END) as vencidas,
                    SUM(valor) as valor_total,
                    SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END) as valor_pendente,
                    SUM(CASE WHEN status = 'recebido' THEN valor_recebido ELSE 0 END) as valor_recebido,
                    SUM(CASE WHEN vencimento < CURDATE() AND status = 'pendente' THEN valor ELSE 0 END) as valor_vencido
                FROM contas_receber
            `);
    
            res.json(stats[0]);
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar estatísticas:', err);
            res.status(500).json({ message: 'Erro ao buscar estatísticas' });
        }
    });
    
    // ============================================================
    // DASHBOARD E FLUXO DE CAIXA
    // ============================================================
    
    // Dashboard completo
    router.get('/financeiro/dashboard', authenticateToken, cacheMiddleware('fin_dashboard', CACHE_CONFIG.dashboardFinan), async (req, res) => {
        try {
            // Estatísticas gerais - usar COALESCE e aceitar ambos os nomes de coluna
            const [statsReceber] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) as a_receber,
                    COALESCE(SUM(CASE WHEN status = 'recebido' THEN COALESCE(valor_recebido, valor) ELSE 0 END), 0) as recebido,
                    COALESCE(SUM(CASE WHEN COALESCE(data_vencimento, vencimento) < CURDATE() AND status = 'pendente' THEN valor ELSE 0 END), 0) as vencido
                FROM contas_receber
            `);
    
            const [statsPagar] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) as a_pagar,
                    COALESCE(SUM(CASE WHEN status = 'pago' THEN COALESCE(valor_pago, valor) ELSE 0 END), 0) as pago,
                    COALESCE(SUM(CASE WHEN COALESCE(data_vencimento, vencimento) < CURDATE() AND status = 'pendente' THEN valor ELSE 0 END), 0) as vencido
                FROM contas_pagar
            `);
    
            // Contas vencendo hoje
            const [vencendoHoje] = await pool.query(`
                SELECT COUNT(*) as total FROM (
                    SELECT id FROM contas_pagar WHERE status = 'pendente' AND DATE(COALESCE(data_vencimento, vencimento)) = CURDATE()
                    UNION ALL
                    SELECT id FROM contas_receber WHERE status = 'pendente' AND DATE(COALESCE(data_vencimento, vencimento)) = CURDATE()
                ) as vencendo
            `);
    
            // Saldo das contas bancárias
            const [saldoBancos] = await pool.query(`
                SELECT COALESCE(SUM(saldo_atual), 0) as saldo_total FROM contas_bancarias WHERE ativo = TRUE
            `);
    
            // Saldo projetado (receber - pagar pendentes)
            const saldoProjetado = (statsReceber[0].a_receber || 0) - (statsPagar[0].a_pagar || 0);
    
            res.json({
                receber: {
                    a_receber: statsReceber[0].a_receber || 0,
                    recebido: statsReceber[0].recebido || 0,
                    vencido: statsReceber[0].vencido || 0
                },
                pagar: {
                    a_pagar: statsPagar[0].a_pagar || 0,
                    pago: statsPagar[0].pago || 0,
                    vencido: statsPagar[0].vencido || 0
                },
                saldo_atual: saldoBancos[0].saldo_total || 0,
                saldo_projetado: saldoProjetado,
                vencendo_hoje: vencendoHoje[0].total || 0
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar dashboard:', err);
            console.error('[FINANCEIRO] Stack:', err.stack);
            res.status(500).json({ message: 'Erro ao buscar dados do dashboard', error: err.message });
        }
    });
    
    // API completa do Fluxo de Caixa (com dados reais)
    router.get('/financeiro/fluxo-caixa/completo', authenticateToken, cacheMiddleware('fin_fluxo_comp', CACHE_CONFIG.dashboardFinan), async (req, res) => {
        try {
            const { periodo = '30d' } = req.query;
            const hoje = new Date();
    
            // Calcular datas baseado no período
            let diasFuturo = 30;
            let diasPassado = 30;
            if (periodo === '7d') { diasFuturo = 7; diasPassado = 7; }
            else if (periodo === '90d') { diasFuturo = 90; diasPassado = 30; }
            else if (periodo === 'ano') { diasFuturo = 365; diasPassado = 90; }
    
            const dataInicio = new Date(hoje);
            dataInicio.setDate(dataInicio.getDate() - diasPassado);
            const dataFim = new Date(hoje);
            dataFim.setDate(dataFim.getDate() + diasFuturo);
    
            const inicioStr = dataInicio.toISOString().split('T')[0];
            const fimStr = dataFim.toISOString().split('T')[0];
            const hojeStr = hoje.toISOString().split('T')[0];
    
            // 1. Saldo atual dos bancos
            const [saldoBancos] = await pool.query(`
                SELECT COALESCE(SUM(saldo_atual), 0) as saldo_total
                FROM bancos
                WHERE status = 'ativo'
            `);
            const saldoAtual = parseFloat(saldoBancos[0].saldo_total) || 0;
    
            // 2. Entradas previstas (contas a receber pendentes)
            const [entradasPrev] = await pool.query(`
                SELECT COALESCE(SUM(valor), 0) as total
                FROM contas_receber
                WHERE status = 'pendente'
                AND COALESCE(data_vencimento, vencimento) BETWEEN ? AND ?
            `, [hojeStr, fimStr]);
    
            // 3. Saídas previstas (contas a pagar pendentes)
            const [saidasPrev] = await pool.query(`
                SELECT COALESCE(SUM(valor), 0) as total
                FROM contas_pagar
                WHERE status = 'pendente'
                AND COALESCE(data_vencimento, vencimento) BETWEEN ? AND ?
            `, [hojeStr, fimStr]);
    
            const entradasPrevistas = parseFloat(entradasPrev[0].total) || 0;
            const saidasPrevistas = parseFloat(saidasPrev[0].total) || 0;
            const saldoProjetado = saldoAtual + entradasPrevistas - saidasPrevistas;
    
            // 4. Próximas movimentações (contas a pagar e receber futuras)
            const [proximasMovs] = await pool.query(`
                SELECT
                    'receber' as origem,
                    COALESCE(cr.data_vencimento, cr.vencimento) as data,
                    COALESCE(cr.descricao, CONCAT('Conta a Receber #', cr.id)) as descricao,
                    'entrada' as tipo,
                    cr.valor,
                    cr.categoria_id as categoria
                FROM contas_receber cr
                WHERE cr.status = 'pendente'
                AND COALESCE(cr.data_vencimento, cr.vencimento) >= ?
                UNION ALL
                SELECT
                    'pagar' as origem,
                    COALESCE(cp.data_vencimento, cp.vencimento) as data,
                    COALESCE(cp.descricao, CONCAT('Conta a Pagar #', cp.id)) as descricao,
                    'saida' as tipo,
                    cp.valor,
                    cp.categoria_id as categoria
                FROM contas_pagar cp
                WHERE cp.status = 'pendente'
                AND COALESCE(cp.data_vencimento, cp.vencimento) >= ?
                ORDER BY data ASC
                LIMIT 10
            `, [hojeStr, hojeStr]);
    
            // 5. Movimentações realizadas (do período passado)
            const [movimentacoes] = await pool.query(`
                SELECT
                    DATE(data) as data,
                    cliente_fornecedor as descricao,
                    categoria,
                    tipo,
                    valor,
                    saldo
                FROM movimentacoes_bancarias
                WHERE data BETWEEN ? AND ?
                ORDER BY data DESC, id DESC
                LIMIT 50
            `, [inicioStr, hojeStr]);
    
            // 6. Fluxo diário para o gráfico (últimos dias + próximos dias)
            const [fluxoDiario] = await pool.query(`
                SELECT
                    DATE(COALESCE(data_vencimento, vencimento)) as data,
                    COALESCE(SUM(CASE WHEN tipo = 'receber' THEN valor ELSE 0 END), 0) as entradas,
                    COALESCE(SUM(CASE WHEN tipo = 'pagar' THEN valor ELSE 0 END), 0) as saidas
                FROM (
                    SELECT COALESCE(data_vencimento, vencimento) as data_vencimento, vencimento, valor, 'receber' as tipo
                    FROM contas_receber
                    WHERE COALESCE(data_vencimento, vencimento) BETWEEN ? AND ?
                    AND status IN ('pendente', 'recebido', 'recebida')
                    UNION ALL
                    SELECT COALESCE(data_vencimento, vencimento) as data_vencimento, vencimento, valor, 'pagar' as tipo
                    FROM contas_pagar
                    WHERE COALESCE(data_vencimento, vencimento) BETWEEN ? AND ?
                    AND status IN ('pendente', 'pago', 'paga')
                ) as todas_contas
                GROUP BY DATE(COALESCE(data_vencimento, vencimento))
                ORDER BY data ASC
            `, [inicioStr, fimStr, inicioStr, fimStr]);
    
            // 7. Resumo semanal (próximos 7 dias)
            const resumoSemanal = [];
            for (let i = 0; i < 7; i++) {
                const dia = new Date(hoje);
                dia.setDate(hoje.getDate() + i);
                const diaStr = dia.toISOString().split('T')[0];
    
                const fluxoDia = fluxoDiario.find(f => {
                    const dataFluxo = new Date(f.data).toISOString().split('T')[0];
                    return dataFluxo === diaStr;
                });
    
                resumoSemanal.push({
                    data: diaStr,
                    diaSemana: dia.toLocaleDateString('pt-BR', { weekday: 'short' }),
                    diaNumero: dia.getDate(),
                    entradas: parseFloat(fluxoDia?.entradas) || 0,
                    saidas: parseFloat(fluxoDia?.saidas) || 0,
                    saldo: (parseFloat(fluxoDia?.entradas) || 0) - (parseFloat(fluxoDia?.saidas) || 0)
                });
            }
    
            res.json({
                success: true,
                saldoAtual,
                entradasPrevistas,
                saidasPrevistas,
                saldoProjetado,
                proximasMovimentacoes: proximasMovs,
                movimentacoes,
                fluxoDiario,
                resumoSemanal,
                periodo
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar fluxo de caixa completo:', err);
            res.status(500).json({ message: 'Erro ao buscar fluxo de caixa', error: err.message });
        }
    });
    
    // Fluxo de caixa
    router.get('/financeiro/fluxo-caixa', authenticateToken, cacheMiddleware('fin_fluxo', CACHE_CONFIG.dashboardFinan), async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;
    
            const inicio = data_inicio || new Date().toISOString().split('T')[0];
            const fim = data_fim || new Date(new Date().setMonth(new Date().getMonth() + 3)).toISOString().split('T')[0];
    
            const [fluxo] = await pool.query(`
                SELECT
                    DATE(vencimento) as data,
                    SUM(CASE WHEN tipo = 'receber' THEN valor ELSE 0 END) as entradas,
                    SUM(CASE WHEN tipo = 'pagar' THEN valor ELSE 0 END) as saidas
                FROM (
                    SELECT vencimento, valor, 'receber' as tipo
                    FROM contas_receber
                    WHERE vencimento BETWEEN ? AND ? AND status != 'cancelado'
                    UNION ALL
                    SELECT vencimento, valor, 'pagar' as tipo
                    FROM contas_pagar
                    WHERE vencimento BETWEEN ? AND ? AND status != 'cancelado'
                ) as todas_contas
                GROUP BY DATE(vencimento)
                ORDER BY data ASC
            `, [inicio, fim, inicio, fim]);
    
            // Calcular saldo acumulado
            let saldoAcumulado = 0;
            const fluxoComSaldo = fluxo.map(item => {
                saldoAcumulado += (item.entradas - item.saidas);
                return {
                    ...item,
                    saldo: saldoAcumulado
                };
            });
    
            res.json(fluxoComSaldo);
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar fluxo de caixa:', err);
            res.status(500).json({ message: 'Erro ao buscar fluxo de caixa' });
        }
    });
    
    // Gráfico de receitas vs despesas (Dashboard)
    router.get('/financeiro/dashboard/grafico-receitas-despesas', authenticateToken, cacheMiddleware('fin_grafico', CACHE_CONFIG.dashboardFinan), async (req, res) => {
        try {
            const { periodo = '6' } = req.query; // últimos 6 meses por padrão
    
            const [dados] = await pool.query(`
                SELECT
                    DATE_FORMAT(data, '%Y-%m') as mes,
                    COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END), 0) as receitas,
                    COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END), 0) as despesas
                FROM (
                    SELECT data_recebimento as data, valor, 'receita' as tipo
                    FROM contas_receber
                    WHERE status IN ('recebida', 'recebido') AND data_recebimento IS NOT NULL AND data_recebimento >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
                    UNION ALL
                    SELECT data_recebimento as data, valor, 'despesa' as tipo
                    FROM contas_pagar
                    WHERE status IN ('paga', 'pago') AND data_recebimento IS NOT NULL AND data_recebimento >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
                ) as movimentacoes
                WHERE data IS NOT NULL
                GROUP BY DATE_FORMAT(data, '%Y-%m')
                ORDER BY mes ASC
            `, [periodo, periodo]);
    
            res.json({ success: true, dados: dados || [] });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar gráfico:', err);
            console.error('[FINANCEIRO] Stack:', err.stack);
            res.status(500).json({ message: 'Erro ao buscar gráfico', error: err.message });
        }
    });
    
    // Fluxo de caixa do dashboard (simplificado)
    router.get('/financeiro/dashboard/fluxo-caixa', authenticateToken, cacheMiddleware('fin_dash_fluxo', CACHE_CONFIG.dashboardFinan), async (req, res) => {
        try {
            const [fluxo] = await pool.query(`
                SELECT
                    DATE_FORMAT(data, '%Y-%m-%d') as data,
                    COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0) as entradas,
                    COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0) as saidas
                FROM (
                    SELECT data_recebimento as data, valor, 'entrada' as tipo
                    FROM contas_receber
                    WHERE status IN ('recebida', 'recebido') AND data_recebimento IS NOT NULL AND data_recebimento >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                    UNION ALL
                    SELECT data_recebimento as data, valor, 'saida' as tipo
                    FROM contas_pagar
                    WHERE status IN ('paga', 'pago') AND data_recebimento IS NOT NULL AND data_recebimento >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                ) as movimentacoes
                WHERE data IS NOT NULL
                GROUP BY DATE_FORMAT(data, '%Y-%m-%d')
                ORDER BY data ASC
            `);
    
            res.json({ success: true, fluxo: fluxo || [] });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar fluxo dashboard:', err);
            console.error('[FINANCEIRO] Stack:', err.stack);
            res.status(500).json({ message: 'Erro ao buscar fluxo de caixa', error: err.message });
        }
    });
    
    // Projeção de fluxo (30/60/90 dias)
    router.get('/financeiro/fluxo-caixa/projecao', authenticateToken, cacheMiddleware('fin_projecao', CACHE_CONFIG.relatorios), async (req, res) => {
        try {
            const hoje = new Date();
            const data30 = new Date(hoje);
            data30.setDate(data30.getDate() + 30);
            const data60 = new Date(hoje);
            data60.setDate(data60.getDate() + 60);
            const data90 = new Date(hoje);
            data90.setDate(data90.getDate() + 90);
    
            const [projecao] = await pool.query(`
                SELECT
                    SUM(CASE WHEN tipo = 'receber' AND vencimento <= ? THEN valor ELSE 0 END) as receber_30,
                    SUM(CASE WHEN tipo = 'receber' AND vencimento <= ? THEN valor ELSE 0 END) as receber_60,
                    SUM(CASE WHEN tipo = 'receber' AND vencimento <= ? THEN valor ELSE 0 END) as receber_90,
                    SUM(CASE WHEN tipo = 'pagar' AND vencimento <= ? THEN valor ELSE 0 END) as pagar_30,
                    SUM(CASE WHEN tipo = 'pagar' AND vencimento <= ? THEN valor ELSE 0 END) as pagar_60,
                    SUM(CASE WHEN tipo = 'pagar' AND vencimento <= ? THEN valor ELSE 0 END) as pagar_90
                FROM (
                    SELECT vencimento, valor, 'receber' as tipo
                    FROM contas_receber
                    WHERE status = 'pendente'
                    UNION ALL
                    SELECT vencimento, valor, 'pagar' as tipo
                    FROM contas_pagar
                    WHERE status = 'pendente'
                ) as todas_contas
            `, [
                data30.toISOString().split('T')[0],
                data60.toISOString().split('T')[0],
                data90.toISOString().split('T')[0],
                data30.toISOString().split('T')[0],
                data60.toISOString().split('T')[0],
                data90.toISOString().split('T')[0]
            ]);
    
            res.json({
                dias_30: {
                    receber: projecao[0].receber_30 || 0,
                    pagar: projecao[0].pagar_30 || 0,
                    saldo: (projecao[0].receber_30 || 0) - (projecao[0].pagar_30 || 0)
                },
                dias_60: {
                    receber: projecao[0].receber_60 || 0,
                    pagar: projecao[0].pagar_60 || 0,
                    saldo: (projecao[0].receber_60 || 0) - (projecao[0].pagar_60 || 0)
                },
                dias_90: {
                    receber: projecao[0].receber_90 || 0,
                    pagar: projecao[0].pagar_90 || 0,
                    saldo: (projecao[0].receber_90 || 0) - (projecao[0].pagar_90 || 0)
                }
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao buscar projeção:', err);
            res.status(500).json({ message: 'Erro ao buscar projeção' });
        }
    });
    
    // ============================================================
    // RELATÓRIOS
    // ============================================================
    
    // DRE (Demonstração de Resultados do Exercício)
    router.get('/financeiro/relatorios/dre', authenticateToken, async (req, res) => {
        try {
            const { mes, ano } = req.query;
            const mesAtual = mes || (new Date().getMonth() + 1);
            const anoAtual = ano || new Date().getFullYear();
    
            const dataInicio = `${anoAtual}-${String(mesAtual).padStart(2, '0')}-01`;
            const dataFim = `${anoAtual}-${String(mesAtual).padStart(2, '0')}-31`;
    
            // Receitas por categoria
            const [receitas] = await pool.query(`
                SELECT
                    c.nome as categoria,
                    SUM(cr.valor) as total
                FROM contas_receber cr
                LEFT JOIN categorias_financeiras c ON cr.categoria = c.nome
                WHERE cr.vencimento BETWEEN ? AND ? AND cr.status != 'cancelado'
                GROUP BY c.nome
                ORDER BY total DESC
            `, [dataInicio, dataFim]);
    
            // Despesas por categoria
            const [despesas] = await pool.query(`
                SELECT
                    c.nome as categoria,
                    SUM(cp.valor) as total
                FROM contas_pagar cp
                LEFT JOIN categorias_financeiras c ON cp.categoria = c.nome
                WHERE cp.vencimento BETWEEN ? AND ? AND cp.status != 'cancelado'
                GROUP BY c.nome
                ORDER BY total DESC
            `, [dataInicio, dataFim]);
    
            const totalReceitas = receitas.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
            const totalDespesas = despesas.reduce((sum, d) => sum + (parseFloat(d.total) || 0), 0);
            const resultado = totalReceitas - totalDespesas;
    
            res.json({
                periodo: { mes: mesAtual, ano: anoAtual },
                receitas: {
                    detalhes: receitas,
                    total: totalReceitas
                },
                despesas: {
                    detalhes: despesas,
                    total: totalDespesas
                },
                resultado: resultado,
                margem: totalReceitas > 0 ? ((resultado / totalReceitas) * 100).toFixed(2) : 0
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao gerar DRE:', err);
            res.status(500).json({ message: 'Erro ao gerar DRE' });
        }
    });
    
    // Aging (Análise de vencimento 30/60/90 dias)
    router.get('/financeiro/relatorios/aging', authenticateToken, async (req, res) => {
        try {
            const { tipo } = req.query; // 'pagar' ou 'receber'
    
            const tabela = tipo === 'pagar' ? 'contas_pagar' : 'contas_receber';
    
            const [aging] = await pool.query(`
                SELECT
                    CASE
                        WHEN vencimento >= CURDATE() THEN 'A Vencer'
                        WHEN DATEDIFF(CURDATE(), vencimento) BETWEEN 1 AND 30 THEN '1-30 dias'
                        WHEN DATEDIFF(CURDATE(), vencimento) BETWEEN 31 AND 60 THEN '31-60 dias'
                        WHEN DATEDIFF(CURDATE(), vencimento) BETWEEN 61 AND 90 THEN '61-90 dias'
                        ELSE 'Mais de 90 dias'
                    END as faixa,
                    COUNT(*) as quantidade,
                    SUM(valor) as total
                FROM ${tabela}
                WHERE status = 'pendente'
                GROUP BY faixa
                ORDER BY
                    CASE faixa
                        WHEN 'A Vencer' THEN 1
                        WHEN '1-30 dias' THEN 2
                        WHEN '31-60 dias' THEN 3
                        WHEN '61-90 dias' THEN 4
                        ELSE 5
                    END
            `);
    
            res.json(aging);
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao gerar Aging:', err);
            res.status(500).json({ message: 'Erro ao gerar relatório Aging' });
        }
    });
    
    // Relatório por categoria
    router.get('/financeiro/relatorios/por-categoria', authenticateToken, async (req, res) => {
        try {
            const { data_inicio, data_fim, tipo } = req.query;
    
            const inicio = data_inicio || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
            const fim = data_fim || new Date().toISOString().split('T')[0];
    
            let query = `
                SELECT
                    c.nome as categoria,
                    c.tipo,
                    c.cor,
                    c.orcamento_mensal,
                    SUM(CASE WHEN t.tipo_conta = 'receber' THEN t.valor ELSE 0 END) as total_receitas,
                    SUM(CASE WHEN t.tipo_conta = 'pagar' THEN t.valor ELSE 0 END) as total_despesas
                FROM categorias_financeiras c
                LEFT JOIN (
                    SELECT categoria, valor, 'receber' as tipo_conta
                    FROM contas_receber
                    WHERE vencimento BETWEEN ? AND ? AND status != 'cancelado'
                    UNION ALL
                    SELECT categoria, valor, 'pagar' as tipo_conta
                    FROM contas_pagar
                    WHERE vencimento BETWEEN ? AND ? AND status != 'cancelado'
                ) t ON c.nome = t.categoria
                WHERE c.ativo = TRUE
            `;
    
            if (tipo && tipo !== 'todos') {
                query += ` AND (c.tipo = '${tipo}' OR c.tipo = 'ambos')`;
            }
    
            query += ` GROUP BY c.id, c.nome, c.tipo, c.cor, c.orcamento_mensal ORDER BY c.nome`;
    
            const [relatorio] = await pool.query(query, [inicio, fim, inicio, fim]);
    
            res.json(relatorio);
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao gerar relatório por categoria:', err);
            res.status(500).json({ message: 'Erro ao gerar relatório por categoria' });
        }
    });
    
    // Fluxo de caixa projetado
    router.get('/financeiro/relatorios/fluxo-caixa-projetado', authenticateToken, async (req, res) => {
        try {
            const { meses = 3 } = req.query;
            const dataFim = new Date();
            dataFim.setMonth(dataFim.getMonth() + parseInt(meses));
    
            const [projecao] = await pool.query(`
                SELECT
                    DATE_FORMAT(vencimento, '%Y-%m') as mes,
                    SUM(CASE WHEN tipo = 'receber' THEN valor ELSE 0 END) as receitas_previstas,
                    SUM(CASE WHEN tipo = 'pagar' THEN valor ELSE 0 END) as despesas_previstas
                FROM (
                    SELECT vencimento, valor, 'receber' as tipo
                    FROM contas_receber
                    WHERE status = 'pendente' AND vencimento <= ?
                    UNION ALL
                    SELECT vencimento, valor, 'pagar' as tipo
                    FROM contas_pagar
                    WHERE status = 'pendente' AND vencimento <= ?
                ) as projecoes
                GROUP BY DATE_FORMAT(vencimento, '%Y-%m')
                ORDER BY mes ASC
            `, [dataFim.toISOString().split('T')[0], dataFim.toISOString().split('T')[0]]);
    
            // Calcular saldo projetado acumulado
            let saldoAcumulado = 0;
            const [saldoAtual] = await pool.query('SELECT COALESCE(SUM(saldo_atual), 0) as saldo FROM contas_bancarias WHERE ativo = 1');
            saldoAcumulado = saldoAtual[0].saldo || 0;
    
            const projecaoComSaldo = projecao.map(item => {
                saldoAcumulado += (item.receitas_previstas - item.despesas_previstas);
                return {
                    ...item,
                    saldo_projetado: saldoAcumulado
                };
            });
    
            res.json({ success: true, projecao: projecaoComSaldo });
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao gerar projeção:', err);
            res.status(500).json({ message: 'Erro ao gerar projeção de fluxo de caixa' });
        }
    });
    
    // Exportar dados (preparar JSON para Excel/PDF)
    router.get('/financeiro/relatorios/exportar', authenticateToken, async (req, res) => {
        try {
            const { tipo, data_inicio, data_fim, formato } = req.query;
    
            const inicio = data_inicio || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
            const fim = data_fim || new Date().toISOString().split('T')[0];
    
            let dados = [];
    
            if (tipo === 'pagar') {
                const [contas] = await pool.query(
                    'SELECT id, descricao, fornecedor_nome, valor, data_vencimento, vencimento, status, categoria, forma_pagamento, observacoes, created_at FROM contas_pagar WHERE vencimento BETWEEN ? AND ? ORDER BY vencimento ASC LIMIT 5000',
                    [inicio, fim]
                );
                dados = contas;
            } else if (tipo === 'receber') {
                const [contas] = await pool.query(
                    'SELECT id, descricao, cliente_nome, valor, data_vencimento, vencimento, status, categoria, forma_pagamento, observacoes, created_at FROM contas_receber WHERE vencimento BETWEEN ? AND ? ORDER BY vencimento ASC LIMIT 5000',
                    [inicio, fim]
                );
                dados = contas;
            } else {
                // Ambos
                const [pagar] = await pool.query(
                    'SELECT id, descricao, fornecedor_nome as contraparte, valor, data_vencimento, vencimento, status, categoria, "pagar" as tipo_conta FROM contas_pagar WHERE vencimento BETWEEN ? AND ? LIMIT 5000',
                    [inicio, fim]
                );
                const [receber] = await pool.query(
                    'SELECT id, descricao, cliente_nome as contraparte, valor, data_vencimento, vencimento, status, categoria, "receber" as tipo_conta FROM contas_receber WHERE vencimento BETWEEN ? AND ? LIMIT 5000',
                    [inicio, fim]
                );
                dados = [...pagar, ...receber].sort((a, b) => new Date(a.vencimento) - new Date(b.vencimento));
            }
    
            res.json({
                tipo: tipo || 'todos',
                periodo: { inicio, fim },
                total_registros: dados.length,
                dados: dados
            });
    
        } catch (err) {
            console.error('[FINANCEIRO] Erro ao exportar:', err);
            res.status(500).json({ message: 'Erro ao exportar dados' });
        }
    });
    
    // FIM DAS APIs - PARTE 2
    
    // === ENDPOINT DE MIGRAÇÃO - INTEGRAÇÃO COMPRAS/VENDAS → FINANCEIRO ===
    // TEMPORÁRIO - SEM AUTENTICAÇÃO (apenas para setup inicial)
    router.post('/financeiro/migrar-integracao-setup', authenticateToken, authorizeAdmin, async (req, res) => {
        const connection = await pool.getConnection();
    
        try{
            await connection.beginTransaction();
    
            const logs = [];
            logs.push('🔄 Iniciando migração de integração...\n');
    
            // 1. Adicionar colunas em contas_pagar
            logs.push('1️⃣ Adicionando colunas em contas_pagar...');
            try {
                await connection.query(`
                    ALTER TABLE contas_pagar
                    ADD COLUMN pedido_compra_id INT NULL COMMENT 'ID do pedido de compra relacionado',
                    ADD COLUMN venda_id INT NULL COMMENT 'ID da venda relacionada',
                    ADD INDEX idx_pedido_compra (pedido_compra_id),
                    ADD INDEX idx_venda (venda_id)
                `);
                logs.push('   ✅ Colunas adicionadas');
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME') {
                    logs.push('   ⚠️ Colunas já existem');
                } else {
                    throw err;
                }
            }
    
            // 2. Adicionar colunas em contas_receber
            logs.push('2️⃣ Adicionando colunas em contas_receber...');
            try {
                await connection.query(`
                    ALTER TABLE contas_receber
                    ADD COLUMN venda_id INT NULL COMMENT 'ID da venda relacionada',
                    ADD COLUMN pedido_venda_id INT NULL COMMENT 'ID do pedido de venda',
                    ADD INDEX idx_venda (venda_id),
                    ADD INDEX idx_pedido_venda (pedido_venda_id)
                `);
                logs.push('   ✅ Colunas adicionadas');
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME') {
                    logs.push('   ⚠️ Colunas já existem');
                } else {
                    throw err;
                }
            }
    
            // 3. Criar tabela de logs
            logs.push('3️⃣ Criando tabela de logs...');
            await connection.query(`
                CREATE TABLE IF NOT EXISTS logs_integracao_financeiro (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tipo_origem ENUM('compra', 'venda', 'manual') NOT NULL,
                    origem_id INT NULL,
                    tipo_destino ENUM('conta_pagar', 'conta_receber') NOT NULL,
                    destino_id INT NULL,
                    valor DECIMAL(15,2) NOT NULL,
                    usuario_id INT NULL,
                    status ENUM('sucesso', 'erro') DEFAULT 'sucesso',
                    mensagem TEXT NULL,
                    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_origem (tipo_origem, origem_id),
                    INDEX idx_destino (tipo_destino, destino_id),
                    INDEX idx_data (criado_em)
                )
            `);
            logs.push('   ✅ Tabela criada');
    
            // 4. Criar views integradas
            logs.push('4️⃣ Criando views integradas...');
            await connection.query(`DROP VIEW IF EXISTS vw_contas_pagar_integradas`);
            await connection.query(`
                CREATE VIEW vw_contas_pagar_integradas AS
                SELECT
                    cp.id as conta_id,
                    cp.descricao,
                    cp.valor,
                    cp.vencimento,
                    cp.status,
                    cp.pedido_compra_id,
                    pc.numero_pedido,
                    pc.data_pedido,
                    pc.fornecedor_id,
                    f.razao_social as fornecedor_nome
                FROM contas_pagar cp
                LEFT JOIN pedidos_compra pc ON cp.pedido_compra_id = pc.id
                LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
            `);
            logs.push('   ✅ View contas_pagar_integradas criada');
    
            // View para contas_receber será criada quando implementarmos integração com Vendas
            logs.push('   ⏭️  View contas_receber_integradas será criada na integração de Vendas');
    
            // 5. Criar triggers
            logs.push('5️⃣ Criando triggers de auditoria...');
            await connection.query(`DROP TRIGGER IF EXISTS trg_log_integracao_pagar`);
            await connection.query(`
                CREATE TRIGGER trg_log_integracao_pagar
                AFTER INSERT ON contas_pagar
                FOR EACH ROW
                BEGIN
                    IF NEW.pedido_compra_id IS NOT NULL THEN
                        INSERT INTO logs_integracao_financeiro
                        (tipo_origem, origem_id, tipo_destino, destino_id, valor, usuario_id, status)
                        VALUES ('compra', NEW.pedido_compra_id, 'conta_pagar', NEW.id, NEW.valor, NEW.criado_por, 'sucesso');
                    END IF;
                END
            `);
    
            await connection.query(`DROP TRIGGER IF EXISTS trg_log_integracao_receber`);
            await connection.query(`
                CREATE TRIGGER trg_log_integracao_receber
                AFTER INSERT ON contas_receber
                FOR EACH ROW
                BEGIN
                    IF NEW.venda_id IS NOT NULL THEN
                        INSERT INTO logs_integracao_financeiro
                        (tipo_origem, origem_id, tipo_destino, destino_id, valor, usuario_id, status)
                        VALUES ('venda', NEW.venda_id, 'conta_receber', NEW.id, NEW.valor, NEW.criado_por, 'sucesso');
                    END IF;
                END
            `);
            logs.push('   ✅ Triggers criados');
    
            await connection.commit();
            logs.push('\n✅ MIGRAÇÃO CONCLUÍDA!');
    
            res.json({
                success: true,
                message: 'Migração executada com sucesso',
                logs: logs
            });
    
        } catch (err) {
            await connection.rollback();
            console.error('[FINANCEIRO] Erro na migração:', err);
            res.status(500).json({
                success: false,
                message: 'Erro na migração: ' + err.message
            });
        } finally {
            connection.release();
        }
    });
    
    // AUDIT-FIX ARCH-002: This endpoint is a duplicate of migrar-integracao-setup above.
    // Redirecting to the -setup version to eliminate code duplication.
    router.post('/financeiro/migrar-integracao', authenticateToken, async (req, res) => {
        // Forward to the -setup endpoint which has the same logic
        req.url = '/api/financeiro/migrar-integracao-setup';
        res.redirect(307, '/api/financeiro/migrar-integracao-setup');
    });
    
    
    // ============================================================
    // ROTAS DO MÓDULO DE COMPRAS
    // ============================================================
    
    // Importar rotas de Compras
    const comprasRoutes = require('../src/routes/compras');
    router.use('/compras', comprasRoutes(pool, authenticateToken, logger));
    
    logger.info('✅ Rotas do módulo de Compras carregadas');
    
    // ============================================================
    // ROTAS DO MÓDULO DE FATURAMENTO NF-e
    // ============================================================
    
    const faturamentoRoutes = require('../modules/Faturamento/api/faturamento');
    router.use('/faturamento', faturamentoRoutes(pool, authenticateToken));
    
    // Servir arquivos estáticos do módulo Faturamento
    router.use('/modules/Faturamento', express.static(path.join(__dirname, '..', 'modules', 'Faturamento', 'public')));
    
    logger.info('✅ Rotas do módulo de Faturamento carregadas');
    
    // ============================================================
    // APIS DE INTEGRAÇÃO ENTRE MÓDULOS
    // ============================================================
    
    const integracaoRouter = express.Router();
    integracaoRouter.use(authenticateToken);
    
    // ========== API DE RESERVA DE ESTOQUE ==========
    
    /**
     * Criar reserva de estoque para pedido de venda
     * Reserva produtos sem baixar estoque físico
     */
    integracaoRouter.post('/estoque/reservar', [
        body('pedido_id').isInt({ min: 1 }),
        body('itens').isArray({ min: 1 }),
        body('itens.*.codigo_material').trim().notEmpty(),
        body('itens.*.quantidade').isFloat({ min: 0.01 }),
        body('dias_expiracao').optional().isInt({ min: 1, max: 365 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_id, itens, dias_expiracao = 7 } = req.body;
            const usuario_id = req.user.id;
    
            const reservasCriadas = [];
            const erros = [];
    
            for (const item of itens) {
                try {
                    // Verificar disponibilidade
                    const [estoque] = await connection.query(`
                        SELECT quantidade_fisica, quantidade_reservada, quantidade_disponivel
                        FROM estoque_saldos
                        WHERE codigo_material = ?
                    `, [item.codigo_material]);
    
                    if (estoque.length === 0) {
                        erros.push(`Material ${item.codigo_material} não encontrado no estoque`);
                        continue;
                    }
    
                    const disponivel = parseFloat(estoque[0].quantidade_disponivel);
                    if (disponivel < item.quantidade) {
                        erros.push(`Estoque insuficiente para ${item.codigo_material}. Disponível: ${disponivel}, Solicitado: ${item.quantidade}`);
                        continue;
                    }
    
                    // Criar reserva
                    const [reserva] = await connection.query(`
                        INSERT INTO estoque_reservas
                        (codigo_material, quantidade, tipo_origem, documento_id, documento_numero,
                         usuario_id, data_expiracao, status)
                        VALUES (?, ?, 'pedido_venda', ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 'ativa')
                    `, [
                        item.codigo_material,
                        item.quantidade,
                        pedido_id,
                        `PED-${pedido_id}`,
                        usuario_id,
                        dias_expiracao
                    ]);
    
                    reservasCriadas.push({
                        reserva_id: reserva.insertId,
                        codigo_material: item.codigo_material,
                        quantidade: item.quantidade,
                        disponivel_antes: disponivel,
                        disponivel_depois: disponivel - item.quantidade
                    });
    
                } catch (error) {
                    erros.push(`Erro ao reservar ${item.codigo_material}: ${error.message}`);
                }
            }
    
            if (erros.length > 0 && reservasCriadas.length === 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Não foi possível criar nenhuma reserva',
                    erros
                });
            }
    
            await connection.commit();
    
            res.json({
                success: true,
                message: `${reservasCriadas.length} reserva(s) criada(s)`,
                data: {
                    pedido_id,
                    reservas: reservasCriadas,
                    erros: erros.length > 0 ? erros : undefined
                }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao criar reserva:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    /**
     * Consumir reserva e baixar estoque físico
     * Usado quando pedido é aprovado e estoque deve ser baixado
     */
    integracaoRouter.post('/estoque/consumir-reserva', [
        body('pedido_id').isInt({ min: 1 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_id } = req.body;
            const usuario_id = req.user.id;
    
            // Buscar todas as reservas ativas do pedido
            const [reservas] = await connection.query(`
                SELECT id, codigo_material, quantidade, tipo_origem, documento_id, status, created_at
                FROM estoque_reservas
                WHERE tipo_origem = 'pedido_venda'
                AND documento_id = ?
                AND status = 'ativa'
            `, [pedido_id]);
    
            if (reservas.length === 0) {
                throw new Error('Nenhuma reserva ativa encontrada para este pedido');
            }
    
            const movimentacoes = [];
    
            for (const reserva of reservas) {
                // Buscar saldo atual
                const [estoque] = await connection.query(`
                    SELECT quantidade_fisica FROM estoque_saldos
                    WHERE codigo_material = ?
                `, [reserva.codigo_material]);
    
                if (estoque.length === 0) continue;
    
                const qtdAnterior = parseFloat(estoque[0].quantidade_fisica);
                const qtdAtual = qtdAnterior - reserva.quantidade;
    
                // Baixar estoque físico
                await connection.query(`
                    UPDATE estoque_saldos
                    SET quantidade_fisica = quantidade_fisica - ?,
                        ultima_saida = CURDATE()
                    WHERE codigo_material = ?
                `, [reserva.quantidade, reserva.codigo_material]);
    
                // Registrar movimentação
                await connection.query(`
                    INSERT INTO estoque_movimentacoes
                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior,
                     quantidade_atual, documento_tipo, documento_id, documento_numero, usuario_id)
                    VALUES (?, 'saida', 'venda', ?, ?, ?, 'pedido_venda', ?, ?, ?)
                `, [
                    reserva.codigo_material,
                    reserva.quantidade,
                    qtdAnterior,
                    qtdAtual,
                    pedido_id,
                    reserva.documento_numero,
                    usuario_id
                ]);
    
                // Marcar reserva como consumida
                await connection.query(`
                    UPDATE estoque_reservas
                    SET status = 'consumida',
                        data_consumo = NOW()
                    WHERE id = ?
                `, [reserva.id]);
    
                movimentacoes.push({
                    codigo_material: reserva.codigo_material,
                    quantidade: reserva.quantidade,
                    quantidade_anterior: qtdAnterior,
                    quantidade_atual: qtdAtual
                });
            }
    
            await connection.commit();
    
            res.json({
                success: true,
                message: `${movimentacoes.length} reserva(s) consumida(s) e estoque baixado`,
                data: {
                    pedido_id,
                    movimentacoes
                }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao consumir reserva:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    /**
     * Cancelar reserva de estoque
     */
    integracaoRouter.post('/estoque/cancelar-reserva', [
        body('pedido_id').isInt({ min: 1 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_id } = req.body;
    
            // Marcar reservas como canceladas (trigger vai liberar automaticamente)
            const [result] = await connection.query(`
                UPDATE estoque_reservas
                SET status = 'cancelada'
                WHERE tipo_origem = 'pedido_venda'
                AND documento_id = ?
                AND status = 'ativa'
            `, [pedido_id]);
    
            await connection.commit();
    
            res.json({
                success: true,
                message: `${result.affectedRows} reserva(s) cancelada(s)`,
                data: { pedido_id, reservas_canceladas: result.affectedRows }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao cancelar reserva:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    // ========== INTEGRAÇÃO: VENDAS → ESTOQUE → FINANCEIRO ==========
    
    /**
     * Aprovar pedido de venda e realizar todas as integrações
     * 1. Baixa estoque (se produto acabado)
     * 2. Cria conta a receber no Financeiro
     * 3. Pode criar OP no PCP (se necessário)
     */
    integracaoRouter.post('/vendas/aprovar-pedido', [
        body('pedido_id').isInt({ min: 1 }),
        body('gerar_op').optional().isBoolean(),
        body('baixar_estoque').optional().isBoolean(),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_id, gerar_op = false, baixar_estoque = true } = req.body;
            const usuario_id = req.user.id;
    
            // 1. Buscar dados do pedido
            const [pedidos] = await connection.query(`
                SELECT p.*, c.nome as cliente_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.id = ?
            `, [pedido_id]);
    
            if (pedidos.length === 0) {
                throw new Error('Pedido não encontrado');
            }
    
            const pedido = pedidos[0];
    
            // 2. Buscar itens do pedido
            const [itens] = await connection.query(`
                SELECT pi.*, pr.codigo, pr.descricao
                FROM pedido_itens pi
                LEFT JOIN produtos pr ON pi.produto_id = pr.id
                WHERE pi.pedido_id = ?
            `, [pedido_id]);
    
            // 3. Baixar estoque (se solicitado)
            if (baixar_estoque) {
                for (const item of itens) {
                    // Verificar estoque disponível
                    const [estoqueCheck] = await connection.query(`
                        SELECT quantidade_fisica, quantidade_reservada
                        FROM estoque_saldos
                        WHERE codigo_material = ?
                    `, [item.codigo]);
    
                    if (estoqueCheck.length > 0) {
                        const estoque = estoqueCheck[0];
                        const disponivel = estoque.quantidade_fisica - estoque.quantidade_reservada;
    
                        if (disponivel < item.quantidade) {
                            throw new Error(`Estoque insuficiente para ${item.descricao}. Disponível: ${disponivel}, Necessário: ${item.quantidade}`);
                        }
    
                        // Registrar movimentação de saída
                        await connection.query(`
                            INSERT INTO estoque_movimentacoes
                            (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior,
                             quantidade_atual, documento_tipo, documento_id, documento_numero,
                             usuario_id, data_movimento)
                            VALUES (?, 'saida', 'venda', ?, ?, ?, 'pedido_venda', ?, ?, ?, NOW())
                        `, [
                            item.codigo,
                            item.quantidade,
                            estoque.quantidade_fisica,
                            estoque.quantidade_fisica - item.quantidade,
                            pedido_id,
                            pedido.numero_pedido || `PED-${pedido_id}`,
                            usuario_id
                        ]);
    
                        // Atualizar saldo
                        await connection.query(`
                            UPDATE estoque_saldos
                            SET quantidade_fisica = quantidade_fisica - ?,
                                ultima_saida = CURDATE()
                            WHERE codigo_material = ?
                        `, [item.quantidade, item.codigo]);
                    }
                }
            }
    
            // 4. Criar conta a receber no Financeiro
            const valorTotal = pedido.valor_total || itens.reduce((sum, i) => sum + (i.quantidade * i.preco_unitario), 0);
    
            const [contaReceber] = await connection.query(`
                INSERT INTO contas_receber
                (cliente_id, valor, vencimento, categoria_id, forma_pagamento_id,
                 descricao, documento, venda_id, status, criado_por, data_criacao)
                VALUES (?, ?, DATE_ADD(CURDATE(), INTERVAL 30 DAY),
                        (SELECT id FROM categorias_financeiras WHERE tipo = 'receita' AND nome LIKE '%Venda%' LIMIT 1),
                        1, ?, ?, ?, 'pendente', ?, NOW())
            `, [
                pedido.cliente_id,
                valorTotal,
                `Venda ${pedido.numero_pedido || `PED-${pedido_id}`} - ${pedido.cliente_nome}`,
                pedido.numero_pedido || `PED-${pedido_id}`,
                pedido_id,
                usuario_id
            ]);
    
            // 5. Gerar OP se solicitado
            let op_id = null;
            if (gerar_op) {
                const [op] = await connection.query(`
                    INSERT INTO ordens_producao
                    (numero_op, pedido_id, descricao, quantidade, status, data_inicio_prevista, usuario_id)
                    VALUES (?, ?, ?, ?, 'planejada', DATE_ADD(CURDATE(), INTERVAL 1 DAY), ?)
                `, [
                    `OP-${Date.now()}`,
                    pedido_id,
                    `Produção para ${pedido.numero_pedido}`,
                    itens.reduce((sum, i) => sum + i.quantidade, 0),
                    usuario_id
                ]);
                op_id = op.insertId;
            }
    
            // 6. Atualizar status do pedido
            await connection.query(`
                UPDATE pedidos
                SET status = 'aprovado',
                    data_aprovacao = NOW(),
                    aprovado_por = ?,
                    ordem_producao_id = ?
                WHERE id = ?
            `, [usuario_id, op_id, pedido_id]);
    
            // 7. Log de integração
            await connection.query(`
                INSERT INTO logs_integracao_financeiro
                (tipo_origem, origem_id, tipo_destino, destino_id, valor, usuario_id, status, observacoes)
                VALUES ('venda', ?, 'conta_receber', ?, ?, ?, 'sucesso', ?)
            `, [pedido_id, contaReceber.insertId, valorTotal, usuario_id, `Pedido aprovado e integrado`]);
    
            await connection.commit();
    
            res.json({
                success: true,
                message: 'Pedido aprovado e integrado com sucesso',
                data: {
                    pedido_id,
                    conta_receber_id: contaReceber.insertId,
                    op_id,
                    estoque_baixado: baixar_estoque,
                    valor_total: valorTotal
                }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao aprovar pedido:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    // ========== INTEGRAÇÃO: COMPRAS → ESTOQUE → FINANCEIRO ==========
    
    /**
     * Receber pedido de compra e realizar integrações
     * 1. Cria conta a pagar no Financeiro
     * 2. Dá entrada no estoque
     */
    integracaoRouter.post('/compras/receber-pedido', [
        body('pedido_compra_id').isInt({ min: 1 }),
        body('numero_nf').optional().trim(),
        body('itens').isArray({ min: 1 }),
        body('itens.*.codigo_material').trim().notEmpty(),
        body('itens.*.quantidade_recebida').isFloat({ min: 0.01 }),
        body('itens.*.custo_unitario').optional().isFloat({ min: 0 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { pedido_compra_id, numero_nf, itens } = req.body;
            const usuario_id = req.user.id;
    
            // 1. Buscar dados do pedido de compra
            const [pedidos] = await connection.query(`
                SELECT pc.*, f.nome as fornecedor_nome
                FROM pedidos_compra pc
                LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
                WHERE pc.id = ?
            `, [pedido_compra_id]);
    
            if (pedidos.length === 0) {
                throw new Error('Pedido de compra não encontrado');
            }
    
            const pedido = pedidos[0];
    
            // 2. Processar cada item recebido
            let valorTotal = 0;
    
            for (const item of itens) {
                const custo = item.custo_unitario || 0;
                valorTotal += item.quantidade_recebida * custo;
    
                // Verificar se material existe em estoque_saldos
                const [saldoCheck] = await connection.query(`
                    SELECT id, quantidade_fisica, custo_medio
                    FROM estoque_saldos
                    WHERE codigo_material = ?
                `, [item.codigo_material]);
    
                if (saldoCheck.length === 0) {
                    // Criar registro de saldo
                    await connection.query(`
                        INSERT INTO estoque_saldos
                        (codigo_material, quantidade_fisica, custo_medio, ultima_entrada)
                        VALUES (?, ?, ?, CURDATE())
                    `, [item.codigo_material, item.quantidade_recebida, custo]);
                } else {
                    const saldo = saldoCheck[0];
                    const qtdNova = saldo.quantidade_fisica + item.quantidade_recebida;
                    const custoMedioNovo = ((saldo.quantidade_fisica * saldo.custo_medio) +
                                            (item.quantidade_recebida * custo)) / qtdNova;
    
                    // Atualizar saldo
                    await connection.query(`
                        UPDATE estoque_saldos
                        SET quantidade_fisica = ?,
                            custo_medio = ?,
                            ultima_entrada = CURDATE()
                        WHERE codigo_material = ?
                    `, [qtdNova, custoMedioNovo, item.codigo_material]);
                }
    
                // Registrar movimentação de entrada
                await connection.query(`
                    INSERT INTO estoque_movimentacoes
                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior,
                     quantidade_atual, documento_tipo, documento_id, documento_numero,
                     custo_unitario, usuario_id, data_movimento)
                    VALUES (?, 'entrada', 'compra', ?,
                            (SELECT quantidade_fisica FROM estoque_saldos WHERE codigo_material = ?),
                            (SELECT quantidade_fisica FROM estoque_saldos WHERE codigo_material = ?),
                            'pedido_compra', ?, ?, ?, ?, NOW())
                `, [
                    item.codigo_material,
                    item.quantidade_recebida,
                    item.codigo_material,
                    item.codigo_material,
                    pedido_compra_id,
                    numero_nf || `PC-${pedido_compra_id}`,
                    custo,
                    usuario_id
                ]);
            }
    
            // 3. Criar conta a pagar no Financeiro
            const [contaPagar] = await connection.query(`
                INSERT INTO contas_pagar
                (fornecedor_id, valor, vencimento, categoria_id, forma_pagamento_id,
                 descricao, documento, pedido_compra_id, status, criado_por, data_criacao)
                VALUES (?, ?, DATE_ADD(CURDATE(), INTERVAL 30 DAY),
                        (SELECT id FROM categorias_financeiras WHERE tipo = 'despesa' AND nome LIKE '%Compra%' LIMIT 1),
                        1, ?, ?, ?, 'pendente', ?, NOW())
            `, [
                pedido.fornecedor_id,
                valorTotal,
                `Compra ${numero_nf || `PC-${pedido_compra_id}`} - ${pedido.fornecedor_nome}`,
                numero_nf || `PC-${pedido_compra_id}`,
                pedido_compra_id,
                usuario_id
            ]);
    
            // 4. Atualizar status do pedido de compra
            await connection.query(`
                UPDATE pedidos_compra
                SET status = 'recebido', data_recebimento = NOW()
                WHERE id = ?
            `, [pedido_compra_id]);
    
            // 5. Log
            await connection.query(`
                INSERT INTO logs_integracao_financeiro
                (tipo_origem, origem_id, tipo_destino, destino_id, valor, usuario_id, status, observacoes)
                VALUES ('compra', ?, 'conta_pagar', ?, ?, ?, 'sucesso', ?)
            `, [pedido_compra_id, contaPagar.insertId, valorTotal, usuario_id, `Pedido recebido e integrado`]);
    
            await connection.commit();
    
            res.json({
                success: true,
                message: 'Pedido de compra recebido e integrado',
                data: {
                    pedido_compra_id,
                    conta_pagar_id: contaPagar.insertId,
                    valor_total: valorTotal,
                    itens_recebidos: itens.length
                }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao receber pedido de compra:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    // ========== INTEGRAÇÃO: PCP → ESTOQUE (Consumo de OP) ==========
    
    /**
     * Consumir materiais de uma Ordem de Produção
     * Baixa estoque dos materiais usados na produção
     */
    integracaoRouter.post('/pcp/consumir-materiais', [
        body('op_id').isInt({ min: 1 }),
        body('materiais').isArray({ min: 1 }),
        body('materiais.*.codigo_material').trim().notEmpty(),
        body('materiais.*.quantidade_consumida').isFloat({ min: 0.01 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { op_id, materiais } = req.body;
            const usuario_id = req.user.id;
    
            // Verificar OP
            const [ops] = await connection.query('SELECT * FROM ordens_producao WHERE id = ?', [op_id]);
            if (ops.length === 0) throw new Error('OP não encontrada');
    
            const op = ops[0];
    
            // Processar cada material
            for (const material of materiais) {
                // Verificar estoque
                const [saldo] = await connection.query(`
                    SELECT quantidade_fisica, quantidade_reservada
                    FROM estoque_saldos
                    WHERE codigo_material = ?
                `, [material.codigo_material]);
    
                if (saldo.length === 0 || saldo[0].quantidade_fisica < material.quantidade_consumida) {
                    throw new Error(`Estoque insuficiente para ${material.codigo_material}`);
                }
    
                // Registrar saída
                await connection.query(`
                    INSERT INTO estoque_movimentacoes
                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior,
                     quantidade_atual, documento_tipo, documento_id, documento_numero,
                     usuario_id, data_movimento)
                    VALUES (?, 'saida', 'producao', ?, ?, ?, 'ordem_producao', ?, ?, ?, NOW())
                `, [
                    material.codigo_material,
                    material.quantidade_consumida,
                    saldo[0].quantidade_fisica,
                    saldo[0].quantidade_fisica - material.quantidade_consumida,
                    op_id,
                    op.numero_op,
                    usuario_id
                ]);
    
                // Atualizar saldo
                await connection.query(`
                    UPDATE estoque_saldos
                    SET quantidade_fisica = quantidade_fisica - ?,
                        ultima_saida = CURDATE()
                    WHERE codigo_material = ?
                `, [material.quantidade_consumida, material.codigo_material]);
            }
    
            await connection.commit();
    
            res.json({
                success: true,
                message: 'Materiais consumidos com sucesso',
                data: { op_id, materiais_consumidos: materiais.length }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao consumir materiais:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    // ========== INTEGRAÇÃO: PCP → ESTOQUE (Produção Finalizada) ==========
    
    /**
     * Finalizar OP e dar entrada no produto acabado
     */
    integracaoRouter.post('/pcp/finalizar-op', [
        body('op_id').isInt({ min: 1 }),
        body('codigo_produto').trim().notEmpty(),
        body('quantidade_produzida').isFloat({ min: 0.01 }),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { op_id, codigo_produto, quantidade_produzida } = req.body;
            const usuario_id = req.user.id;
    
            const [ops] = await connection.query('SELECT * FROM ordens_producao WHERE id = ?', [op_id]);
            if (ops.length === 0) throw new Error('OP não encontrada');
    
            const op = ops[0];
    
            // Dar entrada no produto acabado
            await connection.query(`
                INSERT INTO estoque_movimentacoes
                (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior,
                 quantidade_atual, documento_tipo, documento_id, documento_numero,
                 usuario_id, data_movimento)
                VALUES (?, 'entrada', 'producao', ?,
                        COALESCE((SELECT quantidade_fisica FROM estoque_saldos WHERE codigo_material = ?), 0),
                        COALESCE((SELECT quantidade_fisica FROM estoque_saldos WHERE codigo_material = ?), 0) + ?,
                        'ordem_producao', ?, ?, ?, NOW())
            `, [codigo_produto, quantidade_produzida, codigo_produto, codigo_produto,
                quantidade_produzida, op_id, op.numero_op, usuario_id]);
    
            // Atualizar ou criar saldo
            const [saldoCheck] = await connection.query(`
                SELECT id FROM estoque_saldos WHERE codigo_material = ?
            `, [codigo_produto]);
    
            if (saldoCheck.length === 0) {
                await connection.query(`
                    INSERT INTO estoque_saldos (codigo_material, quantidade_fisica, ultima_entrada)
                    VALUES (?, ?, CURDATE())
                `, [codigo_produto, quantidade_produzida]);
            } else {
                await connection.query(`
                    UPDATE estoque_saldos
                    SET quantidade_fisica = quantidade_fisica + ?,
                        ultima_entrada = CURDATE()
                    WHERE codigo_material = ?
                `, [quantidade_produzida, codigo_produto]);
            }
    
            // Atualizar status da OP
            await connection.query(`
                UPDATE ordens_producao
                SET status = 'finalizada', data_finalizacao = NOW()
                WHERE id = ?
            `, [op_id]);
    
            await connection.commit();
    
            res.json({
                success: true,
                message: 'OP finalizada e produto em estoque',
                data: { op_id, codigo_produto, quantidade_produzida }
            });
    
        } catch (error) {
            await connection.rollback();
            logger.error('[INTEGRAÇÃO] Erro ao finalizar OP:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });
    
    // ========== RELATÓRIOS DE INTEGRAÇÃO ==========
    
    /**
     * Relatório de movimentações integradas
     */
    integracaoRouter.get('/relatorio/movimentacoes', async (req, res, next) => {
        try {
            const { data_inicio, data_fim, tipo } = req.query;
    
            let where = '1=1';
            const params = [];
    
            if (data_inicio) {
                where += ' AND DATE(data_movimento) >= ?';
                params.push(data_inicio);
            }
            if (data_fim) {
                where += ' AND DATE(data_movimento) <= ?';
                params.push(data_fim);
            }
            if (tipo) {
                where += ' AND tipo_movimento = ?';
                params.push(tipo);
            }
    
            const [movimentacoes] = await pool.query(`
                SELECT
                    em.*,
                    es.descricao,
                    u.nome as usuario_nome
                FROM estoque_movimentacoes em
                LEFT JOIN estoque_saldos es ON em.codigo_material = es.codigo_material
                LEFT JOIN usuarios u ON em.usuario_id = u.id
                WHERE ${where}
                ORDER BY em.data_movimento DESC
                LIMIT 100
            `, params);
    
            res.json({ success: true, data: movimentacoes });
    
        } catch (error) {
            logger.error('[INTEGRAÇÃO] Erro ao gerar relatório:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });
    
    /**
     * Dashboard de integração
     */
    integracaoRouter.get('/dashboard', async (req, res, next) => {
        try {
            // KPIs
            const [pedidosAprovados] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos WHERE status = 'aprovado' AND DATE(data_aprovacao) = CURDATE()
            `);
    
            const [comprasRecebidas] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra WHERE status = 'recebido' AND DATE(data_recebimento) = CURDATE()
            `);
    
            const [opsFinalizadas] = await pool.query(`
                SELECT COUNT(*) as total FROM ordens_producao WHERE status = 'finalizada' AND DATE(data_finalizacao) = CURDATE()
            `);
    
            const [movimentacoesHoje] = await pool.query(`
                SELECT COUNT(*) as total FROM estoque_movimentacoes WHERE DATE(data_movimento) = CURDATE()
            `);
    
            const [estoqueTotal] = await pool.query(`
                SELECT SUM(valor_estoque) as total FROM estoque_saldos
            `);
    
            const [alertasCriticos] = await pool.query(`
                SELECT COUNT(*) as total
                FROM estoque_saldos es
                JOIN pcp_parametros_compra pp ON es.codigo_material = pp.codigo_material
                WHERE es.quantidade_disponivel < pp.estoque_minimo
            `);
    
            res.json({
                success: true,
                data: {
                    pedidos_aprovados_hoje: pedidosAprovados[0].total,
                    compras_recebidas_hoje: comprasRecebidas[0].total,
                    ops_finalizadas_hoje: opsFinalizadas[0].total,
                    movimentacoes_hoje: movimentacoesHoje[0].total,
                    valor_estoque_total: estoqueTotal[0].total || 0,
                    alertas_criticos: alertasCriticos[0].total
                }
            });
    
        } catch (error) {
            logger.error('[INTEGRAÇÃO] Erro ao carregar dashboard:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });
    
    router.use('/integracao', integracaoRouter);
    
    logger.info('✅ APIs de Integração entre módulos carregadas');
    
    // ============================================================
    // APIS ADICIONAIS - FASE 1 MELHORIAS ERP
    // ============================================================
    
    // Dashboard Executivo (KPIs)
    try {
        const dashboardExecutivoRouter = require('../api/dashboard-executivo');
        router.use('/dashboard-executivo', dashboardExecutivoRouter);
        logger.info('✅ API Dashboard Executivo carregada');
    } catch (err) {
        logger.warn('⚠️ API Dashboard Executivo não carregada:', err.message);
    }
    
    // Integração Vendas → Financeiro
    try {
        const integracaoVendasFinanceiro = require('../api/integracao-vendas-financeiro');
        router.use('/integracao/vendas-financeiro', integracaoVendasFinanceiro);
        logger.info('✅ API Integração Vendas-Financeiro carregada');
    } catch (err) {
        logger.warn('⚠️ API Integração Vendas-Financeiro não carregada:', err.message);
    }
    
    // Integração Compras → Financeiro
    try {
        const integracaoComprasFinanceiro = require('../api/integracao-compras-financeiro');
        router.use('/integracao/compras-financeiro', integracaoComprasFinanceiro);
        logger.info('✅ API Integração Compras-Financeiro carregada');
    } catch (err) {
        logger.warn('⚠️ API Integração Compras-Financeiro não carregada:', err.message);
    }
    
    // Sistema de Notificações Unificado (com autenticação opcional para filtrar por áreas)
    try {
        const notificacoesRouter = require('../api/notificacoes');
        // Middleware que tenta autenticar mas não bloqueia se não houver token
        const optionalAuthMiddleware = async (req, res, next) => {
            const token = req.cookies?.authToken || req.headers['authorization']?.replace('Bearer ', '');
            if (token) {
                try {
                    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
                    req.user = decoded;
                } catch (e) {
                    // Token inválido, mas não bloqueia
                }
            }
            next();
        };
        router.use('/notificacoes', optionalAuthMiddleware, notificacoesRouter);
        logger.info('✅ API Notificações Unificadas carregada (com filtro por áreas)');
    } catch (err) {
        logger.warn('⚠️ API Notificações não carregada:', err.message);
    }
    
    // Sistema de Notificações (alias para compatibilidade com módulo Vendas)
    // Armazena notificações em arquivo JSON para compatibilidade
    const NOTIFICATIONS_FILE = path.join(__dirname, '..', 'modules', 'Vendas', 'data', 'notifications.json');
    
    function loadNotifications() {
        try {
            if (!fs.existsSync(NOTIFICATIONS_FILE)) return [];
            const raw = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
            return JSON.parse(raw);
        } catch (e) { return []; }
    }
    
    function saveNotifications(arr) {
        try {
            const dir = path.dirname(NOTIFICATIONS_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(arr, null, 2), 'utf8');
        } catch (e) { console.error('Erro ao salvar notificações:', e); }
    }
    
    // GET /api/notifications - Listar notificações (SECURITY: Added authenticateToken)
    router.get('/notifications', authenticateToken, (req, res) => {
        const notifications = loadNotifications();
        const filter = req.query.filter; // 'all', 'unread', 'important'
        let filtered = notifications;
    
        if (filter === 'unread') {
            filtered = notifications.filter(n => !n.read);
        } else if (filter === 'important') {
            filtered = notifications.filter(n => n.important);
        }
    
        res.json({
            notifications: filtered.slice(0, 50),
            unreadCount: notifications.filter(n => !n.read).length,
            total: notifications.length
        });
    });
    
    // POST /api/notifications/:id/read - Marcar como lida (SECURITY: Added authenticateToken)
    router.post('/notifications/:id/read', authenticateToken, express.json(), (req, res) => {
        const notifications = loadNotifications();
        const id = parseInt(req.params.id);
        const notification = notifications.find(n => n.id === id);
        if (notification) {
            notification.read = true;
            saveNotifications(notifications);
        }
        res.json({ success: true });
    });
    
    // POST /api/notifications/read-all - Marcar todas como lidas (SECURITY: Added authenticateToken)
    router.post('/notifications/read-all', authenticateToken, (req, res) => {
        const notifications = loadNotifications();
        notifications.forEach(n => n.read = true);
        saveNotifications(notifications);
        res.json({ success: true });
    });
    
    // DELETE /api/notifications/:id - Excluir notificação (SECURITY: Added authenticateToken)
    router.delete('/notifications/:id', authenticateToken, (req, res) => {
        let notifications = loadNotifications();
        const id = parseInt(req.params.id);
        notifications = notifications.filter(n => n.id !== id);
        saveNotifications(notifications);
        res.json({ success: true });
    });
    
    // POST /api/notifications - Criar notificação (SECURITY: Added authenticateToken)
    router.post('/notifications', authenticateToken, express.json(), (req, res) => {
        const { type, title, message, data } = req.body;
        const notifications = loadNotifications();
        const notification = {
            id: Date.now(),
            type: type || 'info',
            title: title || 'Notificação',
            message: message || '',
            read: false,
            important: false,
            createdAt: new Date().toISOString(),
            data: data || {}
        };
        notifications.unshift(notification);
        if (notifications.length > 100) notifications.length = 100;
        saveNotifications(notifications);
        res.json(notification);
    });
    
    logger.info('✅ API Notifications (compatibilidade Vendas) carregada');
    
    // Sistema de Auditoria
    try {
        const auditoriaRouter = require('../api/auditoria')({ pool, authenticateToken });
        router.use('/auditoria', authenticateToken, auditoriaRouter);
        logger.info('✅ API Auditoria carregada');
    } catch (err) {
        logger.warn('⚠️ API Auditoria não carregada:', err.message);
    }
    
    // Sistema de Permissões Unificado
    try {
        const permissoesRouter = require('../api/permissoes')({ pool, authenticateToken });
        router.use('/permissoes', permissoesRouter);
        logger.info('✅ API Permissões Unificadas carregada');
    } catch (err) {
        logger.warn('⚠️ API Permissões não carregada:', err.message);
    }
    
    // ===================== FASE 3: FUNCIONALIDADES CORE =====================
    
    // Sistema de Backup
    try {
        const backupRouter = require('../api/backup')({ pool, authenticateToken });
        router.use('/backup', backupRouter);
        logger.info('✅ API Backup carregada');
    } catch (err) {
        logger.warn('⚠️ API Backup não carregada:', err.message);
    }
    
    // Sistema de Conciliação Bancária
    try {
        const conciliacaoRouter = require('../api/conciliacao-bancaria')({ pool, authenticateToken });
        router.use('/conciliacao', conciliacaoRouter);
        logger.info('✅ API Conciliação Bancária carregada');
    } catch (err) {
        logger.warn('⚠️ API Conciliação Bancária não carregada:', err.message);
    }
    
    // Sistema de Relatórios Gerenciais
    try {
        const relatoriosRouter = require('../api/relatorios-gerenciais')({ pool, authenticateToken });
        router.use('/relatorios', relatoriosRouter);
        logger.info('✅ API Relatórios Gerenciais carregada');
    } catch (err) {
        logger.warn('⚠️ API Relatórios Gerenciais não carregada:', err.message);
    }
    
    // Sistema de Workflow de Aprovações
    try {
        const workflowRouter = require('../api/workflow-aprovacoes')({ pool, authenticateToken, io: global.io });
        router.use('/workflow', workflowRouter);
        logger.info('✅ API Workflow Aprovações carregada');
    } catch (err) {
        logger.warn('⚠️ API Workflow Aprovações não carregada:', err.message);
    }
    
    // Melhorias NF-e (Dashboard, Consultas, Reenvio)
    try {
        const nfeMelhoriasRouter = require('../api/nfe-melhorias')({ pool, authenticateToken });
        router.use('/nfe-extra', nfeMelhoriasRouter);
        logger.info('✅ API NF-e Melhorias carregada');
    } catch (err) {
        logger.warn('⚠️ API NF-e Melhorias não carregada:', err.message);
    }
    
    // eSocial Básico (sem ponto eletrônico)
    try {
        const esocialRouter = require('../api/esocial')({ pool, authenticateToken });
        router.use('/esocial', esocialRouter);
        logger.info('✅ API eSocial carregada');
    } catch (err) {
        logger.warn('⚠️ API eSocial não carregada:', err.message);
    }
    
    // ============================================================
    // API ESTOQUE - Consulta de produtos com entrada no PCP (para Vendas)
    // ============================================================
    router.get('/estoque', authenticateToken, async (req, res) => {
        try {
            const { search, categoria, status, tipo } = req.query;
    
            // Query: busca produtos com estoque > 0 OU que possuem bobinas cadastradas
            let sql = `
                SELECT DISTINCT
                    p.id,
                    p.codigo,
                    COALESCE(p.nome, p.descricao) as nome,
                    p.descricao,
                    p.sku,
                    p.gtin,
                    p.ncm,
                    p.cor,
                    p.localizacao,
                    p.variacao,
                    p.observacoes,
                    CASE
                        WHEN COALESCE(bob.total_metros, 0) > 0 THEN bob.total_metros
                        ELSE COALESCE(p.estoque_atual, p.quantidade_estoque, 0)
                    END as estoque_atual,
                    COALESCE(p.estoque_minimo, 10) as estoque_minimo,
                    COALESCE(p.estoque_maximo, 1000) as estoque_maximo,
                    COALESCE(p.preco_venda, p.preco_custo, 0) as preco,
                    p.unidade_medida,
                    p.categoria,
                    'produto' as tipo_item,
                    COALESCE(bob.total_bobinas, 0) as total_bobinas,
                    COALESCE(bob.total_metros, 0) as total_metros_bobinas
                FROM produtos p
                LEFT JOIN (
                    SELECT produto_id,
                           COUNT(*) as total_bobinas,
                           SUM(quantidade) as total_metros
                    FROM bobinas_estoque
                    WHERE status = 'disponivel'
                    GROUP BY produto_id
                ) bob ON bob.produto_id = p.id
                WHERE (p.ativo = 1 OR p.status = 'ativo' OR p.status IS NULL)
                  AND (
                      COALESCE(p.estoque_atual, p.quantidade_estoque, 0) > 0
                      OR bob.total_bobinas > 0
                      OR EXISTS (
                          SELECT 1 FROM movimentacoes_estoque me
                          WHERE me.produto_id = p.id
                            AND me.tipo = 'ENTRADA'
                      )
                      OR EXISTS (
                          SELECT 1 FROM estoque_movimentacoes em
                          WHERE (em.codigo_material COLLATE utf8mb4_general_ci = p.codigo COLLATE utf8mb4_general_ci
                             OR em.codigo_material COLLATE utf8mb4_general_ci = CAST(p.id AS CHAR) COLLATE utf8mb4_general_ci)
                            AND em.tipo_movimento = 'entrada'
                      )
                  )
            `;
    
            const params = [];
    
            if (search) {
                sql += ` AND (p.codigo LIKE ? OR COALESCE(p.nome, p.descricao) LIKE ? OR p.sku LIKE ? OR p.gtin LIKE ?)`;
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }
    
            if (categoria) {
                sql += ` AND p.categoria = ?`;
                params.push(categoria);
            }
    
            if (status === 'disponivel') {
                sql += ` AND COALESCE(p.quantidade_estoque, p.estoque_atual, 0) > 0`;
            } else if (status === 'baixo') {
                sql += ` AND COALESCE(p.quantidade_estoque, p.estoque_atual, 0) > 0 AND COALESCE(p.quantidade_estoque, p.estoque_atual, 0) <= COALESCE(p.estoque_minimo, 10)`;
            } else if (status === 'zerado') {
                sql += ` AND COALESCE(p.quantidade_estoque, p.estoque_atual, 0) <= 0`;
            }
    
            sql += ` ORDER BY COALESCE(p.nome, p.descricao) ASC LIMIT 1000`;
    
            const [produtos] = await pool.query(sql, params);
    
            console.log('[ESTOQUE] Produtos com entrada no PCP:', produtos.length);
    
            // Calcular estatísticas
            let estoqueNormal = 0, estoqueBaixo = 0, estoqueZerado = 0;
            let valorTotal = 0;
            let totalBobinasGeral = 0;
    
            produtos.forEach(p => {
                const qtd = Number(p.estoque_atual || 0);
                const min = Number(p.estoque_minimo || 10);
                const preco = Number(p.preco || 0);
    
                valorTotal += qtd * preco;
                totalBobinasGeral += Number(p.total_bobinas || 0);
    
                if (qtd <= 0) estoqueZerado++;
                else if (qtd <= min) estoqueBaixo++;
                else estoqueNormal++;
            });
    
            res.json({
                success: true,
                produtos,
                estatisticas: {
                    total: produtos.length,
                    disponiveis: estoqueNormal,
                    estoque_baixo: estoqueBaixo,
                    zerados: estoqueZerado,
                    valor_total: valorTotal,
                    total_bobinas: totalBobinasGeral
                }
            });
    
        } catch (err) {
            console.error('[ESTOQUE] Erro ao consultar estoque:', err);
            res.status(500).json({ success: false, message: 'Erro ao consultar estoque' });
        }
    });

    // ============================================================
    // API BOBINAS DO ESTOQUE
    // ============================================================

    // GET /api/estoque/:id/detalhes - Detalhes completos do produto com bobinas
    router.get('/estoque/:id/detalhes', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;

            // Buscar produto com estoque real baseado em bobinas
            const [produtos] = await pool.query(`
                SELECT
                    p.id,
                    p.codigo,
                    COALESCE(p.nome, p.descricao) as nome,
                    p.descricao,
                    p.sku,
                    p.gtin,
                    p.ncm,
                    p.variacao,
                    p.cor,
                    p.localizacao,
                    p.observacoes,
                    CASE
                        WHEN COALESCE(bob.total_metros, 0) > 0 THEN bob.total_metros
                        ELSE COALESCE(p.estoque_atual, p.quantidade_estoque, 0)
                    END as estoque_atual,
                    COALESCE(p.estoque_minimo, 10) as estoque_minimo,
                    COALESCE(p.estoque_maximo, 1000) as estoque_maximo,
                    COALESCE(p.preco_venda, p.preco_custo, 0) as preco,
                    p.unidade_medida,
                    p.categoria,
                    p.updated_at,
                    COALESCE(bob.total_bobinas, 0) as total_bobinas_db,
                    COALESCE(bob.total_metros, 0) as total_metros_db
                FROM produtos p
                LEFT JOIN (
                    SELECT produto_id,
                           COUNT(*) as total_bobinas,
                           SUM(quantidade) as total_metros
                    FROM bobinas_estoque
                    WHERE status = 'disponivel'
                    GROUP BY produto_id
                ) bob ON bob.produto_id = p.id
                WHERE p.id = ?
            `, [id]);

            if (produtos.length === 0) {
                return res.status(404).json({ success: false, message: 'Produto não encontrado' });
            }

            const produto = produtos[0];

            // Buscar bobinas deste produto
            const [bobinas] = await pool.query(`
                SELECT
                    b.id,
                    b.numero_bobina,
                    b.quantidade,
                    b.dimensao_bobina,
                    b.tipo,
                    b.veia_cor,
                    b.local_armazenamento,
                    b.observacao,
                    b.status,
                    b.data_entrada,
                    b.data_atualizacao
                FROM bobinas_estoque b
                WHERE b.produto_id = ?
                ORDER BY b.numero_bobina ASC
            `, [id]);

            // Calcular totais das bobinas
            const totalBobinas = bobinas.length;
            const totalMetros = bobinas.reduce((sum, b) => sum + parseFloat(b.quantidade || 0), 0);
            const bobinasDisponiveis = bobinas.filter(b => b.status === 'disponivel').length;
            const totalRolos = bobinas.filter(b => b.tipo === 'rolo').length;
            const totalBobinasReais = bobinas.filter(b => b.tipo === 'bobina').length;

            // Cores únicas
            const coresUnicas = [...new Set(bobinas.map(b => b.veia_cor).filter(Boolean))];
            // Locais únicos
            const locaisUnicos = [...new Set(bobinas.map(b => b.local_armazenamento).filter(Boolean))];

            res.json({
                success: true,
                produto,
                bobinas,
                resumo: {
                    total_bobinas: totalBobinas,
                    bobinas_disponiveis: bobinasDisponiveis,
                    total_metros: totalMetros,
                    total_rolos: totalRolos,
                    total_bobinas_reais: totalBobinasReais,
                    cores: coresUnicas,
                    locais: locaisUnicos
                }
            });

        } catch (err) {
            console.error('[ESTOQUE] Erro ao buscar detalhes:', err);
            res.status(500).json({ success: false, message: 'Erro ao buscar detalhes do produto' });
        }
    });

    // ============================================================
    // TEMPLATE ESTOQUE - DOWNLOAD E IMPORTAÇÃO
    // ============================================================

    // GET /api/estoque/template/download - Gerar e baixar template Excel para importação de bobinas
    router.get('/estoque/template/download', authenticateToken, async (req, res) => {
        try {
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'ALUFORCE - Sistema de Gestão';
            workbook.created = new Date();

            const ws = workbook.addWorksheet('Estoque Bobinas', {
                properties: { tabColor: { argb: '1E40AF' } }
            });

            // Cabeçalho de instrução
            ws.mergeCells('A1:H1');
            const instrCell = ws.getCell('A1');
            instrCell.value = 'ALUFORCE - Template de Importação de Estoque (Bobinas)';
            instrCell.font = { bold: true, size: 14, color: { argb: 'FFFFFF' } };
            instrCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E40AF' } };
            instrCell.alignment = { horizontal: 'center', vertical: 'middle' };
            ws.getRow(1).height = 35;

            ws.mergeCells('A2:H2');
            const instrCell2 = ws.getCell('A2');
            instrCell2.value = 'Preencha os dados abaixo e importe no módulo PCP > Estoque. Cada linha = 1 bobina. Vários bobinas podem ter o mesmo código de produto.';
            instrCell2.font = { italic: true, size: 10, color: { argb: '64748B' } };
            instrCell2.alignment = { horizontal: 'center', wrapText: true };
            ws.getRow(2).height = 28;

            // Cabeçalhos de coluna (linha 3)
            const headers = [
                { header: 'COD', key: 'cod', width: 15 },
                { header: 'Nome do Produto', key: 'nome', width: 35 },
                { header: 'QTDE (metros)', key: 'qtde', width: 15 },
                { header: 'Bobinas (dimensão)', key: 'dimensao', width: 20 },
                { header: 'Qtd Bobinas', key: 'qtd_bobinas', width: 14 },
                { header: 'VEIA/COR', key: 'veia_cor', width: 18 },
                { header: 'LOCAL', key: 'local', width: 20 },
                { header: 'Observação', key: 'observacao', width: 30 }
            ];

            const headerRow = ws.getRow(3);
            headers.forEach((h, idx) => {
                const cell = headerRow.getCell(idx + 1);
                cell.value = h.header;
                cell.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '334155' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = {
                    top: { style: 'thin', color: { argb: '94A3B8' } },
                    bottom: { style: 'thin', color: { argb: '94A3B8' } },
                    left: { style: 'thin', color: { argb: '94A3B8' } },
                    right: { style: 'thin', color: { argb: '94A3B8' } }
                };
                ws.getColumn(idx + 1).width = h.width;
            });
            headerRow.height = 25;

            // Linha de exemplo (linha 4) — cinza claro
            const exemploRow = ws.getRow(4);
            const exemploData = ['UN10', 'CABO UNIPOLAR 10mm²', '350', '1x0,50', '1', 'PRETO', 'PRATELEIRA A1', 'Bobina padrão'];
            exemploData.forEach((val, idx) => {
                const cell = exemploRow.getCell(idx + 1);
                cell.value = val;
                cell.font = { italic: true, color: { argb: '94A3B8' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
                cell.border = {
                    bottom: { style: 'thin', color: { argb: 'E2E8F0' } }
                };
            });

            // Formatar colunas numéricas
            for (let r = 5; r <= 200; r++) {
                const row = ws.getRow(r);
                row.getCell(3).numFmt = '#,##0.00';  // QTDE
                row.getCell(5).numFmt = '0';          // Qtd Bobinas

                // Borda leve para guiar o preenchimento
                for (let c = 1; c <= 8; c++) {
                    row.getCell(c).border = {
                        bottom: { style: 'hair', color: { argb: 'E2E8F0' } }
                    };
                }
            }

            // Aba de instruções
            const instrWs = workbook.addWorksheet('Instruções', {
                properties: { tabColor: { argb: '22C55E' } }
            });
            instrWs.getColumn(1).width = 60;
            const instrucoes = [
                'INSTRUÇÕES DE PREENCHIMENTO',
                '',
                '1. Preencha a aba "Estoque Bobinas" com os dados do estoque.',
                '2. Cada linha representa UMA bobina individual.',
                '3. Um mesmo produto (COD) pode ter várias bobinas (várias linhas).',
                '4. O campo COD deve ser o código exato do produto no sistema.',
                '5. QTDE = quantidade em metros (ou unidade padrão) daquela bobina.',
                '6. Bobinas (dimensão) = ex: 1x0,50 ou 0,80x1,20.',
                '7. Qtd Bobinas = sempre 1 (cada linha é uma bobina).',
                '8. VEIA/COR = cor do cabo. Ex: PRETO, CINZA, VERMELHO.',
                '9. LOCAL = local de armazenamento. Ex: PRATELEIRA A1, GALPÃO B.',
                '10. Observação = informações adicionais (opcional).',
                '',
                'IMPORTANTE:',
                '- NÃO altere os cabeçalhos da linha 3.',
                '- NÃO preencha a linha 4 (é apenas exemplo).',
                '- Comece a preencher a partir da linha 5.',
                '- Salve como .xlsx antes de importar.',
                '',
                'Gerado em: ' + new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR')
            ];
            instrucoes.forEach((txt, idx) => {
                const cell = instrWs.getCell(`A${idx + 1}`);
                cell.value = txt;
                if (idx === 0) cell.font = { bold: true, size: 14 };
                else if (txt.startsWith('IMPORTANTE')) cell.font = { bold: true, color: { argb: 'EF4444' } };
            });

            // Gerar buffer e enviar
            const buffer = await workbook.xlsx.writeBuffer();
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=Template_Estoque_Bobinas_Aluforce.xlsx');
            res.send(buffer);

        } catch (err) {
            console.error('[TEMPLATE] Erro ao gerar template:', err);
            res.status(500).json({ success: false, message: 'Erro ao gerar template' });
        }
    });

    // POST /api/estoque/template/importar - Importar template Excel preenchido
    router.post('/estoque/template/importar', authenticateToken, upload.single('arquivo'), async (req, res) => {
        let filePath = null;
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado' });
            }
            filePath = req.file.path;

            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(filePath);

            // Pegar a primeira aba (Estoque Bobinas)
            const ws = workbook.getWorksheet(1);
            if (!ws) {
                return res.status(400).json({ success: false, message: 'Planilha vazia' });
            }

            // Headers na linha 3: COD, Nome, QTDE, Bobinas, Qtd Bobinas, VEIA/COR, LOCAL, Observação
            // Dados começam na linha 5 (linha 4 é exemplo)
            const bobinasParaImportar = [];
            const produtosMap = new Map(); // codigo -> dados do produto
            const erros = [];
            let linhasProcessadas = 0;

            ws.eachRow((row, rowNumber) => {
                if (rowNumber <= 4) return; // Pular cabeçalho + instrução + headers + exemplo

                const cod = String(row.getCell(1).value || '').trim();
                const nome = String(row.getCell(2).value || '').trim();
                const qtde = parseFloat(row.getCell(3).value) || 0;
                const dimensao = String(row.getCell(4).value || '').trim();
                const qtdBobinas = parseInt(row.getCell(5).value) || 1;
                const veiaCor = String(row.getCell(6).value || '').trim();
                const local = String(row.getCell(7).value || '').trim();
                const obs = String(row.getCell(8).value || '').trim();

                if (!cod || cod === 'null' || cod === 'undefined') return; // Linha vazia
                if (qtde <= 0) {
                    erros.push(`Linha ${rowNumber}: QTDE inválida para ${cod}`);
                    return;
                }

                linhasProcessadas++;

                // Guardar dados do produto
                if (!produtosMap.has(cod)) {
                    produtosMap.set(cod, { nome, cor: veiaCor, localizacao: local });
                }

                bobinasParaImportar.push({
                    codigo: cod,
                    nome,
                    quantidade: qtde,
                    dimensao,
                    qtd_bobinas: qtdBobinas,
                    veia_cor: veiaCor,
                    local,
                    observacao: obs,
                    linha: rowNumber
                });
            });

            if (bobinasParaImportar.length === 0) {
                return res.status(400).json({ success: false, message: 'Nenhum dado válido encontrado na planilha', erros });
            }

            // Iniciar transação
            const conn = await pool.getConnection();
            await conn.beginTransaction();

            try {
                let produtosAtualizados = 0;
                let bobinasInseridas = 0;
                const produtosNaoEncontrados = [];

                // Processar cada produto único
                for (const [codigo, dados] of produtosMap) {
                    // Verificar se o produto existe
                    const [existente] = await conn.query('SELECT id FROM produtos WHERE codigo = ?', [codigo]);
                    
                    if (existente.length === 0) {
                        // Produto não existe - criar
                        const [result] = await conn.query(
                            `INSERT INTO produtos (codigo, nome, descricao, categoria, unidade_medida, estoque_atual, quantidade_estoque, cor, localizacao, ativo, status) 
                             VALUES (?, ?, ?, 'CABOS', 'M', 0, 0, ?, ?, 1, 'ativo')`,
                            [codigo, dados.nome, dados.nome, dados.cor || null, dados.localizacao || null]
                        );
                        produtosAtualizados++;
                    } else {
                        // Atualizar cor e localização se informados
                        if (dados.cor || dados.localizacao) {
                            await conn.query(
                                `UPDATE produtos SET 
                                    cor = COALESCE(?, cor),
                                    localizacao = COALESCE(?, localizacao)
                                 WHERE codigo = ?`,
                                [dados.cor || null, dados.localizacao || null, codigo]
                            );
                        }
                        produtosAtualizados++;
                    }
                }

                // Remover bobinas existentes dos produtos importados (limpa e reimporta)
                const codigosImportados = [...produtosMap.keys()];
                if (codigosImportados.length > 0) {
                    await conn.query(
                        `DELETE FROM bobinas_estoque WHERE codigo_produto IN (${codigosImportados.map(() => '?').join(',')})`,
                        codigosImportados
                    );
                }

                // Inserir todas as bobinas
                let numeroBobinaPorProduto = {};
                for (const bob of bobinasParaImportar) {
                    // Buscar produto_id
                    const [prod] = await conn.query('SELECT id FROM produtos WHERE codigo = ?', [bob.codigo]);
                    if (prod.length === 0) {
                        erros.push(`Linha ${bob.linha}: Produto ${bob.codigo} não encontrado após inserção`);
                        continue;
                    }
                    const produtoId = prod[0].id;

                    // Incrementar número da bobina para este produto
                    if (!numeroBobinaPorProduto[bob.codigo]) numeroBobinaPorProduto[bob.codigo] = 0;
                    numeroBobinaPorProduto[bob.codigo]++;

                    await conn.query(
                        `INSERT INTO bobinas_estoque 
                            (produto_id, codigo_produto, quantidade, dimensao_bobina, veia_cor, local_armazenamento, observacao, status, numero_bobina, data_entrada)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'disponivel', ?, NOW())`,
                        [
                            produtoId,
                            bob.codigo,
                            bob.quantidade,
                            bob.dimensao || null,
                            bob.veia_cor || null,
                            bob.local || null,
                            bob.observacao || null,
                            numeroBobinaPorProduto[bob.codigo]
                        ]
                    );
                    bobinasInseridas++;
                }

                await conn.commit();
                conn.release();

                // Limpar arquivo temporário
                try { fs.unlinkSync(filePath); } catch(e) {}

                console.log(`[TEMPLATE] Importação concluída: ${produtosAtualizados} produtos, ${bobinasInseridas} bobinas`);

                res.json({
                    success: true,
                    message: `Importação realizada com sucesso!`,
                    resumo: {
                        linhas_processadas: linhasProcessadas,
                        produtos_processados: produtosAtualizados,
                        bobinas_inseridas: bobinasInseridas,
                        erros: erros
                    }
                });

            } catch (dbErr) {
                await conn.rollback();
                conn.release();
                throw dbErr;
            }

        } catch (err) {
            console.error('[TEMPLATE] Erro ao importar template:', err);
            // Limpar arquivo temporário em caso de erro
            if (filePath) try { fs.unlinkSync(filePath); } catch(e) {}
            res.status(500).json({ success: false, message: 'Erro ao importar template: ' + err.message });
        }
    });

    // ============================================================
    // API RELATÓRIOS DE VENDAS
    // ============================================================
    
    // GET /api/vendas/relatorio/completo - Relatório completo de vendas
    router.get('/vendas/relatorio/completo', authenticateToken, cacheMiddleware('vendas_rel_comp', CACHE_CONFIG.relatorios), async (req, res) => {
        try {
            const { dataInicio, dataFim } = req.query;
    
            // Validar datas
            const inicio = dataInicio || new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
            const fim = dataFim || new Date().toISOString().split('T')[0];
    
            console.log(`[RELATORIO] Período: ${inicio} a ${fim}`);
    
            // Estatísticas gerais
            const [statsResult] = await pool.query(`
                SELECT
                    COUNT(*) as total_pedidos,
                    COALESCE(SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) as total_faturado,
                    COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) as total_pendente,
                    COALESCE(AVG(valor), 0) as ticket_medio,
                    COUNT(DISTINCT cliente_id) as total_clientes
                FROM pedidos
                WHERE DATE(created_at) BETWEEN ? AND ?
            `, [inicio, fim]);
    
            // Vendas por dia (para gráfico)
            const [vendasPorDia] = await pool.query(`
                SELECT
                    DATE(created_at) as data,
                    COUNT(*) as quantidade,
                    COALESCE(SUM(valor), 0) as valor
                FROM pedidos
                WHERE DATE(created_at) BETWEEN ? AND ?
                GROUP BY DATE(created_at)
                ORDER BY data ASC
            `, [inicio, fim]);
    
            // Top vendedores
            const [topVendedores] = await pool.query(`
                SELECT
                    p.vendedor_id,
                    COALESCE(u.nome, u.login, 'Não identificado') as nome,
                    COUNT(*) as quantidade,
                    COALESCE(SUM(p.valor), 0) as valor
                FROM pedidos p
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE DATE(p.created_at) BETWEEN ? AND ?
                GROUP BY p.vendedor_id, u.nome, u.login
                ORDER BY valor DESC
                LIMIT 10
            `, [inicio, fim]);
    
            // Top produtos
            const [topProdutos] = await pool.query(`
                SELECT
                    ip.produto_id,
                    COALESCE(ip.descricao, pr.nome, pr.descricao, 'Produto') as nome,
                    SUM(ip.quantidade) as quantidade,
                    COALESCE(SUM(ip.preco_total), 0) as valor
                FROM itens_pedido ip
                LEFT JOIN pedidos p ON ip.pedido_id = p.id
                LEFT JOIN produtos pr ON ip.produto_id = pr.id
                WHERE DATE(p.created_at) BETWEEN ? AND ?
                GROUP BY ip.produto_id, ip.descricao, pr.nome, pr.descricao
                ORDER BY valor DESC
                LIMIT 10
            `, [inicio, fim]);
    
            // Vendas por categoria/status
            const [vendasPorStatus] = await pool.query(`
                SELECT
                    status,
                    COUNT(*) as quantidade,
                    COALESCE(SUM(valor), 0) as valor
                FROM pedidos
                WHERE DATE(created_at) BETWEEN ? AND ?
                GROUP BY status
            `, [inicio, fim]);
    
            res.json({
                success: true,
                periodo: { inicio, fim },
                estatisticas: statsResult[0] || {},
                vendasPorDia,
                topVendedores,
                topProdutos,
                vendasPorStatus
            });
    
        } catch (err) {
            console.error('[RELATORIO] Erro ao gerar relatório:', err);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório' });
        }
    });
    
    // GET /api/vendas/relatorio/mapa-brasil - Dados para mapa do Brasil
    router.get('/vendas/relatorio/mapa-brasil', authenticateToken, cacheMiddleware('vendas_mapa', CACHE_CONFIG.relatorios), async (req, res) => {
        try {
            const { dataInicio, dataFim } = req.query;
    
            const inicio = dataInicio || new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
            const fim = dataFim || new Date().toISOString().split('T')[0];
    
            // Vendas por estado
            const [vendasPorEstado] = await pool.query(`
                SELECT
                    COALESCE(c.estado, 'SP') as uf,
                    COUNT(DISTINCT p.id) as quantidade_pedidos,
                    COALESCE(SUM(p.valor), 0) as valor_total,
                    COUNT(DISTINCT p.cliente_id) as quantidade_clientes
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE DATE(p.created_at) BETWEEN ? AND ?
                GROUP BY c.estado
                ORDER BY valor_total DESC
            `, [inicio, fim]);
    
            res.json({
                success: true,
                periodo: { inicio, fim },
                dados: vendasPorEstado
            });
    
        } catch (err) {
            console.error('[RELATORIO] Erro ao gerar mapa:', err);
            res.status(500).json({ success: false, message: 'Erro ao gerar dados do mapa' });
        }
    });
    
    // ============================================================
    // MÓDULOS ENTERPRISE - AUDITORIA 02/02/2026
    // ============================================================
    
    // Importar módulos de segurança e integração
    const encryption = require('../src/utils/encryption');
    let lgpdCrypto;
    try { lgpdCrypto = require('./lgpd-crypto'); } catch(e) { console.warn('⚠️ lgpd-crypto não encontrado, descriptografia PII desabilitada'); lgpdCrypto = { decryptPII: (v) => v }; }
    const { generateTokenPair, refreshTokens, revokeAllUserTokens, cleanupExpiredTokens } = require('../src/auth/refresh-token');
    const { criarContasReceberDePedido, criarContasPagarDePedidoCompra, verificarPendenciasCliente } = require('../src/integrations/modules-integration');
    const { createOptimisticLockMiddleware, acquireEditLock, releaseEditLock } = require('../src/utils/concurrency-control');
    const { processApproval, listPendingApprovals, canUserApprove, determineApprovalLevel } = require('../src/workflows/approval-workflow');
    
    // === ROTA DE REFRESH TOKEN ===
    router.post('/auth/refresh', async (req, res) => {
        try {
            const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    
            if (!refreshToken) {
                return res.status(401).json({ error: 'Refresh token não fornecido', code: 'NO_REFRESH_TOKEN' });
            }
    
            const result = await refreshTokens(refreshToken, pool);
    
            // Definir novo refresh token no cookie
            res.cookie('refreshToken', result.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 dias
            });
    
            res.json({
                success: true,
                accessToken: result.accessToken,
                expiresIn: result.accessExpiresIn,
                user: result.user
            });
    
        } catch (error) {
            console.error('Erro ao renovar token:', error);
            res.status(401).json({ error: error.message, code: 'REFRESH_FAILED' });
        }
    });
    
    // === LOGOUT DE TODOS DISPOSITIVOS ===
    router.post('/auth/logout-all', authenticateToken, async (req, res) => {
        try {
            const result = await revokeAllUserTokens(pool, req.user.userId);
            res.clearCookie('refreshToken');
            res.json({ success: true, message: `${result.count} sessões encerradas` });
        } catch (error) {
            console.error('Erro ao fazer logout de todos dispositivos:', error);
            res.status(500).json({ error: 'Erro ao encerrar sessões' });
        }
    });
    
    // === VERIFICAR PENDÊNCIAS DO CLIENTE ANTES DE VENDER ===
    router.get('/vendas/clientes/:id/pendencias', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const pendencias = await verificarPendenciasCliente(pool, parseInt(id));
            res.json(pendencias);
        } catch (error) {
            console.error('Erro ao verificar pendências:', error);
            res.status(500).json({ error: 'Erro ao verificar pendências financeiras' });
        }
    });
    
    // === FATURAR PEDIDO COM INTEGRAÇÃO FINANCEIRA ===
    router.post('/vendas/pedidos/:id/faturar', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
    
        try {
            await connection.beginTransaction();
    
            const { id } = req.params;
            const { nfe_chave, gerarNFe } = req.body;
            let { nfe_numero } = req.body;
    
            // Buscar pedido com dados do cliente e empresa
            const [pedidos] = await connection.query(`
                SELECT p.*, c.nome as cliente_nome, c.estado as cliente_uf,
                       e.estado as empresa_uf
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                WHERE p.id = ?
            `, [id]);
    
            if (pedidos.length === 0) {
                throw new Error('Pedido não encontrado');
            }
    
            const pedido = pedidos[0];
    
            // Verificar pendências do cliente
            const pendencias = await verificarPendenciasCliente(pool, pedido.cliente_id);
            if (!pendencias.pode_vender) {
                throw new Error(`Cliente possui débitos vencidos de R$ ${pendencias.valor_vencido.toFixed(2)}. Regularize antes de faturar.`);
            }
    
            // Gerar NF-e número via serviço compartilhado se solicitado
            let nfNumeroGerado = nfe_numero;
            let cfopResult = null;
            if ((gerarNFe || !nfe_numero) && !nfe_numero) {
                try {
                    const { getFaturamentoSharedService } = require('../services/faturamento-shared.service');
                    const faturamentoShared = getFaturamentoSharedService(pool);
                    const nfData = await faturamentoShared.gerarProximoNumeroNFe(connection);
                    nfNumeroGerado = nfData.numero;
                    // Determinar CFOP
                    cfopResult = await faturamentoShared.determinarCFOP(
                        'venda',
                        pedido.empresa_uf || 'MG',
                        pedido.cliente_uf || ''
                    );
                    console.log(`[FATURAR] NF-e gerada: ${nfNumeroGerado} | CFOP: ${cfopResult.cfop} | Pedido #${id}`);
                } catch (nfErr) {
                    console.error('[FATURAR] Erro ao gerar NF-e número:', nfErr.message);
                    // Fallback: gerar número sequencial a partir de pedidos.nf e pedidos.numero_nf
                    try {
                        const [maxRows] = await connection.query(
                            `SELECT GREATEST(
                                COALESCE((SELECT MAX(CAST(nf AS UNSIGNED)) FROM pedidos WHERE nf IS NOT NULL AND nf REGEXP '^[0-9]+$'), 0),
                                COALESCE((SELECT MAX(CAST(numero_nf AS UNSIGNED)) FROM pedidos WHERE numero_nf IS NOT NULL AND numero_nf REGEXP '^[0-9]+$'), 0)
                            ) + 1 as prox`
                        );
                        nfNumeroGerado = String(maxRows[0].prox).padStart(9, '0');
                    } catch(fallbackErr) {
                        console.error('[FATURAR] Fallback também falhou:', fallbackErr.message);
                        nfNumeroGerado = String(Date.now()).slice(-9);
                    }
                }
            }
    
            // Atualizar status do pedido — salvar NF nos campos reais (nf + numero_nf)
            await connection.query(`
                UPDATE pedidos
                SET status = 'faturado',
                    nf = ?,
                    numero_nf = ?,
                    nfe_chave = ?,
                    data_faturamento = NOW(),
                    updated_at = NOW()
                WHERE id = ?
            `, [nfNumeroGerado, nfNumeroGerado, nfe_chave || null, id]);
    
            // Criar contas a receber automaticamente
            const integracaoResult = await criarContasReceberDePedido(pool, {
                ...pedido,
                nfe_numero: nfNumeroGerado,
                valor_total: pedido.valor_total || pedido.valor
            }, req.user.userId);
    
            await connection.commit();
    
            res.json({
                success: true,
                message: 'Pedido faturado e contas a receber geradas',
                pedido_id: id,
                nf_numero: nfNumeroGerado,
                nfe_numero: nfNumeroGerado,
                nfe_gerada: true,
                cfop: cfopResult ? cfopResult.cfop : null,
                financeiro: integracaoResult
            });
    
        } catch (error) {
            await connection.rollback();
            console.error('Erro ao faturar pedido:', error);
            res.status(400).json({ error: error.message });
        } finally {
            connection.release();
        }
    });
    
    // AUDIT-FIX: REMOVED duplicate simplified F9 faturamento parcial routes.
    // These routes were missing critical business logic:
    //   - No ensureFaturamentoParcialTables() call
    //   - No pedido_faturamentos registration
    //   - No history tracking
    //   - No contas a receber generation
    //   - Hardcoded status 'recibo' instead of proper 'parcial'/faturado logic
    //   - No stock deduction on remessa
    // The CORRECT routes are in modules/Vendas/server.js (apiVendasRouter):
    //   POST /api/vendas/pedidos/:id/faturamento-parcial  (lines 3441-3555)
    //   POST /api/vendas/pedidos/:id/remessa-entrega       (lines 3557-3700)
    // Those routes have: table validation, pedido_faturamentos tracking, history logging,
    // contas a receber generation, proper stock loop on remessa, and correct status management.
    
    // === WORKFLOW DE APROVAÇÃO - COMPRAS ===
    router.get('/compras/pendentes-aprovacao', authenticateToken, async (req, res) => {
        try {
            const pedidos = await listPendingApprovals(pool, req.user);
            res.json({
                success: true,
                count: pedidos.length,
                pedidos: pedidos.map(p => ({
                    ...p,
                    nivel_necessario: determineApprovalLevel(p.valor_total),
                    pode_aprovar: canUserApprove(req.user, p.valor_total)
                }))
            });
        } catch (error) {
            console.error('Erro ao listar pendentes:', error);
            res.status(500).json({ error: 'Erro ao listar pedidos pendentes' });
        }
    });
    
    router.post('/compras/pedidos/:id/workflow-aprovar', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { observacao } = req.body;
    
            const result = await processApproval(pool, parseInt(id), req.user, 'aprovar', observacao);
            res.json(result);
    
        } catch (error) {
            console.error('Erro ao aprovar:', error);
            res.status(400).json({ error: error.message });
        }
    });
    
    router.post('/compras/pedidos/:id/workflow-rejeitar', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { observacao } = req.body;
    
            if (!observacao) {
                return res.status(400).json({ error: 'Observação é obrigatória ao rejeitar' });
            }
    
            const result = await processApproval(pool, parseInt(id), req.user, 'rejeitar', observacao);
            res.json(result);
    
        } catch (error) {
            console.error('Erro ao rejeitar:', error);
            res.status(400).json({ error: error.message });
        }
    });
    
    // === CONTROLE DE CONCORRÊNCIA - LOCKS ===
    router.post('/locks/acquire', authenticateToken, async (req, res) => {
        try {
            const { tabela, registro_id } = req.body;
            const result = await acquireEditLock(pool, tabela, registro_id, req.user.userId, req.user.nome || req.user.username);
            res.json(result);
        } catch (error) {
            res.status(409).json({ error: error.message, code: 'LOCK_FAILED' });
        }
    });
    
    router.post('/locks/release', authenticateToken, async (req, res) => {
        try {
            const { tabela, registro_id } = req.body;
            const result = await releaseEditLock(pool, tabela, registro_id, req.user.userId);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // === CRIPTOGRAFIA DE DADOS ===
    router.post('/admin/encrypt-sensitive-data', authenticateToken, async (req, res) => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas admin pode executar esta operação' });
        }
    
        try {
            // Esta rota seria usada para migrar dados existentes
            // Por segurança, apenas retorna informações, não executa automaticamente
            res.json({
                success: true,
                message: 'Use scripts de migração para criptografar dados existentes',
                tabelas_sensiveis: encryption.SENSITIVE_FIELDS
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // === LIMPEZA PERIÓDICA ===
    // Executar limpeza de tokens expirados a cada 6 horas
    setInterval(async () => {
        try {
            if (pool) {
                await cleanupExpiredTokens(pool);
            }
        } catch (error) {
            console.error('Erro na limpeza periódica:', error);
        }
    }, 6 * 60 * 60 * 1000);
    
    // ============================================================
    // FIM DAS ROTAS
    // ============================================================
    
    // Limpeza periódica de sessões expiradas (a cada 1 hora)
    // NOTA: cleanExpiredSessions espera um Map em memória, não pool de DB
    // Se usar sessões em banco, implementar limpeza específica para o store usado
    /*
    setInterval(() => {
        cleanExpiredSessions(pool).catch(err => {
            console.error('Erro ao limpar sessões:', err);
        });
    }, 60 * 60 * 1000); // 1 hora
    */
    
    
    return router;
};
