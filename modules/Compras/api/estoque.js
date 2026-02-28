const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ CONSULTAR ESTOQUE ============
router.get('/', async (req, res) => {
    try {
        const db = getDatabase();
        const { material_id, baixo_estoque } = req.query;
        
        let sql = `SELECT e.*, m.codigo, m.descricao, m.unidade_medida,
                          m.estoque_minimo, m.estoque_maximo
                   FROM estoque e
                   INNER JOIN materiais m ON e.material_id = m.id
                   WHERE 1=1`;
        const params = [];
        
        if (material_id) {
            sql += ' AND e.material_id = ?';
            params.push(material_id);
        }
        
        if (baixo_estoque === 'true') {
            sql += ' AND e.quantidade_atual < m.estoque_minimo';
        }
        
        sql += ' ORDER BY m.descricao';
        
        const [estoque] = await db.execute(sql, params);
        
        res.json({ estoque });
    } catch (error) {
        console.error('Erro ao consultar estoque:', error);
        res.status(500).json({ error: 'Erro ao consultar estoque', message: error.message });
    }
});

// ============ MATERIAIS COM ENTRADA (para Gestão de Estoque) ============
// Retorna APENAS materiais que tiveram movimentação de ENTRADA registrada pelo comprador
// IMPORTANTE: Esta rota DEVE vir ANTES de /:material_id para não ser capturada pelo parâmetro dinâmico
router.get('/materiais-com-entrada', async (req, res) => {
    try {
        const db = getDatabase();
        const { search, status } = req.query;
        
        // ★★★ QUERY 1: Buscar em estoque_materias_primas + movimentacao_materias_primas ★★★
        // Apenas materiais que tiveram ENTRADA registrada na tabela de movimentações
        let sql = `
            SELECT DISTINCT 
                mp.id,
                mp.codigo,
                mp.descricao,
                mp.unidade_medida as unidade,
                mp.quantidade_minima as estoque_min,
                mp.quantidade_minima as estoque_max,
                COALESCE(mp.quantidade_atual, 0) as estoque_atual,
                mp.localizacao,
                mp.tipo,
                mp.updated_at,
                CASE 
                    WHEN COALESCE(mp.quantidade_atual, 0) = 0 THEN 'critico'
                    WHEN COALESCE(mp.quantidade_atual, 0) < mp.quantidade_minima THEN 'baixo'
                    ELSE 'adequado'
                END as status
            FROM estoque_materias_primas mp
            WHERE EXISTS (
                SELECT 1 FROM movimentacao_materias_primas me 
                WHERE me.material_id = mp.id 
                AND me.tipo_movimentacao = 'ENTRADA'
            )
        `;
        
        const params = [];
        
        if (search) {
            sql += ' AND (mp.codigo LIKE ? OR mp.descricao LIKE ?)';
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam);
        }
        
        if (status === 'critico') {
            sql += ' AND COALESCE(mp.quantidade_atual, 0) = 0';
        } else if (status === 'baixo') {
            sql += ' AND COALESCE(mp.quantidade_atual, 0) > 0 AND COALESCE(mp.quantidade_atual, 0) < mp.quantidade_minima';
        } else if (status === 'adequado') {
            sql += ' AND COALESCE(mp.quantidade_atual, 0) >= mp.quantidade_minima';
        }
        
        sql += ' ORDER BY mp.descricao';
        
        let materiais = [];
        
        try {
            const [rows] = await db.execute(sql, params);
            materiais = rows;
        } catch (e) {
            console.log('Tabela estoque_materias_primas não encontrada, tentando materias_primas...');
            
            // ★★★ QUERY 2: Fallback para tabela materias_primas ★★★
            sql = `
                SELECT DISTINCT 
                    mp.id,
                    mp.codigo,
                    mp.descricao,
                    mp.unidade_medida as unidade,
                    mp.quantidade_minima as estoque_min,
                    mp.quantidade_minima as estoque_max,
                    COALESCE(mp.quantidade_atual, 0) as estoque_atual,
                    mp.localizacao,
                    mp.tipo,
                    mp.updated_at,
                    CASE 
                        WHEN COALESCE(mp.quantidade_atual, 0) = 0 THEN 'critico'
                        WHEN COALESCE(mp.quantidade_atual, 0) < mp.quantidade_minima THEN 'baixo'
                        ELSE 'adequado'
                    END as status
                FROM materias_primas mp
                WHERE EXISTS (
                    SELECT 1 FROM movimentacao_materias_primas me 
                    WHERE me.material_id = mp.id 
                    AND me.tipo_movimentacao = 'ENTRADA'
                )
            `;
            
            if (search) {
                sql += ' AND (mp.codigo LIKE ? OR mp.descricao LIKE ?)';
            }
            
            sql += ' ORDER BY mp.descricao';
            
            try {
                const [rows2] = await db.execute(sql, params);
                materiais = rows2;
            } catch (e2) {
                console.log('Tabela materias_primas não encontrada, tentando materiais...');
                
                // ★★★ QUERY 3: Fallback para tabela materiais + estoque ★★★
                sql = `
                    SELECT DISTINCT 
                        m.id,
                        m.codigo,
                        m.descricao,
                        m.unidade_medida as unidade,
                        m.estoque_minimo as estoque_min,
                        m.estoque_maximo as estoque_max,
                        COALESCE(e.quantidade_atual, 0) as estoque_atual,
                        m.localizacao,
                        COALESCE(c.nome, '') as categoria,
                        COALESCE(e.updated_at, m.updated_at) as updated_at,
                        CASE 
                            WHEN COALESCE(e.quantidade_atual, 0) = 0 THEN 'critico'
                            WHEN COALESCE(e.quantidade_atual, 0) < m.estoque_minimo THEN 'baixo'
                            ELSE 'adequado'
                        END as status
                    FROM materiais m
                    LEFT JOIN estoque e ON e.material_id = m.id
                    LEFT JOIN categorias_material c ON m.categoria_id = c.id
                    WHERE EXISTS (
                        SELECT 1 FROM movimentacoes_estoque me 
                        WHERE me.material_id = m.id 
                        AND (me.tipo_movimentacao = 'entrada' OR me.tipo_movimentacao = 'ENTRADA')
                    )
                `;
                
                if (search) {
                    sql += ' AND (m.codigo LIKE ? OR m.descricao LIKE ?)';
                }
                
                sql += ' ORDER BY m.descricao';
                
                try {
                    const [rows3] = await db.execute(sql, params);
                    materiais = rows3;
                } catch (e3) {
                    console.error('Nenhuma tabela de materiais encontrada:', e3.message);
                    materiais = [];
                }
            }
        }
        
        // Calcular estatísticas
        const stats = {
            total: materiais.length,
            adequado: materiais.filter(m => m.status === 'adequado').length,
            baixo: materiais.filter(m => m.status === 'baixo').length,
            critico: materiais.filter(m => m.status === 'critico').length
        };
        
        res.json({ materiais, stats });
    } catch (error) {
        console.error('Erro ao buscar materiais com entrada:', error);
        res.status(500).json({ error: 'Erro ao buscar materiais', message: error.message });
    }
});

// ============ OBTER ESTOQUE DE UM MATERIAL ============
router.get('/:material_id', async (req, res) => {
    try {
        const db = getDatabase();
        const [estoque] = await db.execute(
            `SELECT e.*, m.codigo, m.descricao, m.unidade_medida,
                    m.estoque_minimo, m.estoque_maximo
             FROM estoque e
             INNER JOIN materiais m ON e.material_id = m.id
             WHERE e.material_id = ?`,
            [req.params.material_id]
        );
        
        if (estoque.length === 0) {
            return res.status(404).json({ error: 'Estoque não encontrado para este material' });
        }
        
        res.json(estoque[0]);
    } catch (error) {
        console.error('Erro ao obter estoque:', error);
        res.status(500).json({ error: 'Erro ao buscar estoque', message: error.message });
    }
});

// ============ REGISTRAR MOVIMENTAÇÃO ============
router.post('/movimentacao', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            material_id,
            tipo_movimentacao, // 'entrada' ou 'saida'
            quantidade,
            motivo,
            documento,
            observacoes,
            usuario_id
        } = req.body;
        
        if (!material_id || !tipo_movimentacao || !quantidade) {
            await connection.rollback();
            return res.status(400).json({ error: 'Material, tipo de movimentação e quantidade são obrigatórios' });
        }
        
        if (!['entrada', 'saida'].includes(tipo_movimentacao)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Tipo de movimentação inválido. Use "entrada" ou "saida"' });
        }
        
        // Buscar estoque atual
        const [estoqueAtual] = await connection.execute(
            'SELECT quantidade_atual FROM estoque WHERE material_id = ?',
            [material_id]
        );
        
        let quantidade_atual = 0;
        
        if (estoqueAtual.length === 0) {
            // Criar registro de estoque se não existir
            await connection.execute(
                'INSERT INTO estoque (material_id, quantidade_atual) VALUES (?, 0)',
                [material_id]
            );
        } else {
            quantidade_atual = estoqueAtual[0].quantidade_atual;
        }
        
        // Calcular nova quantidade
        let nova_quantidade;
        if (tipo_movimentacao === 'entrada') {
            nova_quantidade = quantidade_atual + quantidade;
        } else {
            if (quantidade_atual < quantidade) {
                await connection.rollback();
                return res.status(400).json({ 
                    error: 'Quantidade insuficiente em estoque',
                    estoque_atual: quantidade_atual,
                    quantidade_solicitada: quantidade
                });
            }
            nova_quantidade = quantidade_atual - quantidade;
        }
        
        // Atualizar estoque
        await connection.execute(
            'UPDATE estoque SET quantidade_atual = ? WHERE material_id = ?',
            [nova_quantidade, material_id]
        );
        
        // Registrar movimentação
        await connection.execute(
            `INSERT INTO movimentacoes_estoque (
                material_id, tipo_movimentacao, quantidade, 
                saldo_anterior, saldo_atual, motivo, documento,
                observacoes, usuario_id, data_movimentacao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                material_id,
                tipo_movimentacao,
                quantidade,
                quantidade_atual,
                nova_quantidade,
                motivo,
                documento,
                observacoes,
                usuario_id
            ]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Movimentação registrada com sucesso',
            saldo_anterior: quantidade_atual,
            saldo_atual: nova_quantidade
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao registrar movimentação:', error);
        res.status(500).json({ error: 'Erro ao registrar movimentação', message: error.message });
    } finally {
        connection.release();
    }
});

// ============ LISTAR MOVIMENTAÇÕES (rota simplificada) ============
router.get('/movimentacoes', async (req, res) => {
    try {
        const db = getDatabase();
        const { limit = 100, offset = 0 } = req.query;
        
        // Primeiro tenta na tabela movimentacao_materias_primas
        let movimentacoes = [];
        
        try {
            const [rows] = await db.execute(`
                SELECT 
                    m.id,
                    m.tipo_movimentacao as tipo,
                    m.quantidade,
                    m.destino,
                    m.documento,
                    m.observacao,
                    m.created_at,
                    mp.descricao as material_descricao,
                    mp.codigo as material_codigo
                FROM movimentacao_materias_primas m
                LEFT JOIN estoque_materias_primas mp ON m.material_id = mp.id
                ORDER BY m.created_at DESC
                LIMIT ? OFFSET ?
            `, [parseInt(limit), parseInt(offset)]);
            movimentacoes = rows;
        } catch (e) {
            // Fallback para movimentacoes_estoque
            try {
                const [rows2] = await db.execute(`
                    SELECT 
                        m.id,
                        m.tipo_movimentacao as tipo,
                        m.quantidade,
                        m.destino,
                        m.documento,
                        m.observacao,
                        m.data_movimentacao as created_at,
                        mat.descricao as material_descricao,
                        mat.codigo as material_codigo
                    FROM movimentacoes_estoque m
                    LEFT JOIN materiais mat ON m.material_id = mat.id
                    ORDER BY m.data_movimentacao DESC
                    LIMIT ? OFFSET ?
                `, [parseInt(limit), parseInt(offset)]);
                movimentacoes = rows2;
            } catch (e2) {
                console.log('Nenhuma tabela de movimentações encontrada');
            }
        }
        
        res.json({ movimentacoes });
    } catch (error) {
        console.error('Erro ao listar movimentações:', error);
        res.status(500).json({ error: 'Erro ao buscar movimentações', message: error.message });
    }
});

// ============ HISTÓRICO DE MOVIMENTAÇÕES ============
router.get('/movimentacoes/historico', async (req, res) => {
    try {
        const db = getDatabase();
        const { material_id, tipo_movimentacao, data_inicio, data_fim, limit = 100, offset = 0 } = req.query;
        
        let sql = `SELECT m.*, mat.codigo, mat.descricao
                   FROM movimentacoes_estoque m
                   INNER JOIN materiais mat ON m.material_id = mat.id
                   WHERE 1=1`;
        const params = [];
        
        if (material_id) {
            sql += ' AND m.material_id = ?';
            params.push(material_id);
        }
        
        if (tipo_movimentacao) {
            sql += ' AND m.tipo_movimentacao = ?';
            params.push(tipo_movimentacao);
        }
        
        if (data_inicio) {
            sql += ' AND m.data_movimentacao >= ?';
            params.push(data_inicio);
        }
        
        if (data_fim) {
            sql += ' AND m.data_movimentacao <= ?';
            params.push(data_fim);
        }
        
        sql += ' ORDER BY m.data_movimentacao DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [movimentacoes] = await db.execute(sql, params);
        
        res.json({ movimentacoes });
    } catch (error) {
        console.error('Erro ao listar movimentações:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico', message: error.message });
    }
});

// ============ AJUSTAR ESTOQUE (INVENTÁRIO) ============
router.post('/ajuste', async (req, res) => {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            material_id,
            quantidade_contada,
            motivo = 'Ajuste de inventário',
            observacoes,
            usuario_id
        } = req.body;
        
        if (!material_id || quantidade_contada === undefined) {
            await connection.rollback();
            return res.status(400).json({ error: 'Material e quantidade contada são obrigatórios' });
        }
        
        // Buscar estoque atual
        const [estoqueAtual] = await connection.execute(
            'SELECT quantidade_atual FROM estoque WHERE material_id = ?',
            [material_id]
        );
        
        if (estoqueAtual.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Material não encontrado no estoque' });
        }
        
        const quantidade_atual = estoqueAtual[0].quantidade_atual;
        const diferenca = quantidade_contada - quantidade_atual;
        
        // Atualizar estoque
        await connection.execute(
            'UPDATE estoque SET quantidade_atual = ? WHERE material_id = ?',
            [quantidade_contada, material_id]
        );
        
        // Registrar movimentação de ajuste
        const tipo_movimentacao = diferenca >= 0 ? 'entrada' : 'saida';
        const quantidade_movimento = Math.abs(diferenca);
        
        await connection.execute(
            `INSERT INTO movimentacoes_estoque (
                material_id, tipo_movimentacao, quantidade, 
                saldo_anterior, saldo_atual, motivo, observacoes,
                usuario_id, data_movimentacao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                material_id,
                tipo_movimentacao,
                quantidade_movimento,
                quantidade_atual,
                quantidade_contada,
                motivo,
                `Ajuste: ${observacoes || 'Inventário'}. Diferença: ${diferenca}`,
                usuario_id
            ]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Estoque ajustado com sucesso',
            saldo_anterior: quantidade_atual,
            saldo_atual: quantidade_contada,
            diferenca
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao ajustar estoque:', error);
        res.status(500).json({ error: 'Erro ao ajustar estoque', message: error.message });
    } finally {
        connection.release();
    }
});

// ============ ALERTAS DE ESTOQUE BAIXO ============
router.get('/alertas/estoque-baixo', async (req, res) => {
    try {
        const db = getDatabase();
        
        const [alertas] = await db.execute(
            `SELECT e.*, m.codigo, m.descricao, m.unidade_medida,
                    m.estoque_minimo, m.estoque_maximo,
                    (m.estoque_minimo - e.quantidade_atual) as quantidade_faltante
             FROM estoque e
             INNER JOIN materiais m ON e.material_id = m.id
             WHERE e.quantidade_atual < m.estoque_minimo
             ORDER BY (m.estoque_minimo - e.quantidade_atual) DESC`
        );
        
        res.json({ alertas, total: alertas.length });
    } catch (error) {
        console.error('Erro ao buscar alertas:', error);
        res.status(500).json({ error: 'Erro ao buscar alertas de estoque', message: error.message });
    }
});

module.exports = router;
