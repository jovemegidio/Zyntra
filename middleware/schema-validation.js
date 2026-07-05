/**
 * Schema Validation Middleware — ALUFORCE ERP
 * 
 * Utiliza Joi para validar body, params e query de requests HTTP.
 * Schemas predefinidos para endpoints críticos (financeiro, vendas, auth).
 */

const Joi = require('joi');

/**
 * Cria middleware de validação para body, params e/ou query
 * @param {{ body?: Joi.Schema, params?: Joi.Schema, query?: Joi.Schema }} schemas
 * @returns {Function} Express middleware
 */
function validate(schemas) {
    return (req, res, next) => {
        const errors = [];

        if (schemas.body) {
            const { error } = schemas.body.validate(req.body, { abortEarly: false, stripUnknown: false });
            if (error) errors.push(...error.details.map(d => ({ field: d.path.join('.'), message: d.message, location: 'body' })));
        }

        if (schemas.params) {
            const { error } = schemas.params.validate(req.params, { abortEarly: false });
            if (error) errors.push(...error.details.map(d => ({ field: d.path.join('.'), message: d.message, location: 'params' })));
        }

        if (schemas.query) {
            const { error } = schemas.query.validate(req.query, { abortEarly: false, allowUnknown: true });
            if (error) errors.push(...error.details.map(d => ({ field: d.path.join('.'), message: d.message, location: 'query' })));
        }

        if (errors.length > 0) {
            return res.status(400).json({
                message: 'Dados de entrada inválidos',
                code: 'VALIDATION_ERROR',
                errors
            });
        }

        next();
    };
}

// ======================================
// SCHEMAS PREDEFINIDOS — Endpoints Críticos
// ======================================

// --- Auth ---
const loginSchema = {
    body: Joi.object({
        email: Joi.string().allow('', null).optional(),
        cpf: Joi.string().trim().allow('', null).optional().custom((value, helpers) => {
            if (value === '' || value === null || value === undefined) return value;
            const digits = String(value).replace(/\D/g, '');
            if (digits.length !== 11) {
                return helpers.error('cpf.invalid');
            }
            return value;
        }).messages({ 'cpf.invalid': 'CPF deve conter 11 dígitos numéricos' }),
        password: Joi.string().min(6).max(128).required().messages({ 'string.min': 'Senha deve ter pelo menos 6 caracteres', 'any.required': 'Senha é obrigatória' }),
        remember: Joi.boolean().optional(),
        trustedDeviceToken: Joi.string().allow(null, '').optional()
    }).or('email', 'cpf').messages({ 'object.missing': 'Email ou CPF é obrigatório' })
};

const changePasswordSchema = {
    body: Joi.object({
        currentPassword: Joi.string().required(),
        newPassword: Joi.string().min(8).max(128).required()
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
            .messages({ 'string.pattern.base': 'Senha deve conter maiúscula, minúscula e número' }),
        confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
            .messages({ 'any.only': 'Confirmação de senha não confere' })
    })
};

// --- Financeiro ---
const lancamentoFinanceiroSchema = {
    body: Joi.object({
        tipo: Joi.string().valid('receita', 'despesa').required(),
        descricao: Joi.string().max(500).required(),
        valor: Joi.number().precision(2).positive().required().messages({ 'number.positive': 'Valor deve ser positivo' }),
        data_vencimento: Joi.date().iso().required(),
        data_pagamento: Joi.date().iso().optional().allow(null),
        categoria_id: Joi.number().integer().positive().optional().allow(null),
        conta_id: Joi.number().integer().positive().optional().allow(null),
        centro_custo_id: Joi.number().integer().positive().optional().allow(null),
        status: Joi.string().valid('pendente', 'pago', 'vencido', 'cancelado').optional(),
        observacoes: Joi.string().max(1000).optional().allow('', null),
        parcelas: Joi.number().integer().min(1).max(120).optional(),
        fornecedor_id: Joi.number().integer().positive().optional().allow(null),
        cliente_id: Joi.number().integer().positive().optional().allow(null),
        nf_numero: Joi.string().max(50).optional().allow('', null)
    })
};

// --- Vendas / Pedidos ---
const pedidoVendaSchema = {
    body: Joi.object({
        cliente_id: Joi.number().integer().positive().required(),
        vendedor_id: Joi.number().integer().positive().optional(),
        condicao_pagamento_id: Joi.number().integer().positive().optional().allow(null),
        transportadora_id: Joi.number().integer().positive().optional().allow(null),
        observacoes: Joi.string().max(2000).optional().allow('', null),
        desconto_percentual: Joi.number().min(0).max(100).optional(),
        desconto_valor: Joi.number().min(0).optional(),
        itens: Joi.array().items(Joi.object({
            produto_id: Joi.number().integer().positive().required(),
            quantidade: Joi.number().positive().required(),
            preco_unitario: Joi.number().precision(2).positive().required(),
            desconto: Joi.number().min(0).max(100).optional()
        })).min(1).required()
    })
};

// --- Clientes ---
const clienteSchema = {
    body: Joi.object({
        nome: Joi.string().max(200).required(),
        razao_social: Joi.string().max(200).optional().allow('', null),
        cpf_cnpj: Joi.string().max(18).optional().allow('', null),
        email: Joi.string().email().optional().allow('', null),
        telefone: Joi.string().max(20).optional().allow('', null),
        celular: Joi.string().max(20).optional().allow('', null),
        cep: Joi.string().max(10).optional().allow('', null),
        endereco: Joi.string().max(300).optional().allow('', null),
        numero: Joi.string().max(20).optional().allow('', null),
        complemento: Joi.string().max(100).optional().allow('', null),
        bairro: Joi.string().max(100).optional().allow('', null),
        cidade: Joi.string().max(100).optional().allow('', null),
        estado: Joi.string().max(2).optional().allow('', null),
        ativo: Joi.boolean().optional()
    })
};

// --- ID de recurso (params) ---
const idParamSchema = {
    params: Joi.object({
        id: Joi.number().integer().positive().required().messages({ 'number.base': 'ID deve ser um número' })
    })
};

// --- Paginação (query) ---
const paginationSchema = {
    query: Joi.object({
        page: Joi.number().integer().min(1).optional(),
        limit: Joi.number().integer().min(1).max(500).optional(),
        sort: Joi.string().max(50).optional(),
        order: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').optional(),
        search: Joi.string().max(200).optional().allow('')
    })
};

// --- Funcionários (RH) ---
const funcionarioSchema = {
    body: Joi.object({
        nome: Joi.string().max(200).required(),
        cpf: Joi.string().max(14).optional().allow('', null),
        email: Joi.string().email().optional().allow('', null),
        cargo: Joi.string().max(100).optional().allow('', null),
        departamento: Joi.string().max(100).optional().allow('', null),
        salario: Joi.number().precision(2).min(0).optional().allow(null),
        data_admissao: Joi.date().iso().optional().allow(null),
        data_demissao: Joi.date().iso().optional().allow(null),
        ativo: Joi.boolean().optional()
    }).unknown(true) // Allow extra fields from RH module
};

module.exports = {
    validate,
    schemas: {
        login: loginSchema,
        changePassword: changePasswordSchema,
        lancamentoFinanceiro: lancamentoFinanceiroSchema,
        pedidoVenda: pedidoVendaSchema,
        cliente: clienteSchema,
        idParam: idParamSchema,
        pagination: paginationSchema,
        funcionario: funcionarioSchema
    }
};
