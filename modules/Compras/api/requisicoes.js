const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ LISTAR REQUISIÇÕES ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { status, departamento, urgente, limit = req.query.limite || 50, offset = 0 } = req.query;
        
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
        
        const [requisicoes] = await db.query(sql, params);
        
        // Buscar itens de cada requisição
        for (let r of requisicoes) {
            try {
                const [itens] = await db.query(
                    'SELECT * FROM itens_requisicao WHERE requisicao_id = ?',
                    [r.id]
                );
                r.itens = itens;
            } catch(e) {
                r.itens = [];
            }
        }
        
        const countSql = 'SELECT COUNT(*) as total FROM requisicoes_compras WHERE 1=1' +
            (status ? ' AND status = ?' : '') +
            (departamento ? ' AND departamento = ?' : '');
        const countParams = [];
        if (status) countParams.push(status);
        if (departamento) countParams.push(departamento);
        
        const [countResult] = await db.query(countSql, countParams);
        const total = countResult[0].total;
        
        res.json({
            requisicoes,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Erro ao listar requisições:', error);
        res.status(500).json({ error: 'Erro ao buscar requisições' });
    }
});

// ============ PRÓXIMO NÚMERO ============
router.get('/proximo-numero', async (req, res) => {
    try {
        const db = getDatabase();
        const [rows] = await db.query(
            'SELECT numero FROM requisicoes_compras ORDER BY id DESC LIMIT 1'
        );
        let proximo = 'RC-001';
        if (rows.length > 0 && rows[0].numero) {
            const match = rows[0].numero.match(/(\d+)$/);
            if (match) {
                proximo = 'RC-' + String(parseInt(match[1]) + 1).padStart(3, '0');
            }
        }
        res.json({ numero: proximo, proximo_numero: proximo });
    } catch (error) {
        console.error('Erro ao gerar próximo número requisição:', error);
        res.json({ numero: 'RC-' + String(Date.now()).slice(-4), proximo_numero: 'RC-' + String(Date.now()).slice(-4) });
    }
});

// ============ OBTER REQUISIÇÃO ============
router.get('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        const [requisicoes] = await db.query(
            'SELECT * FROM requisicoes_compras WHERE id = ?',
            [req.params.id]
        );
        
        if (requisicoes.length === 0) {
            return res.status(404).json({ error: 'Requisição não encontrada' });
        }
        
        const requisicao = requisicoes[0];
        
        // Buscar itens
        const [itens] = await db.query(
            'SELECT * FROM itens_requisicao WHERE requisicao_id = ?',
            [requisicao.id]
        );
        requisicao.itens = itens;
        
        res.json(requisicao);
    } catch (error) {
        console.error('Erro ao obter requisição:', error);
        res.status(500).json({ error: 'Erro ao buscar requisição' });
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
            centro_custo,
            prioridade,
            data_necessidade,
            justificativa,
            observacoes,
            itens,
            status: statusReq
        } = req.body;
        
        const dept = departamento || centro_custo || null;

        // Mapear valores do frontend para valores aceitos pelo ENUM do banco
        const prioridadeMap = { 'normal': 'media', 'baixa': 'baixa', 'media': 'media', 'alta': 'alta', 'urgente': 'urgente' };
        const statusMap = { 'rascunho': 'pendente', 'pendente': 'pendente', 'aprovada': 'aprovada', 'aprovado': 'aprovada', 'em_cotacao': 'em_cotacao', 'cotacao': 'em_cotacao', 'rejeitada': 'rejeitada', 'rejeitado': 'rejeitada', 'concluida': 'concluida' };
        const prioridadeDB = prioridadeMap[prioridade] || 'media';
        const statusDB = statusMap[statusReq] || 'pendente';

        if (!solicitante || !itens || itens.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Solicitante e itens são obrigatórios' });
        }
        const itemInvalido = itens.find(i => !i.descricao || String(i.descricao).trim() === '');
        if (itemInvalido) {
            await connection.rollback();
            return res.status(400).json({ error: 'Todos os itens devem ter descrição' });
        }
        const itemSemQtd = itens.find(i => !i.quantidade || parseFloat(i.quantidade) <= 0);
        if (itemSemQtd) {
            await connection.rollback();
            return res.status(400).json({ error: 'Todos os itens devem ter quantidade maior que zero' });
        }
        // Preço estimado obrigatório e > 0 (base para nota de venda / cotação)
        const itemSemPreco = itens.find(i => {
            const p = parseFloat(i.valor_estimado != null ? i.valor_estimado : i.preco_unitario);
            return !(p > 0);
        });
        if (itemSemPreco) {
            await connection.rollback();
            return res.status(400).json({ error: 'Todos os itens devem ter preço estimado maior que zero' });
        }
        
        // Gerar número da requisição se não informado
        let numeroRequisicao = numero;
        if (!numeroRequisicao) {
            const ano = new Date().getFullYear();
            const [maxRows] = await connection.query(
                `SELECT MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)) as max_num 
                 FROM requisicoes_compras WHERE numero LIKE ?`,
                [`REQ-${ano}-%`]
            );
            const maxNum = maxRows[0]?.max_num || 0;
            numeroRequisicao = `REQ-${ano}-${String(maxNum + 1).padStart(4, '0')}`;
        }
        
        // Inserir requisição
        const [result] = await connection.query(
            `INSERT INTO requisicoes_compras (
                numero, solicitante, departamento, data_requisicao,
                prioridade, observacoes, status
            ) VALUES (?, ?, ?, CURDATE(), ?, ?, ?)`,
            [
                numeroRequisicao,
                solicitante,
                dept,
                prioridadeDB,
                observacoes || justificativa || null,
                statusDB
            ]
        );
        
        const requisicao_id = result.insertId;
        
        // Inserir itens
        for (const item of itens) {
            await connection.query(
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
        console.error('Erro ao criar requisição:', error.message || error);
        res.status(500).json({ error: 'Erro ao criar requisição', detalhe: error.message || 'Falha interna' });
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
        const [requisicoes] = await connection.query(
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
        await connection.query(
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
            await connection.query(
                'DELETE FROM itens_requisicao WHERE requisicao_id = ?',
                [req.params.id]
            );
            
            // Inserir novos itens
            for (const item of itens) {
                await connection.query(
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
        res.status(500).json({ error: 'Erro ao atualizar requisição' });
    } finally {
        connection.release();
    }
});

// ============ APROVAR REQUISIÇÃO ============
router.put('/:id/aprovar', async (req, res) => {
    try {
        const db = getDatabase();
        const { aprovador, observacoes_aprovacao } = req.body;
        
        const [result] = await db.query(
            `UPDATE requisicoes_compras SET 
                status = 'aprovada'
            WHERE id = ? AND status = 'pendente'`,
            [req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'Requisição não encontrada ou não está pendente' });
        }
        
        res.json({
            success: true,
            message: 'Requisição aprovada com sucesso'
        });
    } catch (error) {
        console.error('Erro ao aprovar requisição:', error);
        res.status(500).json({ error: 'Erro ao aprovar requisição' });
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
        
        const [result] = await db.query(
            `UPDATE requisicoes_compras SET 
                status = 'rejeitada'
            WHERE id = ? AND status = 'pendente'`,
            [req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'Requisição não encontrada ou não está pendente' });
        }
        
        res.json({
            success: true,
            message: 'Requisição reprovada'
        });
    } catch (error) {
        console.error('Erro ao reprovar requisição:', error);
        res.status(500).json({ error: 'Erro ao reprovar requisição' });
    }
});

// ============ CANCELAR REQUISIÇÃO ============
router.delete('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        
        const [result] = await db.query(
            "UPDATE requisicoes_compras SET status = 'rejeitada' WHERE id = ? AND status IN ('pendente','aprovada')",
            [req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'Requisição não encontrada ou já finalizada' });
        }
        
        res.json({
            success: true,
            message: 'Requisição cancelada com sucesso'
        });
    } catch (error) {
        console.error('Erro ao cancelar requisição:', error);
        res.status(500).json({ error: 'Erro ao cancelar requisição' });
    }
});

module.exports = router;
