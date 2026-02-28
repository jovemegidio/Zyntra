/**
 * Integração de Middlewares de Segurança - ALUFORCE ERP
 * 
 * Este arquivo centraliza a configuração e aplicação de todos
 * os middlewares de segurança criados durante a auditoria.
 * 
 * USO:
 *   const { applySecurityMiddlewares } = require('./src/middleware/security-integration');
 *   applySecurityMiddlewares(app, pool);
 * 
 * Criado durante auditoria de segurança - 30/01/2026
 */

// Importar middlewares de segurança
const { csrfProtection, csrfTokenRoute, originValidation } = require('./csrf');
const { smartRateLimiter, applyRateLimiters, ipRateLimiter } = require('./rate-limit');
const { auditDeleteMiddleware, auditWriteMiddleware, initAuditTable, logAction } = require('./audit');

/**
 * Aplica todos os middlewares de segurança na aplicação Express
 * @param {Express.Application} app - Aplicação Express
 * @param {Object} options - Opções de configuração
 */
function applySecurityMiddlewares(app, options = {}) {
    const {
        pool = null,           // Pool de conexão MySQL para audit log
        enableCSRF = true,     // Habilitar proteção CSRF
        enableRateLimit = true, // Habilitar rate limiting
        enableAudit = true,    // Habilitar audit log
        allowedOrigins = [],   // Origens permitidas para CSRF
        csrfIgnorePaths = [    // Caminhos ignorados pelo CSRF
            '/api/login',
            '/api/auth/login',
            '/api/webhook',
            '/api/callback',
            '/api/sse',
            '/api/events'
        ],
        whitelistIPs = [],     // IPs na whitelist
        blacklistIPs = []      // IPs na blacklist
    } = options;

    console.log('[SECURITY] 🔒 Aplicando middlewares de segurança...');

    // 1. Rate Limiting por IP (blacklist/whitelist)
    if (enableRateLimit && (whitelistIPs.length > 0 || blacklistIPs.length > 0)) {
        app.use(ipRateLimiter({
            whitelist: whitelistIPs,
            blacklist: blacklistIPs
        }));
        console.log('[SECURITY]   ✅ IP Rate Limiter aplicado');
    }

    // 2. Rate Limiting inteligente por rota
    if (enableRateLimit) {
        app.use(smartRateLimiter());
        console.log('[SECURITY]   ✅ Smart Rate Limiter aplicado');
    }

    // 3. Validação de Origin (antes do CSRF)
    if (enableCSRF && allowedOrigins.length > 0) {
        app.use(originValidation(allowedOrigins));
        console.log('[SECURITY]   ✅ Origin Validation aplicado');
    }

    // 4. Rota para obter token CSRF
    if (enableCSRF) {
        app.get('/api/csrf-token', csrfTokenRoute);
        console.log('[SECURITY]   ✅ Rota CSRF Token registrada: GET /api/csrf-token');
    }

    // 5. Proteção CSRF
    if (enableCSRF) {
        app.use(csrfProtection({
            ignorePaths: csrfIgnorePaths
        }));
        console.log('[SECURITY]   ✅ CSRF Protection aplicado');
    }

    // 6. Audit Log para operações DELETE
    if (enableAudit) {
        app.use(auditDeleteMiddleware({ pool }));
        console.log('[SECURITY]   ✅ Audit Delete Middleware aplicado');
    }

    // 7. Inicializar tabela de auditoria
    if (enableAudit && pool) {
        initAuditTable(pool).catch(err => {
            console.error('[SECURITY] Erro ao inicializar tabela de auditoria:', err.message);
        });
    }

    console.log('[SECURITY] 🔒 Middlewares de segurança aplicados com sucesso!\n');
}

/**
 * Aplica rate limiters específicos por rota
 * @param {Express.Application} app 
 */
function applyRouteRateLimiters(app) {
    applyRateLimiters(app);
}

/**
 * Helper para logar ações administrativas
 * @param {string} action - Tipo de ação
 * @param {Object} req - Request Express
 * @param {Object} data - Dados adicionais
 * @param {Object} pool - Pool MySQL
 */
async function logAdminAction(action, req, data = {}, pool = null) {
    await logAction(action, {
        userId: req.user?.id,
        userEmail: req.user?.email,
        userRole: req.user?.role,
        ip: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent'],
        method: req.method,
        path: req.path,
        ...data
    }, pool);
}

/**
 * Middleware para logar todas as operações de escrita
 * Usar seletivamente em rotas específicas
 */
function auditAllWrites(options = {}) {
    return auditWriteMiddleware(options);
}

module.exports = {
    applySecurityMiddlewares,
    applyRouteRateLimiters,
    logAdminAction,
    auditAllWrites,
    // Re-exportar para acesso direto
    csrfProtection,
    csrfTokenRoute,
    originValidation,
    smartRateLimiter,
    applyRateLimiters,
    ipRateLimiter,
    auditDeleteMiddleware,
    auditWriteMiddleware
};
