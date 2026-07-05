const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ LISTAR COTAÇÕES ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { status, limit = 50, offset = 0 } = req.query;
        
        // AUDIT #006: retornar nome do solicitante via JOIN (frontend lê solicitante_nome)
        let sql = `SELECT c.*, u.nome AS solicitante_nome
                   FROM cotacoes c
                   LEFT JOIN usuarios u ON c.usuario_solicitante_id = u.id
                   WHERE 1=1`;
        const params = [];

        if (status) {
            sql += ' AND c.status = ?';
            params.push(status);
        }

        sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
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
        res.status(500).json({ error: 'Erro ao buscar cotações' });
    }
});

// ============ PRÓXIMO NÚMERO ============
router.get('/proximo-numero', async (req, res) => {
    try {
        const db = getDatabase();
        const [rows] = await db.query(
            'SELECT numero_cotacao FROM cotacoes ORDER BY id DESC LIMIT 1'
        );
        let proximo = 'COT-001';
        if (rows.length > 0 && rows[0].numero_cotacao) {
            const match = rows[0].numero_cotacao.match(/(\d+)$/);
            if (match) {
                proximo = 'COT-' + String(parseInt(match[1]) + 1).padStart(3, '0');
            }
        }
        res.json({ numero: proximo, proximo_numero: proximo });
    } catch (error) {
        console.error('Erro ao gerar próximo número cotação:', error);
        res.json({ numero: 'COT-' + String(Date.now()).slice(-4), proximo_numero: 'COT-' + String(Date.now()).slice(-4) });
    }
});

// ============ OBTER COTAÇÃO ============
router.get('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        const [cotacoes] = await db.query(
            `SELECT c.*, u.nome AS solicitante_nome
             FROM cotacoes c
             LEFT JOIN usuarios u ON c.usuario_solicitante_id = u.id
             WHERE c.id = ?`,
            [req.params.id]
        );
        
        if (cotacoes.length === 0) {
            return res.status(404).json({ error: 'Cotação não encontrada' });
        }
        
        const cotacao = cotacoes[0];
        
        cotacao.itens = [];
        
        // Buscar propostas
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
        
        res.json(cotacao);
    } catch (error) {
        console.error('Erro ao obter cotação:', error);
        res.status(500).json({ error: 'Erro ao buscar cotação' });
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
            numero,
            descricao,
            data_limite,
            data_validade,
            data_abertura,
            quantidade,
            unidade,
            observacoes,
            fornecedores_ids = [],
            itens
        } = req.body;
        
        const numeroCotacaoBase = titulo || numero || descricao;
        const dataLimite = data_limite || data_validade;
        const descricaoFinal = descricao || observacoes || '';
        const dataSolicitacao = data_abertura || new Date().toISOString().split('T')[0];
        
        if (!numeroCotacaoBase) {
            await connection.rollback();
            return res.status(400).json({ error: 'Número/descrição da cotação é obrigatório' });
        }
        
        // Auto-gerar numero_cotacao único
        let numeroCotacao = numeroCotacaoBase;
        if (!numero || numero === numeroCotacaoBase) {
            const ano = new Date().getFullYear();
            const [maxRows] = await connection.query(
                `SELECT MAX(CAST(SUBSTRING_INDEX(numero_cotacao, '-', -1) AS UNSIGNED)) as max_num 
                 FROM cotacoes WHERE numero_cotacao LIKE ?`,
                [`COT-${ano}-%`]
            );
            const maxNum = maxRows[0]?.max_num || 0;
            numeroCotacao = `COT-${ano}-${String(maxNum + 1).padStart(4, '0')}`;
        }
        
        // Inserir cotação — AUDIT #012: registrar solicitante a partir do token
        const [result] = await connection.query(
            `INSERT INTO cotacoes (
                numero_cotacao, descricao, data_solicitacao, data_limite, status, usuario_solicitante_id
            ) VALUES (?, ?, ?, ?, 'aberta', ?)`,
            [numeroCotacao, descricaoFinal, dataSolicitacao, dataLimite, (req.user && req.user.id) || null]
        );
        
        const cotacao_id = result.insertId;
        
        // Criar propostas vazias para fornecedores selecionados
        // Usa compras_fornecedores como fonte primária de IDs
        if (fornecedores_ids.length > 0) {
            for (const fornecedor_id of fornecedores_ids) {
                try {
                    // Verificar se o fornecedor existe em compras_fornecedores
                    const [exists] = await connection.query(
                        'SELECT id FROM compras_fornecedores WHERE id = ? UNION SELECT id FROM fornecedores WHERE id = ? LIMIT 1',
                        [fornecedor_id, fornecedor_id]
                    );
                    if (exists.length > 0) {
                        await connection.query(
                            `INSERT INTO propostas_cotacao (
                                cotacao_id, fornecedor_id, valor_total
                            ) VALUES (?, ?, 0)`,
                            [cotacao_id, fornecedor_id]
                        );
                    } else {
                        console.warn(`[COTACAO] Fornecedor ID ${fornecedor_id} não encontrado, ignorando`);
                    }
                } catch (fkErr) {
                    console.warn(`[COTACAO] Erro ao vincular fornecedor ${fornecedor_id}:`, fkErr.message);
                }
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
        res.status(500).json({ error: 'Erro ao criar cotação' });
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
        const [cotacoes] = await connection.query(
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
        const [propostasExistentes] = await connection.query(
            'SELECT id FROM propostas_cotacao WHERE cotacao_id = ? AND fornecedor_id = ?',
            [req.params.id, fornecedor_id]
        );
        
        if (propostasExistentes.length > 0) {
            // Atualizar proposta existente
            await connection.query(
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
            await connection.query(
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
        res.status(500).json({ error: 'Erro ao adicionar proposta' });
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
        await connection.query(
            `UPDATE propostas_cotacao SET 
                selecionada = 1
            WHERE id = ?`,
            [proposta_id]
        );
        
        // Marcar outras propostas como não selecionadas
        await connection.query(
            `UPDATE propostas_cotacao SET 
                selecionada = 0
            WHERE cotacao_id = ? AND id != ?`,
            [req.params.id, proposta_id]
        );
        
        // Encerrar cotação
        await connection.query(
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
        res.status(500).json({ error: 'Erro ao selecionar vencedor' });
    } finally {
        connection.release();
    }
});

// ============ ENCERRAR COTAÇÃO ============
router.put('/:id/encerrar', async (req, res) => {
    try {
        const db = getDatabase();
        const { motivo } = req.body;
        
        // SECURITY FIX (COT-AUTHZ-002): Verificar que cotação está aberta antes de encerrar
        const [result] = await db.query(
            `UPDATE cotacoes SET 
                status = 'encerrada',
                data_encerramento = NOW(),
                motivo_encerramento = ?
            WHERE id = ? AND status = 'aberta'`,
            [motivo, req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'Cotação não pode ser encerrada (não está aberta ou não encontrada)' });
        }
        
        res.json({
            success: true,
            message: 'Cotação encerrada'
        });
    } catch (error) {
        console.error('Erro ao encerrar cotação:', error);
        res.status(500).json({ error: 'Erro ao encerrar cotação' });
    }
});

// ============ CANCELAR/EXCLUIR COTAÇÃO ============
router.delete('/:id', async (req, res) => {
    try {
        const db = getDatabase();
        
        // Verificar se cotação existe
        const [rows] = await db.query('SELECT id, status FROM cotacoes WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Cotação não encontrada' });
        }
        
        const cotacao = rows[0];
        
        // Se já cancelada ou encerrada, permitir exclusão permanente
        if (cotacao.status === 'cancelada' || cotacao.status === 'encerrada') {
            await db.query('DELETE FROM propostas_cotacao WHERE cotacao_id = ?', [req.params.id]);
            await db.query('DELETE FROM cotacoes WHERE id = ?', [req.params.id]);
            return res.json({ success: true, message: 'Cotação excluída permanentemente' });
        }
        
        // Se aberta ou em análise, cancelar (soft-delete)
        await db.query("UPDATE cotacoes SET status = 'cancelada' WHERE id = ?", [req.params.id]);
        
        res.json({
            success: true,
            message: 'Cotação cancelada com sucesso'
        });
    } catch (error) {
        console.error('Erro ao excluir cotação:', error);
        res.status(500).json({ error: 'Erro ao excluir cotação' });
    }
});

module.exports = router;
