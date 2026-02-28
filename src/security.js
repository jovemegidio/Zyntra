// config/security.js
// Configurações de segurança centralizadas

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Configuração do Helmet para proteção de headers
const helmetConfig = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            // AUDIT-FIX SEC-004: Removed 'unsafe-eval'. Kept 'unsafe-inline' for onclick handlers.
            // TODO: Migrate inline handlers to addEventListener() then remove 'unsafe-inline'
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            scriptSrcAttr: ["'unsafe-inline'"], // Required until onclick handlers are migrated
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            // AUDIT-FIX ARCH-001: Additional CSP hardening directives
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
        }
    },
    hsts: process.env.NODE_ENV === 'production' ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    } : false,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

// Rate limiters personalizados
const createRateLimiter = (windowMs, max, message) => {
    return rateLimit({
        windowMs,
        max,
        message: { error: message },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => {
            // Pular rate limit para testes locais se configurado
            return process.env.DISABLE_RATE_LIMIT === 'true';
        }
    });
};

const rateLimiters = {
    // Login: 5 tentativas por 15 minutos
    login: createRateLimiter(
        15 * 60 * 1000,
        5,
        'Muitas tentativas de login. Tente novamente em 15 minutos.'
    ),
    
    // API geral: 100 requisições por 15 minutos
    api: createRateLimiter(
        15 * 60 * 1000,
        100,
        'Limite de requisições excedido. Tente novamente em 15 minutos.'
    ),
    
    // Upload: 10 uploads por hora
    upload: createRateLimiter(
        60 * 60 * 1000,
        10,
        'Limite de uploads excedido. Tente novamente em 1 hora.'
    ),
    
    // Strict para endpoints sensíveis: 3 por hora
    strict: createRateLimiter(
        60 * 60 * 1000,
        3,
        'Limite excedido para operação sensível. Tente novamente em 1 hora.'
    )
};

// CORS configuration
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = process.env.ALLOWED_ORIGINS 
            ? process.env.ALLOWED_ORIGINS.split(',')
            : ['http://localhost:3000', 'http://127.0.0.1:3000'];
        
        // Permitir requisições sem origin (apps mobile, Postman, etc)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Validação de JWT Secret
const validateJWTSecret = () => {
    const secret = process.env.JWT_SECRET;
    
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('JWT_SECRET não definido em produção!');
        }
        console.warn('⚠️ JWT_SECRET não definido. Usando valor padrão (apenas desenvolvimento)');
        return false;
    }
    
    if (secret.length < 32) {
        console.warn('⚠️ JWT_SECRET muito curto. Recomendado: pelo menos 32 caracteres');
        return false;
    }
    
    return true;
};

// Lista de IPs bloqueados (pode ser movida para Redis em produção)
const blockedIPs = new Set();

const blockIP = (ip) => {
    blockedIPs.add(ip);
    console.warn(`🚫 IP bloqueado: ${ip}`);
};

const isIPBlocked = (ip) => {
    return blockedIPs.has(ip);
};

const ipBlockMiddleware = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    
    if (isIPBlocked(ip)) {
        return res.status(403).json({ 
            error: 'Acesso negado. IP bloqueado.' 
        });
    }
    
    next();
};

module.exports = {
    helmetConfig,
    rateLimiters,
    corsOptions,
    validateJWTSecret,
    blockIP,
    isIPBlocked,
    ipBlockMiddleware
};
