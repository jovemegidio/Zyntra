/**
 * PCP — Sub-router: Relatórios
 * Extraído de pcp-routes.js (CRIT-6: split god object)
 *
 * Rotas:
 *   GET /relatorios/cabos-mais-vendidos
 *   GET /relatorios/ranking-vendas
 *   GET /relatorios/metros-produzidos
 *   GET /relatorios/faturamento-mensal
 */

module.exports = function registerRelatoriosRoutes(router, pool) {

    // 1. Cabos mais vendidos (ranking por quantidade e valor)
    router.get('/relatorios/cabos-mais-vendidos', async (req, res) => {
        try {
            const { data_inicio, data_fim, limit } = req.query;
            const maxResults = parseInt(limit) || 20;
            let whereClause = '';
            let params = [];

            if (data_inicio && data_fim) {
                whereClause = 'WHERE p.created_at BETWEEN ? AND ?';
                params = [data_inicio, data_fim];
            }

            const [porQuantidade] = await pool.query(`
                SELECT
                    pi.codigo,
                    pi.descricao,
                    SUM(pi.quantidade) as total_quantidade,
                    pi.unidade,
                    SUM(pi.subtotal) as total_valor,
                    COUNT(DISTINCT pi.pedido_id) as total_pedidos,
                    AVG(pi.preco_unitario) as preco_medio
                FROM pedido_itens pi
                LEFT JOIN pedidos p ON pi.pedido_id = p.id
                ${whereClause}
                GROUP BY pi.codigo, pi.descricao, pi.unidade
                ORDER BY total_quantidade DESC
                LIMIT ?
            `, [...params, maxResults]);

            const [porValor] = await pool.query(`
                SELECT
                    pi.codigo,
                    pi.descricao,
                    SUM(pi.quantidade) as total_quantidade,
                    pi.unidade,
                    SUM(pi.subtotal) as total_valor,
                    COUNT(DISTINCT pi.pedido_id) as total_pedidos,
                    AVG(pi.preco_unitario) as preco_medio
                FROM pedido_itens pi
                LEFT JOIN pedidos p ON pi.pedido_id = p.id
                ${whereClause}
                GROUP BY pi.codigo, pi.descricao, pi.unidade
                ORDER BY total_valor DESC
                LIMIT ?
            `, [...params, maxResults]);

            const [resumo] = await pool.query(`
                SELECT
                    COUNT(DISTINCT pi.codigo) as total_produtos_vendidos,
                    SUM(pi.quantidade) as quantidade_total,
                    SUM(pi.subtotal) as valor_total,
                    COUNT(DISTINCT pi.pedido_id) as total_pedidos
                FROM pedido_itens pi
                LEFT JOIN pedidos p ON pi.pedido_id = p.id
                ${whereClause}
            `, params);

            let whereOP = '';
            let paramsOP = [];
            if (data_inicio && data_fim) {
                whereOP = 'WHERE data_inicio BETWEEN ? AND ?';
                paramsOP = [data_inicio, data_fim];
            }

            const [ordensProducao] = await pool.query(`
                SELECT
                    produto_nome,
                    codigo,
                    SUM(quantidade) as total_quantidade,
                    SUM(metragem) as total_metragem,
                    COUNT(*) as total_ordens,
                    unidade
                FROM ordens_producao
                ${whereOP}
                GROUP BY produto_nome, codigo, unidade
                ORDER BY total_quantidade DESC
                LIMIT ?
            `, [...paramsOP, maxResults]);

            res.json({
                success: true,
                ranking_por_quantidade: porQuantidade,
                ranking_por_valor: porValor,
                ordens_producao: ordensProducao,
                resumo: resumo[0] || {},
                periodo: { data_inicio, data_fim }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro cabos mais vendidos:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de cabos mais vendidos.' });
        }
    });

    // 2. Ranking de vendas (por vendedor, cliente, produto)
    router.get('/relatorios/ranking-vendas', async (req, res) => {
        try {
            const { data_inicio, data_fim, agrupar } = req.query;
            let whereClause = '';
            let params = [];

            if (data_inicio && data_fim) {
                whereClause = 'WHERE p.created_at BETWEEN ? AND ?';
                params = [data_inicio, data_fim];
            }

            const [porVendedor] = await pool.query(`
                SELECT
                    COALESCE(p.vendedor_nome, 'Não informado') as vendedor,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio,
                    COUNT(CASE WHEN p.status = 'faturado' THEN 1 END) as pedidos_faturados,
                    COUNT(CASE WHEN p.status = 'aprovado' THEN 1 END) as pedidos_aprovados
                FROM pedidos p
                ${whereClause}
                GROUP BY p.vendedor_nome
                ORDER BY valor_total DESC
                LIMIT 20
            `, params);

            const [porCliente] = await pool.query(`
                SELECT
                    COALESCE(p.cliente_nome, 'Não informado') as cliente,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio,
                    MAX(p.created_at) as ultimo_pedido
                FROM pedidos p
                ${whereClause}
                GROUP BY p.cliente_nome
                ORDER BY valor_total DESC
                LIMIT 20
            `, params);

            const [totais] = await pool.query(`
                SELECT
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio,
                    COUNT(DISTINCT p.vendedor_nome) as total_vendedores,
                    COUNT(DISTINCT p.cliente_nome) as total_clientes
                FROM pedidos p
                ${whereClause}
            `, params);

            const [evolucaoMensal] = await pool.query(`
                SELECT
                    DATE_FORMAT(p.created_at, '%Y-%m') as mes,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total
                FROM pedidos p
                ${whereClause.length > 0 ? whereClause : 'WHERE p.created_at IS NOT NULL'}
                GROUP BY DATE_FORMAT(p.created_at, '%Y-%m')
                ORDER BY mes DESC
                LIMIT 12
            `, params);

            res.json({
                success: true,
                por_vendedor: porVendedor,
                por_cliente: porCliente,
                evolucao_mensal: evolucaoMensal.reverse(),
                totais: totais[0] || {},
                periodo: { data_inicio, data_fim }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro ranking vendas:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar ranking de vendas.' });
        }
    });

    // 3. Metros produzidos por dia
    router.get('/relatorios/metros-produzidos', async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;

            const fim = data_fim || new Date().toISOString().slice(0, 10);
            const inicio = data_inicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

            const [apontamentosDiarios] = await pool.query(`
                SELECT
                    DATE(ap.data_apontamento) as data,
                    SUM(ap.quantidade_produzida) as quantidade_produzida,
                    SUM(ap.tempo_producao) as tempo_total_min,
                    COUNT(*) as total_apontamentos,
                    GROUP_CONCAT(DISTINCT ap.maquina SEPARATOR ', ') as maquinas,
                    GROUP_CONCAT(DISTINCT ap.operador SEPARATOR ', ') as operadores
                FROM apontamentos_producao ap
                WHERE ap.data_apontamento BETWEEN ? AND ?
                GROUP BY DATE(ap.data_apontamento)
                ORDER BY data ASC
            `, [inicio, fim]);

            const [ordensConcluidasDia] = await pool.query(`
                SELECT
                    DATE(COALESCE(data_conclusao, data_inicio)) as data,
                    SUM(metragem) as total_metragem,
                    SUM(quantidade) as total_quantidade,
                    COUNT(*) as total_ordens,
                    GROUP_CONCAT(DISTINCT produto_nome SEPARATOR ', ') as produtos
                FROM ordens_producao
                WHERE (data_conclusao BETWEEN ? AND ? OR data_inicio BETWEEN ? AND ?)
                GROUP BY DATE(COALESCE(data_conclusao, data_inicio))
                ORDER BY data ASC
            `, [inicio, fim, inicio, fim]);

            const [resumoApontamentos] = await pool.query(`
                SELECT
                    SUM(quantidade_produzida) as total_produzido,
                    AVG(quantidade_produzida) as media_diaria,
                    MAX(quantidade_produzida) as max_dia,
                    MIN(quantidade_produzida) as min_dia,
                    SUM(tempo_producao) as tempo_total,
                    COUNT(DISTINCT DATE(data_apontamento)) as dias_com_producao
                FROM apontamentos_producao
                WHERE data_apontamento BETWEEN ? AND ?
            `, [inicio, fim]);

            const [resumoOrdens] = await pool.query(`
                SELECT
                    SUM(metragem) as total_metragem,
                    SUM(quantidade) as total_quantidade,
                    COUNT(*) as total_ordens,
                    COUNT(CASE WHEN status = 'concluida' THEN 1 END) as ordens_concluidas,
                    COUNT(CASE WHEN status = 'em_producao' THEN 1 END) as ordens_em_producao
                FROM ordens_producao
                WHERE data_inicio BETWEEN ? AND ? OR data_conclusao BETWEEN ? AND ?
            `, [inicio, fim, inicio, fim]);

            res.json({
                success: true,
                apontamentos_diarios: apontamentosDiarios,
                ordens_por_dia: ordensConcluidasDia,
                resumo_apontamentos: resumoApontamentos[0] || {},
                resumo_ordens: resumoOrdens[0] || {},
                periodo: { data_inicio: inicio, data_fim: fim }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro metros produzidos:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de metros produzidos.' });
        }
    });

    // 4. Faturamento mensal
    router.get('/relatorios/faturamento-mensal', async (req, res) => {
        try {
            const { ano } = req.query;
            const anoFiltro = parseInt(ano) || new Date().getFullYear();

            const [faturamentoPF] = await pool.query(`
                SELECT
                    DATE_FORMAT(data_faturamento, '%Y-%m') as mes,
                    MONTH(data_faturamento) as mes_num,
                    COUNT(*) as total_pedidos,
                    SUM(total) as valor_total,
                    AVG(total) as ticket_medio
                FROM pedidos_faturados
                WHERE YEAR(data_faturamento) = ?
                GROUP BY DATE_FORMAT(data_faturamento, '%Y-%m'), MONTH(data_faturamento)
                ORDER BY mes_num ASC
            `, [anoFiltro]);

            const [faturamentoPedidos] = await pool.query(`
                SELECT
                    DATE_FORMAT(p.created_at, '%Y-%m') as mes,
                    MONTH(p.created_at) as mes_num,
                    COUNT(*) as total_pedidos,
                    SUM(p.valor) as valor_total,
                    AVG(p.valor) as ticket_medio
                FROM pedidos p
                WHERE p.status IN ('faturado', 'entregue', 'convertido')
                AND YEAR(p.created_at) = ?
                GROUP BY DATE_FORMAT(p.created_at, '%Y-%m'), MONTH(p.created_at)
                ORDER BY mes_num ASC
            `, [anoFiltro]);

            const [faturamentoAnoAnterior] = await pool.query(`
                SELECT
                    SUM(total) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos_faturados
                WHERE YEAR(data_faturamento) = ?
            `, [anoFiltro - 1]);

            const [faturamentoAnoAtual] = await pool.query(`
                SELECT
                    SUM(total) as valor_total,
                    COUNT(*) as total_pedidos
                FROM pedidos_faturados
                WHERE YEAR(data_faturamento) = ?
            `, [anoFiltro]);

            const [topClientes] = await pool.query(`
                SELECT
                    cliente,
                    COUNT(*) as total_pedidos,
                    SUM(total) as valor_total
                FROM pedidos_faturados
                WHERE YEAR(data_faturamento) = ?
                GROUP BY cliente
                ORDER BY valor_total DESC
                LIMIT 10
            `, [anoFiltro]);

            const totalAtual = faturamentoAnoAtual[0]?.valor_total || 0;
            const totalAnterior = faturamentoAnoAnterior[0]?.valor_total || 0;
            const variacao = totalAnterior > 0 ? ((totalAtual - totalAnterior) / totalAnterior * 100).toFixed(2) : 0;

            res.json({
                success: true,
                faturamento_mensal: faturamentoPF,
                faturamento_pedidos: faturamentoPedidos,
                top_clientes: topClientes,
                resumo: {
                    ano: anoFiltro,
                    valor_total_ano: totalAtual,
                    total_pedidos_ano: faturamentoAnoAtual[0]?.total_pedidos || 0,
                    valor_ano_anterior: totalAnterior,
                    variacao_percentual: `${variacao}%`
                }
            });
        } catch (err) {
            console.error('[PCP_RELATORIOS] Erro faturamento mensal:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao gerar relatório de faturamento mensal.' });
        }
    });

};
