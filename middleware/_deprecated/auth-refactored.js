/**
 * Authentication Middleware - REFATORADO
 * Middlewares para autenticação e autorização
 * 
 * ATUALIZAÇÍO: Admins agora são consultados do banco de dados
 * ao invés de lista hardcoded
 */

const jwt = require('jsonwebtoken');

// JWT_SECRET deve vir OBRIGATORIAMENTE do .env
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ [AUTH-MIDDLEWARE] ERRO FATAL: JWT_SECRET não definido no .env');
    process.exit(1);
}

// Pool de conexão será injetado pelo server.js
let dbPool = null;

/**
 * Injeta o pool de conexão do banco de dados
 * Deve ser chamado pelo server.js após criar o pool
 */
function setDbPool(pool) {
    dbPool = pool;
    console.log('✅ [AUTH] Pool de conexão configurado no middleware');
}

/**
 * Cache de admins para evitar consultas excessivas ao banco
 * TTL: 5 minutos
 */
const adminCache = {
    data: new Set(),
    lastUpdate: 0,
    TTL: 5 * 60 * 1000 // 5 minutos
};

/**
 * Atualiza cache de administradores do banco
 */
async function refreshAdminCache() {
    if (!dbPool) {
        console.warn('⚠️ [AUTH] Pool não disponível para refresh de cache');
        return false;
    }
    
    try {
        const [rows] = await dbPool.execute(`
            SELECT email FROM system_admins WHERE is_active = 1
            UNION
            SELECT email FROM usuarios WHERE role = 'admin' OR is_admin = 1
        `);
        
        adminCache.data = new Set(rows.map(r => r.email.toLowerCase()));
        adminCache.lastUpdate = Date.now();
        
        console.log(`🔄 [AUTH] Cache de admins atualizado: ${adminCache.data.size} administradores`);
        return true;
    } catch (error) {
        // Se a tabela system_admins não existir, usar apenas role=admin
        if (error.code === 'ER_NO_SUCH_TABLE') {
            console.warn('⚠️ [AUTH] Tabela system_admins não existe. Execute migration/001-admin-config.js');
            try {
                const [rows] = await dbPool.execute(`
                    SELECT email FROM usuarios WHERE role = 'admin' OR is_admin = 1
                `);
                adminCache.data = new Set(rows.map(r => r.email.toLowerCase()));
                adminCache.lastUpdate = Date.now();
                return true;
            } catch (e) {
                console.error('❌ [AUTH] Erro ao buscar admins:', e.message);
            }
        }
        return false;
    }
}

/**
 * Verifica se um email é de um administrador
 * Usa cache com fallback para banco
 */
async function isAdminEmail(email) {
    if (!email) return false;
    
    const emailLower = email.toLowerCase();
    const now = Date.now();
    
    // Se cache expirou, atualizar
    if (now - adminCache.lastUpdate > adminCache.TTL) {
        await refreshAdminCache();
    }
    
    return adminCache.data.has(emailLower);
}

/**
 * Middleware para verificar token JWT
 */
function authenticateToken(req, res, next) {
    // Tenta obter o token do cookie authToken ou do header Authorization
    const token = req.cookies?.authToken || req.cookies?.token || 
                  (req.headers['authorization'] && req.headers['authorization'].replace('Bearer ', ''));
    
    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Token inválido' });
    }
}

/**
 * Middleware para verificar se o usuário é admin
 * ATUALIZADO: Agora consulta banco de dados via cache
 */
async function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    // Verificar por role primeiro (mais rápido)
    if (req.user.role === 'admin') {
        return next();
    }
    
    // Verificar na lista de admins do banco (com cache)
    const isAdmin = await isAdminEmail(req.user.email);

    if (!isAdmin) {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    next();
}

/**
 * Versão síncrona para compatibilidade (usa apenas cache)
 * DEPRECATED: Usar requireAdmin async
 */
function requireAdminSync(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    // Verificar por role
    if (req.user.role === 'admin') {
        return next();
    }
    
    // Verificar cache (sem refresh)
    const isAdmin = adminCache.data.has(req.user.email?.toLowerCase());

    if (!isAdmin) {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    next();
}

/**
 * Middleware opcional para verificar permissões específicas
 */
function checkPermission(permission) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }

        // Admins têm todas as permissões
        if (req.user.role === 'admin') {
            return next();
        }

        // Verificar se usuário tem a permissão específica
        if (req.user.permissions && req.user.permissions.includes(permission)) {
            return next();
        }

        return res.status(403).json({ 
            error: `Permissão '${permission}' necessária` 
        });
    };
}

/**
 * API para gerenciar administradores (apenas super-admins)
 */
const adminManagementRoutes = {
    /**
     * Lista todos os administradores
     * GET /api/admin/admins
     */
    async listAdmins(req, res) {
        try {
            const [admins] = await dbPool.execute(`
                SELECT 
                    sa.id,
                    u.nome,
                    u.email,
                    sa.granted_at,
                    sa.reason,
                    granter.nome as granted_by_name
                FROM system_admins sa
                INNER JOIN usuarios u ON sa.user_id = u.id
                LEFT JOIN usuarios granter ON sa.granted_by = granter.id
                WHERE sa.is_active = 1
                ORDER BY sa.granted_at DESC
            `);
            
            res.json({ success: true, admins });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },
    
    /**
     * Adiciona um novo administrador
     * POST /api/admin/admins { email, reason }
     */
    async addAdmin(req, res) {
        const { email, reason } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email é obrigatório' });
        }
        
        try {
            // Buscar usuário
            const [users] = await dbPool.execute(
                'SELECT id FROM usuarios WHERE email = ?',
                [email]
            );
            
            if (users.length === 0) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            // Adicionar como admin
            await dbPool.execute(`
                INSERT INTO system_admins (user_id, email, granted_by, reason)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    is_active = 1,
                    granted_by = VALUES(granted_by),
                    reason = VALUES(reason)
            `, [users[0].id, email, req.user.id, reason || 'Adicionado via API']);
            
            // Limpar cache
            adminCache.lastUpdate = 0;
            await refreshAdminCache();
            
            res.json({ success: true, message: `${email} agora é administrador` });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },
    
    /**
     * Remove um administrador
     * DELETE /api/admin/admins/:email
     */
    async removeAdmin(req, res) {
        const { email } = req.params;
        
        // Não permitir remover a si mesmo
        if (email === req.user.email) {
            return res.status(400).json({ error: 'Não é possível remover suas próprias permissões de admin' });
        }
        
        try {
            await dbPool.execute(`
                UPDATE system_admins SET is_active = 0 WHERE email = ?
            `, [email]);
            
            // Limpar cache
            adminCache.lastUpdate = 0;
            await refreshAdminCache();
            
            res.json({ success: true, message: `${email} removido dos administradores` });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = {
    authenticateToken,
    requireAdmin,
    requireAdminSync,
    checkPermission,
    setDbPool,
    refreshAdminCache,
    isAdminEmail,
    adminManagementRoutes
};
