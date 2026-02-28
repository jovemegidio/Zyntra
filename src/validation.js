// middleware/validation.js - Sistema de Validação Robusto
const Joi = require('joi');
const { ValidationError } = require('./errorHandler');

// Schema de validação para login
const loginSchema = Joi.object({
  email: Joi.string()
    .email({ tlds: { allow: false } })
    .pattern(/^[a-zA-Z0-9._%+-]+@(aluforce\.ind\.br|aluforce\.com|lumiereasses?oria\.com\.br)$/)
    .required()
    .messages({
      'string.email': 'Email deve ter um formato válido',
      'string.pattern.base': 'Apenas emails @aluforce.ind.br, @aluforce.com e @lumiereassessoria.com.br são permitidos',
      'any.required': 'Email é obrigatório'
    }),
  password: Joi.string()
    .min(6)
    .max(100)
    .required()
    .messages({
      'string.min': 'Senha deve ter pelo menos 6 caracteres',
      'string.max': 'Senha não pode ter mais de 100 caracteres',
      'any.required': 'Senha é obrigatória'
    })
});

// Schema para cadastro de usuário
const userCreateSchema = Joi.object({
  nome: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-ZÀ-ÿ\s]+$/)
    .required()
    .messages({
      'string.min': 'Nome deve ter pelo menos 2 caracteres',
      'string.max': 'Nome não pode ter mais de 100 caracteres',
      'string.pattern.base': 'Nome deve conter apenas letras e espaços',
      'any.required': 'Nome é obrigatório'
    }),
  email: Joi.string()
    .email()
    .pattern(/^[a-zA-Z0-9._%+-]+@(aluforce\.ind\.br|aluforce\.com|lumiereasses?oria\.com\.br)$/)
    .required(),
  senha: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      'string.min': 'Senha deve ter pelo menos 8 caracteres',
      'string.pattern.base': 'Senha deve conter ao menos: 1 letra minúscula, 1 maiúscula, 1 número e 1 caractere especial',
      'any.required': 'Senha é obrigatória'
    }),
  role: Joi.string()
    .valid('admin', 'user', 'comercial', 'financeiro', 'pcp', 'rh')
    .default('user'),
  setor: Joi.string()
    .valid('comercial', 'financeiro', 'pcp', 'rh', 'ti', 'diretoria')
    .optional()
});

// Schema para atualização de perfil
const profileUpdateSchema = Joi.object({
  nome: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-ZÀ-ÿ\s]+$/)
    .optional(),
  apelido: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-ZÀ-ÿ\s]+$/)
    .optional()
    .messages({
      'string.min': 'Apelido deve ter pelo menos 2 caracteres',
      'string.max': 'Apelido não pode ter mais de 50 caracteres',
      'string.pattern.base': 'Apelido deve conter apenas letras e espaços'
    })
});

// Schema para pedidos
const pedidoSchema = Joi.object({
  empresa_id: Joi.number()
    .integer()
    .positive()
    .required()
    .messages({
      'number.base': 'ID da empresa deve ser um número',
      'number.integer': 'ID da empresa deve ser um número inteiro',
      'number.positive': 'ID da empresa deve ser positivo',
      'any.required': 'ID da empresa é obrigatório'
    }),
  valor: Joi.number()
    .positive()
    .precision(2)
    .required()
    .messages({
      'number.base': 'Valor deve ser um número',
      'number.positive': 'Valor deve ser positivo',
      'any.required': 'Valor é obrigatório'
    }),
  descricao: Joi.string()
    .max(500)
    .optional()
    .messages({
      'string.max': 'Descrição não pode ter mais de 500 caracteres'
    }),
  status: Joi.string()
    .valid('orcamento', 'analise', 'aprovado', 'faturado', 'entregue', 'cancelado')
    .default('orcamento')
});

// Schema para empresas
const empresaSchema = Joi.object({
  cnpj: Joi.string()
    .pattern(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/)
    .required()
    .messages({
      'string.pattern.base': 'CNPJ deve estar no formato XX.XXX.XXX/XXXX-XX',
      'any.required': 'CNPJ é obrigatório'
    }),
  nome_fantasia: Joi.string()
    .min(2)
    .max(100)
    .required()
    .messages({
      'string.min': 'Nome fantasia deve ter pelo menos 2 caracteres',
      'string.max': 'Nome fantasia não pode ter mais de 100 caracteres',
      'any.required': 'Nome fantasia é obrigatório'
    }),
  razao_social: Joi.string()
    .max(100)
    .optional(),
  email: Joi.string()
    .email()
    .optional(),
  telefone: Joi.string()
    .pattern(/^\(\d{2}\)\s\d{4,5}-\d{4}$/)
    .optional()
    .messages({
      'string.pattern.base': 'Telefone deve estar no formato (XX) XXXXX-XXXX'
    }),
  cep: Joi.string()
    .pattern(/^\d{5}-\d{3}$/)
    .optional()
    .messages({
      'string.pattern.base': 'CEP deve estar no formato XXXXX-XXX'
    }),
  logradouro: Joi.string().max(200).optional(),
  numero: Joi.string().max(20).optional(),
  bairro: Joi.string().max(100).optional(),
  municipio: Joi.string().max(100).optional(),
  uf: Joi.string().length(2).uppercase().optional()
});

// Middleware de validação genérico
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      throw new ValidationError('Dados inválidos', details);
    }

    req[source] = value;
    next();
  };
};

// Middleware de sanitização
const sanitize = (req, res, next) => {
  // Remove scripts e tags HTML potencialmente perigosas
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<[^>]*>/g, '')
      .trim();
  };

  const sanitizeObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeString(obj[key]);
      } else if (typeof obj[key] === 'object') {
        obj[key] = sanitizeObject(obj[key]);
      }
    }
    return obj;
  };

  req.body = sanitizeObject(req.body);
  req.query = sanitizeObject(req.query);
  req.params = sanitizeObject(req.params);
  
  next();
};

// Rate limiting personalizado por endpoint
const createRateLimit = (windowMs = 15 * 60 * 1000, max = 100, message = 'Too many requests') => {
  const expressRateLimit = require('express-rate-limit');
  
  return expressRateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: {
          message,
          retryAfter: Math.round(windowMs / 1000)
        }
      });
    }
  });
};

module.exports = {
  validate,
  sanitize,
  createRateLimit,
  schemas: {
    login: loginSchema,
    userCreate: userCreateSchema,
    profileUpdate: profileUpdateSchema,
    pedido: pedidoSchema,
    empresa: empresaSchema
  }
};