/**
 * Zyntra - Dashboard API Routes
 * Versão: 2026-04-02
 * Rotas para KPIs, Alertas e Métricas do Dashboard Principal
 * AUDIT-FIX: authenticateToken aplicado no mount (routes/index.js)
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
            return res.json({
                vendas: { valor: 'R$ 0,00', trend: '0%', trendUp: true, chart: [] },
                pedidosAbertos: 0,
                aReceber: 'R$ 0,00',
                ordensAtivas: 0
            });
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
            // Faturamento do mês atual — soma das NF-e emitidas/autorizadas no mês
            db.query(`
                SELECT COALESCE(SUM(valor_total), 0) as total
                FROM nfe
                WHERE status IN ('autorizada', 'emitida', 'concluida', 'enviada')
                AND MONTH(COALESCE(data_emissao, created_at)) = MONTH(CURDATE())
                AND YEAR(COALESCE(data_emissao, created_at))  = YEAR(CURDATE())
            `).catch(() => [[{ total: 0 }]]),

            // Mês anterior (para calcular tendência) — faturamento NF-e
            db.query(`
                SELECT COALESCE(SUM(valor_total), 0) as total
                FROM nfe
                WHERE status IN ('autorizada', 'emitida', 'concluida', 'enviada')
                AND MONTH(COALESCE(data_emissao, created_at)) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
                AND YEAR(COALESCE(data_emissao, created_at))  = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
            `).catch(() => [[{ total: 0 }]]),

            // Pedidos de compra em aberto
            db.query(`
                SELECT COUNT(*) as total
                FROM pedidos_compra
                WHERE status IN ('pendente', 'aprovado', 'parcial', 'em_andamento')
            `).catch(() => [[{ total: 0 }]]),

            // Contas a receber com vencimento hoje (ainda em aberto)
            db.query(`
                SELECT COALESCE(SUM(valor), 0) as total
                FROM contas_receber
                WHERE data_vencimento = CURDATE()
                AND status IN ('a_vencer', 'vencida', 'pendente', 'aberto')
            `).catch(() => [[{ total: 0 }]]),

            // BUG-003: Ordens ativas — exclui apenas terminais (alinhado com query do PCP)
            db.query(`
                SELECT COUNT(*) as total
                FROM ordens_producao
                WHERE status NOT IN ('concluida', 'cancelada', 'finalizada', 'Concluída', 'Cancelada', 'Finalizada')
            `).catch(() => [[{ total: 0 }]])
        ]);
        
        // Processar resultados
        let vendasAtual = vendasMes.status === 'fulfilled' ?
            parseFloat(vendasMes.value[0]?.[0]?.total || 0) : 0;
        let vendasAnterior = vendasMesAnterior.status === 'fulfilled' ?
            parseFloat(vendasMesAnterior.value[0]?.[0]?.total || 0) : 0;

        // BUG-014: contas_receber está vazia em produção (sem integração Fat→Fin).
        // Fallback: usa NF-e faturadas no mês como aproximação dos recebimentos.
        // BUG-FIX 2026-06-27: a coluna `valor_total` não existe em `nfe`/`pedidos` no
        // aluforce (só existe `valor`; labor-energy/eletric têm valor_total em `nfe`,
        // mas não em `pedidos`). Referenciar uma coluna inexistente faz a query
        // estourar erro SQL silenciosamente capturado pelo catch, retornando 0 sempre,
        // independente dos dados reais. Tenta `valor_total` primeiro (preserva o
        // comportamento já existente nas instâncias onde a coluna existe) e cai para
        // `valor` quando a coluna não existir.
        if (vendasAtual === 0) {
            try {
                const [[row]] = await db.query(`
                    SELECT COALESCE(SUM(valor_total), 0) as total
                    FROM nfe
                    WHERE status IN ('autorizada', 'emitida', 'concluida', 'enviada')
                      AND MONTH(COALESCE(data_emissao, created_at)) = MONTH(CURDATE())
                      AND YEAR(COALESCE(data_emissao, created_at))  = YEAR(CURDATE())
                `);
                vendasAtual = parseFloat(row?.total || 0);
            } catch (_) {
                try {
                    const [[row]] = await db.query(`
                        SELECT COALESCE(SUM(valor), 0) as total
                        FROM nfe
                        WHERE status IN ('autorizada', 'emitida', 'concluida', 'enviada')
                          AND MONTH(COALESCE(data_emissao, created_at)) = MONTH(CURDATE())
                          AND YEAR(COALESCE(data_emissao, created_at))  = YEAR(CURDATE())
                    `);
                    vendasAtual = parseFloat(row?.total || 0);
                } catch (_) {}
            }
            // Fallback final: pedidos com status faturado/entregue (coluna real é `valor`)
            if (vendasAtual === 0) {
                try {
                    const [[row2]] = await db.query(`
                        SELECT COALESCE(SUM(valor), 0) as total
                        FROM pedidos
                        WHERE status IN ('faturado', 'entregue', 'recibo', 'convertido')
                          AND MONTH(COALESCE(data_faturamento, created_at)) = MONTH(CURDATE())
                          AND YEAR(COALESCE(data_faturamento, created_at))  = YEAR(CURDATE())
                    `);
                    vendasAtual = parseFloat(row2?.total || 0);
                } catch (_) {}
            }
        }
        if (vendasAnterior === 0) {
            try {
                const [[row]] = await db.query(`
                    SELECT COALESCE(SUM(valor_total), 0) as total
                    FROM nfe
                    WHERE status IN ('autorizada', 'emitida', 'concluida', 'enviada')
                      AND MONTH(COALESCE(data_emissao, created_at)) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
                      AND YEAR(COALESCE(data_emissao, created_at))  = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
                `);
                vendasAnterior = parseFloat(row?.total || 0);
            } catch (_) {
                try {
                    const [[row]] = await db.query(`
                        SELECT COALESCE(SUM(valor), 0) as total
                        FROM nfe
                        WHERE status IN ('autorizada', 'emitida', 'concluida', 'enviada')
                          AND MONTH(COALESCE(data_emissao, created_at)) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
                          AND YEAR(COALESCE(data_emissao, created_at))  = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
                    `);
                    vendasAnterior = parseFloat(row?.total || 0);
                } catch (_) {}
            }
        }
        
        // Calcular tendência
        let trendPercent = 0;
        let trendUp = true;
        if (vendasAnterior > 0) {
            trendPercent = Math.round(((vendasAtual - vendasAnterior) / vendasAnterior) * 100);
            trendUp = trendPercent >= 0;
        }
        
        // Dados diários do mês atual para mini-chart
        let chartData = [0, 0, 0, 0, 0, 0, 0];
        try {
            const [dailyRows] = await db.query(`
                SELECT DAY(COALESCE(data_recebimento, data_vencimento)) as dia,
                       COALESCE(SUM(COALESCE(valor_recebido, valor)), 0) as total
                FROM contas_receber
                WHERE status IN ('liquidada', 'pago', 'recebido', 'paga', 'recebida', 'quitada', 'quitado')
                AND MONTH(COALESCE(data_recebimento, data_vencimento)) = MONTH(CURDATE())
                AND YEAR(COALESCE(data_recebimento, data_vencimento)) = YEAR(CURDATE())
                GROUP BY dia
                ORDER BY dia ASC
            `);
            if (dailyRows && dailyRows.length > 0) {
                chartData = dailyRows.map(r => parseFloat(r.total) || 0);
            }
        } catch (e) { /* mantém fallback */ }

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
        res.json({
            vendas: { valor: 'R$ 0,00', trend: '0%', trendUp: true, chart: [] },
            pedidosAbertos: 0,
            aReceber: 'R$ 0,00',
            ordensAtivas: 0
        });
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
            pedidosAprovados,
            pedidosPendentesTotal
        ] = await Promise.allSettled([
            // Contas a pagar vencidas
            db.query(`
                SELECT COUNT(*) as total
                FROM contas_pagar
                WHERE data_vencimento < CURDATE()
                AND status IN ('pendente', 'aberto', 'a_vencer', 'vencida')
            `).catch(() => [[{ total: 0 }]]),

            // Contas a pagar vencendo hoje
            db.query(`
                SELECT COUNT(*) as total
                FROM contas_pagar
                WHERE data_vencimento = CURDATE()
                AND status IN ('pendente', 'aberto', 'a_vencer')
            `).catch(() => [[{ total: 0 }]]),

            // Estoque crítico
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
            `).catch(() => [[{ total: 0 }]]),

            // Pedidos de compra pendentes (campo usado pelo frontend em activity-list)
            db.query(`
                SELECT COUNT(*) as total
                FROM pedidos_compra
                WHERE status IN ('pendente', 'em_andamento', 'parcial')
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
                parseInt(pedidosAprovados.value[0]?.[0]?.total || 0) : 0,
            pedidosPendentes: pedidosPendentesTotal.status === 'fulfilled' ?
                parseInt(pedidosPendentesTotal.value[0]?.[0]?.total || 0) : 0
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

/**
 * GET /api/dashboard/fluxo-financeiro
 * Recebimentos diários do mês atual para o gráfico de fluxo financeiro
 */
router.get('/fluxo-financeiro', async (req, res) => {
    try {
        const db = req.app.locals.pool;
        if (!db) return res.json({ labels: [], recebimentos: [], pagamentos: [] });

        const hoje = new Date();
        const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();

        const [recRows] = await db.query(`
            SELECT DAY(COALESCE(data_recebimento, data_vencimento)) as dia,
                   COALESCE(SUM(COALESCE(valor_recebido, valor)), 0) as total
            FROM contas_receber
            WHERE status IN ('liquidada', 'pago', 'recebido', 'paga', 'recebida', 'quitada', 'quitado')
            AND MONTH(COALESCE(data_recebimento, data_vencimento)) = MONTH(CURDATE())
            AND YEAR(COALESCE(data_recebimento, data_vencimento))  = YEAR(CURDATE())
            GROUP BY dia ORDER BY dia
        `).catch(() => [[]]);

        const [pagRows] = await db.query(`
            SELECT DAY(COALESCE(data_pagamento, data_vencimento)) as dia,
                   COALESCE(SUM(COALESCE(valor_pago, valor)), 0) as total
            FROM contas_pagar
            WHERE status IN ('pago', 'paga', 'liquidada', 'quitada')
            AND MONTH(COALESCE(data_pagamento, data_vencimento)) = MONTH(CURDATE())
            AND YEAR(COALESCE(data_pagamento, data_vencimento))  = YEAR(CURDATE())
            GROUP BY dia ORDER BY dia
        `).catch(() => [[]]);

        const recMap = {};
        recRows.forEach(r => { recMap[r.dia] = parseFloat(r.total) || 0; });
        const pagMap = {};
        pagRows.forEach(r => { pagMap[r.dia] = parseFloat(r.total) || 0; });

        const labels = [], recebimentos = [], pagamentos = [];
        const diaAtual = hoje.getDate();
        for (let d = 1; d <= Math.min(diaAtual, diasNoMes); d++) {
            labels.push(d);
            recebimentos.push(recMap[d] || 0);
            pagamentos.push(pagMap[d] || 0);
        }

        res.json({ labels, recebimentos, pagamentos });
    } catch (e) {
        console.error('Dashboard fluxo-financeiro error:', e);
        res.json({ labels: [], recebimentos: [], pagamentos: [] });
    }
});

/**
 * GET /api/dashboard/pedidos-recentes
 * Últimos pedidos de venda para o widget do dashboard
 */
router.get('/pedidos-recentes', async (req, res) => {
    try {
        const db = req.app.locals.pool;
        if (!db) return res.json([]);

        const [rows] = await db.query(`
            SELECT p.id,
                   COALESCE(p.numero_pedido, CONCAT('#', p.id)) as numero_pedido,
                   p.status,
                   p.created_at,
                   COALESCE(p.valor, 0) as valor_total,
                   COALESCE(c.razao_social, c.nome_fantasia, c.nome, p.cliente_nome, p.cliente, 'Cliente') AS cliente_nome
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            ORDER BY p.id DESC
            LIMIT 8
        `).catch((e) => { console.error('[Dashboard] pedidos-recentes query falhou:', e.message); return [[]]; });
        res.json(rows || []);
    } catch (e) {
        console.error('Dashboard pedidos-recentes error:', e);
        res.json([]);
    }
});

/**
 * GET /api/dashboard/atividade-recente
 * Atividades reais recentes agregadas de múltiplos módulos
 */
router.get('/atividade-recente', async (req, res) => {
    try {
        const db = req.app.locals.pool;
        if (!db) return res.json([]);

        const activities = [];

        // Pedidos recentes (vendas)
        const [pedidos] = await db.query(`
            SELECT 'pedido' as tipo,
                   CONCAT('Pedido #', COALESCE(numero_pedido, id), ' — ',
                          COALESCE(cliente_nome, cliente, 'Cliente')) as descricao,
                   status,
                   COALESCE(created_at, NOW()) as ts
            FROM pedidos
            ORDER BY id DESC LIMIT 3
        `).catch(() => [[]]);

        // NF-e recentes
        const [nfes] = await db.query(`
            SELECT 'nfe' as tipo,
                   CONCAT('NF-e emitida — ', COALESCE(destinatario_nome, numero, '')) as descricao,
                   status,
                   COALESCE(created_at, data_emissao, NOW()) as ts
            FROM nfe
            ORDER BY id DESC LIMIT 3
        `).catch(() => [[]]);

        // Contas a receber recentes
        const [receber] = await db.query(`
            SELECT 'receber' as tipo,
                   CONCAT('Recebimento: R$ ', FORMAT(COALESCE(valor_recebido, valor), 2, 'pt_BR'),
                          ' — ', COALESCE(descricao, cliente_nome, 'Conta')) as descricao,
                   status,
                   COALESCE(data_recebimento, updated_at, created_at, NOW()) as ts
            FROM contas_receber
            WHERE status IN ('liquidada','pago','recebido','paga')
            ORDER BY id DESC LIMIT 2
        `).catch(() => [[]]);

        // Contas pagas recentes
        const [pagar] = await db.query(`
            SELECT 'pagar' as tipo,
                   CONCAT('Pagamento: R$ ', FORMAT(COALESCE(valor_pago, valor), 2, 'pt_BR'),
                          ' — ', COALESCE(descricao, fornecedor_nome, 'Conta')) as descricao,
                   status,
                   COALESCE(data_pagamento, updated_at, created_at, NOW()) as ts
            FROM contas_pagar
            WHERE status IN ('pago','paga','liquidada','quitada')
            ORDER BY id DESC LIMIT 2
        `).catch(() => [[]]);

        const iconMap = {
            pedido:  { icon: 'fa-cart-shopping', color: '#3b82f6',  label: 'Vendas'     },
            nfe:     { icon: 'fa-file-invoice',  color: '#06b6d4',  label: 'Faturamento' },
            receber: { icon: 'fa-arrow-down',    color: '#10b981',  label: 'Financeiro'  },
            pagar:   { icon: 'fa-arrow-up',      color: '#f59e0b',  label: 'Financeiro'  }
        };

        [...(pedidos||[]), ...(nfes||[]), ...(receber||[]), ...(pagar||[])]
            .filter(r => r && r.tipo)
            .forEach(r => {
                const meta = iconMap[r.tipo] || { icon: 'fa-circle', color: '#94a3b8', label: '—' };
                activities.push({
                    icon: meta.icon,
                    color: meta.color,
                    text: r.descricao || '—',
                    modulo: meta.label,
                    ts: r.ts
                });
            });

        // Ordenar por data e retornar os 5 mais recentes
        activities.sort((a, b) => new Date(b.ts) - new Date(a.ts));

        if (activities.length === 0) {
            return res.json([{ icon: 'fa-check', color: '#10b981', text: 'Nenhuma atividade recente', modulo: 'Sistema', ts: null }]);
        }

        res.json(activities.slice(0, 5));
    } catch (e) {
        console.error('Dashboard atividade-recente error:', e);
        res.json([]);
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
        aprovadosHoje: 7,
        pedidosPendentes: 4
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
