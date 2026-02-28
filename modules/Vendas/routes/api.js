// API Routes for Vendas Module

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

// Pool de conexão com o banco
let vendasPool = null;

async function getPool() {
    if (!vendasPool) {
        // Credenciais DEVEM vir de variáveis de ambiente
        if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
            console.warn('⚠️ DB_USER e DB_PASSWORD não definidos no ambiente');
        }
        vendasPool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'aluforce_vendas',
            waitForConnections: true,
            connectionLimit: 10
        });
    }
    return vendasPool;
}

// Função utilitária para parse seguro de JSON
function safeParseJSON(str, fallback = null) {
    if (!str) return fallback;
    if (typeof str === 'object') return str;
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

// ============================================================
// VALIDAÇÃO DE CNPJ E CPF (Enterprise-Grade)
// ============================================================

/**
 * Valida CPF com verificação de dígitos
 * @param {string} cpf - CPF a ser validado (com ou sem pontuação)
 * @returns {boolean} - true se válido
 */
function validateCPF(cpf) {
    if (!cpf) return false;
    
    // Remove caracteres não numéricos
    cpf = cpf.replace(/[^\d]/g, '');
    
    // CPF deve ter 11 dígitos
    if (cpf.length !== 11) return false;
    
    // Verifica se todos os dígitos são iguais (CPFs inválidos como 111.111.111-11)
    if (/^(\d)\1{10}$/.test(cpf)) return false;
    
    // Validação do primeiro dígito verificador
    let soma = 0;
    for (let i = 0; i < 9; i++) {
        soma += parseInt(cpf.charAt(i)) * (10 - i);
    }
    let resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(9))) return false;
    
    // Validação do segundo dígito verificador
    soma = 0;
    for (let i = 0; i < 10; i++) {
        soma += parseInt(cpf.charAt(i)) * (11 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(10))) return false;
    
    return true;
}

/**
 * Valida CNPJ com verificação de dígitos
 * @param {string} cnpj - CNPJ a ser validado (com ou sem pontuação)
 * @returns {boolean} - true se válido
 */
function validateCNPJ(cnpj) {
    if (!cnpj) return false;
    
    // Remove caracteres não numéricos
    cnpj = cnpj.replace(/[^\d]/g, '');
    
    // CNPJ deve ter 14 dígitos
    if (cnpj.length !== 14) return false;
    
    // Verifica se todos os dígitos são iguais
    if (/^(\d)\1{13}$/.test(cnpj)) return false;
    
    // Validação do primeiro dígito verificador
    let tamanho = cnpj.length - 2;
    let numeros = cnpj.substring(0, tamanho);
    let digitos = cnpj.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
    
    for (let i = tamanho; i >= 1; i--) {
        soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
        if (pos < 2) pos = 9;
    }
    
    let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado !== parseInt(digitos.charAt(0))) return false;
    
    // Validação do segundo dígito verificador
    tamanho = tamanho + 1;
    numeros = cnpj.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;
    
    for (let i = tamanho; i >= 1; i--) {
        soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
        if (pos < 2) pos = 9;
    }
    
    resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado !== parseInt(digitos.charAt(1))) return false;
    
    return true;
}

/**
 * Valida CNPJ ou CPF automaticamente baseado no tamanho
 * @param {string} documento - CNPJ ou CPF
 * @returns {{valid: boolean, type: string, message: string}}
 */
function validateCNPJorCPF(documento) {
    if (!documento) {
        return { valid: false, type: null, message: 'Documento não informado' };
    }
    
    const cleaned = documento.replace(/[^\d]/g, '');
    
    if (cleaned.length === 11) {
        const valid = validateCPF(cleaned);
        return { 
            valid, 
            type: 'CPF', 
            message: valid ? 'CPF válido' : 'CPF inválido - dígitos verificadores incorretos' 
        };
    } else if (cleaned.length === 14) {
        const valid = validateCNPJ(cleaned);
        return { 
            valid, 
            type: 'CNPJ', 
            message: valid ? 'CNPJ válido' : 'CNPJ inválido - dígitos verificadores incorretos' 
        };
    } else {
        return { 
            valid: false, 
            type: null, 
            message: `Documento deve ter 11 (CPF) ou 14 (CNPJ) dígitos. Encontrado: ${cleaned.length}` 
        };
    }
}

// Middleware de autenticação real
const authenticateToken = (req, res, next) => {
    // Usa o middleware global se disponível
    if (req.user) {
        return next();
    }
    
    // Verifica se o token está no cookie ou header
    const jwt = require('jsonwebtoken');
    const token = req.cookies?.authToken || req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        console.log('❌ Token não encontrado - cookies:', Object.keys(req.cookies || {}));
        return res.status(401).json({ error: 'Token não fornecido' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'aluforce-secret-key-2024');
        req.user = decoded;
        next();
    } catch (error) {
        console.log('❌ Token inválido:', error.message);
        return res.status(401).json({ error: 'Token inválido' });
    }
};

// =================================================================
// DASHBOARD ROUTES
// =================================================================

// GET /api/vendas/dashboard - Stats gerais
router.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        
        // Vendas do mês atual
        const [vendasMes] = await pool.query(`
            SELECT COALESCE(SUM(valor), 0) as total
            FROM pedidos 
            WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) 
            AND YEAR(created_at) = YEAR(CURRENT_DATE())
            AND status NOT IN ('cancelado', 'recusado')
        `);
        
        // Pedidos ativos
        const [pedidosAtivos] = await pool.query(`
            SELECT COUNT(*) as total 
            FROM pedidos 
            WHERE status IN ('orcamento', 'analise', 'aprovado', 'producao')
        `);
        
        // Clientes ativos (que fizeram pedido nos últimos 90 dias)
        const [clientesAtivos] = await pool.query(`
            SELECT COUNT(DISTINCT cliente_id) as total 
            FROM pedidos 
            WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
        `);
        
        // Taxa de conversão (faturados / total)
        const [taxaConversao] = await pool.query(`
            SELECT 
                COUNT(CASE WHEN status = 'faturado' THEN 1 END) as faturados,
                COUNT(*) as total
            FROM pedidos 
            WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) 
            AND YEAR(created_at) = YEAR(CURRENT_DATE())
        `);
        
        const taxa = taxaConversao[0].total > 0 
            ? Math.round((taxaConversao[0].faturados / taxaConversao[0].total) * 100) 
            : 0;

        res.json({
            success: true,
            stats: {
                vendasMes: parseFloat(vendasMes[0].total) || 0,
                pedidosAtivos: pedidosAtivos[0].total || 0,
                clientesAtivos: clientesAtivos[0].total || 0,
                taxaConversao: taxa
            }
        });
    } catch (error) {
        console.error('Error getting dashboard stats:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar estatísticas'
        });
    }
});

// GET /api/vendas/dashboard/vendedor - Dashboard do vendedor
router.get('/dashboard/vendedor', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const vendedorId = req.user?.id;
        const periodo = parseInt(req.query.período) || 30;
        
        // Meta do mês (pode ser configurada por vendedor)
        let metaValor = 32500;
        try {
            const [metaRow] = await pool.query(
                `SELECT valor FROM metas_vendedores WHERE vendedor_id = ? AND MONTH(mes) = MONTH(CURRENT_DATE()) LIMIT 1`,
                [vendedorId]
            );
            if (metaRow.length > 0) metaValor = parseFloat(metaRow[0].valor);
        } catch (e) { /* tabela pode não existir */ }
        
        // Vendas do vendedor no mês
        const [vendasVendedor] = await pool.query(`
            SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as quantidade
            FROM pedidos 
            WHERE vendedor_id = ?
            AND MONTH(created_at) = MONTH(CURRENT_DATE()) 
            AND YEAR(created_at) = YEAR(CURRENT_DATE())
            AND status NOT IN ('cancelado', 'recusado')
        `, [vendedorId]);
        
        const atingido = parseFloat(vendasVendedor[0].total) || 0;
        const percentual = metaValor > 0 ? Math.round((atingido / metaValor) * 100) : 0;
        
        // Histórico mensal (últimos 6 meses)
        const [historicoMensal] = await pool.query(`
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as mes,
                COALESCE(SUM(valor), 0) as valor_faturado
            FROM pedidos 
            WHERE vendedor_id = ?
            AND created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
            AND status NOT IN ('cancelado', 'recusado')
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY mes ASC
        `, [vendedorId]);
        
        // Pipeline de vendas
        const [pipeline] = await pool.query(`
            SELECT status, COUNT(*) as quantidade, COALESCE(SUM(valor), 0) as valor
            FROM pedidos 
            WHERE vendedor_id = ?
            AND MONTH(created_at) = MONTH(CURRENT_DATE())
            GROUP BY status
        `, [vendedorId]);
        
        // Clientes do vendedor (últimos pedidos)
        const [meusClientes] = await pool.query(`
            SELECT 
                p.id,
                p.valor,
                p.status,
                p.created_at as data,
                COALESCE(c.nome_fantasia, c.razao_social, c.nome, 'Cliente') as cliente_nome
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.vendedor_id = ?
            ORDER BY p.created_at DESC
            LIMIT 10
        `, [vendedorId]);

        res.json({
            success: true,
            meta: {
                valor: metaValor,
                atingido: atingido,
                percentual: percentual
            },
            metricas: {
                total_pedidos: vendasVendedor[0].quantidade || 0,
                valor_total: atingido
            },
            históricoMensal: historicoMensal,
            pipeline: pipeline,
            meusClientes: meusClientes
        });
    } catch (error) {
        console.error('Error getting vendedor dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar dashboard do vendedor'
        });
    }
});

// GET /api/vendas/dashboard/top-vendedores - Ranking
router.get('/dashboard/top-vendedores', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const limit = parseInt(req.query.limit) || 5;
        
        const [vendedores] = await pool.query(`
            SELECT 
                u.id,
                u.nome,
                COALESCE(SUM(p.valor), 0) as valor,
                COUNT(p.id) as quantidade
            FROM usuarios u
            LEFT JOIN pedidos p ON p.vendedor_id = u.id 
                AND MONTH(p.created_at) = MONTH(CURRENT_DATE())
                AND YEAR(p.created_at) = YEAR(CURRENT_DATE())
                AND p.status NOT IN ('cancelado', 'recusado')
            WHERE u.ativo = 1
            GROUP BY u.id, u.nome
            HAVING valor > 0 OR quantidade > 0
            ORDER BY valor DESC
            LIMIT ?
        `, [limit]);

        res.json(vendedores);
    } catch (error) {
        console.error('Error getting top vendedores:', error);
        res.status(500).json([]);
    }
});

// GET /api/vendas/dashboard/graficos - Dados para gráficos
router.get('/dashboard/graficos', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        
        // Vendas por mês (últimos 6 meses)
        const [vendasMensais] = await pool.query(`
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as mes,
                COALESCE(SUM(valor), 0) as valor
            FROM pedidos 
            WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
            AND status NOT IN ('cancelado', 'recusado')
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY mes ASC
        `);
        
        const nomesMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const labels = vendasMensais.map(v => {
            const [ano, mes] = v.mes.split('-');
            return nomesMeses[parseInt(mes) - 1];
        });
        const valores = vendasMensais.map(v => parseFloat(v.valor));
        
        // Status de vendas (mês atual)
        const [statusVendas] = await pool.query(`
            SELECT status, COUNT(*) as quantidade
            FROM pedidos 
            WHERE MONTH(created_at) = MONTH(CURRENT_DATE())
            AND YEAR(created_at) = YEAR(CURRENT_DATE())
            GROUP BY status
        `);
        
        const statusMap = {
            'faturado': 'Faturados',
            'analise': 'Em Negociação',
            'aprovado': 'Aprovados',
            'cancelado': 'Perdidos'
        };
        
        const statusLabels = statusVendas.map(s => statusMap[s.status] || s.status);
        const statusValores = statusVendas.map(s => s.quantidade);

        res.json({
            vendasMensais: {
                labels: labels,
                valores: valores
            },
            vendasStatus: {
                labels: statusLabels,
                valores: statusValores
            }
        });
    } catch (error) {
        console.error('Error getting graficos:', error);
        res.status(500).json({
            vendasMensais: { labels: [], valores: [] },
            vendasStatus: { labels: [], valores: [] }
        });
    }
});

// GET /api/vendas/user-info
router.get('/user-info', authenticateToken, async (req, res) => {
    try {
        // TODO: Buscar informações reais do usuário
        res.json({
            success: true,
            user: {
                name: req.user?.name || 'Usuário',
                role: req.user?.role || 'Vendedor',
                email: req.user?.email || ''
            }
        });
    } catch (error) {
        console.error('Error getting user info:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar informações do usuário'
        });
    }
});

// =================================================================
// PEDIDOS ROUTES
// =================================================================

// GET /api/vendas/pedidos/recentes
router.get('/pedidos/recentes', authenticateToken, async (req, res) => {
    try {
        // TODO: Buscar pedidos recentes do banco
        res.json({
            success: true,
            pedidos: []
        });
    } catch (error) {
        console.error('Error getting recent pedidos:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar pedidos recentes'
        });
    }
});

// GET /api/vendas/pedidos
router.get('/pedidos', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const limit = parseInt(req.query.limit) || 200;
        
        const [pedidos] = await pool.query(`
            SELECT 
                p.id,
                p.id as numero,
                p.valor as valor_total,
                p.descricao,
                p.status,
                p.empresa_id,
                p.vendedor_id,
                p.cliente_id,
                p.created_at as data_pedido,
                p.faturado_em,
                p.frete,
                p.redespacho,
                p.observacao,
                p.prioridade,
                p.data_prevista,
                p.prazo_entrega,
                p.endereco_entrega,
                p.municipio_entrega,
                p.metodo_envio,
                COALESCE(c.nome_fantasia, c.razao_social, c.nome, 'Cliente não informado') as cliente_nome,
                c.email as cliente_email,
                c.telefone as cliente_telefone,
                u.nome as vendedor_nome
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            ORDER BY p.id DESC
            LIMIT ?
        `, [limit]);
        
        // Retornar direto o array (o frontend espera array direto)
        res.json(pedidos);
    } catch (error) {
        console.error('Error getting pedidos:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar pedidos'
        });
    }
});

// GET /api/vendas/pedidos/:id
router.get('/pedidos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getPool();
        
        const [pedidos] = await pool.query(`
            SELECT p.*, 
                   p.valor as valor_total,
                   p.descricao as observacoes,
                   p.created_at as data_criacao,
                   c.nome as cliente_nome, c.email as cliente_email, c.telefone as cliente_telefone,
                   c.cnpj as cliente_cnpj, c.endereco as cliente_endereco,
                   e.nome_fantasia as empresa_nome, e.cnpj as empresa_cnpj,
                   u.nome as vendedor_nome
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN empresas e ON p.empresa_id = e.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.id = ?
        `, [id]);
        
        if (pedidos.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        // Formatar o pedido para compatibilidade com o frontend
        const pedido = pedidos[0];
        const pedidoFormatado = {
            ...pedido,
            numero: `Pedido Nº ${pedido.id}`,
            cliente: pedido.cliente_nome || '',
            vendedor: pedido.vendedor_nome || '',
            valor: parseFloat(pedido.valor) || 0,
            data: pedido.created_at ? new Date(pedido.created_at).toISOString().slice(0, 10) : '',
            frete: parseFloat(pedido.frete) || 0,
            origem: 'Sistema',
            tipo: pedido.prioridade || 'normal',
            produtos: safeParseJSON(pedido.produtos_preview, [])
        };
        
        res.json(pedidoFormatado);
    } catch (error) {
        console.error('Error getting pedido:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar pedido'
        });
    }
});

// POST /api/vendas/pedidos
router.post('/pedidos', authenticateToken, async (req, res) => {
    try {
        const { 
            cliente_id, empresa_id, produtos, itens, valor, valor_total, valor_produtos, 
            desconto, descricao, observacoes, status = 'orcamento', frete = 0, 
            prioridade = 'normal', prazo_entrega, endereco_entrega, municipio_entrega, 
            metodo_envio, condicao_pagamento, cenario_fiscal, parcelas
        } = req.body;
        const vendedor_id = req.user?.id;
        const pool = await getPool();
        
        // Usar valor_total se fornecido, senão valor
        const valorFinal = valor_total || valor || 0;
        
        // Usar itens se fornecido, senão produtos
        const produtosArray = itens || produtos || [];
        
        const [result] = await pool.query(`
            INSERT INTO pedidos 
            (cliente_id, empresa_id, vendedor_id, valor, descricao, status, 
             frete, prioridade, produtos_preview, prazo_entrega, endereco_entrega, 
             municipio_entrega, metodo_envio, observacao, desconto, parcelas,
             condicao_pagamento, cenario_fiscal, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
            cliente_id || null, empresa_id || null, vendedor_id, valorFinal, 
            descricao || observacoes || '', status, frete, prioridade, 
            JSON.stringify(produtosArray), prazo_entrega || null, 
            endereco_entrega || null, municipio_entrega || null, 
            metodo_envio || null, observacoes || null, desconto || 0,
            parcelas || null, condicao_pagamento || null, cenario_fiscal || null
        ]);
        
        res.json({ success: true, id: result.insertId, numero: result.insertId, message: 'Pedido criado com sucesso' });
    } catch (error) {
        console.error('Error creating pedido:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao criar pedido: ' + (error.message || 'Erro interno')
        });
    }
});

// PUT /api/vendas/pedidos/:id
router.put('/pedidos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            // Dados básicos
            cliente_id, empresa_id, produtos, itens, valor, valor_total, valor_produtos,
            desconto, descricao, observacao, observacoes, observacao_cliente, status, frete, prioridade, 
            prazo_entrega, endereco_entrega, municipio_entrega, metodo_envio,
            condicao_pagamento, condicoes_pagamento, cenario_fiscal, parcelas,
            // Dados de transporte/frete (do frontend)
            transportadora, tipo_frete, placa_veiculo, veiculo_uf, rntrc,
            qtd_volumes, especie_volumes, marca_volumes, numeracao_volumes,
            peso_liquido, peso_bruto, valor_seguro, tipo_entrega,
            numero_lacre, outras_despesas, codigo_rastreio, veiculo_proprio,
            // Informações adicionais
            nf, origem, info_complementar, vendedor_nome
        } = req.body;
        const pool = await getPool();
        
        // Construir query dinâmica apenas com campos fornecidos
        const updates = [];
        const params = [];
        
        // Campos básicos
        if (cliente_id !== undefined) { updates.push('cliente_id = ?'); params.push(cliente_id); }
        if (empresa_id !== undefined) { updates.push('empresa_id = ?'); params.push(empresa_id); }
        if (valor !== undefined) { updates.push('valor = ?'); params.push(valor); }
        if (valor_total !== undefined) { updates.push('valor = ?'); params.push(valor_total); }
        if (desconto !== undefined) { updates.push('desconto = ?'); params.push(desconto); }
        if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }
        if (observacao !== undefined) { updates.push('observacao = ?'); params.push(observacao); }
        if (observacoes !== undefined) { updates.push('observacao = ?'); params.push(observacoes); }
        if (observacao_cliente !== undefined) { updates.push('observacao_cliente = ?'); params.push(observacao_cliente); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }
        if (frete !== undefined) { updates.push('frete = ?'); params.push(frete); }
        if (prioridade !== undefined) { updates.push('prioridade = ?'); params.push(prioridade); }
        if (prazo_entrega !== undefined) { updates.push('prazo_entrega = ?'); params.push(prazo_entrega); }
        if (endereco_entrega !== undefined) { updates.push('endereco_entrega = ?'); params.push(endereco_entrega); }
        if (municipio_entrega !== undefined) { updates.push('municipio_entrega = ?'); params.push(municipio_entrega); }
        if (metodo_envio !== undefined) { updates.push('metodo_envio = ?'); params.push(metodo_envio); }
        if (condicao_pagamento !== undefined) { updates.push('condicao_pagamento = ?'); params.push(condicao_pagamento); }
        if (condicoes_pagamento !== undefined) { updates.push('condicao_pagamento = ?'); params.push(condicoes_pagamento); }
        if (cenario_fiscal !== undefined) { updates.push('cenario_fiscal = ?'); params.push(cenario_fiscal); }
        if (parcelas !== undefined) { updates.push('parcelas = ?'); params.push(parcelas); }
        if (produtos !== undefined) { updates.push('produtos_preview = ?'); params.push(JSON.stringify(produtos)); }
        if (itens !== undefined) { updates.push('produtos_preview = ?'); params.push(JSON.stringify(itens)); }
        
        // Campos de transporte/frete
        if (transportadora !== undefined) { updates.push('transportadora = ?'); params.push(transportadora); }
        if (tipo_frete !== undefined) { updates.push('tipo_frete = ?'); params.push(tipo_frete); }
        if (placa_veiculo !== undefined) { updates.push('placa_veiculo = ?'); params.push(placa_veiculo); }
        if (veiculo_uf !== undefined) { updates.push('veiculo_uf = ?'); params.push(veiculo_uf); }
        if (rntrc !== undefined) { updates.push('rntrc = ?'); params.push(rntrc); }
        if (qtd_volumes !== undefined) { updates.push('qtd_volumes = ?'); params.push(qtd_volumes); }
        if (especie_volumes !== undefined) { updates.push('especie_volumes = ?'); params.push(especie_volumes); }
        if (marca_volumes !== undefined) { updates.push('marca_volumes = ?'); params.push(marca_volumes); }
        if (numeracao_volumes !== undefined) { updates.push('numeracao_volumes = ?'); params.push(numeracao_volumes); }
        if (peso_liquido !== undefined) { updates.push('peso_liquido = ?'); params.push(peso_liquido); }
        if (peso_bruto !== undefined) { updates.push('peso_bruto = ?'); params.push(peso_bruto); }
        if (valor_seguro !== undefined) { updates.push('valor_seguro = ?'); params.push(valor_seguro); }
        if (tipo_entrega !== undefined) { updates.push('tipo_entrega = ?'); params.push(tipo_entrega); }
        if (numero_lacre !== undefined) { updates.push('numero_lacre = ?'); params.push(numero_lacre); }
        if (outras_despesas !== undefined) { updates.push('outras_despesas = ?'); params.push(outras_despesas); }
        if (codigo_rastreio !== undefined) { updates.push('codigo_rastreio = ?'); params.push(codigo_rastreio); }
        if (veiculo_proprio !== undefined) { updates.push('veiculo_proprio = ?'); params.push(veiculo_proprio); }
        
        // Informações adicionais
        if (nf !== undefined) { updates.push('nf = ?'); params.push(nf); }
        if (origem !== undefined) { updates.push('origem = ?'); params.push(origem); }
        if (info_complementar !== undefined) { updates.push('info_complementar = ?'); params.push(info_complementar); }
        if (vendedor_nome !== undefined) { updates.push('vendedor_nome = ?'); params.push(vendedor_nome); }
        
        // Sempre atualizar updated_at
        updates.push('updated_at = NOW()');
        
        if (updates.length === 1) { // Apenas updated_at
            return res.status(400).json({ error: 'Nenhum campo para atualizar' });
        }
        
        params.push(id);
        await pool.query(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = ?`, params);
        
        res.json({ success: true, message: 'Pedido atualizado com sucesso' });
    } catch (error) {
        console.error('Error updating pedido:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao atualizar pedido: ' + (error.message || 'Erro interno')
        });
    }
});

// DELETE /api/vendas/pedidos/:id - Cancelar pedido (soft delete)
router.delete('/pedidos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getPool();
        
        // Verificar se o pedido existe
        const [existing] = await pool.query('SELECT id, status FROM pedidos WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pedido não encontrado'
            });
        }
        
        // Não permitir cancelar pedidos já faturados
        if (existing[0].status === 'faturado') {
            return res.status(400).json({
                success: false,
                message: 'Não é possível cancelar pedidos já faturados'
            });
        }
        
        // Soft delete - muda status para cancelado
        await pool.query(
            'UPDATE pedidos SET status = ?, updated_at = NOW() WHERE id = ?',
            ['cancelado', id]
        );
        
        // Registrar no histórico
        try {
            await pool.query(
                'INSERT INTO pedido_historico (pedido_id, tipo, descricao, usuario_id, created_at) VALUES (?, ?, ?, ?, NOW())',
                [id, 'cancelamento', 'Pedido cancelado', req.user?.id || null]
            );
        } catch (histErr) {
            console.warn('Erro ao registrar histórico de cancelamento:', histErr);
        }
        
        res.json({
            success: true,
            message: 'Pedido cancelado com sucesso'
        });
    } catch (error) {
        console.error('Error deleting pedido:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao cancelar pedido'
        });
    }
});

// PATCH /api/vendas/pedidos/:id - Atualização parcial (usado pelo frontend)
// Redireciona para PUT que já suporta atualizações parciais
router.patch('/pedidos/:id', authenticateToken, (req, res, next) => {
    // PUT já suporta atualização parcial, então basta redirecionar
    req.method = 'PUT';
    next('route');
});

// Registrar rota PATCH como alias de PUT
router.patch('/pedidos/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getPool();
        
        // Verificar se pedido existe
        const [existing] = await pool.query('SELECT id FROM pedidos WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
        }
        
        // Construir query dinâmica com todos os campos possíveis
        const updates = [];
        const params = [];
        
        // Mapeamento de campos do frontend para banco de dados
        const fieldMap = {
            // Campos básicos
            cliente_id: 'cliente_id', empresa_id: 'empresa_id',
            valor: 'valor', valor_total: 'valor', desconto: 'desconto',
            descricao: 'descricao', observacao: 'observacao', observacoes: 'observacao',
            observacao_cliente: 'observacao_cliente', status: 'status',
            frete: 'frete', prioridade: 'prioridade',
            prazo_entrega: 'prazo_entrega', endereco_entrega: 'endereco_entrega',
            municipio_entrega: 'municipio_entrega', metodo_envio: 'metodo_envio',
            condicao_pagamento: 'condicao_pagamento', condicoes_pagamento: 'condicao_pagamento',
            cenario_fiscal: 'cenario_fiscal', parcelas: 'parcelas',
            
            // Campos de transporte/frete
            transportadora: 'transportadora', tipo_frete: 'tipo_frete',
            placa_veiculo: 'placa_veiculo', veiculo_uf: 'veiculo_uf', rntrc: 'rntrc',
            qtd_volumes: 'qtd_volumes', especie_volumes: 'especie_volumes',
            marca_volumes: 'marca_volumes', numeracao_volumes: 'numeracao_volumes',
            peso_liquido: 'peso_liquido', peso_bruto: 'peso_bruto',
            valor_seguro: 'valor_seguro', tipo_entrega: 'tipo_entrega',
            numero_lacre: 'numero_lacre', outras_despesas: 'outras_despesas',
            codigo_rastreio: 'codigo_rastreio', veiculo_proprio: 'veiculo_proprio',
            
            // Informações adicionais
            nf: 'nf', origem: 'origem', info_complementar: 'info_complementar',
            vendedor_nome: 'vendedor_nome'
        };
        
        // Processar cada campo
        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (req.body[key] !== undefined) {
                updates.push(`${dbField} = ?`);
                params.push(req.body[key]);
            }
        }
        
        // Campos JSON especiais
        if (req.body.produtos !== undefined) {
            updates.push('produtos_preview = ?');
            params.push(JSON.stringify(req.body.produtos));
        }
        if (req.body.itens !== undefined) {
            updates.push('produtos_preview = ?');
            params.push(JSON.stringify(req.body.itens));
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
        }
        
        updates.push('updated_at = NOW()');
        params.push(id);
        
        await pool.query(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = ?`, params);
        
        res.json({ success: true, message: 'Pedido atualizado com sucesso' });
    } catch (error) {
        console.error('Error updating pedido (PATCH):', error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar pedido', error: error.message });
    }
});

// POST /api/vendas/pedidos/:id/historico - Registrar histórico de alterações
router.post('/pedidos/:id/historico', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { tipo, descricao, usuario } = req.body;
        const pool = await getPool();
        
        // Verificar se o pedido existe
        const [existing] = await pool.query('SELECT id FROM pedidos WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        // Tentar inserir no log de auditoria
        try {
            await pool.query(`
                INSERT INTO audit_log (tabela, registro_id, acao, dados_novos, usuario_id, created_at)
                VALUES ('pedidos', ?, ?, ?, ?, NOW())
            `, [id, tipo || 'historico', JSON.stringify({ descricao, usuario }), req.user?.id || null]);
        } catch (auditError) {
            // Se a tabela audit_log não existir, apenas logar
            console.log('Histórico registrado (audit_log não disponível):', { pedidoId: id, tipo, descricao });
        }
        
        res.json({ 
            success: true, 
            message: 'Histórico registrado com sucesso'
        });
    } catch (error) {
        console.error('Error registering historico:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao registrar histórico'
        });
    }
});

// POST /api/vendas/pedidos/:id/faturar - Faturar um pedido
router.post('/pedidos/:id/faturar', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            data_faturamento, 
            numero_nf, 
            gerar_financeiro = true,
            observacoes 
        } = req.body;
        const pool = await getPool();
        
        // Verificar se o pedido existe
        const [existing] = await pool.query(
            'SELECT id, status, valor, cliente_id, empresa_id FROM pedidos WHERE id = ?', 
            [id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Pedido não encontrado' 
            });
        }
        
        const pedido = existing[0];
        
        // Não permitir faturar pedidos cancelados
        if (pedido.status === 'cancelado') {
            return res.status(400).json({ 
                success: false, 
                message: 'Não é possível faturar um pedido cancelado' 
            });
        }
        
        // Não permitir faturar pedidos já faturados
        if (pedido.status === 'faturado') {
            return res.status(400).json({ 
                success: false, 
                message: 'Este pedido já está faturado' 
            });
        }
        
        // Atualizar status para faturado
        const dataFat = data_faturamento || new Date().toISOString().split('T')[0];
        await pool.query(`
            UPDATE pedidos 
            SET status = 'faturado', 
                data_faturamento = ?,
                numero_nf = COALESCE(?, numero_nf),
                updated_at = NOW()
            WHERE id = ?
        `, [dataFat, numero_nf || null, id]);
        
        // Registrar no histórico
        try {
            await pool.query(`
                INSERT INTO pedido_historico 
                (pedido_id, tipo, descricao, usuario_id, created_at)
                VALUES (?, 'faturamento', ?, ?, NOW())
            `, [id, observacoes || `Pedido faturado em ${dataFat}`, req.user?.id || null]);
        } catch (histErr) {
            console.warn('Erro ao registrar histórico de faturamento:', histErr.message);
        }
        
        // Gerar registro financeiro se solicitado
        if (gerar_financeiro) {
            try {
                await pool.query(`
                    INSERT INTO financeiro 
                    (tipo, descricao, valor, pedido_id, cliente_id, empresa_id, status, data_vencimento, created_at)
                    VALUES ('receita', ?, ?, ?, ?, ?, 'pendente', DATE_ADD(?, INTERVAL 30 DAY), NOW())
                `, [
                    `Faturamento pedido #${id}`,
                    pedido.valor || 0,
                    id,
                    pedido.cliente_id,
                    pedido.empresa_id,
                    dataFat
                ]);
            } catch (finErr) {
                // Tabela financeiro pode não existir
                console.log('Registro financeiro não gerado (tabela pode não existir):', finErr.message);
            }
        }
        
        res.json({ 
            success: true, 
            message: 'Pedido faturado com sucesso',
            data_faturamento: dataFat,
            numero_nf
        });
    } catch (error) {
        console.error('Error faturando pedido:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao faturar pedido',
            error: error.message
        });
    }
});

// =================================================================
// CLIENTES ROUTES
// =================================================================

// GET /api/vendas/clientes - Listar todos os clientes
router.get('/clientes', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const { search, limit = 50, offset = 0, ativo } = req.query;
        
        let sql = `
            SELECT 
                id, razao_social, nome_fantasia, cnpj_cpf, ie, 
                endereco, cidade, estado, cep, telefone, email,
                contato, observacoes, ativo, created_at, updated_at
            FROM clientes WHERE 1=1
        `;
        const params = [];
        
        if (search) {
            sql += ` AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj_cpf LIKE ?)`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        
        if (ativo !== undefined) {
            sql += ` AND ativo = ?`;
            params.push(ativo === 'true' ? 1 : 0);
        }
        
        sql += ` ORDER BY razao_social LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));
        
        const [clientes] = await pool.query(sql, params);
        
        // Contagem total
        let countSql = `SELECT COUNT(*) as total FROM clientes WHERE 1=1`;
        const countParams = [];
        if (search) {
            countSql += ` AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj_cpf LIKE ?)`;
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm);
        }
        if (ativo !== undefined) {
            countSql += ` AND ativo = ?`;
            countParams.push(ativo === 'true' ? 1 : 0);
        }
        
        const [[{ total }]] = await pool.query(countSql, countParams);
        
        res.json({
            success: true,
            clientes,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Error getting clientes:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar clientes',
            error: error.message
        });
    }
});

// GET /api/vendas/clientes/:id - Obter cliente específico
router.get('/clientes/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const { id } = req.params;
        
        const [clientes] = await pool.query(`
            SELECT * FROM clientes WHERE id = ?
        `, [id]);
        
        if (clientes.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Cliente não encontrado'
            });
        }
        
        res.json({
            success: true,
            cliente: clientes[0]
        });
    } catch (error) {
        console.error('Error getting cliente:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar cliente',
            error: error.message
        });
    }
});

// POST /api/vendas/clientes - Criar novo cliente
router.post('/clientes', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const {
            razao_social, nome_fantasia, cnpj_cpf, ie,
            endereco, cidade, estado, cep, telefone, email,
            contato, observacoes, ativo = 1
        } = req.body;
        
        // Validação básica
        if (!razao_social || !cnpj_cpf) {
            return res.status(400).json({
                success: false,
                message: 'Razão social e CNPJ/CPF são obrigatórios'
            });
        }
        
        // Validação de CNPJ/CPF com verificação de dígitos
        const docValidation = validateCNPJorCPF(cnpj_cpf);
        if (!docValidation.valid) {
            return res.status(400).json({
                success: false,
                message: docValidation.message,
                documentType: docValidation.type
            });
        }
        
        // Verificar CNPJ/CPF duplicado
        const [existing] = await pool.query(
            'SELECT id FROM clientes WHERE cnpj_cpf = ?',
            [cnpj_cpf]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Já existe um cliente com este CNPJ/CPF'
            });
        }
        
        const [result] = await pool.query(`
            INSERT INTO clientes 
            (razao_social, nome_fantasia, cnpj_cpf, ie, endereco, cidade, estado, cep, telefone, email, contato, observacoes, ativo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [razao_social, nome_fantasia, cnpj_cpf, ie, endereco, cidade, estado, cep, telefone, email, contato, observacoes, ativo]);
        
        res.status(201).json({
            success: true,
            message: 'Cliente criado com sucesso',
            clienteId: result.insertId
        });
    } catch (error) {
        console.error('Error creating cliente:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao criar cliente',
            error: error.message
        });
    }
});

// PUT /api/vendas/clientes/:id - Atualizar cliente
router.put('/clientes/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const { id } = req.params;
        const {
            razao_social, nome_fantasia, cnpj_cpf, ie,
            endereco, cidade, estado, cep, telefone, email,
            contato, observacoes, ativo
        } = req.body;
        
        // Verificar se cliente existe
        const [existing] = await pool.query('SELECT id FROM clientes WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Cliente não encontrado'
            });
        }
        
        // Se CNPJ/CPF está sendo atualizado, validar formato e verificar duplicatas
        if (cnpj_cpf !== undefined) {
            const docValidation = validateCNPJorCPF(cnpj_cpf);
            if (!docValidation.valid) {
                return res.status(400).json({
                    success: false,
                    message: docValidation.message,
                    documentType: docValidation.type
                });
            }
            
            // Verificar se o novo CNPJ/CPF já existe em outro cliente
            const [duplicate] = await pool.query(
                'SELECT id FROM clientes WHERE cnpj_cpf = ? AND id != ?',
                [cnpj_cpf, id]
            );
            if (duplicate.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Já existe outro cliente com este CNPJ/CPF'
                });
            }
        }
        
        // Construir query dinâmica
        const updates = [];
        const params = [];
        
        if (razao_social !== undefined) { updates.push('razao_social = ?'); params.push(razao_social); }
        if (nome_fantasia !== undefined) { updates.push('nome_fantasia = ?'); params.push(nome_fantasia); }
        if (cnpj_cpf !== undefined) { updates.push('cnpj_cpf = ?'); params.push(cnpj_cpf); }
        if (ie !== undefined) { updates.push('ie = ?'); params.push(ie); }
        if (endereco !== undefined) { updates.push('endereco = ?'); params.push(endereco); }
        if (cidade !== undefined) { updates.push('cidade = ?'); params.push(cidade); }
        if (estado !== undefined) { updates.push('estado = ?'); params.push(estado); }
        if (cep !== undefined) { updates.push('cep = ?'); params.push(cep); }
        if (telefone !== undefined) { updates.push('telefone = ?'); params.push(telefone); }
        if (email !== undefined) { updates.push('email = ?'); params.push(email); }
        if (contato !== undefined) { updates.push('contato = ?'); params.push(contato); }
        if (observacoes !== undefined) { updates.push('observacoes = ?'); params.push(observacoes); }
        if (ativo !== undefined) { updates.push('ativo = ?'); params.push(ativo); }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Nenhum campo para atualizar'
            });
        }
        
        updates.push('updated_at = NOW()');
        params.push(id);
        
        await pool.query(`UPDATE clientes SET ${updates.join(', ')} WHERE id = ?`, params);
        
        res.json({
            success: true,
            message: 'Cliente atualizado com sucesso'
        });
    } catch (error) {
        console.error('Error updating cliente:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao atualizar cliente',
            error: error.message
        });
    }
});

// DELETE /api/vendas/clientes/:id - Excluir cliente (soft delete)
router.delete('/clientes/:id', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const { id } = req.params;
        const { hard = 'false' } = req.query;
        
        // Verificar se cliente existe
        const [existing] = await pool.query('SELECT id FROM clientes WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Cliente não encontrado'
            });
        }
        
        if (hard === 'true') {
            // Hard delete
            await pool.query('DELETE FROM clientes WHERE id = ?', [id]);
            res.json({
                success: true,
                message: 'Cliente excluído permanentemente'
            });
        } else {
            // Soft delete - marca como inativo
            await pool.query('UPDATE clientes SET ativo = 0, updated_at = NOW() WHERE id = ?', [id]);
            res.json({
                success: true,
                message: 'Cliente desativado com sucesso'
            });
        }
    } catch (error) {
        console.error('Error deleting cliente:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao excluir cliente',
            error: error.message
        });
    }
});

// =================================================================
// PRODUTOS ROUTES
// =================================================================

// GET /api/vendas/produtos/autocomplete/:termo - Buscar produtos para autocomplete
router.get('/produtos/autocomplete/:termo', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const termo = req.params.termo || '';
        
        if (termo.length < 2) {
            return res.json([]);
        }
        
        const searchTerm = `%${termo}%`;
        
        const [produtos] = await pool.query(`
            SELECT 
                id,
                codigo,
                descricao,
                preco_venda,
                unidade,
                estoque_atual,
                ncm,
                cfop
            FROM produtos 
            WHERE 
                codigo LIKE ? OR 
                descricao LIKE ? OR 
                sku LIKE ?
            ORDER BY descricao ASC
            LIMIT 20
        `, [searchTerm, searchTerm, searchTerm]);
        
        res.json(produtos);
    } catch (error) {
        console.error('Erro no autocomplete de produtos:', error);
        res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
});

// GET /api/vendas/produtos
router.get('/produtos', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const { search, limit = 50, offset = 0 } = req.query;
        
        let query = 'SELECT * FROM produtos';
        let params = [];
        
        if (search) {
            query += ' WHERE codigo LIKE ? OR descricao LIKE ?';
            params.push(`%${search}%`, `%${search}%`);
        }
        
        query += ' ORDER BY descricao ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [produtos] = await pool.query(query, params);
        
        res.json({
            success: true,
            produtos: produtos,
            categorias: []
        });
    } catch (error) {
        console.error('Error getting produtos:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar produtos'
        });
    }
});

// =================================================================
// KANBAN ROUTES
// =================================================================

// GET /api/vendas/kanban
router.get('/kanban', authenticateToken, async (req, res) => {
    try {
        // TODO: Buscar cards do kanban do banco
        res.json({
            success: true,
            cards: []
        });
    } catch (error) {
        console.error('Error getting kanban:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar kanban'
        });
    }
});

// GET /api/vendas/kanban/pedidos - Listar todos os pedidos para o Kanban
router.get('/kanban/pedidos', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        
        // Query com subquery para calcular valor_total dos itens
        const [pedidos] = await pool.query(`
            SELECT p.id, 
                   p.status, 
                   p.valor,
                   COALESCE(
                       (SELECT SUM(COALESCE(pi.subtotal, pi.quantidade * pi.preco_unitario, 0)) 
                        FROM pedido_itens pi WHERE pi.pedido_id = p.id), 
                       p.valor, 
                       0
                   ) as valor_total_itens,
                   p.descricao as observacoes,
                   p.created_at as data_criacao,
                   p.prioridade as tipo,
                   p.frete,
                   c.nome as cliente_nome,
                   c.cnpj as cliente_cnpj,
                   u.nome as vendedor_nome,
                   e.nome_fantasia as empresa_nome
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            LEFT JOIN empresas e ON p.empresa_id = e.id
            ORDER BY p.created_at DESC
            LIMIT 200
        `);
        
        // Formatar pedidos para o frontend
        const pedidosFormatados = pedidos.map(p => {
            // Priorizar valor calculado dos itens, depois valor do pedido
            const valorTotal = parseFloat(p.valor_total_itens) || parseFloat(p.valor) || 0;
            return {
                id: p.id,
                numero: `Orçamento Nº ${p.id}`,
                cliente: p.cliente_nome || 'Cliente não informado',
                status: p.status || 'orcamento',
                valor: valorTotal,
                valor_total: valorTotal,
                faturamento: p.observacoes || 'Aguardando',
                origem: 'Omie',
                tipo: p.tipo || 'a vista',
                vendedor_nome: p.vendedor_nome || '',
                data_criacao: p.data_criacao,
                observacoes: p.observacoes || ''
            };
        });
        
        res.json(pedidosFormatados);
    } catch (error) {
        console.error('Error getting kanban pedidos:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar pedidos do kanban'
        });
    }
});

// Função auxiliar para enviar notificação ao Discord
async function enviarNotificacaoDiscord(pedidoId, statusAnterior, statusNovo, nomeUsuario = 'Sistema') {
    try {
        // SEGURANÇA: Webhook DEVE vir de variável de ambiente
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        if (!webhookUrl) {
            console.warn('[Discord] DISCORD_WEBHOOK_URL não configurado - notificação não enviada');
            return;
        }
        
        const statusEmojis = {
            'orcamento': '📝',
            'analise-credito': '🔍',
            'analise': '🔍',
            'pedido-aprovado': '✅',
            'aprovado': '✅',
            'faturar': '💵',
            'faturado': '✅',
            'recibo': '🎉',
            'Concluído': '🎉',
            'concluido': '🎉'
        };
        
        const statusNomes = {
            'orcamento': 'Orçamento',
            'analise-credito': 'Análise de Crédito',
            'analise': 'Análise de Crédito',
            'pedido-aprovado': 'Crédito Aprovado',
            'aprovado': 'Crédito Aprovado',
            'faturar': 'Faturar',
            'faturado': 'Faturado',
            'recibo': 'Finalizado',
            'Concluído': 'Finalizado',
            'concluido': 'Finalizado'
        };
        
        const emojiAnt = statusEmojis[statusAnterior] || '📋';
        const emojiNovo = statusEmojis[statusNovo] || '📋';
        const nomeAnt = statusNomes[statusAnterior] || statusAnterior;
        const nomeNovo = statusNomes[statusNovo] || statusNovo;
        
        const embed = {
            title: `${emojiNovo} Pedido #${pedidoId} - Status Atualizado`,
            description: `**${emojiAnt} ${nomeAnt}** → **${emojiNovo} ${nomeNovo}**`,
            color: statusNovo === 'recibo' || statusNovo === 'Concluído' || statusNovo === 'concluido' ? 8388736 : (statusNovo === 'faturado' ? 5763719 : 3447003),
            fields: [
                {
                    name: '👤 Movido por',
                    value: nomeUsuario,
                    inline: true
                },
                {
                    name: '🕒 Data/Hora',
                    value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                    inline: true
                }
            ],
            footer: {
                text: 'ALUFORCE ERP - Vendas'
            },
            timestamp: new Date().toISOString()
        };
        
        const fetch = require('node-fetch');
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'ALUFORCE Vendas',
                avatar_url: 'https://i.imgur.com/4M34hi2.png',
                embeds: [embed]
            })
        });
        
        console.log(`🔔 Discord notificado: Pedido ${pedidoId} ${nomeAnt} → ${nomeNovo}`);
    } catch (error) {
        console.error('❌ Erro ao enviar notificação Discord:', error.message);
    }
}

// PUT /api/vendas/pedidos/:id/status - Atualizar apenas o status do pedido
router.put('/pedidos/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        let { status } = req.body;
        
        if (!status) {
            return res.status(400).json({ error: 'Status é obrigatório' });
        }
        
        // Se o status for 'recibo', alterar para 'Concluído'
        if (status === 'recibo') {
            status = 'Concluído';
        }
        
        const pool = await getPool();
        
        // Verificar se o pedido existe e buscar dados completos
        const [existing] = await pool.query('SELECT id, status, cliente, cliente_nome, valor FROM pedidos WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        const statusAnterior = existing[0].status;
        const clienteNome = existing[0].cliente_nome || existing[0].cliente || 'Cliente não informado';
        const valor = existing[0].valor || 0;
        
        // Atualizar o status
        await pool.query('UPDATE pedidos SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
        
        // Registrar no log de auditoria se existir
        try {
            await pool.query(`
                INSERT INTO audit_log (tabela, registro_id, acao, dados_anteriores, dados_novos, usuario_id, created_at)
                VALUES ('pedidos', ?, 'status_change', ?, ?, ?, NOW())
            `, [id, JSON.stringify({ status: statusAnterior }), JSON.stringify({ status }), req.user?.id || null]);
        } catch (auditError) {
            console.log('Audit log não disponível:', auditError.message);
        }
        
        console.log(`✅ Pedido ${id}: status alterado de "${statusAnterior}" para "${status}"`);
        
        // Enviar notificação ao Discord (não aguardar para não atrasar resposta)
        const nomeUsuario = req.user?.nome || req.user?.username || 'Sistema';
        enviarNotificacaoDiscord(id, statusAnterior, status, nomeUsuario).catch(err => 
            console.error('Erro ao notificar Discord:', err)
        );
        
        res.json({ 
            success: true, 
            message: 'Status atualizado com sucesso',
            statusAnterior,
            statusNovo: status
        });
    } catch (error) {
        console.error('Error updating pedido status:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao atualizar status do pedido'
        });
    }
});

// POST /api/vendas/kanban/mover
router.post('/kanban/mover', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const { cardId, novoStatus, pedidoId } = req.body;
        
        // Usar pedidoId ou cardId (compatibilidade)
        const id = pedidoId || cardId;
        
        if (!id || !novoStatus) {
            return res.status(400).json({
                success: false,
                message: 'ID do pedido e novo status são obrigatórios'
            });
        }
        
        // Status válidos para o kanban
        const statusValidos = ['orcamento', 'pendente', 'aprovado', 'producao', 'pronto', 'enviado', 'entregue', 'cancelado', 'faturado'];
        if (!statusValidos.includes(novoStatus)) {
            return res.status(400).json({
                success: false,
                message: `Status inválido. Valores permitidos: ${statusValidos.join(', ')}`
            });
        }
        
        // Verificar se o pedido existe
        const [existing] = await pool.query('SELECT id, status FROM pedidos WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pedido não encontrado'
            });
        }
        
        const statusAnterior = existing[0].status;
        
        // Não permitir mover de faturado para outro status (exceto admin)
        if (statusAnterior === 'faturado' && novoStatus !== 'faturado') {
            return res.status(400).json({
                success: false,
                message: 'Pedidos faturados não podem ter status alterado'
            });
        }
        
        // Atualizar status do pedido
        await pool.query(
            'UPDATE pedidos SET status = ?, updated_at = NOW() WHERE id = ?',
            [novoStatus, id]
        );
        
        // Registrar no histórico
        await pool.query(
            `INSERT INTO pedido_historico (pedido_id, status_anterior, status_novo, usuario_id, observacao, created_at)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [id, statusAnterior, novoStatus, req.user?.id || null, 'Status alterado via Kanban']
        );
        
        res.json({
            success: true,
            message: 'Status do pedido atualizado com sucesso',
            statusAnterior,
            novoStatus
        });
    } catch (error) {
        console.error('Error moving kanban card:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao mover card',
            error: error.message
        });
    }
});

// =================================================================
// METAS ROUTES
// =================================================================

// GET /api/vendas/metas
router.get('/metas', authenticateToken, async (req, res) => {
    try {
        // TODO: Buscar metas e comissões do banco
        res.json({
            success: true,
            metas: [],
            comissoes: []
        });
    } catch (error) {
        console.error('Error getting metas:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar metas'
        });
    }
});

// GET /api/vendas/metas/ranking - Ranking de vendedores com metas
router.get('/metas/ranking', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const { periodo } = req.query;
        
        // Usar período atual se não especificado
        const periodoAtual = periodo || new Date().toISOString().substring(0, 7);
        const [ano, mes] = periodoAtual.split('-');
        
        // Buscar vendedores com suas vendas no período
        const [vendedores] = await pool.query(`
            SELECT 
                v.id,
                v.nome,
                v.email,
                v.avatar,
                v.meta_mensal,
                COALESCE(SUM(CASE 
                    WHEN p.status IN ('aprovado', 'faturado', 'entregue') 
                    AND YEAR(p.data_criacao) = ? 
                    AND MONTH(p.data_criacao) = ?
                    THEN p.valor_total 
                    ELSE 0 
                END), 0) as valor_realizado,
                COUNT(CASE 
                    WHEN p.status IN ('aprovado', 'faturado', 'entregue') 
                    AND YEAR(p.data_criacao) = ? 
                    AND MONTH(p.data_criacao) = ?
                    THEN p.id 
                END) as qtd_vendas
            FROM vendedores v
            LEFT JOIN pedidos p ON v.id = p.vendedor_id
            WHERE v.ativo = 1
            GROUP BY v.id
            ORDER BY valor_realizado DESC
        `, [parseInt(ano), parseInt(mes), parseInt(ano), parseInt(mes)]);
        
        // Adicionar posição e percentual
        const ranking = vendedores.map((v, index) => {
            const meta = parseFloat(v.meta_mensal) || 50000;
            const valorRealizado = parseFloat(v.valor_realizado) || 0;
            const percentual = meta > 0 ? (valorRealizado / meta) * 100 : 0;
            
            return {
                posicao: index + 1,
                id: v.id,
                nome: v.nome,
                email: v.email,
                avatar: v.avatar,
                meta_mensal: meta,
                valor_realizado: valorRealizado,
                qtd_vendas: parseInt(v.qtd_vendas) || 0,
                percentual_atingido: percentual.toFixed(1)
            };
        });
        
        res.json({
            success: true,
            periodo: periodoAtual,
            ranking
        });
    } catch (error) {
        console.error('Error getting ranking:', error);
        // Retornar ranking vazio em caso de erro
        res.json({
            success: true,
            periodo: req.query.periodo || new Date().toISOString().substring(0, 7),
            ranking: []
        });
    }
});

// GET /api/vendas/notificacoes - Notificações do vendedor
router.get('/notificacoes', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        const userId = req.user?.id || req.user?.userId;
        
        // Buscar notificações do vendedor
        const [notificacoes] = await pool.query(`
            SELECT 
                id,
                tipo,
                titulo,
                mensagem,
                prioridade,
                lida,
                created_at
            FROM notificacoes
            WHERE usuario_id = ? OR usuario_id IS NULL
            ORDER BY created_at DESC
            LIMIT 20
        `, [userId]).catch(() => [[]]);
        
        // Se não houver tabela de notificações, retornar vazio
        res.json({
            success: true,
            notificacoes: notificacoes || []
        });
    } catch (error) {
        console.error('Error getting notificacoes:', error);
        // Retornar vazio em caso de erro (tabela pode não existir)
        res.json({
            success: true,
            notificacoes: []
        });
    }
});

// =================================================================
// IMPOSTOS ROUTES
// =================================================================

// Cenários fiscais padrão (fallback quando banco não disponível)
const cenariosFiscaisPadrao = {
    venda_normal: {
        codigo: 'venda_normal',
        nome: 'Venda Normal (Dentro do Estado)',
        icms_aliquota: 18.00,
        icms_reducao_base: 0,
        icms_st_aliquota: 0,
        icms_st_mva: 0,
        ipi_aliquota: 0,
        pis_aliquota: 1.65,
        cofins_aliquota: 7.60,
        iss_aliquota: 0,
        cst_icms: '00',
        cst_ipi: '50',
        cst_pis: '01',
        cst_cofins: '01',
        cfop_dentro_estado: '5102',
        cfop_fora_estado: '6102',
        calcula_icms_st: false,
        destaca_impostos: true
    },
    venda_fora_estado: {
        codigo: 'venda_fora_estado',
        nome: 'Venda Fora do Estado',
        icms_aliquota: 12.00,
        icms_reducao_base: 0,
        icms_st_aliquota: 0,
        icms_st_mva: 0,
        ipi_aliquota: 0,
        pis_aliquota: 1.65,
        cofins_aliquota: 7.60,
        iss_aliquota: 0,
        cst_icms: '00',
        cst_ipi: '50',
        cst_pis: '01',
        cst_cofins: '01',
        cfop_dentro_estado: '5102',
        cfop_fora_estado: '6102',
        calcula_icms_st: false,
        destaca_impostos: true
    },
    venda_zona_franca: {
        codigo: 'venda_zona_franca',
        nome: 'Venda Zona Franca',
        icms_aliquota: 0,
        icms_reducao_base: 0,
        icms_st_aliquota: 0,
        icms_st_mva: 0,
        ipi_aliquota: 0,
        pis_aliquota: 1.65,
        cofins_aliquota: 7.60,
        iss_aliquota: 0,
        cst_icms: '40',
        cst_ipi: '52',
        cst_pis: '01',
        cst_cofins: '01',
        cfop_dentro_estado: '5109',
        cfop_fora_estado: '6109',
        calcula_icms_st: false,
        destaca_impostos: true
    },
    exportacao: {
        codigo: 'exportacao',
        nome: 'Exportação',
        icms_aliquota: 0,
        icms_reducao_base: 0,
        icms_st_aliquota: 0,
        icms_st_mva: 0,
        ipi_aliquota: 0,
        pis_aliquota: 0,
        cofins_aliquota: 0,
        iss_aliquota: 0,
        cst_icms: '41',
        cst_ipi: '52',
        cst_pis: '08',
        cst_cofins: '08',
        cfop_dentro_estado: '7101',
        cfop_fora_estado: '7101',
        calcula_icms_st: false,
        destaca_impostos: false
    },
    simples_nacional: {
        codigo: 'simples_nacional',
        nome: 'Simples Nacional',
        icms_aliquota: 0,
        icms_reducao_base: 0,
        icms_st_aliquota: 0,
        icms_st_mva: 0,
        ipi_aliquota: 0,
        pis_aliquota: 0,
        cofins_aliquota: 0,
        iss_aliquota: 0,
        cst_icms: '102',
        cst_ipi: '53',
        cst_pis: '49',
        cst_cofins: '49',
        cfop_dentro_estado: '5102',
        cfop_fora_estado: '6102',
        calcula_icms_st: false,
        destaca_impostos: false
    },
    industrializacao: {
        codigo: 'industrializacao',
        nome: 'Industrialização (com IPI)',
        icms_aliquota: 18.00,
        icms_reducao_base: 0,
        icms_st_aliquota: 0,
        icms_st_mva: 0,
        ipi_aliquota: 5.00,
        pis_aliquota: 1.65,
        cofins_aliquota: 7.60,
        iss_aliquota: 0,
        cst_icms: '00',
        cst_ipi: '50',
        cst_pis: '01',
        cst_cofins: '01',
        cfop_dentro_estado: '5101',
        cfop_fora_estado: '6101',
        calcula_icms_st: false,
        destaca_impostos: true
    },
    revenda: {
        codigo: 'revenda',
        nome: 'Revenda de Mercadorias',
        icms_aliquota: 18.00,
        icms_reducao_base: 0,
        icms_st_aliquota: 0,
        icms_st_mva: 0,
        ipi_aliquota: 0,
        pis_aliquota: 1.65,
        cofins_aliquota: 7.60,
        iss_aliquota: 0,
        cst_icms: '00',
        cst_ipi: '53',
        cst_pis: '01',
        cst_cofins: '01',
        cfop_dentro_estado: '5102',
        cfop_fora_estado: '6102',
        calcula_icms_st: false,
        destaca_impostos: true
    }
};

// GET /api/vendas/impostos/cenarios - Listar todos os cenários fiscais
router.get('/impostos/cenarios', authenticateToken, async (req, res) => {
    try {
        const pool = await getPool();
        
        try {
            const [cenarios] = await pool.query(`
                SELECT * FROM cenarios_fiscais WHERE ativo = 1 ORDER BY nome
            `);
            
            if (cenarios.length > 0) {
                res.json({ success: true, cenarios });
                return;
            }
        } catch (dbError) {
            console.log('Tabela cenarios_fiscais não disponível, usando padrão');
        }
        
        // Retornar cenários padrão
        res.json({ 
            success: true, 
            cenarios: Object.values(cenariosFiscaisPadrao)
        });
    } catch (error) {
        console.error('Error getting cenários fiscais:', error);
        res.status(500).json({ success: false, message: 'Erro ao carregar cenários fiscais' });
    }
});

// GET /api/vendas/impostos/cenarios/:codigo - Obter um cenário específico
router.get('/impostos/cenarios/:codigo', authenticateToken, async (req, res) => {
    try {
        const { codigo } = req.params;
        const pool = await getPool();
        
        try {
            const [cenarios] = await pool.query(`
                SELECT * FROM cenarios_fiscais WHERE codigo = ? AND ativo = 1
            `, [codigo]);
            
            if (cenarios.length > 0) {
                res.json({ success: true, cenario: cenarios[0] });
                return;
            }
        } catch (dbError) {
            console.log('Tabela cenarios_fiscais não disponível, usando padrão');
        }
        
        // Retornar cenário padrão
        const cenario = cenariosFiscaisPadrao[codigo];
        if (cenario) {
            res.json({ success: true, cenario });
        } else {
            res.status(404).json({ success: false, message: 'Cenário não encontrado' });
        }
    } catch (error) {
        console.error('Error getting cenário fiscal:', error);
        res.status(500).json({ success: false, message: 'Erro ao carregar cenário fiscal' });
    }
});

// POST /api/vendas/impostos/calcular - Calcular impostos para um pedido
router.post('/impostos/calcular', authenticateToken, async (req, res) => {
    try {
        const { 
            cenario_codigo,
            valor_produtos,
            valor_desconto = 0,
            valor_frete = 0,
            valor_seguro = 0,
            outras_despesas = 0,
            itens = [],
            // Sobrescrever alíquotas se fornecidas
            icms_aliquota_custom,
            icms_reducao_custom,
            icms_st_aliquota_custom,
            icms_st_mva_custom,
            ipi_aliquota_custom,
            pis_aliquota_custom,
            cofins_aliquota_custom,
            iss_aliquota_custom,
            usar_config_sistema = true  // Usar configurações do sistema por padrão
        } = req.body;
        
        // Obter cenário fiscal
        let cenario = cenariosFiscaisPadrao[cenario_codigo] || cenariosFiscaisPadrao.venda_normal;
        
        // Buscar configurações de impostos do sistema (se disponível)
        let configSistema = null;
        if (usar_config_sistema && global.getConfiguracoesImpostos) {
            try {
                configSistema = await global.getConfiguracoesImpostos();
            } catch (e) {
                console.log('Não foi possível buscar config de impostos do sistema:', e.message);
            }
        }
        
        // Aplicar alíquotas: prioridade = custom > sistema > cenário padrão
        const aliquotas = {
            icms: icms_aliquota_custom !== undefined 
                ? parseFloat(icms_aliquota_custom) 
                : (configSistema?.icms !== undefined ? parseFloat(configSistema.icms) : cenario.icms_aliquota),
            icms_reducao: icms_reducao_custom !== undefined ? parseFloat(icms_reducao_custom) : cenario.icms_reducao_base,
            icms_st: icms_st_aliquota_custom !== undefined ? parseFloat(icms_st_aliquota_custom) : cenario.icms_st_aliquota,
            icms_st_mva: icms_st_mva_custom !== undefined ? parseFloat(icms_st_mva_custom) : cenario.icms_st_mva,
            ipi: ipi_aliquota_custom !== undefined 
                ? parseFloat(ipi_aliquota_custom) 
                : (configSistema?.ipi !== undefined ? parseFloat(configSistema.ipi) : cenario.ipi_aliquota),
            pis: pis_aliquota_custom !== undefined 
                ? parseFloat(pis_aliquota_custom) 
                : (configSistema?.pis !== undefined ? parseFloat(configSistema.pis) : cenario.pis_aliquota),
            cofins: cofins_aliquota_custom !== undefined 
                ? parseFloat(cofins_aliquota_custom) 
                : (configSistema?.cofins !== undefined ? parseFloat(configSistema.cofins) : cenario.cofins_aliquota),
            iss: iss_aliquota_custom !== undefined 
                ? parseFloat(iss_aliquota_custom) 
                : (configSistema?.iss !== undefined ? parseFloat(configSistema.iss) : cenario.iss_aliquota)
        };
        
        // Calcular base de cálculo
        const valorProdutos = parseFloat(valor_produtos) || 0;
        const valorDesconto = parseFloat(valor_desconto) || 0;
        const valorFrete = parseFloat(valor_frete) || 0;
        const valorSeguro = parseFloat(valor_seguro) || 0;
        const valorOutras = parseFloat(outras_despesas) || 0;
        
        // Base para cálculo do ICMS (produtos - desconto)
        let baseICMS = valorProdutos - valorDesconto;
        
        // Aplicar redução de base se houver
        if (aliquotas.icms_reducao > 0) {
            baseICMS = baseICMS * (1 - aliquotas.icms_reducao / 100);
        }
        
        // Base para IPI é o valor dos produtos
        const baseIPI = valorProdutos;
        
        // Calcular IPI primeiro (se aplicável)
        const valorIPI = aliquotas.ipi > 0 ? baseIPI * (aliquotas.ipi / 100) : 0;
        
        // Calcular ICMS
        const valorICMS = aliquotas.icms > 0 ? baseICMS * (aliquotas.icms / 100) : 0;
        
        // Calcular ICMS ST (se aplicável)
        let valorICMSST = 0;
        let baseICMSST = 0;
        if (aliquotas.icms_st > 0 && aliquotas.icms_st_mva > 0) {
            // Base ST = (valor produtos + IPI) * (1 + MVA/100)
            baseICMSST = (valorProdutos + valorIPI) * (1 + aliquotas.icms_st_mva / 100);
            // ICMS ST = (Base ST * Alíquota ST) - ICMS próprio
            valorICMSST = (baseICMSST * (aliquotas.icms_st / 100)) - valorICMS;
            if (valorICMSST < 0) valorICMSST = 0;
        }
        
        // Base para PIS e COFINS (produtos - desconto + frete + seguro + outras despesas)
        const basePISCOFINS = valorProdutos - valorDesconto + valorFrete + valorSeguro + valorOutras;
        
        // Calcular PIS e COFINS
        const valorPIS = aliquotas.pis > 0 ? basePISCOFINS * (aliquotas.pis / 100) : 0;
        const valorCOFINS = aliquotas.cofins > 0 ? basePISCOFINS * (aliquotas.cofins / 100) : 0;
        
        // Calcular ISS (para serviços)
        const baseISS = valorProdutos - valorDesconto;
        const valorISS = aliquotas.iss > 0 ? baseISS * (aliquotas.iss / 100) : 0;
        
        // Total de impostos destacados
        const totalImpostos = valorICMS + valorICMSST + valorIPI + valorPIS + valorCOFINS + valorISS;
        
        // Total da NF (produtos + IPI + ICMS ST + frete + seguro + outras - desconto)
        // Nota: PIS, COFINS e ICMS já estão inclusos no preço normalmente
        const totalNF = valorProdutos + valorIPI + valorICMSST + valorFrete + valorSeguro + valorOutras - valorDesconto;
        
        const resultado = {
            cenario: cenario.nome,
            cenario_codigo: cenario.codigo,
            
            // Alíquotas utilizadas
            aliquotas,
            
            // Bases de cálculo
            bases: {
                icms: baseICMS,
                icms_st: baseICMSST,
                ipi: baseIPI,
                pis: basePISCOFINS,
                cofins: basePISCOFINS,
                iss: baseISS
            },
            
            // Valores dos impostos
            valores: {
                icms: valorICMS,
                icms_st: valorICMSST,
                ipi: valorIPI,
                pis: valorPIS,
                cofins: valorCOFINS,
                iss: valorISS
            },
            
            // CSTs
            csts: {
                icms: cenario.cst_icms,
                ipi: cenario.cst_ipi,
                pis: cenario.cst_pis,
                cofins: cenario.cst_cofins
            },
            
            // CFOP
            cfop: {
                dentro_estado: cenario.cfop_dentro_estado,
                fora_estado: cenario.cfop_fora_estado
            },
            
            // Totalizadores
            totais: {
                produtos: valorProdutos,
                desconto: valorDesconto,
                frete: valorFrete,
                seguro: valorSeguro,
                outras_despesas: valorOutras,
                impostos: totalImpostos,
                nota_fiscal: totalNF
            },
            
            destaca_impostos: cenario.destaca_impostos
        };
        
        res.json({ success: true, impostos: resultado });
    } catch (error) {
        console.error('Error calculating impostos:', error);
        res.status(500).json({ success: false, message: 'Erro ao calcular impostos' });
    }
});

// POST /api/vendas/pedidos/:id/impostos - Salvar impostos de um pedido
router.post('/pedidos/:id/impostos', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { impostos, cenario_codigo } = req.body;
        
        const pool = await getPool();
        
        // Verificar se pedido existe
        const [existing] = await pool.query('SELECT id FROM pedidos WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        // Atualizar total_impostos no pedido
        await pool.query(`
            UPDATE pedidos 
            SET total_impostos = ?, cenario_fiscal_id = (SELECT id FROM cenarios_fiscais WHERE codigo = ? LIMIT 1)
            WHERE id = ?
        `, [impostos.totais?.impostos || 0, cenario_codigo, id]);
        
        // Tentar salvar detalhes na tabela pedidos_impostos
        try {
            await pool.query(`
                INSERT INTO pedidos_impostos (
                    pedido_id, cenario_fiscal_id,
                    base_calculo_icms, base_calculo_icms_st, base_calculo_ipi,
                    base_calculo_pis, base_calculo_cofins, base_calculo_iss,
                    valor_icms, valor_icms_st, valor_ipi, valor_pis, valor_cofins, valor_iss,
                    total_impostos, total_produtos, total_desconto, total_frete,
                    total_seguro, total_outras_despesas, total_nf
                ) VALUES (
                    ?, (SELECT id FROM cenarios_fiscais WHERE codigo = ? LIMIT 1),
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?
                )
                ON DUPLICATE KEY UPDATE
                    cenario_fiscal_id = VALUES(cenario_fiscal_id),
                    base_calculo_icms = VALUES(base_calculo_icms),
                    base_calculo_icms_st = VALUES(base_calculo_icms_st),
                    base_calculo_ipi = VALUES(base_calculo_ipi),
                    base_calculo_pis = VALUES(base_calculo_pis),
                    base_calculo_cofins = VALUES(base_calculo_cofins),
                    base_calculo_iss = VALUES(base_calculo_iss),
                    valor_icms = VALUES(valor_icms),
                    valor_icms_st = VALUES(valor_icms_st),
                    valor_ipi = VALUES(valor_ipi),
                    valor_pis = VALUES(valor_pis),
                    valor_cofins = VALUES(valor_cofins),
                    valor_iss = VALUES(valor_iss),
                    total_impostos = VALUES(total_impostos),
                    total_produtos = VALUES(total_produtos),
                    total_desconto = VALUES(total_desconto),
                    total_frete = VALUES(total_frete),
                    total_seguro = VALUES(total_seguro),
                    total_outras_despesas = VALUES(total_outras_despesas),
                    total_nf = VALUES(total_nf),
                    updated_at = NOW()
            `, [
                id, cenario_codigo,
                impostos.bases?.icms || 0, impostos.bases?.icms_st || 0, impostos.bases?.ipi || 0,
                impostos.bases?.pis || 0, impostos.bases?.cofins || 0, impostos.bases?.iss || 0,
                impostos.valores?.icms || 0, impostos.valores?.icms_st || 0, impostos.valores?.ipi || 0,
                impostos.valores?.pis || 0, impostos.valores?.cofins || 0, impostos.valores?.iss || 0,
                impostos.totais?.impostos || 0, impostos.totais?.produtos || 0, impostos.totais?.desconto || 0,
                impostos.totais?.frete || 0, impostos.totais?.seguro || 0, impostos.totais?.outras_despesas || 0,
                impostos.totais?.nota_fiscal || 0
            ]);
        } catch (dbError) {
            console.log('Tabela pedidos_impostos não disponível:', dbError.message);
        }
        
        res.json({ success: true, message: 'Impostos salvos com sucesso' });
    } catch (error) {
        console.error('Error saving impostos:', error);
        res.status(500).json({ success: false, message: 'Erro ao salvar impostos' });
    }
});

// GET /api/vendas/pedidos/:id/impostos - Obter impostos de um pedido
router.get('/pedidos/:id/impostos', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getPool();
        
        try {
            const [impostos] = await pool.query(`
                SELECT pi.*, cf.codigo as cenario_codigo, cf.nome as cenario_nome
                FROM pedidos_impostos pi
                LEFT JOIN cenarios_fiscais cf ON pi.cenario_fiscal_id = cf.id
                WHERE pi.pedido_id = ?
            `, [id]);
            
            if (impostos.length > 0) {
                res.json({ success: true, impostos: impostos[0] });
                return;
            }
        } catch (dbError) {
            console.log('Tabela pedidos_impostos não disponível');
        }
        
        res.json({ success: true, impostos: null });
    } catch (error) {
        console.error('Error getting impostos:', error);
        res.status(500).json({ success: false, message: 'Erro ao carregar impostos' });
    }
});

// ========================================
// PDF GENERATION - ORÇAMENTO / PEDIDO
// ========================================
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// GET /api/vendas/pedidos/:id/pdf - Gerar PDF do orçamento/pedido
router.get('/pedidos/:id/pdf', authenticateToken, async (req, res) => {
    console.log('📄 Gerando PDF para pedido:', req.params.id, '| Usuário:', req.user?.id || 'N/A');
    try {
        const { id } = req.params;
        const pool = await getPool();
        
        // Buscar configurações da empresa (dados do modal de configurações)
        const [configEmpresa] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
        const empresaConfig = configEmpresa[0] || {};
        
        // Buscar dados completos do pedido
        const [pedidos] = await pool.query(`
            SELECT p.*, 
                   p.valor as valor_total,
                   p.descricao as observacoes_internas,
                   p.observacao as observacoes,
                   p.created_at as data_criacao,
                   c.nome as cliente_nome, 
                   c.razao_social as cliente_razao_social,
                   c.nome_fantasia as cliente_nome_fantasia,
                   c.email as cliente_email, 
                   c.telefone as cliente_telefone,
                   c.cnpj_cpf as cliente_cnpj, 
                   c.endereco as cliente_endereco,
                   c.bairro as cliente_bairro,
                   c.cidade as cliente_cidade,
                   c.estado as cliente_estado,
                   c.cep as cliente_cep,
                   c.inscricao_estadual as cliente_ie,
                   e.nome_fantasia as empresa_nome, 
                   e.razao_social as empresa_razao_social,
                   e.cnpj as empresa_cnpj,
                   e.endereco as empresa_endereco,
                   e.cidade as empresa_cidade,
                   e.estado as empresa_estado,
                   e.telefone as empresa_telefone,
                   e.email as empresa_email,
                   u.nome as vendedor_nome,
                   u.email as vendedor_email
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN empresas e ON p.empresa_id = e.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.id = ?
        `, [id]);
        
        if (pedidos.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        
        const pedido = pedidos[0];
        
        // Buscar itens do pedido
        const [itens] = await pool.query(`
            SELECT * FROM itens_pedido WHERE pedido_id = ?
        `, [id]);
        
        // Buscar dados do usuário que está gerando o PDF
        let usuarioGerador = 'Sistema';
        if (req.user && req.user.id) {
            const [usuarios] = await pool.query('SELECT nome FROM usuarios WHERE id = ?', [req.user.id]);
            if (usuarios.length > 0) {
                usuarioGerador = usuarios[0].nome;
            }
        }
        
        // Criar documento PDF
        const doc = new PDFDocument({ 
            size: 'A4', 
            margin: 40,
            info: {
                Title: `Orçamento Nº ${pedido.id}`,
                Author: 'ALUFORCE Sistema',
                Subject: 'Orçamento/Pedido',
                Creator: 'ALUFORCE V.2'
            }
        });
        
        // Configurar response para PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=orcamento_${pedido.id}.pdf`);
        
        doc.pipe(res);
        
        // Cores do tema ALUFORCE
        const corPrimaria = '#f97316'; // Laranja
        const corSecundaria = '#1e293b'; // Azul escuro
        const corTexto = '#333333';
        const corClara = '#f8fafc';
        
        // ========================================
        // CABEÇALHO
        // ========================================
        
        // Logo - Priorizar logo das configurações da empresa
        let logoCarregada = false;
        
        // 1. Tentar logo das configurações (uploads/empresa/...)
        if (empresaConfig.logo_url) {
            const logoConfigPath = path.join(__dirname, '..', '..', '..', 'public', empresaConfig.logo_url.replace(/^\//, ''));
            if (fs.existsSync(logoConfigPath)) {
                try {
                    doc.image(logoConfigPath, 40, 30, { width: 120 });
                    logoCarregada = true;
                    console.log('📄 [PDF] Usando logo das configurações:', logoConfigPath);
                } catch (e) {
                    console.log('Erro ao carregar logo das configurações:', e.message);
                }
            }
        }
        
        // 2. Fallback para logo padrão
        if (!logoCarregada) {
            const logoPath = path.join(__dirname, '..', '..', '..', 'public', 'images', 'Logo Monocromatico - Azul - Aluforce.png');
            if (fs.existsSync(logoPath)) {
                try {
                    doc.image(logoPath, 40, 30, { width: 120 });
                } catch (e) {
                    console.log('Erro ao carregar logo padrão:', e.message);
                }
            }
        }
        
        // Dados da empresa (lado direito) - Priorizar dados das configurações
        const empresaNome = empresaConfig.razao_social || pedido.empresa_razao_social || pedido.empresa_nome || 'ALUFORCE INDÚSTRIA';
        const empresaCnpj = empresaConfig.cnpj || pedido.empresa_cnpj || '00.000.000/0001-00';
        const empresaEndereco = empresaConfig.endereco ? `${empresaConfig.endereco}, ${empresaConfig.numero || ''}` : (pedido.empresa_endereco || '');
        const empresaCidade = empresaConfig.cidade || pedido.empresa_cidade || '';
        const empresaEstado = empresaConfig.estado || pedido.empresa_estado || '';
        const empresaTelefone = empresaConfig.telefone || pedido.empresa_telefone || '';
        const empresaEmail = empresaConfig.email || pedido.empresa_email || '';
        
        doc.fontSize(10)
           .fillColor(corSecundaria)
           .text(empresaNome, 350, 35, { align: 'right' })
           .fontSize(8)
           .fillColor('#666')
           .text(`CNPJ: ${empresaCnpj}`, 350, 50, { align: 'right' })
           .text(empresaEndereco, 350, 62, { align: 'right' })
           .text(`${empresaCidade} - ${empresaEstado}`, 350, 74, { align: 'right' })
           .text(`Tel: ${empresaTelefone} | ${empresaEmail}`, 350, 86, { align: 'right' });
        
        // Linha divisória
        doc.moveTo(40, 110).lineTo(555, 110).strokeColor(corPrimaria).lineWidth(2).stroke();
        
        // ========================================
        // TÍTULO DO DOCUMENTO
        // ========================================
        doc.fontSize(18)
           .fillColor(corPrimaria)
           .text(`ORÇAMENTO Nº ${String(pedido.id).padStart(6, '0')}`, 40, 125, { align: 'center' });
        
        doc.fontSize(9)
           .fillColor('#666')
           .text(`Data de Emissão: ${new Date(pedido.created_at).toLocaleDateString('pt-BR')}`, 40, 148, { align: 'center' });
        
        // ========================================
        // DADOS DO CLIENTE
        // ========================================
        let yPos = 175;
        
        // Caixa do cliente
        doc.rect(40, yPos, 515, 80).fillColor(corClara).fill();
        doc.rect(40, yPos, 515, 80).strokeColor('#e2e8f0').lineWidth(1).stroke();
        
        doc.fontSize(10)
           .fillColor(corPrimaria)
           .font('Helvetica-Bold')
           .text('DADOS DO CLIENTE', 50, yPos + 10);
        
        doc.font('Helvetica')
           .fontSize(9)
           .fillColor(corTexto);
        
        // Coluna esquerda
        doc.text(`Cliente: ${pedido.cliente_razao_social || pedido.cliente_nome || 'Não informado'}`, 50, yPos + 28);
        doc.text(`CNPJ/CPF: ${pedido.cliente_cnpj || 'Não informado'}`, 50, yPos + 42);
        doc.text(`I.E.: ${pedido.cliente_ie || 'Isento'}`, 50, yPos + 56);
        
        // Coluna direita
        doc.text(`Endereço: ${pedido.cliente_endereco || ''}, ${pedido.cliente_bairro || ''}`, 280, yPos + 28);
        doc.text(`Cidade: ${pedido.cliente_cidade || ''} - ${pedido.cliente_estado || ''}`, 280, yPos + 42);
        doc.text(`CEP: ${pedido.cliente_cep || ''} | Tel: ${pedido.cliente_telefone || ''}`, 280, yPos + 56);
        
        // ========================================
        // DADOS DO PEDIDO
        // ========================================
        yPos = 265;
        
        doc.rect(40, yPos, 255, 50).fillColor(corClara).fill();
        doc.rect(40, yPos, 255, 50).strokeColor('#e2e8f0').lineWidth(1).stroke();
        
        doc.rect(300, yPos, 255, 50).fillColor(corClara).fill();
        doc.rect(300, yPos, 255, 50).strokeColor('#e2e8f0').lineWidth(1).stroke();
        
        doc.fontSize(9)
           .fillColor(corPrimaria)
           .font('Helvetica-Bold')
           .text('VENDEDOR', 50, yPos + 8)
           .text('CONDIÇÃO DE PAGAMENTO', 310, yPos + 8);
        
        doc.font('Helvetica')
           .fillColor(corTexto)
           .text(pedido.vendedor_nome || 'Não informado', 50, yPos + 25)
           .text(pedido.vendedor_email || '', 50, yPos + 38);
        
        // Número de parcelas
        const parcelas = pedido.prioridade || 'A combinar';
        doc.text(parcelas, 310, yPos + 25);
        
        // ========================================
        // TABELA DE ITENS
        // ========================================
        yPos = 330;
        
        doc.fontSize(10)
           .fillColor(corPrimaria)
           .font('Helvetica-Bold')
           .text('ITENS DO ORÇAMENTO', 40, yPos);
        
        yPos += 20;
        
        // Cabeçalho da tabela
        doc.rect(40, yPos, 515, 22).fillColor(corSecundaria).fill();
        doc.fontSize(8)
           .fillColor('#fff')
           .font('Helvetica-Bold')
           .text('CÓDIGO', 45, yPos + 7)
           .text('DESCRIÇÃO', 105, yPos + 7)
           .text('QTD', 320, yPos + 7)
           .text('UN', 365, yPos + 7)
           .text('VLR. UNIT.', 400, yPos + 7)
           .text('VLR. TOTAL', 480, yPos + 7);
        
        yPos += 22;
        
        // Linhas da tabela
        let totalItens = 0;
        doc.font('Helvetica').fillColor(corTexto);
        
        if (itens.length > 0) {
            itens.forEach((item, idx) => {
                const bgColor = idx % 2 === 0 ? '#fff' : corClara;
                doc.rect(40, yPos, 515, 20).fillColor(bgColor).fill();
                doc.rect(40, yPos, 515, 20).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
                
                const valorUnit = parseFloat(item.preco_unitario) || 0;
                const quantidade = parseFloat(item.quantidade) || 0;
                const valorTotal = parseFloat(item.preco_total) || (valorUnit * quantidade);
                totalItens += valorTotal;
                
                doc.fontSize(8)
                   .fillColor(corTexto)
                   .text(item.codigo_produto || '-', 45, yPos + 6, { width: 55 })
                   .text((item.descricao || '').substring(0, 45), 105, yPos + 6, { width: 210 })
                   .text(quantidade.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 320, yPos + 6)
                   .text(item.unidade || 'UN', 365, yPos + 6)
                   .text(valorUnit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), 400, yPos + 6)
                   .text(valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), 480, yPos + 6);
                
                yPos += 20;
                
                // Nova página se necessário
                if (yPos > 700) {
                    doc.addPage();
                    yPos = 40;
                }
            });
        } else {
            // Sem itens
            doc.rect(40, yPos, 515, 30).fillColor('#fff').fill();
            doc.rect(40, yPos, 515, 30).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
            doc.fontSize(9)
               .fillColor('#888')
               .text('Nenhum item adicionado ao orçamento', 45, yPos + 10);
            yPos += 30;
        }
        
        // ========================================
        // TOTAIS
        // ========================================
        yPos += 10;
        
        const valorPedido = parseFloat(pedido.valor_total) || totalItens || 0;
        const frete = parseFloat(pedido.frete) || 0;
        const desconto = parseFloat(pedido.desconto) || 0;
        const totalFinal = valorPedido + frete - desconto;
        
        // Caixa de totais
        doc.rect(350, yPos, 205, 70).fillColor(corClara).fill();
        doc.rect(350, yPos, 205, 70).strokeColor('#e2e8f0').lineWidth(1).stroke();
        
        doc.fontSize(9)
           .fillColor(corTexto)
           .text('Subtotal:', 360, yPos + 10)
           .text(valorPedido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), 480, yPos + 10, { align: 'right', width: 70 });
        
        doc.text('Frete:', 360, yPos + 25)
           .text(frete.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), 480, yPos + 25, { align: 'right', width: 70 });
        
        if (desconto > 0) {
            doc.text('Desconto:', 360, yPos + 40)
               .text(`- ${desconto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 480, yPos + 40, { align: 'right', width: 70 });
        }
        
        doc.moveTo(360, yPos + 52).lineTo(545, yPos + 52).strokeColor('#ccc').lineWidth(0.5).stroke();
        
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .fillColor(corPrimaria)
           .text('TOTAL:', 360, yPos + 55)
           .text(totalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), 480, yPos + 55, { align: 'right', width: 70 });
        
        // ========================================
        // OBSERVAÇÕES
        // ========================================
        yPos += 90;
        
        if (yPos > 650) {
            doc.addPage();
            yPos = 40;
        }
        
        if (pedido.observacoes || pedido.observacoes_internas) {
            doc.fontSize(10)
               .fillColor(corPrimaria)
               .font('Helvetica-Bold')
               .text('OBSERVAÇÕES', 40, yPos);
            
            yPos += 15;
            
            doc.rect(40, yPos, 515, 60).fillColor('#fff').fill();
            doc.rect(40, yPos, 515, 60).strokeColor('#e2e8f0').lineWidth(1).stroke();
            
            doc.fontSize(9)
               .font('Helvetica')
               .fillColor(corTexto)
               .text(pedido.observacoes || pedido.observacoes_internas || '', 50, yPos + 10, { 
                   width: 495, 
                   height: 50,
                   ellipsis: true 
               });
            
            yPos += 70;
        }
        
        // ========================================
        // RODAPÉ
        // ========================================
        
        // Linha final
        doc.moveTo(40, 750).lineTo(555, 750).strokeColor('#e2e8f0').lineWidth(1).stroke();
        
        doc.fontSize(8)
           .fillColor('#888')
           .font('Helvetica')
           .text(`Documento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')} por ${usuarioGerador}`, 40, 758, { align: 'center' })
           .text('Este orçamento tem validade de 7 dias a partir da data de emissão.', 40, 770, { align: 'center' })
           .text('ALUFORCE Sistema de Gestão Empresarial v2.1', 40, 782, { align: 'center' });
        
        // Finalizar documento
        doc.end();
        
    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao gerar PDF',
            error: error.message 
        });
    }
});

module.exports = router;
