// =================================================================
// INTEGRAÇÍO RBAC - ALUFORCE v2.0
// Middleware e utilitários para integrar o novo sistema RBAC
// =================================================================

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Cria as funções de middleware e integração RBAC
 * @param {Object} pool - Pool de conexão MySQL
 * @param {String} jwtSecret - Chave secreta JWT
 * @returns {Object} Objeto com middlewares e funções utilitárias
 */
function createRBACIntegration(pool, jwtSecret) {
    
    // =========================================================================
    // CACHE EM MEMÓRIA
    // =========================================================================
    const permissionCache = new Map();
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

    function getCachedPermissions(userId) {
        const cached = permissionCache.get(userId);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
            return cached.data;
        }
        return null;
    }

    function setCachedPermissions(userId, data) {
        permissionCache.set(userId, { data, timestamp: Date.now() });
    }

    function clearUserCache(userId) {
        permissionCache.delete(userId);
    }

    function clearAllCache() {
        permissionCache.clear();
    }

    // =========================================================================
    // FUNÇÕES AUXILIARES
    // =========================================================================

    /**
     * Busca permissões completas do usuário no banco (RBAC)
     */
    async function getUserPermissionsFromDB(userId) {
        // Verificar cache primeiro
        const cached = getCachedPermissions(userId);
        if (cached) return cached;

        const connection = await pool.getConnection();
        try {
            // Verificar se as tabelas RBAC existem
            const [tables] = await connection.query(`
                SELECT TABLE_NAME 
                FROM information_schema.TABLES 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME IN ('roles', 'usuario_roles', 'role_modulos', 'modulos')
            `);

            // Se tabelas RBAC não existem, retornar null (usar sistema legado)
            if (tables.length < 4) {
                console.log('[RBAC] Tabelas RBAC não encontradas, usando sistema legado');
                return null;
            }

            // Buscar roles do usuário
            const [userRoles] = await connection.query(`
                SELECT r.id, r.nome, r.codigo, r.nivel, r.is_system
                FROM roles r
                INNER JOIN usuario_roles ur ON r.id = ur.role_id
                WHERE ur.usuario_id = ? AND ur.ativo = 1
                ORDER BY r.nivel DESC
            `, [userId]);

            if (!userRoles.length) {
                // Usuário sem roles RBAC - retornar null para usar sistema legado
                return null;
            }

            // Buscar módulos acessíveis pelas roles
            const roleIds = userRoles.map(r => r.id);
            const [moduleAccess] = await connection.query(`
                SELECT DISTINCT 
                    m.codigo,
                    m.nome,
                    m.url,
                    MAX(rm.pode_visualizar) as pode_visualizar,
                    MAX(rm.pode_criar) as pode_criar,
                    MAX(rm.pode_editar) as pode_editar,
                    MAX(rm.pode_excluir) as pode_excluir,
                    MAX(rm.pode_aprovar) as pode_aprovar
                FROM modulos m
                INNER JOIN role_modulos rm ON m.id = rm.modulo_id
                WHERE rm.role_id IN (?) AND m.ativo = 1
                GROUP BY m.id, m.codigo, m.nome, m.url
            `, [roleIds]);

            // Verificar permissões especiais do usuário
            const [specialPerms] = await connection.query(`
                SELECT 
                    m.codigo as modulo_codigo,
                    p.codigo as permissao_codigo,
                    upe.concedida
                FROM usuario_permissoes_especiais upe
                INNER JOIN permissoes p ON upe.permissao_id = p.id
                LEFT JOIN modulos m ON upe.modulo_id = m.id
                WHERE upe.usuario_id = ?
            `, [userId]);

            // Montar objeto de permissões
            const permissions = {
                roles: userRoles.map(r => ({
                    id: r.id,
                    nome: r.nome,
                    codigo: r.codigo,
                    nivel: r.nivel
                })),
                highestLevel: Math.max(...userRoles.map(r => r.nivel)),
                modules: {},
                specialPermissions: {}
            };

            // Mapear acesso aos módulos
            moduleAccess.forEach(mod => {
                permissions.modules[mod.codigo] = {
                    nome: mod.nome,
                    url: mod.url,
                    visualizar: !!mod.pode_visualizar,
                    criar: !!mod.pode_criar,
                    editar: !!mod.pode_editar,
                    excluir: !!mod.pode_excluir,
                    aprovar: !!mod.pode_aprovar
                };
            });

            // Aplicar permissões especiais
            specialPerms.forEach(sp => {
                if (!permissions.specialPermissions[sp.modulo_codigo || 'global']) {
                    permissions.specialPermissions[sp.modulo_codigo || 'global'] = {};
                }
                permissions.specialPermissions[sp.modulo_codigo || 'global'][sp.permissao_codigo] = sp.concedida;
            });

            // Guardar no cache
            setCachedPermissions(userId, permissions);

            return permissions;

        } finally {
            connection.release();
        }
    }

    /**
     * Verifica se usuário tem acesso a um módulo específico
     */
    async function checkModuleAccess(userId, moduloCodigo, acao = 'visualizar') {
        // Buscar permissões do usuário
        const permissions = await getUserPermissionsFromDB(userId);
        
        // Se não há RBAC configurado, retornar true (deixar sistema legado decidir)
        if (!permissions) return { hasRBAC: false, allowed: true };

        // Super admin tem acesso total
        if (permissions.highestLevel >= 100) {
            return { hasRBAC: true, allowed: true };
        }

        // Verificar permissão especial primeiro
        const specialPerm = permissions.specialPermissions[moduloCodigo]?.[acao];
        if (specialPerm !== undefined) {
            return { hasRBAC: true, allowed: specialPerm };
        }

        // Verificar acesso pelo módulo
        const modulePerms = permissions.modules[moduloCodigo];
        if (!modulePerms) {
            return { hasRBAC: true, allowed: false };
        }

        // Mapear ação para permissão
        const actionMap = {
            'visualizar': 'visualizar',
            'criar': 'criar',
            'editar': 'editar',
            'excluir': 'excluir',
            'aprovar': 'aprovar',
            'view': 'visualizar',
            'create': 'criar',
            'edit': 'editar',
            'delete': 'excluir',
            'approve': 'aprovar'
        };

        const permKey = actionMap[acao] || 'visualizar';
        return { hasRBAC: true, allowed: !!modulePerms[permKey] };
    }

    /**
     * Registra log de acesso
     */
    async function logAccess(userId, acao, modulo, detalhes = null, ip = null, userAgent = null) {
        try {
            await pool.query(`
                INSERT INTO log_acessos (usuario_id, acao, modulo, detalhes, ip, user_agent)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [userId, acao, modulo, detalhes, ip, userAgent]);
        } catch (err) {
            // Log de acesso não deve impedir a operação
            console.error('[RBAC] Erro ao registrar log:', err.message);
        }
    }

    // =========================================================================
    // MIDDLEWARES
    // =========================================================================

    /**
     * Middleware de autenticação com suporte a RBAC
     */
    function authMiddleware(req, res, next) {
        const token = req.cookies?.authToken || req.headers['authorization']?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Não autenticado' 
            });
        }

        try {
            const decoded = jwt.verify(token, jwtSecret);
            req.user = decoded;
            next();
        } catch (err) {
            console.log('[RBAC] Token inválido:', err.message);
            return res.status(401).json({ 
                success: false, 
                message: 'Token inválido ou expirado' 
            });
        }
    }

    /**
     * Middleware para verificar acesso a módulo específico
     * @param {String} moduloCodigo - Código do módulo (pcp, vendas, etc)
     * @param {String} acao - Ação requerida (visualizar, criar, editar, excluir, aprovar)
     */
    function requireModuleAccess(moduloCodigo, acao = 'visualizar') {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    return res.status(401).json({ 
                        success: false, 
                        message: 'Não autenticado' 
                    });
                }

                const { hasRBAC, allowed } = await checkModuleAccess(req.user.id, moduloCodigo, acao);

                // Se RBAC não está configurado para este usuário, deixar passar
                // O sistema legado (authorizeArea) irá verificar
                if (!hasRBAC) {
                    return next();
                }

                if (!allowed) {
                    // Registrar tentativa de acesso negado
                    await logAccess(
                        req.user.id, 
                        'acesso_negado', 
                        moduloCodigo, 
                        JSON.stringify({ acao }),
                        req.ip,
                        req.headers['user-agent']
                    );

                    return res.status(403).json({ 
                        success: false, 
                        message: `Acesso negado ao módulo ${moduloCodigo}`,
                        detail: `Você não tem permissão para ${acao} neste módulo`
                    });
                }

                // Acesso permitido
                next();

            } catch (err) {
                console.error('[RBAC] Erro ao verificar permissão:', err);
                // AUDIT-FIX R-05: Fail-closed — em caso de erro, NEGAR acesso (nunca conceder)
                return res.status(500).json({ 
                    success: false, 
                    message: 'Erro interno ao verificar permissões. Acesso negado por segurança.',
                    code: 'RBAC_ERROR'
                });
            }
        };
    }

    /**
     * Middleware para verificar se é admin
     */
    function requireAdmin(req, res, next) {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Não autenticado' 
            });
        }

        if (!req.user.is_admin) {
            return res.status(403).json({ 
                success: false, 
                message: 'Acesso restrito a administradores' 
            });
        }

        next();
    }

    /**
     * Middleware combinado: autenticação + verificação de módulo
     */
    function authAndModule(moduloCodigo, acao = 'visualizar') {
        return [authMiddleware, requireModuleAccess(moduloCodigo, acao)];
    }

    // =========================================================================
    // FUNÇÕES DE MIGRAÇÍO
    // =========================================================================

    /**
     * Migra usuários do sistema legado para RBAC
     * Converte permissões do permissions.js para roles no banco
     */
    async function migrateUsersToRBAC() {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Buscar todos os usuários
            const [usuarios] = await connection.query('SELECT id, email, is_admin FROM usuarios');

            // Importar permissões legadas
            let legacyPermissions = {};
            try {
                legacyPermissions = require('../public/js/permissions');
            } catch (e) {
                console.log('[RBAC] Arquivo de permissões legadas não encontrado');
            }

            // Mapear áreas para roles
            const areaToRole = {
                'vendas': 'vendedor',
                'pcp': 'operador_pcp',
                'compras': 'comprador',
                'financeiro': 'financeiro',
                'rh': 'rh',
                'estoque': 'estoquista',
                'faturamento': 'faturamento',
                'logistica': 'logistica',
                'qualidade': 'qualidade',
                'nfe': 'faturamento'
            };

            for (const user of usuarios) {
                const userName = user.email?.split('@')[0]?.toLowerCase();
                const userPerms = legacyPermissions[userName];

                if (!userPerms) continue;

                // Se é admin, atribuir role de admin
                if (userPerms.isAdmin || user.is_admin) {
                    const [adminRole] = await connection.query(
                        'SELECT id FROM roles WHERE codigo = ?', ['admin']
                    );
                    if (adminRole.length) {
                        await connection.query(`
                            INSERT IGNORE INTO usuario_roles (usuario_id, role_id)
                            VALUES (?, ?)
                        `, [user.id, adminRole[0].id]);
                    }
                }

                // Atribuir roles baseado nas áreas
                if (userPerms.areas) {
                    for (const area of userPerms.areas) {
                        const roleCodigo = areaToRole[area];
                        if (!roleCodigo) continue;

                        const [role] = await connection.query(
                            'SELECT id FROM roles WHERE codigo = ?', [roleCodigo]
                        );
                        if (role.length) {
                            await connection.query(`
                                INSERT IGNORE INTO usuario_roles (usuario_id, role_id)
                                VALUES (?, ?)
                            `, [user.id, role[0].id]);
                        }
                    }
                }
            }

            await connection.commit();
            console.log('[RBAC] Migração de usuários concluída');
            return { success: true, message: 'Migração concluída' };

        } catch (err) {
            await connection.rollback();
            console.error('[RBAC] Erro na migração:', err);
            return { success: false, error: err.message };
        } finally {
            connection.release();
        }
    }

    // =========================================================================
    // RETORNO DO MÓDULO
    // =========================================================================

    return {
        // Middlewares
        authMiddleware,
        requireModuleAccess,
        requireAdmin,
        authAndModule,

        // Funções auxiliares
        getUserPermissionsFromDB,
        checkModuleAccess,
        logAccess,
        
        // Gerenciamento de cache
        clearUserCache,
        clearAllCache,

        // Migração
        migrateUsersToRBAC
    };
}

module.exports = createRBACIntegration;
