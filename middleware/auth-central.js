/**
 * Auth Central — Middleware Único de Autenticação e Autorização
 * =============================================================
 *
 * Este módulo é o PONTO ÚNICO de autenticação/autorização para todo o ERP.
 * Todos os outros middlewares de auth devem delegar para cá.
 *
 * SUBSTITUI:
 * - server.js: authenticateToken (inline L2350), authorizeArea, authorizeAdmin, authorizeAction
 * - middleware/auth.js: authenticateToken, requireAdmin, checkPermission
 * - middleware/auth-unified.js: authenticate(), authorizeModule()
 * - middleware/auth-refactored.js: authenticateToken, requireAdmin
 * - middleware/rbac-integration.js: factory createRBACIntegration
 * - routes/auth-rbac.js: adminOnly, checkModuleAccess (mantidos como alias)
 *
 * Criado: 10/03/2026 — Refatoração Ponto 3
 */

const jwt = require('jsonwebtoken');
const permissionService = require('../services/permission.service');

// SEC-021: Cache service para verificar tokens revogados (blacklist)
let _cacheService;
try { _cacheService = require('../services/cache'); } catch (_) { _cacheService = null; }

const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET_KEY;
if (!JWT_SECRET) {
    console.error('❌ [AUTH-CENTRAL] ERRO FATAL: JWT_SECRET não definido no .env');
    process.exit(1);
}

// TC-AUTH-03-001: Inactivity timeout — 15 minutos (em milissegundos)
const SESSION_INACTIVITY_MS = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_MS, 10) || 15 * 60 * 1000;

// ============================================================
// 1. AUTENTICAÇÃO — Verificação de JWT
// ============================================================

/**
 * Middleware de autenticação JWT.
 * Extrai token de: Authorization header → cookie httpOnly → (nenhum query param por segurança).
 * Enforce HS256.
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = null;

    // 1. Header Authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const headerToken = authHeader.split(' ')[1];
        if (headerToken && headerToken !== 'null' && headerToken !== 'undefined') {
            token = headerToken;
        }
    }

    // 2. Cookies httpOnly
    if (!token) {
        token = req.cookies?.authToken || req.cookies?.token;
    }

    // SECURITY: Não aceitar token via query string (expõe em logs/histórico)

    if (!token) {
        return res.status(401).json({ message: 'Token de autenticação não fornecido.', code: 'AUTH_MISSING' });
    }

    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, async (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Token expirado. Faça login novamente.', code: 'AUTH_EXPIRED' });
            }
            return res.status(403).json({ message: 'Token inválido. Faça login novamente.', code: 'AUTH_INVALID' });
        }

        // SEC-021: Verificar se o access token foi revogado (blacklist por jti)
        if (user.jti && _cacheService) {
            try {
                const revoked = await _cacheService.cacheGet(`revoked_jwt:${user.jti}`);
                if (revoked) {
                    return res.status(401).json({ message: 'Sessão encerrada. Faça login novamente.', code: 'AUTH_REVOKED' });
                }
            } catch (cacheErr) {
                // v7.4 FIX: fail-open — se cache indisponível, permitir passagem com warning
                // Antes era fail-closed (503), causando logout em massa quando Redis cai
                // A blacklist é uma segunda camada de defesa; o JWT já foi validado acima
                console.warn('[AUTH] Cache indisponível para verificar blacklist:', cacheErr.message);
            }
        }

        // TC-AUTH-03-001: Inactivity timeout — 15 min sem atividade encerra a sessão
        if (_cacheService && user.id) {
            const sessionKey = `session_activity:${user.id}:${user.deviceId || 'default'}`;
            // SECURITY FIX: Requests com X-Activity-Check NÃO resetam o timer de inatividade.
            // Isso evita que health-checks periódicos do frontend anulem a proteção de inatividade.
            const isPassiveCheck = req.headers['x-activity-check'] === 'passive';
            try {
                const lastActivity = await _cacheService.cacheGet(sessionKey);

                // Se a chave não existe no Redis (TTL expirou ou nunca foi criada),
                // significa que o usuário ficou inativo além do TTL → sessão expirada.
                // Apenas permitir passagem se for a primeira requisição pós-login
                // (o login SEMPRE cria a chave, então null = inatividade).
                if (lastActivity === null || lastActivity === undefined) {
                    return res.status(401).json({
                        message: 'Sessão encerrada por inatividade.',
                        code: 'AUTH_INACTIVE'
                    });
                }

                if (Date.now() - lastActivity > SESSION_INACTIVITY_MS) {
                    // Sessão expirou por inatividade — limpar a chave
                    await _cacheService.cacheDelete(sessionKey).catch(() => {});
                    return res.status(401).json({
                        message: 'Sessão encerrada por inatividade.',
                        code: 'AUTH_INACTIVE'
                    });
                }
                // Renovar timestamp de atividade APENAS se NÃO for check passivo
                if (!isPassiveCheck) {
                    await _cacheService.cacheSet(sessionKey, Date.now(), SESSION_INACTIVITY_MS + 60000);
                }
            } catch (cacheErr) {
                // CHAOS-FIX BD-002: se cache indisponível, permitir passagem (fail-open)
                // Inatividade é segunda camada; JWT já foi validado acima
                console.warn('[AUTH] Cache indisponível para verificar inatividade:', cacheErr.message);
            }
        }

        req.user = user;
        next();
    });
}

/**
 * Middleware de autenticação opcional — não falha se não tiver token.
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }
    if (!token) token = req.cookies?.authToken || req.cookies?.token;

    if (token) {
        try {
            const user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            // SEC-021: Verificar blacklist em optionalAuth também
            if (user.jti && _cacheService) {
                _cacheService.cacheGet(`revoked_jwt:${user.jti}`)
                    .then(revoked => { req.user = revoked ? null : user; next(); })
                    .catch(() => { req.user = user; next(); });
                return;
            }
            req.user = user;
        } catch (e) {
            req.user = null;
        }
    }
    next();
}

// ============================================================
// 2. AUTORIZAÇÃO — Admin
// ============================================================

/**
 * Middleware que requer admin.
 * Verifica JWT flags + DB lookup via permission.service.
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ message: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    }

    const role = String(req.user.role || '').toLowerCase().trim();
    const isAdm = role === 'admin' || role === 'administrador' ||
                  req.user.is_admin === 1 || req.user.is_admin === true || req.user.is_admin === '1';

    if (isAdm) return next();

    return res.status(403).json({
        message: 'Acesso negado. Requer privilégios de administrador.',
        code: 'ADMIN_REQUIRED'
    });
}

/**
 * Middleware que requer admin OU RH (para rotas de RH que precisam de admin/rh).
 */
function requireAdminOrRH(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ message: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    }

    const role = String(req.user.role || '').toLowerCase().trim();
    const isAdm = role === 'admin' || role === 'administrador' ||
                  req.user.is_admin === 1 || req.user.is_admin === true || req.user.is_admin === '1';
    const isRH = role === 'rh' || role === 'recursos humanos';

    if (isAdm || isRH) return next();

    // Fallback: verificar permissão via DB
    const pool = req.app?.locals?.pool;
    if (pool) {
        permissionService.hasModuleAccess(pool, req.user.id, 'rh', req.user)
            .then(hasAccess => {
                if (hasAccess) return next();
                return res.status(403).json({
                    message: 'Acesso negado. Requer privilégios de administrador ou RH.',
                    code: 'ADMIN_RH_REQUIRED'
                });
            })
            .catch(() => res.status(403).json({
                message: 'Acesso negado. Requer privilégios de administrador ou RH.',
                code: 'ADMIN_RH_REQUIRED'
            }));
    } else {
        return res.status(403).json({
            message: 'Acesso negado. Requer privilégios de administrador ou RH.',
            code: 'ADMIN_RH_REQUIRED'
        });
    }
}

// ============================================================
// 3. AUTORIZAÇÃO — Módulo
// ============================================================

/**
 * Guarda de PÁGINA (HTML/estático) por módulo — não confundir com requireModule (API/JSON).
 * SECURITY FIX 2026-06-29: os módulos eram servidos via express.static sem nenhuma
 * verificação de login OU de área — um usuário sem acesso ao setor (ou até deslogado,
 * dependendo do navegador) conseguia abrir a página inteira só por ter o link, pois
 * o gate de permissão só existia nas chamadas de API feitas DEPOIS da página carregar.
 * Usa o mesmo permissionService (DB permissoes_modulos + fallback) das APIs, mas responde
 * com redirect/HTML em vez de JSON, já que é consumido por navegação direta de página.
 *
 * @param {string|string[]} moduleNames - Código(s) do módulo (financeiro, compras, pcp, rh, nfe...)
 */
function requirePageAccess(moduleNames) {
    const modules = Array.isArray(moduleNames) ? moduleNames : [moduleNames];
    return (req, res, next) => {
        const authHeader = req.headers['authorization'];
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split(' ')[1];
        if (!token) token = req.cookies?.authToken || req.cookies?.token;

        if (!token) {
            return res.redirect('/login.html?returnTo=' + encodeURIComponent(req.originalUrl));
        }

        jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, async (err, user) => {
            if (err) {
                return res.redirect('/login.html?returnTo=' + encodeURIComponent(req.originalUrl));
            }
            req.user = user;
            try {
                if (await permissionService.isAdmin(user)) return next();
                if (permissionService.isConsultoria(user)) {
                    permissionService.applyConsultoriaFlags(req);
                    return next();
                }
                const pool = req.app?.locals?.pool;
                for (const m of modules) {
                    if (await permissionService.hasModuleAccess(pool, user.id, m, user)) return next();
                }
            } catch (e) {
                console.error('[AUTH-CENTRAL] Erro ao verificar acesso de página:', e.message);
            }
            return res.status(403).send(
                '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
                '<title>Acesso Negado</title></head>' +
                '<body style="font-family:Arial,sans-serif;text-align:center;padding:80px 20px;color:#333">' +
                '<h1 style="font-size:48px;margin-bottom:8px">403</h1>' +
                '<p style="font-size:18px">Você não tem permissão para acessar este módulo.</p>' +
                '<p><a href="/dashboard" style="color:#6254e8">Voltar ao painel</a></p>' +
                '</body></html>'
            );
        });
    };
}

// ============================================================
// Guard específico do módulo VENDAS
// ------------------------------------------------------------
// Regra de negócio: quem tem acesso a Vendas mas NÃO é vendedor
// (permissoes_vendas.kanban=true, sem pedidos/clientes/gestão) só
// pode usar o Kanban (index.html). Também destrava o acesso ao
// módulo para esses usuários mesmo sem linha 'vendas' em
// permissoes_modulos (data-driven por permissoes_vendas).
// ============================================================
const VENDAS_KANBAN_PAGES = new Set(['', 'index.html', 'index']);
function _parsePermVendas(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return null; }
}
// "kanban-only" = tem kanban mas não é vendedor (sem pedidos/clientes/gestão)
function _isVendasKanbanOnly(pv) {
    return !!(pv && pv.kanban === true && pv.pedidos !== true && pv.clientes !== true && pv.gestao !== true);
}
function _vendas403(res) {
    return res.status(403).send(
        '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Acesso Negado</title></head>' +
        '<body style="font-family:Arial,sans-serif;text-align:center;padding:80px 20px;color:#333">' +
        '<h1 style="font-size:48px;margin-bottom:8px">403</h1>' +
        '<p style="font-size:18px">Você não tem permissão para acessar este módulo.</p>' +
        '<p><a href="/dashboard" style="color:#6254e8">Voltar ao painel</a></p></body></html>'
    );
}
function requireVendasPage() {
    return (req, res, next) => {
        const parts = (req.path || '').split('/');
        const pageName = (parts[parts.length - 1] || '').toLowerCase();
        if (pageName === 'login.html' || pageName === 'login') return res.redirect('/login.html');

        const authHeader = req.headers['authorization'];
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split(' ')[1];
        if (!token) token = req.cookies?.authToken || req.cookies?.token;
        if (!token) return res.redirect('/login.html?returnTo=' + encodeURIComponent(req.originalUrl));

        jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, async (err, user) => {
            if (err) return res.redirect('/login.html?returnTo=' + encodeURIComponent(req.originalUrl));
            req.user = user;
            try {
                if (await permissionService.isAdmin(user)) return next();
                if (permissionService.isConsultoria(user)) {
                    permissionService.applyConsultoriaFlags(req);
                    return next();
                }
                const pool = req.app?.locals?.pool;
                let pv = null;
                if (pool) {
                    try {
                        const [rows] = await pool.query('SELECT permissoes_vendas FROM usuarios WHERE id = ? LIMIT 1', [user.id]);
                        if (rows && rows[0]) pv = _parsePermVendas(rows[0].permissoes_vendas);
                    } catch (e) { /* ignora — cai no hasModuleAccess */ }
                }
                const hasModule = pool ? await permissionService.hasModuleAccess(pool, user.id, 'vendas', user) : false;
                const kanbanOnly = _isVendasKanbanOnly(pv);
                const hasAnyVendas = hasModule || kanbanOnly ||
                    !!(pv && (pv.pedidos || pv.clientes || pv.gestao || pv.dashboard || pv.relatorios || pv.estoque));

                if (!hasAnyVendas) return _vendas403(res);

                // Não-vendedor (kanban-only) → somente o Kanban (index.html)
                if (kanbanOnly && !VENDAS_KANBAN_PAGES.has(pageName)) {
                    return res.redirect('/Vendas/index.html');
                }
                return next();
            } catch (e) {
                console.error('[AUTH-CENTRAL] Erro no guard de Vendas:', e.message);
                return _vendas403(res);
            }
        });
    };
}

/**
 * Middleware de autorização por módulo.
 * DB-first com fallback hardcoded (período de transição).
 * Aplica flags de consultoria automaticamente.
 *
 * @param {string} module - Código do módulo (vendas, rh, pcp, financeiro, etc)
 */
function requireModule(module) {
    // Aceita um módulo (string) ou uma lista (array). Com lista, concede acesso
    // se o usuário tiver QUALQUER um dos módulos — ex.: ['vendas','pcp'] permite
    // que o PCP veja/movimente o Kanban de Vendas sem dar acesso a Vendas a todos.
    const modules = Array.isArray(module) ? module : [module];
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Não autenticado.', code: 'AUTH_REQUIRED' });
        }

        // Admin tem acesso a tudo
        if (await permissionService.isAdmin(req.user)) {
            return next();
        }

        // Consultoria: acesso de leitura
        if (permissionService.isConsultoria(req.user)) {
            permissionService.applyConsultoriaFlags(req);
            return next();
        }

        // Verificar módulo via permission.service (basta ter acesso a um dos módulos)
        const pool = req.app?.locals?.pool;
        for (const m of modules) {
            if (await permissionService.hasModuleAccess(pool, req.user.id, m, req.user)) {
                return next();
            }
        }

        return res.status(403).json({
            message: `Acesso negado ao módulo ${modules.join('/')}. Você não tem permissão.`,
            code: 'MODULE_DENIED'
        });
    };
}

// ============================================================
// 4. AUTORIZAÇÃO — Ação Granular
// ============================================================

/**
 * Middleware de autorização por ação.
 * DB-first com fallback hardcoded.
 *
 * @param {string} module - Código do módulo
 * @param {string|string[]} actions - Ação ou lista de ações necessárias
 */
function requireAction(module, actions) {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Não autenticado.', code: 'AUTH_REQUIRED' });
        }

        // Admin tem acesso total
        if (await permissionService.isAdmin(req.user)) {
            req.userPermissions = Array.isArray(actions) ? actions : [actions];
            return next();
        }

        const pool = req.app?.locals?.pool;
        const actionsArray = Array.isArray(actions) ? actions : [actions];

        const permittedActions = await permissionService.filterPermittedActions(
            pool, req.user.id, module, actionsArray, req.user
        );

        if (permittedActions.length > 0) {
            req.userPermissions = permittedActions;
            return next();
        }

        return res.status(403).json({
            message: `Acesso negado. Você não tem permissão para esta ação no módulo ${module}.`,
            code: 'ACTION_DENIED',
            required_actions: actionsArray,
            module
        });
    };
}

// ============================================================
// 5. AUTORIZAÇÃO — checkModuleAccess (compat auth-rbac.js)
// ============================================================

/**
 * Middleware compatível com checkModuleAccess de auth-rbac.js.
 * Usa vw_usuario_permissoes com fallback para permission.service.
 */
function checkModuleAccess(moduloCodigo, tipoPermissao = 'visualizar') {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Não autenticado.', code: 'AUTH_REQUIRED' });
        }

        if (await permissionService.isAdmin(req.user)) return next();

        const pool = req.app?.locals?.pool;
        if (!pool) {
            return res.status(403).json({
                message: `Acesso negado ao módulo ${moduloCodigo}`,
                code: 'MODULE_ACCESS_DENIED'
            });
        }

        const hasPermission = await permissionService.checkModulePermission(
            pool, req.user.id, moduloCodigo, tipoPermissao
        );

        if (hasPermission) return next();

        return res.status(403).json({
            message: `Acesso negado ao módulo ${moduloCodigo}`,
            code: 'MODULE_ACCESS_DENIED'
        });
    };
}

// ============================================================
// 6. WRITE GUARD — Anti-mutation para consultoria
// ============================================================

/**
 * Bloqueia mutations (POST/PUT/PATCH/DELETE) para perfis restritos.
 * Aplica DEPOIS de authenticateToken + requireModule.
 */
function writeGuard(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    // Se flags não foram setadas, permitir (backward compat)
    if (req.canEdit === undefined && req.canCreate === undefined && req.canDelete === undefined) {
        return next();
    }

    if (req.method === 'DELETE' && req.canDelete === false) {
        return res.status(403).json({ message: 'Seu perfil não permite exclusões.', code: 'WRITE_GUARD_DELETE' });
    }

    if (req.method === 'POST' && req.canCreate === false) {
        return res.status(403).json({ message: 'Seu perfil não permite criar registros.', code: 'WRITE_GUARD_CREATE' });
    }

    if (['PUT', 'PATCH'].includes(req.method) && req.canEdit === false) {
        return res.status(403).json({ message: 'Seu perfil não permite edições.', code: 'WRITE_GUARD_EDIT' });
    }

    next();
}

// ============================================================
// IDOR PROTECTION — Verificação de Ownership
// ============================================================

/**
 * Verifica se o recurso pertence ao usuário autenticado (IDOR protection).
 * Roles com acesso global (admin, gerente, diretor) passam automaticamente.
 *
 * @param {Object} pool - Pool MySQL
 * @param {string} table - Tabela do recurso
 * @param {string} ownerField - Campo que identifica o dono (ex: 'usuario_id')
 * @param {string} paramName - Nome do parâmetro na URL (ex: 'id')
 * @param {Object} options - Opções adicionais
 */
function checkOwnership(pool, table, ownerField, paramName = 'id', options = {}) {
    const {
        globalAccessRoles = ['admin', 'gerente', 'diretor'],
        idField = 'id'
    } = options;

    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Não autenticado.' });
        }

        const userRole = (req.user.role || '').toLowerCase();
        const isAdmin = userRole === 'admin' || req.user.is_admin === true || req.user.is_admin === 1;

        if (isAdmin || globalAccessRoles.includes(userRole)) {
            return next();
        }

        const resourceId = req.params[paramName];
        if (!resourceId) return next();

        try {
            const [rows] = await pool.query(
                `SELECT ?? FROM ?? WHERE ?? = ? LIMIT 1`,
                [ownerField, table, idField, resourceId]
            );

            if (rows.length === 0) {
                return res.status(404).json({ message: 'Recurso não encontrado.' });
            }

            const ownerId = rows[0][ownerField];
            const userId = req.user.id || req.user.userId;

            if (String(ownerId) !== String(userId)) {
                console.warn(`[IDOR] Tentativa de acesso: user ${userId} → ${table}#${resourceId} (owner: ${ownerId})`);
                return res.status(403).json({
                    message: 'Acesso negado. Este recurso não pertence a você.',
                    code: 'IDOR_DENIED'
                });
            }

            next();
        } catch (err) {
            console.error('[IDOR] Erro ao verificar ownership:', err.message);
            return res.status(500).json({ message: 'Erro ao verificar permissões.' });
        }
    };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    // Autenticação
    authenticateToken,
    optionalAuth,
    // Admin
    requireAdmin,
    requireAdminOrRH,
    // Módulo
    requireModule,
    requirePageAccess,
    requireVendasPage,
    // Ação granular
    requireAction,
    // Compat auth-rbac.js
    checkModuleAccess,
    // Write guard
    writeGuard,
    // IDOR protection
    checkOwnership,
    // Re-export do service
    permissionService,
    // Aliases para backward compatibility
    adminOnly: requireAdmin,
    authorizeArea: requireModule,
    authorizeAction: requireAction,
    authorizeAdmin: requireAdminOrRH,
};
