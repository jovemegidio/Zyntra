/**
 * Rotas de API - Módulo Financeiro
 * Controle de Contas a Pagar e Contas a Receber com permissões por usuário
 */

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

// JWT_SECRET deve vir OBRIGATORIAMENTE do .env
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ [FINANCEIRO] ERRO FATAL: JWT_SECRET não definido no .env');
    process.exit(1);
}

// Log das variáveis de ambiente para debug
console.log('[Financeiro] Configuração DB:', {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME
});

// Configuração do pool de conexões MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'interchange.proxy.rlwy.net',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
    database: process.env.DB_NAME || 'railway',
    port: parseInt(process.env.DB_PORT) || 19396,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// =====================================================
// MIDDLEWARES DE AUTENTICAÇÍO E AUTORIZAÇÍO
// =====================================================

/**
 * Middleware para verificar autenticação via JWT
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || 
                 req.cookies?.authToken || 
                 req.cookies?.token;
    
    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido' });
        }
        req.user = user;
        next();
    });
}

/**
 * Middleware para controle de acesso ao módulo financeiro
 * Helen, Junior (Eldir) têm acesso TOTAL ao Financeiro
 * Atualizado: 2025-01-10
 */
function authorizeFinanceiro(section) {
    return async (req, res, next) => {
        try {
            const userEmail = req.user?.email?.toLowerCase();
            const userRole = req.user?.role;
            
            console.log(`[FINANCEIRO-AUTH] Verificando: email="${userEmail}", section="${section}"`);
            
            if (!userEmail) {
                return res.status(401).json({ error: 'Usuário não identificado' });
            }

            // Lista de usuários com acesso total ao Financeiro
            const financeiroEmails = [
                // Admins
                'andreia@aluforce.ind.br',
                'andreia.lopes@aluforce.ind.br',
                'douglas@aluforce.ind.br',
                'douglas.moreira@aluforce.ind.br',
                'ti@aluforce.ind.br',
                // Equipe Financeiro - ACESSO TOTAL
                'hellen@aluforce.ind.br',
                'hellen.nascimento@aluforce.ind.br',
                'helen@aluforce.ind.br',
                'helen.nascimento@aluforce.ind.br',
                'junior@aluforce.ind.br',
                'eldir@aluforce.ind.br',
                'eldir.junior@aluforce.ind.br'
            ];

            const isAdmin = userRole === 'admin';
            const hasFinanceiroAccess = financeiroEmails.includes(userEmail);

            if (isAdmin || hasFinanceiroAccess) {
                console.log(`[FINANCEIRO-AUTH] ✅ Acesso concedido para ${userEmail}`);
                req.userAccess = 'admin';
                return next();
            }

            // Consultoria tem acesso de visualização a todos os módulos
            if (userRole === 'consultoria') {
                console.log(`[FINANCEIRO-AUTH] ✅ Acesso consultoria para ${userEmail}`);
                req.userAccess = 'consultoria';
                req.canEdit = false;
                req.canCreate = false;
                req.canDelete = false;
                return next();
            }

            // Outros usuários não autorizados
            console.log(`[FINANCEIRO-AUTH] ❌ Acesso negado para ${userEmail}`);
            
            // Mensagens específicas por seção
            const sectionMessages = {
                'pagar': 'Contas a Pagar',
                'receber': 'Contas a Receber',
                'bancos': 'Contas Bancárias',
                'config': 'Configurações Financeiras',
                'dashboard': 'o Dashboard Financeiro'
            };
            const sectionName = sectionMessages[section] || 'o módulo financeiro';
            
            return res.status(403).json({ 
                error: `Acesso negado. Você não tem permissão para acessar ${sectionName}.` 
            });
        } catch (error) {
            console.error('[Financeiro] Erro no middleware de autorização:', error);
            return res.status(500).json({ error: 'Erro ao verificar permissões' });
        }
    };
}

// =====================================================
// FUNÇÕES DE VALIDAÇÁO - Prioridade 2 QA
// =====================================================

/**
 * Valida se um valor é numérico positivo
 */
function isValidNumber(value) {
    const num = parseFloat(value);
    return !isNaN(num) && num >= 0;
}

/**
 * Valida formato de data (YYYY-MM-DD ou ISO 8601)
 */
function isValidDate(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date);
}

/**
 * Sanitiza strings removendo caracteres perigosos
 */
function sanitizeString(str) {
    if (!str) return '';
    return String(str).trim().replace(/[<>]/g, '');
}

/**
 * Validação completa para contas a receber/pagar
 */
function validateContaInput(data, tipo = 'receber') {
    const errors = [];
    
    // Campos obrigatórios
    if (!data.descricao || data.descricao.trim() === '') {
        errors.push('Descrição é obrigatória');
    }
    
    // Validação de valor
    if (data.valor === undefined || data.valor === null || data.valor === '') {
        errors.push('Valor é obrigatório');
    } else if (!isValidNumber(data.valor)) {
        errors.push('Valor deve ser um número válido maior ou igual a zero');
    } else if (parseFloat(data.valor) <= 0) {
        errors.push('Valor deve ser maior que zero');
    }
    
    // Validação de data de vencimento
    const vencimento = data.vencimento || data.data_vencimento;
    if (!vencimento) {
        errors.push('Data de vencimento é obrigatória');
    } else if (!isValidDate(vencimento)) {
        errors.push('Data de vencimento inválida. Use o formato YYYY-MM-DD');
    }
    
    // Validação específica por tipo
    if (tipo === 'receber' && !data.cliente) {
        errors.push('Cliente é obrigatório para contas a receber');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

// =====================================================
// ROTAS - DASHBOARD
// =====================================================

/**
 * Middleware de autenticação opcional (para rotas de resumo)
 * Se houver token, valida e adiciona user. Se não houver, continua sem user.
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || 
                 req.cookies?.authToken || 
                 req.cookies?.token;
    
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (!err) {
                req.user = user;
            }
            next();
        });
    } else {
        next();
    }
}

/**
 * GET /api/financeiro/resumo-kpis
 * Rota pública para KPIs básicos do dashboard financeiro
 * Retorna apenas totais sem detalhes sensíveis
 */
router.get('/resumo-kpis', optionalAuth, async (req, res) => {
    try {
        console.log('[Financeiro] Buscando resumo KPIs...');
        
        // Total a receber
        const [receberTotal] = await pool.execute(`
            SELECT 
                COALESCE(SUM(valor), 0) as total,
                COUNT(*) as quantidade
            FROM contas_receber 
            WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
        `);
        
        // Total a pagar
        const [pagarTotal] = await pool.execute(`
            SELECT 
                COALESCE(SUM(valor), 0) as total,
                COUNT(*) as quantidade
            FROM contas_pagar 
            WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
        `);
        
        // Vencidos
        const [vencidosReceber] = await pool.execute(`
            SELECT COUNT(*) as quantidade
            FROM contas_receber 
            WHERE COALESCE(data_vencimento, vencimento) < CURDATE()
            AND status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
        `);
        
        const [vencidosPagar] = await pool.execute(`
            SELECT COUNT(*) as quantidade
            FROM contas_pagar 
            WHERE COALESCE(data_vencimento, vencimento) < CURDATE()
            AND status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
        `);
        
        const totalReceber = parseFloat(receberTotal[0]?.total || 0);
        const totalPagar = parseFloat(pagarTotal[0]?.total || 0);
        const saldo = totalReceber - totalPagar;
        const totalVencidos = (vencidosReceber[0]?.quantidade || 0) + (vencidosPagar[0]?.quantidade || 0);
        
        console.log('[Financeiro] KPIs:', { totalReceber, totalPagar, saldo, totalVencidos });
        
        res.json({
            success: true,
            data: {
                totalReceber,
                totalPagar,
                saldo,
                vencidos: totalVencidos,
                quantidadeReceber: receberTotal[0]?.quantidade || 0,
                quantidadePagar: pagarTotal[0]?.quantidade || 0
            }
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar resumo KPIs:', error);
        res.status(500).json({ error: 'Erro ao buscar resumo' });
    }
});

/**
 * GET /api/financeiro/proximos-vencimentos
 * Rota para vencimentos próximos - com autenticação opcional
 */
router.get('/proximos-vencimentos', optionalAuth, async (req, res) => {
    try {
        const limite = parseInt(req.query.limite) || 5;
        
        // Buscar próximos vencimentos de contas a receber
        const [receber] = await pool.query(`
            SELECT 
                cr.id,
                'receber' as tipo,
                COALESCE(c.nome_fantasia, c.razao_social, cr.descricao, 'N/D') as descricao,
                cr.valor,
                COALESCE(cr.data_vencimento, cr.vencimento) as data_vencimento,
                cr.status
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            WHERE cr.status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            ORDER BY COALESCE(cr.data_vencimento, cr.vencimento) ASC
            LIMIT ${limite}
        `);
        
        // Buscar próximos vencimentos de contas a pagar
        const [pagar] = await pool.query(`
            SELECT 
                cp.id,
                'pagar' as tipo,
                COALESCE(f.nome_fantasia, f.razao_social, f.nome, cp.descricao, 'N/D') as descricao,
                cp.valor,
                COALESCE(cp.data_vencimento, cp.vencimento) as data_vencimento,
                cp.status
            FROM contas_pagar cp
            LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
            WHERE cp.status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            ORDER BY COALESCE(cp.data_vencimento, cp.vencimento) ASC
            LIMIT ${limite}
        `);
        
        // Combinar e ordenar por data
        const todas = [...receber, ...pagar]
            .sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento))
            .slice(0, limite);
        
        res.json({ success: true, data: todas });
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar vencimentos:', error);
        res.status(500).json({ error: 'Erro ao buscar vencimentos' });
    }
});

/**
 * GET /api/financeiro/ultimos-lancamentos
 * Rota para lançamentos recentes - com autenticação opcional
 */
router.get('/ultimos-lancamentos', optionalAuth, async (req, res) => {
    try {
        const limite = parseInt(req.query.limite) || 10;
        
        // Buscar últimos lançamentos de receber
        const [receber] = await pool.query(`
            SELECT 
                cr.id,
                'Receber' as tipo,
                COALESCE(c.nome_fantasia, c.razao_social, cr.descricao, 'N/D') as descricao,
                cr.valor,
                COALESCE(cr.data_vencimento, cr.vencimento) as data_vencimento,
                cr.status,
                cr.data_criacao
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            ORDER BY cr.data_criacao DESC
            LIMIT ${limite}
        `);
        
        // Buscar últimos lançamentos de pagar
        const [pagar] = await pool.query(`
            SELECT 
                cp.id,
                'Pagar' as tipo,
                COALESCE(f.nome_fantasia, f.razao_social, f.nome, cp.descricao, 'N/D') as descricao,
                cp.valor,
                COALESCE(cp.data_vencimento, cp.vencimento) as data_vencimento,
                cp.status,
                cp.data_criacao
            FROM contas_pagar cp
            LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
            ORDER BY cp.data_criacao DESC
            LIMIT ${limite}
        `);
        
        // Combinar e ordenar por data de criação
        const todas = [...receber, ...pagar]
            .sort((a, b) => new Date(b.data_criacao || b.data_vencimento) - new Date(a.data_criacao || a.data_vencimento))
            .slice(0, limite);
        
        res.json({ success: true, data: todas });
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar lançamentos:', error);
        res.status(500).json({ error: 'Erro ao buscar lançamentos' });
    }
});

/**
 * GET /api/financeiro/fluxo-caixa-resumo
 * Rota pública para fluxo de caixa (com autenticação opcional)
 */
router.get('/fluxo-caixa-resumo', optionalAuth, async (req, res) => {
    try {
        console.log('[Financeiro] Buscando fluxo de caixa...');
        
        const { dataInicio, dataFim, periodo } = req.query;
        
        // Definir período baseado no parâmetro
        let inicio, fim;
        const hoje = new Date();
        
        switch(periodo) {
            case '7d':
                inicio = new Date(hoje);
                inicio.setDate(inicio.getDate() - 7);
                fim = new Date(hoje);
                fim.setDate(fim.getDate() + 30);
                break;
            case '30d':
            default:
                inicio = new Date(hoje);
                inicio.setDate(inicio.getDate() - 30);
                fim = new Date(hoje);
                fim.setDate(fim.getDate() + 60);
                break;
            case '90d':
                inicio = new Date(hoje);
                inicio.setDate(inicio.getDate() - 90);
                fim = new Date(hoje);
                fim.setDate(fim.getDate() + 90);
                break;
        }
        
        const inicioStr = dataInicio || inicio.toISOString().split('T')[0];
        const fimStr = dataFim || fim.toISOString().split('T')[0];

        // Saldo inicial das contas bancárias
        const [saldoInicial] = await pool.execute(
            'SELECT COALESCE(SUM(saldo_atual), 0) as saldo FROM contas_bancarias WHERE ativo = 1'
        );

        // Contas a receber projetadas
        const [receber] = await pool.execute(`
            SELECT 
                DATE(COALESCE(data_vencimento, vencimento)) as data,
                SUM(valor - COALESCE(valor_recebido, 0)) as valor,
                'entrada' as tipo,
                COUNT(*) as quantidade,
                GROUP_CONCAT(DISTINCT COALESCE(c.nome_fantasia, c.razao_social, 'Cliente') SEPARATOR ', ') as descricao
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            WHERE cr.status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
              AND COALESCE(cr.data_vencimento, cr.vencimento) BETWEEN ? AND ?
            GROUP BY DATE(COALESCE(cr.data_vencimento, cr.vencimento))
            ORDER BY data
        `, [inicioStr, fimStr]);

        // Contas a pagar projetadas
        const [pagar] = await pool.execute(`
            SELECT 
                DATE(COALESCE(data_vencimento, vencimento)) as data,
                SUM(valor - COALESCE(valor_pago, 0)) as valor,
                'saida' as tipo,
                COUNT(*) as quantidade,
                GROUP_CONCAT(DISTINCT COALESCE(f.nome_fantasia, f.nome, 'Fornecedor') SEPARATOR ', ') as descricao
            FROM contas_pagar cp
            LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
            WHERE cp.status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
              AND COALESCE(cp.data_vencimento, cp.vencimento) BETWEEN ? AND ?
            GROUP BY DATE(COALESCE(cp.data_vencimento, cp.vencimento))
            ORDER BY data
        `, [inicioStr, fimStr]);

        // Montar fluxo de caixa diário
        const fluxoDiario = {};
        let saldoAcumulado = parseFloat(saldoInicial[0]?.saldo) || 0;

        // Processar projetados
        receber.forEach(r => {
            if (!r.data) return;
            const data = r.data.toISOString ? r.data.toISOString().split('T')[0] : r.data;
            if (!fluxoDiario[data]) fluxoDiario[data] = { data, entradas: 0, saidas: 0, saldo: 0, detalhes: [] };
            fluxoDiario[data].entradas += parseFloat(r.valor) || 0;
            fluxoDiario[data].detalhes.push({ tipo: 'entrada', valor: parseFloat(r.valor), descricao: r.descricao, quantidade: r.quantidade });
        });

        pagar.forEach(p => {
            if (!p.data) return;
            const data = p.data.toISOString ? p.data.toISOString().split('T')[0] : p.data;
            if (!fluxoDiario[data]) fluxoDiario[data] = { data, entradas: 0, saidas: 0, saldo: 0, detalhes: [] };
            fluxoDiario[data].saidas += parseFloat(p.valor) || 0;
            fluxoDiario[data].detalhes.push({ tipo: 'saida', valor: parseFloat(p.valor), descricao: p.descricao, quantidade: p.quantidade });
        });

        // Ordenar e calcular saldo acumulado
        const fluxoArray = Object.values(fluxoDiario).sort((a, b) => a.data.localeCompare(b.data));
        fluxoArray.forEach(dia => {
            saldoAcumulado += dia.entradas - dia.saidas;
            dia.saldo = saldoAcumulado;
        });

        // Lista de movimentações detalhadas
        const [movimentacoesReceber] = await pool.execute(`
            SELECT 
                'entrada' as tipo,
                COALESCE(c.nome_fantasia, c.razao_social, cr.descricao, 'Recebimento') as descricao,
                COALESCE(cat.nome, 'Vendas') as categoria,
                cr.valor,
                COALESCE(cr.data_vencimento, cr.vencimento) as data,
                cr.status
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            LEFT JOIN categorias_financeiro cat ON cr.categoria_id = cat.id
            WHERE COALESCE(cr.data_vencimento, cr.vencimento) BETWEEN ? AND ?
            ORDER BY COALESCE(cr.data_vencimento, cr.vencimento) DESC
            LIMIT 50
        `, [inicioStr, fimStr]);

        const [movimentacoesPagar] = await pool.execute(`
            SELECT 
                'saida' as tipo,
                COALESCE(f.nome_fantasia, f.nome, cp.descricao, 'Pagamento') as descricao,
                COALESCE(cat.nome, 'Fornecedores') as categoria,
                cp.valor,
                COALESCE(cp.data_vencimento, cp.vencimento) as data,
                cp.status
            FROM contas_pagar cp
            LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
            LEFT JOIN categorias_financeiro cat ON cp.categoria_id = cat.id
            WHERE COALESCE(cp.data_vencimento, cp.vencimento) BETWEEN ? AND ?
            ORDER BY COALESCE(cp.data_vencimento, cp.vencimento) DESC
            LIMIT 50
        `, [inicioStr, fimStr]);

        // Projeções futuras
        const hojeStr = new Date().toISOString().split('T')[0];
        const projecoes = [...movimentacoesReceber, ...movimentacoesPagar]
            .filter(m => m.data && m.data >= hojeStr && m.status !== 'pago')
            .sort((a, b) => new Date(a.data) - new Date(b.data))
            .slice(0, 10);

        // Totais
        const totalReceber = receber.reduce((acc, r) => acc + (parseFloat(r.valor) || 0), 0);
        const totalPagar = pagar.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
        const saldoInicialNum = parseFloat(saldoInicial[0]?.saldo) || 0;

        console.log('[Financeiro] Fluxo de caixa:', { 
            saldoInicial: saldoInicialNum, 
            totalReceber, 
            totalPagar, 
            diasComMovimento: fluxoArray.length 
        });

        res.json({
            success: true,
            saldoInicial: saldoInicialNum,
            totalReceber,
            totalPagar,
            saldoProjetado: saldoInicialNum + totalReceber - totalPagar,
            fluxoDiario: fluxoArray,
            movimentacoes: [...movimentacoesReceber, ...movimentacoesPagar]
                .sort((a, b) => new Date(b.data) - new Date(a.data))
                .slice(0, 30),
            projecoes,
            periodo: { inicio: inicioStr, fim: fimStr }
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao gerar fluxo de caixa:', error);
        res.status(500).json({ error: 'Erro ao gerar fluxo de caixa' });
    }
});

/**
 * GET /api/financeiro/conciliacao-resumo
 * Rota para conciliação bancária (com autenticação opcional)
 */
router.get('/conciliacao-resumo', optionalAuth, async (req, res) => {
    try {
        console.log('[Financeiro] Buscando dados de conciliação...');
        
        // Buscar contas bancárias
        const [contas] = await pool.execute(`
            SELECT 
                id, banco, agencia, conta, tipo, saldo_atual, ativo,
                DATE_FORMAT(updated_at, '%d/%m/%Y') as ultima_atualizacao
            FROM contas_bancarias 
            WHERE ativo = 1
            ORDER BY banco
        `);

        // Calcular totais por status
        const [pendentes] = await pool.execute(`
            SELECT 
                'receber' as tipo,
                COUNT(*) as quantidade,
                COALESCE(SUM(valor), 0) as total
            FROM contas_receber
            WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            UNION ALL
            SELECT 
                'pagar' as tipo,
                COUNT(*) as quantidade,
                COALESCE(SUM(valor), 0) as total
            FROM contas_pagar
            WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
        `);

        // Movimentações recentes para conciliar
        const [movimentacoes] = await pool.execute(`
            (SELECT 
                'entrada' as tipo,
                cr.id,
                COALESCE(c.nome_fantasia, c.razao_social, cr.descricao, 'Recebimento') as descricao,
                cr.valor,
                COALESCE(cr.data_vencimento, cr.vencimento) as data,
                cr.status,
                'contas_receber' as tabela
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            WHERE cr.status IN ('pendente', 'parcial')
            ORDER BY COALESCE(cr.data_vencimento, cr.vencimento) ASC
            LIMIT 20)
            UNION ALL
            (SELECT 
                'saida' as tipo,
                cp.id,
                COALESCE(f.nome_fantasia, f.nome, cp.descricao, 'Pagamento') as descricao,
                cp.valor,
                COALESCE(cp.data_vencimento, cp.vencimento) as data,
                cp.status,
                'contas_pagar' as tabela
            FROM contas_pagar cp
            LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
            WHERE cp.status IN ('pendente', 'parcial')
            ORDER BY COALESCE(cp.data_vencimento, cp.vencimento) ASC
            LIMIT 20)
            ORDER BY data ASC
            LIMIT 30
        `);

        // Saldo total das contas
        const saldoTotal = contas.reduce((acc, c) => acc + (parseFloat(c.saldo_atual) || 0), 0);
        
        // Pendentes
        const pendenteReceber = pendentes.find(p => p.tipo === 'receber') || { quantidade: 0, total: 0 };
        const pendentePagar = pendentes.find(p => p.tipo === 'pagar') || { quantidade: 0, total: 0 };

        res.json({
            success: true,
            contas,
            saldoTotal,
            pendentes: {
                receber: { quantidade: pendenteReceber.quantidade, total: parseFloat(pendenteReceber.total) },
                pagar: { quantidade: pendentePagar.quantidade, total: parseFloat(pendentePagar.total) }
            },
            movimentacoes,
            totalItensParaConciliar: movimentacoes.length
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar conciliação:', error);
        res.status(500).json({ error: 'Erro ao buscar dados de conciliação' });
    }
});
/**
 * GET /api/financeiro/dashboard
 * Retorna estatísticas do dashboard baseado nas permissões do usuário
 */
router.get('/dashboard', authenticateToken, authorizeFinanceiro('dashboard'), async (req, res) => {
    try {
        const userAccess = req.userAccess;
        const today = new Date().toISOString().split('T')[0];

        let result = {
            saldoAtual: 0,
            aReceber: 0,
            aPagar: 0,
            vencendoHoje: 0,
            ultimasTransacoes: []
        };

        // Admins veem tudo
        if (userAccess === 'admin') {
            const [receber] = await pool.execute(
                'SELECT SUM(valor) as total FROM contas_receber WHERE status = "PENDENTE"'
            );
            const [pagar] = await pool.execute(
                'SELECT SUM(valor) as total FROM contas_pagar WHERE status = "PENDENTE"'
            );
            const [vencendoHojeReceber] = await pool.execute(
                'SELECT COUNT(*) as count FROM contas_receber WHERE DATE(vencimento) = ? AND status = "PENDENTE"',
                [today]
            );
            const [vencendoHojePagar] = await pool.execute(
                'SELECT COUNT(*) as count FROM contas_pagar WHERE DATE(vencimento) = ? AND status = "PENDENTE"',
                [today]
            );

            result.aReceber = receber[0]?.total || 0;
            result.aPagar = pagar[0]?.total || 0;
            result.saldoAtual = result.aReceber - result.aPagar;
            result.vencendoHoje = (vencendoHojeReceber[0]?.count || 0) + (vencendoHojePagar[0]?.count || 0);

            // Últimas transações (ambas tabelas)
            const [transacoesReceber] = await pool.execute(
                'SELECT "Receber" as tipo, cliente_id as referencia, descricao, valor, vencimento, status FROM contas_receber ORDER BY data_criacao DESC LIMIT 5'
            );
            const [transacoesPagar] = await pool.execute(
                'SELECT "Pagar" as tipo, fornecedor_id as referencia, descricao, valor, vencimento, status FROM contas_pagar ORDER BY data_criacao DESC LIMIT 5'
            );
            result.ultimasTransacoes = [...transacoesReceber, ...transacoesPagar]
                .sort((a, b) => new Date(b.vencimento) - new Date(a.vencimento))
                .slice(0, 10);
        }
        // Júnior vê apenas contas a receber
        else if (userAccess === 'receber') {
            const [receber] = await pool.execute(
                'SELECT SUM(valor) as total FROM contas_receber WHERE status = "PENDENTE"'
            );
            const [vencendoHoje] = await pool.execute(
                'SELECT COUNT(*) as count FROM contas_receber WHERE DATE(vencimento) = ? AND status = "PENDENTE"',
                [today]
            );
            const [transacoes] = await pool.execute(
                'SELECT "Receber" as tipo, cliente as referencia, descricao, valor, vencimento, status FROM contas_receber ORDER BY data_criacao DESC LIMIT 10'
            );

            result.aReceber = receber[0]?.total || 0;
            result.saldoAtual = result.aReceber;
            result.vencendoHoje = vencendoHoje[0]?.count || 0;
            result.ultimasTransacoes = transacoes;
        }
        // Hellen vê apenas contas a pagar
        else if (userAccess === 'pagar') {
            const [pagar] = await pool.execute(
                'SELECT SUM(valor) as total FROM contas_pagar WHERE status = "PENDENTE"'
            );
            const [vencendoHoje] = await pool.execute(
                'SELECT COUNT(*) as count FROM contas_pagar WHERE DATE(vencimento) = ? AND status = "PENDENTE"',
                [today]
            );
            const [transacoes] = await pool.execute(
                'SELECT "Pagar" as tipo, fornecedor as referencia, descricao, valor, vencimento, status FROM contas_pagar ORDER BY data_criacao DESC LIMIT 10'
            );

            result.aPagar = pagar[0]?.total || 0;
            result.saldoAtual = -result.aPagar;
            result.vencendoHoje = vencendoHoje[0]?.count || 0;
            result.ultimasTransacoes = transacoes;
        }

        res.json(result);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar dashboard:', error);
        res.status(500).json({ error: 'Erro ao buscar dados do dashboard' });
    }
});

// =====================================================
// ROTAS - CONTAS A RECEBER
// =====================================================

/**
 * GET /api/financeiro/contas-receber
 * Lista todas as contas a receber
 */
router.get('/contas-receber', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const { status, dataInicio, dataFim, limite } = req.query;
        let query = `
            SELECT 
                cr.id,
                cr.cliente_id,
                COALESCE(c.nome_fantasia, c.razao_social, cr.descricao, 'N/D') as cliente_nome,
                c.cnpj_cpf as cnpj_cpf,
                cr.valor,
                cr.valor as valor_total,
                cr.descricao,
                cr.status,
                cr.vencimento,
                cr.data_vencimento,
                cr.data_criacao,
                cr.categoria_id,
                cat.nome as categoria,
                cr.banco_id as conta_bancaria,
                cr.forma_recebimento,
                cr.observacoes,
                cr.parcela_numero,
                cr.total_parcelas,
                cr.valor_recebido,
                cr.data_recebimento,
                cr.pedido_id,
                cr.venda_id,
                DATE_FORMAT(cr.data_vencimento, '%Y-%m') as competencia,
                cr.observacoes as numero_documento,
                '' as centro_receita,
                3 as dias_lembrete,
                NULL as recorrencia
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            LEFT JOIN categorias_financeiro cat ON cr.categoria_id = cat.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND cr.status = ?';
            params.push(status);
        }

        if (dataInicio) {
            query += ' AND COALESCE(cr.data_vencimento, cr.vencimento) >= ?';
            params.push(dataInicio);
        }

        if (dataFim) {
            query += ' AND COALESCE(cr.data_vencimento, cr.vencimento) <= ?';
            params.push(dataFim);
        }

        query += ' ORDER BY COALESCE(cr.data_vencimento, cr.vencimento) ASC';
        
        if (limite) {
            query += ` LIMIT ${parseInt(limite)}`;
        }

        const [rows] = await pool.execute(query, params);
        res.json({ success: true, data: rows, total: rows.length });
    } catch (error) {
        console.error('[Financeiro] Erro ao listar contas a receber:', error);
        res.status(500).json({ error: 'Erro ao listar contas a receber' });
    }
});

/**
 * GET /api/financeiro/contas-receber/estatisticas
 * Retorna estatísticas das contas a receber para os KPIs
 */
router.get('/contas-receber/estatisticas', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const hoje = new Date().toISOString().split('T')[0];
        const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const fimMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];
        
        // Total a receber (pendentes)
        const [totalReceber] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as total_receber
            FROM contas_receber 
            WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
        `);
        
        // Vencendo em 7 dias
        const [vencendo] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as vencendo
            FROM contas_receber 
            WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            AND COALESCE(data_vencimento, vencimento) BETWEEN ? AND DATE_ADD(?, INTERVAL 7 DAY)
        `, [hoje, hoje]);
        
        // Vencidas
        const [vencidas] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as vencidas
            FROM contas_receber 
            WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            AND COALESCE(data_vencimento, vencimento) < ?
        `, [hoje]);
        
        // Recebidas no mês atual
        const [recebidasMes] = await pool.execute(`
            SELECT COALESCE(SUM(valor_recebido), 0) as recebidas_mes
            FROM contas_receber 
            WHERE status IN ('recebido', 'recebida', 'RECEBIDO', 'RECEBIDA')
            AND data_recebimento BETWEEN ? AND ?
        `, [inicioMes, fimMes]);
        
        res.json({
            success: true,
            total_receber: parseFloat(totalReceber[0]?.total_receber || 0),
            vencendo: parseFloat(vencendo[0]?.vencendo || 0),
            vencidas: parseFloat(vencidas[0]?.vencidas || 0),
            recebidas_mes: parseFloat(recebidasMes[0]?.recebidas_mes || 0)
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar estatísticas de contas a receber:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

/**
 * GET /api/financeiro/contas-receber/:id
 * Busca uma conta a receber específica
 */
router.get('/contas-receber/:id', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute('SELECT * FROM contas_receber WHERE id = ?', [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao buscar conta' });
    }
});

/**
 * POST /api/financeiro/contas-receber
 * Cria uma nova conta a receber - Com validações robustas
 */
router.post('/contas-receber', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const { cliente, descricao, valor, vencimento, tipo } = req.body;

        // Validação robusta dos dados de entrada
        const validation = validateContaInput({ cliente, descricao, valor, vencimento }, 'receber');
        if (!validation.isValid) {
            return res.status(400).json({ 
                error: 'Dados inválidos',
                details: validation.errors 
            });
        }

        // Sanitizar strings e converter tipos
        const descricaoSanitizada = sanitizeString(descricao);
        const valorNumerico = parseFloat(valor);
        const dataVencimento = new Date(vencimento).toISOString().split('T')[0];

        const [result] = await pool.execute(
            'INSERT INTO contas_receber (cliente, descricao, valor, vencimento, status, tipo, data_criacao) VALUES (?, ?, ?, ?, "PENDENTE", ?, NOW())',
            [sanitizeString(cliente), descricaoSanitizada, valorNumerico, dataVencimento, tipo || 'VENDA']
        );

        res.status(201).json({ 
            message: 'Conta a receber criada com sucesso',
            id: result.insertId 
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao criar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao criar conta' });
    }
});

/**
 * PUT /api/financeiro/contas-receber/:id
 * Atualiza uma conta a receber
 */
router.put('/contas-receber/:id', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const { id } = req.params;
        const { cliente, descricao, valor, vencimento, status, tipo } = req.body;

        const [result] = await pool.execute(
            'UPDATE contas_receber SET cliente = ?, descricao = ?, valor = ?, vencimento = ?, status = ?, tipo = ? WHERE id = ?',
            [cliente, descricao, valor, vencimento, status, tipo, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        // Se a conta foi paga, registrar data de pagamento
        if (status === 'PAGO') {
            await pool.execute(
                'UPDATE contas_receber SET data_pagamento = NOW() WHERE id = ?',
                [id]
            );
        }

        res.json({ message: 'Conta atualizada com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao atualizar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao atualizar conta' });
    }
});

/**
 * DELETE /api/financeiro/contas-receber/:id
 * Remove uma conta a receber (Soft Delete para auditoria)
 */
router.delete('/contas-receber/:id', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar se a conta existe e seu status
        const [conta] = await pool.execute('SELECT * FROM contas_receber WHERE id = ?', [id]);
        if (conta.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        
        // Não permitir exclusão de contas já pagas
        if (conta[0].status === 'PAGO' || conta[0].status === 'pago') {
            return res.status(400).json({ 
                error: 'Não é possível excluir uma conta já paga. Use o estorno primeiro.' 
            });
        }
        
        // Soft delete: marcar como cancelado ao invés de deletar
        const [result] = await pool.execute(
            `UPDATE contas_receber 
             SET status = 'CANCELADO', 
                 deleted_at = NOW(),
                 deleted_by = ?,
                 observacoes = CONCAT(COALESCE(observacoes, ''), ' [CANCELADO] Excluído por ', ?, ' em ', NOW())
             WHERE id = ?`,
            [req.user?.email || 'sistema', req.user?.email || 'sistema', id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        res.json({ message: 'Conta removida com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao remover conta a receber:', error);
        res.status(500).json({ error: 'Erro ao remover conta' });
    }
});

// =====================================================
// ROTAS - CONTAS A PAGAR
// =====================================================

/**
 * GET /api/financeiro/contas-pagar
 * Lista todas as contas a pagar
 */
router.get('/contas-pagar', authenticateToken, authorizeFinanceiro('pagar'), async (req, res) => {
    try {
        const { status, dataInicio, dataFim, limite } = req.query;
        let query = `
            SELECT 
                cp.id,
                cp.fornecedor_id,
                COALESCE(f.nome, f.razao_social, cp.cnpj_cpf, 'N/D') as fornecedor_nome,
                COALESCE(f.cnpj, cp.cnpj_cpf) as fornecedor_cnpj,
                cp.valor,
                cp.valor as valor_total,
                cp.descricao,
                cp.status,
                cp.vencimento,
                cp.data_vencimento,
                COALESCE(cp.data_vencimento_original, cp.data_vencimento, cp.vencimento) as data_vencimento_original,
                cp.data_criacao,
                cp.categoria_id,
                cat.nome as categoria,
                cp.banco_id as conta_bancaria_id,
                cp.forma_pagamento,
                cp.observacoes,
                cp.parcela_numero,
                cp.total_parcelas,
                cp.valor_pago,
                cp.data_recebimento as data_pagamento,
                cp.pedido_compra_id,
                cp.cnpj_cpf as numero_documento,
                COALESCE(cp.minha_empresa_nome_fantasia, '') as centro_custo,
                DATE_FORMAT(cp.data_vencimento, '%Y-%m') as competencia
            FROM contas_pagar cp
            LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
            LEFT JOIN categorias_financeiro cat ON cp.categoria_id = cat.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND cp.status = ?';
            params.push(status);
        }

        if (dataInicio) {
            query += ' AND COALESCE(cp.data_vencimento, cp.vencimento) >= ?';
            params.push(dataInicio);
        }

        if (dataFim) {
            query += ' AND COALESCE(cp.data_vencimento, cp.vencimento) <= ?';
            params.push(dataFim);
        }

        query += ' ORDER BY COALESCE(cp.data_vencimento, cp.vencimento) ASC';
        
        if (limite) {
            query += ` LIMIT ${parseInt(limite)}`;
        }

        const [rows] = await pool.execute(query, params);
        res.json({ success: true, data: rows, total: rows.length });
    } catch (error) {
        console.error('[Financeiro] Erro ao listar contas a pagar:', error);
        res.status(500).json({ error: 'Erro ao listar contas a pagar' });
    }
});

/**
 * GET /api/financeiro/contas-pagar/estatisticas
 * Retorna estatísticas das contas a pagar para os KPIs
 */
router.get('/contas-pagar/estatisticas', authenticateToken, authorizeFinanceiro('pagar'), async (req, res) => {
    try {
        const hoje = new Date().toISOString().split('T')[0];
        const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const fimMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];
        
        // Total a pagar (pendentes)
        const [totalPagar] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as total_pagar
            FROM contas_pagar 
            WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
        `);
        
        // Vencendo em 7 dias
        const [vencendo] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as vencendo
            FROM contas_pagar 
            WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            AND COALESCE(data_vencimento, vencimento) BETWEEN ? AND DATE_ADD(?, INTERVAL 7 DAY)
        `, [hoje, hoje]);
        
        // Vencidas
        const [vencidas] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as vencidas
            FROM contas_pagar 
            WHERE status IN ('pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            AND COALESCE(data_vencimento, vencimento) < ?
        `, [hoje]);
        
        // Pagas no mês atual
        const [pagasMes] = await pool.execute(`
            SELECT COALESCE(SUM(valor_pago), 0) as pagas_mes
            FROM contas_pagar 
            WHERE status = 'pago'
            AND data_recebimento BETWEEN ? AND ?
        `, [inicioMes, fimMes]);
        
        res.json({
            success: true,
            total_pagar: parseFloat(totalPagar[0]?.total_pagar || 0),
            vencendo: parseFloat(vencendo[0]?.vencendo || 0),
            vencidas: parseFloat(vencidas[0]?.vencidas || 0),
            pagas_mes: parseFloat(pagasMes[0]?.pagas_mes || 0)
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar estatísticas de contas a pagar:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

/**
 * GET /api/financeiro/contas-pagar/:id
 * Busca uma conta a pagar específica
 */
router.get('/contas-pagar/:id', authenticateToken, authorizeFinanceiro('pagar'), async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute('SELECT * FROM contas_pagar WHERE id = ?', [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar conta a pagar:', error);
        res.status(500).json({ error: 'Erro ao buscar conta' });
    }
});

/**
 * POST /api/financeiro/contas-pagar
 * Cria uma nova conta a pagar - Com validações robustas
 */
router.post('/contas-pagar', authenticateToken, authorizeFinanceiro('pagar'), async (req, res) => {
    try {
        const { fornecedor_id, fornecedor, descricao, valor, vencimento, data_vencimento, data_vencimento_original, categoria_id, banco_id, forma_pagamento, observacoes, numero_documento, valor_total, categoria } = req.body;

        // Aceitar tanto 'vencimento' quanto 'data_vencimento'
        const dataVenc = data_vencimento || vencimento;
        const dataVencOriginal = data_vencimento_original || dataVenc;
        const valorFinal = valor_total || valor;

        // Validação robusta dos dados de entrada
        const validation = validateContaInput({ descricao: descricao || fornecedor, valor: valorFinal, vencimento: dataVencOriginal }, 'pagar');
        if (!validation.isValid) {
            return res.status(400).json({ 
                error: 'Dados inválidos',
                details: validation.errors 
            });
        }

        // Sanitizar strings e converter tipos
        const descricaoSanitizada = sanitizeString(descricao || fornecedor);
        const valorNumerico = parseFloat(valorFinal);
        const dataVencimento = new Date(dataVenc).toISOString().split('T')[0];
        const dataVencimentoOriginal = new Date(dataVencOriginal).toISOString().split('T')[0];
        const obsSanitizada = sanitizeString(observacoes);

        const [result] = await pool.execute(
            `INSERT INTO contas_pagar (fornecedor_id, descricao, valor, data_vencimento, data_vencimento_original, categoria_id, categoria, banco_id, forma_pagamento, observacoes, numero_documento, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "pendente")`,
            [fornecedor_id || null, descricaoSanitizada, valorNumerico, dataVencimento, dataVencimentoOriginal, categoria_id || null, categoria || null, banco_id || null, forma_pagamento || null, obsSanitizada || null, numero_documento || null]
        );

        res.status(201).json({ 
            message: 'Conta a pagar criada com sucesso',
            id: result.insertId 
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao criar conta a pagar:', error);
        res.status(500).json({ error: 'Erro ao criar conta' });
    }
});

/**
 * PUT /api/financeiro/contas-pagar/:id
 * Atualiza uma conta a pagar
 */
router.put('/contas-pagar/:id', authenticateToken, authorizeFinanceiro('pagar'), async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            fornecedor, descricao, valor, vencimento, data_vencimento, data_vencimento_original,
            status, tipo, categoria, numero_documento, observacoes, forma_pagamento, valor_total
        } = req.body;

        const dataVenc = data_vencimento || vencimento;
        const valorFinal = valor_total || valor;
        
        // Build dynamic update query
        const updates = [];
        const params = [];
        
        if (fornecedor !== undefined) { updates.push('fornecedor = ?'); params.push(fornecedor); }
        if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }
        if (valorFinal !== undefined) { updates.push('valor = ?'); params.push(valorFinal); }
        if (dataVenc !== undefined) { updates.push('data_vencimento = ?'); params.push(dataVenc); }
        if (data_vencimento_original !== undefined) { updates.push('data_vencimento_original = ?'); params.push(data_vencimento_original); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }
        if (tipo !== undefined) { updates.push('tipo = ?'); params.push(tipo); }
        if (categoria !== undefined) { updates.push('categoria = ?'); params.push(categoria); }
        if (numero_documento !== undefined) { updates.push('numero_documento = ?'); params.push(numero_documento); }
        if (observacoes !== undefined) { updates.push('observacoes = ?'); params.push(observacoes); }
        if (forma_pagamento !== undefined) { updates.push('forma_pagamento = ?'); params.push(forma_pagamento); }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nenhum campo para atualizar' });
        }
        
        params.push(id);
        const [result] = await pool.execute(
            `UPDATE contas_pagar SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        // Se a conta foi paga, registrar data de pagamento
        if (status === 'PAGO' || status === 'pago') {
            await pool.execute(
                'UPDATE contas_pagar SET data_pagamento = NOW() WHERE id = ?',
                [id]
            );
        }

        res.json({ message: 'Conta atualizada com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao atualizar conta a pagar:', error);
        res.status(500).json({ error: 'Erro ao atualizar conta' });
    }
});

/**
 * DELETE /api/financeiro/contas-pagar/:id
 * Remove uma conta a pagar (Soft Delete para auditoria)
 */
router.delete('/contas-pagar/:id', authenticateToken, authorizeFinanceiro('pagar'), async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar se a conta existe e seu status
        const [conta] = await pool.execute('SELECT * FROM contas_pagar WHERE id = ?', [id]);
        if (conta.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        
        // Não permitir exclusão de contas já pagas
        if (conta[0].status === 'pago' || conta[0].status === 'PAGO') {
            return res.status(400).json({ 
                error: 'Não é possível excluir uma conta já paga. Use o estorno primeiro.' 
            });
        }
        
        // Soft delete: marcar como cancelado ao invés de deletar
        const [result] = await pool.execute(
            `UPDATE contas_pagar 
             SET status = 'cancelado', 
                 deleted_at = NOW(),
                 deleted_by = ?,
                 observacoes = CONCAT(COALESCE(observacoes, ''), ' [CANCELADO] Excluído por ', ?, ' em ', NOW())
             WHERE id = ?`,
            [req.user?.email || 'sistema', req.user?.email || 'sistema', id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        res.json({ message: 'Conta removida com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao remover conta a pagar:', error);
        res.status(500).json({ error: 'Erro ao remover conta' });
    }
});

// =====================================================
// ROTAS - CONTAS BANCÁRIAS
// =====================================================

/**
 * GET /api/financeiro/contas-bancarias
 * Lista todas as contas bancárias
 * [SEGURANÇA] Adicionado authorizeFinanceiro - 2026-01-21
 */
router.get('/contas-bancarias', authenticateToken, authorizeFinanceiro('bancos'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT id, nome, banco, tipo, agencia, conta as numero_conta, 
                   saldo_atual as saldo, observacoes, ativo as ativa, created_at
            FROM contas_bancarias 
            ORDER BY nome
        `);
        
        res.json(rows);
    } catch (error) {
        console.error('[Financeiro] Erro ao listar contas bancárias:', error);
        res.status(500).json({ error: 'Erro ao carregar contas bancárias' });
    }
});

/**
 * POST /api/financeiro/contas-bancarias
 * Cria uma nova conta bancária
 * [SEGURANÇA] Adicionado authorizeFinanceiro - 2026-01-21
 */
router.post('/contas-bancarias', authenticateToken, authorizeFinanceiro('bancos'), async (req, res) => {
    try {
        const { nome, banco, tipo, agencia, numero_conta, saldo, observacoes } = req.body;
        
        const [result] = await pool.query(
            `INSERT INTO contas_bancarias (nome, banco, tipo, agencia, conta, saldo_inicial, saldo_atual, observacoes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [nome, banco, tipo || 'corrente', agencia, numero_conta, saldo || 0, saldo || 0, observacoes]
        );
        
        res.status(201).json({ id: result.insertId, message: 'Conta bancária criada com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao criar conta bancária:', error);
        res.status(500).json({ error: 'Erro ao criar conta bancária' });
    }
});

/**
 * PUT /api/financeiro/contas-bancarias/:id
 * Atualiza uma conta bancária
 * [SEGURANÇA] Adicionado authorizeFinanceiro - 2026-01-21
 */
router.put('/contas-bancarias/:id', authenticateToken, authorizeFinanceiro('bancos'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, banco, tipo, agencia, numero_conta, saldo, observacoes, ativa } = req.body;
        
        await pool.query(
            `UPDATE contas_bancarias 
             SET nome = ?, banco = ?, tipo = ?, agencia = ?, conta = ?, 
                 saldo_atual = ?, observacoes = ?, ativo = ?
             WHERE id = ?`,
            [nome, banco, tipo, agencia, numero_conta, saldo, observacoes, ativa, id]
        );
        
        res.json({ message: 'Conta bancária atualizada com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao atualizar conta bancária:', error);
        res.status(500).json({ error: 'Erro ao atualizar conta bancária' });
    }
});

/**
 * DELETE /api/financeiro/contas-bancarias/:id
 * Remove uma conta bancária
 * [SEGURANÇA] Adicionado authorizeFinanceiro - 2026-01-21
 */
router.delete('/contas-bancarias/:id', authenticateToken, authorizeFinanceiro('bancos'), async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await pool.query('DELETE FROM contas_bancarias WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Conta bancária não encontrada' });
        }
        
        res.json({ message: 'Conta bancária removida com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao remover conta bancária:', error);
        res.status(500).json({ error: 'Erro ao remover conta bancária' });
    }
});

// =====================================================
// ROTAS - BAIXA DE CONTAS
// =====================================================

/**
 * POST /api/financeiro/contas-pagar/:id/baixa
 * Registra baixa (pagamento) de conta a pagar - COM TRANSAÇÁO
 */
router.post('/contas-pagar/:id/baixa', authenticateToken, authorizeFinanceiro('pagar'), async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { id } = req.params;
        const { 
            valor_pago, 
            data_pagamento, 
            forma_pagamento, 
            conta_bancaria_id, 
            observacoes,
            baixa_parcial
        } = req.body;

        // Buscar conta atual
        const [conta] = await connection.execute('SELECT * FROM contas_pagar WHERE id = ? FOR UPDATE', [id]);
        if (conta.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        const contaAtual = conta[0];
        const valorOriginal = parseFloat(contaAtual.valor) || 0;
        const valorJaPago = parseFloat(contaAtual.valor_pago) || 0;
        const valorBaixa = parseFloat(valor_pago) || valorOriginal;
        const novoValorPago = valorJaPago + valorBaixa;

        // Determinar novo status
        let novoStatus = 'pago';
        if (baixa_parcial || novoValorPago < valorOriginal) {
            novoStatus = 'parcial';
        }

        // Atualizar conta (dentro da transação)
        await connection.execute(
            `UPDATE contas_pagar 
             SET valor_pago = ?,
                 status = ?,
                 data_recebimento = ?,
                 forma_pagamento = ?,
                 banco_id = ?,
                 observacoes = CONCAT(COALESCE(observacoes, ''), '[BAIXA] ', ?)
             WHERE id = ?`,
            [novoValorPago, novoStatus, data_pagamento || new Date(), forma_pagamento, conta_bancaria_id, observacoes || '', id]
        );

        // Registrar movimentação bancária se tiver conta (dentro da transação)
        if (conta_bancaria_id) {
            await connection.execute(
                `UPDATE contas_bancarias SET saldo_atual = saldo_atual - ? WHERE id = ?`,
                [valorBaixa, conta_bancaria_id]
            );
        }

        // Commit da transação - todas as operações são atômicas
        await connection.commit();

        res.json({ 
            success: true,
            message: `Baixa registrada com sucesso. Status: ${novoStatus}`,
            valor_pago: novoValorPago,
            status: novoStatus
        });
    } catch (error) {
        await connection.rollback();
        console.error('[Financeiro] Erro ao registrar baixa:', error);
        res.status(500).json({ error: 'Erro ao registrar baixa' });
    } finally {
        connection.release();
    }
});

/**
 * POST /api/financeiro/contas-receber/:id/baixa
 * Registra baixa (recebimento) de conta a receber - COM TRANSAÇÁO
 */
router.post('/contas-receber/:id/baixa', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { id } = req.params;
        const { 
            valor_recebido, 
            data_recebimento, 
            forma_recebimento, 
            conta_bancaria_id, 
            observacoes,
            baixa_parcial
        } = req.body;

        // Buscar conta atual com lock
        const [conta] = await connection.execute('SELECT * FROM contas_receber WHERE id = ? FOR UPDATE', [id]);
        if (conta.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        const contaAtual = conta[0];
        const valorOriginal = parseFloat(contaAtual.valor) || 0;
        const valorJaRecebido = parseFloat(contaAtual.valor_recebido) || 0;
        const valorBaixa = parseFloat(valor_recebido) || valorOriginal;
        const novoValorRecebido = valorJaRecebido + valorBaixa;

        // Determinar novo status
        let novoStatus = 'pago';
        if (baixa_parcial || novoValorRecebido < valorOriginal) {
            novoStatus = 'parcial';
        }

        // Atualizar conta (dentro da transação)
        await connection.execute(
            `UPDATE contas_receber 
             SET valor_recebido = ?,
                 status = ?,
                 data_recebimento = ?,
                 forma_recebimento = ?,
                 banco_id = ?,
                 observacoes = CONCAT(COALESCE(observacoes, ''), '[BAIXA] ', ?)
             WHERE id = ?`,
            [novoValorRecebido, novoStatus, data_recebimento || new Date(), forma_recebimento, conta_bancaria_id, observacoes || '', id]
        );

        // Registrar movimentação bancária se tiver conta (dentro da transação)
        if (conta_bancaria_id) {
            await connection.execute(
                `UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?`,
                [valorBaixa, conta_bancaria_id]
            );
        }

        // Commit da transação
        await connection.commit();

        res.json({ 
            success: true,
            message: `Recebimento registrado com sucesso. Status: ${novoStatus}`,
            valor_recebido: novoValorRecebido,
            status: novoStatus
        });
    } catch (error) {
        await connection.rollback();
        console.error('[Financeiro] Erro ao registrar recebimento:', error);
        res.status(500).json({ error: 'Erro ao registrar recebimento' });
    } finally {
        connection.release();
    }
});

/**
 * POST /api/financeiro/contas-pagar/:id/estornar
 * Estorna baixa de conta a pagar - COM TRANSAÇÁO
 */
router.post('/contas-pagar/:id/estornar', authenticateToken, authorizeFinanceiro('pagar'), async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { id } = req.params;
        
        const [conta] = await connection.execute('SELECT * FROM contas_pagar WHERE id = ? FOR UPDATE', [id]);
        if (conta.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        const contaAtual = conta[0];
        const valorPago = parseFloat(contaAtual.valor_pago) || 0;
        const contaBancaria = contaAtual.banco_id;

        // Estornar na conta bancária (dentro da transação)
        if (contaBancaria && valorPago > 0) {
            await connection.execute(
                `UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?`,
                [valorPago, contaBancaria]
            );
        }

        // Resetar conta (dentro da transação)
        await connection.execute(
            `UPDATE contas_pagar 
             SET valor_pago = 0,
                 status = 'pendente',
                 data_recebimento = NULL,
                 observacoes = CONCAT(COALESCE(observacoes, ''), '[ESTORNO] Baixa estornada em ', NOW())
             WHERE id = ?`,
            [id]
        );

        await connection.commit();
        res.json({ success: true, message: 'Baixa estornada com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('[Financeiro] Erro ao estornar:', error);
        res.status(500).json({ error: 'Erro ao estornar' });
    } finally {
        connection.release();
    }
});

/**
 * POST /api/financeiro/contas-receber/:id/estornar
 * Estorna recebimento de conta a receber - COM TRANSAÇÁO
 */
router.post('/contas-receber/:id/estornar', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { id } = req.params;
        
        const [conta] = await connection.execute('SELECT * FROM contas_receber WHERE id = ? FOR UPDATE', [id]);
        if (conta.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        const contaAtual = conta[0];
        const valorRecebido = parseFloat(contaAtual.valor_recebido) || 0;
        const contaBancaria = contaAtual.banco_id;

        // Estornar na conta bancária (dentro da transação)
        if (contaBancaria && valorRecebido > 0) {
            await connection.execute(
                `UPDATE contas_bancarias SET saldo_atual = saldo_atual - ? WHERE id = ?`,
                [valorRecebido, contaBancaria]
            );
        }

        // Resetar conta (dentro da transação)
        await connection.execute(
            `UPDATE contas_receber 
             SET valor_recebido = 0,
                 status = 'pendente',
                 data_recebimento = NULL,
                 observacoes = CONCAT(COALESCE(observacoes, ''), '[ESTORNO] Recebimento estornado em ', NOW())
             WHERE id = ?`,
            [id]
        );

        await connection.commit();
        res.json({ success: true, message: 'Recebimento estornado com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('[Financeiro] Erro ao estornar:', error);
        res.status(500).json({ error: 'Erro ao estornar' });
    } finally {
        connection.release();
    }
});

// =====================================================
// ROTAS - FLUXO DE CAIXA
// =====================================================

/**
 * GET /api/financeiro/fluxo-caixa
 * Retorna o fluxo de caixa projetado e realizado
 */
router.get('/fluxo-caixa', authenticateToken, async (req, res) => {
    try {
        const { dataInicio, dataFim, tipo } = req.query;
        
        // Data padrão: próximos 30 dias
        const inicio = dataInicio || new Date().toISOString().split('T')[0];
        const fim = dataFim || new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];

        // Saldo inicial das contas bancárias
        const [saldoInicial] = await pool.execute(
            'SELECT COALESCE(SUM(saldo_atual), 0) as saldo FROM contas_bancarias WHERE ativo = 1'
        );

        // Contas a receber projetadas
        const [receber] = await pool.execute(`
            SELECT 
                DATE(COALESCE(data_vencimento, vencimento)) as data,
                SUM(valor - COALESCE(valor_recebido, 0)) as valor,
                'receber' as tipo,
                COUNT(*) as quantidade
            FROM contas_receber 
            WHERE status IN ('pendente', 'parcial')
              AND COALESCE(data_vencimento, vencimento) BETWEEN ? AND ?
            GROUP BY DATE(COALESCE(data_vencimento, vencimento))
            ORDER BY data
        `, [inicio, fim]);

        // Contas a pagar projetadas
        const [pagar] = await pool.execute(`
            SELECT 
                DATE(COALESCE(data_vencimento, vencimento)) as data,
                SUM(valor - COALESCE(valor_pago, 0)) as valor,
                'pagar' as tipo,
                COUNT(*) as quantidade
            FROM contas_pagar 
            WHERE status IN ('pendente', 'parcial')
              AND COALESCE(data_vencimento, vencimento) BETWEEN ? AND ?
            GROUP BY DATE(COALESCE(data_vencimento, vencimento))
            ORDER BY data
        `, [inicio, fim]);

        // Movimentações realizadas (baixas)
        const [realizadoReceber] = await pool.execute(`
            SELECT 
                DATE(data_recebimento) as data,
                SUM(valor_recebido) as valor,
                'recebido' as tipo
            FROM contas_receber 
            WHERE status IN ('pago', 'parcial')
              AND data_recebimento BETWEEN ? AND ?
            GROUP BY DATE(data_recebimento)
        `, [inicio, fim]);

        const [realizadoPagar] = await pool.execute(`
            SELECT 
                DATE(data_recebimento) as data,
                SUM(valor_pago) as valor,
                'pago' as tipo
            FROM contas_pagar 
            WHERE status IN ('pago', 'parcial')
              AND data_recebimento BETWEEN ? AND ?
            GROUP BY DATE(data_recebimento)
        `, [inicio, fim]);

        // Montar fluxo de caixa diário
        const fluxoDiario = {};
        let saldoAcumulado = parseFloat(saldoInicial[0]?.saldo) || 0;

        // Processar projetados
        receber.forEach(r => {
            const data = r.data.toISOString().split('T')[0];
            if (!fluxoDiario[data]) fluxoDiario[data] = { data, entradas: 0, saidas: 0, saldo: 0 };
            fluxoDiario[data].entradas += parseFloat(r.valor) || 0;
        });

        pagar.forEach(p => {
            const data = p.data.toISOString().split('T')[0];
            if (!fluxoDiario[data]) fluxoDiario[data] = { data, entradas: 0, saidas: 0, saldo: 0 };
            fluxoDiario[data].saidas += parseFloat(p.valor) || 0;
        });

        // Ordenar e calcular saldo acumulado
        const fluxoArray = Object.values(fluxoDiario).sort((a, b) => a.data.localeCompare(b.data));
        fluxoArray.forEach(dia => {
            saldoAcumulado += dia.entradas - dia.saidas;
            dia.saldo = saldoAcumulado;
        });

        // Totais
        const totalReceber = receber.reduce((acc, r) => acc + (parseFloat(r.valor) || 0), 0);
        const totalPagar = pagar.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);

        res.json({
            success: true,
            saldoInicial: parseFloat(saldoInicial[0]?.saldo) || 0,
            totalReceber,
            totalPagar,
            saldoProjetado: (parseFloat(saldoInicial[0]?.saldo) || 0) + totalReceber - totalPagar,
            fluxoDiario: fluxoArray,
            periodo: { inicio, fim }
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao gerar fluxo de caixa:', error);
        res.status(500).json({ error: 'Erro ao gerar fluxo de caixa' });
    }
});

// =====================================================
// ROTAS - DRE (Demonstrativo de Resultados)
// =====================================================

/**
 * GET /api/financeiro/dre
 * Retorna o DRE do período
 */
router.get('/dre', authenticateToken, async (req, res) => {
    try {
        const { mes, ano } = req.query;
        const mesAtual = mes || new Date().getMonth() + 1;
        const anoAtual = ano || new Date().getFullYear();
        
        const dataInicio = `${anoAtual}-${String(mesAtual).padStart(2, '0')}-01`;
        const dataFim = new Date(anoAtual, mesAtual, 0).toISOString().split('T')[0];

        // Receitas por categoria
        const [receitas] = await pool.execute(`
            SELECT 
                COALESCE(cat.nome, 'Sem Categoria') as categoria,
                SUM(cr.valor_recebido) as valor
            FROM contas_receber cr
            LEFT JOIN categorias_financeiro cat ON cr.categoria_id = cat.id
            WHERE cr.status = 'pago' 
              AND cr.data_recebimento BETWEEN ? AND ?
            GROUP BY cat.nome
            ORDER BY valor DESC
        `, [dataInicio, dataFim]);

        // Despesas por categoria
        const [despesas] = await pool.execute(`
            SELECT 
                COALESCE(cat.nome, 'Sem Categoria') as categoria,
                SUM(cp.valor_pago) as valor
            FROM contas_pagar cp
            LEFT JOIN categorias_financeiro cat ON cp.categoria_id = cat.id
            WHERE cp.status = 'pago' 
              AND cp.data_recebimento BETWEEN ? AND ?
            GROUP BY cat.nome
            ORDER BY valor DESC
        `, [dataInicio, dataFim]);

        // Totais
        const totalReceitas = receitas.reduce((acc, r) => acc + (parseFloat(r.valor) || 0), 0);
        const totalDespesas = despesas.reduce((acc, d) => acc + (parseFloat(d.valor) || 0), 0);
        const resultado = totalReceitas - totalDespesas;

        res.json({
            success: true,
            periodo: { mes: mesAtual, ano: anoAtual, dataInicio, dataFim },
            receitas: {
                categorias: receitas,
                total: totalReceitas
            },
            despesas: {
                categorias: despesas,
                total: totalDespesas
            },
            resultado: {
                valor: resultado,
                tipo: resultado >= 0 ? 'lucro' : 'prejuizo',
                percentual: totalReceitas > 0 ? ((resultado / totalReceitas) * 100).toFixed(2) : 0
            }
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao gerar DRE:', error);
        res.status(500).json({ error: 'Erro ao gerar DRE' });
    }
});

// =====================================================
// ROTAS - RELATÓRIOS AVANÇADOS
// =====================================================

/**
 * GET /api/financeiro/relatorios/vencimentos
 * Relatório de contas vencidas e a vencer
 */
router.get('/relatorios/vencimentos', authenticateToken, async (req, res) => {
    try {
        const hoje = new Date().toISOString().split('T')[0];

        // Contas a pagar vencidas
        const [pagarVencidas] = await pool.execute(`
            SELECT 
                id, descricao, valor, 
                COALESCE(data_vencimento, vencimento) as vencimento,
                DATEDIFF(?, COALESCE(data_vencimento, vencimento)) as dias_atraso,
                'pagar' as tipo
            FROM contas_pagar 
            WHERE status = 'pendente' 
              AND COALESCE(data_vencimento, vencimento) < ?
            ORDER BY vencimento
        `, [hoje, hoje]);

        // Contas a receber vencidas
        const [receberVencidas] = await pool.execute(`
            SELECT 
                id, descricao, valor,
                COALESCE(data_vencimento, vencimento) as vencimento,
                DATEDIFF(?, COALESCE(data_vencimento, vencimento)) as dias_atraso,
                'receber' as tipo
            FROM contas_receber 
            WHERE status = 'pendente' 
              AND COALESCE(data_vencimento, vencimento) < ?
            ORDER BY vencimento
        `, [hoje, hoje]);

        // Contas vencendo nos próximos 7 dias
        const em7dias = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];
        
        const [pagarProximas] = await pool.execute(`
            SELECT id, descricao, valor, COALESCE(data_vencimento, vencimento) as vencimento, 'pagar' as tipo
            FROM contas_pagar 
            WHERE status = 'pendente' 
              AND COALESCE(data_vencimento, vencimento) BETWEEN ? AND ?
            ORDER BY vencimento
        `, [hoje, em7dias]);

        const [receberProximas] = await pool.execute(`
            SELECT id, descricao, valor, COALESCE(data_vencimento, vencimento) as vencimento, 'receber' as tipo
            FROM contas_receber 
            WHERE status = 'pendente' 
              AND COALESCE(data_vencimento, vencimento) BETWEEN ? AND ?
            ORDER BY vencimento
        `, [hoje, em7dias]);

        res.json({
            success: true,
            vencidas: {
                pagar: pagarVencidas,
                receber: receberVencidas,
                totalPagar: pagarVencidas.reduce((acc, c) => acc + (parseFloat(c.valor) || 0), 0),
                totalReceber: receberVencidas.reduce((acc, c) => acc + (parseFloat(c.valor) || 0), 0)
            },
            proximas7dias: {
                pagar: pagarProximas,
                receber: receberProximas,
                totalPagar: pagarProximas.reduce((acc, c) => acc + (parseFloat(c.valor) || 0), 0),
                totalReceber: receberProximas.reduce((acc, c) => acc + (parseFloat(c.valor) || 0), 0)
            }
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao gerar relatório:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório' });
    }
});

/**
 * GET /api/financeiro/relatorios/por-fornecedor
 * Relatório de contas agrupadas por fornecedor
 */
router.get('/relatorios/por-fornecedor', authenticateToken, async (req, res) => {
    try {
        const [resultado] = await pool.execute(`
            SELECT 
                COALESCE(f.razao_social, f.nome, cp.cnpj_cpf, 'Não Identificado') as fornecedor,
                COUNT(*) as quantidade,
                SUM(cp.valor) as total,
                SUM(CASE WHEN cp.status = 'pendente' THEN cp.valor ELSE 0 END) as pendente,
                SUM(CASE WHEN cp.status = 'pago' THEN cp.valor ELSE 0 END) as pago
            FROM contas_pagar cp
            LEFT JOIN fornecedores_financeiro f ON cp.fornecedor_id = f.id
            GROUP BY fornecedor
            ORDER BY total DESC
            LIMIT 50
        `);

        res.json({ success: true, data: resultado });
    } catch (error) {
        console.error('[Financeiro] Erro ao gerar relatório:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório' });
    }
});

/**
 * GET /api/financeiro/relatorios/por-cliente
 * Relatório de contas agrupadas por cliente
 */
router.get('/relatorios/por-cliente', authenticateToken, async (req, res) => {
    try {
        const [resultado] = await pool.execute(`
            SELECT 
                COALESCE(c.razao_social, c.nome_fantasia, cr.descricao, 'Não Identificado') as cliente,
                COUNT(*) as quantidade,
                SUM(cr.valor) as total,
                SUM(CASE WHEN cr.status = 'pendente' THEN cr.valor ELSE 0 END) as pendente,
                SUM(CASE WHEN cr.status = 'pago' THEN cr.valor ELSE 0 END) as recebido
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            GROUP BY cliente
            ORDER BY total DESC
            LIMIT 50
        `);

        res.json({ success: true, data: resultado });
    } catch (error) {
        console.error('[Financeiro] Erro ao gerar relatório:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório' });
    }
});

/**
 * GET /api/financeiro/categorias
 * Lista categorias financeiras
 */
router.get('/categorias', authenticateToken, async (req, res) => {
    try {
        const [categorias] = await pool.execute(`
            SELECT id, nome, tipo 
            FROM categorias_financeiro 
            ORDER BY tipo, nome
        `);
        res.json({ success: true, data: categorias });
    } catch (error) {
        console.error('[Financeiro] Erro ao listar categorias:', error);
        res.status(500).json({ error: 'Erro ao listar categorias' });
    }
});

/**
 * POST /api/financeiro/categorias
 * Cria nova categoria
 */
router.post('/categorias', authenticateToken, async (req, res) => {
    try {
        const { nome, tipo } = req.body;
        const [result] = await pool.execute(
            'INSERT INTO categorias_financeiro (nome, tipo) VALUES (?, ?)',
            [nome, tipo || 'despesa']
        );
        res.status(201).json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('[Financeiro] Erro ao criar categoria:', error);
        res.status(500).json({ error: 'Erro ao criar categoria' });
    }
});

/**
 * GET /api/financeiro/permissoes
 * Retorna permissões do usuário no módulo financeiro
 */
router.get('/permissoes', authenticateToken, async (req, res) => {
    try {
        const userEmail = req.user?.email?.toLowerCase();
        const userRole = req.user?.role;

        // Admins têm acesso total
        const adminEmails = [
            'andreia@aluforce.ind.br',
            'douglas@aluforce.ind.br',
            'ti@aluforce.ind.br',
            'fernando@aluforce.ind.br'
        ];

        const isAdmin = adminEmails.includes(userEmail) || userRole === 'admin';

        if (isAdmin) {
            return res.json({
                contas_pagar: { visualizar: true, criar: true, editar: true, excluir: true },
                contas_receber: { visualizar: true, criar: true, editar: true, excluir: true },
                fluxo_caixa: { visualizar: true },
                dre: { visualizar: true },
                relatorios: { visualizar: true }
            });
        }

        // Controle específico
        if (userEmail === 'junior@aluforce.ind.br') {
            return res.json({
                contas_pagar: { visualizar: false, criar: false, editar: false, excluir: false },
                contas_receber: { visualizar: true, criar: true, editar: true, excluir: false },
                fluxo_caixa: { visualizar: true },
                dre: { visualizar: false },
                relatorios: { visualizar: true }
            });
        }

        if (userEmail === 'hellen@aluforce.ind.br') {
            return res.json({
                contas_pagar: { visualizar: true, criar: true, editar: true, excluir: false },
                contas_receber: { visualizar: false, criar: false, editar: false, excluir: false },
                fluxo_caixa: { visualizar: true },
                dre: { visualizar: false },
                relatorios: { visualizar: true }
            });
        }

        // Padrão: acesso limitado
        res.json({
            contas_pagar: { visualizar: true, criar: false, editar: false, excluir: false },
            contas_receber: { visualizar: true, criar: false, editar: false, excluir: false },
            fluxo_caixa: { visualizar: true },
            dre: { visualizar: false },
            relatorios: { visualizar: true }
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar permissões:', error);
        res.status(500).json({ error: 'Erro ao buscar permissões' });
    }
});

// =====================================================
// CENTROS DE CUSTO
// [SEGURANÇA] Rotas protegidas com authorizeFinanceiro - 2026-01-21
// =====================================================

// Listar centros de custo
router.get('/centros-custo', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM centros_custo ORDER BY nome
        `);
        res.json(rows);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar centros de custo:', error);
        // Retorna array vazio se tabela não existir ou erro de coluna
        if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR') {
            return res.json([]);
        }
        res.status(500).json({ error: 'Erro ao buscar centros de custo' });
    }
});

// Criar centro de custo
router.post('/centros-custo', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { codigo, nome, departamento, responsavel_id, orcamento, ativo } = req.body;
        const [result] = await pool.query(
            `INSERT INTO centros_custo (codigo, nome, departamento, responsavel_id, orcamento, ativo, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [codigo, nome, departamento, responsavel_id || null, orcamento || 0, ativo !== false ? 1 : 0]
        );
        res.json({ id: result.insertId, message: 'Centro de custo criado com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao criar centro de custo:', error);
        res.status(500).json({ error: 'Erro ao criar centro de custo' });
    }
});

// Atualizar centro de custo
router.put('/centros-custo/:id', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { id } = req.params;
        const { codigo, nome, departamento, responsavel_id, orcamento, ativo } = req.body;
        await pool.query(
            `UPDATE centros_custo SET codigo=?, nome=?, departamento=?, responsavel_id=?, orcamento=?, ativo=?, updated_at=NOW() WHERE id=?`,
            [codigo, nome, departamento, responsavel_id || null, orcamento || 0, ativo ? 1 : 0, id]
        );
        res.json({ message: 'Centro de custo atualizado com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao atualizar centro de custo:', error);
        res.status(500).json({ error: 'Erro ao atualizar centro de custo' });
    }
});

// Excluir centro de custo
router.delete('/centros-custo/:id', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM centros_custo WHERE id = ?', [id]);
        res.json({ message: 'Centro de custo excluído com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao excluir centro de custo:', error);
        res.status(500).json({ error: 'Erro ao excluir centro de custo' });
    }
});

// =====================================================
// PLANO DE CONTAS
// [SEGURANÇA] Rotas protegidas com authorizeFinanceiro - 2026-01-21
// =====================================================

// Listar plano de contas
router.get('/plano-contas', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM plano_contas ORDER BY codigo
        `);
        res.json(rows);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar plano de contas:', error);
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json([]);
        }
        res.status(500).json({ error: 'Erro ao buscar plano de contas' });
    }
});

// Criar conta no plano
router.post('/plano-contas', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { codigo, nome, tipo, pai_id, cor, ativo } = req.body;
        const [result] = await pool.query(
            `INSERT INTO plano_contas (codigo, nome, tipo, pai_id, cor, ativo, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [codigo, nome, tipo, pai_id || null, cor || '#6366f1', ativo !== false ? 1 : 0]
        );
        res.json({ id: result.insertId, message: 'Conta criada com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao criar conta:', error);
        res.status(500).json({ error: 'Erro ao criar conta' });
    }
});

// Atualizar conta
router.put('/plano-contas/:id', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { id } = req.params;
        const { codigo, nome, tipo, pai_id, cor, ativo } = req.body;
        await pool.query(
            `UPDATE plano_contas SET codigo=?, nome=?, tipo=?, pai_id=?, cor=?, ativo=?, updated_at=NOW() WHERE id=?`,
            [codigo, nome, tipo, pai_id || null, cor, ativo ? 1 : 0, id]
        );
        res.json({ message: 'Conta atualizada com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao atualizar conta:', error);
        res.status(500).json({ error: 'Erro ao atualizar conta' });
    }
});

// Excluir conta
router.delete('/plano-contas/:id', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM plano_contas WHERE id = ?', [id]);
        res.json({ message: 'Conta excluída com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao excluir conta:', error);
        res.status(500).json({ error: 'Erro ao excluir conta' });
    }
});

// =====================================================
// ORÇAMENTOS
// [SEGURANÇA] Rotas protegidas com authorizeFinanceiro - 2026-01-21
// =====================================================

// Listar orçamentos
router.get('/orcamentos', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT * FROM orcamentos ORDER BY categoria`);
        res.json(rows);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar orçamentos:', error);
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json([]);
        }
        res.status(500).json({ error: 'Erro ao buscar orçamentos' });
    }
});

// Criar orçamento
router.post('/orcamentos', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { categoria, centro_custo, limite, alerta, gasto } = req.body;
        const [result] = await pool.query(
            `INSERT INTO orcamentos (categoria, centro_custo, limite, alerta, gasto, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
            [categoria, centro_custo || null, limite || 0, alerta || null, gasto || 0]
        );
        res.json({ id: result.insertId, message: 'Orçamento criado com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao criar orçamento:', error);
        res.status(500).json({ error: 'Erro ao criar orçamento' });
    }
});

// Atualizar orçamento
router.put('/orcamentos/:id', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { id } = req.params;
        const { categoria, centro_custo, limite, alerta, gasto } = req.body;
        await pool.query(
            `UPDATE orcamentos SET categoria=?, centro_custo=?, limite=?, alerta=?, gasto=?, updated_at=NOW() WHERE id=?`,
            [categoria, centro_custo || null, limite, alerta, gasto || 0, id]
        );
        res.json({ message: 'Orçamento atualizado com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao atualizar orçamento:', error);
        res.status(500).json({ error: 'Erro ao atualizar orçamento' });
    }
});

// Excluir orçamento
router.delete('/orcamentos/:id', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM orcamentos WHERE id = ?', [id]);
        res.json({ message: 'Orçamento excluído com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao excluir orçamento:', error);
        res.status(500).json({ error: 'Erro ao excluir orçamento' });
    }
});

// =====================================================
// IMPOSTOS
// [SEGURANÇA] Rotas protegidas com authorizeFinanceiro - 2026-01-21
// =====================================================

// Listar impostos
router.get('/impostos', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT * FROM impostos ORDER BY tipo`);
        res.json(rows);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar impostos:', error);
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json([]);
        }
        res.status(500).json({ error: 'Erro ao buscar impostos' });
    }
});

// Criar imposto
router.post('/impostos', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { tipo, aliquota, descricao, base, observacoes, ativo } = req.body;
        const [result] = await pool.query(
            `INSERT INTO impostos (tipo, aliquota, descricao, base, observacoes, ativo, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [tipo, aliquota || 0, descricao || null, base || 'valor_total', observacoes || null, ativo !== false ? 1 : 0]
        );
        res.json({ id: result.insertId, message: 'Imposto criado com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao criar imposto:', error);
        res.status(500).json({ error: 'Erro ao criar imposto' });
    }
});

// Atualizar imposto
router.put('/impostos/:id', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { id } = req.params;
        const { tipo, aliquota, descricao, base, observacoes, ativo } = req.body;
        await pool.query(
            `UPDATE impostos SET tipo=?, aliquota=?, descricao=?, base=?, observacoes=?, ativo=?, updated_at=NOW() WHERE id=?`,
            [tipo, aliquota, descricao, base, observacoes, ativo ? 1 : 0, id]
        );
        res.json({ message: 'Imposto atualizado com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao atualizar imposto:', error);
        res.status(500).json({ error: 'Erro ao atualizar imposto' });
    }
});

// Excluir imposto
router.delete('/impostos/:id', authenticateToken, authorizeFinanceiro('config'), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM impostos WHERE id = ?', [id]);
        res.json({ message: 'Imposto excluído com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao excluir imposto:', error);
        res.status(500).json({ error: 'Erro ao excluir imposto' });
    }
});

// =====================================================
// BANCOS / CONTAS BANCÁRIAS
// [SEGURANÇA] Rotas protegidas com authorizeFinanceiro - 2026-01-21
// =====================================================

// Listar bancos
router.get('/bancos', authenticateToken, authorizeFinanceiro('bancos'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT b.*, 
                   COALESCE((SELECT SUM(valor) FROM movimentacoes_bancarias WHERE banco_id = b.id AND tipo = 'entrada' AND MONTH(data) = MONTH(CURDATE()) AND YEAR(data) = YEAR(CURDATE())), 0) as entradas_mes,
                   COALESCE((SELECT SUM(valor) FROM movimentacoes_bancarias WHERE banco_id = b.id AND tipo = 'saida' AND MONTH(data) = MONTH(CURDATE()) AND YEAR(data) = YEAR(CURDATE())), 0) as saidas_mes
            FROM bancos b
            ORDER BY b.nome
        `);
        res.json(rows);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar bancos:', error);
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json([]);
        }
        res.status(500).json({ error: 'Erro ao buscar bancos' });
    }
});

// Obter banco por ID
router.get('/bancos/:id', authenticateToken, authorizeFinanceiro('bancos'), async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query(`
            SELECT b.*, 
                   COALESCE((SELECT SUM(valor) FROM movimentacoes_bancarias WHERE banco_id = b.id AND tipo = 'entrada' AND MONTH(data) = MONTH(CURDATE()) AND YEAR(data) = YEAR(CURDATE())), 0) as entradas_mes,
                   COALESCE((SELECT SUM(valor) FROM movimentacoes_bancarias WHERE banco_id = b.id AND tipo = 'saida' AND MONTH(data) = MONTH(CURDATE()) AND YEAR(data) = YEAR(CURDATE())), 0) as saidas_mes
            FROM bancos b
            WHERE b.id = ?
        `, [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Banco não encontrado' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar banco:', error);
        res.status(500).json({ error: 'Erro ao buscar banco' });
    }
});

// Criar banco
router.post('/bancos', authenticateToken, authorizeFinanceiro('bancos'), async (req, res) => {
    try {
        const { codigo, nome, agencia, conta, tipo, apelido, saldo_inicial, observacoes, ativo } = req.body;
        const [result] = await pool.query(
            `INSERT INTO bancos (codigo, nome, agencia, conta, tipo, apelido, saldo, saldo_inicial, observacoes, ativo, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [codigo, nome, agencia, conta, tipo || 'corrente', apelido || null, saldo_inicial || 0, saldo_inicial || 0, observacoes || null, ativo !== false ? 1 : 0]
        );
        res.json({ id: result.insertId, message: 'Banco cadastrado com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao criar banco:', error);
        res.status(500).json({ error: 'Erro ao criar banco' });
    }
});

// Atualizar banco
router.put('/bancos/:id', authenticateToken, authorizeFinanceiro('bancos'), async (req, res) => {
    try {
        const { id } = req.params;
        const { codigo, nome, agencia, conta, tipo, apelido, observacoes, ativo } = req.body;
        await pool.query(
            `UPDATE bancos SET codigo=?, nome=?, agencia=?, conta=?, tipo=?, apelido=?, observacoes=?, ativo=?, updated_at=NOW() WHERE id=?`,
            [codigo, nome, agencia, conta, tipo, apelido, observacoes, ativo ? 1 : 0, id]
        );
        res.json({ message: 'Banco atualizado com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao atualizar banco:', error);
        res.status(500).json({ error: 'Erro ao atualizar banco' });
    }
});

// Excluir banco
router.delete('/bancos/:id', authenticateToken, authorizeFinanceiro('bancos'), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM bancos WHERE id = ?', [id]);
        res.json({ message: 'Banco excluído com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao excluir banco:', error);
        res.status(500).json({ error: 'Erro ao excluir banco' });
    }
});

// =====================================================
// MOVIMENTAÇÕES BANCÁRIAS
// =====================================================

// Listar movimentações de um banco
router.get('/bancos/:id/movimentacoes', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { limit = 50 } = req.query;
        const [rows] = await pool.query(`
            SELECT m.*, b.nome as banco_nome, b.nome as banco_apelido
            FROM movimentacoes_bancarias m
            JOIN bancos b ON m.banco_id = b.id
            WHERE m.banco_id = ?
            ORDER BY m.data DESC, m.id DESC
            LIMIT ?
        `, [id, parseInt(limit)]);
        res.json(rows);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar movimentações:', error);
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json([]);
        }
        res.status(500).json({ error: 'Erro ao buscar movimentações' });
    }
});

// Listar todas as movimentações bancárias
// [SEGURANÇA] Rota protegida com autenticação - Corrigido em 2026-01-21
router.get('/movimentacoes-bancarias', authenticateToken, authorizeFinanceiro('bancos'), async (req, res) => {
    try {
        const { limit = 50, conta_id } = req.query;
        
        // Verificar se tabela movimentacoes_bancarias existe
        const [tables] = await pool.query("SHOW TABLES LIKE 'movimentacoes_bancarias'");
        
        if (tables.length > 0) {
            let query = `
                SELECT 
                    m.id,
                    m.data,
                    m.banco_id,
                    COALESCE(b.nome, 'Conta Bancária') as banco_nome, 
                    COALESCE(b.nome, 'Conta Bancária') as banco_apelido,
                    COALESCE(m.cliente_fornecedor, m.categoria, 'Movimentação') as descricao,
                    m.tipo,
                    m.valor,
                    m.saldo as saldo_apos,
                    m.categoria,
                    m.nota_fiscal,
                    m.vendedor
                FROM movimentacoes_bancarias m
                LEFT JOIN bancos b ON m.banco_id = b.id
            `;
            const params = [];
            
            if (conta_id) {
                query += ' WHERE m.banco_id = ?';
                params.push(conta_id);
            }
            
            query += ' ORDER BY m.data DESC, m.id DESC LIMIT ?';
            params.push(parseInt(limit));
            
            const [rows] = await pool.query(query, params);
            
            if (rows.length > 0) {
                return res.json(rows);
            }
        }
        
        // Se não tem movimentações na tabela principal, retornar array vazio
        res.json([]);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar movimentações:', error);
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json([]);
        }
        res.json([]);
    }
});

// Criar movimentação
router.post('/movimentacoes-bancarias', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { banco_id, tipo, valor, data, descricao, categoria } = req.body;
        
        // Buscar saldo atual do banco
        const [bancoRows] = await connection.query('SELECT saldo FROM bancos WHERE id = ?', [banco_id]);
        if (bancoRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Banco não encontrado' });
        }
        
        let saldoAtual = parseFloat(bancoRows[0].saldo) || 0;
        const valorMovimento = parseFloat(valor);
        
        // Calcular novo saldo
        if (tipo === 'entrada') {
            saldoAtual += valorMovimento;
        } else {
            saldoAtual -= valorMovimento;
        }
        
        // Inserir movimentação
        const [result] = await connection.query(
            `INSERT INTO movimentacoes_bancarias (banco_id, tipo, valor, saldo_apos, data, descricao, categoria, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [banco_id, tipo, valorMovimento, saldoAtual, data, descricao, categoria || null]
        );
        
        // Atualizar saldo do banco
        await connection.query('UPDATE bancos SET saldo = ?, updated_at = NOW() WHERE id = ?', [saldoAtual, banco_id]);
        
        await connection.commit();
        res.json({ id: result.insertId, saldo: saldoAtual, message: 'Movimentação registrada com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('[Financeiro] Erro ao criar movimentação:', error);
        res.status(500).json({ error: 'Erro ao criar movimentação' });
    } finally {
        connection.release();
    }
});

// Transferência entre contas
router.post('/transferencia-bancaria', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { conta_origem, conta_destino, valor, data, descricao } = req.body;
        const valorTransf = parseFloat(valor);
        
        // Buscar bancos
        const [origemRows] = await connection.query('SELECT * FROM bancos WHERE id = ?', [conta_origem]);
        const [destinoRows] = await connection.query('SELECT * FROM bancos WHERE id = ?', [conta_destino]);
        
        if (origemRows.length === 0 || destinoRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Conta bancária não encontrada' });
        }
        
        const bancoOrigem = origemRows[0];
        const bancoDestino = destinoRows[0];
        
        if (parseFloat(bancoOrigem.saldo) < valorTransf) {
            await connection.rollback();
            return res.status(400).json({ error: 'Saldo insuficiente na conta de origem' });
        }
        
        const novoSaldoOrigem = parseFloat(bancoOrigem.saldo_atual || 0) - valorTransf;
        const novoSaldoDestino = parseFloat(bancoDestino.saldo_atual || 0) + valorTransf;
        
        // Movimentação de saída na origem
        await connection.query(
            `INSERT INTO movimentacoes_bancarias (banco_id, tipo, valor, saldo, data, categoria, observacoes, created_at) 
             VALUES (?, 'saida', ?, ?, ?, 'transferencia', ?, NOW())`,
            [conta_origem, valorTransf, novoSaldoOrigem, data, descricao || `Transferência para ${bancoDestino.nome}`]
        );
        
        // Movimentação de entrada no destino
        await connection.query(
            `INSERT INTO movimentacoes_bancarias (banco_id, tipo, valor, saldo, data, categoria, observacoes, created_at) 
             VALUES (?, 'entrada', ?, ?, ?, 'transferencia', ?, NOW())`,
            [conta_destino, valorTransf, novoSaldoDestino, data, descricao || `Transferência de ${bancoOrigem.nome}`]
        );
        
        // Atualizar saldos
        await connection.query('UPDATE bancos SET saldo_atual = ?, updated_at = NOW() WHERE id = ?', [novoSaldoOrigem, conta_origem]);
        await connection.query('UPDATE bancos SET saldo_atual = ?, updated_at = NOW() WHERE id = ?', [novoSaldoDestino, conta_destino]);
        
        await connection.commit();
        res.json({ message: 'Transferência realizada com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('[Financeiro] Erro na transferência:', error);
        res.status(500).json({ error: 'Erro ao realizar transferência' });
    } finally {
        connection.release();
    }
});

module.exports = router;
