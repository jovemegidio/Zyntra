/**
 * Authentication Middleware
 * Middlewares para autenticação e autorização
 */

const jwt = require('jsonwebtoken');
// JWT_SECRET deve vir OBRIGATORIAMENTE do .env
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ [AUTH-MIDDLEWARE] ERRO FATAL: JWT_SECRET não definido no .env');
    process.exit(1);
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
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    // Administradores: role=admin OU emails específicos
    const adminEmails = [
        'andreia.lopes@aluforce.ind.br',
        'douglas.moreira@aluforce.ind.br',
        'ti@aluforce.ind.br'
    ];

    const isAdmin = req.user.role === 'admin' || adminEmails.includes(req.user.email);

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

module.exports = {
    authenticateToken,
    requireAdmin,
    checkPermission
};
