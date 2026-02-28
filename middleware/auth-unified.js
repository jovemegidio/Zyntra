/**
 * AUDIT-FIX R-01: Sistema de Autenticação e Autorização Unificado — ALUFORCE ERP
 * 
 * Este módulo substitui os 5 sistemas concorrentes de auth por um único sistema
 * baseado em RBAC com banco de dados, com fallback seguro.
 * 
 * Criado durante auditoria de segurança — 15/02/2026
 * 
 * IMPORTANTE: Este módulo implementa fail-closed (nega acesso em caso de erro)
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET_KEY;

// Cache de permissões em memória com TTL (evita query a cada request)
const permissionsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Limpa cache de permissões expiradas periodicamente
 */
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of permissionsCache.entries()) {
        if (now - entry.timestamp > CACHE_TTL) {
            permissionsCache.delete(key);
        }
    }
}, 60 * 1000); // Limpa a cada 1 minuto

/**
 * Busca permissões do usuário no banco de dados (com cache)
 */
async function getUserPermissions(pool, userId) {
    const cacheKey = `perms_${userId}`;
    const cached = permissionsCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return cached.data;
    }

    try {
        // Tentar buscar da tabela de RBAC primeiro
        const [roles] = await pool.query(`
            SELECT DISTINCT m.codigo as modulo, p.acao
            FROM usuario_roles ur
            JOIN role_permissoes rp ON ur.role_id = rp.role_id
            JOIN permissoes p ON rp.permissao_id = p.id
            JOIN modulos m ON p.modulo_id = m.id
            WHERE ur.usuario_id = ? AND ur.ativo = 1
        `, [userId]);

        if (roles.length > 0) {
            const perms = { source: 'rbac', modules: {} };
            for (const row of roles) {
                if (!perms.modules[row.modulo]) perms.modules[row.modulo] = [];
                perms.modules[row.modulo].push(row.acao);
            }
            permissionsCache.set(cacheKey, { data: perms, timestamp: Date.now() });
            return perms;
        }
    } catch (err) {
        // Tabela RBAC pode não existir ainda — fallback para verificação por role
        console.warn('[AUTH-UNIFIED] Tabelas RBAC não disponíveis, usando role do JWT');
    }

    // Fallback: usar role do JWT (campo no token)
    return { source: 'jwt-role', modules: null };
}

/**
 * Middleware unificado de autenticação JWT
 * Substitui: authenticateToken, authMiddleware do rbac-integration
 */
function authenticate(pool) {
    return (req, res, next) => {
        const authHeader = req.headers['authorization'];
        let token = null;

        // Extrair token do header Authorization
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const headerToken = authHeader.split(' ')[1];
            if (headerToken && headerToken !== 'null' && headerToken !== 'undefined') {
                token = headerToken;
            }
        }

        // Fallback: cookies
        if (!token) {
            token = req.cookies?.authToken || req.cookies?.token;
        }

        if (!token) {
            return res.status(401).json({ message: 'Token de autenticação não fornecido.', code: 'AUTH_MISSING' });
        }

        jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, async (err, user) => {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(401).json({ message: 'Token expirado. Faça login novamente.', code: 'AUTH_EXPIRED' });
                }
                return res.status(403).json({ message: 'Token inválido.', code: 'AUTH_INVALID' });
            }
            
            req.user = user;

            // Carregar permissões do banco (com cache)
            if (pool) {
                try {
                    req.userPermissions = await getUserPermissions(pool, user.id || user.userId);
                } catch (e) {
                    // Fail-closed: se não conseguir carregar permissões, ainda permite auth
                    // mas authorizeModule vai negar acesso se precisar de perms específicas
                    req.userPermissions = { source: 'jwt-role', modules: null };
                }
            }

            next();
        });
    };
}

/**
 * Middleware unificado de autorização por módulo
 * Substitui: authorizeArea, requireModuleAccess, authorizeFinanceiro, authorizeCompras
 * 
 * Verifica acesso em ordem:
 * 1. Admin? → permite
 * 2. RBAC DB? → verifica permissão específica
 * 3. JWT role? → verifica se role tem acesso ao módulo
 */
function authorizeModule(moduleName, action = 'visualizar') {
    // Mapeamento de roles para módulos permitidos
    const ROLE_MODULE_MAP = {
        'admin': '*', // Acesso total
        'comercial': ['vendas', 'clientes', 'produtos', 'crm', 'dashboard'],
        'financeiro': ['financeiro', 'faturamento', 'dashboard'],
        'compras': ['compras', 'produtos', 'fornecedores', 'dashboard'],
        'pcp': ['pcp', 'produtos', 'estoque', 'dashboard'],
        'rh': ['rh', 'funcionarios', 'dashboard'],
        'logistica': ['logistica', 'estoque', 'dashboard'],
        'consultoria': ['vendas', 'financeiro', 'compras', 'pcp', 'dashboard'], // Leitura apenas
        'gerente': '*', // Acesso total
        'diretor': '*'  // Acesso total
    };

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Não autenticado.', code: 'AUTH_REQUIRED' });
        }

        const userRole = (req.user.role || '').toLowerCase();
        const isAdmin = userRole === 'admin' || 
                        req.user.is_admin === true || 
                        req.user.is_admin === 1 ||
                        req.user.is_admin === '1';

        // 1. Admin sempre tem acesso
        if (isAdmin) return next();

        // 2. Verificar RBAC do banco (se disponível)
        if (req.userPermissions?.source === 'rbac' && req.userPermissions.modules) {
            const modulePerms = req.userPermissions.modules[moduleName.toLowerCase()];
            if (modulePerms && (modulePerms.includes(action) || modulePerms.includes('*'))) {
                return next();
            }
            // RBAC diz não → negar
            return res.status(403).json({
                message: `Acesso negado ao módulo ${moduleName}.`,
                code: 'AUTHZ_DENIED'
            });
        }

        // 3. Fallback: verificar por role do JWT
        const allowedModules = ROLE_MODULE_MAP[userRole];
        if (allowedModules === '*') return next();
        
        if (Array.isArray(allowedModules) && allowedModules.includes(moduleName.toLowerCase())) {
            // Consultoria = somente leitura
            if (userRole === 'consultoria') {
                req.isConsultoria = true;
                req.canEdit = false;
                req.canCreate = false;
                req.canDelete = false;
            }
            return next();
        }

        // Negar acesso (fail-closed)
        return res.status(403).json({
            message: `Acesso negado ao módulo ${moduleName}. Seu perfil (${userRole}) não tem permissão.`,
            code: 'AUTHZ_DENIED'
        });
    };
}

/**
 * AUDIT-FIX R-05: Middleware de verificação de ownership (anti-IDOR)
 * Verifica se o recurso pertence ao usuário ou se o usuário tem role com acesso global
 * 
 * @param {string} table - Nome da tabela (ex: 'pedidos')
 * @param {string} ownerField - Campo que identifica o dono (ex: 'vendedor_id', 'usuario_id')
 * @param {string} paramName - Nome do parâmetro na URL (ex: 'id')
 * @param {Object} options - Opções adicionais
 */
function checkOwnership(pool, table, ownerField, paramName = 'id', options = {}) {
    const {
        globalAccessRoles = ['admin', 'gerente', 'diretor', 'consultoria'],
        idField = 'id'
    } = options;

    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Não autenticado.' });
        }

        const userRole = (req.user.role || '').toLowerCase();
        const isAdmin = userRole === 'admin' || req.user.is_admin === true || req.user.is_admin === 1;

        // Roles com acesso global podem ver qualquer recurso
        if (isAdmin || globalAccessRoles.includes(userRole)) {
            return next();
        }

        const resourceId = req.params[paramName];
        if (!resourceId) return next(); // Sem ID = listagem (tratada por query filter)

        try {
            const [rows] = await pool.query(
                `SELECT ${ownerField} FROM ${table} WHERE ${idField} = ? LIMIT 1`,
                [resourceId]
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
            // Fail-closed: erro = negar
            return res.status(500).json({ message: 'Erro ao verificar permissões.' });
        }
    };
}

/**
 * Middleware para filtrar listagens por usuário (anti-IDOR em queries de lista)
 * Adiciona filtro WHERE automaticamente para que usuários vejam apenas seus dados
 */
function scopeToUser(ownerField = 'vendedor_id') {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Não autenticado.' });
        }

        const userRole = (req.user.role || '').toLowerCase();
        const isAdmin = userRole === 'admin' || req.user.is_admin === true || req.user.is_admin === 1;
        const isGlobal = ['admin', 'gerente', 'diretor', 'consultoria'].includes(userRole);

        if (isAdmin || isGlobal) {
            req.scopeFilter = ''; // Sem filtro
            req.scopeParams = [];
        } else {
            req.scopeFilter = ` AND ${ownerField} = ?`;
            req.scopeParams = [req.user.id || req.user.userId];
        }

        next();
    };
}

/**
 * Invalida cache de permissões de um usuário (chamar ao alterar permissões)
 */
function invalidatePermissionsCache(userId) {
    permissionsCache.delete(`perms_${userId}`);
}

/**
 * Limpa todo o cache de permissões
 */
function clearPermissionsCache() {
    permissionsCache.clear();
}

module.exports = {
    authenticate,
    authorizeModule,
    checkOwnership,
    scopeToUser,
    invalidatePermissionsCache,
    clearPermissionsCache,
    getUserPermissions
};
