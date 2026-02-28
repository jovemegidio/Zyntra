/**
 * Middleware de Proteção CSRF - ALUFORCE ERP
 * 
 * Implementa proteção contra Cross-Site Request Forgery usando:
 * - Double Submit Cookie pattern
 * - Token sincronizado com sessão
 * 
 * Criado durante auditoria de segurança - 30/01/2026
 */

const crypto = require('crypto');

// Armazenamento de tokens (em produção, usar Redis)
const tokenStore = new Map();

// Configurações
const CSRF_CONFIG = {
    tokenLength: 32,
    tokenExpiry: 3600000, // 1 hora
    cookieName: '_csrf',
    headerName: 'x-csrf-token',
    ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
    ignorePaths: [
        '/api/login',
        '/api/auth/login',
        '/api/auth/refresh',
        '/api/webhook',
        '/api/health',
        '/api/status'
    ]
};

/**
 * Gera um token CSRF seguro
 * @returns {string}
 */
function generateToken() {
    return crypto.randomBytes(CSRF_CONFIG.tokenLength).toString('hex');
}

/**
 * Limpa tokens expirados periodicamente
 */
function cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, data] of tokenStore.entries()) {
        if (data.expires < now) {
            tokenStore.delete(token);
        }
    }
}

// Executar limpeza a cada 10 minutos
setInterval(cleanupExpiredTokens, 600000);

/**
 * Middleware para gerar e validar tokens CSRF
 * 
 * Uso:
 * 1. GET /api/csrf-token - Retorna novo token
 * 2. Todas as requisições POST/PUT/DELETE devem incluir o token no header x-csrf-token
 * 
 * @param {Object} options - Opções de configuração
 * @returns {Function} Middleware Express
 */
function csrfProtection(options = {}) {
    const config = { ...CSRF_CONFIG, ...options };
    
    return (req, res, next) => {
        // Adicionar função para gerar token à requisição
        req.csrfToken = () => {
            const token = generateToken();
            const userId = req.user?.id || 'anonymous';
            
            tokenStore.set(token, {
                userId,
                expires: Date.now() + config.tokenExpiry
            });
            
            // Também setar como cookie httpOnly
            res.cookie(config.cookieName, token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: config.tokenExpiry
            });
            
            return token;
        };
        
        // Ignorar métodos seguros
        if (config.ignoreMethods.includes(req.method)) {
            return next();
        }
        
        // Ignorar paths específicos
        const path = req.path || req.url;
        if (config.ignorePaths.some(p => path.startsWith(p))) {
            return next();
        }
        
        // Bypass para requisições com Bearer token (API token-based — CSRF não se aplica)
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ') && authHeader.length > 7) {
            return next();
        }
        
        // Verificar token
        const tokenFromHeader = req.headers[config.headerName];
        const tokenFromCookie = req.cookies?.[config.cookieName];
        const tokenFromBody = req.body?._csrf;
        
        const token = tokenFromHeader || tokenFromBody;
        
        if (!token) {
            console.warn('[CSRF] Token não fornecido:', req.method, path);
            return res.status(403).json({ 
                error: 'CSRF token missing',
                message: 'Token CSRF não fornecido. Inclua o header x-csrf-token.'
            });
        }
        
        // Validar token
        const storedData = tokenStore.get(token);
        
        if (!storedData) {
            console.warn('[CSRF] Token inválido ou expirado:', req.method, path);
            return res.status(403).json({ 
                error: 'CSRF token invalid',
                message: 'Token CSRF inválido ou expirado. Obtenha um novo token.'
            });
        }
        
        // Verificar expiração
        if (storedData.expires < Date.now()) {
            tokenStore.delete(token);
            return res.status(403).json({ 
                error: 'CSRF token expired',
                message: 'Token CSRF expirado. Obtenha um novo token.'
            });
        }
        
        // Double Submit: verificar se cookie corresponde
        if (tokenFromCookie && tokenFromCookie !== token) {
            console.warn('[CSRF] Token mismatch:', req.method, path);
            return res.status(403).json({ 
                error: 'CSRF token mismatch',
                message: 'Token CSRF não corresponde ao cookie.'
            });
        }
        
        // Invalidar token após uso (one-time use)
        tokenStore.delete(token);
        
        next();
    };
}

/**
 * Rota para obter novo token CSRF
 * Deve ser chamada antes de operações POST/PUT/DELETE
 */
function csrfTokenRoute(req, res) {
    // Gera novo token CSRF
    const token = generateToken();
    const expires = Date.now() + CSRF_CONFIG.tokenExpiry;
    
    // Armazena o token
    tokenStore.set(token, { expires, ip: req.ip });
    
    // Define cookie
    res.cookie(CSRF_CONFIG.cookieName, token, {
        httpOnly: false, // JavaScript precisa acessar
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: CSRF_CONFIG.tokenExpiry
    });
    
    res.json({ 
        token,
        expires
    });
}

/**
 * Middleware simplificado que apenas valida origin/referer
 * Alternativa mais leve ao CSRF completo
 */
function originValidation(allowedOrigins = []) {
    return (req, res, next) => {
        // Ignorar métodos seguros
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return next();
        }
        
        const origin = req.headers.origin || req.headers.referer;
        
        if (!origin) {
            // Requisições sem origin (same-origin ou curl) são permitidas
            return next();
        }
        
        try {
            const originUrl = new URL(origin);
            const host = req.headers.host;
            
            // Verificar se origin corresponde ao host
            if (originUrl.host === host) {
                return next();
            }
            
            // Verificar lista de origens permitidas
            if (allowedOrigins.includes(originUrl.origin)) {
                return next();
            }
            
            console.warn('[ORIGIN] Origin não permitida:', origin, 'para', host);
            return res.status(403).json({
                error: 'Origin not allowed',
                message: 'Requisição de origem não permitida'
            });
        } catch (e) {
            console.warn('[ORIGIN] Origin inválida:', origin);
            return res.status(403).json({
                error: 'Invalid origin',
                message: 'Header de origem inválido'
            });
        }
    };
}

module.exports = {
    csrfProtection,
    csrfTokenRoute,
    originValidation,
    generateToken,
    CSRF_CONFIG
};
