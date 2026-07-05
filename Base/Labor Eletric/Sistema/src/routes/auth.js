// auth.js - Middleware e rota de autenticação corrigida
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { validatePasswordStrength } = require('../../utils/password-validator');
const { validate, schemas } = require('../../middleware/schema-validation');
const twoFactorService = require('../../services/two-factor.service');

const refreshTokenModule = require('../auth/refresh-token');

const router = express.Router();

// ============================================================================
// ACCOUNT LOCKOUT — bloqueia conta após tentativas falhas consecutivas
// Persistido no banco (colunas login_attempts, locked_until na tabela usuarios)
// com cache in-memory como fallback se o DB estiver indisponível
// ============================================================================
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutos
const loginAttemptsCache = new Map(); // fallback in-memory

async function getLoginAttempt(email) {
    const key = (email || '').toLowerCase().trim();
    try {
        const [rows] = await pool.query(
            'SELECT login_attempts, locked_until FROM usuarios WHERE email = ?',
            [key]
        );
        if (!rows.length) return { count: 0, lockedUntil: null };
        const row = rows[0];
        const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : null;
        if (lockedUntil && Date.now() > lockedUntil) {
            await pool.query(
                'UPDATE usuarios SET login_attempts = 0, locked_until = NULL WHERE email = ?',
                [key]
            );
            return { count: 0, lockedUntil: null };
        }
        return { count: row.login_attempts || 0, lockedUntil };
    } catch (err) {
        // Fallback to in-memory cache
        const record = loginAttemptsCache.get(key);
        if (!record) return { count: 0, lockedUntil: null };
        if (record.lockedUntil && Date.now() > record.lockedUntil) {
            loginAttemptsCache.delete(key);
            return { count: 0, lockedUntil: null };
        }
        return record;
    }
}

async function recordFailedLogin(email) {
    const key = (email || '').toLowerCase().trim();
    const record = await getLoginAttempt(key);
    const newCount = record.count + 1;
    const lockedUntil = newCount >= MAX_LOGIN_ATTEMPTS ? Date.now() + LOCKOUT_DURATION_MS : null;
    try {
        await pool.query(
            'UPDATE usuarios SET login_attempts = ?, locked_until = ? WHERE email = ?',
            [newCount, lockedUntil ? new Date(lockedUntil) : null, key]
        );
    } catch (err) {
        loginAttemptsCache.set(key, { count: newCount, lockedUntil });
    }
    return { count: newCount, lockedUntil };
}

async function resetLoginAttempts(email) {
    const key = (email || '').toLowerCase().trim();
    try {
        await pool.query(
            'UPDATE usuarios SET login_attempts = 0, locked_until = NULL WHERE email = ?',
            [key]
        );
    } catch (err) {
        loginAttemptsCache.delete(key);
    }
}

// Ensure DB columns exist (idempotent migration)
async function ensureLockoutColumns() {
    try {
        const [cols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME IN ('login_attempts','locked_until')"
        );
        const existing = cols.map(c => c.COLUMN_NAME);
        if (!existing.includes('login_attempts')) {
            await pool.query('ALTER TABLE usuarios ADD COLUMN login_attempts INT DEFAULT 0');
        }
        if (!existing.includes('locked_until')) {
            await pool.query('ALTER TABLE usuarios ADD COLUMN locked_until DATETIME NULL');
        }
    } catch (err) {
        console.warn('[AUTH/LOCKOUT] Could not add lockout columns (may already exist):', err.code);
    }
}
// Run migration after pool is set (deferred)
setTimeout(() => { if (pool) ensureLockoutColumns(); }, 2000);

// Configuração do Banco de Dados e modo de desenvolvimento
const DEV_MOCK = (process.env.DEV_MOCK === '1' || process.env.DEV_MOCK === 'true');

// JWT_SECRET deve vir OBRIGATORIAMENTE do .env
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ [AUTH] ERRO FATAL: JWT_SECRET não definido no .env');
    process.exit(1);
}

// ============================================================================
// POOL DE CONEXÃO - Aceita pool externo via setPool() para reutilizar
// a mesma conexão do server.js principal, evitando pools órfãos
// ============================================================================
let pool;
let _poolReady = false;

/**
 * Injeta o pool de conexão do server.js principal.
 * Deve ser chamado ANTES de montar o router.
 * @param {import('mysql2/promise').Pool} externalPool
 */
router.setPool = function setPool(externalPool) {
    if (externalPool && typeof externalPool.query === 'function') {
        pool = externalPool;
        _poolReady = true;
        console.log('[AUTH] ✅ Pool de conexão injetado pelo server.js principal');
    } else {
        console.error('[AUTH] ❌ Pool injetado é inválido - usando pool interno como fallback');
    }
};

if (DEV_MOCK) {
    // Mock simples em memória para testes locais sem MySQL
    console.log('[AUTH] Iniciando em modo DEV_MOCK - banco em memória');
    // AUDIT-FIX SEC-002: Mock user password is now bcrypt-hashed (no more plaintext credentials in source)
    const mockUsers = [
        { id: 1, nome: 'Funcionário Exemplo', email: 'exemplo@aluforce.ind.br', role: 'user', setor: 'comercial', senha_hash: '$2a$12$LJ3m4ys3GZfnwMqeFcOoNu8X8MYVfVl4A6F2r.zZJ9XqLy1L5KJqy' }
    ];
    pool = {
        // Simula respostas para as queries usadas no fluxo de login
        query: async (sql, params) => {
            const s = (sql || '').toString().toUpperCase();
            if (s.startsWith('SHOW COLUMNS FROM USUARIOS')) {
                return [[
                    { Field: 'id' }, { Field: 'nome' }, { Field: 'email' }, { Field: 'senha' }
                ]];
            }
            if (s.includes('SELECT * FROM USUARIOS WHERE EMAIL')) {
                const email = params && params[0] ? params[0] : '';
                const rows = mockUsers.filter(u => u.email.toLowerCase() === String(email).toLowerCase());
                return [rows];
            }
            return [[]];
        }
    };
    _poolReady = true;
} else {
    // Pool interno como fallback (caso setPool() não seja chamado)
    // Usa as mesmas variáveis de ambiente que o server.js principal
    pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'aluforce_vendas',
        waitForConnections: true,
        connectionLimit: parseInt(process.env.DB_CONN_LIMIT) || 5,
        queueLimit: 50,
        connectTimeout: 10000
    });
    _poolReady = true;
    console.log('[AUTH] ⚠️ Usando pool interno - considere injetar pool via authRouter.setPool(pool)');
}

/**
 * Helper: executa query com tratamento de erro robusto e retry em caso de conexão perdida.
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<any>}
 */
async function safeQuery(sql, params = []) {
    if (!pool || !_poolReady) {
        throw new Error('Pool de conexão MySQL não está disponível');
    }
    try {
        return await pool.query(sql, params);
    } catch (err) {
        // Retry automático para erros de conexão transitórios
        if (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNREFUSED') {
            console.warn(`[AUTH] ⚠️ Conexão perdida (${err.code}), tentando reconectar...`);
            await new Promise(r => setTimeout(r, 1000));
            return await pool.query(sql, params);
        }
        throw err;
    }
}

// Audit log helper — fire-and-forget
async function auditLog(action, userId, description, req) {
    try {
        if (!pool || !_poolReady) return;
        await pool.query(
            `INSERT INTO auditoria_logs (usuario_id, acao, modulo, descricao, ip_address, user_agent, created_at)
             VALUES (?, ?, 'auth', ?, ?, ?, NOW())`,
            [userId || null, action, description || null, req?.ip || null, req?.headers?.['user-agent'] || null]
        );
    } catch (e) { /* fire-and-forget */ }
}

// Rota de login corrigida (sem campo cargo)
router.post('/login', validate(schemas.login), async (req, res) => {
    const isDevMode = process.env.NODE_ENV !== 'production';
    if (isDevMode) {
        console.log('=== DEBUG LOGIN ===');
        console.log('req.body keys:', req.body ? Object.keys(req.body) : 'undefined');
    }

    // Validação adicional do req.body
    if (!req.body || typeof req.body !== 'object') {
        console.error('[AUTH/LOGIN] req.body está undefined ou não é um objeto');
        return res.status(400).json({ message: 'Dados de login inválidos' });
    }

    let { email, password, trustedDeviceToken, cpf } = req.body;
    try {
        // ========================================
        // CPF LOGIN MODE
        // ========================================
        let isCpfLogin = false;
        let funcSenha = null; // senha do registro funcionarios, usada como fallback de comparação
        if (cpf && !email) {
            isCpfLogin = true;
            // Strip non-digits
            cpf = String(cpf).replace(/\D/g, '');
            if (cpf.length !== 11) {
                return res.status(400).json({ message: 'CPF deve conter 11 dígitos.' });
            }
            if (isDevMode) console.log('[AUTH/LOGIN] Tentativa de login por CPF:', cpf.substring(0, 3) + '...');

            // Look up email AND senha from funcionarios table by CPF
            try {
                const [funcRows] = await safeQuery(
                    'SELECT email, senha FROM funcionarios WHERE REPLACE(REPLACE(REPLACE(cpf, ".", ""), "-", ""), " ", "") = ? LIMIT 1',
                    [cpf]
                );
                if (!funcRows.length) {
                    await recordFailedLogin('cpf:' + cpf);
                    return res.status(401).json({ message: 'Login ou senha incorretos.' });
                }
                email = funcRows[0].email;
                funcSenha = funcRows[0].senha || null;
                if (!email) {
                    return res.status(401).json({ message: 'CPF não possui email vinculado. Contate o RH.' });
                }
            } catch (cpfErr) {
                console.error('[AUTH/LOGIN] Erro ao buscar CPF:', cpfErr.message);
                return res.status(500).json({ message: 'Erro ao verificar CPF.' });
            }
        }

        if (isDevMode) console.log('[AUTH/LOGIN] Tentativa de login para:', email);

        // Se o usuário digitou apenas o login sem @, adicionar domínio padrão
        if (email && !email.includes('@')) {
            email = `${email}${process.env.DEFAULT_EMAIL_DOMAIN || '@aluforce.ind.br'}`;
        }

        // Domínios permitidos para login (configurável via .env)
        const defaultDomains = [
            '@aluforce.ind.br',
            '@aluforce.com',
            '@energy.com.br',
            '@laboreletric.com.br',
            '@lumiereassesoria.com.br',   // Consultoria parceira (grafia alternativa)
            '@lumiereassessoria.com.br',  // Consultoria parceira (grafia oficial com SS)
            '@zyntra.com.br'             // Zyntra Demo
        ];
        const dominiosPermitidos = process.env.ALLOWED_EMAIL_DOMAINS
            ? process.env.ALLOWED_EMAIL_DOMAINS.split(',').map(d => d.trim())
            : defaultDomains;

        const emailValido = dominiosPermitidos.some(dominio => email && email.endsWith(dominio));

        if (!isCpfLogin && (!email || !emailValido)) {
            return res.status(401).json({ message: 'E-mail não autorizado. Domínios permitidos: ' + dominiosPermitidos.join(', ') });
        }

        // ========================================
        // ACCOUNT LOCKOUT — verificar se conta está bloqueada
        // ========================================
        const attemptRecord = await getLoginAttempt(email);
        if (attemptRecord.lockedUntil && Date.now() < attemptRecord.lockedUntil) {
            const minutesLeft = Math.ceil((attemptRecord.lockedUntil - Date.now()) / 60000);
            await auditLog('login_locked', null, `Tentativa em conta bloqueada: ${email}`, req);
            return res.status(429).json({
                message: `Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em ${minutesLeft} minuto(s).`
            });
        }

        // Detecta colunas da tabela `usuarios` para escolher o campo de senha
        let cols;
        try {
            const [c] = await safeQuery('SHOW COLUMNS FROM usuarios');
            cols = c.map(x => x.Field.toLowerCase());
            if (isDevMode) console.log('[AUTH/LOGIN] Colunas usuarios detectadas:', cols.join(', '));
        } catch (err) {
            console.error('[AUTH/LOGIN] Erro ao inspecionar colunas da tabela usuarios:', err.code || err.message);
            if (err && err.code === 'ER_NO_SUCH_TABLE') {
                return res.status(500).json({ message: 'Tabela `usuarios` não encontrada no banco de dados. Verifique a configuração do DB.' });
            }
            // Conexão com o banco pode estar indisponível
            if (err.message && err.message.includes('Pool de conexão')) {
                return res.status(503).json({ message: 'Serviço temporariamente indisponível. Tente novamente em alguns segundos.' });
            }
            return res.status(500).json({ message: 'Erro ao verificar esquema de usuários.' });
        }

        // Seleciona o usuário (busca por email OU login)
        let [rows] = await safeQuery('SELECT * FROM usuarios WHERE email = ? OR login = ? ORDER BY id ASC LIMIT 1', [email, email.split('@')[0]]);

        // ========================================
        // CPF LOGIN SYNC: Sincronizar dados quando usuario é encontrado
        // via campo login mas com email diferente do funcionarios
        // ========================================
        if (rows.length && isCpfLogin) {
            const foundUser = rows[0];
            const foundByLogin = foundUser.email !== email && foundUser.login === email.split('@')[0];
            if (foundByLogin) {
                try {
                    const [funcSync] = await safeQuery(
                        `SELECT nome_completo, email, senha, foto_perfil_url
                         FROM funcionarios
                         WHERE REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = ?
                         LIMIT 1`,
                        [cpf]
                    );
                    if (funcSync.length) {
                        const f = funcSync[0];
                        // Sincronizar senha do funcionarios → usuarios (para que a senha usada no RH funcione)
                        if (f.senha) {
                            await safeQuery(
                                `UPDATE usuarios SET senha_hash = ?, password_hash = ? WHERE id = ?`,
                                [f.senha, f.senha, foundUser.id]
                            );
                        }
                        // Sincronizar foto se usuarios tem NULL
                        if ((!foundUser.foto || !foundUser.avatar) && f.foto_perfil_url) {
                            await safeQuery(
                                `UPDATE usuarios SET foto = COALESCE(foto, ?), avatar = COALESCE(avatar, ?) WHERE id = ?`,
                                [f.foto_perfil_url, f.foto_perfil_url, foundUser.id]
                            );
                        }
                        console.log(`[AUTH/LOGIN] 🔄 CPF login sync: ${foundUser.login} (usuarios.email=${foundUser.email}, func.email=${f.email})`);
                        // Re-query para pegar dados atualizados
                        [rows] = await safeQuery('SELECT * FROM usuarios WHERE id = ?', [foundUser.id]);
                    }
                } catch (syncErr) {
                    console.error('[AUTH/LOGIN] ⚠️ CPF sync failed:', syncErr.message);
                }
            }
        }

        // ========================================
        // AUTO-PROVISIONING: CPF login sem usuario
        // Se o funcionário tem CPF e senha mas não tem registro em usuarios,
        // cria automaticamente a conta a partir dos dados de funcionarios.
        // ========================================
        if (!rows.length && isCpfLogin) {
            try {
                const [funcData] = await safeQuery(
                    `SELECT nome_completo, email, senha, foto_perfil_url, cargo, departamento
                     FROM funcionarios
                     WHERE REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = ?
                     LIMIT 1`,
                    [cpf]
                );
                if (funcData.length && funcData[0].senha) {
                    const f = funcData[0];
                    const loginName = f.email ? f.email.split('@')[0] : null;
                    await safeQuery(
                        `INSERT INTO usuarios (nome, email, senha_hash, password_hash, role, avatar, foto, login, senha_temporaria, status)
                         VALUES (?, ?, ?, ?, 'user', ?, ?, ?, 0, 'ativo')`,
                        [f.nome_completo, f.email, f.senha, f.senha, f.foto_perfil_url || null, f.foto_perfil_url || null, loginName]
                    );
                    console.log(`[AUTH/LOGIN] ✅ Auto-provisioned usuarios record for CPF login: ${f.email}`);
                    // Re-query to get the newly created user
                    [rows] = await safeQuery('SELECT * FROM usuarios WHERE email = ? ORDER BY id ASC LIMIT 1', [f.email]);
                }
            } catch (provisionErr) {
                console.error('[AUTH/LOGIN] ⚠️ Auto-provision failed:', provisionErr.message);
            }
        }

        // ========================================
        // FALLBACK: Busca por nome_completo em funcionarios
        // Quando usuario digita email diferente do cadastrado (ex: fabiano.marques vs fabiano.oliveira)
        // Tenta localizar o funcionario pelo nome e vincular ao registro em usuarios
        // ========================================
        if (!rows.length && !isCpfLogin) {
            try {
                const loginPart = (email.split('@')[0] || '').toLowerCase();
                const nameParts = loginPart.split('.');
                if (nameParts.length >= 2) {
                    const firstName = nameParts[0];
                    const lastName = nameParts[nameParts.length - 1];
                    // Escapar caracteres especiais de LIKE (%, _)
                    const escapeLike = (str) => str.replace(/[%_\\]/g, '\\$&');
                    // Busca funcionario cujo nome_completo comece com o primeiro nome e contenha o sobrenome
                    const [funcMatch] = await safeQuery(
                        `SELECT email FROM funcionarios
                         WHERE LOWER(nome_completo) LIKE ? ESCAPE '\\\\' AND LOWER(nome_completo) LIKE ? ESCAPE '\\\\'
                         LIMIT 1`,
                        [escapeLike(firstName) + '%', '%' + escapeLike(lastName) + '%']
                    );
                    if (funcMatch.length && funcMatch[0].email) {
                        const realEmail = funcMatch[0].email;
                        console.log(`[AUTH/LOGIN] 🔗 Fallback nome: ${email} → funcionario email: ${realEmail}`);
                        [rows] = await safeQuery('SELECT * FROM usuarios WHERE email = ? ORDER BY id ASC LIMIT 1', [realEmail]);
                        // Atualizar login para que proxima vez funcione diretamente
                        if (rows.length) {
                            await safeQuery('UPDATE usuarios SET login = ? WHERE id = ? AND (login IS NULL OR login = ? OR login != ?)',
                                [loginPart, rows[0].id, rows[0].email.split('@')[0], loginPart]);
                            console.log(`[AUTH/LOGIN] ✅ Login alias atualizado: ${loginPart} → usuarios.id=${rows[0].id}`);
                        }
                    }
                }
            } catch (fallbackErr) {
                console.error('[AUTH/LOGIN] ⚠️ Fallback nome lookup failed:', fallbackErr.message);
            }
        }

        if (!rows.length) {
            // ACCOUNT LOCKOUT: registrar tentativa falha mesmo sem usuário encontrado
            await recordFailedLogin(email);
            // AUDIT-FIX SEC-007: Generic message prevents user enumeration
            return res.status(401).json({ message: 'Login ou senha incorretos.' });
        }
        const user = rows[0];

        // ========================================
        // VALIDAÇÃO: BLOQUEAR USUÁRIOS INATIVOS/DEMITIDOS
        // A fonte primária de verdade é o campo `status` no banco de dados.
        // A lista hardcoded foi removida — gerenciar status via painel admin.
        // ========================================

        // Verificar campo de status no banco (ativo, inativo, demitido, desativado, bloqueado)
        const statusUsuario = (user.status || '').toLowerCase().trim();
        const statusInativo = ['demitido', 'inativo', 'desativado', 'bloqueado'].includes(statusUsuario);

        if (statusInativo) {
            await auditLog('login_blocked_inactive', user.id, `Login bloqueado - status=${statusUsuario}: ${user.email}`, req);
            console.log(`🚫 Login bloqueado - Usuário inativo (status=${statusUsuario}): ${user.email}`);
            return res.status(403).json({
                message: 'Conta desativada. Contate o administrador.'
            });
        }
        // ========================================

        // Possíveis nomes comuns de campos de senha
        const possibleNames = ['senha_hash', 'senha', 'password', 'senha_plain', 'pass', 'passwd', 'password_hash'];
        let hashField = null;
        for (const n of possibleNames) {
            if (cols.includes(n)) { hashField = n; break; }
        }
        if (!hashField) {
            for (const n of possibleNames) {
                if (Object.prototype.hasOwnProperty.call(user, n)) { hashField = n; break; }
            }
        }
        if (!hashField) {
            return res.status(500).json({ message: 'Nenhum campo de senha encontrado na tabela `usuarios`. Verifique o esquema.' });
        }

        // AUDIT-FIX: ALWAYS use bcrypt comparison. Plaintext passwords are auto-hashed on first successful login.
        let valid = false;
        const storedValue = user[hashField] || '';
        const isBcryptHash = typeof storedValue === 'string' && /^\$2[aby]\$/.test(storedValue);
        try {
            if (isBcryptHash) {
                valid = await bcrypt.compare(password, storedValue);
            } else {
                // AUDIT-FIX: For legacy plaintext passwords, compare then auto-hash if valid
                // SECURITY: Use timing-safe comparison to prevent timing attacks
                const passwordBuf = Buffer.from(password);
                const storedBuf = Buffer.from(user[hashField] || '');
                valid = passwordBuf.length === storedBuf.length && crypto.timingSafeEqual(passwordBuf, storedBuf);
                if (valid) {
                    // Auto-migrate: hash the plaintext password in the DB for future logins
                    try {
                        const hashedPw = await bcrypt.hash(password, 12);
                        // If possible, update to a hash field
                        const hashFieldName = hashField === 'senha' ? 'senha_hash' : hashField;
                        await safeQuery(`UPDATE usuarios SET senha_hash = ? WHERE id = ?`, [hashedPw, user.id]);
                        console.log(`[AUTH/LOGIN] 🔒 Auto-migrated plaintext password to bcrypt for user ${user.id}`);
                    } catch (migrationErr) {
                        console.error('[AUTH/LOGIN] ⚠️ Failed to auto-migrate password:', migrationErr.message);
                    }
                }
            }
        } catch (err) {
            console.error('Erro ao comparar senha:', err.message);
            return res.status(500).json({ message: 'Erro ao verificar credenciais.' });
        }
        // CPF fallback: se senha em `usuarios` não bater, comparar contra `funcionarios.senha`.
        // Cobre o caso mais comum: senha trocada via módulo RH que só atualiza funcionarios.
        if (!valid && isCpfLogin && funcSenha) {
            const isFuncSenhaBcrypt = /^\$2[aby]\$/.test(String(funcSenha));
            try {
                if (isFuncSenhaBcrypt) {
                    valid = await bcrypt.compare(password, funcSenha);
                } else {
                    const pwBuf = Buffer.from(password);
                    const fbBuf = Buffer.from(funcSenha);
                    valid = pwBuf.length === fbBuf.length && crypto.timingSafeEqual(pwBuf, fbBuf);
                }
                if (valid) {
                    // Sincronizar: propagar hash do funcionarios → usuarios para próximos logins
                    try {
                        await safeQuery('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [funcSenha, user.id]);
                        console.log(`[AUTH/LOGIN] 🔄 CPF login: senha sincronizada de funcionarios → usuarios para ${email}`);
                    } catch (syncErr) {
                        console.error('[AUTH/LOGIN] ⚠️ CPF senha sync failed:', syncErr.message);
                    }
                }
            } catch (fallbackErr) {
                console.error('[AUTH/LOGIN] ⚠️ CPF senha fallback error:', fallbackErr.message);
            }
        }

        if (!valid) {
            // ACCOUNT LOCKOUT: registrar tentativa falha
            const lockResult = await recordFailedLogin(email);
            const remaining = MAX_LOGIN_ATTEMPTS - lockResult.count;
            await auditLog('login_failed', user.id, `Senha incorreta para ${email} (tentativa ${lockResult.count}/${MAX_LOGIN_ATTEMPTS})`, req);
            if (lockResult.lockedUntil) {
                return res.status(429).json({
                    message: `Conta bloqueada por ${LOCKOUT_DURATION_MS / 60000} minutos após ${MAX_LOGIN_ATTEMPTS} tentativas falhas.`
                });
            }
            // AUDIT-FIX SEC-007: Same message as user-not-found to prevent enumeration
            return res.status(401).json({ message: 'Login ou senha incorretos.' });
        }

        // ACCOUNT LOCKOUT: login bem-sucedido, resetar contador
        await resetLoginAttempts(email);

        // ════════════════════════════════════════════════════════════════
        // 🔐 2FA - AUTENTICAÇÃO DE DOIS FATORES VIA EMAIL
        // ════════════════════════════════════════════════════════════════
        // [REFACTORED 10/03/2026] 2FA agora é controlado pelo banco de dados
        // via coluna `two_factor_enabled` na tabela usuarios.
        // Admin ativa/desativa pelo painel — sem whitelist hardcoded.
        const requires2FA = await twoFactorService.requires2FA(pool, user.id);

        if (requires2FA) {
        try {
            // Criar tabela de dispositivos confiáveis se não existir
            await safeQuery(`
                CREATE TABLE IF NOT EXISTS auth_trusted_devices (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    usuario_id INT NOT NULL,
                    device_token VARCHAR(100) NOT NULL UNIQUE,
                    user_agent VARCHAR(500) DEFAULT NULL,
                    ip_address VARCHAR(45) DEFAULT NULL,
                    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                    expira_em DATETIME NOT NULL,
                    INDEX idx_device_token (device_token),
                    INDEX idx_usuario (usuario_id),
                    INDEX idx_expira (expira_em)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // 🔍 Verificar se o dispositivo já é confiável (cookie OU body param)
            const trustedDeviceCookie = req.cookies && req.cookies['trusted_device_2fa'];
            const trustedDeviceBody = trustedDeviceToken; // Backup via localStorage
            const trustedTokenToCheck = trustedDeviceCookie || trustedDeviceBody || null;

            console.log(`[AUTH/2FA] 🔍 Verificando dispositivo confiável para userId ${user.id}`);
            console.log(`[AUTH/2FA]   - Cookie trusted_device_2fa: ${trustedDeviceCookie ? 'PRESENTE' : 'AUSENTE'}`);
            console.log(`[AUTH/2FA]   - Body trustedDeviceToken: ${trustedDeviceBody ? 'PRESENTE' : 'AUSENTE'}`);

            if (trustedTokenToCheck) {
                // Limpar dispositivos expirados
                await safeQuery('DELETE FROM auth_trusted_devices WHERE expira_em < NOW()');

                const [trustedRows] = await safeQuery(
                    'SELECT 1 FROM auth_trusted_devices WHERE device_token = ? AND usuario_id = ? AND expira_em > NOW()',
                    [trustedTokenToCheck, user.id]
                );

                console.log(`[AUTH/2FA]   - Registros encontrados no DB: ${trustedRows ? trustedRows.length : 0}`);

                if (trustedRows && trustedRows.length > 0) {
                    console.log(`[AUTH/2FA] ✅ Dispositivo confiável encontrado para ${user.email} - pulando 2FA (via ${trustedDeviceCookie ? 'cookie' : 'localStorage'})`);

                    // Renovar o cookie caso tenha vindo só pelo body (cookie perdido)
                    if (!trustedDeviceCookie && trustedDeviceBody) {
                        console.log(`[AUTH/2FA] 🔄 Renovando cookie trusted_device_2fa (estava ausente)`);
                        const trustedCookieOpts = {
                            httpOnly: true,
                            path: '/',
                            maxAge: 30 * 24 * 60 * 60 * 1000,
                            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
                        };
                        if (process.env.NODE_ENV === 'production') {
                            trustedCookieOpts.secure = true;
                        }
                        res.cookie('trusted_device_2fa', trustedDeviceBody, trustedCookieOpts);
                    }

                    // Throw para sair do try e cair no login normal
                    const skipError = new Error('SKIP_2FA_TRUSTED_DEVICE');
                    skipError.skipToLogin = true;
                    throw skipError;
                } else {
                    console.log(`[AUTH/2FA] ⚠️ Token de dispositivo presente mas não encontrado no DB para user ${user.id}`);
                }
            } else {
                console.log(`[AUTH/2FA] ℹ️ Nenhum token de dispositivo confiável encontrado - 2FA será exigido`);
            }

            // Criar tabela de códigos 2FA se não existir
            await safeQuery(`
                CREATE TABLE IF NOT EXISTS auth_2fa_codes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    pending_token VARCHAR(100) NOT NULL UNIQUE,
                    usuario_id INT NOT NULL,
                    codigo VARCHAR(6) NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    tentativas INT DEFAULT 0,
                    usado TINYINT(1) DEFAULT 0,
                    expira_em DATETIME NOT NULL,
                    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_pending_token (pending_token),
                    INDEX idx_expira (expira_em)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Gerar código de 6 dígitos
            const codigo2FA = crypto.randomInt(100000, 999999).toString();
            const pendingToken = uuidv4();
            const expiraEm = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos

            // Limpar códigos antigos deste usuário
            await safeQuery('DELETE FROM auth_2fa_codes WHERE usuario_id = ? OR expira_em < NOW()', [user.id]);

            // Salvar código no banco
            await safeQuery(
                'INSERT INTO auth_2fa_codes (pending_token, usuario_id, codigo, email, expira_em) VALUES (?, ?, ?, ?, ?)',
                [pendingToken, user.id, codigo2FA, user.email, expiraEm]
            );

            // Capturar informações do dispositivo para o email
            const loginIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || 'Desconhecido';
            const loginUA = req.headers['user-agent'] || 'Desconhecido';
            const loginDate = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

            // Extrair navegador e SO do user-agent
            const parseBrowser = (ua) => {
                if (!ua || ua === 'Desconhecido') return 'Desconhecido';
                let browser = 'Navegador desconhecido';
                let os = '';
                if (ua.includes('Edg/')) browser = 'Edge ' + (ua.match(/Edg\/(\d+)/)||[])[1];
                else if (ua.includes('Chrome/')) browser = 'Chrome ' + (ua.match(/Chrome\/(\d+)/)||[])[1];
                else if (ua.includes('Firefox/')) browser = 'Firefox ' + (ua.match(/Firefox\/(\d+)/)||[])[1];
                else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';
                if (ua.includes('Windows NT 10')) os = 'Windows 10';
                else if (ua.includes('Windows NT')) os = 'Windows';
                else if (ua.includes('Mac OS X')) os = 'macOS';
                else if (ua.includes('Linux')) os = 'Linux';
                else if (ua.includes('Android')) os = 'Android';
                else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
                return os ? `${browser} no ${os}` : browser;
            };
            const browserInfo = parseBrowser(loginUA);

            // Enviar email com o código em BACKGROUND (não bloqueia a resposta)
            // O código já foi salvo no banco, então mesmo que o email demore, o usuário pode aguardar
            const emailPromise = (async () => {
                let emailEnviado = false;
                let emailErro = null;

                for (let tentativa = 1; tentativa <= 3; tentativa++) {
                    try {
                        const nodemailer = require('nodemailer');
                        const transporter = nodemailer.createTransport({
                            host: process.env.SMTP_HOST || 'mail.aluforce.ind.br',
                            port: parseInt(process.env.SMTP_PORT) || 465,
                            secure: (process.env.SMTP_SECURE !== 'false'),
                            auth: {
                                user: process.env.SMTP_USER,
                                pass: process.env.SMTP_PASS
                            },
                            tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
                            connectionTimeout: 10000,
                            greetingTimeout: 10000,
                            socketTimeout: 15000
                        });

                    const nomeUsuario = (user.nome || user.email.split('@')[0]).split(' ')[0];

                    await transporter.sendMail({
                        from: `"Zyntra" <${process.env.SMTP_USER || 'sistema@aluforce.ind.br'}>`,
                        to: user.email,
                        subject: `Código de verificação Zyntra`,
                        html: `
<div style="margin:0;padding:0;background-color:#1a1a2e;width:100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#1a1a2e" style="background-color:#1a1a2e;">
    <tr><td align="center" bgcolor="#1a1a2e" style="padding:32px 16px;background-color:#1a1a2e;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="520" style="max-width:520px;width:100%;">

        <!-- LOGO -->
        <tr><td bgcolor="#1a1a2e" style="padding:24px 0 28px;text-align:center;background-color:#1a1a2e;">
          <img src="https://aluforce.api.br/images/zyntra-branco.png" alt="Zyntra" style="height:48px;width:auto;display:inline-block;" />
        </td></tr>

        <!-- CARD -->
        <tr><td bgcolor="#242442" style="background-color:#242442;border-radius:16px;overflow:hidden;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#242442">

            <!-- CONTENT -->
            <tr><td bgcolor="#242442" style="padding:40px 36px 32px;background-color:#242442;">
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:16px;color:#e2e8f0;margin:0 0 8px;">Olá <strong>${nomeUsuario}</strong>,</p>
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#94a3b8;margin:0 0 28px;line-height:1.6;">Aqui está seu código de verificação Zyntra:</p>

              <!-- CODE BOX -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;">
                <tr><td bgcolor="#1a1a2e" style="background-color:#1a1a2e;border-radius:12px;padding:24px;text-align:center;">
                  <span style="font-family:'Courier New',monospace;font-size:38px;font-weight:700;letter-spacing:10px;color:#ffffff;">${codigo2FA}</span>
                </td></tr>
              </table>

              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#94a3b8;text-align:center;margin:0 0 28px;">Digite este código na tela de verificação para liberar seu acesso.</p>

              <!-- DEVICE INFO BOX -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                <tr><td bgcolor="#1e1e3a" style="background-color:#1e1e3a;border-radius:10px;padding:16px 20px;border-left:3px solid #6366f1;">
                  <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#cbd5e1;margin:0 0 4px;">Data: <strong style="color:#e2e8f0;">${loginDate}</strong></p>
                  <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#cbd5e1;margin:0 0 4px;">IP: <strong style="color:#e2e8f0;">${loginIP}</strong></p>
                  <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#cbd5e1;margin:0;">Navegador: <strong style="color:#e2e8f0;">${browserInfo}</strong></p>
                </td></tr>
              </table>

              <!-- SECURITY WARNING -->
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#94a3b8;margin:0 0 12px;line-height:1.5;">Se não foi você que tentou acessar, recomendamos redefinir suas credenciais agora mesmo.</p>

              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#94a3b8;margin:0 0 0;line-height:1.6;">Para manter sua conta ainda mais protegida, use sempre uma senha forte e habilite a autenticação em duas etapas.</p>
            </td></tr>

            <!-- DIVIDER -->
            <tr><td bgcolor="#242442" style="padding:0 36px;background-color:#242442;"><div style="height:1px;background-color:#374151;"></div></td></tr>

            <!-- FOOTER -->
            <tr><td bgcolor="#242442" style="padding:20px 36px 28px;background-color:#242442;">
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#64748b;margin:0;text-align:center;">— Zyntra</p>
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#475569;margin:8px 0 0;text-align:center;">Este é um email automático, não responda.</p>
            </td></tr>

          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>
                        `
                    });

                    emailEnviado = true;
                    console.log(`[AUTH/2FA] ✅ Código 2FA enviado para ${user.email} (tentativa ${tentativa})`);
                    break; // Sucesso, sair do loop de retry

                } catch (retryErr) {
                    emailErro = retryErr;
                    console.error(`[AUTH/2FA] ⚠️ Tentativa ${tentativa}/3 falhou:`, retryErr.message);
                    if (tentativa < 3) {
                        // Aguardar antes de retentar (1s, 2s)
                        await new Promise(r => setTimeout(r, tentativa * 1000));
                    }
                }
            }

            if (!emailEnviado) {
                console.error('[AUTH/2FA] ❌ Todas as 3 tentativas de envio falharam:', emailErro?.message);
                // Nota: o código já foi salvo no banco, o usuário pode solicitar reenvio
            }
            })().catch(err => {
                console.error('[AUTH/2FA] ❌ Erro no envio assíncrono do email:', err.message);
            });

            // Responder IMEDIATAMENTE ao cliente (email é enviado em background)
            // O código 2FA já foi salvo no banco de dados
            const emailParts = user.email.split('@');
            const maskedEmail = emailParts[0].substring(0, 2) + '***@' + emailParts[1];

            return res.json({
                requires2FA: true,
                pendingToken: pendingToken,
                maskedEmail: maskedEmail,
                message: 'Código de verificação enviado para seu email.'
            });
        } catch (twoFAErr) {
            if (twoFAErr.skipToLogin) {
                console.log('[AUTH/2FA] ✅ Dispositivo confiável - prosseguindo para login direto');
                // Cai no fluxo normal de login abaixo
            } else {
                console.error('[AUTH/2FA] ⚠️ Erro no sistema 2FA:', twoFAErr.message);
                // SECURITY: Do NOT allow login without 2FA on failure (prevents 2FA bypass)
                return res.status(503).json({
                    message: 'Serviço de verificação temporariamente indisponível. Tente novamente em alguns instantes.'
                });
            }
        }
        } // fim do if (requires2FA)
        // ════════════════════════════════════════════════════════════════

        // 🔐 MULTI-DEVICE: Gerar deviceId único para isolamento de sessão
        const deviceId = uuidv4();
        console.log(`[AUTH/LOGIN] 📱 DeviceId gerado: ${deviceId.substring(0, 8)}...`);

        // Gera PAR de tokens: access (15m) + refresh (7d) com rotação
        const tokenPair = await refreshTokenModule.generateTokenPair(
            { id: user.id, username: user.email, nome: user.nome, role: user.role, empresa_id: user.empresa_id, area: user.area },
            pool,
            deviceId
        );
        // Adicionar campos extras ao access token (deviceId, setor, email)
        const accessToken = jwt.sign({
            id: user.id,
            nome: user.nome,
            email: user.email,
            role: user.role,
            setor: user.setor || null,
            deviceId: deviceId,
            type: 'access'
        }, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: refreshTokenModule.ACCESS_TOKEN_EXPIRY });

        const cookieOptions = {
            httpOnly: true,
            path: '/'
        };

        // Em produção com HTTPS, usar secure e sameSite strict
        // Detectar HTTPS real (via req.secure ou header X-Forwarded-Proto)
        const isSecureConnection = req.secure || req.get('X-Forwarded-Proto') === 'https';
        if (process.env.NODE_ENV === 'production' && isSecureConnection) {
            cookieOptions.secure = true;
            cookieOptions.sameSite = 'strict';
        } else {
            // HTTP ou desenvolvimento: não usar secure, sameSite lax
            cookieOptions.sameSite = 'lax';
        }
        // Access token cookie: 15 minutos
        const accessCookieOptions = Object.assign({}, cookieOptions, { maxAge: 1000 * 60 * 15 });
        res.cookie('authToken', accessToken, accessCookieOptions);

        // Refresh token cookie: 7 dias (httpOnly, path / para acesso em page navigation)
        const refreshCookieOptions = Object.assign({}, cookieOptions, {
            maxAge: 1000 * 60 * 60 * 24 * 7
        });
        res.cookie('refreshToken', tokenPair.refreshToken, refreshCookieOptions);

        console.log('[AUTH/LOGIN] ✅ Cookies authToken (15m) + refreshToken (7d) setados para userId:', user.id);
        // Se a requisição vem de um navegador (ex: submission de formulário) redirecione para o painel
        // Caso seja uma requisição AJAX/fetch, retorne JSON (comportamento atual)
        const acceptsHtml = typeof req.headers.accept === 'string' && req.headers.accept.indexOf('text/html') !== -1;
        const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest' || (req.headers['content-type'] && req.headers['content-type'].indexOf('application/json') !== -1);
        if (acceptsHtml && !isAjax) {
            // Redireciona para index.html (painel de controle)
            return res.redirect('/index.html');
        }
        // Retorna path relativo para que o client-side possa prefixar o base path da empresa
        const redirectTo = '/dashboard';
        // SECURITY: Token is NOT included in JSON response.
        // Authentication is handled exclusively via httpOnly cookie (set above).
        // This eliminates XSS token theft via localStorage.
        const payload = {
            success: true,
            deviceId, // 🔐 MULTI-DEVICE: ID único deste dispositivo
            redirectTo,
            forcePasswordChange: user.senha_temporaria === 1 || user.senha_temporaria === true, // 🔑 Flag de senha temporária
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                role: user.role,
                is_admin: user.is_admin || 0,
                setor: user.setor || null,
                apelido: user.apelido || null,
                foto: user.foto || user.avatar || null,
                avatar: user.avatar || user.foto || null,
                areas: (() => {
                    // Parse áreas do banco de dados
                    let areas = [];
                    if (user.areas) {
                        try {
                            areas = typeof user.areas === 'string' ? JSON.parse(user.areas) : (Array.isArray(user.areas) ? user.areas : []);
                        } catch(e) {
                            areas = String(user.areas).split(',').map(a => a.trim()).filter(a => a);
                        }
                    }
                    // Fallback: permissions-server.js
                    if (areas.length === 0) {
                        try {
                            const permServer = require('../../src/permissions-server');
                            const fn = (user.nome || '').split(' ')[0].toLowerCase() || (user.email || '').split('@')[0].split('.')[0].toLowerCase();
                            const serverAreas = permServer.getUserAreas(fn);
                            if (serverAreas && serverAreas.length > 0) areas = serverAreas;
                        } catch(e) {}
                    }
                    // Admin: todas as áreas
                    if (user.is_admin) {
                        areas = ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'];
                    }
                    return areas;
                })()
            }
        };
        res.json(payload);

        // 📸 POST-LOGIN: sync foto from funcionarios -> usuarios (fire-and-forget)
        (async () => {
            try {
                const [funcFoto] = await safeQuery(
                    'SELECT foto_perfil_url FROM funcionarios WHERE LOWER(email) = ? AND foto_perfil_url IS NOT NULL AND foto_perfil_url != "" LIMIT 1',
                    [user.email.toLowerCase()]
                );
                if (funcFoto && funcFoto.length > 0) {
                    const newFoto = funcFoto[0].foto_perfil_url;
                    if (newFoto && user.foto !== newFoto) {
                        await safeQuery(
                            'UPDATE usuarios SET foto = ?, avatar = ? WHERE id = ?',
                            [newFoto, newFoto, user.id]
                        );
                        console.log(`[AUTH/LOGIN] 📸 Foto sincronizada para ${user.email}`);
                    }
                }
            } catch (e) { /* fire-and-forget */ }
        })();

        auditLog('LOGIN_SUCCESS', user.id, `Login bem-sucedido: ${user.email}`, req);

        // TC-AUTH-01-001: Registrar sessão no Redis para controle de inatividade
        try {
            const cacheService = require('../../services/cache');
            const sessionKey = `session_activity:${user.id}:${deviceId}`;
            await cacheService.cacheSet(sessionKey, Date.now(), 4 * 60 * 60 * 1000 + 60000); // 4h + 1min margem (TC-AUTH-03-001)
            console.log(`[AUTH/LOGIN] 📡 Sessão registrada no Redis: ${sessionKey}`);
        } catch (redisErr) {
            console.warn('[AUTH/LOGIN] ⚠️ Redis session registration failed (non-blocking):', redisErr.message);
        }
    } catch (error) {
        // Log completo no servidor (stack quando disponível)
        console.error('Erro detalhado no login:', error.stack || error);
        // Envia apenas mensagem/texto para o cliente para evitar problemas de serialização
        res.status(500).json({ message: 'Erro inesperado no login' });
    }
});

// Rota para logout (limpa cookies, revoga refresh tokens e cache)
router.post('/logout', async (req, res) => {
    console.log('[AUTH/LOGOUT] 🚪 Logout requisitado');

    // Obter token para limpar cache e identificar usuário
    const token = req.cookies?.authToken || req.headers['authorization']?.replace('Bearer ', '');
    let userName = 'Usuário';
    let userId = null;

    // Tentar decodificar o token para obter dados do usuário
    if (token) {
        try {
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(token, JWT_SECRET);
            userName = decoded.nome || decoded.email || 'Usuário';
            userId = decoded.id;
        } catch (e) {
            // Token inválido, usa valores padrão
        }

        if (typeof global.cacheClearByToken === 'function') {
            global.cacheClearByToken(token);
            console.log('[AUTH/LOGOUT] 🗑️ Cache de sessão limpo');
        }
    }

    // Revogar todos os refresh tokens do usuário no banco
    if (userId && pool && !DEV_MOCK) {
        try {
            await refreshTokenModule.revokeAllUserTokens(pool, userId);
            console.log('[AUTH/LOGOUT] 🔒 Refresh tokens revogados para userId:', userId);
        } catch (e) {
            console.warn('[AUTH/LOGOUT] ⚠️ Erro ao revogar refresh tokens:', e.message);
        }
    }

    // Registrar logout no audit log
    if (typeof global.registrarAuditLog === 'function') {
        global.registrarAuditLog({
            usuario: userName,
            usuarioId: userId,
            acao: 'Logout',
            modulo: 'Sistema',
            descricao: `Usuário ${userName} realizou logout do sistema`,
            ip: req.ip || req.connection?.remoteAddress
        });
    }

    // Limpar cookie com as mesmas opções que foi criado
    const cookieOptions = {
        httpOnly: true,
        path: '/'
    };

    if (process.env.NODE_ENV === 'production') {
        cookieOptions.secure = true;
        cookieOptions.sameSite = 'strict';
    } else {
        cookieOptions.sameSite = 'lax';
    }

    res.clearCookie('authToken', cookieOptions);
    // Limpar cookie de refresh token
    res.clearCookie('refreshToken', cookieOptions);
    // Limpar também cookie legado com path restrito (migração)
    res.clearCookie('refreshToken', Object.assign({}, cookieOptions, { path: '/api/auth' }));
    // Limpar também o cookie de lembrar-me
    res.clearCookie('rememberToken', cookieOptions);
    console.log('[AUTH/LOGOUT] ✅ Cookies authToken, refreshToken e rememberToken limpos');
    res.json({ ok: true, message: 'Logout realizado com sucesso' });
});

// ===================== TOKEN REFRESH (ROTAÇÃO AUTOMÁTICA) =====================
// O access token (cookie authToken) expira em 15 min.
// O frontend chama esta rota para obter novos tokens sem re-login.
router.post('/auth/refresh', async (req, res) => {
    try {
        const oldRefreshToken = req.cookies?.refreshToken;

        if (!oldRefreshToken) {
            return res.status(401).json({ code: 'NO_REFRESH_TOKEN', message: 'Refresh token não fornecido.' });
        }

        if (DEV_MOCK) {
            return res.status(501).json({ message: 'Token refresh não disponível em modo mock.' });
        }

        // Detectar possível reuso de token revogado (ataque)
        const jwtLib = require('jsonwebtoken');
        let decoded;
        try {
            decoded = jwtLib.verify(oldRefreshToken, process.env.REFRESH_SECRET || JWT_SECRET + '_refresh');
        } catch (e) {
            return res.status(401).json({ code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token inválido ou expirado.' });
        }

        if (decoded.tokenId) {
            const reused = await refreshTokenModule.detectTokenReuse(pool, decoded.tokenId);
            if (reused) {
                // Token já foi usado/revogado — possível roubo: revogar TODOS os tokens do usuário
                await refreshTokenModule.revokeAllUserTokens(pool, decoded.userId);
                console.warn(`🚨 [SECURITY] Token reuse detected for userId ${decoded.userId} — all tokens revoked`);
                const clearOpts = { httpOnly: true, path: '/' };
                if (process.env.NODE_ENV === 'production') { clearOpts.secure = true; clearOpts.sameSite = 'strict'; } else { clearOpts.sameSite = 'lax'; }
                res.clearCookie('authToken', clearOpts);
                res.clearCookie('refreshToken', clearOpts);
                res.clearCookie('refreshToken', Object.assign({}, clearOpts, { path: '/api/auth' }));
                return res.status(401).json({ code: 'TOKEN_REUSE_DETECTED', message: 'Sessão comprometida. Faça login novamente.' });
            }
        }

        // Rotacionar tokens
        const result = await refreshTokenModule.refreshTokens(oldRefreshToken, pool);

        if (!result || !result.success) {
            return res.status(401).json({ code: 'REFRESH_FAILED', message: 'Não foi possível renovar sessão.' });
        }

        // Gerar novo access token com campos completos
        const newAccessToken = jwtLib.sign({
            id: result.user.id,
            nome: result.user.nome,
            email: result.user.username,
            role: result.user.role,
            deviceId: decoded.deviceId || 'default',
            type: 'access'
        }, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: refreshTokenModule.ACCESS_TOKEN_EXPIRY });

        // Cookie options
        const cookieOpts = { httpOnly: true, path: '/' };
        if (process.env.NODE_ENV === 'production') {
            cookieOpts.secure = true;
            cookieOpts.sameSite = 'strict';
        } else {
            cookieOpts.sameSite = 'lax';
        }

        // Setar novos cookies
        res.cookie('authToken', newAccessToken, Object.assign({}, cookieOpts, { maxAge: 1000 * 60 * 15 }));
        res.cookie('refreshToken', result.refreshToken, Object.assign({}, cookieOpts, {
            maxAge: 1000 * 60 * 60 * 24 * 7
        }));

        console.log(`[AUTH/REFRESH] ✅ Tokens renovados para userId ${result.user.id}`);

        res.json({
            success: true,
            user: result.user
        });

    } catch (error) {
        console.error('[AUTH/REFRESH] ❌ Erro:', error.message);
        res.status(401).json({ code: 'REFRESH_ERROR', message: 'Erro ao renovar sessão. Faça login novamente.' });
    }
});

// ===================== ROTAS DE RECUPERAÇÃO DE SENHA (SECURED) =====================
// AUDIT-FIX: Replaced insecure 3-step flow (userId leak + IDOR) with signed token system.
// Token is time-limited (15 min), hashed in DB, and tied to user email.

// crypto já importado no topo do arquivo

// Ensure password_reset_tokens table exists
async function ensurePasswordResetTokensTable() {
    try {
        await safeQuery(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            token_hash VARCHAR(128) NOT NULL,
            expires_at DATETIME NOT NULL,
            used TINYINT(1) DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_token_hash (token_hash),
            INDEX idx_user_id (user_id)
        )`);
    } catch (e) {
        console.error('[AUTH] Erro ao criar tabela password_reset_tokens:', e.message);
    }
}

// Passo 1: Verificar se o email existe no sistema
// AUDIT-FIX: No longer returns userId to client. Returns only success boolean.
router.post('/auth/verify-email', async (req, res) => {
    try {
        const { email } = req.body;
        console.log('[AUTH/VERIFY-EMAIL] Verificando email:', email);

        if (!email || !email.includes('@')) {
            return res.status(400).json({ message: 'Email inválido.' });
        }

        // Verifica se email existe no banco
        const [rows] = await safeQuery('SELECT id, nome, email, setor FROM usuarios WHERE email = ? LIMIT 1', [email]);

        if (!rows.length) {
            // SECURITY: Return 200 with generic message to prevent user enumeration
            return res.json({ success: true, message: 'Verificação concluída.' });
        }

        const user = rows[0];
        console.log('[AUTH/VERIFY-EMAIL] ✅ Email encontrado, userId:', user.id);

        // AUDIT-FIX: Do NOT return userId to client — prevents IDOR attack
        res.json({
            success: true,
            message: 'Verificação concluída.'
        });
    } catch (error) {
        console.error('[AUTH/VERIFY-EMAIL] Erro:', error.stack || error);
        res.status(500).json({
            message: 'Erro ao verificar email.'
        });
    }
});

// Passo 2: DESCONTINUADO — fluxo de recuperação agora usa apenas link por email (POST /api/auth/forgot-password)
router.post('/auth/verify-user-data', (req, res) => {
    res.status(410).json({ message: 'Este endpoint foi descontinuado. Use POST /api/auth/forgot-password.' });
});

// Passo 3: DESCONTINUADO — fluxo de recuperação agora usa apenas link por email (POST /api/auth/forgot-password)
router.post('/auth/change-password', (req, res) => {
    res.status(410).json({ message: 'Este endpoint foi descontinuado. Use POST /api/auth/forgot-password.' });
});

// ===================== FUNCIONALIDADE "LEMBRAR-ME" =====================

// Cria tabela de refresh tokens se não existir (schema unificado: remember-me + token refresh)
async function ensureRefreshTokensTable() {
    try {
        // Criar tabela com schema completo (suporta remember-me e token refresh)
        await safeQuery(`
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                token_id VARCHAR(64) NULL UNIQUE,
                user_id INT NOT NULL,
                token VARCHAR(512) NULL UNIQUE,
                device_id VARCHAR(100) DEFAULT 'default',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                revoked TINYINT(1) DEFAULT 0,
                revoked_at DATETIME NULL,
                used TINYINT(1) DEFAULT 0,
                used_at DATETIME NULL,
                replaced_by VARCHAR(64) NULL,
                INDEX idx_user_id (user_id),
                INDEX idx_token (token),
                INDEX idx_token_id (token_id),
                INDEX idx_user_device (user_id, device_id),
                INDEX idx_expires (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        // Migração: adicionar colunas se tabela já existia com schema antigo
        // Migração: garantir que token aceita NULL (schema antigo era NOT NULL)
        try { await safeQuery('ALTER TABLE refresh_tokens MODIFY COLUMN token VARCHAR(512) NULL'); } catch (e) { /* já está NULL */ }

        const columnsToAdd = [
            { name: 'token_id', sql: 'ALTER TABLE refresh_tokens ADD COLUMN token_id VARCHAR(64) NULL UNIQUE AFTER id' },
            { name: 'device_id', sql: 'ALTER TABLE refresh_tokens ADD COLUMN device_id VARCHAR(100) DEFAULT \'default\' AFTER token' },
            { name: 'revoked', sql: 'ALTER TABLE refresh_tokens ADD COLUMN revoked TINYINT(1) DEFAULT 0 AFTER expires_at' },
            { name: 'revoked_at', sql: 'ALTER TABLE refresh_tokens ADD COLUMN revoked_at DATETIME NULL AFTER revoked' },
            { name: 'used', sql: 'ALTER TABLE refresh_tokens ADD COLUMN used TINYINT(1) DEFAULT 0 AFTER revoked_at' },
            { name: 'used_at', sql: 'ALTER TABLE refresh_tokens ADD COLUMN used_at DATETIME NULL AFTER used' },
            { name: 'replaced_by', sql: 'ALTER TABLE refresh_tokens ADD COLUMN replaced_by VARCHAR(64) NULL AFTER used_at' }
        ];
        const [columns] = await safeQuery('SHOW COLUMNS FROM refresh_tokens');
        const existingCols = new Set(columns.map(c => c.Field));
        for (const col of columnsToAdd) {
            if (!existingCols.has(col.name)) {
                try { await safeQuery(col.sql); console.log(`[AUTH] ✅ Coluna ${col.name} adicionada à refresh_tokens`); } catch (e) { /* já existe */ }
            }
        }
        console.log('[AUTH] ✅ Tabela refresh_tokens verificada/criada (schema unificado)');
    } catch (error) {
        console.error('[AUTH] ⚠️ Erro ao criar tabela refresh_tokens:', error.message);
    }
}

// Garante que a tabela existe ao inicializar
if (!DEV_MOCK) {
    ensureRefreshTokensTable();
}

// Limpa tokens expirados (executa a cada 1 hora)
setInterval(async () => {
    if (!DEV_MOCK) {
        try {
            const [result] = await safeQuery('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
            if (result.affectedRows > 0) {
                console.log(`[AUTH/CLEANUP] 🗑️ ${result.affectedRows} tokens expirados removidos`);
            }
        } catch (error) {
            console.error('[AUTH/CLEANUP] Erro ao limpar tokens:', error.message);
        }
    }
}, 60 * 60 * 1000); // 1 hora

// Criar refresh token para "Lembrar-me"
// AUDIT-FIX: Added JWT authentication check — only authenticated users can create remember-me tokens
router.post('/auth/create-remember-token', async (req, res) => {
    try {
        // AUDIT-FIX: Verify the JWT cookie before allowing token creation
        const authToken = req.cookies?.authToken;
        if (!authToken) {
            return res.status(401).json({ message: 'Autenticação necessária para criar token de lembrar-me.' });
        }

        let decoded;
        try {
            decoded = jwt.verify(authToken, JWT_SECRET, { algorithms: ['HS256'] });
        } catch (jwtErr) {
            return res.status(401).json({ message: 'Token de autenticação inválido ou expirado.' });
        }

        // Use the authenticated user's ID, not the request body (prevents IDOR)
        const userId = decoded.id;
        const email = decoded.email;
        console.log('[AUTH/REMEMBER-TOKEN] Criando token para userId autenticado:', userId);

        // Verifica se usuário existe
        const [rows] = await safeQuery('SELECT id, nome, email, role, setor FROM usuarios WHERE id = ? AND email = ? LIMIT 1', [userId, email]);

        if (!rows.length) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const user = rows[0];

        // Gera token seguro (30 dias de validade)
        const crypto = require('crypto');
        const rememberToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias

        // AUDIT-FIX SEC-005: Hash token before storing (if DB leaks, tokens are useless)
        const tokenHash = crypto.createHash('sha256').update(rememberToken).digest('hex');
        await safeQuery(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [userId, tokenHash, expiresAt]
        );

        console.log('[AUTH/REMEMBER-TOKEN] ✅ Token criado e salvo no banco');

        // Define cookie httpOnly com o token
        const cookieOptions = {
            httpOnly: true,
            path: '/',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 dias
        };

        if (process.env.NODE_ENV === 'production') {
            cookieOptions.secure = true;
            cookieOptions.sameSite = 'strict';
        } else {
            cookieOptions.sameSite = 'lax';
        }

        res.cookie('rememberToken', rememberToken, cookieOptions);

        res.json({
            success: true,
            message: 'Token de lembrar-me criado com sucesso.'
        });
    } catch (error) {
        console.error('[AUTH/REMEMBER-TOKEN] Erro:', error.stack || error);
        res.status(500).json({
            message: 'Erro ao criar token de lembrar-me.'
        });
    }
});

// Validar refresh token e fazer login automático
router.post('/auth/validate-remember-token', async (req, res) => {
    try {
        const rememberToken = req.cookies.rememberToken;
        console.log('[AUTH/VALIDATE-REMEMBER] Validando token...');

        if (!rememberToken) {
            // 204 No Content instead of 401 — avoids red console error on login page
            return res.status(204).end();
        }

        // AUDIT-FIX SEC-005: Compare by hash, not plaintext token
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(rememberToken).digest('hex');
        const [rows] = await safeQuery(`
            SELECT rt.*, u.id, u.nome, u.email, u.role, u.setor
            FROM refresh_tokens rt
            JOIN usuarios u ON rt.user_id = u.id
            WHERE rt.token = ? AND rt.expires_at > NOW()
            LIMIT 1
        `, [tokenHash]);

        if (!rows.length) {
            // Token inválido ou expirado - limpa cookie
            res.clearCookie('rememberToken');
            return res.status(401).json({ message: 'Token inválido ou expirado.' });
        }

        const tokenData = rows[0];
        const user = {
            id: tokenData.id,
            nome: tokenData.nome,
            email: tokenData.email,
            role: tokenData.role,
            setor: tokenData.setor
        };

        console.log('[AUTH/VALIDATE-REMEMBER] ✅ Token válido para userId:', user.id);

        // 🔐 FIX: Gerar deviceId para isolamento de sessão (igual ao login normal)
        const deviceId = uuidv4();

        // Gerar PAR de tokens (access 15m + refresh 7d) igual ao login normal
        const tokenPair = await refreshTokenModule.generateTokenPair(
            { id: user.id, username: user.email, nome: user.nome, role: user.role },
            pool,
            deviceId
        );

        // Access token com campos completos
        const accessToken = jwt.sign({
            id: user.id,
            nome: user.nome,
            email: user.email,
            role: user.role,
            setor: user.setor || null,
            deviceId: deviceId,
            type: 'access'
        }, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: refreshTokenModule.ACCESS_TOKEN_EXPIRY });

        // Cookie options
        const cookieOptions = {
            httpOnly: true,
            path: '/'
        };

        if (process.env.NODE_ENV === 'production') {
            cookieOptions.secure = true;
            cookieOptions.sameSite = 'strict';
        } else {
            cookieOptions.sameSite = 'lax';
        }

        // Access token (15 min)
        res.cookie('authToken', accessToken, Object.assign({}, cookieOptions, { maxAge: 1000 * 60 * 15 }));
        // Refresh token (7 dias)
        res.cookie('refreshToken', tokenPair.refreshToken, Object.assign({}, cookieOptions, {
            maxAge: 1000 * 60 * 60 * 24 * 7
        }));

        res.json({
            success: true,
            user: user,
            message: 'Login automático realizado com sucesso.'
        });
    } catch (error) {
        // Se a tabela refresh_tokens não existir, retorna 401 (não 500)
        // Isso é esperado na primeira execução antes da tabela ser criada
        if (error.code === 'ER_NO_SUCH_TABLE') {
            console.warn('[AUTH/VALIDATE-REMEMBER] Tabela refresh_tokens não existe ainda');
            res.clearCookie('rememberToken');
            return res.status(401).json({ message: 'Funcionalidade de lembrar-me não disponível.' });
        }
        console.error('[AUTH/VALIDATE-REMEMBER] Erro:', error.code || error.message);
        // Retorna 401 em vez de 500 para erros de DB - o cliente trata como "sem token"
        res.clearCookie('rememberToken');
        res.status(401).json({
            message: 'Erro ao validar token de lembrar-me.'
        });
    }
});

// Remover token de lembrar-me (ao desmarcar checkbox)
router.post('/auth/remove-remember-token', async (req, res) => {
    try {
        const rememberToken = req.cookies.rememberToken;
        console.log('[AUTH/REMOVE-REMEMBER] Removendo token...');

        if (!rememberToken) {
            return res.json({ success: true, message: 'Nenhum token para remover.' });
        }

        // AUDIT-FIX SEC-005: Remove by hash, not plaintext
        const crypto = require('crypto');
        const tokenHash = crypto.createHash('sha256').update(rememberToken).digest('hex');
        await safeQuery('DELETE FROM refresh_tokens WHERE token = ?', [tokenHash]);

        // Limpa cookie
        res.clearCookie('rememberToken');

        console.log('[AUTH/REMOVE-REMEMBER] ✅ Token removido');

        res.json({
            success: true,
            message: 'Token de lembrar-me removido com sucesso.'
        });
    } catch (error) {
        console.error('[AUTH/REMOVE-REMEMBER] Erro:', error.stack || error);
        res.status(500).json({
            message: 'Erro ao remover token de lembrar-me.'
        });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// 🔐 ROTA 2FA - VERIFICAÇÃO DO CÓDIGO DE DOIS FATORES
// ════════════════════════════════════════════════════════════════════════════
router.post('/verify-2fa', async (req, res) => {
    const { pendingToken, code, rememberDevice } = req.body;

    if (!pendingToken || !code) {
        return res.status(400).json({ message: 'Token e código são obrigatórios.' });
    }

    try {
        // Buscar o registro 2FA pendente
        const [rows] = await safeQuery(
            'SELECT expira_em, tentativas, codigo, usuario_id, email FROM auth_2fa_codes WHERE pending_token = ? AND usado = 0',
            [pendingToken]
        );

        if (!rows.length) {
            return res.status(401).json({ message: 'Código expirado ou inválido. Faça login novamente.' });
        }

        const registro = rows[0];

        // Verificar expiração
        if (new Date(registro.expira_em) < new Date()) {
            await safeQuery('DELETE FROM auth_2fa_codes WHERE pending_token = ?', [pendingToken]);
            return res.status(401).json({ message: 'Código expirado. Faça login novamente.', expired: true });
        }

        // Verificar tentativas (máximo 5)
        if (registro.tentativas >= 5) {
            await safeQuery('DELETE FROM auth_2fa_codes WHERE pending_token = ?', [pendingToken]);
            return res.status(429).json({ message: 'Muitas tentativas incorretas. Faça login novamente.', expired: true });
        }

        // Verificar código (timing-safe comparison)
        const codeA = Buffer.from(registro.codigo || '');
        const codeB = Buffer.from((code || '').trim());
        if (codeA.length !== codeB.length || !crypto.timingSafeEqual(codeA, codeB)) {
            await safeQuery('UPDATE auth_2fa_codes SET tentativas = tentativas + 1 WHERE pending_token = ?', [pendingToken]);
            const restantes = 4 - registro.tentativas;
            return res.status(401).json({
                message: `Código incorreto. ${restantes > 0 ? restantes + ' tentativa(s) restante(s).' : 'Última tentativa.'}`,
                attemptsLeft: restantes
            });
        }

        // ✅ Código válido! Marcar como usado
        await safeQuery('DELETE FROM auth_2fa_codes WHERE pending_token = ?', [pendingToken]);

        // Buscar dados completos do usuário
        const [userRows] = await safeQuery('SELECT id, nome, email, role, setor, empresa_id, cargo, status, avatar_url, is_admin, apelido, foto, avatar, areas FROM usuarios WHERE id = ?', [registro.usuario_id]);
        if (!userRows.length) {
            return res.status(500).json({ message: 'Erro interno: usuário não encontrado.' });
        }

        const user = userRows[0];

        // 🔐 MULTI-DEVICE: Gerar deviceId
        const deviceId = uuidv4();
        console.log(`[AUTH/2FA] ✅ 2FA verificado para ${user.email}, DeviceId: ${deviceId.substring(0, 8)}...`);

        // Gerar PAR de tokens: access (15m) + refresh (7d) com rotação (igual login normal)
        const tokenPair = await refreshTokenModule.generateTokenPair(
            { id: user.id, username: user.email, nome: user.nome, role: user.role, empresa_id: user.empresa_id, area: user.areas },
            pool,
            deviceId
        );
        const accessToken = jwt.sign({
            id: user.id,
            nome: user.nome,
            email: user.email,
            role: user.role,
            setor: user.setor || null,
            deviceId: deviceId,
            type: 'access'
        }, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: refreshTokenModule.ACCESS_TOKEN_EXPIRY });

        // Configurar cookie
        const cookieOptions = { httpOnly: true, path: '/' };
        if (process.env.NODE_ENV === 'production') {
            cookieOptions.secure = true;
            cookieOptions.sameSite = 'strict';
        } else {
            cookieOptions.sameSite = 'lax';
        }
        // Access token cookie: 15 minutos
        const accessCookieOptions = Object.assign({}, cookieOptions, { maxAge: 1000 * 60 * 15 });
        res.cookie('authToken', accessToken, accessCookieOptions);
        // Refresh token cookie: 7 dias
        const refreshCookieOptions = Object.assign({}, cookieOptions, { maxAge: 1000 * 60 * 60 * 24 * 7 });
        res.cookie('refreshToken', tokenPair.refreshToken, refreshCookieOptions);

        console.log('[AUTH/2FA] ✅ Cookies authToken (15m) + refreshToken (7d) setados para userId:', user.id);

        // 🔐 Salvar dispositivo confiável se solicitado
        let savedTrustedToken = null;
        if (rememberDevice) {
            try {
                const trustedToken = uuidv4();
                const thirtyDays = 30 * 24 * 60 * 60 * 1000;
                const trustedExpira = new Date(Date.now() + thirtyDays);
                const userAgent = (req.headers['user-agent'] || '').substring(0, 500);
                const ipAddress = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || '';

                await safeQuery(`
                    CREATE TABLE IF NOT EXISTS auth_trusted_devices (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        usuario_id INT NOT NULL,
                        device_token VARCHAR(100) NOT NULL UNIQUE,
                        user_agent VARCHAR(500) DEFAULT NULL,
                        ip_address VARCHAR(45) DEFAULT NULL,
                        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                        expira_em DATETIME NOT NULL,
                        INDEX idx_device_token (device_token),
                        INDEX idx_usuario (usuario_id),
                        INDEX idx_expira (expira_em)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                `);

                // Limitar a 5 dispositivos por usuário (remover o mais antigo)
                const [existingDevices] = await safeQuery(
                    'SELECT id FROM auth_trusted_devices WHERE usuario_id = ? ORDER BY criado_em DESC',
                    [user.id]
                );
                if (existingDevices && existingDevices.length >= 5) {
                    const idsToDelete = existingDevices.slice(4).map(d => d.id);
                    if (idsToDelete.length > 0) {
                        await safeQuery('DELETE FROM auth_trusted_devices WHERE id IN (?)', [idsToDelete]);
                    }
                }

                await safeQuery(
                    'INSERT INTO auth_trusted_devices (usuario_id, device_token, user_agent, ip_address, expira_em) VALUES (?, ?, ?, ?, ?)',
                    [user.id, trustedToken, userAgent, ipAddress, trustedExpira]
                );

                // Setar cookie httpOnly de longa duração (30 dias)
                const trustedCookieOpts = {
                    httpOnly: true,
                    path: '/',
                    maxAge: thirtyDays,
                    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
                };
                if (process.env.NODE_ENV === 'production') {
                    trustedCookieOpts.secure = true;
                }
                res.cookie('trusted_device_2fa', trustedToken, trustedCookieOpts);
                savedTrustedToken = trustedToken; // Salvar para enviar no JSON response

                console.log(`[AUTH/2FA] 🔒 Dispositivo confiável salvo para userId ${user.id} (30 dias)`);
                console.log(`[AUTH/2FA] 🔒 Cookie trusted_device_2fa setado com maxAge: ${thirtyDays}ms, secure: ${process.env.NODE_ENV === 'production'}, sameSite: ${process.env.NODE_ENV === 'production' ? 'strict' : 'lax'}`);
            } catch (trustErr) {
                console.error('[AUTH/2FA] ⚠️ Erro ao salvar dispositivo confiável:', trustErr.message);
                console.error('[AUTH/2FA] ⚠️ Erro:', trustErr.message);
                // Não impede o login — continua normalmente
            }
        }

        const redirectTo = '/dashboard';

        // SECURITY: Token is NOT included in JSON response — delivered only via httpOnly cookie
        const payload = {
            success: true,
            deviceId,
            redirectTo,
            trustedDeviceToken: savedTrustedToken || null, // 🔐 Backup — also set as httpOnly cookie trusted_device_2fa
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                role: user.role,
                is_admin: user.is_admin || 0,
                setor: user.setor || null,
                apelido: user.apelido || null,
                foto: user.foto || user.avatar || null,
                avatar: user.avatar || user.foto || null,
                areas: (() => {
                    let areas = [];
                    if (user.areas) {
                        try {
                            areas = typeof user.areas === 'string' ? JSON.parse(user.areas) : (Array.isArray(user.areas) ? user.areas : []);
                        } catch(e) {
                            areas = String(user.areas).split(',').map(a => a.trim()).filter(a => a);
                        }
                    }
                    if (areas.length === 0) {
                        try {
                            const permServer = require('../../src/permissions-server');
                            const fn = (user.nome || '').split(' ')[0].toLowerCase() || (user.email || '').split('@')[0].split('.')[0].toLowerCase();
                            const serverAreas = permServer.getUserAreas(fn);
                            if (serverAreas && serverAreas.length > 0) areas = serverAreas;
                        } catch(e) {}
                    }
                    if (user.is_admin) {
                        areas = ['vendas', 'rh', 'pcp', 'financeiro', 'nfe', 'compras', 'ti'];
                    }
                    return areas;
                })()
            }
        };

        console.log(`[AUTH/2FA] 📤 Resposta verify-2fa: trustedDeviceToken ${savedTrustedToken ? 'incluído' : 'NÃO incluído'}`);
        res.json(payload);

    } catch (error) {
        console.error('[AUTH/2FA] Erro ao verificar código:', error.stack || error);
        res.status(500).json({ message: 'Erro ao verificar código. Tente novamente.' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// 🔐 ROTA 2FA - REENVIAR CÓDIGO
// ════════════════════════════════════════════════════════════════════════════
router.post('/resend-2fa', async (req, res) => {
    const { pendingToken } = req.body;

    if (!pendingToken) {
        return res.status(400).json({ message: 'Token pendente é obrigatório.' });
    }

    try {
        // Buscar registro existente
        const [rows] = await safeQuery(
            'SELECT usuario_id, email FROM auth_2fa_codes WHERE pending_token = ? AND usado = 0',
            [pendingToken]
        );

        if (!rows.length) {
            return res.status(401).json({ message: 'Sessão expirada. Faça login novamente.', expired: true });
        }

        const registro = rows[0];

        // Gerar novo código
        const crypto = require('crypto');
        const novoCodigo = crypto.randomInt(100000, 999999).toString();
        const novaExpiracao = new Date(Date.now() + 5 * 60 * 1000);

        // Atualizar no banco
        await safeQuery(
            'UPDATE auth_2fa_codes SET codigo = ?, expira_em = ?, tentativas = 0 WHERE pending_token = ?',
            [novoCodigo, novaExpiracao, pendingToken]
        );

        // Buscar nome do usuário
        const [userRows] = await safeQuery('SELECT nome, email FROM usuarios WHERE id = ?', [registro.usuario_id]);
        const nomeUsuario = userRows.length ? (userRows[0].nome || userRows[0].email.split('@')[0]).split(' ')[0] : 'Usuário';
        const emailDestinatario = userRows.length ? userRows[0].email : registro.email;

        // Reenviar email com retry
        let emailEnviado = false;
        for (let tentativa = 1; tentativa <= 3; tentativa++) {
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST || 'mail.aluforce.ind.br',
                    port: parseInt(process.env.SMTP_PORT) || 465,
                    secure: (process.env.SMTP_SECURE !== 'false'),
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS
                    },
                    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
                    connectionTimeout: 10000,
                    greetingTimeout: 10000,
                    socketTimeout: 15000
                });

                // Capturar info do dispositivo para o resend
                const resendIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || 'Desconhecido';
                const resendDate = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                const resendUA = req.headers['user-agent'] || 'Desconhecido';
                const parseBrowserResend = (ua) => {
                    if (!ua || ua === 'Desconhecido') return 'Desconhecido';
                    let browser = 'Navegador desconhecido', os = '';
                    if (ua.includes('Edg/')) browser = 'Edge ' + (ua.match(/Edg\/(\d+)/)||[])[1];
                    else if (ua.includes('Chrome/')) browser = 'Chrome ' + (ua.match(/Chrome\/(\d+)/)||[])[1];
                    else if (ua.includes('Firefox/')) browser = 'Firefox ' + (ua.match(/Firefox\/(\d+)/)||[])[1];
                    else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';
                    if (ua.includes('Windows NT 10')) os = 'Windows 10';
                    else if (ua.includes('Windows NT')) os = 'Windows';
                    else if (ua.includes('Mac OS X')) os = 'macOS';
                    else if (ua.includes('Linux')) os = 'Linux';
                    else if (ua.includes('Android')) os = 'Android';
                    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
                    return os ? `${browser} no ${os}` : browser;
                };
                const resendBrowser = parseBrowserResend(resendUA);

                await transporter.sendMail({
                    from: `"Zyntra" <${process.env.SMTP_USER || 'sistema@aluforce.ind.br'}>`,
                    to: emailDestinatario,
                    subject: `Novo código de verificação Zyntra`,
                    html: `
<div style="margin:0;padding:0;background-color:#1a1a2e;width:100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#1a1a2e" style="background-color:#1a1a2e;">
    <tr><td align="center" bgcolor="#1a1a2e" style="padding:32px 16px;background-color:#1a1a2e;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="520" style="max-width:520px;width:100%;">
        <tr><td bgcolor="#1a1a2e" style="padding:24px 0 28px;text-align:center;background-color:#1a1a2e;">
          <img src="https://aluforce.api.br/images/zyntra-branco.png" alt="Zyntra" style="height:48px;width:auto;display:inline-block;" />
        </td></tr>
        <tr><td bgcolor="#242442" style="background-color:#242442;border-radius:16px;overflow:hidden;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#242442">
            <tr><td bgcolor="#242442" style="padding:40px 36px 32px;background-color:#242442;">
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:16px;color:#e2e8f0;margin:0 0 8px;">Olá <strong>${nomeUsuario}</strong>,</p>
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#94a3b8;margin:0 0 28px;line-height:1.6;">Aqui está seu novo código de verificação Zyntra:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;">
                <tr><td bgcolor="#1a1a2e" style="background-color:#1a1a2e;border-radius:12px;padding:24px;text-align:center;">
                  <span style="font-family:'Courier New',monospace;font-size:38px;font-weight:700;letter-spacing:10px;color:#ffffff;">${novoCodigo}</span>
                </td></tr>
              </table>
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#94a3b8;text-align:center;margin:0 0 28px;">Digite este código na tela de verificação para liberar seu acesso.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                <tr><td bgcolor="#1e1e3a" style="background-color:#1e1e3a;border-radius:10px;padding:16px 20px;border-left:3px solid #6366f1;">
                  <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#cbd5e1;margin:0 0 4px;">Data: <strong style="color:#e2e8f0;">${resendDate}</strong></p>
                  <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#cbd5e1;margin:0 0 4px;">IP: <strong style="color:#e2e8f0;">${resendIP}</strong></p>
                  <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#cbd5e1;margin:0;">Navegador: <strong style="color:#e2e8f0;">${resendBrowser}</strong></p>
                </td></tr>
              </table>
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#94a3b8;margin:0;line-height:1.6;">Se não foi você, recomendamos redefinir suas credenciais imediatamente.</p>
            </td></tr>
            <tr><td bgcolor="#242442" style="padding:0 36px;background-color:#242442;"><div style="height:1px;background-color:#374151;"></div></td></tr>
            <tr><td bgcolor="#242442" style="padding:20px 36px 28px;background-color:#242442;">
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#64748b;margin:0;text-align:center;">— Zyntra</p>
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#475569;margin:8px 0 0;text-align:center;">Este é um email automático, não responda.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>
                    `
                });

                emailEnviado = true;
                console.log(`[AUTH/2FA] ✅ Código reenviado para ${emailDestinatario} (tentativa ${tentativa})`);
                break;

            } catch (retryErr) {
                console.error(`[AUTH/2FA-RESEND] ⚠️ Tentativa ${tentativa}/3 falhou:`, retryErr.message);
                if (tentativa < 3) {
                    await new Promise(r => setTimeout(r, tentativa * 1000));
                }
            }
        }

        if (!emailEnviado) {
            return res.status(500).json({ message: 'Erro ao enviar email. Verifique sua conexão e tente novamente.' });
        }

        const emailParts = emailDestinatario.split('@');
        const maskedEmail = emailParts[0].substring(0, 2) + '***@' + emailParts[1];

        res.json({ success: true, maskedEmail, message: 'Novo código enviado com sucesso!' });

    } catch (error) {
        console.error('[AUTH/2FA-RESEND] Erro:', error.stack || error);
        res.status(500).json({ message: 'Erro ao reenviar código. Tente novamente.' });
    }
});

// ===================== ROTA TROCA OBRIGATÓRIA DE SENHA TEMPORÁRIA =====================
// Usuário autenticado com senha temporária precisa definir uma senha definitiva
router.post('/auth/force-change-password', async (req, res) => {
    try {
        const { newPassword } = req.body;
        // SECURITY: Read token from httpOnly cookie (primary) or body (legacy fallback)
        const token = req.cookies?.authToken || req.body.token;

        if (!token || !newPassword) {
            return res.status(400).json({ success: false, message: 'Dados incompletos.' });
        }

        const pwCheck = validatePasswordStrength(newPassword);
        if (!pwCheck.valid) {
            return res.status(400).json({ success: false, message: pwCheck.errors.join('. ') });
        }

        // Decodifica o token JWT para obter o userId
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        } catch (err) {
            console.error('[AUTH/FORCE-CHANGE] ❌ Token inválido:', err.message);
            return res.status(401).json({ success: false, message: 'Sessão inválida. Faça login novamente.' });
        }

        const userId = decoded.id;
        console.log(`[AUTH/FORCE-CHANGE] 🔑 Troca obrigatória para userId: ${userId}`);

        // Verifica se o usuário realmente tem senha temporária
        const [rows] = await safeQuery('SELECT id, email, senha_temporaria FROM usuarios WHERE id = ? LIMIT 1', [userId]);
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
        }

        if (!rows[0].senha_temporaria) {
            return res.status(400).json({ success: false, message: 'Nenhuma troca de senha pendente.' });
        }

        // Hash da nova senha
        const senhaHash = await bcrypt.hash(newPassword, 12);

        // Atualiza senha_hash (coluna canônica) e remove flag de temporária
        await safeQuery('UPDATE usuarios SET senha_hash = ?, senha_temporaria = 0 WHERE id = ?', [senhaHash, userId]);
        console.log(`[AUTH/FORCE-CHANGE] ✅ Senha definitiva salva para userId: ${userId}`);

        auditLog('PASSWORD_FORCE_CHANGE', userId, 'Troca obrigatória de senha temporária', req);

        res.json({ success: true, message: 'Senha alterada com sucesso!' });

    } catch (error) {
        console.error('[AUTH/FORCE-CHANGE] ❌ Erro:', error.stack || error);
        res.status(500).json({ success: false, message: 'Erro ao alterar senha. Tente novamente.' });
    }
});

// ===================== ROTA ESQUECI-SENHA (1-step) =====================
// Recebe email, gera nova senha aleatória, atualiza no banco e envia por email
// Frontend: public/esqueci-senha.html faz POST /api/auth/esqueci-senha
router.post('/auth/esqueci-senha', async (req, res) => {
    try {
        const { email } = req.body;
        console.log('[AUTH/ESQUECI-SENHA] Solicitação recebida');

        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, message: 'Email inválido.' });
        }

        // Busca usuário pelo email
        const [rows] = await safeQuery('SELECT id, nome, email FROM usuarios WHERE email = ? LIMIT 1', [email]);

        if (!rows.length) {
            // Retorna sucesso genérico para evitar enumeração de emails
            console.log('[AUTH/ESQUECI-SENHA] Email não encontrado');
            return res.json({
                success: true,
                message: 'Se o email estiver cadastrado, uma nova senha será enviada.'
            });
        }

        const user = rows[0];
        const nome = (user.nome || email.split('@')[0]).split(' ')[0];

        // Gera nova senha aleatória que atende à política de segurança (12 chars)
        const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const lower = 'abcdefghjkmnpqrstuvwxyz';
        const digits = '23456789';
        const special = '!@#$%&*';
        const all = upper + lower + digits + special;
        // Garante pelo menos 1 de cada tipo
        let novaSenha = '';
        novaSenha += upper.charAt(crypto.randomInt(upper.length));
        novaSenha += lower.charAt(crypto.randomInt(lower.length));
        novaSenha += digits.charAt(crypto.randomInt(digits.length));
        novaSenha += special.charAt(crypto.randomInt(special.length));
        for (let i = 4; i < 12; i++) {
            novaSenha += all.charAt(crypto.randomInt(all.length));
        }
        // Embaralha a senha (Fisher-Yates com crypto seguro)
        const arr1 = novaSenha.split('');
        for (let i = arr1.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [arr1[i], arr1[j]] = [arr1[j], arr1[i]]; }
        novaSenha = arr1.join('');

        // Hash da nova senha
        const senhaHash = await bcrypt.hash(novaSenha, 12);

        // Atualiza no banco (senha_hash + flag de senha temporária)
        await safeQuery('UPDATE usuarios SET senha_hash = ?, senha_temporaria = 1 WHERE id = ?', [senhaHash, user.id]);
        console.log('[AUTH/ESQUECI-SENHA] ✅ Senha temporária atualizada no banco para userId:', user.id);

        // Carrega template de email
        const templates = require('../../config/email-templates');
        const htmlContent = templates.recuperacaoSenha.html(nome, novaSenha);

        // Envia email com a nova senha
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.hostinger.com',
            port: parseInt(process.env.SMTP_PORT) || 465,
            secure: true,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000
        });

        await transporter.sendMail({
            from: `"Zyntra" <${process.env.SMTP_USER || 'sistema@aluforce.ind.br'}>`,
            to: user.email,
            subject: templates.recuperacaoSenha.assunto,
            html: htmlContent
        });

        console.log(`[AUTH/ESQUECI-SENHA] ✅ Email de recuperação enviado para userId ${user.id}`);

        auditLog('PASSWORD_RESET_REQUEST', user.id, 'Recuperação de senha solicitada', req);

        res.json({
            success: true,
            message: 'Nova senha enviada para o email informado.'
        });

    } catch (error) {
        console.error('[AUTH/ESQUECI-SENHA] ❌ Erro:', error.stack || error);
        res.status(500).json({
            success: false,
            message: 'Erro ao processar solicitação. Tente novamente.'
        });
    }
});

// ===================== ALIAS: /auth/forgot-password → esqueci-senha =====================
// O modal de "Esqueci minha senha" do login.js chama /api/auth/forgot-password
// Este alias redireciona para a mesma lógica do esqueci-senha
router.post('/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        console.log('[AUTH/FORGOT-PASSWORD] Alias → esqueci-senha');

        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, message: 'Email inválido.' });
        }

        // Busca usuário pelo email
        const [rows] = await safeQuery('SELECT id, nome, email FROM usuarios WHERE email = ? LIMIT 1', [email]);

        if (!rows.length) {
            console.log('[AUTH/FORGOT-PASSWORD] Email não encontrado');
            return res.json({
                success: true,
                message: 'Se o email estiver cadastrado, uma nova senha será enviada.'
            });
        }

        const user = rows[0];
        const nome = (user.nome || email.split('@')[0]).split(' ')[0];

        // Gera nova senha aleatória que atende à política de segurança (12 chars)
        const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const lower = 'abcdefghjkmnpqrstuvwxyz';
        const digits = '23456789';
        const special = '!@#$%&*';
        const all = upper + lower + digits + special;
        let novaSenha = '';
        novaSenha += upper.charAt(crypto.randomInt(upper.length));
        novaSenha += lower.charAt(crypto.randomInt(lower.length));
        novaSenha += digits.charAt(crypto.randomInt(digits.length));
        novaSenha += special.charAt(crypto.randomInt(special.length));
        for (let i = 4; i < 12; i++) {
            novaSenha += all.charAt(crypto.randomInt(all.length));
        }
        const arr2 = novaSenha.split('');
        for (let i = arr2.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [arr2[i], arr2[j]] = [arr2[j], arr2[i]]; }
        novaSenha = arr2.join('');

        const senhaHash = await bcrypt.hash(novaSenha, 12);
        await safeQuery('UPDATE usuarios SET senha_hash = ?, senha_temporaria = 1 WHERE id = ?', [senhaHash, user.id]);

        const templates = require('../../config/email-templates');
        const htmlContent = templates.recuperacaoSenha.html(nome, novaSenha);

        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.hostinger.com',
            port: parseInt(process.env.SMTP_PORT) || 465,
            secure: true,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000
        });

        await transporter.sendMail({
            from: `"Zyntra" <${process.env.SMTP_USER || 'sistema@aluforce.ind.br'}>`,
            to: user.email,
            subject: templates.recuperacaoSenha.assunto,
            html: htmlContent
        });

        console.log(`[AUTH/FORGOT-PASSWORD] ✅ Email de recuperação enviado para ${user.email}`);

        auditLog('PASSWORD_RESET_REQUEST', user.id, `Recuperação de senha (forgot-password) para ${user.email}`, req);

        res.json({ success: true, message: 'Nova senha enviada para o email informado.' });

    } catch (error) {
        console.error('[AUTH/FORGOT-PASSWORD] ❌ Erro:', error.stack || error);
        res.status(500).json({ success: false, message: 'Erro ao processar solicitação. Tente novamente.' });
    }
});

// ============================================================================
// GET /me — Retorna dados do usuário autenticado (global, usado por todos os módulos)
// ============================================================================
router.get('/me', async (req, res) => {
    // Extrair token de múltiplas fontes (mesmo padrão do auth-central)
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const headerToken = authHeader.split(' ')[1];
        if (headerToken && headerToken !== 'null' && headerToken !== 'undefined') {
            token = headerToken;
        }
    }
    if (!token) {
        token = req.cookies?.authToken || req.cookies?.token;
    }
    if (!token) {
        return res.status(401).json({ message: 'Não autenticado', code: 'AUTH_MISSING' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const userId = decoded.id || decoded.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Token inválido', code: 'AUTH_INVALID' });
        }

        const [rows] = await safeQuery(
            'SELECT id, nome, email, role, is_admin, avatar, foto, login, setor FROM usuarios WHERE id = ? LIMIT 1',
            [userId]
        );
        if (!rows.length) {
            return res.status(404).json({ message: 'Usuário não encontrado' });
        }
        const u = rows[0];
        res.json({
            id: u.id,
            nome: u.nome,
            email: u.email,
            role: u.role,
            is_admin: u.is_admin,
            avatar: u.avatar || u.foto,
            foto: u.foto || u.avatar,
            login: u.login,
            setor: u.setor
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expirado', code: 'AUTH_EXPIRED' });
        }
        console.error('[AUTH/ME] Erro:', err.message);
        return res.status(403).json({ message: 'Token inválido', code: 'AUTH_INVALID' });
    }
});

module.exports = router;
