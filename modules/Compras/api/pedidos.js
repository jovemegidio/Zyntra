const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// BUG-006: Sanitizador HTML simples para prevenir XSS armazenado
function sanitizeHtml(str) {
    if (str == null) return null;
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\//g, '&#x2F;');
}

// ============ LISTAR PEDIDOS ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { status, fornecedor_id, data_inicio, data_fim, limit = 50, offset = 0 } = req.query;
        
        // SECURITY: Hard cap no limit para prevenir memory exhaustion (BATCH-002)
        const safeLimitVal = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
        const safeOffset = Math.max(parseInt(offset) || 0, 0);
        
        let sql = 'SELECT pc.*, f.razao_social as fornecedor_nome FROM pedidos_compra pc LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id WHERE 1=1';
        const params = [];
        
        if (status) {
            sql += ' AND pc.status = ?';
            params.push(status);
        }
        
        if (fornecedor_id) {
            sql += ' AND pc.fornecedor_id = ?';
            params.push(fornecedor_id);
        }
        
        if (data_inicio) {
            sql += ' AND pc.data_pedido >= ?';
            params.push(data_inicio);
        }
        
        if (data_fim) {
            sql += ' AND pc.data_pedido <= ?';
            params.push(data_fim);
        }
        
        sql += ' ORDER BY pc.data_pedido DESC LIMIT ? OFFSET ?';
        params.push(safeLimitVal, safeOffset);
        
        const [pedidos] = await db.query(sql, params);
        
        // Buscar itens de cada pedido
        for (let pedido of pedidos) {
            const [itens] = await db.query(
                'SELECT * FROM pedidos_compra_itens WHERE pedido_id = ?',
                [pedido.id]
            );
            pedido.itens = itens;
        }
        
        const countSql = 'SELECT COUNT(*) as total FROM pedidos_compra WHERE 1=1' +
            (status ? ' AND status = ?' : '') +
            (fornecedor_id ? ' AND fornecedor_id = ?' : '');
        const countParams = [];
        if (status) countParams.push(status);
        if (fornecedor_id) countParams.push(fornecedor_id);
        
        const [countResult] = await db.query(countSql, countParams);
        const total = countResult[0].total;
        
        res.json({
            pedidos,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Erro ao listar pedidos:', error);
        res.status(500).json({ error: 'Erro ao buscar pedidos' });
    }
});

// ============ OBTER PEDIDO ============
router.get('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        const [pedidos] = await db.query(
            'SELECT pc.*, f.razao_social as fornecedor_nome FROM pedidos_compra pc LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id WHERE pc.id = ?',
            [req.params.id]
        );
        
        if (pedidos.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        const pedido = pedidos[0];
        
        // Buscar itens
        const [itens] = await db.query(
            'SELECT * FROM pedidos_compra_itens WHERE pedido_id = ?',
            [pedido.id]
        );
        pedido.itens = itens;
        
        res.json(pedido);
    } catch (error) {
        console.error('Erro ao obter pedido:', error);
        res.status(500).json({ error: 'Erro ao buscar pedido' });
    }
});

// ============ CRIAR PEDIDO ============
router.post('/', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            fornecedor_id,
            data_pedido,
            data_entrega_prevista,
            forma_pagamento,
            condicoes_pagamento,
            observacoes,
            itens
        } = req.body;

        // BUG-013: Extrair ID do usuário autenticado para trilha de auditoria
        const usuario_id = req.user?.id || req.user?.user_id || req.user?.userId || null;

        if (!fornecedor_id || !itens || itens.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Fornecedor e itens são obrigatórios' });
        }

        // BUG-009: data de entrega prevista é obrigatória (rastreamento de SLA e alertas de atraso)
        if (!data_entrega_prevista) {
            await connection.rollback();
            return res.status(400).json({ error: 'Data de entrega prevista é obrigatória.' });
        }

        // Validar fornecedor existe
        const [fornecedorExists] = await connection.query(
            'SELECT id FROM fornecedores WHERE id = ?', [fornecedor_id]
        );
        if (fornecedorExists.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Fornecedor não encontrado' });
        }
        
        // Validar itens: quantidade e preço devem ser positivos
        for (const item of itens) {
            if (!Number.isFinite(item.quantidade) || item.quantidade <= 0) {
                await connection.rollback();
                return res.status(400).json({ error: `Quantidade inválida: ${item.quantidade}. Deve ser > 0` });
            }
            if (!Number.isFinite(item.preco_unitario) || item.preco_unitario <= 0) {
                await connection.rollback();
                return res.status(400).json({ error: `Preço unitário inválido: ${item.preco_unitario}. Deve ser > 0` });
            }
        }
        
        // Calcular valor total
        const valor_total = itens.reduce((sum, item) => sum + (item.quantidade * item.preco_unitario), 0);

        // DB-002: Bloquear pedido com valor total zero (previne dados inválidos no banco)
        if (!Number.isFinite(valor_total) || valor_total <= 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Valor total do pedido deve ser maior que zero.' });
        }

        // Gerar número do pedido
        const numero_pedido = 'PC-' + Date.now().toString().slice(-6);
        
        // Inserir pedido — BUG-006: sanitizar observacoes; BUG-013: gravar usuario_solicitante_id
        const [result] = await connection.query(
            `INSERT INTO pedidos_compra (
                numero_pedido, fornecedor_id, data_pedido, data_entrega_prevista,
                valor_total, valor_final, status, observacoes, usuario_solicitante_id
            ) VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?)`,

            [
                numero_pedido,
                fornecedor_id,
                data_pedido || new Date(),
                data_entrega_prevista,
                valor_total,
                valor_total,
                sanitizeHtml(observacoes),
                usuario_id
            ]
        );
        
        const pedido_id = result.insertId;
        
        // Inserir itens — BUG-006: sanitizar descricao dos itens
        for (const item of itens) {
            await connection.query(
                `INSERT INTO pedidos_compra_itens (
                    pedido_id, material_id, descricao, quantidade,
                    preco_unitario, subtotal
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    pedido_id,
                    item.material_id,
                    sanitizeHtml(item.descricao),
                    item.quantidade,
                    item.preco_unitario,
                    item.quantidade * item.preco_unitario
                ]
            );
        }
        
        await connection.commit();
        
        res.status(201).json({
            success: true,
            message: 'Pedido criado com sucesso',
            pedido_id
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao criar pedido:', error);
        res.status(500).json({ error: 'Erro ao criar pedido' });
    } finally {
        connection.release();
    }
});

// ============ ATUALIZAR PEDIDO ============
router.put('/:id', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            fornecedor_id,
            data_entrega_prevista,
            forma_pagamento,
            condicoes_pagamento,
            observacoes,
            itens
        } = req.body;
        
        // Verificar se pedido existe e está pendente
        const [pedidos] = await connection.query(
            'SELECT status FROM pedidos_compra WHERE id = ?',
            [req.params.id]
        );
        
        if (pedidos.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        if (pedidos[0].status !== 'pendente') {
            await connection.rollback();
            return res.status(400).json({ error: 'Apenas pedidos pendentes podem ser editados' });
        }
        
        let valor_total = 0;
        
        if (itens && itens.length > 0) {
            valor_total = itens.reduce((sum, item) => sum + (item.quantidade * item.preco_unitario), 0);
            
            // Deletar itens antigos
            await connection.query(
                'DELETE FROM pedidos_compra_itens WHERE pedido_id = ?',
                [req.params.id]
            );
            
            // Inserir novos itens
            for (const item of itens) {
                await connection.query(
                    `INSERT INTO pedidos_compra_itens (
                        pedido_id, material_id, descricao, quantidade, 
                        preco_unitario, subtotal
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        req.params.id,
                        item.material_id,
                        item.descricao,
                        item.quantidade,
                        item.preco_unitario,
                        item.quantidade * item.preco_unitario
                    ]
                );
            }
        }
        
        // Atualizar pedido
        await connection.query(
            `UPDATE pedidos_compra SET 
                fornecedor_id = COALESCE(?, fornecedor_id),
                data_entrega_prevista = COALESCE(?, data_entrega_prevista),
                valor_total = COALESCE(?, valor_total),
                valor_final = COALESCE(?, valor_final),
                observacoes = COALESCE(?, observacoes)
            WHERE id = ?`,
            [
                fornecedor_id,
                data_entrega_prevista,
                valor_total || null,
                valor_total || null,
                observacoes,
                req.params.id
            ]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Pedido atualizado com sucesso'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao atualizar pedido:', error);
        res.status(500).json({ error: 'Erro ao atualizar pedido' });
    } finally {
        connection.release();
    }
});

// ============ ATUALIZAR STATUS ============
router.put('/:id/status', async (req, res) => {
    try {
        const db = getDatabase();
        const { status } = req.body;

        const statusValidos = ['pendente', 'aprovado', 'enviado', 'recebido', 'cancelado'];
        if (!statusValidos.includes(status)) {
            return res.status(400).json({ error: 'Status inválido' });
        }

        // Transições válidas: evita reapproval ou transições inválidas
        const transicoesPermitidas = {
            'pendente': ['aprovado', 'cancelado'],
            'aprovado': ['enviado', 'cancelado'],
            'enviado': ['recebido', 'cancelado'],
            'recebido': [],
            'cancelado': []
        };

        // Guard clause atômica: só atualiza se o status atual permitir a transição
        const statusOrigensValidas = Object.entries(transicoesPermitidas)
            .filter(([_, destinos]) => destinos.includes(status))
            .map(([origem]) => origem);

        if (statusOrigensValidas.length === 0) {
            return res.status(400).json({ error: `Status '${status}' não pode ser definido como destino` });
        }

        const placeholders = statusOrigensValidas.map(() => '?').join(', ');
        const [result] = await db.query(
            `UPDATE pedidos_compra SET status = ?, updated_at = NOW() WHERE id = ? AND status IN (${placeholders})`,
            [status, req.params.id, ...statusOrigensValidas]
        );

        if (result.affectedRows === 0) {
            return res.status(409).json({
                error: 'Conflito de status',
                message: 'Pedido já foi alterado por outro usuário ou transição inválida'
            });
        }

        res.json({
            success: true,
            message: 'Status atualizado com sucesso'
        });
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
        res.status(500).json({ error: 'Erro ao atualizar status' });
    }
});

// ============ CANCELAR PEDIDO ============
router.delete('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        
        // SECURITY FIX (PED-AUTHZ-001): Verificar status antes de cancelar — impedir cancelamento de pedidos já recebidos
        const [result] = await db.query(
            "UPDATE pedidos_compra SET status = 'cancelado', updated_at = NOW() WHERE id = ? AND status NOT IN ('recebido', 'cancelado')",
            [req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'Pedido não pode ser cancelado (já recebido, já cancelado, ou não encontrado)' });
        }
        
        res.json({
            success: true,
            message: 'Pedido cancelado com sucesso'
        });
    } catch (error) {
        console.error('Erro ao cancelar pedido:', error);
        res.status(500).json({ error: 'Erro ao cancelar pedido' });
    }
});

// Rota POST para cancelar (usada pelo frontend)
router.post('/:id/cancelar', async (req, res) => {
    try {
        const db = getDatabase();
        
        // SECURITY FIX (PED-AUTHZ-001): Verificar status antes de cancelar
        const [result] = await db.query(
            "UPDATE pedidos_compra SET status = 'cancelado', updated_at = NOW() WHERE id = ? AND status NOT IN ('recebido', 'cancelado')",
            [req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'Pedido não pode ser cancelado (já recebido, já cancelado, ou não encontrado)' });
        }
        
        res.json({
            success: true,
            message: 'Pedido cancelado com sucesso'
        });
    } catch (error) {
        console.error('Erro ao cancelar pedido:', error);
        res.status(500).json({ error: 'Erro ao cancelar pedido' });
    }
});

module.exports = router;
