const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ LISTAR REQUISIÇÕES ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { status, departamento, urgente, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM requisicoes_compras WHERE 1=1';
        const params = [];
        
        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        
        if (departamento) {
            sql += ' AND departamento = ?';
            params.push(departamento);
        }
        
        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [requisicoes] = await db.execute(sql, params);
        
        // Buscar itens de cada requisição
        for (let r of requisicoes) {
            const [itens] = await db.execute(
                'SELECT * FROM itens_requisicao WHERE requisicao_id = ?',
                [r.id]
            );
            r.itens = itens;
        }
        
        const countSql = 'SELECT COUNT(*) as total FROM requisicoes_compras WHERE 1=1' +
            (status ? ' AND status = ?' : '') +
            (departamento ? ' AND departamento = ?' : '');
        const countParams = [];
        if (status) countParams.push(status);
        if (departamento) countParams.push(departamento);
        
        const [countResult] = await db.execute(countSql, countParams);
        const total = countResult[0].total;
        
        res.json({
            requisicoes,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Erro ao listar requisições:', error);
        res.status(500).json({ error: 'Erro ao buscar requisições', message: error.message });
    }
});

// ============ OBTER REQUISIÇÃO ============
router.get('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        const [requisicoes] = await db.execute(
            'SELECT * FROM requisicoes_compras WHERE id = ?',
            [req.params.id]
        );
        
        if (requisicoes.length === 0) {
            return res.status(404).json({ error: 'Requisição não encontrada' });
        }
        
        const requisicao = requisicoes[0];
        
        // Buscar itens
        const [itens] = await db.execute(
            'SELECT * FROM itens_requisicao WHERE requisicao_id = ?',
            [requisicao.id]
        );
        requisicao.itens = itens;
        
        res.json(requisicao);
    } catch (error) {
        console.error('Erro ao obter requisição:', error);
        res.status(500).json({ error: 'Erro ao buscar requisição', message: error.message });
    }
});

// ============ CRIAR REQUISIÇÃO ============
router.post('/', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            numero,
            solicitante,
            departamento,
            prioridade,
            data_necessidade,
            justificativa,
            observacoes,
            itens
        } = req.body;
        
        if (!solicitante || !departamento || !itens || itens.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Solicitante, departamento e itens são obrigatórios' });
        }
        
        // Gerar número da requisição se não informado
        let numeroRequisicao = numero;
        if (!numeroRequisicao) {
            const ano = new Date().getFullYear();
            const [maxRows] = await connection.execute(
                `SELECT MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)) as max_num 
                 FROM requisicoes_compras WHERE numero LIKE ?`,
                [`REQ-${ano}-%`]
            );
            const maxNum = maxRows[0]?.max_num || 0;
            numeroRequisicao = `REQ-${ano}-${String(maxNum + 1).padStart(4, '0')}`;
        }
        
        // Inserir requisição
        const [result] = await connection.execute(
            `INSERT INTO requisicoes_compras (
                numero, solicitante, departamento, data_requisicao,
                prioridade, observacoes, status
            ) VALUES (?, ?, ?, CURDATE(), ?, ?, 'pendente')`,
            [
                numeroRequisicao,
                solicitante,
                departamento,
                prioridade || 'media',
                observacoes || justificativa || null
            ]
        );
        
        const requisicao_id = result.insertId;
        
        // Inserir itens
        for (const item of itens) {
            await connection.execute(
                `INSERT INTO itens_requisicao (
                    requisicao_id, descricao, quantidade, 
                    unidade, observacao
                ) VALUES (?, ?, ?, ?, ?)`,
                [
                    requisicao_id,
                    item.descricao,
                    item.quantidade,
                    item.unidade || 'UN',
                    item.observacoes || item.observacao || null
                ]
            );
        }
        
        await connection.commit();
        
        res.status(201).json({
            success: true,
            message: 'Requisição criada com sucesso',
            id: requisicao_id,
            numero: numeroRequisicao
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao criar requisição:', error);
        res.status(500).json({ error: 'Erro ao criar requisição', message: error.message });
    } finally {
        connection.release();
    }
});

// ============ ATUALIZAR REQUISIÇÃO ============
router.put('/:id', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            data_necessidade,
            justificativa,
            urgente,
            itens
        } = req.body;
        
        // Verificar se requisição existe e está pendente
        const [requisicoes] = await connection.execute(
            'SELECT status FROM requisicoes_compras WHERE id = ?',
            [req.params.id]
        );
        
        if (requisicoes.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Requisição não encontrada' });
        }
        
        if (requisicoes[0].status !== 'pendente') {
            await connection.rollback();
            return res.status(400).json({ error: 'Apenas requisições pendentes podem ser editadas' });
        }
        
        // Atualizar requisição
        await connection.execute(
            `UPDATE requisicoes_compras SET 
                prioridade = COALESCE(?, prioridade),
                observacoes = COALESCE(?, observacoes)
            WHERE id = ?`,
            [
                req.body.prioridade || null,
                req.body.observacoes || req.body.justificativa || null,
                req.params.id
            ]
        );
        
        if (itens && itens.length > 0) {
            // Deletar itens antigos
            await connection.execute(
                'DELETE FROM itens_requisicao WHERE requisicao_id = ?',
                [req.params.id]
            );
            
            // Inserir novos itens
            for (const item of itens) {
                await connection.execute(
                    `INSERT INTO itens_requisicao (
                        requisicao_id, descricao, quantidade, 
                        unidade, observacao
                    ) VALUES (?, ?, ?, ?, ?)`,
                    [
                        req.params.id,
                        item.descricao,
                        item.quantidade,
                        item.unidade || 'UN',
                        item.observacoes || item.observacao || null
                    ]
                );
            }
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Requisição atualizada com sucesso'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao atualizar requisição:', error);
        res.status(500).json({ error: 'Erro ao atualizar requisição', message: error.message });
    } finally {
        connection.release();
    }
});

// ============ APROVAR REQUISIÇÃO ============
router.put('/:id/aprovar', async (req, res) => {
    try {
        const db = getDatabase();
        const { aprovador, observacoes_aprovacao } = req.body;
        
        await db.execute(
            `UPDATE requisicoes_compras SET 
                status = 'aprovada'
            WHERE id = ?`,
            [req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Requisição aprovada com sucesso'
        });
    } catch (error) {
        console.error('Erro ao aprovar requisição:', error);
        res.status(500).json({ error: 'Erro ao aprovar requisição', message: error.message });
    }
});

// ============ REPROVAR REQUISIÇÃO ============
router.put('/:id/reprovar', async (req, res) => {
    try {
        const db = getDatabase();
        const { aprovador, motivo_reprovacao } = req.body;
        
        if (!motivo_reprovacao) {
            return res.status(400).json({ error: 'Motivo da reprovação é obrigatório' });
        }
        
        await db.execute(
            `UPDATE requisicoes_compras SET 
                status = 'rejeitada'
            WHERE id = ?`,
            [req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Requisição reprovada'
        });
    } catch (error) {
        console.error('Erro ao reprovar requisição:', error);
        res.status(500).json({ error: 'Erro ao reprovar requisição', message: error.message });
    }
});

// ============ CANCELAR REQUISIÇÃO ============
router.delete('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        
        await db.execute(
            "UPDATE requisicoes_compras SET status = 'rejeitada' WHERE id = ?",
            [req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Requisição cancelada com sucesso'
        });
    } catch (error) {
        console.error('Erro ao cancelar requisição:', error);
        res.status(500).json({ error: 'Erro ao cancelar requisição', message: error.message });
    }
});

module.exports = router;
