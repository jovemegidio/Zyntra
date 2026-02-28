const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ LISTAR REQUISIÇÕES ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { status, departamento, urgente, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM requisicoes WHERE 1=1';
        const params = [];
        
        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        
        if (departamento) {
            sql += ' AND departamento = ?';
            params.push(departamento);
        }
        
        if (urgente !== undefined) {
            sql += ' AND urgente = ?';
            params.push(urgente === 'true' ? 1 : 0);
        }
        
        sql += ' ORDER BY urgente DESC, data_solicitacao DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [requisicoes] = await db.execute(sql, params);
        
        // Buscar itens de cada requisição
        for (let req of requisicoes) {
            const [itens] = await db.execute(
                'SELECT * FROM requisicoes_itens WHERE requisicao_id = ?',
                [req.id]
            );
            req.itens = itens;
        }
        
        const countSql = 'SELECT COUNT(*) as total FROM requisicoes WHERE 1=1' +
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
            'SELECT * FROM requisicoes WHERE id = ?',
            [req.params.id]
        );
        
        if (requisicoes.length === 0) {
            return res.status(404).json({ error: 'Requisição não encontrada' });
        }
        
        const requisicao = requisicoes[0];
        
        // Buscar itens
        const [itens] = await db.execute(
            'SELECT * FROM requisicoes_itens WHERE requisicao_id = ?',
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
            solicitante,
            departamento,
            data_necessidade,
            justificativa,
            urgente = false,
            itens
        } = req.body;
        
        if (!solicitante || !departamento || !itens || itens.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Solicitante, departamento e itens são obrigatórios' });
        }
        
        // Inserir requisição
        const [result] = await connection.execute(
            `INSERT INTO requisicoes (
                solicitante, departamento, data_solicitacao, data_necessidade,
                justificativa, urgente, status
            ) VALUES (?, ?, NOW(), ?, ?, ?, 'pendente')`,
            [
                solicitante,
                departamento,
                data_necessidade,
                justificativa,
                urgente ? 1 : 0
            ]
        );
        
        const requisicao_id = result.insertId;
        
        // Inserir itens
        for (const item of itens) {
            await connection.execute(
                `INSERT INTO requisicoes_itens (
                    requisicao_id, material_id, descricao, quantidade, 
                    unidade, observacoes
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    requisicao_id,
                    item.material_id || null,
                    item.descricao,
                    item.quantidade,
                    item.unidade || 'UN',
                    item.observacoes
                ]
            );
        }
        
        await connection.commit();
        
        res.status(201).json({
            success: true,
            message: 'Requisição criada com sucesso',
            requisicao_id
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
            'SELECT status FROM requisicoes WHERE id = ?',
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
            `UPDATE requisicoes SET 
                data_necessidade = COALESCE(?, data_necessidade),
                justificativa = COALESCE(?, justificativa),
                urgente = COALESCE(?, urgente)
            WHERE id = ?`,
            [
                data_necessidade,
                justificativa,
                urgente !== undefined ? (urgente ? 1 : 0) : null,
                req.params.id
            ]
        );
        
        if (itens && itens.length > 0) {
            // Deletar itens antigos
            await connection.execute(
                'DELETE FROM requisicoes_itens WHERE requisicao_id = ?',
                [req.params.id]
            );
            
            // Inserir novos itens
            for (const item of itens) {
                await connection.execute(
                    `INSERT INTO requisicoes_itens (
                        requisicao_id, material_id, descricao, quantidade, 
                        unidade, observacoes
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        req.params.id,
                        item.material_id || null,
                        item.descricao,
                        item.quantidade,
                        item.unidade || 'UN',
                        item.observacoes
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
            `UPDATE requisicoes SET 
                status = 'aprovada',
                aprovador = ?,
                data_aprovacao = NOW(),
                observacoes_aprovacao = ?
            WHERE id = ?`,
            [aprovador, observacoes_aprovacao, req.params.id]
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
            `UPDATE requisicoes SET 
                status = 'reprovada',
                aprovador = ?,
                data_aprovacao = NOW(),
                observacoes_aprovacao = ?
            WHERE id = ?`,
            [aprovador, motivo_reprovacao, req.params.id]
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
            "UPDATE requisicoes SET status = 'cancelada' WHERE id = ?",
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
