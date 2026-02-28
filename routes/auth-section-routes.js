/**
 * AUTH SECTION ROUTES - Extracted from server.js (Lines 19747-21279)
 * LGPD mount, login fallback, page serving, password reset, admin funcionarios
 * @module routes/auth-section-routes
 */
const express = require('express');
const path = require('path');
let logger;
try { logger = require('../src/logger'); } catch(_) { logger = console; }
const userPermissions = require('../src/permissions-server');

module.exports = function createAuthSectionRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeAdmin, writeAuditLog, jwt, JWT_SECRET, app } = deps;
    const router = express.Router();

    // ⚡ Cache functions — importadas diretamente do serviço de cache
    let cacheGet, cacheSet, CACHE_CONFIG;
    try {
        const cacheService = require('../services/cache');
        cacheGet = cacheService.cacheGet;
        cacheSet = cacheService.cacheSet;
        CACHE_CONFIG = cacheService.CACHE_CONFIG;
    } catch (_) {
        // Fallback: funções noop se o serviço de cache não estiver disponível
        cacheGet = async () => null;
        cacheSet = async () => {};
        CACHE_CONFIG = { userSession: 60000, default: 30000 };
    }

    // --- Standard requires for extracted routes ---
    const { body, param, query, validationResult } = require('express-validator');
    const path = require('path');
    const multer = require('multer');
    const fs = require('fs');
    const upload = multer({ dest: path.join(__dirname, '..', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 } });
    const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    const validate = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: 'Dados inválidos', errors: errors.array() });
        next();
    };
    // LGPD router require
    let createLGPDRouter;
    try { createLGPDRouter = require('./lgpd').createLGPDRouter; } catch(_) {}

    // AUDIT-FIX R-17/R-18/R-19/R-20: Rotas LGPD compliance
    try {
        if (createLGPDRouter) {
            const lgpdRouter = createLGPDRouter(pool, authenticateToken);
            router.use('/lgpd', lgpdRouter);
            console.log('[LGPD] Rotas de compliance montadas em /api/lgpd');
        }
    } catch (lgpdErr) {
        console.error('[LGPD] ERRO ao montar rotas LGPD:', lgpdErr.message);
    }
    
    // =================================================================
    // 6. ROTAS PARA SERVIR PÁGINAS HTML E LOGIN (se houver)
    // =================================================================
    
    // --- ROTA DE LOGIN / AUTH (API) ---
    // NOTA: A rota principal de login é gerenciada pelo authRouter (src/routes/auth.js)
    // montado em router.use('/api', authRouter) no início do arquivo.
    // A rota abaixo é mantida como FALLBACK caso o authRouter não processe a requisição.
    // Em operação normal, o authRouter captura /api/login primeiro.
    
    // ============================================================================
    // ENDPOINTS TEMPORÁRIOS REMOVIDOS - USAR SCRIPT EM /scripts/update_permissions.js
    // ============================================================================
    // SISTEMA DE LOGIN - ENDPOINT FALLBACK (authRouter é o principal)
    // ============================================================================
    
    // Rota de login fallback (só executa se authRouter não capturar)
    router.post('/login', /* authLimiter, */ async (req, res) => {
        logger.warn('[SERVER/LOGIN-FALLBACK] Rota de login fallback atingida - authRouter pode não estar funcionando');
        try {
            const { email, password } = req.body;
    
            if (!email || !password) {
                return res.status(400).json({ message: 'Email e senha são obrigatórios.' });
            }
    
            // Buscar usuário na tabela usuarios primeiro
            const [rows] = await pool.query('SELECT * FROM usuarios WHERE email = ? LIMIT 1', [email]);
            let user = (rows && rows.length) ? rows[0] : null;
    
            // Verificar se usuário está inativo (por status OU por campo ativo)
            if (user && (
                (user.status && user.status.toLowerCase() === 'inativo') ||
                (user.ativo !== undefined && user.ativo === 0)
            )) {
                return res.status(403).json({ message: 'Sua conta está inativa. Entre em contato com o administrador.' });
            }
    
            // Se não encontrado em usuarios, tentar na tabela funcionarios
            if (!user) {
                try {
                    const [frows] = await pool.query('SELECT * FROM funcionarios WHERE email = ? LIMIT 1', [email]);
                    if (frows && frows.length) {
                        const f = frows[0];
    
                        // Converter role para is_admin (tabela funcionarios não tem is_admin)
                        const roleAdmin = (f.role === 'admin' || f.role === 'administrador');
    
                        // Verificar se funcionário está inativo
                        if (f.status && f.status.toLowerCase() === 'inativo') {
                            return res.status(403).json({ message: 'Sua conta está inativa. Entre em contato com o administrador.' });
                        }
    
                        user = {
                            id: f.id,
                            nome: f.nome_completo || f.nome || null,
                            email: f.email,
                            role: f.role || 'funcionario',
                            is_admin: roleAdmin ? 1 : 0,
                            senha_hash: f.password_hash || f.senha_hash || null,
                            senha: f.senha || null
                        };
                    }
                } catch (e) {
                    logger.error('[LOGIN] Erro ao buscar funcionario:', e);
                }
            }
    
            if (!user) {
                return res.status(401).json({ message: 'Credenciais inválidas.' });
            }
    
            // Verificar senha
            let senhaValida = false;
    
            // Tentar bcrypt primeiro se houver hash
            if (user.senha_hash) {
                try {
                    const bcrypt = require('bcryptjs');
                    senhaValida = await bcrypt.compare(password, user.senha_hash);
                } catch (e) {
                    logger.error('[LOGIN] Erro bcrypt:', e);
                }
            }
    
            // SECURITY FIX: Plaintext password fallback REMOVIDO (Due Diligence 2026-02-15)
            // Se o usuário ainda tem senha em texto plano, forçar reset via bcrypt
            if (!senhaValida && user.senha && !user.senha_hash) {
                // Migrar automaticamente para bcrypt na próxima tentativa válida
                try {
                    const isPlaintext = !user.senha.startsWith('$2a$') && !user.senha.startsWith('$2b$');
                    if (isPlaintext) {
                        const bcryptCheck = require('bcryptjs');
                        // Comparar com texto plano para migração única
                        if (user.senha === password) {
                            const newHash = await bcryptCheck.hash(password, 12);
                            await pool.query('UPDATE usuarios SET senha_hash = ?, password_hash = ? WHERE id = ?', [newHash, newHash, user.id]);
                            logger.warn(`[SECURITY] Usuário ${user.id} migrado de texto plano para bcrypt.`);
                            senhaValida = true;
                        }
                    }
                } catch (migErr) {
                    logger.error('[SECURITY] Erro na migração de senha:', migErr);
                }
            }
    
            if (!senhaValida) {
                return res.status(401).json({ message: 'Credenciais inválidas.' });
            }
    
            // 🔒 MULTI-DEVICE: Gerar deviceId único para cada dispositivo
            // Isso garante que cada login em cada dispositivo tem sua própria sessão
            const deviceId = uuidv4();
    
            // Gerar JWT token com deviceId para isolamento de sessão
            const tokenPayload = {
                id: user.id,
                nome: user.nome,
                email: user.email,
                role: user.role || 'user',
                is_admin: user.is_admin || 0,
                deviceId: deviceId // CRITICAL: Identificador único do dispositivo
            };
    
            // AUDIT-FIX ARCH-004: Added algorithm HS256 + audience claim
            const token = jwt.sign(tokenPayload, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '8h' });
    
            // Definir cookie httpOnly - secure=true para HTTPS (produção)
            const isSecure = req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production' || req.secure;
            res.cookie('authToken', token, {
                httpOnly: true,
                secure: isSecure,
                sameSite: isSecure ? 'none' : 'lax', // 'none' para cross-site com HTTPS
                maxAge: 8 * 60 * 60 * 1000, // 8 horas
                path: '/'
            });
    
            console.log(`✅ Login bem-sucedido: ${user.email} | Secure Cookie: ${isSecure}`);
    
            // Resposta de sucesso - inclui token e deviceId para multi-dispositivo
            res.json({
                message: 'Login realizado com sucesso',
                token: token, // Token JWT para localStorage (compatibilidade com módulos que usam Bearer token)
                deviceId: deviceId, // 🔒 MULTI-DEVICE: ID único deste dispositivo
                user: {
                    id: user.id,
                    nome: user.nome,
                    email: user.email,
                    role: user.role,
                    is_admin: user.is_admin
                },
                redirectTo: '/dashboard'
            });
    
        } catch (error) {
            console.error('Erro no login:', error);
            res.status(500).json({ message: 'Erro interno do servidor.' });
        }
    });
    
    // ============================================================================
    // FIM DO SISTEMA DE LOGIN
    // ============================================================================
    
    // ============================================================================
    // SISTEMA DE AUDIT LOG - HISTÓRICO DE ALTERAÇÕES
    // ============================================================================
    
    // Armazenamento em memória (pode migrar para banco de dados depois)
    let auditLogs = [];
    
    /**
     * Função para registrar uma ação no audit log
     * @param {Object} logData - Dados do log
     */
    function registrarAuditLog(logData) {
        const log = {
            id: Date.now(),
            usuario: logData.usuario || 'Sistema',
            usuarioId: logData.usuarioId || null,
            acao: logData.acao || 'Ação',
            modulo: logData.modulo || 'Sistema',
            descricao: logData.descricao || '',
            dados: logData.dados || null,
            ip: logData.ip || null,
            data: new Date().toISOString()
        };
    
        auditLogs.unshift(log); // Adiciona no início
    
        // Limita a 1000 registros em memória
        if (auditLogs.length > 1000) {
            auditLogs = auditLogs.slice(0, 1000);
        }
    
        return log;
    }
    
    // Expõe a função globalmente
    global.registrarAuditLog = registrarAuditLog;
    
    // GET /api/audit-log - Listar logs de auditoria
    // SECURITY: Requer autenticação e privilégios de administrador
    router.get('/audit-log', authenticateToken, authorizeAdmin, (req, res) => {
        try {
            const { limite = 50, modulo, usuario, acao, dataInicio, dataFim } = req.query;
    
            let logs = [...auditLogs];
    
            // Filtros
            if (modulo) {
                logs = logs.filter(l => l.modulo.toLowerCase() === modulo.toLowerCase());
            }
    
            if (usuario) {
                logs = logs.filter(l => l.usuario.toLowerCase().includes(usuario.toLowerCase()));
            }
    
            if (acao) {
                logs = logs.filter(l => l.acao.toLowerCase() === acao.toLowerCase());
            }
    
            if (dataInicio) {
                const inicio = new Date(dataInicio);
                logs = logs.filter(l => new Date(l.data) >= inicio);
            }
    
            if (dataFim) {
                const fim = new Date(dataFim);
                logs = logs.filter(l => new Date(l.data) <= fim);
            }
    
            // Limita resultado
            const resultado = logs.slice(0, parseInt(limite));
    
            res.json({
                success: true,
                logs: resultado,
                total: auditLogs.length,
                filtrados: logs.length
            });
        } catch (error) {
            console.error('Erro ao buscar logs:', error);
            res.status(500).json({ success: false, message: 'Erro ao buscar logs' });
        }
    });
    
    // POST /api/audit-log - Registrar nova entrada
    // SECURITY: Requer autenticação para registrar logs
    router.post('/audit-log', authenticateToken, (req, res) => {
        try {
            const { usuario, usuarioId, acao, modulo, descricao, dados } = req.body;
    
            const log = registrarAuditLog({
                usuario,
                usuarioId,
                acao,
                modulo,
                descricao,
                dados,
                ip: req.ip || req.connection?.remoteAddress
            });
    
            res.json({ success: true, log });
        } catch (error) {
            console.error('Erro ao registrar log:', error);
            res.status(500).json({ success: false, message: 'Erro ao registrar log' });
        }
    });
    
    // Adiciona alguns logs de exemplo na inicialização
    setTimeout(() => {
        registrarAuditLog({
            usuario: 'Sistema',
            acao: 'Iniciou',
            modulo: 'Sistema',
            descricao: 'Sistema Aluforce iniciado com sucesso'
        });
    }, 1000);
    
    // ============================================================================
    // FIM DO SISTEMA DE AUDIT LOG
    // ============================================================================
    
    // Endpoint para o front-end verificar se está autenticado via cookie
    // ⚡ OTIMIZADO COM CACHE EM MEMÓRIA - MULTI-DEVICE SAFE
    // 🔐 v6.0: Prioridade = Authorization header > cookie (isolamento por aba)
    router.get('/me', authenticateToken, async (req, res) => {
        // 🔐 v6.0: Usar mesma prioridade do middleware: header PRIMEIRO, cookie depois
        // Isso garante que cada aba usa SEU próprio token (do sessionStorage → header)
        const authHeader = req.headers['authorization'];
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const ht = authHeader.split(' ')[1];
            if (ht && ht !== 'null' && ht !== 'undefined') token = ht;
        }
        if (!token) token = req.cookies?.authToken;
    
        if (!token) {
            return res.status(401).json({ message: 'Não autenticado' });
        }
    
        // 🔐 MULTI-DEVICE: Decodificar token para obter userId e deviceId
        let tokenData = null;
        try {
            tokenData = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            return res.status(401).json({ message: 'Token inválido' });
        }
    
        // ⚡ MULTI-DEVICE: Cache key agora usa userId + deviceId para isolamento
        // Isso garante que cada dispositivo tem seu próprio cache de sessão
        const cacheKey = tokenData.deviceId
            ? `user_session_${tokenData.id}_${tokenData.deviceId}`
            : `user_session_${token.substring(0, 32)}`; // Fallback para tokens antigos
    
        const cachedUser = await cacheGet(cacheKey);
        if (cachedUser) {
            // Adicionar deviceId na resposta para o frontend saber qual dispositivo é
            return res.json({ ...cachedUser, deviceId: tokenData.deviceId });
        }
    
    
        try {
            const user = tokenData;
    
            // Buscar dados completos do usuário no banco (tentar usuarios primeiro, depois funcionarios)
            let dbUser = null;
            try {
                // Buscar usuario com possível foto e dados do funcionario vinculado por email
                const [rows] = await pool.query(
                    `SELECT u.id, u.nome, u.email, u.role, u.is_admin, u.setor,
                            u.apelido, u.telefone, u.data_nascimento, u.bio, u.departamento,
                            u.permissoes_pcp, u.permissoes_rh, u.permissoes_vendas,
                            u.permissoes_compras, u.permissoes_financeiro, u.permissoes_nfe,
                            u.areas,
                            u.foto, u.avatar,
                            f.foto_perfil_url as foto_funcionario,
                            f.cargo as cargo,
                            f.departamento as departamento_func,
                            f.data_admissao as data_admissao,
                            f.id as matricula
                     FROM usuarios u
                     LEFT JOIN funcionarios f ON u.email = f.email
                     WHERE u.id = ?`,
                    [user.id]
                );
                dbUser = rows && rows[0] ? rows[0] : null;
    
                // Se não encontrou em usuarios, buscar em funcionarios
                if (!dbUser) {
                    const [frows] = await pool.query(
                        `SELECT id, nome_completo as nome, email, role, foto_perfil_url as avatar,
                                cargo, departamento, data_admissao, id as matricula
                         FROM funcionarios WHERE id = ?`,
                        [user.id]
                    );
                    const func = frows && frows[0] ? frows[0] : null;
                    if (func) {
                        // Converter role para is_admin
                        const roleAdmin = (func.role === 'admin' || func.role === 'administrador');
                        dbUser = {
                            id: func.id,
                            nome: func.nome,
                            email: func.email,
                            role: func.role || 'funcionario',
                            is_admin: roleAdmin ? 1 : 0,
                            avatar: func.avatar || "/avatars/default.webp",
                            cargo: func.cargo,
                            departamento: func.departamento,
                            data_admissao: func.data_admissao,
                            matricula: func.matricula,
                            // Funcionários não têm permissões granulares, apenas role
                            permissoes_pcp: null,
                            permissoes_rh: null,
                            permissoes_vendas: null,
                            permissoes_compras: null,
                            permissoes_financeiro: null,
                            permissoes_nfe: null
                        };
                    }
                }
    
                if (dbUser) {
                    // Função helper para parse seguro de permissões
                    function parsePermissao(perm) {
                        if (!perm) return [];
                        if (Array.isArray(perm)) return perm;
                        if (typeof perm === 'object') {
                            // MySQL pode retornar JSON como objeto diretamente
                            return Array.isArray(perm) ? perm : Object.values(perm);
                        }
                        if (typeof perm === 'string') {
                            // Se contém vírgulas, dividir em array
                            if (perm.includes(',')) {
                                return perm.split(',').map(p => p.trim()).filter(p => p.length > 0);
                            }
                            try {
                                const parsed = JSON.parse(perm);
                                return Array.isArray(parsed) ? parsed : [];
                            } catch (e) {
                                // Se não é JSON, pode ser string simples como "rh" ou "vendas"
                                return perm.trim() ? [perm.trim()] : [];
                            }
                        }
                        return [];
                    }
    
                    // Parse permissões de forma segura
                    let permissoes_pcp = parsePermissao(dbUser.permissoes_pcp);
                    let permissoes_rh = parsePermissao(dbUser.permissoes_rh);
                    let permissoes_vendas = parsePermissao(dbUser.permissoes_vendas);
                    let permissoes_compras = parsePermissao(dbUser.permissoes_compras);
                    let permissoes_financeiro = parsePermissao(dbUser.permissoes_financeiro);
                    let permissoes_nfe = parsePermissao(dbUser.permissoes_nfe);
    
                    // Combinar todas as permissões para "areas" - priorizar coluna areas se existir
                    let areasUsuario = parsePermissao(dbUser.areas);
    
                    // Se não tem areas definidas, usar as permissões combinadas
                    if (areasUsuario.length === 0) {
                        areasUsuario = [
                            ...permissoes_pcp.length > 0 ? ['pcp'] : [],
                            ...permissoes_rh.length > 0 ? ['rh'] : [],
                            ...permissoes_vendas.length > 0 ? ['vendas'] : [],
                            ...permissoes_compras.length > 0 ? ['compras'] : [],
                            ...permissoes_financeiro.length > 0 ? ['financeiro'] : [],
                            ...permissoes_nfe.length > 0 ? ['nfe'] : []
                        ];
                    }
    
                    // Fallback final: usar permissions-server.js se DB não tem dados
                    if (areasUsuario.length === 0) {
                        let fn = 'unknown';
                        if (dbUser.nome) fn = dbUser.nome.split(' ')[0].toLowerCase();
                        else if (dbUser.email) fn = dbUser.email.split('@')[0].split('.')[0].toLowerCase();
                        const serverAreas = userPermissions.getUserAreas(fn);
                        if (serverAreas && serverAreas.length > 0) {
                            areasUsuario = serverAreas;
                            console.log(`[API/ME] Fallback para permissions-server: ${fn} => [${areasUsuario.join(',')}]`);
                        }
                    }
    
                    // Determinar a foto do usuário (prioridade: avatar > foto > foto_funcionario)
                    const fotoUsuario = dbUser.avatar || dbUser.foto || dbUser.foto_funcionario || "/avatars/default.webp";
    
                    // Formatar data de admissão
                    let dataAdmissaoFormatada = null;
                    if (dbUser.data_admissao) {
                        const d = new Date(dbUser.data_admissao);
                        dataAdmissaoFormatada = d.toLocaleDateString('pt-BR');
                    }
    
                    // Formatar matrícula com zeros à esquerda
                    let matriculaFormatada = null;
                    if (dbUser.matricula) {
                        matriculaFormatada = String(dbUser.matricula).padStart(5, '0');
                    }
    
                    // Determinar o role/perfil do usuário
                    const userRole = dbUser.role || user.role || 'user';
    
                    const response = {
                        id: dbUser.id,
                        nome: dbUser.nome,
                        email: dbUser.email,
                        role: userRole,
                        perfil: userRole, // Alias para compatibilidade com PCP
                        setor: dbUser.setor || null, // Buscar setor do banco de dados
                        apelido: dbUser.apelido,
                        telefone: dbUser.telefone,
                        data_nascimento: dbUser.data_nascimento,
                        bio: dbUser.bio,
                        departamento: dbUser.departamento_func || dbUser.departamento,
                        cargo: dbUser.cargo,
                        data_admissao: dataAdmissaoFormatada,
                        matricula: matriculaFormatada,
                        avatar: fotoUsuario,
                        foto: fotoUsuario,
                        foto_perfil_url: fotoUsuario,
                        is_admin: dbUser.is_admin,
                        rh_admin: false,
                        permissoes: areasUsuario,
                        permissoes_pcp: permissoes_pcp,
                        permissoes_rh: permissoes_rh,
                        permissoes_vendas: permissoes_vendas,
                        permissoes_compras: permissoes_compras,
                        permissoes_financeiro: permissoes_financeiro,
                        permissoes_nfe: permissoes_nfe,
                        areas: areasUsuario,
                        // Permissões granulares por módulo
                        permissoes_granulares: (() => {
                            try {
                                let fn = 'unknown';
                                if (dbUser.nome) fn = dbUser.nome.split(' ')[0].toLowerCase();
                                else if (dbUser.email) fn = dbUser.email.split('@')[0].split('.')[0].toLowerCase();
                                return userPermissions.getUserAllPermissions(fn);
                            } catch(e) { return {}; }
                        })(),
                        perfil_permissao: (() => {
                            try {
                                let fn = 'unknown';
                                if (dbUser.nome) fn = dbUser.nome.split(' ')[0].toLowerCase();
                                else if (dbUser.email) fn = dbUser.email.split('@')[0].split('.')[0].toLowerCase();
                                return userPermissions.getUserProfile(fn);
                            } catch(e) { return null; }
                        })()
                    };
    
                    // ⚡ Salvar no cache por 1 minuto
                    await cacheSet(cacheKey, response, CACHE_CONFIG.userSession);
    
                    // 🔐 MULTI-DEVICE: Incluir deviceId na resposta
                    return res.json({ ...response, deviceId: tokenData.deviceId });
                }
            } catch (dbErr) {
                console.error('[API/ME] Erro ao buscar usuário no banco:', dbErr);
            }
    
            // Fallback: retornar dados do token com deviceId
            return res.json({
                id: user.id,
                nome: user.nome,
                email: user.email,
                role: user.role,
                is_admin: user.is_admin || 0,
                deviceId: tokenData.deviceId
            });
        } catch (err) {
            console.log('[API/ME] Falha ao verificar JWT:', err.message);
            return res.status(401).json({ message: 'Token inválido' });
        }
    });
    
    // ============================================================================
    
    // ============================================================================
    // API DE PERMISSÕES GRANULARES - CRUD para admin gerenciar permissões
    // ============================================================================
    
    // GET /api/permissions/profiles - Listar perfis disponíveis
    router.get('/permissions/profiles', authenticateToken, (req, res) => {
        const profiles = {};
        for (const [key, profile] of Object.entries(userPermissions.PERMISSION_PROFILES)) {
            profiles[key] = {
                id: key,
                label: profile.label,
                description: profile.description,
                areas: profile.areas
            };
        }
        res.json(profiles);
    });
    
    // GET /api/permissions/actions - Listar todas as ações possíveis por módulo
    router.get('/permissions/actions', authenticateToken, (req, res) => {
        res.json(userPermissions.MODULE_ACTIONS);
    });
    
    // GET /api/permissions/user/:userId - Obter permissões de um usuário
    router.get('/permissions/user/:userId', authenticateToken, async (req, res) => {
        try {
            const isAdmin = req.user.role === 'admin' || req.user.is_admin === 1 || req.user.is_admin === true;
            if (!isAdmin && req.user.id !== parseInt(req.params.userId)) {
                return res.status(403).json({ message: 'Acesso negado' });
            }
    
            const [rows] = await pool.query(
                'SELECT id, nome, email, role, is_admin FROM usuarios WHERE id = ?',
                [req.params.userId]
            );
            if (!rows.length) return res.status(404).json({ message: 'Usuário não encontrado' });
    
            const user = rows[0];
            const firstName = user.nome ? user.nome.split(' ')[0].toLowerCase() : '';
            const emailPrefix = user.email ? user.email.split('@')[0].split('.')[0].toLowerCase() : '';
            const lookupName = firstName || emailPrefix;
    
            const userData = userPermissions.getUserData(lookupName);
            const profile = userPermissions.getUserProfile(lookupName);
            const allPermissions = userPermissions.getUserAllPermissions(lookupName, user.role);
            const areas = userPermissions.getUserAreas(lookupName);
    
            res.json({
                user: { id: user.id, nome: user.nome, email: user.email, role: user.role, is_admin: user.is_admin },
                lookupName,
                areas,
                profile: profile ? { id: profile.id, label: profile.label, description: profile.description } : null,
                hasCustomPermissions: !!(userData && userData.customPermissions),
                permissions: allPermissions
            });
        } catch (err) {
            console.error('[PERMISSIONS] Erro ao buscar permissões:', err);
            res.status(500).json({ message: 'Erro interno' });
        }
    });
    
    // GET /api/permissions/users - Listar todos os usuários com suas permissões
    router.get('/permissions/users', authenticateToken, async (req, res) => {
        try {
            const isAdmin = req.user.role === 'admin' || req.user.is_admin === 1 || req.user.is_admin === true;
            if (!isAdmin) return res.status(403).json({ message: 'Acesso restrito a administradores' });
    
            const [rows] = await pool.query(
                `SELECT id, nome, email, role, is_admin, ativo, status
                 FROM usuarios WHERE status != 'inativo' OR status IS NULL
                 ORDER BY nome`
            );
    
            const users = rows.map(user => {
                const firstName = user.nome ? user.nome.split(' ')[0].toLowerCase() : '';
                const emailPrefix = user.email ? user.email.split('@')[0].split('.')[0].toLowerCase() : '';
                const lookupName = firstName || emailPrefix;
    
                const profile = userPermissions.getUserProfile(lookupName);
                const areas = userPermissions.getUserAreas(lookupName);
                const allPerms = userPermissions.getUserAllPermissions(lookupName, user.role);
    
                return {
                    id: user.id,
                    nome: user.nome,
                    email: user.email,
                    role: user.role,
                    is_admin: user.is_admin,
                    ativo: user.ativo,
                    lookupName,
                    areas,
                    profile: profile ? { id: profile.id, label: profile.label } : null,
                    permissionCount: Object.values(allPerms).reduce((sum, arr) => sum + arr.length, 0)
                };
            });
    
            res.json(users);
        } catch (err) {
            console.error('[PERMISSIONS] Erro ao listar usuários:', err);
            res.status(500).json({ message: 'Erro interno' });
        }
    });
    
    // POST /api/permissions/check - Verificar se o usuário atual tem uma permissão
    router.post('/permissions/check', authenticateToken, (req, res) => {
        const { module, action } = req.body;
        if (!module || !action) return res.status(400).json({ message: 'module e action são obrigatórios' });
    
        let firstName = 'unknown';
        if (req.user.nome) firstName = req.user.nome.split(' ')[0].toLowerCase();
        else if (req.user.email) firstName = req.user.email.split('@')[0].split('.')[0].toLowerCase();
    
        const allowed = userPermissions.hasPermission(firstName, module, action, req.user.role);
        res.json({ allowed, module, action });
    });
    
    // GET /api/permissions/me - Obter todas as permissões do usuário logado
    router.get('/permissions/me', authenticateToken, (req, res) => {
        let firstName = 'unknown';
        if (req.user.nome) firstName = req.user.nome.split(' ')[0].toLowerCase();
        else if (req.user.email) firstName = req.user.email.split('@')[0].split('.')[0].toLowerCase();
    
        const profile = userPermissions.getUserProfile(firstName);
        const allPerms = userPermissions.getUserAllPermissions(firstName, req.user.role);
        const areas = userPermissions.getUserAreas(firstName);
    
        res.json({
            areas,
            profile: profile ? { id: profile.id, label: profile.label, description: profile.description } : null,
            permissions: allPerms,
            actions_catalog: userPermissions.MODULE_ACTIONS
        });
    });
    
    // PUT /api/permissions/user/:userId - Salvar permissões de um usuário
    router.put('/permissions/user/:userId', authenticateToken, async (req, res) => {
        try {
            const isAdmin = req.user.role === 'admin' || req.user.is_admin === 1 || req.user.is_admin === true;
            if (!isAdmin) return res.status(403).json({ message: 'Acesso restrito a administradores' });
    
            const userId = parseInt(req.params.userId);
            const { profile, areas, permissions } = req.body;
    
            if (!areas || !Array.isArray(areas)) {
                return res.status(400).json({ message: 'Áreas são obrigatórias' });
            }
    
            const [rows] = await pool.query('SELECT id, nome, email, role FROM usuarios WHERE id = ?', [userId]);
            if (!rows.length) return res.status(404).json({ message: 'Usuário não encontrado' });
            const user = rows[0];
            const firstName = user.nome ? user.nome.split(' ')[0].toLowerCase() : '';
    
            const permissoesJson = JSON.stringify(permissions || {});
            const areasJson = JSON.stringify(areas);
            await pool.query(
                `UPDATE usuarios SET
                    permissoes_custom = ?,
                    areas = ?,
                    permissoes_vendas = ?,
                    permissoes_rh = ?,
                    permissoes_pcp = ?,
                    permissoes_compras = ?,
                    permissoes_financeiro = ?,
                    permissoes_nfe = ?
                WHERE id = ?`,
                [
                    permissoesJson,
                    areasJson,
                    JSON.stringify(permissions?.vendas || []),
                    JSON.stringify(permissions?.rh || []),
                    JSON.stringify(permissions?.pcp || []),
                    JSON.stringify(permissions?.compras || []),
                    JSON.stringify(permissions?.financeiro || []),
                    JSON.stringify(permissions?.nfe || []),
                    userId
                ]
            );
    
            if (firstName && userPermissions.userPermissions) {
                const userData = userPermissions.userPermissions[firstName];
                if (userData) {
                    userData.areas = areas;
                    userData.profile = profile || null;
                    userData.customPermissions = permissions || null;
                } else {
                    userPermissions.userPermissions[firstName] = {
                        areas: areas,
                        rhType: areas.includes('rh') ? 'area' : 'area',
                        profile: profile || null,
                        customPermissions: permissions || null
                    };
                }
            }
    
            console.log(`[PERMISSIONS] Permissoes atualizadas - User: ${user.nome} (ID:${userId}), Profile: ${profile || 'custom'}, Areas: [${areas.join(',')}], Admin: ${req.user.nome}`);
    
            res.json({
                message: 'Permissoes salvas com sucesso',
                userId: userId,
                profile: profile,
                areas: areas,
                permissionCount: Object.values(permissions || {}).reduce((sum, arr) => Array.isArray(arr) ? sum + arr.length : sum, 0)
            });
        } catch (err) {
            console.error('[PERMISSIONS] Erro ao salvar permissoes:', err);
            res.status(500).json({ message: 'Erro interno ao salvar permissoes' });
        }
    });
    
    // ROTA PAGINA DE PERMISSOES (Admin only)
    router.get('/admin/permissoes', authenticatePage, (req, res) => {
        // Admin check removido - client-side handles auth via API
        // Se não tiver token, a página JS vai redirecionar para login
        const isAdmin = req.user && (req.user.role === 'admin' || req.user.is_admin == 1);
        if (!req.user || isAdmin) {
            res.sendFile(path.join(__dirname, '..', 'modules', 'Admin', 'public', 'pages', 'permissoes.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Apenas administradores podem acessar esta página.</p>');
        }
    });
    
    // ALIAS /api/auth/me → redireciona para /api/me (compatibilidade com módulos)
    // Alguns módulos (Compras, Admin) usam /api/auth/me em vez de /api/me
    // ============================================================================
    router.get('/auth/me', authenticateToken, async (req, res) => {
        // 🔐 v6.0: Usar mesma prioridade do middleware: header PRIMEIRO, cookie depois
        const authHeader = req.headers['authorization'];
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const ht = authHeader.split(' ')[1];
            if (ht && ht !== 'null' && ht !== 'undefined') token = ht;
        }
        if (!token) token = req.cookies?.authToken;
        if (!token) {
            return res.status(401).json({ message: 'Não autenticado' });
        }
    
        let tokenData;
        try {
            tokenData = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            return res.status(401).json({ message: 'Token inválido' });
        }
    
        // Cache key com deviceId
        const cacheKey = tokenData.deviceId
            ? `user_session_${tokenData.id}_${tokenData.deviceId}`
            : `user_session_${token.substring(0, 32)}`;
    
        const cachedUser = await cacheGet(cacheKey);
        if (cachedUser) {
            return res.json({ ...cachedUser, deviceId: tokenData.deviceId });
        }
    
        try {
            const [rows] = await pool.query(
                `SELECT u.id, u.nome, u.email, u.role, u.is_admin, u.setor,
                        u.apelido, u.telefone, u.avatar, u.foto,
                        u.permissoes_pcp, u.permissoes_rh, u.permissoes_vendas,
                        u.permissoes_compras, u.permissoes_financeiro, u.permissoes_nfe,
                        u.areas,
                        f.foto_perfil_url as foto_funcionario,
                        f.cargo, f.departamento as departamento_func
                 FROM usuarios u
                 LEFT JOIN funcionarios f ON u.email = f.email
                 WHERE u.id = ?`,
                [tokenData.id]
            );
    
            if (rows && rows[0]) {
                const dbUser = rows[0];
                const fotoUsuario = dbUser.avatar || dbUser.foto || dbUser.foto_funcionario || "/avatars/default.webp";
                const response = {
                    id: dbUser.id,
                    nome: dbUser.nome,
                    email: dbUser.email,
                    role: dbUser.role || tokenData.role || 'user',
                    setor: dbUser.setor,
                    is_admin: dbUser.is_admin,
                    avatar: fotoUsuario,
                    foto: fotoUsuario,
                    cargo: dbUser.cargo,
                    departamento: dbUser.departamento_func || dbUser.departamento,
                    areas: dbUser.areas ? (typeof dbUser.areas === 'string' ? JSON.parse(dbUser.areas) : dbUser.areas) : [],
                    deviceId: tokenData.deviceId
                };
                await cacheSet(cacheKey, response, 60000);
                return res.json(response);
            }
    
            // Fallback
            return res.json({
                id: tokenData.id,
                nome: tokenData.nome,
                email: tokenData.email,
                role: tokenData.role,
                is_admin: tokenData.is_admin || 0,
                deviceId: tokenData.deviceId
            });
        } catch (dbErr) {
            console.error('[API/AUTH/ME] Erro ao buscar usuário:', dbErr.message);
            return res.json({
                id: tokenData.id,
                nome: tokenData.nome,
                email: tokenData.email,
                role: tokenData.role,
                is_admin: tokenData.is_admin || 0,
                deviceId: tokenData.deviceId
            });
        }
    });
    
    // Alias para /api/usuario/atual (compatibilidade com Vendas)
    // 🔐 v6.0: Prioridade = Authorization header > cookie
    router.get('/usuario/atual', authenticateToken, async (req, res) => {
        const authHeader = req.headers['authorization'];
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const ht = authHeader.split(' ')[1];
            if (ht && ht !== 'null' && ht !== 'undefined') token = ht;
        }
        if (!token) token = req.cookies?.authToken;
        if (!token) {
            return res.status(401).json({ message: 'Não autenticado' });
        }
        try {
            const user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            // Buscar dados do usuário no banco com JOIN para foto do funcionário
            const [rows] = await pool.query(
                `SELECT u.id, u.nome, u.email, u.role, u.is_admin,
                        u.foto, u.avatar,
                        f.foto_perfil_url as foto_funcionario
                 FROM usuarios u
                 LEFT JOIN funcionarios f ON u.email = f.email
                 WHERE u.id = ?`,
                [user.id]
            );
            if (rows && rows[0]) {
                const dbUser = rows[0];
                const fotoUsuario = dbUser.avatar || dbUser.foto || dbUser.foto_funcionario || "/avatars/default.webp";
                return res.json({
                    ...dbUser,
                    avatar: fotoUsuario,
                    foto: fotoUsuario,
                    foto_perfil_url: fotoUsuario
                });
            }
            // Fallback para dados do token
            return res.json({ id: user.id, nome: user.nome, email: user.email, role: user.role });
        } catch (err) {
            return res.status(401).json({ message: 'Token inválido' });
        }
    });
    
    // Endpoint para obter permissões do usuário
    // 🔐 v6.0: Prioridade = Authorization header > cookie
    router.get('/permissions', (req, res) => {
        const authHeader = req.headers['authorization'];
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const ht = authHeader.split(' ')[1];
            if (ht && ht !== 'null' && ht !== 'undefined') token = ht;
        }
        if (!token) token = req.cookies?.authToken;
        if (!token) return res.status(401).json({ message: 'Não autenticado' });
    
        try {
            const user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            const firstName = user.nome ? user.nome.split(' ')[0].toLowerCase() : '';
            const emailPrefix = user.email ? user.email.split('@')[0].toLowerCase() : '';
    
            const permissions = {
                areas: userPermissions.getUserAreas(firstName) || userPermissions.getUserAreas(emailPrefix),
                rhType: userPermissions.getRHType(firstName) || userPermissions.getRHType(emailPrefix),
                isAdmin: userPermissions.isAdmin(firstName) || userPermissions.isAdmin(emailPrefix)
            };
    
            return res.json(permissions);
        } catch (err) {
            return res.status(401).json({ message: 'Token inválido' });
        }
    });
    
    // Atualizar perfil do usuário (nome, apelido, telefone, bio, etc.) - aceita token via cookie ou Authorization header
    // 🔐 v6.0: Prioridade = Authorization header > cookie
    router.put('/me', authenticateToken, async (req, res) => {
        const authHeader = req.headers['authorization'];
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const ht = authHeader.split(' ')[1];
            if (ht && ht !== 'null' && ht !== 'undefined') token = ht;
        }
        if (!token) token = req.cookies?.authToken;
        if (!token) return res.status(401).json({ message: 'Não autenticado' });
        try {
            const user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            const { nome, apelido, telefone, data_nascimento, bio } = req.body || {};
    
            // Validação básica
            if (nome && nome.trim() === '') {
                return res.status(400).json({ error: 'Nome completo não pode ser vazio' });
            }
    
            // Limpar apelido se for string vazia
            const apelidoFinal = (apelido && apelido.trim() !== '') ? apelido.trim() : null;
    
            // Em modo DEV_MOCK, apenas retorna objeto atualizado sem persistir
            if (process.env.DEV_MOCK === '1' || process.env.DEV_MOCK === 'true') {
                const updated = Object.assign({}, user);
                if (nome) updated.nome = nome;
                updated.apelido = apelidoFinal;
                if (telefone) updated.telefone = telefone;
                if (data_nascimento) updated.data_nascimento = data_nascimento;
                if (bio) updated.bio = bio;
                return res.json({ user: updated });
            }
    
            // Em produção, atualiza na tabela usuarios
            const updates = [];
            const params = [];
    
            if (nome) { updates.push('nome = ?'); params.push(nome); }
            updates.push('apelido = ?');
            params.push(apelidoFinal);
            if (telefone !== undefined) { updates.push('telefone = ?'); params.push(telefone || null); }
            if (data_nascimento !== undefined) { updates.push('data_nascimento = ?'); params.push(data_nascimento || null); }
            if (bio !== undefined) { updates.push('bio = ?'); params.push(bio || null); }
    
            if (updates.length > 0) {
                params.push(user.id);
                const sql = `UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`;
                console.log('[API/ME PUT] 📝 Atualizando usuário:', user.email);
                await pool.query(sql, params);
            }
    
            // Buscar usuário atualizado com todas as informações
            const [[updatedUser]] = await pool.query(
                `SELECT id, nome, email, role, is_admin, apelido, telefone, data_nascimento,
                        bio, avatar, departamento,
                        permissoes_pcp, permissoes_vendas, permissoes_rh,
                        permissoes_compras, permissoes_financeiro, permissoes_nfe
                 FROM usuarios WHERE id = ?`,
                [user.id]
            );
    
            // Parse permissões de forma segura
            function parsePermissao(perm) {
                if (!perm) return [];
                if (Array.isArray(perm)) return perm;
                if (typeof perm === 'string') {
                    try {
                        const parsed = JSON.parse(perm);
                        return Array.isArray(parsed) ? parsed : [];
                    } catch (e) {
                        return perm.trim() ? [perm.trim()] : [];
                    }
                }
                return [];
            }
    
            let permissoes_pcp = parsePermissao(updatedUser.permissoes_pcp);
            let permissoes_rh = parsePermissao(updatedUser.permissoes_rh);
            let permissoes_vendas = parsePermissao(updatedUser.permissoes_vendas);
            let permissoes_compras = parsePermissao(updatedUser.permissoes_compras);
            let permissoes_financeiro = parsePermissao(updatedUser.permissoes_financeiro);
            let permissoes_nfe = parsePermissao(updatedUser.permissoes_nfe);
    
            let permissoes = [
                ...permissoes_pcp,
                ...permissoes_rh,
                ...permissoes_vendas,
                ...permissoes_compras,
                ...permissoes_financeiro,
                ...permissoes_nfe
            ];
    
            const response = {
                user: {
                    id: updatedUser.id,
                    nome: updatedUser.nome,
                    email: updatedUser.email,
                    role: updatedUser.role,
                    setor: null,
                    apelido: updatedUser.apelido,
                    telefone: updatedUser.telefone,
                    data_nascimento: updatedUser.data_nascimento,
                    bio: updatedUser.bio,
                    avatar: updatedUser.avatar || "/avatars/default.webp",
                    departamento: updatedUser.departamento,
                    is_admin: updatedUser.is_admin,
                    rh_admin: false,
                    permissoes: permissoes,
                    permissoes_pcp: permissoes_pcp,
                    permissoes_rh: permissoes_rh,
                    permissoes_vendas: permissoes_vendas,
                    permissoes_compras: permissoes_compras,
                    permissoes_financeiro: permissoes_financeiro,
                    permissoes_nfe: permissoes_nfe,
                    areas: permissoes
                }
            };
    
            console.log('[API/ME PUT] ✅ Perfil atualizado:', user.email);
    
            console.log('[API/ME PUT] ✅ Perfil atualizado com sucesso. Apelido:', apelidoFinal);
    
            return res.json(response);
        } catch (err) {
            console.error('Erro em PUT /api/me:', err && err.stack ? err.stack : err);
            return res.status(500).json({ message: 'Erro ao atualizar perfil' });
        }
    });
    
    // Upload de Avatar do Usuário
    const avatarStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            const avatarDir = process.platform !== 'win32'
                ? '/var/www/uploads/avatars'
                : path.join(__dirname, '..', 'public', 'avatars');
            if (!fs.existsSync(avatarDir)) {
                fs.mkdirSync(avatarDir, { recursive: true });
            }
            cb(null, avatarDir);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            const filename = `user-${req.userId}${ext}`;
            cb(null, filename);
        }
    });
    
    const avatarFilter = (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de arquivo inválido. Use JPG, PNG, GIF ou WEBP.'), false);
        }
    };
    
    const uploadAvatar = multer({
        storage: avatarStorage,
        fileFilter: avatarFilter,
        limits: {
            fileSize: 2 * 1024 * 1024 // 2MB
        }
    });
    
    router.post('/upload-avatar', (req, res, next) => {
        // 🔐 v6.0: header PRIMEIRO, cookie depois
        const authHeader = req.headers['authorization'];
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const ht = authHeader.split(' ')[1];
            if (ht && ht !== 'null' && ht !== 'undefined') token = ht;
        }
        if (!token) token = req.cookies?.authToken;
        if (!token) {
            return res.status(401).json({ error: 'Não autenticado' });
        }
    
        try {
            const user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            req.userId = user.id;
            req.userEmail = user.email;
            next();
        } catch (err) {
            return res.status(401).json({ error: 'Token inválido' });
        }
    }, uploadAvatar.single('avatar'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'Nenhum arquivo enviado' });
            }
    
            const avatarUrl = `/avatars/${req.file.filename}`;
    
            // Atualizar banco de dados com o caminho do avatar - salvar em ambas colunas
            try {
                await pool.query(
                    'UPDATE usuarios SET avatar = ?, foto = ? WHERE id = ?',
                    [avatarUrl, avatarUrl, req.userId]
                );
                console.log(`[AVATAR] Banco atualizado: avatar e foto = ${avatarUrl} para usuário ${req.userId}`);
            } catch (dbErr) {
                console.error('Erro ao atualizar avatar no banco:', dbErr);
                // Continua mesmo se falhar no DB, pois o arquivo já foi salvo
            }
    
            console.log(`[AVATAR] Upload bem-sucedido para usuário ${req.userEmail}: ${avatarUrl}`);
    
            res.json({
                success: true,
                avatarUrl: avatarUrl,
                message: 'Avatar atualizado com sucesso'
            });
    
        } catch (error) {
            console.error('Erro ao fazer upload do avatar:', error);
            res.status(500).json({ error: 'Erro ao fazer upload do avatar' });
        }
    });
    
    // ============================================================
    // ENDPOINTS DE RESET DE SENHA
    // ============================================================
    
    // Endpoint para solicitar reset de senha
    router.post('/auth/forgot-password', async (req, res) => {
        const { email } = req.body;
    
        if (!email || !email.trim()) {
            return res.status(400).json({ message: 'Email é obrigatório' });
        }
    
        try {
            // Verificar se o email existe na tabela usuarios ou funcionarios
            let userExists = false;
            let userName = '';
    
            // Verificar na tabela usuarios
            const [usuarios] = await pool.query('SELECT nome_completo, email FROM usuarios WHERE email = ?', [email]);
            if (usuarios && usuarios.length > 0) {
                userExists = true;
                userName = usuarios[0].nome_completo;
            } else {
                // Verificar na tabela funcionarios
                const [funcionarios] = await pool.query('SELECT nome_completo, email FROM funcionarios WHERE email = ?', [email]);
                if (funcionarios && funcionarios.length > 0) {
                    userExists = true;
                    userName = funcionarios[0].nome_completo;
                }
            }
    
            // Por segurança, sempre retornar sucesso mesmo que o email não exista
            // Isso evita que atacantes descubram quais emails estão cadastrados
            if (!userExists) {
                console.log(`[RESET] Tentativa de reset para email não cadastrado: ${email}`);
                return res.json({
                    message: 'Se o email estiver cadastrado, você receberá um link para redefinir sua senha.'
                });
            }
    
            // Gerar token único
            const crypto = require('crypto');
            const token = crypto.randomBytes(32).toString('hex');
    
            // Token expira em 30 minutos
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + 30);
    
            // Salvar token no banco
            await pool.query(
                'INSERT INTO password_reset_tokens (email, token, expira_em) VALUES (?, ?, ?)',
                [email, token, expiresAt]
            );
    
            // Gerar link de reset
            const resetLink = `http://localhost:${PORT}/reset-password.html?token=${token}`;
    
            // Enviar email
            try {
                await enviarEmail(
                    email,
                    'Redefinição de Senha - Sistema ALUFORCE',
                    `Olá ${userName},\n\nRecebemos uma solicitação para redefinir sua senha.\n\nClique no link abaixo para criar uma nova senha:\n${resetLink}\n\nEste link expira em 30 minutos.\n\nSe você não solicitou esta redefinição, ignore este email.\n\nAtenciosamente,\nEquipe ALUFORCE`,
                    `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #333;">Redefinição de Senha</h2>
                            <p>Olá <strong>${userName}</strong>,</p>
                            <p>Recebemos uma solicitação para redefinir sua senha no Sistema ALUFORCE.</p>
                            <p>Clique no botão abaixo para criar uma nova senha:</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="${resetLink}" style="background-color: #4CAF50; color: white; padding: 14px 28px; text-decoration: none; border-radius: 4px; display: inline-block;">Redefinir Senha</a>
                            </div>
                            <p style="color: #666; font-size: 14px;">Ou copie e cole este link no seu navegador:</p>
                            <p style="background-color: #f5f5f5; padding: 10px; border-radius: 4px; word-break: break-all; font-size: 12px;">${resetLink}</p>
                            <p style="color: #999; font-size: 12px; margin-top: 30px;">
                                ⏰ Este link expira em <strong>30 minutos</strong>.<br>
                                🔒 Se você não solicitou esta redefinição, ignore este email com segurança.
                            </p>
                            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                            <p style="color: #999; font-size: 12px; text-align: center;">
                                Atenciosamente,<br>
                                <strong>Equipe ALUFORCE</strong>
                            </p>
                        </div>
                    `
                );
                console.log(`[RESET] ✅ Email de reset enviado para: ${email}`);
            } catch (emailErr) {
                console.error('[RESET] ❌ Erro ao enviar email:', emailErr);
                // Mesmo que o email falhe, retornar sucesso (o token foi criado)
                // Em produção, você pode querer logar isso e tentar reenviar
            }
    
            return res.json({
                message: 'Se o email estiver cadastrado, você receberá um link para redefinir sua senha.',
                success: true
            });
    
        } catch (err) {
            console.error('[RESET] Erro ao processar solicitação:', err);
    
            // Verificar se é erro de tabela não existente
            if (err.code === 'ER_NO_SUCH_TABLE') {
                // AUDIT-FIX ARCH-002: Removed duplicate CREATE TABLE password_reset_tokens
                // Table is created at startup in migration block (line ~23019)
                console.log('[RESET] Tabela password_reset_tokens não existe. Verifique migrações de startup.');
                return res.status(503).json({
                    message: 'Sistema sendo configurado. Por favor, tente novamente.',
                    retry: true
                });
            }
    
            return res.status(500).json({ message: 'Erro ao processar solicitação. Tente novamente.' });
        }
    });
    
    // Endpoint para validar token de reset
    router.get('/auth/validate-reset-token/:token', async (req, res) => {
        const { token } = req.params;
    
        if (!token) {
            return res.status(400).json({ message: 'Token inválido', valid: false });
        }
    
        try {
            const [tokens] = await pool.query(
                'SELECT * FROM password_reset_tokens WHERE token = ? AND usado = 0 AND expira_em > NOW()',
                [token]
            );
    
            if (!tokens || tokens.length === 0) {
                return res.json({ valid: false, message: 'Token inválido ou expirado' });
            }
    
            return res.json({ valid: true, email: tokens[0].email });
    
        } catch (err) {
            console.error('[RESET] Erro ao validar token:', err);
            return res.status(500).json({ message: 'Erro ao validar token', valid: false });
        }
    });
    
    // Endpoint para redefinir a senha
    router.post('/auth/reset-password', async (req, res) => {
        const { token, novaSenha } = req.body;
    
        if (!token || !novaSenha) {
            return res.status(400).json({ message: 'Token e nova senha são obrigatórios' });
        }
    
        // SECURITY FIX: Política de senha forte (Due Diligence 2026-02-15)
        if (novaSenha.length < 10) {
            return res.status(400).json({ message: 'A senha deve ter no mínimo 10 caracteres' });
        }
        if (!/[A-Z]/.test(novaSenha)) {
            return res.status(400).json({ message: 'A senha deve conter pelo menos uma letra maiúscula' });
        }
        if (!/[a-z]/.test(novaSenha)) {
            return res.status(400).json({ message: 'A senha deve conter pelo menos uma letra minúscula' });
        }
        if (!/[0-9]/.test(novaSenha)) {
            return res.status(400).json({ message: 'A senha deve conter pelo menos um número' });
        }
        if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(novaSenha)) {
            return res.status(400).json({ message: 'A senha deve conter pelo menos um caractere especial (!@#$%...)' });
        }
    
        try {
            // Buscar token válido
            const [tokens] = await pool.query(
                'SELECT * FROM password_reset_tokens WHERE token = ? AND usado = 0 AND expira_em > NOW()',
                [token]
            );
    
            if (!tokens || tokens.length === 0) {
                return res.status(400).json({ message: 'Token inválido ou expirado' });
            }
    
            const resetToken = tokens[0];
            const email = resetToken.email;
    
            // Hash da nova senha
            const bcrypt = require('bcryptjs');
            const senhaHash = await bcrypt.hash(novaSenha, 10);
    
            // Atualizar senha na tabela usuarios (SECURITY: apenas hash, nunca texto plano)
            const [usuariosResult] = await pool.query(
                'UPDATE usuarios SET senha_hash = ?, password_hash = ? WHERE email = ?',
                [senhaHash, senhaHash, email]
            );
    
            // Atualizar senha na tabela funcionarios (SECURITY: hash bcrypt, limpar texto plano)
            const [funcionariosResult] = await pool.query(
                'UPDATE funcionarios SET senha = ?, senha_texto = NULL WHERE email = ?',
                [senhaHash, email]
            );
    
            // Marcar token como usado
            await pool.query(
                'UPDATE password_reset_tokens SET usado = 1 WHERE token = ?',
                [token]
            );
    
            // Invalidar todos os tokens antigos deste email
            await pool.query(
                'UPDATE password_reset_tokens SET usado = 1 WHERE email = ? AND token != ?',
                [email, token]
            );
    
            console.log(`[RESET] ✅ Senha redefinida com sucesso para: ${email}`);
    
            return res.json({
                message: 'Senha redefinida com sucesso! Você já pode fazer login.',
                success: true
            });
    
        } catch (err) {
            console.error('[RESET] Erro ao redefinir senha:', err);
            return res.status(500).json({ message: 'Erro ao redefinir senha. Tente novamente.' });
        }
    });
    
    // Note: /api/logout é provido por authRouter; se preferir usar a implementação
    // embutida aqui, substitua/remova a rota no arquivo auth.js.
    
    // Rota para servir o favicon
    router.get('/favicon.ico', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'images', 'favicon.ico'));
    });
    
    
    // Rota raiz: sempre servir a tela de login
    router.get('/', (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
    });
    
    // Manter rotas antigas de login apontando para a tela de login
    router.get(['/login.html', '/login'], (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
    });
    
    // Middleware que exige autenticação via JWT (cookie ou Authorization header) - para servir páginas protegidas
    // SECURITY: Não aceita token via query string (expõe em logs/histórico do navegador)
    function requireAuthPage(req, res, next) {
        // Primeiro tenta pegar do cookie, depois do header Authorization
        const token = req.cookies?.token || req.cookies?.authToken || req.headers['authorization']?.replace('Bearer ', '');
    
        if (!token) {
            // não autenticado -> redireciona para login
            console.log('[AUTH] Sem token ao acessar página protegida, redirecionando para login');
            return res.redirect('/login.html');
        }
    
        try {
            const user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            req.user = user;
            return next();
        } catch (err) {
            console.log('[AUTH] Token inválido ao acessar página protegida:', err && err.message);
            return res.redirect('/login.html');
        }
    }
    
    // Servir /dashboard e /index.html apenas para usuários autenticados
    router.get('/dashboard', requireAuthPage, (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Clear-Site-Data', '"cache"');
        res.sendFile(path.join(__dirname, 'dashboard-emergent', 'index.html'));
    });
    
    router.get('/index.html', requireAuthPage, (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Clear-Site-Data', '"cache"');
        res.sendFile(path.join(__dirname, 'dashboard-emergent', 'index.html'));
    });
    
    // Servir arquivos estáticos do dashboard-emergent
    router.use('/dashboard-emergent', express.static(path.join(__dirname, 'dashboard-emergent')));
    
    // Middleware para autenticação via JWT no backend
    // SECURITY: Não aceita token via query string (expõe em logs/histórico do navegador)
    function authenticatePage(req, res, next) {
        // SECURITY FIX: Agora exige token válido para servir páginas protegidas
        // Due Diligence 2026-02-15: Fechado bypass que permitia acesso sem autenticação
        const token = req.cookies?.authToken || req.cookies?.token || req.headers['authorization']?.replace('Bearer ', '');
        if (!token) {
            console.log('[AUTH] Sem token ao acessar página protegida:', req.path);
            return res.redirect('/login.html');
        }
        // AUDIT-FIX HIGH-006: Enforce HS256 algorithm to prevent algorithm-switching attacks
        jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
            if (err) {
                console.log('[AUTH] Token inválido ao acessar página protegida:', err.message);
                return res.redirect('/login.html');
            }
            req.user = user;
            return next();
        });
    }
    
    // ============================================================
    // ROTAS PROTEGIDAS DO FINANCEIRO
    // ============================================================
    
    // Rotas principais do Financeiro
    router.get('/Financeiro/financeiro.html', authenticatePage, (req, res) => {
        if (req.user && req.user.nome) {
            const firstName = req.user.nome.split(' ')[0].toLowerCase();
            if (userPermissions.hasAccess(firstName, 'financeiro')) {
                res.sendFile(path.join(__dirname, '..', 'modules', 'Financeiro', 'public', 'index.html'));
            } else {
                res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo Financeiro.</p>');
            }
        } else {
            res.redirect('/login.html');
        }
    });
    
    router.get('/Financeiro/index.html', authenticatePage, (req, res) => {
        if (req.user && req.user.nome) {
            const firstName = req.user.nome.split(' ')[0].toLowerCase();
            if (userPermissions.hasAccess(firstName, 'financeiro')) {
                res.sendFile(path.join(__dirname, '..', 'modules', 'Financeiro', 'public', 'index.html'));
            } else {
                res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo Financeiro.</p>');
            }
        } else {
            res.redirect('/login.html');
        }
    });
    

    return router;
};
