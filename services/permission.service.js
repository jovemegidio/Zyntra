/**
 * Permission Service — Serviço Centralizado de Permissões
 * ========================================================
 * Single Source of Truth para verificação de acesso.
 * 
 * Ordem de verificação:
 * 1. Admin? → acesso total
 * 2. DB (permissoes_modulos / permissoes_acoes) → fonte autoritativa
 * 3. Fallback: permissions-server.js hardcoded (período de transição)
 * 
 * Este serviço SUBSTITUI as verificações duplicadas em:
 * - server.js (authorizeArea, authorizeAction, authorizeAdmin, getDbAreas, getDbActions)
 * - middleware/auth-unified.js (authorizeModule, ROLE_MODULE_MAP)
 * - middleware/auth.js (requireAdmin com emails hardcoded)
 * - middleware/auth-refactored.js (admin cache)
 * - middleware/rbac-integration.js (factory pattern)
 * - routes/auth-rbac.js (checkModuleAccess com vw_usuario_permissoes)
 * - routes/financeiro-core.js (checkFinanceiroPermission inline)
 * - modules/RH/server.js (adminRoles, adminUsers hardcoded)
 * 
 * Criado: 10/03/2026 — Refatoração Ponto 3 (consolidação de permissões)
 */

// Escopo da SESSÃO (login por CPF → só RH). É um teto aplicado por cima de
// tudo que este serviço decide: recorta o resultado, nunca concede nada.
const loginScope = require('../utils/login-scope');

// Fallback para período de transição (será removido quando todos os users estiverem no DB)
let _hardcodedPermissions = null;
function getHardcodedPermissions() {
    if (!_hardcodedPermissions) {
        try {
            _hardcodedPermissions = require('../src/permissions-server');
        } catch (e) {
            _hardcodedPermissions = { hasAccess: () => false, hasPermission: () => false };
        }
    }
    return _hardcodedPermissions;
}

// ============================================================
// Cache em memória com TTL
// ============================================================
const _moduleCache = new Map();  // userId → { modules: Set<string>, ts: number }
const _actionCache = new Map();  // `${userId}:${module}` → { actions: Set<string>, ts: number }
const _adminCache = new Map();   // userId → { isAdmin: boolean, ts: number }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// Limpar cache expirado a cada 2 minutos
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _moduleCache.entries()) {
        if (now - entry.ts > CACHE_TTL) _moduleCache.delete(key);
    }
    for (const [key, entry] of _actionCache.entries()) {
        if (now - entry.ts > CACHE_TTL) _actionCache.delete(key);
    }
    for (const [key, entry] of _adminCache.entries()) {
        if (now - entry.ts > CACHE_TTL) _adminCache.delete(key);
    }
}, 2 * 60 * 1000).unref();

// ============================================================
// Verificação de Admin
// ============================================================

/**
 * Verifica se o usuário é admin.
 * Aceita tanto o objeto req.user (JWT) quanto userId + pool (DB lookup).
 * 
 * @param {Object} user - Objeto do JWT (req.user) com { role, is_admin }
 * @param {Object} [pool] - Pool MySQL (opcional, para DB lookup)
 * @param {number} [userId] - ID do usuário (opcional, para DB lookup)
 * @returns {Promise<boolean>}
 */
async function isAdmin(user, pool, userId) {
    // Sessão restrita (login por CPF) nunca é admin — senão o próprio
    // `if (isAdmin) return next()` no topo de cada guard furaria o escopo.
    if (loginScope.isEscopoRestrito(user)) return false;

    // O claim do token é PISTA, não prova. Um token assinado com o segredo de
    // outra instância carrega o role/is_admin de um usuário que não é o desta
    // base — foi assim que um admin da Cobal virava admin da Aluforce enquanto
    // as duas compartilhavam JWT_SECRET. O banco decide sempre que der.
    const claimDizAdmin = !!user && (() => {
        const role = String(user.role || '').toLowerCase().trim();
        if (role === 'admin' || role === 'administrador') return true;
        return user.is_admin === 1 || user.is_admin === true || user.is_admin === '1';
    })();

    // Sem banco para conferir, o claim é tudo que resta.
    const id = userId || user?.id || user?.userId;
    if (!pool || !id) return claimDizAdmin;

    // Cache
    const cached = _adminCache.get(id);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.isAdmin;

    // DB lookup
    try {
        const [rows] = await pool.query(
            'SELECT is_admin, role FROM usuarios WHERE id = ? LIMIT 1', [id]
        );
        if (rows.length === 0) {
            _adminCache.set(id, { isAdmin: false, ts: Date.now() });
            return false;
        }
        const dbUser = rows[0];
        const result = dbUser.is_admin === 1 ||
                       String(dbUser.role || '').toLowerCase() === 'admin' ||
                       String(dbUser.role || '').toLowerCase() === 'administrador';
        _adminCache.set(id, { isAdmin: result, ts: Date.now() });
        return result;
    } catch (e) {
        return false;
    }
}

// ============================================================
// Verificação de Acesso a Módulo
// ============================================================

/**
 * Verifica se o usuário tem acesso a um módulo.
 * DB-first com fallback hardcoded.
 * 
 * @param {Object} pool - Pool MySQL
 * @param {number} userId - ID do usuário
 * @param {string} module - Código do módulo (vendas, rh, pcp, etc)
 * @param {Object} [user] - Objeto JWT (para firstName fallback)
 * @returns {Promise<boolean>}
 */
async function hasModuleAccess(pool, userId, module, user) {
    if (!userId || !module) return false;

    // Teto do escopo: numa sessão por CPF, só o RH passa — independente
    // do que permissoes_modulos/areas concedam ao cadastro.
    if (!loginScope.moduloLiberado(user, module)) return false;

    const moduleLower = module.toLowerCase();

    // Cache
    const cached = _moduleCache.get(userId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        if (cached.modules === null) {
            // null = sem registros no DB → usar fallback
            return _hardcodedFallbackAccess(user, moduleLower);
        }
        return cached.modules.has(moduleLower);
    }

    // DB lookup (permissoes_modulos)
    if (pool) {
        try {
            const [rows] = await pool.query(
                'SELECT modulo FROM permissoes_modulos WHERE usuario_id = ? AND visualizar = 1',
                [userId]
            );
            if (rows.length > 0) {
                const modules = new Set(rows.map(r => r.modulo.toLowerCase()));
                _moduleCache.set(userId, { modules, ts: Date.now() });
                return modules.has(moduleLower);
            }
            // Sem registros no DB → cache como null para usar fallback
            _moduleCache.set(userId, { modules: null, ts: Date.now() });
        } catch (e) {
            // Erro no DB → não cachear, tentar fallback
        }
    }

    return _hardcodedFallbackAccess(user, moduleLower);
}

/**
 * Retorna todos os módulos acessíveis pelo usuário.
 * @returns {Promise<Set<string>|null>} Set de módulos ou null se sem dados
 */
async function getUserModules(pool, userId, user) {
    if (!userId) return new Set();

    const cached = _moduleCache.get(userId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        if (cached.modules) return loginScope.filtrarModulos(user, cached.modules);
        // Fallback
        return loginScope.filtrarModulos(user, _hardcodedFallbackModules(user));
    }

    if (pool) {
        try {
            const [rows] = await pool.query(
                'SELECT modulo FROM permissoes_modulos WHERE usuario_id = ? AND visualizar = 1',
                [userId]
            );
            if (rows.length > 0) {
                const modules = new Set(rows.map(r => r.modulo.toLowerCase()));
                // Cacheia o conjunto REAL do usuário; o recorte do escopo é
                // aplicado na saída, senão a sessão por CPF envenenaria o
                // cache (TTL 5 min) compartilhado com a sessão por e-mail.
                _moduleCache.set(userId, { modules, ts: Date.now() });
                return loginScope.filtrarModulos(user, modules);
            }
            _moduleCache.set(userId, { modules: null, ts: Date.now() });
        } catch (e) { /* fallthrough */ }
    }

    return loginScope.filtrarModulos(user, _hardcodedFallbackModules(user));
}

// ============================================================
// Verificação de Ações Granulares
// ============================================================

/**
 * Verifica se o usuário tem permissão para uma ação específica em um módulo.
 * DB-first com fallback hardcoded.
 * 
 * @param {Object} pool - Pool MySQL
 * @param {number} userId - ID do usuário
 * @param {string} module - Código do módulo
 * @param {string} action - Ação (ex: 'pedido.criar', 'exportar.excel')
 * @param {Object} [user] - Objeto JWT (para firstName fallback)
 * @returns {Promise<boolean>}
 */
async function hasActionPermission(pool, userId, module, action, user) {
    if (!userId || !module || !action) return false;

    // Nenhuma ação fora do RH numa sessão restrita (login por CPF).
    if (!loginScope.moduloLiberado(user, module)) return false;

    const cacheKey = `${userId}:${module}`;
    const cached = _actionCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        if (cached.actions === null) {
            return _hardcodedFallbackAction(user, module, action);
        }
        return cached.actions.has(action);
    }

    if (pool) {
        try {
            const [rows] = await pool.query(
                'SELECT acao FROM permissoes_acoes WHERE usuario_id = ? AND modulo = ? AND permitido = 1',
                [userId, module]
            );
            if (rows.length > 0) {
                const actions = new Set(rows.map(r => r.acao));
                _actionCache.set(cacheKey, { actions, ts: Date.now() });
                return actions.has(action);
            }
            _actionCache.set(cacheKey, { actions: null, ts: Date.now() });
        } catch (e) { /* fallthrough */ }
    }

    return _hardcodedFallbackAction(user, module, action);
}

/**
 * Filtra uma lista de ações retornando apenas as permitidas.
 * @returns {Promise<string[]>} Lista de ações permitidas
 */
async function filterPermittedActions(pool, userId, module, actions, user) {
    if (!Array.isArray(actions)) actions = [actions];
    const results = [];
    for (const action of actions) {
        if (await hasActionPermission(pool, userId, module, action, user)) {
            results.push(action);
        }
    }
    return results;
}

// ============================================================
// Verificação via View RBAC (auth-rbac.js compat)
// ============================================================

/**
 * Verifica permissão via view vw_usuario_permissoes (compatível com auth-rbac.js).
 * @param {Object} pool
 * @param {number} userId
 * @param {string} moduloCodigo
 * @param {string} tipoPermissao - visualizar|criar|editar|excluir|aprovar
 * @param {Object} [user] - Objeto JWT (para aplicar o escopo da sessão)
 * @returns {Promise<boolean>}
 */
async function checkModulePermission(pool, userId, moduloCodigo, tipoPermissao = 'visualizar', user) {
    if (!pool || !userId || !moduloCodigo) return false;

    if (!loginScope.moduloLiberado(user, moduloCodigo)) return false;

    try {
        const [result] = await pool.query(`
            SELECT COUNT(*) as tem_permissao
            FROM vw_usuario_permissoes
            WHERE usuario_id = ?
            AND modulo_codigo = ?
            AND (
                (? = 'visualizar' AND pode_visualizar = TRUE) OR
                (? = 'criar' AND pode_criar = TRUE) OR
                (? = 'editar' AND pode_editar = TRUE) OR
                (? = 'excluir' AND pode_excluir = TRUE) OR
                (? = 'aprovar' AND pode_aprovar = TRUE)
            )
        `, [userId, moduloCodigo, tipoPermissao, tipoPermissao, tipoPermissao, tipoPermissao, tipoPermissao]);

        return result[0]?.tem_permissao > 0;
    } catch (e) {
        // View pode não existir → fallback para permissoes_modulos
        return hasModuleAccess(pool, userId, moduloCodigo, user);
    }
}

// ============================================================
// Verificação de Consultoria (read-only)
// ============================================================

/**
 * Verifica se o usuário é consultoria (acesso somente leitura).
 * @param {Object} user - Objeto JWT
 * @returns {boolean}
 */
function isConsultoria(user) {
    // Os guards liberam consultoria ANTES de checar o módulo; numa sessão
    // restrita (login por CPF) esse atalho furaria o escopo.
    if (loginScope.isEscopoRestrito(user)) return false;
    return String(user?.role || '').toLowerCase() === 'consultoria';
}

/**
 * Aplica flags de read-only no request para perfil consultoria.
 * @param {Object} req - Express request com req.user populado
 */
function applyConsultoriaFlags(req) {
    if (isConsultoria(req.user)) {
        req.isConsultoria = true;
        req.canEdit = false;
        req.canCreate = false;
        req.canDelete = false;
        req.canApprove = false;
    }
}

// ============================================================
// Invalidação de Cache
// ============================================================

/**
 * Invalida todo o cache de um usuário (chamar ao alterar permissões).
 */
function invalidateUserCache(userId) {
    _moduleCache.delete(userId);
    _adminCache.delete(userId);
    // Limpar ações (precisa iterar porque chave é composta)
    for (const key of _actionCache.keys()) {
        if (key.startsWith(`${userId}:`)) {
            _actionCache.delete(key);
        }
    }
    // Invalidar global._permCache (server.js) se existir
    if (global._permCache) global._permCache.delete(userId);
    if (global._actionCache) {
        for (const key of global._actionCache.keys()) {
            if (key.startsWith(`${userId}:`)) global._actionCache.delete(key);
        }
    }
}

/**
 * Limpa todo o cache de permissões.
 */
function clearAllCache() {
    _moduleCache.clear();
    _actionCache.clear();
    _adminCache.clear();
    if (global._permCache) global._permCache.clear();
    if (global._actionCache) global._actionCache.clear();
}

// ============================================================
// Helpers de Fallback (hardcoded → transição)
// ============================================================

function _addUserKey(keys, value) {
    const key = String(value || '').toLowerCase().trim();
    if (key && !keys.includes(key)) keys.push(key);
}

function _extractUserKeys(user) {
    const keys = [];
    if (!user) return keys;

    const addEmailKeys = (value) => {
        const email = String(value || '').toLowerCase().trim();
        if (!email) return;
        _addUserKey(keys, email);
        const localPart = email.split('@')[0];
        _addUserKey(keys, localPart);
        _addUserKey(keys, localPart.split('.')[0]);
    };

    addEmailKeys(user.email || user.username);
    _addUserKey(keys, user.login);

    if (user.nome) {
        _addUserKey(keys, user.nome);
        _addUserKey(keys, user.nome.split(' ')[0]);
    }

    return keys;
}

function _resolveHardcodedUserKey(user) {
    const permissions = getHardcodedPermissions();
    const keys = _extractUserKeys(user);
    if (!keys.length) return null;

    if (typeof permissions.getUserData === 'function') {
        const knownKey = keys.find(key => permissions.getUserData(key));
        if (knownKey) return knownKey;
    }

    return keys[0];
}

function _hardcodedFallbackAccess(user, module) {
    const key = _resolveHardcodedUserKey(user);
    if (!key) return false;
    return getHardcodedPermissions().hasAccess(key, module, user?.role);
}

function _hardcodedFallbackModules(user) {
    const key = _resolveHardcodedUserKey(user);
    if (!key) return new Set();
    try {
        const areas = getHardcodedPermissions().getUserAreas(key);
        return new Set((areas || []).map(a => a.toLowerCase()));
    } catch (e) {
        return new Set();
    }
}

function _hardcodedFallbackAction(user, module, action) {
    const key = _resolveHardcodedUserKey(user);
    if (!key) return false;
    return getHardcodedPermissions().hasPermission(key, module, action, user?.role);
}

module.exports = {
    // Core
    isAdmin,
    hasModuleAccess,
    hasActionPermission,
    filterPermittedActions,
    checkModulePermission,
    getUserModules,
    // Consultoria
    isConsultoria,
    applyConsultoriaFlags,
    // Cache
    invalidateUserCache,
    clearAllCache,
};
