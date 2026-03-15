const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ LISTAR COTAÇÕES ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { status, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM cotacoes WHERE 1=1';
        const params = [];
        
        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        
        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [cotacoes] = await db.query(sql, params);
        
        // Buscar propostas de cada cotação
        for (let cotacao of cotacoes) {
            cotacao.itens = [];
            try {
                const [propostas] = await db.query(
                    `SELECT cp.*, f.razao_social as fornecedor_nome 
                     FROM propostas_cotacao cp 
                     LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id 
                     WHERE cp.cotacao_id = ?`,
                    [cotacao.id]
                );
                cotacao.propostas = propostas;
            } catch(e) {
                cotacao.propostas = [];
            }
        }
        
        const countSql = 'SELECT COUNT(*) as total FROM cotacoes WHERE 1=1' +
            (status ? ' AND status = ?' : '');
        const countParams = status ? [status] : [];
        
        const [countResult] = await db.query(countSql, countParams);
        const total = countResult[0].total;
        
        res.json({
            cotacoes,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Erro ao listar cotações:', error);
        res.status(500).json({ error: 'Erro ao buscar cotações', message: error.message });
    }
});

// ============ OBTER COTAÇÃO ============
router.get('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        const [cotacoes] = await db.execute(
            'SELECT * FROM cotacoes WHERE id = ?',
            [req.params.id]
        );
        
        if (cotacoes.length === 0) {
            return res.status(404).json({ error: 'Cotação não encontrada' });
        }
        
        const cotacao = cotacoes[0];
        
        cotacao.itens = [];
        
        // Buscar propostas
        try {
            const [propostas] = await db.execute(
                `SELECT cp.*, f.razao_social as fornecedor_nome 
                 FROM propostas_cotacao cp 
                 LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id 
                 WHERE cp.cotacao_id = ?`,
                [cotacao.id]
            );
            cotacao.propostas = propostas;
        } catch(e) {
            cotacao.propostas = [];
        }
        
        res.json(cotacao);
    } catch (error) {
        console.error('Erro ao obter cotação:', error);
        res.status(500).json({ error: 'Erro ao buscar cotação', message: error.message });
    }
});

// ============ CRIAR COTAÇÃO ============
router.post('/', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            titulo,
            descricao,
            data_limite,
            fornecedores_ids = [],
            itens
        } = req.body;
        
        if (!titulo || !itens || itens.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Título e itens são obrigatórios' });
        }
        
        // Inserir cotação
        const [result] = await connection.execute(
            `INSERT INTO cotacoes (
                numero_cotacao, descricao, data_solicitacao, data_limite, status
            ) VALUES (?, ?, CURDATE(), ?, 'aberta')`,
            [titulo, descricao, data_limite]
        );
        
        const cotacao_id = result.insertId;
        
        // Criar propostas vazias para fornecedores selecionados
        if (fornecedores_ids.length > 0) {
            for (const fornecedor_id of fornecedores_ids) {
                await connection.execute(
                    `INSERT INTO propostas_cotacao (
                        cotacao_id, fornecedor_id, valor_total
                    ) VALUES (?, ?, 0)`,
                    [cotacao_id, fornecedor_id]
                );
            }
        }
        
        await connection.commit();
        
        res.status(201).json({
            success: true,
            message: 'Cotação criada com sucesso',
            cotacao_id
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao criar cotação:', error);
        res.status(500).json({ error: 'Erro ao criar cotação', message: error.message });
    } finally {
        connection.release();
    }
});

// ============ ADICIONAR PROPOSTA ============
router.post('/:id/proposta', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            fornecedor_id,
            valor_total,
            prazo_entrega,
            forma_pagamento,
            observacoes,
            itens_precos = []
        } = req.body;
        
        if (!fornecedor_id) {
            await connection.rollback();
            return res.status(400).json({ error: 'Fornecedor é obrigatório' });
        }
        
        // Verificar se cotação está aberta
        const [cotacoes] = await connection.execute(
            'SELECT status FROM cotacoes WHERE id = ?',
            [req.params.id]
        );
        
        if (cotacoes.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Cotação não encontrada' });
        }
        
        if (cotacoes[0].status !== 'aberta') {
            await connection.rollback();
            return res.status(400).json({ error: 'Cotação não está aberta' });
        }
        
        // Verificar se já existe proposta deste fornecedor
        const [propostasExistentes] = await connection.execute(
            'SELECT id FROM propostas_cotacao WHERE cotacao_id = ? AND fornecedor_id = ?',
            [req.params.id, fornecedor_id]
        );
        
        if (propostasExistentes.length > 0) {
            // Atualizar proposta existente
            await connection.execute(
                `UPDATE propostas_cotacao SET 
                    valor_total = ?,
                    prazo_entrega = ?,
                    condicao_pagamento = ?,
                    observacoes = ?,
                    selecionada = 0,
                    data_proposta = NOW()
                WHERE id = ?`,
                [
                    valor_total,
                    prazo_entrega,
                    forma_pagamento,
                    observacoes,
                    propostasExistentes[0].id
                ]
            );
        } else {
            // Inserir nova proposta
            await connection.execute(
                `INSERT INTO propostas_cotacao (
                    cotacao_id, fornecedor_id, valor_total, prazo_entrega,
                    condicao_pagamento, observacoes
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    req.params.id,
                    fornecedor_id,
                    valor_total,
                    prazo_entrega,
                    forma_pagamento,
                    observacoes
                ]
            );
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Proposta adicionada com sucesso'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao adicionar proposta:', error);
        res.status(500).json({ error: 'Erro ao adicionar proposta', message: error.message });
    } finally {
        connection.release();
    }
});

// ============ SELECIONAR VENCEDOR ============
router.put('/:id/selecionar-vencedor', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { proposta_id, justificativa } = req.body;
        
        if (!proposta_id) {
            await connection.rollback();
            return res.status(400).json({ error: 'ID da proposta é obrigatório' });
        }
        
        // Marcar proposta como vencedora
        await connection.execute(
            `UPDATE propostas_cotacao SET 
                selecionada = 1
            WHERE id = ?`,
            [proposta_id]
        );
        
        // Marcar outras propostas como não selecionadas
        await connection.execute(
            `UPDATE propostas_cotacao SET 
                selecionada = 0
            WHERE cotacao_id = ? AND id != ?`,
            [req.params.id, proposta_id]
        );
        
        // Encerrar cotação
        await connection.execute(
            `UPDATE cotacoes SET 
                status = 'encerrada',
                data_encerramento = NOW()
            WHERE id = ?`,
            [req.params.id]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Vencedor selecionado e cotação encerrada'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao selecionar vencedor:', error);
        res.status(500).json({ error: 'Erro ao selecionar vencedor', message: error.message });
    } finally {
        connection.release();
    }
});

// ============ ENCERRAR COTAÇÃO ============
router.put('/:id/encerrar', async (req, res) => {
    try {
        const db = getDatabase();
        const { motivo } = req.body;
        
        await db.execute(
            `UPDATE cotacoes SET 
                status = 'encerrada',
                data_encerramento = NOW(),
                motivo_encerramento = ?
            WHERE id = ?`,
            [motivo, req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Cotação encerrada'
        });
    } catch (error) {
        console.error('Erro ao encerrar cotação:', error);
        res.status(500).json({ error: 'Erro ao encerrar cotação', message: error.message });
    }
});

// ============ CANCELAR COTAÇÃO ============
router.delete('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        
        await db.execute(
            "UPDATE cotacoes SET status = 'cancelada' WHERE id = ?",
            [req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Cotação cancelada com sucesso'
        });
    } catch (error) {
        console.error('Erro ao cancelar cotação:', error);
        res.status(500).json({ error: 'Erro ao cancelar cotação', message: error.message });
    }
});

module.exports = router;
