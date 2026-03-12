const express = require('express')
const cors = require('cors')
const path = require('path')
const mysql = require('mysql2')
const multer = require('multer') // upload de arquivos
const sharp = require('sharp')
const fs = require('fs')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { body, validationResult } = require('express-validator')
const rateLimit = require('express-rate-limit')
const cookieParser = require('cookie-parser')
require('dotenv').config()

// Importar security middleware centralizado
const {
    generalLimiter,
    authLimiter,
    apiLimiter,
    sanitizeInput,
    securityHeaders,
    cleanExpiredSessions
} = require('../../security-middleware');
const { adminRoles, adminUsers, rolesGestao } = require('./config/roles');

const app = express()
const PORT = process.env.PORT_RH || process.env.PORT || 3004
// JWT_SECRET deve vir OBRIGATORIAMENTE do .env
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  console.error('❌ [RH] ERRO FATAL: JWT_SECRET não definido no .env')
  process.exit(1)
}

const logger = require('./logger')
const { maskCPF } = require('../../src/helpers');

// Função utilitária para mascarar dados sensíveis em logs
function maskSensitiveLog(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  // Remover campos de senha/hash
  delete out.senha;
  delete out.senha_hash;
  delete out.password_hash;
  delete out.password;
  if (out.cpf) out.cpf = maskCPF(out.cpf).replace(/(\d{3})\.(\d{3})\.(\d{3})-(\d{2})/, '$1.***.***-$4');
  if (out.banco) out.banco = '***';
  if (out.agencia) out.agencia = '***';
  if (out.conta || out.conta_corrente) {
    out.conta = out.conta_corrente = '***';
  }
  if (out.salario || out.salario_base) {
    out.salario = out.salario_base = '***';
  }
  return out;
}

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-this-secret-in-prod')) {
  logger.error('NODE_ENV=production mas JWT_SECRET não está configurado ou é o placeholder. Abortando startup.')
  process.exit(1)
}

// Pool MySQL centralizado
const pool = require('../../database/pool')

// Compat: objeto 'db' que roteia para pool (mantém compatibilidade com código callback-style)
const db = {
  query: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    pool.query(sql, params || [])
      .then(([results, fields]) => callback(null, results, fields))
      .catch(err => callback(err));
  }
};

// Inicialização: validar conexão e criar tabelas
(async () => {
  try {
    await pool.query('SET NAMES utf8mb4');
    logger.info('Ligado com sucesso à base de dados MySQL "aluforce_vendas".');
    logger.info('Charset UTF-8mb4 configurado para a conexão.');
  } catch (err) {
    logger.error('ERRO AO LIGAR-SE À BASE DE DADOS:', err);
    process.exit(1);
  }

  // Garantir tabelas auxiliares
  const ensureTables = [
    { name: 'avisos_lidos', sql: `CREATE TABLE IF NOT EXISTS avisos_lidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        aviso_id INT NOT NULL,
        funcionario_id INT NOT NULL,
        lido_at DATETIME NOT NULL,
        UNIQUE KEY unico_aviso_funcionario (aviso_id, funcionario_id),
        INDEX idx_funcionario (funcionario_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` },
    { name: 'atéstados', sql: `CREATE TABLE IF NOT EXISTS atéstados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        funcionario_id INT NOT NULL,
        data_atestado DATE,
        dias_afastado INT DEFAULT 0,
        motivo VARCHAR(255),
        arquivo_url VARCHAR(255) NOT NULL,
        data_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` },
    { name: 'holerites', sql: `CREATE TABLE IF NOT EXISTS holerites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        funcionario_id INT NOT NULL,
        competencia VARCHAR(10) DEFAULT NULL,
        arquivo_url VARCHAR(255) NOT NULL,
        data_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` },
    { name: 'espelhos_ponto', sql: `CREATE TABLE IF NOT EXISTS espelhos_ponto (
        id INT AUTO_INCREMENT PRIMARY KEY,
        funcionario_id INT NOT NULL,
        competencia VARCHAR(10) DEFAULT NULL,
        arquivo_url VARCHAR(255) NOT NULL,
        data_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` }
  ];

  for (const t of ensureTables) {
    try {
      await pool.query(t.sql);
      logger.info(`Tabela ${t.name} pronta (ou já existente).`);
    } catch (e) {
      logger.error(`Não foi possível garantir a existência da tabela ${t.name}:`, e);
    }
  }
})();

// Promise wrapper — agora usa pool em vez de createConnection
async function dbQuery (sql, params = []) {
  const [results] = await pool.query(sql, params);
  return results;
}

// --- CONFIGURAÇÍO DO UPLOAD DE FICHEIROS (MULTER) ---
// AUDIT-FIX: Safe filename helper — strips unsafe chars from extension and id
function safeUploadFilename(prefix, req, file) {
  const idPart = req.params && req.params.id ? String(req.params.id).replace(/\D/g, '') || '0' : '0'
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
  const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '')
  return `${prefix}-${idPart}-${uniqueSuffix}${ext}`
}

// Multer storage + file filter (only images) + limits
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'public', 'uploads', 'fotos')
    fs.mkdirSync(uploadPath, { recursive: true })
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    cb(null, safeUploadFilename('funcionario', req, file))
  }
})

function imageFileFilter (req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error('Apenas imagens (jpg, png, webp) são permitidas.'))
  }
  cb(null, true)
}

const upload = multer({ storage, fileFilter: imageFileFilter, limits: { fileSize: 5 * 1024 * 1024 } }) // 5MB

// Roles e usuários admin carregados de config/roles.js

// Helper to check admin role in a normalized way
function isAdminRole (role) {
  const r = role && String(role).toLowerCase().trim()
  return !!r && adminRoles.includes(r)
}
function isAdminUser (user) {
  if (!user) return false
  return isAdminRole(user.role)
}

function isGestorOuAdminUser (user) {
  if (!user) return false
  if (isAdminUser(user)) return true

  const role = String(user.role || '').toLowerCase().trim()
  const cargo = String(user.cargo || '').toLowerCase().trim()
  return rolesGestao.includes(role) || rolesGestao.includes(cargo)
}
// Campos extras que o admin pode gerenciar (adicionados via migration)
const adminAllowedFields = [
  'nacionalidade', 'naturalidade', 'filiacao_mae', 'filiacao_pai', 'dados_conjuge',
  'zona_eleitoral', 'seção_eleitoral', 'ctps_numero', 'ctps_serie',
  'banco', 'agencia', 'conta_corrente',
  // Campos adicionais do formulário de edição
  'cpf', 'rg', 'email', 'data_admissao', 'pis_pasep', 'endereco',
  'titulo_eleitor', 'cnh', 'certificado_reservista',
  // Campos importantes para RH completo
  'bairro', 'cep', 'cidade', 'estado', 'salario_base', 
  'email_corporativo', 'ramal', 'numero_matricula', 'tipo_contrato',
  'centro_custo', 'jornada_trabalho', 'data_demissao', 'motivo_demissao'
]

// --- MIDDLEWARES ---
app.use(securityHeaders())
app.use(cors({
    origin: function(origin, callback) {
        const allowedOrigins = [
            'http://localhost:3000', 'http://localhost:5000',
            'http://127.0.0.1:3000', 'http://127.0.0.1:5000',
            'https://aluforce.api.br', 'https://www.aluforce.api.br',
            'https://aluforce.ind.br', 'https://erp.aluforce.ind.br',
            'https://www.aluforce.ind.br',
            'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost',
            process.env.CORS_ORIGIN
        ].filter(Boolean)
        if (!origin && process.env.NODE_ENV === 'development') return callback(null, true)
        if (!origin) return callback(null, false)
        if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
            callback(null, true)
        } else {
            callback(new Error('Origem não permitida pelo CORS'))
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// Favicon Zyntra
app.get('/favicon.ico', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.join(__dirname, 'public', 'favicon-zyntra.jpg'));
});

app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: false }))

// === Integração da API eSocial ===
const esocialApi = require('./api/esocial-api');
app.use('/api/esocial', esocialApi);

// Dev/test helper: explicit fallback route to serve a safe admin dashboard script
// This helps environments where an older bundle at /admin/dashboard.js is still being requested.
app.get('/admin/dashboard.js', (req, res) => {
  try {
    const p = path.join(__dirname, 'public', 'admin', 'dashboard.js')
    if (fs.existsSync(p)) return res.sendFile(p)
    return res.status(404).send('// admin dashboard not found')
  } catch (e) {
    logger.error('Erro ao servir /admin/dashboard.js:', e)
    return res.status(500).send('// error serving admin dashboard')
  }
})

// Backwards-compatible fallback for legacy placeholder image paths used in older data/scripts.
// Instead of adding a binary placeholder file, serve an existing asset to avoid 404s in the browser.
app.get('/uploads/fotos/placeholder.png', (req, res) => {
  const fallback = path.join(__dirname, 'public', 'Interativo-Aluforce.jpg')
  if (fs.existsSync(fallback)) return res.sendFile(fallback)
  // Fallback: redirect to the public root image (rare case: file missing)
  return res.redirect(302, '/Interativo-Aluforce.jpg')
})

// Backwards-compatible redirects for legacy admin path names
app.get(['/area-admin.html', '/area-admin'], (req, res) => {
  return res.redirect(301, '/areaadm.html')
})

// Redirecionamento inteligente baseado em permissões
app.get('/area.html', (req, res) => {
  // Verificar se é admin/RH (redireciona para novo portal funcionário)
  // Para compatibilidade, manter o area.html original mas recomendar funcionario.html
  return res.redirect(301, '/funcionario.html')
})

// Helper: gerar token e middleware
function generateToken (user) {
  // AUDIT-FIX ARCH-004: Added algorithm HS256 + audience claim
  // AUDIT-FIX: 15 min to match main auth access token expiry (was 8h)
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '15m' })
}

// Development helper: generate a JWT signed with the server's secret.
// DISABLED FOR SECURITY - Use real login instead
// Only enabled when NODE_ENV is explicitly set to 'development'. 
// This helps local tests and CI to obtain a valid token without duplicating the JWT_SECRET.
if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEBUG_ENDPOINTS === 'true') {
  app.post('/api/debug/generate-token', (req, res) => {
    const id = req.body && req.body.id ? Number(req.body.id) : 8
    const role = req.body && req.body.role ? String(req.body.role) : 'admin'
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' })
    const token = generateToken({ id, role })
    // SEGURANÇA: Token apenas em cookie httpOnly
    res.cookie('authToken', token, {
        httpOnly: true,
        secure: false, // dev mode
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000
    })
    return res.json({ success: true, message: 'Token gerado e armazenado em cookie' })
  })
  logger.warn('⚠️ DEBUG ENDPOINTS HABILITADOS - NÃO USE EM PRODUÇÃO')
}

function authMiddleware (req, res, next) {
  // SECURITY A4: Check cookie FIRST, then Authorization header
  let token = null
  if (req.cookies) {
    token = req.cookies.authToken || req.cookies.token || null
  }
  if (!token) {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Token ausente.' })
    token = auth.split(' ')[1]
  }
  try {
    // AUDIT-FIX ARCH-004: Enforce HS256 algorithm (audience enforced in sign, verify-side after token rotation)
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    req.user = payload
    return next()
  } catch (err) {
    return res.status(401).json({ message: 'Token inválido.' })
  }
}

// optionalAuth: tries to verify a Bearer token but doesn't fail if absent/invalid.
// When a valid token is present it sets req.user, otherwise continues without user.
function optionalAuth (req, res, next) {
  // SECURITY A4: Check cookie first, then Authorization header
  let token = null
  if (req.cookies) {
    token = req.cookies.authToken || req.cookies.token || null
  }
  if (!token) {
    const auth = req.headers.authorization
    if (auth && auth.startsWith('Bearer ')) {
      token = auth.split(' ')[1]
    }
  }
  if (!token) return next()
  try {
    // AUDIT-FIX ARCH-004: Enforce HS256 algorithm (audience enforced in sign, verify-side after token rotation)
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    req.user = payload
  } catch (e) {
    // ignore invalid token for optional auth
  }
  return next()
}

// --- ROTAS DA API ---

// Rate limiter para rota de login
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // 10 tentativas por minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas tentativas. Tente novamente mais tarde.' }
})

// Rota de Login (suporta body { username/email, password/senha })
app.post('/api/login', loginLimiter, (req, res) => {
  // Accept either 'username' or 'email', and either 'password' or 'senha'
  const username = req.body.username || req.body.email
  const password = req.body.password || req.body.senha

  if (!username || !password) {
    return res.status(400).json({ message: 'username/email e password/senha são obrigatórios.' })
  }

  const sql = 'SELECT * FROM funcionarios WHERE email = ? LIMIT 1'
  db.query(sql, [username], async (err, results) => {
    if (err) {
      logger.error('Login error:', err)
      return res.status(500).json({ message: 'Erro interno no servidor.' })
    }
    if (!results || results.length === 0) {
      return res.status(401).json({ message: 'Email ou senha inválidos.' })
    }

    const usuario = results[0]
    
    // Verificar se o colaborador está ativo
    const statusUsuario = (usuario.status || '').toLowerCase().trim()
    if (statusUsuario === 'inativo' || statusUsuario === 'desligado' || statusUsuario === 'demitido') {
      // Mascarar CPF se presente
      const logUser = maskSensitiveLog(usuario);
      logger.warn(`Tentativa de login de usuário inativo: ${logUser.email} (status: ${logUser.status})`)
      return res.status(403).json({ 
        message: 'Acesso bloqueado. Seu cadastro está inativo no sistema. Entre em contato com o RH.',
        code: 'USER_INACTIVE'
      })
    }
    
    try {
      const stored = usuario.senha || ''
      const isBcrypt = stored.startsWith && (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$'))
      let match = false
      if (isBcrypt) {
        match = await bcrypt.compare(password, stored)
      } else {
        // legacy plaintext password - compare directly
        match = password === stored
        if (match) {
          // SECURITY FIX: migrate to bcrypt AND clear plaintext (Due Diligence 2026-02-15)
          try {
            const newHash = await bcrypt.hash(password, 12)
            db.query('UPDATE funcionarios SET senha = ?, senha_texto = NULL WHERE id = ?', [newHash, usuario.id], (uErr) => {
              if (uErr) logger.error('Erro ao atualizar senha legacy:', uErr)
              else logger.info(`Senha do utilizador id=${usuario.id} migrada para bcrypt (coluna limpa).`)
            })
          } catch (hashErr) {
            logger.error('Erro ao hashear senha legacy:', hashErr)
          }
        }
      }
      if (!match) {
        return res.status(401).json({ message: 'Email ou senha inválidos.' })
      }
    } catch (bcryptErr) {
      logger.error('Bcrypt compare error', bcryptErr)
      return res.status(500).json({ message: 'Erro interno.' })
    }

    const roleNormalized = usuario.role ? String(usuario.role).toLowerCase().trim() : ''
    const emailPart = usuario.email ? String(usuario.email).split('@')[0].toLowerCase().trim() : ''
    
    // Verifica se é admin por role OU por nome de usuário específico
    const isAdminByRole = adminRoles.includes(roleNormalized)
    const isAdminByUser = adminUsers.includes(emailPart)
    const isAdmin = isAdminByRole || isAdminByUser
    
    const accessRole = isAdmin ? 'admin' : 'funcionario'

    const { senha, ...safeUser } = usuario
    safeUser.role = accessRole
    
    // Debug: log detalhado do processo de login
    logger.info(`Login successful - User: ${usuario.email}, Role: ${accessRole}, IsAdmin: ${isAdmin}`, {
      userId: usuario.id,
      email: usuario.email,
      originalRole: usuario.role,
      finalRole: accessRole,
      isAdminByRole: isAdminByRole,
      isAdminByUser: isAdminByUser
    })
    
    const token = generateToken({ id: usuario.id, role: accessRole })
    // SEGURANÇA: Token apenas em cookie httpOnly, não no body JSON
    res.cookie('authToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000
    })
    res.json({ message: 'Login bem-sucedido!', success: true, userData: safeUser })
  })
})

// Public endpoint: lista de avisos ativos (visível para funcionários)
// NOTE: a single /api/avisos route is implemented below using `optionalAuth` so
// callers may be authenticated (and receive per-user `lido` state) or anonymous.

// Admin-only: aniversariantes do mês (dashboard)
app.get('/api/aniversariantes', authMiddleware, async (req, res) => {
  try {
    if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado.' })
    // Select employees whose birthday month equals current month, order by day
  const rows = await dbQuery('SELECT id, COALESCE(nome_completo, email) AS nome, data_nascimento AS nascimento FROM funcionarios WHERE data_nascimento IS NOT NULL AND MONTH(data_nascimento) = MONTH(CURDATE()) ORDER BY DAY(data_nascimento) ASC LIMIT 20')
    return res.json(rows || [])
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') return res.json([])
    logger.error('Erro ao obter aniversariantes:', err)
    return res.status(500).json({ message: 'Erro ao carregar aniversariantes.' })
  }
})

// Aniversariantes do mês - rota usada pelo calendário RH
app.get('/api/rh/funcionarios/aniversariantes', authMiddleware, async (req, res) => {
  try {
    const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
    const rows = await dbQuery(
      `SELECT id, COALESCE(nome_completo, email) AS nome, foto_perfil_url, foto_thumb_url, data_nascimento 
       FROM funcionarios 
       WHERE data_nascimento IS NOT NULL AND MONTH(data_nascimento) = ? 
       ORDER BY DAY(data_nascimento) ASC`,
      [mes]
    );
    return res.json(rows || []);
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') return res.json([]);
    logger.error('Erro ao obter aniversariantes por mês:', err);
    return res.status(500).json({ message: 'Erro ao carregar aniversariantes.' });
  }
})

// =================== SISTEMA DE EMAILS DE ANIVERSÁRIO ===================

// Enviar email de teste de aniversário
app.post('/api/rh/aniversario/enviar-teste', authMiddleware, async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: 'Acesso negado. Apenas administradores.' })
    }
    
    const { email, nome } = req.body
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email é obrigatório' })
    }
    
    const birthdayService = require('../../services/birthday-email-service')
    const result = await birthdayService.sendTestEmail(email, nome || 'Teste')
    
    if (result.success) {
      logger.info(`[BIRTHDAY] Email de teste enviado para ${email} por ${req.user.email}`)
      return res.json({ 
        success: true, 
        message: 'Email de aniversário enviado com sucesso!',
        messageId: result.messageId,
        subject: result.subject
      })
    } else {
      return res.status(500).json({ 
        success: false, 
        message: 'Falha ao enviar email: ' + result.error 
      })
    }
  } catch (err) {
    logger.error('Erro ao enviar email de aniversário:', err)
    return res.status(500).json({ success: false, message: 'Erro interno ao enviar email' })
  }
})

// Processar todos os aniversariantes do dia
app.post('/api/rh/aniversario/processar', authMiddleware, async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: 'Acesso negado. Apenas administradores.' })
    }
    
    const birthdayService = require('../../services/birthday-email-service')
    const result = await birthdayService.processAllBirthdays(pool)
    
    logger.info(`[BIRTHDAY] Processamento manual por ${req.user.email}: ${result.sent} enviados, ${result.failed} falhas`)
    
    return res.json({
      success: true,
      message: `Processamento concluído: ${result.sent} emails enviados de ${result.total} aniversariantes`,
      ...result
    })
  } catch (err) {
    logger.error('Erro ao processar aniversários:', err)
    return res.status(500).json({ success: false, message: 'Erro interno ao processar aniversários' })
  }
})

// Buscar aniversariantes do dia (para interface)
app.get('/api/rh/aniversario/hoje', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        id,
        nome_completo as nome,
        email,
        departamento,
        cargo,
        data_nascimento,
        foto_perfil_url as foto
      FROM funcionarios 
      WHERE 
        DAY(data_nascimento) = DAY(CURDATE())
        AND MONTH(data_nascimento) = MONTH(CURDATE())
        AND status = 'ativo'
      ORDER BY nome_completo
    `)
    
    return res.json({
      success: true,
      data: rows,
      count: rows.length
    })
  } catch (err) {
    logger.error('Erro ao buscar aniversariantes do dia:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar aniversariantes' })
  }
})

// =================== FIM SISTEMA DE EMAILS DE ANIVERSÁRIO ===================

// Endpoint to check if a funcionario has holerite or ponto files attached
app.get('/api/funcionarios/:id/doc-status', authMiddleware, async (req, res) => {
  const id = Number(req.params.id || 0)
  if (!id) return res.status(400).json({ message: 'id inválido' })
  // allow self or admin
  if (Number(req.user.id) !== id && !isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado.' })
  try {
    const hol = await dbQuery('SELECT id, arquivo_url, competencia, data_upload FROM holerites WHERE funcionario_id = ? ORDER BY data_upload DESC LIMIT 1', [id])
    const esp = await dbQuery('SELECT id, arquivo_url, competencia, data_upload FROM espelhos_ponto WHERE funcionario_id = ? ORDER BY data_upload DESC LIMIT 1', [id])
    return res.json({ hasHolerite: Array.isArray(hol) && hol.length > 0, holerite: (hol && hol[0]) || null, hasPonto: Array.isArray(esp) && esp.length > 0, ponto: (esp && esp[0]) || null })
  } catch (err) {
    // if tables missing, return false flags
    if (err && err.code === 'ER_NO_SUCH_TABLE') return res.json({ hasHolerite: false, holerite: null, hasPonto: false, ponto: null })
    logger.error('Erro ao verificar documentos do funcionário:', err)
    return res.status(500).json({ message: 'Erro ao verificar documentos.' })
  }
})

// Rota para CADASTRAR um novo funcionário (campos mínimos)
app.post('/api/funcionarios',
  authMiddleware,
  // somente admin pode criar funcionários
  (req, res, next) => {
    if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado.' })
    return next()
  },
  // validação mínima
  body('email').isEmail().withMessage('Email inválido'),
  body('senha').isLength({ min: 6 }).withMessage('Senha deve ter ao menos 6 caracteres'),
  body('dependentes').optional().isInt({ min: 0 }).withMessage('Dependentes deve ser um número inteiro >= 0'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const dados = req.body || {}
    try {
      const hashed = await bcrypt.hash(dados.senha, 10)
    const sql = `INSERT INTO funcionarios (
        email, senha, role, nome_completo, cargo, departamento, cpf, rg,
        telefone, estado_civil, data_nascimento, dependentes, foto_perfil_url, status,
        nacionalidade, naturalidade, filiacao_mae, filiacao_pai, dados_conjuge,
        zona_eleitoral, seção_eleitoral, ctps_numero, ctps_serie,
        banco, agencia, conta_corrente,
        pis_pasep, data_admissao, endereco, bairro, cep, cidade, estado, 
        salario_base, email_corporativo, ramal, numero_matricula, tipo_contrato
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

      const params = [
        dados.email || null,
        hashed,
        dados.role || 'funcionario',
        // nome_completo is NOT NULL in some schemas; fallback to email or empty string
        dados.nome_completo || dados.email || '',
        dados.cargo || null,
        dados.departamento || null,
        // cpf may be NOT NULL in legacy schema; provide empty string fallback
        dados.cpf || '',
        dados.rg || null,
        dados.telefone || null,
        dados.estado_civil || null,
        dados.data_nascimento || null,
        dados.dependentes || 0,
        dados.foto_perfil_url || null,
        dados.status || 'Ativo',
        // admin extra fields
        dados.nacionalidade || null,
        dados.naturalidade || null,
        dados.filiacao_mae || null,
        dados.filiacao_pai || null,
        dados.dados_conjuge || null,
        dados.zona_eleitoral || null,
        dados.seção_eleitoral || null,
        dados.ctps_numero || null,
        dados.ctps_serie || null,
        dados.banco || null,
        dados.agencia || null,
        dados.conta_corrente || null,
        // Campos adicionais importantes
        dados.pis_pasep || null,
        dados.data_admissao || null,
        dados.endereco || null,
        dados.bairro || null,
        dados.cep || null,
        dados.cidade || null,
        dados.estado || null,
        dados.salario_base || null,
        dados.email_corporativo || null,
        dados.ramal || null,
        dados.numero_matricula || null,
        dados.tipo_contrato || 'CLT'
      ]

      db.query(sql, params, (err, results) => {
        if (err) {
          // Log full error stack in development to assist debugging
          if (process.env.NODE_ENV !== 'production') {
            try { logger.error('Erro ao cadastrar funcionário (detalhe): ' + (err && (err.stack || err.message) ? (err.stack || err.message) : String(err))) } catch (e) {}
          } else {
            // Se err contém dados sensíveis, mascarar
            if (err && typeof err === 'object') {
              logger.error('Erro ao cadastrar funcionário:', maskSensitiveLog(err))
            } else {
              logger.error('Erro ao cadastrar funcionário:', err && err.message ? err.message : err)
            }
          }
          if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Entrada duplicada.' })
          return res.status(500).json({ message: 'Erro interno no servidor ao tentar cadastrar.' })
        }
        res.status(201).json({ message: 'Funcionário cadastrado com sucesso!', id: results.insertId })
      })
    } catch (hashErr) {
      logger.error('Erro ao hashear senha:', hashErr)
      return res.status(500).json({ message: 'Erro ao processar senha.' })
    }
  }
)

// Rota para UPLOAD DE FOTO
app.post('/api/funcionarios/:id/foto', authMiddleware, upload.single('foto'), (req, res) => {
  const { id } = req.params
  // apenas admin ou o próprio usuário pode alterar a foto
  if (!isAdminUser(req.user) && Number(req.user.id) !== Number(id)) {
    return res.status(403).json({ message: 'Acesso negado.' })
  }
  if (!req.file) return res.status(400).json({ message: 'Nenhum ficheiro foi enviado.' })

  const fotoUrl = `/uploads/fotos/${req.file.filename}`
  // create thumbnail (200x200) using sharp
  const uploadDir = path.join(__dirname, 'public', 'uploads', 'fotos')
  const ext = path.extname(req.file.filename)
  const base = path.basename(req.file.filename, ext)
  const thumbName = `${base}-thumb${ext}`
  const thumbPath = path.join(uploadDir, thumbName)

  sharp(req.file.path)
    .resize(200, 200, { fit: 'cover' })
    .toFile(thumbPath)
    .then(() => {
      const thumbUrl = `/uploads/fotos/${thumbName}`
      // Attempt to update both foto_perfil_url and foto_thumb_url (foto_thumb_url column may or may not exist)
      const sql = 'UPDATE funcionarios SET foto_perfil_url = ?, foto_thumb_url = ? WHERE id = ?'
      db.query(sql, [fotoUrl, thumbUrl, id], (err, results) => {
        if (err) {
          // If foto_thumb_url column doesn't exist, fall back to updating only foto_perfil_url
          if (err.code === 'ER_BAD_FIELD_ERROR') {
            const fallbackSql = 'UPDATE funcionarios SET foto_perfil_url = ? WHERE id = ?'
            db.query(fallbackSql, [fotoUrl, id], (fErr, fResults) => {
              if (fErr) {
                logger.error('Erro ao guardar foto (fallback):', fErr)
                return res.status(500).json({ message: 'Erro ao guardar a foto.' })
              }
              if (fResults.affectedRows === 0) return res.status(404).json({ message: 'Funcionário não encontrado.' })
              return res.json({ message: 'Foto atualizada com sucesso!', foto_url: fotoUrl, foto_thumb_url: thumbUrl })
            })
          } else {
            logger.error('Erro ao guardar foto:', err)
            return res.status(500).json({ message: 'Erro ao guardar a foto.' })
          }
        } else {
          if (results.affectedRows === 0) return res.status(404).json({ message: 'Funcionário não encontrado.' })
          return res.json({ message: 'Foto atualizada com sucesso!', foto_url: fotoUrl, foto_thumb_url: thumbUrl })
        }
      })
    })
    .catch((sharpErr) => {
      logger.error('Erro ao criar thumbnail:', sharpErr)
      // Even if thumbnail creation fails, try to update original photo URL
      const fallbackSql = 'UPDATE funcionarios SET foto_perfil_url = ? WHERE id = ?'
      db.query(fallbackSql, [fotoUrl, id], (fErr, fResults) => {
        if (fErr) {
          logger.error('Erro ao guardar foto após falha no thumbnail:', fErr)
          return res.status(500).json({ message: 'Erro ao guardar a foto.' })
        }
        if (fResults.affectedRows === 0) return res.status(404).json({ message: 'Funcionário não encontrado.' })
        return res.json({ message: 'Foto enviada, thumbnail falhou.', foto_url: fotoUrl })
      })
    })
})

// Rota para UPLOAD DE ATESTADO (PDF, imagens) - tanto funcionário quanto admin podem enviar
// Uses a separate storage destination under public/uploads/atéstados
const atéstadoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'public', 'uploads', 'atéstados')
    fs.mkdirSync(uploadPath, { recursive: true })
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    cb(null, safeUploadFilename('atestado', req, file))
  }
})

// Filtro de arquivos para atestados - ATUALIZADO 17/01/2026
const atestadoFileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif'];
  const allowedExts = /\.(pdf|jpg|jpeg|png|gif)$/i;
  
  if (allowedTypes.includes(file.mimetype) && allowedExts.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('Apenas PDF ou imagens (JPG, PNG, GIF) são permitidos para atestados.'), false);
  }
};

const uploadAtestado = multer({ storage: atéstadoStorage, fileFilter: atestadoFileFilter, limits: { fileSize: 5 * 1024 * 1024 } }) // 5MB

app.post('/api/funcionarios/:id/atéstado', authMiddleware, uploadAtestado.single('atéstado'), async (req, res) => {
  const { id } = req.params
  // only admin or the owner can upload their atéstado
  if (!isAdminUser(req.user) && Number(req.user.id) !== Number(id)) {
    return res.status(403).json({ message: 'Acesso negado.' })
  }
  if (!req.file) return res.status(400).json({ message: 'Nenhum ficheiro enviado.' })

  const arquivoUrl = `/uploads/atéstados/${req.file.filename}`
  const descrição = req.body.descrição || req.body.motivo || null
  const dataAtestado = req.body.data_atestado || null
  const dias = req.body.dias ? Number(req.body.dias) : 0

  try {
    const sql = 'INSERT INTO atéstados (funcionario_id, data_atestado, dias_afastado, motivo, arquivo_url, data_upload) VALUES (?, ?, ?, ?, ?, NOW())'
    await dbQuery(sql, [id, dataAtestado, dias, descrição, arquivoUrl])
    return res.json({ message: 'Atéstado enviado com sucesso.', url: arquivoUrl })
  } catch (e) {
    logger.error('Erro ao gravar atéstado:', e)
    return res.status(500).json({ message: 'Erro interno ao gravar atéstado.' })
  }
})

// Storage for holerites (PDF only)
const holeriteStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'public', 'uploads', 'holerites')
    fs.mkdirSync(uploadPath, { recursive: true })
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    cb(null, safeUploadFilename('holerite', req, file))
  }
})

function pdfFileFilter (req, file, cb) {
  if (file.mimetype !== 'application/pdf') return cb(new Error('Apenas ficheiros PDF são permitidos para holerites.'))
  cb(null, true)
}

const uploadHolerite = multer({ storage: holeriteStorage, fileFilter: pdfFileFilter, limits: { fileSize: 20 * 1024 * 1024 } })

// Endpoint for admin to upload holerite for a funcionario
app.post('/api/funcionarios/:id/holerite', authMiddleware, uploadHolerite.single('holerite'), async (req, res) => {
  const { id } = req.params
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado.' })
  if (!req.file) return res.status(400).json({ message: 'Nenhum ficheiro enviado.' })
  const arquivoUrl = `/uploads/holerites/${req.file.filename}`
  const competencia = req.body.competencia || null
  try {
    // Ensure holerites table exists (defensive)
    const ensureHolerites = `CREATE TABLE IF NOT EXISTS holerites (
            id INT AUTO_INCREMENT PRIMARY KEY,
            funcionario_id INT NOT NULL,
            mes_referencia VARCHAR(7) DEFAULT NULL,
            arquivo_url VARCHAR(255) NOT NULL,
            data_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            competencia VARCHAR(10) DEFAULT NULL,
            FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    try { await dbQuery(ensureHolerites) } catch (ee) { logger.warn('Falha ao garantir tabela holerites (prosseguindo):', ee) }

    // Some schemas expect mes_referencia (YYYY-MM) NOT NULL; derive it from competencia or today
    const mesRef = competencia && String(competencia).trim() ? String(competencia).trim() : (new Date()).toISOString().slice(0, 7)
    try {
      await dbQuery('INSERT INTO holerites (funcionario_id, mes_referencia, arquivo_url, data_upload, competencia) VALUES (?, ?, ?, NOW(), ?)', [id, mesRef, arquivoUrl, competencia])
    } catch (innerErr) {
      // If the target schema doesn't have mes_referencia (older schema), fallback to previous insert
      if (innerErr && innerErr.code === 'ER_BAD_FIELD_ERROR') {
        await dbQuery('INSERT INTO holerites (funcionario_id, competencia, arquivo_url, data_upload) VALUES (?, ?, ?, NOW())', [id, competencia, arquivoUrl])
      } else {
        throw innerErr
      }
    }

    return res.json({ message: 'Holerite enviado com sucesso.', url: arquivoUrl })
  } catch (e) {
    logger.error('Erro ao gravar holerite:', e && e.stack ? e.stack : e)
    return res.status(500).json({ message: 'Erro interno ao gravar holerite.' })
  }
})

// Storage for espelho de ponto (PDF preferred but allow images)
const pontoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'public', 'uploads', 'ponto')
    fs.mkdirSync(uploadPath, { recursive: true })
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    const idPart = req.params && req.params.id ? String(req.params.id) : 'unknown'
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, `ponto-${idPart}-${uniqueSuffix}${path.extname(file.originalname)}`)
  }
})

// Filtro de arquivos para espelho de ponto - ATUALIZADO 17/01/2026
const pontoFileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  const allowedExts = /\.(pdf|jpg|jpeg|png)$/i;
  
  if (allowedTypes.includes(file.mimetype) && allowedExts.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('Apenas PDF ou imagens (JPG, PNG) são permitidos para espelho de ponto.'), false);
  }
};

const uploadPonto = multer({ storage: pontoStorage, fileFilter: pontoFileFilter, limits: { fileSize: 8 * 1024 * 1024 } })

// Endpoint for RH to upload espelho de ponto for a funcionario
app.post('/api/funcionarios/:id/ponto', authMiddleware, uploadPonto.single('ponto'), async (req, res) => {
  const { id } = req.params
  // only RH or admin roles can upload ponto
  const allowed = ['rh', 'diretoria', 'financeiro']
  // normalize role label
  const roleNormalized = (req.user.role || '').toLowerCase()
  if (!isAdminUser(req.user) && !allowed.includes(roleNormalized)) return res.status(403).json({ message: 'Acesso negado.' })
  if (!req.file) return res.status(400).json({ message: 'Nenhum ficheiro enviado.' })
  const arquivoUrl = `/uploads/ponto/${req.file.filename}`
  const competencia = req.body.competencia || null
  try {
    await dbQuery('INSERT INTO espelhos_ponto (funcionario_id, competencia, arquivo_url, data_upload) VALUES (?, ?, ?, NOW())', [id, competencia, arquivoUrl])
    return res.json({ message: 'Espelho de ponto enviado com sucesso.', url: arquivoUrl })
  } catch (e) {
    logger.error('Erro ao gravar espelho de ponto:', e)
    return res.status(500).json({ message: 'Erro interno ao gravar espelho de ponto.' })
  }
})

// Rota para buscar funcionários (para a página de admin) - protegida
// Suporta:
//  - ?q=termo  -> pesquisa por nome_completo ou email
//  - ?birth_month=MM -> retorna funcionários cujo MONTH(data_nascimento) = MM (1-12)
app.get('/api/funcionarios', authMiddleware, (req, res) => {
  // Apenas admins podem listar todos
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado.' })

  const q = (req.query.q || '').trim()
  const birthMonth = req.query.birth_month ? Number(req.query.birth_month) : null
  const noFoto = req.query.no_foto ? String(req.query.no_foto) === '1' : false
  const limit = req.query.limit ? Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 10)) : null
  const includeAll = req.query.include_all === '1' // Parmetro para incluir todos (admin view)
  let sql; let params = []
  
  // Filtro base: apenas funcionários ativos, excluindo Diretoria e Consultoria
  const baseFilter = includeAll ? '' : 'ativo = 1 AND departamento NOT IN ("Diretoria", "Consultoria")'

  if (birthMonth && Number.isInteger(birthMonth) && birthMonth >= 1 && birthMonth <= 12) {
    const whereClause = baseFilter ? `${baseFilter} AND ` : ''
    sql = `SELECT id, foto_perfil_url AS foto_url, foto_thumb_url, COALESCE(nome_completo, email) AS nome, role AS cargo, email, data_nascimento, departamento FROM funcionarios WHERE ${whereClause}data_nascimento IS NOT NULL AND MONTH(data_nascimento) = ? ORDER BY DAY(data_nascimento)`
    params.push(birthMonth)
  } else if (noFoto) {
    // return users without a custom photo (null or empty) or explicitly using placeholder
    const lim = limit || 10
    const whereClause = baseFilter ? `${baseFilter} AND ` : ''
    sql = `SELECT id, COALESCE(nome_completo, email) AS nome, foto_perfil_url, foto_thumb_url, departamento FROM funcionarios WHERE ${whereClause}(foto_perfil_url IS NULL OR foto_perfil_url = "" OR foto_perfil_url LIKE ?) LIMIT ?`
    params.push('%placeholder%')
    params.push(lim)
  } else if (q) {
    const whereClause = baseFilter ? `${baseFilter} AND ` : ''
    sql = `SELECT id, foto_perfil_url AS foto_url, foto_thumb_url, COALESCE(nome_completo, email) AS nome, role AS cargo, email, departamento FROM funcionarios WHERE ${whereClause}(nome_completo LIKE ? OR email LIKE ?) LIMIT 200`
    const like = `%${q}%`
    params.push(like, like)
  } else {
    const whereClause = baseFilter ? `WHERE ${baseFilter}` : ''
    sql = `SELECT id, foto_perfil_url AS foto_url, foto_thumb_url, COALESCE(nome_completo, email) AS nome, role AS cargo, email, departamento FROM funcionarios ${whereClause} ORDER BY nome_completo`
  }

  db.query(sql, params, (err, results) => {
    if (err) {
      logger.error('Erro ao buscar funcionarios:', err)
      return res.status(500).json({ message: 'Erro interno no servidor.' })
    }
    res.json(results)
  })
})

// Rota para buscar UM funcionário por ID
app.get('/api/funcionarios/:id', authMiddleware, (req, res) => {
  const { id } = req.params
  // AUDIT-FIX: Exclude password_hash, salt, senha from SELECT
  const sql = `SELECT id, email, nome_completo, role, departamento, foto_perfil_url, foto_thumb_url,
               telefone, data_nascimento, estado_civil, dependentes, ativo, status,
               data_admissao, data_demissao, cargo, endereco, cidade, uf, cep,
               cpf, rg, pis, ctps, banco, agencia, conta, tipo_conta,
               observacoes, escolaridade, genero
               FROM funcionarios WHERE id = ? LIMIT 1`
  db.query(sql, [id], async (err, results) => {
    if (err) {
      logger.error('Erro ao buscar funcionario:', err)
      return res.status(500).json({ message: 'Erro interno no servidor.' })
    }
    if (!results || results.length === 0) return res.status(404).json({ message: 'Funcionário não encontrado.' })
    // Permitir que o próprio usuário busque seus dados ou admin
    if (!isAdminUser(req.user) && Number(req.user.id) !== Number(id)) {
      return res.status(403).json({ message: 'Acesso negado.' })
    }

    try {
      // fetch recent holerites and latest ponto for this funcionario
      const holerites = await dbQuery('SELECT id, competencia, arquivo_url, data_upload FROM holerites WHERE funcionario_id = ? ORDER BY data_upload DESC LIMIT 10', [id])
      const pontoRows = await dbQuery('SELECT id, competencia, arquivo_url, data_upload FROM espelhos_ponto WHERE funcionario_id = ? ORDER BY data_upload DESC LIMIT 1', [id])
      const latestPonto = (pontoRows && pontoRows.length > 0) ? pontoRows[0] : null

      // AUDIT-FIX: Strip all sensitive fields (defense-in-depth)
      const { senha, password_hash, salt, ...dadosSeguros } = results[0]
      // attach holerites and ponto info
      dadosSeguros.holerites = holerites || []
      dadosSeguros.espelho_ponto = latestPonto
      res.json(dadosSeguros)
    } catch (e) {
      logger.error('Erro ao buscar holerites/ponto para funcionario:', e)
      const { senha, password_hash, salt, ...dadosSeguros } = results[0]
      dadosSeguros.holerites = []
      dadosSeguros.espelho_ponto = null
      res.json(dadosSeguros)
    }
  })
})

// Rota para ATUALIZAR dados do funcionário
app.put('/api/funcionarios/:id', authMiddleware, (req, res) => {
  const { id } = req.params
  // Apenas admin ou o próprio usuário pode atualizar
  if (!isAdminUser(req.user) && Number(req.user.id) !== Number(id)) {
    return res.status(403).json({ message: 'Acesso negado.' })
  }
  // If the requester is admin, allow extended fields (including adminAllowedFields).
  const employeeAllowed = ['telefone', 'estado_civil', 'dependentes']
  let allowed = []
  if (req.user.role === 'admin') {
    // allow admins to update birthdate as well so aniversariantes refletem alterações
    allowed = employeeAllowed.concat(['nome_completo', 'cargo', 'departamento', 'status', 'data_nascimento'], adminAllowedFields)
  } else {
    allowed = employeeAllowed
  }
  const updates = []
  const params = []

  // Explicit whitelist for columns that may be updated. This prevents any accidental
  // interpolation of unsafe identifiers. `adminAllowedFields` is appended for admin users.
  const baseSafe = ['telefone', 'estado_civil', 'dependentes', 'nome_completo', 'cargo', 'departamento', 'status', 'data_nascimento']
  const safeCols = new Set(baseSafe.concat(adminAllowedFields || []))

  // Basic validation for some fields coming from the client
  if (Object.prototype.hasOwnProperty.call(req.body, 'dependentes')) {
    const d = Number(req.body.dependentes)
    if (!Number.isInteger(d) || d < 0) return res.status(400).json({ message: 'dependentes deve ser inteiro >= 0' })
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'telefone')) {
    const t = String(req.body.telefone || '').replace(/\D/g, '')
    if (t.length < 8) return res.status(400).json({ message: 'telefone inválido.' })
    // normalize telefone to digits-only
    req.body.telefone = t
  }

  for (const key of allowed) {
    // ensure the column name is in our explicit safe list
    if (!safeCols.has(key)) {
      // skip any unexpected column names (defensive)
      continue
    }
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      updates.push(`${key} = ?`)
      params.push(req.body[key])
    }
  }

  if (updates.length === 0) return res.status(400).json({ message: 'Nenhum campo para atualizar.' })

  params.push(id)
  const sql = `UPDATE funcionarios SET ${updates.join(', ')} WHERE id = ?`
  db.query(sql, params, (err, results) => {
    if (err) {
      logger.error('Erro ao atualizar funcionario:', err)
      return res.status(500).json({ message: 'Erro interno no servidor.' })
    }
    if (results.affectedRows === 0) return res.status(404).json({ message: 'Funcionário não encontrado.' })
    res.json({ message: 'Dados atualizados com sucesso!', updatedData: req.body })
  })
})

// ------------------
// Rotas de AVISOS
// ------------------
// GET /api/notifications/count -> contagem de notificações não lidas
app.get('/api/notifications/count', authMiddleware, async (req, res) => {
  try {
    // Contar avisos não lidos para o usuário
    const sql = `SELECT COUNT(*) as count 
                FROM avisos a 
                LEFT JOIN avisos_lidos al ON al.aviso_id = a.id AND al.funcionario_id = ?
                WHERE al.id IS NULL`
    
    db.query(sql, [req.user.id], (err, results) => {
      if (err) {
        logger.error('Erro ao contar notificações:', err)
        return res.status(500).json({ count: 0 })
      }
      const count = results && results[0] ? results[0].count : 0
      res.json({ count })
    })
  } catch (error) {
    logger.error('Erro ao buscar contagem de notificações:', error)
    res.json({ count: 0 })
  }
})

// GET /api/user-data -> dados atualizados do usuário
app.get('/api/user-data', authMiddleware, async (req, res) => {
  try {
    // AUDIT-FIX: Exclude sensitive fields in SQL instead of SELECT * + delete
    const sql = `SELECT id, email, nome_completo, role, departamento, foto_perfil_url, foto_thumb_url,
                 telefone, data_nascimento, estado_civil, dependentes, ativo, status,
                 data_admissao, data_demissao, cargo, endereco, cidade, uf, cep,
                 cpf, rg, pis, ctps, banco, agencia, conta, tipo_conta
                 FROM funcionarios WHERE id = ?`
    
    db.query(sql, [req.user.id], (err, results) => {
      if (err) {
        logger.error('Erro ao buscar dados do usuário:', err)
        return res.status(500).json({ success: false, message: 'Erro interno no servidor.' })
      }
      
      if (results && results.length > 0) {
        const userData = results[0]
        // AUDIT-FIX: password_hash and salt are no longer in the query results
        
        res.json({ success: true, userData })
      } else {
        res.status(404).json({ success: false, message: 'Usuário não encontrado.' })
      }
    })
  } catch (error) {
    logger.error('Erro ao recarregar dados do usuário:', error)
    res.status(500).json({ success: false, message: 'Erro interno no servidor.' })
  }
})

// GET /api/avisos  -> listar avisos (todos os utilizadores autenticados podem ver)
app.get('/api/avisos', optionalAuth, async (req, res) => {
  try {
    // If a user is present, include lido state via left join; otherwise return public list.
    if (req.user && req.user.id) {
      const sql = `SELECT a.id, a.titulo, a.conteudo AS mensagem, NULL AS created_by, a.data_publicacao AS created_at,
                CASE WHEN al.id IS NOT NULL THEN 1 ELSE 0 END AS lido
                FROM avisos a
                LEFT JOIN avisos_lidos al ON al.aviso_id = a.id AND al.funcionario_id = ?
                ORDER BY a.data_publicacao DESC
                LIMIT 50`
      db.query(sql, [req.user.id], (err, results) => {
        if (err) {
          logger.error('Erro ao buscar avisos:', err)
          return res.status(500).json({ message: 'Erro interno no servidor.' })
        }
        const mapped = (results || []).map(r => ({ ...r, lido: r.lido === 1 }))
        return res.json(mapped)
      })
    } else {
      const rows = await dbQuery('SELECT id, titulo, conteudo AS mensagem, data_publicacao AS created_at FROM avisos ORDER BY data_publicacao DESC LIMIT 50')
      return res.json(rows || [])
    }
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') return res.json([])
    logger.error('Erro ao obter avisos:', err)
    return res.status(500).json({ message: 'Erro ao carregar avisos.' })
  }
})

// POST /api/avisos -> criar aviso (apenas admin)
app.post('/api/avisos', authMiddleware, (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado.' })
  const { titulo, mensagem } = req.body || {}
  if (!titulo || !mensagem) return res.status(400).json({ message: 'Título e mensagem são obrigatórios.' })
  // insert into avisos using 'conteudo' and 'data_publicacao' columns
  const sql = 'INSERT INTO avisos (titulo, conteudo, data_publicacao) VALUES (?, ?, NOW())'
  db.query(sql, [titulo, mensagem], (err, results) => {
    if (err) {
      logger.error('Erro ao criar aviso:', err)
      return res.status(500).json({ message: 'Erro interno no servidor.' })
    }
    const insertedId = results.insertId
    // fetch the inserted aviso to broadcast
    db.query('SELECT id, titulo, conteudo AS mensagem, data_publicacao AS created_at FROM avisos WHERE id = ? LIMIT 1', [insertedId], (sErr, rows) => {
      if (sErr) {
        logger.error('Erro ao buscar aviso inserido:', sErr)
        return res.status(201).json({ message: 'Aviso criado.', id: insertedId })
      }
      const row = (rows && rows[0]) ? rows[0] : null
      const aviso = row ? { id: row.id, titulo: row.titulo, mensagem: row.mensagem, created_at: row.created_at } : { id: insertedId, titulo, mensagem, created_at: new Date() }
      // broadcast to SSE clients (non-blocking) with explicit action
      try { broadcastAviso({ ...aviso, action: 'created' }) } catch (e) { logger.warn('Broadcast aviso falhou:', e) }
      return res.status(201).json({ message: 'Aviso criado.', aviso })
    })
  })
})

// DELETE /api/avisos/:id -> remover (apenas admin)
app.delete('/api/avisos/:id', authMiddleware, (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado.' })
  const { id } = req.params
  // Buscar aviso antes de deletar para broadcast completo
  db.query('SELECT id, titulo, conteudo AS mensagem, data_publicacao AS created_at FROM avisos WHERE id = ? LIMIT 1', [id], (fetchErr, rows) => {
    const aviso = (rows && rows[0]) ? rows[0] : { id: Number(id) }
    const sql = 'DELETE FROM avisos WHERE id = ?'
    db.query(sql, [id], (err, results) => {
      if (err) {
        logger.error('Erro ao apagar aviso:', err)
        return res.status(500).json({ message: 'Erro interno no servidor.' })
      }
      if (results.affectedRows === 0) return res.status(404).json({ message: 'Aviso não encontrado.' })
      // Garantir created_at como string ISO
      if (aviso.created_at && typeof aviso.created_at !== 'string') {
        try { aviso.created_at = new Date(aviso.created_at).toISOString() } catch (e) {}
      }
      try { broadcastAviso({ ...aviso, action: 'deleted' }) } catch (e) { logger.warn('Broadcast delete aviso falhou:', e) }
      res.json({ message: 'Aviso removido.' })
    })
  })
})

// PUT /api/avisos/:id -> atualizar aviso (apenas admin)
app.put('/api/avisos/:id', authMiddleware, (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado.' })
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'ID inválido.' })
  const { titulo, mensagem } = req.body || {}
  if (!titulo && !mensagem) return res.status(400).json({ message: 'Título ou mensagem devem ser fornecidos.' })
  const updates = []
  const params = []
  if (titulo) { updates.push('titulo = ?'); params.push(titulo) }
  if (mensagem) { updates.push('conteudo = ?'); params.push(mensagem) }
  // set data_publicacao to NOW() to update publish time when edited
  updates.push('data_publicacao = NOW()')

  params.push(id)
  const sql = `UPDATE avisos SET ${updates.join(', ')} WHERE id = ?`
  db.query(sql, params, (err, results) => {
    if (err) {
      logger.error('Erro ao atualizar aviso:', err)
      return res.status(500).json({ message: 'Erro interno no servidor.' })
    }
    if (results.affectedRows === 0) return res.status(404).json({ message: 'Aviso não encontrado.' })
    // return the updated aviso
    db.query('SELECT id, titulo, conteudo AS mensagem, data_publicacao AS created_at FROM avisos WHERE id = ? LIMIT 1', [id], (sErr, rows) => {
      if (sErr) {
        logger.error('Erro ao buscar aviso atualizado:', sErr)
        return res.json({ message: 'Aviso atualizado.' })
      }
      const row = (rows && rows[0]) ? rows[0] : null
      const aviso = row ? { id: row.id, titulo: row.titulo, mensagem: row.mensagem, created_at: row.created_at } : null
      try { if (aviso) broadcastAviso({ ...aviso, action: 'updated' }) } catch (e) { logger.warn('Broadcast updated aviso falhou:', e) }
      res.json({ message: 'Aviso atualizado.', aviso })
    })
  })
})

// GET /api/avisos/:id -> obter um aviso por id (autenticado)
app.get('/api/avisos/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'ID inválido.' })
  const sql = `SELECT a.id, a.titulo, a.conteudo AS mensagem, a.data_publicacao AS created_at,
                CASE WHEN al.id IS NOT NULL THEN 1 ELSE 0 END AS lido
                FROM avisos a
                LEFT JOIN avisos_lidos al ON al.aviso_id = a.id AND al.funcionario_id = ?
                WHERE a.id = ? LIMIT 1`
  db.query(sql, [req.user.id, id], (err, results) => {
    if (err) {
      logger.error('Erro ao buscar aviso por id:', err)
      return res.status(500).json({ message: 'Erro interno no servidor.' })
    }
    if (!results || results.length === 0) return res.status(404).json({ message: 'Aviso não encontrado.' })
    const r = results[0]
    // normalize lido
    r.lido = r.lido === 1
    res.json(r)
  })
})

// Rota para alterar senha
app.post('/api/funcionarios/:id/senha',
  authMiddleware,
  body('senha').isLength({ min: 10 }).withMessage('Senha deve ter ao menos 10 caracteres')
    .matches(/[A-Z]/).withMessage('Senha deve conter letra maiúscula')
    .matches(/[a-z]/).withMessage('Senha deve conter letra minúscula')
    .matches(/[0-9]/).withMessage('Senha deve conter número')
    .matches(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/).withMessage('Senha deve conter caractere especial'),
  async (req, res) => {
    const { id } = req.params
    if (!isAdminUser(req.user) && Number(req.user.id) !== Number(id)) {
      return res.status(403).json({ message: 'Acesso negado.' })
    }
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const nova = req.body.senha
    try {
      const hashed = await bcrypt.hash(nova, 12)
      // SECURITY FIX: Atualizar senha com hash bcrypt + limpar texto plano
      const sql = 'UPDATE funcionarios SET senha = ?, senha_texto = NULL WHERE id = ?'
      db.query(sql, [hashed, id], (err, results) => {
        if (err) {
          logger.error('Erro ao atualizar senha:', err)
          return res.status(500).json({ message: 'Erro interno no servidor.' })
        }
        if (results.affectedRows === 0) return res.status(404).json({ message: 'Funcionário não encontrado.' })
        res.json({ message: 'Senha atualizada com sucesso.' })
      })
    } catch (hashErr) {
      logger.error('Erro ao hashear senha:', hashErr)
      return res.status(500).json({ message: 'Erro interno.' })
    }
  }
)

// Rota para obter dados do usuário autenticado
app.get('/api/me', authMiddleware, (req, res) => {
  // AUDIT-FIX: Exclude sensitive fields in SQL
  const sql = `SELECT id, email, nome_completo, role, departamento, foto_perfil_url, foto_thumb_url,
               telefone, data_nascimento, estado_civil, dependentes, ativo, status,
               data_admissao, cargo, observacoes
               FROM funcionarios WHERE id = ? LIMIT 1`
  db.query(sql, [req.user.id], (err, results) => {
    if (err) {
      logger.error('Erro ao buscar usuário:', err)
      return res.status(500).json({ message: 'Erro interno no servidor.' })
    }
    if (!results || results.length === 0) return res.status(404).json({ message: 'Usuário não encontrado.' })
    res.json(results[0])
  })
})

// ------------------
// Persistência de leitura de avisos (per-user)
// ------------------
// GET /api/avisos/read -> retorna array de aviso_ids lidos pelo utilizador
app.get('/api/avisos/read', authMiddleware, async (req, res) => {
  try {
    const rows = await dbQuery('SELECT aviso_id FROM avisos_lidos WHERE funcionario_id = ?', [req.user.id])
    const ids = (rows || []).map(r => r.aviso_id)
    res.json({ read: ids })
  } catch (e) {
    logger.error('Erro ao buscar avisos lidos:', e)
    res.status(500).json({ message: 'Erro interno.' })
  }
})

// POST /api/avisos/:id/read -> marcar como lido
app.post('/api/avisos/:id/read', authMiddleware, async (req, res) => {
  const avisoId = Number(req.params.id)
  if (!Number.isInteger(avisoId) || avisoId <= 0) return res.status(400).json({ message: 'ID de aviso inválido.' })
  try {
    const now = new Date()
    const sql = 'INSERT INTO avisos_lidos (aviso_id, funcionario_id, lido_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE lido_at = VALUES(lido_at)'
    await dbQuery(sql, [avisoId, req.user.id, now])
    res.json({ message: 'Marcado como lido.', aviso_id: avisoId })
  } catch (e) {
    logger.error('Erro ao marcar aviso como lido:', e)
    res.status(500).json({ message: 'Erro interno.' })
  }
})

// DELETE /api/avisos/:id/read -> desmarcar como lido
app.delete('/api/avisos/:id/read', authMiddleware, async (req, res) => {
  const avisoId = Number(req.params.id)
  if (!Number.isInteger(avisoId) || avisoId <= 0) return res.status(400).json({ message: 'ID de aviso inválido.' })
  try {
    const sql = 'DELETE FROM avisos_lidos WHERE aviso_id = ? AND funcionario_id = ?'
    await dbQuery(sql, [avisoId, req.user.id])
    res.json({ message: 'Marcado como não lido.' })
  } catch (e) {
    logger.error('Erro ao desmarcar aviso como lido:', e)
    res.status(500).json({ message: 'Erro interno.' })
  }
})

// ------------------
// Dashboard summary (agregado) - para otimizar dashboard admin
// Disponível para utilizadores autenticados (admins veem tudo)
// ------------------
app.get('/api/dashboard/summary', authMiddleware, async (req, res) => {
  try {
    // Avisos (limitados)
    const avisos = await dbQuery('SELECT id, titulo, conteudo AS mensagem, NULL AS created_by, data_publicacao AS created_at FROM avisos ORDER BY data_publicacao DESC LIMIT 20')

    // Aniversariantes do mês
    const now = new Date()
    const month = now.getMonth() + 1
    // Return both foto_perfil_url and foto_url (legacy) so frontend can use either property
  const aniversariantes = await dbQuery('SELECT id, COALESCE(nome_completo, email) AS nome, foto_perfil_url, foto_thumb_url, foto_perfil_url AS foto_url, data_nascimento FROM funcionarios WHERE data_nascimento IS NOT NULL AND MONTH(data_nascimento) = ? ORDER BY DAY(data_nascimento)', [month])

    // Usuarios sem foto (para o banner)
    let semFoto = []
    try {
  semFoto = await dbQuery('SELECT id, COALESCE(nome_completo, email) AS nome FROM funcionarios WHERE foto_perfil_url IS NULL OR foto_perfil_url = "" OR foto_perfil_url LIKE ? LIMIT 20', ['%placeholder%'])
    } catch (e) {
      semFoto = []
    }

    // Tempo de casa (pegar id, nome, data_admissao)
  const funcionarios = await dbQuery('SELECT id, COALESCE(nome_completo, email) AS nome, data_admissao FROM funcionarios')
    const tempoCasa = funcionarios.map(f => {
      const adm = f.data_admissao ? new Date(f.data_admissao) : null
      const dias = adm ? Math.floor((Date.now() - adm.getTime()) / (1000 * 60 * 60 * 24)) : null
      return { id: f.id, nome: f.nome, data_admissao: f.data_admissao, dias }
    }).sort((a, b) => (b.dias || 0) - (a.dias || 0)).slice(0, 50)

    // Atéstados recentes: juntar dos registros de atéstados (tabela atéstados se existir)
    let atéstados = []
    try {
      // se existe tabela atéstados, use-a
  atéstados = await dbQuery('SELECT a.id, a.funcionario_id, COALESCE(f.nome_completo, f.email) AS nome, a.nome_arquivo, a.url_arquivo, a.data_envio FROM atéstados a LEFT JOIN funcionarios f ON f.id = a.funcionario_id ORDER BY a.data_envio DESC LIMIT 50')
    } catch (e) {
      // tabela pode não existir; tentamos a versão que armazena em JSON na coluna funcionarios.atéstados (menos provável) -> ignorar
      atéstados = []
    }

    // If requester is not admin, include only what the user needs plus their own ponto/holerites
    if (req.user.role !== 'admin') {
      try {
        // fetch latest espelho_ponto for this user
        const pontoRows = await dbQuery('SELECT id, competencia, arquivo_url, data_upload FROM espelhos_ponto WHERE funcionario_id = ? ORDER BY data_upload DESC LIMIT 1', [req.user.id])
        const latestPonto = (pontoRows && pontoRows.length > 0) ? pontoRows[0] : null
        // do not include full tempoCasa aggregate for non-admins
        return res.json({ avisos, aniversariantes, atéstados, espelho_ponto: latestPonto })
      } catch (e) {
        logger.error('Erro ao buscar espelho de ponto para summary do user:', e)
        return res.json({ avisos, aniversariantes, atéstados })
      }
    }

    res.json({ avisos, aniversariantes, tempoCasa, atéstados, semFoto })
  } catch (err) {
    // Log full stack for server-side diagnostics, but do not leak internals to the client
    logger.error('Erro ao gerar dashboard summary:', err && err.stack ? err.stack : err)
    res.status(500).json({ message: 'Erro interno ao compilar resumo do dashboard.' })
  }
})

// ------------------
// Server-Sent Events (SSE) for avisos em tempo real
// ------------------
const sseClients = new Set()

function broadcastAviso (aviso) {
  try { logger.info('[SSE] Broadcast aviso:', aviso) } catch (e) {}
  if (aviso && aviso.created_at && typeof aviso.created_at !== 'string') {
    try { aviso.created_at = new Date(aviso.created_at).toISOString() } catch (e) {}
  }
  const str = JSON.stringify(aviso)
  for (const client of Array.from(sseClients)) {
    try {
      client.res.write('event: novo_aviso\n')
      if (aviso && aviso.id) client.res.write('id: ' + String(aviso.id) + '\n')
      client.res.write('data: ' + str + '\n\n')
    } catch (e) {
      try { client.res.end() } catch (_) {}
      try { if (client.interval) clearInterval(client.interval) } catch (_) {}
      sseClients.delete(client)
    }
  }
}

// SSE endpoint: supports token via Authorization header OR ?token=<jwt> so EventSource can connect
app.get('/api/avisos/stream', (req, res) => {
  // debug: log incoming url and query keys to help debug missing token cases
  try { logger.info('[SSE] incoming URL: ' + (req.originalUrl || req.url || '(no url)') + ' queryKeys:' + JSON.stringify(Object.keys(req.query || {}))) } catch (e) {}
  try { console.log('[SSE-DEBUG] rawUrl=', req.url, 'originalUrl=', req.originalUrl, 'headers.keys=', Object.keys(req.headers || {}), 'query=', req.query) } catch (e) { console.log('[SSE-DEBUG] failed to print req debug', e) }
  // try multiple common locations for a JWT so EventSource clients using
  // different param names still work: Authorization header, ?token=, ?access_token=,
  // X-Access-Token header, or ?auth= etc. Log a masked token for diagnostics.
  let token = null
  const auth = req.headers && req.headers.authorization
  if (auth && auth.startsWith && auth.startsWith('Bearer ')) token = auth.split(' ')[1]
  // common query param variants
  if (!token && req.query) {
    token = req.query.token || req.query.access_token || req.query.auth || req.query.bearer || null
    if (token) token = String(token)
  }
  // alternate header used by some clients
  if (!token && req.headers && req.headers['x-access-token']) token = String(req.headers['x-access-token'])

  function maskToken (t) {
    try {
      if (!t) return null
      return String(t).slice(0, 8) + '...' + String(t).slice(-6)
    } catch (ignored) { return '***' }
  }

  if (!token) {
    logger.warn('[SSE] conexao sem token detectada para /api/avisos/stream de IP ' + ((req.ip) || (req.connection && req.connection.remoteAddress) || 'unknown'))
    return res.status(401).json({ message: 'Token ausente.' })
  }
  try {
    // log masked token for easier debugging without leaking full JWT to logs
    try { logger.info('[SSE] token recebido (mascarado): ' + maskToken(token)) } catch (e) {}
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    // log a compact payload summary for diagnostics (do not print full token)
    try { logger.info(`[SSE] token payload: id=${payload && payload.id ? payload.id : 'unknown'} role=${payload && payload.role ? payload.role : 'unknown'} sse=${payload && payload.sse ? '1' : '0'}`) } catch (e) {}
    // attach minimal user info for this connection
    const user = { id: payload.id, role: payload.role }

    // required headers for SSE; disable proxy buffering (nginx)
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.flushHeaders && res.flushHeaders()
    // send an initial comment and retry suggestion
    res.write(': connected\n')
    res.write('retry: 10000\n\n')

    const client = { id: `${user.id}-${Date.now()}`, res, user }
    // ping interval to keep connection alive through proxies
    client.interval = setInterval(() => {
      try { client.res.write(': ping\n') } catch (e) {
        try { client.res.end() } catch (_) {}
        if (client.interval) clearInterval(client.interval)
        sseClients.delete(client)
      }
    }, 20000)

    sseClients.add(client)

    req.on('close', () => {
      try { if (client.interval) clearInterval(client.interval) } catch (_) {}
      sseClients.delete(client)
    })
  } catch (e) {
    try { logger.warn('[SSE] jwt verify failed for token (masked): ' + maskToken(token) + ' error: ' + (e && e.message ? e.message : String(e))) } catch (logErr) {}
    return res.status(401).json({ message: 'Token inválido para SSE.' })
  }
})

// Handshake endpoint: create a short-lived SSE token after validating Authorization header.
// This lets browsers that cannot set custom headers (EventSource) obtain a temporary
// token via an authenticated POST, then open an EventSource with the returned URL.
app.post('/api/avisos/sse-handshake', authMiddleware, (req, res) => {
  try {
    // create a short-lived token limited to SSE connections
    const shortToken = jwt.sign({ id: req.user.id, role: req.user.role, sse: true }, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '20s' })
    try { logger.info(`[SSE-HANDSHAKE] created short token for user=${req.user.id}`) } catch (e) {}
    return res.json({ url: `/api/avisos/stream?token=${encodeURIComponent(shortToken)}` })
  } catch (e) {
    logger.error('Erro no handshake SSE:', e)
    return res.status(500).json({ message: 'Erro ao gerar handshake SSE.' })
  }
})

// ==================== NOVAS APIS RH - DASHBOARD EXECUTIVO ====================

// GET /api/rh/funcionarios - Lista funcionários com estatísticas para o dashboard
// AUDIT-FIX MOD-004: Added role-based authorization check
app.get('/api/rh/funcionarios', authMiddleware, async (req, res) => {
  try {
    // AUDIT-FIX: Only admin, gerente, and RH roles can access employee dashboard
    const allowedRoles = ['admin', 'gerente', 'rh', 'diretoria', 'Administrador', 'Gerente'];
    const userRole = (req.user?.role || req.user?.cargo || '').toString();
    if (!allowedRoles.some(r => userRole.toLowerCase() === r.toLowerCase())) {
      return res.status(403).json({ message: 'Acesso negado. Permissão insuficiente para visualizar dados de funcionários.' });
    }

    const limit = req.query.limit ? Math.min(100, Math.max(1, parseInt(req.query.limit, 10))) : null;
    const includeStats = req.query.stats !== 'false';
    
    // Query base para funcionários
    let sql = `
      SELECT 
        id, nome_completo AS nome, email, cargo, role, departamento, 
        data_admissao, data_demissao, foto_perfil_url,
        CASE 
          WHEN ativo = FALSE OR data_demissao IS NOT NULL THEN 'Demitido'
          WHEN em_ferias = TRUE THEN 'Férias'
          ELSE 'Ativo'
        END as status
      FROM funcionarios 
      ORDER BY data_admissao DESC
    `;
    
    // AUDIT-FIX MOD-003: Parameterized LIMIT instead of string interpolation
    const params = [];
    if (limit) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }
    
    const funcionarios = await dbQuery(sql, params);
    
    if (!includeStats) {
      return res.json(funcionarios);
    }
    
    // Calcular estatísticas
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();
    
    const [statsTotal] = await dbQuery('SELECT COUNT(*) as total FROM funcionarios');
    const [statsAtivos] = await dbQuery('SELECT COUNT(*) as total FROM funcionarios WHERE (ativo = TRUE OR ativo IS NULL) AND data_demissao IS NULL');
    const [statsFerias] = await dbQuery('SELECT COUNT(*) as total FROM funcionarios WHERE em_ferias = TRUE AND (ativo = TRUE OR ativo IS NULL)');
    const [statsAdmissoes] = await dbQuery(
      'SELECT COUNT(*) as total FROM funcionarios WHERE MONTH(data_admissao) = ? AND YEAR(data_admissao) = ?',
      [mesAtual, anoAtual]
    );
    
    // Funcionários por departamento
    const departamentos = await dbQuery(`
      SELECT departamento, COUNT(*) as quantidade 
      FROM funcionarios 
      WHERE (ativo = TRUE OR ativo IS NULL) AND data_demissao IS NULL
      GROUP BY departamento 
      ORDER BY quantidade DESC
    `);
    
    // Cargos disponíveis
    const cargos = await dbQuery(`
      SELECT DISTINCT cargo FROM funcionarios WHERE cargo IS NOT NULL AND cargo != '' ORDER BY cargo
    `);
    
    res.json({
      funcionarios: funcionarios || [],
      stats: {
        total: statsTotal?.total || 0,
        ativos: statsAtivos?.total || 0,
        ferias: statsFerias?.total || 0,
        admissoes_mes: statsAdmissoes?.total || 0
      },
      departamentos: departamentos || [],
      cargos: cargos ? cargos.map(c => c.cargo) : []
    });
    
  } catch (error) {
    logger.error('Erro ao buscar funcionários RH:', error);
    res.status(500).json({ message: 'Erro ao buscar funcionários' });
  }
});

// GET /api/rh/atividades - Atividades recentes do módulo RH
app.get('/api/rh/atividades', authMiddleware, async (req, res) => {
  try {
    const limit = req.query.limit ? Math.min(50, Math.max(1, parseInt(req.query.limit, 10))) : 10;
    
    // Buscar atividades de várias fontes
    const atividades = [];
    
    // 1. Últimas admissões (últimos 60 dias)
    const admissoes = await dbQuery(`
      SELECT 
        nome_completo,
        data_admissao as created_at,
        'fa-user-plus' as icone,
        '#10b981' as cor,
        'admissao' as tipo
      FROM funcionarios 
      WHERE data_admissao >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
      ORDER BY data_admissao DESC
      LIMIT 5
    `);
    if (admissoes) {
      admissoes.forEach(a => {
        a.titulo = 'Admissão: ' + a.nome_completo;
        delete a.nome_completo;
      });
      atividades.push(...admissoes);
    }
    
    // 2. Últimos desligamentos (últimos 60 dias)
    const desligamentos = await dbQuery(`
      SELECT 
        nome_completo,
        data_demissao as created_at,
        'fa-user-minus' as icone,
        '#ef4444' as cor,
        'desligamento' as tipo
      FROM funcionarios 
      WHERE data_demissao >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
      ORDER BY data_demissao DESC
      LIMIT 3
    `);
    if (desligamentos) {
      desligamentos.forEach(d => {
        d.titulo = 'Desligamento: ' + d.nome_completo;
        delete d.nome_completo;
      });
      atividades.push(...desligamentos);
    }
    
    // 3. Últimos holerites enviados
    const holerites = await dbQuery(`
      SELECT 
        f.nome_completo,
        h.data_upload as created_at,
        'fa-file-invoice-dollar' as icone,
        '#3b82f6' as cor,
        'holerite' as tipo
      FROM holerites h
      JOIN funcionarios f ON h.funcionario_id = f.id
      WHERE h.data_upload >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      ORDER BY h.data_upload DESC
      LIMIT 3
    `);
    if (holerites) {
      holerites.forEach(h => {
        h.titulo = 'Holerite disponível: ' + h.nome_completo;
        delete h.nome_completo;
      });
      atividades.push(...holerites);
    }
    
    // 4. Avisos/comunicados recentes
    const avisos = await dbQuery(`
      SELECT 
        titulo,
        data_publicacao as created_at,
        'fa-bullhorn' as icone,
        '#f59e0b' as cor,
        'aviso' as tipo
      FROM avisos 
      WHERE data_publicacao >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      ORDER BY data_publicacao DESC
      LIMIT 3
    `);
    if (avisos) atividades.push(...avisos);
    
    // Ordenar por data (mais recentes primeiro)
    atividades.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Limitar resultado
    res.json(atividades.slice(0, limit));
    
  } catch (error) {
    logger.error('Erro ao buscar atividades RH:', error);
    res.status(500).json({ message: 'Erro ao buscar atividades' });
  }
});

// GET /api/rh/dashboard/kpis - KPIs principais do RH
app.get('/api/rh/dashboard/kpis', authMiddleware, async (req, res) => {
  try {
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();
    const mesAnterior = mesAtual === 1 ? 12 : mesAtual - 1;
    const anoMesAnterior = mesAtual === 1 ? anoAtual - 1 : anoAtual;

    // Total de funcionários ativos
    const totalAtivosRows = await dbQuery(
      'SELECT COUNT(*) as total FROM funcionarios WHERE ativo = TRUE OR ativo IS NULL'
    );
    const totalAtivos = totalAtivosRows[0] || { total: 0 };

    // Total de funcionários
    const totalFuncionariosRows = await dbQuery('SELECT COUNT(*) as total FROM funcionarios');
    const totalFuncionarios = totalFuncionariosRows[0] || { total: 0 };

    // Admissões no mês
    const admicoesmesRows = await dbQuery(
      'SELECT COUNT(*) as total FROM funcionarios WHERE MONTH(data_admissao) = ? AND YEAR(data_admissao) = ?',
      [mesAtual, anoAtual]
    );
    const admicoesmes = admicoesmesRows[0] || { total: 0 };

    // Desligamentos no mês
    const desligamentosRows = await dbQuery(
      'SELECT COUNT(*) as total FROM funcionarios WHERE MONTH(data_demissao) = ? AND YEAR(data_demissao) = ?',
      [mesAtual, anoAtual]
    );
    const desligamentos = desligamentosRows[0] || { total: 0 };

    // Cálculo de turnover (simplificado)
    const headcountMedio = totalAtivos.total;
    const turnoverMes = headcountMedio > 0 ? ((desligamentos.total / headcountMedio) * 100).toFixed(2) : 0;

    // Distribuição por departamento
    const distribuicaoDepartamento = await dbQuery(
      'SELECT departamento, COUNT(*) as quantidade FROM funcionarios WHERE ativo = TRUE OR ativo IS NULL GROUP BY departamento ORDER BY quantidade DESC LIMIT 10'
    );

    // Funcionários sem foto
    const semFotoRows = await dbQuery(
      'SELECT COUNT(*) as total FROM funcionarios WHERE (ativo = TRUE OR ativo IS NULL) AND (foto_perfil_url IS NULL OR foto_perfil_url = "")'
    );
    const semFoto = semFotoRows[0] || { total: 0 };

    res.json({
      totalFuncionarios: totalFuncionarios.total,
      funcionariosAtivos: totalAtivos.total,
      funcionariosInativos: totalFuncionarios.total - totalAtivos.total,
      admisoesNoMes: admicoesmes.total,
      desligamentosNoMes: desligamentos.total,
      turnoverMes: parseFloat(turnoverMes),
      distribuicaoDepartamento: distribuicaoDepartamento || [],
      semFoto: semFoto.total
    });
  } catch (error) {
    logger.error('Erro ao buscar KPIs:', error);
    res.status(500).json({ message: 'Erro ao buscar KPIs do dashboard' });
  }
});

// GET /api/rh/stats - Estatísticas rápidas para o dashboard admin (chamado pelo frontend rh-admin.js)
app.get('/api/rh/stats', authMiddleware, async (req, res) => {
  try {
    const totalFuncionariosStRows = await dbQuery(
      'SELECT COUNT(*) as total FROM funcionarios WHERE ativo = TRUE OR ativo IS NULL'
    );
    const totalFuncionariosSt = totalFuncionariosStRows[0] || { total: 0 };
    
    const funcionariosAtivosRows = await dbQuery(
      'SELECT COUNT(*) as total FROM funcionarios WHERE status = "ativo" OR (ativo = TRUE AND status IS NULL)'
    );
    const funcionariosAtivosSt = funcionariosAtivosRows[0] || { total: 0 };
    
    // Estimar folha de pagamento (soma dos salários base)
    const folhaPagamentoRows = await dbQuery(
      'SELECT COALESCE(SUM(salario_base), 0) as total FROM funcionarios WHERE ativo = TRUE OR ativo IS NULL'
    );
    const folhaPagamento = folhaPagamentoRows[0] || { total: 0 };
    
    // Faltas no mês atual
    const faltasMesRows = await dbQuery(
      `SELECT COUNT(*) as total FROM controle_ponto 
       WHERE MONTH(data) = MONTH(CURDATE()) AND YEAR(data) = YEAR(CURDATE()) 
       AND (tipo = 'falta' OR status = 'falta')`
    );
    const faltasMes = faltasMesRows[0] || { total: 0 };
    
    res.json({
      totalFuncionarios: totalFuncionariosSt.total || 0,
      funcionariosAtivos: funcionariosAtivosSt.total || 0,
      folhaPagamento: parseFloat(folhaPagamento.total || 0),
      faltasMes: faltasMes.total || 0
    });
  } catch (error) {
    logger.error('Erro ao buscar stats:', error);
    res.status(500).json({ message: 'Erro ao buscar estatísticas' });
  }
});

// GET /api/rh/funcionarios/recentes - Últimos funcionários admitidos (chamado pelo frontend rh-admin.js)
app.get('/api/rh/funcionarios/recentes', authMiddleware, async (req, res) => {
  try {
    const limite = parseInt(req.query.limit) || 5;
    
    const recentes = await dbQuery(
      `SELECT 
         id, nome_completo, cargo, departamento, data_admissao, foto_perfil_url,
         status, email_corporativo
       FROM funcionarios 
       WHERE (ativo = TRUE OR ativo IS NULL)
       ORDER BY data_admissao DESC
       LIMIT ?`,
      [limite]
    );
    
    res.json(recentes || []);
  } catch (error) {
    logger.error('Erro ao buscar funcionários recentes:', error);
    res.status(500).json({ message: 'Erro ao buscar funcionários recentes' });
  }
});

// GET /api/rh/funcionarios/:id - Buscar UM funcionário por ID (rota com prefixo /rh/)
app.get('/api/rh/funcionarios/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `SELECT id, email, nome_completo, role, departamento, foto_perfil_url, foto_thumb_url,
                 telefone, data_nascimento, estado_civil, dependentes, ativo, status,
                 data_admissao, data_demissao, cargo, endereco, cidade, uf, cep,
                 cpf, rg, pis, ctps, banco, agencia, conta, tipo_conta,
                 observacoes, escolaridade, genero
                 FROM funcionarios WHERE id = ? LIMIT 1`;
    const results = await dbQuery(sql, [id]);
    if (!results || results.length === 0) return res.status(404).json({ message: 'Funcionário não encontrado.' });
    // Permitir que o próprio usuário busque seus dados ou admin
    if (!isAdminUser(req.user) && Number(req.user.id) !== Number(id)) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }
    const { senha, password_hash, salt, ...dadosSeguros } = results[0];
    // Anexar holerites e ponto
    try {
      const holerites = await dbQuery('SELECT id, competencia, arquivo_url, data_upload FROM holerites WHERE funcionario_id = ? ORDER BY data_upload DESC LIMIT 10', [id]);
      const pontoRows = await dbQuery('SELECT id, competencia, arquivo_url, data_upload FROM espelhos_ponto WHERE funcionario_id = ? ORDER BY data_upload DESC LIMIT 1', [id]);
      dadosSeguros.holerites = holerites || [];
      dadosSeguros.espelho_ponto = (pontoRows && pontoRows.length > 0) ? pontoRows[0] : null;
    } catch (e) {
      dadosSeguros.holerites = [];
      dadosSeguros.espelho_ponto = null;
    }
    res.json(dadosSeguros);
  } catch (err) {
    logger.error('Erro ao buscar funcionário por ID (rh):', err);
    return res.status(500).json({ message: 'Erro interno no servidor.' });
  }
});

// GET /api/rh/notificacoes - Buscar notificações do funcionário (chamado pelo frontend funcionario.html)
app.get('/api/rh/notificacoes', authMiddleware, async (req, res) => {
  try {
    let funcionarioId = req.query.funcionario_id || req.user.id;
    // SEGURANÇA: Não permitir que usuário comum veja notificações de outro
    if (String(funcionarioId) !== String(req.user.id) && !isAdminUser(req.user)) {
      funcionarioId = req.user.id;
    }
    const limite = parseInt(req.query.limit) || 10;
    
    // Buscar notificações específicas do funcionário + avisos gerais
    const notificacoes = await dbQuery(`
      (SELECT 
         'aviso' as tipo,
         a.id,
         a.titulo,
         a.conteudo as mensagem,
         a.created_at,
         CASE WHEN al.id IS NOT NULL THEN 1 ELSE 0 END as lida
       FROM avisos a
       LEFT JOIN avisos_lidos al ON a.id = al.aviso_id AND al.funcionario_id = ?
       WHERE a.ativo = TRUE
       ORDER BY a.created_at DESC
       LIMIT ?)
      ORDER BY created_at DESC
    `, [funcionarioId, limite]);
    
    // Contar não lidas
    const naoLidasRows = await dbQuery(`
      SELECT COUNT(*) as total 
      FROM avisos a 
      LEFT JOIN avisos_lidos al ON a.id = al.aviso_id AND al.funcionario_id = ?
      WHERE a.ativo = TRUE AND al.id IS NULL
    `, [funcionarioId]);
    const naoLidas = naoLidasRows[0] || { total: 0 };
    
    res.json({
      notificacoes: notificacoes || [],
      nao_lidas: naoLidas?.total || 0
    });
  } catch (error) {
    logger.error('Erro ao buscar notificações:', error);
    res.status(500).json({ message: 'Erro ao buscar notificações' });
  }
});

// PUT /api/rh/notificacoes/:id/lida - Marcar notificação como lida
app.put('/api/rh/notificacoes/:id/lida', authMiddleware, async (req, res) => {
  try {
    const avisoId = req.params.id;
    const funcionarioId = req.user.id;
    
    // Verificar se já foi lida
    const [jaLida] = await dbQuery(
      'SELECT id FROM avisos_lidos WHERE aviso_id = ? AND funcionario_id = ?',
      [avisoId, funcionarioId]
    );
    
    if (!jaLida) {
      // Inserir como lida
      await dbQuery(
        'INSERT INTO avisos_lidos (aviso_id, funcionario_id, lido_em) VALUES (?, ?, NOW())',
        [avisoId, funcionarioId]
      );
    }
    
    res.json({ success: true, message: 'Notificação marcada como lida' });
  } catch (error) {
    logger.error('Erro ao marcar notificação como lida:', error);
    res.status(500).json({ message: 'Erro ao marcar notificação' });
  }
});

// GET /api/rh/dashboard/charts - Dados para gráficos
app.get('/api/rh/dashboard/charts', authMiddleware, async (req, res) => {
  try {
    // Distribuição por faixa etária
    const faixasEtarias = await dbQuery(`
      SELECT 
        CASE 
          WHEN TIMESTAMPDIFF(YEAR, data_nascimento, CURDATE()) < 25 THEN 'Até 24 anos'
          WHEN TIMESTAMPDIFF(YEAR, data_nascimento, CURDATE()) BETWEEN 25 AND 34 THEN '25-34 anos'
          WHEN TIMESTAMPDIFF(YEAR, data_nascimento, CURDATE()) BETWEEN 35 AND 44 THEN '35-44 anos'
          WHEN TIMESTAMPDIFF(YEAR, data_nascimento, CURDATE()) BETWEEN 45 AND 54 THEN '45-54 anos'
          ELSE '55+ anos'
        END as faixa,
        COUNT(*) as quantidade
      FROM funcionarios
      WHERE data_nascimento IS NOT NULL AND (ativo = TRUE OR ativo IS NULL)
      GROUP BY faixa
      ORDER BY faixa
    `);

    // Distribuição por tempo de casa
    const tempoCasa = await dbQuery(`
      SELECT 
        CASE 
          WHEN TIMESTAMPDIFF(MONTH, data_admissao, CURDATE()) < 6 THEN 'Até 6 meses'
          WHEN TIMESTAMPDIFF(MONTH, data_admissao, CURDATE()) BETWEEN 6 AND 12 THEN '6-12 meses'
          WHEN TIMESTAMPDIFF(YEAR, data_admissao, CURDATE()) BETWEEN 1 AND 2 THEN '1-2 anos'
          WHEN TIMESTAMPDIFF(YEAR, data_admissao, CURDATE()) BETWEEN 3 AND 5 THEN '3-5 anos'
          ELSE '5+ anos'
        END as faixa,
        COUNT(*) as quantidade
      FROM funcionarios
      WHERE data_admissao IS NOT NULL AND (ativo = TRUE OR ativo IS NULL)
      GROUP BY faixa
      ORDER BY faixa
    `);

    // Evolução de headcount (últimos 12 meses)
    const evolucaoHeadcount = await dbQuery(`
      SELECT 
        DATE_FORMAT(data_admissao, '%Y-%m') as mes,
        COUNT(*) as admissoes
      FROM funcionarios
      WHERE data_admissao >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY mes
      ORDER BY mes
    `);

    res.json({
      faixasEtarias: faixasEtarias || [],
      tempoCasa: tempoCasa || [],
      evolucaoHeadcount: evolucaoHeadcount || []
    });
  } catch (error) {
    logger.error('Erro ao buscar dados de gráficos:', error);
    res.status(500).json({ message: 'Erro ao buscar dados de gráficos' });
  }
});

// GET /api/rh/centro-custo - Listar centros de custo
app.get('/api/rh/centro-custo', authMiddleware, async (req, res) => {
  try {
    const centros = await dbQuery(
      'SELECT id, codigo, nome, descricao, ativo FROM centro_custo WHERE ativo = TRUE ORDER BY codigo LIMIT 500'
    );
    res.json(centros || []);
  } catch (error) {
    logger.error('Erro ao listar centros de custo:', error);
    res.status(500).json({ message: 'Erro ao listar centros de custo' });
  }
});

// POST /api/rh/centro-custo - Criar centro de custo (ADMIN ONLY)
app.post('/api/rh/centro-custo', authMiddleware, async (req, res) => {
  try {
    // Verificação de permissão de administrador
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem criar centros de custo.' });
    }
    
    const codigo = req.body.codigo ?? req.body['código'];
    const descricao = req.body.descricao ?? req.body['descrição'];
    const { departamento, responsavel_id } = req.body;
    const orcamento_mensal = req.body.orcamento_mensal ?? req.body['orçamento_mensal'];
    
    if (!codigo || !descricao) {
      return res.status(400).json({ message: 'Código e descrição são obrigatórios' });
    }

    const result = await dbQuery(
      'INSERT INTO centro_custo (codigo, descricao, departamento, responsavel_id, orcamento_mensal, ativo) VALUES (?, ?, ?, ?, ?, TRUE)',
      [codigo, descricao, departamento || null, responsavel_id || null, orcamento_mensal || null]
    );

    res.status(201).json({ id: result.insertId, message: 'Centro de custo criado com sucesso' });
  } catch (error) {
    logger.error('Erro ao criar centro de custo:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Código de centro de custo já existe' });
    }
    res.status(500).json({ message: 'Erro ao criar centro de custo' });
  }
});

// GET /api/rh/histórico-salarial/:funcionarioId - Histórico salarial de um funcionário
app.get('/api/rh/histórico-salarial/:funcionarioId', authMiddleware, async (req, res) => {
  try {
    const { funcionarioId } = req.params;
    
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver este histórico salarial
    // Apenas o próprio funcionário ou admin pode ver salários
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(funcionarioId) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seu próprio histórico salarial.' });
    }
    
    const histórico = await dbQuery(
      `SELECT h.*, f.nome_completo as aprovador_nome 
       FROM histórico_salarial h
       LEFT JOIN funcionarios f ON h.aprovado_por = f.id
       WHERE h.funcionario_id = ?
       ORDER BY h.data_vigencia DESC`,
      [funcionarioId]
    );

    res.json(histórico || []);
  } catch (error) {
    logger.error('Erro ao buscar histórico salarial:', error);
    res.status(500).json({ message: 'Erro ao buscar histórico salarial' });
  }
});

// POST /api/rh/histórico-salarial - Registrar reajuste salarial
app.post('/api/rh/histórico-salarial', authMiddleware, async (req, res) => {
  try {
    // AUDITORIA ENTERPRISE: Verificação obrigatória de admin para alteração de salário
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem alterar salários.' });
    }

    const { 
      funcionario_id, 
      salario_anterior, 
      salario_novo, 
      percentual_aumento,
      motivo, 
      tipo, 
      data_vigencia,
      observacoes 
    } = req.body;

    if (!funcionario_id || !salario_novo || !data_vigencia) {
      return res.status(400).json({ message: 'Dados incompletos' });
    }

    // Registrar no histórico
    const result = await dbQuery(
      `INSERT INTO histórico_salarial 
       (funcionario_id, salario_anterior, salario_novo, percentual_aumento, motivo, tipo, data_vigencia, aprovado_por, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [funcionario_id, salario_anterior || null, salario_novo, percentual_aumento || null, motivo || null, tipo || 'merito', data_vigencia, req.user.id, observacoes || null]
    );

    // Atualizar salário do funcionário
    await dbQuery(
      'UPDATE funcionarios SET salario = ? WHERE id = ?',
      [salario_novo, funcionario_id]
    );

    res.status(201).json({ id: result.insertId, message: 'Reajuste salarial registrado com sucesso' });
  } catch (error) {
    logger.error('Erro ao registrar reajuste salarial:', error);
    res.status(500).json({ message: 'Erro ao registrar reajuste salarial' });
  }
});

// GET /api/rh/histórico-cargos/:funcionarioId - Histórico de cargos de um funcionário
app.get('/api/rh/histórico-cargos/:funcionarioId', authMiddleware, async (req, res) => {
  try {
    const { funcionarioId } = req.params;
    
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver este histórico
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(funcionarioId) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seu próprio histórico de cargos.' });
    }
    
    const histórico = await dbQuery(
      `SELECT h.*, f.nome_completo as aprovador_nome 
       FROM histórico_cargos h
       LEFT JOIN funcionarios f ON h.aprovado_por = f.id
       WHERE h.funcionario_id = ?
       ORDER BY h.data_efetivacao DESC`,
      [funcionarioId]
    );

    res.json(histórico || []);
  } catch (error) {
    logger.error('Erro ao buscar histórico de cargos:', error);
    res.status(500).json({ message: 'Erro ao buscar histórico de cargos' });
  }
});

// POST /api/rh/histórico-cargos - Registrar mudança de cargo (ADMIN ONLY)
app.post('/api/rh/histórico-cargos', authMiddleware, async (req, res) => {
  try {
    // Verificação de permissão de administrador
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem registrar mudanças de cargo.' });
    }
    
    const {
      funcionario_id,
      cargo_anterior,
      cargo_novo,
      departamento_anterior,
      departamento_novo,
      tipo_movimentacao,
      data_efetivacao,
      motivo,
      observacoes
    } = req.body;

    if (!funcionario_id || !cargo_novo || !data_efetivacao) {
      return res.status(400).json({ message: 'Dados incompletos' });
    }

    // Registrar no histórico
    const result = await dbQuery(
      `INSERT INTO histórico_cargos 
       (funcionario_id, cargo_anterior, cargo_novo, departamento_anterior, departamento_novo, tipo_movimentacao, data_efetivacao, motivo, aprovado_por, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [funcionario_id, cargo_anterior || null, cargo_novo, departamento_anterior || null, departamento_novo || null, tipo_movimentacao || 'promocao', data_efetivacao, motivo || null, req.user.id, observacoes || null]
    );

    // Atualizar cargo e departamento do funcionário
    await dbQuery(
      'UPDATE funcionarios SET cargo = ?, departamento = ? WHERE id = ?',
      [cargo_novo, departamento_novo || null, funcionario_id]
    );

    res.status(201).json({ id: result.insertId, message: 'Mudança de cargo registrada com sucesso' });
  } catch (error) {
    logger.error('Erro ao registrar mudança de cargo:', error);
    res.status(500).json({ message: 'Erro ao registrar mudança de cargo' });
  }
});

// ==================== FASE 2: CONTROLE DE PONTO ====================

// GET /api/rh/ponto/registrar - Registrar entrada/saída (bater ponto)
app.post('/api/rh/ponto/registrar', authMiddleware, async (req, res) => {
  try {
    const { funcionario_id, tipo_registro, observacao } = req.body;
    
    // AUDITORIA ENTERPRISE: Verificar se o usuário está registrando seu próprio ponto ou é admin
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(funcionario_id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Você só pode registrar seu próprio ponto.' });
    }
    
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toTimeString().split(' ')[0];
    const ip = req.ip || req.connection.remoteAddress;

    // Buscar registro do dia
    const registros = await dbQuery(
      'SELECT * FROM controle_ponto WHERE funcionario_id = ? AND data = ?',
      [funcionario_id, today]
    );

    let result;
    
    if (registros.length === 0) {
      // Primeiro registro do dia - entrada manhá
      result = await dbQuery(
        `INSERT INTO controle_ponto 
         (funcionario_id, data, entrada_manha, tipo_registro, ip_registro, observacao)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [funcionario_id, today, now, tipo_registro || 'normal', ip, observacao || null]
      );
      
      res.json({ 
        message: 'Entrada registrada com sucesso', 
        tipo: 'entrada_manha',
        horario: now,
        id: result.insertId 
      });
    } else {
      const registro = registros[0];
      
      // Determinar qual campo atualizar
      if (!registro.saida_almoco) {
        await dbQuery(
          'UPDATE controle_ponto SET saida_almoco = ?, ip_registro = ? WHERE id = ?',
          [now, ip, registro.id]
        );
        res.json({ message: 'Saída para almoço registrada', tipo: 'saida_almoco', horario: now });
      } else if (!registro.entrada_tarde) {
        await dbQuery(
          'UPDATE controle_ponto SET entrada_tarde = ?, ip_registro = ? WHERE id = ?',
          [now, ip, registro.id]
        );
        res.json({ message: 'Retorno do almoço registrado', tipo: 'entrada_tarde', horario: now });
      } else if (!registro.saida_final) {
        await dbQuery(
          'UPDATE controle_ponto SET saida_final = ?, ip_registro = ? WHERE id = ?',
          [now, ip, registro.id]
        );
        res.json({ message: 'Saída final registrada', tipo: 'saida_final', horario: now });
      } else {
        res.status(400).json({ message: 'Todos os horários do dia já foram registrados' });
      }
    }
  } catch (error) {
    logger.error('Erro ao registrar ponto:', error);
    res.status(500).json({ message: 'Erro ao registrar ponto' });
  }
});

// GET /api/rh/ponto/hoje/:funcionarioId - Consultar ponto de hoje
app.get('/api/rh/ponto/hoje/:funcionarioId', authMiddleware, async (req, res) => {
  try {
    const { funcionarioId } = req.params;
    
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver este ponto
    // Apenas o próprio funcionário ou admin pode ver ponto
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(funcionarioId) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seu próprio ponto.' });
    }
    
    const today = new Date().toISOString().split('T')[0];

    const registros = await dbQuery(
      `SELECT cp.*, f.nome as funcionario_nome, f.cargo
       FROM controle_ponto cp
       JOIN funcionarios f ON cp.funcionario_id = f.id
       WHERE cp.funcionario_id = ? AND cp.data = ?`,
      [funcionarioId, today]
    );

    if (!registros || registros.length === 0) {
      return res.json({ 
        existe: false, 
        message: 'Nenhum registro de ponto hoje',
        próximo_registro: 'entrada_manha'
      });
    }

    const registro = registros[0];
    let próximo_registro = null;
    
    if (!registro.saida_almoco) próximo_registro = 'saida_almoco';
    else if (!registro.entrada_tarde) próximo_registro = 'entrada_tarde';
    else if (!registro.saida_final) próximo_registro = 'saida_final';

    res.json({ 
      existe: true, 
      registro,
      próximo_registro,
      completo: !próximo_registro
    });
  } catch (error) {
    logger.error('Erro ao consultar ponto:', error);
    res.status(500).json({ message: 'Erro ao consultar ponto' });
  }
});

// GET /api/rh/ponto/histórico/:funcionarioId - Histórico de ponto
app.get('/api/rh/ponto/histórico/:funcionarioId', authMiddleware, async (req, res) => {
  try {
    const { funcionarioId } = req.params;
    
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver este histórico
    // Apenas o próprio funcionário ou admin pode ver histórico de ponto
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(funcionarioId) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seu próprio histórico de ponto.' });
    }
    
    const { mes, ano, limite } = req.query;

    let query = `
      SELECT cp.*, 
             f.nome as funcionario_nome,
             f.cargo,
             aprovador.nome as aprovador_nome
      FROM controle_ponto cp
      JOIN funcionarios f ON cp.funcionario_id = f.id
      LEFT JOIN funcionarios aprovador ON cp.aprovado_por = aprovador.id
      WHERE cp.funcionario_id = ?
    `;
    
    const params = [funcionarioId];

    if (mes && ano) {
      query += ` AND MONTH(cp.data) = ? AND YEAR(cp.data) = ?`;
      params.push(mes, ano);
    }

    query += ` ORDER BY cp.data DESC`;

    if (limite) {
      query += ` LIMIT ?`;
      params.push(parseInt(limite));
    }

    const registros = await dbQuery(query, params);
    res.json(registros);
  } catch (error) {
    logger.error('Erro ao buscar histórico:', error);
    res.status(500).json({ message: 'Erro ao buscar histórico' });
  }
});

// GET /api/rh/ponto/relatório-mensal - Relatório mensal consolidado
app.get('/api/rh/ponto/relatório-mensal', authMiddleware, async (req, res) => {
  try {
    const { mes, ano, departamento } = req.query;

    let query = `
      SELECT 
        f.id as funcionario_id,
        f.nome,
        f.cargo,
        f.departamento,
        COUNT(DISTINCT cp.data) as dias_trabalhados,
        SUM(cp.horas_trabalhadas) as total_horas,
        SUM(cp.horas_extras) as total_horas_extras,
        SUM(cp.atraso_minutos) as total_atraso_minutos,
        SUM(CASE WHEN cp.tipo_registro = 'falta' THEN 1 ELSE 0 END) as total_faltas,
        SUM(CASE WHEN cp.tipo_registro = 'atéstado' THEN 1 ELSE 0 END) as total_atestados,
        SUM(CASE WHEN cp.aprovado = 'pendente' THEN 1 ELSE 0 END) as pendentes_aprovacao
      FROM funcionarios f
      LEFT JOIN controle_ponto cp ON f.id = cp.funcionario_id
      WHERE f.status = 'ativo'
    `;

    const params = [];

    if (mes && ano) {
      query += ` AND MONTH(cp.data) = ? AND YEAR(cp.data) = ?`;
      params.push(mes, ano);
    }

    if (departamento) {
      query += ` AND f.departamento = ?`;
      params.push(departamento);
    }

    query += ` GROUP BY f.id ORDER BY f.nome`;

    const relatório = await dbQuery(query, params);
    res.json(relatório);
  } catch (error) {
    logger.error('Erro ao gerar relatório:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

// POST /api/rh/ponto/justificativa - Adicionar justificativa a um registro
app.post('/api/rh/ponto/justificativa', authMiddleware, async (req, res) => {
  try {
    const { ponto_id, justificativa, tipo_registro } = req.body;

    if (!ponto_id || !justificativa) {
      return res.status(400).json({ message: 'Ponto ID e justificativa são obrigatórios' });
    }

    const updateData = {
      justificativa,
      aprovado: 'pendente'
    };

    if (tipo_registro) {
      updateData.tipo_registro = tipo_registro;
    }

    await dbQuery(
      `UPDATE controle_ponto 
       SET justificativa = ?, tipo_registro = COALESCE(?, tipo_registro), aprovado = 'pendente'
       WHERE id = ?`,
      [justificativa, tipo_registro || null, ponto_id]
    );

    res.json({ message: 'Justificativa adicionada com sucesso' });
  } catch (error) {
    logger.error('Erro ao adicionar justificativa:', error);
    res.status(500).json({ message: 'Erro ao adicionar justificativa' });
  }
});

// POST /api/rh/ponto/aprovar - Aprovar/reprovar registro de ponto (ADMIN ONLY)
app.post('/api/rh/ponto/aprovar', authMiddleware, async (req, res) => {
  try {
    // Verificação de permissão de administrador
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem aprovar registros de ponto.' });
    }
    
    const { ponto_id, status, observacao } = req.body;

    if (!ponto_id || !status || !['aprovado', 'reprovado'].includes(status)) {
      return res.status(400).json({ message: 'Dados inválidos' });
    }

    await dbQuery(
      `UPDATE controle_ponto 
       SET aprovado = ?, aprovado_por = ?, data_aprovacao = NOW(), observacao = COALESCE(?, observacao)
       WHERE id = ?`,
      [status, req.user.id, observacao || null, ponto_id]
    );

    res.json({ message: `Registro ${status} com sucesso` });
  } catch (error) {
    logger.error('Erro ao aprovar ponto:', error);
    res.status(500).json({ message: 'Erro ao aprovar ponto' });
  }
});

// GET /api/rh/ponto/pendentes - Listar registros pendentes de aprovação
app.get('/api/rh/ponto/pendentes', authMiddleware, async (req, res) => {
  try {
    const { departamento } = req.query;

    let query = `
      SELECT cp.*, 
             f.nome as funcionario_nome,
             f.cargo,
             f.departamento
      FROM controle_ponto cp
      JOIN funcionarios f ON cp.funcionario_id = f.id
      WHERE cp.aprovado = 'pendente'
    `;

    const params = [];

    if (departamento) {
      query += ` AND f.departamento = ?`;
      params.push(departamento);
    }

    query += ` ORDER BY cp.data DESC, cp.created_at DESC`;

    const pendentes = await dbQuery(query, params);
    res.json(pendentes);
  } catch (error) {
    logger.error('Erro ao buscar pendentes:', error);
    res.status(500).json({ message: 'Erro ao buscar pendentes' });
  }
});

// GET /api/rh/ponto/dashboard - Dashboard com KPIs de ponto
app.get('/api/rh/ponto/dashboard', authMiddleware, async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const mesAtual = new Date().getMonth() + 1;
    const anoAtual = new Date().getFullYear();

    // KPIs do dia
    const kpisHojeRows = await dbQuery(`
      SELECT 
        COUNT(DISTINCT funcionario_id) as total_presentes,
        SUM(CASE WHEN atraso_minutos > 0 THEN 1 ELSE 0 END) as total_atrasos,
        SUM(CASE WHEN tipo_registro = 'falta' THEN 1 ELSE 0 END) as total_faltas_hoje
      FROM controle_ponto
      WHERE data = ?
    `, [hoje]);
    const kpisHoje = kpisHojeRows[0] || { total_presentes: 0, total_atrasos: 0, total_faltas_hoje: 0 };

    // KPIs do mês
    const kpisMesRows = await dbQuery(`
      SELECT 
        COUNT(DISTINCT funcionario_id) as funcionarios_registrados,
        SUM(horas_trabalhadas) as total_horas_mes,
        SUM(horas_extras) as total_horas_extras_mes,
        SUM(CASE WHEN tipo_registro = 'falta' THEN 1 ELSE 0 END) as total_faltas_mes,
        SUM(CASE WHEN tipo_registro = 'atéstado' THEN 1 ELSE 0 END) as total_atestados_mes,
        COUNT(CASE WHEN aprovado = 'pendente' THEN 1 END) as pendentes_aprovacao
      FROM controle_ponto
      WHERE MONTH(data) = ? AND YEAR(data) = ?
    `, [mesAtual, anoAtual]);
    const kpisMes = kpisMesRows[0] || { funcionarios_registrados: 0, total_horas_mes: 0, total_horas_extras_mes: 0, total_faltas_mes: 0, total_atestados_mes: 0, pendentes_aprovacao: 0 };

    // Total de funcionários ativos
    const totalFuncRows = await dbQuery(
      "SELECT COUNT(*) as total FROM funcionarios WHERE status = 'ativo'"
    );
    const totalFunc = totalFuncRows[0] || { total: 0 };

    // Últimos registros
    const últimosRegistros = await dbQuery(`
      SELECT cp.*, f.nome, f.cargo
      FROM controle_ponto cp
      JOIN funcionarios f ON cp.funcionario_id = f.id
      WHERE cp.data = ?
      ORDER BY cp.updated_at DESC
      LIMIT 10
    `, [hoje]);

    res.json({
      hoje: {
        presentes: kpisHoje.total_presentes || 0,
        atrasos: kpisHoje.total_atrasos || 0,
        faltas: kpisHoje.total_faltas_hoje || 0,
        percentual_presenca: totalFunc.total > 0 
          ? ((kpisHoje.total_presentes / totalFunc.total) * 100).toFixed(1)
          : 0
      },
      mes: {
        funcionarios_registrados: kpisMes.funcionarios_registrados || 0,
        total_horas: parseFloat(kpisMes.total_horas_mes || 0).toFixed(2),
        total_horas_extras: parseFloat(kpisMes.total_horas_extras_mes || 0).toFixed(2),
        total_faltas: kpisMes.total_faltas_mes || 0,
        total_atestados: kpisMes.total_atestados_mes || 0,
        pendentes_aprovacao: kpisMes.pendentes_aprovacao || 0
      },
      últimos_registros: últimosRegistros
    });
  } catch (error) {
    logger.error('Erro ao buscar dashboard:', error);
    res.status(500).json({ message: 'Erro ao buscar dashboard' });
  }
});

// GET /api/rh/jornadas - Listar jornadas de trabalho
app.get('/api/rh/jornadas', authMiddleware, async (req, res) => {
  try {
    const jornadas = await dbQuery(
      'SELECT id, nome, carga_horaria, entrada, saida, intervalo, ativo FROM jornada_trabalho WHERE ativo = TRUE ORDER BY nome LIMIT 500'
    );
    res.json(jornadas);
  } catch (error) {
    logger.error('Erro ao listar jornadas:', error);
    res.status(500).json({ message: 'Erro ao listar jornadas' });
  }
});

// POST /api/rh/jornadas - Criar nova jornada (ADMIN ONLY)
app.post('/api/rh/jornadas', authMiddleware, async (req, res) => {
  try {
    // Verificação de permissão de administrador
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem criar jornadas de trabalho.' });
    }
    
    const {
      nome,
      entrada_manha,
      saida_almoco,
      entrada_tarde,
      saida_final,
      carga_horaria_diaria,
      carga_horaria_semanal,
      tolerancia_atraso,
      tolerancia_saida,
      dias_trabalho
    } = req.body;
    const descricao = req.body.descricao ?? req.body['descrição'];

    if (!nome || !entrada_manha || !saida_final) {
      return res.status(400).json({ message: 'Dados incompletos' });
    }

    const result = await dbQuery(
      `INSERT INTO jornada_trabalho 
       (nome, descricao, entrada_manha, saida_almoco, entrada_tarde, saida_final, carga_horaria_diaria, carga_horaria_semanal, tolerancia_atraso, tolerancia_saida, dias_trabalho)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nome, descricao || null, entrada_manha, saida_almoco || null, entrada_tarde || null, saida_final, carga_horaria_diaria || 8, carga_horaria_semanal || 40, tolerancia_atraso || 10, tolerancia_saida || 10, dias_trabalho ? JSON.stringify(dias_trabalho) : null]
    );

    res.status(201).json({ id: result.insertId, message: 'Jornada criada com sucesso' });
  } catch (error) {
    logger.error('Erro ao criar jornada:', error);
    res.status(500).json({ message: 'Erro ao criar jornada' });
  }
});

// ==================== FASE 3: GESTÍO DE FÉRIAS ====================

// GET /api/rh/ferias/saldo/:funcionarioId - Consultar saldo de férias
app.get('/api/rh/ferias/saldo/:funcionarioId', authMiddleware, async (req, res) => {
  try {
    const { funcionarioId } = req.params;

    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver este saldo
    // Apenas o próprio funcionário ou admin pode ver saldo de férias
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(funcionarioId) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seu próprio saldo de férias.' });
    }

    const períodos = await dbQuery(
      `SELECT * FROM ferias_periodos 
       WHERE funcionario_id = ? 
       AND status IN ('ativo', 'em_gozo')
       ORDER BY data_inicio DESC`,
      [funcionarioId]
    );

    const totalDisponivel = períodos.reduce((sum, p) => sum + (p.dias_disponivel || 0), 0);
    const próximoVencimento = períodos.find(p => !p.vencido);

    res.json({
      períodos,
      total_dias_disponivel: totalDisponivel,
      próximo_vencimento: próximoVencimento ? próximoVencimento.data_limite_gozo : null
    });
  } catch (error) {
    logger.error('Erro ao consultar saldo:', error);
    res.status(500).json({ message: 'Erro ao consultar saldo' });
  }
});

// POST /api/rh/ferias/solicitar - Solicitar férias
app.post('/api/rh/ferias/solicitar', authMiddleware, async (req, res) => {
  try {
    const {
      funcionario_id,
      período_aquisitivo_inicio,
      período_aquisitivo_fim,
      data_inicio,
      data_fim,
      tipo,
      fracao,
      dias_abono,
      adiantamento_13,
      observacoes
    } = req.body;

    // AUDITORIA ENTERPRISE: Verificar se o usuário está solicitando férias para si mesmo ou é admin
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(funcionario_id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Você só pode solicitar férias para você mesmo.' });
    }

    if (!funcionario_id || !data_inicio || !data_fim || !período_aquisitivo_inicio || !período_aquisitivo_fim) {
      return res.status(400).json({ message: 'Dados incompletos' });
    }

    // Calcular dias solicitados
    const inicio = new Date(data_inicio);
    const fim = new Date(data_fim);
    const diasCorridos = Math.ceil((fim - inicio) / (1000 * 60 * 60 * 24)) + 1;

    // Verificar saldo disponível
    const [período] = await dbQuery(
      `SELECT * FROM ferias_periodos 
       WHERE funcionario_id = ? 
       AND data_inicio = ? 
       AND data_fim = ?`,
      [funcionario_id, período_aquisitivo_inicio, período_aquisitivo_fim]
    );

    if (!período.length) {
      return res.status(404).json({ message: 'Período aquisitivo não encontrado' });
    }

    const diasNecessarios = diasCorridos + (dias_abono || 0);
    if (período[0].dias_disponivel < diasNecessarios) {
      return res.status(400).json({ 
        message: 'Saldo insuficiente',
        disponivel: período[0].dias_disponivel,
        solicitado: diasNecessarios
      });
    }

    // Registrar solicitação
    const result = await dbQuery(
      `INSERT INTO ferias_solicitacoes 
       (funcionario_id, período_aquisitivo_inicio, período_aquisitivo_fim, data_inicio, data_fim, 
        dias_solicitados, dias_corridos, tipo, fracao, dias_abono, adiantamento_13, observacoes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`,
      [funcionario_id, período_aquisitivo_inicio, período_aquisitivo_fim, data_inicio, data_fim,
       diasCorridos, diasCorridos, tipo || 'integral', fracao || null, dias_abono || 0, 
       adiantamento_13 || false, observacoes || null]
    );

    res.status(201).json({ 
      id: result.insertId, 
      message: 'Solicitação de férias registrada com sucesso',
      dias_solicitados: diasCorridos
    });
  } catch (error) {
    logger.error('Erro ao solicitar férias:', error);
    res.status(500).json({ message: 'Erro ao solicitar férias' });
  }
});

// GET /api/rh/ferias/minhas/:funcionarioId - Listar minhas solicitações
app.get('/api/rh/ferias/minhas/:funcionarioId', authMiddleware, async (req, res) => {
  try {
    const { funcionarioId } = req.params;
    
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver estas solicitações
    // Apenas o próprio funcionário ou admin pode ver solicitações de férias
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(funcionarioId) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar suas próprias solicitações de férias.' });
    }
    
    const { status } = req.query;

    let query = `
      SELECT fs.*, 
             COALESCE(aprovador.nome_completo, aprovador.nome) as aprovador_nome
      FROM ferias_solicitacoes fs
      LEFT JOIN funcionarios aprovador ON fs.aprovado_por = aprovador.id
      WHERE fs.funcionario_id = ?
    `;

    const params = [funcionarioId];

    if (status) {
      query += ` AND fs.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY fs.id DESC`;

    const solicitacoes = await dbQuery(query, params);
    res.json(solicitacoes);
  } catch (error) {
    logger.error('Erro ao listar solicitações:', error);
    res.status(500).json({ message: 'Erro ao listar solicitações' });
  }
});

// GET /api/rh/ferias/pendentes - Listar solicitações pendentes de aprovação
app.get('/api/rh/ferias/pendentes', authMiddleware, async (req, res) => {
  try {
    const { departamento } = req.query;

    let query = `
      SELECT fs.*,
             f.nome as funcionario_nome,
             f.cargo,
             f.departamento,
             gestor.nome as gestor_nome,
             DATEDIFF(CURDATE(), fs.solicitado_em) as dias_aguardando
      FROM ferias_solicitacoes fs
      JOIN funcionarios f ON fs.funcionario_id = f.id
      LEFT JOIN funcionarios gestor ON f.gestor_id = gestor.id
      WHERE fs.status = 'pendente'
    `;

    const params = [];

    if (departamento) {
      query += ` AND f.departamento = ?`;
      params.push(departamento);
    }

    query += ` ORDER BY fs.solicitado_em ASC`;

    const pendentes = await dbQuery(query, params);
    res.json(pendentes);
  } catch (error) {
    logger.error('Erro ao listar pendentes:', error);
    res.status(500).json({ message: 'Erro ao listar pendentes' });
  }
});

// POST /api/rh/ferias/aprovar - Aprovar solicitação (ADMIN ONLY)
app.post('/api/rh/ferias/aprovar', authMiddleware, async (req, res) => {
  try {
    // Verificação de permissão de administrador
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem aprovar férias.' });
    }
    
    const { solicitacao_id, observacoes_rh } = req.body;

    if (!solicitacao_id) {
      return res.status(400).json({ message: 'ID da solicitação é obrigatório' });
    }

    await dbQuery(
      `UPDATE ferias_solicitacoes 
       SET status = 'aprovada', 
           aprovado_por = ?, 
           aprovado_em = NOW(),
           observacoes_rh = ?
       WHERE id = ? AND status = 'pendente'`,
      [req.user.id, observacoes_rh || null, solicitacao_id]
    );

    res.json({ message: 'Férias aprovadas com sucesso' });
  } catch (error) {
    logger.error('Erro ao aprovar férias:', error);
    res.status(500).json({ message: 'Erro ao aprovar férias' });
  }
});

// POST /api/rh/ferias/reprovar - Reprovar solicitação (ADMIN ONLY)
app.post('/api/rh/ferias/reprovar', authMiddleware, async (req, res) => {
  try {
    // Verificação de permissão de administrador
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem reprovar férias.' });
    }
    
    const { solicitacao_id, motivo_reprovacao } = req.body;

    if (!solicitacao_id || !motivo_reprovacao) {
      return res.status(400).json({ message: 'Solicitação ID e motivo são obrigatórios' });
    }

    await dbQuery(
      `UPDATE ferias_solicitacoes 
       SET status = 'reprovada', 
           aprovado_por = ?, 
           aprovado_em = NOW(),
           motivo_reprovacao = ?
       WHERE id = ? AND status = 'pendente'`,
      [req.user.id, motivo_reprovacao, solicitacao_id]
    );

    res.json({ message: 'Solicitação reprovada' });
  } catch (error) {
    logger.error('Erro ao reprovar férias:', error);
    res.status(500).json({ message: 'Erro ao reprovar férias' });
  }
});

// POST /api/rh/ferias/cancelar - Cancelar solicitação
app.post('/api/rh/ferias/cancelar', authMiddleware, async (req, res) => {
  try {
    const { solicitacao_id } = req.body;

    if (!solicitacao_id) {
      return res.status(400).json({ message: 'ID da solicitação é obrigatório' });
    }

    // Verificar se pode cancelar (apenas pendentes ou aprovadas antes da data)
    const solicitacoes = await dbQuery(
      'SELECT * FROM ferias_solicitacoes WHERE id = ?',
      [solicitacao_id]
    );

    if (!solicitacoes || solicitacoes.length === 0) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }

    const sol = solicitacoes[0];
    
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode cancelar esta solicitação
    // Apenas o próprio funcionário ou admin pode cancelar
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(sol.funcionario_id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Você só pode cancelar suas próprias solicitações de férias.' });
    }
    const hoje = new Date();
    const dataInicio = new Date(sol.data_inicio);

    if (sol.status === 'em_gozo' || sol.status === 'concluida') {
      return res.status(400).json({ message: 'Não é possível cancelar férias já iniciadas ou concluídas' });
    }

    if (sol.status === 'aprovada' && dataInicio <= hoje) {
      return res.status(400).json({ message: 'Não é possível cancelar férias já iniciadas' });
    }

    await dbQuery(
      'UPDATE ferias_solicitacoes SET status = \'cancelada\' WHERE id = ?',
      [solicitacao_id]
    );

    res.json({ message: 'Solicitação cancelada com sucesso' });
  } catch (error) {
    logger.error('Erro ao cancelar férias:', error);
    res.status(500).json({ message: 'Erro ao cancelar férias' });
  }
});

// GET /api/rh/ferias/calendario - Calendário de férias
app.get('/api/rh/ferias/calendario', authMiddleware, async (req, res) => {
  try {
    const { mes, ano, departamento } = req.query;

    let query = `
      SELECT fs.*,
             f.nome as funcionario_nome,
             f.cargo,
             f.departamento
      FROM ferias_solicitacoes fs
      JOIN funcionarios f ON fs.funcionario_id = f.id
      WHERE fs.status IN ('aprovada', 'em_gozo', 'concluida')
    `;

    const params = [];

    if (mes && ano) {
      query += ` AND (
        (MONTH(fs.data_inicio) = ? AND YEAR(fs.data_inicio) = ?) OR
        (MONTH(fs.data_fim) = ? AND YEAR(fs.data_fim) = ?)
      )`;
      params.push(mes, ano, mes, ano);
    }

    if (departamento) {
      query += ` AND f.departamento = ?`;
      params.push(departamento);
    }

    query += ` ORDER BY fs.data_inicio`;

    const calendario = await dbQuery(query, params);
    res.json(calendario);
  } catch (error) {
    logger.error('Erro ao buscar calendário:', error);
    res.status(500).json({ message: 'Erro ao buscar calendário' });
  }
});

// GET /api/rh/ferias/dashboard - Dashboard de férias
app.get('/api/rh/ferias/dashboard', authMiddleware, async (req, res) => {
  try {
    // Estatísticas gerais
    const statsRows = await dbQuery(`
      SELECT 
        COUNT(DISTINCT fp.funcionario_id) as total_funcionarios_com_saldo,
        SUM(fp.dias_disponivel) as total_dias_disponiveis,
        COUNT(CASE WHEN fp.vencido = TRUE THEN 1 END) as períodos_vencidos,
        COUNT(CASE WHEN DATEDIFF(fp.data_limite_gozo, CURDATE()) <= 30 AND fp.vencido = FALSE THEN 1 END) as períodos_criticos
      FROM ferias_periodos fp
      WHERE fp.status = 'ativo'
    `);
    const stats = statsRows[0] || { total_funcionarios_com_saldo: 0, total_dias_disponiveis: 0, períodos_vencidos: 0, períodos_criticos: 0 };

    // Solicitações pendentes
    const pendentesRows = await dbQuery(`
      SELECT COUNT(*) as total
      FROM ferias_solicitacoes
      WHERE status = 'pendente'
    `);
    const pendentes = pendentesRows[0] || { total: 0 };

    // Férias nos próximos 30 dias
    const próximasRows = await dbQuery(`
      SELECT COUNT(*) as total
      FROM ferias_solicitacoes
      WHERE status = 'aprovada'
      AND data_inicio BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
    `);
    const próximas = próximasRows[0] || { total: 0 };

    // Férias em andamento hoje
    const emGozoRows = await dbQuery(`
      SELECT COUNT(*) as total
      FROM ferias_solicitacoes
      WHERE status IN ('aprovada', 'em_gozo')
      AND CURDATE() BETWEEN data_inicio AND data_fim
    `);
    const emGozo = emGozoRows[0] || { total: 0 };

    // Top 5 departamentos com mais dias disponíveis
    const topDepartamentos = await dbQuery(`
      SELECT 
        f.departamento,
        SUM(fp.dias_disponivel) as total_dias
      FROM ferias_periodos fp
      JOIN funcionarios f ON fp.funcionario_id = f.id
      WHERE fp.status = 'ativo' AND f.departamento IS NOT NULL
      GROUP BY f.departamento
      ORDER BY total_dias DESC
      LIMIT 5
    `);

    res.json({
      estatisticas: {
        total_funcionarios_com_saldo: stats.total_funcionarios_com_saldo || 0,
        total_dias_disponiveis: stats.total_dias_disponiveis || 0,
        períodos_vencidos: stats.períodos_vencidos || 0,
        períodos_criticos: stats.períodos_criticos || 0
      },
      solicitacoes: {
        pendentes: pendentes.total || 0,
        próximas_30_dias: próximas.total || 0,
        em_gozo_hoje: emGozo.total || 0
      },
      top_departamentos: topDepartamentos
    });
  } catch (error) {
    logger.error('Erro ao buscar dashboard:', error);
    res.status(500).json({ message: 'Erro ao buscar dashboard' });
  }
});

// GET /api/rh/ferias/relatório-vencimentos - Relatório de vencimentos
app.get('/api/rh/ferias/relatório-vencimentos', authMiddleware, async (req, res) => {
  try {
    const { tipo } = req.query; // 'vencido', 'critico', 'todos'

    let query = `
      SELECT 
        f.id as funcionario_id,
        f.nome as funcionario_nome,
        f.cargo,
        f.departamento,
        f.email,
        fp.data_inicio as período_inicio,
        fp.data_fim as período_fim,
        fp.dias_disponivel,
        fp.data_limite_gozo,
        fp.vencido,
        DATEDIFF(fp.data_limite_gozo, CURDATE()) as dias_ate_vencimento,
        CASE 
          WHEN fp.vencido = TRUE THEN 'VENCIDO'
          WHEN DATEDIFF(fp.data_limite_gozo, CURDATE()) <= 30 THEN 'CRÍTICO'
          WHEN DATEDIFF(fp.data_limite_gozo, CURDATE()) <= 60 THEN 'ATENÇÉO'
          ELSE 'NORMAL'
        END as alerta
      FROM ferias_periodos fp
      JOIN funcionarios f ON fp.funcionario_id = f.id
      WHERE fp.status = 'ativo' AND fp.dias_disponivel > 0
    `;

    if (tipo === 'vencido') {
      query += ` AND fp.vencido = TRUE`;
    } else if (tipo === 'critico') {
      query += ` AND fp.vencido = FALSE AND DATEDIFF(fp.data_limite_gozo, CURDATE()) <= 30`;
    }

    query += ` ORDER BY fp.data_limite_gozo ASC`;

    const relatório = await dbQuery(query);
    res.json(relatório);
  } catch (error) {
    logger.error('Erro ao gerar relatório:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

// GET /api/rh/ferias/configuracoes - Obter configurações
app.get('/api/rh/ferias/configuracoes', authMiddleware, async (req, res) => {
  try {
    const configs = await dbQuery(
      'SELECT * FROM ferias_configuracoes WHERE ativo = TRUE ORDER BY id DESC LIMIT 1'
    );

    if (!configs || configs.length === 0) {
      return res.status(404).json({ message: 'Configurações não encontradas' });
    }

    res.json(configs[0]);
  } catch (error) {
    logger.error('Erro ao buscar configurações:', error);
    res.status(500).json({ message: 'Erro ao buscar configurações' });
  }
});

// ==================== FASE 4: FOLHA DE PAGAMENTO ====================

// Funções auxiliares para cálculo de impostos
function calcularINSS(salarioBase, ano = 2025) {
  const faixas = [
    { inicio: 0, fim: 1412.00, aliquota: 0.075 },
    { inicio: 1412.01, fim: 2666.68, aliquota: 0.09 },
    { inicio: 2666.69, fim: 4000.03, aliquota: 0.12 },
    { inicio: 4000.04, fim: 7786.02, aliquota: 0.14 }
  ];
  
  let inssAcumulado = 0;
  let salarioRestante = salarioBase;
  
  for (const faixa of faixas) {
    if (salarioRestante <= 0) break;
    
    if (salarioBase <= faixa.fim) {
      inssAcumulado += salarioRestante * faixa.aliquota;
      salarioRestante = 0;
    } else {
      const valorFaixa = faixa.fim - faixa.inicio;
      inssAcumulado += valorFaixa * faixa.aliquota;
      salarioRestante -= valorFaixa;
    }
  }
  
  return {
    valor: Math.round(inssAcumulado * 100) / 100,
    aliquota: salarioBase > 0 ? Math.round((inssAcumulado / salarioBase) * 10000) / 10000 : 0
  };
}

function calcularIRRF(baseCalculo, dependentes = 0, ano = 2025) {
  const deducaoDependente = 189.59;
  const faixas = [
    { inicio: 0, fim: 2259.20, aliquota: 0, parcela: 0 },
    { inicio: 2259.21, fim: 2826.65, aliquota: 0.075, parcela: 169.44 },
    { inicio: 2826.66, fim: 3751.05, aliquota: 0.15, parcela: 381.44 },
    { inicio: 3751.06, fim: 4664.68, aliquota: 0.225, parcela: 662.77 },
    { inicio: 4664.69, fim: 999999, aliquota: 0.275, parcela: 896.00 }
  ];
  
  const baseTributavel = baseCalculo - (dependentes * deducaoDependente);
  
  if (baseTributavel <= 0) {
    return { valor: 0, aliquota: 0 };
  }
  
  const faixa = faixas.find(f => baseTributavel >= f.inicio && baseTributavel <= f.fim);
  
  if (!faixa || faixa.aliquota === 0) {
    return { valor: 0, aliquota: 0 };
  }
  
  const irrfValor = Math.round(((baseTributavel * faixa.aliquota) - faixa.parcela) * 100) / 100;
  
  return {
    valor: irrfValor > 0 ? irrfValor : 0,
    aliquota: faixa.aliquota
  };
}

// POST /api/rh/folha/criar - Criar folha de pagamento mensal
app.post('/api/rh/folha/criar', authMiddleware, async (req, res) => {
  // AUDITORIA ENTERPRISE: Verificação obrigatória de admin para criar folha de pagamento
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem criar folhas de pagamento.' });
  }

  const { mes, ano, tipo = 'MENSAL' } = req.body;
  
  if (!mes || !ano) {
    return res.status(400).json({ error: 'Mês e ano são obrigatórios' });
  }
  
  try {
    // Verificar se já existe
    const [existing] = await pool.query(
      'SELECT id FROM rh_folhas_pagamento WHERE mes = ? AND ano = ? AND tipo = ?',
      [mes, ano, tipo]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Folha já existe para este período' });
    }
    
    const [result] = await pool.query(
      'INSERT INTO rh_folhas_pagamento (mes, ano, tipo, created_by) VALUES (?, ?, ?, ?)',
      [mes, ano, tipo, req.user.id]
    );
    
    res.json({ 
      success: true, 
      folha_id: result.insertId,
      mes,
      ano,
      tipo
    });
  } catch (error) {
    logger.error('Erro ao criar folha:', error);
    res.status(500).json({ error: 'Erro ao criar folha de pagamento' });
  }
});

// POST /api/rh/folha/calcular - Calcular holerites da folha
app.post('/api/rh/folha/calcular', authMiddleware, async (req, res) => {
  // AUDITORIA ENTERPRISE: Verificação obrigatória de admin para calcular folha
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem calcular folha.' });
  }

  const { folha_id, funcionarios_ids } = req.body;
  
  if (!folha_id) {
    return res.status(400).json({ error: 'folha_id é obrigatório' });
  }
  
  try {
    // Buscar folha
    const [folha] = await pool.query('SELECT * FROM rh_folhas_pagamento WHERE id = ?', [folha_id]);
    if (folha.length === 0) {
      return res.status(404).json({ error: 'Folha não encontrada' });
    }
    
    // Buscar funcionários
    let query = 'SELECT id FROM funcionarios WHERE status = "ativo"';
    const params = [];
    
    if (funcionarios_ids && funcionarios_ids.length > 0) {
      query += ' AND id IN (?)';
      params.push(funcionarios_ids);
    }
    
    const [funcionarios] = await pool.query(query, params);
    
    let holeritesCriados = 0;
    
    for (const func of funcionarios) {
      // Verificar se já tem holerite
      const [existingH] = await pool.query(
        'SELECT id FROM rh_holerites WHERE folha_id = ? AND funcionario_id = ?',
        [folha_id, func.id]
      );
      
      if (existingH.length > 0) continue;
      
      // Buscar salário REAL do funcionário na tabela
      const [salarioRows] = await pool.query(
        'SELECT salario_base, salario, nome_completo FROM funcionarios WHERE id = ?',
        [func.id]
      );
      const salarioBase = parseFloat(salarioRows[0]?.salario_base || salarioRows[0]?.salario || 0);
      if (salarioBase <= 0) {
        logger.warn(`[FOLHA] Funcionário ID ${func.id} (${salarioRows[0]?.nome_completo || 'N/A'}) sem salário cadastrado - criando holerite com salário zerado`);
      }
      
      // Calcular INSS
      const inss = calcularINSS(salarioBase);
      
      // Calcular IRRF
      const baseIRRF = salarioBase - inss.valor;
      const irrf = calcularIRRF(baseIRRF, 0);
      
      // Inserir holerite
      await pool.query(`
        INSERT INTO rh_holerites (
          folha_id, funcionario_id, salario_base,
          inss_base, inss_aliquota, inss_valor,
          irrf_base, irrf_aliquota, irrf_valor,
          fgts_base
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        folha_id, func.id, salarioBase,
        salarioBase, inss.aliquota, inss.valor,
        baseIRRF, irrf.aliquota, irrf.valor,
        salarioBase
      ]);
      
      holeritesCriados++;
    }
    
    res.json({ 
      success: true, 
      holerites_criados: holeritesCriados 
    });
  } catch (error) {
    logger.error('Erro ao calcular folha:', error);
    res.status(500).json({ error: 'Erro ao calcular folha' });
  }
});

// GET /api/rh/folha/:id - Detalhes da folha
app.get('/api/rh/folha/:id', authMiddleware, async (req, res) => {
  try {
    const [folha] = await pool.query('SELECT * FROM rh_folhas_pagamento WHERE id = ?', [req.params.id]);
    
    if (folha.length === 0) {
      return res.status(404).json({ error: 'Folha não encontrada' });
    }
    
    const [holerites] = await pool.query(`
      SELECT h.*, f.nome AS funcionario_nome
      FROM rh_holerites h
      LEFT JOIN funcionarios f ON h.funcionario_id = f.id
      WHERE h.folha_id = ?
      ORDER BY f.nome
    `, [req.params.id]);
    
    res.json({
      ...folha[0],
      holerites
    });
  } catch (error) {
    logger.error('Erro ao buscar folha:', error);
    res.status(500).json({ error: 'Erro ao buscar folha' });
  }
});

// GET /api/rh/folha/listar - Listar folhas
app.get('/api/rh/folha/listar', authMiddleware, async (req, res) => {
  const { ano, tipo } = req.query;
  
  try {
    let query = 'SELECT * FROM vw_folha_resumo_mensal WHERE 1=1';
    const params = [];
    
    if (ano) {
      query += ' AND ano = ?';
      params.push(ano);
    }
    
    if (tipo) {
      query += ' AND tipo = ?';
      params.push(tipo);
    }
    
    query += ' ORDER BY ano DESC, mes DESC';
    
    const [folhas] = await pool.query(query, params);
    
    res.json(folhas);
  } catch (error) {
    logger.error('Erro ao listar folhas:', error);
    res.status(500).json({ error: 'Erro ao listar folhas' });
  }
});

// PUT /api/rh/folha/:id/fechar - Fechar folha e criar conta a pagar no Financeiro
const axios = require('axios');
app.put('/api/rh/folha/:id/fechar', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Apenas administradores podem fechar folha.' });
  }
  const folhaId = req.params.id;
  try {
    // Buscar folha
    const [folhaRows] = await pool.query('SELECT * FROM rh_folhas_pagamento WHERE id = ?', [folhaId]);
    if (folhaRows.length === 0) {
      return res.status(404).json({ error: 'Folha não encontrada' });
    }
    const folha = folhaRows[0];
    if (folha.status === 'fechada') {
      return res.status(400).json({ error: 'Folha já está fechada' });
    }

    // Calcular valor total da folha (soma dos salários líquidos dos holerites)
    const [holerites] = await pool.query('SELECT salario_liquido FROM rh_holerites WHERE folha_id = ?', [folhaId]);
    const valorTotal = holerites.reduce((acc, h) => acc + parseFloat(h.salario_liquido || 0), 0);
    if (valorTotal <= 0) {
      return res.status(400).json({ error: 'Folha sem holerites ou valor total zero' });
    }

    // Atualizar status da folha para "fechada"
    await pool.query("UPDATE rh_folhas_pagamento SET status = 'fechada', fechado_em = NOW() WHERE id = ?", [folhaId]);

    // Montar dados para Financeiro
    const descricao = `Folha de Pagamento ${folha.mes}/${folha.ano}`;
    const data_emissao = new Date().toISOString().slice(0, 10);
    // Vencimento: 5º dia útil do mês seguinte
    const ano = folha.ano;
    const mes = folha.mes;
    const vencimentoDate = new Date(ano, mes, 5); // JS: mês 0-based, mas queremos o mês seguinte
    let data_vencimento = vencimentoDate.toISOString().slice(0, 10);

    // Token JWT do usuário atual para autenticar no Financeiro
    const token = req.cookies?.authToken || req.cookies?.token || (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);
    if (!token) {
      return res.status(401).json({ error: 'Token de autenticação não encontrado para integração Financeiro.' });
    }

    // Chamar API do Financeiro
    const financeiroUrl = process.env.FINANCEIRO_URL || 'http://localhost:3006/api/financeiro/contas-pagar';
    const payload = {
      descricao,
      valor_total: valorTotal,
      data_emissao,
      data_vencimento,
      observacoes: `Folha RH integrada automaticamente. Folha ID: ${folhaId}`
    };
    const headers = { Authorization: `Bearer ${token}` };
    let financeiroResp;
    try {
      financeiroResp = await axios.post(financeiroUrl, payload, { headers });
    } catch (err) {
      logger.error('Erro ao integrar com Financeiro:', err?.response?.data || err.message);
      return res.status(500).json({ error: 'Erro ao criar conta a pagar no Financeiro', details: err?.response?.data || err.message });
    }

    res.json({ success: true, folha_id: folhaId, valor_total: valorTotal, financeiro: financeiroResp.data });
  } catch (error) {
    logger.error('Erro ao fechar folha:', error);
    res.status(500).json({ error: 'Erro ao fechar folha', details: error.message });
  }
});

// =====================================================
// FOLHA MANUAL (espelho da planilha Excel)
// =====================================================

// GET /api/rh/folha-manual/competencia - Buscar folhas por mês/ano
app.get('/api/rh/folha-manual/competencia', authMiddleware, async (req, res) => {
  const { mes, ano } = req.query;
  if (!mes || !ano) return res.status(400).json({ error: 'mes e ano são obrigatórios' });
  try {
    const [folhas] = await pool.query(
      'SELECT * FROM rh_folha_manual WHERE mes = ? AND ano = ? ORDER BY FIELD(tipo, "SALARIO", "ADIANTAMENTO")',
      [parseInt(mes), parseInt(ano)]
    );
    // Para cada folha, buscar itens
    for (const f of folhas) {
      const [itens] = await pool.query('SELECT * FROM rh_folha_manual_itens WHERE folha_id = ? ORDER BY empresa, colaborador_nome', [f.id]);
      f.itens = itens;
    }
    res.json(folhas);
  } catch (error) {
    logger.error('Erro ao buscar folha manual:', error);
    res.status(500).json({ error: 'Erro ao buscar folhas', details: error.message });
  }
});

// GET /api/rh/folha-manual/listar - Listar todas as folhas manuais
app.get('/api/rh/folha-manual/listar', authMiddleware, async (req, res) => {
  const { ano } = req.query;
  try {
    let sql = 'SELECT fm.*, (SELECT COUNT(*) FROM rh_folha_manual_itens WHERE folha_id = fm.id) as qtd_itens FROM rh_folha_manual fm';
    const params = [];
    if (ano) { sql += ' WHERE fm.ano = ?'; params.push(parseInt(ano)); }
    sql += ' ORDER BY fm.ano DESC, fm.mes DESC, FIELD(fm.tipo, "SALARIO", "ADIANTAMENTO")';
    const [folhas] = await pool.query(sql, params);
    res.json(folhas);
  } catch (error) {
    logger.error('Erro ao listar folhas manuais:', error);
    res.status(500).json({ error: 'Erro ao listar folhas' });
  }
});

// POST /api/rh/folha-manual/salvar - Criar ou atualizar folha com todos os itens
app.post('/api/rh/folha-manual/salvar', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Apenas administradores podem gerenciar a folha.' });
  const { mes, ano, tipo, itens } = req.body;
  if (!mes || !ano || !tipo) return res.status(400).json({ error: 'mes, ano e tipo são obrigatórios' });
  if (!Array.isArray(itens)) return res.status(400).json({ error: 'itens deve ser um array' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Upsert folha
    const [existing] = await conn.query(
      'SELECT id, status FROM rh_folha_manual WHERE mes = ? AND ano = ? AND tipo = ?',
      [parseInt(mes), parseInt(ano), tipo]
    );

    let folhaId;
    if (existing.length > 0) {
      if (existing[0].status === 'fechada') {
        await conn.rollback();
        return res.status(400).json({ error: 'Folha já fechada. Não é possível editar.' });
      }
      folhaId = existing[0].id;
      // Remover itens antigos
      await conn.query('DELETE FROM rh_folha_manual_itens WHERE folha_id = ?', [folhaId]);
    } else {
      const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const titulo = tipo === 'SALARIO'
        ? `${MESES[parseInt(mes)]} - SALÁRIO, POR FORA E HORA EXTRAS`
        : `${MESES[parseInt(mes)]} - ADIANTAMENTO`;
      const [result] = await conn.query(
        'INSERT INTO rh_folha_manual (mes, ano, tipo, titulo, criado_por) VALUES (?, ?, ?, ?, ?)',
        [parseInt(mes), parseInt(ano), tipo, titulo, req.user.nome || req.user.email]
      );
      folhaId = result.insertId;
    }

    // Inserir itens
    let totalGeral = 0;
    for (const item of itens) {
      if (!item.colaborador_nome || !item.colaborador_nome.trim()) continue;
      const vb = parseFloat(item.valor_base) || 0;
      const spf = parseFloat(item.salario_por_fora) || 0;
      const h50 = parseFloat(item.he_50) || 0;
      const h100 = parseFloat(item.he_100) || 0;
      const desc = parseFloat(item.desconto_emprestimo) || 0;
      const totalItem = vb + spf + h50 + h100 - desc;
      totalGeral += totalItem;

      await conn.query(
        `INSERT INTO rh_folha_manual_itens (folha_id, empresa, colaborador_nome, funcionario_id, valor_base, salario_por_fora, he_50, he_100, desconto_emprestimo, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [folhaId, item.empresa || '', item.colaborador_nome.trim(), item.funcionario_id || null, vb, spf, h50, h100, desc, totalItem]
      );
    }

    // Atualizar total geral
    await conn.query('UPDATE rh_folha_manual SET total_geral = ? WHERE id = ?', [totalGeral, folhaId]);
    await conn.commit();

    res.json({ success: true, folha_id: folhaId, total_geral: totalGeral });
  } catch (error) {
    await conn.rollback();
    logger.error('Erro ao salvar folha manual:', error);
    res.status(500).json({ error: 'Erro ao salvar folha', details: error.message });
  } finally {
    conn.release();
  }
});

// PUT /api/rh/folha-manual/:id/fechar - Fechar folha manual e enviar ao Contas a Pagar
app.put('/api/rh/folha-manual/:id/fechar', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Apenas administradores podem fechar a folha.' });
  const folhaId = req.params.id;
  try {
    const [folhaRows] = await pool.query('SELECT * FROM rh_folha_manual WHERE id = ?', [folhaId]);
    if (folhaRows.length === 0) return res.status(404).json({ error: 'Folha não encontrada' });
    const folha = folhaRows[0];
    if (folha.status === 'fechada') return res.status(400).json({ error: 'Folha já está fechada' });

    // Calcular total
    const [itens] = await pool.query('SELECT total FROM rh_folha_manual_itens WHERE folha_id = ?', [folhaId]);
    const valorTotal = itens.reduce((acc, i) => acc + parseFloat(i.total || 0), 0);
    if (valorTotal <= 0) return res.status(400).json({ error: 'Folha sem itens ou valor total zero' });

    // Fechar
    await pool.query("UPDATE rh_folha_manual SET status = 'fechada', fechado_em = NOW(), total_geral = ? WHERE id = ?", [valorTotal, folhaId]);

    // Montar dados para Financeiro
    const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const tipoLabel = folha.tipo === 'SALARIO' ? 'Salário' : 'Adiantamento';
    const descricao = `Folha ${tipoLabel} - ${MESES[folha.mes]} ${folha.ano}`;
    const data_emissao = new Date().toISOString().slice(0, 10);
    const vencimentoDate = new Date(folha.ano, folha.mes, 5);
    const data_vencimento = vencimentoDate.toISOString().slice(0, 10);

    const token = req.cookies?.authToken || req.cookies?.token || (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);
    if (!token) return res.status(401).json({ error: 'Token de autenticação não encontrado.' });

    const financeiroUrl = process.env.FINANCEIRO_URL || 'http://localhost:3006/api/financeiro/contas-pagar';
    const payload = { descricao, valor_total: valorTotal, data_emissao, data_vencimento, observacoes: `Folha manual ${tipoLabel} integrada. ID: ${folhaId}` };
    const headers = { Authorization: `Bearer ${token}` };
    let financeiroResp;
    try {
      financeiroResp = await axios.post(financeiroUrl, payload, { headers });
    } catch (err) {
      logger.error('Erro ao integrar folha manual com Financeiro:', err?.response?.data || err.message);
      return res.status(500).json({ error: 'Erro ao criar conta a pagar no Financeiro', details: err?.response?.data || err.message });
    }

    res.json({ success: true, folha_id: folhaId, valor_total: valorTotal, financeiro: financeiroResp.data });
  } catch (error) {
    logger.error('Erro ao fechar folha manual:', error);
    res.status(500).json({ error: 'Erro ao fechar folha manual', details: error.message });
  }
});

// PUT /api/rh/folha-manual/:id/reabrir - Reabrir folha fechada
app.put('/api/rh/folha-manual/:id/reabrir', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Apenas administradores.' });
  try {
    await pool.query("UPDATE rh_folha_manual SET status = 'rascunho', fechado_em = NULL WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao reabrir folha:', error);
    res.status(500).json({ error: 'Erro ao reabrir folha' });
  }
});

// GET /api/rh/funcionarios-empresas - Listar funcionários agrupados por empresa para importar na folha
app.get('/api/rh/funcionarios-empresas', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.id, f.nome_completo as nome, f.cargo, f.departamento, f.salario,
             COALESCE(f.departamento, 'SEM EMPRESA') as empresa
      FROM funcionarios f
      WHERE f.status = 'Ativo' OR f.ativo = 1
      ORDER BY f.departamento, f.nome_completo
    `);
    res.json(rows);
  } catch (error) {
    logger.error('Erro ao buscar funcionários:', error);
    res.status(500).json({ error: 'Erro ao buscar funcionários' });
  }
});

// GET /api/rh/holerite/:id - Buscar holerite específico
app.get('/api/rh/holerite/:id', authMiddleware, async (req, res) => {
  try {
    const [holerite] = await pool.query(`
      SELECT h.*, f.nome AS funcionario_nome, fp.mes, fp.ano
      FROM rh_holerites h
      LEFT JOIN funcionarios f ON h.funcionario_id = f.id
      LEFT JOIN rh_folhas_pagamento fp ON h.folha_id = fp.id
      WHERE h.id = ?
    `, [req.params.id]);
    
    if (holerite.length === 0) {
      return res.status(404).json({ error: 'Holerite não encontrado' });
    }
    
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver este holerite
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(holerite[0].funcionario_id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seus próprios holerites.' });
    }
    
    // Buscar itens adicionais
    const [itens] = await pool.query(
      'SELECT * FROM rh_holerite_itens WHERE holerite_id = ?',
      [req.params.id]
    );
    
    res.json({
      ...holerite[0],
      itens
    });
  } catch (error) {
    logger.error('Erro ao buscar holerite:', error);
    res.status(500).json({ error: 'Erro ao buscar holerite' });
  }
});

// GET /api/rh/holerite/funcionario/:funcionario_id - Holerites do funcionário
app.get('/api/rh/holerite/funcionario/:funcionario_id', authMiddleware, async (req, res) => {
  // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver estes holerites
  const userFuncId = Number(req.user.funcionario_id || req.user.id);
  if (Number(req.params.funcionario_id) !== userFuncId && !isAdminUser(req.user)) {
    return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seus próprios holerites.' });
  }
  
  const { ano } = req.query;
  
  try {
    let query = `
      SELECT h.*, fp.mes, fp.ano, fp.tipo, fp.status AS folha_status
      FROM rh_holerites h
      INNER JOIN rh_folhas_pagamento fp ON h.folha_id = fp.id
      WHERE h.funcionario_id = ?
    `;
    const params = [req.params.funcionario_id];
    
    if (ano) {
      query += ' AND fp.ano = ?';
      params.push(ano);
    }
    
    query += ' ORDER BY fp.ano DESC, fp.mes DESC';
    
    const [holerites] = await pool.query(query, params);
    
    res.json(holerites);
  } catch (error) {
    logger.error('Erro ao buscar holerites:', error);
    res.status(500).json({ error: 'Erro ao buscar holerites' });
  }
});

// PUT /api/rh/holerite/:id - Atualizar holerite (ADMIN ONLY)
app.put('/api/rh/holerite/:id', authMiddleware, async (req, res) => {
  // Verificação de permissão de administrador
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem atualizar holerites.' });
  }
  
  const updates = req.body;
  const allowedFields = [
    'horas_extras', 'adicional_noturno', 'adicional_periculosidade', 
    'adicional_insalubridade', 'comissoes', 'bonus', 'gratificacoes',
    'ferias_pagamento', 'terco_ferias', 'vale_transporte', 'vale_refeicao',
    'plano_saude', 'adiantamento', 'faltas', 'atrasos', 'emprestimos',
    'pensao_alimenticia', 'outros_proventos', 'outros_descontos', 'observacoes'
  ];
  
  const fields = Object.keys(updates).filter(k => allowedFields.includes(k));
  
  if (fields.length === 0) {
    return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
  }
  
  try {
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(req.params.id);
    
    await pool.query(`UPDATE rh_holerites SET ${setClause} WHERE id = ?`, values);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao atualizar holerite:', error);
    res.status(500).json({ error: 'Erro ao atualizar holerite' });
  }
});

// POST /api/rh/holerite/:id/item - Adicionar item ao holerite
app.post('/api/rh/holerite/:id/item', authMiddleware, async (req, res) => {
  const { tipo, referencia, valor } = req.body;
  const codigo = req.body.codigo ?? req.body['código'];
  const descricao = req.body.descricao ?? req.body['descrição'];
  
  if (!tipo || !descricao || !valor) {
    return res.status(400).json({ error: 'tipo, descrição e valor são obrigatórios' });
  }
  
  try {
    await pool.query(
      'INSERT INTO rh_holerite_itens (holerite_id, tipo, codigo, descricao, referencia, valor) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, tipo, codigo, descricao, referencia, valor]
    );
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao adicionar item:', error);
    res.status(500).json({ error: 'Erro ao adicionar item' });
  }
});

// ============ HOLERITES (plural) - ROTAS PARA GESTÃO DE HOLERITES ============

// Ensure visualizacoes and confirmacao columns exist
const ensureHoleritesColumns = `
  ALTER TABLE rh_holerites
    ADD COLUMN IF NOT EXISTS visualizado TINYINT(1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_visualizacoes INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS confirmado_recebimento TINYINT(1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS data_confirmacao DATETIME NULL,
    ADD COLUMN IF NOT EXISTS arquivo_pdf VARCHAR(255),
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'rascunho',
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(30) DEFAULT 'salario'
`;
db.query(ensureHoleritesColumns, (e) => {
  if (e && !e.message?.includes('Duplicate')) logger.warn('Aviso ao ajustar colunas rh_holerites:', e.message);
});

// Ensure table de consentimento digital para holerites
const ensureHoleritesConsentTable = `
  CREATE TABLE IF NOT EXISTS rh_holerites_consentimentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    funcionario_id INT NOT NULL,
    assinatura_digital VARCHAR(255) NOT NULL,
    aceito TINYINT(1) DEFAULT 1,
    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_holerites_consentimento_funcionario (funcionario_id)
  )
`;
db.query(ensureHoleritesConsentTable, (e) => {
  if (e) logger.warn('Aviso ao criar tabela rh_holerites_consentimentos:', e.message);
});

function getUserFuncionarioId(user) {
  const id = Number(user?.funcionario_id || user?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// GET /api/rh/holerites/eventos/padrao - Eventos padrão para holerite
app.get('/api/rh/holerites/eventos/padrao', authMiddleware, async (req, res) => {
  res.json({
    proventos: [
      { codigo: '001', descricao: 'Salário Base', referencia: '220h' },
      { codigo: '002', descricao: 'Horas Extras 50%', referencia: '' },
      { codigo: '003', descricao: 'Horas Extras 100%', referencia: '' },
      { codigo: '004', descricao: 'Adicional Noturno', referencia: '' },
      { codigo: '005', descricao: 'Insalubridade', referencia: '' },
      { codigo: '006', descricao: 'Periculosidade', referencia: '' },
      { codigo: '007', descricao: 'Comissão', referencia: '' },
      { codigo: '008', descricao: 'Gratificação', referencia: '' },
      { codigo: '009', descricao: 'DSR', referencia: '' }
    ],
    descontos: [
      { codigo: '101', descricao: 'INSS', referencia: '' },
      { codigo: '102', descricao: 'IRRF', referencia: '' },
      { codigo: '103', descricao: 'Vale Transporte (6%)', referencia: '' },
      { codigo: '104', descricao: 'Vale Refeição', referencia: '' },
      { codigo: '105', descricao: 'Plano de Saúde', referencia: '' },
      { codigo: '106', descricao: 'Plano Odontológico', referencia: '' },
      { codigo: '107', descricao: 'Pensão Alimentícia', referencia: '' },
      { codigo: '108', descricao: 'Adiantamento', referencia: '' },
      { codigo: '109', descricao: 'Faltas/Atrasos', referencia: '' }
    ]
  });
});

// GET /api/rh/holerites - Listar holerites com filtros (ADMIN)
app.get('/api/rh/holerites', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  const { funcionario_id, mes, ano, status, tipo } = req.query;
  try {
    let query = `
      SELECT h.*, f.nome AS funcionario_nome, f.cargo, f.departamento,
        COALESCE(h.tipo, fp.tipo, 'salario') AS tipo,
        COALESCE(h.status, fp.status, 'rascunho') AS status,
        fp.mes, fp.ano
      FROM rh_holerites h
      LEFT JOIN funcionarios f ON h.funcionario_id = f.id
      LEFT JOIN rh_folhas_pagamento fp ON h.folha_id = fp.id
      WHERE 1=1
    `;
    const params = [];
    if (funcionario_id) { query += ' AND h.funcionario_id = ?'; params.push(funcionario_id); }
    if (mes) { query += ' AND (fp.mes = ? OR h.id > 0 AND fp.mes = ?)'; params.push(mes, mes); }
    if (ano) { query += ' AND fp.ano = ?'; params.push(ano); }
    if (status) { query += ' AND (h.status = ? OR fp.status = ?)'; params.push(status, status); }
    if (tipo) { query += ' AND (h.tipo = ? OR fp.tipo = ?)'; params.push(tipo, tipo); }
    query += ' ORDER BY fp.ano DESC, fp.mes DESC, f.nome';

    const [holerites] = await pool.query(query, params);

    // Stats
    const total = holerites.length;
    const publicados = holerites.filter(h => h.status === 'publicado').length;
    const visualizados = holerites.filter(h => h.visualizado).length;
    const naoVisualizados = publicados - visualizados;

    res.json({
      holerites,
      stats: { total, publicados, visualizados, naoVisualizados }
    });
  } catch (error) {
    logger.error('Erro ao listar holerites:', error);
    res.status(500).json({ error: 'Erro ao listar holerites' });
  }
});

// GET /api/rh/holerites/consentimento - Verificar consentimento digital do usuário logado
app.get('/api/rh/holerites/consentimento', authMiddleware, async (req, res) => {
  try {
    if (isAdminUser(req.user)) {
      return res.json({ consentimento: true, admin: true });
    }

    const funcionarioId = getUserFuncionarioId(req.user);
    if (!funcionarioId) {
      return res.status(400).json({ message: 'Funcionário não identificado para o usuário logado.' });
    }

    const [rows] = await pool.query(
      'SELECT id, assinatura_digital, created_at, updated_at FROM rh_holerites_consentimentos WHERE funcionario_id = ? AND aceito = 1 LIMIT 1',
      [funcionarioId]
    );

    const consent = rows.length > 0;
    return res.json({
      consentimento: consent,
      admin: false,
      registro: consent ? rows[0] : null
    });
  } catch (error) {
    logger.error('Erro ao verificar consentimento digital de holerites:', error);
    res.status(500).json({ error: 'Erro ao verificar consentimento digital' });
  }
});

// POST /api/rh/holerites/consentimento - Registrar/atualizar consentimento digital
app.post('/api/rh/holerites/consentimento', authMiddleware, async (req, res) => {
  try {
    if (isAdminUser(req.user)) {
      return res.json({ success: true, admin: true, message: 'Usuário admin não precisa de consentimento.' });
    }

    const assinatura = String(req.body?.assinatura_digital || '').trim();
    if (assinatura.length < 3) {
      return res.status(400).json({ message: 'assinatura_digital é obrigatória e deve ter ao menos 3 caracteres.' });
    }

    const funcionarioId = getUserFuncionarioId(req.user);
    if (!funcionarioId) {
      return res.status(400).json({ message: 'Funcionário não identificado para o usuário logado.' });
    }

    const ipAddress = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || null;
    const userAgent = req.headers['user-agent'] || null;

    await pool.query(
      `INSERT INTO rh_holerites_consentimentos
        (funcionario_id, assinatura_digital, aceito, ip_address, user_agent)
       VALUES (?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         assinatura_digital = VALUES(assinatura_digital),
         aceito = 1,
         ip_address = VALUES(ip_address),
         user_agent = VALUES(user_agent),
         updated_at = CURRENT_TIMESTAMP`,
      [funcionarioId, assinatura, ipAddress, userAgent]
    );

    res.json({ success: true, message: 'Consentimento digital registrado com sucesso.' });
  } catch (error) {
    logger.error('Erro ao registrar consentimento digital de holerites:', error);
    res.status(500).json({ error: 'Erro ao registrar consentimento digital' });
  }
});

// GET /api/rh/holerites/meus - Listar holerites do funcionário logado
app.get('/api/rh/holerites/meus', authMiddleware, async (req, res) => {
  try {
    const funcionarioId = getUserFuncionarioId(req.user);
    if (!funcionarioId) {
      return res.status(400).json({ error: 'Funcionário não identificado para o usuário logado.' });
    }

    const { mes, ano } = req.query;
    let query = `
      SELECT h.*, f.nome AS funcionario_nome, f.cargo, f.departamento, f.cpf,
        COALESCE(h.tipo, fp.tipo, 'salario') AS tipo,
        COALESCE(h.status, fp.status, 'rascunho') AS status_holerite,
        fp.mes, fp.ano
      FROM rh_holerites h
      LEFT JOIN funcionarios f ON h.funcionario_id = f.id
      LEFT JOIN rh_folhas_pagamento fp ON h.folha_id = fp.id
      WHERE h.funcionario_id = ? AND (h.status = 'publicado' OR fp.status = 'publicado')
    `;
    const params = [funcionarioId];
    if (ano) { query += ' AND fp.ano = ?'; params.push(parseInt(ano)); }
    if (mes) { query += ' AND fp.mes = ?'; params.push(parseInt(mes)); }
    query += ' ORDER BY fp.ano DESC, fp.mes DESC';

    const [holerites] = await pool.query(query, params);
    res.json({ holerites });
  } catch (error) {
    logger.error('Erro ao listar holerites do funcionário:', error);
    res.status(500).json({ error: 'Erro ao listar holerites' });
  }
});

// GET /api/rh/holerites/:id - Buscar holerite por id (plural alias)
app.get('/api/rh/holerites/:id', authMiddleware, async (req, res, next) => {
  // Avoid matching named subroutes
  if (!/^\d+$/.test(req.params.id)) return next();
  try {
    const [holerite] = await pool.query(`
      SELECT h.*, f.nome AS funcionario_nome, f.cargo, f.departamento, f.cpf, fp.mes, fp.ano,
        COALESCE(h.tipo, fp.tipo, 'salario') AS tipo,
        COALESCE(h.status, fp.status, 'rascunho') AS status
      FROM rh_holerites h
      LEFT JOIN funcionarios f ON h.funcionario_id = f.id
      LEFT JOIN rh_folhas_pagamento fp ON h.folha_id = fp.id
      WHERE h.id = ?
    `, [req.params.id]);
    if (holerite.length === 0) return res.status(404).json({ error: 'Holerite não encontrado' });

    // Verificar se o usuário pode ver este holerite
    const userFuncId = getUserFuncionarioId(req.user);
    if (userFuncId && Number(holerite[0].funcionario_id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seus próprios holerites.' });
    }

    const [itens] = await pool.query('SELECT * FROM rh_holerite_itens WHERE holerite_id = ?', [req.params.id]);
    const proventos = itens.filter(i => i.tipo === 'provento');
    const descontos = itens.filter(i => i.tipo === 'desconto');

    res.json({ ...holerite[0], proventos, descontos, itens });
  } catch (error) {
    logger.error('Erro ao buscar holerite:', error);
    res.status(500).json({ error: 'Erro ao buscar holerite' });
  }
});

// POST /api/rh/holerites - Criar holerite manual
app.post('/api/rh/holerites', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  const { funcionario_id, mes, ano, salario_base, total_proventos, total_descontos, salario_liquido, proventos, descontos, status, tipo } = req.body;
  if (!funcionario_id || !mes || !ano) return res.status(400).json({ error: 'funcionario_id, mes e ano são obrigatórios' });
  try {
    // Buscar ou criar folha
    let [folhas] = await pool.query('SELECT id FROM rh_folhas_pagamento WHERE mes=? AND ano=? LIMIT 1', [mes, ano]);
    let folha_id;
    if (folhas.length > 0) {
      folha_id = folhas[0].id;
    } else {
      const [result] = await pool.query(
        'INSERT INTO rh_folhas_pagamento (mes, ano, tipo, status) VALUES (?, ?, ?, ?)',
        [mes, ano, tipo || 'salario', 'rascunho']
      );
      folha_id = result.insertId;
    }

    const [result] = await pool.query(`
      INSERT INTO rh_holerites (folha_id, funcionario_id, salario_base, total_proventos, total_descontos, salario_liquido, status, tipo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [folha_id, funcionario_id, salario_base || 0, total_proventos || 0, total_descontos || 0, salario_liquido || 0, status || 'rascunho', tipo || 'salario']);

    const holeriteId = result.insertId;

    // Inserir itens
    if (proventos?.length) {
      for (const p of proventos) {
        await pool.query('INSERT INTO rh_holerite_itens (holerite_id, tipo, codigo, descricao, referencia, valor) VALUES (?,?,?,?,?,?)',
          [holeriteId, 'provento', p.codigo, p.descricao, p.referencia, p.valor || 0]);
      }
    }
    if (descontos?.length) {
      for (const d of descontos) {
        await pool.query('INSERT INTO rh_holerite_itens (holerite_id, tipo, codigo, descricao, referencia, valor) VALUES (?,?,?,?,?,?)',
          [holeriteId, 'desconto', d.codigo, d.descricao, d.referencia, d.valor || 0]);
      }
    }

    res.json({ success: true, id: holeriteId, message: 'Holerite criado com sucesso!' });
  } catch (error) {
    logger.error('Erro ao criar holerite:', error);
    res.status(500).json({ error: 'Erro ao criar holerite' });
  }
});

// PUT /api/rh/holerites/:id - Atualizar holerite
app.put('/api/rh/holerites/:id', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  const { salario_base, total_proventos, total_descontos, salario_liquido, proventos, descontos, status, tipo } = req.body;
  try {
    const updates = [];
    const params = [];
    if (salario_base !== undefined) { updates.push('salario_base=?'); params.push(salario_base); }
    if (total_proventos !== undefined) { updates.push('total_proventos=?'); params.push(total_proventos); }
    if (total_descontos !== undefined) { updates.push('total_descontos=?'); params.push(total_descontos); }
    if (salario_liquido !== undefined) { updates.push('salario_liquido=?'); params.push(salario_liquido); }
    if (status) { updates.push('status=?'); params.push(status); }
    if (tipo) { updates.push('tipo=?'); params.push(tipo); }

    if (updates.length > 0) {
      params.push(req.params.id);
      await pool.query(`UPDATE rh_holerites SET ${updates.join(', ')} WHERE id=?`, params);
    }

    // Atualizar itens se fornecidos
    if (proventos || descontos) {
      await pool.query('DELETE FROM rh_holerite_itens WHERE holerite_id=?', [req.params.id]);
      if (proventos?.length) {
        for (const p of proventos) {
          await pool.query('INSERT INTO rh_holerite_itens (holerite_id, tipo, codigo, descricao, referencia, valor) VALUES (?,?,?,?,?,?)',
            [req.params.id, 'provento', p.codigo, p.descricao, p.referencia, p.valor || 0]);
        }
      }
      if (descontos?.length) {
        for (const d of descontos) {
          await pool.query('INSERT INTO rh_holerite_itens (holerite_id, tipo, codigo, descricao, referencia, valor) VALUES (?,?,?,?,?,?)',
            [req.params.id, 'desconto', d.codigo, d.descricao, d.referencia, d.valor || 0]);
        }
      }
    }

    res.json({ success: true, message: 'Holerite atualizado com sucesso!' });
  } catch (error) {
    logger.error('Erro ao atualizar holerite:', error);
    res.status(500).json({ error: 'Erro ao atualizar holerite' });
  }
});

// DELETE /api/rh/holerites/:id - Excluir holerite
app.delete('/api/rh/holerites/:id', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  try {
    await pool.query('DELETE FROM rh_holerite_itens WHERE holerite_id=?', [req.params.id]);
    await pool.query('DELETE FROM rh_holerites WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Holerite excluído com sucesso!' });
  } catch (error) {
    logger.error('Erro ao excluir holerite:', error);
    res.status(500).json({ error: 'Erro ao excluir holerite' });
  }
});

// POST /api/rh/holerites/:id/publicar - Publicar holerite
app.post('/api/rh/holerites/:id/publicar', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  try {
    await pool.query("UPDATE rh_holerites SET status='publicado' WHERE id=?", [req.params.id]);
    res.json({ success: true, message: 'Holerite publicado com sucesso!' });
  } catch (error) {
    logger.error('Erro ao publicar holerite:', error);
    res.status(500).json({ error: 'Erro ao publicar holerite' });
  }
});

// GET /api/rh/holerites/:id/download-pdf - Download PDF
app.get('/api/rh/holerites/:id/download-pdf', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT arquivo_pdf FROM rh_holerites WHERE id=?', [req.params.id]);
    if (rows.length === 0 || !rows[0].arquivo_pdf) {
      return res.status(404).json({ error: 'PDF não encontrado' });
    }
    const filePath = path.join(__dirname, 'public', rows[0].arquivo_pdf);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado' });
    res.download(filePath);
  } catch (error) {
    logger.error('Erro ao baixar PDF:', error);
    res.status(500).json({ error: 'Erro ao baixar PDF' });
  }
});

// POST /api/rh/holerites/:id/visualizar - Registrar que o funcionário visualizou o holerite
app.post('/api/rh/holerites/:id/visualizar', authMiddleware, async (req, res) => {
  try {
    const holeriteId = req.params.id;
    const userFuncId = getUserFuncionarioId(req.user);

    // Verificar ownership para não-admin
    if (userFuncId && !isAdminUser(req.user)) {
      const [rows] = await pool.query('SELECT funcionario_id FROM rh_holerites WHERE id = ? LIMIT 1', [holeriteId]);
      if (rows.length > 0 && Number(rows[0].funcionario_id) !== userFuncId) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    await pool.query(
      'UPDATE rh_holerites SET visualizado = 1, total_visualizacoes = COALESCE(total_visualizacoes, 0) + 1 WHERE id = ?',
      [holeriteId]
    );
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao registrar visualização:', error);
    res.status(500).json({ error: 'Erro ao registrar visualização' });
  }
});

// POST /api/rh/holerites/:id/confirmar - Confirmar recebimento do holerite
app.post('/api/rh/holerites/:id/confirmar', authMiddleware, async (req, res) => {
  try {
    const holeriteId = req.params.id;
    const userFuncId = getUserFuncionarioId(req.user);

    // Verificar ownership para não-admin
    if (userFuncId && !isAdminUser(req.user)) {
      const [rows] = await pool.query('SELECT funcionario_id FROM rh_holerites WHERE id = ? LIMIT 1', [holeriteId]);
      if (rows.length > 0 && Number(rows[0].funcionario_id) !== userFuncId) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    await pool.query(
      "UPDATE rh_holerites SET confirmado_recebimento = 1, data_confirmacao = NOW() WHERE id = ?",
      [holeriteId]
    );
    res.json({ success: true, message: 'Recebimento confirmado com sucesso!' });
  } catch (error) {
    logger.error('Erro ao confirmar recebimento:', error);
    res.status(500).json({ error: 'Erro ao confirmar recebimento' });
  }
});

// GET /api/rh/holerites/consentimentos - Listar consentimentos
app.get('/api/rh/holerites/consentimentos', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  try {
    const [rows] = await pool.query(`
      SELECT h.id, h.funcionario_id, f.nome AS funcionario_nome, h.confirmado_recebimento,
        fp.mes, fp.ano
      FROM rh_holerites h
      LEFT JOIN funcionarios f ON h.funcionario_id = f.id
      LEFT JOIN rh_folhas_pagamento fp ON h.folha_id = fp.id
      WHERE h.status = 'publicado'
      ORDER BY fp.ano DESC, fp.mes DESC, f.nome
    `);
    res.json({ consentimentos: rows });
  } catch (error) {
    logger.error('Erro ao buscar consentimentos:', error);
    res.status(500).json({ error: 'Erro ao buscar consentimentos' });
  }
});

// POST /api/rh/holerites/importar-pdf - Importar PDF de holerite (identificação automática por nome)
const uploadHoleritePDF = multer({ storage: holeriteStorage, fileFilter: pdfFileFilter, limits: { fileSize: 20 * 1024 * 1024 } });
app.post('/api/rh/holerites/importar-pdf', authMiddleware, uploadHoleritePDF.single('pdf'), async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  if (!req.file) return res.status(400).json({ error: 'Arquivo PDF é obrigatório' });
  const { mes, ano, tipo = 'salario', publicar_automaticamente } = req.body;
  if (!mes || !ano) return res.status(400).json({ error: 'mes e ano são obrigatórios' });

  let pdfParse;
  try { pdfParse = require('pdf-parse'); } catch (e) {
    return res.status(500).json({ error: 'Módulo pdf-parse não disponível. Instale com: npm install pdf-parse' });
  }

  // Normaliza string para comparação: remove acentos, lowercase, trim
  function normalizarNome(s) {
    if (!s) return '';
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  // Tenta identificar funcionário pelo texto extraído da página
  function identificarFuncionario(textoPagina, funcionarios) {
    const textoNorm = normalizarNome(textoPagina);
    // 1. Correspondência exata do nome completo
    for (const f of funcionarios) {
      if (normalizarNome(f.nome) && textoNorm.includes(normalizarNome(f.nome))) {
        return { funcionario: f, matchedBy: 'nome_completo' };
      }
    }
    // 2. Correspondência por CPF (sem formatação)
    for (const f of funcionarios) {
      if (f.cpf) {
        const cpfDigits = f.cpf.replace(/\D/g, '');
        if (cpfDigits.length === 11 && textoPagina.replace(/\D/g,'').includes(cpfDigits)) {
          return { funcionario: f, matchedBy: 'cpf' };
        }
      }
    }
    // 3. Correspondência por PIS/PASEP
    for (const f of funcionarios) {
      if (f.pis_pasep) {
        const pis = f.pis_pasep.replace(/\D/g, '');
        if (pis.length >= 9 && textoPagina.replace(/\D/g,'').includes(pis)) {
          return { funcionario: f, matchedBy: 'pis_pasep' };
        }
      }
    }
    // 4. Correspondência por 2+ palavras do nome (mín. 4 chars cada)
    for (const f of funcionarios) {
      const palavrasNome = normalizarNome(f.nome).split(/\s+/).filter(p => p.length >= 4);
      const matchCount = palavrasNome.filter(p => textoNorm.includes(p)).length;
      if (matchCount >= 2) {
        return { funcionario: f, matchedBy: 'nome_parcial' };
      }
    }
    return null;
  }

  try {
    // Buscar/criar folha de pagamento
    let [folhas] = await pool.query('SELECT id FROM rh_folhas_pagamento WHERE mes=? AND ano=? AND tipo=? LIMIT 1', [mes, ano, tipo]);
    let folha_id;
    if (folhas.length > 0) {
      folha_id = folhas[0].id;
    } else {
      const [result] = await pool.query('INSERT INTO rh_folhas_pagamento (mes, ano, tipo, status) VALUES (?, ?, ?, ?)', [mes, ano, tipo, 'rascunho']);
      folha_id = result.insertId;
    }

    // Buscar todos os funcionários ativos
    const [funcionarios] = await pool.query("SELECT id, nome, cpf, pis_pasep FROM funcionarios WHERE status = 'ativo' OR status IS NULL OR status = 'Ativo'");

    // Parsear o PDF completo
    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer, { max: 0 });
    const totalPaginas = pdfData.numpages;

    // Processar página a página
    // pdf-parse retorna texto único; para separar por página usamos renderPage callback
    const pageTexts = [];
    await pdfParse(pdfBuffer, {
      pagerender: (pageData) => {
        return pageData.getTextContent({ normalizeWhitespace: true }).then(tc => {
          const text = tc.items.map(i => i.str).join(' ');
          pageTexts.push(text);
          return text;
        });
      }
    }).catch(() => {});

    // Se não conseguiu por pagerender, usa fallback por split de página
    if (pageTexts.length === 0 && pdfData.text) {
      const pageSep = /\f|\n{5,}/;
      const partes = pdfData.text.split(pageSep);
      partes.forEach(p => pageTexts.push(p));
    }

    const statusHolerite = publicar_automaticamente === 'true' ? 'publicado' : 'rascunho';
    const detalhes = [];
    let importados = 0;
    let nao_identificados = 0;
    const erros = [];

    for (let i = 0; i < pageTexts.length; i++) {
      const pagText = pageTexts[i];
      const match = identificarFuncionario(pagText, funcionarios);

      if (!match) {
        nao_identificados++;
        detalhes.push({ pagina: i + 1, funcionario: null, matchedBy: null, status: 'nao_identificado' });
        continue;
      }

      const { funcionario, matchedBy } = match;
      // Salvar arquivo separado por funcionário (reutiliza o mesmo PDF - URLs com #page= para referência)
      const arquivoUrl = `/uploads/holerites/${req.file.filename}`;
      try {
        // Evitar duplicatas: verificar se já existe holerite para esse funcionário nessa folha
        const [existing] = await pool.query(
          'SELECT id FROM rh_holerites WHERE folha_id=? AND funcionario_id=? LIMIT 1',
          [folha_id, funcionario.id]
        );
        if (existing.length > 0) {
          await pool.query(
            'UPDATE rh_holerites SET arquivo_pdf=?, status=?, updated_at=NOW() WHERE id=?',
            [arquivoUrl, statusHolerite, existing[0].id]
          );
        } else {
          await pool.query(
            'INSERT INTO rh_holerites (folha_id, funcionario_id, arquivo_pdf, status) VALUES (?, ?, ?, ?)',
            [folha_id, funcionario.id, arquivoUrl, statusHolerite]
          );
        }
        importados++;
        detalhes.push({ pagina: i + 1, funcionario: funcionario.nome, matchedBy, status: 'importado' });
      } catch (dbErr) {
        erros.push({ pagina: i + 1, erro: dbErr.message });
        detalhes.push({ pagina: i + 1, funcionario: funcionario.nome, matchedBy, status: 'erro_db' });
      }
    }

    res.json({
      message: `Importação concluída: ${importados} importados, ${nao_identificados} não identificados de ${pageTexts.length} páginas`,
      resultados: {
        total_paginas: totalPaginas,
        paginas_processadas: pageTexts.length,
        importados,
        nao_identificados,
        detalhes,
        erros
      }
    });
  } catch (error) {
    logger.error('Erro ao importar PDF em lote:', error);
    res.status(500).json({ error: 'Erro ao processar PDF: ' + error.message });
  }
});

// GET /api/rh/holerites/relatorio/visualizacoes - Relatório HTML de visualizações
app.get('/api/rh/holerites/relatorio/visualizacoes', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  const { mes, ano } = req.query;
  try {
    let query = `
      SELECT h.id, f.nome AS funcionario_nome, f.cargo, f.departamento,
        fp.mes, fp.ano, h.visualizado, h.total_visualizacoes, h.confirmado_recebimento,
        COALESCE(h.status, fp.status) AS status
      FROM rh_holerites h
      LEFT JOIN funcionarios f ON h.funcionario_id = f.id
      LEFT JOIN rh_folhas_pagamento fp ON h.folha_id = fp.id
      WHERE h.status = 'publicado'
    `;
    const params = [];
    if (mes) { query += ' AND fp.mes = ?'; params.push(mes); }
    if (ano) { query += ' AND fp.ano = ?'; params.push(ano); }
    query += ' ORDER BY f.nome';

    const [rows] = await pool.query(query, params);
    const meses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const total = rows.length;
    const vistos = rows.filter(r => r.visualizado).length;
    const confirmados = rows.filter(r => r.confirmado_recebimento).length;
    const periodo = mes && ano ? `${meses[parseInt(mes)]}/${ano}` : ano ? `Ano ${ano}` : 'Todos os períodos';

    let html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório de Visualizações</title>
    <style>
      body{font-family:'Segoe UI',sans-serif;margin:0;padding:20px;background:#f8fafc;color:#1e293b;}
      h1{font-size:1.2rem;color:#1e293b;margin-bottom:4px;}
      .periodo{font-size:0.85rem;color:#64748b;margin-bottom:16px;}
      .stats{display:flex;gap:12px;margin-bottom:20px;}
      .stat{flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center;}
      .stat-value{font-size:1.5rem;font-weight:700;color:#6366f1;}
      .stat-label{font-size:0.75rem;color:#64748b;}
      table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;}
      th{background:#f1f5f9;padding:10px 12px;font-size:0.75rem;text-transform:uppercase;color:#64748b;text-align:left;font-weight:600;}
      td{padding:10px 12px;border-top:1px solid #f1f5f9;font-size:0.85rem;}
      tr:hover{background:#f8fafc;}
      .badge{padding:3px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;}
      .badge-sim{background:#dcfce7;color:#166534;}
      .badge-nao{background:#fee2e2;color:#991b1b;}
      @media print{body{padding:0;background:#fff;}.stats .stat{border:1px solid #ccc;}}
    </style></head><body>
    <h1><i>📊</i> Relatório de Visualizações de Holerites</h1>
    <p class="periodo">${periodo} | Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
    <div class="stats">
      <div class="stat"><div class="stat-value">${total}</div><div class="stat-label">Total</div></div>
      <div class="stat"><div class="stat-value">${vistos}</div><div class="stat-label">Visualizados</div></div>
      <div class="stat"><div class="stat-value">${total - vistos}</div><div class="stat-label">Não Vistos</div></div>
      <div class="stat"><div class="stat-value">${confirmados}</div><div class="stat-label">Confirmados</div></div>
    </div>
    <table><thead><tr><th>Funcionário</th><th>Cargo</th><th>Departamento</th><th>Período</th><th>Visualizado</th><th>Visualizações</th><th>Confirmado</th></tr></thead><tbody>`;

    rows.forEach(r => {
      html += `<tr>
        <td style="font-weight:600;">${r.funcionario_nome || 'N/A'}</td>
        <td>${r.cargo || '-'}</td>
        <td>${r.departamento || '-'}</td>
        <td>${meses[r.mes] || '-'}/${r.ano || '-'}</td>
        <td><span class="badge ${r.visualizado ? 'badge-sim' : 'badge-nao'}">${r.visualizado ? 'Sim' : 'Não'}</span></td>
        <td>${r.total_visualizacoes || 0}x</td>
        <td><span class="badge ${r.confirmado_recebimento ? 'badge-sim' : 'badge-nao'}">${r.confirmado_recebimento ? 'Sim' : 'Não'}</span></td>
      </tr>`;
    });

    html += `</tbody></table></body></html>`;
    res.type('html').send(html);
  } catch (error) {
    logger.error('Erro ao gerar relatório:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// POST /api/rh/decimo-terceiro/calcular - Calcular 13º salário
app.post('/api/rh/decimo-terceiro/calcular', authMiddleware, async (req, res) => {
  const { funcionario_id, ano, parcela = 'UNICA' } = req.body;
  
  if (!funcionario_id || !ano) {
    return res.status(400).json({ error: 'funcionario_id e ano são obrigatórios' });
  }
  
  try {
    // Buscar salário REAL e data de admissão do funcionário
    const [funcRows] = await pool.query(
      'SELECT salario_base, salario, data_admissao FROM funcionarios WHERE id = ?',
      [funcionario_id]
    );
    if (funcRows.length === 0) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }
    const salarioBase = parseFloat(funcRows[0].salario_base || funcRows[0].salario || 0);
    if (salarioBase <= 0) {
      return res.status(400).json({ error: 'Funcionário sem salário cadastrado' });
    }
    
    // Calcular meses trabalhados no ano (proporcional real)
    const dataAdmissao = funcRows[0].data_admissao ? new Date(funcRows[0].data_admissao) : null;
    let mesesTrabalhados = 12;
    if (dataAdmissao && dataAdmissao.getFullYear() === parseInt(ano)) {
      mesesTrabalhados = 12 - dataAdmissao.getMonth();
      // Se admitido após dia 15, não conta o mês de admissão
      if (dataAdmissao.getDate() > 15) mesesTrabalhados--;
    }
    if (mesesTrabalhados < 1) mesesTrabalhados = 1;
    if (mesesTrabalhados > 12) mesesTrabalhados = 12;
    
    const valorBruto = (salarioBase / 12) * mesesTrabalhados;
    
    // Calcular INSS
    const inss = calcularINSS(valorBruto);
    
    // Calcular IRRF
    const baseIRRF = valorBruto - inss.valor;
    const irrf = calcularIRRF(baseIRRF, 0);
    
    const valorLiquido = valorBruto - inss.valor - irrf.valor;
    
    const [result] = await pool.query(`
      INSERT INTO rh_decimo_terceiro (
        funcionario_id, ano, meses_trabalhados, valor_bruto,
        inss, irrf, valor_liquido, parcela
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [funcionario_id, ano, mesesTrabalhados, valorBruto, inss.valor, irrf.valor, valorLiquido, parcela]);
    
    res.json({
      success: true,
      id: result.insertId,
      valor_bruto: valorBruto,
      inss: inss.valor,
      irrf: irrf.valor,
      valor_liquido: valorLiquido
    });
  } catch (error) {
    logger.error('Erro ao calcular 13º:', error);
    res.status(500).json({ error: 'Erro ao calcular 13º salário' });
  }
});

// GET /api/rh/decimo-terceiro/:funcionario_id - Listar 13º do funcionário
app.get('/api/rh/decimo-terceiro/:funcionario_id', authMiddleware, async (req, res) => {
  try {
    const [decimosTerceiros] = await pool.query(
      'SELECT * FROM rh_decimo_terceiro WHERE funcionario_id = ? ORDER BY ano DESC',
      [req.params.funcionario_id]
    );
    
    res.json(decimosTerceiros);
  } catch (error) {
    logger.error('Erro ao buscar 13º:', error);
    res.status(500).json({ error: 'Erro ao buscar 13º salário' });
  }
});

// POST /api/rh/rescisao/calcular - Calcular rescisão
app.post('/api/rh/rescisao/calcular', authMiddleware, async (req, res) => {
  // AUDITORIA ENTERPRISE: Verificação obrigatória de admin para calcular rescisão
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem calcular rescisões.' });
  }

  const { 
    funcionario_id, tipo_rescisao, data_demissao, 
    aviso_previo_trabalhado = false, dias_aviso_previo = 30 
  } = req.body;
  
  if (!funcionario_id || !tipo_rescisao || !data_demissao) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }
  
  try {
    // Buscar salário REAL e data de admissão do funcionário
    const [funcRows] = await pool.query(
      'SELECT salario_base, salario, data_admissao FROM funcionarios WHERE id = ?',
      [funcionario_id]
    );
    if (funcRows.length === 0) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }
    const salarioBase = parseFloat(funcRows[0].salario_base || funcRows[0].salario || 0);
    if (salarioBase <= 0) {
      return res.status(400).json({ error: 'Funcionário sem salário cadastrado' });
    }
    
    // Calcular dias trabalhados no mês da demissão
    const dataDem = new Date(data_demissao);
    const dataAdm = new Date(funcRows[0].data_admissao);
    const diasTrabalhados = dataDem.getDate();
    const mesesTrabalhados = Math.max(1, Math.ceil((dataDem - dataAdm) / (1000 * 60 * 60 * 24 * 30.44)));
    const mesesNoAno = dataDem.getMonth() + 1;
    
    // Cálculo com valores reais e proporcionais
    const saldoSalario = (salarioBase / 30) * diasTrabalhados;
    const avisoIndenizado = aviso_previo_trabalhado ? 0 : salarioBase;
    const feriasProporcionais = (salarioBase / 12) * (mesesTrabalhados % 12 || 12);
    const tercoFerias = feriasProporcionais / 3;
    const decimoTerceiroProp = (salarioBase / 12) * mesesNoAno;
    
    const totalProventos = saldoSalario + avisoIndenizado + feriasProporcionais + tercoFerias + decimoTerceiroProp;
    
    // Impostos
    const inss = calcularINSS(totalProventos);
    const irrf = calcularIRRF(totalProventos - inss.valor, 0);
    
    const totalDescontos = inss.valor + irrf.valor;
    const valorLiquido = totalProventos - totalDescontos;
    
    // FGTS e multa (proporcional ao tempo de serviço)
    const fgtsAcumulado = salarioBase * 0.08 * mesesTrabalhados;
    const fgtsDepositar = salarioBase * 0.08;
    const multaFgts = tipo_rescisao === 'SEM_JUSTA_CAUSA' ? fgtsAcumulado * 0.40 : 0;
    
    const [result] = await pool.query(`
      INSERT INTO rh_rescisoes (
        funcionario_id, tipo_rescisao, data_demissao,
        aviso_previo_trabalhado, dias_aviso_previo,
        saldo_salario, aviso_previo_indenizado, ferias_proporcionais,
        terco_ferias_proporcionais, decimo_terceiro_proporcional,
        total_proventos, inss, irrf, total_descontos, valor_liquido,
        fgts_depositar, multa_fgts, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      funcionario_id, tipo_rescisao, data_demissao,
      aviso_previo_trabalhado, dias_aviso_previo,
      saldoSalario, avisoIndenizado, feriasProporcionais,
      tercoFerias, decimoTerceiroProp,
      totalProventos, inss.valor, irrf.valor, totalDescontos, valorLiquido,
      fgtsDepositar, multaFgts, req.user.id
    ]);
    
    res.json({
      success: true,
      id: result.insertId,
      total_proventos: totalProventos,
      total_descontos: totalDescontos,
      valor_liquido: valorLiquido,
      fgts_depositar: fgtsDepositar,
      multa_fgts: multaFgts
    });
  } catch (error) {
    logger.error('Erro ao calcular rescisão:', error);
    res.status(500).json({ error: 'Erro ao calcular rescisão' });
  }
});

// GET /api/rh/rescisao/:funcionario_id - Buscar rescisão do funcionário
app.get('/api/rh/rescisao/:funcionario_id', authMiddleware, async (req, res) => {
  try {
    const [rescisao] = await pool.query(
      'SELECT * FROM rh_rescisoes WHERE funcionario_id = ? ORDER BY data_demissao DESC',
      [req.params.funcionario_id]
    );
    
    res.json(rescisao.length > 0 ? rescisao[0] : null);
  } catch (error) {
    logger.error('Erro ao buscar rescisão:', error);
    res.status(500).json({ error: 'Erro ao buscar rescisão' });
  }
});

// GET /api/rh/folha/dashboard - Dashboard executivo
app.get('/api/rh/folha/dashboard', authMiddleware, async (req, res) => {
  const { ano } = req.query;
  
  try {
    let query = 'SELECT * FROM vw_indicadores_folha WHERE 1=1';
    const params = [];
    
    if (ano) {
      query += ' AND ano = ?';
      params.push(ano);
    } else {
      query += ' AND ano = YEAR(CURDATE())';
    }
    
    const [indicadores] = await pool.query(query, params);
    
    // Totalizador anual
    const totais = indicadores.reduce((acc, curr) => ({
      total_proventos: acc.total_proventos + parseFloat(curr.custo_total_proventos || 0),
      total_liquido: acc.total_liquido + parseFloat(curr.total_liquido_pago || 0),
      total_encargos: acc.total_encargos + parseFloat(curr.total_encargos_fgts || 0),
      total_inss: acc.total_inss + parseFloat(curr.total_inss_retido || 0),
      total_irrf: acc.total_irrf + parseFloat(curr.total_irrf_retido || 0)
    }), {
      total_proventos: 0,
      total_liquido: 0,
      total_encargos: 0,
      total_inss: 0,
      total_irrf: 0
    });
    
    res.json({
      por_mes: indicadores,
      totais_anuais: totais
    });
  } catch (error) {
    logger.error('Erro ao buscar dashboard:', error);
    res.status(500).json({ error: 'Erro ao buscar dashboard' });
  }
});

// GET /api/rh/folha/relatório/centro-custo - Relatório por centro de custo
app.get('/api/rh/folha/relatório/centro-custo', authMiddleware, async (req, res) => {
  const { mes, ano } = req.query;
  
  if (!mes || !ano) {
    return res.status(400).json({ error: 'Mês e ano são obrigatórios' });
  }
  
  try {
    const [relatório] = await pool.query(
      'SELECT * FROM vw_folha_por_centro_custo WHERE mes = ? AND ano = ? ORDER BY total_liquido DESC',
      [mes, ano]
    );
    
    res.json(relatório);
  } catch (error) {
    logger.error('Erro ao gerar relatório:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// GET /api/rh/impostos/config - Consultar tabelas de impostos
app.get('/api/rh/impostos/config', authMiddleware, async (req, res) => {
  const { tipo, ano = 2025 } = req.query;
  
  try {
    let query = 'SELECT * FROM rh_impostos_config WHERE ativo = TRUE AND ano = ?';
    const params = [ano];
    
    if (tipo) {
      query += ' AND tipo = ?';
      params.push(tipo);
    }
    
    query += ' ORDER BY tipo, faixa_inicio';
    
    const [impostos] = await pool.query(query, params);
    
    res.json(impostos);
  } catch (error) {
    logger.error('Erro ao buscar impostos:', error);
    res.status(500).json({ error: 'Erro ao buscar impostos' });
  }
});

// ==================== FASE 5: BENEFÍCIOS ====================

// GET /api/rh/beneficios/tipos - Listar tipos de benefícios
app.get('/api/rh/beneficios/tipos', authMiddleware, async (req, res) => {
  try {
    const [tipos] = await pool.query('SELECT * FROM rh_beneficios_tipos WHERE ativo = TRUE ORDER BY nome');
    res.json(tipos);
  } catch (error) {
    logger.error('Erro ao listar tipos:', error);
    res.status(500).json({ error: 'Erro ao listar tipos de benefícios' });
  }
});

// POST /api/rh/beneficios/vincular - Vincular benefício a funcionário
app.post('/api/rh/beneficios/vincular', authMiddleware, async (req, res) => {
  const { funcionario_id, beneficio_tipo_id, valor_mensal, quantidade = 1, data_inicio, observacoes } = req.body;
  
  if (!funcionario_id || !beneficio_tipo_id || !valor_mensal || !data_inicio) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }
  
  try {
    const [result] = await pool.query(`
      INSERT INTO rh_funcionarios_beneficios (
        funcionario_id, beneficio_tipo_id, valor_mensal, quantidade, data_inicio, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [funcionario_id, beneficio_tipo_id, valor_mensal, quantidade, data_inicio, observacoes]);
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    logger.error('Erro ao vincular benefício:', error);
    res.status(500).json({ error: 'Erro ao vincular benefício' });
  }
});

// GET /api/rh/beneficios/funcionario/:id - Benefícios do funcionário
app.get('/api/rh/beneficios/funcionario/:id', authMiddleware, async (req, res) => {
  try {
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver estes benefícios
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(req.params.id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seus próprios benefícios.' });
    }
    
    const [beneficios] = await pool.query(`
      SELECT fb.*, bt.nome AS beneficio_nome, bt.codigo, bt.descricao
      FROM rh_funcionarios_beneficios fb
      INNER JOIN rh_beneficios_tipos bt ON fb.beneficio_tipo_id = bt.id
      WHERE fb.funcionario_id = ? AND fb.ativo = TRUE
      ORDER BY bt.nome
    `, [req.params.id]);
    
    res.json(beneficios);
  } catch (error) {
    logger.error('Erro ao buscar benefícios:', error);
    res.status(500).json({ error: 'Erro ao buscar benefícios' });
  }
});

// PUT /api/rh/beneficios/:id/cancelar - Cancelar benefício (ADMIN ONLY)
app.put('/api/rh/beneficios/:id/cancelar', authMiddleware, async (req, res) => {
  // Verificação de permissão de administrador
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem cancelar benefícios.' });
  }
  
  const { data_fim, motivo } = req.body;
  
  try {
    await pool.query(
      'UPDATE rh_funcionarios_beneficios SET data_fim = ?, observacoes = CONCAT(COALESCE(observacoes, ""), " - Cancelado: ", ?), ativo = FALSE WHERE id = ?',
      [data_fim || new Date(), motivo || 'Não informado', req.params.id]
    );
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao cancelar benefício:', error);
    res.status(500).json({ error: 'Erro ao cancelar benefício' });
  }
});

// GET /api/rh/beneficios/dashboard - Dashboard de benefícios
app.get('/api/rh/beneficios/dashboard', authMiddleware, async (req, res) => {
  try {
    const [dashboard] = await pool.query('SELECT * FROM vw_dashboard_beneficios');
    const [porTipo] = await pool.query('SELECT * FROM vw_custos_beneficios ORDER BY custo_empresa_mensal DESC');
    
    res.json({
      resumo: dashboard[0],
      por_tipo: porTipo
    });
  } catch (error) {
    logger.error('Erro ao buscar dashboard:', error);
    res.status(500).json({ error: 'Erro ao buscar dashboard' });
  }
});

// POST /api/rh/dependentes/adicionar - Adicionar dependente
app.post('/api/rh/dependentes/adicionar', authMiddleware, async (req, res) => {
  const { funcionario_id, nome, cpf, data_nascimento, grau_parentesco, tem_plano_saude, irrf_dependente } = req.body;
  
  if (!funcionario_id || !nome || !data_nascimento || !grau_parentesco) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }
  
  try {
    const [result] = await pool.query(`
      INSERT INTO rh_dependentes (
        funcionario_id, nome, cpf, data_nascimento, grau_parentesco,
        tem_plano_saude, irrf_dependente
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [funcionario_id, nome, cpf, data_nascimento, grau_parentesco, tem_plano_saude || false, irrf_dependente || false]);
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    logger.error('Erro ao adicionar dependente:', error);
    res.status(500).json({ error: 'Erro ao adicionar dependente' });
  }
});

// GET /api/rh/dependentes/funcionario/:id - Dependentes do funcionário
app.get('/api/rh/dependentes/funcionario/:id', authMiddleware, async (req, res) => {
  try {
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver estes dependentes
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(req.params.id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seus próprios dependentes.' });
    }
    
    const [dependentes] = await pool.query(`
      SELECT 
        d.*,
        TIMESTAMPDIFF(YEAR, d.data_nascimento, CURDATE()) AS idade
      FROM rh_dependentes d
      WHERE d.funcionario_id = ? AND d.ativo = TRUE
      ORDER BY d.grau_parentesco, d.nome
    `, [req.params.id]);
    
    res.json(dependentes);
  } catch (error) {
    logger.error('Erro ao buscar dependentes:', error);
    res.status(500).json({ error: 'Erro ao buscar dependentes' });
  }
});

// PUT /api/rh/dependentes/:id - Atualizar dependente (ADMIN ONLY)
app.put('/api/rh/dependentes/:id', authMiddleware, async (req, res) => {
  // Verificação de permissão de administrador
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem atualizar dependentes.' });
  }
  
  const updates = req.body;
  const allowedFields = ['nome', 'cpf', 'data_nascimento', 'grau_parentesco', 'tem_plano_saude', 'tem_vale_transporte', 'tem_vale_refeicao', 'irrf_dependente', 'observacoes'];
  
  const fields = Object.keys(updates).filter(k => allowedFields.includes(k));
  
  if (fields.length === 0) {
    return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
  }
  
  try {
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(req.params.id);
    
    await pool.query(`UPDATE rh_dependentes SET ${setClause} WHERE id = ?`, values);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao atualizar dependente:', error);
    res.status(500).json({ error: 'Erro ao atualizar dependente' });
  }
});

// DELETE /api/rh/dependentes/:id - Excluir dependente (ADMIN ONLY)
app.delete('/api/rh/dependentes/:id', authMiddleware, async (req, res) => {
  // Verificação de permissão de administrador
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem excluir dependentes.' });
  }
  
  const { motivo } = req.body;
  
  try {
    await pool.query(
      'UPDATE rh_dependentes SET ativo = FALSE, data_exclusao = CURDATE(), motivo_exclusao = ? WHERE id = ?',
      [motivo || 'Não informado', req.params.id]
    );
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao excluir dependente:', error);
    res.status(500).json({ error: 'Erro ao excluir dependente' });
  }
});

// ============ PENSÃO ALIMENTÍCIA ============

// Criar tabela se não existir
const ensurePensaoAlimenticia = `CREATE TABLE IF NOT EXISTS rh_pensao_alimenticia (
  id INT AUTO_INCREMENT PRIMARY KEY,
  funcionario_id INT NOT NULL,
  valor DECIMAL(10,2) DEFAULT 0,
  nome_recebedor VARCHAR(255),
  cpf_recebedor VARCHAR(14),
  banco_recebedor VARCHAR(100),
  agencia_recebedor VARCHAR(20),
  conta_recebedor VARCHAR(30),
  observacoes TEXT,
  ativo TINYINT(1) DEFAULT 1,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE,
  INDEX idx_func_pensao (funcionario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

db.query(ensurePensaoAlimenticia, (e) => {
  if (e) logger.error('Erro ao criar tabela rh_pensao_alimenticia:', e);
  else logger.info('Tabela rh_pensao_alimenticia pronta.');
});

// GET - Listar pensões de um funcionário
app.get('/api/rh/funcionarios/:id/pensao', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM rh_pensao_alimenticia WHERE funcionario_id = ? ORDER BY criado_em DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    logger.error('Erro ao listar pensões:', error);
    res.status(500).json({ error: 'Erro ao listar pensões' });
  }
});

// POST - Criar pensão
app.post('/api/rh/funcionarios/:id/pensao', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  const { valor, nome_recebedor, cpf_recebedor, banco_recebedor, agencia_recebedor, conta_recebedor, observacoes } = req.body;
  try {
    const [result] = await pool.query(
      `INSERT INTO rh_pensao_alimenticia (funcionario_id, valor, nome_recebedor, cpf_recebedor, banco_recebedor, agencia_recebedor, conta_recebedor, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, valor || 0, nome_recebedor || null, cpf_recebedor || null, banco_recebedor || null, agencia_recebedor || null, conta_recebedor || null, observacoes || null]
    );
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    logger.error('Erro ao criar pensão:', error);
    res.status(500).json({ error: 'Erro ao criar pensão' });
  }
});

// PUT - Atualizar pensão
app.put('/api/rh/funcionarios/:id/pensao/:pensaoId', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  const { valor, nome_recebedor, cpf_recebedor, banco_recebedor, agencia_recebedor, conta_recebedor, observacoes } = req.body;
  try {
    await pool.query(
      `UPDATE rh_pensao_alimenticia SET valor=?, nome_recebedor=?, cpf_recebedor=?, banco_recebedor=?, agencia_recebedor=?, conta_recebedor=?, observacoes=?
       WHERE id=? AND funcionario_id=?`,
      [valor || 0, nome_recebedor || null, cpf_recebedor || null, banco_recebedor || null, agencia_recebedor || null, conta_recebedor || null, observacoes || null, req.params.pensaoId, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao atualizar pensão:', error);
    res.status(500).json({ error: 'Erro ao atualizar pensão' });
  }
});

// DELETE - Remover pensão
app.delete('/api/rh/funcionarios/:id/pensao/:pensaoId', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  try {
    await pool.query('DELETE FROM rh_pensao_alimenticia WHERE id=? AND funcionario_id=?', [req.params.pensaoId, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao remover pensão:', error);
    res.status(500).json({ error: 'Erro ao remover pensão' });
  }
});

// ============ SALÁRIO FAMÍLIA ============

// Criar tabela se não existir
const ensureSalarioFamilia = `CREATE TABLE IF NOT EXISTS rh_salario_familia (
  id INT AUTO_INCREMENT PRIMARY KEY,
  funcionario_id INT NOT NULL UNIQUE,
  recebe TINYINT(1) DEFAULT 0,
  quantidade_dependentes INT DEFAULT 0,
  observacoes TEXT,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE,
  INDEX idx_func_sf (funcionario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const ensureSfDependentes = `CREATE TABLE IF NOT EXISTS rh_sf_dependentes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  funcionario_id INT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  parentesco VARCHAR(50),
  data_nascimento DATE,
  cpf VARCHAR(14),
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE,
  INDEX idx_func_sf_dep (funcionario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

db.query(ensureSalarioFamilia, (e) => {
  if (e) logger.error('Erro ao criar tabela rh_salario_familia:', e);
  else logger.info('Tabela rh_salario_familia pronta.');
});

db.query(ensureSfDependentes, (e) => {
  if (e) logger.error('Erro ao criar tabela rh_sf_dependentes:', e);
  else logger.info('Tabela rh_sf_dependentes pronta.');
});

// GET - Dados de salário família do funcionário
app.get('/api/rh/funcionarios/:id/salario-familia', authMiddleware, async (req, res) => {
  try {
    const [sfRows] = await pool.query('SELECT * FROM rh_salario_familia WHERE funcionario_id = ?', [req.params.id]);
    const [depRows] = await pool.query('SELECT * FROM rh_sf_dependentes WHERE funcionario_id = ? ORDER BY criado_em DESC', [req.params.id]);
    const sf = sfRows[0] || { recebe: 0, observacoes: '' };
    res.json({ recebe: sf.recebe, observacoes: sf.observacoes || '', dependentes: depRows });
  } catch (error) {
    logger.error('Erro ao carregar salário família:', error);
    res.status(500).json({ error: 'Erro ao carregar salário família' });
  }
});

// PUT - Atualizar dados de salário família
app.put('/api/rh/funcionarios/:id/salario-familia', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  const { recebe, quantidade_dependentes, observacoes } = req.body;
  try {
    await pool.query(
      `INSERT INTO rh_salario_familia (funcionario_id, recebe, quantidade_dependentes, observacoes)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE recebe=VALUES(recebe), quantidade_dependentes=VALUES(quantidade_dependentes), observacoes=VALUES(observacoes)`,
      [req.params.id, recebe ? 1 : 0, quantidade_dependentes || 0, observacoes || null]
    );
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao salvar salário família:', error);
    res.status(500).json({ error: 'Erro ao salvar salário família' });
  }
});

// POST - Adicionar dependente SF
app.post('/api/rh/funcionarios/:id/salario-familia/dependente', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  const { nome, parentesco, data_nascimento, cpf } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const [result] = await pool.query(
      'INSERT INTO rh_sf_dependentes (funcionario_id, nome, parentesco, data_nascimento, cpf) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, nome, parentesco || null, data_nascimento || null, cpf || null]
    );
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    logger.error('Erro ao adicionar dependente SF:', error);
    res.status(500).json({ error: 'Erro ao adicionar dependente' });
  }
});

// DELETE - Remover dependente SF
app.delete('/api/rh/funcionarios/:id/salario-familia/dependente/:depId', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: 'Acesso negado' });
  try {
    await pool.query('DELETE FROM rh_sf_dependentes WHERE id=? AND funcionario_id=?', [req.params.depId, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao remover dependente SF:', error);
    res.status(500).json({ error: 'Erro ao remover dependente' });
  }
});

// GET /api/rh/beneficios/relatório/custos - Relatório de custos
app.get('/api/rh/beneficios/relatório/custos', authMiddleware, async (req, res) => {
  const { mes, ano } = req.query;
  
  try {
    let query = `
      SELECT 
        bt.nome AS beneficio,
        COUNT(DISTINCT fb.funcionario_id) AS total_funcionarios,
        SUM(fb.valor_mensal) AS custo_total,
        SUM(fb.valor_empresa) AS custo_empresa,
        SUM(fb.valor_funcionario) AS desconto_funcionarios,
        AVG(fb.valor_mensal) AS custo_medio
      FROM rh_funcionarios_beneficios fb
      INNER JOIN rh_beneficios_tipos bt ON fb.beneficio_tipo_id = bt.id
      WHERE fb.ativo = TRUE
    `;
    
    const params = [];
    
    if (mes && ano) {
      query += ` AND (fb.data_inicio <= LAST_DAY(CONCAT(?, '-', ?, '-01')) 
                  AND (fb.data_fim IS NULL OR fb.data_fim >= CONCAT(?, '-', ?, '-01')))`;
      params.push(ano, mes, ano, mes);
    }
    
    query += ' GROUP BY bt.id, bt.nome ORDER BY custo_empresa DESC';
    
    const [relatório] = await pool.query(query, params);
    
    res.json(relatório);
  } catch (error) {
    logger.error('Erro ao gerar relatório:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// GET /api/rh/beneficios/convenios - Listar convênios
app.get('/api/rh/beneficios/convenios', authMiddleware, async (req, res) => {
  try {
    const [convenios] = await pool.query(`
      SELECT c.*, bt.nome AS beneficio_nome
      FROM rh_beneficios_convenios c
      INNER JOIN rh_beneficios_tipos bt ON c.beneficio_tipo_id = bt.id
      WHERE c.ativo = TRUE
      ORDER BY bt.nome, c.nome_fornecedor
    `);
    
    res.json(convenios);
  } catch (error) {
    logger.error('Erro ao listar convênios:', error);
    res.status(500).json({ error: 'Erro ao listar convênios' });
  }
});

// POST /api/rh/beneficios/convenios - Adicionar convênio
app.post('/api/rh/beneficios/convenios', authMiddleware, async (req, res) => {
  const { beneficio_tipo_id, nome_fornecedor, cnpj, contato, telefone, email, valor_contratado, data_inicio_contrato } = req.body;
  
  if (!beneficio_tipo_id || !nome_fornecedor) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }
  
  try {
    const [result] = await pool.query(`
      INSERT INTO rh_beneficios_convenios (
        beneficio_tipo_id, nome_fornecedor, cnpj, contato, telefone, email, valor_contratado, data_inicio_contrato
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [beneficio_tipo_id, nome_fornecedor, cnpj, contato, telefone, email, valor_contratado, data_inicio_contrato]);
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    logger.error('Erro ao adicionar convênio:', error);
    res.status(500).json({ error: 'Erro ao adicionar convênio' });
  }
});

// GET /api/rh/vale-transporte/:funcionario_id - Detalhes VT do funcionário
app.get('/api/rh/vale-transporte/:funcionario_id', authMiddleware, async (req, res) => {
  try {
    const [vt] = await pool.query(
      'SELECT * FROM rh_vale_transporte WHERE funcionario_id = ? AND ativo = TRUE ORDER BY data_inicio DESC LIMIT 1',
      [req.params.funcionario_id]
    );
    
    res.json(vt.length > 0 ? vt[0] : null);
  } catch (error) {
    logger.error('Erro ao buscar VT:', error);
    res.status(500).json({ error: 'Erro ao buscar vale transporte' });
  }
});

// POST /api/rh/vale-transporte - Cadastrar vale transporte
app.post('/api/rh/vale-transporte', authMiddleware, async (req, res) => {
  const { funcionario_id, tipo_transporte, linha_ida, linha_volta, valor_unitario, quantidade_dia, dias_uteis, data_inicio } = req.body;
  
  if (!funcionario_id || !valor_unitario || !data_inicio) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }
  
  try {
    const valorMensal = valor_unitario * (quantidade_dia || 2) * (dias_uteis || 22);
    
    const [result] = await pool.query(`
      INSERT INTO rh_vale_transporte (
        funcionario_id, tipo_transporte, linha_ida, linha_volta, valor_unitario,
        quantidade_dia, dias_uteis, valor_mensal, data_inicio
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [funcionario_id, tipo_transporte, linha_ida, linha_volta, valor_unitario, quantidade_dia || 2, dias_uteis || 22, valorMensal, data_inicio]);
    
    res.json({ success: true, id: result.insertId, valor_mensal: valorMensal });
  } catch (error) {
    logger.error('Erro ao cadastrar VT:', error);
    res.status(500).json({ error: 'Erro ao cadastrar vale transporte' });
  }
});

// ==================== FASE 6: AVALIAÇÉO DE DESEMPENHO ====================

// 1. Listar períodos de avaliação
app.get('/api/rh/avaliacoes/periodos', authMiddleware, async (req, res) => {
  try {
    const [períodos] = await pool.query(`
      SELECT * FROM rh_periodos_avaliacao ORDER BY data_inicio DESC
    `);
    res.json(períodos);
  } catch (error) {
    logger.error('Erro ao listar períodos:', error);
    res.status(500).json({ error: 'Erro ao listar períodos de avaliação' });
  }
});

// Alias com acento (compatibilidade)
app.get('/api/rh/avaliacoes/períodos', authMiddleware, async (req, res) => {
  try {
    const [períodos] = await pool.query(`
      SELECT * FROM rh_periodos_avaliacao ORDER BY data_inicio DESC
    `);
    res.json(períodos);
  } catch (error) {
    logger.error('Erro ao listar períodos:', error);
    res.status(500).json({ error: 'Erro ao listar períodos de avaliação' });
  }
});

// 2. Listar competências
app.get('/api/rh/avaliacoes/competencias', authMiddleware, async (req, res) => {
  try {
    const [competencias] = await pool.query(`
      SELECT * FROM rh_competencias WHERE ativo = TRUE ORDER BY categoria, nome
    `);

    // Fallback: repair encoding-corrupted names at runtime
    const encodingFixes = {
      'Conhecimento T?cnico': 'Conhecimento Técnico',
      'Comunica??o': 'Comunicação',
      'Proatividade': 'Proatividade',
      'Resolu??o de Problemas': 'Resolução de Problemas',
      'Lideran?a': 'Liderança',
      'Lideran??a': 'Liderança',
      'Vis?o Estrat?gica': 'Visão Estratégica',
      'Vis??o Estrat??gica': 'Visão Estratégica',
      'Gest?o de Pessoas': 'Gestão de Pessoas',
      'Gest??o de Pessoas': 'Gestão de Pessoas',
      'Planejamento e Organiza??o': 'Planejamento e Organização',
      'Planejamento e Organiza????o': 'Planejamento e Organização',
      'Precis?o': 'Precisão',
      'Colabora??o': 'Colaboração',
      'solu??es': 'soluções',
      'mudan?as': 'mudanças',
      'An?lise': 'Análise',
      'decis?o': 'decisão',
    };

    const repaired = competencias.map(c => {
      let nome = c.nome || '';
      let descricao = c.descricao || '';
      // Fix known corrupted names
      if (encodingFixes[nome]) {
        nome = encodingFixes[nome];
      }
      // Fix any remaining ? patterns in both nome and descricao
      for (const [bad, good] of Object.entries(encodingFixes)) {
        if (descricao.includes(bad)) {
          descricao = descricao.split(bad).join(good);
        }
      }
      return { ...c, nome, descricao };
    });

    res.json(repaired);
  } catch (error) {
    logger.error('Erro ao listar competências:', error);
    res.status(500).json({ error: 'Erro ao listar competências' });
  }
});

// 3. Criar/atualizar avaliação de desempenho
app.post('/api/rh/avaliacoes/criar', authMiddleware, async (req, res) => {
  const { 
    funcionario_id, avaliador_id, tipo_avaliacao, 
    pontos_fortes, pontos_melhoria, comentarios_avaliador, competencias 
  } = req.body;
  const periodo_id = req.body.periodo_id ?? req.body['período_id'];

  // Apenas gestores e administradores podem avaliar terceiros.
  // Autoavaliação é permitida quando avaliador e avaliado são o mesmo usuário.
  const userFuncId = Number(req.user.funcionario_id || req.user.id)
  const funcionarioId = Number(funcionario_id)
  const avaliadorId = Number(avaliador_id)
  const ehAutoavaliacao = funcionarioId === userFuncId && avaliadorId === userFuncId

  if (!ehAutoavaliacao && !isGestorOuAdminUser(req.user)) {
    return res.status(403).json({ message: 'Acesso negado. Apenas gestores/administradores podem criar avaliações de colaboradores.' })
  }

  if (!isAdminUser(req.user) && avaliadorId !== userFuncId) {
    return res.status(403).json({ message: 'Acesso negado. O avaliador deve ser o usuário autenticado.' })
  }
  
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    // Criar avaliação
    const [result] = await conn.query(`
      INSERT INTO rh_avaliacoes_desempenho 
      (funcionario_id, periodo_id, avaliador_id, tipo_avaliacao, data_avaliacao, status,
       pontos_fortes, pontos_melhoria, comentarios_avaliador) 
      VALUES (?, ?, ?, ?, CURDATE(), 'RASCUNHO', ?, ?, ?)
    `, [funcionario_id, periodo_id, avaliador_id, tipo_avaliacao, pontos_fortes, pontos_melhoria, comentarios_avaliador]);
    
    const avaliacaoId = result.insertId;
    
    // Inserir competências avaliadas
    if (competencias && competencias.length > 0) {
      for (const comp of competencias) {
        await conn.query(`
          INSERT INTO rh_avaliacao_itens (avaliacao_id, competencia_id, nota, peso, comentario)
          VALUES (?, ?, ?, ?, ?)
        `, [avaliacaoId, comp.competencia_id, comp.nota, comp.peso || 1.0, comp.comentario || null]);
      }
    }
    
    await conn.commit();
    res.json({ success: true, id: avaliacaoId });
  } catch (error) {
    await conn.rollback();
    logger.error('Erro ao criar avaliação:', error);
    res.status(500).json({ error: 'Erro ao criar avaliação' });
  } finally {
    conn.release();
  }
});

// 4. Buscar avaliações do funcionário
app.get('/api/rh/avaliacoes/funcionario/:id', authMiddleware, async (req, res) => {
  try {
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver estas avaliações
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(req.params.id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar suas próprias avaliações.' });
    }
    
    const [avaliacoes] = await pool.query(`
      SELECT a.*, p.nome AS periodo_nome, 
             av.nome_completo AS avaliador_nome
      FROM rh_avaliacoes_desempenho a
      INNER JOIN rh_periodos_avaliacao p ON a.periodo_id = p.id
      LEFT JOIN funcionarios av ON a.avaliador_id = av.id
      WHERE a.funcionario_id = ?
      ORDER BY a.data_avaliacao DESC
    `, [req.params.id]);
    
    res.json(avaliacoes);
  } catch (error) {
    logger.error('Erro ao buscar avaliações:', error);
    res.status(500).json({ error: 'Erro ao buscar avaliações' });
  }
});

// 5. Detalhes da avaliação com itens
app.get('/api/rh/avaliacoes/:id', authMiddleware, async (req, res) => {
  try {
    const [avaliacoes] = await pool.query(`
      SELECT a.*, f.nome_completo AS funcionario_nome, f.cargo,
             av.nome_completo AS avaliador_nome, p.nome AS periodo_nome
      FROM rh_avaliacoes_desempenho a
      INNER JOIN funcionarios f ON a.funcionario_id = f.id
      LEFT JOIN funcionarios av ON a.avaliador_id = av.id
      INNER JOIN rh_periodos_avaliacao p ON a.periodo_id = p.id
      WHERE a.id = ?
    `, [req.params.id]);
    
    if (avaliacoes.length === 0) {
      return res.status(404).json({ error: 'Avaliação não encontrada' });
    }

    const userFuncId = Number(req.user.funcionario_id || req.user.id)
    const avaliacao = avaliacoes[0]
    const podeVisualizar = isAdminUser(req.user) ||
      Number(avaliacao.funcionario_id) === userFuncId ||
      Number(avaliacao.avaliador_id) === userFuncId

    if (!podeVisualizar) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar avaliações relacionadas ao seu usuário.' })
    }
    
    const [itens] = await pool.query(`
      SELECT ai.*, c.nome AS competencia_nome, c.categoria
      FROM rh_avaliacao_itens ai
      INNER JOIN rh_competencias c ON ai.competencia_id = c.id
      WHERE ai.avaliacao_id = ?
      ORDER BY c.categoria, c.nome
    `, [req.params.id]);
    
    res.json({ avaliacao: avaliacoes[0], itens });
  } catch (error) {
    logger.error('Erro ao buscar detalhes da avaliação:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes' });
  }
});

// 6. Finalizar/aprovar avaliação
app.put('/api/rh/avaliacoes/:id/finalizar', authMiddleware, async (req, res) => {
  const { comentarios_avaliado } = req.body;
  try {
    const [rows] = await pool.query(
      'SELECT id, funcionario_id, avaliador_id FROM rh_avaliacoes_desempenho WHERE id = ?',
      [req.params.id]
    )

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Avaliação não encontrada' })
    }

    const userFuncId = Number(req.user.funcionario_id || req.user.id)
    const registro = rows[0]
    const podeFinalizar = isAdminUser(req.user) ||
      Number(registro.funcionario_id) === userFuncId ||
      Number(registro.avaliador_id) === userFuncId

    if (!podeFinalizar) {
      return res.status(403).json({ message: 'Acesso negado. Você não pode finalizar esta avaliação.' })
    }

    await pool.query(`
      UPDATE rh_avaliacoes_desempenho 
      SET status = 'CONCLUIDA', comentarios_avaliado = ?
      WHERE id = ?
    `, [comentarios_avaliado, req.params.id]);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao finalizar avaliação:', error);
    res.status(500).json({ error: 'Erro ao finalizar avaliação' });
  }
});

// 7. Criar meta
app.post('/api/rh/metas/criar', authMiddleware, async (req, res) => {
  const { 
    funcionario_id, titulo, categoria, tipo, 
    valor_meta, unidade_medida, data_inicio, data_fim, responsavel_id 
  } = req.body;
  const periodo_id = req.body.periodo_id ?? req.body['período_id'];
  const descricao = req.body.descricao ?? req.body['descrição'];
  
  try {
    const [result] = await pool.query(`
      INSERT INTO rh_metas 
      (funcionario_id, periodo_id, titulo, descricao, categoria, tipo, valor_meta, 
       unidade_medida, data_inicio, data_fim, status, responsavel_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANEJADA', ?)
    `, [funcionario_id, periodo_id, titulo, descricao, categoria, tipo, valor_meta, unidade_medida, data_inicio, data_fim, responsavel_id]);
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    logger.error('Erro ao criar meta:', error);
    res.status(500).json({ error: 'Erro ao criar meta' });
  }
});

// 8. Atualizar progresso da meta
app.put('/api/rh/metas/:id/progresso', authMiddleware, async (req, res) => {
  const { valor_realizado, observacoes } = req.body;
  try {
    await pool.query(`
      UPDATE rh_metas 
      SET valor_realizado = ?, observacoes = ?, status = 'EM_ANDAMENTO'
      WHERE id = ?
    `, [valor_realizado, observacoes, req.params.id]);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao atualizar meta:', error);
    res.status(500).json({ error: 'Erro ao atualizar meta' });
  }
});

// 9. Listar metas do funcionário
app.get('/api/rh/metas/funcionario/:id', authMiddleware, async (req, res) => {
  try {
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver estas metas
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(req.params.id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar suas próprias metas.' });
    }
    
    const [metas] = await pool.query(`
      SELECT m.*, p.nome AS periodo_nome,
             r.nome_completo AS responsavel_nome
      FROM rh_metas m
      LEFT JOIN rh_periodos_avaliacao p ON m.periodo_id = p.id
      LEFT JOIN funcionarios r ON m.responsavel_id = r.id
      WHERE m.funcionario_id = ?
      ORDER BY m.data_fim DESC
    `, [req.params.id]);
    
    res.json(metas);
  } catch (error) {
    logger.error('Erro ao listar metas:', error);
    res.status(500).json({ error: 'Erro ao listar metas' });
  }
});

// 10. Adicionar feedback 360°
app.post('/api/rh/feedback360/adicionar', authMiddleware, async (req, res) => {
  const { 
    avaliacao_id, avaliado_id, avaliador_id, tipo_relacao, 
    comunicacao, trabalho_equipe, lideranca, resolucao_problemas, 
    proatividade, qualidade_trabalho, pontualidade, comentarios, anonimo 
  } = req.body;
  
  try {
    const [result] = await pool.query(`
      INSERT INTO rh_feedback_360 
      (avaliacao_id, avaliado_id, avaliador_id, tipo_relacao, comunicacao, trabalho_equipe,
       lideranca, resolucao_problemas, proatividade, qualidade_trabalho, pontualidade,
       comentarios, anonimo, data_feedback)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())
    `, [avaliacao_id, avaliado_id, avaliador_id, tipo_relacao, comunicacao, trabalho_equipe, lideranca, resolucao_problemas, proatividade, qualidade_trabalho, pontualidade, comentarios, anonimo]);
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    logger.error('Erro ao adicionar feedback 360:', error);
    res.status(500).json({ error: 'Erro ao adicionar feedback' });
  }
});

// 11. Buscar feedbacks 360° do funcionário
app.get('/api/rh/feedback360/funcionario/:id', authMiddleware, async (req, res) => {
  try {
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver estes feedbacks
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(req.params.id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seus próprios feedbacks.' });
    }
    
    const [feedbacks] = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.anonimo = TRUE THEN 'Anônimo' ELSE av.nome_completo END AS avaliador_nome
      FROM rh_feedback_360 f
      LEFT JOIN funcionarios av ON f.avaliador_id = av.id
      WHERE f.avaliado_id = ?
      ORDER BY f.data_feedback DESC
    `, [req.params.id]);
    
    // Calcular médias
    const [medias] = await pool.query(`
      SELECT 
        ROUND(AVG(comunicacao), 2) AS media_comunicacao,
        ROUND(AVG(trabalho_equipe), 2) AS media_trabalho_equipe,
        ROUND(AVG(lideranca), 2) AS media_lideranca,
        ROUND(AVG(resolucao_problemas), 2) AS media_resolucao_problemas,
        ROUND(AVG(proatividade), 2) AS media_proatividade,
        ROUND(AVG(qualidade_trabalho), 2) AS media_qualidade,
        ROUND(AVG(pontualidade), 2) AS media_pontualidade
      FROM rh_feedback_360
      WHERE avaliado_id = ?
    `, [req.params.id]);
    
    res.json({ feedbacks, medias: medias[0] });
  } catch (error) {
    logger.error('Erro ao buscar feedbacks 360:', error);
    res.status(500).json({ error: 'Erro ao buscar feedbacks' });
  }
});

// 12. Criar ação PDI
app.post('/api/rh/pdi/criar', authMiddleware, async (req, res) => {
  const { 
    funcionario_id, competencia_desenvolver, acao_desenvolvimento,
    tipo_acao, prioridade, prazo_conclusao, custo_estimado, responsavel_acompanhamento 
  } = req.body;
  const periodo_id = req.body.periodo_id ?? req.body['período_id'];
  
  try {
    const [result] = await pool.query(`
      INSERT INTO rh_pdi 
      (funcionario_id, periodo_id, competencia_desenvolver, acao_desenvolvimento, tipo_acao,
       prioridade, prazo_conclusao, custo_estimado, status, responsavel_acompanhamento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PLANEJADO', ?)
    `, [funcionario_id, periodo_id, competencia_desenvolver, acao_desenvolvimento, tipo_acao, prioridade, prazo_conclusao, custo_estimado, responsavel_acompanhamento]);
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    logger.error('Erro ao criar PDI:', error);
    res.status(500).json({ error: 'Erro ao criar PDI' });
  }
});

// 13. Atualizar progresso PDI
app.put('/api/rh/pdi/:id/progresso', authMiddleware, async (req, res) => {
  const { percentual_conclusao, resultado_obtido, status } = req.body;
  try {
    const dataField = status === 'CONCLUIDO' ? ', data_conclusao = CURDATE()' : '';
    
    await pool.query(`
      UPDATE rh_pdi 
      SET percentual_conclusao = ?, resultado_obtido = ?, status = ? ${dataField}
      WHERE id = ?
    `, [percentual_conclusao, resultado_obtido, status, req.params.id]);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Erro ao atualizar PDI:', error);
    res.status(500).json({ error: 'Erro ao atualizar PDI' });
  }
});

// 14. Listar PDI do funcionário
app.get('/api/rh/pdi/funcionario/:id', authMiddleware, async (req, res) => {
  try {
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver estes PDIs
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(req.params.id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seus próprios PDIs.' });
    }
    
    const [pdis] = await pool.query(`
      SELECT p.*, r.nome_completo AS responsavel_nome
      FROM rh_pdi p
      LEFT JOIN funcionarios r ON p.responsavel_acompanhamento = r.id
      WHERE p.funcionario_id = ?
      ORDER BY p.prioridade DESC, p.prazo_conclusao
    `, [req.params.id]);
    
    res.json(pdis);
  } catch (error) {
    logger.error('Erro ao listar PDI:', error);
    res.status(500).json({ error: 'Erro ao listar PDI' });
  }
});

// 15. Dashboard de avaliações
app.get('/api/rh/avaliacoes/dashboard', authMiddleware, async (req, res) => {
  try {
    if (!isGestorOuAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Dashboard de avaliações disponível apenas para gestores/administradores.' })
    }

    const [stats] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM rh_avaliacoes_desempenho WHERE status = 'CONCLUIDA') AS avaliacoes_concluidas,
        (SELECT COUNT(DISTINCT funcionario_id) FROM rh_avaliacoes_desempenho) AS funcionarios_avaliados,
        (SELECT ROUND(AVG(nota_final), 2) FROM rh_avaliacoes_desempenho WHERE nota_final IS NOT NULL) AS nota_media,
        (SELECT COUNT(*) FROM rh_metas WHERE status = 'ATINGIDA') AS metas_atingidas,
        (SELECT COUNT(*) FROM rh_metas) AS total_metas,
        (SELECT ROUND(AVG(percentual_atingido), 2) FROM rh_metas WHERE percentual_atingido IS NOT NULL) AS percentual_medio_metas,
        (SELECT COUNT(*) FROM rh_pdi WHERE status = 'CONCLUIDO') AS pdis_concluidos,
        (SELECT SUM(custo_estimado) FROM rh_pdi) AS investimento_total_pdi
    `);
    
    const [classificacoes] = await pool.query(`
      SELECT classificacao, COUNT(*) AS total
      FROM rh_avaliacoes_desempenho
      WHERE classificacao IS NOT NULL
      GROUP BY classificacao
    `);
    
    res.json({ resumo: stats[0], classificacoes });
  } catch (error) {
    logger.error('Erro ao gerar dashboard:', error);
    res.status(500).json({ error: 'Erro ao gerar dashboard' });
  }
});

// 16. Registrar promoção
app.post('/api/rh/promocoes/registrar', authMiddleware, async (req, res) => {
  const { 
    funcionario_id, avaliacao_id, cargo_anterior, cargo_novo, 
    salario_anterior, salario_novo, tipo_movimentacao, motivo, data_efetivacao 
  } = req.body;
  
  try {
    const [result] = await pool.query(`
      INSERT INTO rh_historico_promocoes 
      (funcionario_id, avaliacao_id, cargo_anterior, cargo_novo, salario_anterior,
       salario_novo, tipo_movimentacao, motivo, data_efetivacao, aprovado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [funcionario_id, avaliacao_id, cargo_anterior, cargo_novo, salario_anterior, salario_novo, tipo_movimentacao, motivo, data_efetivacao, req.user?.id || 1]);
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    logger.error('Erro ao registrar promoção:', error);
    res.status(500).json({ error: 'Erro ao registrar promoção' });
  }
});

// 17. Histórico de promoções
app.get('/api/rh/promocoes/funcionario/:id', authMiddleware, async (req, res) => {
  try {
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver este histórico
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(req.params.id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seu próprio histórico de promoções.' });
    }
    
    const [promocoes] = await pool.query(`
      SELECT p.*, a.nome_completo AS aprovado_por_nome
      FROM rh_historico_promocoes p
      LEFT JOIN funcionarios a ON p.aprovado_por = a.id
      WHERE p.funcionario_id = ?
      ORDER BY p.data_efetivacao DESC
    `, [req.params.id]);
    
    res.json(promocoes);
  } catch (error) {
    logger.error('Erro ao buscar promoções:', error);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// ==================== FIM NOVAS APIS RH ====================

// ==================== GESTÍO DE TREINAMENTOS ====================

// Garantir que as tabelas de treinamentos existam
const ensureTreinamentos = `CREATE TABLE IF NOT EXISTS rh_treinamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    descricao TEXT,
    tipo ENUM('presencial', 'online', 'hibrido') DEFAULT 'presencial',
    categoria VARCHAR(100),
    carga_horaria INT DEFAULT 0,
    instrutor VARCHAR(255),
    local_treinamento VARCHAR(255),
    data_inicio DATE,
    data_fim DATE,
    horario_inicio TIME,
    horario_fim TIME,
    vagas_totais INT DEFAULT 0,
    vagas_disponiveis INT DEFAULT 0,
    status ENUM('agendado', 'em_andamento', 'concluido', 'cancelado') DEFAULT 'agendado',
    certificado_template VARCHAR(255),
    obrigatorio BOOLEAN DEFAULT false,
    departamentos_alvo TEXT,
    criado_por INT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_data (data_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const ensureInscricoes = `CREATE TABLE IF NOT EXISTS rh_inscricoes_treinamento (
    id INT AUTO_INCREMENT PRIMARY KEY,
    treinamento_id INT NOT NULL,
    funcionario_id INT NOT NULL,
    status ENUM('inscrito', 'confirmado', 'concluido', 'cancelado', 'nao_compareceu') DEFAULT 'inscrito',
    nota_avaliacao DECIMAL(4,2),
    presenca BOOLEAN DEFAULT false,
    certificado_emitido BOOLEAN DEFAULT false,
    certificado_url VARCHAR(255),
    feedback TEXT,
    data_inscricao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_conclusao TIMESTAMP NULL,
    FOREIGN KEY (treinamento_id) REFERENCES rh_treinamentos(id) ON DELETE CASCADE,
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE,
    UNIQUE KEY unico_inscricao (treinamento_id, funcionario_id),
    INDEX idx_funcionario (funcionario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const ensureHistórico = `CREATE TABLE IF NOT EXISTS rh_historico_treinamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    funcionario_id INT NOT NULL,
    treinamento_id INT,
    nome_treinamento VARCHAR(255) NOT NULL,
    instituicao VARCHAR(255),
    carga_horaria INT DEFAULT 0,
    data_conclusao DATE,
    certificado_url VARCHAR(255),
    observacoes TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE,
    INDEX idx_funcionario (funcionario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

db.query(ensureTreinamentos, (e) => {
  if (e) logger.error('Erro ao criar tabela rh_treinamentos:', e);
  else logger.info('Tabela rh_treinamentos pronta.');
});

db.query(ensureInscricoes, (e) => {
  if (e) logger.error('Erro ao criar tabela rh_inscricoes_treinamento:', e);
  else logger.info('Tabela rh_inscricoes_treinamento pronta.');
});

db.query(ensureHistorico, (e) => {
  if (e) logger.error('Erro ao criar tabela rh_historico_treinamentos:', e);
  else logger.info('Tabela rh_historico_treinamentos pronta.');
});

// Listar treinamentos
app.get('/api/rh/treinamentos', authMiddleware, async (req, res) => {
  try {
    const { status, tipo, categoria, periodo } = req.query;
    let sql = `
      SELECT t.*, 
        (SELECT COUNT(*) FROM rh_inscricoes_treinamento WHERE treinamento_id = t.id AND status != 'cancelado') as inscritos,
        u.nome_completo as criador_nome
      FROM rh_treinamentos t
      LEFT JOIN funcionarios u ON t.criado_por = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (status && status !== 'todos') {
      sql += ' AND t.status = ?';
      params.push(status);
    }
    if (tipo) {
      sql += ' AND t.tipo = ?';
      params.push(tipo);
    }
    if (categoria) {
      sql += ' AND t.categoria = ?';
      params.push(categoria);
    }
    if (periodo) {
      const hoje = new Date().toISOString().split('T')[0];
      if (periodo === 'proximos') {
        sql += ' AND t.data_inicio >= ?';
        params.push(hoje);
      } else if (periodo === 'passados') {
        sql += ' AND t.data_fim < ?';
        params.push(hoje);
      }
    }
    
    sql += ' ORDER BY t.data_inicio DESC';
    
    const treinamentos = await dbQuery(sql, params);
    res.json(treinamentos);
  } catch (error) {
    logger.error('Erro ao listar treinamentos:', error);
    res.status(500).json({ error: 'Erro ao listar treinamentos' });
  }
});

// Obter treinamento por ID
app.get('/api/rh/treinamentos/:id', authMiddleware, async (req, res) => {
  try {
    const [treinamento] = await dbQuery(`
      SELECT t.*, u.nome_completo as criador_nome
      FROM rh_treinamentos t
      LEFT JOIN funcionarios u ON t.criado_por = u.id
      WHERE t.id = ?
    `, [req.params.id]);
    
    if (!treinamento) {
      return res.status(404).json({ error: 'Treinamento não encontrado' });
    }
    
    // Buscar inscritos
    const inscritos = await dbQuery(`
      SELECT i.*, f.nome_completo, f.cargo, f.departamento, f.foto_url
      FROM rh_inscricoes_treinamento i
      JOIN funcionarios f ON i.funcionario_id = f.id
      WHERE i.treinamento_id = ?
      ORDER BY i.data_inscricao ASC
    `, [req.params.id]);
    
    res.json({ ...treinamento, inscritos });
  } catch (error) {
    logger.error('Erro ao buscar treinamento:', error);
    res.status(500).json({ error: 'Erro ao buscar treinamento' });
  }
});

// Criar treinamento
app.post('/api/rh/treinamentos', authMiddleware, async (req, res) => {
  try {
    const {
      titulo, descricao, tipo, categoria, carga_horaria, instrutor,
      local_treinamento, data_inicio, data_fim, horario_inicio, horario_fim,
      vagas_totais, obrigatorio, departamentos_alvo
    } = req.body;
    
    if (!titulo || !data_inicio) {
      return res.status(400).json({ error: 'Título e data de início são obrigatórios' });
    }
    
    const result = await dbQuery(`
      INSERT INTO rh_treinamentos (
        titulo, descricao, tipo, categoria, carga_horaria, instrutor,
        local_treinamento, data_inicio, data_fim, horario_inicio, horario_fim,
        vagas_totais, vagas_disponiveis, obrigatorio, departamentos_alvo, criado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      titulo, descricao, tipo || 'presencial', categoria, carga_horaria || 0, instrutor,
      local_treinamento, data_inicio, data_fim || data_inicio, horario_inicio, horario_fim,
      vagas_totais || 0, vagas_totais || 0, obrigatorio || false,
      JSON.stringify(departamentos_alvo || []), req.user?.id
    ]);
    
    res.status(201).json({ success: true, id: result.insertId, message: 'Treinamento criado com sucesso' });
  } catch (error) {
    logger.error('Erro ao criar treinamento:', error);
    res.status(500).json({ error: 'Erro ao criar treinamento' });
  }
});

// Atualizar treinamento (ADMIN ONLY)
app.put('/api/rh/treinamentos/:id', authMiddleware, async (req, res) => {
  try {
    // Verificação de permissão de administrador
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem atualizar treinamentos.' });
    }
    
    const {
      titulo, descricao, tipo, categoria, carga_horaria, instrutor,
      local_treinamento, data_inicio, data_fim, horario_inicio, horario_fim,
      vagas_totais, status, obrigatorio, departamentos_alvo
    } = req.body;
    
    // Calcular vagas disponíveis
    const [inscricoesCount] = await dbQuery(`
      SELECT COUNT(*) as total FROM rh_inscricoes_treinamento 
      WHERE treinamento_id = ? AND status != 'cancelado'
    `, [req.params.id]);
    
    const vagasDisponiveis = (vagas_totais || 0) - (inscricoesCount?.total || 0);
    
    await dbQuery(`
      UPDATE rh_treinamentos SET
        titulo = ?, descricao = ?, tipo = ?, categoria = ?, carga_horaria = ?,
        instrutor = ?, local_treinamento = ?, data_inicio = ?, data_fim = ?,
        horario_inicio = ?, horario_fim = ?, vagas_totais = ?, vagas_disponiveis = ?,
        status = ?, obrigatorio = ?, departamentos_alvo = ?
      WHERE id = ?
    `, [
      titulo, descricao, tipo, categoria, carga_horaria,
      instrutor, local_treinamento, data_inicio, data_fim,
      horario_inicio, horario_fim, vagas_totais, Math.max(0, vagasDisponiveis),
      status, obrigatorio, JSON.stringify(departamentos_alvo || []), req.params.id
    ]);
    
    res.json({ success: true, message: 'Treinamento atualizado' });
  } catch (error) {
    logger.error('Erro ao atualizar treinamento:', error);
    res.status(500).json({ error: 'Erro ao atualizar treinamento' });
  }
});

// Excluir treinamento (ADMIN ONLY)
app.delete('/api/rh/treinamentos/:id', authMiddleware, async (req, res) => {
  try {
    // Verificação de permissão de administrador
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem excluir treinamentos.' });
    }
    
    await dbQuery('DELETE FROM rh_treinamentos WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Treinamento excluído' });
  } catch (error) {
    logger.error('Erro ao excluir treinamento:', error);
    res.status(500).json({ error: 'Erro ao excluir treinamento' });
  }
});

// Inscrever funcionário em treinamento
app.post('/api/rh/treinamentos/:id/inscrever', authMiddleware, async (req, res) => {
  try {
    const { funcionario_id } = req.body;
    const treinamentoId = req.params.id;
    
    // Verificar vagas
    const [treinamento] = await dbQuery('SELECT vagas_disponiveis FROM rh_treinamentos WHERE id = ?', [treinamentoId]);
    
    if (!treinamento) {
      return res.status(404).json({ error: 'Treinamento não encontrado' });
    }
    
    if (treinamento.vagas_disponiveis <= 0) {
      return res.status(400).json({ error: 'Não há vagas disponíveis' });
    }
    
    // Verificar se já está inscrito
    const [existente] = await dbQuery(
      'SELECT id FROM rh_inscricoes_treinamento WHERE treinamento_id = ? AND funcionario_id = ?',
      [treinamentoId, funcionario_id]
    );
    
    if (existente) {
      return res.status(400).json({ error: 'Funcionário já está inscrito' });
    }
    
    // Inscrever
    await dbQuery(
      'INSERT INTO rh_inscricoes_treinamento (treinamento_id, funcionario_id) VALUES (?, ?)',
      [treinamentoId, funcionario_id]
    );
    
    // Atualizar vagas
    await dbQuery('UPDATE rh_treinamentos SET vagas_disponiveis = vagas_disponiveis - 1 WHERE id = ?', [treinamentoId]);
    
    res.status(201).json({ success: true, message: 'Inscrição realizada com sucesso' });
  } catch (error) {
    logger.error('Erro ao inscrever:', error);
    res.status(500).json({ error: 'Erro ao inscrever' });
  }
});

// Cancelar inscrição (ADMIN ONLY)
app.delete('/api/rh/treinamentos/:id/inscricao/:funcionarioId', authMiddleware, async (req, res) => {
  try {
    // Verificação de permissão de administrador
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem cancelar inscrições.' });
    }
    
    await dbQuery(
      'DELETE FROM rh_inscricoes_treinamento WHERE treinamento_id = ? AND funcionario_id = ?',
      [req.params.id, req.params.funcionarioId]
    );
    
    await dbQuery('UPDATE rh_treinamentos SET vagas_disponiveis = vagas_disponiveis + 1 WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, message: 'Inscrição cancelada' });
  } catch (error) {
    logger.error('Erro ao cancelar inscrição:', error);
    res.status(500).json({ error: 'Erro ao cancelar inscrição' });
  }
});

// Registrar presença/conclusão
app.put('/api/rh/treinamentos/:id/inscricao/:funcionarioId', authMiddleware, async (req, res) => {
  try {
    const { presenca, nota_avaliacao, status, feedback, certificado_emitido, certificado_url } = req.body;
    
    let sql = 'UPDATE rh_inscricoes_treinamento SET ';
    const updates = [];
    const params = [];
    
    if (presenca !== undefined) { updates.push('presenca = ?'); params.push(presenca); }
    if (nota_avaliacao !== undefined) { updates.push('nota_avaliacao = ?'); params.push(nota_avaliacao); }
    if (status) { 
      updates.push('status = ?'); 
      params.push(status);
      if (status === 'concluido') {
        updates.push('data_conclusao = NOW()');
      }
    }
    if (feedback !== undefined) { updates.push('feedback = ?'); params.push(feedback); }
    if (certificado_emitido !== undefined) { updates.push('certificado_emitido = ?'); params.push(certificado_emitido); }
    if (certificado_url !== undefined) { updates.push('certificado_url = ?'); params.push(certificado_url); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
    }
    
    sql += updates.join(', ') + ' WHERE treinamento_id = ? AND funcionario_id = ?';
    params.push(req.params.id, req.params.funcionarioId);
    
    await dbQuery(sql, params);
    res.json({ success: true, message: 'Registro atualizado' });
  } catch (error) {
    logger.error('Erro ao atualizar registro:', error);
    res.status(500).json({ error: 'Erro ao atualizar registro' });
  }
});

// Treinamentos do funcionário
app.get('/api/rh/funcionarios/:id/treinamentos', authMiddleware, async (req, res) => {
  try {
    // AUDITORIA ENTERPRISE: Verificar se o usuário pode ver estes treinamentos
    const userFuncId = Number(req.user.funcionario_id || req.user.id);
    if (Number(req.params.id) !== userFuncId && !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar seus próprios treinamentos.' });
    }
    
    const treinamentos = await dbQuery(`
      SELECT 
        t.id, t.titulo, t.tipo, t.categoria, t.carga_horaria, t.data_inicio, t.data_fim, t.status as status_treinamento,
        i.status, i.presenca, i.nota_avaliacao, i.certificado_emitido, i.certificado_url, i.data_conclusao
      FROM rh_inscricoes_treinamento i
      JOIN rh_treinamentos t ON i.treinamento_id = t.id
      WHERE i.funcionario_id = ?
      ORDER BY t.data_inicio DESC
    `, [req.params.id]);
    
    // Buscar histórico adicional
    const historico = await dbQuery(`
      SELECT * FROM rh_historico_treinamentos
      WHERE funcionario_id = ?
      ORDER BY data_conclusao DESC
    `, [req.params.id]);
    
    res.json({ treinamentos, historico });
  } catch (error) {
    logger.error('Erro ao buscar treinamentos do funcionário:', error);
    res.status(500).json({ error: 'Erro ao buscar treinamentos' });
  }
});

// Adicionar treinamento externo ao histórico
app.post('/api/rh/funcionarios/:id/treinamentos-historico', authMiddleware, async (req, res) => {
  try {
    const { nome_treinamento, instituicao, carga_horaria, data_conclusao, certificado_url, observacoes } = req.body;
    
    await dbQuery(`
      INSERT INTO rh_historico_treinamentos 
      (funcionario_id, nome_treinamento, instituicao, carga_horaria, data_conclusao, certificado_url, observacoes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [req.params.id, nome_treinamento, instituicao, carga_horaria || 0, data_conclusao, certificado_url, observacoes]);
    
    res.status(201).json({ success: true, message: 'Treinamento adicionado ao histórico' });
  } catch (error) {
    logger.error('Erro ao adicionar histórico:', error);
    res.status(500).json({ error: 'Erro ao adicionar histórico' });
  }
});

// Dashboard de treinamentos
app.get('/api/rh/treinamentos-dashboard', authMiddleware, async (req, res) => {
  try {
    const [stats] = await dbQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'agendado' THEN 1 ELSE 0 END) as agendados,
        SUM(CASE WHEN status = 'em_andamento' THEN 1 ELSE 0 END) as em_andamento,
        SUM(CASE WHEN status = 'concluido' THEN 1 ELSE 0 END) as concluidos,
        SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) as cancelados
      FROM rh_treinamentos
    `);
    
    const [inscricoes] = await dbQuery(`
      SELECT 
        COUNT(*) as total_inscricoes,
        SUM(CASE WHEN status = 'concluido' THEN 1 ELSE 0 END) as concluidos,
        AVG(nota_avaliacao) as media_notas
      FROM rh_inscricoes_treinamento
    `);
    
    const proximos = await dbQuery(`
      SELECT t.*, 
        (SELECT COUNT(*) FROM rh_inscricoes_treinamento WHERE treinamento_id = t.id AND status != 'cancelado') as inscritos
      FROM rh_treinamentos t
      WHERE t.data_inicio >= CURDATE() AND t.status = 'agendado'
      ORDER BY t.data_inicio ASC
      LIMIT 5
    `);
    
    const porCategoria = await dbQuery(`
      SELECT categoria, COUNT(*) as total
      FROM rh_treinamentos
      WHERE categoria IS NOT NULL
      GROUP BY categoria
      ORDER BY total DESC
    `);
    
    res.json({
      stats: stats || {},
      inscricoes: inscricoes || {},
      proximos,
      porCategoria
    });
  } catch (error) {
    logger.error('Erro ao buscar dashboard:', error);
    res.status(500).json({ error: 'Erro ao buscar dashboard' });
  }
});

// Categorias de treinamento
app.get('/api/rh/treinamentos-categorias', authMiddleware, async (req, res) => {
  try {
    const categorias = await dbQuery(`
      SELECT DISTINCT categoria FROM rh_treinamentos 
      WHERE categoria IS NOT NULL AND categoria != ''
      ORDER BY categoria
    `);
    res.json(categorias.map(c => c.categoria));
  } catch (error) {
    logger.error('Erro ao buscar categorias:', error);
    res.status(500).json({ error: 'Erro ao buscar categorias' });
  }
});

// ==================== FIM GESTÍO DE TREINAMENTOS ====================


// Error handler (Multer and general)
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err && err.message ? err.message : err)
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message })
  }
  if (err && err.message && err.message.includes('Apenas imagens')) {
    return res.status(400).json({ message: err.message })
  }
  res.status(500).json({ message: 'Erro interno no servidor.' })
})

// --- INICIALIZAÇÁO DO SERVIDOR ---
// Prefer binding to 0.0.0.0 so the server is reachable from other hosts/containers during tests.
// Also add a listen error handler to log bind issues (useful on Windows if address is unavailable).
const LISTEN_ADDR = process.env.LISTEN_ADDR || '0.0.0.0'
// Função para tentar iniciar o servidor em uma porta específica
function tryStartServer(port, retryCount = 0) {
  const maxRetries = 5 // Tentar até 5 portas diferentes
  const alternativePorts = [3000, 3001, 3002, 3003, 3004, 3005] // Portas alternativas
  
  const server = app.listen(port, LISTEN_ADDR, () => {
    // Sucesso: servidor iniciado
    const addr = server.address && server.address()
    const boundHost = addr && addr.address ? addr.address : LISTEN_ADDR
    const boundPort = addr && addr.port ? addr.port : port
    
    // Log de sucesso com destaque se não for a porta 3000
    if (boundPort !== 3000) {
      logger.info(`🔄 Porta 3000 ocupada. Servidor iniciado na porta alternativa ${boundPort}!`)
      console.log(`🔄 Porta 3000 ocupada. Servidor iniciado na porta alternativa ${boundPort}!`)
    }
    
    logger.info(`Servidor a correr! Aceda à aplicação em http://${boundHost === '0.0.0.0' ? '127.0.0.1' : boundHost}:${boundPort}`)
    try {
      logger.info('Server.address: ' + JSON.stringify(addr))
      console.log('Server listening:', JSON.stringify(addr))
    } catch (e) {
      // ignore logging errors
    }
  })

  // Handler de erro com auto-retry para portas ocupadas
  server.on('error', (err) => {
    // Verificar se é erro de porta ocupada
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️  Porta ${port} está ocupada.`)
      
      // Se ainda há tentativas restantes
      if (retryCount < maxRetries - 1) {
        const nextPort = alternativePorts[retryCount + 1]
        console.log(`🔄 Tentando porta alternativa ${nextPort}...`)
        
        // Fechar o servidor atual antes de tentar a próxima porta
        server.close(() => {
          tryStartServer(nextPort, retryCount + 1)
        })
      } else {
        // Esgotou todas as tentativas
        logger.error('❌ Todas as portas alternativas estão ocupadas. Não foi possível iniciar o servidor.')
        console.error('❌ Erro: Todas as portas alternativas estão ocupadas.')
        console.error('💡 Portas tentadas:', alternativePorts.slice(0, retryCount + 1).join(', '))
        console.error('💡 Tente parar outros serviços ou usar uma porta diferente via variável de ambiente PORT.')
        process.exit(1)
      }
    } else {
      // Outros tipos de erro - usar o handler original
      handleServerError(err)
    }
  })

  return server
}

// Handler original de erros do servidor (extraído para reutilização)
function handleServerError(err) {
  try {
    if (err && err.stack) {
      logger.error('Erro ao ligar o servidor HTTP: ' + err.stack)
      console.error(err.stack)
    } else if (err && err.message) {
      logger.error('Erro ao ligar o servidor HTTP: ' + err.message)
      console.error(err.message)
    } else {
      logger.error('Erro ao ligar o servidor HTTP: (unknown) ' + String(err))
      console.error(err)
    }
  } catch (logErr) {
    try { console.error('Erro ao registar erro de listen:', logErr) } catch (_) {}
  }
  // if permission denied, exit to allow process manager to restart
  if (err && err.code === 'EACCES') process.exit(1)
}

// Iniciar o servidor começando pela porta preferida (PORT ou 3000)
const server = tryStartServer(PORT)

// Handler de erro removido - agora está integrado na função tryStartServer

// Graceful shutdown helpers: ensure server and DB are closed on signals or fatal errors
async function gracefulShutdown (reason) {
  try { logger.info('Iniciando shutdown gracioso: ' + (reason || 'signal')) } catch (e) {}
  try {
    if (server && typeof server.close === 'function') {
      // stop accepting new connections
      server.close((closeErr) => {
        try { if (closeErr) logger.warn('Erro ao fechar servidor HTTP:', closeErr) } catch (_) {}
        // attempt to end DB connection if available
        try {
          if (db && typeof db.end === 'function') {
            db.end((dbErr) => {
              try { if (dbErr) logger.warn('Erro ao fechar ligação DB:', dbErr) } catch (_) {}
              process.exit(closeErr || dbErr ? 1 : 0)
            })
          } else {
            process.exit(closeErr ? 1 : 0)
          }
        } catch (e) {
          try { logger.warn('Erro ao encerrar DB durante shutdown:', e) } catch (_) {}
          process.exit(1)
        }
      })
      // fallback: force exit after timeout to avoid hanging indefinitely
      setTimeout(() => {
        try { logger.warn('Forçando exit após timeout de shutdown') } catch (_) {}
        process.exit(1)
      }, 8000).unref && setTimeout(() => {}, 0)
    } else {
      // no server reference available, just try to end DB
      try {
        if (db && typeof db.end === 'function') db.end(() => process.exit(0))
        else process.exit(0)
      } catch (e) { process.exit(1) }
    }
  } catch (e) {
    try { logger.error('Erro durante gracefulShutdown:', e) } catch (_) {}
    process.exit(1)
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('uncaughtException', (err) => {
  try { logger.error('uncaughtException - iniciando shutdown:', err && err.stack ? err.stack : err) } catch (_) {}
  // give a moment to log then shutdown
  setTimeout(() => gracefulShutdown('uncaughtException'), 50)
})
process.on('unhandledRejection', (reason) => {
  try { logger.warn('unhandledRejection - iniciando shutdown:', reason && reason.stack ? reason.stack : reason) } catch (_) {}
  setTimeout(() => gracefulShutdown('unhandledRejection'), 50)
})
