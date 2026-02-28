/**
 * ALUFORCE - Dashboard API Routes
 * Versão: 2026-01-18
 * Rotas para KPIs, Alertas e Métricas do Dashboard Principal
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/dashboard/kpis
 * Retorna KPIs executivos do dashboard
 */
router.get('/kpis', async (req, res) => {
    try {
        const db = req.app.locals.pool;
        
        if (!db) {
            return res.json(getSimulatedKPIs());
        }
        
        // Data atual e início do mês
        const hoje = new Date();
        const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        const inicioMesStr = inicioMes.toISOString().split('T')[0];
        const hojeStr = hoje.toISOString().split('T')[0];
        
        // Buscar dados em paralelo com tratamento de erro individual
        const [
            vendasMes,
            vendasMesAnterior,
            pedidosAbertos,
            aReceberHoje,
            ordensAtivas
        ] = await Promise.allSettled([
            // Vendas do mês atual (contas_receber pagas)
            db.query(`
                SELECT COALESCE(SUM(valor), 0) as total 
                FROM contas_receber 
                WHERE status = 'pago'
                AND MONTH(data_vencimento) = MONTH(CURDATE())
                AND YEAR(data_vencimento) = YEAR(CURDATE())
            `).catch(() => [[{ total: 0 }]]),
            
            // Vendas do mês anterior (para comparação)
            db.query(`
                SELECT COALESCE(SUM(valor), 0) as total 
                FROM contas_receber 
                WHERE status = 'pago'
                AND MONTH(data_vencimento) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
                AND YEAR(data_vencimento) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
            `).catch(() => [[{ total: 0 }]]),
            
            // Pedidos de compra em aberto
            db.query(`
                SELECT COUNT(*) as total 
                FROM pedidos_compra 
                WHERE status IN ('pendente', 'aprovado', 'parcial', 'em_andamento')
            `).catch(() => [[{ total: 0 }]]),
            
            // Contas a receber pendentes (valor total)
            db.query(`
                SELECT COALESCE(SUM(valor), 0) as total 
                FROM contas_receber 
                WHERE data_vencimento = CURDATE() 
                AND status IN ('pendente', 'aberto')
            `).catch(() => [[{ total: 0 }]]),
            
            // Ordens de produção ativas
            db.query(`
                SELECT COUNT(*) as total 
                FROM ordens_producao 
                WHERE status IN ('em_producao', 'aguardando', 'planejada', 'Em Produção', 'Aguardando')
            `).catch(() => [[{ total: 0 }]])
        ]);
        
        // Processar resultados
        const vendasAtual = vendasMes.status === 'fulfilled' ? 
            parseFloat(vendasMes.value[0]?.[0]?.total || 0) : 0;
        const vendasAnterior = vendasMesAnterior.status === 'fulfilled' ? 
            parseFloat(vendasMesAnterior.value[0]?.[0]?.total || 0) : 0;
        
        // Calcular tendência
        let trendPercent = 0;
        let trendUp = true;
        if (vendasAnterior > 0) {
            trendPercent = Math.round(((vendasAtual - vendasAnterior) / vendasAnterior) * 100);
            trendUp = trendPercent >= 0;
        }
        
        // Mini chart fallback (dados estáticos por enquanto)
        const chartData = [40, 55, 30, 65, 50, 75, 60];
        
        res.json({
            vendas: {
                valor: formatCurrency(vendasAtual),
                trend: `${trendUp ? '+' : ''}${trendPercent}%`,
                trendUp: trendUp,
                chart: chartData
            },
            pedidosAbertos: pedidosAbertos.status === 'fulfilled' ? 
                parseInt(pedidosAbertos.value[0]?.[0]?.total || 0) : 0,
            aReceber: aReceberHoje.status === 'fulfilled' ? 
                formatCurrency(parseFloat(aReceberHoje.value[0]?.[0]?.total || 0)) : 'R$ 0,00',
            ordensAtivas: ordensAtivas.status === 'fulfilled' ? 
                parseInt(ordensAtivas.value[0]?.[0]?.total || 0) : 0
        });
        
    } catch (error) {
        console.error('Dashboard KPIs Error:', error);
        res.json(getSimulatedKPIs());
    }
});

/**
 * GET /api/dashboard/alerts
 * Retorna alertas e pendências do dashboard
 */
router.get('/alerts', async (req, res) => {
    try {
        const db = req.app.locals.pool;
        
        if (!db) {
            return res.json(getSimulatedAlerts());
        }
        
        const hojeStr = new Date().toISOString().split('T')[0];
        
        // Buscar alertas em paralelo com tratamento de erro individual
        const [
            contasVencidas,
            contasVencerHoje,
            estoqueCritico,
            pedidosAprovados
        ] = await Promise.allSettled([
            // Contas a pagar vencidas (data_vencimento < hoje E status pendente)
            db.query(`
                SELECT COUNT(*) as total 
                FROM contas_pagar 
                WHERE data_vencimento < CURDATE() 
                AND status IN ('pendente', 'aberto')
            `).catch(() => [[{ total: 0 }]]),
            
            // Contas a pagar vencendo hoje
            db.query(`
                SELECT COUNT(*) as total 
                FROM contas_pagar 
                WHERE data_vencimento = CURDATE() 
                AND status IN ('pendente', 'aberto')
            `).catch(() => [[{ total: 0 }]]),
            
            // Estoque crítico - mesma lógica do PCP (produtos com estoque <= mínimo)
            db.query(`
                SELECT COUNT(*) as total 
                FROM produtos 
                WHERE (ativo = 1 OR ativo IS NULL OR status = 'ativo')
                AND (estoque_atual < estoque_minimo OR quantidade_estoque < estoque_minimo)
                AND estoque_minimo > 0
            `).catch(() => [[{ total: 0 }]]),
            
            // Pedidos aprovados hoje
            db.query(`
                SELECT COUNT(*) as total 
                FROM pedidos_compra 
                WHERE DATE(data_aprovacao) = CURDATE() 
                AND status = 'aprovado'
            `).catch(() => [[{ total: 0 }]])
        ]);
        
        res.json({
            vencidos: contasVencidas.status === 'fulfilled' ? 
                parseInt(contasVencidas.value[0]?.[0]?.total || 0) : 0,
            vencerHoje: contasVencerHoje.status === 'fulfilled' ? 
                parseInt(contasVencerHoje.value[0]?.[0]?.total || 0) : 0,
            estoqueCritico: estoqueCritico.status === 'fulfilled' ? 
                parseInt(estoqueCritico.value[0]?.[0]?.total || 0) : 0,
            aprovadosHoje: pedidosAprovados.status === 'fulfilled' ? 
                parseInt(pedidosAprovados.value[0]?.[0]?.total || 0) : 0
        });
        
    } catch (error) {
        console.error('Dashboard Alerts Error:', error);
        res.json(getSimulatedAlerts());
    }
});

/**
 * GET /api/dashboard/modules
 * Retorna contadores para os módulos
 */
router.get('/modules', async (req, res) => {
    console.log('[Dashboard Modules] Requisição recebida');
    try {
        const db = req.app.locals.pool;
        
        if (!db) {
            console.log('[Dashboard Modules] Pool não encontrado, usando dados simulados');
            return res.json(getSimulatedModules());
        }
        
        // Queries otimizadas para cada módulo
        const [
            compras,
            vendas,
            nfe,
            pcp,
            financeiro,
            rh
        ] = await Promise.allSettled([
            // Compras: pedidos de compra pendentes ou em andamento
            db.query(`
                SELECT COUNT(*) as total 
                FROM pedidos_compra 
                WHERE status IN ('pendente', 'aprovado', 'parcial', 'em_andamento')
            `).catch(() => [[{ total: 0 }]]),
            
            // Vendas: orçamentos em aberto (usar pedidos se orcamentos não existir)
            db.query(`
                SELECT COUNT(*) as total 
                FROM pedidos_compra 
                WHERE tipo = 'venda' OR status = 'cotacao'
            `).catch(() => db.query(`
                SELECT COUNT(*) as total FROM pedidos WHERE status IN ('pendente', 'aberto')
            `).catch(() => [[{ total: 0 }]])),
            
            // NF-e: notas pendentes ou rejeitadas
            db.query(`
                SELECT COUNT(*) as total 
                FROM nfe 
                WHERE status IN ('pendente', 'rejeitada')
            `).catch(() => [[{ total: 0 }]]),
            
            // PCP: ordens de produção ativas
            db.query(`
                SELECT COUNT(*) as total 
                FROM ordens_producao 
                WHERE status IN ('em_producao', 'aguardando', 'planejada', 'Em Produção', 'Aguardando', 'Planejada')
            `).catch(() => [[{ total: 0 }]]),
            
            // Financeiro: total de lançamentos abertos (pagar + receber)
            db.query(`
                SELECT 
                    (SELECT COUNT(*) FROM contas_pagar WHERE status IN ('pendente', 'aberto')) +
                    (SELECT COUNT(*) FROM contas_receber WHERE status IN ('pendente', 'aberto')) as total
            `).catch(() => [[{ total: 0 }]]),
            
            // RH: funcionários ativos
            db.query(`
                SELECT COUNT(*) as total 
                FROM funcionarios 
                WHERE ativo = 1 OR status = 'ativo'
            `).catch(() => [[{ total: 0 }]])
        ]);
        
        const result = {
            compras: { count: compras.status === 'fulfilled' ? parseInt(compras.value[0]?.[0]?.total || 0) : 0, label: 'pedidos' },
            vendas: { count: vendas.status === 'fulfilled' ? parseInt(vendas.value[0]?.[0]?.total || 0) : 0, label: 'orçamentos' },
            nfe: { count: nfe.status === 'fulfilled' ? parseInt(nfe.value[0]?.[0]?.total || 0) : 0, label: 'pendentes' },
            pcp: { count: pcp.status === 'fulfilled' ? parseInt(pcp.value[0]?.[0]?.total || 0) : 0, label: 'ordens' },
            financeiro: { count: financeiro.status === 'fulfilled' ? parseInt(financeiro.value[0]?.[0]?.total || 0) : 0, label: 'lançamentos' },
            rh: { count: rh.status === 'fulfilled' ? parseInt(rh.value[0]?.[0]?.total || 0) : 0, label: 'funcionários' }
        };
        
        console.log('[Dashboard Modules] Resultado:', JSON.stringify(result));
        res.json(result);
        
    } catch (error) {
        console.error('Dashboard Modules Error:', error);
        res.json(getSimulatedModules());
    }
});

// === Funções auxiliares ===

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

function getSimulatedKPIs() {
    return {
        vendas: {
            valor: 'R$ 127.450,00',
            trend: '+12%',
            trendUp: true,
            chart: [40, 55, 30, 65, 50, 75, 60]
        },
        pedidosAbertos: 8,
        aReceber: 'R$ 45.320,00',
        ordensAtivas: 12
    };
}

function getSimulatedAlerts() {
    return {
        vencidos: 3,
        vencerHoje: 5,
        estoqueCritico: 2,
        aprovadosHoje: 7
    };
}

function getSimulatedModules() {
    return {
        compras: { count: 8, label: 'pedidos' },
        vendas: { count: 15, label: 'orçamentos' },
        nfe: { count: 3, label: 'pendentes' },
        pcp: { count: 12, label: 'ordens' },
        financeiro: { count: 24, label: 'lançamentos' },
        rh: { count: 47, label: 'funcionários' }
    };
}

module.exports = router;
