/**
 * API DASHBOARD EXECUTIVO - ALUFORCE V.2
 * Dashboard consolidado para gestão executiva
 */

const express = require('express');
const router = express.Router();

let pool;
let authenticateToken;

/**
 * GET /api/dashboard-executivo
 * Dashboard executivo consolidado
 */
router.get('/', async (req, res) => {
    try {
        const hoje = new Date();
        const mesAtual = hoje.toISOString().slice(0, 7);
        const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).toISOString().slice(0, 7);

        const dashboard = {
            vendas: { mes_atual: 0, mes_anterior: 0, variacao: 0 },
            pedidos: { total: 0, pendentes: 0, finalizados: 0 },
            producao: { ops_ativas: 0, atrasadas: 0, concluidas_mes: 0 },
            financeiro: { a_receber: 0, a_pagar: 0, saldo: 0, vencidos: 0 },
            clientes: { ativos: 0, novos_mes: 0 },
            indicadores: { ticket_medio: 0, taxa_conversao: 0, prazo_medio_entrega: 0 }
        };

        // Vendas
        try {
            const [vendasAtual] = await pool.query(`
                SELECT COALESCE(SUM(valor_total), 0) as total 
                FROM pedidos 
                WHERE DATE_FORMAT(created_at, '%Y-%m') = ? AND status != 'cancelado'
            `, [mesAtual]);
            dashboard.vendas.mes_atual = parseFloat(vendasAtual[0]?.total) || 0;

            const [vendasAnterior] = await pool.query(`
                SELECT COALESCE(SUM(valor_total), 0) as total 
                FROM pedidos 
                WHERE DATE_FORMAT(created_at, '%Y-%m') = ? AND status != 'cancelado'
            `, [mesAnterior]);
            dashboard.vendas.mes_anterior = parseFloat(vendasAnterior[0]?.total) || 0;

            if (dashboard.vendas.mes_anterior > 0) {
                dashboard.vendas.variacao = ((dashboard.vendas.mes_atual - dashboard.vendas.mes_anterior) / dashboard.vendas.mes_anterior * 100).toFixed(1);
            }
        } catch (e) {}

        // Pedidos
        try {
            const [pedidos] = await pool.query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) as pendentes,
                    SUM(CASE WHEN status IN ('finalizado', 'entregue') THEN 1 ELSE 0 END) as finalizados
                FROM pedidos
            `);
            dashboard.pedidos = pedidos[0] || dashboard.pedidos;
        } catch (e) {}

        // Produção
        try {
            const [producao] = await pool.query(`
                SELECT 
                    SUM(CASE WHEN status IN ('em_producao', 'pendente') THEN 1 ELSE 0 END) as ops_ativas,
                    SUM(CASE WHEN status = 'em_producao' AND data_previsao < CURDATE() THEN 1 ELSE 0 END) as atrasadas,
                    SUM(CASE WHEN status = 'concluida' AND DATE_FORMAT(updated_at, '%Y-%m') = ? THEN 1 ELSE 0 END) as concluidas_mes
                FROM ordens_producao
            `, [mesAtual]);
            dashboard.producao = {
                ops_ativas: producao[0]?.ops_ativas || 0,
                atrasadas: producao[0]?.atrasadas || 0,
                concluidas_mes: producao[0]?.concluidas_mes || 0
            };
        } catch (e) {}

        // Financeiro
        try {
            const [aReceber] = await pool.query(`
                SELECT 
                    COALESCE(SUM(valor), 0) as total,
                    COALESCE(SUM(CASE WHEN data_vencimento < CURDATE() AND status = 'pendente' THEN valor ELSE 0 END), 0) as vencidos
                FROM contas_receber WHERE status = 'pendente'
            `);
            dashboard.financeiro.a_receber = parseFloat(aReceber[0]?.total) || 0;
            dashboard.financeiro.vencidos = parseFloat(aReceber[0]?.vencidos) || 0;

            const [aPagar] = await pool.query(`
                SELECT COALESCE(SUM(valor), 0) as total 
                FROM contas_pagar WHERE status = 'pendente'
            `);
            dashboard.financeiro.a_pagar = parseFloat(aPagar[0]?.total) || 0;
            dashboard.financeiro.saldo = dashboard.financeiro.a_receber - dashboard.financeiro.a_pagar;
        } catch (e) {}

        // Clientes
        try {
            const [clientes] = await pool.query(`
                SELECT 
                    COUNT(*) as ativos,
                    SUM(CASE WHEN DATE_FORMAT(created_at, '%Y-%m') = ? THEN 1 ELSE 0 END) as novos_mes
                FROM clientes WHERE ativo = 1 OR ativo IS NULL
            `, [mesAtual]);
            dashboard.clientes = clientes[0] || dashboard.clientes;
        } catch (e) {}

        // Indicadores
        try {
            const [indicadores] = await pool.query(`
                SELECT 
                    AVG(valor_total) as ticket_medio
                FROM pedidos 
                WHERE status != 'cancelado' AND DATE_FORMAT(created_at, '%Y-%m') = ?
            `, [mesAtual]);
            dashboard.indicadores.ticket_medio = parseFloat(indicadores[0]?.ticket_medio) || 0;
        } catch (e) {}

        res.json({ success: true, data: dashboard });
    } catch (error) {
        console.error('[DASHBOARD EXECUTIVO] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao gerar dashboard' });
    }
});

/**
 * GET /api/dashboard-executivo/grafico-vendas
 * Dados para gráfico de vendas
 */
router.get('/grafico-vendas', async (req, res) => {
    try {
        const { meses = 12 } = req.query;

        const [dados] = await pool.query(`
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as mes,
                COUNT(*) as quantidade,
                COALESCE(SUM(valor_total), 0) as valor_total
            FROM pedidos 
            WHERE status != 'cancelado'
            AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY mes
        `, [parseInt(meses)]);

        res.json({ success: true, data: dados });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/dashboard-executivo/top-clientes
 * Top clientes por faturamento
 */
router.get('/top-clientes', async (req, res) => {
    try {
        const { limite = 10 } = req.query;

        const [dados] = await pool.query(`
            SELECT 
                c.id,
                c.razao_social,
                c.nome_fantasia,
                COUNT(p.id) as total_pedidos,
                COALESCE(SUM(p.valor_total), 0) as valor_total
            FROM clientes c
            LEFT JOIN pedidos p ON c.id = p.cliente_id AND p.status != 'cancelado'
            GROUP BY c.id, c.razao_social, c.nome_fantasia
            ORDER BY valor_total DESC
            LIMIT ?
        `, [parseInt(limite)]);

        res.json({ success: true, data: dados });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/dashboard-executivo/top-produtos
 * Top produtos mais vendidos
 */
router.get('/top-produtos', async (req, res) => {
    try {
        const { limite = 10 } = req.query;

        const [dados] = await pool.query(`
            SELECT 
                pr.id,
                pr.nome,
                pr.codigo,
                COALESCE(SUM(pi.quantidade), 0) as quantidade_vendida,
                COALESCE(SUM(pi.valor_total), 0) as valor_total
            FROM produtos pr
            LEFT JOIN pedido_itens pi ON pr.id = pi.produto_id
            LEFT JOIN pedidos p ON pi.pedido_id = p.id AND p.status != 'cancelado'
            GROUP BY pr.id, pr.nome, pr.codigo
            ORDER BY quantidade_vendida DESC
            LIMIT ?
        `, [parseInt(limite)]);

        res.json({ success: true, data: dados });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

module.exports = function(deps) {
    pool = deps.pool;
    authenticateToken = deps.authenticateToken;
    return router;
};
