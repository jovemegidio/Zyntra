/**
 * MIDDLEWARE DE SEGURANÇA - ALUFORCE v2.1
 * Implementa proteções contra ataques comuns
 * Atualizado: 26/01/2026 - Rate limiting global melhorado
 * Atualizado: 15/02/2026 - Redis store para cluster mode
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const { createRedisStore } = require('./services/rate-limiter-redis');

// Detectar ambiente
const isDev = process.env.NODE_ENV !== 'production';

// ============================================
// RATE LIMITING GLOBAL (APLICADO EM TODAS ROTAS)
// Redis store em produção (cluster-safe), MemoryStore em dev
// ============================================

/**
 * Rate limiter geral para todas as rotas
 * Protege contra DDoS e uso abusivo
 */
const generalStore = createRedisStore('general');
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: isDev ? 5000 : 3000, // 3000 req/15min em produção (páginas SPA fazem múltiplas chamadas API), 5000 em dev
    ...(generalStore ? { store: generalStore } : {}),
    // AUDIT-FIX S4.3: Se Redis cair em runtime, permite requests (fallback graceful)
    passOnStoreError: true,
    message: {
        error: 'Muitas requisições deste IP. Aguarde alguns minutos.',
        retryAfter: '15 minutos',
        code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false }, // Desabilita validação - usamos trust proxy
    // AUDIT-FIX SEC-003: Always enforce rate limiting, even in dev (just with higher threshold)
    handler: (req, res, next, options) => {
        console.log(`[RATE-LIMIT] ⚠️ Limite atingido: ${req.ip} - ${req.path}`);
        res.status(options.statusCode).json(options.message);
    },
    keyGenerator: (req) => {
        // SECURITY: Use req.ip which respects trust proxy setting
        return req.ip;
    }
});

/**
 * Rate limiter rigoroso para autenticação (login/registro/reset)
 */
const authStore = createRedisStore('auth');
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: isDev ? 500 : 100, // TC-AUTH-01-003: 100 tentativas em produção por IP / 15 min
    ...(authStore ? { store: authStore } : {}),
    // AUDIT-FIX S4.3: Auth bloqueia por segurança se store falhar (deny-by-default)
    passOnStoreError: false,
    message: {
        error: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
        retryAfter: '15 minutos',
        code: 'AUTH_RATE_LIMIT'
    },
    skipSuccessfulRequests: false, // AUDIT-FIX: Conta TODAS as tentativas para prevenir credential stuffing
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false }, // Desabilita validação - usamos trust proxy
    keyGenerator: (req) => {
        return req.ip;
    },
    handler: (req, res, next, options) => {
        console.warn(`[AUTH-RATE-LIMIT] ⚠️ Brute-force bloqueado: ${req.ip} - ${req.path}`);
        res.status(options.statusCode).json(options.message);
    }
});

/**
 * Rate limiter para APIs de escrita (POST/PUT/DELETE)
 * Previne spam e abuso
 */
const writeStore = createRedisStore('write');
const writeLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: isDev ? 500 : 100, // 100 escritas/minuto em produção
    ...(writeStore ? { store: writeStore } : {}),
    passOnStoreError: true,
    message: {
        error: 'Limite de operações de escrita excedido. Aguarde 1 minuto.',
        retryAfter: '1 minuto',
        code: 'WRITE_RATE_LIMIT'
    },
    skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
    validate: { xForwardedForHeader: false } // Desabilita validação - usamos trust proxy
});

/**
 * Rate limiter para APIs pesadas (relatórios, exports, dashboards)
 */
const heavyStore = createRedisStore('heavy');
const heavyApiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: isDev ? 200 : 50, // 50 requests/minuto em produção
    ...(heavyStore ? { store: heavyStore } : {}),
    passOnStoreError: true,
    message: {
        error: 'Limite de relatórios/exports excedido. Aguarde 1 minuto.',
        retryAfter: '1 minuto',
        code: 'HEAVY_API_LIMIT'
    },
    validate: { xForwardedForHeader: false } // Desabilita validação - usamos trust proxy
});

/**
 * Rate limiter para upload de arquivos
 */
const uploadStore = createRedisStore('upload');
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: isDev ? 500 : 50, // 50 uploads/hora em produção
    ...(uploadStore ? { store: uploadStore } : {}),
    passOnStoreError: true,
    message: {
        error: 'Limite de uploads excedido. Tente novamente mais tarde.',
        retryAfter: '1 hora',
        code: 'UPLOAD_RATE_LIMIT'
    },
    validate: { xForwardedForHeader: false } // Desabilita validação - usamos trust proxy
});

// Alias para compatibilidade
const apiLimiter = writeLimiter;

// ============================================
// SANITIZAÇÍO DE ENTRADA
// ============================================

/**
 * Remove tags HTML perigosas e scripts
 * @param {string} input - Texto a ser sanitizado
 * @returns {string} Texto limpo
 */
function sanitizeHTML(input) {
    if (typeof input !== 'string') return input;

    // Remove tags script, style, iframe, object, embed
    let cleaned = input
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
        .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');

    // Remove atributos perigosos
    cleaned = cleaned
        .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '') // Remove onclick, onerror, etc
        .replace(/javascript:/gi, ''); // Remove javascript: protocol

    return cleaned;
}

/**
 * Sanitiza recursivamente um objeto
 */
function sanitizeObject(obj) {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
        return sanitizeHTML(obj);
    }

    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
    }

    if (typeof obj === 'object') {
        const sanitized = {};
        for (const key in obj) {
            sanitized[key] = sanitizeObject(obj[key]);
        }
        return sanitized;
    }

    return obj;
}

/**
 * Middleware para sanitizar body de requisições
 */
function sanitizeInput(req, res, next) {
    if (req.body) {
        req.body = sanitizeObject(req.body);
    }
    if (req.query) {
        req.query = sanitizeObject(req.query);
    }
    if (req.params) {
        req.params = sanitizeObject(req.params);
    }
    next();
}

// ============================================
// VALIDAÇÍO DE ENTRADA
// ============================================

/**
 * Valida campos obrigatórios
 */
function validateRequired(fields) {
    return (req, res, next) => {
        const missing = [];
        for (const field of fields) {
            if (!req.body[field] && req.body[field] !== 0) {
                missing.push(field);
            }
        }

        if (missing.length > 0) {
            return res.status(400).json({
                error: 'Campos obrigatórios ausentes',
                missing: missing
            });
        }
        next();
    };
}

/**
 * Valida email
 */
function validateEmail(field = 'email') {
    return (req, res, next) => {
        const email = req.body[field];
        if (email && !validator.isEmail(email)) {
            return res.status(400).json({
                error: `${field} inválido`,
                field: field
            });
        }
        next();
    };
}

/**
 * Valida CPF/CNPJ
 */
function validateCpfCnpj(field = 'cpf_cnpj') {
    return (req, res, next) => {
        const value = req.body[field];
        if (value) {
            const numbers = value.replace(/\D/g, '');
            if (numbers.length !== 11 && numbers.length !== 14) {
                return res.status(400).json({
                    error: `${field} inválido - deve conter 11 (CPF) ou 14 (CNPJ) dígitos`,
                    field: field
                });
            }
        }
        next();
    };
}

/**
 * Valida SQL - previne SQL injection
 */
function validateSqlColumn(column) {
    // Lista branca de colunas permitidas
    const allowedColumns = [
        'id', 'nome', 'email', 'created_at', 'updated_at',
        'status', 'valor', 'quantidade', 'data', 'descricao',
        'codigo', 'cliente_id', 'pedido_id', 'usuario_id'
    ];

    return allowedColumns.includes(column);
}

// ============================================
// HEADERS DE SEGURANÇA
// ============================================

/**
 * Configura helmet com headers de segurança
 */
function securityHeaders() {
    const isDevelopment = process.env.NODE_ENV !== 'production';

    return helmet({
        // AUDIT 2026-06-22: CSP em modo report-only ao ativar produção (aluforce).
        // Evita quebrar o frontend (recursos fora da allowlist) enquanto coletamos
        // violacoes no console; endurecer (remover reportOnly) apos revisar os reports.
        contentSecurityPolicy: isDevelopment ? false : {
            reportOnly: true,
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
                // AUDIT-FIX SEC-004: Removed 'unsafe-eval' to prevent eval-based XSS attacks
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
                // Permitir inline event handlers (onclick, onchange, etc)
                scriptSrcAttr: ["'unsafe-inline'"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
                imgSrc: ["'self'", "data:", "https:", "blob:"],
                connectSrc: ["'self'", "data:", "ws:", "wss:", "https://cdn.jsdelivr.net", "https:"],
                frameSrc: ["'self'", "blob:"],
                // AUDIT-FIX ARCH-001: Additional CSP hardening directives
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                frameAncestors: ["'self'"],
                // FIX 25/06/2026: 'upgrade-insecure-requests' eh ignorado em policy report-only e
                // o browser loga warning no console. Como esta CSP esta em reportOnly, omitimos a
                // diretiva (null faz o helmet nao emiti-la). Reintroduzir ao endurecer (reportOnly:false).
                upgradeInsecureRequests: null,
            },
        },
        // Desabilitar todos os headers HTTPS em desenvolvimento
        hsts: isDevelopment ? false : { maxAge: 31536000 },
        crossOriginEmbedderPolicy: false,
        crossOriginOpenerPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" }
    });
}

// ============================================
// PROTEÇÃO CSRF
// ============================================

/**
 * Gera token CSRF único por sessão
 * Usa double-submit cookie pattern (não requer sessão server-side)
 */
const crypto = require('crypto');

function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware CSRF: Double-Submit Cookie Pattern
 * - GET requests: gera token e seta cookie + retorna no header
 * - POST/PUT/DELETE: valida que header X-CSRF-Token === cookie csrf_token
 * - Ignora rotas de API pura (mobile/external) e login
 */
function csrfProtection(req, res, next) {
    // Rotas isentas de CSRF (APIs que usam Bearer token já são protegidas)
    const exemptPaths = ['/api/login', '/api/logout', '/api/refresh-token', '/api/health', '/api/webhook', '/api/auth', '/api/discord', '/api/verify-2fa', '/api/resend-2fa'];
    if (exemptPaths.some(p => req.path.startsWith(p))) {
        return next();
    }

    // Se é requisição de leitura, gerar/renovar token
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (!req.cookies?.csrf_token) {
            const token = generateCsrfToken();
            res.cookie('csrf_token', token, {
                httpOnly: false, // JS precisa ler para enviar no header
                sameSite: 'Strict',
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000 // 24h
            });
            res.setHeader('X-CSRF-Token', token);
        }
        return next();
    }

    // Para escrita: verificar token (apenas se veio de browser com cookie)
    // APIs com Bearer token (mobile/external) não enviam cookies, então passam
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return next(); // API token-based — CSRF não se aplica
    }

    // Browser com cookie httpOnly: exigir mesma origem quando Origin/Referer vierem presentes.
    // Mantém compatibilidade com fetch JSON existente, mas bloqueia CSRF cross-site.
    if (req.cookies?.authToken) {
        const origin = req.headers.origin;
        const referer = req.headers.referer;
        const host = req.headers.host;
        const isSameHost = (value) => {
            if (!value || !host) return true;
            try {
                return new URL(value).host === host;
            } catch {
                return false;
            }
        };
        if (!isSameHost(origin) || !isSameHost(referer)) {
            console.warn(`[CSRF] ⚠️ Origem bloqueada: ${req.ip} - ${req.method} ${req.path}`);
            return res.status(403).json({
                error: 'Origem da requisição não permitida',
                code: 'CSRF_ORIGIN_INVALID'
            });
        }
    }

    // FIX 24/03/2026: Para requests autenticados via httpOnly cookie (SameSite=Strict),
    // verificar que a requisição tem um header customizado que browsers automaticamente
    // não enviam em cross-origin requests (double-submit com header customizado).
    // Isso é mais seguro que bypass total, pois custom headers requerem JS do mesmo origin.
    if (req.cookies?.authToken) {
        // Requests com cookie httpOnly + qualquer header customizado (Accept, X-Requested-With,
        // Content-Type: application/json) já são protegidos contra CSRF simples,
        // pois cross-origin requests com custom headers disparam preflight CORS.
        const contentType = req.headers['content-type'] || '';
        const hasCustomHeader = req.headers['x-requested-with'] ||
            contentType.includes('application/json') ||
            req.headers['accept']?.includes('application/json');
        if (hasCustomHeader) {
            return next();
        }
        // Form submissions sem custom headers — exigir CSRF token
    }

    const cookieToken = req.cookies?.csrf_token;
    const headerToken = req.headers['x-csrf-token'];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        console.warn(`[CSRF] ⚠️ Token inválido: ${req.ip} - ${req.method} ${req.path}`);
        return res.status(403).json({
            error: 'Token CSRF inválido ou ausente',
            code: 'CSRF_INVALID'
        });
    }

    next();
}

// ============================================
// LIMPEZA DE SESSÕES
// ============================================

/**
 * Remove sessões expiradas (chamar periodicamente)
 */
function cleanExpiredSessions(sessions, maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [sid, data] of sessions.entries()) {
        if (now - data.created > maxAge) {
            sessions.delete(sid);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`🧹 [SECURITY] ${cleaned} sessões expiradas removidas`);
    }

    return cleaned;
}

// ============================================
// EXPORTAÇÕES
// ============================================

module.exports = {
    // Rate limiting
    generalLimiter,
    authLimiter,
    apiLimiter,
    writeLimiter,
    heavyApiLimiter,
    uploadLimiter,

    // Sanitização
    sanitizeHTML,
    sanitizeObject,
    sanitizeInput,

    // Validação
    validateRequired,
    validateEmail,
    validateCpfCnpj,
    validateSqlColumn,

    // Headers
    securityHeaders,

    // CSRF
    csrfProtection,
    generateCsrfToken,

    // Sessões
    cleanExpiredSessions
};
