/**
 * Rate Limiting por Rota - ALUFORCE ERP
 *
 * Implementa limites de requisição diferenciados por tipo de rota:
 * - Rotas de autenticação: mais restritivas (prevenir brute force)
 * - Rotas financeiras: restritivas (dados sensíveis)
 * - Rotas de upload: muito restritivas (recursos do servidor)
 * - Rotas de leitura: mais permissivas
 * - Rotas gerais: limite padrão
 *
 * Implementação própria sem dependências externas
 *
 * Criado durante auditoria de segurança - 30/01/2026
 */

// Store para rate limiting (em produção, usar Redis)
const rateLimitStore = new Map();

/**
 * Configurações de rate limit por categoria
 */
const RATE_LIMITS = {
    // Login/Autenticação - DESABILITADO (sem limite de tentativas)
    auth: {
        windowMs: 15 * 60 * 1000, // 15 minutos
        max: 999999, // Sem limite prático de tentativas
        message: {
            error: 'Too many login attempts',
            message: 'Muitas tentativas de login. Aguarde 15 minutos.',
            retryAfter: 15 * 60
        },
        skipSuccessfulRequests: true
    },

    // Rotas financeiras - restritivo (dados sensíveis)
    financial: {
        windowMs: 1 * 60 * 1000, // 1 minuto
        max: 30, // 30 requisições por minuto
        message: {
            error: 'Too many requests to financial API',
            message: 'Limite de requisições financeiras excedido. Aguarde 1 minuto.'
        }
    },

    // Upload de arquivos - muito restritivo (recursos do servidor)
    upload: {
        windowMs: 1 * 60 * 1000, // 1 minuto
        max: 10, // 10 uploads por minuto
        message: {
            error: 'Too many file uploads',
            message: 'Limite de uploads excedido. Aguarde 1 minuto.'
        }
    },

    // Operações de escrita (POST/PUT/DELETE) - moderado
    write: {
        windowMs: 1 * 60 * 1000, // 1 minuto
        max: 60, // 60 operações por minuto
        message: {
            error: 'Too many write operations',
            message: 'Limite de operações excedido. Aguarde 1 minuto.'
        }
    },

    // Rotas de leitura - permissivo
    read: {
        windowMs: 1 * 60 * 1000, // 1 minuto
        max: 500, // 500 requisições por minuto
        message: {
            error: 'Too many read requests',
            message: 'Limite de leituras excedido. Aguarde 1 minuto.'
        }
    },

    // Limite geral padrão
    general: {
        windowMs: 1 * 60 * 1000, // 1 minuto
        max: 300, // 300 requisições por minuto
        message: {
            error: 'Too many requests',
            message: 'Limite de requisições excedido. Aguarde 1 minuto.'
        }
    },

    // APIs públicas/webhooks - permissivo mas monitorado
    public: {
        windowMs: 1 * 60 * 1000, // 1 minuto
        max: 50, // 50 requisições por minuto
        message: {
            error: 'Too many API requests',
            message: 'Limite de requisições da API excedido.'
        }
    },

    // Relatórios/Exports - restritivo (operações pesadas)
    reports: {
        windowMs: 5 * 60 * 1000, // 5 minutos
        max: 10, // 10 relatórios a cada 5 minutos
        message: {
            error: 'Too many report requests',
            message: 'Limite de geração de relatórios excedido. Aguarde 5 minutos.'
        }
    }
};

/**
 * Cria um rate limiter para uma categoria específica
 * @param {string|Object} categoryOrOptions - Categoria do rate limit ou opções diretas
 * @param {Object} customOptions - Opções customizadas (se primeiro param for string)
 * @returns {Function} Middleware Express
 */
function createRateLimiter(categoryOrOptions, customOptions = {}) {
    // Suportar chamada com opções diretas (para testes) ou com categoria
    let config, category;

    if (typeof categoryOrOptions === 'object') {
        // Chamado com opções diretas: createRateLimiter({ max: 5, windowMs: 60000 })
        config = { ...RATE_LIMITS.general, ...categoryOrOptions };
        category = 'custom';
    } else {
        // Chamado com categoria: createRateLimiter('auth')
        category = categoryOrOptions;
        config = { ...(RATE_LIMITS[category] || RATE_LIMITS.general), ...customOptions };
    }

    // Store simples em memória para o rate limiter
    const store = new Map();

    return (req, res, next) => {
        const userId = req.user?.id || 'anonymous';
        const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
        const key = `${category}:${ip}:${userId}`;

        const now = Date.now();
        let record = store.get(key);

        // Reset se a janela expirou
        if (!record || now > record.resetAt) {
            record = {
                count: 0,
                resetAt: now + (config.windowMs || 60000)
            };
        }

        record.count++;
        store.set(key, record);

        // Configurar headers
        if (res.set) {
            res.set('X-RateLimit-Limit', config.max || 100);
            res.set('X-RateLimit-Remaining', Math.max(0, (config.max || 100) - record.count));
            res.set('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));
        }

        // Verificar se excedeu o limite
        if (record.count > (config.max || 100)) {
            console.warn(`[RATE-LIMIT] Limite excedido: ${category}`, {
                ip,
                user: req.user?.email || 'anonymous',
                path: req.path,
                method: req.method
            });

            return res.status(429).json({
                error: 'Too many requests',
                message: config.message?.message || 'Limite de requisições excedido.',
                category,
                limit: config.max,
                windowMs: config.windowMs
            });
        }

        next();
    };
}

/**
 * Rotas que correspondem a cada categoria
 */
const ROUTE_PATTERNS = {
    // auth DESABILITADO - sem limite de tentativas de login
    auth: [
        // '/api/login',
        // '/api/auth/login',
        // '/api/auth/register',
        // '/api/auth/forgot-password',
        // '/api/auth/reset-password',
        // '/api/auth/refresh'
    ],

    financial: [
        '/api/financeiro',
        '/api/contas-pagar',
        '/api/contas-receber',
        '/api/fluxo-caixa',
        '/api/dre',
        '/api/balanco',
        '/api/pagamentos'
    ],

    upload: [
        '/api/upload',
        '/api/anexos',
        '/api/arquivos',
        '/api/importar'
    ],

    reports: [
        '/api/relatorios',
        '/api/exportar',
        '/api/export',
        '/api/report',
        '/api/pdf'
    ],

    public: [
        '/api/webhook',
        '/api/public',
        '/api/callback'
    ]
};

/**
 * Categoriza uma rota para rate limiting
 * @param {string} path - Caminho da rota
 * @param {string} method - Método HTTP
 * @returns {string} Categoria do rate limit
 */
function categorizeRoute(path, method) {
    // Verificar padrões específicos
    for (const [cat, patterns] of Object.entries(ROUTE_PATTERNS)) {
        if (patterns.some(p => path.startsWith(p) || path.includes(p))) {
            return cat;
        }
    }

    // Verificar padrões adicionais por keyword
    const pathLower = path.toLowerCase();

    // Autenticação - DESABILITADO: tratar como 'general' para não bloquear login
    // if (pathLower.includes('login') || pathLower.includes('logout') ||
    //     pathLower.includes('auth') || pathLower.includes('password')) {
    //     return 'auth';
    // }

    // Financeiro
    if (pathLower.includes('financeiro') || pathLower.includes('pagamento') ||
        pathLower.includes('nfe') || pathLower.includes('fatura') ||
        pathLower.includes('pagar') || pathLower.includes('receber')) {
        return 'financial';
    }

    // Upload
    if (pathLower.includes('upload') || pathLower.includes('file') ||
        pathLower.includes('anexo') || pathLower.includes('import')) {
        return 'upload';
    }

    // Classificar por método
    if (method === 'GET' || method === 'HEAD') {
        return 'read';
    } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return 'write';
    }

    return 'general';
}

/**
 * Middleware que aplica rate limit baseado na rota
 * @returns {Function} Middleware Express
 */
function smartRateLimiter() {
    // Criar limiters para cada categoria
    const limiters = {};
    for (const category of Object.keys(RATE_LIMITS)) {
        limiters[category] = createRateLimiter(category);
    }

    return (req, res, next) => {
        const path = req.path || req.url;
        const method = req.method;

        // ⚡ Pular rate limit para arquivos estáticos
        const staticExtensions = ['.js', '.css', '.html', '.ico', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.webp', '.map'];
        if (staticExtensions.some(ext => path.toLowerCase().endsWith(ext))) {
            return next();
        }

        // Determinar categoria baseada na rota
        const category = categorizeRoute(path, method);

        // Aplicar limiter da categoria
        return limiters[category](req, res, next);
    };
}

/**
 * Aplicar rate limiters específicos a rotas
 * @param {Express.Application} app - Aplicação Express
 */
function applyRateLimiters(app) {
    // Rate limit para autenticação - DESABILITADO
    // app.use('/api/login', createRateLimiter('auth'));
    // app.use('/api/auth', createRateLimiter('auth'));

    // Rate limit para rotas financeiras
    app.use('/api/financeiro', createRateLimiter('financial'));
    app.use('/api/contas-pagar', createRateLimiter('financial'));
    app.use('/api/contas-receber', createRateLimiter('financial'));

    // Rate limit para uploads
    app.use('/api/upload', createRateLimiter('upload'));
    app.use('/api/anexos', createRateLimiter('upload'));

    // Rate limit para relatórios
    app.use('/api/relatorios', createRateLimiter('reports'));
    app.use('/api/exportar', createRateLimiter('reports'));

    console.log('[RATE-LIMIT] ✅ Rate limiters aplicados por categoria');
}

/**
 * Middleware de rate limit para IPs específicos (blacklist/whitelist)
 */
function ipRateLimiter(options = {}) {
    const {
        whitelist = [],
        blacklist = [],
        blacklistLimit = 5 // requisições muito limitadas para IPs na blacklist
    } = options;

    return (req, res, next) => {
        const ip = req.ip || req.connection?.remoteAddress;

        // IPs na whitelist passam sem limit
        if (whitelist.includes(ip)) {
            return next();
        }

        // IPs na blacklist têm limite muito restritivo
        if (blacklist.includes(ip)) {
            const key = `blacklist:${ip}`;
            const now = Date.now();
            const data = rateLimitStore.get(key) || { count: 0, resetAt: now + 60000 };

            if (now > data.resetAt) {
                data.count = 0;
                data.resetAt = now + 60000;
            }

            data.count++;
            rateLimitStore.set(key, data);

            if (data.count > blacklistLimit) {
                console.warn(`[RATE-LIMIT] IP na blacklist excedeu limite: ${ip}`);
                return res.status(429).json({
                    error: 'Access restricted',
                    message: 'Acesso restrito para este IP.'
                });
            }
        }

        next();
    };
}

module.exports = {
    RATE_LIMITS,
    createRateLimiter,
    categorizeRoute,
    smartRateLimiter,
    applyRateLimiters,
    ipRateLimiter
};
