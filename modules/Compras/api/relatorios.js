const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

// ============ RELATÓRIO DE COMPRAS POR PERÍODO ============
router.get('/compras-periodo', async (req, res) => {
    try {
        const db = getDatabase();
        const { data_inicio, data_fim, status, fornecedor_id } = req.query;
        
        if (!data_inicio || !data_fim) {
            return res.status(400).json({ error: 'Data de início e fim são obrigatórias' });
        }
        
        let sql = `SELECT 
                      p.id,
                      p.numero_pedido,
                      p.data_pedido,
                      p.data_entrega_prevista,
                      p.valor_total,
                      p.status,
                      f.razao_social as fornecedor
                   FROM pedidos_compra p
                   LEFT JOIN fornecedores f ON p.fornecedor_id = f.id
                   WHERE p.data_pedido BETWEEN ? AND ?`;
        const params = [data_inicio, data_fim];
        
        if (status) {
            sql += ' AND p.status = ?';
            params.push(status);
        }
        
        if (fornecedor_id) {
            sql += ' AND p.fornecedor_id = ?';
            params.push(fornecedor_id);
        }
        
        sql += ' ORDER BY p.data_pedido DESC';
        
        const [pedidos] = await db.query(sql, params);
        
        // Calcular totalizadores
        const [totais] = await db.query(
            `SELECT 
                COUNT(*) as quantidade_pedidos,
                SUM(valor_total) as valor_total,
                AVG(valor_total) as valor_medio
             FROM pedidos_compra 
             WHERE data_pedido BETWEEN ? AND ?` +
             (status ? ' AND status = ?' : '') +
             (fornecedor_id ? ' AND fornecedor_id = ?' : ''),
            params
        );
        
        res.json({
            pedidos,
            resumo: totais[0]
        });
    } catch (error) {
        console.error('Erro ao gerar relatório de compras:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório', message: error.message });
    }
});

// ============ RELATÓRIO DE DESEMPENHO DE FORNECEDORES ============
router.get('/desempenho-fornecedores', async (req, res) => {
    try {
        const db = getDatabase();
        const { data_inicio, data_fim } = req.query;
        
        if (!data_inicio || !data_fim) {
            return res.status(400).json({ error: 'Data de início e fim são obrigatórias' });
        }
        
        const [fornecedores] = await db.query(
            `SELECT 
                f.id,
                f.razao_social,
                COUNT(p.id) as total_pedidos,
                SUM(CASE WHEN p.status = 'entregue' THEN 1 ELSE 0 END) as pedidos_entregues,
                SUM(CASE WHEN p.status = 'cancelado' THEN 1 ELSE 0 END) as pedidos_cancelados,
                SUM(p.valor_total) as valor_total_comprado,
                AVG(p.valor_total) as valor_medio_pedido,
                AVG(DATEDIFF(p.data_recebimento, p.data_entrega_prevista)) as media_atraso_dias
             FROM fornecedores f
             LEFT JOIN pedidos_compra p ON f.id = p.fornecedor_id 
                 AND p.data_pedido BETWEEN ? AND ?
             GROUP BY f.id, f.razao_social
             HAVING total_pedidos > 0
             ORDER BY valor_total_comprado DESC`,
            [data_inicio, data_fim]
        );
        
        res.json({ fornecedores });
    } catch (error) {
        console.error('Erro ao gerar relatório de fornecedores:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório', message: error.message });
    }
});

// ============ RELATÓRIO DE ESTOQUE BAIXO ============
router.get('/estoque-baixo', async (req, res) => {
    try {
        const db = getDatabase();
        
        const [materiais] = await db.query(
            `SELECT 
                m.id,
                m.codigo,
                m.descricao,
                m.unidade_medida,
                e.quantidade_atual,
                m.estoque_minimo,
                m.estoque_maximo,
                (m.estoque_minimo - e.quantidade_atual) as quantidade_comprar,
                m.preco_medio,
                (m.estoque_minimo - e.quantidade_atual) * m.preco_medio as valor_estimado,
                f.razao_social as fornecedor_preferencial
             FROM materiais m
             INNER JOIN estoque e ON m.id = e.material_id
             LEFT JOIN fornecedores f ON m.fornecedor_preferencial_id = f.id
             WHERE e.quantidade_atual < m.estoque_minimo
                AND m.status = 'ativo'
             ORDER BY (m.estoque_minimo - e.quantidade_atual) DESC`
        );
        
        const [totais] = await db.query(
            `SELECT 
                COUNT(*) as total_materiais,
                SUM((m.estoque_minimo - e.quantidade_atual) * m.preco_medio) as valor_total_estimado
             FROM materiais m
             INNER JOIN estoque e ON m.id = e.material_id
             WHERE e.quantidade_atual < m.estoque_minimo
                AND m.status = 'ativo'`
        );
        
        res.json({
            materiais,
            resumo: totais[0]
        });
    } catch (error) {
        console.error('Erro ao gerar relatório de estoque baixo:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório', message: error.message });
    }
});

// ============ RELATÓRIO DE MATERIAIS CRÍTICOS ============
router.get('/materiais-criticos', async (req, res) => {
    try {
        const db = getDatabase();
        
        // Materiais sem estoque ou abaixo de 20% do mínimo
        const [materiais] = await db.query(
            `SELECT 
                m.id,
                m.codigo,
                m.descricao,
                m.unidade_medida,
                e.quantidade_atual,
                m.estoque_minimo,
                m.estoque_maximo,
                ROUND((e.quantidade_atual / NULLIF(m.estoque_minimo, 0)) * 100, 2) as percentual_minimo,
                m.preco_medio,
                f.razao_social as fornecedor_preferencial
             FROM materiais m
             LEFT JOIN estoque e ON m.id = e.material_id
             LEFT JOIN fornecedores f ON m.fornecedor_preferencial_id = f.id
             WHERE m.status = 'ativo'
                AND (
                    e.quantidade_atual IS NULL 
                    OR e.quantidade_atual = 0
                    OR e.quantidade_atual <= (m.estoque_minimo * 0.2)
                )
             ORDER BY 
                CASE 
                    WHEN e.quantidade_atual IS NULL THEN 1
                    WHEN e.quantidade_atual = 0 THEN 2
                    ELSE 3
                END,
                percentual_minimo ASC`
        );
        
        res.json({ materiais, total: materiais.length });
    } catch (error) {
        console.error('Erro ao gerar relatório de materiais críticos:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório', message: error.message });
    }
});

// ============ RELATÓRIO DE MOVIMENTAÇÕES DE ESTOQUE ============
router.get('/movimentacoes-estoque', async (req, res) => {
    try {
        const db = getDatabase();
        const { data_inicio, data_fim, material_id, tipo_movimentacao } = req.query;
        
        if (!data_inicio || !data_fim) {
            return res.status(400).json({ error: 'Data de início e fim são obrigatórias' });
        }
        
        let sql = `SELECT 
                      mo.id,
                      mo.data_movimentacao,
                      mo.tipo_movimentacao,
                      mo.quantidade,
                      mo.saldo_anterior,
                      mo.saldo_atual,
                      mo.motivo,
                      mo.documento,
                      m.codigo,
                      m.descricao as material
                   FROM movimentacoes_estoque mo
                   INNER JOIN materiais m ON mo.material_id = m.id
                   WHERE mo.data_movimentacao BETWEEN ? AND ?`;
        const params = [data_inicio, data_fim];
        
        if (material_id) {
            sql += ' AND mo.material_id = ?';
            params.push(material_id);
        }
        
        if (tipo_movimentacao) {
            sql += ' AND mo.tipo_movimentacao = ?';
            params.push(tipo_movimentacao);
        }
        
        sql += ' ORDER BY mo.data_movimentacao DESC';
        
        const [movimentacoes] = await db.query(sql, params);
        
        // Totalizadores
        const [totais] = await db.query(
            `SELECT 
                tipo_movimentacao,
                COUNT(*) as quantidade_movimentacoes,
                SUM(quantidade) as quantidade_total
             FROM movimentacoes_estoque
             WHERE data_movimentacao BETWEEN ? AND ?` +
             (material_id ? ' AND material_id = ?' : '') +
             (tipo_movimentacao ? ' AND tipo_movimentacao = ?' : '') +
             ` GROUP BY tipo_movimentacao`,
            params
        );
        
        res.json({
            movimentacoes,
            resumo: totais
        });
    } catch (error) {
        console.error('Erro ao gerar relatório de movimentações:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório', message: error.message });
    }
});

// ============ RELATÓRIO DE REQUISIÇÕES POR STATUS ============
router.get('/requisicoes-status', async (req, res) => {
    try {
        const db = getDatabase();
        const { data_inicio, data_fim, status } = req.query;
        
        if (!data_inicio || !data_fim) {
            return res.status(400).json({ error: 'Data de início e fim são obrigatórias' });
        }
        
        let sql = `SELECT 
                      r.id,
                      r.numero,
                      r.data_requisicao,
                      r.status,
                      r.prioridade,
                      r.departamento,
                      r.solicitante,
                      COUNT(ri.id) as total_itens
                   FROM requisicoes_compras r
                   LEFT JOIN itens_requisicao ri ON r.id = ri.requisicao_id
                   WHERE r.data_requisicao BETWEEN ? AND ?`;
        const params = [data_inicio, data_fim];
        
        if (status) {
            sql += ' AND r.status = ?';
            params.push(status);
        }
        
        sql += ' GROUP BY r.id ORDER BY r.data_requisicao DESC';
        
        const [requisicoes] = await db.query(sql, params);
        
        // Resumo por status
        const [resumo] = await db.query(
            `SELECT 
                status,
                COUNT(*) as quantidade,
                SUM(CASE WHEN prioridade = 'urgente' THEN 1 ELSE 0 END) as urgentes
             FROM requisicoes_compras
             WHERE data_requisicao BETWEEN ? AND ?
             GROUP BY status`,
            [data_inicio, data_fim]
        );
        
        res.json({
            requisicoes,
            resumo
        });
    } catch (error) {
        console.error('Erro ao gerar relatório de requisições:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório', message: error.message });
    }
});

// ============ RELATÓRIO DE COTAÇÕES ============
router.get('/cotacoes', async (req, res) => {
    try {
        const db = getDatabase();
        const { data_inicio, data_fim, status } = req.query;
        
        if (!data_inicio || !data_fim) {
            return res.status(400).json({ error: 'Data de início e fim são obrigatórias' });
        }
        
        let sql = `SELECT 
                      c.id,
                      c.numero_cotacao,
                      c.data_solicitacao,
                      c.data_limite,
                      c.status,
                      COUNT(DISTINCT cp.fornecedor_id) as total_fornecedores,
                      MIN(cp.valor_total) as menor_proposta,
                      MAX(cp.valor_total) as maior_proposta
                   FROM cotacoes c
                   LEFT JOIN propostas_cotacao cp ON c.id = cp.cotacao_id
                   WHERE c.data_solicitacao BETWEEN ? AND ?`;
        const params = [data_inicio, data_fim];
        
        if (status) {
            sql += ' AND c.status = ?';
            params.push(status);
        }
        
        sql += ' GROUP BY c.id ORDER BY c.data_solicitacao DESC';
        
        const [cotacoes] = await db.query(sql, params);
        
        // Resumo
        const [resumo] = await db.query(
            `SELECT 
                status,
                COUNT(*) as quantidade
             FROM cotacoes
             WHERE data_solicitacao BETWEEN ? AND ?
             GROUP BY status`,
            [data_inicio, data_fim]
        );
        
        res.json({
            cotacoes,
            resumo
        });
    } catch (error) {
        console.error('Erro ao gerar relatório de cotações:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório', message: error.message });
    }
});

module.exports = router;
