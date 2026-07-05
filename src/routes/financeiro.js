/**
 * Rotas de API - Módulo Financeiro
 * Controle de Contas a Pagar e Contas a Receber com permissões por usuário
 *
 * Usa pool centralizado (database/pool.js) e auth centralizado (middleware/auth-central.js)
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const SpreadsheetReader = require('../utils/spreadsheet-reader');

// Multer para upload de comprovantes (memoryStorage → buffer)
const comprovanteUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
        cb(null, allowed.includes(file.mimetype));
    }
});

// Multer para upload de Excel (memoryStorage)
const excelUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (_req, file, cb) => {
        const excelTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/octet-stream'
        ];
        cb(null, (excelTypes.includes(file.mimetype) || !file.mimetype) && /\.xlsx$/i.test(file.originalname));
    }
});

// Pool e Auth centralizados — sem duplicações
const pool = require('../../database/pool');
const { authenticateToken } = require('../../middleware/auth-central');
const { corteTemporalMiddleware } = require('../middleware/financeiro-corte-temporal');

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
                'adm@aluforce.ind.br',
                'eldir@aluforce.ind.br',
                'eldir.junior@aluforce.ind.br'
            ];

            const isAdmin = userRole === 'admin';
            const hasFinanceiroAccess = financeiroEmails.includes(userEmail);

            if (isAdmin || hasFinanceiroAccess) {
                req.userAccess = 'admin';
                return next();
            }

            // Usuários da equipe Financeiro (role 'financeiro', 'financeiro2', 'financeiro3', ...)
            // têm acesso total ao módulo, independentemente do domínio (aluforce.ind.br / labor.com.br).
            if (/^financeiro\d*$/.test(String(userRole || '').toLowerCase())) {
                req.userAccess = 'admin';
                return next();
            }

            // Consultoria tem acesso de visualização a todos os módulos
            if (userRole === 'consultoria') {
                req.userAccess = 'consultoria';
                req.canEdit = false;
                req.canCreate = false;
                req.canDelete = false;
                return next();
            }

            // Verificar coluna 'areas' no banco — permite acesso se contém "financeiro"
            try {
                const [rows] = await pool.query(
                    'SELECT areas FROM usuarios WHERE email = ? AND ativo = 1 LIMIT 1',
                    [userEmail]
                );
                if (rows.length > 0 && rows[0].areas) {
                    let areas = rows[0].areas;
                    if (typeof areas === 'string') {
                        try { areas = JSON.parse(areas); } catch(e) { areas = []; }
                    }
                    if (Array.isArray(areas) && areas.includes('financeiro')) {
                        req.userAccess = 'admin';
                        return next();
                    }
                }
            } catch (dbErr) {
                console.error('[FINANCEIRO-AUTH] Erro ao consultar areas:', dbErr.message);
            }

            // Outros usuários não autorizados
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

// Alias usado pelas rotas de resumo/KPI
const checkFinanceiroPermission = authorizeFinanceiro;

// =====================================================
// MIDDLEWARE GLOBAL — CORTE TEMPORAL 2026
// Nenhum dado anterior a 01/01/2026 é retornado pela API
// =====================================================
router.use(corteTemporalMiddleware);

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
        jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
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
router.get('/resumo-kpis', authenticateToken, checkFinanceiroPermission('visualizar'), async (req, res) => {
    try {
        console.log('[Financeiro] Buscando resumo KPIs...');

        // Total a receber (com corte temporal 2026)
        const corte = req.financeiroCorteTemporal;
        const [receberTotal] = await pool.execute(`
            SELECT
                COALESCE(SUM(valor), 0) as total,
                COUNT(*) as quantidade
            FROM contas_receber cr
            WHERE cr.status IN ('a_vencer', 'vencida', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            ${corte.crClause('cr')}
        `);

        // Total a pagar (com corte temporal 2026)
        const [pagarTotal] = await pool.execute(`
            SELECT
                COALESCE(SUM(valor), 0) as total,
                COUNT(*) as quantidade
            FROM contas_pagar cp
            WHERE cp.status IN ('a_vencer', 'vencida', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            ${corte.cpClause('cp')}
        `);

        // Vencidos - com contagem e valor separados por tipo (com corte temporal 2026)
        const [vencidosReceber] = await pool.execute(`
            SELECT COUNT(*) as quantidade, COALESCE(SUM(valor), 0) as valor_total
            FROM contas_receber cr
            WHERE COALESCE(cr.data_vencimento, cr.vencimento) < CURDATE()
            AND cr.status IN ('vencida', 'a_vencer', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            ${corte.crClause('cr')}
        `);

        const [vencidosPagar] = await pool.execute(`
            SELECT COUNT(*) as quantidade, COALESCE(SUM(valor), 0) as valor_total
            FROM contas_pagar cp
            WHERE COALESCE(cp.data_vencimento, cp.vencimento) < CURDATE()
            AND cp.status IN ('vencida', 'a_vencer', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            ${corte.cpClause('cp')}
        `);

        const totalReceber = parseFloat(receberTotal[0]?.total || 0);
        const totalPagar = parseFloat(pagarTotal[0]?.total || 0);
        const saldo = totalReceber - totalPagar;
        const vencReceber = vencidosReceber[0]?.quantidade || 0;
        const vencPagar = vencidosPagar[0]?.quantidade || 0;
        const totalVencidos = vencReceber + vencPagar;

        console.log('[Financeiro] KPIs:', { totalReceber, totalPagar, saldo, totalVencidos });

        res.json({
            success: true,
            data: {
                totalReceber,
                totalPagar,
                saldo,
                vencidos: totalVencidos,
                vencidosReceber: vencReceber,
                vencidosPagar: vencPagar,
                valorVencidosReceber: parseFloat(vencidosReceber[0]?.valor_total || 0),
                valorVencidosPagar: parseFloat(vencidosPagar[0]?.valor_total || 0),
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
router.get('/proximos-vencimentos', authenticateToken, checkFinanceiroPermission('visualizar'), async (req, res) => {
    try {
        const limite = Math.min(Math.max(parseInt(req.query.limite) || 5, 1), 100);

        // Buscar próximos vencimentos de contas a receber (últimos 30 dias vencidos + futuros)
        const [receber] = await pool.query(`
            SELECT
                cr.id,
                'receber' as tipo,
                COALESCE(c.nome_fantasia, c.razao_social, cr.cliente_nome, cr.descricao, 'N/D') as descricao,
                cr.valor,
                COALESCE(cr.data_vencimento, cr.vencimento) as data_vencimento,
                LOWER(cr.status) as status
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            WHERE cr.status IN ('a_vencer', 'vencida', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
              AND COALESCE(cr.data_vencimento, cr.vencimento) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ORDER BY COALESCE(cr.data_vencimento, cr.vencimento) ASC
            LIMIT ?
        `, [limite]);

        // Buscar próximos vencimentos de contas a pagar (últimos 30 dias vencidos + futuros)
        const [pagar] = await pool.query(`
            SELECT
                cp.id,
                'pagar' as tipo,
                COALESCE(f.nome_fantasia, f.razao_social, f.nome, cp.descricao, 'N/D') as descricao,
                cp.valor,
                COALESCE(cp.data_vencimento, cp.vencimento) as data_vencimento,
                LOWER(cp.status) as status
            FROM contas_pagar cp
            LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
            WHERE cp.status IN ('a_vencer', 'vencida', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
              AND COALESCE(cp.data_vencimento, cp.vencimento) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ORDER BY COALESCE(cp.data_vencimento, cp.vencimento) ASC
            LIMIT ?
        `, [limite]);

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
router.get('/ultimos-lancamentos', authenticateToken, checkFinanceiroPermission('visualizar'), async (req, res) => {
    try {
        const limite = Math.min(Math.max(parseInt(req.query.limite) || 10, 1), 100);

        // Buscar últimos lançamentos de receber
        const [receber] = await pool.query(`
            SELECT
                cr.id,
                'Receber' as tipo,
                COALESCE(c.nome_fantasia, c.razao_social, cr.cliente_nome, cr.descricao, 'N/D') as descricao,
                cr.valor,
                COALESCE(cr.data_vencimento, cr.vencimento) as data_vencimento,
                LOWER(cr.status) as status,
                cr.data_criacao
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            ORDER BY cr.data_criacao DESC
            LIMIT ?
        `, [limite]);

        // Buscar últimos lançamentos de pagar
        const [pagar] = await pool.query(`
            SELECT
                cp.id,
                'Pagar' as tipo,
                COALESCE(f.nome_fantasia, f.razao_social, f.nome, cp.descricao, 'N/D') as descricao,
                cp.valor,
                COALESCE(cp.data_vencimento, cp.vencimento) as data_vencimento,
                LOWER(cp.status) as status,
                cp.data_criacao
            FROM contas_pagar cp
            LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
            ORDER BY cp.data_criacao DESC
            LIMIT ?
        `, [limite]);

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
router.get('/fluxo-caixa-resumo', authenticateToken, checkFinanceiroPermission('fluxo_caixa'), async (req, res) => {
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
            case '90d':
                inicio = new Date(hoje);
                inicio.setDate(inicio.getDate() - 90);
                fim = new Date(hoje);
                fim.setDate(fim.getDate() + 90);
                break;
            case 'mes':
            case '30d':
            default:
                // Mês atual: do dia 1 ao último dia do mês
                inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
                fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
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
                GROUP_CONCAT(DISTINCT COALESCE(c.nome_fantasia, c.razao_social, cr.cliente_nome, 'Cliente') SEPARATOR ', ') as descricao
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            WHERE cr.status IN ('a_vencer', 'vencida', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
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
            WHERE cp.status IN ('a_vencer', 'vencida', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
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
                COALESCE(c.nome_fantasia, c.razao_social, cr.cliente_nome, cr.descricao, 'Recebimento') as descricao,
                COALESCE(cat.nome, cr.categoria_nome, 'Vendas') as categoria,
                cr.valor,
                COALESCE(cr.data_vencimento, cr.vencimento) as data,
                LOWER(cr.status) as status
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
                LOWER(cp.status) as status
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
            .filter(m => m.data && m.data >= hojeStr && !['pago', 'liquidada', 'cancelada'].includes(m.status))
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
router.get('/conciliacao-resumo', authenticateToken, checkFinanceiroPermission('visualizar'), async (req, res) => {
    try {
        console.log('[Financeiro] Buscando dados de conciliação...');
        const corte = req.financeiroCorteTemporal;

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
            FROM contas_receber cr
            WHERE cr.status IN ('a_vencer', 'vencida', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
              ${corte.crClause('cr')}
            UNION ALL
            SELECT
                'pagar' as tipo,
                COUNT(*) as quantidade,
                COALESCE(SUM(valor), 0) as total
            FROM contas_pagar cp
            WHERE cp.status IN ('a_vencer', 'vencida', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
              ${corte.cpClause('cp')}
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
            WHERE cr.status IN ('a_vencer', 'vencida', 'pendente', 'parcial')
              ${corte.crClause('cr')}
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
            WHERE cp.status IN ('a_vencer', 'vencida', 'pendente', 'parcial')
              ${corte.cpClause('cp')}
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
        const corte = req.financeiroCorteTemporal;

        // Admins veem tudo
        if (userAccess === 'admin') {
            const [receber] = await pool.execute(
                'SELECT SUM(valor) as total FROM contas_receber cr WHERE cr.status = "PENDENTE"' + corte.crClause('cr')
            );
            const [pagar] = await pool.execute(
                'SELECT SUM(valor) as total FROM contas_pagar cp WHERE cp.status = "PENDENTE"' + corte.cpClause('cp')
            );
            const [vencendoHojeReceber] = await pool.execute(
                'SELECT COUNT(*) as count FROM contas_receber cr WHERE DATE(cr.vencimento) = ? AND cr.status = "PENDENTE"' + corte.crClause('cr'),
                [today]
            );
            const [vencendoHojePagar] = await pool.execute(
                'SELECT COUNT(*) as count FROM contas_pagar cp WHERE DATE(cp.vencimento) = ? AND cp.status = "PENDENTE"' + corte.cpClause('cp'),
                [today]
            );

            result.aReceber = receber[0]?.total || 0;
            result.aPagar = pagar[0]?.total || 0;
            result.saldoAtual = result.aReceber - result.aPagar;
            result.vencendoHoje = (vencendoHojeReceber[0]?.count || 0) + (vencendoHojePagar[0]?.count || 0);

            // Últimas transações (ambas tabelas)
            const [transacoesReceber] = await pool.execute(
                'SELECT "Receber" as tipo, cr.cliente_id as referencia, cr.descricao, cr.valor, cr.vencimento, cr.status FROM contas_receber cr WHERE 1=1' + corte.crClause('cr') + ' ORDER BY cr.data_criacao DESC LIMIT 5'
            );
            const [transacoesPagar] = await pool.execute(
                'SELECT "Pagar" as tipo, cp.fornecedor_id as referencia, cp.descricao, cp.valor, cp.vencimento, cp.status FROM contas_pagar cp WHERE 1=1' + corte.cpClause('cp') + ' ORDER BY cp.data_criacao DESC LIMIT 5'
            );
            result.ultimasTransacoes = [...transacoesReceber, ...transacoesPagar]
                .sort((a, b) => new Date(b.vencimento) - new Date(a.vencimento))
                .slice(0, 10);
        }
        // Júnior vê apenas contas a receber
        else if (userAccess === 'receber') {
            const [receber] = await pool.execute(
                'SELECT SUM(valor) as total FROM contas_receber cr WHERE cr.status = "PENDENTE"' + corte.crClause('cr')
            );
            const [vencendoHoje] = await pool.execute(
                'SELECT COUNT(*) as count FROM contas_receber cr WHERE DATE(cr.vencimento) = ? AND cr.status = "PENDENTE"' + corte.crClause('cr'),
                [today]
            );
            const [transacoes] = await pool.execute(
                'SELECT "Receber" as tipo, cr.cliente as referencia, cr.descricao, cr.valor, cr.vencimento, cr.status FROM contas_receber cr WHERE 1=1' + corte.crClause('cr') + ' ORDER BY cr.data_criacao DESC LIMIT 10'
            );

            result.aReceber = receber[0]?.total || 0;
            result.saldoAtual = result.aReceber;
            result.vencendoHoje = vencendoHoje[0]?.count || 0;
            result.ultimasTransacoes = transacoes;
        }
        // Hellen vê apenas contas a pagar
        else if (userAccess === 'pagar') {
            const [pagar] = await pool.execute(
                'SELECT SUM(valor) as total FROM contas_pagar cp WHERE cp.status = "PENDENTE"' + corte.cpClause('cp')
            );
            const [vencendoHoje] = await pool.execute(
                'SELECT COUNT(*) as count FROM contas_pagar cp WHERE DATE(cp.vencimento) = ? AND cp.status = "PENDENTE"' + corte.cpClause('cp'),
                [today]
            );
            const [transacoes] = await pool.execute(
                'SELECT "Pagar" as tipo, cp.fornecedor as referencia, cp.descricao, cp.valor, cp.vencimento, cp.status FROM contas_pagar cp WHERE 1=1' + corte.cpClause('cp') + ' ORDER BY cp.data_criacao DESC LIMIT 10'
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
        const { status, limite, mes } = req.query;
        const dataInicio = req.query.dataInicio || req.query.data_inicio;
        const dataFim = req.query.dataFim || req.query.data_fim;

        // Validar formato de datas se fornecidas
        if (dataInicio && !/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
            return res.json({ success: true, data: [], total: 0 });
        }
        if (dataFim && !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
            return res.json({ success: true, data: [], total: 0 });
        }

        let query = `
            SELECT
                cr.id,
                cr.cliente_id,
                COALESCE(c.nome_fantasia, c.razao_social, cr.cliente_nome, cr.descricao, 'N/D') as cliente_nome,
                COALESCE(cr.cnpj_cliente, c.cnpj_cpf) as cnpj_cpf,
                cr.valor,
                cr.valor as valor_total,
                cr.descricao,
                LOWER(cr.status) as status,
                cr.vencimento,
                cr.data_vencimento,
                cr.data_criacao,
                cr.categoria_id,
                COALESCE(cat.nome, cr.categoria_nome) as categoria,
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
                COALESCE(cr.numero_documento, cr.observacoes, cr.descricao) as numero_documento,
                COALESCE(cr.conta_corrente_nome, '') as centro_receita,
                3 as dias_lembrete,
                NULL as recorrencia,
                cr.empresa,
                CASE UPPER(TRIM(cr.empresa))
                    WHEN 'ALUFORCE' THEN '08.192.479/0001-60'
                    WHEN 'LABOR' THEN '35.165.246/0001-06'
                    WHEN 'LABOR ELETRIC' THEN '35.165.246/0001-06'
                    WHEN 'ENERGY' THEN '53.937.474/0001-20'
                    WHEN 'LABOR ENERGY' THEN '53.937.474/0001-20'
                    ELSE ''
                END as cnpj_empresa,
                cr.portador,
                cr.nota_fiscal,
                cr.parcela_info,
                cr.dias_vencido,
                cr.situacao,
                COALESCE(cr.cnpj_cliente, c.cnpj_cpf) as cnpj_cliente,
                cr.data_operacao,
                cr.posicao,
                cr.recomprado,
                cr.cartorio,
                cr.aceita_troca,
                cr.comissaria,
                cr.origem_importacao,
                cr.pago_no_dia,
                cr.aceita_troca_factory,
                cr.comprovante_url,
                cr.dia_recomprado,
                cr.data_para_cartorio,
                cr.data_protestado,
                cr.origem_integracao,
                cr.data_emissao,
                cr.vendedor,
                cr.numero_boleto,
                cr.projeto,
                cr.valor_liquido,
                cr.a_receber,
                cr.valor_pis,
                cr.valor_cofins,
                cr.valor_csll,
                cr.valor_ir,
                cr.valor_iss,
                cr.valor_inss,
                cr.tipo_documento
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            LEFT JOIN categorias_financeiro cat ON cr.categoria_id = cat.id
            WHERE 1=1
        `;
        const params = [];
        const corte = req.financeiroCorteTemporal;

        // CORTE TEMPORAL 2026 — Hard limit
        if (corte && typeof corte.crClause === 'function') {
            query += corte.crClause('cr');
        }

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

        // Filtro por mês (YYYY-MM)
        if (mes && /^\d{4}-\d{2}$/.test(mes)) {
            query += ' AND DATE_FORMAT(COALESCE(cr.data_vencimento, cr.vencimento), "%Y-%m") = ?';
            params.push(mes);
        }

        query += ' ORDER BY COALESCE(cr.data_vencimento, cr.vencimento) ASC';

        if (limite) {
            const parsedLimit = Math.min(Math.max(parseInt(limite) || 100, 1), 500);
            query += ` LIMIT ${parsedLimit}`;
        }

        const [rows] = await pool.query(query, params);
        res.json({ success: true, data: rows, total: rows.length });
    } catch (error) {
        console.error('[Financeiro] Erro ao listar contas a receber:', error.message);
        console.error('[Financeiro] Stack:', error.stack);
        console.error('[Financeiro] Query params:', JSON.stringify(req.query));
        // Retornar array vazio em vez de 500 para não quebrar o frontend
        res.json({ success: true, data: [], total: 0, _error: 'Falha temporária na consulta' });
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
        const corteStat = req.financeiroCorteTemporal;

        // Total a receber (a_vencer + vencida — novo domínio)
        const [totalReceber] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as total_receber
            FROM contas_receber cr
            WHERE cr.status IN ('a_vencer', 'vencida', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            ${corteStat.crClause('cr')}
        `);

        // Vencendo em 7 dias
        const [vencendo] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as vencendo
            FROM contas_receber cr
            WHERE cr.status IN ('a_vencer', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            AND COALESCE(cr.data_vencimento, cr.vencimento) BETWEEN ? AND DATE_ADD(?, INTERVAL 7 DAY)
            ${corteStat.crClause('cr')}
        `, [hoje, hoje]);

        // Vencidas
        const [vencidas] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as vencidas
            FROM contas_receber cr
            WHERE cr.status IN ('vencida', 'a_vencer', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            AND COALESCE(cr.data_vencimento, cr.vencimento) < ?
            ${corteStat.crClause('cr')}
        `, [hoje]);

        // Liquidadas no mês atual (novo domínio)
        const [recebidasMes] = await pool.execute(`
            SELECT COALESCE(SUM(COALESCE(valor_recebido, valor)), 0) as recebidas_mes
            FROM contas_receber cr
            WHERE cr.status IN ('liquidada', 'recebido', 'recebida', 'RECEBIDO', 'RECEBIDA', 'pago', 'PAGO')
            AND COALESCE(cr.data_recebimento, cr.pago_no_dia) BETWEEN ? AND ?
            ${corteStat.crClause('cr')}
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
 * GET /api/financeiro/contas-receber/:id/historico
 * Retorna histórico de movimentações de uma conta a receber
 */
router.get('/contas-receber/:id/historico', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar se a conta existe
        const [conta] = await pool.execute('SELECT id, descricao, valor, status FROM contas_receber WHERE id = ?', [id]);
        if (conta.length === 0) {
            return res.status(404).json({ success: false, message: 'Conta não encontrada' });
        }

        // Buscar conciliações vinculadas
        const [conciliacoes] = await pool.execute(
            `SELECT c.id, c.valor, c.tipo_match, c.created_at as data,
                    'conciliacao' as tipo_evento,
                    CONCAT('Conciliação ', c.tipo_match, ' - Extrato #', c.extrato_id) as descricao
             FROM conciliacoes c
             WHERE c.movimentacao_sistema_id = ? AND c.movimentacao_tabela = 'contas_receber'
             ORDER BY c.created_at DESC`,
            [id]
        );

        // Montar timeline unificada com dados da própria conta
        const historico = [];

        // Evento de criação
        if (conta[0]) {
            historico.push({
                tipo: 'criacao',
                descricao: 'Conta a receber criada',
                valor: conta[0].valor,
                data: conta[0].data_criacao || null
            });
        }

        // Eventos de conciliação
        conciliacoes.forEach(c => {
            historico.push({
                tipo: c.tipo_evento,
                descricao: c.descricao,
                valor: c.valor,
                data: c.data
            });
        });

        // Ordenar por data desc
        historico.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

        res.json({ success: true, conta: conta[0], historico });
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar histórico CR:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar histórico' });
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
            'INSERT INTO contas_receber (cliente_nome, descricao, valor, vencimento, data_vencimento, status, categoria_nome) VALUES (?, ?, ?, ?, ?, "PENDENTE", ?)',
            [sanitizeString(cliente), descricaoSanitizada, valorNumerico, dataVencimento, dataVencimento, tipo || 'VENDA']
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
 * Atualiza uma conta a receber — com novos campos: pago_no_dia, aceita_troca_factory, comprovante_url
 */
router.put('/contas-receber/:id', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            cliente, cliente_nome, descricao, valor, vencimento, status, tipo,
            pago_no_dia, aceita_troca_factory, comprovante_url,
            dia_recomprado, data_para_cartorio, data_protestado,
            observacoes, forma_recebimento, categoria, categoria_nome,
            empresa, nota_fiscal, cnpj_cliente, data_emissao, data_vencimento,
            parcela_info, situacao, portador, vendedor, posicao,
            valor_recebido, numero_documento, numero_boleto
        } = req.body;

        // Validar status contra domínio estrito
        const STATUS_VALIDOS_CR = ['cancelada', 'liquidada', 'vencida', 'a_vencer', 'pendente', 'recebido', 'parcial', 'pago'];
        if (status && !STATUS_VALIDOS_CR.includes(status.toLowerCase())) {
            return res.status(400).json({
                error: `Status inválido. Valores aceitos: ${STATUS_VALIDOS_CR.join(', ')}`
            });
        }

        // Build dinâmico do UPDATE
        const updates = [];
        const params = [];

        if (cliente !== undefined) { updates.push('cliente_nome = ?'); params.push(sanitizeString(cliente)); }
        if (descricao !== undefined) { updates.push('descricao = ?'); params.push(sanitizeString(descricao)); }
        if (valor !== undefined) { updates.push('valor = ?'); params.push(parseFloat(valor)); }
        if (vencimento !== undefined) {
            updates.push('vencimento = ?', 'data_vencimento = ?');
            const dv = new Date(vencimento).toISOString().split('T')[0];
            params.push(dv, dv);
        }
        if (status !== undefined) { updates.push('status = ?'); params.push(status.toLowerCase()); }
        if (tipo !== undefined) { updates.push('tipo = ?'); params.push(tipo); }
        if (observacoes !== undefined) { updates.push('observacoes = ?'); params.push(sanitizeString(observacoes)); }
        if (forma_recebimento !== undefined) { updates.push('forma_recebimento = ?'); params.push(forma_recebimento); }
        if (categoria !== undefined) { updates.push('categoria_nome = ?'); params.push(categoria); }

        // Novos campos (2.3)
        if (pago_no_dia !== undefined) { updates.push('pago_no_dia = ?'); params.push(pago_no_dia || null); }
        if (aceita_troca_factory !== undefined) { updates.push('aceita_troca_factory = ?'); params.push(aceita_troca_factory ? 1 : 0); }
        if (comprovante_url !== undefined) { updates.push('comprovante_url = ?'); params.push(sanitizeString(comprovante_url)); }

        // Campos ETL (2.4)
        if (dia_recomprado !== undefined) { updates.push('dia_recomprado = ?'); params.push(dia_recomprado || null); }
        if (data_para_cartorio !== undefined) { updates.push('data_para_cartorio = ?'); params.push(data_para_cartorio || null); }
        if (data_protestado !== undefined) { updates.push('data_protestado = ?'); params.push(data_protestado || null); }

        // Campos Faturamento Modal (v2.5)
        if (empresa !== undefined) { updates.push('empresa = ?'); params.push(sanitizeString(empresa)); }
        if (nota_fiscal !== undefined) { updates.push('nota_fiscal = ?'); params.push(sanitizeString(nota_fiscal)); }
        if (cnpj_cliente !== undefined) { updates.push('cnpj_cliente = ?'); params.push(sanitizeString(cnpj_cliente)); }
        if (data_emissao !== undefined) { updates.push('data_emissao = ?'); params.push(data_emissao || null); }
        if (data_vencimento !== undefined) { updates.push('data_vencimento = ?'); params.push(data_vencimento || null); }
        if (parcela_info !== undefined) { updates.push('parcela_info = ?'); params.push(sanitizeString(parcela_info)); }
        if (situacao !== undefined) { updates.push('situacao = ?'); params.push(sanitizeString(situacao)); }
        if (portador !== undefined) { updates.push('portador = ?'); params.push(sanitizeString(portador)); }
        if (vendedor !== undefined) { updates.push('vendedor = ?'); params.push(sanitizeString(vendedor)); }
        if (posicao !== undefined) { updates.push('posicao = ?'); params.push(sanitizeString(posicao)); }
        if (cliente_nome !== undefined) { updates.push('cliente_nome = ?'); params.push(sanitizeString(cliente_nome)); }
        if (categoria_nome !== undefined) { updates.push('categoria_nome = ?'); params.push(sanitizeString(categoria_nome)); }
        if (valor_recebido !== undefined) { updates.push('valor_recebido = ?'); params.push(parseFloat(valor_recebido) || 0); }
        if (numero_documento !== undefined) { updates.push('numero_documento = ?'); params.push(sanitizeString(numero_documento)); }
        if (numero_boleto !== undefined) { updates.push('numero_boleto = ?'); params.push(sanitizeString(numero_boleto)); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nenhum campo para atualizar' });
        }

        // AUDIT-FIX R2: Guard de idempotência — impedir pagamento duplo
        if (status && ['liquidada', 'pago'].includes(status.toLowerCase())) {
            const [current] = await pool.execute('SELECT status FROM contas_receber WHERE id = ?', [id]);
            if (current.length && ['liquidada', 'pago', 'recebido'].includes((current[0].status || '').toLowerCase())) {
                return res.status(409).json({ error: 'Esta conta já está liquidada/paga. Não é possível pagar novamente.' });
            }
        }

        params.push(id);
        const [result] = await pool.execute(
            `UPDATE contas_receber SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        // Se a conta foi liquidada, registrar data de pagamento
        if (status === 'liquidada' || status === 'PAGO') {
            await pool.execute(
                'UPDATE contas_receber SET data_pagamento = COALESCE(pago_no_dia, NOW()) WHERE id = ?',
                [id]
            );
        }

        res.json({ success: true, message: 'Conta atualizada com sucesso' });
    } catch (error) {
        console.error('[Financeiro] Erro ao atualizar conta a receber:', error);
        res.status(500).json({ error: 'Erro ao atualizar conta' });
    }
});

/**
 * POST /api/financeiro/contas-receber/:id/comprovante
 * Upload de comprovante de pagamento (imagem/PDF)
 * Usa o serviço de upload-storage (S3/MinIO/Local)
 */
router.post('/contas-receber/:id/comprovante', authenticateToken, authorizeFinanceiro('receber'), comprovanteUpload.single('comprovante'), async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar se a conta existe
        const [conta] = await pool.execute('SELECT id FROM contas_receber WHERE id = ?', [id]);
        if (conta.length === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado. Use multipart/form-data com campo "comprovante".' });
        }

        // Validar tipo de arquivo
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
        if (!allowedMimes.includes(req.file.mimetype)) {
            return res.status(400).json({ error: 'Tipo de arquivo não permitido. Aceitos: JPEG, PNG, GIF, PDF.' });
        }

        if (req.file.size > 10 * 1024 * 1024) {
            return res.status(400).json({ error: 'Arquivo muito grande. Máximo: 10MB.' });
        }

        // Usar upload-storage service
        const UploadStorage = require('../../services/upload-storage');
        const storage = new UploadStorage();
        await storage.init();

        const result = await storage.uploadFile(req.file.buffer, req.file.originalname, {
            prefix: `financeiro/comprovantes/cr-${id}`,
            contentType: req.file.mimetype
        });

        // Salvar URL no banco
        await pool.execute(
            'UPDATE contas_receber SET comprovante_url = ? WHERE id = ?',
            [result.url || result.key, id]
        );

        res.json({
            success: true,
            message: 'Comprovante enviado com sucesso',
            comprovante_url: result.url || result.key
        });
    } catch (error) {
        console.error('[Financeiro] Erro ao fazer upload de comprovante:', error);
        res.status(500).json({ error: 'Erro ao enviar comprovante' });
    }
});

/**
 * GET /api/financeiro/status-dominio/:tipo
 * Retorna os status válidos para CR ou CP (tabela de domínio)
 */
router.get('/status-dominio/:tipo', authenticateToken, async (req, res) => {
    try {
        const tipo = req.params.tipo === 'receber' ? 'cr' : req.params.tipo === 'pagar' ? 'cp' : req.params.tipo;
        if (!['cr', 'cp'].includes(tipo)) {
            return res.status(400).json({ error: 'Tipo deve ser "cr" ou "cp" (ou "receber"/"pagar")' });
        }

        const [rows] = await pool.execute(
            'SELECT codigo, label, cor FROM financeiro_status_dominio WHERE tipo = ? AND ativo = 1 ORDER BY ordem',
            [tipo]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        // Se a tabela não existe ainda, retorna status hardcoded
        res.json({
            success: true,
            data: [
                { codigo: 'cancelada', label: 'Cancelada', cor: '#6c757d' },
                { codigo: 'liquidada', label: 'Liquidada', cor: '#28a745' },
                { codigo: 'vencida', label: 'Vencida', cor: '#dc3545' },
                { codigo: 'a_vencer', label: 'A Vencer', cor: '#ffc107' },
            ]
        });
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
        if (['liquidada', 'PAGO', 'pago'].includes(conta[0].status)) {
            return res.status(400).json({
                error: 'Não é possível excluir uma conta já liquidada. Use o estorno primeiro.'
            });
        }

        // Soft delete: marcar como cancelada ao invés de deletar
        const [result] = await pool.execute(
            `UPDATE contas_receber
             SET status = 'cancelada',
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
        const { status, limite, mes } = req.query;
        const dataInicio = req.query.dataInicio || req.query.data_inicio;
        const dataFim = req.query.dataFim || req.query.data_fim;
        let query = `
            SELECT
                cp.id,
                cp.fornecedor_id,
                COALESCE(f.nome, f.razao_social, cp.fornecedor_nome, cp.cnpj_cpf, 'N/D') as fornecedor_nome,
                COALESCE(f.cnpj, cp.cnpj_cpf) as fornecedor_cnpj,
                cp.valor,
                cp.valor as valor_total,
                cp.descricao,
                LOWER(cp.status) as status,
                cp.vencimento,
                cp.data_vencimento,
                COALESCE(cp.data_vencimento_original, cp.data_vencimento, cp.vencimento) as data_vencimento_original,
                cp.data_criacao,
                cp.categoria_id,
                COALESCE(cat.nome, cp.categoria_nome) as categoria,
                cp.banco_id as conta_bancaria_id,
                cp.forma_pagamento,
                cp.observacoes,
                cp.parcela_numero,
                cp.total_parcelas,
                cp.valor_pago,
                COALESCE(cp.data_pagamento, cp.data_recebimento) as data_pagamento,
                cp.pedido_compra_id,
                COALESCE(cp.numero_documento, cp.cnpj_cpf, cp.descricao) as numero_documento,
                COALESCE(cp.conta_corrente_nome, cp.minha_empresa_nome_fantasia, '') as centro_custo,
                DATE_FORMAT(cp.data_vencimento, '%Y-%m') as competencia
            FROM contas_pagar cp
            LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
            LEFT JOIN categorias_financeiro cat ON cp.categoria_id = cat.id
            WHERE 1=1
        `;
        const params = [];
        const corteCP = req.financeiroCorteTemporal;

        // CORTE TEMPORAL 2026 — Hard limit
        query += corteCP.cpClause('cp');

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

        // Filtro por mês (YYYY-MM)
        if (mes && /^\d{4}-\d{2}$/.test(mes)) {
            query += ' AND DATE_FORMAT(COALESCE(cp.data_vencimento, cp.vencimento), "%Y-%m") = ?';
            params.push(mes);
        }

        query += ' ORDER BY COALESCE(cp.data_vencimento, cp.vencimento) ASC';

        if (limite) {
            query += ' LIMIT ?';
            params.push(Math.min(Math.max(parseInt(limite), 1), 100));
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
        const corteStat = req.financeiroCorteTemporal;

        // Total a pagar (a_vencer + vencida — novo domínio, compat legado)
        const [totalPagar] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as total_pagar
            FROM contas_pagar cp
            WHERE cp.status IN ('a_vencer', 'vencida', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            ${corteStat.cpClause('cp')}
        `);

        // Vencendo em 7 dias
        const [vencendo] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as vencendo
            FROM contas_pagar cp
            WHERE cp.status IN ('a_vencer', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            AND COALESCE(cp.data_vencimento, cp.vencimento) BETWEEN ? AND DATE_ADD(?, INTERVAL 7 DAY)
            ${corteStat.cpClause('cp')}
        `, [hoje, hoje]);

        // Vencidas
        const [vencidas] = await pool.execute(`
            SELECT COALESCE(SUM(valor), 0) as vencidas
            FROM contas_pagar cp
            WHERE cp.status IN ('vencida', 'a_vencer', 'pendente', 'parcial', 'PENDENTE', 'PARCIAL')
            AND COALESCE(cp.data_vencimento, cp.vencimento) < ?
            ${corteStat.cpClause('cp')}
        `, [hoje]);

        // Liquidadas no mês atual (novo domínio)
        const [pagasMes] = await pool.execute(`
            SELECT COALESCE(SUM(COALESCE(valor_pago, valor)), 0) as pagas_mes
            FROM contas_pagar cp
            WHERE cp.status IN ('liquidada', 'pago', 'PAGO')
            AND COALESCE(cp.data_pagamento, cp.data_recebimento) BETWEEN ? AND ?
            ${corteStat.cpClause('cp')}
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
        const { fornecedor_id, fornecedor, descricao, valor, vencimento, data_vencimento, data_vencimento_original, categoria_id, banco_id, forma_pagamento, observacoes, numero_documento, valor_total, categoria, codigo_barras, conta_bancaria_id, data_emissao } = req.body;

        // Aceitar tanto 'vencimento' quanto 'data_vencimento'
        const dataVenc = data_vencimento || vencimento;
        const dataVencOriginal = data_vencimento_original || dataVenc;
        const valorFinal = valor_total || valor;
        const bancoId = conta_bancaria_id || banco_id;

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
            `INSERT INTO contas_pagar (fornecedor_id, fornecedor_nome, descricao, valor, data_vencimento, data_vencimento_original, categoria_id, categoria_nome, banco_id, forma_pagamento, observacoes, numero_documento, codigo_barras_boleto, data_emissao, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "pendente")`,
            [fornecedor_id || null, fornecedor || null, descricaoSanitizada, valorNumerico, dataVencimento, dataVencimentoOriginal, categoria_id || null, categoria || null, bancoId || null, forma_pagamento || null, obsSanitizada || null, numero_documento || null, codigo_barras || null, data_emissao || null]
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
            status, tipo, categoria, numero_documento, observacoes, forma_pagamento, valor_total,
            codigo_barras, conta_bancaria_id, data_emissao
        } = req.body;

        const dataVenc = data_vencimento || vencimento;
        const valorFinal = valor_total || valor;

        // Build dynamic update query
        const updates = [];
        const params = [];

        if (fornecedor !== undefined) { updates.push('fornecedor_nome = ?'); params.push(fornecedor); }
        if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }
        if (valorFinal !== undefined) { updates.push('valor = ?'); params.push(valorFinal); }
        if (dataVenc !== undefined) { updates.push('data_vencimento = ?'); params.push(dataVenc); }
        if (data_vencimento_original !== undefined) { updates.push('data_vencimento_original = ?'); params.push(data_vencimento_original); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }
        if (tipo !== undefined) { updates.push('tipo = ?'); params.push(tipo); }
        if (categoria !== undefined) { updates.push('categoria_nome = ?'); params.push(categoria); }
        if (numero_documento !== undefined) { updates.push('numero_documento = ?'); params.push(numero_documento); }
        if (observacoes !== undefined) { updates.push('observacoes = ?'); params.push(observacoes); }
        if (forma_pagamento !== undefined) { updates.push('forma_pagamento = ?'); params.push(forma_pagamento); }
        if (codigo_barras !== undefined) { updates.push('codigo_barras_boleto = ?'); params.push(codigo_barras); }
        if (conta_bancaria_id !== undefined) { updates.push('banco_id = ?'); params.push(conta_bancaria_id || null); }
        if (data_emissao !== undefined) { updates.push('data_emissao = ?'); params.push(data_emissao); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nenhum campo para atualizar' });
        }

        // AUDIT-FIX R2: Guard de idempotência — impedir pagamento duplo
        if (status && ['liquidada', 'pago'].includes(status.toLowerCase())) {
            const [current] = await pool.execute('SELECT status FROM contas_pagar WHERE id = ?', [id]);
            if (current.length && ['liquidada', 'pago'].includes((current[0].status || '').toLowerCase())) {
                return res.status(409).json({ error: 'Esta conta já está liquidada/paga. Não é possível pagar novamente.' });
            }
        }

        params.push(id);
        const [result] = await pool.execute(
            `UPDATE contas_pagar SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        // Se a conta foi liquidada, registrar data de pagamento
        if (status === 'liquidada' || status === 'PAGO' || status === 'pago') {
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

        // Não permitir exclusão de contas já liquidadas
        if (['liquidada', 'pago', 'PAGO'].includes(conta[0].status)) {
            return res.status(400).json({
                error: 'Não é possível excluir uma conta já liquidada. Use o estorno primeiro.'
            });
        }

        // Soft delete: marcar como cancelada ao invés de deletar
        const [result] = await pool.execute(
            `UPDATE contas_pagar
             SET status = 'cancelada',
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
            WHERE COALESCE(ativo, 1) = 1
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
        // AUDIT-FIX R3: Soft delete em vez de hard DELETE
        const [result] = await pool.query('UPDATE contas_bancarias SET ativo = 0 WHERE id = ?', [id]);

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
// SELECT DE CONTAS BANCÁRIAS (uso em modais, sem restrição de seção)
// =====================================================

/**
 * GET /api/financeiro/bancos-select
 * Retorna lista mínima de contas bancárias para uso em dropdowns/selects.
 * Requer apenas autenticação — sem restrição de seção financeiro.
 */
router.get('/bancos-select', authenticateToken, async (req, res) => {
    try {
        let contas = [];

        // Fonte primária: contas_bancarias (tabela gerenciada pelo CRUD do módulo)
        try {
            const [rows] = await pool.query(
                `SELECT id,
                        CONCAT(
                            COALESCE(banco, nome, ''),
                            CASE WHEN conta IS NOT NULL AND conta != '' THEN CONCAT(' — Cc. ', conta) ELSE '' END,
                            CASE WHEN agencia IS NOT NULL AND agencia != '' THEN CONCAT(' — Ag. ', agencia) ELSE '' END
                        ) AS nome
                 FROM contas_bancarias
                 WHERE ativo = 1
                 ORDER BY nome`
            );
            contas = rows || [];
        } catch (e) { /* tabela pode não existir */ }

        // Fonte secundária: tabela bancos (sistema legado de movimentações)
        if (contas.length === 0) {
            try {
                const [rows] = await pool.query(
                    `SELECT id,
                            CONCAT(
                                COALESCE(nome, instituicao, ''),
                                CASE WHEN conta_corrente IS NOT NULL AND conta_corrente != '' THEN CONCAT(' — Cc. ', conta_corrente) ELSE '' END,
                                CASE WHEN agencia IS NOT NULL AND agencia != '' THEN CONCAT(' — Ag. ', agencia) ELSE '' END
                            ) AS nome
                     FROM bancos
                     WHERE status != 'inativo' OR status IS NULL
                     ORDER BY nome`
                );
                contas = rows || [];
            } catch (e) { /* tabela pode não existir */ }
        }

        res.json(contas);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar contas para select:', error);
        res.json([]);
    }
});

// =====================================================
// MOVIMENTAÇÕES DIRETAS (lançamentos manuais no fluxo de caixa)
// =====================================================

/**
 * POST /api/financeiro/movimentacoes
 * Registra uma movimentação direta em conta bancária (entrada ou saída).
 * Atualiza o saldo_atual da conta e armazena no log de movimentações.
 */
router.post('/movimentacoes', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { conta_id, tipo, valor, data, descricao, categoria, observacoes } = req.body;

        if (!conta_id) return res.status(400).json({ error: 'Conta bancária não informada.' });
        if (!tipo || !['entrada', 'saida'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido. Use "entrada" ou "saida".' });
        const valorNum = parseFloat(valor);
        if (!valorNum || valorNum <= 0) return res.status(400).json({ error: 'Valor inválido.' });
        if (!data) return res.status(400).json({ error: 'Data não informada.' });
        if (!descricao || !descricao.trim()) return res.status(400).json({ error: 'Descrição não informada.' });

        // Buscar conta em contas_bancarias
        const [contaRows] = await connection.query(
            'SELECT id, saldo_atual FROM contas_bancarias WHERE id = ? AND ativo = 1 LIMIT 1',
            [conta_id]
        );

        if (contaRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Conta bancária não encontrada.' });
        }

        const saldoAtual = parseFloat(contaRows[0].saldo_atual) || 0;
        const novoSaldo = tipo === 'entrada' ? saldoAtual + valorNum : saldoAtual - valorNum;

        // Atualiza saldo da conta
        await connection.query(
            'UPDATE contas_bancarias SET saldo_atual = ?, updated_at = NOW() WHERE id = ?',
            [novoSaldo, conta_id]
        );

        // Registra no log de movimentações bancárias (banco_id = conta_id para rastreabilidade)
        await connection.query(
            `INSERT INTO movimentacoes_bancarias (banco_id, tipo, valor, saldo_apos, data, descricao, categoria, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [conta_id, tipo, valorNum, novoSaldo, data, descricao.trim(), categoria || null]
        ).catch(() => { /* tabela movimentacoes_bancarias pode não existir — ignora */ });

        await connection.commit();

        res.json({
            success: true,
            id: null,
            saldo: novoSaldo,
            message: 'Movimentação registrada com sucesso'
        });
    } catch (error) {
        await connection.rollback();
        console.error('[Financeiro] Erro ao registrar movimentação:', error);
        res.status(500).json({ error: 'Erro ao registrar movimentação' });
    } finally {
        connection.release();
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
        let novoStatus = 'liquidada';
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

        // Registrar movimentação bancária (saldo + linha no extrato) se tiver conta
        if (conta_bancaria_id) {
            await registrarMovimentacaoBancaria(connection, {
                conta_id: conta_bancaria_id,
                tipo: 'saida',
                valor: valorBaixa,
                data: data_pagamento || new Date().toISOString().slice(0, 10),
                cliente_fornecedor: contaAtual.fornecedor_nome || contaAtual.descricao,
                categoria: contaAtual.categoria_nome,
                numero_documento: contaAtual.numero_documento,
                nota_fiscal: contaAtual.nota_fiscal,
                observacoes: `Baixa CP #${id}${observacoes ? ' - ' + observacoes : ''}`,
                origem: 'baixa_pagar'
            });
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
        let novoStatus = 'liquidada';
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

        // Registrar movimentação bancária (saldo + linha no extrato) se tiver conta
        if (conta_bancaria_id) {
            await registrarMovimentacaoBancaria(connection, {
                conta_id: conta_bancaria_id,
                tipo: 'entrada',
                valor: valorBaixa,
                data: data_recebimento || new Date().toISOString().slice(0, 10),
                cliente_fornecedor: contaAtual.cliente_nome || contaAtual.descricao,
                categoria: contaAtual.categoria_nome,
                numero_documento: contaAtual.numero_documento,
                nota_fiscal: contaAtual.nota_fiscal,
                observacoes: `Baixa CR #${id}${observacoes ? ' - ' + observacoes : ''}`,
                origem: 'baixa_receber'
            });
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
        const corte = req.financeiroCorteTemporal;
        // Aceita inicio/fim (frontend) ou dataInicio/dataFim; janela padrão -30d..+90d
        const inicio = req.query.inicio || req.query.dataInicio
            || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
        const fim = req.query.fim || req.query.dataFim
            || new Date(Date.now() + 90*24*60*60*1000).toISOString().split('T')[0];

        // Saldo inicial das contas bancárias
        const [saldoInicial] = await pool.execute(
            'SELECT COALESCE(SUM(saldo_atual), 0) as saldo FROM contas_bancarias WHERE ativo = 1'
        );

        // RECEBER: realizados na data de recebimento, pendentes na data de vencimento.
        // Inclui TODOS os status não-cancelados (pendente/vencido/atrasado/aberto/recebido...).
        const [receber] = await pool.execute(`
            SELECT
                DATE(CASE WHEN cr.status IN ('recebido','pago','liquidado','parcial') AND cr.data_recebimento IS NOT NULL
                          THEN cr.data_recebimento ELSE cr.data_vencimento END) AS data,
                'entrada' AS tipo,
                CASE WHEN cr.status IN ('recebido','pago','liquidado')
                     THEN COALESCE(NULLIF(cr.valor_recebido,0), cr.valor)
                     ELSE (cr.valor - COALESCE(cr.valor_recebido,0)) END AS valor,
                cr.cliente_nome AS origem_destino, cr.descricao, cr.categoria_nome AS categoria, cr.status
            FROM contas_receber cr
            WHERE (cr.status IS NULL OR cr.status NOT IN ('cancelado','cancelada'))
              AND DATE(CASE WHEN cr.status IN ('recebido','pago','liquidado','parcial') AND cr.data_recebimento IS NOT NULL
                            THEN cr.data_recebimento ELSE cr.data_vencimento END) BETWEEN ? AND ?
              ${corte.crClause('cr')}
        `, [inicio, fim]);

        // PAGAR: realizados na data de pagamento, pendentes na data de vencimento.
        const [pagar] = await pool.execute(`
            SELECT
                DATE(CASE WHEN cp.status = 'pago' AND cp.data_pagamento IS NOT NULL
                          THEN cp.data_pagamento ELSE cp.data_vencimento END) AS data,
                'saida' AS tipo,
                CASE WHEN cp.status = 'pago'
                     THEN COALESCE(NULLIF(cp.valor_pago,0), cp.valor)
                     ELSE (cp.valor - COALESCE(cp.valor_pago,0)) END AS valor,
                cp.fornecedor_nome AS origem_destino, cp.descricao, cp.categoria_nome AS categoria, cp.status
            FROM contas_pagar cp
            WHERE (cp.status IS NULL OR cp.status NOT IN ('cancelado','cancelada'))
              AND DATE(CASE WHEN cp.status = 'pago' AND cp.data_pagamento IS NOT NULL
                            THEN cp.data_pagamento ELSE cp.data_vencimento END) BETWEEN ? AND ?
              ${corte.cpClause('cp')}
        `, [inicio, fim]);

        // Array plano de movimentos (contrato consumido pela página de Fluxo de Caixa)
        const toISO = (d) => (d instanceof Date ? d.toISOString().split('T')[0] : String(d || '').split('T')[0]);
        const data = [...receber, ...pagar]
            .map(m => ({
                data: toISO(m.data),
                tipo: m.tipo,
                valor: parseFloat(m.valor) || 0,
                origem_destino: m.origem_destino,
                descricao: m.descricao,
                categoria: m.categoria,
                status: m.status
            }))
            .sort((a, b) => String(a.data).localeCompare(String(b.data)));

        // Resumo diário + saldo acumulado (compatibilidade)
        const saldoIni = parseFloat(saldoInicial[0]?.saldo) || 0;
        const porDia = {};
        for (const m of data) {
            if (!porDia[m.data]) porDia[m.data] = { data: m.data, entradas: 0, saidas: 0, saldo: 0 };
            if (m.tipo === 'entrada') porDia[m.data].entradas += m.valor; else porDia[m.data].saidas += m.valor;
        }
        let saldoAcumulado = saldoIni;
        const fluxoArray = Object.values(porDia).sort((a, b) => a.data.localeCompare(b.data));
        for (const dia of fluxoArray) { saldoAcumulado += dia.entradas - dia.saidas; dia.saldo = saldoAcumulado; }

        const totalReceber = receber.reduce((acc, r) => acc + (parseFloat(r.valor) || 0), 0);
        const totalPagar = pagar.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);

        res.json({
            success: true,
            data,
            saldoInicial: saldoIni,
            totalReceber,
            totalPagar,
            saldoProjetado: saldoIni + totalReceber - totalPagar,
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
        const corte = req.financeiroCorteTemporal;

        // Receitas por categoria
        const [receitas] = await pool.execute(`
            SELECT
                COALESCE(cat.nome, 'Sem Categoria') as categoria,
                SUM(cr.valor_recebido) as valor
            FROM contas_receber cr
            LEFT JOIN categorias_financeiro cat ON cr.categoria_id = cat.id
            WHERE cr.status IN ('liquidada', 'pago')
              AND cr.data_recebimento BETWEEN ? AND ?
              ${corte.crClause('cr')}
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
            WHERE cp.status IN ('liquidada', 'pago')
              AND cp.data_recebimento BETWEEN ? AND ?
              ${corte.cpClause('cp')}
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
// ROTAS - POSIÇÃO DE FUNDOS (DEV SPEC 3.2)
// =====================================================

/**
 * GET /api/financeiro/fundos/posicao
 * Retorna posição consolidada de fundos por portador/banco
 * Agrupamento: Portador → A Vencer | Vencido | Liquidado | Total
 */
router.get('/fundos/posicao', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const corte = req.financeiroCorteTemporal;
        const hoje = new Date().toISOString().split('T')[0];

        const [posicao] = await pool.execute(`
            SELECT
                COALESCE(cr.portador, 'Sem Portador') as portador,
                COUNT(*) as total_titulos,
                SUM(cr.valor) as valor_total,
                SUM(CASE WHEN cr.status IN ('a_vencer') AND COALESCE(cr.data_vencimento, cr.vencimento) >= ? THEN cr.valor ELSE 0 END) as a_vencer,
                SUM(CASE WHEN cr.status IN ('vencida') OR (cr.status IN ('a_vencer','pendente') AND COALESCE(cr.data_vencimento, cr.vencimento) < ?) THEN cr.valor ELSE 0 END) as vencido,
                SUM(CASE WHEN cr.status IN ('liquidada','pago') THEN cr.valor ELSE 0 END) as liquidado,
                COUNT(CASE WHEN cr.status IN ('a_vencer') AND COALESCE(cr.data_vencimento, cr.vencimento) >= ? THEN 1 END) as qtd_a_vencer,
                COUNT(CASE WHEN cr.status IN ('vencida') OR (cr.status IN ('a_vencer','pendente') AND COALESCE(cr.data_vencimento, cr.vencimento) < ?) THEN 1 END) as qtd_vencido,
                COUNT(CASE WHEN cr.status IN ('liquidada','pago') THEN 1 END) as qtd_liquidado
            FROM contas_receber cr
            WHERE cr.status != 'cancelada'
              ${corte.crClause('cr')}
            GROUP BY COALESCE(cr.portador, 'Sem Portador')
            ORDER BY valor_total DESC
        `, [hoje, hoje, hoje, hoje]);

        // Totais gerais
        const totais = posicao.reduce((acc, p) => ({
            valor_total: acc.valor_total + (parseFloat(p.valor_total) || 0),
            a_vencer: acc.a_vencer + (parseFloat(p.a_vencer) || 0),
            vencido: acc.vencido + (parseFloat(p.vencido) || 0),
            liquidado: acc.liquidado + (parseFloat(p.liquidado) || 0),
            total_titulos: acc.total_titulos + (parseInt(p.total_titulos) || 0)
        }), { valor_total: 0, a_vencer: 0, vencido: 0, liquidado: 0, total_titulos: 0 });

        res.json({ success: true, posicao, totais, dataReferencia: hoje });
    } catch (error) {
        console.error('[Financeiro] Erro ao calcular posição de fundos:', error);
        res.status(500).json({ success: false, message: 'Erro ao calcular posição de fundos' });
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
        const corte = req.financeiroCorteTemporal;
        const [pagarVencidas] = await pool.execute(`
            SELECT
                id, descricao, valor,
                COALESCE(data_vencimento, vencimento) as vencimento,
                DATEDIFF(?, COALESCE(data_vencimento, vencimento)) as dias_atraso,
                'pagar' as tipo
            FROM contas_pagar cp
            WHERE cp.status = 'pendente'
              AND COALESCE(cp.data_vencimento, cp.vencimento) < ?
              ${corte.cpClause('cp')}
            ORDER BY vencimento
        `, [hoje, hoje]);

        // Contas a receber vencidas
        const [receberVencidas] = await pool.execute(`
            SELECT
                id, descricao, valor,
                COALESCE(data_vencimento, vencimento) as vencimento,
                DATEDIFF(?, COALESCE(data_vencimento, vencimento)) as dias_atraso,
                'receber' as tipo
            FROM contas_receber cr
            WHERE cr.status = 'pendente'
              AND COALESCE(cr.data_vencimento, cr.vencimento) < ?
              ${corte.crClause('cr')}
            ORDER BY vencimento
        `, [hoje, hoje]);

        // Contas vencendo nos próximos 7 dias
        const em7dias = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];

        const [pagarProximas] = await pool.execute(`
            SELECT id, descricao, valor, COALESCE(data_vencimento, vencimento) as vencimento, 'pagar' as tipo
            FROM contas_pagar cp
            WHERE cp.status = 'pendente'
              AND COALESCE(cp.data_vencimento, cp.vencimento) BETWEEN ? AND ?
              ${corte.cpClause('cp')}
            ORDER BY vencimento
        `, [hoje, em7dias]);

        const [receberProximas] = await pool.execute(`
            SELECT id, descricao, valor, COALESCE(data_vencimento, vencimento) as vencimento, 'receber' as tipo
            FROM contas_receber cr
            WHERE cr.status = 'pendente'
              AND COALESCE(cr.data_vencimento, cr.vencimento) BETWEEN ? AND ?
              ${corte.crClause('cr')}
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
        const corte = req.financeiroCorteTemporal;
        const [resultado] = await pool.execute(`
            SELECT
                COALESCE(f.razao_social, f.nome, cp.cnpj_cpf, 'Não Identificado') as fornecedor,
                COUNT(*) as quantidade,
                SUM(cp.valor) as total,
                SUM(CASE WHEN cp.status IN ('pendente', 'a_vencer') THEN cp.valor ELSE 0 END) as pendente,
                SUM(CASE WHEN cp.status IN ('liquidada', 'pago') THEN cp.valor ELSE 0 END) as pago
            FROM contas_pagar cp
            LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
            WHERE ${corte.rawClause('cp', { incluirParcelasFuturas: true })}
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
        const corte = req.financeiroCorteTemporal;
        const [resultado] = await pool.execute(`
            SELECT
                COALESCE(c.razao_social, c.nome_fantasia, cr.descricao, 'Não Identificado') as cliente,
                COUNT(*) as quantidade,
                SUM(cr.valor) as total,
                SUM(CASE WHEN cr.status IN ('pendente', 'a_vencer') THEN cr.valor ELSE 0 END) as pendente,
                SUM(CASE WHEN cr.status IN ('liquidada', 'pago') THEN cr.valor ELSE 0 END) as recebido
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            WHERE ${corte.rawClause('cr', { incluirParcelasFuturas: true })}
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
        let categorias;
        try {
            const [rows] = await pool.execute(`
                SELECT id, nome, tipo, cor, icone, descricao, pai_id, ativo
                FROM categorias_financeiras
                WHERE ativo = 1
                ORDER BY tipo, COALESCE(pai_id, id), CASE WHEN pai_id IS NULL THEN 0 ELSE 1 END, nome
            `);
            categorias = rows;
        } catch (err) {
            const [rows] = await pool.execute(`
                SELECT id, nome, tipo
                FROM categorias_financeiro
                ORDER BY tipo, nome
            `);
            categorias = rows;
        }
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
        const { codigo, nome, agencia, conta, tipo, apelido, saldo_inicial, observacoes, ativo,
                categoria, limite_credito, conta_vinculada, nao_considerar_resumo, data_saldo_inicial } = req.body;
        const [result] = await pool.query(
            `INSERT INTO bancos (nome, instituicao, tipo_conta, agencia, conta_corrente, saldo_inicial, saldo_atual, limite_credito, status, considera_fluxo, emite_boleto, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
            [apelido || nome || 'Conta', nome || apelido || '', tipo || categoria || 'Conta Corrente', agencia || '', conta || '',
             saldo_inicial || 0, saldo_inicial || 0, limite_credito || 0,
             ativo !== false ? 'ativo' : 'inativo', nao_considerar_resumo ? 0 : 1]
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
        const { codigo, nome, agencia, conta, tipo, apelido, observacoes, ativo,
                categoria, limite_credito, nao_considerar_resumo } = req.body;
        await pool.query(
            `UPDATE bancos SET nome=?, instituicao=?, tipo_conta=?, agencia=?, conta_corrente=?,
             limite_credito=?, status=?, considera_fluxo=?, updated_at=NOW() WHERE id=?`,
            [apelido || nome, nome || apelido || '', tipo || categoria || 'Conta Corrente',
             agencia, conta, limite_credito || 0,
             ativo !== false ? 'ativo' : 'inativo', nao_considerar_resumo ? 0 : 1, id]
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
        // AUDIT-FIX R3: Soft delete em vez de hard DELETE
        await pool.query('UPDATE bancos SET ativo = 0 WHERE id = ?', [id]);
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

// Extrato bancário (usado pelo modal extrato em bancos.html)
router.get('/bancos/:id/extrato', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { data_inicio, data_fim, limit = 500 } = req.query;
        let sql = `
            SELECT m.*, m.cliente_fornecedor as descricao, m.cliente_fornecedor as descrição, m.saldo as saldo_apos,
                   b.nome as banco_nome, b.apelido as banco_apelido
            FROM movimentacoes_bancarias m
            JOIN bancos b ON m.banco_id = b.id
            WHERE m.banco_id = ?
        `;
        const params = [id];
        if (data_inicio) { sql += ' AND m.data >= ?'; params.push(data_inicio); }
        if (data_fim) { sql += ' AND m.data <= ?'; params.push(data_fim); }
        sql += ' ORDER BY m.data DESC, m.id DESC LIMIT ?';
        params.push(parseInt(limit));
        const [movimentacoes] = await pool.execute(sql, params);
        res.json(movimentacoes);
    } catch (error) {
        console.error('[Financeiro] Erro ao buscar extrato:', error);
        if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
        res.status(500).json({ error: 'Erro ao buscar extrato' });
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

// =====================================================
// HELPERS — Movimentações bancárias (extrato + saldo)
// Schema real de movimentacoes_bancarias: (banco_id, tipo['entrada'|'saida'|'transferencia'],
// valor, saldo[running], data, cliente_fornecedor, categoria, numero_documento, nota_fiscal,
// observacoes, origem, ...). O saldo corrente vive em contas_bancarias.saldo_atual.
// =====================================================

/**
 * Resolve o id de uma conta bancária a partir do nome (match exato → parcial).
 * @returns {number|null} id da conta ou null se não encontrar.
 */
async function resolverContaBancariaId(conn, nome) {
    if (!nome) return null;
    const n = String(nome).trim();
    if (!n) return null;
    const [rows] = await conn.query(
        `SELECT id FROM contas_bancarias
         WHERE ativo = 1 AND (nome = ? OR nome LIKE ?)
         ORDER BY (nome = ?) DESC, id ASC LIMIT 1`,
        [n, `%${n}%`, n]
    );
    return rows.length ? rows[0].id : null;
}

/**
 * Registra uma movimentação bancária de forma atômica: atualiza contas_bancarias.saldo_atual
 * e insere a linha em movimentacoes_bancarias com o saldo corrente (running balance).
 * DEVE ser chamada dentro de uma transação (usa FOR UPDATE na conta).
 * @returns {number|null} novo saldo, ou null se a conta não existir/params inválidos.
 */
async function registrarMovimentacaoBancaria(conn, opts) {
    const { conta_id, tipo, valor, data, cliente_fornecedor, categoria,
            numero_documento, nota_fiscal, observacoes, origem } = opts;
    const valorNum = parseFloat(valor) || 0;
    if (!conta_id || valorNum <= 0 || !['entrada', 'saida'].includes(tipo)) return null;

    const [rows] = await conn.query(
        'SELECT id, saldo_atual FROM contas_bancarias WHERE id = ? AND ativo = 1 FOR UPDATE',
        [conta_id]
    );
    if (!rows.length) return null;

    const saldoAtual = parseFloat(rows[0].saldo_atual) || 0;
    const novoSaldo = tipo === 'entrada' ? saldoAtual + valorNum : saldoAtual - valorNum;

    await conn.query(
        'UPDATE contas_bancarias SET saldo_atual = ?, updated_at = NOW() WHERE id = ?',
        [novoSaldo, conta_id]
    );
    await conn.query(
        `INSERT INTO movimentacoes_bancarias
            (banco_id, tipo, valor, saldo, data, cliente_fornecedor, categoria,
             numero_documento, nota_fiscal, observacoes, origem, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [conta_id, tipo, valorNum, novoSaldo, data || new Date().toISOString().slice(0, 10),
         cliente_fornecedor || null, categoria || null,
         numero_documento || null, nota_fiscal || null, observacoes || null, origem || 'manual']
    );
    return novoSaldo;
}

/**
 * Idempotência: evita duplicar a mesma movimentação quando a planilha é reimportada.
 * Chave natural: banco_id + tipo + valor + data + origem + documento (num/nf/cliente).
 */
async function movimentacaoJaExiste(conn, { conta_id, tipo, valor, data, origem, chaveDoc }) {
    const [rows] = await conn.query(
        `SELECT id FROM movimentacoes_bancarias
         WHERE banco_id = ? AND tipo = ? AND valor = ? AND data = ? AND origem = ?
           AND COALESCE(numero_documento, nota_fiscal, cliente_fornecedor, '') = ?
         LIMIT 1`,
        [conta_id, tipo, parseFloat(valor) || 0, data, origem, chaveDoc || '']
    );
    return rows.length > 0;
}

/**
 * Gera (fora da transação-mãe) a movimentação bancária de uma conta paga/recebida importada.
 * Abre sua própria conexão/transação, é idempotente e nunca lança — só retorna se gerou.
 * @returns {boolean} true se uma nova movimentação foi criada.
 */
async function gerarMovimentacaoDeImportacao({ contaNome, tipo, valor, data, cliente_fornecedor,
                                               categoria, numero_documento, origem }) {
    if (!contaNome) return false;
    const valorNum = parseFloat(valor) || 0;
    if (valorNum <= 0 || !data) return false;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const contaId = await resolverContaBancariaId(conn, contaNome);
        if (!contaId) { await conn.rollback(); return false; }
        const chaveDoc = numero_documento || cliente_fornecedor || '';
        const jaExiste = await movimentacaoJaExiste(conn, {
            conta_id: contaId, tipo, valor: valorNum, data, origem, chaveDoc
        });
        if (jaExiste) { await conn.rollback(); return false; }
        await registrarMovimentacaoBancaria(conn, {
            conta_id: contaId, tipo, valor: valorNum, data,
            cliente_fornecedor, categoria,
            numero_documento, nota_fiscal: null, // mantém a chave de idempotência determinística
            observacoes: cliente_fornecedor, origem
        });
        await conn.commit();
        return true;
    } catch (e) {
        try { await conn.rollback(); } catch (_) { /* noop */ }
        console.error('[Financeiro] gerarMovimentacaoDeImportacao:', e.message);
        return false;
    } finally {
        conn.release();
    }
}

// =====================================================
// IMPORTAÇÃO EM LOTE - Contas a Pagar
// =====================================================
router.post('/importar/contas-pagar', authenticateToken, authorizeFinanceiro('pagar'), async (req, res) => {
    try {
        const { dados } = req.body;
        if (!Array.isArray(dados) || dados.length === 0) {
            return res.status(400).json({ error: 'Nenhum dado recebido para importação' });
        }

        let importados = 0;
        let movimentacoes = 0;
        const erros = [];
        const parseDataSimples = (d) => {
            if (!d) return null;
            const dt = new Date(d);
            return isNaN(dt.getTime()) ? null : dt.toISOString().split('T')[0];
        };

        for (let i = 0; i < dados.length; i++) {
            const item = dados[i];
            try {
                const descricao = sanitizeString(item.descricao || item.fornecedor_nome || item.favorecido || item.historico || '');
                const valor = parseFloat(item.valor || item.valor_total || 0);
                const vencimento = item.data_vencimento || item.vencimento || item.dt_vcto || null;
                const categoria = sanitizeString(item.categoria || item.categoria_nome || item.conta_financeira || '');
                const fornecedor = sanitizeString(item.fornecedor_nome || item.favorecido || item.fornecedor || descricao);
                const empresa = sanitizeString(item.empresa || 'ALUFORCE');
                const observacoes = sanitizeString(item.observacoes || item.descricao_obs || '');
                const numero_documento = sanitizeString(item.numero_documento || item.nota_fiscal || '');
                const forma_pagamento = sanitizeString(item.forma_pagamento || '');
                const status = sanitizeString(item.status || 'pendente').toLowerCase();
                const contaNome = sanitizeString(item.conta_corrente_nome || item.conta_bancaria || '');
                const mesRef = sanitizeString(item.mes_referencia || '');

                if (!valor || valor <= 0) {
                    erros.push({ linha: i + 2, erro: 'Valor inválido ou zero' });
                    continue;
                }

                let dataVenc = null;
                if (vencimento) {
                    const d = new Date(vencimento);
                    if (!isNaN(d.getTime())) {
                        dataVenc = d.toISOString().split('T')[0];
                    }
                }
                if (!dataVenc) {
                    erros.push({ linha: i + 2, erro: 'Data de vencimento inválida' });
                    continue;
                }

                const dataPagamento = parseDataSimples(item.data_pagamento);
                const valorPago = parseFloat(item.valor_pagamento || item.valor_pago || 0) || null;
                const pago = ['pago', 'liquidada', 'liquidado', 'quitado'].includes(status) || !!dataPagamento;
                const descricaoFinal = fornecedor + (descricao && descricao !== fornecedor ? ' - ' + descricao : '');

                await pool.execute(
                    `INSERT INTO contas_pagar
                        (descricao, valor, data_vencimento, data_vencimento_original, categoria_nome,
                         forma_pagamento, observacoes, numero_documento, status,
                         fornecedor_nome, conta_corrente_nome, data_pagamento, valor_pago,
                         data_emissao, mes_referencia, origem)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importacao')`,
                    [descricaoFinal, valor, dataVenc, dataVenc, categoria,
                     forma_pagamento, (empresa + ' ' + observacoes).trim(), numero_documento,
                     pago ? 'pago' : status,
                     fornecedor || null, contaNome || null, dataPagamento, valorPago,
                     parseDataSimples(item.data_emissao), mesRef || null]
                );
                importados++;

                // Conta paga com conta bancária identificável → gera a saída no extrato bancário
                if (pago && contaNome) {
                    const gerou = await gerarMovimentacaoDeImportacao({
                        contaNome,
                        tipo: 'saida',
                        valor: valorPago || valor,
                        data: dataPagamento || dataVenc,
                        cliente_fornecedor: fornecedor,
                        categoria,
                        numero_documento,
                        origem: 'importacao_pagar'
                    });
                    if (gerou) movimentacoes++;
                }
            } catch (err) {
                erros.push({ linha: i + 2, erro: err.message });
            }
        }

        res.json({ success: true, importados, movimentacoes, total: dados.length, erros });
    } catch (error) {
        console.error('[Financeiro] Erro na importação contas-pagar:', error);
        res.status(500).json({ error: 'Erro na importação de contas a pagar' });
    }
});

// =====================================================
// IMPORTAÇÃO EXCEL (FILE UPLOAD) - Contas a Receber
// =====================================================
router.post('/contas-receber/importar-excel', authenticateToken, authorizeFinanceiro('receber'), excelUpload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const workbook = await SpreadsheetReader.read(req.file.buffer);

        // Auto-detect best sheet: prefer FATURAMENTO, then first sheet
        const preferredSheets = ['FATURAMENTO', 'A RECEBER', 'CONTAS A RECEBER'];
        let sheetName = workbook.SheetNames[0];
        for (const pref of preferredSheets) {
            if (workbook.SheetNames.includes(pref)) { sheetName = pref; break; }
        }
        const sheet = workbook.Sheets[sheetName];
        console.log('[IMPORTAR-CR] Usando aba:', sheetName, '| Abas disponíveis:', workbook.SheetNames.join(', '));

        const rawData = SpreadsheetReader.utils.sheet_to_json(sheet, { header: 1, raw: true });
        if (!rawData || rawData.length < 2) {
            throw new Error('Arquivo vazio ou sem dados');
        }

        // Detect header row
        const HEADER_KEYWORDS = ['EMPRESA', 'CLIENTE', 'CNPJ', 'VALOR', 'VCTO', 'NFe', 'EMISSÃO', 'EMISSAO', 'Empresa', 'Cliente', 'Vencimento'];
        let headerRowIdx = 0;
        for (let i = 0; i < Math.min(rawData.length, 15); i++) {
            const row = rawData[i];
            if (!row) continue;
            const rowStr = row.map(c => String(c || '')).join('|').toUpperCase();
            const matches = HEADER_KEYWORDS.filter(kw => rowStr.includes(kw.toUpperCase()));
            if (matches.length >= 3) { headerRowIdx = i; break; }
        }
        const headers = (rawData[headerRowIdx] || []).map(h => String(h || '').trim());
        console.log('[IMPORTAR-CR] Header na linha:', headerRowIdx + 1, '| Colunas:', headers.join(', '));

        // Column name mapping: Excel header → DB field
        const COLUMN_MAP = {
            'EMPRESA': 'empresa', 'Empresa': 'empresa', 'empresa': 'empresa',
            'EMISSÃO': 'data_emissao', 'Emissão': 'data_emissao', 'Emissao': 'data_emissao', 'emissao': 'data_emissao', 'Data de Emissão': 'data_emissao',
            'TIPO': 'tipo_documento', 'Tipo': 'tipo_documento', 'tipo': 'tipo_documento', 'Tipo de Documento': 'tipo_documento',
            'NFe': 'nota_fiscal', 'nfe': 'nota_fiscal', 'Nota Fiscal': 'nota_fiscal', 'NF': 'nota_fiscal',
            'P': 'parcela_info', 'Parcela': 'parcela_info', 'parcela': 'parcela_info',
            'CLIENTE': 'cliente_nome', 'Cliente': 'cliente_nome', 'cliente': 'cliente_nome',
            'CNPJ': 'cnpj_cliente', 'cnpj': 'cnpj_cliente', 'CNPJ/CPF': 'cnpj_cliente',
            'VALOR P': 'valor', 'Valor': 'valor', 'valor': 'valor', 'Valor da Conta': 'valor',
            'VCTO': 'data_vencimento', 'Vencimento': 'data_vencimento', 'vencimento': 'data_vencimento', 'Data de Vencimento': 'data_vencimento',
            'SITUAÇÃO': 'situacao', 'Situação': 'situacao', 'Situacao': 'situacao', 'situacao': 'situacao',
            'PORTADOR': 'portador', 'Portador': 'portador', 'portador': 'portador',
            'DATA': 'data_operacao',
            'STATUS': 'status', 'Status': 'status', 'status': 'status',
            'DIAS': 'dias_vencido',
            'POSIÇÃO': 'posicao', 'Posição': 'posicao',
            'RECOMPRADO': 'recomprado',
            'CARTORIO': 'cartorio',
            'OBSERVAÇÃO': 'observacoes', 'Observação': 'observacoes', 'Observacao': 'observacoes', 'Observações': 'observacoes',
            'ACEITA TROCA  FACTORY': 'aceita_troca', 'ACEITA TROCA FACTORY': 'aceita_troca',
            'COMISSÁRIA': 'comissaria', 'COMISSARIA': 'comissaria',
            'Vendedor': 'vendedor', 'VENDEDOR': 'vendedor',
            'Conta Corrente': 'conta_corrente_nome', 'CONTA CORRENTE': 'conta_corrente_nome',
            'Categoria': 'categoria_nome', 'CATEGORIA': 'categoria_nome',
            'Número do Documento': 'numero_documento', 'DOCUMENTO': 'numero_documento',
            'Número do Boleto': 'numero_boleto', 'BOLETO': 'numero_boleto',
            'Projeto': 'projeto', 'PROJETO': 'projeto',
            'PIS': 'valor_pis', 'COFINS': 'valor_cofins', 'CSLL': 'valor_csll',
            'IR': 'valor_ir', 'ISS': 'valor_iss', 'INSS': 'valor_inss'
        };

        const colMap = {};
        for (let i = 0; i < headers.length; i++) {
            const mapped = COLUMN_MAP[headers[i]];
            if (mapped && !(mapped in colMap)) colMap[mapped] = i;
        }
        console.log('[IMPORTAR-CR] Mapeamento:', JSON.stringify(colMap));

        const getVal = (row, field) => {
            if (!(field in colMap)) return null;
            const v = row[colMap[field]];
            return (v !== undefined && v !== null && v !== '') ? v : null;
        };

        const parseData = (d) => {
            if (!d) return null;
            if (d instanceof Date) return d.toISOString().slice(0, 10);
            if (typeof d === 'number') {
                const dt = SpreadsheetReader.SSF.parse_date_code(d);
                if (dt) return `${dt.y}-${String(dt.m).padStart(2,'0')}-${String(dt.d).padStart(2,'0')}`;
            }
            const s = String(d).trim();
            const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
            return null;
        };

        const parseValor = (v) => {
            if (!v) return 0;
            if (typeof v === 'number') return v;
            const s = String(v).replace(/[^\d,.-]/g, '').replace(',', '.');
            return parseFloat(s) || 0;
        };

        // Delete previous imports
        const [delResult] = await pool.execute(`DELETE FROM contas_receber WHERE
            origem_integracao = 'importacao_excel'
            OR (empresa IS NULL AND nota_fiscal IS NULL AND cnpj_cliente IS NULL AND data_emissao IS NULL AND origem_integracao = 'manual')`);
        console.log('[IMPORTAR-CR] Registros anteriores removidos:', delResult.affectedRows);

        let importados = 0;
        let erros = 0;
        let erroDetalhe = [];

        for (let i = headerRowIdx + 1; i < rawData.length; i++) {
            const row = rawData[i];
            if (!row || row.length === 0) continue;

            try {
                const cliente = getVal(row, 'cliente_nome');
                const valorRaw = getVal(row, 'valor');
                const valor = parseValor(valorRaw);

                if (!cliente && !valor) continue;
                if (String(cliente || '').toUpperCase() === 'CLIENTE') continue;
                if (String(getVal(row, 'empresa') || '').toUpperCase() === 'DADOS DA NF') continue;

                const empresa = String(getVal(row, 'empresa') || '').trim();
                const nfe = String(getVal(row, 'nota_fiscal') || '').trim();
                const parcela = String(getVal(row, 'parcela_info') || '').trim();
                const cnpj = String(getVal(row, 'cnpj_cliente') || '').trim();
                const emissao = parseData(getVal(row, 'data_emissao'));
                const vencimento = parseData(getVal(row, 'data_vencimento'));
                const situacao = String(getVal(row, 'situacao') || '').trim();
                const portador = String(getVal(row, 'portador') || '').trim();
                const dataOp = parseData(getVal(row, 'data_operacao'));
                const statusRaw = String(getVal(row, 'status') || '').trim().toUpperCase();
                const diasRaw = getVal(row, 'dias_vencido');
                const dias = diasRaw ? parseInt(diasRaw) || 0 : null;
                const posicao = String(getVal(row, 'posicao') || '').trim();
                const recomprado = String(getVal(row, 'recomprado') || '').trim();
                const cartorio = String(getVal(row, 'cartorio') || '').trim();
                const obs = String(getVal(row, 'observacoes') || '').trim();
                const aceitaTroca = String(getVal(row, 'aceita_troca') || '').trim();
                const comissaria = String(getVal(row, 'comissaria') || '').trim();
                const tipoDoc = String(getVal(row, 'tipo_documento') || '').trim();
                const vendedor = String(getVal(row, 'vendedor') || '').trim();
                const contaCorrente = String(getVal(row, 'conta_corrente_nome') || '').trim();
                const categoria = String(getVal(row, 'categoria_nome') || '').trim();
                const numDocumento = String(getVal(row, 'numero_documento') || '').trim();
                const numBoleto = String(getVal(row, 'numero_boleto') || '').trim();
                const projeto = String(getVal(row, 'projeto') || '').trim();

                const pis = parseValor(getVal(row, 'valor_pis'));
                const cofins = parseValor(getVal(row, 'valor_cofins'));
                const csll = parseValor(getVal(row, 'valor_csll'));
                const ir = parseValor(getVal(row, 'valor_ir'));
                const iss = parseValor(getVal(row, 'valor_iss'));
                const inss = parseValor(getVal(row, 'valor_inss'));

                let statusFinal = 'a_vencer';
                if (statusRaw === 'LIQUIDADO' || statusRaw === 'LIQUIDADA') statusFinal = 'liquidada';
                else if (statusRaw === 'VENCIDO' || statusRaw === 'VENCIDA') statusFinal = 'vencida';
                else if (statusRaw === 'A VENCER') statusFinal = 'a_vencer';
                else if (statusRaw === 'RECOMPRADO' || statusRaw === 'RECOMPRADA') statusFinal = 'liquidada';
                else if (statusRaw) statusFinal = statusRaw.toLowerCase().replace(/ /g, '_');

                const emissaoFinal = emissao || new Date().toISOString().slice(0,10);
                const vencimentoFinal = vencimento || emissaoFinal;
                const valorLiquido = valor - pis - cofins - csll - ir - iss - inss;

                await pool.execute(
                    `INSERT INTO contas_receber
                     (empresa, nota_fiscal, parcela_info, cliente_nome, cnpj_cliente,
                      data_emissao, data_vencimento, valor, tipo_documento,
                      situacao, portador, data_operacao, status, dias_vencido,
                      posicao, recomprado, cartorio, observacoes,
                      aceita_troca, comissaria, vendedor,
                      conta_corrente_nome, categoria_nome, numero_documento, numero_boleto, projeto,
                      valor_pis, valor_cofins, valor_csll, valor_ir, valor_iss, valor_inss,
                      valor_liquido, a_receber, origem_integracao)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'importacao_excel')`,
                    [empresa || null, nfe || null, parcela || null, cliente || null, cnpj || null,
                     emissaoFinal, vencimentoFinal, valor, tipoDoc || null,
                     situacao || null, portador || null, dataOp, statusFinal, dias,
                     posicao || null, recomprado || null, cartorio || null, obs || null,
                     aceitaTroca || null, comissaria || null, vendedor || null,
                     contaCorrente || null, categoria || tipoDoc || null, numDocumento || null, numBoleto || null, projeto || null,
                     pis, cofins, csll, ir, iss, inss,
                     valorLiquido, valorLiquido]
                );
                importados++;
            } catch (e) {
                erros++;
                erroDetalhe.push({ linha: i + 1, erro: e.message });
                console.error(`Erro importando linha ${i + 1}:`, e.message);
            }
        }

        console.log('[IMPORTAR-CR] Concluído:', importados, 'importados |', erros, 'erros | Aba:', sheetName);
        res.json({ success: true, importados, erros, sheet: sheetName, erroDetalhe: erroDetalhe.slice(0, 10) });
    } catch (error) {
        console.error('❌ Erro ao importar Excel:', error);
        res.status(500).json({ error: 'Erro ao importar arquivo', message: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// =====================================================
// IMPORTAÇÃO EM LOTE - Contas a Receber
// =====================================================
router.post('/importar/contas-receber', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const { dados } = req.body;
        if (!Array.isArray(dados) || dados.length === 0) {
            return res.status(400).json({ error: 'Nenhum dado recebido para importação' });
        }

        let importados = 0;
        let movimentacoes = 0;
        const erros = [];
        const parseDate = (d) => {
            if (!d) return null;
            const dt = new Date(d);
            return isNaN(dt.getTime()) ? null : dt.toISOString().split('T')[0];
        };

        for (let i = 0; i < dados.length; i++) {
            const item = dados[i];
            try {
                const empresa      = sanitizeString(item.empresa || '');
                const clienteNome  = sanitizeString(item.cliente_nome || item.cliente || item.origem || '');
                const cnpjCliente  = sanitizeString(item.cnpj_cliente || item.cnpj || '');
                const notaFiscal   = sanitizeString(item.nota_fiscal || '');
                const parcelaInfo  = sanitizeString(item.parcela_info || '');
                const descricao    = sanitizeString(item.descricao || item.tipo || notaFiscal || clienteNome || '');
                const valor        = parseFloat(item.valor || item.valor_bruto || 0);
                const vencimento   = item.data_vencimento || item.vencimento || item.dt_entrada || null;
                const situacao     = sanitizeString(item.situacao || '');
                const portador     = sanitizeString(item.portador || '');
                const observacoes  = sanitizeString(item.observacoes || '');
                const diasVencido  = parseInt(item.dias_vencido) || null;
                const posicao      = sanitizeString(item.posicao || '');
                const categoria    = sanitizeString(item.categoria_nome || item.categoria || item.conta_financeira || '');
                const contaNome    = sanitizeString(item.conta_corrente_nome || item.conta_bancaria || '');
                const mesRef       = sanitizeString(item.mes_referencia || '');
                const diaRecomprado    = item.dia_recomprado || item.dt_recompra || null;
                const dataParaCartorio = item.data_para_cartorio || item.dt_cartorio || null;
                const dataProtestado   = item.data_protestado || item.dt_protesto || null;

                // Recebimento (planilha "Recebimentos" traz DT ENTRADA / VALOR BRUTO / CONTA BANCÁRIA)
                const rawStatus = sanitizeString(item.status || '').toLowerCase();
                const dataRecebimento = parseDate(item.data_recebimento || item.dt_entrada);
                const valorRecebido = parseFloat(item.valor_recebido || 0) || null;
                const recebido = ['recebido', 'liquidado', 'liquidada', 'pago'].includes(rawStatus) || !!dataRecebimento;

                // Normalize status (novo domínio + compat legado)
                let status = (rawStatus || 'a_vencer');
                const statusMap = {
                    'pendente': 'a_vencer', 'a vencer': 'a_vencer', 'a_vencer': 'a_vencer',
                    'vencido': 'vencida', 'vencida': 'vencida',
                    'liquidado': 'liquidada', 'liquidada': 'liquidada', 'recebido': 'liquidada', 'pago': 'liquidada',
                    'cancelado': 'cancelada', 'cancelada': 'cancelada',
                    'parcial': 'a_vencer'
                };
                status = statusMap[status] || 'a_vencer';

                if (!valor || valor <= 0) {
                    erros.push({ linha: i + 2, erro: 'Valor inválido ou zero' });
                    continue;
                }

                const dataVenc = parseDate(vencimento);
                if (!dataVenc) {
                    erros.push({ linha: i + 2, erro: 'Data de vencimento inválida' });
                    continue;
                }

                await pool.execute(
                    `INSERT INTO contas_receber
                     (empresa, cliente_nome, descricao, cnpj_cliente, nota_fiscal, parcela_info,
                      valor, vencimento, data_vencimento, status, situacao, portador,
                      dias_vencido, posicao, observacoes, origem_importacao,
                      dia_recomprado, data_para_cartorio, data_protestado,
                      categoria_nome, conta_corrente_nome, data_recebimento, valor_recebido, mes_referencia)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'excel', ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [empresa, clienteNome || descricao, descricao, cnpjCliente, notaFiscal, parcelaInfo,
                     valor, dataVenc, dataVenc, status, situacao, portador,
                     diasVencido, posicao, observacoes,
                     parseDate(diaRecomprado), parseDate(dataParaCartorio), parseDate(dataProtestado),
                     categoria || null, contaNome || null, dataRecebimento, valorRecebido, mesRef || null]
                );
                importados++;

                // Conta recebida com conta bancária identificável → gera a entrada no extrato bancário
                if (recebido && contaNome) {
                    const gerou = await gerarMovimentacaoDeImportacao({
                        contaNome,
                        tipo: 'entrada',
                        valor: valorRecebido || valor,
                        data: dataRecebimento || dataVenc,
                        cliente_fornecedor: clienteNome,
                        categoria,
                        numero_documento: notaFiscal,
                        origem: 'importacao_receber'
                    });
                    if (gerou) movimentacoes++;
                }
            } catch (err) {
                erros.push({ linha: i + 2, erro: err.message });
            }
        }

        res.json({ success: true, importados, movimentacoes, total: dados.length, erros });
    } catch (error) {
        console.error('[Financeiro] Erro na importação contas-receber:', error);
        res.status(500).json({ error: 'Erro na importação de contas a receber' });
    }
});

// =====================================================
// IMPORTAÇÃO EM LOTE - Fluxo de Caixa / Bancos / Movimentações
// =====================================================
router.post('/importar/fluxo-caixa', authenticateToken, async (req, res) => {
    try {
        const { dados } = req.body;
        if (!Array.isArray(dados) || dados.length === 0) {
            return res.status(400).json({ error: 'Nenhum dado recebido' });
        }
        // Redirecionar para as tabelas apropriadas baseado no tipo
        let importados = 0;
        const erros = [];
        for (let i = 0; i < dados.length; i++) {
            const item = dados[i];
            try {
                const tipo = (item.tipo || '').toLowerCase();
                const valor = parseFloat(item.valor || 0);
                if (!valor) { erros.push({ linha: i+2, erro: 'Valor inválido' }); continue; }
                const descricao = sanitizeString(item.descricao || item.cliente_fornecedor || '');
                const data = item.data_prevista || item.data || null;
                let dataFmt = null;
                if (data) { const d = new Date(data); if (!isNaN(d.getTime())) dataFmt = d.toISOString().split('T')[0]; }
                if (!dataFmt) { erros.push({ linha: i+2, erro: 'Data inválida' }); continue; }

                if (tipo === 'entrada' || tipo === 'receita') {
                    await pool.execute('INSERT INTO contas_receber (cliente_nome, descricao, valor, vencimento, data_vencimento, status) VALUES (?, ?, ?, ?, ?, "PENDENTE")', [descricao, descricao, valor, dataFmt, dataFmt]);
                } else {
                    await pool.execute('INSERT INTO contas_pagar (descricao, valor, data_vencimento, data_vencimento_original, status) VALUES (?, ?, ?, ?, "pendente")', [descricao, valor, dataFmt, dataFmt]);
                }
                importados++;
            } catch (err) { erros.push({ linha: i+2, erro: err.message }); }
        }
        res.json({ success: true, importados, total: dados.length, erros });
    } catch (error) {
        console.error('[Financeiro] Erro importação fluxo-caixa:', error);
        res.status(500).json({ error: 'Erro na importação' });
    }
});

// =====================================================
// IMPORTAÇÃO EM LOTE - Movimentações bancárias (extrato)
// Template: template_movimentacoes.xlsx (Data / Conta Bancária / Tipo / Valor /
// Cliente-Fornecedor / Categoria / Número Documento / Nota Fiscal / Parcela / Observações)
// Cada linha vira uma entrada/saída real no extrato + ajusta o saldo da conta.
// =====================================================
router.post('/importar/movimentacoes', authenticateToken, async (req, res) => {
    try {
        const { dados } = req.body;
        if (!Array.isArray(dados) || dados.length === 0) {
            return res.status(400).json({ error: 'Nenhum dado recebido para importação' });
        }

        const parseDate = (d) => {
            if (!d) return null;
            const dt = new Date(d);
            return isNaN(dt.getTime()) ? null : dt.toISOString().split('T')[0];
        };
        const normalizarTipo = (t) => {
            const s = sanitizeString(t || '').toLowerCase();
            if (['entrada', 'crédito', 'credito', 'c', 'receita', 'recebimento'].includes(s)) return 'entrada';
            if (['saida', 'saída', 'débito', 'debito', 'd', 'despesa', 'pagamento'].includes(s)) return 'saida';
            return null;
        };

        let importados = 0;
        let duplicados = 0;
        const erros = [];

        for (let i = 0; i < dados.length; i++) {
            const item = dados[i];
            const conn = await pool.getConnection();
            try {
                const tipo = normalizarTipo(item.tipo);
                const valor = parseFloat(item.valor || 0);
                const data = parseDate(item.data || item.data_prevista);
                const contaNome = sanitizeString(item.conta_bancaria || item.conta_corrente_nome || '');
                const clienteFornecedor = sanitizeString(item.cliente_fornecedor || '');
                const categoria = sanitizeString(item.categoria || '');
                const numeroDoc = sanitizeString(item.numero_documento || '');
                const notaFiscal = sanitizeString(item.nota_fiscal || '');
                const observacoes = sanitizeString(item.observacoes || '');

                // Validações (o finally libera a conexão em qualquer caminho, inclusive continue)
                if (!tipo) { erros.push({ linha: i + 2, erro: 'Tipo inválido (use Entrada/Saída)' }); continue; }
                if (!valor || valor <= 0) { erros.push({ linha: i + 2, erro: 'Valor inválido ou zero' }); continue; }
                if (!data) { erros.push({ linha: i + 2, erro: 'Data inválida' }); continue; }
                if (!contaNome) { erros.push({ linha: i + 2, erro: 'Conta bancária não informada' }); continue; }

                await conn.beginTransaction();
                const contaId = await resolverContaBancariaId(conn, contaNome);
                if (!contaId) {
                    await conn.rollback();
                    erros.push({ linha: i + 2, erro: `Conta bancária "${contaNome}" não encontrada` });
                    continue;
                }

                const chaveDoc = numeroDoc || notaFiscal || clienteFornecedor || '';
                const jaExiste = await movimentacaoJaExiste(conn, {
                    conta_id: contaId, tipo, valor, data, origem: 'importacao_mov', chaveDoc
                });
                if (jaExiste) {
                    await conn.rollback();
                    duplicados++;
                    continue;
                }

                await registrarMovimentacaoBancaria(conn, {
                    conta_id: contaId, tipo, valor, data,
                    cliente_fornecedor: clienteFornecedor,
                    categoria,
                    numero_documento: numeroDoc,
                    nota_fiscal: notaFiscal,
                    observacoes,
                    origem: 'importacao_mov'
                });
                await conn.commit();
                importados++;
            } catch (err) {
                try { await conn.rollback(); } catch (_) { /* noop */ }
                erros.push({ linha: i + 2, erro: err.message });
            } finally {
                conn.release();
            }
        }

        res.json({ success: true, importados, duplicados, total: dados.length, erros });
    } catch (error) {
        console.error('[Financeiro] Erro na importação de movimentações:', error);
        res.status(500).json({ error: 'Erro na importação de movimentações bancárias' });
    }
});

// =====================================================
// IMPORTAÇÃO EM LOTE - Contas bancárias
// Template: template_bancos.xlsx. Upsert por nome (não sobrescreve saldo de conta existente).
// =====================================================
router.post('/importar/bancos', authenticateToken, async (req, res) => {
    try {
        const { dados } = req.body;
        if (!Array.isArray(dados) || dados.length === 0) {
            return res.status(400).json({ error: 'Nenhum dado recebido para importação' });
        }

        const toBool = (v) => {
            const s = sanitizeString(v || '').toLowerCase();
            return ['sim', 's', 'true', '1', 'x', 'yes'].includes(s) ? 1 : 0;
        };
        const toNum = (v) => {
            if (v === undefined || v === null || v === '') return 0;
            if (typeof v === 'number') return v;
            const s = String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
            return parseFloat(s) || 0;
        };

        let importados = 0;
        let duplicados = 0;
        const erros = [];

        for (let i = 0; i < dados.length; i++) {
            const item = dados[i];
            try {
                const nome = sanitizeString(item.nome || '');
                if (!nome) { erros.push({ linha: i + 2, erro: 'Nome da conta obrigatório' }); continue; }

                const [existe] = await pool.query('SELECT id FROM contas_bancarias WHERE nome = ? LIMIT 1', [nome]);
                if (existe.length) { duplicados++; continue; }

                const saldoInicial = toNum(item.saldo_inicial);
                await pool.execute(
                    `INSERT INTO contas_bancarias
                        (nome, banco, agencia, numero_conta, tipo, saldo_inicial, saldo_atual,
                         limite_credito, considera_fluxo, emite_boletos, observacoes, ativo, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
                    [nome,
                     sanitizeString(item.banco || ''),
                     sanitizeString(item.agencia || ''),
                     sanitizeString(item.numero_conta || ''),
                     sanitizeString(item.tipo || 'corrente'),
                     saldoInicial, saldoInicial,
                     toNum(item.limite_credito),
                     toBool(item.considera_fluxo),
                     toBool(item.emite_boletos),
                     sanitizeString(item.observacoes || '')]
                );
                importados++;
            } catch (err) {
                erros.push({ linha: i + 2, erro: err.message });
            }
        }

        res.json({ success: true, importados, duplicados, total: dados.length, erros });
    } catch (error) {
        console.error('[Financeiro] Erro na importação de contas bancárias:', error);
        res.status(500).json({ error: 'Erro na importação de contas bancárias' });
    }
});

// =====================================================
// NOTIFICAÇÕES FINANCEIRO
// =====================================================

/**
 * CREATE TABLE notificacoes_financeiro se não existir (lazy)
 */
async function ensureNotificacoesTable() {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS notificacoes_financeiro (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            usuario_email VARCHAR(255) NULL,
            tipo VARCHAR(20) DEFAULT 'info',
            titulo VARCHAR(255) NOT NULL,
            mensagem TEXT NULL,
            icone VARCHAR(50) NULL,
            cor VARCHAR(50) NULL,
            lida TINYINT(1) DEFAULT 0,
            link VARCHAR(500) NULL,
            dados_extra JSON NULL,
            data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_usuario (usuario_email),
            INDEX idx_lida (lida)
        )
    `);
}

/**
 * GET /api/financeiro/alertas
 * Carrega notificações do usuário autenticado
 */
router.get('/alertas', authenticateToken, async (req, res) => {
    try {
        await ensureNotificacoesTable();
        const email = req.user?.email || null;
        const [rows] = await pool.execute(
            `SELECT * FROM notificacoes_financeiro
             WHERE (usuario_email = ? OR usuario_email IS NULL)
             ORDER BY data_criacao DESC LIMIT 50`,
            [email]
        );
        res.json(rows);
    } catch (error) {
        console.error('[Notificações] Erro ao carregar alertas:', error);
        res.json([]); // Retorna vazio para não quebrar UI
    }
});

/**
 * GET /api/financeiro/notificacoes
 * Lista notificações do usuário
 */
router.get('/notificacoes', authenticateToken, async (req, res) => {
    try {
        await ensureNotificacoesTable();
        const email = req.user?.email || null;
        const [rows] = await pool.execute(
            `SELECT * FROM notificacoes_financeiro
             WHERE (usuario_email = ? OR usuario_email IS NULL)
             ORDER BY data_criacao DESC LIMIT 100`,
            [email]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[Notificações] Erro ao listar notificações:', error);
        res.status(500).json({ error: 'Erro ao listar notificações' });
    }
});

/**
 * POST /api/financeiro/notificacoes
 * Persiste nova notificação
 */
router.post('/notificacoes', authenticateToken, async (req, res) => {
    try {
        await ensureNotificacoesTable();
        const email = req.user?.email || null;
        const { tipo, titulo, mensagem, icone, cor, lida, link, dados_extra } = req.body;

        if (!titulo) return res.status(400).json({ error: 'Título obrigatório' });

        const [result] = await pool.execute(
            `INSERT INTO notificacoes_financeiro
             (usuario_email, tipo, titulo, mensagem, icone, cor, lida, link, dados_extra)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                tipo || 'info',
                String(titulo).substring(0, 255),
                mensagem || null,
                icone || null,
                cor || null,
                lida ? 1 : 0,
                link ? String(link).substring(0, 500) : null,
                dados_extra ? JSON.stringify(dados_extra) : null
            ]
        );
        res.status(201).json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('[Notificações] Erro ao criar notificação:', error);
        res.status(500).json({ error: 'Erro ao criar notificação' });
    }
});

/**
 * POST /api/financeiro/notificacoes/marcar-todas-lidas
 * Marca todas as notificações do usuário como lidas
 */
router.post('/notificacoes/marcar-todas-lidas', authenticateToken, async (req, res) => {
    try {
        await ensureNotificacoesTable();
        const email = req.user?.email || null;
        await pool.execute(
            `UPDATE notificacoes_financeiro SET lida = 1
             WHERE usuario_email = ? AND lida = 0`,
            [email]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('[Notificações] Erro ao marcar todas como lidas:', error);
        res.status(500).json({ error: 'Erro ao atualizar notificações' });
    }
});

/**
 * PATCH /api/financeiro/notificacoes/:id
 * Atualiza uma notificação (ex: marcar como lida)
 */
router.patch('/notificacoes/:id', authenticateToken, async (req, res) => {
    try {
        await ensureNotificacoesTable();
        const { id } = req.params;
        const email = req.user?.email || null;
        const { lida } = req.body;

        // Garantir que o usuário só edite suas próprias notificações
        const [result] = await pool.execute(
            `UPDATE notificacoes_financeiro SET lida = ?
             WHERE id = ? AND (usuario_email = ? OR usuario_email IS NULL)`,
            [lida ? 1 : 0, id, email]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Notificação não encontrada' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('[Notificações] Erro ao atualizar notificação:', error);
        res.status(500).json({ error: 'Erro ao atualizar notificação' });
    }
});

/**
 * GET /api/financeiro/prazo-medio
 * Retorna dados reais de prazo médio agrupados por empresa e por dia de vencimento.
 * Integra dados de contas_receber e contas_pagar.
 */
router.get('/prazo-medio', authenticateToken, async (req, res) => {
    try {
        const corte = req.financeiroCorteTemporal;
        const hoje = new Date().toISOString().slice(0, 10);

        // === CONTAS A RECEBER - por empresa ===
        const crQuery = `
            SELECT
                COALESCE(UPPER(TRIM(cr.empresa)), 'SEM EMPRESA') as empresa,
                DATE_FORMAT(COALESCE(cr.data_vencimento, cr.vencimento), '%Y-%m-%d') as dia_vencimento,
                COUNT(*) as qtd_titulos,
                SUM(cr.valor) as valor_bruto,
                SUM(COALESCE(cr.valor_recebido, 0)) as valor_recebido,
                SUM(cr.valor - COALESCE(cr.valor_recebido, 0)) as valor_aberto,
                cr.portador
            FROM contas_receber cr
            WHERE LOWER(cr.status) NOT IN ('liquidada','liquidado','pago','recebido','cancelada')
                AND (cr.valor - COALESCE(cr.valor_recebido, 0)) > 0
                ${corte ? corte.crClause('cr') : ''}
            GROUP BY empresa, dia_vencimento, cr.portador
            ORDER BY empresa, dia_vencimento
        `;
        const [crRows] = await pool.execute(crQuery);

        // === CONTAS A PAGAR - por empresa ===
        const cpQuery = `
            SELECT
                COALESCE(UPPER(TRIM(cp.minha_empresa_nome_fantasia)), 'SEM EMPRESA') as empresa,
                DATE_FORMAT(COALESCE(cp.data_vencimento, cp.vencimento), '%Y-%m-%d') as dia_vencimento,
                COUNT(*) as qtd_titulos,
                SUM(cp.valor) as valor_bruto,
                SUM(COALESCE(cp.valor_pago, 0)) as valor_pago,
                SUM(cp.valor - COALESCE(cp.valor_pago, 0)) as valor_aberto
            FROM contas_pagar cp
            WHERE LOWER(cp.status) NOT IN ('liquidada','liquidado','pago','cancelada')
                AND (cp.valor - COALESCE(cp.valor_pago, 0)) > 0
                ${corte ? corte.cpClause('cp') : ''}
            GROUP BY empresa, dia_vencimento
            ORDER BY empresa, dia_vencimento
        `;
        const [cpRows] = await pool.execute(cpQuery);

        res.json({
            success: true,
            hoje,
            contas_receber: crRows,
            contas_pagar: cpRows
        });
    } catch (error) {
        console.error('[Prazo Médio] Erro:', error);
        res.status(500).json({ error: 'Erro ao calcular prazo médio', details: error.message });
    }
});

// GET /api/financeiro/operacoes-credito — Operações de crédito
router.get('/operacoes-credito', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT id, bordero, empresa, tipo_operacao, instituicao, prorrogacao,
                   prazo_medio, data_operacao, taxa_periodo, tmp,
                   vlr_bruto, qtde_titulos, dif_monet, tarifas,
                   iss_riss_irrf_perc, iss_riss_irrf_monet, iof, cpmf_cobr,
                   total_deducoes, liq_op, retencao_passivo, recompra,
                   amort_fom, conta_grafica, liq_lib
            FROM operacoes_credito
            ORDER BY data_operacao DESC
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[Operações Crédito] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar operações', details: error.message });
    }
});

// PUT /api/financeiro/operacoes-credito/:id — Atualizar operação de crédito
router.put('/operacoes-credito/:id', authenticateToken, authorizeFinanceiro('receber'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            bordero, empresa, tipo_operacao, instituicao, prorrogacao,
            prazo_medio, data_operacao, taxa_periodo, tmp,
            vlr_bruto, qtde_titulos, dif_monet, tarifas,
            iss_riss_irrf_perc, iss_riss_irrf_monet, iof, cpmf_cobr,
            total_deducoes, liq_op, retencao_passivo, recompra,
            amort_fom, conta_grafica, liq_lib
        } = req.body;

        const [result] = await pool.execute(`
            UPDATE operacoes_credito SET
                bordero = ?, empresa = ?, tipo_operacao = ?, instituicao = ?, prorrogacao = ?,
                prazo_medio = ?, data_operacao = ?, taxa_periodo = ?, tmp = ?,
                vlr_bruto = ?, qtde_titulos = ?, dif_monet = ?, tarifas = ?,
                iss_riss_irrf_perc = ?, iss_riss_irrf_monet = ?, iof = ?, cpmf_cobr = ?,
                total_deducoes = ?, liq_op = ?, retencao_passivo = ?, recompra = ?,
                amort_fom = ?, conta_grafica = ?, liq_lib = ?
            WHERE id = ?
        `, [
            bordero, empresa, tipo_operacao, instituicao, prorrogacao,
            prazo_medio || 0, data_operacao || null, taxa_periodo || 0, tmp || 0,
            vlr_bruto || 0, qtde_titulos || 0, dif_monet || 0, tarifas || 0,
            iss_riss_irrf_perc || 0, iss_riss_irrf_monet || 0, iof || 0, cpmf_cobr || 0,
            total_deducoes || 0, liq_op || 0, retencao_passivo || 0, recompra || 0,
            amort_fom || 0, conta_grafica || 0, liq_lib || 0,
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Operação não encontrada' });
        }

        res.json({ success: true, message: 'Operação atualizada com sucesso' });
    } catch (error) {
        console.error('[Operações Crédito PUT] Erro:', error);
        res.status(500).json({ error: 'Erro ao atualizar operação', details: error.message });
    }
});

module.exports = router;

// =============================================
// CONCILIAÇÃO BANCÁRIA - ROTAS CRUD
// =============================================

// Helper: garantir que tabelas de conciliação existem
async function ensureConciliacaoTables() {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS extrato_bancario (
                id INT AUTO_INCREMENT PRIMARY KEY,
                conta_id INT NULL,
                data DATE NULL,
                descricao VARCHAR(500) NULL,
                valor DECIMAL(15,2) NOT NULL DEFAULT 0,
                conciliado TINYINT(1) DEFAULT 0,
                hash_linha VARCHAR(64) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_conta (conta_id),
                INDEX idx_data (data),
                INDEX idx_hash (hash_linha)
            )
        `);
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS conciliacoes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                conta_id INT NULL,
                movimentacao_sistema_id INT NULL,
                movimentacao_tabela VARCHAR(50) NULL,
                extrato_id INT NULL,
                valor DECIMAL(15,2) NOT NULL DEFAULT 0,
                tipo_match ENUM('manual','automatico') DEFAULT 'manual',
                usuario_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_extrato (extrato_id),
                INDEX idx_sistema (movimentacao_sistema_id)
            )
        `);
    } catch (e) {
        if (!String(e.message).includes('already exists')) {
            console.warn('[Conciliação] Erro ao criar tabelas:', e.message);
        }
    }
}

/**
 * GET /api/financeiro/conciliacao
 * tipo=extrato → lançamentos do extrato bancário
 * tipo=conciliacoes → histórico de conciliações
 */
router.get('/conciliacao', authenticateToken, async (req, res) => {
    try {
        await ensureConciliacaoTables();
        const { tipo, conta_id } = req.query;
        if (tipo === 'extrato') {
            let sql = 'SELECT id, conta_id, data, descricao, valor, conciliado FROM extrato_bancario';
            const params = [];
            if (conta_id) { sql += ' WHERE conta_id = ?'; params.push(conta_id); }
            sql += ' ORDER BY data DESC LIMIT 200';
            const [rows] = await pool.execute(sql, params);
            return res.json({ success: true, data: rows });
        }
        if (tipo === 'conciliacoes') {
            let sql = 'SELECT id, conta_id, movimentacao_sistema_id, movimentacao_tabela, extrato_id, valor, tipo_match, created_at FROM conciliacoes';
            const params = [];
            if (conta_id) { sql += ' WHERE conta_id = ?'; params.push(conta_id); }
            sql += ' ORDER BY created_at DESC LIMIT 200';
            const [rows] = await pool.execute(sql, params);
            return res.json({ success: true, data: rows });
        }
        res.json({ success: true, data: [] });
    } catch (error) {
        console.error('[Conciliação] Erro GET:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar dados de conciliação' });
    }
});

/**
 * POST /api/financeiro/conciliacao
 * Conciliação manual: vincula lançamento do sistema com extrato
 */
router.post('/conciliacao', authenticateToken, async (req, res) => {
    try {
        await ensureConciliacaoTables();
        const { conta_id, movimentacao_sistema_id, movimentacao_tabela, extrato_id, valor, tipo_match = 'manual' } = req.body;
        if (!movimentacao_sistema_id || !extrato_id) {
            return res.status(400).json({ success: false, message: 'IDs do sistema e extrato são obrigatórios' });
        }
        if (movimentacao_tabela && !['contas_receber', 'contas_pagar'].includes(movimentacao_tabela)) {
            return res.status(400).json({ success: false, message: 'movimentacao_tabela inválida' });
        }
        const [result] = await pool.execute(
            'INSERT INTO conciliacoes (conta_id, movimentacao_sistema_id, movimentacao_tabela, extrato_id, valor, tipo_match, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [conta_id || null, movimentacao_sistema_id, movimentacao_tabela || null, extrato_id, valor || 0, tipo_match, req.user?.id || null]
        );
        await pool.execute('UPDATE extrato_bancario SET conciliado = 1 WHERE id = ?', [extrato_id]);
        res.json({ success: true, id: result.insertId, message: 'Conciliação realizada' });
    } catch (error) {
        console.error('[Conciliação] Erro POST:', error);
        res.status(500).json({ success: false, message: 'Erro ao conciliar' });
    }
});

/**
 * POST /api/financeiro/conciliacao/automatica
 * Concilia automaticamente por valor e data aproximada
 */
router.post('/conciliacao/automatica', authenticateToken, async (req, res) => {
    try {
        await ensureConciliacaoTables();
        const { conta_id } = req.body;
        let whereConta = '';
        const params = [];
        if (conta_id) { whereConta = ' AND e.conta_id = ?'; params.push(conta_id); }

        // Buscar extratos não conciliados
        const [extratos] = await pool.execute(
            `SELECT id, valor, data FROM extrato_bancario WHERE conciliado = 0${conta_id ? ' AND conta_id = ?' : ''} ORDER BY data`,
            conta_id ? [conta_id] : []
        );

        // Buscar movimentações do sistema pendentes
        const corte = req.financeiroCorteTemporal;
        const [receber] = await pool.execute(
            "SELECT id, valor, COALESCE(data_vencimento, vencimento) as data, 'contas_receber' as tabela FROM contas_receber cr WHERE cr.status IN ('pendente','parcial','a_vencer','vencida')" + corte.crClause('cr')
        );
        const [pagar] = await pool.execute(
            "SELECT id, valor, COALESCE(data_vencimento, vencimento) as data, 'contas_pagar' as tabela FROM contas_pagar cp WHERE cp.status IN ('pendente','parcial','a_vencer','vencida')" + corte.cpClause('cp')
        );

        let conciliados = 0;
        const usados = new Set();
        for (const ext of extratos) {
            const extValor = parseFloat(ext.valor);
            const extVal = Math.abs(extValor);
            // Isolamento CR/CP: crédito (valor > 0) → só CR, débito (valor < 0) → só CP
            const candidatos = extValor >= 0 ? receber : pagar;
            const match = candidatos.find(s => !usados.has(s.tabela + '_' + s.id) && Math.abs(Math.abs(parseFloat(s.valor)) - extVal) < 0.01);
            if (match) {
                await pool.execute(
                    'INSERT INTO conciliacoes (conta_id, movimentacao_sistema_id, movimentacao_tabela, extrato_id, valor, tipo_match, usuario_id) VALUES (?, ?, ?, ?, ?, "automatico", ?)',
                    [conta_id || null, match.id, match.tabela, ext.id, extVal, req.user?.id || null]
                );
                await pool.execute('UPDATE extrato_bancario SET conciliado = 1 WHERE id = ?', [ext.id]);
                usados.add(match.tabela + '_' + match.id);
                conciliados++;
            }
        }
        res.json({ success: true, conciliados, message: `${conciliados} item(ns) conciliado(s)` });
    } catch (error) {
        console.error('[Conciliação Auto] Erro:', error);
        res.status(500).json({ success: false, message: 'Erro na conciliação automática' });
    }
});

/**
 * DELETE /api/financeiro/conciliacao/:id
 * Desfazer conciliação
 */
router.delete('/conciliacao/:id', authenticateToken, async (req, res) => {
    try {
        await ensureConciliacaoTables();
        const { id } = req.params;
        const [conc] = await pool.execute('SELECT extrato_id FROM conciliacoes WHERE id = ?', [id]);
        if (conc.length === 0) return res.status(404).json({ success: false, message: 'Conciliação não encontrada' });
        const extratoId = conc[0].extrato_id;
        // AUDIT-FIX R3: Soft delete em vez de hard DELETE
        await pool.execute('UPDATE conciliacoes SET ativo = 0 WHERE id = ?', [id]);
        if (extratoId) {
            await pool.execute('UPDATE extrato_bancario SET conciliado = 0 WHERE id = ?', [extratoId]);
        }
        res.json({ success: true, message: 'Conciliação desfeita' });
    } catch (error) {
        console.error('[Conciliação] Erro DELETE:', error);
        res.status(500).json({ success: false, message: 'Erro ao desfazer conciliação' });
    }
});

/**
 * POST /api/financeiro/conciliacao/importar-ofx
 * Importar extrato bancário (OFX ou CSV em texto)
 */
router.post('/conciliacao/importar-ofx', authenticateToken, async (req, res) => {
    try {
        await ensureConciliacaoTables();
        const { conta_id, conteudo, nome_arquivo } = req.body;
        if (!conteudo) return res.status(400).json({ success: false, message: 'Conteúdo do arquivo é obrigatório' });

        const linhas = conteudo.split('\n').filter(l => l.trim());
        let importados = 0;
        let duplicados = 0;
        const isOFX = conteudo.includes('<OFX>') || conteudo.includes('<STMTTRN>');

        if (isOFX) {
            // Parse OFX simplificado
            const transacoes = conteudo.split('<STMTTRN>').slice(1);
            for (const tx of transacoes) {
                const getTag = (tag) => { const m = tx.match(new RegExp('<' + tag + '>([^<\\n]+)')); return m ? m[1].trim() : ''; };
                const dtPosted = getTag('DTPOSTED');
                const valor = parseFloat(getTag('TRNAMT').replace(',', '.')) || 0;
                const memo = getTag('MEMO') || getTag('NAME') || '';
                const fitid = getTag('FITID');
                const data = dtPosted.length >= 8 ? `${dtPosted.slice(0,4)}-${dtPosted.slice(4,6)}-${dtPosted.slice(6,8)}` : null;

                const hash = require('crypto').createHash('sha256').update(`${conta_id || ''}_${data}_${valor}_${fitid}`).digest('hex');
                const [dup] = await pool.execute('SELECT id FROM extrato_bancario WHERE hash_linha = ?', [hash]);
                if (dup.length > 0) { duplicados++; continue; }

                await pool.execute(
                    'INSERT INTO extrato_bancario (conta_id, data, descricao, valor, hash_linha) VALUES (?, ?, ?, ?, ?)',
                    [conta_id || null, data, memo.substring(0, 500), valor, hash]
                );
                importados++;
            }
        } else {
            // Parse CSV (data;descricao;valor ou data,descricao,valor)
            const sep = linhas[0].includes(';') ? ';' : ',';
            const startIdx = linhas[0].toLowerCase().includes('data') ? 1 : 0;
            for (let i = startIdx; i < linhas.length; i++) {
                const cols = linhas[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
                if (cols.length < 3) continue;
                const data = cols[0].includes('/') ? cols[0].split('/').reverse().join('-') : cols[0];
                const descricao = cols[1] || '';
                const valor = parseFloat((cols[2] || '0').replace(/\./g, '').replace(',', '.')) || 0;

                const hash = require('crypto').createHash('sha256').update(`${conta_id || ''}_${data}_${valor}_${descricao}`).digest('hex');
                const [dup] = await pool.execute('SELECT id FROM extrato_bancario WHERE hash_linha = ?', [hash]);
                if (dup.length > 0) { duplicados++; continue; }

                await pool.execute(
                    'INSERT INTO extrato_bancario (conta_id, data, descricao, valor, hash_linha) VALUES (?, ?, ?, ?, ?)',
                    [conta_id || null, data, descricao.substring(0, 500), valor, hash]
                );
                importados++;
            }
        }
        res.json({ success: true, importados, duplicados, total: importados + duplicados, arquivo: nome_arquivo });
    } catch (error) {
        console.error('[Conciliação] Erro importação:', error);
        res.status(500).json({ success: false, message: 'Erro ao importar extrato' });
    }
});
