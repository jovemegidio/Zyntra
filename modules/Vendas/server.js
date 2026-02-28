// server.js - VERSÃO FINAL, ESTÁVEL E COM NOVAS FUNCIONALIDADES
// Load environment variables from .env when present
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server: IOServer } = require('socket.io');
const fs = require('fs');
const os = require('os');
const cookieParser = require('cookie-parser');

// LGPD - Descriptografia de campos PII (CNPJ, CPF, IE)
let lgpdCrypto;
try { lgpdCrypto = require('../../lgpd-crypto'); } catch(e) { lgpdCrypto = { decryptPII: (v) => v }; }

// Importar security middleware
const {
    generalLimiter,
    authLimiter,
    apiLimiter,
    sanitizeInput,
    securityHeaders,
    cleanExpiredSessions
} = require('../../security-middleware');
// optional redis (used if REDIS_URL provided)
let Redis = null;
let redisClient = null;
try { Redis = require('ioredis'); } catch (e) { Redis = null; }

const app = express();
// Configuração de portas com fallback
const PORTS_TO_TRY = [3000, 3001, 3002];
let port = process.env.PORT ? Number(process.env.PORT) : PORTS_TO_TRY[0];

// Middleware para cookies
app.use(cookieParser());

// Aplicar security middleware
app.use(securityHeaders());
app.use(generalLimiter);
app.use(sanitizeInput);

// Serve static frontend assets (must be before API routes and catch-all)
app.use(express.static(path.join(__dirname, 'public'), { 
    extensions: ['html', 'htm'],
    setHeaders: (res, path) => {
        // Previne cache para arquivos HTML
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Parse JSON and URL-encoded bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- CONFIGURAÇÕES SEGURAS ---
// JWT_SECRET DEVE vir obrigatoriamente de variável de ambiente
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ ERRO FATAL: JWT_SECRET não definido no .env');
    console.error('Configure a variável de ambiente JWT_SECRET antes de iniciar o servidor');
    process.exit(1);
}
if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
    console.error('❌ ERRO FATAL: JWT_SECRET deve ter pelo menos 32 caracteres em produção');
    process.exit(1);
}

// Configuração do banco de dados - credenciais devem vir de variáveis de ambiente
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'aluforce_vendas',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONN_LIMIT || 10),
    queueLimit: 0
};

// Validar credenciais do banco em produção
if (process.env.NODE_ENV === 'production') {
    if (!DB_CONFIG.user || !DB_CONFIG.password) {
        console.error('❌ ERRO FATAL: DB_USER e DB_PASSWORD são obrigatórios em produção');
        process.exit(1);
    }
}

// Create DB pool (will attempt connection on start)
let pool = null;
let dbAvailable = false;
try {
    pool = mysql.createPool(DB_CONFIG);
} catch (e) {
    console.warn('mysql.createPool failed', e && e.message ? e.message : e);
    pool = null;
}

// Try a quick verification of DB connectivity and set dbAvailable
(async function verifyDb() {
    if (!pool) return;
    try {
        await pool.query('SELECT 1');
        dbAvailable = true;
        console.log('DB connection OK');
        // create audit table if missing early
        await ensureAuditTable().catch(() => {});
    } catch (err) {
        dbAvailable = false;
        console.warn('⚠️ AVISO: Não foi possível conectar ao banco de dados.', err && err.message ? err.message : err);
    }
})();

// try connect to Redis if REDIS_URL provided
const REDIS_URL = process.env.REDIS_URL || null;
if (Redis && REDIS_URL) {
    try {
        redisClient = new Redis(REDIS_URL);
        redisClient.on('error', (err) => console.warn('Redis error:', err && err.message ? err.message : err));
    } catch (e) { redisClient = null; }
}

// --- Simple in-memory cache (TTL) - lightweight fallback when Redis not configured ---
const cacheStore = new Map(); // key -> { ts, ttl, value }
function setCache(key, value, ttlMs = 30 * 1000) {
    try {
        if (redisClient) {
            const payload = JSON.stringify({ v: value });
            const secs = Math.max(1, Math.round(ttlMs / 1000));
            redisClient.set(key, payload, 'EX', secs).catch(() => {});
            return;
        }
        const entry = { ts: Date.now(), ttl: ttlMs, value };
        cacheStore.set(key, entry);
        // schedule removal
        setTimeout(() => { const e = cacheStore.get(key); if (e && e.ts === entry.ts) cacheStore.delete(key); }, ttlMs + 50);
    } catch (e) {}
}
function getCache(key) {
    try {
        if (redisClient) return null; // use async path when Redis in use
        const e = cacheStore.get(key);
        if (!e) return null;
        if (Date.now() - e.ts > e.ttl) { cacheStore.delete(key); return null; }
        return e.value;
    } catch (e) { return null; }
}

async function getCacheAsync(key) {
    try {
        if (redisClient) {
            const raw = await redisClient.get(key);
            if (!raw) return null;
            try { const p = JSON.parse(raw); return p && p.v !== undefined ? p.v : p; } catch (e) { return JSON.parse(raw); }
        }
        return getCache(key);
    } catch (e) { return null; }
}
async function delCacheAsync(key) {
    try {
        if (redisClient) return await redisClient.del(key);
        cacheStore.delete(key);
        return 1;
    } catch (e) { return 0; }
}

// --- Audit helper (simple DB-backed audit_logs) ---
async function ensureAuditTable() {
    if (!dbAvailable) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NULL,
                action VARCHAR(100) NOT NULL,
                resource_type VARCHAR(100) NULL,
                resource_id VARCHAR(100) NULL,
                meta JSON NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    } catch (e) { console.warn('ensureAuditTable failed', e && e.message ? e.message : e); }
}

async function logAudit(userId, action, resourceType = null, resourceId = null, meta = null) {
    try {
        if (!dbAvailable) return;
        await ensureAuditTable();
        await pool.query('INSERT INTO audit_logs (user_id, action, resource_type, resource_id, meta) VALUES (?, ?, ?, ?, ?)', [userId || null, action, resourceType || null, resourceId === undefined || resourceId === null ? null : String(resourceId), meta ? JSON.stringify(meta) : null]);
    } catch (e) { console.warn('logAudit error', e && e.message ? e.message : e); }
}

// --- Background job: compute and cache dashboard aggregates periodically ---
async function computeAndCacheAggregates() {
    try {
        if (!dbAvailable) return;
        const months = 12;
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
        const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;

        const [rows] = await pool.query(
            `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COALESCE(SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS total
             FROM pedidos
             WHERE created_at >= ?
             GROUP BY ym
             ORDER BY ym ASC`,
            [startStr]
        );

        // write/upsert into dashboard_aggregates to make aggregates durable
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS dashboard_aggregates (
                  ym VARCHAR(7) NOT NULL PRIMARY KEY,
                  total DECIMAL(18,2) NOT NULL DEFAULT 0,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);
        } catch (e) { /* non-fatal */ }

        const map = new Map();
        for (const r of rows) map.set(r.ym, Number(r.total || 0));
        const labels = [];
        const values = [];
        for (let i = 0; i < months; i++) {
            const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
            const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            labels.push(d.toLocaleString('pt-BR', { month: 'short', year: 'numeric' }));
            const v = map.has(ym) ? map.get(ym) : 0;
            values.push(v);
            try { await pool.query('INSERT INTO dashboard_aggregates (ym, total) VALUES (?, ?) ON DUPLICATE KEY UPDATE total = VALUES(total), created_at = CURRENT_TIMESTAMP', [ym, v]); } catch (e) { /* ignore per-row upsert errors */ }
        }

        setCache('dashboard:monthly', { labels, values }, 60 * 60 * 1000);

        // top vendedores last 30 days
        const periodDays = 30;
        const startTop = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (periodDays - 1));
        const startTopStr = `${startTop.getFullYear()}-${String(startTop.getMonth() + 1).padStart(2, '0')}-${String(startTop.getDate()).padStart(2, '0')}`;
        const [topRows] = await pool.query(
            `SELECT u.id, u.nome, COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END), 0) AS valor
             FROM pedidos p
             JOIN usuarios u ON p.vendedor_id = u.id
             WHERE p.created_at >= ?
             GROUP BY u.id, u.nome
             ORDER BY valor DESC
             LIMIT 10`,
            [startTopStr]
        );
        setCache('dashboard:top_vendedores', topRows.map(r => ({ id: r.id, nome: r.nome, valor: Number(r.valor || 0) })), 60 * 60 * 1000);
    } catch (e) {
        console.warn('computeAndCacheAggregates failed', e && e.message ? e.message : e);
    }
}

// --- Middleware de autorização Admin ---
const authorizeAdmin = (req, res, next) => {
    if (req.user?.role === 'admin') {
        return next();
    }
    return res.status(403).json({ message: 'Acesso negado. Requer privilégios de administrador.' });
};

// --- Funções de sanitização para prevenir XSS e SQL injection ---
function sanitizeString(str) {
    if (!str) return '';
    // Remove caracteres potencialmente perigosos
    return String(str)
        .replace(/[<>]/g, '') // Remove < e >
        .replace(/javascript:/gi, '') // Remove javascript:
        .replace(/on\w+=/gi, '') // Remove handlers inline
        .trim()
        .slice(0, 5000); // Limita tamanho
}

function sanitizeNumber(value, defaultValue = 0) {
    const num = parseFloat(value);
    return isNaN(num) ? defaultValue : num;
}

function sanitizeInt(value, defaultValue = 0) {
    const num = parseInt(value, 10);
    return isNaN(num) ? defaultValue : num;
}

function sanitizeEmail(email) {
    if (!email) return '';
    const cleaned = String(email).trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(cleaned) ? cleaned : '';
}

function sanitizeCNPJ(cnpj) {
    if (!cnpj) return '';
    return String(cnpj).replace(/\D/g, '').slice(0, 14);
}

function sanitizeBoolean(value) {
    return value === true || value === 'true' || value === '1' || value === 1;
}

// Admin: invalidate cache keys (single key or prefix)
app.post('/api/admin/cache/invalidate', authorizeAdmin, express.json(), async (req, res) => {
    try {
        const { key, prefix } = req.body || {};
        if (!key && !prefix) return res.status(400).json({ message: 'key or prefix required' });
        if (key) {
            await delCacheAsync(key);
            return res.json({ invalidated: [key] });
        }
        const invalidated = [];
        if (redisClient) {
            const stream = redisClient.scanStream({ match: `${prefix}*`, count: 100 });
            for await (const chunk of stream) {
                if (!chunk || chunk.length === 0) continue;
                for (const k of chunk) { await redisClient.del(k); invalidated.push(k); }
            }
        } else {
            for (const k of Array.from(cacheStore.keys())) {
                if (k.startsWith(prefix)) { cacheStore.delete(k); invalidated.push(k); }
            }
        }
        return res.json({ invalidated });
    } catch (e) { return res.status(500).json({ error: 'server_error' }); }
});

// Admin: read audit logs (paged)
app.get('/api/admin/audit-logs', authorizeAdmin, async (req, res) => {
    try {
        if (!dbAvailable) return res.status(503).json({ error: 'db_unavailable' });
        const page = Math.max(1, Number(req.query.page || 1));
        const per = Math.min(200, Math.max(10, Number(req.query.per || 50)));
        const offset = (page - 1) * per;
        await ensureAuditTable();
        const [rows] = await pool.query('SELECT id, user_id, action, resource_type, resource_id, meta, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?', [per, offset]);
        res.json(rows.map(r => ({ id: r.id, user_id: r.user_id, action: r.action, resource_type: r.resource_type, resource_id: r.resource_id, meta: r.meta ? JSON.parse(r.meta) : null, created_at: r.created_at })));
    } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

// Admin: trigger recomputation of dashboard aggregates (enqueue job in BullMQ when Redis available)
app.post('/api/admin/compute-aggregates', authorizeAdmin, express.json(), async (req, res) => {
    try {
        // If Redis + bullmq available, enqueue job for worker(s)
        const canQueue = !!(process.env.REDIS_URL || REDIS_URL);
        if (canQueue) {
            let QueueClass = null;
            try { QueueClass = require('bullmq').Queue; } catch (e) { QueueClass = null; }
            if (QueueClass) {
                const connection = { connectionString: process.env.REDIS_URL || REDIS_URL };
                const q = new QueueClass('aggregates', { connection });
                await q.add('compute', { requestedBy: req.user && req.user.id ? req.user.id : null }, { removeOnComplete: true, removeOnFail: 100 });
                return res.status(202).json({ enqueued: true });
            }
        }

        // Fallback: run immediately (synchronous)
        if (!dbAvailable) return res.status(503).json({ error: 'db_unavailable' });
        await computeAndCacheAggregates();
        return res.json({ ok: true });
    } catch (e) {
        console.error('compute-aggregates error', e && e.message ? e.message : e);
        return res.status(500).json({ error: 'server_error' });
    }
});

// --- ROTA DE LOGIN ---
app.post('/api/login', authLimiter, async (req, res, next) => {
    try {
        // aceita { email, password } ou { username, password }
        const emailOrUsername = (req.body.email || req.body.username || '').toString().trim();
        const password = (req.body.password || '').toString();

        if (!emailOrUsername || !password) {
            return res.status(400).json({ message: 'Email/username e senha são obrigatórios.' });
        }

        const [rows] = await pool.query('SELECT * FROM usuarios WHERE email = ? OR login = ? LIMIT 1', [emailOrUsername, emailOrUsername]);
        if (rows.length === 0) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        const user = rows[0];
        // suporta colunas antigas (senha) e nova (senha_hash)
        const senhaHash = user.senha_hash || user.senha || '';
        if (!senhaHash) {
            return res.status(500).json({ message: 'Conta sem hash de senha configurado.' });
        }

        const isPasswordCorrect = await bcrypt.compare(password, senhaHash);
        if (!isPasswordCorrect) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        const userDataForToken = { id: user.id, nome: user.nome, email: user.email, role: user.role, is_admin: user.is_admin };
        // AUDIT-FIX ARCH-004: Added algorithm HS256 + audience claim
        const token = jwt.sign(userDataForToken, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '8h' });

        // retorna chaves simples e compatíveis com frontend
        return res.json({ token, user: userDataForToken });
    } catch (error) {
        next(error);
    }
});

// --- ROTAS DA API DE VENDAS (PROTEGIDAS) ---
const apiVendasRouter = express.Router();
// middleware de autenticação JWT
function authenticateToken(req, res, next) {
    try {
        // SEGURANÇA: Aceitar token APENAS do header Authorization ou cookie
        // NÃO aceitar token em query string (vulnerabilidade - tokens ficam em logs/histórico)
        const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
        let token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.split(' ')[1] : null;
        
        // Se não encontrou no header, tentar pegar do cookie
        if (!token && req.cookies) {
            token = req.cookies.authToken || req.cookies.token;
        }
        
        if (!token) {
            console.log(`🔒 Token ausente - Rota: ${req.method} ${req.path}`);
            return res.status(401).json({ message: 'Token ausente.' });
        }
        let decoded = null;
        try { 
            // AUDIT-FIX ARCH-004: Enforce HS256 algorithm (audience enforced in sign, verify-side after token rotation)
            decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); 
        } catch (err) { 
            console.log(`🔒 Token inválido - Rota: ${req.method} ${req.path} - Erro: ${err.message}`);
            return res.status(401).json({ message: 'Token inválido.' }); 
        }
        req.user = decoded;
        // SEGURANÇA: Não logar dados do usuário em produção
        if (process.env.NODE_ENV !== 'production') {
            console.log(`✅ Token validado - Usuário: ${decoded.nome || decoded.email} - Rota: ${req.method} ${req.path}`);
        }
        return next();
    } catch (e) { 
        console.log(`❌ Erro no middleware auth - Rota: ${req.method} ${req.path} - Erro: ${e.message}`);
        return res.status(500).json({ message: 'Erro no servidor.' }); 
    }
}

// ========================================
// ROTAS PÚBLICAS (ANTES DO MIDDLEWARE DE AUTH)
// ========================================

// Lista de emails de admins - APENAS COMO FALLBACK
// IMPORTANTE: A verificação primária DEVE ser pelo campo is_admin ou role do banco
const ADMINS_EMAILS = ['ti@aluforce.ind.br', 'andreia@aluforce.ind.br', 'douglas@aluforce.ind.br'];

/**
 * Verifica se o usuário é administrador
 * SEGURANÇA: Usa apenas campos do banco de dados, nunca comparação por nome
 * @param {Object} user - Objeto do usuário
 * @returns {boolean}
 */
function verificarSeAdmin(user) {
    if (!user) return false;
    
    // 1. Verificar flag is_admin do banco (forma preferida)
    if (user.is_admin === true || user.is_admin === 1) return true;
    
    // 2. Verificar role do banco
    if (user.role && user.role.toString().toLowerCase() === 'admin') return true;
    
    // 3. Fallback: verificar email (apenas emails conhecidos)
    if (user.email && ADMINS_EMAILS.includes(user.email.toLowerCase())) return true;
    
    // NÃO verificar por nome - vulnerabilidade de segurança
    return false;
}

// Rota para Kanban - COM FILTROS e controle de visibilidade por usuário
// SECURITY: Agora requer autenticação obrigatória
apiVendasRouter.get('/kanban/pedidos', authenticateToken, async (req, res) => {
    try {
        if (!dbAvailable) {
            return res.json([]);
        }
        
        // Usar usuário do token (obrigatório após authenticateToken)
        const currentUser = req.user;
        let isAdmin = verificarSeAdmin(currentUser);
        
        // Se não temos o objeto completo, buscar do banco
        if (!currentUser.role && currentUser.id) {
            try {
                const [userRows] = await pool.query('SELECT id, nome, email, role, is_admin FROM usuarios WHERE id = ?', [currentUser.id]);
                if (userRows.length > 0) {
                    Object.assign(currentUser, userRows[0]);
                    isAdmin = verificarSeAdmin(currentUser);
                }
            } catch (e) { 
                console.log('⚠️ Erro ao buscar dados do usuário:', e.message);
            }
        }
        
        console.log(`👤 Kanban: Usuário ${currentUser.nome || currentUser.email} | Admin: ${isAdmin}`);
        
        // Capturar parâmetros de filtro
        const { 
            dataInclusao, 
            dataPrevisao, 
            dataFaturamento,
            vendedor,
            projeto,
            exibirCancelados,
            exibirDenegados,
            exibirEncerrados
        } = req.query;
        
        // Construir condições WHERE dinâmicas
        let whereConditions = [];
        let queryParams = [];
        
        // FILTRO POR USUÁRIO: Vendedores só veem seus próprios pedidos
        if (currentUser && !isAdmin) {
            whereConditions.push('p.vendedor_id = ?');
            queryParams.push(currentUser.id);
            console.log(`👤 Filtrando pedidos do vendedor: ${currentUser.nome} (ID: ${currentUser.id})`);
        }
        
        // Filtro de status base (cancelados, denegados, encerrados)
        const statusExcluidos = [];
        if (exibirCancelados !== 'true') statusExcluidos.push('cancelado');
        if (exibirDenegados !== 'true') statusExcluidos.push('denegado');
        if (exibirEncerrados !== 'true') statusExcluidos.push('encerrado', 'arquivado');
        
        if (statusExcluidos.length > 0) {
            whereConditions.push(`p.status NOT IN (${statusExcluidos.map(() => '?').join(',')})`);
            queryParams.push(...statusExcluidos);
        }
        
        // Filtro de vendedor (somente se for admin, pois vendedor já está filtrado)
        if (isAdmin && vendedor && vendedor !== 'todos') {
            whereConditions.push('p.vendedor_id = ?');
            queryParams.push(vendedor);
        }
        
        // Função auxiliar para calcular datas
        const calcularData = (filtro, tipo = 'passado') => {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            
            switch (filtro) {
                case 'hoje':
                    return hoje;
                case 'ontem':
                    const ontem = new Date(hoje);
                    ontem.setDate(ontem.getDate() - 1);
                    return ontem;
                case 'amanha':
                    const amanha = new Date(hoje);
                    amanha.setDate(amanha.getDate() + 1);
                    return amanha;
                case 'ultimos-3':
                case 'proximos-3':
                    const d3 = new Date(hoje);
                    d3.setDate(d3.getDate() + (tipo === 'futuro' ? 3 : -3));
                    return d3;
                case 'ultimos-7':
                case 'proximos-7':
                    const d7 = new Date(hoje);
                    d7.setDate(d7.getDate() + (tipo === 'futuro' ? 7 : -7));
                    return d7;
                case 'ultimos-15':
                case 'proximos-15':
                    const d15 = new Date(hoje);
                    d15.setDate(d15.getDate() + (tipo === 'futuro' ? 15 : -15));
                    return d15;
                case 'ultimos-30':
                case 'proximos-30':
                    const d30 = new Date(hoje);
                    d30.setDate(d30.getDate() + (tipo === 'futuro' ? 30 : -30));
                    return d30;
                case 'ultimos-60':
                case 'proximos-60':
                    const d60 = new Date(hoje);
                    d60.setDate(d60.getDate() + (tipo === 'futuro' ? 60 : -60));
                    return d60;
                case 'ultimos-90':
                case 'proximos-90':
                    const d90 = new Date(hoje);
                    d90.setDate(d90.getDate() + (tipo === 'futuro' ? 90 : -90));
                    return d90;
                case 'ultimos-120':
                    const d120 = new Date(hoje);
                    d120.setDate(d120.getDate() - 120);
                    return d120;
                case 'ultimo-ano':
                    const dAno = new Date(hoje);
                    dAno.setFullYear(dAno.getFullYear() - 1);
                    return dAno;
                default:
                    return null;
            }
        };
        
        // Filtro de data de inclusão (created_at)
        if (dataInclusao && dataInclusao !== 'tudo') {
            const dataLimite = calcularData(dataInclusao, 'passado');
            if (dataLimite) {
                if (dataInclusao === 'hoje') {
                    whereConditions.push('DATE(p.created_at) = CURDATE()');
                } else if (dataInclusao === 'ontem') {
                    whereConditions.push('DATE(p.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)');
                } else {
                    whereConditions.push('p.created_at >= ?');
                    queryParams.push(dataLimite.toISOString().split('T')[0]);
                }
            }
        }
        
        // Filtro de data de previsão (data_previsao ou data_entrega)
        if (dataPrevisao && dataPrevisao !== 'tudo') {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            
            if (dataPrevisao.startsWith('proximos-')) {
                const dataLimite = calcularData(dataPrevisao, 'futuro');
                if (dataLimite) {
                    whereConditions.push('(p.data_previsao BETWEEN CURDATE() AND ? OR p.data_entrega BETWEEN CURDATE() AND ?)');
                    const dataStr = dataLimite.toISOString().split('T')[0];
                    queryParams.push(dataStr, dataStr);
                }
            } else if (dataPrevisao === 'amanha') {
                whereConditions.push('(DATE(p.data_previsao) = DATE_ADD(CURDATE(), INTERVAL 1 DAY) OR DATE(p.data_entrega) = DATE_ADD(CURDATE(), INTERVAL 1 DAY))');
            } else if (dataPrevisao === 'hoje') {
                whereConditions.push('(DATE(p.data_previsao) = CURDATE() OR DATE(p.data_entrega) = CURDATE())');
            } else {
                const dataLimite = calcularData(dataPrevisao, 'passado');
                if (dataLimite) {
                    whereConditions.push('(p.data_previsao >= ? OR p.data_entrega >= ?)');
                    const dataStr = dataLimite.toISOString().split('T')[0];
                    queryParams.push(dataStr, dataStr);
                }
            }
        }
        
        // Filtro de data de faturamento (para pedidos faturados)
        if (dataFaturamento && dataFaturamento !== 'tudo') {
            const dataLimite = calcularData(dataFaturamento, 'passado');
            if (dataLimite) {
                whereConditions.push('(p.data_faturamento >= ? OR (p.status IN ("faturado", "recibo") AND p.updated_at >= ?))');
                const dataStr = dataLimite.toISOString().split('T')[0];
                queryParams.push(dataStr, dataStr);
            }
        }
        
        // Montar query final
        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
        
        const query = `
            SELECT 
                p.id, 
                p.valor, 
                p.status, 
                p.created_at, 
                p.updated_at,
                p.vendedor_id,
                p.cliente_id,
                p.empresa_id,
                p.descricao,
                p.prioridade,
                p.frete,
                p.data_previsao,
                p.data_entrega,
                p.data_faturamento,
                p.tipo_faturamento,
                p.percentual_faturado,
                p.valor_faturado,
                p.numero_nf,
                p.total_ipi,
                p.total_icms_st,
                p.total_icms,
                COALESCE(c.nome, e.nome_fantasia) AS empresa_nome,
                u.nome AS vendedor_nome,
                -- Dados completos do cliente para recibo/impressão
                COALESCE(c.cnpj, c.cnpj_cpf, c.cpf, e.cnpj) AS cliente_cnpj,
                COALESCE(c.inscricao_estadual, e.inscricao_estadual) AS cliente_ie,
                COALESCE(c.endereco, e.endereco) AS cliente_endereco,
                COALESCE(c.bairro, e.bairro) AS cliente_bairro,
                COALESCE(c.cidade, e.cidade) AS cliente_cidade,
                COALESCE(c.estado, e.estado) AS cliente_uf,
                COALESCE(c.cep, e.cep) AS cliente_cep,
                COALESCE(c.telefone, e.telefone) AS cliente_telefone,
                COALESCE(c.email, e.email) AS cliente_email
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN empresas e ON p.empresa_id = e.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            ${whereClause}
            ORDER BY p.created_at DESC
            LIMIT 500
        `;
        
        console.log('📋 Kanban Query:', query);
        console.log('📋 Kanban Params:', queryParams);
        
        const [rows] = await pool.query(query, queryParams);
        
        // Buscar itens de todos os pedidos de uma vez (mais eficiente)
        const pedidoIds = rows.map(p => p.id);
        let itensMap = {};
        
        if (pedidoIds.length > 0) {
            const [itensRows] = await pool.query(`
                SELECT 
                    pi.pedido_id,
                    pi.codigo,
                    pi.descricao,
                    pi.quantidade,
                    pi.preco_unitario,
                    pi.subtotal,
                    p.unidade_medida
                FROM pedido_itens pi
                LEFT JOIN produtos p ON pi.produto_id = p.id
                WHERE pi.pedido_id IN (${pedidoIds.map(() => '?').join(',')})
                ORDER BY pi.pedido_id, pi.id
            `, pedidoIds);
            
            // Agrupar itens por pedido
            itensRows.forEach(item => {
                if (!itensMap[item.pedido_id]) {
                    itensMap[item.pedido_id] = [];
                }
                itensMap[item.pedido_id].push({
                    codigo: item.codigo,
                    descricao: item.descricao,
                    quantidade: parseFloat(item.quantidade) || 0,
                    preco_unitario: parseFloat(item.preco_unitario) || 0,
                    subtotal: parseFloat(item.subtotal) || 0,
                    unidade: item.unidade_medida || 'UN'
                });
            });
        }
        
        // Formatar para o Kanban
        const pedidosFormatados = rows.map(p => {
            const itens = itensMap[p.id] || [];
            // Priorizar p.valor (que já inclui IPI + ICMS ST + frete)
            // Só usar soma dos itens como fallback se p.valor não existir
            const valorPedido = parseFloat(p.valor) || 0;
            let valorFinal = valorPedido;
            if (valorFinal === 0 && itens.length > 0) {
                // Fallback: calcular dos itens + impostos
                const subtotalItens = itens.reduce((sum, item) => {
                    const subtotal = parseFloat(item.subtotal) || 
                        ((parseFloat(item.quantidade) || 0) * (parseFloat(item.preco_unitario) || 0));
                    return sum + subtotal;
                }, 0);
                const totalIPI = parseFloat(p.total_ipi) || 0;
                const totalICMSST = parseFloat(p.total_icms_st) || 0;
                const frete = parseFloat(p.frete) || 0;
                valorFinal = subtotalItens + totalIPI + totalICMSST + frete;
            }
            
            // Log de debug para valores
            if (valorFinal === 0 && (p.valor || itens.length > 0)) {
                console.log(`⚠️ Pedido ${p.id}: valor original=${p.valor}, itens=${itens.length}, valorFinal=${valorFinal}`);
            }
            
            // Gerar número baseado no status
            const statusLabel = {
                'orcamento': 'Orçamento',
                'analise-credito': 'Análise',
                'pedido-aprovado': 'Pedido',
                'faturar': 'Pedido',
                'faturado': 'Faturado',
                'recibo': 'Finalizado'
            };
            const labelNumero = statusLabel[p.status] || 'Pedido';
            
            return {
                id: p.id,
                numero: `${labelNumero} Nº ${p.id}`,
                cliente: p.empresa_nome || 'Cliente não informado',
                cliente_nome: p.empresa_nome,
                cliente_id: p.cliente_id,
                empresa_id: p.empresa_id,
                // Dados completos do cliente para recibo/impressão
                cliente_cnpj: p.cliente_cnpj || null,
                cliente_ie: p.cliente_ie || null,
                cliente_endereco: p.cliente_endereco || null,
                cliente_bairro: p.cliente_bairro || null,
                cliente_cidade: p.cliente_cidade || null,
                cliente_uf: p.cliente_uf || null,
                cliente_cep: p.cliente_cep || null,
                cliente_telefone: p.cliente_telefone || null,
                cliente_email: p.cliente_email || null,
                vendedor_nome: p.vendedor_nome || '',
                vendedor_id: p.vendedor_id,
                status: p.status || 'orcamento',
                valor: valorFinal,
                valor_total: valorFinal,
                total_ipi: parseFloat(p.total_ipi) || 0,
                total_icms_st: parseFloat(p.total_icms_st) || 0,
                frete: parseFloat(p.frete) || 0,
                tipo: p.prioridade || 'a vista',
                faturamento: p.descricao || 'Aguardando',
                observacoes: p.descricao,
                origem: 'Omie',
                data_criacao: p.created_at,
                created_at: p.created_at,
                data_previsao: p.data_previsao,
                data_entrega: p.data_entrega,
                data_faturamento: p.data_faturamento,
                // Campos de faturamento parcial (F9)
                tipo_faturamento: p.tipo_faturamento || 'integral',
                percentual_faturado: parseFloat(p.percentual_faturado) || 0,
                valor_faturado: parseFloat(p.valor_faturado) || 0,
                numero_nf: p.numero_nf || null,
                itens: itens
            };
        });
        
        console.log(`📋 Kanban: ${pedidosFormatados.length} pedidos carregados com filtros`);
        res.json(pedidosFormatados);
        
    } catch (err) {
        console.error('Erro ao buscar pedidos para Kanban:', err);
        res.status(500).json({ message: 'Erro ao carregar pedidos', error: err.message });
    }
});

// Rota para listar vendedores (para filtros do Kanban) - AGORA PROTEGIDA
apiVendasRouter.get('/vendedores', authenticateToken, async (req, res) => {
    try {
        if (!dbAvailable) {
            return res.json([]);
        }
        
        // Buscar vendedores comerciais ATIVOS do banco (por role, departamento)
        // Vendedores inativos: Thainá, Ariel, Nicolas, Laís
        const [rows] = await pool.query(`
            SELECT id, nome, email, apelido, avatar, foto
            FROM usuarios 
            WHERE (role = 'comercial' OR departamento = 'Comercial')
              AND (ativo = 1 OR ativo IS NULL)
            ORDER BY nome ASC
        `);
        
        // Se não encontrou no banco, retornar lista fixa com IDs simulados
        if (rows.length === 0) {
            console.log('⚠️ Vendedores não encontrados no banco, retornando lista fixa');
            return res.json([
                { id: 1, nome: 'Márcia Scarcella', email: 'marcia@aluforce.com.br' },
                { id: 2, nome: 'Augusto Ladeira', email: 'augusto@aluforce.com.br' },
                { id: 3, nome: 'Renata Nascimento', email: 'renata@aluforce.com.br' },
                { id: 4, nome: 'Fabiano Marques', email: 'fabiano@aluforce.com.br' },
                { id: 5, nome: 'Fabíola Souza', email: 'fabiola@aluforce.com.br' }
            ]);
        }
        
        console.log(`👤 Vendedores comerciais ativos: ${rows.length} encontrados`);
        res.json(rows);
        
    } catch (err) {
        console.error('Erro ao buscar vendedores:', err);
        // Fallback para lista fixa em caso de erro
        res.json([
            { id: 62, nome: 'Márcia Scarcella', email: 'marcia@aluforce.com.br' },
            { id: 63, nome: 'Augusto Ladeira', email: 'augusto@aluforce.com.br' },
            { id: 2, nome: 'Renata Nascimento', email: 'renata@aluforce.com.br' },
            { id: 65, nome: 'Fabiano Marques', email: 'fabiano@aluforce.com.br' },
            { id: 72, nome: 'Fabíola Souza', email: 'fabiola@aluforce.com.br' }
        ]);
    }
});

// Rota para listar itens de um pedido (Kanban) - AGORA PROTEGIDA
apiVendasRouter.get('/pedidos/:id/itens', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        // Garantir que a tabela existe
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS pedido_itens (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    pedido_id INT NOT NULL,
                    codigo VARCHAR(50),
                    descricao VARCHAR(255) NOT NULL,
                    quantidade DECIMAL(10,2) DEFAULT 1,
                    quantidade_parcial DECIMAL(10,2) DEFAULT 0,
                    unidade VARCHAR(10) DEFAULT 'UN',
                    local_estoque VARCHAR(100) DEFAULT 'Principal',
                    preco_unitario DECIMAL(15,2) DEFAULT 0,
                    desconto DECIMAL(15,2) DEFAULT 0,
                    total DECIMAL(15,2) DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
                    INDEX idx_pedido_id (pedido_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);
        } catch (e) { /* tabela já existe */ }
        
        let [itens] = await pool.query(
            'SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC',
            [id]
        );
        
        // Se não houver itens mas o pedido tiver valor, criar item genérico automaticamente
        if ((!itens || itens.length === 0)) {
            const [pedidos] = await pool.query('SELECT id, valor, cliente_nome FROM pedidos WHERE id = ?', [id]);
            if (pedidos.length > 0 && pedidos[0].valor > 0) {
                const pedido = pedidos[0];
                console.log(`📦 Pedido ${id} tem valor R$${pedido.valor} mas sem itens. Criando item genérico...`);
                
                // Criar item genérico com o valor total do pedido
                try {
                    await pool.query(
                        `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [id, 'ITEM-' + id, 'Item do Pedido (importado)', 1, 0, 'UN', 'PADRAO', pedido.valor, 0, pedido.valor]
                    );
                    
                    // Buscar novamente os itens
                    [itens] = await pool.query(
                        'SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC',
                        [id]
                    );
                    console.log(`✅ Item genérico criado para pedido ${id}`);
                } catch (insertErr) {
                    console.warn('Não foi possível criar item genérico:', insertErr.message);
                }
            }
        }
        
        res.json(itens);
    } catch (error) {
        if (error && error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
        next(error);
    }
});

// ========================================
// ROTAS DE HISTÓRICO (ANTES DO MIDDLEWARE DE AUTH)
// Permite consulta de histórico sem autenticação obrigatória
// ========================================

// Helper: criar tabela de histórico específico do pedido
async function ensurePedidoHistoricoTablePre() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedido_historico (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pedido_id INT NOT NULL,
                user_id INT NULL,
                user_name VARCHAR(255),
                action VARCHAR(100) NOT NULL,
                descricao TEXT,
                meta JSON NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_pedido_id (pedido_id),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    } catch (e) { /* tabela já existe */ }
}

// Obter histórico do pedido (ANTES do middleware de auth)
apiVendasRouter.get('/pedidos/:id/historico', async (req, res, next) => {
    try {
        await ensurePedidoHistoricoTablePre();
        const { id } = req.params;
        const [rows] = await pool.query(
            'SELECT * FROM pedido_historico WHERE pedido_id = ? ORDER BY created_at DESC',
            [id]
        );
        res.json(rows);
    } catch (error) {
        if (error && error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
        next(error);
    }
});

// Adicionar entrada ao histórico (com autenticação opcional)
apiVendasRouter.post('/pedidos/:id/historico', async (req, res, next) => {
    try {
        await ensurePedidoHistoricoTablePre();
        const { id } = req.params;
        const { action, descricao, meta, usuario } = req.body;
        const user = req.user || {};
        
        await pool.query(
            'INSERT INTO pedido_historico (pedido_id, user_id, user_name, action, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
            [id, user.id || null, user.nome || user.name || usuario || 'Sistema', action || 'manual', descricao || '', meta ? JSON.stringify(meta) : null]
        );
        
        res.status(201).json({ message: 'Histórico registrado com sucesso!' });
    } catch (error) {
        next(error);
    }
});

// ========================================
// MIDDLEWARE DE AUTENTICAÇÃO (APLICADO A ROTAS SUBSEQUENTES)
// ========================================
apiVendasRouter.use(authenticateToken);

// Multer em memória para uploads temporários (limitando tamanho por arquivo e count)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// --- ROTAS DE METAS DE VENDAS ---

// Listar todas as metas (Admin)
apiVendasRouter.get('/metas', async (req, res, next) => {
    try {
        const { periodo, vendedor_id } = req.query;
        let query = `
            SELECT m.*, u.nome as vendedor_nome, u.email as vendedor_email,
                   (SELECT COALESCE(SUM(valor), 0) FROM pedidos 
                    WHERE vendedor_id = m.vendedor_id 
                    AND status IN ('faturado', 'recibo') 
                    AND DATE_FORMAT(created_at, '%Y-%m') = m.periodo) as valor_realizado
            FROM metas_vendas m
            LEFT JOIN usuarios u ON m.vendedor_id = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (periodo) {
            query += ` AND m.periodo = ?`;
            params.push(periodo);
        }
        if (vendedor_id) {
            query += ` AND m.vendedor_id = ?`;
            params.push(vendedor_id);
        }
        
        query += ` ORDER BY m.periodo DESC, u.nome ASC`;
        
        const [rows] = await pool.query(query, params);
        
        // Calcular percentual atingido
        const metas = rows.map(m => ({
            ...m,
            percentual_atingido: m.valor_meta > 0 ? ((m.valor_realizado / m.valor_meta) * 100).toFixed(2) : 0,
            status_meta: m.valor_realizado >= m.valor_meta ? 'atingida' : 
                         m.valor_realizado >= m.valor_meta * 0.8 ? 'proxima' : 'pendente'
        }));
        
        res.json(metas);
    } catch (error) {
        next(error);
    }
});

// Obter meta específica do vendedor logado
apiVendasRouter.get('/metas/minha', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const periodo = req.query.periodo || new Date().toISOString().substring(0, 7); // YYYY-MM atual
        
        const [rows] = await pool.query(`
            SELECT m.*, 
                   (SELECT COALESCE(SUM(valor), 0) FROM pedidos 
                    WHERE vendedor_id = ? 
                    AND status IN ('faturado', 'recibo') 
                    AND DATE_FORMAT(created_at, '%Y-%m') = ?) as valor_realizado
            FROM metas_vendas m
            WHERE m.vendedor_id = ? AND m.periodo = ?
        `, [userId, periodo, userId, periodo]);
        
        if (rows.length === 0) {
            return res.json({ 
                vendedor_id: userId,
                periodo,
                valor_meta: 0,
                valor_realizado: 0,
                percentual_atingido: 0,
                message: 'Nenhuma meta definida para este período'
            });
        }
        
        const meta = rows[0];
        res.json({
            ...meta,
            percentual_atingido: meta.valor_meta > 0 ? ((meta.valor_realizado / meta.valor_meta) * 100).toFixed(2) : 0,
            status_meta: meta.valor_realizado >= meta.valor_meta ? 'atingida' : 
                         meta.valor_realizado >= meta.valor_meta * 0.8 ? 'proxima' : 'pendente'
        });
    } catch (error) {
        next(error);
    }
});

// Obter meta de vendedor específico por ID
apiVendasRouter.get('/metas/vendedor/:vendedorId', async (req, res, next) => {
    try {
        const { vendedorId } = req.params;
        const periodo = req.query.periodo || new Date().toISOString().substring(0, 7);
        
        const [rows] = await pool.query(`
            SELECT m.*, u.nome as vendedor_nome,
                   (SELECT COALESCE(SUM(valor), 0) FROM pedidos 
                    WHERE vendedor_id = m.vendedor_id 
                    AND status IN ('faturado', 'recibo') 
                    AND DATE_FORMAT(created_at, '%Y-%m') = m.periodo) as valor_realizado
            FROM metas_vendas m
            LEFT JOIN usuarios u ON m.vendedor_id = u.id
            WHERE m.vendedor_id = ? AND m.periodo = ?
        `, [vendedorId, periodo]);
        
        if (rows.length === 0) {
            return res.json({ 
                vendedor_id: parseInt(vendedorId),
                periodo,
                valor_meta: 0,
                valor_realizado: 0,
                percentual_atingido: 0
            });
        }
        
        const meta = rows[0];
        res.json({
            ...meta,
            percentual_atingido: meta.valor_meta > 0 ? ((meta.valor_realizado / meta.valor_meta) * 100).toFixed(2) : 0
        });
    } catch (error) {
        next(error);
    }
});

// Criar nova meta (Admin)
apiVendasRouter.post('/metas', async (req, res, next) => {
    try {
        const user = req.user;
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin) {
            return res.status(403).json({ message: 'Apenas administradores podem definir metas.' });
        }
        
        const { vendedor_id, periodo, tipo, valor_meta } = req.body;
        
        if (!vendedor_id || !periodo || !valor_meta) {
            return res.status(400).json({ message: 'Campos obrigatórios: vendedor_id, periodo, valor_meta' });
        }
        
        // Verificar se já existe meta para este vendedor/período
        const [existing] = await pool.query(
            'SELECT id FROM metas_vendas WHERE vendedor_id = ? AND periodo = ?',
            [vendedor_id, periodo]
        );
        
        if (existing.length > 0) {
            // Atualizar meta existente
            await pool.query(
                'UPDATE metas_vendas SET tipo = ?, valor_meta = ? WHERE id = ?',
                [tipo || 'mensal', parseFloat(valor_meta), existing[0].id]
            );
            return res.json({ message: 'Meta atualizada com sucesso', id: existing[0].id });
        }
        
        // Inserir nova meta
        const [result] = await pool.query(
            'INSERT INTO metas_vendas (vendedor_id, periodo, tipo, valor_meta) VALUES (?, ?, ?, ?)',
            [vendedor_id, periodo, tipo || 'mensal', parseFloat(valor_meta)]
        );
        
        res.status(201).json({ message: 'Meta criada com sucesso', id: result.insertId });
    } catch (error) {
        next(error);
    }
});

// Criar metas em lote para todos vendedores (Admin)
apiVendasRouter.post('/metas/lote', async (req, res, next) => {
    try {
        const user = req.user;
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin) {
            return res.status(403).json({ message: 'Apenas administradores podem definir metas.' });
        }
        
        const { periodo, valor_meta_padrao, metas_individuais } = req.body;
        
        if (!periodo) {
            return res.status(400).json({ message: 'Período é obrigatório' });
        }
        
        // Buscar vendedores do Comercial
        const [vendedores] = await pool.query(`
            SELECT u.id, u.nome FROM usuarios u
            LEFT JOIN departamentos d ON u.departamento_id = d.id
            WHERE d.nome = 'Comercial' AND u.status = 'ativo'
        `);
        
        let criadas = 0;
        let atualizadas = 0;
        
        for (const vendedor of vendedores) {
            // Verificar se há meta individual definida
            const metaIndividual = metas_individuais?.find(m => m.vendedor_id === vendedor.id);
            const valorMeta = metaIndividual ? metaIndividual.valor_meta : valor_meta_padrao;
            
            if (!valorMeta) continue;
            
            const [existing] = await pool.query(
                'SELECT id FROM metas_vendas WHERE vendedor_id = ? AND periodo = ?',
                [vendedor.id, periodo]
            );
            
            if (existing.length > 0) {
                await pool.query(
                    'UPDATE metas_vendas SET valor_meta = ? WHERE id = ?',
                    [parseFloat(valorMeta), existing[0].id]
                );
                atualizadas++;
            } else {
                await pool.query(
                    'INSERT INTO metas_vendas (vendedor_id, periodo, tipo, valor_meta) VALUES (?, ?, ?, ?)',
                    [vendedor.id, periodo, 'mensal', parseFloat(valorMeta)]
                );
                criadas++;
            }
        }
        
        res.json({ 
            message: `Metas processadas: ${criadas} criadas, ${atualizadas} atualizadas`,
            total_vendedores: vendedores.length,
            criadas,
            atualizadas
        });
    } catch (error) {
        next(error);
    }
});

// Atualizar meta (Admin)
apiVendasRouter.put('/metas/:id', async (req, res, next) => {
    try {
        const user = req.user;
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin) {
            return res.status(403).json({ message: 'Apenas administradores podem editar metas.' });
        }
        
        const { id } = req.params;
        const { tipo, valor_meta } = req.body;
        
        const [existing] = await pool.query('SELECT id FROM metas_vendas WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Meta não encontrada' });
        }
        
        await pool.query(
            'UPDATE metas_vendas SET tipo = COALESCE(?, tipo), valor_meta = COALESCE(?, valor_meta) WHERE id = ?',
            [tipo, valor_meta ? parseFloat(valor_meta) : null, id]
        );
        
        res.json({ message: 'Meta atualizada com sucesso' });
    } catch (error) {
        next(error);
    }
});

// Excluir meta (Admin)
apiVendasRouter.delete('/metas/:id', async (req, res, next) => {
    try {
        const user = req.user;
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin) {
            return res.status(403).json({ message: 'Apenas administradores podem excluir metas.' });
        }
        
        const { id } = req.params;
        
        const [existing] = await pool.query('SELECT id FROM metas_vendas WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Meta não encontrada' });
        }
        
        await pool.query('DELETE FROM metas_vendas WHERE id = ?', [id]);
        
        res.json({ message: 'Meta excluída com sucesso' });
    } catch (error) {
        next(error);
    }
});

// Ranking de vendedores com metas
apiVendasRouter.get('/metas/ranking', async (req, res, next) => {
    try {
        const periodo = req.query.periodo || new Date().toISOString().substring(0, 7);
        
        const [rows] = await pool.query(`
            SELECT 
                u.id, u.nome, u.email, u.avatar,
                COALESCE(m.valor_meta, 0) as valor_meta,
                COALESCE((SELECT SUM(valor) FROM pedidos 
                          WHERE vendedor_id = u.id 
                          AND status IN ('faturado', 'recibo') 
                          AND DATE_FORMAT(created_at, '%Y-%m') = ?), 0) as valor_realizado,
                COALESCE((SELECT COUNT(*) FROM pedidos 
                          WHERE vendedor_id = u.id 
                          AND status IN ('faturado', 'recibo') 
                          AND DATE_FORMAT(created_at, '%Y-%m') = ?), 0) as qtd_vendas
            FROM usuarios u
            LEFT JOIN departamentos d ON u.departamento_id = d.id
            LEFT JOIN metas_vendas m ON u.id = m.vendedor_id AND m.periodo = ?
            WHERE d.nome = 'Comercial' AND u.status = 'ativo'
            ORDER BY valor_realizado DESC
        `, [periodo, periodo, periodo]);
        
        const ranking = rows.map((r, index) => ({
            ...r,
            posicao: index + 1,
            percentual_atingido: r.valor_meta > 0 ? ((r.valor_realizado / r.valor_meta) * 100).toFixed(2) : 0,
            status_meta: r.valor_realizado >= r.valor_meta && r.valor_meta > 0 ? 'atingida' : 
                         r.valor_realizado >= r.valor_meta * 0.8 && r.valor_meta > 0 ? 'proxima' : 'pendente'
        }));
        
        res.json({ periodo, ranking });
    } catch (error) {
        next(error);
    }
});

// --- ROTAS DE COMISSÕES ---

// Configuração de comissões por vendedor
apiVendasRouter.get('/comissoes/configuracao', async (req, res, next) => {
    try {
        // Buscar vendedores com suas configurações de comissão
        const [vendedores] = await pool.query(`
            SELECT 
                u.id, u.nome, u.email,
                COALESCE(u.comissao_percentual, 1.0) as comissao_percentual,
                COALESCE(u.comissao_tipo, 'percentual') as comissao_tipo
            FROM usuarios u
            LEFT JOIN departamentos d ON u.departamento_id = d.id
            WHERE d.nome = 'Comercial' AND u.status = 'ativo'
            ORDER BY u.nome
        `);
        
        res.json(vendedores);
    } catch (error) {
        next(error);
    }
});

// Atualizar configuração de comissão de vendedor (Apenas Andreia e Antonio T.I.)
apiVendasRouter.put('/comissoes/configuracao/:vendedorId', async (req, res, next) => {
    try {
        const user = req.user;
        const username = (user.email || '').split('@')[0].toLowerCase();
        const USERS_PERMITIDOS_COMISSAO = ['andreia', 'antonio', 'ti', 'tialuforce'];
        const podeAlterarComissao = USERS_PERMITIDOS_COMISSAO.includes(username);
        if (!podeAlterarComissao) {
            return res.status(403).json({ message: 'Apenas Andreia e Antonio (T.I.) podem alterar comissões.' });
        }
        
        const { vendedorId } = req.params;
        const { comissao_percentual, comissao_tipo } = req.body;
        
        // Verificar se a coluna existe, se não, usar apenas o que for possível
        try {
            await pool.query(
                'UPDATE usuarios SET comissao_percentual = ? WHERE id = ?',
                [parseFloat(comissao_percentual) || 1.0, vendedorId]
            );
        } catch (e) {
            // Se a coluna não existir, tentar criar
            await pool.query('ALTER TABLE usuarios ADD COLUMN comissao_percentual DECIMAL(5,2) DEFAULT 1.0');
            await pool.query(
                'UPDATE usuarios SET comissao_percentual = ? WHERE id = ?',
                [parseFloat(comissao_percentual) || 1.0, vendedorId]
            );
        }
        
        res.json({ message: 'Comissão atualizada com sucesso' });
    } catch (error) {
        next(error);
    }
});

// Calcular comissões de um período
apiVendasRouter.get('/comissoes', async (req, res, next) => {
    try {
        const { periodo, vendedor_id, status } = req.query;
        const periodoAtual = periodo || new Date().toISOString().substring(0, 7);
        
        // Verificar se usuário é admin (pode ver todos) ou vendedor (só vê o próprio)
        const user = req.user;
        const username = (user.email || '').split('@')[0].toLowerCase();
        const ADMINS_COMISSAO = ['ti', 'douglas', 'andreia', 'fernando', 'consultoria', 'admin', 'antonio', 'tialuforce'];
        const isAdminComissao = user.is_admin === 1 || user.is_admin === true || ADMINS_COMISSAO.includes(username);
        
        let query = `
            SELECT 
                p.id as pedido_id,
                p.numero_pedido,
                p.valor,
                p.status,
                p.created_at,
                e.nome_fantasia as cliente_nome,
                u.id as vendedor_id,
                u.nome as vendedor_nome,
                COALESCE(u.comissao_percentual, 1.0) as percentual_comissao,
                (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) as valor_comissao
            FROM pedidos p
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            LEFT JOIN empresas e ON p.empresa_id = e.id
            WHERE DATE_FORMAT(p.created_at, '%Y-%m') = ?
        `;
        const params = [periodoAtual];
        
        // Se não é admin, forçar filtro pelo próprio vendedor
        if (!isAdminComissao) {
            query += ' AND p.vendedor_id = ?';
            params.push(user.id);
        } else if (vendedor_id) {
            query += ' AND p.vendedor_id = ?';
            params.push(vendedor_id);
        }
        
        if (status === 'faturado') {
            query += " AND p.status IN ('faturado', 'recibo')";
        }
        
        query += ' ORDER BY u.nome, p.created_at DESC';
        
        const [rows] = await pool.query(query, params);
        
        res.json(rows);
    } catch (error) {
        next(error);
    }
});

// Resumo de comissões por vendedor
apiVendasRouter.get('/comissoes/resumo', async (req, res, next) => {
    try {
        const { periodo } = req.query;
        const periodoAtual = periodo || new Date().toISOString().substring(0, 7);
        
        // Verificar se usuário é admin (pode ver todos) ou vendedor (só vê o próprio)
        const user = req.user;
        const username = (user.email || '').split('@')[0].toLowerCase();
        const ADMINS_COMISSAO = ['ti', 'douglas', 'andreia', 'fernando', 'consultoria', 'admin', 'antonio', 'tialuforce'];
        const isAdminComissao = user.is_admin === 1 || user.is_admin === true || ADMINS_COMISSAO.includes(username);
        
        let whereExtra = '';
        const params = [periodoAtual];
        
        // Se não é admin, filtrar apenas pelo próprio vendedor
        if (!isAdminComissao) {
            whereExtra = ' AND u.id = ?';
            params.push(user.id);
        }
        
        const [rows] = await pool.query(`
            SELECT 
                u.id as vendedor_id,
                u.nome as vendedor_nome,
                u.email,
                COALESCE(u.comissao_percentual, 1.0) as percentual_comissao,
                COUNT(CASE WHEN p.status IN ('faturado', 'recibo') THEN 1 END) as qtd_faturados,
                COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END), 0) as valor_faturado,
                COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) ELSE 0 END), 0) as comissao_faturada,
                COUNT(CASE WHEN p.status NOT IN ('cancelado', 'faturado', 'recibo') THEN 1 END) as qtd_pendentes,
                COALESCE(SUM(CASE WHEN p.status NOT IN ('cancelado', 'faturado', 'recibo') THEN p.valor ELSE 0 END), 0) as valor_pendente,
                COALESCE(SUM(CASE WHEN p.status NOT IN ('cancelado', 'faturado', 'recibo') THEN (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) ELSE 0 END), 0) as comissao_pendente
            FROM usuarios u
            LEFT JOIN departamentos d ON u.departamento_id = d.id
            LEFT JOIN pedidos p ON u.id = p.vendedor_id AND DATE_FORMAT(p.created_at, '%Y-%m') = ?
            WHERE d.nome = 'Comercial' AND u.status = 'ativo'${whereExtra}
            GROUP BY u.id, u.nome, u.email, u.comissao_percentual
            ORDER BY comissao_faturada DESC
        `, params);
        
        // Calcular totais
        const totais = {
            total_faturado: rows.reduce((sum, r) => sum + parseFloat(r.valor_faturado || 0), 0),
            total_comissao_faturada: rows.reduce((sum, r) => sum + parseFloat(r.comissao_faturada || 0), 0),
            total_pendente: rows.reduce((sum, r) => sum + parseFloat(r.valor_pendente || 0), 0),
            total_comissao_pendente: rows.reduce((sum, r) => sum + parseFloat(r.comissao_pendente || 0), 0)
        };
        
        res.json({ periodo: periodoAtual, vendedores: rows, totais });
    } catch (error) {
        next(error);
    }
});

// Histórico de comissões pagas
apiVendasRouter.get('/comissoes/historico', async (req, res, next) => {
    try {
        const { vendedor_id, ano } = req.query;
        const anoAtual = ano || new Date().getFullYear();
        
        // Verificar se usuário é admin (pode ver todos) ou vendedor (só vê o próprio)
        const user = req.user;
        const username = (user.email || '').split('@')[0].toLowerCase();
        const ADMINS_COMISSAO = ['ti', 'douglas', 'andreia', 'fernando', 'consultoria', 'admin', 'antonio', 'tialuforce'];
        const isAdminComissao = user.is_admin === 1 || user.is_admin === true || ADMINS_COMISSAO.includes(username);
        
        let query = `
            SELECT 
                DATE_FORMAT(p.created_at, '%Y-%m') as periodo,
                u.id as vendedor_id,
                u.nome as vendedor_nome,
                COUNT(*) as qtd_vendas,
                SUM(p.valor) as valor_total,
                SUM(p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) as comissao_total
            FROM pedidos p
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.status IN ('faturado', 'recibo')
            AND YEAR(p.created_at) = ?
        `;
        const params = [anoAtual];
        
        // Se não é admin, forçar filtro pelo próprio vendedor
        if (!isAdminComissao) {
            query += ' AND p.vendedor_id = ?';
            params.push(user.id);
        } else if (vendedor_id) {
            query += ' AND p.vendedor_id = ?';
            params.push(vendedor_id);
        }
        
        query += ' GROUP BY DATE_FORMAT(p.created_at, "%Y-%m"), u.id, u.nome ORDER BY periodo DESC, u.nome';
        
        const [rows] = await pool.query(query, params);
        
        res.json(rows);
    } catch (error) {
        next(error);
    }
});

// Exportar relatório de comissões
apiVendasRouter.get('/comissoes/exportar', async (req, res, next) => {
    try {
        const { periodo, formato } = req.query;
        const periodoAtual = periodo || new Date().toISOString().substring(0, 7);
        
        const [rows] = await pool.query(`
            SELECT 
                u.nome as 'Vendedor',
                u.email as 'Email',
                COUNT(CASE WHEN p.status IN ('faturado', 'recibo') THEN 1 END) as 'Qtd Vendas',
                SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END) as 'Valor Total',
                COALESCE(u.comissao_percentual, 1.0) as 'Percentual (%)',
                SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) ELSE 0 END) as 'Comissão (R$)'
            FROM usuarios u
            LEFT JOIN departamentos d ON u.departamento_id = d.id
            LEFT JOIN pedidos p ON u.id = p.vendedor_id AND DATE_FORMAT(p.created_at, '%Y-%m') = ?
            WHERE d.nome = 'Comercial' AND u.status = 'ativo'
            GROUP BY u.id, u.nome, u.email, u.comissao_percentual
            ORDER BY u.nome
        `, [periodoAtual]);
        
        if (formato === 'csv') {
            // Gerar CSV
            const headers = Object.keys(rows[0] || {}).join(';');
            const csvRows = rows.map(r => Object.values(r).join(';'));
            const csv = [headers, ...csvRows].join('\n');
            
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=comissoes_${periodoAtual}.csv`);
            return res.send('\uFEFF' + csv); // BOM para Excel
        }
        
        res.json(rows);
    } catch (error) {
        next(error);
    }
});

// --- ROTAS DE DASHBOARD ---

// Dashboard Admin: métricas completas e avançadas
apiVendasRouter.get('/dashboard/admin', async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Usuário não autenticado.' });
        }
        const user = req.user;
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin) return res.status(403).json({ message: 'Acesso negado: apenas administradores.' });

        const período = req.query.período || '30'; // dias

        // Métricas gerais
        const [metricsRows] = await pool.query(`
            SELECT 
                COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END) as total_faturado,
                SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END) as valor_faturado,
                COUNT(CASE WHEN status = 'orçamento' THEN 1 END) as total_orcamentos,
                SUM(CASE WHEN status = 'orçamento' THEN valor ELSE 0 END) as valor_orcamentos,
                COUNT(CASE WHEN status = 'analise' THEN 1 END) as total_analise,
                SUM(CASE WHEN status = 'analise' THEN valor ELSE 0 END) as valor_analise,
                COUNT(CASE WHEN status = 'cancelado' THEN 1 END) as total_cancelado,
                COUNT(*) as total_pedidos,
                AVG(valor) as ticket_medio
            FROM pedidos
            WHERE created_at >= CURDATE() - INTERVAL ? DAY
        `, [parseInt(período)]);

        // Top vendedores (faturamento)
        const [topVendedores] = await pool.query(`
            SELECT 
                u.id, u.nome, u.email,
                COUNT(p.id) as total_vendas,
                SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END) as valor_faturado,
                SUM(p.valor) as valor_total
            FROM usuarios u
            LEFT JOIN pedidos p ON u.id = p.vendedor_id AND p.created_at >= CURDATE() - INTERVAL ? DAY
            WHERE u.role = 'vendedor' OR u.is_admin = 0
            GROUP BY u.id, u.nome, u.email
            ORDER BY valor_faturado DESC
            LIMIT 10
        `, [parseInt(período)]);

        // Faturamento mensal (últimos 12 meses)
        const [faturamentoMensal] = await pool.query(`
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as mes,
                COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END) as qtd_faturado,
                SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END) as valor_faturado
            FROM pedidos
            WHERE created_at >= CURDATE() - INTERVAL 12 MONTH
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY mes ASC
        `);

        // Conversão por status
        const [conversao] = await pool.query(`
            SELECT 
                status,
                COUNT(*) as quantidade,
                SUM(valor) as valor_total
            FROM pedidos
            WHERE created_at >= CURDATE() - INTERVAL ? DAY
            GROUP BY status
        `, [parseInt(período)]);

        // Pedidos por empresa (top 10)
        const [topEmpresas] = await pool.query(`
            SELECT 
                e.id, e.nome_fantasia, e.cnpj,
                COUNT(p.id) as total_pedidos,
                SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END) as valor_faturado
            FROM empresas e
            LEFT JOIN pedidos p ON e.id = p.empresa_id AND p.created_at >= CURDATE() - INTERVAL ? DAY
            GROUP BY e.id, e.nome_fantasia, e.cnpj
            ORDER BY valor_faturado DESC
            LIMIT 10
        `, [parseInt(período)]);

        // Taxa de conversão
        const totalOrcamentos = metricsRows[0].total_orcamentos || 0;
        const totalFaturado = metricsRows[0].total_faturado || 0;
        const taxaConversao = totalOrcamentos > 0 ? ((totalFaturado / totalOrcamentos) * 100).toFixed(2) : 0;

        res.json({
            período: parseInt(período),
            metricas: metricsRows[0],
            taxaConversao: parseFloat(taxaConversao),
            topVendedores,
            faturamentoMensal,
            conversaoPorStatus: conversao,
            topEmpresas
        });
    } catch (error) {
        next(error);
    }
});

// Dashboard Vendedor: métricas pessoais
apiVendasRouter.get('/dashboard/vendedor', async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Usuário não autenticado.' });
        }
        const user = req.user;
        const vendedorId = user.id;
        const período = req.query.período || '30'; // dias

        // Métricas pessoais do vendedor
        const [metricsRows] = await pool.query(`
            SELECT 
                COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END) as total_faturado,
                SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END) as valor_faturado,
                COUNT(CASE WHEN status = 'orçamento' THEN 1 END) as total_orcamentos,
                SUM(CASE WHEN status = 'orçamento' THEN valor ELSE 0 END) as valor_orcamentos,
                COUNT(CASE WHEN status = 'analise' THEN 1 END) as total_analise,
                COUNT(CASE WHEN status = 'cancelado' THEN 1 END) as total_cancelado,
                COUNT(*) as total_pedidos,
                AVG(valor) as ticket_medio
            FROM pedidos
            WHERE vendedor_id = ? AND created_at >= CURDATE() - INTERVAL ? DAY
        `, [vendedorId, parseInt(período)]);

        // Pipeline do vendedor (valor por status)
        const [pipeline] = await pool.query(`
            SELECT 
                status,
                COUNT(*) as quantidade,
                SUM(valor) as valor_total
            FROM pedidos
            WHERE vendedor_id = ? AND created_at >= CURDATE() - INTERVAL ? DAY
            GROUP BY status
        `, [vendedorId, parseInt(período)]);

        // Histórico mensal do vendedor (últimos 6 meses)
        const [históricoMensal] = await pool.query(`
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as mes,
                COUNT(CASE WHEN status IN ('faturado', 'recibo') THEN 1 END) as qtd_faturado,
                SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END) as valor_faturado
            FROM pedidos
            WHERE vendedor_id = ? AND created_at >= CURDATE() - INTERVAL 6 MONTH
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY mes ASC
        `, [vendedorId]);

        // Meus clientes (empresas com mais pedidos)
        const [meusClientes] = await pool.query(`
            SELECT 
                e.id, e.nome_fantasia,
                COUNT(p.id) as total_pedidos,
                SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END) as valor_faturado,
                MAX(p.created_at) as último_pedido
            FROM empresas e
            INNER JOIN pedidos p ON e.id = p.empresa_id
            WHERE p.vendedor_id = ? AND p.created_at >= CURDATE() - INTERVAL ? DAY
            GROUP BY e.id, e.nome_fantasia
            ORDER BY valor_faturado DESC
            LIMIT 10
        `, [vendedorId, parseInt(período)]);

        // Taxa de conversão pessoal
        const totalOrcamentos = metricsRows[0].total_orcamentos || 0;
        const totalFaturado = metricsRows[0].total_faturado || 0;
        const taxaConversao = totalOrcamentos > 0 ? ((totalFaturado / totalOrcamentos) * 100).toFixed(2) : 0;

        // Buscar meta real do banco
        const periodoAtual = new Date().toISOString().substring(0, 7);
        const [metaRows] = await pool.query(
            'SELECT valor_meta FROM metas_vendas WHERE vendedor_id = ? AND periodo = ?',
            [vendedorId, periodoAtual]
        );
        const metaMensal = metaRows.length > 0 ? metaRows[0].valor_meta : 0;
        const valorFaturado = metricsRows[0].valor_faturado || 0;
        const percentualMeta = metaMensal > 0 ? ((valorFaturado / metaMensal) * 100).toFixed(2) : 0;

        res.json({
            período: parseInt(período),
            metricas: metricsRows[0],
            taxaConversao: parseFloat(taxaConversao),
            meta: {
                valor: metaMensal,
                atingido: valorFaturado,
                percentual: parseFloat(percentualMeta)
            },
            pipeline,
            históricoMensal,
            meusClientes
        });
    } catch (error) {
        next(error);
    }
});

// Notificações do usuário (pedidos atrasados, follow-ups)
apiVendasRouter.get('/notificacoes', async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Usuário não autenticado.' });
        }
        const user = req.user;
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        
        let notificacoes = [];

        // Pedidos em análise há mais de 7 dias
        const [pedidosAtrasados] = await pool.query(`
            SELECT 
                p.id, p.valor, p.status, p.created_at,
                e.nome_fantasia as empresa_nome,
                DATEDIFF(CURDATE(), p.created_at) as dias_espera
            FROM pedidos p
            LEFT JOIN empresas e ON p.empresa_id = e.id
            WHERE p.status = 'analise' 
            AND p.created_at < CURDATE() - INTERVAL 7 DAY
            ${!isAdmin ? 'AND p.vendedor_id = ?' : ''}
            ORDER BY p.created_at ASC
            LIMIT 10
        `, !isAdmin ? [user.id] : []);

        notificacoes = notificacoes.concat(pedidosAtrasados.map(p => ({
            tipo: 'pedido_atrasado',
            pedido_id: p.id,
            titulo: `Pedido ${p.id} em análise há ${p.dias_espera} dias`,
            mensagem: `Empresa: ${p.empresa_nome} - Valor: R$ ${parseFloat(p.valor).toFixed(2)}`,
            data: p.created_at,
            prioridade: p.dias_espera > 14 ? 'alta' : 'media'
        })));

        // Orçamentos sem follow-up (mais de 3 dias)
        const [orçamentosSemFollowup] = await pool.query(`
            SELECT 
                p.id, p.valor, p.created_at,
                e.nome_fantasia as empresa_nome,
                DATEDIFF(CURDATE(), p.created_at) as dias_orcamento
            FROM pedidos p
            LEFT JOIN empresas e ON p.empresa_id = e.id
            WHERE p.status = 'orçamento'
            AND p.created_at < CURDATE() - INTERVAL 3 DAY
            ${!isAdmin ? 'AND p.vendedor_id = ?' : ''}
            ORDER BY p.created_at ASC
            LIMIT 10
        `, !isAdmin ? [user.id] : []);

        notificacoes = notificacoes.concat(orçamentosSemFollowup.map(p => ({
            tipo: 'follow_up',
            pedido_id: p.id,
            titulo: `Orçamento ${p.id} aguardando follow-up`,
            mensagem: `Empresa: ${p.empresa_nome} - ${p.dias_orcamento} dias sem retorno`,
            data: p.created_at,
            prioridade: 'baixa'
        })));

        res.json({
            total: notificacoes.length,
            notificacoes: notificacoes.sort((a, b) => {
                const prioridades = { alta: 3, media: 2, baixa: 1 };
                return (prioridades[b.prioridade] || 0) - (prioridades[a.prioridade] || 0);
            })
        });
    } catch (error) {
        next(error);
    }
});

// --- ROTAS DE PEDIDOS ---

// **ROTA ATUALIZADA** para unificar filtros avançados e de período.
apiVendasRouter.get('/pedidos/filtro-avancado', async (req, res, next) => {
    try {
        const { q, period, data_inicio, data_fim, empresa_id, vendedor_id, valor_min, valor_max } = req.query;
        
        let queryConditions = [];
        let params = [];

        if (q) {
            const searchTerm = `%${q}%`;
            queryConditions.push("(e.nome_fantasia LIKE ? OR p.id LIKE ? OR u.nome LIKE ?)");
            params.push(searchTerm, searchTerm, searchTerm);
        }
        if (period && period !== 'all') {
            queryConditions.push("p.created_at >= CURDATE() - INTERVAL ? DAY");
            params.push(parseInt(period));
        }
        if (data_inicio) {
            queryConditions.push("p.created_at >= ?");
            params.push(data_inicio);
        }
        if (data_fim) {
            queryConditions.push("p.created_at <= ?");
            params.push(data_fim);
        }
        if (empresa_id) {
            queryConditions.push("p.empresa_id = ?");
            params.push(empresa_id);
        }
        if (vendedor_id) {
            queryConditions.push("p.vendedor_id = ?");
            params.push(vendedor_id);
        }
        if (valor_min) {
            queryConditions.push("p.valor >= ?");
            params.push(valor_min);
        }
        if (valor_max) {
            queryConditions.push("p.valor <= ?");
            params.push(valor_max);
        }

        // se usuário não é admin, restringe resultados aos pedidos atribuídos a ele ou sem vendedor
        const user = req.user || {};
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin) {
            queryConditions.push('(p.vendedor_id IS NULL OR p.vendedor_id = ?)');
            params.push(user.id);
        }

        const whereClause = queryConditions.length > 0 ? `WHERE ${queryConditions.join(' AND ')}` : '';

        const [rows] = await pool.query(`
            SELECT 
                p.id, p.valor, p.status, p.created_at, p.vendedor_id,
                e.nome_fantasia AS empresa_nome,
                u.nome AS vendedor_nome
            FROM pedidos p
            LEFT JOIN empresas e ON p.empresa_id = e.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            ${whereClause}
            ORDER BY p.id DESC
        `, params);
        
        res.json(rows);
    } catch (error) {
        next(error);
    }
});

// Lista de pedidos (paginada) - usada pelo frontend para preencher tabelas/kanban
apiVendasRouter.get('/pedidos', async (req, res, next) => {
    try {
        const page = Math.max(parseInt(req.query.page || '1'), 1);
        const limit = Math.max(parseInt(req.query.limit || '50'), 1);
        const offset = (page - 1) * limit;

        const period = req.query.period || null;
        const vendedor_id = req.query.vendedor_id || null;
        const data_inicio = req.query.data_inicio || null;
        const data_fim = req.query.data_fim || null;
        const status = req.query.status || null; // Filtro por status (novo, em_negociacao, faturado, entregue, perdido)

        // Identificar usuário logado (igual ao Kanban - lê do cookie)
        let currentUser = null;
        let isAdmin = false;
        const token = req.cookies?.authToken || req.cookies?.token || 
                      (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') 
                          ? req.headers.authorization.split(' ')[1] : null);
        
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                if (decoded && decoded.id) {
                    const [userRows] = await pool.query('SELECT id, nome, email, role, is_admin FROM usuarios WHERE id = ?', [decoded.id]);
                    if (userRows.length > 0) {
                        currentUser = userRows[0];
                        isAdmin = verificarSeAdmin(currentUser);
                        console.log(`👤 Pedidos: Usuário ${currentUser.nome} | Admin: ${isAdmin}`);
                    }
                }
            } catch (e) { 
                console.log('⚠️ Token inválido em /pedidos:', e.message);
            }
        }
        
        // Fallback para req.user se middleware já preencheu
        if (!currentUser && req.user) {
            currentUser = req.user;
            isAdmin = verificarSeAdmin(currentUser);
        }

        let where = [];
        let params = [];

        // FILTRO POR USUÁRIO: Vendedores só veem seus próprios pedidos (igual ao Kanban)
        if (currentUser && !isAdmin) {
            where.push('p.vendedor_id = ?');
            params.push(currentUser.id);
            console.log(`👤 Filtrando pedidos do vendedor: ${currentUser.nome} (ID: ${currentUser.id})`);
        }

        if (period && period !== 'all') {
            where.push('p.created_at >= CURDATE() - INTERVAL ? DAY');
            params.push(parseInt(period));
        }
        if (vendedor_id && isAdmin) {
            where.push('p.vendedor_id = ?');
            params.push(vendedor_id);
        }
        
        // Filtro por data de início e fim
        if (data_inicio) {
            where.push('DATE(p.created_at) >= ?');
            params.push(data_inicio);
        }
        if (data_fim) {
            where.push('DATE(p.created_at) <= ?');
            params.push(data_fim);
        }
        
        // Filtro por status (novo, em_negociacao, faturado, entregue, perdido)
        if (status) {
            where.push('p.status = ?');
            params.push(status);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [rows] = await pool.query(`
            SELECT p.id, p.valor, p.valor as valor_total, p.status, p.created_at, p.created_at as data_pedido, 
                   p.vendedor_id, p.empresa_id, p.cliente_id, p.descricao, p.observacao, p.frete, p.prioridade,
                   p.data_previsao, p.data_entrega, p.data_faturamento,
                   p.transportadora_nome, p.transportadora_id, p.condicao_pagamento, p.nf,
                   p.tipo_faturamento, p.percentual_faturado, p.valor_faturado, p.numero_nf,
                   COALESCE(c.nome, e.nome_fantasia, e.razao_social, 'Cliente não informado') AS cliente_nome,
                   e.nome_fantasia AS empresa_nome,
                   u.nome AS vendedor_nome
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN empresas e ON p.empresa_id = e.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            ${whereClause}
            ORDER BY p.id DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        res.json(rows);
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.get('/pedidos/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query('SELECT * FROM pedidos WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: "Pedido não encontrado." });
        }
        // Restrição de visualização: usuários não-admin não podem ver pedidos de outro vendedor
        const pedido = rows[0];
        const user = req.user || {};
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin && pedido.vendedor_id != null && Number(pedido.vendedor_id) !== Number(user.id)) {
            return res.status(403).json({ message: 'Acesso negado: você não tem permissão para visualizar este pedido.' });
        }
        res.json(pedido);
    } catch (error) {
        next(error);
    }
});

// Cria pedido: atribui automaticamente ao usuário logado
// USA TRANSAÇÃO para garantir integridade (pedido + itens)
apiVendasRouter.post('/pedidos', upload.array('anexos', 8), async (req, res, next) => {
    // Obter conexão para transação
    const connection = await pool.getConnection();
    
    try {
        // Iniciar transação
        await connection.beginTransaction();
        
        // Helper para sanitizar valores
        const sanitize = (val) => (val === 'null' || val === 'undefined' || val === '' ? null : val);
        const sanitizeNum = (val) => {
            if (val === 'null' || val === 'undefined' || val === '' || val === null) return null;
            const num = parseFloat(val);
            return isNaN(num) ? null : num;
        };
        const sanitizeBool = (val) => val === '1' || val === true || val === 'true';
        
        // Suporte a JSON e multipart - TODOS OS CAMPOS DA TABELA
        const empresa_id = sanitize(req.body.empresa_id || req.body.empresaId) || null;
        const cliente_nome = sanitize(req.body.cliente_nome || req.body.clienteNome) || null;
        const valor = sanitizeNum(req.body.valor) || 0;
        const descrição = sanitize(req.body.descrição || req.body.descricao) || null;
        const frete = sanitizeNum(req.body.frete) || 0.00;
        const redespacho = sanitizeBool(req.body.redespacho);
        const observacao = sanitize(req.body.observacao || req.body.observacoes) || null;
        const status = sanitize(req.body.status) || 'orcamento';
        const condicao_pagamento = sanitize(req.body.condicao_pagamento) || 'À Vista';
        const cenario_fiscal = sanitize(req.body.cenario_fiscal) || null;
        const previsao_faturamento = sanitize(req.body.previsao_faturamento || req.body.data_previsao) || null;
        const departamento = sanitize(req.body.departamento) || null;
        const itens = req.body.itens || [];
        
        // Campos adicionais de transporte e entrega
        const transportadora_nome = sanitize(req.body.transportadora_nome || req.body.transportadora) || null;
        const tipo_frete = sanitize(req.body.tipo_frete) || null;
        const metodo_envio = sanitize(req.body.metodo_envio) || null;
        const endereco_entrega = sanitize(req.body.endereco_entrega) || null;
        const municipio_entrega = sanitize(req.body.municipio_entrega) || null;
        const prazo_entrega = sanitize(req.body.prazo_entrega) || null;
        const placa_veiculo = sanitize(req.body.placa_veiculo) || null;
        const veiculo_uf = sanitize(req.body.veiculo_uf) || null;
        const rntrc = sanitize(req.body.rntrc) || null;
        const qtd_volumes = sanitizeNum(req.body.qtd_volumes) || null;
        const especie_volumes = sanitize(req.body.especie_volumes) || null;
        const marca_volumes = sanitize(req.body.marca_volumes) || null;
        const numeracao_volumes = sanitize(req.body.numeracao_volumes) || null;
        const peso_liquido = sanitizeNum(req.body.peso_liquido) || null;
        const peso_bruto = sanitizeNum(req.body.peso_bruto) || null;
        const valor_seguro = sanitizeNum(req.body.valor_seguro) || null;
        const outras_despesas = sanitizeNum(req.body.outras_despesas) || null;
        const numero_lacre = sanitize(req.body.numero_lacre) || null;
        const codigo_rastreio = sanitize(req.body.codigo_rastreio) || null;
        const desconto_pct = sanitizeNum(req.body.desconto_pct) || 0;
        
        // Campos adicionais de observações e informações
        const observacao_cliente = sanitize(req.body.observacao_cliente) || null;
        const info_complementar = sanitize(req.body.info_complementar) || null;
        const campos_obs_nfe = sanitize(req.body.campos_obs_nfe) || null;
        const dados_adicionais_nf = sanitize(req.body.dados_adicionais_nf) || null;
        const projeto = sanitize(req.body.projeto) || null;
        const contato = sanitize(req.body.contato) || null;
        const categoria = sanitize(req.body.categoria) || null;
        const prioridade = sanitize(req.body.prioridade) || null;
        const conta_corrente = sanitize(req.body.conta_corrente) || null;
        const pedido_cliente = sanitize(req.body.pedido_cliente) || null;
        const contrato_venda = sanitize(req.body.contrato_venda) || null;
        const nf = sanitize(req.body.nf) || null;
        
        // Vendedor: usa o informado ou o usuário logado
        const vendedor_id = req.body.vendedor_id || req.body.vendedorId || (req.user ? req.user.id : null);
        
        // Validação flexível - aceita empresa_id OU cliente_nome
        if (!empresa_id && !cliente_nome) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ message: 'Informe a empresa ou o nome do cliente.' });
        }
        
        // Se não tiver empresa_id mas tiver cliente_nome, buscar ou criar empresa
        let empresaFinalId = empresa_id;
        if (!empresaFinalId && cliente_nome) {
            // Tentar buscar empresa pelo nome
            const [existingEmp] = await connection.query(
                'SELECT id FROM empresas WHERE nome_fantasia = ? OR razao_social = ? LIMIT 1',
                [cliente_nome, cliente_nome]
            );
            if (existingEmp.length > 0) {
                empresaFinalId = existingEmp[0].id;
            } else {
                // Criar empresa automaticamente
                const [newEmp] = await connection.query(
                    'INSERT INTO empresas (nome_fantasia, razao_social) VALUES (?, ?)',
                    [cliente_nome, cliente_nome]
                );
                empresaFinalId = newEmp.insertId;
            }
        }
        
        // Inserir pedido (dentro da transação) - TODOS OS CAMPOS
        const [result] = await connection.query(
            `INSERT INTO pedidos (
                empresa_id, vendedor_id, valor, descricao, frete, redespacho, observacao, status, 
                condicao_pagamento, cenario_fiscal, data_previsao, departamento,
                transportadora_nome, tipo_frete, metodo_envio, endereco_entrega, municipio_entrega,
                prazo_entrega, placa_veiculo, veiculo_uf, rntrc, qtd_volumes, especie_volumes,
                marca_volumes, numeracao_volumes, peso_liquido, peso_bruto, valor_seguro,
                outras_despesas, numero_lacre, codigo_rastreio, observacao_cliente, info_complementar,
                campos_obs_nfe, dados_adicionais_nf, projeto, contato, categoria, prioridade,
                conta_corrente, pedido_cliente, contrato_venda, nf, desconto_pct
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                empresaFinalId, vendedor_id, valor, descrição, frete || 0.00, redespacho || false, observacao, status,
                condicao_pagamento, cenario_fiscal, previsao_faturamento, departamento,
                transportadora_nome, tipo_frete, metodo_envio, endereco_entrega, municipio_entrega,
                prazo_entrega, placa_veiculo, veiculo_uf, rntrc, qtd_volumes, especie_volumes,
                marca_volumes, numeracao_volumes, peso_liquido, peso_bruto, valor_seguro,
                outras_despesas, numero_lacre, codigo_rastreio, observacao_cliente, info_complementar,
                campos_obs_nfe, dados_adicionais_nf, projeto, contato, categoria, prioridade,
                conta_corrente, pedido_cliente, contrato_venda, nf, desconto_pct
            ]
        );

        const insertedId = result.insertId;
        
        // Salvar itens do pedido (dentro da transação)
        if (Array.isArray(itens) && itens.length > 0) {
            await ensurePedidoItensTable();
            for (const item of itens) {
                const total = (parseFloat(item.quantidade) || 1) * (parseFloat(item.preco_unitario) || 0);
                await connection.query(
                    `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, unidade, local_estoque, preco_unitario, total) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        insertedId,
                        item.codigo || '',
                        item.descricao || '',
                        parseFloat(item.quantidade) || 1,
                        item.unidade || 'UN',
                        item.local_estoque || 'PADRÃO',
                        parseFloat(item.preco_unitario) || 0,
                        total
                    ]
                );
            }
            console.log(`📦 ${itens.length} itens salvos para o pedido ${insertedId}`);
        }
        
        // Se foram enviados arquivos via multipart (req.files), salvá-los
        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
            const anexosFromFiles = req.files.map(f => ({ name: f.originalname, type: f.mimetype, size: f.size, buffer: f.buffer }));
            await saveAnexos(insertedId, anexosFromFiles);
        } else if (req.body && Array.isArray(req.body.anexos) && req.body.anexos.length > 0) {
            await saveAnexos(insertedId, req.body.anexos);
        }
        
        // Atualizar última movimentação da empresa (para sistema de inativação automática)
        if (empresaFinalId) {
            await connection.query(
                'UPDATE empresas SET ultima_movimentacao = NOW(), status_cliente = ? WHERE id = ?',
                ['ativo', empresaFinalId]
            );
        }
        
        // COMMIT da transação - tudo OK
        await connection.commit();
        connection.release();

        console.log(`✅ Pedido ${insertedId} criado por vendedor ${vendedor_id} (transação commitada)`);
        
        // Criar notificação de novo pedido
        if (global.createNotification) {
            const user = req.user || {};
            const nomeUsuario = user.nome || user.email || 'Usuário';
            const valorFormatado = (parseFloat(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            global.createNotification(
                'order',
                `Novo Pedido #${insertedId}`,
                `${nomeUsuario} criou pedido para ${cliente_nome || 'Cliente'} - ${valorFormatado}`,
                { 
                    pedido_id: insertedId, 
                    cliente: cliente_nome, 
                    valor: valor,
                    user_id: user.id || null,
                    user_nome: nomeUsuario,
                    vendedor_id: vendedor_id || null,
                    tipo: 'novo_pedido'
                }
            );
        }
        
        res.status(201).json({ message: 'Pedido criado com sucesso!', id: insertedId, insertId: insertedId });
    } catch (error) {
        // ROLLBACK em caso de erro
        try {
            await connection.rollback();
        } catch (rollbackErr) {
            console.error('Erro no rollback:', rollbackErr);
        }
        connection.release();
        console.error('Erro ao criar pedido (transação revertida):', error);
        next(error);
    }
});

// Atualiza pedido: admin pode alterar vendedor_id; vendedores só podem editar seus pedidos
apiVendasRouter.put('/pedidos/:id', upload.array('anexos', 8), async (req, res, next) => {
    try {
    const { id } = req.params;
    // parse básico para multipart compat
    const empresa_id = req.body.empresa_id || req.body.empresaId;
    const valor = req.body.valor ? parseFloat(req.body.valor) : null;
    const descrição = req.body.descrição;
    const frete = req.body.frete ? parseFloat(req.body.frete) : 0.00;
    const redespacho = req.body.redespacho === '1' || req.body.redespacho === true || req.body.redespacho === 'true';
    const observacao = req.body.observacao;
    const vendedor_id = req.body.vendedor_id || req.body.vendedorId;
        if (!empresa_id || !valor) {
            return res.status(400).json({ message: 'Empresa e valor são obrigatórios.' });
        }

        const [existingRows] = await pool.query('SELECT vendedor_id FROM pedidos WHERE id = ?', [id]);
        if (existingRows.length === 0) return res.status(404).json({ message: 'Pedido não encontrado.' });
        const existing = existingRows[0];
        const user = req.user || {};
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin && Number(existing.vendedor_id) !== Number(user.id)) {
            return res.status(403).json({ message: 'Acesso negado: somente o vendedor responsável ou admin podem editar este pedido.' });
        }

        const vendedorParaAtualizar = isAdmin && vendedor_id ? vendedor_id : existing.vendedor_id;

        const [result] = await pool.query(
            `UPDATE pedidos SET empresa_id = ?, valor = ?, descrição = ?, frete = ?, redespacho = ?, observacao = ?, vendedor_id = ? WHERE id = ?`,
            [empresa_id, valor, descrição || null, frete || 0.00, redespacho || false, observacao || null, vendedorParaAtualizar, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Pedido não encontrado.' });
        }
        // Se foram enviados arquivos via multipart (req.files), salvá-los
        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
            const anexosFromFiles = req.files.map(f => ({ name: f.originalname, type: f.mimetype, size: f.size, buffer: f.buffer }));
            await saveAnexos(id, anexosFromFiles);
        } else if (req.body && Array.isArray(req.body.anexos) && req.body.anexos.length > 0) {
            await saveAnexos(id, req.body.anexos);
        }

        res.json({ message: 'Pedido atualizado com sucesso.' });
    } catch (error) {
        next(error);
    }
});

// Helper: cria tabela de anexos se não existir e salva anexos base64 (conteudo) como BLOB
async function saveAnexos(pedidoId, anexosArray) {
    // cria tabela se necessário
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pedido_anexos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pedido_id INT NOT NULL,
            nome VARCHAR(255),
            tipo VARCHAR(100),
            tamanho BIGINT,
            conteudo LONGBLOB,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    for (const a of anexosArray) {
        try {
            let buffer = null;
            if (!a) continue;
            if (a.buffer) {
                buffer = Buffer.isBuffer(a.buffer) ? a.buffer : Buffer.from(a.buffer);
            } else if (a.content) {
                buffer = Buffer.from(a.content, 'base64');
            } else if (a.base64) {
                buffer = Buffer.from(a.base64, 'base64');
            }
            if (!buffer) continue;
            const tamanho = a.size || buffer.length;
            await pool.query('INSERT INTO pedido_anexos (pedido_id, nome, tipo, tamanho, conteudo) VALUES (?, ?, ?, ?, ?)', [pedidoId, a.name || null, a.type || null, tamanho, buffer]);
        } catch (err) {
            console.error('Falha ao salvar anexo:', err && err.message ? err.message : err);
        }
    }
}

// --- ROTAS DE ANEXOS DE PEDIDOS ---
// Lista metadados dos anexos de um pedido
apiVendasRouter.get('/pedidos/:id/anexos', async (req, res, next) => {
    try {
        const { id } = req.params;
        const user = req.user || {};
        // Busca pedido para checar permissões
        const [pedidoRows] = await pool.query('SELECT id, vendedor_id FROM pedidos WHERE id = ?', [id]);
        if (!pedidoRows || pedidoRows.length === 0) return res.status(404).json({ message: 'Pedido não encontrado.' });
        const pedido = pedidoRows[0];
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin && Number(pedido.vendedor_id) !== Number(user.id)) {
            return res.status(403).json({ message: 'Acesso negado: somente o vendedor responsável ou admin podem listar anexos.' });
        }

        // Se a tabela não existir, retorna lista vazia
        try {
            const [rows] = await pool.query('SELECT id, nome, tipo, tamanho, criado_em FROM pedido_anexos WHERE pedido_id = ? ORDER BY criado_em DESC', [id]);
            return res.json(rows || []);
        } catch (err) {
            if (err && err.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            throw err;
        }
    } catch (error) {
        next(error);
    }
});

// Faz download/stream de um anexo específico
apiVendasRouter.get('/pedidos/:id/anexos/:anexoId', async (req, res, next) => {
    try {
        const { id, anexoId } = req.params;
        const user = req.user || {};

        // Busca anexo junto com info do pedido para autorização
        const [rows] = await pool.query(
            `SELECT pa.id, pa.nome, pa.tipo, pa.tamanho, pa.conteudo, p.vendedor_id
             FROM pedido_anexos pa
             JOIN pedidos p ON p.id = pa.pedido_id
             WHERE pa.id = ? AND pa.pedido_id = ? LIMIT 1`,
            [anexoId, id]
        );

        if (!rows || rows.length === 0) return res.status(404).json({ message: 'Anexo não encontrado.' });
        const anexo = rows[0];
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin && Number(anexo.vendedor_id) !== Number(user.id)) {
            return res.status(403).json({ message: 'Acesso negado: somente o vendedor responsável ou admin podem baixar este anexo.' });
        }

        const buffer = anexo.conteudo; // Buffer vindo do MySQL
        const contentType = anexo.tipo || 'application/octet-stream';
        const filename = anexo.nome || `anexo-${anexo.id}`;

    res.setHeader('Content-Type', contentType);
    // Use buffer.length (bytes) for content length
    res.setHeader('Content-Length', buffer ? buffer.length : 0);
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    return res.send(buffer);
    } catch (error) {
        // Se a tabela não existir, responde 404
        if (error && error.code === 'ER_NO_SUCH_TABLE') return res.status(404).json({ message: 'Nenhum anexo encontrado.' });
        next(error);
    }
});

// Deleta um anexo (apenas admin ou vendedor responsável)
apiVendasRouter.delete('/pedidos/:id/anexos/:anexoId', async (req, res, next) => {
    try {
        const { id, anexoId } = req.params;
        const user = req.user || {};

        // Verifica se o anexo existe e obtém vendedor do pedido
        const [rows] = await pool.query(
            `SELECT pa.id, p.vendedor_id FROM pedido_anexos pa JOIN pedidos p ON p.id = pa.pedido_id WHERE pa.id = ? AND pa.pedido_id = ? LIMIT 1`,
            [anexoId, id]
        );
        if (!rows || rows.length === 0) return res.status(404).json({ message: 'Anexo não encontrado.' });
        const anexo = rows[0];
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin && Number(anexo.vendedor_id) !== Number(user.id)) {
            return res.status(403).json({ message: 'Acesso negado: somente o vendedor responsável ou admin podem deletar este anexo.' });
        }

        const [result] = await pool.query('DELETE FROM pedido_anexos WHERE id = ?', [anexoId]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Anexo não encontrado.' });
        res.status(204).send();
    } catch (error) {
        if (error && error.code === 'ER_NO_SUCH_TABLE') return res.status(404).json({ message: 'Nenhum anexo encontrado.' });
        next(error);
    }
});

// Deleta pedido: apenas admin ou vendedor atribuído
apiVendasRouter.delete('/pedidos/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query('SELECT vendedor_id FROM pedidos WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Pedido não encontrado.' });
        const pedido = rows[0];
        const user = req.user || {};
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin && Number(pedido.vendedor_id) !== Number(user.id)) {
            return res.status(403).json({ message: 'Acesso negado: somente o vendedor responsável ou admin podem excluir este pedido.' });
        }

        const [result] = await pool.query('DELETE FROM pedidos WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: "Pedido não encontrado." });
        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.put('/pedidos/:id/status', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        // Status aceitos pelo kanban e pelo sistema
        const validStatuses = [
            'orcamento', 'orçamento', 
            'analise', 'analise-credito', 
            'aprovado', 'pedido-aprovado', 
            'faturar',
            'faturado', 
            'entregue', 
            'cancelado',
            'recibo'
        ];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ message: 'Status inválido.' });
        }
        
        // Buscar status atual do pedido
        const [pedidoAtualRows] = await pool.query('SELECT id, status, vendedor_id FROM pedidos WHERE id = ?', [id]);
        if (pedidoAtualRows.length === 0) {
            return res.status(404).json({ message: 'Pedido não encontrado.' });
        }
        const statusAtual = pedidoAtualRows[0].status || 'orcamento';
        
        // Verificar se é admin (lista de admins por email/nome)
        const user = req.user || {};
        const adminsEmails = ['ti@aluforce.ind.br', 'andreia@aluforce.ind.br', 'douglas@aluforce.ind.br'];
        const adminsNomes = ['antonio egidio', 'andreia', 'douglas'];
        
        let isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        if (!isAdmin && user.email) {
            isAdmin = adminsEmails.includes(user.email.toLowerCase());
        }
        if (!isAdmin && user.nome) {
            // Normalizar nome removendo acentos para comparação
            const nomeMin = user.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            isAdmin = adminsNomes.some(admin => nomeMin.includes(admin));
        }
        
        console.log(`🔐 Verificação de permissão - Usuário: ${user.nome || user.email} | Admin: ${isAdmin} | Status desejado: ${status} | Status atual: ${statusAtual}`);
        
        // Vendedores (não-admin) só podem mover até "analise"
        if (!isAdmin) {
            // Verificar se é dono do pedido
            const pedido = pedidoAtualRows[0];
            if (pedido.vendedor_id && user.id && pedido.vendedor_id !== user.id) {
                return res.status(403).json({ message: 'Você só pode mover seus próprios pedidos.' });
            }
            
            // Vendedor só pode definir status até "analise" ou cancelar seus próprios pedidos
            const allowedForVendedor = ['orcamento', 'orçamento', 'analise', 'analise-credito', 'cancelado'];
            if (!allowedForVendedor.includes(status)) {
                return res.status(403).json({ message: 'Apenas administradores podem mover pedidos após "Análise de Crédito".' });
            }
        }

        const [result] = await pool.query('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Pedido não encontrado." });
        }
        
        // ========================================
        // ESTORNO DE ESTOQUE AO CANCELAR
        // Quando pedido é cancelado a partir de status que já tiveram baixa de estoque,
        // devolver os produtos ao estoque automaticamente.
        // Regra: só retorna estoque se cancelar a partir de "analise-credito" ou "pedido-aprovado"
        // ========================================
        let estornoEstoque = [];
        if (status === 'cancelado' && ['analise-credito', 'pedido-aprovado'].includes(statusAtual)) {
            try {
                console.log(`[ESTORNO_ESTOQUE] Cancelamento do pedido #${id} a partir de "${statusAtual}" — verificando itens para estorno...`);
                
                // Buscar movimentações de saída deste pedido
                const [movimentacoes] = await pool.query(`
                    SELECT id, codigo_material, quantidade, quantidade_anterior, quantidade_atual
                    FROM estoque_movimentacoes
                    WHERE documento_tipo = 'pedido' AND documento_id = ? AND tipo_movimento = 'saida'
                    ORDER BY id ASC
                `, [id]);
                
                if (movimentacoes.length > 0) {
                    for (const mov of movimentacoes) {
                        // Devolver ao estoque
                        const [produtos] = await pool.query(
                            'SELECT id, codigo, descricao, estoque_atual FROM produtos WHERE codigo = ? LIMIT 1',
                            [mov.codigo_material]
                        );
                        
                        if (produtos.length > 0) {
                            const produto = produtos[0];
                            const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                            const novoEstoque = estoqueAnterior + parseFloat(mov.quantidade);
                            
                            await pool.query('UPDATE produtos SET estoque_atual = ? WHERE id = ?', [novoEstoque, produto.id]);
                            
                            // Registrar movimentação de entrada (estorno)
                            await pool.query(`
                                INSERT INTO estoque_movimentacoes
                                (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                 documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                VALUES (?, 'entrada', 'cancelamento_pedido', ?, ?, ?, 'pedido_cancelado', ?, ?, ?, NOW())
                            `, [
                                mov.codigo_material, mov.quantidade, estoqueAnterior, novoEstoque,
                                id, user.id || null,
                                `Estorno automático - Cancelamento do Pedido #${id} - Devolvido ${mov.quantidade} ao estoque`
                            ]);
                            
                            estornoEstoque.push({
                                produto: produto.codigo,
                                descricao: produto.descricao,
                                quantidade_devolvida: parseFloat(mov.quantidade),
                                estoque_anterior: estoqueAnterior,
                                estoque_atual: novoEstoque
                            });
                            
                            console.log(`[ESTORNO_ESTOQUE] ✅ ${produto.codigo} — devolvido ${mov.quantidade} (${estoqueAnterior} → ${novoEstoque})`);
                        }
                    }
                    console.log(`[ESTORNO_ESTOQUE] ✅ ${estornoEstoque.length} produto(s) estornados para pedido #${id}`);
                } else {
                    // Sem movimentações registradas — tentar estorno direto pelos itens do pedido
                    const [itens] = await pool.query('SELECT codigo, descricao, quantidade, unidade FROM pedido_itens WHERE pedido_id = ?', [id]);
                    if (itens.length > 0) {
                        for (const item of itens) {
                            const codigoMaterial = item.codigo;
                            if (!codigoMaterial) continue;
                            
                            const [produtos] = await pool.query(
                                'SELECT id, codigo, descricao, estoque_atual FROM produtos WHERE codigo = ? OR sku = ? LIMIT 1',
                                [codigoMaterial, codigoMaterial]
                            );
                            
                            if (produtos.length > 0) {
                                const produto = produtos[0];
                                const quantidade = parseFloat(item.quantidade || 0);
                                if (quantidade <= 0) continue;
                                
                                const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                                const novoEstoque = estoqueAnterior + quantidade;
                                
                                await pool.query('UPDATE produtos SET estoque_atual = ? WHERE id = ?', [novoEstoque, produto.id]);
                                
                                await pool.query(`
                                    INSERT INTO estoque_movimentacoes
                                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                     documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                    VALUES (?, 'entrada', 'cancelamento_pedido', ?, ?, ?, 'pedido_cancelado', ?, ?, ?, NOW())
                                `, [
                                    produto.codigo, quantidade, estoqueAnterior, novoEstoque,
                                    id, user.id || null,
                                    `Estorno automático - Cancelamento do Pedido #${id} - ${quantidade}${item.unidade || 'UN'}`
                                ]);
                                
                                estornoEstoque.push({
                                    produto: produto.codigo,
                                    descricao: produto.descricao,
                                    quantidade_devolvida: quantidade,
                                    estoque_anterior: estoqueAnterior,
                                    estoque_atual: novoEstoque
                                });
                                
                                console.log(`[ESTORNO_ESTOQUE] ✅ ${produto.codigo} — devolvido ${quantidade} (fallback por itens)`);
                            }
                        }
                    }
                    console.log(`[ESTORNO_ESTOQUE] Estorno por itens: ${estornoEstoque.length} produto(s)`);
                }
            } catch (estornoErr) {
                console.error(`[ESTORNO_ESTOQUE] ❌ Erro ao estornar estoque do pedido #${id}:`, estornoErr.message);
                // Não falha a operação principal
            }
        }
        
        // ====== NOTIFICAÇÃO DE MOVIMENTAÇÃO ======
        try {
            // Buscar dados do pedido para contexto na notificação
            const [pedidoInfo] = await pool.query(`
                SELECT p.id, p.status, p.vendedor_id, c.nome as cliente_nome, u.nome as vendedor_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE p.id = ?
            `, [id]);
            
            const pedido = pedidoInfo[0] || {};
            const statusLabels = {
                'orcamento': 'Orçamento', 'orçamento': 'Orçamento',
                'analise': 'Análise de Crédito', 'analise-credito': 'Análise de Crédito',
                'aprovado': 'Aprovado', 'pedido-aprovado': 'Pedido Aprovado',
                'faturar': 'Faturar', 'faturado': 'Faturado',
                'entregue': 'Entregue', 'cancelado': 'Cancelado', 'recibo': 'Recibo'
            };
            const statusLabel = statusLabels[status] || status;
            const nomeUsuario = user.nome || user.email || 'Usuário';
            const clienteNome = pedido.cliente_nome || 'Cliente não definido';
            
            if (typeof global.createNotification === 'function') {
                global.createNotification(
                    status === 'cancelado' ? 'warning' : 'order',
                    `Pedido #${id} → ${statusLabel}`,
                    `${nomeUsuario} moveu pedido de ${clienteNome} para ${statusLabel}`,
                    { 
                        pedido_id: parseInt(id), 
                        status: status,
                        status_label: statusLabel,
                        user_id: user.id || null,
                        user_nome: nomeUsuario,
                        vendedor_id: pedido.vendedor_id || null,
                        vendedor_nome: pedido.vendedor_nome || null,
                        cliente_nome: clienteNome,
                        tipo: 'movimentacao_status'
                    }
                );
            }
        } catch (notifErr) {
            console.error('⚠️ Erro ao criar notificação de status:', notifErr.message);
        }
        
        res.json({ 
            message: 'Status atualizado com sucesso.',
            transicao: { de: statusAtual, para: status },
            estoque_estornado: estornoEstoque.length > 0,
            estorno_estoque: estornoEstoque
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/vendas/pedidos/:id - Atualização parcial do pedido (para o Kanban)
apiVendasRouter.patch('/pedidos/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        let updates = req.body;
        
        // Sanitizar valores: converter 'null' string para null real e tratar números inválidos
        const sanitizeValue = (val) => {
            if (val === 'null' || val === 'undefined' || val === '') return null;
            return val;
        };
        
        const sanitizeNumber = (val) => {
            if (val === 'null' || val === 'undefined' || val === '' || val === null) return null;
            const num = parseFloat(val);
            return isNaN(num) ? null : num;
        };
        
        // Aplicar sanitização em todos os campos
        Object.keys(updates).forEach(key => {
            updates[key] = sanitizeValue(updates[key]);
        });
        
        console.log(`📝 PATCH /pedidos/${id} - Dados recebidos:`, updates);
        
        // Verificar se pedido existe
        const [existingRows] = await pool.query('SELECT * FROM pedidos WHERE id = ?', [id]);
        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Pedido não encontrado.' });
        }
        
        const existing = existingRows[0];
        const user = req.user || {};
        const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
        
        // Verificar permissão
        if (!isAdmin && existing.vendedor_id && Number(existing.vendedor_id) !== Number(user.id)) {
            return res.status(403).json({ message: 'Acesso negado: somente o vendedor responsável ou admin podem editar este pedido.' });
        }
        
        // Construir query de atualização dinâmica
        // Colunas que existem na tabela pedidos: vendedor_id, observacao, status, valor, frete, descricao, prioridade
        const fieldsToUpdate = [];
        const values = [];
        
        // Atualizar vendedor_id se vendedor_nome foi fornecido
        if (updates.vendedor_nome !== undefined && updates.vendedor_nome !== '') {
            // Buscar vendedor_id pelo nome
            const [vendedorRows] = await pool.query(
                'SELECT id, nome FROM usuarios WHERE nome LIKE ? OR apelido LIKE ? LIMIT 1', 
                [`%${updates.vendedor_nome}%`, `%${updates.vendedor_nome}%`]
            );
            if (vendedorRows.length > 0) {
                fieldsToUpdate.push('vendedor_id = ?');
                values.push(vendedorRows[0].id);
                console.log(`✅ Vendedor encontrado: "${updates.vendedor_nome}" -> ID ${vendedorRows[0].id} (${vendedorRows[0].nome})`);
            } else {
                console.log(`⚠️ Vendedor não encontrado: "${updates.vendedor_nome}"`);
            }
        }
        
        // Observação existe na tabela
        if (updates.observacao !== undefined) {
            fieldsToUpdate.push('observacao = ?');
            values.push(updates.observacao);
        }
        
        // Status existe na tabela - com VALIDAÇÃO de transições permitidas
        if (updates.status !== undefined) {
            const validStatuses = ['orcamento', 'orçamento', 'analise', 'analise-credito', 'aprovado', 'pedido-aprovado', 'faturar', 'faturado', 'entregue', 'cancelado', 'recibo'];
            
            if (!validStatuses.includes(updates.status)) {
                return res.status(400).json({ message: `Status inválido: "${updates.status}". Valores permitidos: ${validStatuses.join(', ')}` });
            }
            
            // Máquina de estados: transições proibidas
            const statusAtual = existing.status;
            const TRANSICOES_PROIBIDAS = {
                'cancelado': ['aprovado', 'faturado', 'entregue', 'faturar', 'recibo'], // Cancelado não volta
                'faturado': ['orcamento', 'orçamento', 'analise', 'analise-credito'],     // Faturado não regride
                'entregue': ['orcamento', 'orçamento', 'analise', 'analise-credito', 'aprovado', 'faturar'] // Entregue não regride
            };
            
            const proibidas = TRANSICOES_PROIBIDAS[statusAtual] || [];
            if (proibidas.includes(updates.status) && !isAdmin) {
                return res.status(403).json({ 
                    message: `Transição de status não permitida: "${statusAtual}" → "${updates.status}". Contate um administrador.` 
                });
            }
            
            // Mesmo admin não pode reverter cancelado para faturado/entregue
            if (statusAtual === 'cancelado' && ['faturado', 'entregue', 'recibo'].includes(updates.status)) {
                return res.status(400).json({ 
                    message: 'Pedido cancelado não pode ser revertido para faturado/entregue. Crie um novo pedido.' 
                });
            }
            
            fieldsToUpdate.push('status = ?');
            values.push(updates.status);
        }
        
        // Valor existe na tabela (campo numérico)
        if (updates.valor !== undefined) {
            fieldsToUpdate.push('valor = ?');
            values.push(sanitizeNumber(updates.valor));
        }
        
        // Frete existe na tabela (campo numérico)
        if (updates.frete !== undefined) {
            fieldsToUpdate.push('frete = ?');
            values.push(sanitizeNumber(updates.frete));
        }
        
        // Descrição existe na tabela
        if (updates.descricao !== undefined) {
            fieldsToUpdate.push('descricao = ?');
            values.push(updates.descricao);
        }
        
        // Prioridade existe na tabela
        if (updates.prioridade !== undefined) {
            fieldsToUpdate.push('prioridade = ?');
            values.push(updates.prioridade);
        }
        
        // Cliente_id existe na tabela (campo numérico)
        if (updates.cliente_id !== undefined) {
            fieldsToUpdate.push('cliente_id = ?');
            values.push(sanitizeNumber(updates.cliente_id));
            console.log(`✅ Cliente_id atualizado para: ${updates.cliente_id}`);
        }
        
        // Empresa_id existe na tabela (campo numérico)
        if (updates.empresa_id !== undefined) {
            fieldsToUpdate.push('empresa_id = ?');
            values.push(sanitizeNumber(updates.empresa_id));
            console.log(`✅ Empresa_id atualizado para: ${updates.empresa_id}`);
        }
        
        // Transportadora - salvar em ambos os campos (transportadora e transportadora_nome)
        if (updates.transportadora !== undefined || updates.transportadora_nome !== undefined) {
            const transportadoraValor = updates.transportadora || updates.transportadora_nome;
            fieldsToUpdate.push('transportadora_nome = ?');
            values.push(transportadoraValor);
            fieldsToUpdate.push('transportadora = ?');
            values.push(transportadoraValor);
            console.log(`✅ Transportadora atualizada para: ${transportadoraValor}`);
        }
        
        // NF - salvar em nf
        if (updates.nf !== undefined) {
            fieldsToUpdate.push('nf = ?');
            values.push(updates.nf);
            console.log(`✅ NF atualizada para: ${updates.nf}`);
        }
        
        // Parcelas/Condição de Pagamento - salvar em condicao_pagamento e condicoes_pagamento
        if (updates.parcelas !== undefined || updates.condicao_pagamento !== undefined) {
            const condicaoValor = updates.condicao_pagamento || updates.parcelas;
            fieldsToUpdate.push('condicao_pagamento = ?');
            values.push(condicaoValor);
            fieldsToUpdate.push('condicoes_pagamento = ?');
            values.push(condicaoValor);
            console.log(`✅ Condição de pagamento atualizada para: ${condicaoValor}`);
        }
        
        // ========== CAMPOS ADICIONAIS DE TRANSPORTE ==========
        if (updates.tipo_frete !== undefined) {
            fieldsToUpdate.push('tipo_frete = ?');
            values.push(updates.tipo_frete);
        }
        if (updates.metodo_envio !== undefined) {
            fieldsToUpdate.push('metodo_envio = ?');
            values.push(updates.metodo_envio);
        }
        if (updates.redespacho !== undefined) {
            fieldsToUpdate.push('redespacho = ?');
            values.push(updates.redespacho === '1' || updates.redespacho === true || updates.redespacho === 'true');
        }
        
        // ========== CAMPOS DE ENTREGA ==========
        if (updates.endereco_entrega !== undefined) {
            fieldsToUpdate.push('endereco_entrega = ?');
            values.push(updates.endereco_entrega);
        }
        if (updates.municipio_entrega !== undefined) {
            fieldsToUpdate.push('municipio_entrega = ?');
            values.push(updates.municipio_entrega);
        }
        if (updates.prazo_entrega !== undefined) {
            fieldsToUpdate.push('prazo_entrega = ?');
            values.push(updates.prazo_entrega);
        }
        if (updates.data_previsao !== undefined || updates.previsao_faturamento !== undefined) {
            fieldsToUpdate.push('data_previsao = ?');
            values.push(updates.data_previsao || updates.previsao_faturamento);
        }
        
        // ========== CAMPOS DE VEÍCULO/TRANSPORTADORA ==========
        if (updates.placa_veiculo !== undefined) {
            fieldsToUpdate.push('placa_veiculo = ?');
            values.push(updates.placa_veiculo);
        }
        if (updates.veiculo_uf !== undefined) {
            fieldsToUpdate.push('veiculo_uf = ?');
            values.push(updates.veiculo_uf);
        }
        if (updates.rntrc !== undefined) {
            fieldsToUpdate.push('rntrc = ?');
            values.push(updates.rntrc);
        }
        
        // ========== CAMPOS DE VOLUMES/PESO ==========
        if (updates.qtd_volumes !== undefined) {
            fieldsToUpdate.push('qtd_volumes = ?');
            values.push(sanitizeNumber(updates.qtd_volumes));
        }
        if (updates.especie_volumes !== undefined) {
            fieldsToUpdate.push('especie_volumes = ?');
            values.push(updates.especie_volumes);
        }
        if (updates.marca_volumes !== undefined) {
            fieldsToUpdate.push('marca_volumes = ?');
            values.push(updates.marca_volumes);
        }
        if (updates.numeracao_volumes !== undefined) {
            fieldsToUpdate.push('numeracao_volumes = ?');
            values.push(updates.numeracao_volumes);
        }
        if (updates.peso_liquido !== undefined) {
            fieldsToUpdate.push('peso_liquido = ?');
            values.push(sanitizeNumber(updates.peso_liquido));
        }
        if (updates.peso_bruto !== undefined) {
            fieldsToUpdate.push('peso_bruto = ?');
            values.push(sanitizeNumber(updates.peso_bruto));
        }
        
        // ========== CAMPOS DE VALORES ADICIONAIS ==========
        if (updates.valor_seguro !== undefined) {
            fieldsToUpdate.push('valor_seguro = ?');
            values.push(sanitizeNumber(updates.valor_seguro));
        }
        if (updates.outras_despesas !== undefined) {
            fieldsToUpdate.push('outras_despesas = ?');
            values.push(sanitizeNumber(updates.outras_despesas));
        }
        if (updates.numero_lacre !== undefined) {
            fieldsToUpdate.push('numero_lacre = ?');
            values.push(updates.numero_lacre);
        }
        if (updates.codigo_rastreio !== undefined) {
            fieldsToUpdate.push('codigo_rastreio = ?');
            values.push(updates.codigo_rastreio);
        }
        
        // ========== CAMPOS DE OBSERVAÇÕES E INFORMAÇÕES ==========
        if (updates.observacao_cliente !== undefined) {
            fieldsToUpdate.push('observacao_cliente = ?');
            values.push(updates.observacao_cliente);
        }
        if (updates.info_complementar !== undefined) {
            fieldsToUpdate.push('info_complementar = ?');
            values.push(updates.info_complementar);
        }
        if (updates.campos_obs_nfe !== undefined) {
            fieldsToUpdate.push('campos_obs_nfe = ?');
            values.push(updates.campos_obs_nfe);
        }
        if (updates.dados_adicionais_nf !== undefined) {
            fieldsToUpdate.push('dados_adicionais_nf = ?');
            values.push(updates.dados_adicionais_nf);
        }
        
        // ========== CAMPOS ADICIONAIS ==========
        if (updates.projeto !== undefined) {
            fieldsToUpdate.push('projeto = ?');
            values.push(updates.projeto);
        }
        if (updates.contato !== undefined) {
            fieldsToUpdate.push('contato = ?');
            values.push(updates.contato);
        }
        if (updates.categoria !== undefined) {
            fieldsToUpdate.push('categoria = ?');
            values.push(updates.categoria);
        }
        if (updates.conta_corrente !== undefined) {
            fieldsToUpdate.push('conta_corrente = ?');
            values.push(updates.conta_corrente);
        }
        if (updates.pedido_cliente !== undefined) {
            fieldsToUpdate.push('pedido_cliente = ?');
            values.push(updates.pedido_cliente);
        }
        if (updates.contrato_venda !== undefined) {
            fieldsToUpdate.push('contrato_venda = ?');
            values.push(updates.contrato_venda);
        }
        if (updates.cenario_fiscal !== undefined) {
            fieldsToUpdate.push('cenario_fiscal = ?');
            values.push(updates.cenario_fiscal);
        }
        if (updates.departamento !== undefined) {
            fieldsToUpdate.push('departamento = ?');
            values.push(updates.departamento);
        }
        
        // ========== CAMPOS DE ORIGEM E EMAIL ==========
        if (updates.origem !== undefined) {
            fieldsToUpdate.push('origem = ?');
            values.push(updates.origem);
        }
        if (updates.email_cliente !== undefined) {
            fieldsToUpdate.push('email_cliente = ?');
            values.push(updates.email_cliente);
        }
        if (updates.email_assunto !== undefined) {
            fieldsToUpdate.push('email_assunto = ?');
            values.push(updates.email_assunto);
        }
        if (updates.email_mensagem !== undefined) {
            fieldsToUpdate.push('email_mensagem = ?');
            values.push(updates.email_mensagem);
        }
        
        // ========== CAMPOS DE DESCONTO E PARCELAS ==========
        if (updates.desconto !== undefined) {
            fieldsToUpdate.push('desconto = ?');
            values.push(sanitizeNumber(updates.desconto));
        }
        if (updates.parcelas !== undefined) {
            fieldsToUpdate.push('parcelas = ?');
            values.push(updates.parcelas);
        }
        
        // ========== CAMPO VENDEDOR NOME ==========
        if (updates.vendedor_nome !== undefined) {
            fieldsToUpdate.push('vendedor_nome = ?');
            values.push(updates.vendedor_nome);
        }
        
        // ========== TRANSPORTADORA ID ==========
        if (updates.transportadora_id !== undefined) {
            fieldsToUpdate.push('transportadora_id = ?');
            values.push(sanitizeNumber(updates.transportadora_id));
        }
        
        // Se não há campos para atualizar
        if (fieldsToUpdate.length === 0) {
            console.log(`⚠️ Nenhum campo válido para atualizar`);
            return res.status(400).json({ message: 'Nenhum campo válido para atualizar.' });
        }
        
        values.push(id);
        
        const query = `UPDATE pedidos SET ${fieldsToUpdate.join(', ')} WHERE id = ?`;
        console.log(`📝 Query: ${query}`);
        console.log(`📝 Values:`, values);
        
        const [result] = await pool.query(query, values);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Pedido não encontrado.' });
        }
        
        console.log(`✅ Pedido ${id} atualizado com sucesso! (${result.affectedRows} linha(s) afetada(s))`);
        
        // ========================================
        // ESTORNO DE ESTOQUE AO CANCELAR (via PATCH/Kanban)
        // ========================================
        let estornoEstoque = [];
        if (updates.status === 'cancelado' && ['analise-credito', 'pedido-aprovado'].includes(existing.status)) {
            try {
                console.log(`[ESTORNO_ESTOQUE] Cancelamento via PATCH do pedido #${id} a partir de "${existing.status}"`);
                
                const [movimentacoes] = await pool.query(`
                    SELECT id, codigo_material, quantidade, quantidade_anterior, quantidade_atual
                    FROM estoque_movimentacoes
                    WHERE documento_tipo = 'pedido' AND documento_id = ? AND tipo_movimento = 'saida'
                    ORDER BY id ASC
                `, [id]);
                
                if (movimentacoes.length > 0) {
                    for (const mov of movimentacoes) {
                        const [produtos] = await pool.query(
                            'SELECT id, codigo, descricao, estoque_atual FROM produtos WHERE codigo = ? LIMIT 1',
                            [mov.codigo_material]
                        );
                        if (produtos.length > 0) {
                            const produto = produtos[0];
                            const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                            const novoEstoque = estoqueAnterior + parseFloat(mov.quantidade);
                            
                            await pool.query('UPDATE produtos SET estoque_atual = ? WHERE id = ?', [novoEstoque, produto.id]);
                            await pool.query(`
                                INSERT INTO estoque_movimentacoes
                                (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                 documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                VALUES (?, 'entrada', 'cancelamento_pedido', ?, ?, ?, 'pedido_cancelado', ?, ?, ?, NOW())
                            `, [
                                mov.codigo_material, mov.quantidade, estoqueAnterior, novoEstoque,
                                id, user.id || null,
                                `Estorno automático - Cancelamento do Pedido #${id} - Devolvido ${mov.quantidade} ao estoque`
                            ]);
                            
                            estornoEstoque.push({ produto: produto.codigo, descricao: produto.descricao,
                                quantidade_devolvida: parseFloat(mov.quantidade), estoque_anterior: estoqueAnterior, estoque_atual: novoEstoque });
                            console.log(`[ESTORNO_ESTOQUE] ✅ ${produto.codigo} — devolvido ${mov.quantidade}`);
                        }
                    }
                } else {
                    const [itens] = await pool.query('SELECT codigo, descricao, quantidade, unidade FROM pedido_itens WHERE pedido_id = ?', [id]);
                    for (const item of itens) {
                        if (!item.codigo) continue;
                        const [produtos] = await pool.query('SELECT id, codigo, descricao, estoque_atual FROM produtos WHERE codigo = ? OR sku = ? LIMIT 1', [item.codigo, item.codigo]);
                        if (produtos.length > 0) {
                            const produto = produtos[0];
                            const quantidade = parseFloat(item.quantidade || 0);
                            if (quantidade <= 0) continue;
                            const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                            const novoEstoque = estoqueAnterior + quantidade;
                            
                            await pool.query('UPDATE produtos SET estoque_atual = ? WHERE id = ?', [novoEstoque, produto.id]);
                            await pool.query(`
                                INSERT INTO estoque_movimentacoes
                                (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                 documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                VALUES (?, 'entrada', 'cancelamento_pedido', ?, ?, ?, 'pedido_cancelado', ?, ?, ?, NOW())
                            `, [produto.codigo, quantidade, estoqueAnterior, novoEstoque, id, user.id || null,
                                `Estorno automático - Cancelamento do Pedido #${id} - ${quantidade}${item.unidade || 'UN'}`]);
                            
                            estornoEstoque.push({ produto: produto.codigo, descricao: produto.descricao,
                                quantidade_devolvida: quantidade, estoque_anterior: estoqueAnterior, estoque_atual: novoEstoque });
                        }
                    }
                }
                if (estornoEstoque.length > 0) {
                    console.log(`[ESTORNO_ESTOQUE] ✅ ${estornoEstoque.length} produto(s) devolvidos ao estoque (PATCH)`);
                }
            } catch (estornoErr) {
                console.error(`[ESTORNO_ESTOQUE] ❌ Erro ao estornar estoque:`, estornoErr.message);
            }
        }
        
        // ====== NOTIFICAÇÃO DE MOVIMENTAÇÃO (PATCH) ======
        if (updates.status !== undefined) {
            try {
                const statusLabels = {
                    'orcamento': 'Orçamento', 'orçamento': 'Orçamento',
                    'analise': 'Análise de Crédito', 'analise-credito': 'Análise de Crédito',
                    'aprovado': 'Aprovado', 'pedido-aprovado': 'Pedido Aprovado',
                    'faturar': 'Faturar', 'faturado': 'Faturado',
                    'entregue': 'Entregue', 'cancelado': 'Cancelado', 'recibo': 'Recibo'
                };
                const statusLabel = statusLabels[updates.status] || updates.status;
                const statusAnteriorLabel = statusLabels[existing.status] || existing.status;
                const nomeUsuario = user.nome || user.email || 'Usuário';
                
                // Buscar nome do cliente
                let clienteNome = 'Cliente não definido';
                try {
                    const [cliRows] = await pool.query('SELECT nome FROM clientes WHERE id = ?', [existing.cliente_id]);
                    if (cliRows.length > 0) clienteNome = cliRows[0].nome;
                } catch(e) {}
                
                if (typeof global.createNotification === 'function') {
                    global.createNotification(
                        updates.status === 'cancelado' ? 'warning' : 'order',
                        `Pedido #${id} → ${statusLabel}`,
                        `${nomeUsuario} moveu pedido de ${clienteNome} de ${statusAnteriorLabel} para ${statusLabel}`,
                        { 
                            pedido_id: parseInt(id), 
                            status: updates.status,
                            status_anterior: existing.status,
                            status_label: statusLabel,
                            user_id: user.id || null,
                            user_nome: nomeUsuario,
                            vendedor_id: existing.vendedor_id || null,
                            vendedor_nome: existing.vendedor_nome || null,
                            cliente_nome: clienteNome,
                            tipo: 'movimentacao_status'
                        }
                    );
                }
            } catch (notifErr) {
                console.error('⚠️ Erro ao criar notificação de status (PATCH):', notifErr.message);
            }
        }
        
        // Buscar pedido atualizado para retornar
        const [updatedRows] = await pool.query(`
            SELECT p.*, 
                   c.nome as cliente_nome,
                   u.nome as vendedor_nome
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.id = ?
        `, [id]);
        
        res.json({ 
            message: 'Pedido atualizado com sucesso.',
            pedido: updatedRows[0] || null
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar pedido (PATCH):', error);
        next(error);
    }
});

// --- ROTAS DE ITENS DO PEDIDO ---
// Helper: criar tabela de itens se não existir
async function ensurePedidoItensTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pedido_itens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pedido_id INT NOT NULL,
            codigo VARCHAR(100),
            descricao TEXT,
            quantidade DECIMAL(15,3) DEFAULT 1,
            quantidade_parcial DECIMAL(15,3) DEFAULT 0,
            unidade VARCHAR(20) DEFAULT 'UN',
            local_estoque VARCHAR(255) DEFAULT 'PADRAO - Local de Estoque Padrão',
            preco_unitario DECIMAL(18,2) DEFAULT 0,
            desconto DECIMAL(18,2) DEFAULT 0,
            total DECIMAL(18,2) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
            INDEX idx_pedido_id (pedido_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
}

// NOTA: Rota GET /pedidos/:id/itens já definida anteriormente (linha ~800) com authenticateToken
// Esta rota duplicada foi removida para evitar conflitos

// Helper: verificar se usuário pode editar pedido com status faturado/recibo
async function verificarPermissaoEdicaoPedido(pedidoId, userEmail) {
    const [pedido] = await pool.query('SELECT status FROM pedidos WHERE id = ?', [pedidoId]);
    if (pedido.length === 0) {
        return { permitido: false, erro: 'Pedido não encontrado.' };
    }
    
    const status = (pedido[0].status || '').toLowerCase();
    const statusBloqueados = ['faturado', 'recibo'];
    
    // Apenas ti@aluforce.ind.br pode editar pedidos faturados ou com recibo
    if (statusBloqueados.includes(status) && userEmail !== 'ti@aluforce.ind.br') {
        return { 
            permitido: false, 
            erro: `Pedido com status "${pedido[0].status}" só pode ser editado por ti@aluforce.ind.br` 
        };
    }
    
    return { permitido: true };
}

// Adicionar item ao pedido
apiVendasRouter.post('/pedidos/:id/itens', async (req, res, next) => {
    try {
        await ensurePedidoItensTable();
        const { id } = req.params;
        
        // Verificar permissão para editar pedidos faturados/recibo
        const userEmail = req.user?.email || '';
        const permissao = await verificarPermissaoEdicaoPedido(id, userEmail);
        if (!permissao.permitido) {
            return res.status(403).json({ message: permissao.erro });
        }
        
        const { codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto,
                produto_id, valor_ipi, valor_icms_st, aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes, preco_custo } = req.body;
        
        if (!codigo || !descricao) {
            return res.status(400).json({ message: 'Código e descrição são obrigatórios.' });
        }
        
        const qty = parseFloat(quantidade) || 1;
        const qtyParcial = parseFloat(quantidade_parcial) || 0;
        const preco = parseFloat(preco_unitario) || 0;
        const desc = parseFloat(desconto) || 0;
        const vIPI = parseFloat(valor_ipi) || 0;
        const vICMSST = parseFloat(valor_icms_st) || 0;
        const subtotal = (qty * preco) - desc;
        
        const [result] = await pool.query(
            `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal,
             produto_id, valor_ipi, valor_icms_st, aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes, preco_custo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, codigo, descricao, qty, qtyParcial, unidade || 'UN', local_estoque || 'PADRAO', preco, desc, subtotal,
             produto_id || null, vIPI, vICMSST, parseFloat(aliquota_ipi) || 0, parseFloat(aliquota_icms) || 0, parseFloat(mva_st) || 0,
             cfop || null, cenario_fiscal || null, observacoes || null, parseFloat(preco_custo) || 0]
        );
        
        // Atualizar valor total do pedido
        await atualizarTotalPedido(id);
        
        // Emitir evento de atualização em tempo real via Socket.IO
        const [pedidoAtualizado] = await pool.query('SELECT id, valor FROM pedidos WHERE id = ?', [id]);
        if (io && pedidoAtualizado.length > 0) {
            io.emit('pedido_atualizado', { 
                pedidoId: parseInt(id), 
                valor: pedidoAtualizado[0].valor,
                acao: 'item_adicionado'
            });
        }
        
        await logAudit(req.user?.id, 'item_added', 'pedido_itens', result.insertId, { pedido_id: id, codigo });
        
        res.status(201).json({ message: 'Item adicionado com sucesso!', id: result.insertId });
    } catch (error) {
        next(error);
    }
});

// Atualizar item do pedido
apiVendasRouter.put('/pedidos/:pedidoId/itens/:itemId', async (req, res, next) => {
    try {
        await ensurePedidoItensTable();
        const { pedidoId, itemId } = req.params;
        
        // Verificar permissão para editar pedidos faturados/recibo
        const userEmail = req.user?.email || '';
        const permissao = await verificarPermissaoEdicaoPedido(pedidoId, userEmail);
        if (!permissao.permitido) {
            return res.status(403).json({ message: permissao.erro });
        }
        
        const { codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto,
                produto_id, valor_ipi, valor_icms_st, aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes, preco_custo } = req.body;
        
        const qty = parseFloat(quantidade) || 1;
        const qtyParcial = parseFloat(quantidade_parcial) || 0;
        const preco = parseFloat(preco_unitario) || 0;
        const desc = parseFloat(desconto) || 0;
        const vIPI = parseFloat(valor_ipi) || 0;
        const vICMSST = parseFloat(valor_icms_st) || 0;
        const subtotal = (qty * preco) - desc;
        
        const [result] = await pool.query(
            `UPDATE pedido_itens SET codigo = ?, descricao = ?, quantidade = ?, quantidade_parcial = ?, unidade = ?, local_estoque = ?, preco_unitario = ?, desconto = ?, subtotal = ?,
             produto_id = ?, valor_ipi = ?, valor_icms_st = ?, aliquota_ipi = ?, aliquota_icms = ?, mva_st = ?,
             cfop = ?, cenario_fiscal = ?, observacoes = ?, preco_custo = ?
             WHERE id = ? AND pedido_id = ?`,
            [codigo, descricao, qty, qtyParcial, unidade || 'UN', local_estoque || 'PADRAO', preco, desc, subtotal,
             produto_id || null, vIPI, vICMSST, parseFloat(aliquota_ipi) || 0, parseFloat(aliquota_icms) || 0, parseFloat(mva_st) || 0,
             cfop || null, cenario_fiscal || null, observacoes || null, parseFloat(preco_custo) || 0, itemId, pedidoId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Item não encontrado.' });
        }
        
        // Atualizar valor total do pedido
        await atualizarTotalPedido(pedidoId);
        
        // Emitir evento de atualização em tempo real via Socket.IO
        const [pedidoAtualizado] = await pool.query('SELECT id, valor FROM pedidos WHERE id = ?', [pedidoId]);
        if (io && pedidoAtualizado.length > 0) {
            io.emit('pedido_atualizado', { 
                pedidoId: parseInt(pedidoId), 
                valor: pedidoAtualizado[0].valor,
                acao: 'item_atualizado'
            });
        }
        
        await logAudit(req.user?.id, 'item_updated', 'pedido_itens', itemId, { pedido_id: pedidoId, codigo });
        
        res.json({ message: 'Item atualizado com sucesso!' });
    } catch (error) {
        next(error);
    }
});

// Buscar item específico do pedido (GET)
apiVendasRouter.get('/pedidos/:pedidoId/itens/:itemId', async (req, res, next) => {
    try {
        await ensurePedidoItensTable();
        const { pedidoId, itemId } = req.params;
        
        const [rows] = await pool.query(
            'SELECT * FROM pedido_itens WHERE id = ? AND pedido_id = ?',
            [itemId, pedidoId]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Item não encontrado.' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        next(error);
    }
});

// Excluir item do pedido
apiVendasRouter.delete('/pedidos/:pedidoId/itens/:itemId', async (req, res, next) => {
    try {
        await ensurePedidoItensTable();
        const { pedidoId, itemId } = req.params;
        
        // Verificar permissão para editar pedidos faturados/recibo
        const userEmail = req.user?.email || '';
        const permissao = await verificarPermissaoEdicaoPedido(pedidoId, userEmail);
        if (!permissao.permitido) {
            return res.status(403).json({ message: permissao.erro });
        }
        
        const [result] = await pool.query(
            'DELETE FROM pedido_itens WHERE id = ? AND pedido_id = ?',
            [itemId, pedidoId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Item não encontrado.' });
        }
        
        // Atualizar valor total do pedido
        await atualizarTotalPedido(pedidoId);
        
        // Emitir evento de atualização em tempo real via Socket.IO
        const [pedidoAtualizado] = await pool.query('SELECT id, valor FROM pedidos WHERE id = ?', [pedidoId]);
        if (io && pedidoAtualizado.length > 0) {
            io.emit('pedido_atualizado', { 
                pedidoId: parseInt(pedidoId), 
                valor: pedidoAtualizado[0].valor,
                acao: 'item_excluido'
            });
        }
        
        await logAudit(req.user?.id, 'item_deleted', 'pedido_itens', itemId, { pedido_id: pedidoId });
        
        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

// Helper: atualizar valor total do pedido baseado nos itens
async function atualizarTotalPedido(pedidoId) {
    try {
        console.log(`🔄 Iniciando atualização do total do pedido ${pedidoId}...`);
        
        // Buscar soma dos subtotais e impostos dos itens
        const [rows] = await pool.query(
            'SELECT COALESCE(SUM(subtotal), 0) AS total_subtotais, COALESCE(SUM(valor_ipi), 0) AS total_ipi, COALESCE(SUM(valor_icms_st), 0) AS total_icms_st FROM pedido_itens WHERE pedido_id = ?',
            [pedidoId]
        );
        const totalSubtotais = parseFloat(rows[0]?.total_subtotais) || 0;
        const totalIPI = parseFloat(rows[0]?.total_ipi) || 0;
        const totalICMSST = parseFloat(rows[0]?.total_icms_st) || 0;
        
        // Buscar frete e desconto_pct do pedido
        const [pedidoRows] = await pool.query('SELECT COALESCE(frete, 0) AS frete, COALESCE(desconto_pct, 0) AS desconto_pct FROM pedidos WHERE id = ?', [pedidoId]);
        const frete = parseFloat(pedidoRows[0]?.frete) || 0;
        const descontoPct = parseFloat(pedidoRows[0]?.desconto_pct) || 0;
        
        // Calcular desconto geral em R$ (% sobre subtotal líquido dos itens)
        const descontoValor = totalSubtotais * (descontoPct / 100);
        
        const novoTotal = totalSubtotais - descontoValor + totalIPI + totalICMSST + frete;
        
        console.log(`📦 Pedido ${pedidoId}: subtotais=R$${totalSubtotais.toFixed(2)}, desconto=${descontoPct}% (R$${descontoValor.toFixed(2)}), IPI=R$${totalIPI.toFixed(2)}, ICMS ST=R$${totalICMSST.toFixed(2)}, frete=R$${frete.toFixed(2)} => total=R$${novoTotal.toFixed(2)}`);
        
        // Atualizar o valor, impostos e desconto calculado no pedido
        const [updateResult] = await pool.query(
            'UPDATE pedidos SET valor = ?, total_ipi = ?, total_icms_st = ?, desconto = ? WHERE id = ?', 
            [novoTotal, totalIPI, totalICMSST, descontoValor, pedidoId]
        );
        
        console.log(`✅ Pedido ${pedidoId} atualizado: valor = R$${novoTotal.toFixed(2)} (${updateResult.affectedRows} linhas afetadas)`);
        
        // Verificar se o update funcionou
        const [verificacao] = await pool.query('SELECT valor FROM pedidos WHERE id = ?', [pedidoId]);
        console.log(`🔍 Verificação: Valor no banco = R$${verificacao[0]?.valor}`);
        
        return novoTotal;
    } catch (e) {
        console.error('❌ Erro ao atualizar total do pedido:', e.message);
        throw e;
    }
}

// --- ROTAS DE HISTÓRICO DO PEDIDO ---
// Helper: criar tabela de histórico específico do pedido
async function ensurePedidoHistoricoTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pedido_historico (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pedido_id INT NOT NULL,
            user_id INT NULL,
            user_name VARCHAR(255),
            action VARCHAR(100) NOT NULL,
            descricao TEXT,
            meta JSON NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
            INDEX idx_pedido_id (pedido_id),
            INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
}

// Registrar histórico do pedido
async function registrarHistorico(pedidoId, userId, userName, action, descricao, meta = null) {
    try {
        await ensurePedidoHistoricoTable();
        await pool.query(
            'INSERT INTO pedido_historico (pedido_id, user_id, user_name, action, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
            [pedidoId, userId || null, userName || 'Sistema', action, descricao, meta ? JSON.stringify(meta) : null]
        );
    } catch (e) {
        console.warn('Erro ao registrar histórico:', e.message);
    }
}

// NOTA: Rotas de histórico já definidas antes do middleware de autenticação (linha ~891)
// As rotas abaixo foram movidas para garantir acesso sem token obrigatório

// Faturar pedido e gerar NFe automaticamente
apiVendasRouter.post('/pedidos/:id/faturar', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { gerarNFe = true } = req.body; // Opção para gerar NFe automaticamente
        const user = req.user || {};
        
        // Verificar se pedido existe
        const [pedidoRows] = await pool.query('SELECT * FROM pedidos WHERE id = ?', [id]);
        if (pedidoRows.length === 0) {
            return res.status(404).json({ message: 'Pedido não encontrado.' });
        }
        
        const pedido = pedidoRows[0];
        
        // Buscar itens do pedido
        const [itensRows] = await pool.query('SELECT * FROM pedido_itens WHERE pedido_id = ?', [id]);
        
        // Buscar dados do cliente
        const [clienteRows] = await pool.query('SELECT * FROM clientes WHERE id = ?', [pedido.cliente_id]);
        const cliente = clienteRows[0] || {};
        
        let novaNf = null;
        let nfeData = null;
        
        // Tentar gerar NFe automaticamente se solicitado
        if (gerarNFe && itensRows.length > 0) {
            try {
                // Preparar dados para o módulo NFe
                const nfePayload = {
                    pedido_id: id,
                    cliente: {
                        nome: cliente.nome || pedido.cliente,
                        cpf_cnpj: cliente.cpf_cnpj || cliente.cnpj,
                        email: cliente.email,
                        telefone: cliente.telefone,
                        endereco: cliente.endereco,
                        numero: cliente.numero,
                        complemento: cliente.complemento,
                        bairro: cliente.bairro,
                        cidade: cliente.cidade,
                        uf: cliente.uf,
                        cep: cliente.cep
                    },
                    produtos: itensRows.map(item => ({
                        codigo: item.codigo_produto,
                        descricao: item.descricao || item.produto,
                        ncm: item.ncm || '00000000',
                        quantidade: item.quantidade,
                        valor_unitario: item.valor_unitario,
                        valor_total: (parseFloat(item.quantidade) * parseFloat(item.valor_unitario))
                    })),
                    valor_total: pedido.valor,
                    observacoes: pedido.observacoes || ''
                };
                
                // Fazer requisição para o módulo NFe (porta 3003)
                const axios = require('axios');
                const nfeResponse = await axios.post('http://localhost:3003/api/nfe/gerar', nfePayload, {
                    timeout: 30000,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': req.headers.authorization
                    }
                });
                
                if (nfeResponse.data && nfeResponse.data.numero) {
                    novaNf = nfeResponse.data.numero;
                    nfeData = {
                        numero: nfeResponse.data.numero,
                        chave: nfeResponse.data.chave,
                        protocolo: nfeResponse.data.protocolo,
                        danfe_url: nfeResponse.data.danfe_url
                    };
                    
                    console.log(`[VENDAS -> NFe] NFe ${novaNf} gerada automaticamente para pedido ${id}`);
                }
            } catch (nfeError) {
                console.error('[VENDAS -> NFe] Erro ao gerar NFe automaticamente:', nfeError.message);
                // Continua o faturamento mesmo se a NFe falhar
            }
        }
        
        // Se não gerou NFe, usa numeração sequencial tradicional
        if (!novaNf) {
            const [nfRows] = await pool.query('SELECT MAX(CAST(nf_numero AS UNSIGNED)) as ultima_nf FROM pedidos WHERE nf_numero IS NOT NULL');
            const ultimaNf = nfRows[0]?.ultima_nf || 0;
            novaNf = String(ultimaNf + 1).padStart(8, '0');
        }
        
        // Atualizar pedido
        await pool.query(
            'UPDATE pedidos SET status = ?, nf_numero = ?, data_faturamento = NOW(), nfe_chave = ?, nfe_protocolo = ? WHERE id = ?',
            ['faturado', novaNf, nfeData?.chave || null, nfeData?.protocolo || null, id]
        );
        
        // Registrar no histórico
        await registrarHistorico(
            id,
            user.id,
            user.nome || user.name || 'Usuário',
            'faturamento',
            nfeData ? `Pedido faturado - NFe ${novaNf} emitida automaticamente` : `Pedido faturado - NF ${novaNf}`,
            { nf_numero: novaNf, valor: pedido.valor, nfe_gerada: !!nfeData }
        );
        
        // Criar notificação de faturamento
        if (global.createNotification) {
            const nomeUsuario = user.nome || user.name || user.email || 'Usuário';
            const valorFormatado = (parseFloat(pedido.valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            global.createNotification(
                'payment',
                `Pedido #${id} → Faturado`,
                `${nomeUsuario} faturou pedido - ${nfeData ? 'NFe' : 'NF'} ${novaNf} - ${valorFormatado}`,
                { 
                    pedido_id: id, 
                    nf_numero: novaNf, 
                    valor: pedido.valor, 
                    nfe_data: nfeData,
                    user_id: user.id || null,
                    user_nome: nomeUsuario,
                    vendedor_id: pedido.vendedor_id || null,
                    status: 'faturado',
                    status_label: 'Faturado',
                    tipo: 'movimentacao_status'
                }
            );
        }
        
        res.json({ 
            message: nfeData ? 'Pedido faturado e NFe gerada com sucesso!' : 'Pedido faturado com sucesso!',
            nf_numero: novaNf,
            nfe_gerada: !!nfeData,
            nfe_data: nfeData
        });
    } catch (error) {
        next(error);
    }
});

// =====================================================
// DUPLICAR PEDIDO
// =====================================================
apiVendasRouter.post('/pedidos/:id/duplicar', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const user = req.user || {};
        
        // Buscar pedido original
        const [pedidoRows] = await pool.query('SELECT * FROM pedidos WHERE id = ?', [id]);
        if (pedidoRows.length === 0) {
            return res.status(404).json({ message: 'Pedido não encontrado.' });
        }
        
        const pedidoOriginal = pedidoRows[0];
        
        // Buscar itens do pedido original
        const [itensRows] = await pool.query('SELECT * FROM pedido_itens WHERE pedido_id = ?', [id]);
        
        // Criar novo pedido (cópia)
        const novaDataPrevista = new Date();
        novaDataPrevista.setDate(novaDataPrevista.getDate() + 7); // 7 dias no futuro
        
        const [insertResult] = await pool.query(`
            INSERT INTO pedidos (
                cliente_id, cliente, contato, email, telefone, celular,
                valor, status, data_prevista, vendedor_id, vendedor,
                parcelas, condicao_pagamento, cenario_fiscal, observacoes,
                protecao, comissao_percentual, tipo_faturamento,
                created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'orcamento', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, NOW())
        `, [
            pedidoOriginal.cliente_id,
            pedidoOriginal.cliente,
            pedidoOriginal.contato,
            pedidoOriginal.email,
            pedidoOriginal.telefone,
            pedidoOriginal.celular,
            pedidoOriginal.valor || 0,
            novaDataPrevista,
            pedidoOriginal.vendedor_id,
            pedidoOriginal.vendedor,
            pedidoOriginal.parcelas || 1,
            pedidoOriginal.condicao_pagamento || 'A Vista',
            pedidoOriginal.cenario_fiscal || 'Venda Normal',
            pedidoOriginal.observacoes ? `[CÓPIA DO PEDIDO #${id}] ${pedidoOriginal.observacoes}` : `[CÓPIA DO PEDIDO #${id}]`,
            pedidoOriginal.protecao || 0,
            pedidoOriginal.comissao_percentual || 0,
            user.id || null
        ]);
        
        const novoPedidoId = insertResult.insertId;
        
        // Copiar itens para o novo pedido
        for (const item of itensRows) {
            await pool.query(`
                INSERT INTO pedido_itens (
                    pedido_id, codigo_produto, produto, descricao,
                    quantidade, valor_unitario, valor_total,
                    ncm, unidade, ipi, icms, pis, cofins
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                novoPedidoId,
                item.codigo_produto,
                item.produto,
                item.descricao,
                item.quantidade,
                item.valor_unitario,
                item.valor_total,
                item.ncm,
                item.unidade,
                item.ipi || 0,
                item.icms || 0,
                item.pis || 0,
                item.cofins || 0
            ]);
        }
        
        // Registrar no histórico do pedido original
        await registrarHistorico(
            id,
            user.id,
            user.nome || user.name || 'Usuário',
            'duplicacao',
            `Pedido duplicado para novo pedido #${novoPedidoId}`,
            { novo_pedido_id: novoPedidoId }
        );
        
        // Registrar no histórico do novo pedido
        await registrarHistorico(
            novoPedidoId,
            user.id,
            user.nome || user.name || 'Usuário',
            'criacao',
            `Pedido criado como cópia do pedido #${id}`,
            { pedido_original_id: id }
        );
        
        console.log(`[VENDAS] Pedido #${id} duplicado para #${novoPedidoId} por ${user.nome || user.name || 'Usuário'}`);
        
        res.json({ 
            message: `Pedido duplicado com sucesso!`,
            id: novoPedidoId,
            pedido_original: id
        });
    } catch (error) {
        console.error('[VENDAS] Erro ao duplicar pedido:', error);
        next(error);
    }
});

// =====================================================
// ROTAS DE FATURAMENTO PARCIAL (50% F9) - ENTREGA FUTURA
// =====================================================

// Helper: Garantir que tabelas de faturamento parcial existem
async function ensureFaturamentoParcialTables() {
    try {
        // Verificar se coluna tipo_faturamento existe
        const [cols] = await pool.query(`SHOW COLUMNS FROM pedidos LIKE 'tipo_faturamento'`);
        if (cols.length === 0) {
            // Adicionar colunas se não existirem
            await pool.query(`
                ALTER TABLE pedidos 
                ADD COLUMN tipo_faturamento ENUM('normal','parcial_50','entrega_futura','consignado') DEFAULT 'normal',
                ADD COLUMN percentual_faturado DECIMAL(5,2) DEFAULT 0,
                ADD COLUMN valor_faturado DECIMAL(15,2) DEFAULT 0,
                ADD COLUMN valor_pendente DECIMAL(15,2) DEFAULT 0,
                ADD COLUMN estoque_baixado TINYINT(1) DEFAULT 0,
                ADD COLUMN nfe_faturamento_numero VARCHAR(50) NULL,
                ADD COLUMN nfe_faturamento_cfop VARCHAR(10) DEFAULT '5922',
                ADD COLUMN nfe_remessa_numero VARCHAR(50) NULL,
                ADD COLUMN nfe_remessa_cfop VARCHAR(10) DEFAULT '5117'
            `);
            console.log('[FATURAMENTO_PARCIAL] Colunas adicionadas à tabela pedidos');
        }
        
        // Criar tabela de faturamentos parciais
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedido_faturamentos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pedido_id INT NOT NULL,
                sequencia INT NOT NULL DEFAULT 1,
                tipo ENUM('faturamento','remessa','complementar') NOT NULL,
                percentual DECIMAL(5,2) NOT NULL,
                valor DECIMAL(15,2) NOT NULL,
                nfe_numero VARCHAR(50) NULL,
                nfe_chave VARCHAR(50) NULL,
                nfe_cfop VARCHAR(10) NULL,
                nfe_status ENUM('pendente','autorizada','cancelada','denegada') DEFAULT 'pendente',
                baixa_estoque TINYINT(1) DEFAULT 0,
                conta_receber_id INT NULL,
                usuario_id INT NULL,
                usuario_nome VARCHAR(100) NULL,
                observacoes TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_pedido_id (pedido_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch (e) {
        console.warn('[FATURAMENTO_PARCIAL] Erro ao garantir tabelas:', e.message);
    }
}

// Obter CFOPs para faturamento parcial
apiVendasRouter.get('/faturamento/cfops', async (req, res, next) => {
    try {
        // Retornar CFOPs padrão para faturamento parcial
        const cfops = {
            faturamento: {
                dentro_estado: { cfop: '5922', descricao: 'Simples Faturamento - Operação Interna' },
                fora_estado: { cfop: '6922', descricao: 'Simples Faturamento - Operação Interestadual' }
            },
            remessa: {
                dentro_estado: { cfop: '5117', descricao: 'Remessa Entrega Futura - Operação Interna' },
                fora_estado: { cfop: '6117', descricao: 'Remessa Entrega Futura - Operação Interestadual' }
            },
            normal: {
                dentro_estado: { cfop: '5102', descricao: 'Venda Mercadoria - Operação Interna' },
                fora_estado: { cfop: '6102', descricao: 'Venda Mercadoria - Operação Interestadual' }
            }
        };
        res.json(cfops);
    } catch (error) {
        next(error);
    }
});

// Faturamento Parcial (50% F9) - Etapa 1: Simples Faturamento
apiVendasRouter.post('/pedidos/:id/faturamento-parcial', async (req, res, next) => {
    try {
        await ensureFaturamentoParcialTables();
        const { id } = req.params;
        const { 
            tipo_faturamento = 'parcial_50',  // parcial_50, entrega_futura
            percentual = 50,                   // Percentual a faturar (padrão 50%)
            cfop = '5922',                     // CFOP de faturamento
            gerarNFe = false,                  // Gerar NFe automaticamente
            gerarFinanceiro = true,            // Gerar conta a receber
            observacoes = ''
        } = req.body;
        const user = req.user || {};
        
        // Verificar se pedido existe
        const [pedidoRows] = await pool.query('SELECT * FROM pedidos WHERE id = ?', [id]);
        if (pedidoRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
        }
        
        const pedido = pedidoRows[0];
        
        // Validações
        if (pedido.status === 'cancelado') {
            return res.status(400).json({ success: false, message: 'Não é possível faturar pedido cancelado.' });
        }
        
        if (pedido.percentual_faturado >= 100) {
            return res.status(400).json({ success: false, message: 'Pedido já está 100% faturado.' });
        }
        
        // Calcular valor a faturar
        const valorTotal = parseFloat(pedido.valor) || 0;
        const percentualFaturar = Math.min(parseFloat(percentual), 100 - (parseFloat(pedido.percentual_faturado) || 0));
        const valorFaturar = (valorTotal * percentualFaturar) / 100;
        
        // Gerar número de NF sequencial
        const [nfRows] = await pool.query('SELECT MAX(CAST(nfe_faturamento_numero AS UNSIGNED)) as ultima_nf FROM pedidos WHERE nfe_faturamento_numero IS NOT NULL');
        const ultimaNf = nfRows[0]?.ultima_nf || 0;
        const novoNfNumero = String(ultimaNf + 1).padStart(8, '0');
        
        // Atualizar pedido
        const novoPercentualFaturado = (parseFloat(pedido.percentual_faturado) || 0) + percentualFaturar;
        const novoValorFaturado = (parseFloat(pedido.valor_faturado) || 0) + valorFaturar;
        const novoStatus = novoPercentualFaturado >= 100 ? 'faturado' : 'parcial';
        
        await pool.query(`
            UPDATE pedidos SET 
                tipo_faturamento = ?,
                percentual_faturado = ?,
                valor_faturado = ?,
                valor_pendente = ? - ?,
                nfe_faturamento_numero = ?,
                nfe_faturamento_cfop = ?,
                status = ?,
                data_faturamento = IF(data_faturamento IS NULL, NOW(), data_faturamento)
            WHERE id = ?
        `, [tipo_faturamento, novoPercentualFaturado, novoValorFaturado, valorTotal, novoValorFaturado, novoNfNumero, cfop, novoStatus, id]);
        
        // Registrar na tabela de faturamentos
        const [fatResult] = await pool.query(`
            INSERT INTO pedido_faturamentos 
            (pedido_id, sequencia, tipo, percentual, valor, nfe_numero, nfe_cfop, baixa_estoque, usuario_id, usuario_nome, observacoes)
            VALUES (?, 1, 'faturamento', ?, ?, ?, ?, 0, ?, ?, ?)
        `, [id, percentualFaturar, valorFaturar, novoNfNumero, cfop, user.id || null, user.nome || 'Sistema', observacoes]);
        
        // Registrar histórico
        await registrarHistorico(
            id,
            user.id,
            user.nome || 'Sistema',
            'faturamento_parcial',
            `Faturamento Parcial (${percentualFaturar}%) - NF ${novoNfNumero} - CFOP ${cfop} - R$ ${valorFaturar.toFixed(2)}`,
            { 
                tipo: 'faturamento', 
                percentual: percentualFaturar, 
                valor: valorFaturar, 
                nf_numero: novoNfNumero, 
                cfop,
                baixa_estoque: false
            }
        );
        
        // Gerar conta a receber se solicitado
        let contaReceberId = null;
        if (gerarFinanceiro) {
            try {
                const [contaResult] = await pool.query(`
                    INSERT INTO contas_receber 
                    (pedido_id, cliente_id, descricao, valor, data_vencimento, status, tipo)
                    VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), 'pendente', 'faturamento_parcial')
                `, [id, pedido.cliente_id || pedido.empresa_id, `Faturamento ${percentualFaturar}% - Pedido #${id}`, valorFaturar]);
                contaReceberId = contaResult.insertId;
                
                // Atualizar registro de faturamento com conta a receber
                await pool.query('UPDATE pedido_faturamentos SET conta_receber_id = ? WHERE id = ?', [contaReceberId, fatResult.insertId]);
            } catch (finErr) {
                console.warn('[FATURAMENTO_PARCIAL] Erro ao gerar financeiro:', finErr.message);
            }
        }
        
        res.json({
            success: true,
            message: `Faturamento parcial de ${percentualFaturar}% realizado com sucesso!`,
            dados: {
                pedido_id: id,
                nf_numero: novoNfNumero,
                cfop,
                percentual_faturado: novoPercentualFaturado,
                valor_faturado: novoValorFaturado,
                valor_pendente: valorTotal - novoValorFaturado,
                baixa_estoque: false,
                conta_receber_id: contaReceberId,
                proximo_passo: novoPercentualFaturado < 100 ? 'Aguardando remessa para completar faturamento' : 'Faturamento completo'
            }
        });
        
    } catch (error) {
        console.error('[FATURAMENTO_PARCIAL] Erro:', error);
        next(error);
    }
});

// Faturamento Parcial - Etapa 2: Remessa/Entrega (baixa estoque)
apiVendasRouter.post('/pedidos/:id/remessa-entrega', async (req, res, next) => {
    try {
        await ensureFaturamentoParcialTables();
        const { id } = req.params;
        const { 
            cfop = '5117',                     // CFOP de remessa
            gerarNFe = false,                  // Gerar NFe automaticamente
            gerarFinanceiro = true,            // Gerar conta a receber do valor restante
            baixarEstoque = true,              // Baixar estoque
            observacoes = ''
        } = req.body;
        const user = req.user || {};
        
        // Verificar se pedido existe
        const [pedidoRows] = await pool.query('SELECT * FROM pedidos WHERE id = ?', [id]);
        if (pedidoRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
        }
        
        const pedido = pedidoRows[0];
        
        // Validações
        if (pedido.estoque_baixado === 1) {
            return res.status(400).json({ success: false, message: 'Estoque já foi baixado para este pedido.' });
        }
        
        if (pedido.tipo_faturamento === 'normal') {
            return res.status(400).json({ success: false, message: 'Este pedido não é de faturamento parcial.' });
        }
        
        // Calcular valor restante
        const valorTotal = parseFloat(pedido.valor) || 0;
        const valorFaturado = parseFloat(pedido.valor_faturado) || 0;
        const valorRestante = valorTotal - valorFaturado;
        const percentualRestante = 100 - (parseFloat(pedido.percentual_faturado) || 0);
        
        // Gerar número de NF de remessa
        const [nfRows] = await pool.query('SELECT MAX(CAST(nfe_remessa_numero AS UNSIGNED)) as ultima_nf FROM pedidos WHERE nfe_remessa_numero IS NOT NULL');
        const ultimaNf = nfRows[0]?.ultima_nf || 0;
        const novoNfRemessa = String(ultimaNf + 1).padStart(8, '0');
        
        // Atualizar pedido - marcar como faturado completo e estoque baixado
        await pool.query(`
            UPDATE pedidos SET 
                percentual_faturado = 100,
                valor_faturado = ?,
                valor_pendente = 0,
                estoque_baixado = 1,
                data_baixa_estoque = NOW(),
                nfe_remessa_numero = ?,
                nfe_remessa_cfop = ?,
                status = 'faturado',
                data_entrega_efetiva = NOW()
            WHERE id = ?
        `, [valorTotal, novoNfRemessa, cfop, id]);
        
        // Registrar na tabela de faturamentos
        const [fatResult] = await pool.query(`
            INSERT INTO pedido_faturamentos 
            (pedido_id, sequencia, tipo, percentual, valor, nfe_numero, nfe_cfop, baixa_estoque, usuario_id, usuario_nome, observacoes)
            VALUES (?, 2, 'remessa', ?, ?, ?, ?, 1, ?, ?, ?)
        `, [id, percentualRestante, valorRestante, novoNfRemessa, cfop, user.id || null, user.nome || 'Sistema', observacoes]);
        
        // Baixar estoque se solicitado
        if (baixarEstoque) {
            try {
                const [itens] = await pool.query('SELECT * FROM pedido_itens WHERE pedido_id = ?', [id]);
                for (const item of itens) {
                    // Registrar movimento de saída
                    await pool.query(`
                        INSERT INTO estoque_movimentos 
                        (produto_id, tipo, quantidade, referencia_tipo, referencia_id, observacoes, usuario_id)
                        VALUES (?, 'saida', ?, 'remessa', ?, ?, ?)
                    `, [item.produto_id, item.quantidade, id, `Remessa pedido #${id}`, user.id || null]);
                    
                    // AUDIT-FIX MOD-001: Atomic stock decrement with negative check
                    const [stockResult] = await pool.query(`
                        UPDATE produtos SET estoque_atual = estoque_atual - ? 
                        WHERE id = ? AND estoque_atual >= ?
                    `, [item.quantidade, item.produto_id, item.quantidade]);
                    if (stockResult.affectedRows === 0) {
                        console.warn(`[REMESSA] Estoque insuficiente para produto ${item.produto_id}, qtd: ${item.quantidade}`);
                    }
                }
                console.log(`[REMESSA] Estoque baixado para pedido ${id}`);
            } catch (estErr) {
                console.warn('[REMESSA] Erro ao baixar estoque:', estErr.message);
            }
        }
        
        // Registrar histórico
        await registrarHistorico(
            id,
            user.id,
            user.nome || 'Sistema',
            'remessa_entrega',
            `Remessa/Entrega - NF ${novoNfRemessa} - CFOP ${cfop} - R$ ${valorRestante.toFixed(2)} - Estoque baixado`,
            { 
                tipo: 'remessa', 
                percentual: percentualRestante, 
                valor: valorRestante, 
                nf_numero: novoNfRemessa, 
                cfop,
                baixa_estoque: true
            }
        );
        
        // Gerar conta a receber do valor restante
        let contaReceberId = null;
        if (gerarFinanceiro && valorRestante > 0) {
            try {
                const [contaResult] = await pool.query(`
                    INSERT INTO contas_receber 
                    (pedido_id, cliente_id, descricao, valor, data_vencimento, status, tipo)
                    VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), 'pendente', 'remessa_entrega')
                `, [id, pedido.cliente_id || pedido.empresa_id, `Remessa/Entrega - Pedido #${id}`, valorRestante]);
                contaReceberId = contaResult.insertId;
                
                await pool.query('UPDATE pedido_faturamentos SET conta_receber_id = ? WHERE id = ?', [contaReceberId, fatResult.insertId]);
            } catch (finErr) {
                console.warn('[REMESSA] Erro ao gerar financeiro:', finErr.message);
            }
        }
        
        res.json({
            success: true,
            message: 'Remessa/Entrega realizada com sucesso! Estoque baixado.',
            dados: {
                pedido_id: id,
                nf_remessa: novoNfRemessa,
                cfop,
                percentual_faturado: 100,
                valor_total: valorTotal,
                estoque_baixado: true,
                conta_receber_id: contaReceberId,
                status: 'Faturamento completo'
            }
        });
        
    } catch (error) {
        console.error('[REMESSA] Erro:', error);
        next(error);
    }
});

// Consultar status de faturamento parcial do pedido
apiVendasRouter.get('/pedidos/:id/faturamento-status', async (req, res, next) => {
    try {
        await ensureFaturamentoParcialTables();
        const { id } = req.params;
        
        // Buscar pedido
        const [pedidoRows] = await pool.query(`
            SELECT p.*, 
                   e.nome_fantasia as empresa_nome,
                   e.uf as empresa_uf
            FROM pedidos p
            LEFT JOIN empresas e ON p.empresa_id = e.id
            WHERE p.id = ?
        `, [id]);
        
        if (pedidoRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
        }
        
        const pedido = pedidoRows[0];
        
        // Buscar histórico de faturamentos
        const [faturamentos] = await pool.query(`
            SELECT * FROM pedido_faturamentos WHERE pedido_id = ? ORDER BY sequencia ASC
        `, [id]);
        
        // Determinar próxima ação
        let proximaAcao = null;
        let cfopSugerido = null;
        
        if (pedido.tipo_faturamento === 'normal' || !pedido.tipo_faturamento) {
            proximaAcao = 'faturamento_normal';
            cfopSugerido = pedido.empresa_uf === 'MG' ? '5102' : '6102';
        } else if (pedido.percentual_faturado < 100) {
            proximaAcao = 'aguardando_remessa';
            cfopSugerido = pedido.empresa_uf === 'MG' ? '5117' : '6117';
        } else if (!pedido.estoque_baixado) {
            proximaAcao = 'aguardando_baixa_estoque';
            cfopSugerido = pedido.empresa_uf === 'MG' ? '5117' : '6117';
        } else {
            proximaAcao = 'completo';
        }
        
        res.json({
            success: true,
            pedido: {
                id: pedido.id,
                numero: pedido.numero,
                status: pedido.status,
                tipo_faturamento: pedido.tipo_faturamento || 'normal',
                valor_total: parseFloat(pedido.valor) || 0,
                percentual_faturado: parseFloat(pedido.percentual_faturado) || 0,
                valor_faturado: parseFloat(pedido.valor_faturado) || 0,
                valor_pendente: parseFloat(pedido.valor_pendente) || 0,
                estoque_baixado: pedido.estoque_baixado === 1,
                nfe_faturamento: pedido.nfe_faturamento_numero,
                nfe_remessa: pedido.nfe_remessa_numero,
                empresa_nome: pedido.empresa_nome,
                empresa_uf: pedido.empresa_uf
            },
            faturamentos,
            proxima_acao: proximaAcao,
            cfop_sugerido: cfopSugerido,
            resumo: {
                etapa_1: pedido.nfe_faturamento_numero ? 'concluido' : 'pendente',
                etapa_2: pedido.nfe_remessa_numero ? 'concluido' : 'pendente'
            }
        });
        
    } catch (error) {
        next(error);
    }
});

// Listar pedidos com faturamento parcial pendente
apiVendasRouter.get('/faturamento/parciais-pendentes', async (req, res, next) => {
    try {
        await ensureFaturamentoParcialTables();
        
        const [rows] = await pool.query(`
            SELECT p.*, 
                   e.nome_fantasia as empresa_nome,
                   u.nome as vendedor_nome
            FROM pedidos p
            LEFT JOIN empresas e ON p.empresa_id = e.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.tipo_faturamento IN ('parcial_50', 'entrega_futura')
              AND (p.percentual_faturado < 100 OR p.estoque_baixado = 0)
              AND p.status NOT IN ('cancelado', 'denegado')
            ORDER BY p.created_at DESC
        `);
        
        res.json({
            success: true,
            total: rows.length,
            pedidos: rows.map(p => ({
                id: p.id,
                numero: p.numero,
                empresa: p.empresa_nome,
                vendedor: p.vendedor_nome,
                valor_total: parseFloat(p.valor) || 0,
                percentual_faturado: parseFloat(p.percentual_faturado) || 0,
                valor_pendente: parseFloat(p.valor_pendente) || 0,
                estoque_baixado: p.estoque_baixado === 1,
                proxima_acao: p.percentual_faturado < 100 ? 'Emitir Remessa' : 'Baixar Estoque',
                created_at: p.created_at
            }))
        });
        
    } catch (error) {
        next(error);
    }
});

// --- ROTAS DE EMPRESAS ---
apiVendasRouter.get('/empresas', async (req, res, next) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const [rows] = await pool.query('SELECT * FROM empresas ORDER BY nome_fantasia ASC LIMIT ? OFFSET ?', [parseInt(limit), offset]);
        res.json(rows);
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.get('/empresas/search', async (req, res, next) => {
    try {
        const q = req.query.q || '';
        const query = `%${q}%`;
        const [rows] = await pool.query(
            `SELECT id, nome_fantasia, cnpj FROM empresas 
             WHERE nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ?
             ORDER BY nome_fantasia LIMIT 10`,
            [query, query, query]
        );
        res.json(rows);
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.get('/empresas/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query('SELECT * FROM empresas WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Empresa não encontrada.' });
        res.json(rows[0]);
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.get('/empresas/:id/details', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [empresaResult, kpisResult, pedidosResult, clientesResult] = await Promise.all([
            pool.query('SELECT * FROM empresas WHERE id = ?', [id]),
            pool.query(`SELECT 
                COUNT(*) AS totalPedidos, 
                COALESCE(SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS totalFaturado, 
                COALESCE(AVG(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS ticketMedio 
                FROM pedidos WHERE empresa_id = ?`, [id]),
            pool.query('SELECT id, valor, status, created_at FROM pedidos WHERE empresa_id = ? ORDER BY created_at DESC', [id]),
            pool.query('SELECT id, nome, email, telefone FROM clientes WHERE empresa_id = ? ORDER BY nome ASC', [id])
        ]);

        const details = empresaResult[0][0];
        if (!details) return res.status(404).json({ message: 'Empresa não encontrada.' });

        res.json({
            details,
            kpis: kpisResult[0][0] || { totalPedidos: 0, totalFaturado: 0, ticketMedio: 0 },
            pedidos: pedidosResult[0] || [],
            clientes: clientesResult[0] || []
        });
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.post('/empresas', async (req, res, next) => {
    try {
        const { cnpj, nome_fantasia, razao_social, email, email_2, telefone, telefone_2, cep, logradouro, número, bairro, municipio, uf } = req.body;
        if (!nome_fantasia || !cnpj) {
            return res.status(400).json({ message: 'Nome fantasia e CNPJ são obrigatórios.' });
        }
        const [result] = await pool.query(
            `INSERT INTO empresas (cnpj, nome_fantasia, razao_social, email, email_2, telefone, telefone_2, cep, logradouro, número, bairro, municipio, uf) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [cnpj, nome_fantasia, razao_social || null, email || null, email_2 || null, telefone || null, telefone_2 || null, cep || null, logradouro || null, número || null, bairro || null, municipio || null, uf || null]
        );
        res.status(201).json({ message: 'Empresa cadastrada com sucesso!', insertedId: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Este CNPJ já está cadastrado.' });
        next(error);
    }
});

apiVendasRouter.put('/empresas/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { cnpj, nome_fantasia, razao_social, email, email_2, telefone, telefone_2, cep, logradouro, número, bairro, municipio, uf } = req.body;
        if (!nome_fantasia || !cnpj) {
            return res.status(400).json({ message: 'Nome fantasia e CNPJ são obrigatórios.' });
        }
        const [result] = await pool.query(
            `UPDATE empresas SET cnpj = ?, nome_fantasia = ?, razao_social = ?, email = ?, email_2 = ?, telefone = ?, telefone_2 = ?, cep = ?, logradouro = ?, número = ?, bairro = ?, municipio = ?, uf = ? WHERE id = ?`,
            [cnpj, nome_fantasia, razao_social, email, email_2, telefone, telefone_2, cep, logradouro, número, bairro, municipio, uf, id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Empresa não encontrada.' });
        res.json({ message: 'Empresa atualizada com sucesso.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Este CNPJ já está cadastrado.' });
        next(error);
    }
});

apiVendasRouter.delete('/empresas/:id', authorizeAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM clientes WHERE empresa_id = ?', [id]);
        await pool.query('DELETE FROM pedidos WHERE empresa_id = ?', [id]);
        const [result] = await pool.query('DELETE FROM empresas WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Empresa não encontrada.' });
        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

// --- ROTAS DE CLIENTES ---

// Busca unificada de clientes e empresas (para autocomplete)
apiVendasRouter.get('/clientes-empresas/search', async (req, res, next) => {
    try {
        const q = req.query.q || '';
        if (q.length < 1) {
            return res.json([]);
        }
        const query = `%${q}%`;
        
        // Buscar empresas
        const [empresas] = await pool.query(
            `SELECT id, nome_fantasia as nome, razao_social, cnpj, 'empresa' as tipo
             FROM empresas 
             WHERE nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ?
             ORDER BY nome_fantasia
             LIMIT 10`,
            [query, query, query]
        );
        
        // Buscar clientes
        const [clientes] = await pool.query(
            `SELECT c.id, c.nome, c.email, c.telefone, c.cpf, c.empresa_id, 
                    e.nome_fantasia as empresa_nome, 'cliente' as tipo
             FROM clientes c
             LEFT JOIN empresas e ON c.empresa_id = e.id
             WHERE c.nome LIKE ? OR c.email LIKE ? OR c.cpf LIKE ?
             ORDER BY c.nome
             LIMIT 10`,
            [query, query, query]
        );
        
        // Combinar resultados: empresas primeiro, depois clientes
        const resultados = [
            ...empresas.map(e => ({
                id: e.id,
                nome: e.nome_fantasia || e.razao_social || e.nome,
                subtitulo: e.cnpj ? `CNPJ: ${e.cnpj}` : '',
                tipo: 'empresa',
                empresa_id: e.id
            })),
            ...clientes.map(c => ({
                id: c.id,
                nome: c.nome,
                subtitulo: c.empresa_nome ? `${c.empresa_nome}` : (c.email || ''),
                tipo: 'cliente',
                cliente_id: c.id,
                empresa_id: c.empresa_id
            }))
        ];
        
        res.json(resultados);
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.get('/clientes', async (req, res, next) => {
    try {
        const { page = 1, limit = 2000 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const [rows] = await pool.query(`
            SELECT c.id, c.nome, c.razao_social, c.nome_fantasia, c.email, c.telefone, 
                   c.cnpj, c.cpf, c.cnpj_cpf, c.cidade, c.estado, c.ativo,
                   c.vendedor_responsavel, c.vendedor_proprietario,
                   c.created_at, c.data_cadastro,
                   e.nome_fantasia AS empresa_nome
            FROM clientes c
            LEFT JOIN empresas e ON c.empresa_id = e.id
            ORDER BY c.nome ASC
            LIMIT ? OFFSET ?
        `, [parseInt(limit), offset]);
        res.json(rows);
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.get('/clientes/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query('SELECT * FROM clientes WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });
        res.json(rows[0]);
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.get('/clientes/:id/details', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [clienteResult, interacoesResult, pedidosResult, tagsResult] = await Promise.all([
            pool.query(`SELECT c.*, e.nome_fantasia as empresa_nome FROM clientes c LEFT JOIN empresas e ON c.empresa_id = e.id WHERE c.id = ?`, [id]),
            pool.query(`SELECT i.tipo, i.anotacao, i.created_at, u.nome as usuario_nome FROM cliente_interacoes i JOIN usuarios u ON i.usuario_id = u.id WHERE i.cliente_id = ? ORDER BY i.created_at DESC`, [id]),
            pool.query(`SELECT p.id, p.valor, p.status, p.created_at FROM pedidos p JOIN clientes c ON p.empresa_id = c.empresa_id WHERE c.id = ? ORDER BY p.created_at DESC`, [id]),
            pool.query(`SELECT t.id, t.nome, t.cor FROM cliente_tags t JOIN cliente_has_tags cht ON t.id = cht.tag_id WHERE cht.cliente_id = ?`, [id])
        ]);

        const cliente = clienteResult[0][0];
        if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' });

        res.json({
            details: cliente,
            interacoes: interacoesResult[0] || [],
            pedidos: pedidosResult[0] || [],
            tags: tagsResult[0] || []
        });
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.post('/clientes', async (req, res, next) => {
    try {
        const { nome, nome_fantasia, cnpj, contato, telefone, celular, email, website,
                endereco, numero, complemento, bairro, cidade, uf, cep,
                inscricao_estadual, inscricao_municipal, limite_credito, ativo, empresa_id } = req.body;
        if (!nome) return res.status(400).json({ message: 'Nome é obrigatório.' });

        // Montar endereço completo
        let enderecoFinal = endereco || null;
        if (enderecoFinal && numero) enderecoFinal += `, ${numero}`;
        if (enderecoFinal && complemento) enderecoFinal += ` - ${complemento}`;

        const [result] = await pool.query(
            `INSERT INTO clientes (nome, nome_fantasia, razao_social, cnpj, contato, telefone, email, 
             endereco, bairro, cidade, estado, cep, inscricao_estadual, inscricao_municipal, 
             credito_total, ativo, empresa_id, data_cadastro, incluido_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
            [nome, nome_fantasia || null, nome || null, cnpj || null, contato || null,
             telefone || null, email || null, enderecoFinal, bairro || null,
             cidade || null, uf || null, cep || null, inscricao_estadual || null,
             inscricao_municipal || null, limite_credito ? parseFloat(limite_credito) : 0,
             ativo !== undefined ? (ativo ? 1 : 0) : 1,
             empresa_id || 1, req.user ? req.user.nome : 'Sistema']
        );
        res.status(201).json({ message: 'Cliente cadastrado com sucesso!', id: result.insertId });
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.put('/clientes/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const body = req.body;
        
        // Se é apenas toggle de ativo, permitir sem exigir nome/empresa
        if (body.ativo !== undefined && Object.keys(body).length <= 2) {
            const [result] = await pool.query(
                'UPDATE clientes SET ativo = ? WHERE id = ?',
                [body.ativo ? 1 : 0, id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });
            return res.json({ message: `Cliente ${body.ativo ? 'ativado' : 'inativado'} com sucesso.` });
        }
        
        const { nome, nome_fantasia, cnpj, contato, telefone, celular, email, website,
                endereco, numero, complemento, bairro, cidade, uf, cep,
                inscricao_estadual, inscricao_municipal, limite_credito, empresa_id } = body;
        if (!nome) return res.status(400).json({ message: 'Nome é obrigatório.' });

        let enderecoFinal = endereco || null;
        if (enderecoFinal && numero) enderecoFinal += `, ${numero}`;
        if (enderecoFinal && complemento) enderecoFinal += ` - ${complemento}`;

        const [result] = await pool.query(
            `UPDATE clientes SET nome = ?, nome_fantasia = ?, cnpj = ?, contato = ?, 
             telefone = ?, email = ?, endereco = ?, bairro = ?, cidade = ?, 
             estado = ?, cep = ?, inscricao_estadual = ?, inscricao_municipal = ?,
             credito_total = ?, ativo = ?, empresa_id = ?,
             data_ultima_alteracao = NOW(), alterado_por = ?
             WHERE id = ?`,
            [nome, nome_fantasia || null, cnpj || null, contato || null,
             telefone || null, email || null, enderecoFinal, bairro || null,
             cidade || null, uf || null, cep || null, inscricao_estadual || null,
             inscricao_municipal || null,
             limite_credito ? parseFloat(limite_credito) : 0,
             body.ativo !== undefined ? (body.ativo ? 1 : 0) : 1,
             empresa_id || 1,
             req.user ? req.user.nome : 'Sistema', id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });
        res.json({ message: 'Cliente atualizado com sucesso.' });
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.delete('/clientes/:id', authorizeAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const [result] = await pool.query('DELETE FROM clientes WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });
        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.post('/clientes/:id/interacoes', async (req, res, next) => {
    try {
        const { id: cliente_id } = req.params;
        const { tipo, anotacao } = req.body;
        const { id: usuario_id } = req.user;
        if (!tipo || !anotacao) return res.status(400).json({ message: 'Tipo e anotação são obrigatórios.' });
        await pool.query(
            'INSERT INTO cliente_interacoes (cliente_id, usuario_id, tipo, anotacao) VALUES (?, ?, ?, ?)',
            [cliente_id, usuario_id, tipo, anotacao]
        );
        res.status(201).json({ message: 'Interação registrada com sucesso!' });
    } catch (error) {
        next(error);
    }
});

apiVendasRouter.post('/clientes/:id/tags', async (req, res, next) => {
    try {
        const { id: cliente_id } = req.params;
        const { tag_id } = req.body;
        await pool.query(
            'INSERT INTO cliente_has_tags (cliente_id, tag_id) VALUES (?, ?)',
            [cliente_id, tag_id]
        );
        res.status(201).json({ message: 'Tag associada com sucesso!' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.json({ message: 'Tag já associada.' });
        next(error);
    }
});

apiVendasRouter.get('/tags', async (req, res, next) => {
    try {
        const [tags] = await pool.query('SELECT * FROM cliente_tags ORDER BY nome');
        res.json(tags);
    } catch (error) {
        next(error);
    }
});

// ========================================
// ROTAS DE PRODUTOS
// ========================================

// Garantir tabela de produtos existe
async function ensureProdutosTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS produtos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo VARCHAR(50) NOT NULL UNIQUE,
                descricao VARCHAR(255) NOT NULL,
                ncm VARCHAR(20),
                ean VARCHAR(20),
                categoria VARCHAR(100),
                situacao ENUM('ativo', 'inativo', 'descontinuado') DEFAULT 'ativo',
                unidade VARCHAR(10) DEFAULT 'UN',
                peso_bruto DECIMAL(10,3) DEFAULT 0,
                peso_liquido DECIMAL(10,3) DEFAULT 0,
                preco_custo DECIMAL(15,2) DEFAULT 0,
                preco_venda DECIMAL(15,2) DEFAULT 0,
                estoque_atual INT DEFAULT 0,
                estoque_minimo INT DEFAULT 0,
                local_estoque VARCHAR(100) DEFAULT 'principal',
                observacoes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_codigo (codigo),
                INDEX idx_categoria (categoria),
                INDEX idx_situacao (situacao)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    } catch (e) { /* tabela já existe */ }
}

// Listar produtos
apiVendasRouter.get('/produtos', async (req, res, next) => {
    try {
        await ensureProdutosTable();
        const { page = 1, limit = 50, categoria, situacao, search } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        let whereConditions = [];
        let params = [];
        
        if (categoria) {
            whereConditions.push('categoria = ?');
            params.push(categoria);
        }
        if (situacao) {
            whereConditions.push('situacao = ?');
            params.push(situacao);
        }
        if (search) {
            whereConditions.push('(codigo LIKE ? OR descricao LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        
        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
        
        const [rows] = await pool.query(
            `SELECT * FROM produtos ${whereClause} ORDER BY descricao ASC LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );
        
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM produtos ${whereClause}`,
            params
        );
        
        res.json({ produtos: rows, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return res.json({ produtos: [], total: 0 });
        next(error);
    }
});

// Autocomplete de produtos - busca rápida para dropdown
apiVendasRouter.get('/produtos/autocomplete/:termo', async (req, res, next) => {
    try {
        await ensureProdutosTable();
        const { termo } = req.params;
        const limit = parseInt(req.query.limit) || 15;
        
        const [rows] = await pool.query(
            `SELECT id, codigo, descricao, unidade, preco_venda, estoque_atual, local_estoque 
             FROM produtos 
             WHERE situacao = 'ativo' AND (codigo LIKE ? OR descricao LIKE ? OR ean LIKE ?)
             ORDER BY 
                CASE 
                    WHEN codigo = ? THEN 1 
                    WHEN codigo LIKE ? THEN 2 
                    ELSE 3 
                END,
                descricao ASC
             LIMIT ?`,
            [`%${termo}%`, `%${termo}%`, `%${termo}%`, termo, `${termo}%`, limit]
        );
        
        res.json(rows);
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
        next(error);
    }
});

// Buscar produto por ID
apiVendasRouter.get('/produtos/:id', async (req, res, next) => {
    try {
        await ensureProdutosTable();
        const { id } = req.params;
        const [rows] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Produto não encontrado.' });
        res.json(rows[0]);
    } catch (error) {
        next(error);
    }
});

// Criar produto
apiVendasRouter.post('/produtos', async (req, res, next) => {
    try {
        await ensureProdutosTable();
        const { 
            codigo, descricao, ncm, ean, categoria, situacao, unidade,
            peso_bruto, peso_liquido, preco_custo, preco_venda,
            estoque_atual, estoque_minimo, local_estoque, observacoes 
        } = req.body;
        
        if (!codigo || !descricao) {
            return res.status(400).json({ message: 'Código e Descrição são obrigatórios.' });
        }
        
        const [result] = await pool.query(
            `INSERT INTO produtos (codigo, descricao, ncm, ean, categoria, situacao, unidade, peso_bruto, peso_liquido, preco_custo, preco_venda, estoque_atual, estoque_minimo, local_estoque, observacoes) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                sanitizeString(codigo), sanitizeString(descricao), 
                sanitizeString(ncm) || null, sanitizeString(ean) || null,
                sanitizeString(categoria) || null, situacao || 'ativo', unidade || 'UN',
                sanitizeNumber(peso_bruto), sanitizeNumber(peso_liquido),
                sanitizeNumber(preco_custo), sanitizeNumber(preco_venda),
                sanitizeInt(estoque_atual), sanitizeInt(estoque_minimo),
                sanitizeString(local_estoque) || 'principal', sanitizeString(observacoes) || null
            ]
        );
        
        await logAudit(req.user?.id, 'create_produto', 'produto', result.insertId, { codigo, descricao });
        
        res.status(201).json({ message: 'Produto cadastrado com sucesso!', id: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Já existe um produto com este código.' });
        }
        next(error);
    }
});

// Atualizar produto
apiVendasRouter.put('/produtos/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { 
            codigo, descricao, ncm, ean, categoria, situacao, unidade,
            peso_bruto, peso_liquido, preco_custo, preco_venda,
            estoque_atual, estoque_minimo, local_estoque, observacoes 
        } = req.body;
        
        if (!codigo || !descricao) {
            return res.status(400).json({ message: 'Código e Descrição são obrigatórios.' });
        }
        
        const [result] = await pool.query(
            `UPDATE produtos SET codigo = ?, descricao = ?, ncm = ?, ean = ?, categoria = ?, situacao = ?, unidade = ?, peso_bruto = ?, peso_liquido = ?, preco_custo = ?, preco_venda = ?, estoque_atual = ?, estoque_minimo = ?, local_estoque = ?, observacoes = ? WHERE id = ?`,
            [
                sanitizeString(codigo), sanitizeString(descricao), 
                sanitizeString(ncm), sanitizeString(ean),
                sanitizeString(categoria), situacao, unidade,
                sanitizeNumber(peso_bruto), sanitizeNumber(peso_liquido),
                sanitizeNumber(preco_custo), sanitizeNumber(preco_venda),
                sanitizeInt(estoque_atual), sanitizeInt(estoque_minimo),
                sanitizeString(local_estoque), sanitizeString(observacoes), id
            ]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Produto não encontrado.' });
        }
        
        await logAudit(req.user?.id, 'update_produto', 'produto', id, { codigo, descricao });
        
        res.json({ message: 'Produto atualizado com sucesso.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Já existe outro produto com este código.' });
        }
        next(error);
    }
});

// Excluir produto
apiVendasRouter.delete('/produtos/:id', authorizeAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const [result] = await pool.query('DELETE FROM produtos WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Produto não encontrado.' });
        }
        
        await logAudit(req.user?.id, 'delete_produto', 'produto', id, null);
        
        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

// Buscar produto por código (para autocomplete)
apiVendasRouter.get('/produtos/busca/:codigo', async (req, res, next) => {
    try {
        await ensureProdutosTable();
        const { codigo } = req.params;
        const [rows] = await pool.query(
            'SELECT id, codigo, descricao, preco_venda, unidade, estoque_atual FROM produtos WHERE codigo LIKE ? OR descricao LIKE ? LIMIT 10',
            [`${codigo}%`, `%${codigo}%`]
        );
        res.json(rows);
    } catch (error) {
        next(error);
    }
});

// **NOVA ROTA** para buscar a lista de vendedores (equipe comercial)
// Rota duplicada removida - usar a rota anterior em /vendedores que já filtra os vendedores corretos

// ========================================
// ROTAS DE CADASTRO RÁPIDO (MODAIS)
// ========================================

// POST /vendedores - Criar novo vendedor
apiVendasRouter.post('/vendedores', authenticateToken, authorizeAdmin, async (req, res, next) => {
    try {
        const { nome, email, telefone, regiao, comissao } = req.body;
        
        if (!nome || !email) {
            return res.status(400).json({ message: 'Nome e email são obrigatórios.' });
        }
        
        const [result] = await pool.query(
            `INSERT INTO usuarios (nome, email, telefone, regiao, comissao_percentual, role, departamento) 
             VALUES (?, ?, ?, ?, ?, 'vendedor', 'comercial')`,
            [nome, email, telefone || null, regiao || null, parseFloat(comissao) || 0]
        );
        
        res.status(201).json({ 
            message: 'Vendedor criado com sucesso!', 
            id: result.insertId 
        });
    } catch (error) {
        console.error('Erro ao criar vendedor:', error);
        next(error);
    }
});

// POST /condicoes-pagamento - Criar nova condição de pagamento
apiVendasRouter.post('/condicoes-pagamento', authenticateToken, async (req, res, next) => {
    try {
        const { nome, dias, descricao } = req.body;
        
        if (!nome) {
            return res.status(400).json({ message: 'Nome da condição é obrigatório.' });
        }
        
        // Criar tabela se não existir
        await pool.query(`
            CREATE TABLE IF NOT EXISTS condicoes_pagamento (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                dias VARCHAR(100),
                descricao TEXT,
                ativo BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const [result] = await pool.query(
            `INSERT INTO condicoes_pagamento (nome, dias, descricao) VALUES (?, ?, ?)`,
            [nome, dias || null, descricao || null]
        );
        
        res.status(201).json({ 
            message: 'Condição de pagamento criada com sucesso!', 
            id: result.insertId 
        });
    } catch (error) {
        console.error('Erro ao criar condição de pagamento:', error);
        next(error);
    }
});

// GET /condicoes-pagamento - Listar condições de pagamento
apiVendasRouter.get('/condicoes-pagamento', authenticateToken, async (req, res, next) => {
    try {
        // Verificar se tabela existe
        try {
            const [rows] = await pool.query('SELECT * FROM condicoes_pagamento WHERE ativo = TRUE ORDER BY nome');
            res.json(rows);
        } catch (e) {
            // Retornar lista padrão se tabela não existir
            res.json([
                { id: 1, nome: 'À Vista', dias: '0' },
                { id: 2, nome: '30 dias', dias: '30' },
                { id: 3, nome: '30/60 dias', dias: '30,60' },
                { id: 4, nome: '30/60/90 dias', dias: '30,60,90' },
                { id: 5, nome: '28/35/42/49 dias', dias: '28,35,42,49' }
            ]);
        }
    } catch (error) {
        next(error);
    }
});

// POST /tipos-frete - Criar novo tipo de frete
apiVendasRouter.post('/tipos-frete', authenticateToken, async (req, res, next) => {
    try {
        const { codigo, descricao } = req.body;
        
        if (!codigo || !descricao) {
            return res.status(400).json({ message: 'Código e descrição são obrigatórios.' });
        }
        
        // Criar tabela se não existir
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tipos_frete (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo VARCHAR(10) NOT NULL,
                descricao VARCHAR(200) NOT NULL,
                ativo BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const [result] = await pool.query(
            `INSERT INTO tipos_frete (codigo, descricao) VALUES (?, ?)`,
            [codigo, descricao]
        );
        
        res.status(201).json({ 
            message: 'Tipo de frete criado com sucesso!', 
            id: result.insertId 
        });
    } catch (error) {
        console.error('Erro ao criar tipo de frete:', error);
        next(error);
    }
});

// GET /tipos-frete - Listar tipos de frete
apiVendasRouter.get('/tipos-frete', authenticateToken, async (req, res, next) => {
    try {
        try {
            const [rows] = await pool.query('SELECT * FROM tipos_frete WHERE ativo = TRUE ORDER BY codigo');
            res.json(rows);
        } catch (e) {
            // Retornar lista padrão se tabela não existir
            res.json([
                { id: 0, codigo: '0', descricao: 'Contratação do Frete por conta do Remetente (CIF)' },
                { id: 1, codigo: '1', descricao: 'Contratação do Frete por conta do Destinatário (FOB)' },
                { id: 2, codigo: '2', descricao: 'Contratação do Frete por conta de Terceiros' },
                { id: 3, codigo: '3', descricao: 'Transporte Próprio por conta do Remetente' },
                { id: 4, codigo: '4', descricao: 'Transporte Próprio por conta do Destinatário' },
                { id: 9, codigo: '9', descricao: 'Sem Ocorrência de Transporte' }
            ]);
        }
    } catch (error) {
        next(error);
    }
});

// POST /regioes - Criar nova região
apiVendasRouter.post('/regioes', authenticateToken, async (req, res, next) => {
    try {
        const { nome, estados, descricao } = req.body;
        
        if (!nome) {
            return res.status(400).json({ message: 'Nome da região é obrigatório.' });
        }
        
        // Criar tabela se não existir
        await pool.query(`
            CREATE TABLE IF NOT EXISTS regioes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                estados TEXT,
                descricao TEXT,
                ativo BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const [result] = await pool.query(
            `INSERT INTO regioes (nome, estados, descricao) VALUES (?, ?, ?)`,
            [nome, estados || null, descricao || null]
        );
        
        res.status(201).json({ 
            message: 'Região criada com sucesso!', 
            id: result.insertId 
        });
    } catch (error) {
        console.error('Erro ao criar região:', error);
        next(error);
    }
});

// GET /regioes - Listar regiões
apiVendasRouter.get('/regioes', authenticateToken, async (req, res, next) => {
    try {
        try {
            const [rows] = await pool.query('SELECT * FROM regioes WHERE ativo = TRUE ORDER BY nome');
            res.json(rows);
        } catch (e) {
            res.json([]);
        }
    } catch (error) {
        next(error);
    }
});

// POST /cargos - Criar novo cargo
apiVendasRouter.post('/cargos', authenticateToken, async (req, res, next) => {
    try {
        const { nome, departamento, descricao } = req.body;
        
        if (!nome) {
            return res.status(400).json({ message: 'Nome do cargo é obrigatório.' });
        }
        
        // Criar tabela se não existir
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cargos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                departamento VARCHAR(100),
                descricao TEXT,
                ativo BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const [result] = await pool.query(
            `INSERT INTO cargos (nome, departamento, descricao) VALUES (?, ?, ?)`,
            [nome, departamento || null, descricao || null]
        );
        
        res.status(201).json({ 
            message: 'Cargo criado com sucesso!', 
            id: result.insertId 
        });
    } catch (error) {
        console.error('Erro ao criar cargo:', error);
        next(error);
    }
});

// GET /cargos - Listar cargos
apiVendasRouter.get('/cargos', authenticateToken, async (req, res, next) => {
    try {
        try {
            const [rows] = await pool.query('SELECT * FROM cargos WHERE ativo = TRUE ORDER BY nome');
            res.json(rows);
        } catch (e) {
            res.json([]);
        }
    } catch (error) {
        next(error);
    }
});

// ========================================
// ROTAS ADICIONAIS FALTANTES
// ========================================

// GET /transportadoras - Buscar transportadoras
apiVendasRouter.get('/transportadoras', authenticateToken, async (req, res, next) => {
    try {
        const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
        const search = req.query.search || req.query.q || '';
        // Buscar apenas por nome (cnpj está criptografado)
        let query = 'SELECT id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, telefone, email, cidade, estado, cep FROM transportadoras WHERE 1=1';
        const params = [];
        
        if (search) {
            query += ' AND (razao_social LIKE ? OR nome_fantasia LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        
        query += ' ORDER BY COALESCE(razao_social, nome_fantasia) LIMIT 50';
        
        try {
            const [rows] = await pool.query(query, params);
            const resultado = rows.map(r => ({
                id: r.id,
                nome: r.razao_social || r.nome_fantasia || '',
                razao_social: r.razao_social || '',
                cnpj: _dec(r.cnpj_cpf || ''),
                inscricao_estadual: _dec(r.inscricao_estadual || ''),
                telefone: r.telefone || '',
                email: r.email || '',
                cidade: r.cidade || '',
                estado: r.estado || '',
                cep: r.cep || ''
            }));
            res.json(resultado);
        } catch (e) {
            // Se tabela não existir, criar
            await pool.query(`
                CREATE TABLE IF NOT EXISTS transportadoras (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    razao_social VARCHAR(255),
                    nome_fantasia VARCHAR(255),
                    cnpj_cpf VARCHAR(255),
                    inscricao_estadual VARCHAR(50),
                    telefone VARCHAR(50),
                    email VARCHAR(255),
                    endereco TEXT,
                    bairro VARCHAR(100),
                    cidade VARCHAR(100),
                    estado CHAR(2),
                    cep VARCHAR(10),
                    contato VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            res.json([]);
        }
    } catch (error) {
        next(error);
    }
});

// POST /transportadoras - Criar transportadora
apiVendasRouter.post('/transportadoras', authenticateToken, async (req, res, next) => {
    try {
        const { nome, razao_social, cnpj, ie, telefone, email, endereco, cidade, uf, cep } = req.body;
        
        if (!nome) {
            return res.status(400).json({ message: 'Nome da transportadora é obrigatório.' });
        }
        
        const [result] = await pool.query(
            `INSERT INTO transportadoras (nome, razao_social, cnpj, ie, telefone, email, endereco, cidade, uf, cep)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [nome, razao_social || null, cnpj || null, ie || null, telefone || null, 
             email || null, endereco || null, cidade || null, uf || null, cep || null]
        );
        
        res.status(201).json({ 
            message: 'Transportadora criada com sucesso!', 
            id: result.insertId 
        });
    } catch (error) {
        next(error);
    }
});

// GET /empresas/buscar - Buscar empresas/clientes para autocomplete
apiVendasRouter.get('/empresas/buscar', authenticateToken, async (req, res, next) => {
    try {
        const search = req.query.search || req.query.q || req.query.termo || '';
        let query = `SELECT id, nome_fantasia, razao_social, cnpj, cpf, telefone, email 
                     FROM empresas WHERE 1=1`;
        const params = [];
        
        if (search) {
            query += ` AND (nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ? OR cpf LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        query += ' ORDER BY nome_fantasia LIMIT 30';
        
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        next(error);
    }
});

// GET /empresas/:id/credito - Consultar crédito do cliente
apiVendasRouter.get('/empresas/:id/credito', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Buscar limite de crédito da empresa
        const [empresa] = await pool.query(
            'SELECT id, nome_fantasia, limite_credito, saldo_credito FROM empresas WHERE id = ?',
            [id]
        );
        
        if (!empresa || empresa.length === 0) {
            return res.status(404).json({ message: 'Empresa não encontrada.' });
        }
        
        // Calcular saldo usado (pedidos não faturados)
        const [pedidos] = await pool.query(
            `SELECT COALESCE(SUM(valor), 0) as total_pendente 
             FROM pedidos 
             WHERE empresa_id = ? AND status NOT IN ('faturado', 'cancelado')`,
            [id]
        );
        
        const limite = parseFloat(empresa[0].limite_credito) || 0;
        const usado = parseFloat(pedidos[0].total_pendente) || 0;
        const disponivel = limite - usado;
        
        res.json({
            empresa_id: id,
            empresa_nome: empresa[0].nome_fantasia,
            limite_credito: limite,
            credito_usado: usado,
            credito_disponivel: disponivel > 0 ? disponivel : 0,
            status: disponivel > 0 ? 'OK' : 'LIMITE_EXCEDIDO'
        });
    } catch (error) {
        next(error);
    }
});

// GET /credito/:clienteId - Alias para consultar crédito
apiVendasRouter.get('/credito/:clienteId', authenticateToken, async (req, res, next) => {
    req.params.id = req.params.clienteId;
    // Redireciona para a rota de empresas
    try {
        const { clienteId } = req.params;
        
        const [empresa] = await pool.query(
            'SELECT id, nome_fantasia, limite_credito FROM empresas WHERE id = ?',
            [clienteId]
        );
        
        if (!empresa || empresa.length === 0) {
            return res.json({ limite_credito: 0, credito_usado: 0, credito_disponivel: 0 });
        }
        
        const [pedidos] = await pool.query(
            `SELECT COALESCE(SUM(valor), 0) as total_pendente 
             FROM pedidos 
             WHERE empresa_id = ? AND status NOT IN ('faturado', 'cancelado')`,
            [clienteId]
        );
        
        const limite = parseFloat(empresa[0].limite_credito) || 0;
        const usado = parseFloat(pedidos[0].total_pendente) || 0;
        
        res.json({
            limite_credito: limite,
            credito_usado: usado,
            credito_disponivel: Math.max(0, limite - usado)
        });
    } catch (error) {
        next(error);
    }
});

// POST /pedidos/:id/impostos - Salvar impostos do pedido
apiVendasRouter.post('/pedidos/:id/impostos', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { 
            total_icms, total_icms_st, total_ipi, total_pis, total_cofins, 
            total_iss, total_fcp, total_impostos,
            base_calculo_icms, base_calculo_icms_st, base_calculo_ipi,
            base_calculo_pis, base_calculo_cofins
        } = req.body;
        
        await pool.query(
            `UPDATE pedidos SET 
                total_icms = ?, total_icms_st = ?, total_ipi = ?, total_pis = ?, total_cofins = ?,
                total_iss = ?, total_fcp = ?, total_impostos = ?,
                base_calculo_icms = ?, base_calculo_icms_st = ?, base_calculo_ipi = ?,
                base_calculo_pis = ?, base_calculo_cofins = ?
             WHERE id = ?`,
            [
                parseFloat(total_icms) || 0, parseFloat(total_icms_st) || 0, 
                parseFloat(total_ipi) || 0, parseFloat(total_pis) || 0, parseFloat(total_cofins) || 0,
                parseFloat(total_iss) || 0, parseFloat(total_fcp) || 0, parseFloat(total_impostos) || 0,
                parseFloat(base_calculo_icms) || 0, parseFloat(base_calculo_icms_st) || 0,
                parseFloat(base_calculo_ipi) || 0, parseFloat(base_calculo_pis) || 0,
                parseFloat(base_calculo_cofins) || 0, id
            ]
        );
        
        res.json({ message: 'Impostos salvos com sucesso!' });
    } catch (error) {
        next(error);
    }
});

// GET /cenarios-fiscais - Listar cenários fiscais
apiVendasRouter.get('/cenarios-fiscais', authenticateToken, async (req, res, next) => {
    try {
        try {
            const [rows] = await pool.query('SELECT * FROM cenarios_fiscais WHERE ativo = TRUE ORDER BY nome');
            res.json(rows);
        } catch (e) {
            // Tabela não existe, criar e retornar padrão
            await pool.query(`
                CREATE TABLE IF NOT EXISTS cenarios_fiscais (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    nome VARCHAR(100) NOT NULL,
                    descricao TEXT,
                    icms_percent DECIMAL(5,2) DEFAULT 0,
                    ipi_percent DECIMAL(5,2) DEFAULT 0,
                    pis_percent DECIMAL(5,2) DEFAULT 0,
                    cofins_percent DECIMAL(5,2) DEFAULT 0,
                    ativo BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            res.json([
                { id: 1, nome: 'Venda Normal', descricao: 'Venda com tributação normal' },
                { id: 2, nome: 'Simples Nacional', descricao: 'Regime Simples Nacional' },
                { id: 3, nome: 'Exportação', descricao: 'Venda para exportação' }
            ]);
        }
    } catch (error) {
        next(error);
    }
});

// GET /notificacoes/historico - Histórico de notificações
apiVendasRouter.get('/notificacoes/historico', authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        const limit = parseInt(req.query.limit) || 50;
        
        try {
            const [rows] = await pool.query(
                `SELECT * FROM notificacoes 
                 WHERE usuario_id = ? OR usuario_id IS NULL
                 ORDER BY criado_em DESC LIMIT ?`,
                [userId, limit]
            );
            res.json(rows);
        } catch (e) {
            res.json([]);
        }
    } catch (error) {
        next(error);
    }
});

// Rota para retornar dados do usuário autenticado (incluindo foto/avatar e permissões)
apiVendasRouter.get('/me', async (req, res, next) => {
    try {
        const userId = req.user && req.user.id;
        if (!userId) return res.status(401).json({ message: 'Usuário não autenticado.' });
        // Evita referenciar coluna 'foto' caso não exista no schema atual
        const [rows] = await pool.query('SELECT id, nome, email, role, is_admin, departamento, apelido, avatar, foto FROM usuarios WHERE id = ? LIMIT 1', [userId]);
        if (!rows || rows.length === 0) return res.status(404).json({ message: 'Usuário não encontrado.' });
        
        const user = rows[0];
        // Calcular isAdmin usando a função global
        user.isAdmin = verificarSeAdmin(user);
        
        res.json(user);
    } catch (error) {
        next(error);
    }
});

// --- ROTA DE DASHBOARD (ADMIN) ---
// **ATUALIZADA E OTIMIZADA** para aceitar filtros e ser mais performática
apiVendasRouter.get('/dashboard-stats', authorizeAdmin, async (req, res, next) => {
    try {
        const { status } = req.query;
        let whereClause = "WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')";
        let params = [];

        if (status && status !== 'all') {
            whereClause += " AND status = ?";
            params.push(status);
        }

        const query = `
            SELECT 
                COALESCE(SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS totalFaturadoMes,
                COUNT(CASE WHEN status IN ('orçamento', 'analise', 'aprovado') THEN 1 END) AS pedidosPendentes,
                COUNT(CASE WHEN status = 'orçamento' THEN 1 END) AS orçamentosAberto,
                (SELECT COUNT(*) FROM empresas WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')) AS novosClientesMes
            FROM pedidos
            ${whereClause}
        `;
        
        const [rows] = await pool.query(query, params);
        
        res.json(rows[0]);

    } catch (error) {
        next(error);
    }
});

// GET: monthly aggregates for last N months (admin only)
apiVendasRouter.get('/dashboard/monthly', authorizeAdmin, async (req, res, next) => {
    try {
        const months = Math.max(parseInt(req.query.months || '12'), 1);
        // compute start date (first day of month N-1 months ago)
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
        const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;

        if (dbAvailable) {
            const [rows] = await pool.query(
                `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COALESCE(SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS total
                 FROM pedidos
                 WHERE created_at >= ?
                 GROUP BY ym
                 ORDER BY ym ASC`,
                 [startStr]
            );

            // convert rows to map for quick lookup
            const map = new Map();
            for (const r of rows) map.set(r.ym, Number(r.total || 0));

            const labels = [];
            const values = [];
            for (let i = 0; i < months; i++) {
                const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
                const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                labels.push(d.toLocaleString('pt-BR', { month: 'short', year: 'numeric' }));
                values.push(map.has(ym) ? map.get(ym) : 0);
            }
            return res.json({ labels, values });
        }

        // Dev fallback: mock data
        const mockLabels = [];
        const mockValues = [];
        for (let i = months - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            mockLabels.push(d.toLocaleString('pt-BR', { month: 'short', year: 'numeric' }));
            mockValues.push(Math.floor(Math.random() * 200000) + 20000);
        }
        res.json({ labels: mockLabels, values: mockValues, note: 'mock data (DB unavailable)'});
    } catch (err) { next(err); }
});

// GET: top vendedores by faturamento in period (qualquer usuário autenticado pode ver o ranking)
apiVendasRouter.get('/dashboard/top-vendedores', authenticateToken, async (req, res, next) => {
    try {
        const limit = Math.max(parseInt(req.query.limit || '5'), 1);
        const periodDays = Math.max(parseInt(req.query.period || req.query.days || '30'), 1);
        const dataInicio = req.query.data_inicio;
        const dataFim = req.query.data_fim;
        
        const now = new Date();
        let startStr, endStr;
        
        if (dataInicio && dataFim) {
            startStr = dataInicio;
            endStr = dataFim;
        } else {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (periodDays - 1));
            startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
            endStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        }

        if (dbAvailable) {
            const [rows] = await pool.query(
                `SELECT 
                    u.id, 
                    u.nome, 
                    COUNT(p.id) as vendas,
                    COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END), 0) AS valor
                 FROM pedidos p
                 JOIN usuarios u ON p.vendedor_id = u.id
                 WHERE p.created_at >= ? AND p.created_at <= DATE_ADD(?, INTERVAL 1 DAY)
                 GROUP BY u.id, u.nome
                 ORDER BY valor DESC
                 LIMIT ?`,
                 [startStr, endStr, limit]
            );
            return res.json(rows.map(r => ({ 
                id: r.id, 
                nome: r.nome, 
                vendas: Number(r.vendas || 0),
                valor: Number(r.valor || 0) 
            })));
        }

        // Dev fallback mock - Vendedores reais da equipe
        const vendedoresReais = [
            { nome: 'Márcia Scarcella', valor: 48500 },
            { nome: 'Augusto Ladeira', valor: 42300 },
            { nome: 'Renata Nascimento', valor: 32500 },
            { nome: 'Fabiano Marques', valor: 28900 },
            { nome: 'Fabíola Souza', valor: 24700 }
        ];
        const mock = vendedoresReais.slice(0, limit).map((v, i) => ({ 
            id: i + 1, 
            nome: v.nome, 
            vendas: Math.floor(Math.random() * 50) + 10,
            valor: v.valor 
        }));
        res.json(mock);
    } catch (err) { next(err); }
});

// GET: top produtos mais vendidos (baseado nos itens dos pedidos)
apiVendasRouter.get('/dashboard/top-produtos', async (req, res, next) => {
    try {
        const limit = Math.max(parseInt(req.query.limit || '5'), 1);
        const periodDays = Math.max(parseInt(req.query.period || req.query.days || '30'), 1);
        const dataInicio = req.query.data_inicio;
        const dataFim = req.query.data_fim;
        
        const now = new Date();
        let startStr, endStr;
        
        if (dataInicio && dataFim) {
            startStr = dataInicio;
            endStr = dataFim;
        } else {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (periodDays - 1));
            startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
            endStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        }

        if (dbAvailable) {
            // Tentar buscar da tabela pedido_itens com join nos pedidos
            try {
                const [rows] = await pool.query(
                    `SELECT 
                        COALESCE(pi.descricao, pi.codigo, 'Produto') as nome,
                        pi.codigo,
                        SUM(pi.quantidade) as quantidade,
                        SUM(pi.total) as valor
                     FROM pedido_itens pi
                     JOIN pedidos p ON pi.pedido_id = p.id
                     WHERE p.created_at >= ? AND p.created_at <= DATE_ADD(?, INTERVAL 1 DAY)
                     GROUP BY COALESCE(pi.descricao, pi.codigo)
                     ORDER BY valor DESC
                     LIMIT ?`,
                    [startStr, endStr, limit]
                );
                
                if (rows && rows.length > 0) {
                    return res.json(rows.map(r => ({
                        nome: r.nome,
                        codigo: r.codigo,
                        quantidade: Number(r.quantidade || 0),
                        valor: Number(r.valor || 0)
                    })));
                }
            } catch (dbErr) {
                console.warn('Erro ao buscar top-produtos de pedido_itens:', dbErr.message);
            }
            
            // Fallback: tentar da tabela pedidos_vendas/itens_pedido
            try {
                const [rows] = await pool.query(
                    `SELECT 
                        COALESCE(ip.descricao, ip.produto_nome, pr.nome, 'Produto') as nome,
                        ip.produto_codigo as codigo,
                        SUM(ip.quantidade) as quantidade,
                        SUM(ip.valor_total) as valor
                     FROM itens_pedido ip
                     LEFT JOIN pedidos_vendas pv ON ip.pedido_id = pv.id
                     LEFT JOIN produtos pr ON ip.produto_id = pr.id
                     WHERE pv.data_pedido >= ? AND pv.data_pedido <= DATE_ADD(?, INTERVAL 1 DAY)
                     GROUP BY COALESCE(ip.descricao, ip.produto_nome, pr.nome)
                     ORDER BY valor DESC
                     LIMIT ?`,
                    [startStr, endStr, limit]
                );
                
                if (rows && rows.length > 0) {
                    return res.json(rows.map(r => ({
                        nome: r.nome,
                        codigo: r.codigo,
                        quantidade: Number(r.quantidade || 0),
                        valor: Number(r.valor || 0)
                    })));
                }
            } catch (dbErr2) {
                console.warn('Erro ao buscar top-produtos de itens_pedido:', dbErr2.message);
            }
        }

        // Fallback: retornar array vazio
        res.json([]);
    } catch (err) { next(err); }
});

// ========================================
// RELATÓRIO DE LIGAÇÕES (RAMAIS) - CDR Scraper via Puppeteer
// ========================================

// Importar serviço de CDR Scraping
const cdrScraper = require('../../services/cdr-scraper');

// GET /api/vendas/ligacoes/dispositivos - Listar ramais/devices
apiVendasRouter.get('/ligacoes/dispositivos', async (req, res, next) => {
    try {
        const { data_inicio, data_fim } = req.query;
        const ramais = await cdrScraper.listarRamais(data_inicio, data_fim);
        res.json(ramais);
    } catch (error) {
        console.error('Erro ao listar ramais CDR:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/vendas/ligacoes/cdr - Relatório de chamadas realizadas
apiVendasRouter.get('/ligacoes/cdr', async (req, res, next) => {
    try {
        const { data_inicio, data_fim, ramal, tipo } = req.query;
        
        // Datas padrão: hoje
        const hoje = new Date().toISOString().split('T')[0];
        const di = data_inicio || hoje;
        const df = data_fim || hoje;
        
        let chamadas = await cdrScraper.fetchCDRData(di, df);
        
        // Filtrar por ramal se especificado
        if (ramal) {
            chamadas = chamadas.filter(c => c.ramal === ramal || c.origem === ramal);
        }
        
        // Filtrar por tipo se especificado
        if (tipo === 'movel') {
            chamadas = chamadas.filter(c => c.subtipo === 'movel');
        } else if (tipo === 'fixo') {
            chamadas = chamadas.filter(c => c.subtipo === 'fixo');
        }
        
        res.json({
            total: chamadas.length,
            chamadas,
            periodo: { inicio: di, fim: df }
        });
    } catch (error) {
        console.error('Erro ao buscar CDR:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/vendas/ligacoes/cdr-entrada - CDR de chamadas entrantes (DID)
apiVendasRouter.get('/ligacoes/cdr-entrada', async (req, res, next) => {
    try {
        // Este relatório não está disponível via scraping do painel atual
        // Retornar array vazio por enquanto
        res.json({ total: 0, chamadas: [], mensagem: 'Relatório de chamadas recebidas via DID - em implementação' });
    } catch (error) {
        console.error('Erro ao buscar CDR entrada:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/vendas/ligacoes/online - Chamadas em andamento
apiVendasRouter.get('/ligacoes/online', async (req, res, next) => {
    try {
        // Chamadas em andamento não disponíveis via scraping
        res.json({ total: 0, chamadas: [] });
    } catch (error) {
        console.error('Erro ao buscar chamadas online:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/vendas/ligacoes/resumo - Resumo de ligações (dashboard)
apiVendasRouter.get('/ligacoes/resumo', async (req, res, next) => {
    try {
        const { data_inicio, data_fim } = req.query;
        
        const hoje = new Date().toISOString().split('T')[0];
        const di = data_inicio || hoje;
        const df = data_fim || hoje;
        
        const chamadas = await cdrScraper.fetchCDRData(di, df);
        const resumo = cdrScraper.gerarResumo(chamadas);
        
        resumo.periodo = { inicio: di, fim: df };
        
        res.json(resumo);
    } catch (error) {
        console.error('Erro ao gerar resumo de ligações:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/vendas/ligacoes/status - Verificar se integração CDR está configurada
apiVendasRouter.get('/ligacoes/status', async (req, res) => {
    const status = cdrScraper.getStatus();
    res.json(status);
});

// ========================================
// ROTAS DE RELATÓRIOS PDF
// ========================================

// Helper: criar PDF com PDFKit
function criarPdfRelatorio(titulo, colunas, linhas, filtrosTexto) {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    const buffers = [];
    doc.on('data', b => buffers.push(b));

    // Header
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#1a1a2e').text('ALUFORCE', 40, 30);
    doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('Sistema de Gestão Empresarial', 40, 55);
    doc.moveTo(40, 72).lineTo(doc.page.width - 40, 72).strokeColor('#e5e7eb').stroke();

    // Título do relatório
    doc.moveDown(0.5);
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e293b').text(titulo, { align: 'center' });
    if (filtrosTexto) {
        doc.fontSize(9).font('Helvetica').fillColor('#6b7280').text(filtrosTexto, { align: 'center' });
    }
    doc.fontSize(8).fillColor('#94a3b8').text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { align: 'center' });
    doc.moveDown(1);

    // Tabela
    const tableTop = doc.y;
    const pageW = doc.page.width - 80;
    const colW = pageW / colunas.length;

    // Header da tabela
    doc.rect(40, tableTop, pageW, 24).fill('#f1f5f9');
    colunas.forEach((col, i) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151')
           .text(col, 44 + i * colW, tableTop + 7, { width: colW - 8, align: 'left' });
    });

    let y = tableTop + 28;
    linhas.forEach((linha, idx) => {
        if (y > doc.page.height - 60) {
            doc.addPage();
            y = 40;
        }
        if (idx % 2 === 0) {
            doc.rect(40, y - 2, pageW, 20).fill('#fafafa');
        }
        linha.forEach((val, i) => {
            doc.fontSize(8).font('Helvetica').fillColor('#374151')
               .text(String(val || '-'), 44 + i * colW, y + 2, { width: colW - 8, align: 'left' });
        });
        y += 20;
    });

    // Footer
    doc.fontSize(8).fillColor('#94a3b8')
       .text(`Total de registros: ${linhas.length}`, 40, y + 16);

    doc.end();
    return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(buffers))));
}

function formatarMoedaPdf(valor) {
    return 'R$ ' + (parseFloat(valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarDataPdf(data) {
    if (!data) return '-';
    return new Date(data).toLocaleDateString('pt-BR');
}

// PDF: Vendas por Período
apiVendasRouter.get('/relatorios/vendas-periodo/pdf', authenticateToken, async (req, res) => {
    try {
        const { data_inicio, data_fim, vendedor_id, status } = req.query;
        let query = `SELECT p.numero_pedido, p.cliente_nome, p.vendedor_nome, p.valor, p.status, p.created_at
                     FROM pedidos p WHERE 1=1`;
        const params = [];
        if (data_inicio) { query += ' AND p.created_at >= ?'; params.push(data_inicio); }
        if (data_fim) { query += ' AND p.created_at <= ?'; params.push(data_fim + ' 23:59:59'); }
        if (vendedor_id) { query += ' AND p.vendedor_id = ?'; params.push(vendedor_id); }
        if (status && status !== 'todos') { query += ' AND p.status = ?'; params.push(status); }
        query += ' ORDER BY p.created_at DESC';

        const [rows] = await pool.query(query, params);
        const filtro = `Período: ${data_inicio || 'início'} a ${data_fim || 'hoje'}${vendedor_id ? ' | Vendedor filtrado' : ''}${status && status !== 'todos' ? ` | Status: ${status}` : ''}`;
        const colunas = ['Nº Pedido', 'Cliente', 'Vendedor', 'Valor', 'Status', 'Data'];
        const linhas = rows.map(r => [
            r.numero_pedido || '-', r.cliente_nome || '-', r.vendedor_nome || '-',
            formatarMoedaPdf(r.valor), r.status || '-', formatarDataPdf(r.created_at)
        ]);

        const pdfBuffer = await criarPdfRelatorio('Relatório de Vendas por Período', colunas, linhas, filtro);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename=relatorio-vendas.pdf' });
        res.send(pdfBuffer);
    } catch (err) {
        console.error('Erro ao gerar PDF vendas-periodo:', err);
        res.status(500).json({ error: 'Erro ao gerar PDF' });
    }
});

// PDF: Comissões
apiVendasRouter.get('/relatorios/comissoes/pdf', authenticateToken, async (req, res) => {
    try {
        const { data_inicio, data_fim, vendedor_id, percentual_comissao } = req.query;
        const pct = parseFloat(percentual_comissao) || 1;
        let query = `SELECT p.vendedor_nome, COUNT(*) as qtd, SUM(p.valor) as total_vendas,
                     SUM(p.valor * ${pct} / 100) as comissao
                     FROM pedidos p WHERE p.status IN ('faturado','entregue','aprovado')`;
        const params = [];
        if (data_inicio) { query += ' AND p.created_at >= ?'; params.push(data_inicio); }
        if (data_fim) { query += ' AND p.created_at <= ?'; params.push(data_fim + ' 23:59:59'); }
        if (vendedor_id) { query += ' AND p.vendedor_id = ?'; params.push(vendedor_id); }
        query += ' GROUP BY p.vendedor_id, p.vendedor_nome ORDER BY comissao DESC';

        const [rows] = await pool.query(query, params);
        const filtro = `Período: ${data_inicio || 'início'} a ${data_fim || 'hoje'} | Percentual: ${pct}%`;
        const colunas = ['Vendedor', 'Qtd Vendas', 'Total Vendido', 'Comissão'];
        const linhas = rows.map(r => [
            r.vendedor_nome || '-', r.qtd || 0,
            formatarMoedaPdf(r.total_vendas), formatarMoedaPdf(r.comissao)
        ]);

        const pdfBuffer = await criarPdfRelatorio('Relatório de Comissões', colunas, linhas, filtro);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename=relatorio-comissoes.pdf' });
        res.send(pdfBuffer);
    } catch (err) {
        console.error('Erro ao gerar PDF comissoes:', err);
        res.status(500).json({ error: 'Erro ao gerar PDF' });
    }
});

// PDF: Clientes
apiVendasRouter.get('/relatorios/clientes/pdf', authenticateToken, async (req, res) => {
    try {
        const { cliente_id, status, cidade, estado, ordenar_por } = req.query;
        let query = `SELECT c.nome, c.email, c.telefone, c.cidade, c.estado, c.ativo,
                     (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) as qtd_pedidos,
                     (SELECT SUM(p.valor) FROM pedidos p WHERE p.cliente_id = c.id) as total_compras
                     FROM clientes c WHERE 1=1`;
        const params = [];
        if (cliente_id) { query += ' AND c.id = ?'; params.push(cliente_id); }
        if (status === 'ativo') { query += ' AND c.ativo = 1'; }
        else if (status === 'inativo') { query += ' AND c.ativo = 0'; }
        if (cidade) { query += ' AND c.cidade LIKE ?'; params.push(`%${cidade}%`); }
        if (estado) { query += ' AND c.estado = ?'; params.push(estado); }
        const orderMap = { nome: 'c.nome ASC', pedidos: 'qtd_pedidos DESC', valor: 'total_compras DESC' };
        query += ` ORDER BY ${orderMap[ordenar_por] || 'c.nome ASC'}`;

        const [rows] = await pool.query(query, params);
        const filtro = `${cidade ? `Cidade: ${cidade} | ` : ''}${estado ? `Estado: ${estado} | ` : ''}Ordenado por: ${ordenar_por || 'nome'}`;
        const colunas = ['Nome', 'Email', 'Telefone', 'Cidade', 'UF', 'Pedidos', 'Total Compras'];
        const linhas = rows.map(r => [
            r.nome || '-', r.email || '-', r.telefone || '-',
            r.cidade || '-', r.estado || '-', r.qtd_pedidos || 0, formatarMoedaPdf(r.total_compras)
        ]);

        const pdfBuffer = await criarPdfRelatorio('Relatório de Clientes', colunas, linhas, filtro);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename=relatorio-clientes.pdf' });
        res.send(pdfBuffer);
    } catch (err) {
        console.error('Erro ao gerar PDF clientes:', err);
        res.status(500).json({ error: 'Erro ao gerar PDF' });
    }
});

// PDF: Produtos
apiVendasRouter.get('/relatorios/produtos/pdf', authenticateToken, async (req, res) => {
    try {
        const { data_inicio, data_fim, ordenar_por } = req.query;
        let query = `SELECT pi.descricao, pi.codigo, SUM(pi.quantidade) as qtd_total,
                     SUM(pi.preco_unitario * pi.quantidade) as valor_total,
                     COUNT(DISTINCT pi.pedido_id) as qtd_pedidos
                     FROM pedido_itens pi
                     INNER JOIN pedidos p ON pi.pedido_id = p.id
                     WHERE 1=1`;
        const params = [];
        if (data_inicio) { query += ' AND p.created_at >= ?'; params.push(data_inicio); }
        if (data_fim) { query += ' AND p.created_at <= ?'; params.push(data_fim + ' 23:59:59'); }
        query += ' GROUP BY pi.descricao, pi.codigo';
        const orderMap = { quantidade: 'qtd_total DESC', valor: 'valor_total DESC', nome: 'pi.descricao ASC' };
        query += ` ORDER BY ${orderMap[ordenar_por] || 'valor_total DESC'}`;

        const [rows] = await pool.query(query, params);
        const filtro = `Período: ${data_inicio || 'início'} a ${data_fim || 'hoje'} | Ordenado por: ${ordenar_por || 'valor'}`;
        const colunas = ['Código', 'Descrição', 'Qtd Vendida', 'Nº Pedidos', 'Valor Total'];
        const linhas = rows.map(r => [
            r.codigo || '-', r.descricao || '-', r.qtd_total || 0,
            r.qtd_pedidos || 0, formatarMoedaPdf(r.valor_total)
        ]);

        const pdfBuffer = await criarPdfRelatorio('Relatório de Produtos Mais Vendidos', colunas, linhas, filtro);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename=relatorio-produtos.pdf' });
        res.send(pdfBuffer);
    } catch (err) {
        console.error('Erro ao gerar PDF produtos:', err);
        res.status(500).json({ error: 'Erro ao gerar PDF' });
    }
});

// ========================================
// ROTA PROXY CEP (evita CORS no client)
// ========================================
apiVendasRouter.get('/proxy/cep/:cep', async (req, res) => {
    try {
        const { cep } = req.params;
        const cleanCep = cep.replace(/\D/g, '');
        if (cleanCep.length !== 8) return res.status(400).json({ error: 'CEP inválido' });
        
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${cleanCep}`);
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('Erro proxy CEP:', err.message);
        res.status(500).json({ error: 'Erro ao consultar CEP' });
    }
});

app.use('/api/vendas', apiVendasRouter);

// ==============================================
// SISTEMA DE NOTIFICAÇÕES
// ==============================================
const NOTIFICATIONS_FILE = path.join(__dirname, 'data', 'notifications.json');

function loadNotifications() {
    try {
        ensureDataDir();
        if (!fs.existsSync(NOTIFICATIONS_FILE)) return [];
        const raw = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (e) { return []; }
}

function saveNotifications(arr) {
    try { 
        ensureDataDir(); 
        fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(arr, null, 2), 'utf8'); 
    } catch(e){}
}

function createNotification(type, title, message, data = {}) {
    const notifications = loadNotifications();
    const notification = {
        id: Date.now(),
        type, // 'order', 'payment', 'stock', 'success', 'warning', 'error', 'info'
        title,
        message,
        data,
        read: false,
        important: type === 'error' || type === 'stock',
        createdAt: new Date().toISOString()
    };
    notifications.unshift(notification);
    // Manter apenas as últimas 100 notificações
    if (notifications.length > 100) notifications.length = 100;
    saveNotifications(notifications);
    
    // Emitir via Socket.IO se disponível
    if (io) {
        io.emit('notification', notification);
    }
    
    return notification;
}

// API de Notificações (com filtro por role: admin vê tudo, vendedor vê só suas movimentações)
app.get('/api/notifications', (req, res) => {
    // Soft-auth: tenta extrair usuário do token sem bloquear
    let user = req.user || {};
    if (!user.id) {
        try {
            const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
            let token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.split(' ')[1] : null;
            if (!token && req.cookies) token = req.cookies.authToken || req.cookies.token;
            if (token) {
                const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
                user = decoded;
            }
        } catch(e) { /* sem auth, mostra tudo */ }
    }
    
    let notifications = loadNotifications();
    
    // Identificar usuário logado (usa o user já extraído acima)
    const adminsEmails = ['ti@aluforce.ind.br', 'andreia@aluforce.ind.br', 'douglas@aluforce.ind.br'];
    const adminsNomes = ['antonio egidio', 'andreia', 'douglas'];
    
    let isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
    if (!isAdmin && user.email) {
        isAdmin = adminsEmails.includes(user.email.toLowerCase());
    }
    if (!isAdmin && user.nome) {
        const nomeMin = user.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        isAdmin = adminsNomes.some(admin => nomeMin.includes(admin));
    }
    
    // Vendedor: filtra só notificações onde ele é o autor OU é o vendedor responsável do pedido
    if (!isAdmin && user.id) {
        notifications = notifications.filter(n => {
            // Notificações sem dados de usuário (legadas) aparecem para todos
            if (!n.data || !n.data.tipo) return true;
            // Notificações de movimentação: vendedor vê as dele
            if (n.data.tipo === 'movimentacao_status' || n.data.tipo === 'novo_pedido') {
                return (
                    n.data.user_id === user.id ||               // Ele quem moveu/criou
                    n.data.vendedor_id === user.id ||            // Ele é o vendedor do pedido
                    String(n.data.user_id) === String(user.id) ||
                    String(n.data.vendedor_id) === String(user.id)
                );
            }
            // Outros tipos mostram para todos
            return true;
        });
    }
    
    const filter = req.query.filter; // 'all', 'unread', 'important'
    let filtered = notifications;
    
    if (filter === 'unread') {
        filtered = notifications.filter(n => !n.read);
    } else if (filter === 'important') {
        filtered = notifications.filter(n => n.important);
    }
    
    res.json({
        notifications: filtered.slice(0, 50),
        unreadCount: notifications.filter(n => !n.read).length,
        total: notifications.length
    });
});

app.post('/api/notifications/:id/read', express.json(), (req, res) => {
    const notifications = loadNotifications();
    const id = parseInt(req.params.id);
    const notification = notifications.find(n => n.id === id);
    if (notification) {
        notification.read = true;
        saveNotifications(notifications);
    }
    res.json({ success: true });
});

app.post('/api/notifications/read-all', (req, res) => {
    const notifications = loadNotifications();
    notifications.forEach(n => n.read = true);
    saveNotifications(notifications);
    res.json({ success: true });
});

app.delete('/api/notifications/:id', (req, res) => {
    let notifications = loadNotifications();
    const id = parseInt(req.params.id);
    notifications = notifications.filter(n => n.id !== id);
    saveNotifications(notifications);
    res.json({ success: true });
});

// Rota para criar notificação (uso interno/admin)
app.post('/api/notifications', express.json(), (req, res) => {
    const { type, title, message, data } = req.body;
    const notification = createNotification(type || 'info', title, message, data);
    res.json(notification);
});

// Exportar função para uso interno
global.createNotification = createNotification;

// ==============================================
// ROTA PÚBLICA DE PEDIDOS (PARA PÁGINA GESTÃO)
// ==============================================
app.get('/api/pedidos', async (req, res) => {
    try {
        if (!dbAvailable || !pool) {
            return res.json([]);
        }
        
        const [rows] = await pool.query(`
            SELECT 
                p.id,
                p.id as numero,
                p.valor as valor_total,
                p.status,
                p.created_at as data_pedido,
                p.vendedor_id,
                p.data_previsao,
                e.nome_fantasia AS cliente_nome,
                e.cnpj AS cliente_cnpj,
                u.nome AS vendedor_nome
            FROM pedidos p
            LEFT JOIN empresas e ON p.empresa_id = e.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            ORDER BY p.id DESC
            LIMIT 200
        `);
        
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar pedidos:', error);
        res.json([]);
    }
});

// --- ROTA DE DESENVOLVIMENTO: emitir token para um usuário (APENAS EM AMBIENTE DE DESENVOLVIMENTO LOCAL)
// SEGURANÇA: Esta rota NUNCA deve estar disponível em produção
if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_TOKEN === 'true') {
    console.warn('⚠️  ATENÇÃO: Rota /dev/token habilitada - APENAS PARA DESENVOLVIMENTO LOCAL');
    app.get('/dev/token/:userId', async (req, res, next) => {
        try {
            const userId = req.params.userId;
            if (!userId) return res.status(400).json({ message: 'userId é obrigatório.' });
            if (dbAvailable) {
                const [rows] = await pool.query('SELECT id, nome, email, role, is_admin FROM usuarios WHERE id = ? LIMIT 1', [userId]);
                if (!rows || rows.length === 0) return res.status(404).json({ message: 'Usuário não encontrado.' });
                const user = rows[0];
                const tokenPayload = { id: user.id, nome: user.nome, email: user.email, role: user.role, is_admin: user.is_admin };
                // AUDIT-FIX ARCH-004: Added algorithm HS256 + audience claim
                const token = jwt.sign(tokenPayload, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '8h' });
                return res.json({ token, user: tokenPayload });
            }

            // Fallback: gerar um token com dados simulados para desenvolvimento quando o DB estiver indisponível
            const fallbackUser = {
                id: parseInt(userId) || 1,
                nome: `dev-user-${userId}`,
                email: `dev+${userId}@example.local`,
                role: 'dev',
                is_admin: true
            };
            // AUDIT-FIX ARCH-004: Added algorithm HS256 + audience claim
            const token = jwt.sign(fallbackUser, JWT_SECRET, { algorithm: 'HS256', audience: 'aluforce', expiresIn: '8h' });
            return res.json({ token, user: fallbackUser, note: 'DB indisponível — token de desenvolvimento gerado (apenas para dev).' });
        } catch (err) {
            next(err);
        }
    });
}

// --- ROTAS ESPECÍFICAS PARA PÁGINAS PÚBLICAS ---
// Suporte a caminhos alternativos comuns
app.get('/Vendas/public/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/Vendas/public/:page', (req, res) => {
    const page = req.params.page;
    const filePath = path.join(__dirname, 'public', page);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});
app.get('/Vendas/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- ROTA "CATCH-ALL" E MANIPULADOR DE ERROS ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health-check endpoint: quick diagnostics for DB, Redis and static assets
app.get('/health', async (req, res) => {
    const status = { ok: true, checks: {} };
    // DB
    try {
        if (pool) {
            await pool.query('SELECT 1');
            status.checks.db = { connected: true };
        } else {
            status.checks.db = { connected: false, reason: 'no_pool' };
            status.ok = false;
        }
    } catch (e) {
        status.checks.db = { connected: false, reason: e && e.message ? e.message : String(e) };
        status.ok = false;
    }

    // Redis
    try {
        if (redisClient) {
            const pong = await redisClient.ping();
            status.checks.redis = { connected: pong === 'PONG' || Boolean(pong) };
            if (!status.checks.redis.connected) status.ok = false;
        } else {
            status.checks.redis = { connected: false, reason: 'redis_not_configured' };
        }
    } catch (e) {
        status.checks.redis = { connected: false, reason: e && e.message ? e.message : String(e) };
        status.ok = false;
    }

    // Static asset check (vendas.js)
    try {
        const vendasPath = path.join(__dirname, 'public', 'vendas.js');
        const exists = fs.existsSync(vendasPath);
        status.checks.static = { vendas_js_exists: exists };
        if (!exists) status.ok = false;
    } catch (e) {
        status.checks.static = { vendas_js_exists: false, reason: e && e.message ? e.message : String(e) };
        status.ok = false;
    }

    status.time = new Date().toISOString();
    return res.json(status);
});

app.use((err, req, res, next) => {
    console.error('❌ ERRO NO SERVIDOR:', err.stack);
    if (!res.headersSent) {
        res.status(500).json({
            message: 'Ocorreu um erro inesperado no servidor.',
            error: process.env.NODE_ENV === 'development' ? err.message : {}
        });
    }
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const startServer = async () => {
    try {
        await pool.query('SELECT 1');
        dbAvailable = true;
        console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
    } catch (error) {
        dbAvailable = false;
        console.error('⚠️ AVISO: Não foi possível conectar ao banco de dados.');
        console.error(error && error.message ? error.message : error);
        if (process.env.NODE_ENV !== 'development') {
            console.error('❌ ERRO FATAL: em produção a conexão com o DB é obrigatória. Encerrando.');
            process.exit(1);
        } else {
            console.warn('Continuando em modo de desenvolvimento sem o banco de dados. Algumas rotas estarão limitadas.');
        }
    }

    // schedule background aggregation job if DB available
    try {
        if (dbAvailable) {
            // run once immediately
            computeAndCacheAggregates().catch(() => {});
            // then schedule hourly
            setInterval(() => { computeAndCacheAggregates().catch(() => {}); }, 60 * 60 * 1000);
        }
    } catch (e) {}

    // Create HTTP server and attach Socket.IO
    const server = http.createServer(app);

    try {
        io = new IOServer(server, { cors: { origin: process.env.CORS_ORIGIN || true, methods: ['GET','POST'], credentials: true } });

    io.on('connection', (socket) => {
            try {
                // Accept token via handshake.auth.token or Authorization header
                const tokenFromAuth = socket.handshake && socket.handshake.auth && socket.handshake.auth.token;
                const authHeader = socket.handshake && socket.handshake.headers && (socket.handshake.headers.authorization || socket.handshake.headers.Authorization);
                const token = tokenFromAuth || (typeof authHeader === 'string' ? (authHeader.split(' ')[1] || null) : null);

                if (!token) {
                    socket.emit('chat:error', { message: 'Token ausente. Conexão negada.' });
                    socket.disconnect(true);
                    return;
                }

                let decoded = null;
                try { decoded = jwt.verify(token, JWT_SECRET); } catch (err) {
                    socket.emit('chat:error', { message: 'Token inválido. Autenticação falhou.' });
                    socket.disconnect(true);
                    return;
                }

                socket.user = decoded;
                appendChatLog({ type: 'socket:connect', user: socket.user && (socket.user.id || socket.user.nome) });
                // send full history to the newly connected client
                try { socket.emit('chat:history', loadChatHistory()); } catch (e) { /* ignore */ }

                // receive messages from client
                socket.on('chat:message', (payload) => {
                    try {
                        if (!payload || !payload.text) return;
                        const who = payload.who || (socket.user && (socket.user.nome || socket.user.name)) || 'user';
                        const item = { id: Date.now() + Math.floor(Math.random()*999), who: who, text: String(payload.text || ''), ts: Date.now() };
                        const history = loadChatHistory();
                        history.push(item);
                        saveChatHistory(history);
                        appendChatLog({ type: 'socket:message', from: who, item });
                        // broadcast to all connected clients
                        try { io && io.emit && io.emit('chat:message', item); } catch(e){}
                    } catch (err) {
                        console.error('Erro ao processar chat:message:', err && err.message ? err.message : err);
                    }
                });

                socket.on('disconnect', (reason) => {
                    try { appendChatLog({ type: 'socket:disconnect', user: socket.user && (socket.user.id || socket.user.nome), reason }); } catch(e){}
                });

            } catch (err) {
                console.error('Erro no handler de conexao socket:', err && err.message ? err.message : err);
                try { socket.disconnect(true); } catch(e){}
            }
        });
    } catch (err) {
        console.error('Falha ao inicializar Socket.IO:', err && err.message ? err.message : err);
        io = null;
    }

    server.listen(port, () => {
        console.log(`🚀 Servidor executando em http://localhost:${port}` + (dbAvailable ? '' : ' (DB indisponível, modo dev)'));
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️  Porta ${port} já está em uso.`);
            
            // Se temos mais portas para tentar
            const currentIndex = PORTS_TO_TRY.indexOf(port);
            if (currentIndex >= 0 && currentIndex < PORTS_TO_TRY.length - 1) {
                port = PORTS_TO_TRY[currentIndex + 1];
                console.log(`🔄 Tentando porta ${port}...`);
                startServer();
            } else {
                console.error(`❌ Todas as portas (${PORTS_TO_TRY.join(', ')}) estão ocupadas. Finalizando.`);
                process.exit(1);
            }
        } else {
            console.error('❌ Erro ao iniciar servidor:', err);
            process.exit(1);
        }
    });
};

// Limpeza periódica de sessões expiradas (a cada 1 hora)
setInterval(() => {
    cleanExpiredSessions(pool).catch(err => {
        console.error('Erro ao limpar sessões:', err);
    });
}, 60 * 60 * 1000); // 1 hora

// Apenas inicia o servidor quando não estivermos em modo de teste
if (process.env.NODE_ENV !== 'test') {
    startServer();
}

module.exports = { app, pool, startServer };