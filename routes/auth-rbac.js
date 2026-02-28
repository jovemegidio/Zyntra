/**
 * ============================================================
 * ALUFORCE - API de Autenticação e Permissões RBAC
 * Versão: 2.0
 * ============================================================
 * Sistema profissional de autenticação baseado em roles
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');

// Helper de log que também escreve em arquivo
const logToFile = (msg) => {
    const line = `${new Date().toISOString()} ${msg}`;
    console.log(msg);
    try {
        const logPath = require('path').join(__dirname, '..', 'auth-rbac.log');
        fs.appendFileSync(logPath, line + '\n');
    } catch(e) {}
};

// JWT_SECRET deve vir OBRIGATORIAMENTE do .env
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ [AUTH-RBAC] ERRO FATAL: JWT_SECRET não definido no .env');
    process.exit(1);
}
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const REFRESH_TOKEN_EXPIRES = 7 * 24 * 60 * 60 * 1000; // 7 dias

// Log de inicialização para confirmar carregamento
logToFile('[AUTH-RBAC] 🔐 Módulo carregado - JWT_SECRET: ' + JWT_SECRET.substring(0, 10) + '...');

/**
 * Middleware de autenticação JWT
 */
const authMiddleware = async (req, res, next) => {
    try {
        logToFile('[AUTH-RBAC] Middleware chamado para: ' + req.path);
        logToFile('[AUTH-RBAC] Headers auth: ' + (req.headers['authorization'] ? 'PRESENTE' : 'AUSENTE'));
        
        // Tentar pegar token de várias fontes
        const token = 
            req.cookies?.authToken ||
            req.headers['authorization']?.replace('Bearer ', '') ||
            req.query?.token;

        logToFile('[AUTH-RBAC] Token encontrado: ' + (token ? token.substring(0, 30) + '...' : 'NENHUM'));

        if (!token) {
            logToFile('[AUTH-RBAC] ERRO: Token não fornecido');
            return res.status(401).json({ 
                success: false, 
                message: 'Token de autenticação não fornecido',
                code: 'NO_TOKEN'
            });
        }

        logToFile('[AUTH-RBAC] Verificando token com JWT_SECRET...');
        const decoded = jwt.verify(token, JWT_SECRET);
        logToFile('[AUTH-RBAC] Token decodificado - ID: ' + decoded.id);
        
        // Buscar usuário atualizado do banco
        const pool = req.app.locals.pool || require('../database').getPool();
        logToFile('[AUTH-RBAC] Pool obtido, buscando usuário ID: ' + decoded.id);
        
        const [users] = await pool.query(
            'SELECT id, nome, email, role, is_admin, status, areas FROM usuarios WHERE id = ? AND status = "ativo"',
            [decoded.id]
        );

        logToFile('[AUTH-RBAC] Usuários encontrados: ' + users.length);

        if (!users.length) {
            logToFile('[AUTH-RBAC] ERRO: Usuário não encontrado ou inativo');
            return res.status(401).json({ 
                success: false, 
                message: 'Usuário não encontrado ou inativo',
                code: 'USER_NOT_FOUND'
            });
        }

        req.user = users[0];
        // O campo areas pode ser string JSON ou já um array (dependendo do driver MySQL)
        if (typeof req.user.areas === 'string') {
            try {
                req.user.areas = JSON.parse(req.user.areas);
            } catch (e) {
                // Se não for JSON válido, pode ser uma lista separada por vírgulas
                req.user.areas = req.user.areas.split(',').map(a => a.trim()).filter(a => a);
            }
        }
        req.user.areas = req.user.areas || [];
        logToFile('[AUTH-RBAC] Usuário autenticado: ' + req.user.nome);
        next();
    } catch (error) {
        logToFile('[AUTH-RBAC] ERRO no middleware: ' + error.name + ' - ' + error.message);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Token expirado',
                code: 'TOKEN_EXPIRED'
            });
        }
        return res.status(401).json({ 
            success: false, 
            message: 'Token inválido',
            code: 'INVALID_TOKEN'
        });
    }
};

/**
 * Middleware para verificar se é admin
 */
const adminOnly = (req, res, next) => {
    if (!req.user?.is_admin && req.user?.role !== 'admin') {
        return res.status(403).json({ 
            success: false, 
            message: 'Acesso negado. Requer privilégios de administrador.',
            code: 'ADMIN_REQUIRED'
        });
    }
    next();
};

/**
 * Middleware para verificar permissão de módulo
 */
const checkModuleAccess = (moduloCodigo, tipoPermissao = 'visualizar') => {
    return async (req, res, next) => {
        try {
            // Admins têm acesso total
            if (req.user?.is_admin) {
                return next();
            }

            const pool = req.app.locals.pool || require('./database').getPool();
            
            // Verificar permissão via procedure ou query direta
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
            `, [req.user.id, moduloCodigo, tipoPermissao, tipoPermissao, tipoPermissao, tipoPermissao, tipoPermissao]);

            if (!result[0]?.tem_permissao) {
                return res.status(403).json({ 
                    success: false, 
                    message: `Acesso negado ao módulo ${moduloCodigo}`,
                    code: 'MODULE_ACCESS_DENIED'
                });
            }

            next();
        } catch (error) {
            console.error('Erro ao verificar permissão:', error);
            next(error);
        }
    };
};

/**
 * Função para gerar token JWT
 */
const generateToken = (user) => {
    return jwt.sign(
        { 
            id: user.id, 
            email: user.email, 
            nome: user.nome,
            role: user.role,
            is_admin: user.is_admin 
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
};

/**
 * Função para gerar refresh token
 */
const generateRefreshToken = () => {
    return crypto.randomBytes(40).toString('hex');
};

/**
 * Função para registrar log de acesso
 */
const logAccess = async (pool, userId, acao, modulo, req, detalhes = null) => {
    try {
        await pool.query(`
            INSERT INTO log_acessos (usuario_id, acao, modulo, ip, user_agent, detalhes)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            userId,
            acao,
            modulo,
            req.ip || req.connection?.remoteAddress,
            req.headers['user-agent']?.substring(0, 500),
            detalhes ? JSON.stringify(detalhes) : null
        ]);
    } catch (error) {
        console.error('Erro ao registrar log:', error);
    }
};

// ============================================================
// ROTAS PÚBLICAS (SEM AUTENTICAÇÍO)
// ============================================================

/**
 * POST /api/auth/login
 * Realiza login do usuário
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const pool = req.app.locals.pool || require('../database').getPool();

        console.log('[RBAC LOGIN] Tentativa de login:', email);

        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email e senha são obrigatórios' 
            });
        }

        // Buscar usuário - query simplificada primeiro
        console.log('[RBAC LOGIN] Buscando usuário no banco...');
        const [users] = await pool.query(
            'SELECT * FROM usuarios WHERE email = ? LIMIT 1',
            [email.toLowerCase().trim()]
        );

        console.log('[RBAC LOGIN] Usuários encontrados:', users.length);

        if (!users.length) {
            await logAccess(pool, null, 'login_falha', null, req, { email, motivo: 'usuario_nao_encontrado' });
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciais inválidas' 
            });
        }

        const user = users[0];
        console.log('[RBAC LOGIN] Usuário:', user.nome, '- Status:', user.status, '- Admin:', user.is_admin);
        console.log('[RBAC LOGIN] Tem password_hash:', !!user.password_hash);
        console.log('[RBAC LOGIN] Tem senha_hash:', !!user.senha_hash);

        // Verificar status
        if (user.status === 'bloqueado') {
            await logAccess(pool, user.id, 'login_bloqueado', null, req);
            return res.status(403).json({ 
                success: false, 
                message: 'Conta bloqueada. Entre em contato com o administrador.',
                code: 'ACCOUNT_BLOCKED'
            });
        }

        if (user.status === 'inativo') {
            return res.status(403).json({ 
                success: false, 
                message: 'Conta inativa.',
                code: 'ACCOUNT_INACTIVE'
            });
        }

        // Verificar senha
        const senhaHash = user.password_hash || user.senha_hash || user.senha;
        
        console.log('[RBAC LOGIN] Hash para comparar:', senhaHash ? senhaHash.substring(0, 20) + '...' : 'NULL');
        
        if (!senhaHash) {
            await logAccess(pool, user.id, 'login_falha', null, req, { motivo: 'sem_senha_configurada' });
            return res.status(401).json({ 
                success: false, 
                message: 'Conta sem senha configurada. Solicite reset.' 
            });
        }
        
        let isValid = false;
        try {
            isValid = await bcrypt.compare(password, senhaHash);
            console.log('[RBAC LOGIN] Resultado bcrypt.compare:', isValid);
        } catch (e) {
            console.error('[RBAC LOGIN] Erro no bcrypt:', e.message);
        }

        if (!isValid) {
            await logAccess(pool, user.id, 'login_falha', null, req, { motivo: 'senha_incorreta' });
            return res.status(401).json({ 
                success: false, 
                message: 'Credenciais inválidas' 
            });
        }
        
        console.log('[RBAC LOGIN] ✅ Senha válida!');

        // Gerar tokens
        const token = generateToken(user);
        const refreshToken = generateRefreshToken();

        // Salvar sessão (opcional - tabela pode não existir)
        try {
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            await pool.query(`
                INSERT INTO sessoes_ativas (usuario_id, token_hash, ip, user_agent, expira_em)
                VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 8 HOUR))
            `, [user.id, tokenHash, req.ip, req.headers['user-agent']?.substring(0, 500)]);
        } catch (e) {
            console.log('[RBAC LOGIN] Aviso: Não foi possível salvar sessão:', e.message);
        }

        // Atualizar último login
        try {
            await pool.query(`
                UPDATE usuarios 
                SET ultimo_login = NOW(), login_count = COALESCE(login_count, 0) + 1 
                WHERE id = ?
            `, [user.id]);
        } catch (e) {
            console.log('[RBAC LOGIN] Aviso: Não foi possível atualizar ultimo_login:', e.message);
        }

        // Registrar log (opcional)
        await logAccess(pool, user.id, 'login_sucesso', null, req);

        // Montar áreas permitidas
        const areas = user.modulos_permitidos 
            ? user.modulos_permitidos.split(',').filter(Boolean)
            : [];

        // Se for admin, liberar todas as áreas
        const todasAreas = ['pcp', 'vendas', 'compras', 'financeiro', 'nfe', 'rh', 'faturamento', 'admin'];
        const areasPermitidas = user.is_admin ? todasAreas : areas;

        // Definir cookie HttpOnly
        res.cookie('authToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            maxAge: 8 * 60 * 60 * 1000, // 8 horas
            path: '/'
        });

        // Resposta
        const userResponse = {
            id: user.id,
            nome: user.nome,
            email: user.email,
            role: user.role,
            is_admin: Boolean(user.is_admin),
            areas: areasPermitidas,
            avatar: user.avatar || user.foto || '/avatars/default.webp',
            apelido: user.apelido,
            setor: user.setor
        };

        res.json({
            success: true,
            message: 'Login realizado com sucesso',
            token,
            user: userResponse,
            redirectTo: '/index.html'
        });

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro interno no servidor' 
        });
    }
});

/**
 * POST /api/auth/logout
 * Realiza logout do usuário
 */
router.post('/logout', authMiddleware, async (req, res) => {
    try {
        const pool = req.app.locals.pool || require('../database').getPool();
        const token = req.cookies?.authToken || req.headers['authorization']?.replace('Bearer ', '');
        
        if (token) {
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            await pool.query('UPDATE sessoes_ativas SET ativo = FALSE WHERE token_hash = ?', [tokenHash]);
        }

        await logAccess(pool, req.user.id, 'logout', null, req);

        res.clearCookie('authToken', { path: '/' });
        res.clearCookie('rememberToken', { path: '/' });
        
        res.json({ success: true, message: 'Logout realizado com sucesso' });
    } catch (error) {
        console.error('Erro no logout:', error);
        res.json({ success: true }); // Sempre sucesso no logout
    }
});

/**
 * GET /api/auth/me
 * Retorna dados do usuário autenticado
 */
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const pool = req.app.locals.pool || require('../database').getPool();

        // Buscar dados do usuário (simplificado - sem depender de tabelas RBAC)
        const [users] = await pool.query(`
            SELECT u.id, u.nome, u.email, u.role, u.is_admin, u.avatar, u.foto,
                   u.apelido, u.departamento, u.telefone, u.data_nascimento, u.bio,
                   u.ultimo_login, u.status, u.areas
            FROM usuarios u
            WHERE u.id = ?
        `, [req.user.id]);

        if (!users.length) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuário não encontrado' 
            });
        }

        const user = users[0];
        
        // Parse das áreas (pode ser string JSON, array, ou string separada por vírgulas)
        let areas = [];
        if (user.areas) {
            if (Array.isArray(user.areas)) {
                areas = user.areas;
            } else if (typeof user.areas === 'string') {
                try {
                    areas = JSON.parse(user.areas);
                } catch (e) {
                    areas = user.areas.split(',').map(a => a.trim()).filter(a => a);
                }
            }
        }
        
        // Se for admin, dar acesso a tudo
        const todasAreas = ['dashboard', 'pcp', 'vendas', 'compras', 'financeiro', 'nfe', 'rh', 'faturamento', 'admin'];
        if (user.is_admin) {
            areas = todasAreas;
        }

        res.json({
            id: user.id,
            nome: user.nome,
            email: user.email,
            role: user.role,
            is_admin: Boolean(user.is_admin),
            areas: areas,
            avatar: user.avatar || user.foto || '/avatars/default.webp',
            apelido: user.apelido,
            setor: user.departamento,
            telefone: user.telefone,
            bio: user.bio,
            ultimo_login: user.ultimo_login
        });
    } catch (error) {
        logToFile('[AUTH-RBAC] ERRO na rota /me: ' + error.message);
        console.error('Erro ao buscar usuário:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao buscar dados do usuário' 
        });
    }
});

/**
 * GET /api/auth/permissions
 * Retorna permissões detalhadas do usuário
 */
router.get('/permissions', authMiddleware, async (req, res) => {
    try {
        const pool = req.app.locals.pool || require('../database').getPool();

        // Se for admin, retorna todas as permissões
        if (req.user.is_admin) {
            const [modulos] = await pool.query('SELECT codigo, nome, url, icone, cor FROM modulos WHERE ativo = TRUE ORDER BY ordem');
            
            return res.json({
                success: true,
                is_admin: true,
                nivel: 100,
                permissions: {
                    useRBAC: true,
                    modules: modulos.reduce((acc, m) => {
                        acc[m.codigo] = {
                            pode_visualizar: true,
                            pode_criar: true,
                            pode_editar: true,
                            pode_excluir: true,
                            pode_aprovar: true
                        };
                        return acc;
                    }, {})
                },
                modulos: modulos.map(m => ({
                    ...m,
                    pode_visualizar: true,
                    pode_criar: true,
                    pode_editar: true,
                    pode_excluir: true,
                    pode_aprovar: true
                }))
            });
        }

        // Buscar permissões do usuário
        const [permissoes] = await pool.query(`
            SELECT DISTINCT
                m.codigo,
                m.nome,
                m.url,
                m.icone,
                m.cor,
                m.ordem,
                MAX(rm.pode_visualizar) as pode_visualizar,
                MAX(rm.pode_criar) as pode_criar,
                MAX(rm.pode_editar) as pode_editar,
                MAX(rm.pode_excluir) as pode_excluir,
                MAX(rm.pode_aprovar) as pode_aprovar
            FROM usuario_roles ur
            JOIN role_modulos rm ON ur.role_id = rm.role_id
            JOIN modulos m ON rm.modulo_id = m.id
            WHERE ur.usuario_id = ? AND m.ativo = TRUE
            GROUP BY m.id, m.codigo, m.nome, m.url, m.icone, m.cor, m.ordem
            ORDER BY m.ordem
        `, [req.user.id]);

        res.json({
            success: true,
            is_admin: false,
            permissions: {
                useRBAC: true,
                modules: permissoes.reduce((acc, p) => {
                    acc[p.codigo] = {
                        pode_visualizar: Boolean(p.pode_visualizar),
                        pode_criar: Boolean(p.pode_criar),
                        pode_editar: Boolean(p.pode_editar),
                        pode_excluir: Boolean(p.pode_excluir),
                        pode_aprovar: Boolean(p.pode_aprovar)
                    };
                    return acc;
                }, {})
            },
            modulos: permissoes.map(p => ({
                ...p,
                pode_visualizar: Boolean(p.pode_visualizar),
                pode_criar: Boolean(p.pode_criar),
                pode_editar: Boolean(p.pode_editar),
                pode_excluir: Boolean(p.pode_excluir),
                pode_aprovar: Boolean(p.pode_aprovar)
            }))
        });
    } catch (error) {
        console.error('Erro ao buscar permissões:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao buscar permissões' 
        });
    }
});

/**
 * POST /api/auth/check-access
 * Verifica se usuário tem acesso a um módulo específico
 */
router.post('/check-access', authMiddleware, async (req, res) => {
    try {
        const { modulo, acao = 'visualizar' } = req.body;
        
        if (!modulo) {
            return res.status(400).json({ 
                success: false, 
                message: 'Módulo é obrigatório' 
            });
        }

        // Admin tem acesso total
        if (req.user.is_admin) {
            return res.json({ 
                success: true, 
                tem_acesso: true,
                is_admin: true
            });
        }

        const pool = req.app.locals.pool || require('../database').getPool();

        const [result] = await pool.query(`
            SELECT COUNT(*) as tem_acesso
            FROM usuario_roles ur
            JOIN role_modulos rm ON ur.role_id = rm.role_id
            JOIN modulos m ON rm.modulo_id = m.id
            WHERE ur.usuario_id = ?
            AND m.codigo = ?
            AND (
                (? = 'visualizar' AND rm.pode_visualizar = TRUE) OR
                (? = 'criar' AND rm.pode_criar = TRUE) OR
                (? = 'editar' AND rm.pode_editar = TRUE) OR
                (? = 'excluir' AND rm.pode_excluir = TRUE) OR
                (? = 'aprovar' AND rm.pode_aprovar = TRUE)
            )
        `, [req.user.id, modulo, acao, acao, acao, acao, acao]);

        res.json({
            success: true,
            tem_acesso: result[0]?.tem_acesso > 0,
            modulo,
            acao
        });
    } catch (error) {
        console.error('Erro ao verificar acesso:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao verificar acesso' 
        });
    }
});

// ============================================================
// ROTAS DE ADMINISTRAÇÍO (REQUER ADMIN)
// ============================================================

/**
 * GET /api/auth/admin/users
 * Lista todos os usuários (admin only)
 */
router.get('/admin/users', authMiddleware, adminOnly, async (req, res) => {
    try {
        const pool = req.app.locals.pool || require('../database').getPool();
        const { page = 1, limit = 20, search, status, role } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (search) {
            whereClause += ' AND (u.nome LIKE ? OR u.email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        if (status) {
            whereClause += ' AND u.status = ?';
            params.push(status);
        }

        const [users] = await pool.query(`
            SELECT u.id, u.nome, u.email, u.role, u.is_admin, u.status,
                   u.avatar, u.setor, u.departamento, u.ultimo_login, u.created_at,
                   GROUP_CONCAT(DISTINCT r.nome) as roles,
                   GROUP_CONCAT(DISTINCT m.codigo) as modulos
            FROM usuarios u
            LEFT JOIN usuario_roles ur ON u.id = ur.usuario_id
            LEFT JOIN roles r ON ur.role_id = r.id
            LEFT JOIN role_modulos rm ON r.id = rm.role_id
            LEFT JOIN modulos m ON rm.modulo_id = m.id
            ${whereClause}
            GROUP BY u.id
            ORDER BY u.nome
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [countResult] = await pool.query(
            `SELECT COUNT(DISTINCT u.id) as total FROM usuarios u ${whereClause}`,
            params
        );

        res.json({
            success: true,
            users: users.map(u => ({
                ...u,
                is_admin: Boolean(u.is_admin),
                roles: u.roles ? u.roles.split(',') : [],
                modulos: u.modulos ? u.modulos.split(',').filter(Boolean) : []
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult[0].total,
                pages: Math.ceil(countResult[0].total / limit)
            }
        });
    } catch (error) {
        console.error('Erro ao listar usuários:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao listar usuários' 
        });
    }
});

/**
 * GET /api/auth/admin/roles
 * Lista todos os roles disponíveis
 */
router.get('/admin/roles', authMiddleware, adminOnly, async (req, res) => {
    try {
        const pool = req.app.locals.pool || require('../database').getPool();

        const [roles] = await pool.query(`
            SELECT r.*, COUNT(DISTINCT ur.usuario_id) as total_usuarios
            FROM roles r
            LEFT JOIN usuario_roles ur ON r.id = ur.role_id
            GROUP BY r.id
            ORDER BY r.nivel DESC
        `);

        res.json({
            success: true,
            roles
        });
    } catch (error) {
        console.error('Erro ao listar roles:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao listar roles' 
        });
    }
});

/**
 * GET /api/auth/admin/modulos
 * Lista todos os módulos
 */
router.get('/admin/modulos', authMiddleware, adminOnly, async (req, res) => {
    try {
        const pool = req.app.locals.pool || require('../database').getPool();

        const [modulos] = await pool.query(`
            SELECT * FROM modulos ORDER BY ordem
        `);

        res.json({
            success: true,
            modulos
        });
    } catch (error) {
        console.error('Erro ao listar módulos:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao listar módulos' 
        });
    }
});

/**
 * PUT /api/auth/admin/users/:id
 * Atualizar dados de um usuário existente
 */
router.put('/admin/users/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, email, senha, setor, is_admin, roles: roleIds } = req.body;
        const pool = req.app.locals.pool || require('../database').getPool();

        if (!nome || !email) {
            return res.status(400).json({
                success: false,
                message: 'Nome e email são obrigatórios'
            });
        }

        // Verificar se email já pertence a outro usuário
        const [existing] = await pool.query(
            'SELECT id FROM usuarios WHERE email = ? AND id != ?',
            [email.toLowerCase(), id]
        );
        if (existing.length) {
            return res.status(400).json({
                success: false,
                message: 'Email já cadastrado para outro usuário'
            });
        }

        // Montar UPDATE dinâmico
        const updates = ['nome = ?', 'email = ?', 'is_admin = ?'];
        const params = [nome, email.toLowerCase(), is_admin ? 1 : 0];

        if (setor) {
            updates.push('setor = ?');
            params.push(setor);
            updates.push('departamento = ?');
            params.push(setor);
        }

        if (senha) {
            const senhaHash = await bcrypt.hash(senha, 10);
            updates.push('senha_hash = ?');
            params.push(senhaHash);
        }

        params.push(id);
        await pool.query(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, params);

        // Atualizar roles se fornecidas
        if (roleIds && roleIds.length > 0) {
            await pool.query('DELETE FROM usuario_roles WHERE usuario_id = ?', [id]);
            const values = roleIds.map(roleId => [id, roleId, req.user.id]);
            await pool.query(
                'INSERT INTO usuario_roles (usuario_id, role_id, atribuido_por) VALUES ?',
                [values]
            );

            // Sync permissoes_modulos
            const [rolePermissions] = await pool.query(`
                SELECT DISTINCT m.codigo as modulo,
                    MAX(rm.pode_visualizar) as visualizar,
                    MAX(COALESCE(rm.pode_criar, 0)) as criar,
                    MAX(COALESCE(rm.pode_editar, 0)) as editar,
                    MAX(COALESCE(rm.pode_excluir, 0)) as excluir,
                    MAX(COALESCE(rm.pode_aprovar, 0)) as aprovar
                FROM usuario_roles ur
                JOIN role_modulos rm ON ur.role_id = rm.role_id
                JOIN modulos m ON rm.modulo_id = m.id
                WHERE ur.usuario_id = ?
                GROUP BY m.codigo
            `, [id]);

            await pool.query('DELETE FROM permissoes_modulos WHERE usuario_id = ?', [id]);
            for (const perm of rolePermissions) {
                await pool.query(`
                    INSERT INTO permissoes_modulos (usuario_id, modulo, visualizar, criar, editar, excluir, aprovar)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [id, perm.modulo, perm.visualizar, perm.criar, perm.editar, perm.excluir, perm.aprovar]);
            }

            // Limpar cache
            try {
                if (global._permCache) global._permCache.delete(parseInt(id));
                if (global._actionCache) {
                    for (const key of global._actionCache.keys()) {
                        if (key.startsWith(`${id}:`)) global._actionCache.delete(key);
                    }
                }
            } catch(e) {}
        }

        await logAccess(pool, req.user.id, 'editar_usuario', 'admin', req, { usuario_id: id, email });

        res.json({
            success: true,
            message: 'Usuário atualizado com sucesso'
        });
    } catch (error) {
        console.error('Erro ao atualizar usuário:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao atualizar usuário'
        });
    }
});

/**
 * PUT /api/auth/admin/users/:id/roles
 * Atualiza roles de um usuário
 */
router.put('/admin/users/:id/roles', authMiddleware, adminOnly, async (req, res) => {
    const connection = await (req.app.locals.pool || require('../database').getPool()).getConnection();
    
    try {
        const { id } = req.params;
        const { roles } = req.body; // Array de role_ids

        await connection.beginTransaction();

        // Remover roles anteriores
        await connection.query('DELETE FROM usuario_roles WHERE usuario_id = ?', [id]);

        // Adicionar novas roles
        if (roles && roles.length > 0) {
            const values = roles.map(roleId => [id, roleId, req.user.id]);
            await connection.query(
                'INSERT INTO usuario_roles (usuario_id, role_id, atribuido_por) VALUES ?',
                [values]
            );
        }

        // Atualizar cache de áreas no usuário
        const [modulos] = await connection.query(`
            SELECT GROUP_CONCAT(DISTINCT m.codigo) as areas
            FROM usuario_roles ur
            JOIN role_modulos rm ON ur.role_id = rm.role_id
            JOIN modulos m ON rm.modulo_id = m.id
            WHERE ur.usuario_id = ? AND rm.pode_visualizar = TRUE
        `, [id]);

        const areas = modulos[0]?.areas ? modulos[0].areas.split(',') : [];
        await connection.query(
            'UPDATE usuarios SET areas = ? WHERE id = ?',
            [JSON.stringify(areas), id]
        );

        // ============================================================
        // SYNC: Atualizar permissoes_modulos (tabela usada pelo authorizeArea)
        // Isso garante que mudanças no painel admin funcionem de fato
        // ============================================================
        try {
            // Buscar todas as permissões das roles atribuídas
            const [rolePermissions] = await connection.query(`
                SELECT DISTINCT m.codigo as modulo,
                    MAX(rm.pode_visualizar) as visualizar,
                    MAX(COALESCE(rm.pode_criar, 0)) as criar,
                    MAX(COALESCE(rm.pode_editar, 0)) as editar,
                    MAX(COALESCE(rm.pode_excluir, 0)) as excluir,
                    MAX(COALESCE(rm.pode_aprovar, 0)) as aprovar
                FROM usuario_roles ur
                JOIN role_modulos rm ON ur.role_id = rm.role_id
                JOIN modulos m ON rm.modulo_id = m.id
                WHERE ur.usuario_id = ?
                GROUP BY m.codigo
            `, [id]);

            // Remover permissões antigas do usuário
            await connection.query('DELETE FROM permissoes_modulos WHERE usuario_id = ?', [id]);

            // Inserir novas permissões baseadas nas roles
            if (rolePermissions.length > 0) {
                for (const perm of rolePermissions) {
                    await connection.query(`
                        INSERT INTO permissoes_modulos (usuario_id, modulo, visualizar, criar, editar, excluir, aprovar)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [id, perm.modulo, perm.visualizar, perm.criar, perm.editar, perm.excluir, perm.aprovar]);
                }
            }
            console.log(`[AUTH-RBAC] ✅ Sync permissoes_modulos para usuario ${id}: ${rolePermissions.length} módulos`);
        } catch (syncErr) {
            console.error('[AUTH-RBAC] ⚠️ Erro ao sincronizar permissoes_modulos:', syncErr.message);
            // Não falhar a operação principal por causa do sync
        }

        await connection.commit();

        // Limpar cache de permissões no server (se existir)
        try {
            if (global._permCache) global._permCache.delete(parseInt(id));
            if (global._actionCache) {
                for (const key of global._actionCache.keys()) {
                    if (key.startsWith(`${id}:`)) global._actionCache.delete(key);
                }
            }
        } catch(e) {}

        // Log
        const pool = req.app.locals.pool || require('../database').getPool();
        await logAccess(pool, req.user.id, 'atualizar_roles_usuario', 'admin', req, { usuario_id: id, roles });

        res.json({
            success: true,
            message: 'Roles atualizadas com sucesso',
            areas
        });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao atualizar roles:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao atualizar roles' 
        });
    } finally {
        connection.release();
    }
});

/**
 * PUT /api/auth/admin/users/:id/status
 * Atualiza status de um usuário (ativar/bloquear)
 */
router.put('/admin/users/:id/status', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const pool = req.app.locals.pool || require('../database').getPool();

        if (!['ativo', 'inativo', 'bloqueado'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Status inválido' 
            });
        }

        // Não pode alterar próprio status
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Não é possível alterar seu próprio status' 
            });
        }

        await pool.query('UPDATE usuarios SET status = ? WHERE id = ?', [status, id]);

        // Invalidar sessões se bloqueado
        if (status === 'bloqueado') {
            await pool.query('UPDATE sessoes_ativas SET ativo = FALSE WHERE usuario_id = ?', [id]);
        }

        await logAccess(pool, req.user.id, `usuario_${status}`, 'admin', req, { usuario_id: id });

        res.json({
            success: true,
            message: `Usuário ${status === 'bloqueado' ? 'bloqueado' : status === 'ativo' ? 'ativado' : 'desativado'} com sucesso`
        });
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao atualizar status' 
        });
    }
});

/**
 * POST /api/auth/admin/users
 * Criar novo usuário
 */
router.post('/admin/users', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { nome, email, senha, role, is_admin, setor, roles } = req.body;
        const pool = req.app.locals.pool || require('../database').getPool();

        // Validações
        if (!nome || !email || !senha) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nome, email e senha são obrigatórios' 
            });
        }

        // Verificar se email já existe
        const [existing] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [email.toLowerCase()]);
        if (existing.length) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email já cadastrado' 
            });
        }

        // Hash da senha
        const senhaHash = await bcrypt.hash(senha, 10);

        // Inserir usuário
        const [result] = await pool.query(`
            INSERT INTO usuarios (nome, email, senha_hash, role, is_admin, setor, departamento, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'ativo')
        `, [nome, email.toLowerCase(), senhaHash, role || 'usuario', is_admin ? 1 : 0, setor || null, setor || null]);

        const userId = result.insertId;

        // Atribuir roles se fornecidas
        if (roles && roles.length > 0) {
            const values = roles.map(roleId => [userId, roleId, req.user.id]);
            await pool.query(
                'INSERT INTO usuario_roles (usuario_id, role_id, atribuido_por) VALUES ?',
                [values]
            );

            // Sync permissoes_modulos para o novo usuário
            try {
                const [rolePermissions] = await pool.query(`
                    SELECT DISTINCT m.codigo as modulo,
                        MAX(rm.pode_visualizar) as visualizar,
                        MAX(COALESCE(rm.pode_criar, 0)) as criar,
                        MAX(COALESCE(rm.pode_editar, 0)) as editar,
                        MAX(COALESCE(rm.pode_excluir, 0)) as excluir,
                        MAX(COALESCE(rm.pode_aprovar, 0)) as aprovar
                    FROM usuario_roles ur
                    JOIN role_modulos rm ON ur.role_id = rm.role_id
                    JOIN modulos m ON rm.modulo_id = m.id
                    WHERE ur.usuario_id = ?
                    GROUP BY m.codigo
                `, [userId]);

                for (const perm of rolePermissions) {
                    await pool.query(`
                        INSERT INTO permissoes_modulos (usuario_id, modulo, visualizar, criar, editar, excluir, aprovar)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [userId, perm.modulo, perm.visualizar, perm.criar, perm.editar, perm.excluir, perm.aprovar]);
                }
                console.log(`[AUTH-RBAC] ✅ Sync permissoes_modulos para novo usuario ${userId}: ${rolePermissions.length} módulos`);
            } catch (syncErr) {
                console.error('[AUTH-RBAC] ⚠️ Erro ao sync permissoes_modulos:', syncErr.message);
            }
        }

        await logAccess(pool, req.user.id, 'criar_usuario', 'admin', req, { novo_usuario_id: userId, email });

        res.status(201).json({
            success: true,
            message: 'Usuário criado com sucesso',
            user: { id: userId, nome, email }
        });
    } catch (error) {
        console.error('Erro ao criar usuário:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao criar usuário' 
        });
    }
});

/**
 * GET /api/auth/admin/logs
 * Lista logs de acesso
 */
router.get('/admin/logs', authMiddleware, adminOnly, async (req, res) => {
    try {
        const pool = req.app.locals.pool || require('../database').getPool();
        const { page = 1, limit = 50, usuario_id, acao, modulo, data_inicio, data_fim } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (usuario_id) {
            whereClause += ' AND la.usuario_id = ?';
            params.push(usuario_id);
        }
        if (acao) {
            whereClause += ' AND la.acao LIKE ?';
            params.push(`%${acao}%`);
        }
        if (modulo) {
            whereClause += ' AND la.modulo = ?';
            params.push(modulo);
        }
        if (data_inicio) {
            whereClause += ' AND la.created_at >= ?';
            params.push(data_inicio);
        }
        if (data_fim) {
            whereClause += ' AND la.created_at <= ?';
            params.push(data_fim + ' 23:59:59');
        }

        const [logs] = await pool.query(`
            SELECT la.*, u.nome as usuario_nome, u.email as usuario_email
            FROM log_acessos la
            LEFT JOIN usuarios u ON la.usuario_id = u.id
            ${whereClause}
            ORDER BY la.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM log_acessos la ${whereClause}`,
            params
        );

        res.json({
            success: true,
            logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult[0].total,
                pages: Math.ceil(countResult[0].total / limit)
            }
        });
    } catch (error) {
        console.error('Erro ao listar logs:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao listar logs' 
        });
    }
});

// ============================================================
// GET /api/auth/admin/users/:id/permissions
// Retorna permissões granulares (módulos, páginas, funcionalidades)
// ============================================================
router.get('/admin/users/:id/permissions', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = req.app.locals.pool || require('../database').getPool();

        // 1) Permissões de módulo (permissoes_modulos)
        const [modPerms] = await pool.query(
            'SELECT modulo, visualizar, criar, editar, excluir, aprovar FROM permissoes_modulos WHERE usuario_id = ?',
            [id]
        );

        // 2) Permissões detalhadas (JSON) — tabela usuario_permissoes_detalhadas
        let detalhadas = {};
        try {
            const [rows] = await pool.query(
                'SELECT permissoes_json FROM usuario_permissoes_detalhadas WHERE usuario_id = ?',
                [id]
            );
            if (rows.length && rows[0].permissoes_json) {
                detalhadas = typeof rows[0].permissoes_json === 'string'
                    ? JSON.parse(rows[0].permissoes_json)
                    : rows[0].permissoes_json;
            }
        } catch (e) {
            // Tabela pode não existir ainda; reconstruir do permissoes_modulos
            console.log('[AUTH-RBAC] usuario_permissoes_detalhadas não encontrada, usando permissoes_modulos');
        }

        // 3) Mesclar: se detalhadas vazio, gerar a partir de modPerms
        const permissions = {};
        for (const mp of modPerms) {
            const existing = detalhadas[mp.modulo] || {};
            permissions[mp.modulo] = {
                visible: mp.visualizar === 1 || mp.visualizar === true,
                paginas: existing.paginas || {},
                funcionalidades: existing.funcionalidades || {}
            };
        }
        // Adicionar módulos que existem em detalhadas mas não em modPerms
        for (const [mk, mv] of Object.entries(detalhadas)) {
            if (!permissions[mk]) permissions[mk] = mv;
        }

        res.json({ success: true, permissions });
    } catch (error) {
        console.error('Erro ao obter permissões:', error);
        res.status(500).json({ success: false, message: 'Erro ao obter permissões' });
    }
});

// ============================================================
// PUT /api/auth/admin/users/:id/permissions
// Salva permissões granulares (módulos + páginas + funcionalidades)
// ============================================================
router.put('/admin/users/:id/permissions', authMiddleware, adminOnly, async (req, res) => {
    const pool = req.app.locals.pool || require('../database').getPool();
    const connection = await pool.getConnection();

    try {
        const { id } = req.params;
        const { permissions } = req.body; // { modulo_codigo: { visible, paginas:{...}, funcionalidades:{...} } }

        if (!permissions || typeof permissions !== 'object') {
            return res.status(400).json({ success: false, message: 'Permissões inválidas' });
        }

        await connection.beginTransaction();

        // 1) Atualizar permissoes_modulos (tabela que o middleware authorizeArea lê)
        await connection.query('DELETE FROM permissoes_modulos WHERE usuario_id = ?', [id]);

        for (const [modCode, modPerms] of Object.entries(permissions)) {
            if (!modPerms.visible) continue;

            // Determinar flags a partir das páginas (agregar: se qualquer página tem a ação, marcar como true)
            let visualizar = 1, criar = 0, editar = 0, excluir = 0, aprovar = 0;
            if (modPerms.paginas) {
                for (const pg of Object.values(modPerms.paginas)) {
                    if (pg.criar) criar = 1;
                    if (pg.editar) editar = 1;
                    if (pg.excluir) excluir = 1;
                    if (pg.aprovar) aprovar = 1;
                }
            }

            await connection.query(`
                INSERT INTO permissoes_modulos (usuario_id, modulo, visualizar, criar, editar, excluir, aprovar)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [id, modCode, visualizar, criar, editar, excluir, aprovar]);
        }

        // 2) Salvar permissões detalhadas (JSON) na tabela dedicada
        try {
            // Criar tabela se não existir
            await connection.query(`
                CREATE TABLE IF NOT EXISTS usuario_permissoes_detalhadas (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    usuario_id INT NOT NULL UNIQUE,
                    permissoes_json JSON,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    updated_by INT,
                    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
                )
            `);

            await connection.query(`
                INSERT INTO usuario_permissoes_detalhadas (usuario_id, permissoes_json, updated_by)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE permissoes_json = VALUES(permissoes_json), updated_by = VALUES(updated_by)
            `, [id, JSON.stringify(permissions), req.user.id]);
        } catch (e) {
            console.error('[AUTH-RBAC] Erro ao salvar permissões detalhadas:', e.message);
        }

        // 3) Atualizar campo areas do usuário
        const areasAtivas = Object.entries(permissions)
            .filter(([, v]) => v.visible)
            .map(([k]) => k);
        await connection.query('UPDATE usuarios SET areas = ? WHERE id = ?', [JSON.stringify(areasAtivas), id]);

        await connection.commit();

        // 4) Limpar caches
        try {
            if (global._permCache) global._permCache.delete(parseInt(id));
            if (global._actionCache) {
                for (const key of global._actionCache.keys()) {
                    if (key.startsWith(`${id}:`)) global._actionCache.delete(key);
                }
            }
        } catch(e) {}

        await logAccess(pool, req.user.id, 'atualizar_permissoes', 'admin', req, { usuario_id: id });

        res.json({ success: true, message: 'Permissões salvas com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao salvar permissões:', error);
        res.status(500).json({ success: false, message: 'Erro ao salvar permissões' });
    } finally {
        connection.release();
    }
});

// ============================================================
// GET /api/auth/admin/roles/:id/permissions
// Retorna permissões de um perfil (role_modulos JOIN modulos)
// ============================================================
router.get('/admin/roles/:id/permissions', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = req.app.locals.pool || require('../database').getPool();

        const [permissions] = await pool.query(`
            SELECT rm.*, m.codigo as modulo_codigo, m.nome as modulo_nome
            FROM role_modulos rm
            JOIN modulos m ON rm.modulo_id = m.id
            WHERE rm.role_id = ?
            ORDER BY m.ordem
        `, [id]);

        res.json({ success: true, permissions });
    } catch (error) {
        console.error('Erro ao obter permissões do role:', error);
        res.status(500).json({ success: false, message: 'Erro ao obter permissões do perfil' });
    }
});

// ============================================================
// PUT /api/auth/admin/roles/:id
// Atualiza dados e permissões de um perfil
// ============================================================
router.put('/admin/roles/:id', authMiddleware, adminOnly, async (req, res) => {
    const pool = req.app.locals.pool || require('../database').getPool();
    const connection = await pool.getConnection();

    try {
        const { id } = req.params;
        const { nome, codigo, nivel, cor, descricao, modulos } = req.body;

        await connection.beginTransaction();

        // Atualizar dados do role
        const updates = [];
        const params = [];
        if (nome) { updates.push('nome = ?'); params.push(nome); }
        if (codigo) { updates.push('codigo = ?'); params.push(codigo); }
        if (nivel !== undefined) { updates.push('nivel = ?'); params.push(nivel); }
        if (cor) { updates.push('cor = ?'); params.push(cor); }
        if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }

        if (updates.length) {
            params.push(id);
            await connection.query(`UPDATE roles SET ${updates.join(', ')} WHERE id = ?`, params);
        }

        // Atualizar permissões por módulo
        if (modulos && typeof modulos === 'object') {
            await connection.query('DELETE FROM role_modulos WHERE role_id = ?', [id]);

            for (const [modCodigo, perms] of Object.entries(modulos)) {
                // Buscar modulo_id pelo código
                const [mods] = await connection.query('SELECT id FROM modulos WHERE codigo = ?', [modCodigo]);
                if (!mods.length) continue;

                await connection.query(`
                    INSERT INTO role_modulos (role_id, modulo_id, pode_visualizar, pode_criar, pode_editar, pode_excluir, pode_aprovar)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [id, mods[0].id,
                    perms.visualizar ? 1 : 0,
                    perms.criar ? 1 : 0,
                    perms.editar ? 1 : 0,
                    perms.excluir ? 1 : 0,
                    perms.aprovar ? 1 : 0
                ]);
            }

            // Re-sincronizar permissões de TODOS os usuários que possuem esse role
            const [usersWithRole] = await connection.query(
                'SELECT DISTINCT usuario_id FROM usuario_roles WHERE role_id = ?', [id]
            );
            for (const { usuario_id } of usersWithRole) {
                const [rolePermissions] = await connection.query(`
                    SELECT DISTINCT m.codigo as modulo,
                        MAX(rm.pode_visualizar) as visualizar,
                        MAX(COALESCE(rm.pode_criar, 0)) as criar,
                        MAX(COALESCE(rm.pode_editar, 0)) as editar,
                        MAX(COALESCE(rm.pode_excluir, 0)) as excluir,
                        MAX(COALESCE(rm.pode_aprovar, 0)) as aprovar
                    FROM usuario_roles ur
                    JOIN role_modulos rm ON ur.role_id = rm.role_id
                    JOIN modulos m ON rm.modulo_id = m.id
                    WHERE ur.usuario_id = ?
                    GROUP BY m.codigo
                `, [usuario_id]);

                await connection.query('DELETE FROM permissoes_modulos WHERE usuario_id = ?', [usuario_id]);
                for (const perm of rolePermissions) {
                    await connection.query(`
                        INSERT INTO permissoes_modulos (usuario_id, modulo, visualizar, criar, editar, excluir, aprovar)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [usuario_id, perm.modulo, perm.visualizar, perm.criar, perm.editar, perm.excluir, perm.aprovar]);
                }
                // Clear cache
                try {
                    if (global._permCache) global._permCache.delete(usuario_id);
                    if (global._actionCache) {
                        for (const key of global._actionCache.keys()) {
                            if (key.startsWith(`${usuario_id}:`)) global._actionCache.delete(key);
                        }
                    }
                } catch(e) {}
            }
        }

        await connection.commit();
        await logAccess(pool, req.user.id, 'editar_role', 'admin', req, { role_id: id });

        res.json({ success: true, message: 'Perfil atualizado com sucesso' });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao atualizar role:', error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar perfil' });
    } finally {
        connection.release();
    }
});

// ============================================================
// POST /api/auth/admin/roles
// Cria um novo perfil
// ============================================================
router.post('/admin/roles', authMiddleware, adminOnly, async (req, res) => {
    const pool = req.app.locals.pool || require('../database').getPool();
    const connection = await pool.getConnection();

    try {
        const { nome, codigo, nivel, cor, descricao, modulos } = req.body;

        if (!nome || !codigo) {
            return res.status(400).json({ success: false, message: 'Nome e código são obrigatórios' });
        }

        await connection.beginTransaction();

        // Verificar duplicado
        const [existing] = await connection.query('SELECT id FROM roles WHERE codigo = ?', [codigo]);
        if (existing.length) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Já existe um perfil com esse código' });
        }

        const [result] = await connection.query(
            'INSERT INTO roles (nome, codigo, nivel, cor, descricao) VALUES (?, ?, ?, ?, ?)',
            [nome, codigo, nivel || 50, cor || '#3498db', descricao || '']
        );
        const roleId = result.insertId;

        // Inserir permissões de módulos
        if (modulos && typeof modulos === 'object') {
            for (const [modCodigo, perms] of Object.entries(modulos)) {
                const [mods] = await connection.query('SELECT id FROM modulos WHERE codigo = ?', [modCodigo]);
                if (!mods.length) continue;
                await connection.query(`
                    INSERT INTO role_modulos (role_id, modulo_id, pode_visualizar, pode_criar, pode_editar, pode_excluir, pode_aprovar)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [roleId, mods[0].id,
                    perms.visualizar ? 1 : 0,
                    perms.criar ? 1 : 0,
                    perms.editar ? 1 : 0,
                    perms.excluir ? 1 : 0,
                    perms.aprovar ? 1 : 0
                ]);
            }
        }

        await connection.commit();
        await logAccess(pool, req.user.id, 'criar_role', 'admin', req, { role_id: roleId, nome });

        res.status(201).json({ success: true, message: 'Perfil criado com sucesso', id: roleId });
    } catch (error) {
        await connection.rollback();
        console.error('Erro ao criar role:', error);
        res.status(500).json({ success: false, message: 'Erro ao criar perfil' });
    } finally {
        connection.release();
    }
});

// ============================================================
// PUT /api/auth/admin/modulos/:id
// Atualiza dados de um módulo
// ============================================================
router.put('/admin/modulos/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, icone, cor, descricao, url, ativo, ordem } = req.body;
        const pool = req.app.locals.pool || require('../database').getPool();

        const updates = [];
        const params = [];
        if (nome !== undefined) { updates.push('nome = ?'); params.push(nome); }
        if (icone !== undefined) { updates.push('icone = ?'); params.push(icone); }
        if (cor !== undefined) { updates.push('cor = ?'); params.push(cor); }
        if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }
        if (url !== undefined) { updates.push('url = ?'); params.push(url); }
        if (ativo !== undefined) { updates.push('ativo = ?'); params.push(ativo ? 1 : 0); }
        if (ordem !== undefined) { updates.push('ordem = ?'); params.push(ordem); }

        if (!updates.length) {
            return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
        }

        params.push(id);
        await pool.query(`UPDATE modulos SET ${updates.join(', ')} WHERE id = ?`, params);

        await logAccess(pool, req.user.id, 'editar_modulo', 'admin', req, { modulo_id: id });

        res.json({ success: true, message: 'Módulo atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar módulo:', error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar módulo' });
    }
});

// ============================================================
// POST /api/auth/admin/modulos
// Cria um novo módulo
// ============================================================
router.post('/admin/modulos', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { nome, codigo, icone, cor, descricao, url, ativo, ordem } = req.body;
        const pool = req.app.locals.pool || require('../database').getPool();

        if (!nome) {
            return res.status(400).json({ success: false, message: 'Nome é obrigatório' });
        }

        const cod = codigo || nome.toLowerCase().replace(/[^a-z0-9]/g, '_');

        // Verificar duplicado
        const [existing] = await pool.query('SELECT id FROM modulos WHERE codigo = ?', [cod]);
        if (existing.length) {
            return res.status(400).json({ success: false, message: 'Já existe um módulo com esse código' });
        }

        const [result] = await pool.query(
            'INSERT INTO modulos (nome, codigo, icone, cor, descricao, url, ativo, ordem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [nome, cod, icone || 'fa-cube', cor || '#3498db', descricao || '', url || '', ativo !== undefined ? (ativo ? 1 : 0) : 1, ordem || 99]
        );

        await logAccess(pool, req.user.id, 'criar_modulo', 'admin', req, { modulo_id: result.insertId, nome });

        res.status(201).json({ success: true, message: 'Módulo criado com sucesso', id: result.insertId });
    } catch (error) {
        console.error('Erro ao criar módulo:', error);
        res.status(500).json({ success: false, message: 'Erro ao criar módulo' });
    }
});

// ============================================================
// PUT /api/auth/admin/users/:id/2fa — Ativar/Desativar 2FA de um usuário
// ============================================================
router.put('/admin/users/:id/2fa', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { disabled } = req.body; // true = desabilitar, false = habilitar
        const pool = req.app.locals.pool || require('../database').getPool();

        // Garantir que a coluna existe (MySQL compatível)
        try {
            const [cols] = await pool.query("SHOW COLUMNS FROM usuarios LIKE 'two_factor_disabled'");
            if (cols.length === 0) {
                await pool.query('ALTER TABLE usuarios ADD COLUMN two_factor_disabled TINYINT(1) DEFAULT 0');
            }
        } catch (e) {
            // Coluna já existe ou erro de sintaxe — ignorar
        }

        await pool.query(
            'UPDATE usuarios SET two_factor_disabled = ? WHERE id = ?',
            [disabled ? 1 : 0, id]
        );

        // Limpar dispositivos confiáveis se estiver reativando 2FA
        if (!disabled) {
            try {
                await pool.query('DELETE FROM auth_trusted_devices WHERE usuario_id = ?', [id]);
            } catch (e) {
                // Tabela pode não existir
            }
        }

        await logAccess(pool, req.user.id, disabled ? 'desativar_2fa' : 'ativar_2fa', 'admin', req, { usuario_id: id });

        res.json({
            success: true,
            message: disabled ? '2FA desabilitado para o usuário' : '2FA reabilitado para o usuário'
        });
    } catch (error) {
        console.error('Erro ao alterar 2FA:', error);
        res.status(500).json({ success: false, message: 'Erro ao alterar configuração 2FA' });
    }
});

// GET /api/auth/admin/users/:id/2fa — Verificar status 2FA do usuário
router.get('/admin/users/:id/2fa', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = req.app.locals.pool || require('../database').getPool();

        // Garantir que a coluna existe (MySQL compatível)
        try {
            const [cols] = await pool.query("SHOW COLUMNS FROM usuarios LIKE 'two_factor_disabled'");
            if (cols.length === 0) {
                await pool.query('ALTER TABLE usuarios ADD COLUMN two_factor_disabled TINYINT(1) DEFAULT 0');
            }
        } catch (e) {}

        const [rows] = await pool.query(
            'SELECT email, two_factor_disabled FROM usuarios WHERE id = ?', [id]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
        }

        const user = rows[0];
        const email = (user.email || '').toLowerCase().trim();

        // Whitelist de 2FA (mesma do auth.js)
        const twoFA_whitelist = [
            'ti@aluforce.ind.br', 'pcp@aluforce.ind.br', 'rh@aluforce.ind.br',
            'augusto.santos@aluforce.ind.br', 'vendas4@aluforce.ind.br',
            'financeiro2@aluforce.ind.br', 'financeiro3@aluforce.ind.br',
            'adm@aluforce.ind.br', 'compras@aluforce.ind.br', 'aluforce@aluforce.ind.br',
            'qavendas@aluforce.ind.br', 'qapcp@aluforce.ind.br', 'qarh@aluforce.ind.br',
            'qacompras@aluforce.ind.br', 'qanfe@aluforce.ind.br', 'qapainel@aluforce.ind.br'
        ];

        const isInWhitelist = twoFA_whitelist.includes(email);
        const isDisabled = user.two_factor_disabled === 1;

        // Contar dispositivos confiáveis
        let trustedDevices = 0;
        try {
            const [td] = await pool.query(
                'SELECT COUNT(*) as cnt FROM auth_trusted_devices WHERE usuario_id = ? AND expira_em > NOW()', [id]
            );
            trustedDevices = td[0]?.cnt || 0;
        } catch (e) {}

        res.json({
            success: true,
            twoFA: {
                eligible: isInWhitelist,
                disabled: isDisabled,
                active: isInWhitelist && !isDisabled,
                trustedDevices
            }
        });
    } catch (error) {
        console.error('Erro ao verificar 2FA:', error);
        res.status(500).json({ success: false, message: 'Erro ao verificar 2FA' });
    }
});

// Exportar
module.exports = {
    router,
    authMiddleware,
    adminOnly,
    checkModuleAccess,
    generateToken,
    logAccess
};
