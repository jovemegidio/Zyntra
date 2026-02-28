const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ LISTAR PEDIDOS ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { status, fornecedor_id, data_inicio, data_fim, limit = 50, offset = 0 } = req.query;
        
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
        params.push(parseInt(limit), parseInt(offset));
        
        const [pedidos] = await db.execute(sql, params);
        
        // Buscar itens de cada pedido
        for (let pedido of pedidos) {
            const [itens] = await db.execute(
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
        
        const [countResult] = await db.execute(countSql, countParams);
        const total = countResult[0].total;
        
        res.json({
            pedidos,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Erro ao listar pedidos:', error);
        res.status(500).json({ error: 'Erro ao buscar pedidos', message: error.message });
    }
});

// ============ OBTER PEDIDO ============
router.get('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        const [pedidos] = await db.execute(
            'SELECT pc.*, f.razao_social as fornecedor_nome FROM pedidos_compra pc LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id WHERE pc.id = ?',
            [req.params.id]
        );
        
        if (pedidos.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        const pedido = pedidos[0];
        
        // Buscar itens
        const [itens] = await db.execute(
            'SELECT * FROM pedidos_compra_itens WHERE pedido_id = ?',
            [pedido.id]
        );
        pedido.itens = itens;
        
        res.json(pedido);
    } catch (error) {
        console.error('Erro ao obter pedido:', error);
        res.status(500).json({ error: 'Erro ao buscar pedido', message: error.message });
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
        
        if (!fornecedor_id || !itens || itens.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Fornecedor e itens são obrigatórios' });
        }
        
        // Calcular valor total
        const valor_total = itens.reduce((sum, item) => sum + (item.quantidade * item.preco_unitario), 0);
        
        // Inserir pedido
        const [result] = await connection.execute(
            `INSERT INTO pedidos_compra (
                fornecedor_id, data_pedido, data_entrega_prevista, 
                valor_total, status, forma_pagamento, condicoes_pagamento, observacoes
            ) VALUES (?, ?, ?, ?, 'pendente', ?, ?, ?)`,
            [
                fornecedor_id,
                data_pedido || new Date(),
                data_entrega_prevista,
                valor_total,
                forma_pagamento,
                condicoes_pagamento,
                observacoes
            ]
        );
        
        const pedido_id = result.insertId;
        
        // Inserir itens
        for (const item of itens) {
            await connection.execute(
                `INSERT INTO pedidos_compra_itens (
                    pedido_id, material_id, descricao, quantidade, 
                    preco_unitario, subtotal
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    pedido_id,
                    item.material_id,
                    item.descricao,
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
        res.status(500).json({ error: 'Erro ao criar pedido', message: error.message });
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
        const [pedidos] = await connection.execute(
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
            await connection.execute(
                'DELETE FROM pedidos_compra_itens WHERE pedido_id = ?',
                [req.params.id]
            );
            
            // Inserir novos itens
            for (const item of itens) {
                await connection.execute(
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
        await connection.execute(
            `UPDATE pedidos_compra SET 
                fornecedor_id = COALESCE(?, fornecedor_id),
                data_entrega_prevista = COALESCE(?, data_entrega_prevista),
                valor_total = COALESCE(?, valor_total),
                forma_pagamento = COALESCE(?, forma_pagamento),
                condicoes_pagamento = COALESCE(?, condicoes_pagamento),
                observacoes = COALESCE(?, observacoes)
            WHERE id = ?`,
            [
                fornecedor_id,
                data_entrega_prevista,
                valor_total || null,
                forma_pagamento,
                condicoes_pagamento,
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
        res.status(500).json({ error: 'Erro ao atualizar pedido', message: error.message });
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
        
        await db.execute(
            'UPDATE pedidos_compra SET status = ? WHERE id = ?',
            [status, req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Status atualizado com sucesso'
        });
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
        res.status(500).json({ error: 'Erro ao atualizar status', message: error.message });
    }
});

// ============ CANCELAR PEDIDO ============
router.delete('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        
        await db.execute(
            "UPDATE pedidos_compra SET status = 'cancelado' WHERE id = ?",
            [req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Pedido cancelado com sucesso'
        });
    } catch (error) {
        console.error('Erro ao cancelar pedido:', error);
        res.status(500).json({ error: 'Erro ao cancelar pedido', message: error.message });
    }
});

module.exports = router;
