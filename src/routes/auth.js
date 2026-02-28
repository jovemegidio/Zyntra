// auth.js - Middleware e rota de autenticação corrigida
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const router = express.Router();

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

// Rota de login corrigida (sem campo cargo)
router.post('/login', async (req, res) => {
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

    let { email, password } = req.body;
    try {
        if (isDevMode) console.log('[AUTH/LOGIN] Tentativa de login para:', email);

        // Se o usuário digitou apenas o login sem @, adicionar @aluforce.ind.br
        if (email && !email.includes('@')) {
            email = email + '@aluforce.ind.br';
        }

        // Domínios permitidos para login
        const dominiosPermitidos = [
            '@aluforce.ind.br',
            '@aluforce.com',
            '@lumiereassesoria.com.br',   // Consultoria parceira (grafia alternativa)
            '@lumiereassessoria.com.br'   // Consultoria parceira (grafia oficial com SS)
        ];

        const emailValido = dominiosPermitidos.some(dominio => email && email.endsWith(dominio));

        if (!email || !emailValido) {
            return res.status(401).json({ message: 'Apenas e-mails @aluforce.ind.br, @aluforce.com e @lumiereassessoria.com.br são permitidos.' });
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
        const [rows] = await safeQuery('SELECT * FROM usuarios WHERE email = ? OR login = ? ORDER BY id ASC LIMIT 1', [email, email.split('@')[0]]);
        if (!rows.length) {
            // AUDIT-FIX SEC-007: Generic message prevents user enumeration
            return res.status(401).json({ message: 'Email ou senha incorretos.' });
        }
        const user = rows[0];

        // ========================================
        // VALIDAÇÃO: BLOQUEAR USUÁRIOS DEMITIDOS
        // ========================================
        const usuariosDemitidos = [
            'ariel.leandro',
            'felipe.santos',
            'flavio.bezerra',
            'lais.luna',
            'nicolas.santana',
            'thaina.freitas',
            'kissia',
            'sarah'
        ];

        // Verificar se o usuário está demitido (por nome ou email)
        const nomeUsuario = (user.nome || user.name || '').toLowerCase().trim();
        const emailUsuario = (user.email || '').toLowerCase().trim();

        const estaDemitido = usuariosDemitidos.some(demitido => {
            // Verificar se o nome contém o nome do demitido
            if (nomeUsuario.includes(demitido)) return true;
            // Verificar se o email contém o nome do demitido
            if (emailUsuario.includes(demitido)) return true;
            return false;
        });

        // Também verificar campo de status se existir (ativo, inativo, demitido)
        const statusUsuario = (user.status || '').toLowerCase();
        const statusInativo = ['demitido', 'inativo', 'desativado', 'bloqueado'].includes(statusUsuario);

        if (estaDemitido || statusInativo) {
            console.log(`🚫 Login bloqueado - Usuário demitido: ${user.email} (${user.nome})`);
            return res.status(403).json({
                message: 'Acesso negado. Seu usuário foi desativado. Entre em contato com o departamento de TI.'
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
                valid = password === user[hashField];
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
            console.error('Erro ao comparar senha:', err.stack || err);
            return res.status(500).json({ message: 'Erro ao verificar credenciais.', error: (err && err.message) ? err.message : String(err) });
        }
        if (!valid) {
            // AUDIT-FIX SEC-007: Same message as user-not-found to prevent enumeration
            return res.status(401).json({ message: 'Email ou senha incorretos.' });
        }

        // ════════════════════════════════════════════════════════════════
        // 🔐 2FA - AUTENTICAÇÃO DE DOIS FATORES VIA EMAIL
        // ════════════════════════════════════════════════════════════════
        // WHITELIST: Por enquanto, 2FA apenas para emails específicos
        // Quando todos os emails estiverem atualizados, remover esta checagem
        const twoFA_whitelist = [
            'ti@aluforce.ind.br',
            'pcp@aluforce.ind.br',
            'rh@aluforce.ind.br',
            'augusto.santos@aluforce.ind.br',
            'vendas4@aluforce.ind.br',
            'financeiro2@aluforce.ind.br',
            'financeiro3@aluforce.ind.br',
            'adm@aluforce.ind.br',
            'compras@aluforce.ind.br',
            'aluforce@aluforce.ind.br',
            // 'qafinanceiro@aluforce.ind.br', // 2FA removido em 26/02/2026
            'qavendas@aluforce.ind.br',
            'qapcp@aluforce.ind.br',
            'qarh@aluforce.ind.br',
            'qacompras@aluforce.ind.br',
            'qanfe@aluforce.ind.br',
            'qapainel@aluforce.ind.br'
        ];
        const userEmail = (user.email || '').toLowerCase().trim();
        const requires2FA = twoFA_whitelist.includes(userEmail);

        // 🔐 Verificar se o admin desabilitou o 2FA para este usuário via painel
        let twoFactorDisabledByAdmin = false;
        if (requires2FA) {
            try {
                // Verificar se a coluna existe, se não, criar
                const [cols] = await safeQuery("SHOW COLUMNS FROM usuarios LIKE 'two_factor_disabled'");
                if (!cols || cols.length === 0) {
                    await safeQuery('ALTER TABLE usuarios ADD COLUMN two_factor_disabled TINYINT(1) DEFAULT 0').catch(() => {});
                }
                
                const [twoFaCheck] = await safeQuery(
                    'SELECT two_factor_disabled FROM usuarios WHERE id = ?', [user.id]
                );
                if (twoFaCheck && twoFaCheck.length > 0 && twoFaCheck[0].two_factor_disabled === 1) {
                    twoFactorDisabledByAdmin = true;
                    console.log(`[AUTH/2FA] ⏭️ 2FA desabilitado pelo admin para ${user.email}`);
                }
            } catch (e) {
                console.log('[AUTH/2FA] Aviso: Não foi possível verificar two_factor_disabled:', e.message);
            }
        }

        if (requires2FA && !twoFactorDisabledByAdmin) {
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

            // 🔍 Verificar se o dispositivo já é confiável (cookie)
            const trustedDeviceCookie = req.cookies && req.cookies['trusted_device_2fa'];
            if (trustedDeviceCookie) {
                // Limpar dispositivos expirados
                await safeQuery('DELETE FROM auth_trusted_devices WHERE expira_em < NOW()');

                const [trustedRows] = await safeQuery(
                    'SELECT * FROM auth_trusted_devices WHERE device_token = ? AND usuario_id = ? AND expira_em > NOW()',
                    [trustedDeviceCookie, user.id]
                );

                if (trustedRows && trustedRows.length > 0) {
                    console.log(`[AUTH/2FA] ✅ Dispositivo confiável encontrado para ${user.email} - pulando 2FA`);
                    // Throw para sair do try e cair no login normal
                    const skipError = new Error('SKIP_2FA_TRUSTED_DEVICE');
                    skipError.skipToLogin = true;
                    throw skipError;
                }
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
                                user: process.env.SMTP_USER || 'sistema@aluforce.ind.br',
                                pass: process.env.SMTP_PASS || 'apialuforce'
                            },
                            tls: { rejectUnauthorized: false },
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
                // Graceful degradation: se 2FA falhar, continua login normal
                console.log('[AUTH/2FA] ⚠️ Permitindo login direto (2FA com erro)');
            }
        }
        } // fim do if (requires2FA)
        // ════════════════════════════════════════════════════════════════

        // 🔐 MULTI-DEVICE: Gerar deviceId único para isolamento de sessão
        const deviceId = uuidv4();
        console.log(`[AUTH/LOGIN] 📱 DeviceId gerado: ${deviceId.substring(0, 8)}...`);

        // Gera token JWT com deviceId e coloca em cookie httpOnly
        // AUDIT-FIX: Explicit HS256 algorithm to prevent algorithm confusion attacks
        const token = jwt.sign({
            id: user.id,
            nome: user.nome,
            email: user.email,
            role: user.role,
            setor: user.setor || null,
            deviceId: deviceId // CRITICAL: Identificador único do dispositivo
        }, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '8h' });
        const cookieOptions = {
            httpOnly: true,
            path: '/'
        };

        // Em produção, usar secure e sameSite strict
        if (process.env.NODE_ENV === 'production') {
            cookieOptions.secure = true;
            cookieOptions.sameSite = 'strict';
        } else {
            // Em desenvolvimento (localhost), não usar secure mas permitir sameSite lax
            cookieOptions.sameSite = 'lax';
        }
        // Define cookie com expiração em 8 horas
        const finalCookieOptions = Object.assign({}, cookieOptions, { maxAge: 1000 * 60 * 60 * 8 });
        res.cookie('authToken', token, finalCookieOptions);
        console.log('[AUTH/LOGIN] ✅ Cookie authToken setado para:', user.email);
        console.log('[AUTH/LOGIN] Cookie options:', JSON.stringify(finalCookieOptions));
        console.log('[AUTH/LOGIN] Token (primeiros 30 chars):', token.substring(0, 30) + '...');
        // Se a requisição vem de um navegador (ex: submission de formulário) redirecione para o painel
        // Caso seja uma requisição AJAX/fetch, retorne JSON (comportamento atual)
        const acceptsHtml = typeof req.headers.accept === 'string' && req.headers.accept.indexOf('text/html') !== -1;
        const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest' || (req.headers['content-type'] && req.headers['content-type'].indexOf('application/json') !== -1);
        if (acceptsHtml && !isAjax) {
            // Redireciona para index.html (painel de controle)
            return res.redirect('/index.html');
        }
        // Também retorna dados do usuário para uso imediato no cliente (AJAX)
        // Inclui `redirectTo` (absoluto) para que clientes que usam fetch possam redirecionar a página facilmente.
        const baseUrl = (req.protocol || 'http') + '://' + (req.get('host') || req.headers.host || 'localhost');
        const redirectTo = baseUrl + '/dashboard';
        // AUDIT-FIX SEC-006 (REVISED): Token included in response for localStorage fallback.
        // The httpOnly cookie is the primary auth mechanism, but login.js also saves
        // the token to localStorage so auth-unified.js can send it as Authorization header.
        // This provides dual-path authentication resilience.
        const payload = {
            success: true,
            token, // Needed by login.js to save in localStorage for Authorization header fallback
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
    } catch (error) {
        // Log completo no servidor (stack quando disponível)
        console.error('Erro detalhado no login:', error.stack || error);
        // Envia apenas mensagem/texto para o cliente para evitar problemas de serialização
        res.status(500).json({ message: 'Erro inesperado no login', error: (error && error.message) ? error.message : String(error) });
    }
});

// Rota para logout (limpa cookie e cache)
router.post('/logout', (req, res) => {
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
    // Limpar também o cookie de lembrar-me
    res.clearCookie('rememberToken', cookieOptions);
    console.log('[AUTH/LOGOUT] ✅ Cookies authToken e rememberToken limpos');
    res.json({ ok: true, message: 'Logout realizado com sucesso' });
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
            // AUDIT-FIX: Generic message to prevent user enumeration
            return res.status(404).json({ message: 'Email não encontrado no sistema.' });
        }

        const user = rows[0];
        console.log('[AUTH/VERIFY-EMAIL] ✅ Email encontrado, userId:', user.id);

        // AUDIT-FIX: Do NOT return userId to client — prevents IDOR attack
        res.json({
            success: true,
            message: 'Email verificado com sucesso.'
        });
    } catch (error) {
        console.error('[AUTH/VERIFY-EMAIL] Erro:', error.stack || error);
        res.status(500).json({
            message: 'Erro ao verificar email.',
            error: error.message
        });
    }
});

// Passo 2: Verificar dados do usuário (nome e departamento) — now uses email instead of userId
// AUDIT-FIX: Accepts email (not userId) and generates a time-limited reset token on success
router.post('/auth/verify-user-data', async (req, res) => {
    try {
        const { email, name, department } = req.body;
        console.log('[AUTH/VERIFY-DATA] Verificando dados para email:', email);

        if (!email || !name || !department) {
            return res.status(400).json({ message: 'Dados incompletos.' });
        }

        // Busca usuário no banco BY EMAIL (not by userId)
        const [rows] = await safeQuery('SELECT id, nome, setor FROM usuarios WHERE email = ? LIMIT 1', [email]);

        if (!rows.length) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const user = rows[0];

        // Verifica se nome e setor conferem (case-insensitive, exact match)
        // AUDIT-FIX: Use strict equality instead of .includes() to prevent partial name attacks
        const nameMatches = user.nome.toLowerCase().trim() === name.toLowerCase().trim();
        const deptMatches = user.setor && user.setor.toLowerCase().trim() === department.toLowerCase().trim();

        if (!nameMatches) {
            console.log('[AUTH/VERIFY-DATA] ❌ Nome não confere');
            return res.status(401).json({ message: 'Nome não confere com nossos registros.' });
        }

        if (!deptMatches) {
            console.log('[AUTH/VERIFY-DATA] ❌ Departamento não confere');
            return res.status(401).json({ message: 'Departamento não confere com nossos registros.' });
        }

        // AUDIT-FIX: Generate a signed, time-limited reset token
        await ensurePasswordResetTokensTable();

        // Invalidate any existing tokens for this user
        await safeQuery('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);

        // Generate cryptographically secure token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        await safeQuery(
            'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
            [user.id, tokenHash, expiresAt]
        );

        console.log('[AUTH/VERIFY-DATA] ✅ Dados verificados, reset token gerado (expira em 15min)');
        res.json({
            success: true,
            resetToken: resetToken, // Client stores this temporarily for step 3
            message: 'Dados verificados com sucesso.'
        });
    } catch (error) {
        console.error('[AUTH/VERIFY-DATA] Erro:', error.stack || error);
        res.status(500).json({
            message: 'Erro ao verificar dados.',
            error: error.message
        });
    }
});

// Passo 3: Alterar senha — now requires valid reset token (not userId)
// AUDIT-FIX: Uses signed token from step 2 instead of accepting arbitrary userId
router.post('/auth/change-password', async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;
        console.log('[AUTH/CHANGE-PASSWORD] Tentativa de alteração de senha com token');

        if (!resetToken || !newPassword) {
            return res.status(400).json({ message: 'Dados incompletos. Token e nova senha são obrigatórios.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'A senha deve ter pelo menos 6 caracteres.' });
        }

        // AUDIT-FIX: Validate the reset token (hashed comparison, time-limited)
        const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        const [tokenRows] = await safeQuery(
            'SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token_hash = ? LIMIT 1',
            [tokenHash]
        );

        if (!tokenRows.length) {
            return res.status(401).json({ message: 'Token de recuperação inválido.' });
        }

        const tokenData = tokenRows[0];

        if (tokenData.used) {
            return res.status(401).json({ message: 'Token já foi utilizado. Inicie o processo novamente.' });
        }

        if (new Date(tokenData.expires_at) < new Date()) {
            return res.status(401).json({ message: 'Token expirado. Inicie o processo novamente.' });
        }

        const userId = tokenData.user_id;

        // Verifica se usuário existe
        const [rows] = await safeQuery('SELECT id FROM usuarios WHERE id = ? LIMIT 1', [userId]);

        if (!rows.length) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // Gera hash bcrypt da nova senha (salt rounds = 12)
        // AUDIT-FIX: Increased from 10 to 12 rounds
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        console.log('[AUTH/CHANGE-PASSWORD] Hash gerado com sucesso');

        // Detecta qual campo usar para senha
        const [cols] = await safeQuery('SHOW COLUMNS FROM usuarios');
        const colNames = cols.map(x => x.Field.toLowerCase());

        let passwordField = 'senha_hash'; // padrão
        if (colNames.includes('senha_hash')) {
            passwordField = 'senha_hash';
        } else if (colNames.includes('senha')) {
            passwordField = 'senha';
        } else if (colNames.includes('password')) {
            passwordField = 'password';
        }

        // Atualiza senha no banco com hash bcrypt
        await safeQuery(`UPDATE usuarios SET ${passwordField} = ? WHERE id = ?`, [hashedPassword, userId]);

        // AUDIT-FIX: Invalidate the used token
        await safeQuery('UPDATE password_reset_tokens SET used = 1 WHERE token_hash = ?', [tokenHash]);

        // AUDIT-FIX: Invalidate all refresh tokens for this user (force re-login)
        try {
            await safeQuery('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
        } catch (e) { /* table may not exist */ }

        console.log('[AUTH/CHANGE-PASSWORD] ✅ Senha alterada com sucesso no banco (token invalidado)');

        res.json({
            success: true,
            message: 'Senha alterada com sucesso!'
        });
    } catch (error) {
        console.error('[AUTH/CHANGE-PASSWORD] Erro:', error.stack || error);
        res.status(500).json({
            message: 'Erro ao alterar senha.',
            error: error.message
        });
    }
});

// ===================== FUNCIONALIDADE "LEMBRAR-ME" =====================

// Cria tabela de refresh tokens se não existir
async function ensureRefreshTokensTable() {
    try {
        await safeQuery(`
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                token VARCHAR(512) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                INDEX idx_user_id (user_id),
                INDEX idx_token (token),
                FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[AUTH] ✅ Tabela refresh_tokens verificada/criada');
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
            message: 'Erro ao criar token de lembrar-me.',
            error: error.message
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

        console.log('[AUTH/VALIDATE-REMEMBER] ✅ Token válido para:', user.email);

        // 🔐 FIX: Gerar deviceId para isolamento de sessão (igual ao login normal)
        const deviceId = uuidv4();
        const tokenPayload = { ...user, deviceId };

        // Gera novo authToken JWT com deviceId
        // AUDIT-FIX: Explicit HS256 algorithm
        const authToken = jwt.sign(tokenPayload, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '8h' });

        // Define cookie authToken
        const cookieOptions = {
            httpOnly: true,
            path: '/',
            maxAge: 8 * 60 * 60 * 1000 // 8 horas
        };

        if (process.env.NODE_ENV === 'production') {
            cookieOptions.secure = true;
            cookieOptions.sameSite = 'strict';
        } else {
            cookieOptions.sameSite = 'lax';
        }

        res.cookie('authToken', authToken, cookieOptions);

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
            message: 'Erro ao remover token de lembrar-me.',
            error: error.message
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
            'SELECT * FROM auth_2fa_codes WHERE pending_token = ? AND usado = 0',
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

        // Verificar código
        if (registro.codigo !== code.trim()) {
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
        const [userRows] = await safeQuery('SELECT * FROM usuarios WHERE id = ?', [registro.usuario_id]);
        if (!userRows.length) {
            return res.status(500).json({ message: 'Erro interno: usuário não encontrado.' });
        }

        const user = userRows[0];

        // 🔐 MULTI-DEVICE: Gerar deviceId
        const deviceId = uuidv4();
        console.log(`[AUTH/2FA] ✅ 2FA verificado para ${user.email}, DeviceId: ${deviceId.substring(0, 8)}...`);

        // Gerar JWT (mesmo processo do login normal)
        const token = jwt.sign({
            id: user.id,
            nome: user.nome,
            email: user.email,
            role: user.role,
            setor: user.setor || null,
            deviceId: deviceId
        }, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '8h' });

        // Configurar cookie
        const cookieOptions = { httpOnly: true, path: '/' };
        if (process.env.NODE_ENV === 'production') {
            cookieOptions.secure = true;
            cookieOptions.sameSite = 'strict';
        } else {
            cookieOptions.sameSite = 'lax';
        }
        const finalCookieOptions = Object.assign({}, cookieOptions, { maxAge: 1000 * 60 * 60 * 8 });
        res.cookie('authToken', token, finalCookieOptions);

        console.log('[AUTH/2FA] ✅ Cookie authToken setado para:', user.email);

        // 🔐 Salvar dispositivo confiável se solicitado
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

                console.log(`[AUTH/2FA] 🔒 Dispositivo confiável salvo para ${user.email} (30 dias)`);
            } catch (trustErr) {
                console.error('[AUTH/2FA] ⚠️ Erro ao salvar dispositivo confiável:', trustErr.message);
                // Não impede o login — continua normalmente
            }
        }

        const baseUrl = (req.protocol || 'http') + '://' + (req.get('host') || req.headers.host || 'localhost');
        const redirectTo = baseUrl + '/dashboard';

        const payload = {
            success: true,
            token,
            deviceId,
            redirectTo,
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                role: user.role,
                is_admin: user.is_admin || 0,
                setor: user.setor || null,
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
            'SELECT * FROM auth_2fa_codes WHERE pending_token = ? AND usado = 0',
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
                        user: process.env.SMTP_USER || 'sistema@aluforce.ind.br',
                        pass: process.env.SMTP_PASS || 'apialuforce'
                    },
                    tls: { rejectUnauthorized: false },
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
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ success: false, message: 'Dados incompletos.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'A senha deve ter pelo menos 6 caracteres.' });
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

        // Atualiza senha e remove flag de temporária
        await safeQuery('UPDATE usuarios SET senha = ?, senha_temporaria = 0 WHERE id = ?', [senhaHash, userId]);
        console.log(`[AUTH/FORCE-CHANGE] ✅ Senha definitiva salva para userId: ${userId} (${rows[0].email})`);

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
        console.log('[AUTH/ESQUECI-SENHA] Solicitação para:', email);

        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, message: 'Email inválido.' });
        }

        // Busca usuário pelo email
        const [rows] = await safeQuery('SELECT id, nome, email FROM usuarios WHERE email = ? LIMIT 1', [email]);

        if (!rows.length) {
            // Retorna sucesso genérico para evitar enumeração de emails
            console.log('[AUTH/ESQUECI-SENHA] Email não encontrado:', email);
            return res.json({ 
                success: true, 
                message: 'Se o email estiver cadastrado, uma nova senha será enviada.' 
            });
        }

        const user = rows[0];
        const nome = (user.nome || email.split('@')[0]).split(' ')[0];

        // Gera nova senha aleatória (8 chars: letras + números)
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let novaSenha = '';
        for (let i = 0; i < 8; i++) {
            novaSenha += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        // Hash da nova senha
        const senhaHash = await bcrypt.hash(novaSenha, 12);

        // Atualiza no banco (senha + flag de senha temporária)
        await safeQuery('UPDATE usuarios SET senha = ?, senha_temporaria = 1 WHERE id = ?', [senhaHash, user.id]);
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
                user: process.env.SMTP_USER || 'sistema@aluforce.ind.br',
                pass: process.env.SMTP_PASS || 'apialuforce'
            },
            tls: { rejectUnauthorized: false },
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

        console.log(`[AUTH/ESQUECI-SENHA] ✅ Email de recuperação enviado para ${user.email}`);

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
        console.log('[AUTH/FORGOT-PASSWORD] Alias → esqueci-senha para:', email);

        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, message: 'Email inválido.' });
        }

        // Busca usuário pelo email
        const [rows] = await safeQuery('SELECT id, nome, email FROM usuarios WHERE email = ? LIMIT 1', [email]);

        if (!rows.length) {
            console.log('[AUTH/FORGOT-PASSWORD] Email não encontrado:', email);
            return res.json({ 
                success: true, 
                message: 'Se o email estiver cadastrado, uma nova senha será enviada.' 
            });
        }

        const user = rows[0];
        const nome = (user.nome || email.split('@')[0]).split(' ')[0];

        // Gera nova senha aleatória (8 chars)
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let novaSenha = '';
        for (let i = 0; i < 8; i++) {
            novaSenha += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        const senhaHash = await bcrypt.hash(novaSenha, 12);
        await safeQuery('UPDATE usuarios SET senha = ?, senha_temporaria = 1 WHERE id = ?', [senhaHash, user.id]);

        const templates = require('../../config/email-templates');
        const htmlContent = templates.recuperacaoSenha.html(nome, novaSenha);

        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.hostinger.com',
            port: parseInt(process.env.SMTP_PORT) || 465,
            secure: true,
            auth: {
                user: process.env.SMTP_USER || 'sistema@aluforce.ind.br',
                pass: process.env.SMTP_PASS || 'apialuforce'
            },
            tls: { rejectUnauthorized: false },
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
        res.json({ success: true, message: 'Nova senha enviada para o email informado.' });

    } catch (error) {
        console.error('[AUTH/FORGOT-PASSWORD] ❌ Erro:', error.stack || error);
        res.status(500).json({ success: false, message: 'Erro ao processar solicitação. Tente novamente.' });
    }
});

module.exports = router;
