const path = require('path');

// Load environment variables FIRST (before any module that reads process.env)
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
// mysql2/promise removido — pool centralizado em database/pool.js (Sprint 7)
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

// Auth centralizado (Sprint 7 — Consolidação de Arquitetura)
const { authenticateToken } = require('../../middleware/auth-central');
const { corsOptions } = require('../../config/cors');
const { errorHandler } = require('../../middleware/error-handler');

// CRITICAL: JWT_SECRET must be defined — no fallback
if (!process.env.JWT_SECRET) {
    console.error('❌ ERRO FATAL [PCP]: JWT_SECRET não definido no .env');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

// PRODUÇÃO: Silenciar console.log para evitar vazamento de dados
if (process.env.NODE_ENV === 'production') {
    const _origLog = console.log;
    console.log = function(...args) {
        if (process.uptime && process.uptime() < 30) _origLog.apply(console, args);
    };
}

// LGPD - Descriptografia de campos PII (CNPJ, CPF, IE)
let lgpdCrypto;
try { lgpdCrypto = require('../../lgpd-crypto'); } catch(e) { lgpdCrypto = { decryptPII: (v) => v }; }

// =================================================================
// NOTIFICAÇÕES PCP VIA EMAIL
// =================================================================
const PCP_EMAIL = 'pcp@aluforce.ind.br';

// Função para enviar notificações do PCP
async function enviarNotificacaoPCP(tipo, dados) {
    try {
        const pcpTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'mail.aluforce.ind.br',
            port: parseInt(process.env.SMTP_PORT || '465'),
            secure: true,
            auth: {
                user: process.env.SMTP_USER || 'sistema@aluforce.ind.br',
                pass: process.env.SMTP_PASS // SEGURANÇA: Credencial via env var obrigatória
            },
            tls: { rejectUnauthorized: process.env.NODE_ENV !== 'production' ? false : true }
        });

        let assunto = '';
        let html = '';
        const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const estiloBase = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px; border-radius: 12px;">
                <div style="background: linear-gradient(135deg, #1a5a96 0%, #2980b9 100%); padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 24px;">🏭 ALUFORCE - PCP</h1>
                </div>
                <div style="background: white; padding: 25px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        `;
        const estiloFim = `
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="color: #888; font-size: 12px; text-align: center; margin: 0;">
                        Sistema ALUFORCE ERP - Notificação automática<br>
                        ${dataHora}
                    </p>
                </div>
            </div>
        `;

        switch (tipo) {
            case 'ENTRADA_MATERIAL':
                assunto = `📦 [PCP] Entrada de Material: ${dados.codigo || dados.descricao}`;
                html = `${estiloBase}
                    <h2 style="color: #27ae60; margin-top: 0;">📥 Entrada de Material Registrada</h2>
                    <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
                        <tr style="background: #f8f9fa;"><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Material</td><td style="padding: 12px; border: 1px solid #ddd;">${dados.descricao || dados.codigo}</td></tr>
                        <tr><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Código</td><td style="padding: 12px; border: 1px solid #ddd;">${dados.codigo || '-'}</td></tr>
                        <tr style="background: #f8f9fa;"><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Quantidade Entrada</td><td style="padding: 12px; border: 1px solid #ddd; color: #27ae60; font-weight: bold;">+${dados.quantidade} ${dados.unidade || ''}</td></tr>
                        <tr><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Estoque Anterior</td><td style="padding: 12px; border: 1px solid #ddd;">${dados.estoque_anterior} ${dados.unidade || ''}</td></tr>
                        <tr style="background: #e8f5e9;"><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Estoque Atual</td><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold; color: #27ae60;">${dados.estoque_atual} ${dados.unidade || ''}</td></tr>
                        ${dados.observacao ? `<tr><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Observação</td><td style="padding: 12px; border: 1px solid #ddd;">${dados.observacao}</td></tr>` : ''}
                    </table>
                ${estiloFim}`;
                break;

            case 'SAIDA_MATERIAL':
                assunto = `📤 [PCP] Saída de Material: ${dados.codigo || dados.descricao}`;
                html = `${estiloBase}
                    <h2 style="color: #e74c3c; margin-top: 0;">📤 Saída de Material Registrada (Baixa)</h2>
                    <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
                        <tr style="background: #f8f9fa;"><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Material</td><td style="padding: 12px; border: 1px solid #ddd;">${dados.descricao || dados.codigo}</td></tr>
                        <tr><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Código</td><td style="padding: 12px; border: 1px solid #ddd;">${dados.codigo || '-'}</td></tr>
                        <tr style="background: #f8f9fa;"><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Quantidade Saída</td><td style="padding: 12px; border: 1px solid #ddd; color: #e74c3c; font-weight: bold;">-${dados.quantidade} ${dados.unidade || ''}</td></tr>
                        <tr><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Estoque Anterior</td><td style="padding: 12px; border: 1px solid #ddd;">${dados.estoque_anterior} ${dados.unidade || ''}</td></tr>
                        <tr style="background: #ffebee;"><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Estoque Atual</td><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold; color: #e74c3c;">${dados.estoque_atual} ${dados.unidade || ''}</td></tr>
                        ${dados.destino ? `<tr><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Destino</td><td style="padding: 12px; border: 1px solid #ddd;">${dados.destino}</td></tr>` : ''}
                        ${dados.observacao ? `<tr style="background: #f8f9fa;"><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Observação</td><td style="padding: 12px; border: 1px solid #ddd;">${dados.observacao}</td></tr>` : ''}
                    </table>
                ${estiloFim}`;
                break;

            case 'ESTOQUE_BAIXO':
                assunto = `⚠️ [PCP] ALERTA: Estoque Baixo - ${dados.codigo || dados.descricao}`;
                html = `${estiloBase}
                    <h2 style="color: #f39c12; margin-top: 0;">⚠️ Alerta de Estoque Baixo</h2>
                    <p style="color: #e74c3c; font-weight: bold; background: #fff3cd; padding: 10px; border-radius: 5px;">Atenção! O material abaixo está com estoque crítico.</p>
                    <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
                        <tr style="background: #fff3cd;"><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Material</td><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">${dados.descricao || dados.codigo}</td></tr>
                        <tr><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Código</td><td style="padding: 12px; border: 1px solid #ddd;">${dados.codigo}</td></tr>
                        <tr style="background: #ffebee;"><td style="padding: 12px; border: 1px solid #ddd; font-weight: bold;">Estoque Atual</td><td style="padding: 12px; border: 1px solid #ddd; color: #e74c3c; font-weight: bold;">${dados.estoque_atual} ${dados.unidade || ''}</td></tr>
                    </table>
                ${estiloFim}`;
                break;

            default:
                assunto = `📢 [PCP] Notificação: ${dados.titulo || 'Alerta'}`;
                html = `${estiloBase}<h2 style="color: #34495e; margin-top: 0;">📢 ${dados.titulo || 'Notificação PCP'}</h2><p style="color: #555; line-height: 1.6;">${dados.mensagem || JSON.stringify(dados)}</p>${estiloFim}`;
        }

        const info = await pcpTransporter.sendMail({
            from: '"ALUFORCE PCP" <sistema@aluforce.ind.br>',
            to: PCP_EMAIL,
            subject: assunto,
            html: html
        });

        console.log(`📧 [PCP] Email enviado para ${PCP_EMAIL}: ${assunto} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };

    } catch (error) {
        console.error(`❌ [PCP] Erro ao enviar email:`, error.message);
        return { success: false, error: error.message };
    }
}

// 🔒 SECURITY IMPORTS
const {
    generalLimiter,
    authLimiter,
    apiLimiter,
    sanitizeInput,
    validateRequired,
    validateEmail,
    securityHeaders,
    cleanExpiredSessions
} = require('../../security-middleware');

// Sistema de logs melhorado
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const logger = {
    debug: LOG_LEVEL === 'debug' ? console.log : () => {},
    info: console.log,
    warn: console.warn,
    error: console.error
};

// 🚀 PERFORMANCE: Cache em memória para queries frequentes
const queryCache = new Map();
const CACHE_TTL = 30000; // 30 segundos

function getCachedQuery(key) {
    const cached = queryCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    queryCache.delete(key);
    return null;
}

function setCachedQuery(key, data) {
    // Limpar cache se muito grande
    if (queryCache.size > 100) {
        const oldest = queryCache.keys().next().value;
        queryCache.delete(oldest);
    }
    queryCache.set(key, { data, timestamp: Date.now() });
}

function invalidateCache(pattern) {
    for (const key of queryCache.keys()) {
        if (key.includes(pattern)) {
            queryCache.delete(key);
        }
    }
}

// Função para formatar CPF/CNPJ com pontuação
function formatarCpfCnpjExcel(valor) {
    if (!valor) return '';

    // Remove tudo que não é número
    const numeros = String(valor).replace(/\D/g, '');

    if (numeros.length === 11) {
        // CPF: 000.000.000-00
        return numeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    } else if (numeros.length === 14) {
        // CNPJ: 00.000.000/0000-00
        return numeros.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }

    // Se já tiver formatação ou tamanho inválido, retorna como está
    return valor;
}

// Tratamento global de erros para evitar crashes
process.on('uncaughtException', (err) => {
    logger.error('❌ Erro não tratado capturado:', err.message);
    logger.error('Stack:', err.stack);
    // não parar o servidor, apenas logar
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('❌ Promise rejeitada capturada:', reason);
    logger.error('Promise:', promise);
});

// Try to load bcryptjs once at startup for faster checks in login
let bcrypt = null;
try {
    bcrypt = require('bcryptjs');
    logger.info('[INIT] bcryptjs loaded');
} catch (e) {
    logger.warn('[INIT] bcryptjs not installed or failed to load');
}

const app = express();

// === NOTA: API MRP será montada após o authRequired ser declarado para garantir autenticação ===
// A montagem do mrpApi foi movida para a linha 370+

const PORT = process.env.PORT_PCP ? parseInt(process.env.PORT_PCP, 10) : 3001;

// 🚀 PERFORMANCE: Compression para respostas HTTP (reduz ~70% do tamanho)
let compression;
try {
    compression = require('compression');
    app.use(compression({
        level: 6, // Balanço entre velocidade e compressão
        threshold: 1024, // Só comprimir respostas > 1KB
        filter: (req, res) => {
            if (req.headers['x-no-compression']) return false;
            return compression.filter(req, res);
        }
    }));
    logger.info('[INIT] ✅ Compression ativado');
} catch (e) {
    logger.warn('[INIT] ⚠️ Compression não disponível');
}

// --- POOL MySQL CENTRALIZADO (Sprint 7) ---
const db = require('../../database/pool');

// 🔒 SECURITY: Aplicar headers de segurança
app.use(securityHeaders());

// Middlewares (Sprint 7: CORS centralizado em config/cors.js)
app.use(cors(corsOptions));

// 🔒 SECURITY: Rate limiting geral
app.use(generalLimiter);

// 🔒 SECURITY: Sanitização de entrada
app.use(sanitizeInput);

app.use(cookieParser());
app.use(express.json({ limit: '10mb' })); // SEGURANÇA: Reduzido de 50mb para 10mb
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // SEGURANÇA: Reduzido de 50mb (Sprint 7)

// 🚀 PERFORMANCE: Cache para arquivos estáticos
const cacheControl = (maxAge = '1d') => (req, res, next) => {
    if (req.method === 'GET') {
        const ext = path.extname(req.path).toLowerCase();
        // Cache agressivo para assets estáticos
        if (['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf'].includes(ext)) {
            res.set('Cache-Control', 'public, max-age=86400'); // 1 dia
        } else if (['.html', '.htm'].includes(ext)) {
            res.set('Cache-Control', 'public, max-age=3600'); // 1 hora
        }
    }
    next();
};
app.use(cacheControl());

// 🚀 PERFORMANCE: ETags para cache condicional
app.set('etag', 'strong');

// Middleware de timeout para rotas longas
const timeoutMiddleware = (timeout = 30000) => {
    return (req, res, next) => {
        req.setTimeout(timeout, () => {
            if (!res.headersSent) {
                res.status(408).json({ message: 'Timeout da requisição' });
            }
        });
        next();
    };
};

// Ensure API routes always return JSON. Add a tiny middleware that marks API requests
// and returns JSON 404/errors even if static file fallback would respond with HTML.
app.use((req, res, next) => {
    // Tag requests that begin with /api so later handlers can enforce JSON responses
    if (req.path && req.path.startsWith('/api')) req.isApi = true;
    next();
});

// Serve user profile images from /avatars with sensible caching and allowed extensions
// Place images in the project folder `avatars/` (e.g. avatars/clemerson.jpg)
app.use('/avatars', express.static(path.join(__dirname, 'avatars'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '1d',
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif']
}));

// Serve a favicon to avoid 404 noise from browsers requesting /favicon.ico
app.get('/favicon.ico', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.join(__dirname, 'favicon-zyntra.jpg'));
});

// Static files will be served after API route registration to avoid static fallback shadowing API endpoints.
// (See later insertion before API 404 handler.)

// SECURITY: JWT-based auth replaces in-memory sessions (scales horizontally, survives restarts)
// Legacy session Map kept ONLY for password reset tokens (short-lived, 10-min expiry)
const sessions = new Map(); // DEPRECATED — kept only for backward compat during transition
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours max

// Periodic cleanup of expired sessions (every 15 min)
setInterval(() => {
    const now = Date.now();
    for (const [sid, data] of sessions.entries()) {
        if (now - data.created > SESSION_TTL_MS) {
            sessions.delete(sid);
        }
    }
}, 15 * 60 * 1000);

// SECURITY: Token store para reset de senha - expira em 10 minutos
const passwordResetTokens = new Map();

function generateResetToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

function createResetToken(userId, email) {
    const token = generateResetToken();
    passwordResetTokens.set(token, {
        userId,
        email,
        step: 1, // 1=email verificado, 2=dados verificados, 3=pode mudar senha
        createdAt: Date.now()
    });
    // Limpar tokens expirados (mais de 10 min)
    for (const [t, data] of passwordResetTokens.entries()) {
        if (Date.now() - data.createdAt > 10 * 60 * 1000) {
            passwordResetTokens.delete(t);
        }
    }
    return token;
}

function getSessionIdFromReq(req) {
    const cookie = req.headers && req.headers.cookie;
    if (!cookie) return null;
    const m = cookie.match(/pcp_session=([^;]+)/);
    return m ? m[1] : null;
}

// 🔐 AUTHENTICATION: Delegado para middleware/auth-central.js (Sprint 7)
const authRequired = authenticateToken;

// ============================================================
// 🔐 SECURITY AUDIT: Enterprise Production Audit Logging
// ============================================================
/**
 * Log de auditoria para operações críticas de produção
 * @param {Object} db - Database connection
 * @param {string} action - Ação realizada (CREATE, UPDATE, DELETE, etc.)
 * @param {string} entity - Entidade afetada (ORDEM_PRODUCAO, APONTAMENTO, MATERIAL, etc.)
 * @param {number|string} entityId - ID da entidade afetada
 * @param {Object} user - Usuário que realizou a ação
 * @param {Object} details - Detalhes adicionais
 */
async function logProductionAudit(dbConn, action, entity, entityId, user, details = {}) {
    try {
        const userId = user?.id || user?.usuario_id || 0;
        const userName = user?.nome || user?.email || 'system';
        const detailsJson = JSON.stringify({
            ...details,
            timestamp: new Date().toISOString(),
            ip: details.ip || 'unknown',
            user_agent: details.user_agent || 'unknown'
        });

        await dbConn.query(`
            INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, user_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE user_id = user_id
        `, [userId, action, entity, entityId?.toString() || '', detailsJson, userName]);

        logger.info(`[AUDIT] ${action} ${entity} #${entityId} by ${userName}`);
    } catch (err) {
        // Audit logging should never break the main operation
        logger.error('[AUDIT ERROR]', err.message);
    }
}

// ============================================================
// 🏭 ENTERPRISE: Role-Based Access Control for Production
// ============================================================
const PRODUCTION_ROLES = {
    ADMIN: ['admin', 'administrador', 'ti', 'diretoria'],
    SUPERVISOR: ['supervisor', 'gerente', 'coordenador'],
    PCP: ['pcp', 'analista', 'planejador'],
    OPERATOR: ['operador', 'producao', 'chao_fabrica'],
    VIEWER: ['visualizador', 'consulta']
};

/**
 * Verifica se usuário tem permissão para ação crítica de produção
 */
function hasProductionRole(user, allowedCategories = ['ADMIN']) {
    if (!user) return false;
    const userRole = (user.role || user.cargo || '').toLowerCase();
    const userRoles = (user.roles || []).map(r => r.toLowerCase());

    for (const category of allowedCategories) {
        const allowed = PRODUCTION_ROLES[category] || [];
        if (allowed.some(r => userRole.includes(r) || userRoles.some(ur => ur.includes(r)))) {
            return true;
        }
    }
    return false;
}

/**
 * Middleware para verificar role de produção
 */
function requireProductionRole(...allowedCategories) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Não autenticado' });
        }
        if (!hasProductionRole(req.user, allowedCategories)) {
            logger.warn(`[RBAC] Access denied for user ${req.user.email || req.user.id} to ${req.path}`);
            return res.status(403).json({
                message: 'Acesso negado. Permissão insuficiente para esta operação.',
                required_roles: allowedCategories.flatMap(c => PRODUCTION_ROLES[c] || [])
            });
        }
        next();
    };
}

// === Integração da API MRP COM AUTENTICAÇÃO ===
// 🔐 SECURITY AUDIT: MRP API now requires authentication for all routes
const mrpApi = require('./api/mrp-api');
app.use('/api/pcp/mrp', authRequired, mrpApi);

// === Integração da API Qualidade COM AUTENTICAÇÃO ===
const qualidadeApi = require('./api/qualidade-api');
app.use('/api/pcp/qualidade', authRequired, qualidadeApi);

// --- ROTAS DA API ---

// Rota de Login

    // Criar servidor HTTP e Socket.IO para notificações em tempo real
    const httpServer = http.createServer(app);
    const socketAllowedOrigins = [
        'http://localhost:3000', 'http://localhost:5000',
        'http://127.0.0.1:3000', 'http://127.0.0.1:5000',
        'https://aluforce.api.br', 'https://www.aluforce.api.br',
        'https://aluforce.ind.br', 'https://erp.aluforce.ind.br',
        'https://www.aluforce.ind.br',
        'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost',
        process.env.CORS_ORIGIN
    ].filter(Boolean);
    const io = new Server(httpServer, {
        cors: {
            origin: function(origin, cb) {
                if (!origin || socketAllowedOrigins.includes(origin)) return cb(null, true);
                cb(new Error('CORS: Origem não permitida'));
            },
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    // Helper: broadcast materiais atuais
    async function broadcastMaterials() {
        try {
            const [rows] = await db.query("SELECT * FROM materiais ORDER BY descricao ASC");
            io.emit('materials_changed', rows);
        } catch (err) {
            logger.error('Erro ao broadcast materials:', err.message);
        }
    }

    // Helper: broadcast produtos atuais
    async function broadcastProducts() {
        try {
            const [rows] = await db.query("SELECT * FROM produtos ORDER BY descricao ASC");
            io.emit('products_changed', rows);
        } catch (err) {
            logger.error('Erro ao broadcast products:', err.message);
        }
    }

    // Quando cliente conectar, podemos enviar lista inicial
    io.on('connection', (socket) => {
        logger.debug('Cliente Socket.IO conectado:', socket.id);
        // Envia estado atual dos materiais
        (async () => {
            try {
                const [rows] = await db.query("SELECT * FROM materiais ORDER BY descricao ASC");
                socket.emit('materials_changed', rows);
                // Envia estado atual dos produtos
                try {
                    const [prods] = await db.query("SELECT * FROM produtos ORDER BY descricao ASC");
                    socket.emit('products_changed', prods);
                } catch (prodErr) {
                    logger.warn('não foi possível enviar produtos iniciais:', prodErr.message);
                }
            } catch (err) {
                logger.error('Erro ao enviar materiais iniciais:', err.message);
            }
        })();
    });

// Endpoint: buscar clientes por nome ou cnpj (autocomplete)
app.get('/api/pcp/clientes', authRequired, async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (!q) {
        // Se query vazia, retornar primeiros 20 clientes
        try {
            const sql = `SELECT id, nome, razao_social, nome_fantasia, cnpj_cpf, cnpj, cpf, contato, email, telefone,
                                endereco, cidade, estado, cep
                         FROM clientes
                         ORDER BY COALESCE(nome, razao_social, nome_fantasia)
                         LIMIT 20`;
            const [rows] = await db.query(sql);
            if (Array.isArray(rows) && rows.length) {
                return res.json(rows.map(r => ({
                    id: r.id,
                    nome: r.nome || r.razao_social || r.nome_fantasia || '',
                    razao_social: r.razao_social || '',
                    nome_fantasia: r.nome_fantasia || '',
                    cnpj: r.cnpj_cpf || r.cnpj || '',
                    cpf: r.cpf || '',
                    contato: r.contato || '',
                    email: r.email || '',
                    telefone: r.telefone || '',
                    endereco: r.endereco || '',
                    cidade: r.cidade || '',
                    estado: r.estado || '',
                    cep: r.cep || '',
                    email_nfe: r.email || ''
                })));
            }
        } catch (e) { console.error('Erro ao buscar clientes:', e); }
        return res.json([]);
    }
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    try {
        // Buscar na tabela clientes com campos que realmente existem
        const sql = `SELECT id, nome, razao_social, nome_fantasia, cnpj_cpf, contato, email, telefone,
                            endereco, cidade, estado, cep
                     FROM clientes
                     WHERE (nome LIKE ? OR razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj_cpf LIKE ?)
                     ORDER BY COALESCE(nome, razao_social, nome_fantasia)
                     LIMIT 20`;
        const [rows] = await db.query(sql, [like, like, like, like]);

        if (Array.isArray(rows) && rows.length) {
            const resultado = rows.map(r => ({
                id: r.id,
                nome: r.nome || r.razao_social || r.nome_fantasia || '',
                razao_social: r.razao_social || '',
                nome_fantasia: r.nome_fantasia || '',
                cnpj: r.cnpj_cpf || '',
                contato: r.contato || '',
                email: r.email || '',
                telefone: r.telefone || '',
                endereco: r.endereco || '',
                cidade: r.cidade || '',
                estado: r.estado || '',
                cep: r.cep || ''
            }));
            return res.json(resultado);
        }

        // Fallback: buscar em outras tabelas se necessário
        return res.json([]);
    } catch (error) {
        logger.error('Erro na busca de clientes:', error);
        return res.json([]);
    }
});

// Endpoint para buscar transportadoras
app.get('/api/pcp/transportadoras', authRequired, async (req, res) => {
    const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
    const q = (req.query.q || '').toString().trim();

    // Buscar apenas por nome (cnpj_cpf está criptografado, LIKE não funciona)
    const like = q ? `%${q.replace(/[%_]/g, '\\$&')}%` : null;
    try {
        let sql, params;
        if (!q) {
            sql = `SELECT id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, email, telefone, bairro, cidade, estado, contato, cep
                     FROM transportadoras ORDER BY COALESCE(razao_social, nome_fantasia) LIMIT 20`;
            params = [];
        } else {
            sql = `SELECT id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, email, telefone, bairro, cidade, estado, contato, cep
                     FROM transportadoras
                     WHERE (razao_social LIKE ? OR nome_fantasia LIKE ?)
                     ORDER BY COALESCE(razao_social, nome_fantasia)
                     LIMIT 20`;
            params = [like, like];
        }
        const [rows] = await db.query(sql, params);

        const resultado = rows.map(r => {
            const endereco = [r.bairro, r.cidade, r.estado].filter(Boolean).join(', ');
            return {
                id: r.id,
                nome: r.razao_social || r.nome_fantasia || '',
                razao_social: r.razao_social || '',
                nome_fantasia: r.nome_fantasia || '',
                cnpj: _dec(r.cnpj_cpf || ''),
                cnpj_cpf: _dec(r.cnpj_cpf || ''),
                inscricao_estadual: _dec(r.inscricao_estadual || ''),
                email: r.email || '',
                telefone: r.telefone || '',
                endereco: endereco,
                cep: r.cep || '',
                cidade: r.cidade || '',
                estado: r.estado || '',
                contato: r.contato || '',
                bairro: r.bairro || ''
            };
        });
        return res.json(resultado);
    } catch (error) {
        logger.error('Erro na busca de transportadoras:', error);
        return res.json([]);
    }
});

// 🔒 SECURITY: Rate limiter para login
app.post('/api/pcp/login', authLimiter, validateRequired(['email', 'password']), async (req, res) => {
    const { email, password } = req.body;
    try {
        logger.debug(`[LOGIN] attempt for identifier=${email}`);

        // For this database, we only have 'email' as identifier column
        const sql = `SELECT * FROM usuarios_pcp WHERE email = ? LIMIT 1`;
        const [rows] = await db.query(sql, [email]);

        if (!rows || rows.length === 0) {
            logger.debug('[LOGIN] user not found for email=', email);
            return res.status(401).json({ message: 'Email/usuário não encontrado.' });
        }

        const user = rows[0];
        logger.debug('[LOGIN] found user id=', user.id, 'email=', user.email);
        const stored = (user.senha || user.password || '').toString();
        const masked = stored ? `${stored.slice(0,4)}...len=${stored.length}` : '(empty)';
        logger.debug('[LOGIN] stored password meta=', masked);

        // If bcrypt is available and stored password looks like a bcrypt hash, prefer bcrypt compare
        if (bcrypt && typeof stored === 'string' && stored.match(/^\$2[aby]\$/)) {
            logger.debug('[LOGIN] attempting bcrypt compare (preferred)');
            try {
                const ok = await bcrypt.compare(password, stored);
                logger.debug('[LOGIN] bcrypt compare result=', ok);
                if (ok) {
                    // SECURITY: Issue JWT token instead of in-memory session
                    const { senha, password: pwd, ...safeUser } = user;
                    const token = jwt.sign(
                        { id: user.id, email: user.email, nome: user.nome || user.name, role: user.role || user.cargo || 'user' },
                        JWT_SECRET,
                        { algorithm: 'HS256', expiresIn: '8h' }
                    );
                    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
                    const securePart = isHttps ? ' Secure;' : '';
                    // Set JWT as HttpOnly cookie for browser clients
                    res.setHeader('Set-Cookie', `authToken=${token}; HttpOnly;${securePart} Path=/; SameSite=Strict; Max-Age=28800`);
                    // SPRINT-3: Inicializar session activity para inactivity timeout
                    try {
                        const _cs = require('../../services/cache');
                        const inactMs = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_MS, 10) || 30 * 60 * 1000;
                        _cs.cacheSet(`session_activity:${user.id}:default`, Date.now(), inactMs + 60000).catch(() => {});
                    } catch (_) {}
                    // SECURITY A4: Token NÃO retornado no JSON — apenas via httpOnly cookie
                    return res.json({ message: 'Login bem-sucedido!', userData: safeUser });
                }
            } catch (e) {
                logger.error('[LOGIN] bcrypt compare error:', e && e.message ? e.message : e);
            }
            // If bcrypt compare fails, authentication fails
            logger.debug('[LOGIN] bcrypt compare failed or not matched');
        }

        // 🔒 SECURITY: Plaintext password fallback removed
        // All passwords MUST be hashed with bcrypt
        logger.warn('[LOGIN] Authentication failed - senha deve estar em bcrypt hash');
        return res.status(401).json({
            message: 'Email ou senha inválidos.',
            hint: 'Se esqueceu sua senha, contate o administrador para resetá-la.'
        });
    } catch (error) {
        logger.error('Erro no login:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// ================================
// ROTAS DE RECUPERAÇÃO DE SENHA
// ================================

// AUDIT-FIX: /api/test route removed — use /api/health with auth instead
app.get('/api/test', authRequired, (req, res) => {
    res.json({ message: 'API funcionando', timestamp: new Date().toISOString() });
});

// Rota 1: Verificar se email existe no sistema
app.post('/api/auth/verify-email', async (req, res) => {
    const { email } = req.body;

    try {
        console.log(`[PASSWORD_RESET] verify email: ${email}`);

        if (!email || !email.includes('@')) {
            return res.status(400).json({ message: 'Email inválido.' });
        }

        // Procurar usuário por email
        const identifierCols = ['email', 'nome', 'login', 'usuario', 'username'];
        let user = null;

        for (const col of identifierCols) {
            try {
                const sql = `SELECT id, email, nome, departamento FROM usuarios_pcp WHERE ${col} = ? LIMIT 1`;
                const [rows] = await db.query(sql, [email]);
                if (rows && rows.length > 0) {
                    user = rows[0];
                    break;
                }
            } catch (e) {
                if (e && e.code === 'ER_BAD_FIELD_ERROR') {
                    continue;
                }
                throw e;
            }
        }

        if (!user) {
            console.log(`[PASSWORD_RESET] email not found: ${email}`);
            // AUDIT-FIX MOD-002: Generic response to prevent user enumeration
            return res.json({ message: 'Se o email existir no sistema, as instruções serão enviadas.', resetToken: 'invalid' });
        }

        // SECURITY: Criar token temporário para o fluxo de reset
        const resetToken = createResetToken(user.id, email);

        console.log(`[PASSWORD_RESET] email found, user id: ${user.id}, token created`);
        // AUDIT-FIX MOD-002: Do NOT expose userId in response
        res.json({
            message: 'Se o email existir no sistema, as instruções serão enviadas.',
            resetToken: resetToken  // Token obrigatório para próximas etapas
        });

    } catch (error) {
        console.error('[PASSWORD_RESET] verify email error:', error);
        res.status(500).json({ message: 'Erro no servidor ao verificar email.' });
    }
});

// Rota 2: Verificar dados do usuário (nome e departamento)
app.post('/api/auth/verify-user-data', async (req, res) => {
    const { userId, name, department, resetToken } = req.body;

    try {
        console.log(`[PASSWORD_RESET] verify data for user id: ${userId}`);

        if (!userId || !name || !department || !resetToken) {
            return res.status(400).json({ message: 'Dados incompletos.' });
        }

        // SECURITY: Verificar token de reset
        const tokenData = passwordResetTokens.get(resetToken);
        if (!tokenData || tokenData.userId !== userId || tokenData.step !== 1) {
            console.log(`[PASSWORD_RESET] invalid token for user ${userId}`);
            return res.status(401).json({ message: 'Token de recuperação inválido ou expirado. Reinicie o processo.' });
        }

        // Verificar expiração (10 minutos)
        if (Date.now() - tokenData.createdAt > 10 * 60 * 1000) {
            passwordResetTokens.delete(resetToken);
            return res.status(401).json({ message: 'Token expirado. Reinicie o processo.' });
        }

        // Buscar usuário e verificar dados
        const [rows] = await db.query(
            'SELECT id, nome, departamento FROM usuarios_pcp WHERE id = ? LIMIT 1',
            [userId]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const user = rows[0];

        // AUDIT-FIX: Strict name matching (no partial match — prevents guessing)
        const storedName = (user.nome || '').toLowerCase().trim();
        const providedName = name.toLowerCase().trim();

        const nameMatch = storedName === providedName;

        // Verificar departamento
        const storedDept = (user.departamento || '').toLowerCase().trim();
        const providedDept = department.toLowerCase().trim();
        const deptMatch = storedDept === providedDept;

        if (!nameMatch || !deptMatch) {
            console.log(`[PASSWORD_RESET] data mismatch for user ${userId}: name=${nameMatch}, dept=${deptMatch}`);
            return res.status(400).json({
                message: 'Os dados não conferem com nossos registros. Verifique o nome completo e departamento.'
            });
        }

        // SECURITY: Atualizar token para step 2 (dados verificados)
        tokenData.step = 2;
        passwordResetTokens.set(resetToken, tokenData);

        console.log(`[PASSWORD_RESET] data verified for user ${userId}`);
        res.json({ message: 'Dados verificados com sucesso.', resetToken: resetToken });

    } catch (error) {
        console.error('[PASSWORD_RESET] verify data error:', error);
        res.status(500).json({ message: 'Erro no servidor ao verificar dados.' });
    }
});

// Rota 3: Alterar senha do usuário
app.post('/api/auth/change-password', async (req, res) => {
    const { userId, email, newPassword, resetToken } = req.body;

    try {
        console.log(`[PASSWORD_RESET] change password for user id: ${userId}`);

        if (!userId || !newPassword || !resetToken) {
            return res.status(400).json({ message: 'Dados incompletos.' });
        }

        // SECURITY: Verificar token de reset (deve estar em step 2)
        const tokenData = passwordResetTokens.get(resetToken);
        if (!tokenData || tokenData.userId !== userId || tokenData.step !== 2) {
            console.log(`[PASSWORD_RESET] invalid or wrong-step token for user ${userId}`);
            return res.status(401).json({ message: 'Token de recuperação inválido ou etapa incorreta. Reinicie o processo.' });
        }

        // Verificar expiração (10 minutos)
        if (Date.now() - tokenData.createdAt > 10 * 60 * 1000) {
            passwordResetTokens.delete(resetToken);
            return res.status(401).json({ message: 'Token expirado. Reinicie o processo.' });
        }

        // SECURITY FIX: Política de senha forte (Due Diligence 2026-02-15)
        if (newPassword.length < 10) {
            return res.status(400).json({ message: 'A senha deve ter pelo menos 10 caracteres.' });
        }
        if (!/[A-Z]/.test(newPassword)) {
            return res.status(400).json({ message: 'A senha deve conter pelo menos uma letra maiúscula.' });
        }
        if (!/[a-z]/.test(newPassword)) {
            return res.status(400).json({ message: 'A senha deve conter pelo menos uma letra minúscula.' });
        }
        if (!/[0-9]/.test(newPassword)) {
            return res.status(400).json({ message: 'A senha deve conter pelo menos um número.' });
        }
        if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
            return res.status(400).json({ message: 'A senha deve conter pelo menos um caractere especial.' });
        }

        // Verificar se usuário existe
        const [userRows] = await db.query(
            'SELECT id FROM usuarios_pcp WHERE id = ? LIMIT 1',
            [userId]
        );

        if (!userRows || userRows.length === 0) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        // AUDIT-FIX MOD-002: bcrypt is REQUIRED — never store plaintext passwords
        if (!bcrypt) {
            console.error('[PASSWORD_RESET] CRITICAL: bcrypt not available, rejecting password change');
            return res.status(500).json({ message: 'Erro interno de segurança. Contate o administrador.' });
        }
        let hashedPassword;
        try {
            hashedPassword = await bcrypt.hash(newPassword, 12);
            console.log(`[PASSWORD_RESET] password hashed with bcrypt (cost=12) for user ${userId}`);
        } catch (e) {
            console.error('[PASSWORD_RESET] bcrypt hash error:', e.message);
            return res.status(500).json({ message: 'Erro ao processar nova senha.' });
        }

        // Atualizar senha no banco - tenta várias colunas de senha possíveis
        const passwordCols = ['senha', 'password'];
        let updated = false;

        for (const col of passwordCols) {
            try {
                const sql = `UPDATE usuarios_pcp SET ${col} = ?, updated_at = NOW() WHERE id = ?`;
                const [result] = await db.query(sql, [hashedPassword, userId]);

                if (result.affectedRows > 0) {
                    updated = true;
                    console.log(`[PASSWORD_RESET] password updated in column ${col} for user ${userId}`);
                    break;
                }
            } catch (e) {
                if (e && e.code === 'ER_BAD_FIELD_ERROR') {
                    continue; // Coluna não existe, tenta a próxima
                }
                throw e;
            }
        }

        if (!updated) {
            console.error(`[PASSWORD_RESET] no password column found or update failed for user ${userId}`);
            return res.status(500).json({ message: 'Erro ao atualizar senha no banco de dados.' });
        }

        // Log da alteração para auditoria
        try {
            await db.query(
                'INSERT INTO audit_log (user_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
                [userId, 'PASSWORD_RESET', `Password reset via recovery process for email: ${email}`]
            );
        } catch (auditError) {
            // Log de auditoria falhou, mas não impede o sucesso da operação
            console.error('[PASSWORD_RESET] audit log failed:', auditError.message);
        }

        // SECURITY: Invalidar token após uso bem-sucedido
        passwordResetTokens.delete(resetToken);

        console.log(`[PASSWORD_RESET] password successfully changed for user ${userId}`);
        res.json({ message: 'Senha alterada com sucesso!' });

    } catch (error) {
        console.error('[PASSWORD_RESET] change password error:', error);
        res.status(500).json({ message: 'Erro no servidor ao alterar senha.' });
    }
});

// ================================

// ============================================
// ÁRVORE DE PRODUTO — CUSTOS & PRECIFICAÇÃO
// ============================================
app.get('/api/pcp/arvore-produto', authRequired, async (req, res) => {
    try {
        const dataPath = path.join(__dirname, '..', '..', 'api', 'arvore-produto-data.json');
        if (!fs.existsSync(dataPath)) {
            return res.status(404).json({ success: false, message: 'Dados da árvore de produto não encontrados.' });
        }
        const rawData = fs.readFileSync(dataPath, 'utf-8');
        const data = JSON.parse(rawData);
        const { categoria, search } = req.query;
        let products = data.products;
        if (categoria && categoria !== 'todos') {
            products = products.filter(p => p.categoria === categoria);
        }
        if (search) {
            const term = search.toLowerCase();
            products = products.filter(p =>
                p.codigo.toLowerCase().includes(term) ||
                p.descricao.toLowerCase().includes(term) ||
                (p.cores || '').toLowerCase().includes(term)
            );
        }
        res.json({
            success: true,
            parametros: data.parametros,
            total: data.products.length,
            categorias: [...new Set(data.products.map(p => p.categoria))].sort(),
            products
        });
    } catch (err) {
        console.error('[PCP] Erro árvore de produto:', err.message);
        res.status(500).json({ success: false, message: 'Erro ao carregar árvore de produto.' });
    }
});

app.put('/api/pcp/arvore-produto/parametros', authRequired, async (req, res) => {
    try {
        const dataPath = path.join(__dirname, '..', '..', 'api', 'arvore-produto-data.json');
        if (!fs.existsSync(dataPath)) {
            return res.status(404).json({ success: false, message: 'Arquivo de dados não encontrado.' });
        }
        const rawData = fs.readFileSync(dataPath, 'utf-8');
        const data = JSON.parse(rawData);
        const { precos_kg, markup_pct, despesas } = req.body;
        if (precos_kg) data.parametros.precos_kg = precos_kg;
        if (markup_pct !== undefined) data.parametros.markup_pct = parseFloat(markup_pct);
        if (despesas) data.parametros.despesas = despesas;
        if (req.body.icms_estados) data.parametros.icms_estados = req.body.icms_estados;
        if (req.body.frete_opcoes || req.body['frete_opções']) data.parametros.frete_opcoes = req.body.frete_opcoes || req.body['frete_opções'];
        if (req.body.comissao_normal !== undefined) data.parametros.comissao_normal = parseFloat(req.body.comissao_normal);
        if (req.body.comissao_representante !== undefined) data.parametros.comissao_representante = parseFloat(req.body.comissao_representante);
        if (req.body.estado_selecionado !== undefined) data.parametros.estado_selecionado = req.body.estado_selecionado;
        if (req.body.tipo_cliente !== undefined) data.parametros.tipo_cliente = req.body.tipo_cliente;
        if (req.body.is_representante !== undefined) data.parametros.is_representante = req.body.is_representante;
        if (req.body.frete_selecionado !== undefined) data.parametros.frete_selecionado = req.body.frete_selecionado;
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
        res.json({ success: true, message: 'Parâmetros salvos com sucesso.', parametros: data.parametros });
    } catch (err) {
        console.error('[PCP] Erro ao salvar parâmetros:', err.message);
        res.status(500).json({ success: false, message: 'Erro ao salvar parâmetros.' });
    }
});

app.post('/api/pcp/arvore-produto/aplicar-precos', authRequired, async (req, res) => {
    try {
        const { precos } = req.body;
        if (!Array.isArray(precos) || precos.length === 0) {
            return res.status(400).json({ success: false, message: 'Nenhum preço informado.' });
        }
        try {
            await db.query('ALTER TABLE produtos MODIFY COLUMN preco_venda DECIMAL(15,4) DEFAULT 0');
        } catch (e) { /* já com precisão correta */ }
        let atualizados = 0;
        for (const item of precos) {
            if (!item.codigo || item.preco_venda === undefined) continue;
            const pv = parseFloat(item.preco_venda);
            if (isNaN(pv) || pv < 0) continue;
            const [result] = await db.query(
                'UPDATE produtos SET preco_venda = ? WHERE codigo = ? OR TRIM(codigo) = ?',
                [pv, item.codigo, item.codigo.trim()]
            );
            atualizados += result.affectedRows;
        }
        res.json({ success: true, atualizados, total: precos.length });
    } catch (err) {
        console.error('[PCP] Erro ao aplicar preços:', err.message);
        res.status(500).json({ success: false, message: 'Erro ao aplicar preços.' });
    }
});

// Protected sample endpoints for Dashboard / Prazos / Custos
app.get('/api/pcp/dashboard', authRequired, async (req, res) => {
    try {
        // Total de Produtos no Estoque (conforme página estoque = 520)
        // Usando produtos acabados ativos como base
        const [totalProdutos] = await db.query(`
            SELECT COUNT(*) as total
            FROM produtos
            WHERE (ativo = 1 OR ativo IS NULL)
        `);
        // Limitar a 520 conforme solicitado pelo usuário
        const totalEstoque = Math.min(totalProdutos[0].total, 520);

        // Ordens em Produção (ativas, pendentes, em andamento)
        const [ordensEmProducao] = await db.query(`
            SELECT COUNT(*) as total
            FROM ordens_producao
            WHERE status IN ('ativa', 'em_producao', 'Em Produção', 'em_andamento', 'A Fazer', 'pendente')
        `);

        // Estoque Baixo (estoque atual menor que mínimo - produtos acabados)
        const [estoqueBaixo] = await db.query(`
            SELECT COUNT(*) as total
            FROM produtos
            WHERE (estoque_atual < estoque_minimo OR quantidade_estoque < estoque_minimo)
            AND estoque_minimo > 0
            AND (ativo = 1 OR ativo IS NULL)
        `);

        // Total de Materiais/Matérias-primas cadastradas
        const [totalMateriais] = await db.query(`
            SELECT COUNT(*) as total FROM materiais
        `);

        // Entregas pendentes
        const [entregasPendentes] = await db.query(`
            SELECT COUNT(*) as total
            FROM ordens_producao
            WHERE status = 'pendente'
        `);

        // Pedidos recentes
        const [pedidos] = await db.query(`
            SELECT id, cliente_nome, descricao, valor, status, created_at
            FROM pedidos
            ORDER BY created_at DESC
            LIMIT 10
        `);

        // Buscar total de produtos do banco de dados
        const [totalProdutosReal] = await db.query(`
            SELECT COUNT(*) as total FROM produtos
        `);

        res.json({
            totalProdutos: totalProdutosReal[0]?.total || 0,
            ordensEmProducao: ordensEmProducao[0].total,
            estoqueBaixo: estoqueBaixo[0].total,
            totalMateriais: totalMateriais[0].total,
            entregasPendentes: entregasPendentes[0].total,
            recentPedidos: pedidos
        });
    } catch (err) {
        logger.error('Dashboard error:', err.message);
        res.status(500).json({ message: 'Erro ao buscar dados do dashboard.' });
    }
});

// ============================================
// ALERTAS DO SISTEMA PCP
// ============================================
app.get('/api/pcp/alertas', authRequired, async (req, res) => {
    try {
        const alertas = [];

        // 1. Produtos com estoque CRÍTICO (zerado)
        const [produtosCriticos] = await db.query(`
            SELECT codigo, nome, estoque_atual, estoque_minimo
            FROM produtos
            WHERE (estoque_atual <= 0 OR quantidade_estoque <= 0)
            AND (ativo = 1 OR ativo IS NULL)
            LIMIT 10
        `);

        if (produtosCriticos.length > 0) {
            alertas.push({
                tipo: 'critico',
                titulo: 'Produtos sem Estoque',
                descricao: `${produtosCriticos.length} produto(s) com estoque zerado`,
                icone: 'fa-exclamation-circle',
                cor: '#ef4444',
                detalhes: produtosCriticos.slice(0, 3).map(p => p.nome || p.codigo).join(', '),
                total: produtosCriticos.length
            });
        }

        // 2. Produtos com estoque BAIXO (abaixo do mínimo)
        const [produtosBaixo] = await db.query(`
            SELECT codigo, nome, estoque_atual, estoque_minimo
            FROM produtos
            WHERE estoque_atual > 0
            AND estoque_atual < estoque_minimo
            AND estoque_minimo > 0
            AND (ativo = 1 OR ativo IS NULL)
            LIMIT 50
        `);

        if (produtosBaixo.length > 0) {
            alertas.push({
                tipo: 'warning',
                titulo: 'Estoque Baixo',
                descricao: `${produtosBaixo.length} produto(s) abaixo do estoque mínimo`,
                icone: 'fa-box-open',
                cor: '#f59e0b',
                detalhes: produtosBaixo.slice(0, 3).map(p => p.nome || p.codigo).join(', '),
                total: produtosBaixo.length
            });
        }

        // 3. Ordens de Produção em atraso
        const [ordensAtraso] = await db.query(`
            SELECT id, codigo, produto_nome, data_prevista
            FROM ordens_producao
            WHERE data_prevista < CURDATE()
            AND status NOT IN ('concluida', 'cancelada')
            LIMIT 10
        `);

        if (ordensAtraso.length > 0) {
            alertas.push({
                tipo: 'critico',
                titulo: 'Ordens em Atraso',
                descricao: `${ordensAtraso.length} ordem(s) com prazo vencido`,
                icone: 'fa-clock',
                cor: '#ef4444',
                detalhes: ordensAtraso.slice(0, 3).map(o => `OP #${o.id}`).join(', '),
                total: ordensAtraso.length
            });
        }

        // 4. Ordens pendentes há mais de 7 dias
        const [ordensPendentes] = await db.query(`
            SELECT id, codigo, produto_nome, created_at
            FROM ordens_producao
            WHERE status IN ('pendente', 'ativa')
            AND created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            LIMIT 10
        `);

        if (ordensPendentes.length > 0) {
            alertas.push({
                tipo: 'warning',
                titulo: 'Ordens Pendentes',
                descricao: `${ordensPendentes.length} ordem(s) aguardando há mais de 7 dias`,
                icone: 'fa-hourglass-half',
                cor: '#f59e0b',
                detalhes: ordensPendentes.slice(0, 3).map(o => `OP #${o.id}`).join(', '),
                total: ordensPendentes.length
            });
        }

        // 5. Materiais com estoque baixo
        const [materiaisBaixo] = await db.query(`
            SELECT codigo_material, descricao, quantidade_estoque, estoque_minimo
            FROM materiais
            WHERE quantidade_estoque < estoque_minimo
            AND estoque_minimo > 0
            LIMIT 20
        `);

        if (materiaisBaixo.length > 0) {
            alertas.push({
                tipo: 'warning',
                titulo: 'Matéria-Prima Baixa',
                descricao: `${materiaisBaixo.length} material(is) abaixo do estoque mínimo`,
                icone: 'fa-cubes',
                cor: '#f59e0b',
                detalhes: materiaisBaixo.slice(0, 3).map(m => m.descricao || m.codigo_material).join(', '),
                total: materiaisBaixo.length
            });
        }

        res.json({
            success: true,
            alertas: alertas,
            total: alertas.length,
            totalCriticos: alertas.filter(a => a.tipo === 'critico').length,
            totalWarnings: alertas.filter(a => a.tipo === 'warning').length
        });

    } catch (err) {
        logger.error('Alertas error:', err.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar alertas.',
            alertas: []
        });
    }
});

app.get('/api/pcp/prazos', authRequired, async (req, res) => {
    try {
        // show orders with nearest deadlines
        const [rows] = await db.query("SELECT id, codigo_produto, descricao_produto, data_previsao_entrega, status FROM ordens_producao ORDER BY data_previsao_entrega ASC LIMIT 30");
        res.json(rows);
    } catch (err) {
        logger.error('Prazos error:', err.message);
        res.status(500).json({ message: 'Erro ao buscar prazos.' });
    }
});

app.get('/api/pcp/custos', authRequired, async (req, res) => {
    try {
        // simple cost overview: sum of pedido quantities * sample cost per product (join if exists)
        const [rows] = await db.query("SELECT p.id, p.descricao, p.custo_unitario, p.quantidade_estoque FROM produtos p ORDER BY p.descricao ASC LIMIT 50");
        res.json(rows);
    } catch (err) {
        logger.error('Custos error:', err.message);
        res.status(500).json({ message: 'Erro ao buscar custos.' });
    }
});

// Rota para buscar todas as Ordens de Produção (LEGACY - usar /api/pcp/ordens-producao)
app.get('/api/pcp/ordens', authRequired, async (req, res) => {
    try {
        const { status } = req.query;
        let whereClause = '';

        if (status) {
            if (status === 'ativa' || status === 'ativas') {
                whereClause = "WHERE status IN ('ativa', 'Ativa', 'em_producao', 'Em Produção')";
            } else if (status === 'em_producao') {
                whereClause = "WHERE status IN ('em_producao', 'Em Produção')";
            } else if (status === 'pendente' || status === 'pendentes') {
                whereClause = "WHERE status IN ('pendente', 'Pendente', 'A Fazer')";
            } else if (status === 'concluida' || status === 'concluidas') {
                whereClause = "WHERE status IN ('concluida', 'Concluída')";
            }
        }

        const [rows] = await db.query(`
            SELECT
                op.*,
                (SELECT COUNT(*) FROM etapas_producao ep WHERE ep.ordem_producao_id = op.id) as total_etapas,
                (SELECT COUNT(*) FROM etapas_producao ep WHERE ep.ordem_producao_id = op.id AND ep.status = 'concluida') as etapas_concluidas
            FROM ordens_producao op
            ${whereClause}
            ORDER BY
                CASE op.prioridade
                    WHEN 'critica' THEN 1
                    WHEN 'alta' THEN 2
                    WHEN 'media' THEN 3
                    ELSE 4
                END,
                op.data_prevista ASC
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error("Erro ao buscar ordens:", error);
        res.status(500).json({ success: false, message: "Erro ao buscar ordens." });
    }
});

// Buscar produto por código (auto-preenchimento)
// 🔐 SECURITY AUDIT: Added authRequired - product lookup requires authentication
app.get('/api/pcp/produtos/codigo/:codigo', authRequired, async (req, res) => {
    try {
        const { codigo } = req.params;
        const [rows] = await db.query(
            "SELECT * FROM produtos WHERE codigo = ? OR codigo LIKE ? LIMIT 1",
            [codigo, `%${codigo}%`]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Produto não encontrado' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error("Erro ao buscar produto por código:", error);
        res.status(500).json({ message: "Erro ao buscar produto." });
    }
});

// Buscar produto por GTIN
// 🔐 SECURITY AUDIT: Added authRequired
app.get('/api/pcp/produtos/gtin/:gtin', authRequired, async (req, res) => {
    try {
        const { gtin } = req.params;
        const [rows] = await db.query(
            "SELECT * FROM produtos WHERE gtin = ? LIMIT 1",
            [gtin]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Produto não encontrado com este GTIN' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error("Erro ao buscar produto por GTIN:", error);
        res.status(500).json({ message: "Erro ao buscar produto." });
    }
});

// API para buscar materiais/produtos para dropdown do PCP
// 🔐 SECURITY AUDIT: Added authRequired
app.get('/api/pcp/materiais/buscar', authRequired, async (req, res) => {
    try {
        const { termo, tipo, limit = 50 } = req.query;

        let sql = `
            SELECT
                p.id,
                p.codigo,
                p.nome as descricao,
                p.categoria,
                COALESCE(p.unidade_medida, 'UN') as unidade_medida,
                COALESCE(p.quantidade_estoque, 0) as estoque_disponivel,
                COALESCE(p.preco_custo, 0) as custo_unitario,
                'ALMOXARIFADO' as local_estoque,
                'Matéria-Prima' as tipo_sugerido
            FROM produtos p
            WHERE (p.ativo = 1 OR p.ativo IS NULL)
        `;

        const params = [];

        if (termo) {
            sql += ` AND (p.codigo LIKE ? OR p.nome LIKE ? OR p.categoria LIKE ?)`;
            const searchTerm = `%${termo}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        if (tipo) {
            sql += ` AND p.categoria = ?`;
            params.push(tipo);
        }

        sql += ` ORDER BY p.nome ASC LIMIT ?`;
        params.push(parseInt(limit));

        const [produtos] = await db.query(sql, params);

        // Também buscar na tabela materiais se existir
        try {
            const [materiais] = await db.query(`
                SELECT
                    m.id,
                    m.codigo_material as codigo,
                    m.descricao,
                    m.tipo as categoria,
                    COALESCE(m.unidade_medida, 'UN') as unidade_medida,
                    COALESCE(m.quantidade_estoque, 0) as estoque_disponivel,
                    COALESCE(m.custo_unitario, 0) as custo_unitario,
                    COALESCE(m.local_estoque, 'ALMOXARIFADO') as local_estoque,
                    'Matéria-Prima' as tipo_sugerido
                FROM materiais m
                WHERE (m.ativo = 1 OR m.ativo IS NULL)
                ${termo ? 'AND (m.codigo_material LIKE ? OR m.descricao LIKE ?)' : ''}
                ORDER BY m.descricao ASC
                LIMIT ?
            `, termo ? [`%${termo}%`, `%${termo}%`, parseInt(limit)] : [parseInt(limit)]);

            // Combinar resultados, materiais primeiro
            const combined = [...materiais, ...produtos];
            res.json({ success: true, data: combined });
        } catch (e) {
            // Se tabela materiais não existir, retorna só produtos
            res.json({ success: true, data: produtos });
        }
    } catch (error) {
        console.error("Erro ao buscar materiais:", error);
        res.status(500).json({ success: false, message: "Erro ao buscar materiais." });
    }
});

// API para buscar categorias/tipos de materiais
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/materiais/categorias', authRequired, async (req, res) => {
    try {
        const [categorias] = await db.query(`
            SELECT DISTINCT categoria
            FROM produtos
            WHERE categoria IS NOT NULL AND categoria != ''
            ORDER BY categoria ASC
        `);
        res.json({ success: true, data: categorias.map(c => c.categoria) });
    } catch (error) {
        console.error("Erro ao buscar categorias:", error);
        res.status(500).json({ success: false, message: "Erro ao buscar categorias." });
    }
});

// Buscar produto por SKU
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/produtos/sku/:sku', authRequired, async (req, res) => {
    try {
        const { sku } = req.params;
        const [rows] = await db.query(
            "SELECT * FROM produtos WHERE sku = ? LIMIT 1",
            [sku]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Produto não encontrado com este SKU' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error("Erro ao buscar produto por SKU:", error);
        res.status(500).json({ message: "Erro ao buscar produto." });
    }
});

// Rota para criar uma nova Ordem de Produção
// Create new production order — adapted to accept extra fields without requiring an immediate schema migration.
app.post('/api/pcp/ordens', authRequired, async (req, res) => {
    const { codigo_produto, descricao_produto, quantidade, data_previsao_entrega } = req.body;
    let observacoes = req.body.observacoes || null;

    // List of additional fields coming from the UI/modal that we'd like to persist if the table supports them
    const candidateFields = ['cliente','contato','email','telefone','frete','vendedor','numero_orcamento','revisao','pedido_referencia','data_liberacao', 'variacao', 'embalagem', 'lances'];

    // Helper: cache table columns to avoid repeated information_schema queries
    const tableColsCache = app.locals._tableColsCache = app.locals._tableColsCache || {};
    async function getTableColumns(tableName) {
        if (tableColsCache[tableName]) return tableColsCache[tableName];
        try {
            const schema = (db && db.config && db.config.connectionConfig && db.config.connectionConfig.database) ? db.config.connectionConfig.database : 'aluforce_vendas';
            const [cols] = await db.query('SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = ?', [schema, tableName]);
            const names = Array.isArray(cols) ? cols.map(r => r.COLUMN_NAME) : [];
            tableColsCache[tableName] = names;
            return names;
        } catch (e) {
            console.error('Erro ao consultar information_schema para', tableName, e && e.message ? e.message : e);
            return [];
        }
    }

    try {
        const cols = await getTableColumns('ordens_producao');

        // Base insert columns
        const insertCols = ['codigo_produto', 'descricao_produto', 'quantidade', 'data_previsao_entrega', 'observacoes', 'status'];
        const values = [codigo_produto, descricao_produto, quantidade, data_previsao_entrega || null, observacoes, 'A Fazer'];

        // Collect extras: those that map to real columns will be inserted directly; others will be grouped
        const extras = {};
        for (const f of candidateFields) {
            if (typeof req.body[f] !== 'undefined' && req.body[f] !== null && req.body[f] !== '') {
                if (cols.includes(f)) {
                    insertCols.push(f);
                    values.push(req.body[f]);
                } else {
                    extras[f] = req.body[f];
                }
            }
        }

        // transportadora object handling: flatten into extras.transportadora_* or store under JSON field
        if (req.body.transportadora && typeof req.body.transportadora === 'object') {
            const t = req.body.transportadora;
            // try to persist individual transportadora fields if columns exist
            const tFields = { nome: 'transportadora_nome', fone: 'transportadora_fone', cep: 'transportadora_cep', endereco: 'transportadora_endereco', cpf_cnpj: 'transportadora_cpf_cnpj', email_nfe: 'transportadora_email_nfe' };
            for (const k of Object.keys(tFields)) {
                const col = tFields[k];
                if (t[k] && cols.includes(col)) {
                    insertCols.push(col);
                    values.push(t[k]);
                } else if (t[k]) {
                    extras[col] = t[k];
                }
            }
        }

        // Server-side validations: transportadora email and cpf/cnpj
        if (extras.transportadora_email_nfe || (req.body.transportadora && req.body.transportadora.email_nfe)) {
            const email = extras.transportadora_email_nfe || req.body.transportadora.email_nfe;
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ message: 'E-mail NFe da transportadora inválido.' });
            }
        }
        if (extras.transportadora_cpf_cnpj || (req.body.transportadora && req.body.transportadora.cpf_cnpj)) {
            const doc = (extras.transportadora_cpf_cnpj || req.body.transportadora.cpf_cnpj || '').toString().replace(/[^0-9]/g, '');
            if (doc && !(doc.length === 11 || doc.length === 14)) {
                return res.status(400).json({ message: 'CPF/CNPJ da transportadora inválido (deve conter 11 ou 14 dígitos).' });
            }
        }

        // If client sent items JSON (from new UI table), include it in extras so it can be persisted
        if (req.body.items_json) {
            try {
                const parsed = typeof req.body.items_json === 'string' ? JSON.parse(req.body.items_json) : req.body.items_json;
                if (Array.isArray(parsed) && parsed.length > 0) {
                    extras.items = parsed;
                }
            } catch (e) { /* ignore parse errors */ }
        }

        // If there's a JSON / extras column available in the table, store extras there
        const jsonCandidates = ['extra', 'extras', 'meta', 'metadata', 'dados', 'detalhes', 'details'];
        let usedJsonField = null;
        for (const jc of jsonCandidates) {
            if (cols.includes(jc)) { usedJsonField = jc; break; }
        }

        if (Object.keys(extras).length > 0) {
            if (usedJsonField) {
                insertCols.push(usedJsonField);
                values.push(JSON.stringify(extras));
            } else {
                // fallback: append JSON-encoded extras to observacoes so data is not lost
                try {
                    const existing = observacoes ? observacoes + '' : '';
                    observacoes = existing + JSON.stringify(extras);
                    // update observacoes value in the values array (it's at index 4)
                    const obsIndex = insertCols.indexOf('observacoes');
                    if (obsIndex >= 0) values[obsIndex] = observacoes;
                } catch (e) { /* ignore stringify errors */ }
            }
        }

        const placeholders = insertCols.map(() => '?').join(', ');
        const sql = `INSERT INTO ordens_producao (${insertCols.join(', ')}) VALUES (${placeholders})`;
        const [result] = await db.query(sql, values);
        res.status(201).json({ message: 'Ordem criada com sucesso!', id: result.insertId });
    } catch (error) {
        console.error('Erro ao criar ordem:', error && error.message ? error.message : error);
        res.status(500).json({ message: 'Erro ao criar ordem.' });
    }
});

// Rota para atualizar o STATUS de uma Ordem de Produção
// 🔐 SECURITY AUDIT: Added audit logging for status changes
app.put('/api/pcp/ordens/:id/status', authRequired, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        // Buscar status anterior para auditoria
        const [ordemAnterior] = await db.query("SELECT status FROM ordens_producao WHERE id = ?", [id]);
        const statusAnterior = ordemAnterior[0]?.status || 'unknown';

        const [result] = await db.query("UPDATE ordens_producao SET status = ? WHERE id = ?", [status, id]);
        if (result.affectedRows > 0) {
            // Log de auditoria
            await logProductionAudit(db, 'UPDATE_STATUS', 'ORDEM_PRODUCAO', id, req.user, {
                status_anterior: statusAnterior,
                status_novo: status,
                ip: req.ip
            });
            res.json({ message: "Status atualizado com sucesso!" });
        } else {
            res.status(404).json({ message: "Ordem não encontrada." });
        }
    } catch (error) {
        console.error("Erro ao atualizar status:", error);
        res.status(500).json({ message: "Erro ao atualizar status." });
    }
});

// Rota para EXCLUIR uma Ordem de Produção (soft delete ou hard delete)
// 🔐 SECURITY AUDIT: Added RBAC (ADMIN/SUPERVISOR only) and audit logging
app.delete('/api/pcp/ordens/:id', authRequired, requireProductionRole('ADMIN', 'SUPERVISOR', 'PCP'), async (req, res) => {
    const { id } = req.params;
    const { soft = 'true' } = req.query; // Por padrão, soft delete

    try {
        // Verificar se a ordem existe
        const [ordem] = await db.query("SELECT * FROM ordens_producao WHERE id = ?", [id]);
        if (ordem.length === 0) {
            return res.status(404).json({ message: "Ordem de produção não encontrada." });
        }

        // Verificar status - não permitir excluir ordens em produção ou finalizadas
        const statusBloqueados = ['em_producao', 'finalizada', 'concluida'];
        if (statusBloqueados.includes(ordem[0].status)) {
            return res.status(400).json({
                message: `não é possível excluir ordem com status "${ordem[0].status}". Apenas ordens pendentes ou canceladas podem ser excluídas.`
            });
        }

        if (soft === 'true') {
            // Soft delete - marca como cancelada
            await db.query("UPDATE ordens_producao SET status = 'cancelada', updated_at = NOW() WHERE id = ?", [id]);

            // Log de auditoria
            await logProductionAudit(db, 'SOFT_DELETE', 'ORDEM_PRODUCAO', id, req.user, {
                ordem_codigo: ordem[0].codigo_produto,
                ordem_descricao: ordem[0].descricao_produto,
                ip: req.ip
            });

            res.json({ message: "Ordem de produção cancelada com sucesso!", soft_delete: true });
        } else {
            // Hard delete - remove do banco (apenas supervisores/admin)
            if (!hasProductionRole(req.user, ['ADMIN'])) {
                return res.status(403).json({
                    message: 'Exclusão permanente requer permissão de administrador.'
                });
            }

            await db.query("DELETE FROM ordens_producao WHERE id = ?", [id]);

            // Log de auditoria
            await logProductionAudit(db, 'HARD_DELETE', 'ORDEM_PRODUCAO', id, req.user, {
                ordem_codigo: ordem[0].codigo_produto,
                ordem_descricao: ordem[0].descricao_produto,
                ip: req.ip
            });

            res.json({ message: "Ordem de produção excluída permanentemente!", soft_delete: false });
        }
    } catch (error) {
        console.error("Erro ao excluir ordem de produção:", error);
        res.status(500).json({ message: "Erro ao excluir ordem de produção.", error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Rota para EXCLUIR uma Ordem do Kanban
app.delete('/api/pcp/ordens-kanban/:id', authRequired, async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.query("DELETE FROM ordens_producao_kanban WHERE id = ?", [id]);
        if (result.affectedRows > 0) {
            res.json({ message: "Ordem do kanban excluída com sucesso!" });
        } else {
            res.status(404).json({ message: "Ordem não encontrada no kanban." });
        }
    } catch (error) {
        console.error("Erro ao excluir ordem do kanban:", error);
        res.status(500).json({ message: "Erro ao excluir ordem do kanban." });
    }
});


// =============================================
// ROTAS DE OPERADORES PCP
// =============================================

// Listar operadores para selects e filtros
// 🔐 SECURITY AUDIT: Added authRequired
app.get('/api/pcp/operadores', authRequired, async (req, res) => {
    console.log('[API_OPERADORES] Listando operadores...');
    try {
        // Tentar buscar da tabela funcionarios primeiro
        let funcionarios = [];
        try {
            const [rows] = await db.query(`
                SELECT id, nome, cargo, departamento, ativo
                FROM funcionarios
                WHERE ativo = 1 OR ativo IS NULL
                ORDER BY nome ASC
            `);
            funcionarios = rows || [];
        } catch (e) {
            console.log('[API_OPERADORES] Tabela funcionarios não encontrada, tentando usuarios_pcp...');
        }

        // Se não encontrou funcionários, buscar de usuarios_pcp
        if (funcionarios.length === 0) {
            try {
                const [rows] = await db.query(`
                    SELECT id, nome, role as cargo, departamento, ativo
                    FROM usuarios_pcp
                    WHERE ativo = 1 OR ativo IS NULL
                    ORDER BY nome ASC
                `);
                funcionarios = rows || [];
            } catch (e) {
                console.log('[API_OPERADORES] Tabela usuarios_pcp também falhou');
            }
        }

        // Se ainda não encontrou, retornar lista padrão
        if (funcionarios.length === 0) {
            funcionarios = [
                { id: 1, nome: 'Operador 1', cargo: 'Operador', departamento: 'Produção' },
                { id: 2, nome: 'Operador 2', cargo: 'Operador', departamento: 'Produção' },
                { id: 3, nome: 'Operador 3', cargo: 'Operador', departamento: 'Produção' }
            ];
        }

        console.log(`[API_OPERADORES] Retornando ${funcionarios.length} operadores`);
        res.json({ funcionarios, total: funcionarios.length });
    } catch (error) {
        console.error('[API_OPERADORES] Erro:', error.message);
        res.status(500).json({ message: 'Erro ao listar operadores', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});


// =============================================
// ROTAS DE CONTROLE PCP
// =============================================

// Listar ordens para controle PCP
// 🔐 SECURITY AUDIT: Added authRequired - PCP control panel requires auth
app.get('/api/pcp/controle-pcp', authRequired, async (req, res) => {
    console.log('[API_CONTROLE_PCP] Listando ordens para controle...');
    try {
        const { busca, vendedor, extrusora, status } = req.query;

        let whereParts = [];
        let params = [];

        // Filtro de busca
        if (busca && busca.trim()) {
            const like = `%${busca.trim()}%`;
            whereParts.push('(op.codigo LIKE ? OR op.produto_nome LIKE ? OR op.cliente LIKE ?)');
            params.push(like, like, like);
        }

        // Filtro de vendedor/responsável
        if (vendedor && vendedor.trim()) {
            whereParts.push('op.responsavel = ?');
            params.push(vendedor.trim());
        }

        // Filtro de extrusora/máquina
        if (extrusora && extrusora.trim()) {
            whereParts.push('op.maquina = ?');
            params.push(extrusora.trim());
        }

        // Filtro de status
        if (status && status.trim()) {
            whereParts.push('op.status = ?');
            params.push(status.trim());
        }

        const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

        const sql = `
            SELECT
                op.id, op.codigo, op.produto_nome, op.quantidade, op.unidade,
                op.status, op.prioridade, op.data_inicio, op.data_prevista,
                op.responsavel, op.maquina, op.progresso, op.cliente,
                op.created_at, op.updated_at
            FROM ordens_producao op
            ${whereClause}
            ORDER BY
                CASE op.status
                    WHEN 'em_producao' THEN 1
                    WHEN 'pendente' THEN 2
                    WHEN 'concluida' THEN 3
                    ELSE 4
                END,
                op.prioridade DESC,
                op.data_prevista ASC
            LIMIT 100
        `;

        const [ordens] = await db.query(sql, params);

        console.log(`[API_CONTROLE_PCP] Retornando ${ordens.length} ordens`);
        res.json({
            success: true,
            data: ordens || [],
            total: ordens.length
        });
    } catch (error) {
        console.error('[API_CONTROLE_PCP] Erro:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao listar ordens de produção',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Atualizar status de uma ordem no controle PCP
app.put('/api/pcp/controle-pcp/:id/status', authRequired, async (req, res) => {
    const { id } = req.params;
    const { status, observacao } = req.body;
    console.log(`[API_CONTROLE_PCP] Atualizando status da ordem ${id} para ${status}...`);

    try {
        if (!status) {
            return res.status(400).json({ success: false, message: 'Status é obrigatório' });
        }

        let updateSql = 'UPDATE ordens_producao SET status = ?, updated_at = NOW()';
        let params = [status];

        if (observacao) {
            updateSql += ', observacoes = ?';
            params.push(observacao);
        }

        // Atualizar data de conclusão se status for concluída
        if (status === 'concluida' || status === 'Concluída') {
            updateSql += ', data_conclusao = NOW(), progresso = 100';
        }

        updateSql += ' WHERE id = ?';
        params.push(id);

        const [result] = await db.query(updateSql, params);

        if (result.affectedRows > 0) {
            console.log(`[API_CONTROLE_PCP] Status da ordem ${id} atualizado para ${status}`);
            res.json({ success: true, message: 'Status atualizado com sucesso' });
        } else {
            res.status(404).json({ success: false, message: 'Ordem não encontrada' });
        }
    } catch (error) {
        console.error('[API_CONTROLE_PCP] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao atualizar status', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Buscar materiais de uma ordem no controle PCP
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/controle-pcp/:id/materiais', authRequired, async (req, res) => {
    const { id } = req.params;
    console.log(`[API_CONTROLE_PCP] Buscando materiais da ordem ${id}...`);

    try {
        // Tentar buscar materiais vinculados à ordem
        let materiais = [];
        try {
            const [rows] = await db.query(`
                SELECT
                    m.id, m.codigo_material, m.descricao, m.unidade_medida,
                    om.quantidade_necessaria, om.quantidade_utilizada
                FROM ordem_materiais om
                INNER JOIN materiais m ON om.material_id = m.id
                WHERE om.ordem_producao_id = ?
            `, [id]);
            materiais = rows || [];
        } catch (e) {
            console.log('[API_CONTROLE_PCP] Tabela ordem_materiais não existe, retornando vazio');
        }

        res.json({ success: true, data: materiais, total: materiais.length });
    } catch (error) {
        console.error('[API_CONTROLE_PCP] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao buscar materiais', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});


// --- ROTA PARA MULTIPLEXADO ---
// Salva dados de ordens relacionadas a cabos multiplexados
// 🔒 SECURITY AUDIT: Added authRequired - production operations require authentication
app.post('/api/pcp/multiplexado', authRequired, async (req, res) => {
    try {
        const dados = req.body;

        // Verificar se tabela multiplexado existe, criar se necessário
        const [tables] = await db.query("SHOW TABLES LIKE 'ordens_multiplexado'");

        if (!tables || tables.length === 0) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS ordens_multiplexado (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    numero_op VARCHAR(100),
                    cliente VARCHAR(255),
                    produtos JSON,
                    extrusora VARCHAR(100),
                    time_producao VARCHAR(100),
                    previsao_producao DATE,
                    bobinas VARCHAR(50),
                    qtd_bobinas INT DEFAULT 0,
                    metragem DECIMAL(15,2) DEFAULT 0,
                    peso_bruto DECIMAL(15,4) DEFAULT 0,
                    peso_liquido DECIMAL(15,4) DEFAULT 0,
                    al_kg DECIMAL(15,4) DEFAULT 0,
                    cores VARCHAR(200),
                    secao VARCHAR(100),
                    veias INT DEFAULT 0,
                    semana VARCHAR(50),
                    observacoes TEXT,
                    status ENUM('pendente', 'em_producao', 'concluido', 'cancelado') DEFAULT 'pendente',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('[API_MULTIPLEXADO] Tabela ordens_multiplexado criada com sucesso');
        }

        // Inserir dados
        const sql = `
            INSERT INTO ordens_multiplexado
            (numero_op, cliente, produtos, extrusora, time_producao, previsao_producao,
             bobinas, qtd_bobinas, metragem, peso_bruto, peso_liquido, al_kg,
             cores, secao, veias, semana, observacoes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const produtosJson = dados.produtos ? JSON.stringify(dados.produtos) : null;

        const [result] = await db.query(sql, [
            dados.numero_op || null,
            dados.cliente || null,
            produtosJson,
            dados.extrusora || null,
            dados.time_producao || null,
            dados.previsao_producao || null,
            dados.bobinas || null,
            dados.qtd_bobinas || 0,
            dados.metragem || 0,
            dados.peso_bruto || 0,
            dados.peso_liquido || 0,
            dados.al_kg || 0,
            dados.cores || null,
            dados.secao || null,
            dados.veias || 0,
            dados.semana || null,
            dados.observacoes || null
        ]);

        console.log('[API_MULTIPLEXADO] Ordem multiplexado salva com sucesso, ID:', result.insertId);
        res.status(201).json({
            success: true,
            message: 'Dados multiplexado salvos com sucesso!',
            id: result.insertId
        });

    } catch (error) {
        console.error('[API_MULTIPLEXADO] Erro:', error && error.message ? error.message : error);
        res.status(500).json({
            success: false,
            message: 'Erro ao salvar dados multiplexado',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET para listar ordens multiplexado
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/multiplexado', authRequired, async (req, res) => {
    try {
        // Verificar se tabela existe
        const [tables] = await db.query("SHOW TABLES LIKE 'ordens_multiplexado'");

        if (!tables || tables.length === 0) {
            return res.json([]);
        }

        const [rows] = await db.query(`
            SELECT * FROM ordens_multiplexado
            ORDER BY created_at DESC
        `);

        res.json(rows);

    } catch (error) {
        console.error('[API_MULTIPLEXADO] Erro ao listar:', error && error.message ? error.message : error);
        res.status(500).json({ message: 'Erro ao buscar dados multiplexado' });
    }
});


// --- NOVAS ROTAS PARA GESTÃO DE MATERIAIS ---

// Rota para criar um novo material
// 🔒 SECURITY AUDIT: Added authRequired - material creation requires authentication
app.post('/api/pcp/materiais', authRequired, async (req, res) => {
    const { codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao } = req.body;
    const sql = "INSERT INTO materiais (codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao) VALUES (?, ?, ?, ?, ?)";
    try {
        const [result] = await db.query(sql, [codigo_material, descricao, unidade_medida, quantidade_estoque, fornecedor_padrao]);
    res.status(201).json({ message: "Material criado com sucesso!", id: result.insertId });
    // Broadcast para clientes conectados
    broadcastMaterials();
    } catch (error) {
        console.error("Erro ao criar material:", error);
        res.status(500).json({ message: "Erro ao criar material.", error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Rota para buscar todos os materiais (com fallback para tabela produtos)
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/materiais', authRequired, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 1000;
        let rows;
        try {
            [rows] = await db.query("SELECT * FROM materiais ORDER BY descricao ASC LIMIT ?", [limit]);
        } catch (matErr) {
            // Tabela materiais pode não existir — fallback para produtos
            console.warn("Tabela materiais não encontrada, usando produtos:", matErr.message);
            [rows] = await db.query("SELECT * FROM produtos ORDER BY descricao ASC LIMIT ?", [limit]);
        }
        res.json(rows);
    } catch (error) {
        console.error("Erro ao buscar materiais:", error);
        res.status(500).json({ message: "Erro ao buscar materiais." });
    }
});

// Rota para buscar produtos que têm ENTRADA registrada no estoque (para módulo Compras)
// Só retorna produtos que tiveram movimentação de entrada no PCP
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/produtos/com-entrada', authRequired, async (req, res) => {
    console.log('[API_PRODUTOS_COM_ENTRADA] Requisição recebida');
    try {
        let page = parseInt(req.query.page, 10) || 1;
        let limit = parseInt(req.query.limit, 10) || 1000;
        if (page < 1) page = 1;
        if (limit < 1) limit = 10;
        const offset = (page - 1) * limit;

        // Buscar produtos que têm pelo menos uma entrada registrada na tabela de movimentações
        const sql = `
            SELECT DISTINCT p.*, COALESCE(p.preco_venda, p.preco, p.preco_custo, 0) as preco_display
            FROM produtos p
            INNER JOIN estoque_movimentacoes em ON (p.codigo = em.codigo_material OR CAST(p.id AS CHAR) = em.codigo_material)
            WHERE em.tipo_movimento = 'entrada'
            ORDER BY p.descricao ASC
            LIMIT ? OFFSET ?
        `;

        const [rows] = await db.query(sql, [limit, offset]);

        // Contar total
        const countSql = `
            SELECT COUNT(DISTINCT p.id) as total
            FROM produtos p
            INNER JOIN estoque_movimentacoes em ON (p.codigo = em.codigo_material OR CAST(p.id AS CHAR) = em.codigo_material)
            WHERE em.tipo_movimento = 'entrada'
        `;
        const [countResult] = await db.query(countSql);
        const total = countResult[0]?.total || 0;

        // Calcular estatísticas
        let comEstoque = 0, estoqueBaixo = 0, critico = 0;
        rows.forEach(p => {
            const qtd = Number(p.estoque_atual || p.quantidade || p.estoque || 0);
            const min = Number(p.estoque_minimo || 10);
            if (qtd <= min * 0.25) critico++;
            else if (qtd <= min) estoqueBaixo++;
            else comEstoque++;
        });

        console.log('[API_PRODUTOS_COM_ENTRADA] Total:', total, 'Retornados:', rows.length);
        res.json({
            page,
            limit,
            total,
            rows,
            produtos: rows,
            stats: {
                total_produtos: total,
                com_estoque: comEstoque,
                estoque_baixo: estoqueBaixo,
                critico: critico
            }
        });
    } catch (error) {
        console.error('[API_PRODUTOS_COM_ENTRADA] Erro:', error.message);
        res.status(500).json({ message: 'Erro ao buscar produtos com entrada.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Rota para buscar todos os produtos
// Observação: assume-se que exista a tabela `produtos` no banco `aluforce_vendas`.
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/produtos', authRequired, async (req, res) => {
    console.log('[API_PRODUTOS] Requisição recebida:', req.query);
    try {
        // support pagination: ?page=1&limit=6
    let page = parseInt(req.query.page, 10) || 1;
    let limit = parseInt(req.query.limit, 10) || 10;
        if (page < 1) page = 1;
        if (limit < 1) limit = 10;
        const offset = (page - 1) * limit;
        console.log('[API_PRODUTOS] Parâmetros:', { page, limit, offset });

    const q = (req.query.q || '').trim();
    const categoria = (req.query.categoria || '').trim();
    const estoqueFilter = (req.query.estoque || '').trim();
    const like = `%${q}%`;

        // fetch column metadata so client can mirror fields and build safe queries
        let columns = [];
        try {
            console.log('[API_PRODUTOS] Buscando colunas da tabela produtos...');
            const [cols] = await db.query('SHOW COLUMNS FROM produtos');
            columns = Array.isArray(cols) ? cols.map(c => c.Field) : [];
            console.log('[API_PRODUTOS] Colunas encontradas:', columns.length);
        } catch (e) {
            // if table missing or permission issues, respond gracefully
            console.error('[API_PRODUTOS] Erro ao buscar colunas:', e && e.message ? e.message : e);
            return res.status(500).json({ message: 'Erro ao acessar tabela produtos.' });
        }

        const has = (name) => columns.includes(name);
        const orderColumn = has('descricao') ? 'descricao' : (has('nome') ? 'nome' : (has('codigo') ? 'codigo' : 'id'));

        // Build WHERE conditions
        let whereParts = [];
        let params = [];

        // Search filter
        if (q) {
            const searchParts = [];
            if (has('codigo')) { searchParts.push('codigo LIKE ?'); params.push(like); }
            if (has('descricao')) { searchParts.push('descricao LIKE ?'); params.push(like); }
            if (has('nome')) { searchParts.push('nome LIKE ?'); params.push(like); }
            if (has('variacao')) { searchParts.push('variacao LIKE ?'); params.push(like); }
            if (has('sku')) { searchParts.push('sku LIKE ?'); params.push(like); }
            if (has('gtin')) { searchParts.push('gtin LIKE ?'); params.push(like); }
            if (searchParts.length > 0) {
                whereParts.push(`(${searchParts.join(' OR ')})`);
            }
        }

        // Category filter
        if (categoria && has('categoria')) {
            whereParts.push('categoria = ?');
            params.push(categoria);
        }

        // Filtro ALUFORCE - apenas produtos tipo "04 - Produto Acabado"
        const aluforceFilter = (req.query.aluforce || '').trim().toLowerCase();
        if (aluforceFilter === 'true' && has('tipo_produto')) {
            whereParts.push("tipo_produto = ?");
            params.push('04 - Produto Acabado');
        }

        // Stock status filter
        if (estoqueFilter) {
            const estoqueCol = has('estoque_atual') ? 'estoque_atual' : (has('quantidade') ? 'quantidade' : (has('estoque') ? 'estoque' : null));
            const minimoCol = has('estoque_minimo') ? 'estoque_minimo' : null;

            if (estoqueCol) {
                if (estoqueFilter === 'normal' && minimoCol) {
                    whereParts.push(`${estoqueCol} > ${minimoCol}`);
                } else if (estoqueFilter === 'baixo' && minimoCol) {
                    whereParts.push(`${estoqueCol} <= ${minimoCol}`);
                } else if (estoqueFilter === 'baixo') {
                    whereParts.push(`${estoqueCol} <= 10`);
                } else if (estoqueFilter === 'normal') {
                    whereParts.push(`${estoqueCol} > 10`);
                }
            }
        }

        // fetch rows with limit
        let rows = [];
        let total = 0;

        const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
        const sql = `SELECT * FROM produtos ${whereClause} ORDER BY ${orderColumn} ASC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        console.log('[API_PRODUTOS] SQL:', sql, 'Params:', params);
        const [rs] = await db.query(sql, params);
        rows = rs;

        // count total
        const countParams = params.slice(0, params.length - 2);
        const countSql = `SELECT COUNT(*) AS total FROM produtos ${whereClause}`;
        const [countRes] = await db.query(countSql, countParams);
        total = countRes && countRes[0] ? countRes[0].total : 0;

        // try to normalize variacao column to JSON arrays for clients
        let convertedLegacy = false;
        const normalizedRows = (rows || []).map(r => {
            try {
                if (r && typeof r.variacao === 'string') {
                    const raw = r.variacao.trim();
                    if (!raw) { r.variacao = []; }
                    else if (raw.startsWith('[') || raw.startsWith('{')) {
                        try { r.variacao = JSON.parse(raw); } catch (e) { r.variacao = [raw]; convertedLegacy = true; }
                    } else {
                        // legacy CSV or semicolon separated
                        const parts = raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
                        r.variacao = parts;
                        convertedLegacy = true;
                    }
                }
                // Backwards compatibility: if client expects 'descricao' but DB has 'nome', map it
                if (!r.descricao && r.nome) {
                    r.descricao = r.nome;
                }
            } catch (e) { /* ignore parse errors */ }
            return r;
        });

    if (convertedLegacy) res.setHeader('X-PCP-Warn', 'variacao-legacy-converted');
    // Ensure columns list includes descricao for clients that expect it
    if (!columns.includes('descricao') && columns.includes('nome')) columns.push('descricao');

    console.log('[API_PRODUTOS] Enviando resposta:', {
        page,
        limit,
        total,
        rows_count: normalizedRows.length,
        columns_count: columns.length
    });
    res.json({ page, limit, total, rows: normalizedRows, columns });
    } catch (error) {
        console.error('[API_PRODUTOS] ERRO FATAL:', error && error.message ? error.message : error);
        console.error('[API_PRODUTOS] Stack:', error.stack);
        // Provide minimal debug info in a separate endpoint for local troubleshooting
        res.status(500).json({ message: 'Erro ao buscar produtos.', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// (debug endpoint removed) - temporary debug endpoint was removed for production safety

// ==================== ROTAS DE COLUNAS DO KANBAN (ETAPAS) ====================

// Criar tabela kanban_colunas se não existir
async function garantirTabelaKanbanColunas() {
    try {
        const [tables] = await db.query("SHOW TABLES LIKE 'kanban_colunas'");

        if (!tables || tables.length === 0) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS kanban_colunas (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    codigo VARCHAR(50) NOT NULL UNIQUE,
                    nome VARCHAR(100) NOT NULL,
                    descricao VARCHAR(255),
                    cor VARCHAR(20) DEFAULT '#6b7280',
                    icone VARCHAR(50) DEFAULT 'fa-circle',
                    ordem INT DEFAULT 0,
                    ativo TINYINT(1) DEFAULT 1,
                    permite_exclusao TINYINT(1) DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // Inserir colunas padrão do sistema
            await db.query(`
                INSERT INTO kanban_colunas (codigo, nome, descricao, cor, icone, ordem, permite_exclusao) VALUES
                ('a_produzir', 'A Produzir', 'Ordens aguardando início da produção', '#3b82f6', 'fa-clock', 1, 0),
                ('produzindo', 'Produzindo', 'Ordens em processo de produção', '#f59e0b', 'fa-cog', 2, 0),
                ('qualidade', 'Qualidade', 'Ordens em controle de qualidade', '#8b5cf6', 'fa-check-circle', 3, 1),
                ('conferido', 'Conferido', 'Ordens conferidas e aprovadas', '#f97316', 'fa-clipboard-check', 4, 1),
                ('concluido', 'Concluído', 'Ordens finalizadas', '#22c55e', 'fa-check', 5, 0),
                ('armazenado', 'Armazenado', 'Ordens armazenadas no estoque', '#6b7280', 'fa-warehouse', 6, 1)
            `);

            console.log('[API_KANBAN_COLUNAS] Tabela kanban_colunas criada com colunas padrão');
        }
    } catch (error) {
        console.error('[API_KANBAN_COLUNAS] Erro ao criar tabela:', error.message);
    }
}

// Listar colunas ativas do kanban (para renderizar o kanban)
app.get('/api/pcp/kanban-colunas', authRequired, async (req, res) => {
    console.log('[API_KANBAN_COLUNAS] Listando colunas ativas');
    try {
        await garantirTabelaKanbanColunas();

        const [rows] = await db.query(`
            SELECT id, codigo, nome, descricao, cor, icone, ordem, permite_exclusao
            FROM kanban_colunas
            WHERE ativo = 1
            ORDER BY ordem ASC
        `);

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[API_KANBAN_COLUNAS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao listar colunas' });
    }
});

// Listar TODAS as colunas (para modal de configuração)
app.get('/api/pcp/kanban-colunas/todas', authRequired, async (req, res) => {
    console.log('[API_KANBAN_COLUNAS] Listando todas as colunas para configuração');
    try {
        await garantirTabelaKanbanColunas();

        const [rows] = await db.query(`
            SELECT id, codigo, nome, descricao, cor, icone, ordem, permite_exclusao, ativo
            FROM kanban_colunas
            ORDER BY ordem ASC
        `);

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[API_KANBAN_COLUNAS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao listar colunas' });
    }
});

// Criar nova coluna
app.post('/api/pcp/kanban-colunas', authRequired, async (req, res) => {
    console.log('[API_KANBAN_COLUNAS] Criando nova coluna');
    try {
        await garantirTabelaKanbanColunas();

        const { nome, descricao, cor, icone } = req.body;

        if (!nome) {
            return res.status(400).json({ success: false, message: 'Nome é obrigatório' });
        }

        // Gerar código único baseado no nome
        const codigo = nome.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .substring(0, 50);

        // Pegar maior ordem
        const [maxOrdem] = await db.query('SELECT MAX(ordem) as max FROM kanban_colunas');
        const novaOrdem = (maxOrdem[0]?.max || 0) + 1;

        const [result] = await db.query(`
            INSERT INTO kanban_colunas (codigo, nome, descricao, cor, icone, ordem, permite_exclusao)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [codigo, nome, descricao || '', cor || '#6b7280', icone || 'fa-circle', novaOrdem]);

        res.json({
            success: true,
            message: 'Coluna criada com sucesso!',
            data: { id: result.insertId, codigo, nome, descricao, cor, icone, ordem: novaOrdem }
        });
    } catch (error) {
        console.error('[API_KANBAN_COLUNAS] Erro:', error.message);
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ success: false, message: 'Já existe uma coluna com este nome' });
        } else {
            res.status(500).json({ success: false, message: 'Erro ao criar coluna' });
        }
    }
});

// Atualizar coluna existente
app.put('/api/pcp/kanban-colunas/:id', authRequired, async (req, res) => {
    console.log('[API_KANBAN_COLUNAS] Atualizando coluna:', req.params.id);
    try {
        const { id } = req.params;
        const { nome, descricao, cor, icone } = req.body;

        if (!nome) {
            return res.status(400).json({ success: false, message: 'Nome é obrigatório' });
        }

        const [result] = await db.query(`
            UPDATE kanban_colunas
            SET nome = ?, descricao = ?, cor = ?, icone = ?, updated_at = NOW()
            WHERE id = ?
        `, [nome, descricao || '', cor || '#6b7280', icone || 'fa-circle', id]);

        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Coluna atualizada com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Coluna não encontrada' });
        }
    } catch (error) {
        console.error('[API_KANBAN_COLUNAS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao atualizar coluna' });
    }
});

// Reordenar colunas
app.put('/api/pcp/kanban-colunas/reordenar', authRequired, async (req, res) => {
    console.log('[API_KANBAN_COLUNAS] Reordenando colunas');
    try {
        const { ordem } = req.body; // Array: [{ id: 1, ordem: 1 }, { id: 2, ordem: 2 }, ...]

        if (!ordem || !Array.isArray(ordem)) {
            return res.status(400).json({ success: false, message: 'Dados de ordem inválidos' });
        }

        // Atualizar ordem de cada coluna
        for (const item of ordem) {
            await db.query('UPDATE kanban_colunas SET ordem = ? WHERE id = ?', [item.ordem, item.id]);
        }

        res.json({ success: true, message: 'Ordem atualizada com sucesso!' });
    } catch (error) {
        console.error('[API_KANBAN_COLUNAS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao reordenar colunas' });
    }
});

// Excluir coluna (apenas se permite_exclusao = 1)
app.delete('/api/pcp/kanban-colunas/:id', authRequired, async (req, res) => {
    console.log('[API_KANBAN_COLUNAS] Excluindo coluna:', req.params.id);
    try {
        const { id } = req.params;

        // Verificar se a coluna pode ser excluída
        const [coluna] = await db.query('SELECT * FROM kanban_colunas WHERE id = ?', [id]);

        if (!coluna || coluna.length === 0) {
            return res.status(404).json({ success: false, message: 'Coluna não encontrada' });
        }

        if (!coluna[0].permite_exclusao) {
            return res.status(400).json({ success: false, message: 'Esta coluna é do sistema e não pode ser excluída' });
        }

        // Verificar se há ordens nessa coluna
        const [ordens] = await db.query('SELECT COUNT(*) as count FROM ordens_producao_kanban WHERE status = ?', [coluna[0].codigo]);

        if (ordens[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: `Não é possível excluir. Existem ${ordens[0].count} ordem(ns) nesta etapa.`
            });
        }

        const [result] = await db.query('DELETE FROM kanban_colunas WHERE id = ?', [id]);

        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Coluna excluída com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Coluna não encontrada' });
        }
    } catch (error) {
        console.error('[API_KANBAN_COLUNAS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao excluir coluna' });
    }
});

// ==================== ROTAS DE ORDENS DE PRODUÇÃO (KANBAN) ====================

// Próximo número sequencial de OP
app.get('/api/pcp/ordens-kanban/proximo-numero', authRequired, async (req, res) => {
    try {
        const ano = new Date().getFullYear();
        const prefix = `OP Nº ${ano}/`;

        // Buscar o maior número sequencial do ano corrente
        const [rows] = await db.query(
            `SELECT numero FROM ordens_producao_kanban
             WHERE numero LIKE ?
             ORDER BY CAST(SUBSTRING_INDEX(numero, '/', -1) AS UNSIGNED) DESC
             LIMIT 1`,
            [`${prefix}%`]
        );

        let proximoSeq = 1;
        if (rows && rows.length > 0) {
            const ultimo = rows[0].numero;
            const partes = ultimo.split('/');
            const ultimoNum = parseInt(partes[partes.length - 1]) || 0;
            proximoSeq = ultimoNum + 1;
        }

        const numero = `${prefix}${String(proximoSeq).padStart(5, '0')}`;
        res.json({ numero, sequencial: proximoSeq, ano });
    } catch (error) {
        console.error('[API_PROXIMO_NUMERO] Erro:', error.message);
        // Fallback com timestamp
        const ano = new Date().getFullYear();
        const seq = String(Date.now()).slice(-5);
        res.json({ numero: `OP Nº ${ano}/${seq}`, sequencial: parseInt(seq), ano });
    }
});

// API para Kanban de Ordens de Produção - formato compatível com ordens-producao.html
// Agora unifica dados de ordens_producao E ordens_producao_kanban
app.get('/api/pcp/ordens-kanban', authRequired, async (req, res) => {
    console.log('[API_ORDENS_KANBAN] Requisição recebida');
    try {
        // Verifica se a tabela kanban existe e cria se necessário
        const [tables] = await db.query("SHOW TABLES LIKE 'ordens_producao_kanban'");

        if (!tables || tables.length === 0) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS ordens_producao_kanban (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    numero VARCHAR(50) NOT NULL,
                    status VARCHAR(50) DEFAULT 'a_produzir',
                    status_texto VARCHAR(50) DEFAULT 'Em dia',
                    produto VARCHAR(255) NOT NULL,
                    descricao TEXT,
                    codigo VARCHAR(50),
                    data_conclusao DATE,
                    quantidade INT DEFAULT 0,
                    produzido INT DEFAULT 0,
                    unidade VARCHAR(10) DEFAULT 'M',
                    observacoes TEXT,
                    pedido_vinculado_id INT NULL,
                    cliente_nome VARCHAR(200) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('[API_ORDENS_KANBAN] Tabela ordens_producao_kanban criada com sucesso');
        } else {
            // Se a tabela existe, verificar se o campo status ainda é ENUM e alterar para VARCHAR
            try {
                const [columns] = await db.query(`SHOW COLUMNS FROM ordens_producao_kanban LIKE 'status'`);
                if (columns.length > 0 && columns[0].Type.startsWith('enum')) {
                    await db.query(`ALTER TABLE ordens_producao_kanban MODIFY COLUMN status VARCHAR(50) DEFAULT 'a_produzir'`);
                    console.log('[API_ORDENS_KANBAN] Coluna status alterada de ENUM para VARCHAR');
                }
            } catch (alterError) {
                console.log('[API_ORDENS_KANBAN] Não foi possível alterar coluna status:', alterError.message);
            }
            // Garantir que colunas pedido_vinculado_id e cliente_nome existem
            try {
                const [cols] = await db.query(`SHOW COLUMNS FROM ordens_producao_kanban WHERE Field IN ('pedido_vinculado_id','cliente_nome')`);
                const existingCols = cols.map(c => c.Field);
                if (!existingCols.includes('pedido_vinculado_id')) {
                    await db.query(`ALTER TABLE ordens_producao_kanban ADD COLUMN pedido_vinculado_id INT NULL`);
                    console.log('[API_ORDENS_KANBAN] Coluna pedido_vinculado_id adicionada');
                }
                if (!existingCols.includes('cliente_nome')) {
                    await db.query(`ALTER TABLE ordens_producao_kanban ADD COLUMN cliente_nome VARCHAR(200) NULL`);
                    console.log('[API_ORDENS_KANBAN] Coluna cliente_nome adicionada');
                }
            } catch (e) {
                console.log('[API_ORDENS_KANBAN] Erro ao verificar colunas:', e.message);
            }
        }

        // Verifica se a tabela de itens existe e cria se necessário
        const [tablesItens] = await db.query("SHOW TABLES LIKE 'itens_ordem_producao'");

        if (!tablesItens || tablesItens.length === 0) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS itens_ordem_producao (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    ordem_producao_id INT NOT NULL,
                    material_id INT NULL,
                    codigo_material VARCHAR(50),
                    descricao_material VARCHAR(255) NOT NULL,
                    quantidade_necessaria DECIMAL(15,6) DEFAULT 0,
                    quantidade_utilizada DECIMAL(15,6) DEFAULT 0,
                    unidade_medida VARCHAR(20) DEFAULT 'UN',
                    estoque_disponivel DECIMAL(15,6) DEFAULT 0,
                    local_estoque VARCHAR(100) DEFAULT 'ALMOXARIFADO',
                    tipo_item ENUM('PRODUTO_ACABADO', 'MATERIA_PRIMA', 'COMPONENTE', 'EMBALAGEM', 'INSUMO') DEFAULT 'MATERIA_PRIMA',
                    custo_unitario DECIMAL(15,4) DEFAULT 0,
                    custo_total DECIMAL(15,4) DEFAULT 0,
                    principal TINYINT(1) DEFAULT 0,
                    observacao TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_ordem (ordem_producao_id),
                    INDEX idx_material (material_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('[API_ORDENS_KANBAN] Tabela itens_ordem_producao criada com sucesso');
        }

        // Busca dados da tabela kanban
        const [kanbanRows] = await db.query(`
            SELECT
                id, numero, status, status_texto as statusTexto, produto, descricao,
                codigo, DATE_FORMAT(data_conclusao, '%Y-%m-%d') as dataConclusao,
                quantidade, produzido, unidade, observacoes, created_at, 'kanban' as origem,
                pedido_vinculado_id, cliente_nome
            FROM ordens_producao_kanban
        `);

        // Busca dados da tabela principal de ordens_producao (que não estão Concluídas/canceladas)
        const [ordensRows] = await db.query(`
            SELECT
                id,
                codigo as numero,
                CASE status
                    WHEN 'ativa' THEN 'a_produzir'
                    WHEN 'em_producao' THEN 'produzindo'
                    WHEN 'pendente' THEN 'a_produzir'
                    WHEN 'qualidade' THEN 'qualidade'
                    WHEN 'conferido' THEN 'conferido'
                    WHEN 'concluida' THEN 'concluido'
                    WHEN 'armazenado' THEN 'armazenado'
                    WHEN 'cancelada' THEN 'concluido'
                    ELSE 'a_produzir'
                END as status,
                CASE
                    WHEN data_prevista < CURDATE() AND status NOT IN ('concluida', 'armazenado', 'cancelada') THEN 'Atrasada'
                    WHEN status IN ('concluida', 'armazenado') THEN 'Concluída'
                    ELSE 'Em dia'
                END as statusTexto,
                produto_nome as produto,
                observacoes as descricao,
                codigo,
                DATE_FORMAT(COALESCE(data_prevista, data_inicio), '%Y-%m-%d') as dataConclusao,
                CAST(quantidade as SIGNED) as quantidade,
                CAST(COALESCE(quantidade_produzida, 0) as SIGNED) as produzido,
                COALESCE(unidade, 'UN') as unidade,
                observacoes,
                created_at,
                'ordens' as origem,
                numero_pedido as pedido_vinculado_id,
                cliente_nome
            FROM ordens_producao
            WHERE status NOT IN ('cancelada')
        `);

        // Combina os dados, evitando duplicatas por código
        const codigosKanban = new Set(kanbanRows.map(r => r.numero));
        const ordensSemDuplicatas = ordensRows.filter(r => !codigosKanban.has(r.numero));

        const todasOrdens = [...kanbanRows, ...ordensSemDuplicatas];

        // Ordena por status e data
        const statusOrder = { 'a_produzir': 1, 'produzindo': 2, 'qualidade': 3, 'conferido': 4, 'concluido': 5, 'armazenado': 6 };
        todasOrdens.sort((a, b) => {
            const orderA = statusOrder[a.status] || 99;
            const orderB = statusOrder[b.status] || 99;
            if (orderA !== orderB) return orderA - orderB;
            return new Date(a.dataConclusao || '2099-12-31') - new Date(b.dataConclusao || '2099-12-31');
        });

        console.log('[API_ORDENS_KANBAN] Retornando', todasOrdens.length, 'ordens (kanban:', kanbanRows.length, '+ ordens:', ordensSemDuplicatas.length, ')');
        res.json(todasOrdens);

    } catch (error) {
        console.error('[API_ORDENS_KANBAN] Erro:', error.message);
        res.status(500).json([]);
    }
});

// ============================================================
// CRIAR ORDEM DE PRODUÇÃO — ENTERPRISE (persiste TODOS os campos)
// ============================================================
app.post('/api/pcp/ordens-kanban', authRequired, async (req, res) => {
    console.log('[API_ORDENS_KANBAN_V2] Criando nova ordem — ENTERPRISE');

    // Garantir tabelas auxiliares existem (migração lazy)
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS ordens_producao_itens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ordem_producao_id INT NOT NULL,
            item_numero INT DEFAULT 1,
            codigo_produto VARCHAR(50) NOT NULL,
            descricao_produto VARCHAR(500) NOT NULL,
            embalagem VARCHAR(100) DEFAULT 'Bobina',
            codigo_cores VARCHAR(100) NULL,
            lances VARCHAR(100) DEFAULT '1x100',
            quantidade DECIMAL(15,2) NOT NULL DEFAULT 1,
            unidade_medida VARCHAR(20) DEFAULT 'M',
            valor_unitario DECIMAL(15,4) DEFAULT 0,
            valor_total DECIMAL(15,4) DEFAULT 0,
            peso_liquido DECIMAL(15,4) NULL,
            peso_bruto DECIMAL(15,4) NULL,
            lote VARCHAR(100) NULL,
            observacao TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_ordem_item (ordem_producao_id),
            INDEX idx_codigo_produto (codigo_produto)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

        await db.query(`CREATE TABLE IF NOT EXISTS ordens_producao_pagamentos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ordem_producao_id INT NOT NULL,
            linha INT DEFAULT 1,
            forma_pagamento VARCHAR(50) NOT NULL,
            percentual DECIMAL(5,2) DEFAULT 0,
            metodo_pagamento VARCHAR(50) NULL,
            valor DECIMAL(15,2) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_ordem_pag (ordem_producao_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    } catch (migErr) {
        console.warn('[MIGRATION_LAZY] Tabelas auxiliares:', migErr.message);
    }

    try {
        const d = req.body;
        const user = req.user || {};

        // ── Normalizar campos com acento (retrocompat frontend) ──
        if (!d.numero && d['número']) d.numero = d['número'];
        if (!d.cliente && d.cliente_nome) d.cliente = d.cliente_nome;
        if (!d.numero_pedido && d['número_pedido']) d.numero_pedido = d['número_pedido'];
        if (!d.numero_orcamento && d['número_orçamento']) d.numero_orcamento = d['número_orçamento'];
        if (!d.descricao && d['descrição']) d.descricao = d['descrição'];

        // ── Validações enterprise ──
        const erros = [];
        if (!d.cliente && (!d.produtos || d.produtos.length === 0)) {
            erros.push('Informe o cliente ou adicione pelo menos um produto.');
        }
        if (!d.numero) {
            erros.push('Número da OP é obrigatório.');
        }
        if (erros.length > 0) {
            return res.status(400).json({ error: erros.join(' '), erros });
        }

        // Verificar duplicidade de número de OP
        try {
            const [existing] = await db.query(
                'SELECT id FROM ordens_producao WHERE codigo = ? LIMIT 1', [d.numero]
            );
            if (existing && existing.length > 0) {
                return res.status(409).json({ error: `OP com número "${d.numero}" já existe (ID: ${existing[0].id}). Use outro número.` });
            }
        } catch (dupErr) { /* tabela pode não ter a coluna ainda */ }

        // ── Dados derivados ──
        const hoje = new Date();
        const dataConc = d.dataConclusao ? new Date(d.dataConclusao) : null;
        const statusTexto = (dataConc && dataConc < hoje) ? 'Atrasada' : 'Em dia';
        const clienteNome = d.cliente || d.cliente_nome || '';
        const produtoNome = d.produto || clienteNome || 'Ordem de Produção';
        const qtdTotal = d.produtos && d.produtos.length > 0
            ? d.produtos.reduce((acc, p) => acc + (parseFloat(p.quantidade) || 0), 0)
            : (parseFloat(d.quantidade) || 0);
        const valorTotal = d.produtos && d.produtos.length > 0
            ? d.produtos.reduce((acc, p) => acc + (parseFloat(p.total) || (parseFloat(p.quantidade) || 0) * (parseFloat(p.valor_unitario) || 0)), 0)
            : 0;

        // ── INÍCIO DA TRANSAÇÃO ──
        const conn = await db.getConnection();
        await conn.beginTransaction();

        try {
            // 1. INSERT principal — ordens_producao com TODOS os campos
            const sqlPrincipal = `
                INSERT INTO ordens_producao (
                    codigo, revisao, numero_pedido, numero_orcamento, data_liberacao,
                    produto_nome, quantidade, unidade, status, prioridade,
                    data_inicio, data_prevista, observacoes,
                    cliente_nome, cliente_cnpj, cliente_contato, cliente_telefone,
                    cliente_email, cliente_endereco, cliente_cep, cliente_email_nfe,
                    vendedor, prazo_entrega, tipo_frete,
                    transportadora_nome, transportadora_cnpj, transportadora_telefone,
                    transportadora_cep, transportadora_email_nfe, transportadora_endereco,
                    forma_pagamento, metodo_pagamento, percentual_pagamento,
                    condicoes_pagamento, formas_pagamento_json, valor_total,
                    data_previsao_entrega, qtd_volumes, tipo_embalagem_entrega, observacoes_entrega,
                    extrusora, time_producao, previsao_producao, bobinas, qtd_bobinas,
                    metragem, peso_bruto, peso_liquido, al_kg, cores_pe,
                    secao, veias, semana,
                    created_by, created_by_name, produtos_json,
                    pedido_vinculado_id
                ) VALUES (
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, 'ativa', 'media',
                    CURDATE(), ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?,
                    ?
                )
            `;

            const producao = d.producao || {};
            const cores = [
                producao.cor_pt ? `PT:${producao.cor_pt}` : '',
                producao.cor_cz ? `CZ:${producao.cor_cz}` : '',
                producao.cor_vm ? `VM:${producao.cor_vm}` : '',
                producao.cor_az ? `AZ:${producao.cor_az}` : ''
            ].filter(Boolean).join(', ');

            const paramsPrincipal = [
                d.numero || `OP-${Date.now()}`,                              // codigo
                d.revisao || '01',                                            // revisao
                d.numero_pedido || d.num_pedido || null,                     // numero_pedido
                d.numero_orcamento || d.num_orcamento || null,               // numero_orcamento
                d.data_liberacao || null,                                      // data_liberacao
                produtoNome,                                                   // produto_nome
                qtdTotal || 0,                                                // quantidade
                d.unidade || d.produtos?.[0]?.unidade_medida || 'UN',        // unidade
                d.dataConclusao || d.data_previsao_entrega || null,          // data_prevista
                d.observacoes || '',                                          // observacoes
                clienteNome,                                                   // cliente_nome
                d.cpf_cnpj || d.cliente_cpf_cnpj || null,                    // cliente_cnpj
                d.contato_cliente || d.contato || null,                      // cliente_contato
                d.fone_cliente || d.telefone || null,                        // cliente_telefone
                d.email_cliente || d.email || null,                          // cliente_email
                d.endereco_cliente || null,                                    // cliente_endereco
                d.cep_cliente || null,                                        // cliente_cep
                d.email_nfe_cliente || d.email_nfe || null,                  // cliente_email_nfe
                d.vendedor || null,                                           // vendedor
                d.prazo_entrega || null,                                      // prazo_entrega
                d.tipo_frete || d.frete || 'CIF',                           // tipo_frete
                d.transportadora_nome || null,                                // transportadora_nome
                d.transportadora_cpf_cnpj || null,                           // transportadora_cnpj
                d.transportadora_fone || null,                               // transportadora_telefone
                d.transportadora_cep || null,                                // transportadora_cep
                d.transportadora_email_nfe || null,                          // transportadora_email_nfe
                d.transportadora_endereco || null,                           // transportadora_endereco
                d.forma_pagamento || null,                                    // forma_pagamento
                d.metodo_pagamento || null,                                  // metodo_pagamento
                d.percentual_pagamento || 100,                               // percentual_pagamento
                d.condicoes_pagamento || null,                               // condicoes_pagamento
                d.formas_pagamento ? JSON.stringify(d.formas_pagamento) : null, // formas_pagamento_json
                valorTotal,                                                   // valor_total
                d.data_previsao_entrega || null,                             // data_previsao_entrega
                d.qtd_volumes || null,                                       // qtd_volumes
                d.tipo_embalagem_entrega || null,                            // tipo_embalagem_entrega
                d.observacoes_entrega || null,                               // observacoes_entrega
                producao.extrusora || null,                                  // extrusora
                producao.time_producao || null,                              // time_producao
                producao.previsao_producao || d.data_previsao_entrega || null, // previsao_producao
                parseInt(producao.bobinas) || 0,                             // bobinas
                parseInt(producao.quantidade_bobinas || producao.qtd_bobinas) || 0, // qtd_bobinas
                parseFloat(producao.metragem) || 0,                          // metragem
                parseFloat(producao.peso_bruto) || 0,                        // peso_bruto
                parseFloat(producao.peso_liquido) || 0,                      // peso_liquido
                parseFloat(producao.al_kg) || 0,                             // al_kg
                cores || null,                                                // cores_pe
                producao.secao || null,                                      // secao
                parseInt(producao.veias) || 0,                               // veias
                producao.semana || null,                                      // semana
                user.id || null,                                              // created_by
                user.nome || user.name || user.email || null,                // created_by_name
                d.produtos ? JSON.stringify(d.produtos) : null,              // produtos_json
                d.pedido_vinculado_id || null                                // pedido_vinculado_id
            ];

            const [resultProd] = await conn.query(sqlPrincipal, paramsPrincipal);
            const idOrdensProd = resultProd.insertId;
            console.log('[API_ORDENS_KANBAN_V2] OP principal criada ID:', idOrdensProd);

            // 2. INSERT itens/produtos individuais
            if (d.produtos && Array.isArray(d.produtos) && d.produtos.length > 0) {
                for (let i = 0; i < d.produtos.length; i++) {
                    const p = d.produtos[i];
                    await conn.query(`
                        INSERT INTO ordens_producao_itens
                        (ordem_producao_id, item_numero, codigo_produto, descricao_produto,
                         embalagem, codigo_cores, lances, quantidade, unidade_medida,
                         valor_unitario, valor_total, peso_liquido, peso_bruto, lote)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        idOrdensProd,
                        i + 1,
                        p.codigo || '',
                        p.descricao || p.nome || '',
                        p.embalagem || 'Bobina',
                        p.codigo_cores || null,
                        p.lances || '1x100',
                        parseFloat(p.quantidade) || 1,
                        p.unidade_medida || p.unidade || 'M',
                        parseFloat(p.valor_unitario) || 0,
                        parseFloat(p.total) || (parseFloat(p.quantidade) || 0) * (parseFloat(p.valor_unitario) || 0),
                        parseFloat(p.peso_liquido) || null,
                        parseFloat(p.peso_bruto) || null,
                        p.lote || null
                    ]);
                }
                console.log(`[API_ORDENS_KANBAN_V2] ${d.produtos.length} itens inseridos`);
            }

            // 3. INSERT formas de pagamento
            if (d.formas_pagamento && Array.isArray(d.formas_pagamento) && d.formas_pagamento.length > 0) {
                for (let i = 0; i < d.formas_pagamento.length; i++) {
                    const pg = d.formas_pagamento[i];
                    if (pg.forma && pg.percentual > 0) {
                        await conn.query(`
                            INSERT INTO ordens_producao_pagamentos
                            (ordem_producao_id, linha, forma_pagamento, percentual, metodo_pagamento, valor)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `, [
                            idOrdensProd,
                            i + 1,
                            pg.forma,
                            parseFloat(pg.percentual) || 0,
                            pg.metodo || null,
                            parseFloat(pg.valor) || 0
                        ]);
                    }
                }
                console.log(`[API_ORDENS_KANBAN_V2] ${d.formas_pagamento.length} pagamentos inseridos`);
            }

            // 4. INSERT na tabela kanban (visualização)
            const [resultKanban] = await conn.query(`
                INSERT INTO ordens_producao_kanban
                (numero, status, status_texto, produto, descricao, codigo, data_conclusao,
                 quantidade, produzido, unidade, observacoes, pedido_vinculado_id, cliente_nome)
                VALUES (?, 'a_produzir', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
            `, [
                d.numero, statusTexto, produtoNome, d.observacoes || '', d.numero_orcamento || '',
                d.dataConclusao || d.data_previsao_entrega || null,
                qtdTotal || 0, d.unidade || 'M', d.observacoes || '',
                d.pedido_vinculado_id || null, clienteNome
            ]);

            // 5. Audit log
            try {
                await logProductionAudit(db, 'CREATE', 'ORDEM_PRODUCAO', idOrdensProd, user, {
                    numero: d.numero,
                    cliente: clienteNome,
                    produtos_count: d.produtos?.length || 0,
                    valor_total: valorTotal
                });
            } catch (auditErr) {
                console.warn('[AUDIT] Erro ao registrar auditoria:', auditErr.message);
            }

            // ── COMMIT ──
            await conn.commit();

            const novaOrdem = {
                id: resultKanban.insertId,
                idOrdensProd,
                numero: d.numero,
                status: 'a_produzir',
                statusTexto,
                produto: produtoNome,
                descricao: d.observacoes || '',
                codigo: d.numero_orcamento || '',
                dataConclusao: d.dataConclusao || d.data_previsao_entrega || null,
                quantidade: qtdTotal || 0,
                produzido: 0,
                unidade: d.unidade || 'M',
                observacoes: d.observacoes || '',
                cliente_nome: clienteNome,
                origem: 'kanban',
                valor_total: valorTotal,
                produtos_count: d.produtos?.length || 0
            };

            console.log('[API_ORDENS_KANBAN_V2] OP completa criada com sucesso! Principal:', idOrdensProd, 'Kanban:', resultKanban.insertId);
            res.status(201).json(novaOrdem);

        } catch (txError) {
            await conn.rollback();
            console.error('[API_ORDENS_KANBAN_V2] ROLLBACK - Erro na transação:', txError.message);
            res.status(500).json({ error: 'Erro ao criar OP' + (process.env.NODE_ENV === 'development' ? ': ' + txError.message : '') });
        } finally {
            conn.release();
        }

    } catch (error) {
        console.error('[API_ORDENS_KANBAN_V2] Erro geral:', error.message);
        res.status(500).json({ error: 'Erro ao criar ordem de produção' });
    }
});

// Atualizar status da ordem no Kanban (suporta ambas as tabelas)
app.put('/api/pcp/ordens-kanban/:id', authRequired, async (req, res) => {
    console.log('[API_ORDENS_KANBAN] Atualizando ordem ID:', req.params.id);
    try {
        const { id } = req.params;
        const { status, origem } = req.body;

        // Mapear status do kanban para status da tabela ordens_producao
        // Manter status granulares (qualidade, conferido, armazenado) para não perder posição no kanban
        const statusMapOrdens = {
            'a_produzir': 'ativa',
            'produzindo': 'em_producao',
            'qualidade': 'qualidade',
            'conferido': 'conferido',
            'concluido': 'concluida',
            'armazenado': 'armazenado'
        };

        // Se veio da tabela ordens_producao, atualiza lá
        if (origem === 'ordens') {
            const statusOrdens = statusMapOrdens[status] || 'ativa';
            const quantidadeUpdate = (status === 'concluido' || status === 'armazenado')
                ? ', quantidade_produzida = quantidade'
                : '';

            await db.query(`
                UPDATE ordens_producao
                SET status = ?${quantidadeUpdate}
                WHERE id = ?
            `, [statusOrdens, id]);

            console.log('[API_ORDENS_KANBAN] Ordem (ordens_producao) atualizada para status:', statusOrdens);
        } else {
            // Tabela ordens_producao_kanban
            let statusTexto = 'Em dia';
            if (status === 'concluido' || status === 'armazenado') {
                statusTexto = 'Concluída';
            }

            if (status === 'concluido' || status === 'armazenado') {
                await db.query(`
                    UPDATE ordens_producao_kanban
                    SET status = ?, status_texto = ?, produzido = quantidade
                    WHERE id = ?
                `, [status, statusTexto, id]);
            } else {
                await db.query(`
                    UPDATE ordens_producao_kanban
                    SET status = ?, status_texto = ?
                    WHERE id = ?
                `, [status, statusTexto, id]);
            }
            console.log('[API_ORDENS_KANBAN] Ordem (kanban) atualizada');
        }

        res.json({ success: true, message: 'Status atualizado com sucesso' });

    } catch (error) {
        console.error('[API_ORDENS_KANBAN] Erro ao atualizar:', error.message);
        res.status(500).json({ error: 'Erro ao atualizar status da ordem' });
    }
});

// ==================== ROTAS DE ORDENS DE PRODUÇÃO (LEGACY) ====================

// Buscar todas as ordens de produção
app.get('/api/pcp/ordens-producao', authRequired, async (req, res) => {
    console.log('[API_ORDENS_PRODUCAO] Requisição recebida');
    try {
        // Verifica se a tabela existe
        const [tables] = await db.query("SHOW TABLES LIKE 'ordens_producao'");

        if (!tables || tables.length === 0) {
            console.log('[API_ORDENS_PRODUCAO] Tabela não existe, retornando array vazio');
            return res.json({
                success: true,
                data: [],
                total: 0,
                message: 'Tabela não criada ainda - sem dados'
            });
        }

        // Se a tabela existe, busca os dados reais
        const [rows] = await db.query(`
            SELECT
                id, codigo, produto_nome, quantidade, unidade,
                status, prioridade, data_inicio, data_prevista,
                data_conclusao, responsavel, progresso, observacoes,
                created_at, updated_at
            FROM ordens_producao
            ORDER BY
                CASE
                    WHEN status = 'em_producao' THEN 1
                    WHEN status = 'ativa' THEN 2
                    WHEN status = 'pendente' THEN 3
                    WHEN status = 'concluida' THEN 4
                    ELSE 5
                END,
                data_prevista ASC
        `);

        console.log('[API_ORDENS_PRODUCAO] Retornando', rows.length, 'ordens');
        res.json({
            success: true,
            data: rows,
            total: rows.length
        });

    } catch (error) {
        console.error('[API_ORDENS_PRODUCAO] Erro:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar ordens de produção',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Criar nova ordem de produção
app.post('/api/pcp/ordens-producao', authRequired, async (req, res) => {
    console.log('[API_ORDENS_PRODUCAO] Criando nova ordem');
    try {
        const {
            codigo, produto_nome, quantidade, unidade, status,
            prioridade, data_inicio, data_prevista, responsavel, observacoes
        } = req.body;

        const [result] = await db.query(`
            INSERT INTO ordens_producao
            (codigo, produto_nome, quantidade, unidade, status, prioridade,
             data_inicio, data_prevista, responsavel, progresso, observacoes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `, [codigo, produto_nome, quantidade, unidade, status, prioridade,
            data_inicio, data_prevista, responsavel, observacoes]);

        console.log('[API_ORDENS_PRODUCAO] Ordem criada com ID:', result.insertId);
        res.status(201).json({
            success: true,
            message: 'Ordem de produção criada com sucesso',
            id: result.insertId
        });

    } catch (error) {
        console.error('[API_ORDENS_PRODUCAO] Erro ao criar:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao criar ordem de produção',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Atualizar ordem de produção
app.put('/api/pcp/ordens-producao/:id', authRequired, async (req, res) => {
    console.log('[API_ORDENS_PRODUCAO] Atualizando ordem', req.params.id);
    try {
        const { id } = req.params;
        const updates = req.body;

        const allowedFields = [
            'produto_nome', 'quantidade', 'unidade', 'status', 'prioridade',
            'data_inicio', 'data_prevista', 'data_conclusao', 'responsavel',
            'progresso', 'observacoes'
        ];

        const fields = [];
        const values = [];

        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                fields.push(`${key} = ?`);
                values.push(updates[key]);
            }
        });

        if (fields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Nenhum campo válido para atualizar'
            });
        }

        values.push(id);
        await db.query(`
            UPDATE ordens_producao
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = ?
        `, values);

        console.log('[API_ORDENS_PRODUCAO] Ordem atualizada');
        res.json({
            success: true,
            message: 'Ordem de produção atualizada com sucesso'
        });

    } catch (error) {
        console.error('[API_ORDENS_PRODUCAO] Erro ao atualizar:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao atualizar ordem de produção',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// DELETE /api/pcp/ordens-producao/:id
// Exclui da tabela correta (ordens_producao ou ordens_producao_kanban).
// O kanban unifica as duas tabelas via GET /api/pcp/ordens-kanban, então
// o ID pode pertencer a qualquer uma delas.
app.delete('/api/pcp/ordens-producao/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        // 1) Tenta na tabela principal
        const [ordensRows] = await db.query('SELECT id, status FROM ordens_producao WHERE id = ?', [id]);
        if (ordensRows.length > 0) {
            const status = ordensRows[0].status;
            const bloqueados = ['em_producao', 'finalizada', 'concluida', 'armazenado'];
            if (bloqueados.includes(status)) {
                return res.status(400).json({ error: `Não é possível excluir ordem com status "${status}". Apenas ordens pendentes ou canceladas podem ser excluídas.` });
            }
            await db.query('DELETE FROM ordens_producao WHERE id = ?', [id]);
            return res.json({ success: true, message: 'Ordem de produção excluída com sucesso.' });
        }

        // 2) Tenta na tabela kanban
        const [kanbanRows] = await db.query('SELECT id, status FROM ordens_producao_kanban WHERE id = ?', [id]);
        if (kanbanRows.length > 0) {
            await db.query('DELETE FROM ordens_producao_kanban WHERE id = ?', [id]);
            return res.json({ success: true, message: 'Ordem de produção excluída com sucesso.' });
        }

        res.status(404).json({ error: 'Ordem de produção não encontrada.' });
    } catch (error) {
        console.error('[API_ORDENS_PRODUCAO] Erro ao excluir:', error.message);
        res.status(500).json({ error: 'Erro ao excluir ordem de produção.' });
    }
});

// ==================== ROTAS DE FATURAMENTO ====================

// Buscar todos os faturamentos
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/faturamentos', authRequired, async (req, res) => {
    console.log('[API_FATURAMENTOS] Requisição recebida');
    try {
        // Verifica se a tabela existe
        const [tables] = await db.query("SHOW TABLES LIKE 'programacao_faturamento'");

        if (!tables || tables.length === 0) {
            console.log('[API_FATURAMENTOS] Tabela não existe, retornando lista vazia');
            return res.json({
                success: true,
                data: [],
                total: 0,
                message: 'Tabela não criada ainda'
            });
        }

        // Se a tabela existe, busca os dados reais
        const [rows] = await db.query(`
            SELECT
                id, numero, cliente_nome, valor, status, tipo,
                data_programada, data_emissao, numero_nfe, observacoes,
                created_at, updated_at
            FROM programacao_faturamento
            ORDER BY
                CASE
                    WHEN status = 'atrasada' THEN 1
                    WHEN status = 'faturar_hoje' THEN 2
                    WHEN status = 'pendente' THEN 3
                    WHEN status = 'emitida' THEN 4
                    ELSE 5
                END,
                data_programada ASC
        `);

        console.log('[API_FATURAMENTOS] Retornando', rows.length, 'faturamentos');
        res.json({
            success: true,
            data: rows,
            total: rows.length
        });

    } catch (error) {
        console.error('[API_FATURAMENTOS] Erro:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar faturamentos',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Criar novo faturamento
// 🔒 SECURITY AUDIT: Added authRequired - billing operations require authentication
app.post('/api/pcp/faturamentos', authRequired, async (req, res) => {
    console.log('[API_FATURAMENTOS] Criando novo faturamento');
    try {
        const {
            numero, cliente_id, cliente_nome, valor, status, tipo,
            data_programada, data_vencimento, condicoes_pagamento, observacoes
        } = req.body;

        // Validações
        if (!cliente_nome || !valor || !data_programada) {
            return res.status(400).json({
                success: false,
                message: 'Campos obrigatórios: cliente_nome, valor, data_programada'
            });
        }

        // Status padrão: pendente
        const statusFinal = status || 'pendente';

        const [result] = await db.query(`
            INSERT INTO programacao_faturamento
            (numero, cliente_id, cliente_nome, valor, status, tipo, data_programada, data_vencimento, condicoes_pagamento, observacoes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            numero,
            cliente_id || null,
            cliente_nome,
            valor,
            statusFinal,
            tipo || 'nfe',
            data_programada,
            data_vencimento || null,
            condicoes_pagamento || null,
            observacoes || null
        ]);

        console.log('[API_FATURAMENTOS] Faturamento criado com ID:', result.insertId);
        res.status(201).json({
            success: true,
            message: 'Faturamento criado com sucesso',
            id: result.insertId,
            numero: numero
        });

    } catch (error) {
        console.error('[API_FATURAMENTOS] Erro ao criar:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao criar faturamento',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Atualizar faturamento
// 🔒 SECURITY AUDIT: Added authRequired - billing update requires authentication
app.put('/api/pcp/faturamentos/:id', authRequired, async (req, res) => {
    console.log('[API_FATURAMENTOS] Atualizando faturamento', req.params.id);
    try {
        const { id } = req.params;
        const updates = req.body;

        const allowedFields = [
            'cliente_id', 'cliente_nome', 'valor', 'status', 'tipo', 'data_programada',
            'data_vencimento', 'data_emissao', 'numero_nfe', 'condicoes_pagamento', 'observacoes'
        ];

        const fields = [];
        const values = [];

        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                fields.push(`${key} = ?`);
                values.push(updates[key]);
            }
        });

        if (fields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Nenhum campo válido para atualizar'
            });
        }

        values.push(id);
        await db.query(`
            UPDATE programacao_faturamento
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = ?
        `, values);

        console.log('[API_FATURAMENTOS] Faturamento atualizado');
        res.json({
            success: true,
            message: 'Faturamento atualizado com sucesso'
        });

    } catch (error) {
        console.error('[API_FATURAMENTOS] Erro ao atualizar:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao atualizar faturamento',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Criar novo produto
app.post('/api/pcp/produtos', authRequired, async (req, res) => {
    console.log('[CREATE_PRODUCT] Endpoint chamado');
    const {
        codigo, nome, descricao, sku, gtin, variacao, marca,
        categoria, unidade, preco_custo, preco_venda,
        estoque, estoque_minimo, estoque_maximo
    } = req.body;

    try {
        // Validação do GTIN (se fornecido)
        if (gtin && (!/^\d{8,14}$/.test(gtin))) {
            return res.status(400).json({ message: 'GTIN deve conter apenas números (8 a 14 dígitos).' });
        }

        // Require variacao to be an array (or a JSON string that parses to an array).
        let variacaoForDb = null;
        if (typeof variacao === 'undefined' || variacao === null) {
            variacaoForDb = null;
        } else if (Array.isArray(variacao)) {
            variacaoForDb = JSON.stringify(variacao);
        } else if (typeof variacao === 'string') {
            const v = variacao.trim();
            if (v.length === 0) {
                variacaoForDb = null;
            } else {
                try {
                    const parsed = JSON.parse(v);
                    if (!Array.isArray(parsed)) {
                        return res.status(400).json({ message: 'Campo variacao deve ser um array JSON.' });
                    }
                    variacaoForDb = JSON.stringify(parsed);
                } catch (e) {
                    return res.status(400).json({ message: 'Formato de variacao obsoleto. Envie um array JSON (ex: ["A","B"]).' });
                }
            }
        } else {
            return res.status(400).json({ message: 'Campo variacao inválido. Deve ser um array JSON.' });
        }

        // Inserir produto com todos os campos
        const sql = `INSERT INTO produtos
            (codigo, nome, descricao, sku, gtin, variacao, marca, categoria, unidade,
             preco_custo, preco_venda, estoque_atual, estoque_minimo, estoque_maximo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const values = [
            codigo,
            nome || descricao,
            descricao || null,
            sku || null,
            gtin || null,
            variacaoForDb,
            marca || null,
            categoria || null,
            unidade || null,
            preco_custo || 0,
            preco_venda || 0,
            estoque || 0,
            estoque_minimo || 0,
            estoque_maximo || 0
        ];

        const [result] = await db.query(sql, values);

        console.log('[CREATE_PRODUCT] Produto criado com sucesso:', {
            id: result.insertId,
            codigo,
            sku,
            gtin
        });

        res.status(201).json({
            message: 'Produto criado com sucesso',
            id: result.insertId,
            sku: sku,
            gtin: gtin
        });

        if (typeof broadcastProducts === 'function') {
            broadcastProducts();
        }
    } catch (err) {
        console.error('[CREATE_PRODUCT] Erro ao criar produto:', err.message);
        if (err.code === 'ER_DUP_ENTRY') {
            if (err.message.includes('ux_produtos_gtin') || err.message.includes('gtin')) {
                return res.status(400).json({ message: 'GTIN já existe no sistema.' });
            }
            if (err.message.includes('ux_produtos_sku') || err.message.includes('sku')) {
                return res.status(400).json({ message: 'SKU já existe no sistema.' });
            }
            if (err.message.includes('codigo')) {
                return res.status(400).json({ message: 'Código já existe no sistema.' });
            }
        }
        res.status(500).json({ message: 'Erro ao criar produto' + (process.env.NODE_ENV === 'development' ? ': ' + err.message : '') });
    }
});

// Atualizar produto
// 🔐 SECURITY: Added authRequired
app.put('/api/pcp/produtos/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    const {
        codigo, nome, descricao, sku, gtin, variacao, marca,
        categoria, unidade, preco, preco_custo, preco_venda, ncm,
        estoque, estoque_minimo, estoque_maximo, observacoes
    } = req.body;

    console.log('[UPDATE_PRODUCT] Dados recebidos:', { id, codigo, nome, estoque, estoque_minimo, preco, preco_venda });

    try {
        // Validação do GTIN (se fornecido)
        if (gtin && (!/^\d{8,14}$/.test(gtin))) {
            return res.status(400).json({ message: 'GTIN deve conter apenas números (8 a 14 dígitos).' });
        }

        // Require variacao to be an array (or a JSON string that parses to an array).
        let variacaoForDb = null;
        if (typeof variacao === 'undefined' || variacao === null) {
            variacaoForDb = null;
        } else if (Array.isArray(variacao)) {
            variacaoForDb = JSON.stringify(variacao);
        } else if (typeof variacao === 'string') {
            const v = variacao.trim();
            if (v.length === 0) {
                variacaoForDb = null;
            } else {
                try {
                    const parsed = JSON.parse(v);
                    if (!Array.isArray(parsed)) {
                        return res.status(400).json({ message: 'Campo variacao deve ser um array JSON.' });
                    }
                    variacaoForDb = JSON.stringify(parsed);
                } catch (e) {
                    return res.status(400).json({ message: 'Formato de variacao obsoleto. Envie um array JSON (ex: ["A","B"]).' });
                }
            }
        } else {
            return res.status(400).json({ message: 'Campo variacao inválido. Deve ser um array JSON.' });
        }

        // Usar preco_venda se preco não foi fornecido diretamente
        const precoVendaFinal = preco_venda !== undefined ? preco_venda : (preco || 0);
        const estoqueAtualFinal = estoque !== undefined ? estoque : 0;
        const estoqueMinimoFinal = estoque_minimo !== undefined ? estoque_minimo : 0;

        console.log('[UPDATE_PRODUCT] Valores finais:', { precoVendaFinal, estoqueAtualFinal, estoqueMinimoFinal });

        const sql = `UPDATE produtos SET
            codigo = ?,
            nome = ?,
            descricao = ?,
            sku = ?,
            gtin = ?,
            variacao = ?,
            marca = ?,
            categoria = ?,
            unidade_medida = ?,
            ncm = ?,
            preco_custo = ?,
            preco_venda = ?,
            estoque_atual = ?,
            estoque_minimo = ?,
            estoque_maximo = ?,
            observacoes = ?
        WHERE id = ?`;

        const values = [
            codigo,
            nome || descricao,
            descricao || null,
            sku || null,
            gtin || null,
            variacaoForDb,
            marca || null,
            categoria || null,
            unidade || null,
            ncm || null,
            preco_custo || 0,
            precoVendaFinal,
            estoqueAtualFinal,
            estoqueMinimoFinal,
            estoque_maximo || 0,
            observacoes || null,
            id
        ];

        console.log('[UPDATE_PRODUCT] SQL Values:', values);

        const [result] = await db.query(sql, values);

        if (result.affectedRows > 0) {
            console.log('[UPDATE_PRODUCT] ✅ Produto atualizado com sucesso:', { id, codigo, estoque: estoqueAtualFinal, preco: precoVendaFinal });
            res.json({ message: 'Produto atualizado com sucesso' });
            broadcastProducts();
        } else {
            res.status(404).json({ message: 'Produto não encontrado' });
        }
    } catch (err) {
        console.error('[UPDATE_PRODUCT] ❌ Erro ao atualizar produto:', err.message, err.sql);
        if (err.code === 'ER_DUP_ENTRY') {
            if (err.message.includes('ux_produtos_gtin')) {
                return res.status(400).json({ message: 'GTIN já existe no sistema.' });
            }
            if (err.message.includes('ux_produtos_sku')) {
                return res.status(400).json({ message: 'SKU já existe no sistema.' });
            }
            if (err.message.includes('codigo')) {
                return res.status(400).json({ message: 'Código já existe no sistema.' });
            }
        }
        res.status(500).json({ message: 'Erro ao atualizar produto' + (process.env.NODE_ENV === 'development' ? ': ' + err.message : '') });
    }
});

// Excluir produto
// 🔒 SECURITY AUDIT: Added RBAC (ADMIN/SUPERVISOR only), authRequired and audit logging
app.delete('/api/pcp/produtos/:id', authRequired, requireProductionRole('ADMIN', 'SUPERVISOR'), async (req, res) => {
    const { id } = req.params;
    try {
        // Buscar produto antes de excluir para auditoria
        const [produto] = await db.query('SELECT codigo, nome, descricao FROM produtos WHERE id = ?', [id]);

        const [result] = await db.query('DELETE FROM produtos WHERE id = ?', [id]);
        if (result.affectedRows > 0) {
            // Log de auditoria
            await logProductionAudit(db, 'DELETE', 'PRODUTO', id, req.user, {
                produto_codigo: produto[0]?.codigo,
                produto_nome: produto[0]?.nome,
                ip: req.ip
            });
            res.json({ message: 'Produto excluído' });
            broadcastProducts();
        } else {
            res.status(404).json({ message: 'Produto não encontrado' });
        }
    } catch (err) {
        console.error('Erro ao excluir produto:', err.message);
        res.status(500).json({ message: 'Erro ao excluir produto.' });
    }
});

// Rota para gerar catálogo PDF de produtos
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/produtos/catalogo', authRequired, async (req, res) => {
    try {
        console.log('📊 Gerando catálogo de produtos...');

        const [produtos] = await db.query(`
            SELECT id, codigo, nome, descricao, sku, gtin, marca,
                   CASE
                       WHEN variacao IS NOT NULL AND variacao != '' THEN variacao
                       ELSE NULL
                   END as variacao
            FROM produtos
            ORDER BY codigo, nome
        `);

        const agora = new Date();
        const timestamp = agora.toLocaleString('pt-BR');

        const catalogoData = {
            timestamp,
            totalProdutos: produtos.length,
            prefixoEmpresa: '78968192',
            padrao: 'EAN-13',
            produtos: produtos.map(p => ({
                id: p.id,
                codigo: p.codigo,
                nome: p.nome,
                gtin: p.gtin,
                sku: p.sku,
                marca: p.marca || 'Aluforce',
                descricao: p.descricao
            }))
        };

        res.json(catalogoData);
    } catch (error) {
        console.error('Erro ao gerar catálogo:', error);
        res.status(500).json({ message: 'Erro ao gerar catálogo' });
    }
});

// Rota para download do catálogo em CSV
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/produtos/catalogo/csv', authRequired, async (req, res) => {
    try {
        const [produtos] = await db.query(`
            SELECT id, codigo, nome, descricao, sku, gtin, marca
            FROM produtos
            ORDER BY codigo, nome
        `);

        const csvContent = [
            'ID,Código,Nome,GTIN,SKU,Marca,Descrição',
            ...produtos.map(p => {
                const nome = (p.nome || '').replace(/"/g, '""').replace(/\?/g, '²');
                const desc = (p.descricao || '').replace(/"/g, '""').replace(/\?/g, '²');
                return `${p.id},"${p.codigo}","${nome}","${p.gtin}","${p.sku || ''}","${p.marca || 'Aluforce'}","${desc}"`;
            })
        ].join('');

        const agora = new Date();
        const filename = `catalogo_produtos_gtin_${agora.getFullYear()}_${(agora.getMonth()+1).toString().padStart(2,'0')}_${agora.getDate().toString().padStart(2,'0')}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\ufeff' + csvContent); // BOM para UTF-8
    } catch (error) {
        console.error('Erro ao gerar CSV:', error);
        res.status(500).json({ message: 'Erro ao gerar CSV' });
    }
});

// Rota para exportar produtos em PDF
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/produtos/export-pdf', authRequired, async (req, res) => {
    try {
        // Retorna o arquivo HTML do catálogo que pode ser convertido para PDF pelo cliente
        const catalogoPath = path.join(__dirname, 'catalogo_produtos_gtin_2025_10_06.html');

        if (fs.existsSync(catalogoPath)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', 'inline; filename="catalogo_produtos.html"');
            res.sendFile(catalogoPath);
        } else {
            // Gerar catálogo se não existir
            const { exec } = require('child_process');
            exec('node gerar_catalogo_pdf.js', (error, stdout, stderr) => {
                if (error) {
                    console.error('Erro ao gerar catálogo:', error);
                    res.status(500).json({ message: 'Erro ao gerar catálogo PDF' });
                } else {
                    res.sendFile(catalogoPath);
                }
            });
        }
    } catch (error) {
        console.error('Erro ao exportar PDF:', error);
        res.status(500).json({ message: 'Erro ao exportar PDF' });
    }
});

// Rota para exportar materiais para PDF
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/materiais/export-pdf', authRequired, async (req, res) => {
    try {
        const catalogoPath = path.join(__dirname, 'catalogo_materiais_' + new Date().toISOString().split('T')[0] + '.html');

        // Verificar se o arquivo já existe
        if (fs.existsSync(catalogoPath)) {
            res.sendFile(catalogoPath);
        } else {
            // Gerar catálogo de materiais
            const { exec } = require('child_process');
            exec('node gerar_catalogo_materiais.js', (error, stdout, stderr) => {
                if (error) {
                    console.error('Erro ao gerar catálogo de materiais:', error);
                    // Fallback: gerar catálogo simples
                    gerarCatalogoMateriais()
                        .then(() => res.sendFile(catalogoPath))
                        .catch(err => {
                            console.error('Erro no fallback:', err);
                            res.status(500).json({ message: 'Erro ao gerar catálogo de materiais' });
                        });
                } else {
                    res.sendFile(catalogoPath);
                }
            });
        }
    } catch (error) {
        console.error('Erro ao exportar PDF de materiais:', error);
        res.status(500).json({ message: 'Erro ao exportar PDF de materiais' });
    }
});

// Função para gerar catálogo de materiais (fallback)
async function gerarCatalogoMateriais() {
    try {
        const [materiais] = await db.query('SELECT * FROM materiais ORDER BY codigo');

        const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Catálogo de Materiais - Aluforce</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #7c3aed; padding-bottom: 20px; }
        .logo { color: #7c3aed; font-size: 28px; font-weight: bold; }
        .subtitle { color: #666; margin-top: 5px; }
        .material-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .material-card { border: 1px solid #ddd; border-radius: 8px; padding: 15px; background: #f9f9f9; }
        .material-codigo { font-weight: bold; color: #7c3aed; font-size: 16px; }
        .material-descricao { margin: 8px 0; font-size: 14px; }
        .material-info { font-size: 12px; color: #666; margin: 4px 0; }
        .estoque-status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
        .estoque-ok { background: #d1fae5; color: #065f46; }
        .estoque-baixo { background: #fef3c7; color: #92400e; }
        .estoque-critico { background: #fee2e2; color: #991b1b; }
        .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #ddd; padding-top: 20px; }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">ALUFORCE</div>
        <div class="subtitle">Catálogo de Materiais - ${new Date().toLocaleDateString('pt-BR')}</div>
        <div style="margin-top: 10px; font-size: 14px; color: #666;">
            Total de Materiais: ${materiais.length}
        </div>
    </div>

    <div class="material-grid">
        ${materiais.map(material => {
            const estoqueAtual = material.estoque_atual || 0;
            const estoqueMinimo = material.estoque_minimo || 0;
            let estoqueClass = 'estoque-ok';
            let estoqueText = 'Normal';

            if (estoqueAtual <= 0) {
                estoqueClass = 'estoque-critico';
                estoqueText = 'Sem Estoque';
            } else if (estoqueAtual <= estoqueMinimo) {
                estoqueClass = 'estoque-baixo';
                estoqueText = 'Estoque Baixo';
            }

            return `
            <div class="material-card">
                <div class="material-codigo">${material.codigo || 'N/A'}</div>
                <div class="material-descricao">${material.descricao || 'Sem descrição'}</div>
                <div class="material-info">Categoria: ${material.categoria || 'N/A'}</div>
                <div class="material-info">Tipo: ${material.tipo || 'N/A'}</div>
                <div class="material-info">Unidade: ${material.unidade || 'UN'}</div>
                <div class="material-info">
                    Estoque: ${estoqueAtual} ${material.unidade || 'UN'}
                    <span class="estoque-status ${estoqueClass}">${estoqueText}</span>
                </div>
                ${material.custo ? `<div class="material-info">Custo: R$ ${parseFloat(material.custo).toFixed(2)}</div>` : ''}
                ${material.fornecedor ? `<div class="material-info">Fornecedor: ${material.fornecedor}</div>` : ''}
                ${material.localizacao ? `<div class="material-info">Localização: ${material.localizacao}</div>` : ''}
            </div>`;
        }).join('')}
    </div>

    <div class="footer">
        <div>Catálogo gerado automaticamente pelo Sistema PCP Aluforce</div>
        <div>Data: ${new Date().toLocaleString('pt-BR')}</div>
    </div>
</body>
</html>`;

        const catalogoPath = path.join(__dirname, 'catalogo_materiais_' + new Date().toISOString().split('T')[0] + '.html');
        fs.writeFileSync(catalogoPath, html, 'utf8');

        console.log('Catálogo de materiais gerado:', catalogoPath);

    } catch (error) {
        console.error('Erro ao gerar catálogo de materiais:', error);
        throw error;
    }
}

// Rota para buscar um material por id
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/materiais/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query("SELECT * FROM materiais WHERE id = ?", [id]);
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).json({ message: 'Material não encontrado.' });
        }
    } catch (error) {
        console.error('Erro ao buscar material por id:', error.message);
        res.status(500).json({ message: 'Erro ao buscar material.' });
    }
});

// Rota para excluir um material
// 🔒 SECURITY AUDIT: Added RBAC (ADMIN/SUPERVISOR only), authRequired and audit logging
app.delete('/api/pcp/materiais/:id', authRequired, requireProductionRole('ADMIN', 'SUPERVISOR'), async (req, res) => {
    const { id } = req.params;
    try {
        // Buscar material antes de excluir para auditoria
        const [material] = await db.query('SELECT codigo_material, descricao FROM materiais WHERE id = ?', [id]);

        const [result] = await db.query('DELETE FROM materiais WHERE id = ?', [id]);
        if (result.affectedRows > 0) {
            // Log de auditoria
            await logProductionAudit(db, 'DELETE', 'MATERIAL', id, req.user, {
                material_codigo: material[0]?.codigo_material,
                material_descricao: material[0]?.descricao,
                ip: req.ip
            });
            res.json({ message: 'Material excluído com sucesso.' });
            broadcastMaterials();
        } else {
            res.status(404).json({ message: 'Material não encontrado.' });
        }
    } catch (error) {
        console.error('Erro ao excluir material:', error.message);
        res.status(500).json({ message: 'Erro ao excluir material.' });
    }
});

// =====================================================
// ROTAS DE MATÉRIAS-PRIMAS (compatibilidade com frontend)
// =====================================================

// Buscar matéria-prima por ID (alias para materiais)
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/materias-primas/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(`
            SELECT m.*,
                   m.quantidade_estoque as quantidade_atual,
                   m.codigo_material as codigo,
                   m.descricao as nome
            FROM materiais m
            WHERE m.id = ?
        `, [id]);
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).json({ error: 'Matéria-prima não encontrada' });
        }
    } catch (error) {
        console.error('Erro ao buscar matéria-prima:', error);
        res.status(500).json({ error: 'Erro ao buscar matéria-prima' });
    }
});

// Registrar SAÍDA de matéria-prima (baixa de material)
app.post('/api/pcp/materias-primas/:id/saida', authRequired, async (req, res) => {
    const { id } = req.params;
    const { quantidade, destino, documento, observacao, usuario_nome } = req.body;

    try {
        // Buscar material atual
        const [material] = await db.query(`
            SELECT id, codigo_material, descricao, quantidade_estoque, unidade_medida
            FROM materiais WHERE id = ?
        `, [id]);

        if (!material || material.length === 0) {
            return res.status(404).json({ error: 'Material não encontrado' });
        }

        const mat = material[0];
        const qtdAtual = parseFloat(mat.quantidade_estoque) || 0;
        const qtdSaida = parseFloat(quantidade);

        if (qtdSaida <= 0) {
            return res.status(400).json({ error: 'Quantidade deve ser maior que zero' });
        }

        if (qtdSaida > qtdAtual) {
            return res.status(400).json({ error: `Estoque insuficiente. Disponível: ${qtdAtual} ${mat.unidade_medida || 'UN'}` });
        }

        const novaQtd = qtdAtual - qtdSaida;

        // CHAOS-FIX LC-003: Use dedicated connection for transaction safety
        const txConn = await db.getConnection();
        try {
            await txConn.beginTransaction();

            // Atualizar estoque do material
            await txConn.query('UPDATE materiais SET quantidade_estoque = ? WHERE id = ?', [novaQtd, id]);

            // Registrar movimentação
            await txConn.query(`
                INSERT INTO movimentacoes_estoque
                (material_id, tipo, quantidade, quantidade_anterior, quantidade_atual, observacoes, local, documento, usuario_id, criado_em)
                VALUES (?, 'SAIDA', ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [id, qtdSaida, qtdAtual, novaQtd, observacao || `Baixa para ${destino || 'Produção'}`, destino || 'PRODUCAO', documento || null, req.user?.id || 1]);

            await txConn.commit();
        } catch (txErr) {
            try { await txConn.rollback(); } catch(e) {}
            throw txErr;
        } finally {
            txConn.release();
        }

        // Notificação de estoque baixo
        if (novaQtd <= 10) {
            try {
                await db.query(`
                    INSERT INTO notificacoes (titulo, mensagem, tipo, modulo, link, usuario_id, lida, created_at)
                    VALUES (?, ?, 'warning', 'PCP', '/modules/PCP/index.html#materiais', NULL, 0, NOW())
                `, [
                    '⚠️ Estoque Baixo de Material',
                    `O material "${mat.descricao || mat.codigo_material}" está com apenas ${novaQtd.toFixed(2)} ${mat.unidade_medida || 'UN'} em estoque.`
                ]);
            } catch (e) { console.error('Erro notificação:', e.message); }
        }

        console.log(`[PCP] Saída registrada: ${mat.codigo_material} - ${qtdSaida} ${mat.unidade_medida || 'UN'} | Novo estoque: ${novaQtd}`);

        res.json({
            success: true,
            message: 'Baixa registrada com sucesso',
            quantidade_anterior: qtdAtual,
            quantidade_atual: novaQtd,
            material: mat.descricao || mat.codigo_material
        });

        // Enviar notificação por email para PCP
        enviarNotificacaoPCP('SAIDA_MATERIAL', {
            codigo: mat.codigo_material,
            descricao: mat.descricao,
            quantidade: qtdSaida,
            unidade: mat.unidade_medida || 'UN',
            estoque_anterior: qtdAtual,
            estoque_atual: novaQtd,
            destino: destino,
            observacao: observacao
        }).catch(err => console.error('[PCP_EMAIL] Erro:', err.message));

        // Alerta de estoque baixo por email
        if (novaQtd <= 10) {
            enviarNotificacaoPCP('ESTOQUE_BAIXO', {
                codigo: mat.codigo_material,
                descricao: mat.descricao,
                estoque_atual: novaQtd,
                unidade: mat.unidade_medida || 'UN'
            }).catch(err => console.error('[PCP_EMAIL] Erro estoque baixo:', err.message));
        }

        // Broadcast de atualização em tempo real
        if (typeof broadcastMaterials === 'function') broadcastMaterials();
        io.emit('estoque-atualizado', {
            tipo: 'SAIDA',
            item_id: id,
            tabela: 'materiais',
            quantidade_anterior: qtdAtual,
            quantidade_atual: novaQtd
        });

    } catch (error) {
        // CHAOS-FIX LC-003: Rollback handled in inner try-catch-finally
        console.error('Erro ao registrar saída:', error);
        res.status(500).json({ error: 'Erro ao registrar saída de material' });
    }
});

// Registrar ENTRADA de matéria-prima
app.post('/api/pcp/materias-primas/:id/entrada', authRequired, async (req, res) => {
    const { id } = req.params;
    const { quantidade, origem, documento, observacao, usuario_nome } = req.body;

    try {
        // Buscar material atual
        const [material] = await db.query(`
            SELECT id, codigo_material, descricao, quantidade_estoque, unidade_medida
            FROM materiais WHERE id = ?
        `, [id]);

        if (!material || material.length === 0) {
            return res.status(404).json({ error: 'Material não encontrado' });
        }

        const mat = material[0];
        const qtdAtual = parseFloat(mat.quantidade_estoque) || 0;
        const qtdEntrada = parseFloat(quantidade);

        if (qtdEntrada <= 0) {
            return res.status(400).json({ error: 'Quantidade deve ser maior que zero' });
        }

        const novaQtd = qtdAtual + qtdEntrada;

        // CHAOS-FIX LC-003: Use dedicated connection for transaction safety
        const txConn = await db.getConnection();
        try {
            await txConn.beginTransaction();

            // Atualizar estoque do material
            await txConn.query('UPDATE materiais SET quantidade_estoque = ? WHERE id = ?', [novaQtd, id]);

            // Registrar movimentação
            await txConn.query(`
                INSERT INTO movimentacoes_estoque
                (material_id, tipo, quantidade, quantidade_anterior, quantidade_atual, observacoes, local, documento, usuario_id, criado_em)
                VALUES (?, 'ENTRADA', ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [id, qtdEntrada, qtdAtual, novaQtd, observacao || `Entrada de ${origem || 'Compra'}`, origem || 'COMPRA', documento || null, req.user?.id || 1]);

            await txConn.commit();
        } catch (txErr) {
            try { await txConn.rollback(); } catch(e) {}
            throw txErr;
        } finally {
            txConn.release();
        }

        // Notificação de entrada
        try {
            await db.query(`
                INSERT INTO notificacoes (titulo, mensagem, tipo, modulo, link, usuario_id, lida, created_at)
                VALUES (?, ?, 'success', 'PCP', '/modules/PCP/index.html#materiais', NULL, 0, NOW())
            `, [
                '📦 Nova Entrada de Material',
                `O material "${mat.descricao || mat.codigo_material}" recebeu entrada de ${qtdEntrada.toFixed(2)} ${mat.unidade_medida || 'UN'}. Estoque atual: ${novaQtd.toFixed(2)}`
            ]);
        } catch (e) { console.error('Erro notificação:', e.message); }

        console.log(`[PCP] Entrada registrada: ${mat.codigo_material} - ${qtdEntrada} ${mat.unidade_medida || 'UN'} | Novo estoque: ${novaQtd}`);

        res.json({
            success: true,
            message: 'Entrada registrada com sucesso',
            quantidade_anterior: qtdAtual,
            quantidade_atual: novaQtd,
            material: mat.descricao || mat.codigo_material
        });

        // Enviar notificação por email para PCP
        enviarNotificacaoPCP('ENTRADA_MATERIAL', {
            codigo: mat.codigo_material,
            descricao: mat.descricao,
            quantidade: qtdEntrada,
            unidade: mat.unidade_medida || 'UN',
            estoque_anterior: qtdAtual,
            estoque_atual: novaQtd,
            origem: origem,
            observacao: observacao
        }).catch(err => console.error('[PCP_EMAIL] Erro:', err.message));

        // Broadcast de atualização em tempo real
        if (typeof broadcastMaterials === 'function') broadcastMaterials();
        io.emit('estoque-atualizado', {
            tipo: 'ENTRADA',
            item_id: id,
            tabela: 'materiais',
            quantidade_anterior: qtdAtual,
            quantidade_atual: novaQtd
        });

    } catch (error) {
        // CHAOS-FIX LC-003: Rollback handled in inner try-catch-finally
        console.error('Erro ao registrar entrada:', error);
        res.status(500).json({ error: 'Erro ao registrar entrada de material' });
    }
});

// Buscar histórico de movimentações de matéria-prima
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/materias-primas/:id/movimentacoes', authRequired, async (req, res) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    try {
        const [movimentacoes] = await db.query(`
            SELECT
                me.id,
                me.tipo as tipo_movimentacao,
                me.quantidade,
                me.quantidade_anterior,
                me.quantidade_atual,
                me.observacoes as observacao,
                me.local as modulo_origem,
                me.documento,
                me.criado_em as created_at,
                u.nome as usuario_nome
            FROM movimentacoes_estoque me
            LEFT JOIN usuarios u ON me.usuario_id = u.id
            WHERE me.material_id = ?
            ORDER BY me.criado_em DESC
            LIMIT ?
        `, [id, limit]);

        res.json(movimentacoes || []);

    } catch (error) {
        console.error('Erro ao buscar movimentações:', error);
        res.status(500).json({ error: 'Erro ao buscar movimentações' });
    }
});

// Rota para atualizar um material (incluindo estoque)
// 🔐 SECURITY: Added authRequired
app.put('/api/pcp/materiais/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    const { descricao, unidade_medida, quantidade_estoque, fornecedor_padrao } = req.body;
    try {
        const sql = "UPDATE materiais SET descricao = ?, unidade_medida = ?, quantidade_estoque = ?, fornecedor_padrao = ? WHERE id = ?";
        const [result] = await db.query(sql, [descricao, unidade_medida, quantidade_estoque, fornecedor_padrao, id]);
        if (result.affectedRows > 0) {
            res.json({ message: "Material atualizado com sucesso!" });
            broadcastMaterials();
        } else {
            res.status(404).json({ message: "Material não encontrado." });
        }
    } catch (error) {
        console.error("Erro ao atualizar material:", error);
        res.status(500).json({ message: "Erro ao atualizar material." });
    }
});


// --- NOVAS ROTAS PARA ORDENS DE COMPRA ---

// Rota para criar nova Ordem de Compra (INTEGRADA COM MÓDULO COMPRAS)
app.post('/api/pcp/ordens-compra', authRequired, async (req, res) => {
    const { material_id, quantidade, previsao_entrega, fornecedor_id } = req.body;

    // Iniciar transação para garantir consistência
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Buscar informações do material
        const [materialInfo] = await connection.query(
            'SELECT codigo_material, descricao, preco_unitario FROM materiais WHERE id = ?',
            [material_id]
        );

        const material = materialInfo[0] || {};
        const precoUnitario = parseFloat(material.preco_unitario) || 0;
        const valorTotal = precoUnitario * parseFloat(quantidade);

        // 2. Inserir na tabela ordens_compra (PCP)
        const sqlOC = "INSERT INTO ordens_compra (material_id, quantidade, data_pedido, previsao_entrega, status) VALUES (?, ?, CURDATE(), ?, 'Pendente')";
        const [resultOC] = await connection.query(sqlOC, [material_id, quantidade, previsao_entrega]);
        const ordemCompraId = resultOC.insertId;

        // 3. Gerar número do pedido para Compras
        const numeroPedido = `OC-PCP-${String(ordemCompraId).padStart(6, '0')}`;

        // 4. Definir status baseado na existência de fornecedor
        // Sem fornecedor = "aguardando_cotacao" (Compras precisa cotar)
        // Com fornecedor = "pendente" (pronto para aprovar)
        const statusCompra = fornecedor_id ? 'pendente' : 'aguardando_cotacao';

        // 5. INTEGRAÇÃO: Inserir também na tabela pedidos_compra (módulo Compras)
        try {
            const sqlPedidoCompra = `
                INSERT INTO pedidos_compra (
                    numero_pedido, fornecedor_id, data_pedido, data_entrega_prevista,
                    valor_total, valor_final, observacoes, status, origem, ordem_compra_pcp_id
                ) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, 'PCP', ?)
            `;

            // Montar observação informativa
            let observacao = `Solicitação de Compra do PCP\n`;
            observacao += `Material: ${material.codigo_material || 'N/A'} - ${material.descricao || 'N/A'}\n`;
            observacao += `Quantidade: ${quantidade}\n`;
            if (!fornecedor_id) {
                observacao += `⚠️ ATENÇÃO: Fornecedor não definido - Favor realizar cotação`;
            }

            const [resultPedido] = await connection.query(sqlPedidoCompra, [
                numeroPedido,
                fornecedor_id || null,
                previsao_entrega,
                valorTotal,
                valorTotal,
                observacao,
                statusCompra,
                ordemCompraId
            ]);

            const pedidoCompraId = resultPedido.insertId;

            // 6. Inserir item do pedido na tabela de itens
            if (pedidoCompraId) {
                try {
                    await connection.query(`
                        INSERT INTO itens_pedido (
                            pedido_id, codigo_produto, descricao, quantidade, unidade,
                            preco_unitario, preco_total, observacoes
                        ) VALUES (?, ?, ?, ?, 'UN', ?, ?, ?)
                    `, [
                        pedidoCompraId,
                        material.codigo_material || `MAT-${material_id}`,
                        material.descricao || 'Material',
                        quantidade,
                        precoUnitario,
                        valorTotal,
                        fornecedor_id ? 'Item da Ordem de Compra PCP' : 'Aguardando cotação de fornecedor'
                    ]);
                } catch (itemErr) {
                    console.log('[PCP] Tabela itens_pedido não disponível:', itemErr.message);
                }
            }

            const msgStatus = fornecedor_id ? 'pendente de aprovação' : 'aguardando cotação';
            console.log(`[PCP] ✅ OC #${ordemCompraId} integrada com Compras - Pedido #${pedidoCompraId} (${msgStatus})`);
        } catch (integracaoErr) {
            // Se falhar a integração, apenas log - não impede criação da OC
            console.warn('[PCP] ⚠️ Integração com Compras falhou (tabela pode não existir):', integracaoErr.message);
        }

        // 7. Ajustar estoque do material (opcional - comentar se não quiser)
        // try {
        //     await connection.query(
        //         "UPDATE materiais SET quantidade_estoque = quantidade_estoque - ? WHERE id = ?",
        //         [quantidade, material_id]
        //     );
        // } catch (err) {
        //     console.error('Erro ao ajustar estoque após ordem de compra:', err.message);
        // }

        await connection.commit();

        res.status(201).json({
            message: fornecedor_id
                ? "Ordem de compra criada e enviada para aprovação!"
                : "Solicitação de compra criada! Compras irá realizar cotação.",
            id: ordemCompraId,
            numero_pedido: numeroPedido,
            integrado_compras: true,
            aguardando_cotacao: !fornecedor_id
        });

        broadcastMaterials();
    } catch (error) {
        await connection.rollback();
        console.error("Erro ao criar ordem de compra:", error);
        res.status(500).json({ message: "Erro ao criar ordem de compra." });
    } finally {
        connection.release();
    }
});

// Endpoints para a tabela `pedidos` (se existir) - listar/criar/atualizar
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/pedidos', authRequired, async (req, res) => {
    try {
        // Support pagination: ?page=1&limit=10
        let page = parseInt(req.query.page, 10) || 1;
        let limit = parseInt(req.query.limit, 10) || 10;
        if (page < 1) page = 1;
        if (limit < 1) limit = 10;
        const offset = (page - 1) * limit;

        // Prefer to return joined client/company info when available so frontend can display names
        const sql = `SELECT p.*, c.nome AS cliente_nome, c.email AS cliente_email, e.cnpj AS empresa_cnpj, e.razao_social AS empresa_razao, e.nome_fantasia AS empresa_nome
                     FROM pedidos p
                     LEFT JOIN clientes c ON p.cliente_id = c.id
                     LEFT JOIN empresas e ON p.empresa_id = e.id
                     ORDER BY p.created_at DESC, p.id DESC
                     LIMIT ? OFFSET ?`;

        const [rows] = await db.query(sql, [limit, offset]);

        // Normalize produtos_preview if stored as JSON string
        const normalized = (rows || []).map(r => {
            try {
                if (r && r.produtos_preview && typeof r.produtos_preview === 'string') {
                    r.produtos_preview = JSON.parse(r.produtos_preview);
                }
            } catch (e) { /* ignore */ }
            return r;
        });

        res.json({ page, limit, rows: normalized });
    } catch (err) {
        console.error('Erro ao buscar pedidos:', err && err.message ? err.message : err);
        // Return empty array so frontend can continue working even if table layout differs
        res.json([]);
    }
});

// Return only approved / billed orders (flexible matching on status)
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/pedidos/faturados', authRequired, async (req, res) => {
    try {
    // support pagination: ?page=1&limit=50
    let page = parseInt(req.query.page,10) || 1;
    let limit = parseInt(req.query.limit,10) || 50;
    if (page < 1) page = 1;
    if (limit < 1) limit = 50;
    const offset = (page - 1) * limit;
    const sql = `SELECT id, valor, descricao, status, created_at, data_prevista, prazo_entrega, cliente_id, empresa_id, produtos_preview, endereco_entrega, municipio_entrega FROM pedidos WHERE (status LIKE '%fatur%' OR status LIKE '%entreg%' OR status LIKE '%aprov%') ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const [rows] = await db.query(sql, [limit, offset]);
        // produtos_preview may be stored as JSON string; attempt to parse for clients
        const normalized = (rows || []).map(r => {
            try { if (r.produtos_preview && typeof r.produtos_preview === 'string') r.produtos_preview = JSON.parse(r.produtos_preview); } catch (e) {}
            return r;
        });
    // total count for pagination
    const [countRows] = await db.query("SELECT COUNT(*) AS total FROM pedidos WHERE (status LIKE '%fatur%' OR status LIKE '%entreg%' OR status LIKE '%aprov%')");
    const total = countRows && countRows[0] ? countRows[0].total : 0;
    res.json({ page, limit, total, rows: normalized });
    } catch (err) {
        console.error('Erro ao buscar pedidos faturados:', err && err.message ? err.message : err);
        res.json([]);
    }
});

// Return delivery deadlines (prazos) for billed orders (one row per pedido)
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/pedidos/prazos', authRequired, async (req, res) => {
    try {
    let page = parseInt(req.query.page,10) || 1;
    let limit = parseInt(req.query.limit,10) || 50;
    if (page < 1) page = 1; if (limit < 1) limit = 50;
    const offset = (page - 1) * limit;
    const sql = `SELECT id, cliente_id, descricao, status, created_at, data_prevista, prazo_entrega, produtos_preview, endereco_entrega FROM pedidos WHERE (status LIKE '%fatur%' OR status LIKE '%entreg%' OR status LIKE '%aprov%') ORDER BY data_prevista IS NULL, data_prevista ASC LIMIT ? OFFSET ?`;
    const [rows] = await db.query(sql, [limit, offset]);
    const normalized = (rows || []).map(r => { try { if (r.produtos_preview && typeof r.produtos_preview === 'string') r.produtos_preview = JSON.parse(r.produtos_preview); } catch(e){} return r; });
    const [countRows] = await db.query("SELECT COUNT(*) AS total FROM pedidos WHERE (status LIKE '%fatur%' OR status LIKE '%entreg%' OR status LIKE '%aprov%')");
    const total = countRows && countRows[0] ? countRows[0].total : 0;
    res.json({ page, limit, total, rows: normalized });
    } catch (err) {
        console.error('Erro ao buscar prazos de pedidos:', err && err.message ? err.message : err);
        res.json([]);
    }
});

// Aggregated acompanhamento endpoint to show recent vendas/pedidos and totals
// 🔐 SECURITY: Added authRequired
app.get('/api/pcp/acompanhamento', authRequired, async (req, res) => {
    try {
        // totals and recent pedidos
    const [totalsRows] = await db.query('SELECT COUNT(*) AS total_pedidos FROM pedidos');
    const totals = totalsRows && totalsRows[0] ? totalsRows[0] : { total_pedidos: 0 };
    const [recent] = await db.query(`SELECT id, descricao, status, created_at, produtos_preview, data_prevista FROM pedidos ORDER BY created_at DESC LIMIT 20`);
    const normalized = (recent || []).map(r => { try { if (r.produtos_preview && typeof r.produtos_preview === 'string') r.produtos_preview = JSON.parse(r.produtos_preview); } catch(e){} return r; });
    res.json({ totals, recentPedidos: normalized });
    } catch (err) {
        console.error('Erro no acompanhamento:', err && err.message ? err.message : err);
        res.status(500).json({ totals: { total_pedidos: 0 }, recentPedidos: [] });
    }
});

// 🔒 SECURITY AUDIT: Added authRequired - order creation requires authentication
app.post('/api/pcp/pedidos', authRequired, async (req, res) => {
    const { cliente, produto_id, quantidade, status } = req.body;
    try {
        const [result] = await db.query('INSERT INTO pedidos (cliente, produto_id, quantidade, data_pedido, status) VALUES (?, ?, ?, CURDATE(), ?)', [cliente, produto_id, quantidade, status || 'Pendente']);
        res.status(201).json({ message: 'Pedido criado', id: result.insertId });
        // atualizar materiais se necessário
        broadcastMaterials();
    } catch (err) {
        console.error('Erro ao criar pedido:', err.message);
        res.status(500).json({ message: 'Erro ao criar pedido.' });
    }
});

// 🔒 SECURITY AUDIT: Added authRequired - order update requires authentication
app.put('/api/pcp/pedidos/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const [result] = await db.query('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
        if (result.affectedRows > 0) {
            res.json({ message: 'Pedido atualizado' });
            broadcastMaterials();
        } else {
            res.status(404).json({ message: 'Pedido não encontrado' });
        }
    } catch (err) {
        console.error('Erro ao atualizar pedido:', err.message);
        res.status(500).json({ message: 'Erro ao atualizar pedido.' });
    }
});

// Rota para buscar todas as Ordens de Compra
app.get('/api/pcp/ordens-compra', authRequired, async (req, res) => {
    const sql = `
        SELECT oc.id, m.codigo_material, m.descricao, oc.quantidade, oc.data_pedido, oc.previsao_entrega, oc.status
        FROM ordens_compra oc
        JOIN materiais m ON oc.material_id = m.id
        ORDER BY oc.data_pedido DESC
    `;
    try {
        const [rows] = await db.query(sql);
        res.json(rows);
    } catch (error) {
        console.error("Erro ao buscar ordens de compra:", error);
        res.status(500).json({ message: "Erro ao buscar ordens de compra." });
    }
});

// Buscar ordem de compra específica por ID
app.get('/api/pcp/ordens-compra/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(`
            SELECT oc.*, m.codigo_material, m.descricao, m.unidade_medida
            FROM ordens_compra oc
            JOIN materiais m ON oc.material_id = m.id
            WHERE oc.id = ?
            LIMIT 1
        `, [id]);

        if (!rows || rows.length === 0) {
            return res.status(404).json({ message: 'Ordem de compra não encontrada' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error("Erro ao buscar ordem de compra:", error);
        res.status(500).json({ message: "Erro ao buscar ordem de compra." });
    }
});

// Atualizar ordem de compra
app.put('/api/pcp/ordens-compra/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    const { quantidade, previsao_entrega, observacoes, status } = req.body;
    try {
        const updates = [];
        const values = [];

        if (quantidade !== undefined) { updates.push('quantidade = ?'); values.push(quantidade); }
        if (previsao_entrega !== undefined) { updates.push('previsao_entrega = ?'); values.push(previsao_entrega); }
        if (observacoes !== undefined) { updates.push('observacoes = ?'); values.push(observacoes); }
        if (status !== undefined) { updates.push('status = ?'); values.push(status); }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'Nenhum campo para atualizar' });
        }

        values.push(id);
        await db.query(`UPDATE ordens_compra SET ${updates.join(', ')} WHERE id = ?`, values);
        res.json({ success: true, message: 'Ordem de compra atualizada' });
    } catch (error) {
        console.error("Erro ao atualizar ordem de compra:", error);
        res.status(500).json({ message: "Erro ao atualizar ordem de compra." });
    }
});

// Excluir ordem de compra
app.delete('/api/pcp/ordens-compra/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM ordens_compra WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Ordem de compra não encontrada' });
        }
        res.json({ success: true, message: 'Ordem de compra excluída' });
    } catch (error) {
        console.error("Erro ao excluir ordem de compra:", error);
        res.status(500).json({ message: "Erro ao excluir ordem de compra." });
    }
});

// Gerar PDF para uma ordem de compra específica
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/ordens-compra/:id/pdf', authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        // fetch order with material details
        const [rows] = await db.query(
            `SELECT oc.id, oc.quantidade, oc.data_pedido, oc.previsao_entrega, oc.status, m.codigo_material, m.descricao as material_descricao, m.unidade_medida
             FROM ordens_compra oc
             JOIN materiais m ON oc.material_id = m.id
             WHERE oc.id = ? LIMIT 1`, [id]
        );
        if (!rows || rows.length === 0) return res.status(404).json({ message: 'Ordem de compra não encontrada' });
        const ord = rows[0];

        // Lazy load PDFKit
        let PDFDocument;
        try { PDFDocument = require('pdfkit'); } catch (e) { return res.status(500).json({ message: 'Dependência pdfkit não instalada' }); }

        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="ordem_compra_${ord.id}.pdf"`);
        doc.fontSize(16).text('Ordem de Compra', { align: 'center' });
        doc.moveDown();
        doc.fontSize(11).text(`Número: ${ord.id}`);
        doc.text(`Data do Pedido: ${ord.data_pedido ? ord.data_pedido.toISOString().slice(0,10) : ord.data_pedido}`);
        doc.text(`Previsão de Entrega: ${ord.previsao_entrega ? ord.previsao_entrega.toISOString().slice(0,10) : ord.previsao_entrega}`);
        doc.moveDown();
        doc.fontSize(12).text('Material:', { underline: true });
        doc.fontSize(11).text(`Código: ${ord.codigo_material}`);
        doc.text(`Descrição: ${ord.material_descricao}`);
        doc.text(`Unidade: ${ord.unidade_medida || ''}`);
        doc.text(`Quantidade: ${ord.quantidade}`);
        doc.moveDown();
        doc.text('Status: ' + (ord.status || 'Pendente'));

    // Pipe the document to the response before finalizing the PDF stream
    doc.pipe(res);
    doc.end();
    } catch (err) {
        console.error('Erro ao gerar PDF da ordem de compra:', err && err.message ? err.message : err);
        res.status(500).json({ message: 'Erro ao gerar PDF.' });
    }
});

// Gerar Excel para ordem de compra específica
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/ordens-compra/:id/excel', authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        // Lazy load ExcelJS
        let ExcelJS;
        try { ExcelJS = require('exceljs'); } catch (e) { return res.status(500).json({ message: 'Dependência exceljs não instalada' }); }

        // fetch order with material details
        const [rows] = await db.query(
            `SELECT oc.id, oc.quantidade, oc.data_pedido, oc.previsao_entrega, oc.status,
             m.codigo_material, m.descricao as material_descricao, m.unidade_medida
             FROM ordens_compra oc
             JOIN materiais m ON oc.material_id = m.id
             WHERE oc.id = ? LIMIT 1`, [id]
        );
        if (!rows || rows.length === 0) return res.status(404).json({ message: 'Ordem de compra não encontrada' });
        const ord = rows[0];

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Ordem de Compra');

        // Header styling
        worksheet.mergeCells('A1:F1');
        worksheet.getCell('A1').value = 'ORDEM DE COMPRA - ALUFORCE';
        worksheet.getCell('A1').font = { size: 16, bold: true };
        worksheet.getCell('A1').alignment = { horizontal: 'center' };

        // Order details
        worksheet.addRow([]);
        worksheet.addRow(['Número da Ordem:', ord.id]);
        worksheet.addRow(['Data do Pedido:', ord.data_pedido ? ord.data_pedido.toISOString().slice(0,10) : '']);
        worksheet.addRow(['Previsão de Entrega:', ord.previsao_entrega ? ord.previsao_entrega.toISOString().slice(0,10) : '']);
        worksheet.addRow(['Status:', ord.status || 'Pendente']);

        // Material section
        worksheet.addRow([]);
        worksheet.addRow(['MATERIAL']).font = { bold: true };
        worksheet.addRow(['Código:', ord.codigo_material]);
        worksheet.addRow(['Descrição:', ord.material_descricao]);
        worksheet.addRow(['Unidade:', ord.unidade_medida || '']);
        worksheet.addRow(['Quantidade:', ord.quantidade]);

        // Style the worksheet
        worksheet.columns = [
            { width: 20 }, { width: 30 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }
        ];

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="ordem_compra_${ord.id}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Erro ao gerar Excel da ordem de compra:', err && err.message ? err.message : err);
        res.status(500).json({ message: 'Erro ao gerar Excel.' });
    }
});

// Gerar Excel com relatório geral de ordens de produção
app.get('/api/pcp/relatorio/ordens-excel', authRequired, async (req, res) => {
    try {
        let ExcelJS;
        try { ExcelJS = require('exceljs'); } catch (e) { return res.status(500).json({ message: 'Dependência exceljs não instalada' }); }

        const [ordens] = await db.query(`
            SELECT id, codigo_produto, descricao_produto, quantidade,
                   data_previsao_entrega, status, data_criacao, observacoes
            FROM ordens_producao
            ORDER BY data_previsao_entrega ASC
        `);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Relatório de Ordens');

        // Header
        worksheet.mergeCells('A1:H1');
        worksheet.getCell('A1').value = 'RELATÓRIO DE ORDENS DE PRODUÇÃO - ALUFORCE';
        worksheet.getCell('A1').font = { size: 14, bold: true };
        worksheet.getCell('A1').alignment = { horizontal: 'center' };

        // Column headers
        worksheet.addRow([]);
        const headerRow = worksheet.addRow([
            'ID', 'Código Produto', 'Descrição', 'Quantidade',
            'Previsão Entrega', 'Status', 'Data Criação', 'Observações'
        ]);
        headerRow.font = { bold: true };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6FA' } };

        // Data rows
        ordens.forEach(ordem => {
            worksheet.addRow([
                ordem.id,
                ordem.codigo_produto,
                ordem.descricao_produto,
                ordem.quantidade,
                ordem.data_previsao_entrega ? ordem.data_previsao_entrega.toISOString().slice(0,10) : '',
                ordem.status,
                ordem.data_criacao ? ordem.data_criacao.toISOString().slice(0,10) : '',
                ordem.observacoes
            ]);
        });

        // Auto-fit columns
        worksheet.columns.forEach(column => {
            column.width = 15;
        });
        worksheet.getColumn(3).width = 30; // Descrição
        worksheet.getColumn(8).width = 25; // Observações

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="relatorio_ordens_producao.xlsx"');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Erro ao gerar relatório Excel:', err);
        res.status(500).json({ message: 'Erro ao gerar relatório Excel.' });
    }
});

// Sistema de alertas de estoque baixo
app.get('/api/pcp/alertas/estoque-baixo', authRequired, async (req, res) => {
    try {
        const limite = req.query.limite || 10; // quantidade mínima considerada baixa

        const [materiais] = await db.query(`
            SELECT id, codigo_material, descricao, quantidade_estoque, unidade_medida,
                   CASE
                       WHEN quantidade_estoque = 0 THEN 'CRÍTICO'
                       WHEN quantidade_estoque <= ? THEN 'BAIXO'
                       ELSE 'OK'
                   END as nivel_alerta
            FROM materiais
            WHERE quantidade_estoque <= ?
            ORDER BY quantidade_estoque ASC
        `, [limite, limite]);

        // Calcular estatísticas
        const criticos = materiais.filter(m => m.quantidade_estoque === 0).length;
        const baixos = materiais.filter(m => m.quantidade_estoque > 0 && m.quantidade_estoque <= limite).length;

        res.json({
            alertas: materiais,
            resumo: {
                total_alertas: materiais.length,
                criticos: criticos,
                baixos: baixos,
                limite_configurado: limite
            },
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Erro ao buscar alertas de estoque:', err);
        res.status(500).json({ message: 'Erro ao buscar alertas de estoque.' });
    }
});

// Histórico de movimentações de estoque
app.get('/api/pcp/estoque/movimentacoes', authRequired, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        // Verificar se tabela existe, se não, criar com suporte a produto_id
        await db.query(`
            CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
                id INT AUTO_INCREMENT PRIMARY KEY,
                material_id INT NULL,
                produto_id INT NULL,
                tipo ENUM('ENTRADA', 'SAIDA', 'AJUSTE') NOT NULL,
                quantidade DECIMAL(10,2) NOT NULL,
                quantidade_anterior DECIMAL(10,2),
                quantidade_atual DECIMAL(10,2),
                observacoes TEXT,
                local VARCHAR(50) DEFAULT 'PRINCIPAL',
                documento VARCHAR(100),
                usuario_id INT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                data_movimento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Adicionar coluna produto_id se não existir
        try {
            await db.query(`ALTER TABLE movimentacoes_estoque ADD COLUMN produto_id INT NULL AFTER material_id`);
        } catch (e) { /* coluna já existe */ }

        try {
            await db.query(`ALTER TABLE movimentacoes_estoque ADD COLUMN local VARCHAR(50) DEFAULT 'PRINCIPAL'`);
        } catch (e) { /* coluna já existe */ }

        try {
            await db.query(`ALTER TABLE movimentacoes_estoque ADD COLUMN documento VARCHAR(100)`);
        } catch (e) { /* coluna já existe */ }

        try {
            await db.query(`ALTER TABLE movimentacoes_estoque ADD COLUMN criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        } catch (e) { /* coluna já existe */ }

        const [movimentacoes] = await db.query(`
            SELECT me.*, m.codigo_material, m.descricao as material_descricao
            FROM movimentacoes_estoque me
            LEFT JOIN materiais m ON me.material_id = m.id
            ORDER BY COALESCE(me.criado_em, me.data_movimento) DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        const [total] = await db.query('SELECT COUNT(*) as total FROM movimentacoes_estoque');

        res.json({
            movimentacoes,
            pagination: {
                page,
                limit,
                total: total[0].total,
                pages: Math.ceil(total[0].total / limit)
            }
        });

    } catch (err) {
        console.error('Erro ao buscar movimentações:', err);
        res.status(500).json({ message: 'Erro ao buscar movimentações.' });
    }
});

// Registrar movimentação de estoque
app.post('/api/pcp/estoque/movimentacao', authRequired, async (req, res) => {
    const { material_id, produto_id, tipo, quantidade, observacoes, observacao, local, documento } = req.body;

    try {
        // Suportar tanto material_id quanto produto_id
        const itemId = material_id || produto_id;
        const tabela = material_id ? 'materiais' : 'produtos';
        // Materiais usa quantidade_estoque, Produtos usa estoque_atual
        const coluna = material_id ? 'quantidade_estoque' : 'estoque_atual';
        const obs = observacoes || observacao || '';
        const tipoNorm = tipo?.toUpperCase() || 'ENTRADA';

        // Buscar quantidade atual - produtos podem ter estoque_atual OU quantidade_estoque
        const colunaSelect = tabela === 'produtos' ? 'COALESCE(estoque_atual, quantidade_estoque, 0) as quantidade' : `${coluna} as quantidade`;
        const [item] = await db.query(`SELECT ${colunaSelect}, nome, codigo FROM ${tabela} WHERE id = ?`, [itemId]);
        if (!item || item.length === 0) {
            return res.status(404).json({ message: `${tabela === 'materiais' ? 'Material' : 'Produto'} não encontrado` });
        }

        const quantidadeAnterior = parseFloat(item[0].quantidade) || 0;
        let novaQuantidade;

        switch (tipoNorm) {
            case 'ENTRADA':
                novaQuantidade = quantidadeAnterior + parseFloat(quantidade);
                break;
            case 'SAIDA':
                novaQuantidade = quantidadeAnterior - parseFloat(quantidade);
                break;
            case 'AJUSTE':
                novaQuantidade = parseFloat(quantidade);
                break;
            default:
                return res.status(400).json({ message: 'Tipo de movimentação inválido' });
        }

        // Verificar se a nova quantidade não fica negativa
        if (novaQuantidade < 0) {
            return res.status(400).json({ message: 'Quantidade insuficiente em estoque' });
        }

        // CHAOS-FIX LC-003: Use dedicated connection for transaction safety
        // NOTE: tabela/coluna are safe — derived from ternary with literal values only
        const txConn = await db.getConnection();
        try {
            await txConn.beginTransaction();

            // Atualizar estoque
            await txConn.query(`UPDATE ${tabela} SET ${coluna} = ? WHERE id = ?`, [novaQuantidade, itemId]);

            // Registrar movimentação
            await txConn.query(`
                INSERT INTO movimentacoes_estoque
                (material_id, produto_id, tipo, quantidade, quantidade_anterior, quantidade_atual, observacoes, local, documento, usuario_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [material_id || null, produto_id || null, tipoNorm, quantidade, quantidadeAnterior, novaQuantidade, obs, local || 'PRINCIPAL', documento || null, req.user?.id || 1]);

            await txConn.commit();
        } catch (txErr) {
            try { await txConn.rollback(); } catch(e) {}
            throw txErr;
        } finally {
            txConn.release();
        }

        // Broadcast atualização
        if (typeof broadcastMaterials === 'function') broadcastMaterials();

        // Criar notificação para entradas de produtos (visível no módulo Vendas)
        const nomeItem = item[0].nome || item[0].codigo || 'Produto';
        if (tipoNorm === 'ENTRADA') {
            try {
                // Criar notificação no banco de dados
                await db.query(`
                    INSERT INTO notificacoes
                    (titulo, mensagem, tipo, modulo, link, usuario_id, lida, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 0, NOW())
                `, [
                    '📦 Nova Entrada de Estoque',
                    `O produto "${nomeItem}" está disponível com ${novaQuantidade.toFixed(2)} metros em estoque.`,
                    'success',
                    'PCP',
                    '/vendas/estoque.html',
                    null // null = broadcast para todos os usuários
                ]);
                console.log(`[PCP] Notificação de entrada criada: ${nomeItem} - ${novaQuantidade} metros`);
            } catch (notifErr) {
                console.error('[PCP] Erro ao criar notificação:', notifErr.message);
            }
        } else if (tipoNorm === 'SAIDA' && novaQuantidade <= 10) {
            // Notificar estoque baixo após saída
            try {
                await db.query(`
                    INSERT INTO notificacoes
                    (titulo, mensagem, tipo, modulo, link, usuario_id, lida, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 0, NOW())
                `, [
                    '⚠️ Estoque Baixo',
                    `O produto "${nomeItem}" está com apenas ${novaQuantidade.toFixed(2)} metros em estoque. Considere reabastecer.`,
                    'warning',
                    'PCP',
                    '/vendas/estoque.html',
                    null
                ]);
            } catch (notifErr) {
                console.error('[PCP] Erro ao criar notificação de estoque baixo:', notifErr.message);
            }
        }

        // Broadcast para atualização em tempo real via WebSocket
        if (typeof broadcastMaterials === 'function') broadcastMaterials();
        if (typeof io !== 'undefined') {
            io.emit('estoque-atualizado', {
                tipo: tipoNorm,
                item_id: itemId,
                tabela: tabela,
                quantidade_anterior: quantidadeAnterior,
                quantidade_atual: novaQuantidade
            });
        }

        res.json({
            message: 'Movimentação registrada com sucesso',
            quantidade_anterior: quantidadeAnterior,
            quantidade_atual: novaQuantidade,
            nome_item: nomeItem
        });

    } catch (err) {
        // CHAOS-FIX LC-003: Rollback handled in inner try-catch-finally
        console.error('Erro ao registrar movimentação:', err);
        res.status(500).json({ message: 'Erro ao registrar movimentação.' });
    }
});

// Alias: /api/pcp/movimentacoes - Lista movimentações recentes (para histórico geral)
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/movimentacoes', authRequired, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const produto_id = req.query.produto_id;
        const material_id = req.query.material_id;

        let whereClause = '1=1';
        const params = [];

        if (produto_id) {
            whereClause += ' AND me.produto_id = ?';
            params.push(produto_id);
        }
        if (material_id) {
            whereClause += ' AND me.material_id = ?';
            params.push(material_id);
        }

        params.push(limit);

        const [movimentacoes] = await db.query(`
            SELECT
                me.id,
                me.tipo,
                me.quantidade,
                me.quantidade_anterior,
                me.quantidade_atual,
                me.observacoes as motivo,
                me.documento,
                me.local,
                COALESCE(me.criado_em, me.data_movimento) as created_at,
                COALESCE(p.nome, p.descricao, m.descricao, 'N/A') as produto_nome,
                COALESCE(p.codigo, m.codigo_material) as produto_codigo
            FROM movimentacoes_estoque me
            LEFT JOIN produtos p ON me.produto_id = p.id
            LEFT JOIN materiais m ON me.material_id = m.id
            WHERE ${whereClause}
            ORDER BY COALESCE(me.criado_em, me.data_movimento) DESC
            LIMIT ?
        `, params);

        res.json(movimentacoes || []);
    } catch (error) {
        console.error('Erro ao buscar movimentações:', error);
        res.json([]);
    }
});

// Movimentações por produto específico
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/produtos/:id/movimentacoes', authRequired, async (req, res) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    try {
        const [movimentacoes] = await db.query(`
            SELECT
                me.id,
                me.tipo as tipo_movimentacao,
                me.quantidade,
                me.quantidade_anterior,
                me.quantidade_atual,
                me.observacoes as observacao,
                me.local as modulo_origem,
                me.documento,
                COALESCE(me.criado_em, me.data_movimento) as created_at,
                u.nome as usuario_nome
            FROM movimentacoes_estoque me
            LEFT JOIN usuarios u ON me.usuario_id = u.id
            WHERE me.produto_id = ?
            ORDER BY COALESCE(me.criado_em, me.data_movimento) DESC
            LIMIT ?
        `, [id, limit]);

        res.json(movimentacoes || []);
    } catch (error) {
        console.error('Erro ao buscar movimentações do produto:', error);
        res.json([]);
    }
});

// Movimentações por material específico
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/materiais/:id/movimentacoes', authRequired, async (req, res) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    try {
        const [movimentacoes] = await db.query(`
            SELECT
                me.id,
                me.tipo as tipo_movimentacao,
                me.quantidade,
                me.quantidade_anterior,
                me.quantidade_atual,
                me.observacoes as observacao,
                me.local as modulo_origem,
                me.documento,
                COALESCE(me.criado_em, me.data_movimento) as created_at,
                u.nome as usuario_nome
            FROM movimentacoes_estoque me
            LEFT JOIN usuarios u ON me.usuario_id = u.id
            WHERE me.material_id = ?
            ORDER BY COALESCE(me.criado_em, me.data_movimento) DESC
            LIMIT ?
        `, [id, limit]);

        res.json(movimentacoes || []);
    } catch (error) {
        console.error('Erro ao buscar movimentações do material:', error);
        res.json([]);
    }
});

// API para buscar PRODUTOS disponíveis para Vendas (do módulo PCP)
// PRODUTOS que tiveram ENTRADA registrada no PCP ou têm estoque disponível
// NOTA: Materiais (matérias-primas) são para PCP, Produtos (acabados) são para Vendas
// Só mostra produtos que têm estoque > 0 OU tiveram entrada registrada
app.get('/api/pcp/estoque/produtos-disponiveis', authRequired, async (req, res) => {
    try {
        const { search, categoria, status } = req.query;

        // Buscar APENAS CABOS/PRODUTOS ACABADOS do PCP
        // EXCLUIR materiais como XLPE, PVC, Polietileno, etc
        let sql = `
            SELECT
                p.id,
                COALESCE(p.codigo, p.sku, CONCAT('PRD-', p.id)) as codigo,
                COALESCE(p.nome, p.descricao, 'Produto sem nome') as nome,
                p.descricao,
                p.sku,
                p.gtin,
                COALESCE(p.estoque_atual, p.quantidade_estoque, 0) as estoque_atual,
                COALESCE(p.estoque_minimo, 10) as estoque_minimo,
                COALESCE(p.preco_venda, p.preco, 0) as preco,
                COALESCE(p.unidade, 'MT') as unidade_medida,
                p.categoria as tipo_material,
                'PRINCIPAL' as local_estoque,
                (SELECT MAX(me.criado_em) FROM movimentacoes_estoque me WHERE me.produto_id = p.id) as ultima_movimentacao,
                (SELECT COUNT(*) FROM movimentacoes_estoque me WHERE me.produto_id = p.id) as total_movimentacoes,
                (SELECT SUM(CASE WHEN me.tipo = 'ENTRADA' THEN me.quantidade ELSE 0 END) FROM movimentacoes_estoque me WHERE me.produto_id = p.id) as total_entradas
            FROM produtos p
            WHERE (p.status = 'ativo' OR p.status IS NULL OR p.status = '')
              AND (
                  COALESCE(p.estoque_atual, p.quantidade_estoque, 0) > 0
                  OR EXISTS (
                      SELECT 1 FROM movimentacoes_estoque me
                      WHERE me.produto_id = p.id AND me.tipo = 'ENTRADA'
                  )
              )
              -- PRIMEIRO: Excluir TODOS os materiais/matérias-primas pelo código
              AND UPPER(COALESCE(p.codigo, '')) NOT IN ('XLPE', 'PVC', 'COBRE', 'ALUMINIO', 'AL', 'CU')
              AND UPPER(COALESCE(p.codigo, '')) NOT LIKE 'MAT-%'
              -- Excluir pelo nome
              AND UPPER(COALESCE(p.nome, p.descricao, '')) NOT LIKE '%XLPE%'
              AND UPPER(COALESCE(p.nome, p.descricao, '')) NOT LIKE '%POLIETILENO%'
              AND UPPER(COALESCE(p.nome, p.descricao, '')) NOT LIKE '%PVC COMPOSTO%'
              AND UPPER(COALESCE(p.nome, p.descricao, '')) NOT LIKE '%MATERIA PRIMA%'
              AND UPPER(COALESCE(p.nome, p.descricao, '')) NOT LIKE '%MATÉRIA PRIMA%'
              AND UPPER(COALESCE(p.nome, p.descricao, '')) NOT LIKE '%TERMOFIXO%'
              AND UPPER(COALESCE(p.nome, p.descricao, '')) NOT LIKE '%RETICULADO%'
              AND UPPER(COALESCE(p.nome, p.descricao, '')) NOT LIKE '%GRANULADO%'
              AND UPPER(COALESCE(p.nome, p.descricao, '')) NOT LIKE '%COMPOSTO%'
              -- Excluir pela categoria
              AND UPPER(COALESCE(p.categoria, '')) NOT IN ('MATERIA_PRIMA', 'INSUMO', 'MATERIAL', 'MATERIAIS', 'OUTROS')
              -- SEGUNDO: Incluir apenas produtos que são CABOS
              AND (
                  -- Código padrão de cabo: TRN10, DUN16, QDR50, etc
                  UPPER(COALESCE(p.codigo, '')) LIKE 'TRN%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'TRI%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'DUN%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'DUI%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'QDR%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'QDN%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'QUI%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'SEX%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'MUL%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'UNI%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'CABO%'
                  OR UPPER(COALESCE(p.codigo, '')) LIKE 'CB%'
                  -- Ou pelo nome contendo tipo de cabo
                  OR UPPER(COALESCE(p.nome, p.descricao, '')) LIKE '%DUPLEX%'
                  OR UPPER(COALESCE(p.nome, p.descricao, '')) LIKE '%TRIPLEX%'
                  OR UPPER(COALESCE(p.nome, p.descricao, '')) LIKE '%QUADRUPLEX%'
                  OR UPPER(COALESCE(p.nome, p.descricao, '')) LIKE '%QUINTUPLEX%'
                  OR UPPER(COALESCE(p.nome, p.descricao, '')) LIKE '%SEXTUPLEX%'
                  OR UPPER(COALESCE(p.nome, p.descricao, '')) LIKE '%MULTIPLEX%'
                  OR UPPER(COALESCE(p.nome, p.descricao, '')) LIKE '%UNIPOLAR%'
                  -- Ou pelo nome contendo CABO DE POTENCIA
                  OR UPPER(COALESCE(p.nome, p.descricao, '')) LIKE '%CABO DE POTENCIA%'
                  OR UPPER(COALESCE(p.nome, p.descricao, '')) LIKE '%CABO DE POTÊNCIA%'
                  OR UPPER(COALESCE(p.nome, p.descricao, '')) LIKE 'ALUFORCE CABO%'
                  -- Ou categoria de cabo
                  OR UPPER(COALESCE(p.categoria, '')) IN ('CABO', 'CABOS', 'PRODUTO_ACABADO', 'TRIPLEX', 'DUPLEX', 'QUADRUPLEX')
              )
        `;

        const params = [];

        // Filtro de busca
        if (search) {
            sql += ` AND (p.codigo LIKE ? OR p.nome LIKE ? OR p.descricao LIKE ? OR p.sku LIKE ? OR p.gtin LIKE ?)`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        // Filtro de categoria
        if (categoria) {
            sql += ` AND p.categoria = ?`;
            params.push(categoria);
        }

        // Filtro de status de estoque
        if (status === 'normal' || status === 'disponivel') {
            sql += ` AND COALESCE(p.estoque_atual, p.quantidade_estoque, 0) > COALESCE(p.estoque_minimo, 10)`;
        } else if (status === 'baixo') {
            sql += ` AND COALESCE(p.estoque_atual, p.quantidade_estoque, 0) > 0 AND COALESCE(p.estoque_atual, p.quantidade_estoque, 0) <= COALESCE(p.estoque_minimo, 10)`;
        } else if (status === 'critico' || status === 'zerado') {
            sql += ` AND COALESCE(p.estoque_atual, p.quantidade_estoque, 0) <= 0`;
        }

        sql += ` ORDER BY COALESCE(p.nome, p.descricao) ASC LIMIT 500`;

        const [produtos] = await db.query(sql, params);

        // Detectar categoria pelo nome (DUPLEX, TRIPLEX, etc) - analisa formação do cabo
        function detectarCategoriaCabo(nome) {
            if (!nome) return 'OUTROS';
            nome = nome.toUpperCase();
            // Padrões: DUPLEX, 2X, 2 X, etc
            if (nome.includes('DUPLEX') || nome.includes('DUN') || nome.includes('DUI') || /\b2\s*X/.test(nome)) return 'DUPLEX';
            if (nome.includes('TRIPLEX') || nome.includes('TRI') || /\b3\s*X/.test(nome)) return 'TRIPLEX';
            if (nome.includes('QUADRUPLEX') || nome.includes('QDR') || nome.includes('QDN') || /\b4\s*X/.test(nome)) return 'QUADRUPLEX';
            if (nome.includes('QUINTUPLEX') || nome.includes('QUI') || /\b5\s*X/.test(nome)) return 'QUINTUPLEX';
            if (nome.includes('SEXTUPLEX') || nome.includes('SEX') || /\b6\s*X/.test(nome)) return 'SEXTUPLEX';
            if (nome.includes('MULTIPLEX') || nome.includes('MULTI') || /\b[7-9]\s*X/.test(nome) || /\b\d{2,}\s*X/.test(nome)) return 'MULTIPLEX';
            if (nome.includes('UNIPOLAR') || /\b1\s*X/.test(nome)) return 'UNIPOLAR';
            return 'OUTROS';
        }

        // Calcular estatísticas
        let estoqueNormal = 0, estoqueBaixo = 0, estoqueCritico = 0;
        const categoriasCounts = {};

        produtos.forEach(p => {
            const qtd = Number(p.estoque_atual || 0);
            const min = Number(p.estoque_minimo || 10);
            if (qtd <= 0) estoqueCritico++;
            else if (qtd <= min) estoqueBaixo++;
            else estoqueNormal++;

            // Detectar categoria pelo nome do produto
            const cat = detectarCategoriaCabo(p.nome);
            categoriasCounts[cat] = (categoriasCounts[cat] || 0) + 1;

            // Adicionar categoria detectada ao produto
            p.categoria_detectada = cat;
        });

        res.json({
            success: true,
            produtos: produtos,
            stats: {
                total_produtos: produtos.length,
                com_estoque: estoqueNormal,
                estoque_baixo: estoqueBaixo,
                critico: estoqueCritico,
                categorias: categoriasCounts,
                total_categorias: Object.keys(categoriasCounts).length
            }
        });

    } catch (err) {
        console.error('[PCP] Erro ao buscar produtos disponíveis:', err);
        res.status(500).json({ success: false, message: 'Erro ao buscar produtos.' });
    }
});

// Relatório de produtividade
app.get('/api/pcp/relatorios/produtividade', authRequired, async (req, res) => {
    try {
        const { data_inicio, data_fim } = req.query;

        let whereClause = '';
        let params = [];

        if (data_inicio && data_fim) {
            whereClause = 'WHERE data_previsao_entrega BETWEEN ? AND ?';
            params = [data_inicio, data_fim];
        }

        const [resultados] = await db.query(`
            SELECT
                status,
                COUNT(*) as quantidade,
                SUM(quantidade) as total_pecas,
                AVG(quantidade) as media_pecas_por_ordem,
                MIN(data_previsao_entrega) as primeira_entrega,
                MAX(data_previsao_entrega) as ultima_entrega
            FROM ordens_producao
            ${whereClause}
            GROUP BY status
            ORDER BY
                CASE status
                    WHEN 'Concluído' THEN 1
                    WHEN 'Em Produção' THEN 2
                    WHEN 'Aguardando' THEN 3
                    ELSE 4
                END
        `, params);

        // estatísticas gerais
        const [geral] = await db.query(`
            SELECT
                COUNT(*) as total_ordens,
                SUM(quantidade) as total_pecas_geral,
                AVG(quantidade) as media_geral,
                COUNT(CASE WHEN status = 'Concluído' THEN 1 END) as concluidas,
                COUNT(CASE WHEN status = 'Em Produção' THEN 1 END) as em_producao
            FROM ordens_producao
            ${whereClause}
        `, params);

        const produtividade = geral[0].total_ordens > 0 ?
            (geral[0].concluidas / geral[0].total_ordens * 100).toFixed(2) : 0;

        res.json({
            por_status: resultados,
            resumo_geral: {
                ...geral[0],
                taxa_produtividade: `${produtividade}%`,
                periodo: { data_inicio, data_fim }
            }
        });

    } catch (err) {
        console.error('Erro ao gerar relatório de produtividade:', err);
        res.status(500).json({ message: 'Erro ao gerar relatório de produtividade.' });
    }
});

// Relatório de custos por período
app.get('/api/pcp/relatorios/custos', authRequired, async (req, res) => {
    try {
        const { data_inicio, data_fim } = req.query;

        // Custos de materiais por ordens de compra
        let whereClause = '';
        let params = [];

        if (data_inicio && data_fim) {
            whereClause = 'WHERE oc.data_pedido BETWEEN ? AND ?';
            params = [data_inicio, data_fim];
        }

        const [custosMateriais] = await db.query(`
            SELECT
                m.codigo_material,
                m.descricao,
                COUNT(oc.id) as numero_compras,
                SUM(oc.quantidade) as quantidade_total,
                m.unidade_medida,
                AVG(oc.quantidade) as quantidade_media_por_compra
            FROM ordens_compra oc
            JOIN materiais m ON oc.material_id = m.id
            ${whereClause}
            GROUP BY m.id, m.codigo_material, m.descricao, m.unidade_medida
            ORDER BY quantidade_total DESC
        `, params);

        // Análise de produtos mais produzidos
        const [produtosMaisProduzidos] = await db.query(`
            SELECT
                codigo_produto,
                descricao_produto,
                COUNT(*) as numero_ordens,
                SUM(quantidade) as quantidade_total,
                AVG(quantidade) as quantidade_media
            FROM ordens_producao
            ${whereClause.replace('oc.data_pedido', 'data_previsao_entrega')}
            GROUP BY codigo_produto, descricao_produto
            ORDER BY quantidade_total DESC
            LIMIT 10
        `, params);

        res.json({
            custos_materiais: custosMateriais,
            produtos_mais_produzidos: produtosMaisProduzidos,
            periodo: { data_inicio, data_fim },
            resumo: {
                total_tipos_materiais: custosMateriais.length,
                total_tipos_produtos: produtosMaisProduzidos.length
            }
        });

    } catch (err) {
        console.error('Erro ao gerar relatório de custos:', err);
        res.status(500).json({ message: 'Erro ao gerar relatório de custos.' });
    }
});

// Export geral para Excel (todos os dados)
app.get('/api/pcp/export/completo-excel', authRequired, async (req, res) => {
    try {
        let ExcelJS;
        try { ExcelJS = require('exceljs'); } catch (e) { return res.status(500).json({ message: 'Dependência exceljs não instalada' }); }

        const workbook = new ExcelJS.Workbook();

        // Aba 1: Ordens de Produção
        const wsOrdens = workbook.addWorksheet('Ordens de Produção');
        const [ordens] = await db.query('SELECT * FROM ordens_producao ORDER BY data_previsao_entrega');

        wsOrdens.addRow(['ID', 'Código Produto', 'Descrição', 'Quantidade', 'Status', 'Previsão Entrega', 'Data Criação']);
        ordens.forEach(ordem => {
            wsOrdens.addRow([
                ordem.id,
                ordem.codigo_produto,
                ordem.descricao_produto,
                ordem.quantidade,
                ordem.status,
                ordem.data_previsao_entrega ? ordem.data_previsao_entrega.toISOString().slice(0,10) : '',
                ordem.data_criacao ? ordem.data_criacao.toISOString().slice(0,10) : ''
            ]);
        });

        // Aba 2: Materiais
        const wsMateriais = workbook.addWorksheet('Materiais');
        const [materiais] = await db.query('SELECT * FROM materiais ORDER BY descricao');

        wsMateriais.addRow(['ID', 'Código', 'Descrição', 'Unidade', 'Estoque Atual']);
        materiais.forEach(material => {
            wsMateriais.addRow([
                material.id,
                material.codigo_material,
                material.descricao,
                material.unidade_medida,
                material.quantidade_estoque
            ]);
        });

        // Aba 3: Ordens de Compra
        const wsCompras = workbook.addWorksheet('Ordens de Compra');
        const [compras] = await db.query(`
            SELECT oc.*, m.codigo_material, m.descricao as material_descricao
            FROM ordens_compra oc
            JOIN materiais m ON oc.material_id = m.id
            ORDER BY oc.data_pedido DESC
        `);

        wsCompras.addRow(['ID', 'Material', 'Descrição', 'Quantidade', 'Data Pedido', 'Previsão', 'Status']);
        compras.forEach(compra => {
            wsCompras.addRow([
                compra.id,
                compra.codigo_material,
                compra.material_descricao,
                compra.quantidade,
                compra.data_pedido ? compra.data_pedido.toISOString().slice(0,10) : '',
                compra.previsao_entrega ? compra.previsao_entrega.toISOString().slice(0,10) : '',
                compra.status
            ]);
        });

        // Formatação geral
        workbook.worksheets.forEach(ws => {
            ws.getRow(1).font = { bold: true };
            ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6FA' } };
            ws.columns.forEach(column => {
                column.width = 15;
            });
        });

        const timestamp = new Date().toISOString().slice(0,10);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="pcp_completo_${timestamp}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Erro ao exportar dados completos:', err);
        res.status(500).json({ message: 'Erro ao exportar dados completos.' });
    }
});

// Gerar Ordem de Produção em Excel usando template
app.post('/api/pcp/ordem-producao/excel', timeoutMiddleware(60000), authRequired, async (req, res) => {
    try {
        let ExcelJS;
        try { ExcelJS = require('exceljs'); } catch (e) {
            return res.status(500).json({ message: 'Dependência exceljs não instalada' });
        }

        // Tentar carregar template existente
        const templatePath = path.join(__dirname, 'Ordem de Produção.xlsx');
        let workbook;

        try {
            // Se o template existe, carregá-lo
            if (fs.existsSync(templatePath)) {
                workbook = new ExcelJS.Workbook();
                await workbook.xlsx.readFile(templatePath);
                console.log('[EXCEL] Template carregado:', templatePath);
            } else {
                throw new Error('Template não encontrado');
            }
        } catch (err) {
            console.log('[EXCEL] Criando novo template...');
            // Se não existe template, criar um novo
            workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Ordem de Produção');

            // Criar template básico
            worksheet.mergeCells('A1:H1');
            worksheet.getCell('A1').value = 'ORDEM DE PRODUÇÃO - ALUFORCE';
            worksheet.getCell('A1').font = { size: 16, bold: true };
            worksheet.getCell('A1').alignment = { horizontal: 'center' };
            worksheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };

            // Cabeçalhos do template
            const headers = [
                ['', '', '', '', '', '', '', ''],
                ['CÓDIGO', 'PRODUTO', 'QTDE', 'VALOR UNIT.', 'VALOR TOTAL', '', '', ''],
                ['', '', '', '', '', '', '', ''],
                ['', '', '', '', 'Total', '0.00', '', ''],
                ['', '', '', '', '', '', '', ''],
                ['Previsão de Entrega', '', '', '', '', '', '', ''],
                ['dd/mm/aaaa', '', '', '', '', '', '', ''],
                ['', '', '', '', '', '', '', ''],
                ['Observações', '', '', '', '', '', '', ''],
                ['', '', '', '', '', '', '', '']
            ];

            headers.forEach((row, index) => {
                worksheet.addRow(row);
            });
        }

        // Buscar a primeira planilha (assumindo que existe)
        const worksheet = workbook.worksheets[0];

        if (!worksheet) {
            return res.status(500).json({ message: 'Template de Excel inválido - sem planilhas' });
        }

        // Extrair todos os campos do corpo da requisição
        const {
            // Dados do Produto
            codigo_produto,
            descricao_produto,
            quantidade,
            // Dados de preço/valor
            valor_unitario = req.body.custo_unitario || req.body.preco_venda || 0,
            // Configurações do produto
            embalagem = req.body.embalagem || '',
            lances = req.body.lances || '',
            // Dados do Pedido/Orçamento
            numero_orcamento = req.body.numero_orcamento || `ORC-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`,
            numero_pedido = req.body.numero_pedido || `PED-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`,
            data_liberacao = req.body.data_liberacao || new Date().toISOString().slice(0,10),
            data_previsao_entrega,
            // Dados Comerciais
            vendedor = req.body.vendedor || 'Vendedor padrão',
            // Dados do Cliente
            cliente,
            contato_cliente,
            email_cliente,
            fone_cliente,
            tipo_frete = req.body.tipo_frete || 'CIF',
            // Dados da Transportadora
            transportadora_nome = req.body.transportadora_nome || '',
            transportadora_fone = req.body.transportadora_fone || '',
            transportadora_cep = req.body.transportadora_cep || '',
            transportadora_endereco = req.body.transportadora_endereco || '',
            // Dados para Cobrança
            transportadora_cpf_cnpj = req.body.transportadora_cpf_cnpj || '',
            transportadora_email_nfe = req.body.transportadora_email_nfe || '',
            // Observações
            observacoes
        } = req.body;

        console.log('[EXCEL] Preenchendo template com todos os campos...');

        // === PREENCHIMENTO COMPLETO E SISTEMÁTICO BASEADO NA ANÁLISE ===

        function preencherCelulasSeguro(cellAddresses, value, label = '') {
            if (!value) return 0;
            let preenchidas = 0;
            cellAddresses.forEach(cellAddr => {
                try {
                    const cell = worksheet.getCell(cellAddr);
                    if (cell) {
                        cell.value = value;
                        preenchidas++;
                        if (preenchidas === 1 && label) {
                            console.log(`[EXCEL] ${label}: ${cellAddr} = ${value.toString().substring(0, 50)}${value.toString().length > 50 ? '...' : ''}`);
                        }
                    }
                } catch (e) {
                    // Ignorar erros de células específicas
                }
            });
            return preenchidas;
        }

        console.log('[EXCEL] Preenchendo template de forma completa...');

        // === DADOS BÁSICOS ===
        preencherCelulasSeguro(['C4'], numero_orcamento, 'Orçamento');
        preencherCelulasSeguro(['G4'], numero_pedido, 'Pedido');
        preencherCelulasSeguro(['I4', 'J4'], data_liberacao, 'Data Liberação');
        camposPreenchidos += 3;

        // === VENDEDOR ===
        preencherCelulasSeguro(['C6', 'D6', 'E6'], vendedor, 'Vendedor');
        preencherCelulasSeguro(['G6', 'H6', 'I6'], data_previsao_entrega || '7 dias úteis', 'Prazo Entrega');
        camposPreenchidos += 2;

        // === CLIENTE COMPLETO ===
        preencherCelulasSeguro(['C7', 'D7', 'E7', 'F7', 'G7'], cliente, 'Cliente');
        preencherCelulasSeguro(['C8', 'D8', 'E8', 'F8'], contato_cliente, 'Contato');
        preencherCelulasSeguro(['H8', 'I8'], fone_cliente, 'Telefone');
        preencherCelulasSeguro(['C9', 'D9', 'E9', 'F9'], email_cliente, 'Email');
        preencherCelulasSeguro(['I9', 'J9'], tipo_frete, 'Tipo Frete');
        camposPreenchidos += 5;

        // === TRANSPORTADORA COMPLETA ===
        preencherCelulasSeguro(['C12', 'D12', 'E12'], transportadora_nome, 'Nome Transportadora');
        preencherCelulasSeguro(['G12', 'H12'], transportadora_fone, 'Fone Transportadora');
        preencherCelulasSeguro(['C13', 'D13'], transportadora_cep, 'CEP');
        preencherCelulasSeguro(['F13', 'G13', 'H13', 'I13'], transportadora_endereco, 'Endereço');
        camposPreenchidos += 4;

        // CPF/CNPJ com formato especial - usar valor padrão se não informado
        const cnpjTransportadoraFinal = transportadora_cpf_cnpj || '00000000000000';
        ['C15', 'D15'].forEach(cellAddr => {
            try {
                const cell = worksheet.getCell(cellAddr);
                // Garantir que o CNPJ seja tratado como texto
                const cnpjTexto = String(cnpjTransportadoraFinal).replace(/[^0-9]/g, '');
                cell.value = `'${cnpjTexto}`; // Apostrofe força texto
                cell.numFmt = '@'; // Formato texto
                console.log(`[EXCEL] CPF/CNPJ: ${cellAddr} = ***${cnpjTexto.slice(-4)}`);

                // Também preencher na aba PRODUÇÃO
                if (temAbaProducao) {
                    const cellProducao = worksheetProducao.getCell(cellAddr);
                    cellProducao.value = `'${cnpjTexto}`;
                    cellProducao.numFmt = '@';
                }
            } catch (e) {
                console.log(`[EXCEL] Erro ao preencher CNPJ em ${cellAddr}: ${e.message}`);
            }
        });
        camposPreenchidos++;

        preencherCelulasSeguro(['G15', 'H15'], transportadora_email_nfe, 'Email NFe');
        camposPreenchidos++;

        // === PRODUTOS NA TABELA ===
        const linhaProduto = 18;
        let valorTotal = 0;

        if (codigo_produto) {
            worksheet.getCell(`C${linhaProduto}`).value = codigo_produto;
            console.log(`[EXCEL] Código Produto: C${linhaProduto} = ${codigo_produto}`);
        }
        if (descricao_produto) {
            worksheet.getCell(`D${linhaProduto}`).value = descricao_produto;
            console.log(`[EXCEL] Descrição: D${linhaProduto} = ${descricao_produto}`);
        }
        if (embalagem) {
            worksheet.getCell(`F${linhaProduto}`).value = embalagem;
            console.log(`[EXCEL] Embalagem: F${linhaProduto} = ${embalagem}`);
        }
        if (lances) {
            worksheet.getCell(`G${linhaProduto}`).value = lances;
            console.log(`[EXCEL] Lances: G${linhaProduto} = ${lances}`);
        }
        if (quantidade) {
            worksheet.getCell(`H${linhaProduto}`).value = quantidade;
            console.log(`[EXCEL] Quantidade: H${linhaProduto} = ${quantidade}`);
        }
        if (valor_unitario) {
            worksheet.getCell(`I${linhaProduto}`).value = valor_unitario;
            console.log(`[EXCEL] Valor Unit: I${linhaProduto} = R$ ${valor_unitario}`);
        }

        // Calcular valor total
        if (quantidade && valor_unitario) {
            valorTotal = quantidade * valor_unitario;
            worksheet.getCell(`J${linhaProduto}`).value = valorTotal;
            console.log(`[EXCEL] Valor Total: J${linhaProduto} = R$ ${valorTotal.toFixed(2)}`);
        }

        camposPreenchidos += 6;

        // Total geral
        if (valorTotal > 0) {
            preencherCelulasSeguro(['I34', 'J34'], valorTotal, `Total Geral: R$ ${valorTotal.toFixed(2)}`);
            camposPreenchidos++;
        }

        // === OBSERVAÇÕES COMPLETAS ===
        if (observacoes) {
            preencherCelulasSeguro(['A37', 'B37', 'C37', 'D37', 'E37', 'F37', 'G37', 'H37'],
                                  observacoes, 'Observações do Pedido');
            camposPreenchidos++;
        }

        // === PAGAMENTO ===
        const condicoesPagamento = req.body.condicoes_pagamento || '30 dias';
        const metodoPagamento = req.body.metodo_pagamento || 'Faturamento';

        preencherCelulasSeguro(['A44', 'B44', 'C44', 'D44'], condicoesPagamento, 'Condições Pagamento');
        preencherCelulasSeguro(['F44', 'G44', 'H44'], metodoPagamento, 'Método Pagamento');
        if (valorTotal > 0) {
            preencherCelulasSeguro(['I44', 'J44'], valorTotal, 'Valor Total Pagamento');
        }
        camposPreenchidos += 3;

        // === ENTREGA ===
        const dataEntrega = data_previsao_entrega || req.body.data_entrega;
        if (dataEntrega) {
            preencherCelulasSeguro(['A47', 'B47', 'C47', 'D47'], dataEntrega, 'Data Entrega');
            camposPreenchidos++;
        }

        const qtdVolumes = req.body.qtd_volumes || '1 volume';
        preencherCelulasSeguro(['A49', 'B49', 'C49'], qtdVolumes, 'Volumes');

        const tipoEmbalagem = req.body.tipo_embalagem_entrega || embalagem || 'Embalagem padrão';
        preencherCelulasSeguro(['F49', 'G49', 'H49'], tipoEmbalagem, 'Embalagem');

        const observacoesEntrega = req.body.observacoes_entrega || 'Instruções de entrega padrão';
        preencherCelulasSeguro(['E51', 'F51', 'G51', 'H51', 'I51', 'J51'], observacoesEntrega, 'Obs. Entrega');

        camposPreenchidos += 3;

        console.log(`[EXCEL] Total de campos preenchidos: ${camposPreenchidos}`);

        // PREENCHER CÉLULAS ESPECÍFICAS DA TABELA DE PRODUTOS (linhas 18-32 baseado nas imagens)
        try {
            console.log('[EXCEL] Preenchendo tabela de produtos...');

            // Linha 18 (primeira linha de dados da tabela) - baseado na análise das imagens
            const linhaProduto = 18; // Ajustar conforme a linha real da tabela

            // Preencher primeira linha da tabela de produtos
            worksheet.getCell(`C${linhaProduto}`).value = codigo_produto || ''; // Coluna Cod.
            worksheet.getCell(`D${linhaProduto}`).value = descricao_produto || ''; // Coluna Produto
            worksheet.getCell(`F${linhaProduto}`).value = embalagem || ''; // Coluna Embalagem
            worksheet.getCell(`G${linhaProduto}`).value = lances || ''; // Coluna Lance(s)
            worksheet.getCell(`H${linhaProduto}`).value = quantidade || 0; // Coluna Qtd.
            worksheet.getCell(`I${linhaProduto}`).value = valor_unitario || 0; // Coluna V.Un.R$

            // Calcular valor total
            const valorTotal = (quantidade || 0) * (valor_unitario || 0);
            worksheet.getCell(`J${linhaProduto}`).value = valorTotal; // Coluna V.Total.R$

            console.log(`[EXCEL] Tabela linha ${linhaProduto}: ${codigo_produto} | ${descricao_produto} | ${quantidade} | R$ ${valor_unitario} | Total: R$ ${valorTotal}`);

            // PREENCHER TOTAL DO PEDIDO
            const totalPedidoCell = worksheet.getCell('I34'); // Baseado na análise - "Total do Pedido:$"
            if (totalPedidoCell) {
                totalPedidoCell.value = valorTotal;
                console.log(`[EXCEL] Total do Pedido: ${totalPedidoCell.address} = R$ ${valorTotal}`);
            }

            // PREENCHER OBSERVAÇÕES DO PEDIDO (área grande amarela)
            if (observacoes) {
                // Tentar várias células possíveis para observações
                const obsAreas = ['A37', 'B37', 'C37', 'A38', 'B38', 'C38'];
                for (const cellAddr of obsAreas) {
                    const obsCell = worksheet.getCell(cellAddr);
                    if (!obsCell.value) {
                        obsCell.value = observacoes;
                        console.log(`[EXCEL] Observações: ${cellAddr} = ${observacoes}`);
                        break;
                    }
                }
            }

            // PREENCHER DADOS DA TRANSPORTADORA (seção específica)
            // Nome da transportadora
            if (transportadora_nome) {
                const nomeCell = worksheet.getCell('C12'); // Baseado na imagem
                if (nomeCell) {
                    nomeCell.value = transportadora_nome;
                    console.log(`[EXCEL] Transportadora Nome: C12 = ${transportadora_nome}`);
                }
            }

            // Fone da transportadora
            if (transportadora_fone) {
                const foneTranspCell = worksheet.getCell('G12'); // Baseado na imagem
                if (foneTranspCell) {
                    foneTranspCell.value = transportadora_fone;
                    console.log(`[EXCEL] Transportadora Fone: G12 = ${transportadora_fone}`);
                }
            }

            // CPF/CNPJ - formato correto (não científico)
            if (transportadora_cpf_cnpj) {
                const cpfCell = worksheet.getCell('C15');
                if (cpfCell) {
                    // Garantir formato de texto para evitar notação científica
                    cpfCell.value = String(transportadora_cpf_cnpj);
                    cpfCell.numFmt = '@'; // Formato texto
                    console.log(`[EXCEL] CPF/CNPJ: C15 = ***${String(transportadora_cpf_cnpj).slice(-4)}`);
                }
            }

            // Email NFe
            if (transportadora_email_nfe) {
                const emailNfeCell = worksheet.getCell('G15');
                if (emailNfeCell) {
                    emailNfeCell.value = transportadora_email_nfe;
                    console.log(`[EXCEL] Email NFe: G15 = [REDACTED]`);
                }
            }

            // CONDIÇÕES DE PAGAMENTO
            const condicoesPagamento = req.body.condicoes_pagamento || 'À Vista';
            const pagamentoCell = worksheet.getCell('D42'); // Ajustar conforme posição real
            if (pagamentoCell) {
                pagamentoCell.value = condicoesPagamento;
                console.log(`[EXCEL] Condições Pagamento: D42 = ${condicoesPagamento}`);
            }

        } catch (err) {
            console.log('[EXCEL] Aviso: Erro ao preencher células específicas:', err.message);
        }

        // Salvar ordem no banco primeiro
        const [result] = await db.query(
            `INSERT INTO ordens_producao (codigo_produto, descricao_produto, quantidade, data_previsao_entrega, cliente, observacoes, status)
             VALUES (?, ?, ?, ?, ?, ?, 'Rascunho')`,
            [codigo_produto, descricao_produto, quantidade, data_previsao_entrega, cliente, observacoes]
        );

        const ordemId = result.insertId;
        const timestamp = new Date().toISOString().slice(0, 10);

        // Configurar response para download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Ordem_Producao_${ordemId}_${timestamp}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

        console.log(`[EXCEL] Ordem de produção ${ordemId} gerada com sucesso`);

    } catch (err) {
        console.error('Erro ao gerar ordem de produção Excel:', err);
        res.status(500).json({ message: 'Erro ao gerar ordem de produção em Excel.' });
    }
});

// Endpoint específico para geração de ordem de produção via modal (com suporte a múltiplos itens)
app.post('/api/pcp/ordens-producao', authRequired, timeoutMiddleware(60000), async (req, res) => {
    try {
        let ExcelJS;
        try { ExcelJS = require('exceljs'); } catch (e) {
            return res.status(500).json({ message: 'Dependência exceljs não instalada' });
        }

        console.log('[MODAL-EXCEL] === PROCESSANDO ORDEM DO MODAL ===');
        console.log('[MODAL-EXCEL] Content-Type:', req.headers['content-type']);
        console.log('[MODAL-EXCEL] Body recebido:', req.body);
        console.log('[MODAL-EXCEL] Body keys:', req.body ? Object.keys(req.body) : 'UNDEFINED');

        // Verificar se req.body existe
        if (!req.body) {
            console.log('[MODAL-EXCEL] ❌ req.body é undefined ou null');
            return res.status(400).json({ message: 'Dados não recebidos corretamente' });
        }

        // Extrair dados do formulário - CORRIGIDO para nova estrutura
        const {
            // Cliente
            cliente,
            cliente_id,
            contato,
            email,
            telefone,
            // Comercial
            vendedor,
            frete,
            numero_orcamento,
            revisao,
            pedido_referencia,
            data_liberacao,
            // Datas
            data_previsao_entrega,
            // Observações
            observacoes,
            // Configurações
            variacao,
            embalagem,
            lances,
            // Transportadora (pode vir como objeto ou campos individuais)
            transportadora,
            transportadora_nome,
            transportadora_fone,
            transportadora_cep,
            transportadora_endereco,
            transportadora_cpf_cnpj,
            transportadora_email_nfe,
            // Itens (JSON string) - fallback
            items_json
        } = req.body;

        // Mapear transportadora corretamente
        const transportadoraData = transportadora || {};
        const transportadoraNome = transportadoraData.nome || transportadora_nome || '';
        const transportadoraFone = transportadoraData.fone || transportadora_fone || '';
        const transportadoraCep = transportadoraData.cep || transportadora_cep || '';
        const transportadoraEndereco = transportadoraData.endereco || transportadora_endereco || '';
        const transportadoraCpfCnpj = transportadoraData.cpf_cnpj || transportadora_cpf_cnpj || '';
        const transportadoraEmailNfe = transportadoraData.email_nfe || transportadora_email_nfe || '';

        console.log('[MODAL-EXCEL] Transportadora mapeada:', {
            nome: transportadoraNome,
            fone: transportadoraFone,
            cep: transportadoraCep,
            endereco: transportadoraEndereco,
            cpf_cnpj: transportadoraCpfCnpj,
            email_nfe: transportadoraEmailNfe
        });

        // Parse dos itens - CORRIGIDO para suportar múltiplos formatos
        let itens = [];

        // Primeiro, tentar usar 'produtos' (formato do index.html coletarDadosOP())
        if (req.body.produtos && Array.isArray(req.body.produtos)) {
            itens = req.body.produtos;
            console.log('[MODAL-EXCEL] Itens de req.body.produtos:', itens.length, 'produtos');
            if (itens[0]) console.log('[MODAL-EXCEL] Primeiro produto exemplo:', itens[0]);
        }
        // Segundo, tentar usar a estrutura 'items' (formato modal_nova_ordem_saas.html)
        else if (req.body.items && Array.isArray(req.body.items)) {
            itens = req.body.items;
            console.log('[MODAL-EXCEL] Itens do novo modal:', itens.length, 'produtos');
            console.log('[MODAL-EXCEL] Primeiro item exemplo:', itens[0]);
        }
        // Fallback para items_json (estrutura antiga)
        else if (req.body.items_json) {
            try {
                itens = JSON.parse(req.body.items_json);
                console.log('[MODAL-EXCEL] Itens parseados do JSON:', itens.length, 'produtos');
            } catch (e) {
                console.log('[MODAL-EXCEL] Erro ao parsear items_json');
                itens = [];
            }
        }
        // Fallback final para dados individuais
        else {
            console.log('[MODAL-EXCEL] Usando fallback para dados individuais');
            itens = [{
                codigo: req.body.codigo_produto || '',
                descricao: req.body.descricao_produto || '',
                quantidade: parseFloat(req.body.quantidade) || 0,
                valor_unitario: parseFloat(req.body.valor_unitario) || 0
            }];
        }

        console.log('[MODAL-EXCEL] === ITENS FINAIS ===');
        console.log('[MODAL-EXCEL] Total de itens:', itens.length);
        itens.forEach((item, i) => {
            console.log(`[MODAL-EXCEL] Item ${i+1}:`, {
                codigo: item.codigo,
                descricao: item.descricao,
                peso_liquido: item.peso_liquido,
                lote: item.lote,
                quantidade: item.quantidade,
                valor_unitario: item.valor_unitario
            });
        });

        // Carregar template
        const templatePath = path.join(__dirname, 'Ordem de Produção.xlsx');
        let workbook;

        if (fs.existsSync(templatePath)) {
            workbook = new ExcelJS.Workbook();
            // Configurar encoding UTF-8 para caracteres especiais
            await workbook.xlsx.readFile(templatePath, {
                ignoreReadErrors: true
            });
            console.log('[MODAL-EXCEL] Template carregado com sucesso');
        } else {
            return res.status(500).json({ message: 'Template Ordem de Produção.xlsx não encontrado' });
        }

        // Buscar a primeira planilha (VENDAS_PCP)
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            return res.status(500).json({ message: 'Template inválido - sem planilhas' });
        }

        // Buscar a segunda planilha (PRODUÇÃO)
        const worksheetProducao = workbook.worksheets[1];
        let temAbaProducao = !!worksheetProducao;

        console.log('[MODAL-EXCEL] Preenchendo template com base no mapeamento das imagens...');
        if (temAbaProducao) {
            console.log('[MODAL-EXCEL] ✅ Aba PRODUÇÃO encontrada, será preenchida também');
        }

        // Função auxiliar para preencher células com formatação e tratamento de fórmulas
        function preencherCelula(cellAddr, value, label = '', format = null, wsTarget = null) {
            if (value === null || value === undefined) return false;

            const targetWorksheet = wsTarget || worksheet;

            try {
                const cell = targetWorksheet.getCell(cellAddr);
                if (cell) {
                    // 🔧 PRESERVAR fórmulas de porcentagem (E45, E46) e outras fórmulas de cálculo
                    const formulaAtual = cell.formula || cell.sharedFormula;
                    const ehFormulaPorcentagem = formulaAtual && (formulaAtual.includes('%') || formulaAtual.includes('-E45'));
                    const ehFormulaVlookup = formulaAtual && formulaAtual.includes('VLOOKUP');

                    // Só sobrescrever fórmulas que não sejam de porcentagem ou VLOOKUP
                    if (formulaAtual && !ehFormulaPorcentagem && !ehFormulaVlookup) {
                        console.log(`[MODAL-EXCEL] 🔧 Sobrescrevendo fórmula em ${cellAddr} com: ${String(value).substring(0, 50)}`);
                        cell.formula = null;
                        cell.sharedFormula = null;
                        cell.value = value;
                    } else if (!formulaAtual) {
                        // Célula sem fórmula, preencher normalmente
                        cell.value = value;
                    } else {
                        console.log(`[MODAL-EXCEL] ℹ️ Preservando fórmula em ${cellAddr}: ${formulaAtual}`);
                    }

                    if (format) cell.numFmt = format;
                    if (label && !wsTarget) { // Log apenas para a aba principal
                        console.log(`[MODAL-EXCEL] ${label}: ${cellAddr} = ${String(value).substring(0, 50)}`);
                    }
                    return true;
                }
            } catch (e) {
                console.log(`[MODAL-EXCEL] ⚠️ Erro ao preencher ${cellAddr}: ${e.message}`);
                // Tentar célula alternativa próxima
                try {
                    const col = cellAddr.match(/[A-Z]+/)[0];
                    const row = parseInt(cellAddr.match(/\d+/)[0]);
                    const cellAlternativa = col + (row + 1);
                    const altCell = targetWorksheet.getCell(cellAlternativa);
                    if (altCell && !altCell.formula && !altCell.sharedFormula) {
                        altCell.value = value;
                        if (format) altCell.numFmt = format;
                        console.log(`[MODAL-EXCEL] ${label}: ${cellAlternativa} = ${String(value).substring(0, 50)} (alternativa)`);
                        return true;
                    }
                } catch (e2) {
                    console.log(`[MODAL-EXCEL] ⚠️ Também falhou célula alternativa: ${e2.message}`);
                }
            }
            return false;
        }

        let camposPreenchidos = 0;

        // === MAPEAMENTO CORRETO BASEADO NA ANÁLISE DO TEMPLATE ===

        // **LINHA 4 - CABEÇALHO PRINCIPAL (Orçamento, Revisão, Pedido, Data Liberação)**
        // Baseado na análise: A4="Orçamento:", D4="Revisão:", F4="Pedido:", H4="Dt. liberação:"
        if (numero_orcamento) {
            // 🔧 CORREÇÃO 1: Extrair apenas o número do orçamento (01, 001, etc.)
            let numeroLimpo = numero_orcamento;
            const match = numero_orcamento.match(/(\d{1,3})$/); // Pega os últimos 1-3 dígitos
            if (match) {
                numeroLimpo = match[1].padStart(3, '0'); // Preenche com zeros à esquerda para ter 3 dígitos
            }
            camposPreenchidos += preencherCelula('C4', numeroLimpo, 'Orçamento (Número)') ? 1 : 0; // Valor na célula C4

            // 🆕 PREENCHER TAMBÉM NA ABA PRODUÇÃO
            if (temAbaProducao) {
                preencherCelula('C4', numeroLimpo, '', null, worksheetProducao);
            }
        }
        // Revisão - sempre preencher, padrão '00' se não informado
        const revisaoFinal = revisao || '00';
        console.log(`[MODAL-EXCEL] 🔍 Revisão recebida: "${revisao}" -> usando: "${revisaoFinal}"`);
        camposPreenchidos += preencherCelula('E4', revisaoFinal, 'Revisão') ? 1 : 0; // Valor na célula E4
        if (temAbaProducao) {
            preencherCelula('E4', revisaoFinal, '', null, worksheetProducao);
        }

        // Pedido - se não informado, usar sequencial ou padrão
        const pedidoFinal = pedido_referencia || '0';
        camposPreenchidos += preencherCelula('G4', pedidoFinal, 'Pedido') ? 1 : 0; // Valor na célula G4
        if (temAbaProducao) {
            preencherCelula('G4', pedidoFinal, '', null, worksheetProducao);
        }

        // Data de liberação - se não informada, usar data atual
        const dataLiberacaoFinal = data_liberacao ? new Date(data_liberacao).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');
        camposPreenchidos += preencherCelula('J4', dataLiberacaoFinal, 'Data Liberação') ? 1 : 0; // Valor na célula J4
        if (temAbaProducao) {
            preencherCelula('J4', dataLiberacaoFinal, '', null, worksheetProducao);
        }


        // **LINHA 6 - VENDEDOR E PRAZO DE ENTREGA**
        // Baseado na análise: A6="VENDEDOR:", F6="Prazo de entrega:"
        if (vendedor) {
            camposPreenchidos += preencherCelula('C6', vendedor, 'Vendedor') ? 1 : 0; // Valor na célula C6
            if (temAbaProducao) {
                preencherCelula('C6', vendedor, '', null, worksheetProducao);
            }
        }
        if (data_previsao_entrega) {
            const dataFormatada = new Date(data_previsao_entrega).toLocaleDateString('pt-BR');
            camposPreenchidos += preencherCelula('H6', dataFormatada, 'Prazo Entrega') ? 1 : 0; // Valor na célula H6
            if (temAbaProducao) {
                preencherCelula('H6', dataFormatada, '', null, worksheetProducao);
            }
        }

        // **LINHA 7 - CLIENTE**
        // Baseado na análise: A7="Cliente:"
        if (cliente) {
            camposPreenchidos += preencherCelula('C7', cliente, 'Cliente') ? 1 : 0; // Valor na célula C7
            if (temAbaProducao) {
                preencherCelula('C7', cliente, '', null, worksheetProducao);
            }
        }

        // **LINHA 8 - CONTATO E TELEFONE**
        // Baseado na análise: A8="Contato:", G8="Fone:"
        if (contato) {
            camposPreenchidos += preencherCelula('C8', contato, 'Contato') ? 1 : 0; // Valor na célula C8
            if (temAbaProducao) {
                preencherCelula('C8', contato, '', null, worksheetProducao);
            }
        }
        if (telefone) {
            camposPreenchidos += preencherCelula('H8', telefone, 'Telefone') ? 1 : 0; // Valor na célula H8
            if (temAbaProducao) {
                preencherCelula('H8', telefone, '', null, worksheetProducao);
            }
        }

        // **LINHA 9 - EMAIL E FRETE**
        // Baseado na análise: A9="Email:", H9="Frete:"
        if (email) {
            camposPreenchidos += preencherCelula('C9', email, 'Email') ? 1 : 0; // Valor na célula C9
            if (temAbaProducao) {
                preencherCelula('C9', email, '', null, worksheetProducao);
            }
        }
        if (frete) {
            camposPreenchidos += preencherCelula('J9', frete, 'Frete') ? 1 : 0; // Valor na célula J9
            if (temAbaProducao) {
                preencherCelula('J9', frete, '', null, worksheetProducao);
            }
        }

        // **SEÇÃO TRANSPORTADORA (Linhas 12-15)**
        // Baseado na análise: A12="Nome:", A13="Cep:", A15="CPF/CNPJ:"

        // Nome da transportadora - usar valor do modal
        const nomeTransportadoraFinal = transportadoraNome || 'A DEFINIR';
        camposPreenchidos += preencherCelula('C12', nomeTransportadoraFinal, 'Nome Transportadora') ? 1 : 0; // Valor na célula C12
        if (temAbaProducao) {
            preencherCelula('C12', nomeTransportadoraFinal, '', null, worksheetProducao);
        }

        // Telefone da transportadora - usar valor do modal
        const foneTransportadoraFinal = transportadoraFone || '(11) 99999-9999';
        camposPreenchidos += preencherCelula('H12', foneTransportadoraFinal, 'Fone Transportadora') ? 1 : 0; // Valor na célula H12
        if (temAbaProducao) {
            preencherCelula('H12', foneTransportadoraFinal, '', null, worksheetProducao);
        }

        // CEP da transportadora - usar valor do modal
        const cepTransportadoraFinal = transportadoraCep || '00000-000';
        camposPreenchidos += preencherCelula('C13', cepTransportadoraFinal, 'CEP') ? 1 : 0; // Valor na célula C13
        if (temAbaProducao) {
            preencherCelula('C13', cepTransportadoraFinal, '', null, worksheetProducao);
        }

        // Endereço da transportadora - usar valor do modal
        const enderecoTransportadoraFinal = transportadoraEndereco || 'A DEFINIR';
        camposPreenchidos += preencherCelula('F13', enderecoTransportadoraFinal, 'Endereço') ? 1 : 0; // Valor na célula F13
        if (temAbaProducao) {
            preencherCelula('F13', enderecoTransportadoraFinal, '', null, worksheetProducao);
        }

        // Email para NFe da transportadora - usar valor padrão se não informado
        const emailTransportadoraFinal = transportadora_email_nfe || 'teste@empresa.com';
        camposPreenchidos += preencherCelula('H13', emailTransportadoraFinal, 'Email NFe') ? 1 : 0; // Valor na célula H13
        if (temAbaProducao) {
            preencherCelula('H13', emailTransportadoraFinal, '', null, worksheetProducao);
        }

        if (transportadoraCpfCnpj) {
            // 🔧 CORREÇÃO 2: Corrigir formatação do CPF/CNPJ para não bugar
            let cpfCnpjLimpo = transportadoraCpfCnpj.replace(/\D/g, '');
            let cpfCnpjFormatado = '';

            if (cpfCnpjLimpo.length === 11) {
                // CPF: 000.000.000-00
                cpfCnpjFormatado = cpfCnpjLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
            } else if (cpfCnpjLimpo.length === 14) {
                // CNPJ: 00.000.000/0000-00
                cpfCnpjFormatado = cpfCnpjLimpo.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
            } else {
                cpfCnpjFormatado = transportadoraCpfCnpj;
            }

            // 🔧 CORREÇÃO CRÍTICA: Usar formato texto para evitar notação científica
            const cell = worksheet.getCell('C15');
            cell.value = cpfCnpjFormatado;
            cell.numFmt = '@'; // Formato texto obrigatório
            console.log(`[MODAL-EXCEL] CPF/CNPJ Formatado: C15 = ***${String(cpfCnpjFormatado).replace(/\D/g, '').slice(-4)}`);
            camposPreenchidos++;

            // Aplicar também na aba de produção se existir
            if (temAbaProducao) {
                const cellProd = worksheetProducao.getCell('C15');
                cellProd.value = cpfCnpjFormatado;
                cellProd.numFmt = '@'; // Formato texto obrigatório
            }
        }

        if (transportadoraEmailNfe) {
            camposPreenchidos += preencherCelula('G15', transportadoraEmailNfe, 'Email NFe') ? 1 : 0; // Valor na célula G15
            if (temAbaProducao) {
                preencherCelula('G15', transportadoraEmailNfe, '', null, worksheetProducao);
            }
        }

        // === TABELA DE PRODUTOS (Linha 17+) ===
        // Baseado na análise: B17="Cod.", C17="Produto", F17="Embalagem:", G17="Lance(s)", H17="Qtd.", I17="V. Un. R$", J17="V. Total. R$"
        let valorTotalGeral = 0;
        const linhaProdutoInicial = 18; // Produtos começam na linha 18

        console.log(`[MODAL-EXCEL] Processando ${itens.length} itens na tabela de produtos...`);

        // 🔧 CORREÇÃO 4: Buscar nomes completos dos produtos da base de dados
        for (let index = 0; index < itens.length; index++) {
            const item = itens[index];
            const linha = linhaProdutoInicial + index;

            // 🔧 CORREÇÃO CRÍTICA: Na aba PRODUÇÃO, cada produto ocupa 3 linhas:
            // - Linha do produto: 13, 16, 19, 22, 25... (começa em 13, incrementa de 3 em 3)
            // - Linha P.BRUTO/P.LIQUIDO/LOTE: 14, 17, 20, 23, 26... (logo abaixo do produto)
            const linhaProducao = 13 + (index * 3); // Produtos em 13, 16, 19, 22...
            const linhaPesoLote = linhaProducao + 1; // Linha de P.BRUTO/P.LIQUIDO/LOTE logo abaixo

            let { codigo, descricao, quantidade, valor_unitario, peso_liquido, lote } = item;

            // 🔧 CORREÇÃO FINAL: Buscar nome completo SEMPRE para TODOS os produtos
            if (codigo) {
                try {
                    // Buscar produto na base de dados usando diferentes métodos
                    let produtoRows = [];

                    // Primeira tentativa: busca exata por código
                    [produtoRows] = await db.query("SELECT * FROM produtos WHERE codigo = ? LIMIT 1", [codigo]);

                    // Segunda tentativa: busca parcial se não encontrou
                    if (produtoRows.length === 0) {
                        [produtoRows] = await db.query("SELECT * FROM produtos WHERE codigo LIKE ? LIMIT 1", [`%${codigo}%`]);
                    }

                    // Terceira tentativa: busca por SKU ou GTIN
                    if (produtoRows.length === 0) {
                        [produtoRows] = await db.query("SELECT * FROM produtos WHERE sku = ? OR gtin = ? LIMIT 1", [codigo, codigo]);
                    }

                    if (produtoRows.length > 0) {
                        const produto = produtoRows[0];
                        // Construir nome completo do produto
                        let nomeCompleto = '';

                        if (produto.nome && produto.descricao && produto.nome !== produto.descricao) {
                            nomeCompleto = `${produto.nome} - ${produto.descricao}`;
                        } else if (produto.nome) {
                            nomeCompleto = produto.nome;
                        } else if (produto.descricao) {
                            nomeCompleto = produto.descricao;
                        } else {
                            nomeCompleto = codigo;
                        }

                        // Adicionar variação se existir
                        if (produto.variacao && produto.variacao !== 'N/A') {
                            nomeCompleto += ` (${produto.variacao})`;
                        }

                        descricao = nomeCompleto;
                        console.log(`[EXCEL] ✅ Produto ${codigo}: Nome completo = ${descricao}`);
                    } else {
                        console.log(`[EXCEL] ⚠️ Produto ${codigo} não encontrado na base`);
                        descricao = descricao || codigo;
                    }
                } catch (error) {
                    console.log(`[EXCEL] ⚠️ Erro ao buscar produto ${codigo}: ${error.message}`);
                    descricao = descricao || codigo; // Usar código se não conseguir buscar
                }
            }

            // 🔧 CORREÇÃO 3: Mapeamento correto dos produtos baseado na análise real
            // A18: Número sequencial (1, 2, 3...)
            // B18: Código
            // C18: Produto/Descrição (ocupa C, D, E)
            // F18: Embalagem
            // G18: Lance(s)
            // H18: Quantidade
            // I18: Valor Unitário
            // J18: Valor Total

            // Preencher na aba VENDAS_PCP
            camposPreenchidos += preencherCelula(`A${linha}`, index + 1, `Item ${index + 1} - Seq`) ? 1 : 0;

            if (codigo) {
                camposPreenchidos += preencherCelula(`B${linha}`, codigo, `Item ${index + 1} - Código`) ? 1 : 0;
                // Também preencher na aba PRODUÇÃO - Coluna B da linha do produto
                if (temAbaProducao) {
                    preencherCelula(`B${linhaProducao}`, codigo, `[PRODUÇÃO] Código linha ${linhaProducao}`, null, worksheetProducao);
                }
            }
            if (descricao) {
                // Produto ocupa células C, D, E na aba VENDAS_PCP
                camposPreenchidos += preencherCelula(`C${linha}`, descricao, `Item ${index + 1} - Descrição`) ? 1 : 0;
                // 🔧 CORREÇÃO: Preencher nome do produto na aba PRODUÇÃO
                if (temAbaProducao) {
                    // Na aba PRODUÇÃO, o produto vai na coluna C (igual à VENDAS)
                    preencherCelula(`C${linhaProducao}`, descricao, `[PRODUÇÃO] Produto linha ${linhaProducao}`, null, worksheetProducao);
                    console.log(`[MODAL-EXCEL] [PRODUÇÃO] Produto C${linhaProducao} = ${descricao}`);
                }
            }

            // Usar embalagem e lances do modal para cada item
            const embalagemItem = item.embalagem || embalagem || 'Bobina';
            const lancesItem = item.lances || lances || '';

            camposPreenchidos += preencherCelula(`F${linha}`, embalagemItem, `Item ${index + 1} - Embalagem`) ? 1 : 0;
            camposPreenchidos += preencherCelula(`G${linha}`, lancesItem, `Item ${index + 1} - Lances`) ? 1 : 0;

            // 🔧 CORREÇÃO: Preencher embalagem e lances também na aba PRODUÇÃO
            if (temAbaProducao) {
                preencherCelula(`H${linhaProducao}`, embalagemItem, `[PRODUÇÃO] Embalagem linha ${linhaProducao}`, null, worksheetProducao);
                preencherCelula(`I${linhaProducao}`, lancesItem, `[PRODUÇÃO] Lances linha ${linhaProducao}`, null, worksheetProducao);
            }

            if (quantidade) {
                camposPreenchidos += preencherCelula(`H${linha}`, quantidade, `Item ${index + 1} - Quantidade`) ? 1 : 0;
                // Também preencher na aba PRODUÇÃO - Coluna J (Quantidade - SEM formato R$)
                if (temAbaProducao) {
                    // Preencher quantidade e REMOVER formatação R$ (usar formato numérico simples)
                    const cellQtdProducao = worksheetProducao.getCell(`J${linhaProducao}`);
                    cellQtdProducao.value = quantidade;
                    cellQtdProducao.numFmt = '#,##0.00'; // Formato numérico SEM R$
                    console.log(`[MODAL-EXCEL] [PRODUÇÃO] Qtd J${linhaProducao} = ${quantidade} (formato numérico)`);
                }
            }

            // 🔧 CORREÇÃO FINAL: Preencher P.LIQUIDO e LOTE na aba PRODUÇÃO
            // A estrutura na aba PRODUÇÃO conforme ORDEM_COMPLETA_TESTE.xlsx:
            // - Linha do produto (ex: 13): B=Cod, C=Produto, H=Embalagem, I=Lance, J=Qtd
            // - Linha abaixo (ex: 14): A/B="P. BRUTO"(label), C=valor_peso_bruto, D="P.LIQUIDO"(label), E=valor_peso_liquido, F="LOTE"(label), G=valor_lote
            if (temAbaProducao) {
                // Peso Líquido - VALOR vai na coluna E (após o label "P.LIQUIDO" em D)
                const pesoLiquidoItem = peso_liquido || item.peso_liquido || '';
                if (pesoLiquidoItem) {
                    preencherCelula(`E${linhaPesoLote}`, pesoLiquidoItem, `[PRODUÇÃO] P.LIQUIDO VALOR linha ${linhaPesoLote}`, null, worksheetProducao);
                    console.log(`[MODAL-EXCEL] [PRODUÇÃO] P.LIQUIDO VALOR E${linhaPesoLote} = ${pesoLiquidoItem}`);
                }

                // Lote - VALOR vai na coluna G (após o label "LOTE" em F)
                const loteItem = lote || item.lote || '';
                if (loteItem) {
                    preencherCelula(`G${linhaPesoLote}`, loteItem, `[PRODUÇÃO] LOTE VALOR linha ${linhaPesoLote}`, null, worksheetProducao);
                    console.log(`[MODAL-EXCEL] [PRODUÇÃO] LOTE VALOR G${linhaPesoLote} = ${loteItem}`);
                }
            }
            if (valor_unitario) {
                // Usar formato de moeda brasileira com verificação de fórmula
                try {
                    const cellValorUnit = worksheet.getCell(`I${linha}`);
                    if (!cellValorUnit.formula && !cellValorUnit.sharedFormula) {
                        cellValorUnit.formula = null;
                        cellValorUnit.sharedFormula = null;
                        cellValorUnit.value = valor_unitario;
                        cellValorUnit.numFmt = 'R$ #,##0.00';
                        console.log(`[MODAL-EXCEL] Item ${index + 1} - Valor Unit: I${linha} = R$ ${valor_unitario}`);
                        camposPreenchidos++;
                    } else {
                        console.log(`[MODAL-EXCEL] ⚠️ Pulando I${linha} - contém fórmula`);
                    }
                } catch (e) {
                    console.log(`[MODAL-EXCEL] ⚠️ Erro em I${linha}: ${e.message}`);
                }

                // Também preencher na aba PRODUÇÃO
                if (temAbaProducao) {
                    try {
                        const cellValorUnitProducao = worksheetProducao.getCell(`H${linhaProducao}`);
                        if (!cellValorUnitProducao.formula && !cellValorUnitProducao.sharedFormula) {
                            cellValorUnitProducao.value = valor_unitario;
                            cellValorUnitProducao.numFmt = 'R$ #,##0.00';
                        }
                    } catch (e) {
                        console.log(`[MODAL-EXCEL] ⚠️ Erro em H${linhaProducao} (PRODUÇÃO): ${e.message}`);
                    }
                }
            }

            // Calcular valor total do item
            if (quantidade && valor_unitario) {
                const valorTotalItem = quantidade * valor_unitario;

                try {
                    const cellValorTotal = worksheet.getCell(`J${linha}`);
                    if (!cellValorTotal.formula && !cellValorTotal.sharedFormula) {
                        cellValorTotal.formula = null;
                        cellValorTotal.sharedFormula = null;
                        cellValorTotal.value = valorTotalItem;
                        cellValorTotal.numFmt = 'R$ #,##0.00';
                        console.log(`[MODAL-EXCEL] Item ${index + 1} - Valor Total: J${linha} = R$ ${valorTotalItem.toFixed(2)}`);
                        camposPreenchidos++;
                    } else {
                        console.log(`[MODAL-EXCEL] ⚠️ Pulando J${linha} - contém fórmula`);
                    }
                } catch (e) {
                    console.log(`[MODAL-EXCEL] ⚠️ Erro em J${linha}: ${e.message}`);
                }

                // Também preencher na aba PRODUÇÃO
                if (temAbaProducao) {
                    try {
                        const cellValorTotalProducao = worksheetProducao.getCell(`I${linhaProducao}`);
                        if (!cellValorTotalProducao.formula && !cellValorTotalProducao.sharedFormula) {
                            cellValorTotalProducao.value = valorTotalItem;
                            cellValorTotalProducao.numFmt = 'R$ #,##0.00';
                        }
                    } catch (e) {
                        console.log(`[MODAL-EXCEL] ⚠️ Erro em I${linhaProducao} (PRODUÇÃO): ${e.message}`);
                    }
                }

                valorTotalGeral += valorTotalItem;
                console.log(`[MODAL-EXCEL] Item ${index + 1}: ${descricao} - Qtd: ${quantidade} - Unit: R$ ${valor_unitario} - Total: R$ ${valorTotalItem.toFixed(2)}`);
            }
        }

        // **TOTAL GERAL DO PEDIDO**
        // Baseado na análise: I34="Total do Pedido:$"
        if (valorTotalGeral > 0) {
            const linhaTotalGeral = 34; // Linha fixa conforme template

            // Total na célula J34 com verificação de fórmula
            try {
                const cellTotal = worksheet.getCell('J34');
                if (!cellTotal.formula && !cellTotal.sharedFormula) {
                    cellTotal.formula = null;
                    cellTotal.sharedFormula = null;
                    cellTotal.value = valorTotalGeral;
                    cellTotal.numFmt = 'R$ #,##0.00';
                    console.log(`[MODAL-EXCEL] Total Geral: J34 = R$ ${valorTotalGeral.toFixed(2)}`);
                    camposPreenchidos++;
                } else {
                    console.log(`[MODAL-EXCEL] ⚠️ J34 contém fórmula, tentando célula alternativa`);
                    // Tentar I34 como alternativa
                    const cellTotalAlt = worksheet.getCell('I34');
                    if (!cellTotalAlt.formula && !cellTotalAlt.sharedFormula) {
                        cellTotalAlt.formula = null;
                        cellTotalAlt.sharedFormula = null;
                        cellTotalAlt.value = valorTotalGeral;
                        cellTotalAlt.numFmt = 'R$ #,##0.00';
                        console.log(`[MODAL-EXCEL] Total Geral (alt): I34 = R$ ${valorTotalGeral.toFixed(2)}`);
                        camposPreenchidos++;
                    }
                }
            } catch (e) {
                console.log(`[MODAL-EXCEL] ⚠️ Erro ao definir total: ${e.message}`);
            }
        }

        // **SEÇÃO OBSERVAÇÕES**
        // Baseado na análise: A36="Observações do Pedido"
        if (observacoes) {
            // Observações na área específica (A37+)
            const linhaObservacoes = 37;
            camposPreenchidos += preencherCelula(`A${linhaObservacoes}`, observacoes, 'Observações do Pedido') ? 1 : 0;
        }

        // **SEÇÃO CONDIÇÕES DE PAGAMENTO**
        // Baseado na análise: A43="CONDIÇOES DE PAGAMENTO.", A44="FORMAS DE PAGAMENTO", F44="Método de Pagamento", I44="Valor Total $"
        const linhaPagamento = 43; // Linha fixa conforme template

        // Linha PARCELADO (linha 45)
        const linhaParcelado = 45;
        camposPreenchidos += preencherCelula(`A${linhaParcelado}`, 'PARCELADO', 'Parcelado') ? 1 : 0;
        camposPreenchidos += preencherCelula(`E${linhaParcelado}`, '100%', 'Perc Parcelado') ? 1 : 0;
        camposPreenchidos += preencherCelula(`F${linhaParcelado}`, 'FATURAMENTO', 'Método Pagamento') ? 1 : 0;

        // Aplicar formatação de moeda brasileira no valor total
        if (valorTotalGeral > 0) {
            try {
                const cellParcelado = worksheet.getCell(`I${linhaParcelado}`);
                if (!cellParcelado.formula && !cellParcelado.sharedFormula) {
                    cellParcelado.formula = null;
                    cellParcelado.sharedFormula = null;
                    cellParcelado.value = valorTotalGeral;
                    cellParcelado.numFmt = 'R$ #,##0.00';
                    console.log(`[MODAL-EXCEL] Valor Total Parcelado: I${linhaParcelado} = R$ ${valorTotalGeral.toFixed(2)}`);
                    camposPreenchidos++;
                } else {
                    console.log(`[MODAL-EXCEL] ⚠️ I${linhaParcelado} contém fórmula, usando valor direto`);
                }
            } catch (e) {
                console.log(`[MODAL-EXCEL] ⚠️ Erro ao definir valor parcelado: ${e.message}`);
            }
        }

        // Linha ENTREGA (linha 46)
        const linhaEntrega = 46;
        camposPreenchidos += preencherCelula(`A${linhaEntrega}`, 'ENTREGA', 'Entrega') ? 1 : 0;
        camposPreenchidos += preencherCelula(`E${linhaEntrega}`, '0%', 'Perc Entrega') ? 1 : 0;

        // Valor R$ na coluna da direita (mesmo se for 0)
        try {
            const cellEntrega = worksheet.getCell(`I${linhaEntrega}`);
            if (!cellEntrega.formula && !cellEntrega.sharedFormula) {
                cellEntrega.formula = null;
                cellEntrega.sharedFormula = null;
                cellEntrega.value = 0;
                cellEntrega.numFmt = 'R$ #,##0.00';
                console.log(`[MODAL-EXCEL] Valor Entrega: I${linhaEntrega} = R$ 0,00`);
                camposPreenchidos++;
            } else {
                console.log(`[MODAL-EXCEL] ⚠️ I${linhaEntrega} contém fórmula, pulando`);
            }
        } catch (e) {
            console.log(`[MODAL-EXCEL] ⚠️ Erro ao definir valor entrega: ${e.message}`);
        }

        // **SEÇÃO EMBALAGEM**
        // Baseado na análise: F48="EMBALAGEM:"
        if (embalagem) {
            camposPreenchidos += preencherCelula('H48', embalagem, 'Embalagem Geral') ? 1 : 0;
        }

        // **CAMPOS ADICIONAIS DO MODAL**
        // Variação - pode ir em uma área específica
        if (variacao) {
            const linhaVariacao = linhaPagamento + 5;
            camposPreenchidos += preencherCelula(`A${linhaVariacao}`, 'Variação:', 'Label Variação') ? 1 : 0;
            camposPreenchidos += preencherCelula(`B${linhaVariacao}`, variacao, 'Variação') ? 1 : 0;
        }

        console.log(`[MODAL-EXCEL] Total de campos preenchidos: ${camposPreenchidos}`);
        console.log(`[MODAL-EXCEL] Valor total da ordem: R$ ${valorTotalGeral.toFixed(2)}`);

        // 🔧 CORREÇÃO 4: Implementar nome do arquivo personalizado
        const dataAtual = new Date();
        const dataFormatada = dataAtual.toLocaleDateString('pt-BR').replace(/\//g, '-');

        // Extrair nome da empresa do campo cliente
        let nomeEmpresa = 'SemEmpresa';
        if (cliente) {
            // Se o cliente tem formato "EMPRESA — CNPJ (Contato)", extrair só o nome
            const empresaMatch = cliente.match(/^([^—]+)/);
            if (empresaMatch) {
                nomeEmpresa = empresaMatch[1].trim();
            } else {
                nomeEmpresa = cliente.substring(0, 30); // Limitar tamanho
            }
        }

        const nomeArquivo = `Ordem de Produção - ${dataFormatada} - ${nomeEmpresa}.xlsx`;

        console.log(`[MODAL-EXCEL] Nome do arquivo: ${nomeArquivo}`);

        // Configurar response para download com encoding UTF-8
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}`);

        // Escrever com configurações UTF-8
        await workbook.xlsx.write(res, {
            useStyles: true,
            useSharedStrings: true
        });
        res.end();

        console.log(`[MODAL-EXCEL] ✅ Ordem de produção gerada: ${nomeArquivo}`);

    } catch (err) {
        console.error('[MODAL-EXCEL] ❌ Erro ao gerar ordem:', err);
        res.status(500).json({ message: 'Erro ao gerar ordem de produção em Excel' + (process.env.NODE_ENV === 'development' ? ': ' + err.message : '') });
    }
});

// 🆕 ENDPOINT PARA BUSCAR PRODUTOS POR CÓDIGO
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/produtos/buscar/:codigo', authRequired, async (req, res) => {
    try {
        const { codigo } = req.params;

        console.log(`[PRODUTOS] Buscando produto: ${codigo}`);

        // Buscar produto pelo código (busca exata e também por padrão)
        const [produtos] = await db.execute(`
            SELECT
                id,
                codigo,
                nome as descricao,
                descricao as descricao_completa,
                variacao,
                marca,
                gtin,
                sku
            FROM produtos
            WHERE codigo LIKE ? OR gtin LIKE ? OR sku LIKE ?
            LIMIT 1
        `, [`%${codigo}%`, `%${codigo}%`, `%${codigo}%`]);

        if (produtos.length > 0) {
            const produto = produtos[0];

            // Simular preço baseado no código (enquanto não temos tabela de preços)
            let preco_unitario = 10.00; // Preço padrão

            // Lógica para determinar preço baseado no tipo de cabo
            if (produto.codigo.includes('10mm')) preco_unitario = 15.50;
            else if (produto.codigo.includes('16mm')) preco_unitario = 22.30;
            else if (produto.codigo.includes('25mm')) preco_unitario = 35.80;
            else if (produto.codigo.includes('6mm')) preco_unitario = 12.75;
            else if (produto.codigo.includes('4mm')) preco_unitario = 8.90;
            else if (produto.codigo.includes('2.5mm')) preco_unitario = 6.40;
            else if (produto.codigo.includes('1.5mm')) preco_unitario = 5.60;
            else if (produto.codigo.includes('TRIPLEX')) preco_unitario = 18.20;
            else if (produto.codigo.includes('DUPLEX')) preco_unitario = 14.60;
            else if (produto.codigo.includes('FLEX')) preco_unitario = 7.80;

            const produtoCompleto = {
                id: produto.id,
                codigo: produto.codigo,
                descricao: produto.descricao || produto.descricao_completa,
                preco_unitario: preco_unitario,
                embalagem: 'Bobina', // padrão
                lances: '100,150', // padrão
                variacao: produto.variacao,
                marca: produto.marca,
                gtin: produto.gtin,
                sku: produto.sku
            };

            console.log(`[PRODUTOS] ✅ Produto encontrado: ${produto.codigo} - ${produto.descricao}`);
            res.json(produtoCompleto);
        } else {
            console.log(`[PRODUTOS] ❌ Produto não encontrado: ${codigo}`);
            res.status(404).json({ message: 'Produto não encontrado' });
        }

    } catch (error) {
        console.error('[PRODUTOS] ❌ Erro ao buscar produto:', error);
        res.status(500).json({ message: 'Erro ao buscar produto' + (process.env.NODE_ENV === 'development' ? ': ' + error.message : '') });
    }
});

// 🆕 ENDPOINT PARA AUTOCOMPLETE DE PRODUTOS
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/produtos/autocomplete', authRequired, async (req, res) => {
    try {
        const { q } = req.query; // Termo de busca

        if (!q || q.length < 2) {
            return res.json([]);
        }

        console.log(`[PRODUTOS] Autocomplete: ${q}`);

        // Buscar produtos que contenham o termo no código, nome ou descrição
        const [produtos] = await db.execute(`
            SELECT
                codigo,
                nome as descricao,
                descricao as descricao_completa
            FROM produtos
            WHERE codigo LIKE ? OR nome LIKE ? OR descricao LIKE ?
            ORDER BY
                CASE
                    WHEN codigo LIKE ? THEN 1
                    WHEN nome LIKE ? THEN 2
                    ELSE 3
                END,
                codigo
            LIMIT 10
        `, [
            `%${q}%`, `%${q}%`, `%${q}%`,
            `${q}%`, `${q}%` // Para priorizar resultados que começam com o termo
        ]);

        const resultados = produtos.map(produto => ({
            codigo: produto.codigo,
            descricao: produto.descricao || produto.descricao_completa,
            label: `${produto.codigo} - ${produto.descricao || produto.descricao_completa}`
        }));

        console.log(`[PRODUTOS] ✅ Encontrados ${resultados.length} produtos para autocomplete`);
        res.json(resultados);

    } catch (error) {
        console.error('[PRODUTOS] ❌ Erro no autocomplete:', error);
        res.status(500).json({ message: 'Erro no autocomplete' + (process.env.NODE_ENV === 'development' ? ': ' + error.message : '') });
    }
});

// Sistema de backup automático
// fs e path já foram importados no início do arquivo

// Configurar backup automático com cron
let cron;
try {
    cron = require('node-cron');

    // Backup diário às 2:00 AM
    cron.schedule('0 2 * * *', async () => {
        console.log('[BACKUP] Iniciando backup automático diário...');
        await executarBackupCompleto();
    });

    // Backup semanal de relatórios (domingos às 3:00 AM)
    cron.schedule('0 3 * * 0', async () => {
        console.log('[BACKUP] Iniciando backup semanal de relatórios...');
        await gerarRelatorioSemanal();
    });

} catch (e) {
    console.log('[BACKUP] node-cron não disponível, backups automáticos desabilitados');
}

async function executarBackupCompleto() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupDir = path.join(__dirname, 'backups', 'auto');

        // Criar diretório se não existir
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        // Backup das tabelas principais
        const tabelas = ['ordens_producao', 'materiais', 'ordens_compra', 'movimentacoes_estoque'];

        for (const tabela of tabelas) {
            try {
                const [rows] = await db.query(`SELECT * FROM ${tabela}`);
                const filename = path.join(backupDir, `${tabela}_${timestamp}.json`);
                fs.writeFileSync(filename, JSON.stringify(rows, null, 2));
                console.log(`[BACKUP] ${tabela} salva: ${filename}`);
            } catch (err) {
                console.error(`[BACKUP] Erro ao fazer backup de ${tabela}:`, err.message);
            }
        }

        // Registrar backup na tabela de controle
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS backup_historico (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tipo ENUM('AUTO', 'MANUAL') NOT NULL,
                    status ENUM('SUCESSO', 'ERRO') NOT NULL,
                    data_backup TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    detalhes TEXT,
                    arquivo_path VARCHAR(500)
                )
            `);

            await db.query(
                'INSERT INTO backup_historico (tipo, status, detalhes, arquivo_path) VALUES (?, ?, ?, ?)',
                ['AUTO', 'SUCESSO', `Backup automático de ${tabelas.length} tabelas`, backupDir]
            );
        } catch (err) {
            console.error('[BACKUP] Erro ao registrar histórico:', err.message);
        }

    } catch (err) {
        console.error('[BACKUP] Erro no backup automático:', err);
    }
}

async function gerarRelatorioSemanal() {
    try {
        const dataFim = new Date();
        const dataInicio = new Date(dataFim.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 dias atrás

        // estatísticas da semana
        const [stats] = await db.query(`
            SELECT
                COUNT(*) as ordens_criadas,
                SUM(quantidade) as total_pecas,
                COUNT(CASE WHEN status = 'Concluído' THEN 1 END) as ordens_concluidas
            FROM ordens_producao
            WHERE data_criacao BETWEEN ? AND ?
        `, [dataInicio, dataFim]);

        const [materiaisBaixos] = await db.query(`
            SELECT COUNT(*) as materiais_baixo_estoque
            FROM materiais
            WHERE quantidade_estoque <= 10
        `);

        const relatorio = {
            periodo: {
                inicio: dataInicio.toISOString().slice(0, 10),
                fim: dataFim.toISOString().slice(0, 10)
            },
            estatisticas: {
                ...stats[0],
                materiais_baixo_estoque: materiaisBaixos[0].materiais_baixo_estoque
            },
            gerado_em: new Date().toISOString()
        };

        const filename = path.join(__dirname, 'backups', 'relatorios',
            `relatorio_semanal_${dataFim.toISOString().slice(0, 10)}.json`);

        if (!fs.existsSync(path.dirname(filename))) {
            fs.mkdirSync(path.dirname(filename), { recursive: true });
        }

        fs.writeFileSync(filename, JSON.stringify(relatorio, null, 2));
        console.log('[BACKUP] Relatório semanal gerado:', filename);

    } catch (err) {
        console.error('[BACKUP] Erro ao gerar relatório semanal:', err);
    }
}

// Endpoint para backup manual
app.post('/api/pcp/backup/manual', authRequired, async (req, res) => {
    try {
        await executarBackupCompleto();
        res.json({
            message: 'Backup manual executado com sucesso',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Erro no backup manual:', err);
        res.status(500).json({ message: 'Erro ao executar backup manual' });
    }
});

// Endpoint para histórico de backups
app.get('/api/pcp/backup/historico', authRequired, async (req, res) => {
    try {
        const [historico] = await db.query(`
            SELECT * FROM backup_historico
            ORDER BY data_backup DESC
            LIMIT 50
        `);
        res.json(historico);
    } catch (err) {
        console.error('Erro ao buscar histórico de backup:', err);
        res.status(500).json({ message: 'Erro ao buscar histórico de backup' });
    }
});


// Inicia o servidor HTTP (com Socket.IO integrado)
// Try to listen on requested port, but if it's already in use, try the next few ports.
function tryListen(startPort, maxTries = 10) {
    let attempt = 0;
    function listenPort(port) {
        attempt++;
        httpServer.listen(port, () => {
            logger.info(`🚀 Servidor do P.C.P. a correr em http://localhost:${port}`);

            // 🔒 SECURITY: Limpeza periódica de sessões expiradas (a cada 1 hora)
            setInterval(() => {
                const cleaned = cleanExpiredSessions(sessions, 24 * 60 * 60 * 1000); // 24 horas
                if (cleaned > 0) {
                    logger.info(`🧹 [PCP] ${cleaned} sessões expiradas removidas`);
                }
            }, 60 * 60 * 1000); // 1 hora
        });
        httpServer.once('error', (err) => {
            if (err && err.code === 'EADDRINUSE') {
                logger.warn(`⚠️ Port ${port} em uso, tentando porta ${port + 1}...`);
                if (attempt < maxTries) {
                    // small delay before retrying
                    setTimeout(() => listenPort(port + 1), 200);
                } else {
                    logger.error('❌ não foi possível iniciar o servidor: portas em uso.');
                    process.exit(1);
                }
            } else {
                logger.error('❌ Erro ao iniciar o servidor:', err && err.message ? err.message : err);
                process.exit(1);
            }
        });
    }
    listenPort(startPort);
}

tryListen(PORT, 12);

// Buscar produto por id
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/produtos/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query('SELECT * FROM produtos WHERE id = ?', [id]);
        if (rows.length > 0) {
            const r = rows[0];
            // normalize variacao to array for clients (same behaviour as list endpoint)
            try {
                if (r && typeof r.variacao === 'string') {
                    const raw = r.variacao.trim();
                    if (!raw) { r.variacao = []; }
                    else if (raw.startsWith('[') || raw.startsWith('{')) {
                        try { r.variacao = JSON.parse(raw); } catch (e) { r.variacao = [raw]; }
                    } else {
                        const parts = raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
                        r.variacao = parts;
                    }
                }
            } catch (e) { /* ignore parse errors */ }
            res.json(r);
        } else res.status(404).json({ message: 'Produto não encontrado' });
    } catch (err) {
        console.error('Erro ao buscar produto:', err.message);
        res.status(500).json({ message: 'Erro ao buscar produto.' });
    }
});

// Busca unificada (server-side) para ordens, materiais e produtos
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/search', authRequired, async (req, res) => {
    const q = (req.query.q || '').trim();
    const type = (req.query.type || '').trim(); // optional: 'ordem'|'material'|'produto'
    let page = parseInt(req.query.page, 10) || 1;
    let limit = parseInt(req.query.limit, 10) || 25;
    if (!q) return res.json({ ordens: [], materiais: [], produtos: [] });

    // safety bounds
    if (limit > 200) limit = 200;
    if (page < 1) page = 1;
    const offset = (page - 1) * limit;
    const like = `%${q}%`;

    try {
        const result = { ordens: [], materiais: [], produtos: [] };

        // Helper: query ordens
        async function queryOrdens() {
            const [rows] = await db.query(
                `SELECT id, codigo_produto, descricao_produto, quantidade, data_previsao_entrega, status
                 FROM ordens_producao
                 WHERE codigo_produto LIKE ? OR descricao_produto LIKE ?
                 ORDER BY data_previsao_entrega ASC
                 LIMIT ? OFFSET ?`, [like, like, limit, offset]
            );
            return rows;
        }

        async function queryMateriais() {
            const [rows] = await db.query(
                `SELECT id, codigo_material, descricao, unidade_medida, quantidade_estoque
                 FROM materiais
                 WHERE codigo_material LIKE ? OR descricao LIKE ?
                 ORDER BY descricao ASC
                 LIMIT ? OFFSET ?`, [like, like, limit, offset]
            );
            return rows;
        }

        async function queryProdutos() {
            const [rows] = await db.query(
                `SELECT id, codigo, descricao, unidade_medida, quantidade_estoque, custo_unitario
                 FROM produtos
                 WHERE codigo LIKE ? OR descricao LIKE ?
                 ORDER BY descricao ASC
                 LIMIT ? OFFSET ?`, [like, like, limit, offset]
            );
            return rows;
        }

        async function queryPedidos() {
            // search by pedido id (if numeric), cliente (empresa) or produto code/description (join produtos)
            const possibleId = parseInt(q, 10);
            if (!Number.isNaN(possibleId)) {
                const [rows] = await db.query(
                    `SELECT p.id, p.cliente, p.produto_id, p.quantidade, p.status, p.data_pedido, pr.codigo as produto_codigo, pr.descricao as produto_descricao
                     FROM pedidos p
                     LEFT JOIN produtos pr ON p.produto_id = pr.id
                     WHERE p.id = ?
                     ORDER BY p.data_pedido DESC
                     LIMIT ? OFFSET ?`, [possibleId, limit, offset]
                );
                return rows;
            }
            const [rows] = await db.query(
                `SELECT p.id, p.cliente, p.produto_id, p.quantidade, p.status, p.data_pedido, pr.codigo as produto_codigo, pr.descricao as produto_descricao
                 FROM pedidos p
                 LEFT JOIN produtos pr ON p.produto_id = pr.id
                 WHERE p.cliente LIKE ? OR pr.codigo LIKE ? OR pr.descricao LIKE ?
                 ORDER BY p.data_pedido DESC
                 LIMIT ? OFFSET ?`, [like, like, like, limit, offset]
            );
            return rows;
        }

    if (!type || type === 'ordem') result.ordens = await queryOrdens();
    if (!type || type === 'material') result.materiais = await queryMateriais();
    if (!type || type === 'produto') result.produtos = await queryProdutos();
    if (!type || type === 'pedido') result.pedidos = await queryPedidos();

        // counts for pagination/UX
        let ordensTotal = 0, materiaisTotal = 0, produtosTotal = 0;
        try {
            const [ordensCountRows] = await db.query(`SELECT COUNT(*) AS total FROM ordens_producao WHERE codigo_produto LIKE ? OR descricao_produto LIKE ?`, [like, like]);
            ordensTotal = ordensCountRows[0]?.total || 0;
        } catch (e) { ordensTotal = 0; }
        try {
            const [materiaisCountRows] = await db.query(`SELECT COUNT(*) AS total FROM materiais WHERE codigo_material LIKE ? OR descricao LIKE ?`, [like, like]);
            materiaisTotal = materiaisCountRows[0]?.total || 0;
        } catch (e) { materiaisTotal = 0; }
        try {
            const [produtosCountRows] = await db.query(`SELECT COUNT(*) AS total FROM produtos WHERE codigo LIKE ? OR descricao LIKE ?`, [like, like]);
            produtosTotal = produtosCountRows[0]?.total || 0;
        } catch (e) { produtosTotal = 0; }
        // pedidos count
        let pedidosTotal = 0;
        try {
            const [pedidosCountRows] = await db.query(`SELECT COUNT(*) AS total FROM pedidos p LEFT JOIN produtos pr ON p.produto_id = pr.id WHERE p.id = ? OR p.cliente LIKE ? OR pr.codigo LIKE ? OR pr.descricao LIKE ?`, [q, like, like, like]);
            pedidosTotal = pedidosCountRows[0]?.total || 0;
        } catch (e) { pedidosTotal = 0; }

        // include pagination metadata and totals
    res.json({ page, limit, q, results: result, totals: { ordens: ordensTotal, materiais: materiaisTotal, produtos: produtosTotal, pedidos: pedidosTotal } });
    } catch (err) {
        console.error('Erro na busca unificada:', err.message);
        res.status(500).json({ message: 'Erro ao realizar busca.' });
    }
});

// Health endpoint for quick checks - versão melhorada
app.get('/health', async (req, res) => {
    try {
        const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            pid: process.pid
        };

        // Testar banco de dados
        try {
            await db.query('SELECT 1');
            health.database = 'connected';
        } catch (e) {
            health.database = 'disconnected';
            health.status = 'warning';
            logger.warn('Database health check failed:', e.message);
        }

        res.json(health);
    } catch (err) {
        logger.error('Health check error:', err);
        res.status(500).json({ status: 'error', error: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno' });
    }
});

// (API JSON 404 and global error handler will be registered at the end of the file)

// Internal debug endpoint — PROTEGIDO
// SEGURANÇA: authRequired + admin role adicionados — expunha PID e endereço
app.get('/internal-debug', authRequired, requireProductionRole('ADMIN'), (req, res) => {
    try {
        const addr = httpServer.address();
        res.json({ pid: process.pid, address: addr });
    } catch (err) {
        res.status(500).json({ error: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno' });
    }
});

// Lightweight endpoint to return current authenticated user (used by client probes)
app.get('/api/pcp/me', authRequired, async (req, res) => {
    try {
        const user = req.user || {};
        // attempt to fetch foto_perfil_url from multiple tables
        let foto = null;

        // First try usuarios_pcp table (our main PCP users)
        try {
            if (user.email) {
                const [rows] = await db.query('SELECT foto_url FROM usuarios_pcp WHERE email = ? LIMIT 1', [user.email]);
                if (rows && rows[0] && rows[0].foto_url) foto = rows[0].foto_url;
            }
        } catch (e) {
            // ignore lookup errors and continue with other heuristics
            foto = foto || null;
        }

        // Then try funcionarios table as fallback
        try {
            if (!foto && user.email) {
                const [rows] = await db.query('SELECT foto_perfil_url FROM funcionarios WHERE email = ? LIMIT 1', [user.email]);
                if (rows && rows[0] && rows[0].foto_perfil_url) foto = rows[0].foto_perfil_url;
            }
        } catch (e) {
            // ignore lookup errors and continue with other heuristics
            foto = foto || null;
        }
        try {
            if (!foto && user.id) {
                const [rows2] = await db.query('SELECT foto_perfil_url FROM funcionarios WHERE usuario_id = ? LIMIT 1', [user.id]);
                if (rows2 && rows2[0] && rows2[0].foto_perfil_url) foto = rows2[0].foto_perfil_url;
            }
        } catch (e) { /* ignore */ }
        try {
            if (!foto && user.id) {
                const [rows3] = await db.query('SELECT foto_perfil_url FROM funcionarios WHERE id = ? LIMIT 1', [user.id]);
                if (rows3 && rows3[0] && rows3[0].foto_perfil_url) foto = rows3[0].foto_perfil_url;
            }
        } catch (e) { /* ignore */ }

        // return a sanitized subset of user fields (do not expose senha/password)
        const safe = {
            id: user.id,
            email: user.email,
            nome: user.nome,
            role: user.role,
            foto_perfil_url: foto || null
        };
        res.json({ user: safe });
    } catch (err) {
        console.error('/api/pcp/me error:', err && err.message ? err.message : err);
        res.status(500).json({ message: 'Erro ao obter dados do usuário.' });
    }
});

// Endpoint to get users list for login avatar
// SEGURANÇA: authRequired adicionado — rota expunha emails e roles sem autenticação
app.get('/api/pcp/users-list', authRequired, async (req, res) => {
    try {
        // Get basic user info for avatar display in login
        const [users] = await db.query(`
            SELECT id, nome, email, role, foto_url
            FROM usuarios_pcp
            WHERE ativo = TRUE OR ativo IS NULL
            ORDER BY nome
        `);

        // Return sanitized user data (no passwords or sensitive info)
        const sanitizedUsers = users.map(user => ({
            id: user.id,
            nome: user.nome,
            email: user.email,
            role: user.role,
            foto_url: user.foto_url
        }));

        res.json({ users: sanitizedUsers });
    } catch (err) {
        console.error('/api/pcp/users-list error:', err && err.message ? err.message : err);
        res.status(500).json({ message: 'Erro ao obter lista de usuários.' });
    }
});

// Logout endpoint: clears session and cookie set by login
app.post('/api/pcp/logout', (req, res) => {
    try {
        const sid = getSessionIdFromReq(req);
        if (sid && sessions.has(sid)) sessions.delete(sid);
        // Clear cookie on client
        res.setHeader('Set-Cookie', 'pcp_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
        return res.json({ message: 'Logged out' });
    } catch (err) {
        console.error('Logout error:', err && err.message ? err.message : err);
        return res.status(500).json({ message: 'Erro ao deslogar' });
    }
});

// fetch single pedido by id
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/pedidos/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    console.log(`[DEBUG] Buscando pedido ID: ${id}`);

    try {
        // Query the pedidos table directly - no JOIN since produto_id column doesn't exist
        const [rows] = await db.query('SELECT * FROM pedidos WHERE id = ?', [id]);
        console.log(`[DEBUG] Query resultado: ${rows ? rows.length : 0} linhas`);

        if (!rows || rows.length === 0) {
            console.log(`[DEBUG] Pedido ${id} não encontrado`);
            return res.status(404).json({ message: 'Pedido não encontrado' });
        }

        // Return the pedido with produtos_preview field (which contains product info as JSON)
        const pedido = rows[0];
        console.log(`[DEBUG] Pedido encontrado:`, pedido.descricao);

        // Parse produtos_preview if it exists and is valid JSON
        if (pedido.produtos_preview) {
            try {
                pedido.produtos = JSON.parse(pedido.produtos_preview);
                console.log(`[DEBUG] Produtos parseados: ${pedido.produtos.length} itens`);
            } catch (e) {
                console.warn('Erro ao parsear produtos_preview:', e.message);
                pedido.produtos = [];
            }
        } else {
            pedido.produtos = [];
            console.log(`[DEBUG] Sem produtos_preview`);
        }

        console.log(`[DEBUG] Retornando pedido completo`);
        res.json(pedido);
    } catch (err) {
        console.error('Erro ao buscar pedido ID', id, ':', err && err.message ? err.message : err);
        res.status(500).json({ message: 'Erro ao buscar pedido.', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
});

// Debug endpoint — PROTEGIDO (antes era público)
// SEGURANÇA: authRequired + requireProductionRole adicionados
app.get('/api/pcp/debug/pedidos-faturados', authRequired, requireProductionRole('ADMIN'), async (req, res) => {
    try {
        const sql = `SELECT id, valor, descricao, status, created_at, data_prevista, prazo_entrega, cliente_id, empresa_id, produtos_preview, endereco_entrega, municipio_entrega FROM pedidos WHERE (status LIKE '%fatur%' OR status LIKE '%entreg%' OR status LIKE '%aprov%') ORDER BY created_at DESC LIMIT 50`;
        const [rows] = await db.query(sql);
        return res.json({ ok: true, rows: rows.slice(0,10) });
    } catch (err) {
        return res.status(500).json({ ok: false, error: process.env.NODE_ENV === 'development' ? ((err && err.message) ? err.message : String(err)) : 'Erro interno' });
    }
});

// --- INVENTÁRIO ADICIONAL: locations e movimentos ---
// Criar location
app.post('/api/pcp/locations', authRequired, async (req, res) => {
    const { code, name, description } = req.body;
    try {
        const [r] = await db.query('INSERT INTO locations (code, name, description) VALUES (?, ?, ?)', [code, name, description]);
        res.status(201).json({ id: r.insertId, code, name });
    } catch (e) {
        console.error('Erro ao criar location:', e && e.message ? e.message : e);
        res.status(500).json({ message: 'Erro ao criar location.' });
    }
});

// List locations
app.get('/api/pcp/locations', authRequired, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, code, name, description FROM locations ORDER BY name ASC');
        res.json(rows);
    } catch (e) {
        console.error('Erro ao listar locations:', e && e.message ? e.message : e);
        res.status(500).json({ message: 'Erro ao listar locations.' });
    }
});

// Register a stock movement
app.post('/api/pcp/stock_movements', authRequired, async (req, res) => {
    const { produto_id, location_from, location_to, quantidade, tipo, referencia, lote } = req.body;
    if (!produto_id || !quantidade || !tipo) return res.status(400).json({ message: 'produto_id, quantidade e tipo são obrigatórios.' });
    try {
        // if OUT movement, validate saldo at location_from
        if (tipo === 'OUT') {
            if (!location_from) return res.status(400).json({ message: 'location_from é obrigatório para movimentos OUT.' });
            const [rows] = await db.query(`
                SELECT COALESCE(SUM(CASE WHEN tipo='IN' THEN quantidade WHEN tipo='OUT' THEN -quantidade WHEN tipo='TRANSFER' AND location_to=? THEN quantidade WHEN tipo='TRANSFER' AND location_from=? THEN -quantidade WHEN tipo='ADJUST' THEN quantidade ELSE 0 END),0) AS saldo
                FROM stock_movements WHERE produto_id = ?
            `, [location_from, location_from, produto_id]);
            const saldo = rows && rows[0] ? parseFloat(rows[0].saldo) : 0;
            if (saldo < quantidade) return res.status(400).json({ message: `Saldo insuficiente na localização ${location_from}. Saldo atual: ${saldo}` });
        }
        const sql = 'INSERT INTO stock_movements (produto_id, location_from, location_to, quantidade, tipo, referencia, lote, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        const created_by = req.user ? req.user.id : null;
        const [r] = await db.query(sql, [produto_id, location_from || null, location_to || null, quantidade, tipo, referencia || null, lote || null, created_by]);
        res.status(201).json({ id: r.insertId });
    } catch (e) {
        console.error('Erro ao gravar movimento:', e && e.message ? e.message : e);
        res.status(500).json({ message: 'Erro ao gravar movimento.' });
    }
});

// Enhanced transfer endpoint with validation to prevent negative balances
app.post('/api/pcp/transfer', authRequired, async (req, res) => {
    const { produto_id, from_location, to_location, quantidade, referencia, lote } = req.body;
    if (!produto_id || !from_location || !to_location || !quantidade) return res.status(400).json({ message: 'produto_id, from_location, to_location e quantidade são obrigatórios.' });
    try {
        // compute current saldo for produto at from_location
        const [rows] = await db.query(`
            SELECT COALESCE(SUM(CASE WHEN tipo='IN' THEN quantidade WHEN tipo='OUT' THEN -quantidade WHEN tipo='TRANSFER' AND location_to=? THEN quantidade WHEN tipo='TRANSFER' AND location_from=? THEN -quantidade WHEN tipo='ADJUST' THEN quantidade ELSE 0 END),0) AS saldo
            FROM stock_movements WHERE produto_id = ?
        `, [from_location, from_location, produto_id]);
        const saldo = rows && rows[0] ? parseFloat(rows[0].saldo) : 0;
        if (saldo < quantidade) return res.status(400).json({ message: `Saldo insuficiente na localização ${from_location}. Saldo atual: ${saldo}` });
        // Insert transfer as two entries or as a single transfer record depending on your accounting; we'll use single transfer record
        const created_by = req.user ? req.user.id : null;
        const [r] = await db.query('INSERT INTO stock_movements (produto_id, location_from, location_to, quantidade, tipo, referencia, lote, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [produto_id, from_location, to_location, quantidade, 'TRANSFER', referencia || null, lote || null, created_by]);
        res.status(201).json({ id: r.insertId });
    } catch (e) {
        console.error('Erro ao executar transfer:', e && e.message ? e.message : e);
        res.status(500).json({ message: 'Erro ao executar transfer.' });
    }
});

// Compute stock balance for a produto across locations
app.get('/api/pcp/stock_balance/:produto_id', authRequired, async (req, res) => {
    const produto_id = parseInt(req.params.produto_id, 10);
    if (!produto_id) return res.status(400).json({ message: 'produto_id inválido.' });
    try {
        const [rows] = await db.query(
            `SELECT COALESCE(l.id,0) AS location_id, COALESCE(l.code,'_UNLOC_') AS code, COALESCE(l.name,'Unallocated') AS name,
                    SUM(CASE WHEN sm.tipo = 'IN' THEN sm.quantidade WHEN sm.tipo = 'OUT' THEN -sm.quantidade WHEN sm.tipo = 'TRANSFER' AND sm.location_to = l.id THEN sm.quantidade WHEN sm.tipo = 'TRANSFER' AND sm.location_from = l.id THEN -sm.quantidade WHEN sm.tipo = 'ADJUST' THEN sm.quantidade ELSE 0 END) AS saldo
             FROM stock_movements sm
             LEFT JOIN locations l ON l.id = sm.location_to OR l.id = sm.location_from
             WHERE sm.produto_id = ?
             GROUP BY COALESCE(l.id,0), COALESCE(l.code,'_UNLOC_'), COALESCE(l.name,'Unallocated')`, [produto_id]
        );
        res.json({ produto_id, balances: rows });
    } catch (e) {
        console.error('Erro ao calcular saldo:', e && e.message ? e.message : e);
        res.status(500).json({ message: 'Erro ao calcular saldo.' });
    }
});

// =============================================
// ENDPOINT: Gerar Ordem de Produção em Excel (COMPLETO COM VENDAS_PCP)
// 🔐 SECURITY AUDIT: Added authRequired - Excel generation requires authentication
// =============================================
async function handleGerarOrdemExcel(req, res) {
    try {
        const dados = req.body;

        // Normalizar nomes de campos (aceitar diferentes variantes, incluindo com acento)
        const numPedido = dados.num_pedido || dados.numero_sequencial || dados.numero_pedido || dados['número_pedido'] || dados['número_sequencial'] || '';
        const numOrcamento = dados.num_orcamento || dados.numero_orcamento || dados['número_orçamento'] || dados['num_orçamento'] || '';

        logger.info('[GERAR ORDEM EXCEL] Recebendo dados:', { numPedido, numOrcamento, produtos: dados.produtos?.length });

        // Validações básicas - ser mais flexível
        if (!numPedido && !numOrcamento && !dados.cliente) {
            return res.status(400).json({ message: 'Preencha pelo menos o número do pedido, orçamento ou cliente' });
        }

        if (!dados.produtos || dados.produtos.length === 0) {
            return res.status(400).json({ message: 'Adicione pelo menos um produto' });
        }

        // Carregar template Excel com planilhas VENDAS_PCP e PRODUÇÃO
        const templatePath = path.join(__dirname, 'Ordem de Produção Aluforce - Copia.xlsx');

        if (!fs.existsSync(templatePath)) {
            logger.error('[GERAR ORDEM EXCEL] Template não encontrado:', templatePath);
            return res.status(400).json({ message: 'Template Excel não encontrado: ' + templatePath });
        }

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);

        // ===== PLANILHA VENDAS_PCP =====
        const wsVendas = workbook.getWorksheet('VENDAS_PCP');
        if (!wsVendas) {
            return res.status(500).json({ message: 'Planilha VENDAS_PCP não encontrada no template' });
        }

        // PREENCHER VENDAS_PCP (Linhas 4-15) - As fórmulas da planilha PRODUÇÃO referenciam essas células
        wsVendas.getCell('C4').value = numOrcamento;
        wsVendas.getCell('E4').value = dados.revisao || '00';
        wsVendas.getCell('G4').value = numPedido;

        if (dados.data_liberacao) {
            // Tentar múltiplos formatos de data
            let dataLib;
            if (dados.data_liberacao.includes('/')) {
                // Formato brasileiro DD/MM/YYYY
                const [dia, mes, ano] = dados.data_liberacao.split('/');
                dataLib = new Date(ano, mes - 1, dia);
            } else {
                // Formato ISO YYYY-MM-DD
                dataLib = new Date(dados.data_liberacao + 'T00:00:00');
            }
            wsVendas.getCell('J4').value = dataLib;
            wsVendas.getCell('J4').numFmt = 'dd/mm/yyyy';
        }

        // Vendedor
        wsVendas.getCell('C6').value = dados.vendedor || '';

        // Prazo de Entrega - H6 tem fórmula =J4+30, só preencher se prazo específico foi informado
        if (dados.prazo_entrega && dados.prazo_entrega.trim()) {
            let dataPrazo;
            if (dados.prazo_entrega.includes('/')) {
                const [dia, mes, ano] = dados.prazo_entrega.split('/');
                dataPrazo = new Date(ano, mes - 1, dia);
            } else {
                dataPrazo = new Date(dados.prazo_entrega + 'T00:00:00');
            }
            wsVendas.getCell('H6').value = dataPrazo;
            wsVendas.getCell('H6').numFmt = 'dd/mm/yyyy';
        }
        // Se não informar prazo, deixa a fórmula =J4+30 calcular automaticamente

        // Cliente
        wsVendas.getCell('C7').value = dados.cliente || '';

        // Contato
        wsVendas.getCell('C8').value = dados.contato_cliente || dados.contato || '';

        // Fone
        wsVendas.getCell('H8').value = dados.fone_cliente || dados.telefone || '';

        // Email
        wsVendas.getCell('C9').value = dados.email_cliente || dados.email || '';

        // Frete
        wsVendas.getCell('J9').value = dados.tipo_frete || 'FOB';

        // CEP, Endereço e CPF/CNPJ ficam nas células C13/F13/C15 (área transportadora)
        // Preenchidos mais abaixo na seção TRANSPORTADORA com fallback para dados do cliente

        // Dados para cobrança (Linha 14) - Em branco por padrão
        // NÃO PREENCHER - deve ficar vazio conforme modelo padrão
        ['C14', 'D14', 'E14', 'F14'].forEach(cellAddr => {
            const cell = wsVendas.getCell(cellAddr);
            cell.value = ''; // Limpar valor
            if (cell.formula) cell.formula = undefined;
            if (cell.sharedFormula) cell.sharedFormula = undefined;
        });

        // Email NF-e (usa o email do cliente se não informado)
        wsVendas.getCell('G15').value = dados.email_nfe || dados.email_cliente || dados.email || '';

        // PRODUTOS na planilha VENDAS_PCP (Linhas 18-32)
        // IMPORTANTE: Apenas preenchemos B (código), F, G, H, I
        // As colunas C, D, E têm fórmulas VLOOKUP que buscam nome do produto baseado no código
        // A coluna J tem fórmula =I*H para calcular valor total
        // A planilha PRODUÇÃO usa VLOOKUP para buscar código de cores baseado no código (coluna P)

        let linhaVendas = 18;
        let itemNum = 1;
        for (const produto of dados.produtos.slice(0, 15)) { // Limite de 15 produtos
            // Coluna A: Número do item (1, 2, 3...)
            wsVendas.getCell(`A${linhaVendas}`).value = itemNum;

            // Coluna B: Código do produto (OBRIGATÓRIO - usado pelos VLOOKUPs)
            // O código deve estar exatamente como na tabela de lookup (ex: TRN10, DUN16, etc)
            wsVendas.getCell(`B${linhaVendas}`).value = produto.codigo || '';

            // Colunas C, D, E: NÃO PREENCHER - têm fórmulas VLOOKUP que buscam nome do produto
            // As fórmulas são: =IFERROR(VLOOKUP(B18,N18:O198,2,0),"")
            // Se o código do produto existir na tabela N:O, o nome aparecerá automaticamente
            // Se precisar forçar o nome (produto não cadastrado na tabela), preencher apenas se código não existe
            if (!produto.codigo && (produto.descricao || produto['descri\u00e7\u00e3o'] || produto.nome || produto.produto)) {
                // Produto sem código - preencher nome manualmente
                const nomeProduto = produto.descricao || produto['descri\u00e7\u00e3o'] || produto.nome || produto.produto || '';
                wsVendas.getCell(`C${linhaVendas}`).value = nomeProduto;
            }
            // Se tem código, deixa o VLOOKUP do template buscar o nome automaticamente

            // Coluna F: Embalagem
            wsVendas.getCell(`F${linhaVendas}`).value = produto.embalagem || 'Rolo';

            // Coluna G: Lances (formato: 1x100, 2x50, etc)
            wsVendas.getCell(`G${linhaVendas}`).value = produto.lances || '1x100';

            // Coluna H: Quantidade
            wsVendas.getCell(`H${linhaVendas}`).value = produto.quantidade || 0;

            // Coluna I: Valor Unitário
            wsVendas.getCell(`I${linhaVendas}`).value = produto.valor_unitario || 0;
            wsVendas.getCell(`I${linhaVendas}`).numFmt = 'R$ #,##0.00';

            // Coluna J: NÃO PREENCHER - tem fórmula =I*H que calcula automaticamente
            // A fórmula original do template será preservada

            linhaVendas++;
            itemNum++;
        }

        // ========================================
        // LIMPAR LINHAS DE PRODUTOS NÃO UTILIZADAS (linhas 18-32)
        // O template pode ter dados de exemplo (TRN16, TRN25, etc) que precisam ser limpos
        // ========================================
        logger.info(`[GERAR ORDEM EXCEL] Limpando linhas não utilizadas a partir da linha ${linhaVendas}`);
        for (let linhaLimpar = linhaVendas; linhaLimpar <= 32; linhaLimpar++) {
            // Limpar todas as colunas de produtos: A, B, C, D, E, F, G, H, I, J
            ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].forEach(col => {
                const cell = wsVendas.getCell(`${col}${linhaLimpar}`);
                cell.value = null;
                if (cell.formula) cell.formula = undefined;
                if (cell.model) {
                    cell.model.value = null;
                    cell.model.formula = undefined;
                }
            });
            logger.info(`[GERAR ORDEM EXCEL] Linha ${linhaLimpar} limpa (VENDAS_PCP)`);
        }

        // ===== CAMPOS ADICIONAIS CONFORME MAPEAMENTO =====

        // TRANSPORTADORA (Linhas 11-15) - Células corretas conforme MAPEAMENTO_EXCEL_OP.md
        wsVendas.getCell('C12').value = dados.transportadora_nome || '';
        // H12 = Fórmula =H8 (não preencher)
        wsVendas.getCell('C13').value = dados.transportadora_cep || dados.cep || '';
        wsVendas.getCell('F13').value = dados.transportadora_endereco || dados.endereco || '';

        // CPF/CNPJ da transportadora com formatação (se diferente do cliente)
        const cpfCnpjTransp = dados.transportadora_cpf_cnpj || dados.cpf_cnpj || '';
        wsVendas.getCell('C15').value = formatarCpfCnpjExcel(cpfCnpjTransp);
        // G15 = Fórmula =C9 (não preencher)

        // OBSERVAÇÕES (Linhas 36-42)
        const observacoes = dados.observacoes_pedido || dados.observacoes || '';
        if (observacoes) {
            wsVendas.getCell('A37').value = observacoes;
        }

        // PAGAMENTO (Linhas 43-46) - Suporta múltiplas formas de pagamento
        if (dados.formas_pagamento && dados.formas_pagamento.length > 0) {
            // Linha 45: Primeira forma de pagamento
            const pgto1 = dados.formas_pagamento[0];
            wsVendas.getCell('A45').value = pgto1.forma || 'A_VISTA';
            wsVendas.getCell('E45').value = (pgto1.percentual || 100) / 100; // Converter para decimal
            wsVendas.getCell('E45').numFmt = '0%';
            wsVendas.getCell('F45').value = pgto1.metodo || 'BOLETO';

            // Linha 46: Segunda forma de pagamento (se houver)
            if (dados.formas_pagamento.length > 1) {
                const pgto2 = dados.formas_pagamento[1];
                wsVendas.getCell('A46').value = pgto2.forma || '';
                wsVendas.getCell('E46').value = (pgto2.percentual || 0) / 100;
                wsVendas.getCell('E46').numFmt = '0%';
                wsVendas.getCell('F46').value = pgto2.metodo || '';
            }

            // Linha 47: Terceira forma de pagamento (se houver)
            if (dados.formas_pagamento.length > 2) {
                const pgto3 = dados.formas_pagamento[2];
                wsVendas.getCell('A47').value = pgto3.forma || '';
                wsVendas.getCell('E47').value = (pgto3.percentual || 0) / 100;
                wsVendas.getCell('E47').numFmt = '0%';
                wsVendas.getCell('F47').value = pgto3.metodo || '';
            }
        } else {
            // Compatibilidade com formato antigo
            if (dados.forma_pagamento) {
                wsVendas.getCell('A45').value = dados.forma_pagamento.toUpperCase();
            }
            if (dados.metodo_pagamento) {
                wsVendas.getCell('F45').value = dados.metodo_pagamento.toUpperCase();
            }
            // E45 é percentual (1 = 100%)
            const percentual = dados.percentual_pagamento ? dados.percentual_pagamento / 100 : 1;
            wsVendas.getCell('E45').value = percentual;
            wsVendas.getCell('E45').numFmt = '0%';
        }
        // I45 = Fórmula =I35 (não preencher)

        // Condições de Pagamento (Observações) - aceitar variantes com e sem acento
        const condicoesPagamentoObs = dados['condi\u00e7\u00f5es_pagamento'] || dados.condicoes_pagamento || dados.condições_pagamento || '';
        if (condicoesPagamentoObs) {
            wsVendas.getCell('A48').value = condicoesPagamentoObs;
        }

        // ENTREGA (Linhas 48-54)
        if (dados.qtd_volumes) {
            wsVendas.getCell('D48').value = parseInt(dados.qtd_volumes) || 1;
        }
        if (dados.tipo_embalagem_entrega) {
            wsVendas.getCell('H48').value = dados.tipo_embalagem_entrega;
        }
        // Observações de entrega
        if (dados.observacoes_entrega) {
            wsVendas.getCell('E51').value = dados.observacoes_entrega;
        }

        // ===== PLANILHA PRODUÇÃO =====
        // Preencher P.LIQUIDO e LOTE na aba PRODUÇÃO
        // Estrutura conforme ORDEM_COMPLETA_TESTE.xlsx:
        // - Linha do produto: 13, 16, 19, 22... (incrementa de 3 em 3)
        // - Linha de peso/lote: 14, 17, 20, 23... (logo abaixo do produto)
        // Na linha de peso/lote: E = valor P.LIQUIDO, G = valor LOTE

        const wsProd = workbook.getWorksheet('PRODUÇÃO');
        if (wsProd) {
            logger.info('[GERAR ORDEM EXCEL] Preenchendo dados na planilha PRODUÇÃO');

            // Percorrer produtos e preencher dados
            let indexProd = 0;
            for (const produto of dados.produtos.slice(0, 15)) {
                // Linha do produto na PRODUÇÃO: 13, 16, 19, 22... (13 + index * 3)
                const linhaProduto = 13 + (indexProd * 3);
                // Linha de peso/lote: logo abaixo do produto
                const linhaPesoLote = linhaProduto + 1;

                // Preencher CÓDIGO do produto na coluna B (coluna A é número sequencial)
                if (produto.codigo) {
                    const cellCodigo = wsProd.getCell(`B${linhaProduto}`);
                    // Limpar fórmula antes de preencher
                    cellCodigo.value = null;
                    if (cellCodigo.formula) cellCodigo.formula = undefined;
                    cellCodigo.value = produto.codigo;
                    logger.info(`[GERAR ORDEM EXCEL] B${linhaProduto} (CÓDIGO) = ${produto.codigo}`);
                }

                // Preencher DESCRIÇÃO/PRODUTO na coluna C (SEMPRE, não depender do VLOOKUP)
                const descricao = produto.descricao || produto['descri\u00e7\u00e3o'] || produto.nome || produto.produto || '';
                // SEMPRE preencher a célula C, mesmo que descricao esteja vazia (para limpar fórmulas)
                const cellDescricao = wsProd.getCell(`C${linhaProduto}`);
                // Limpar fórmula ANTES de preencher valor
                cellDescricao.value = null;
                if (cellDescricao.formula) cellDescricao.formula = undefined;
                if (cellDescricao.sharedFormula) cellDescricao.sharedFormula = undefined;
                // Agora preencher o valor
                cellDescricao.value = descricao || '';
                logger.info(`[GERAR ORDEM EXCEL] C${linhaProduto} (DESCRIÇÃO) = ${descricao}`);

                // 🔧 CORREÇÃO: Preencher QUANTIDADE na coluna J com formato NUMÉRICO (SEM R$)
                if (produto.quantidade) {
                    const cellQtd = wsProd.getCell(`J${linhaProduto}`);
                    cellQtd.value = produto.quantidade;
                    cellQtd.numFmt = '#,##0.00'; // Formato numérico SEM R$
                    logger.info(`[GERAR ORDEM EXCEL] J${linhaProduto} (QTD) = ${produto.quantidade} (formato numérico)`);
                }

                // Preencher VALOR do P.LIQUIDO na coluna E (após o label "P.LIQUIDO" em D)
                if (produto.peso_liquido) {
                    wsProd.getCell(`E${linhaPesoLote}`).value = produto.peso_liquido;
                    logger.info(`[GERAR ORDEM EXCEL] E${linhaPesoLote} (P.LIQUIDO) = ${produto.peso_liquido}`);
                }

                // Preencher VALOR do LOTE na coluna G (após o label "LOTE" em F)
                if (produto.lote) {
                    wsProd.getCell(`G${linhaPesoLote}`).value = produto.lote;
                    logger.info(`[GERAR ORDEM EXCEL] G${linhaPesoLote} (LOTE) = ${produto.lote}`);
                }

                indexProd++;
            }

            // ========================================
            // LIMPAR LINHAS DE PRODUTOS NÃO UTILIZADAS NA PLANILHA PRODUÇÃO
            // As linhas são: 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55 (15 produtos max)
            // Cada produto ocupa 3 linhas: linha do produto, linha de peso/lote, linha vazia
            // ========================================
            const totalProdutos = dados.produtos.length;
            logger.info(`[GERAR ORDEM EXCEL] Limpando linhas não utilizadas na PRODUÇÃO (${totalProdutos} produtos usados)`);

            for (let i = totalProdutos; i < 15; i++) {
                const linhaProduto = 13 + (i * 3);
                const linhaPesoLote = linhaProduto + 1;

                // Limpar linha do produto (B, C e J são as principais)
                ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].forEach(col => {
                    const cell = wsProd.getCell(`${col}${linhaProduto}`);
                    cell.value = null;
                    if (cell.formula) cell.formula = undefined;
                    if (cell.model) {
                        cell.model.value = null;
                        cell.model.formula = undefined;
                    }
                });

                // Limpar linha de peso/lote (E e G são os valores)
                ['E', 'G'].forEach(col => {
                    const cell = wsProd.getCell(`${col}${linhaPesoLote}`);
                    cell.value = null;
                    if (cell.formula) cell.formula = undefined;
                });

                logger.info(`[GERAR ORDEM EXCEL] Linhas ${linhaProduto}-${linhaPesoLote} limpas (PRODUÇÃO)`);
            }

            logger.info('[GERAR ORDEM EXCEL] Planilha PRODUÇÃO atualizada com P.LIQUIDO, LOTE e QUANTIDADE');
        }

        // ===== FORÇAR LIMPEZA FINAL DO D14 =====
        // O template pode ter fórmula em D14 que referencia email (C9)
        // Limpar APÓS todo preenchimento para garantir que fique em branco
        logger.info('[GERAR ORDEM EXCEL] Forçando limpeza final das células C14-F14 (Dados para cobrança)');
        ['C14', 'D14', 'E14', 'F14'].forEach(cellAddr => {
            const cell = wsVendas.getCell(cellAddr);
            // Remover qualquer valor ou fórmula
            cell.value = null;
            cell.formula = undefined;
            if (cell.model) {
                cell.model.value = null;
                cell.model.formula = undefined;
            }
        });

        // GERAR ARQUIVO E ENVIAR
        const buffer = await workbook.xlsx.writeBuffer();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const nomeArquivo = `Ordem_Producao_${numPedido || numOrcamento || 'nova'}_${timestamp}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nomeArquivo)}"`);
        res.setHeader('Content-Length', buffer.length);

        logger.info('[GERAR ORDEM EXCEL] Arquivo gerado com sucesso:', nomeArquivo);
        res.send(buffer);

    } catch (error) {
        logger.error('[GERAR ORDEM EXCEL] Erro ao gerar arquivo:', error);
        logger.error('[GERAR ORDEM EXCEL] Stack:', error.stack);
        res.status(500).json({
            message: 'Erro ao gerar ordem de produção em Excel',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
// Registrar em ambas as rotas (retrocompat)
app.post('/api/gerar-ordem-excel', authRequired, handleGerarOrdemExcel);
app.post('/api/pcp/gerar-ordem-excel', authRequired, handleGerarOrdemExcel);

// Endpoint duplicado removido - usando versão completa acima com VENDAS_PCP

// =====================================================
// GESTÃO DE PRODUÇÃO - APIs
// =====================================================

// Criar tabela de máquinas se não existir
const criarTabelaMaquinas = async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS maquinas_producao (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo VARCHAR(50) UNIQUE,
                nome VARCHAR(255) NOT NULL,
                setor VARCHAR(100),
                status ENUM('ativa', 'manutencao', 'inativa') DEFAULT 'ativa',
                ultima_manutencao DATE,
                proxima_manutencao DATE,
                observacoes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        logger.info('[GESTAO] Tabela maquinas_producao verificada/criada');
    } catch (error) {
        logger.error('[GESTAO] Erro ao criar tabela maquinas_producao:', error.message);
    }
};

// Criar tabela de gestão de produção se não existir
const criarTabelaGestaoProducao = async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS gestao_producao (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pedido_id INT,
                numero_pedido VARCHAR(50),
                cliente_nome VARCHAR(255),
                produto_nome VARCHAR(255),
                tempo_producao_minutos INT DEFAULT 0,
                materiais_gastos JSON,
                maquinas_utilizadas JSON,
                quantidade_produzida DECIMAL(10,2) DEFAULT 0,
                quantidade_planejada DECIMAL(10,2) DEFAULT 0,
                status ENUM('planejado', 'em_producao', 'pausado', 'concluido', 'cancelado') DEFAULT 'planejado',
                data_inicio DATETIME,
                data_fim DATETIME,
                eficiencia DECIMAL(5,2) DEFAULT 0,
                observacoes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        logger.info('[GESTAO] Tabela gestao_producao verificada/criada');
    } catch (error) {
        logger.error('[GESTAO] Erro ao criar tabela gestao_producao:', error.message);
    }
};

// Inicializar tabelas
setTimeout(async () => {
    await criarTabelaMaquinas();
    await criarTabelaGestaoProducao();
}, 3000);

// Listar máquinas
// 🔒 SECURITY AUDIT: Added authRequired - machine listing requires authentication
app.get('/api/pcp/maquinas', authRequired, async (req, res) => {
    try {
        const [maquinas] = await db.query(`
            SELECT * FROM maquinas_producao ORDER BY nome
        `);
        res.json(maquinas);
    } catch (error) {
        logger.error('[API_MAQUINAS] Erro:', error.message);
        res.status(500).json({ message: 'Erro ao buscar máquinas', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Criar nova máquina
// 🔒 SECURITY AUDIT: Added authRequired - machine management requires authentication
app.post('/api/pcp/maquinas', authRequired, async (req, res) => {
    try {
        const { codigo, nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes } = req.body;

        // Gerar código se não fornecido
        const codigoFinal = codigo || `MAQ-${Date.now().toString().slice(-6)}`;

        const [result] = await db.query(`
            INSERT INTO maquinas_producao (codigo, nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [codigoFinal, nome, setor || 'Geral', status || 'ativa', ultima_manutencao, proxima_manutencao, observacoes]);

        res.status(201).json({
            message: 'Máquina criada com sucesso',
            id: result.insertId,
            codigo: codigoFinal
        });
    } catch (error) {
        logger.error('[API_MAQUINAS] Erro ao criar:', error.message);
        res.status(500).json({ message: 'Erro ao criar máquina', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Atualizar máquina
// 🔒 SECURITY AUDIT: Added authRequired - machine update requires authentication
app.put('/api/pcp/maquinas/:id', authRequired, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes } = req.body;

        await db.query(`
            UPDATE maquinas_producao SET nome = ?, setor = ?, status = ?, ultima_manutencao = ?, proxima_manutencao = ?, observacoes = ?
            WHERE id = ?
        `, [nome, setor, status, ultima_manutencao, proxima_manutencao, observacoes, id]);

        res.json({ message: 'Máquina atualizada com sucesso' });
    } catch (error) {
        logger.error('[API_MAQUINAS] Erro ao atualizar:', error.message);
        res.status(500).json({ message: 'Erro ao atualizar máquina', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Excluir máquina
// 🔒 SECURITY AUDIT: Added RBAC (ADMIN only), authRequired and audit logging
app.delete('/api/pcp/maquinas/:id', authRequired, requireProductionRole('ADMIN'), async (req, res) => {
    try {
        const { id } = req.params;

        // Buscar máquina antes de excluir para auditoria
        const [maquina] = await db.query('SELECT codigo, nome, setor FROM maquinas_producao WHERE id = ?', [id]);

        await db.query('DELETE FROM maquinas_producao WHERE id = ?', [id]);

        // Log de auditoria
        await logProductionAudit(db, 'DELETE', 'MAQUINA', id, req.user, {
            maquina_codigo: maquina[0]?.codigo,
            maquina_nome: maquina[0]?.nome,
            maquina_setor: maquina[0]?.setor,
            ip: req.ip
        });

        res.json({ message: 'Máquina excluída com sucesso' });
    } catch (error) {
        logger.error('[API_MAQUINAS] Erro ao excluir:', error.message);
        res.status(500).json({ message: 'Erro ao excluir máquina', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Listar registros de gestão de produção
// 🔒 SECURITY AUDIT: Added authRequired - production management requires authentication
app.get('/api/pcp/gestao-producao', authRequired, async (req, res) => {
    try {
        const { periodo, maquina, busca } = req.query;

        let query = `
            SELECT gp.*,
                   COALESCE(gp.tempo_producao_minutos, 0) as tempo_minutos,
                   CASE
                       WHEN gp.tempo_producao_minutos >= 60
                       THEN CONCAT(FLOOR(gp.tempo_producao_minutos / 60), 'h ', MOD(gp.tempo_producao_minutos, 60), 'min')
                       ELSE CONCAT(gp.tempo_producao_minutos, 'min')
                   END as tempo_formatado
            FROM gestao_producao gp
            WHERE 1=1
        `;
        const params = [];

        // Filtro por período
        if (periodo && periodo !== 'todos') {
            switch(periodo) {
                case 'hoje':
                    query += ' AND DATE(gp.created_at) = CURDATE()';
                    break;
                case 'semana':
                    query += ' AND gp.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
                    break;
                case 'mes':
                    query += ' AND MONTH(gp.created_at) = MONTH(CURDATE()) AND YEAR(gp.created_at) = YEAR(CURDATE())';
                    break;
                case 'ano':
                    query += ' AND YEAR(gp.created_at) = YEAR(CURDATE())';
                    break;
            }
        }

        // Filtro por busca (número do pedido)
        if (busca) {
            query += ' AND (gp.numero_pedido LIKE ? OR gp.cliente_nome LIKE ? OR gp.produto_nome LIKE ?)';
            params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
        }

        // Filtro por máquina
        if (maquina) {
            query += ' AND JSON_CONTAINS(gp.maquinas_utilizadas, ?)';
            params.push(JSON.stringify(maquina));
        }

        query += ' ORDER BY gp.created_at DESC LIMIT 100';

        const [registros] = await db.query(query, params);

        // Calcular estatísticas
        const [stats] = await db.query(`
            SELECT
                SUM(tempo_producao_minutos) as tempo_total,
                COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(materiais_gastos, '$[*].id'))) as materiais_count,
                AVG(eficiencia) as eficiencia_media
            FROM gestao_producao
            WHERE status != 'cancelado'
              AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())
        `);

        const [maquinasAtivas] = await db.query(`
            SELECT COUNT(*) as total FROM maquinas_producao WHERE status = 'ativa'
        `);

        res.json({
            registros,
            estatisticas: {
                tempo_total_minutos: stats[0]?.tempo_total || 0,
                tempo_total_formatado: stats[0]?.tempo_total ?
                    `${Math.floor(stats[0].tempo_total / 60)}h` : '0h',
                materiais_utilizados: stats[0]?.materiais_count || 0,
                maquinas_ativas: maquinasAtivas[0]?.total || 0,
                eficiencia_media: Math.round(stats[0]?.eficiencia_media || 0)
            }
        });
    } catch (error) {
        logger.error('[API_GESTAO_PRODUCAO] Erro:', error.message);
        res.status(500).json({ message: 'Erro ao buscar dados de gestão', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Criar registro de gestão de produção
// 🔒 SECURITY AUDIT: Added authRequired - production management requires authentication
app.post('/api/pcp/gestao-producao', authRequired, async (req, res) => {
    try {
        const {
            pedido_id, numero_pedido, cliente_nome, produto_nome,
            tempo_producao_minutos, materiais_gastos, maquinas_utilizadas,
            quantidade_produzida, quantidade_planejada, status,
            data_inicio, data_fim, observacoes
        } = req.body;

        // Calcular eficiência
        let eficiencia = 0;
        if (quantidade_planejada && quantidade_produzida) {
            eficiencia = Math.round((quantidade_produzida / quantidade_planejada) * 100);
        }

        const [result] = await db.query(`
            INSERT INTO gestao_producao
            (pedido_id, numero_pedido, cliente_nome, produto_nome, tempo_producao_minutos,
             materiais_gastos, maquinas_utilizadas, quantidade_produzida, quantidade_planejada,
             status, data_inicio, data_fim, eficiencia, observacoes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            pedido_id, numero_pedido, cliente_nome, produto_nome, tempo_producao_minutos || 0,
            JSON.stringify(materiais_gastos || []), JSON.stringify(maquinas_utilizadas || []),
            quantidade_produzida || 0, quantidade_planejada || 0,
            status || 'planejado', data_inicio, data_fim, eficiencia, observacoes
        ]);

        res.status(201).json({
            message: 'Registro de produção criado',
            id: result.insertId
        });
    } catch (error) {
        logger.error('[API_GESTAO_PRODUCAO] Erro ao criar:', error.message);
        res.status(500).json({ message: 'Erro ao criar registro', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Atualizar registro de gestão de produção
// 🔐 SECURITY: Added authRequired
app.put('/api/pcp/gestao-producao/:id', authRequired, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            tempo_producao_minutos, materiais_gastos, maquinas_utilizadas,
            quantidade_produzida, quantidade_planejada, status,
            data_inicio, data_fim, observacoes
        } = req.body;

        // Calcular eficiência
        let eficiencia = 0;
        if (quantidade_planejada && quantidade_produzida) {
            eficiencia = Math.round((quantidade_produzida / quantidade_planejada) * 100);
        }

        await db.query(`
            UPDATE gestao_producao SET
                tempo_producao_minutos = ?, materiais_gastos = ?, maquinas_utilizadas = ?,
                quantidade_produzida = ?, quantidade_planejada = ?, status = ?,
                data_inicio = ?, data_fim = ?, eficiencia = ?, observacoes = ?
            WHERE id = ?
        `, [
            tempo_producao_minutos, JSON.stringify(materiais_gastos || []),
            JSON.stringify(maquinas_utilizadas || []),
            quantidade_produzida, quantidade_planejada, status,
            data_inicio, data_fim, eficiencia, observacoes, id
        ]);

        res.json({ message: 'Registro atualizado' });
    } catch (error) {
        logger.error('[API_GESTAO_PRODUCAO] Erro ao atualizar:', error.message);
        res.status(500).json({ message: 'Erro ao atualizar registro', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Buscar detalhes de um registro
// SEGURANÇA: authRequired adicionado — rota era pública
app.get('/api/pcp/gestao-producao/:id', authRequired, async (req, res) => {
    try {
        const { id } = req.params;
        const [registros] = await db.query('SELECT * FROM gestao_producao WHERE id = ?', [id]);

        if (registros.length === 0) {
            return res.status(404).json({ message: 'Registro não encontrado' });
        }

        res.json(registros[0]);
    } catch (error) {
        logger.error('[API_GESTAO_PRODUCAO] Erro:', error.message);
        res.status(500).json({ message: 'Erro ao buscar registro', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// ==================== ROTAS DE APONTAMENTOS DE PRODUÇÃO ====================

// Buscar estatísticas de apontamentos
// 🔒 SECURITY AUDIT: Added authRequired - statistics require authentication
app.get('/api/pcp/apontamentos/stats', authRequired, async (req, res) => {
    console.log('[API_APONTAMENTOS] Buscando estatísticas...');
    try {
        // OPs ativas (em produção ou pendentes)
        const [opsAtivas] = await db.query(`
            SELECT COUNT(*) as total FROM ordens_producao
            WHERE status IN ('ativa', 'em_producao', 'pendente', 'Em Produção', 'Ativa')
        `);

        // OPs em produção
        const [opsEmProducao] = await db.query(`
            SELECT COUNT(*) as total FROM ordens_producao
            WHERE status IN ('em_producao', 'Em Produção')
        `);

        // Apontamentos de hoje
        const [apontamentosHoje] = await db.query(`
            SELECT COUNT(*) as total, COALESCE(SUM(quantidade_produzida), 0) as qtd_produzida
            FROM apontamentos_producao
            WHERE DATE(data_apontamento) = CURDATE()
        `);

        res.json({
            success: true,
            stats: {
                ops_ativas: opsAtivas[0]?.total || 0,
                ops_em_producao: opsEmProducao[0]?.total || 0,
                apontamentos_hoje: apontamentosHoje[0]?.total || 0,
                qtd_produzida_hoje: apontamentosHoje[0]?.qtd_produzida || 0
            }
        });
    } catch (error) {
        console.error('[API_APONTAMENTOS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas' });
    }
});

// Listar OPs para apontamento
// 🔒 SECURITY AUDIT: Added authRequired - order listing requires authentication
app.get('/api/pcp/apontamentos/ordens', authRequired, async (req, res) => {
    console.log('[API_APONTAMENTOS] Listando OPs para apontamento...');
    try {
        const { status } = req.query;

        let whereClause = "WHERE status NOT IN ('concluida', 'Concluída', 'cancelada')";
        if (status === 'ativas') {
            whereClause = "WHERE status IN ('ativa', 'Ativa')";
        } else if (status === 'em_producao') {
            whereClause = "WHERE status IN ('em_producao', 'Em Produção')";
        } else if (status === 'pendentes') {
            whereClause = "WHERE status IN ('pendente', 'Pendente', 'A Fazer')";
        }

        const [ordens] = await db.query(`
            SELECT
                op.id, op.codigo, op.produto_nome, op.quantidade, op.unidade,
                op.status, op.prioridade, op.data_inicio, op.data_prevista,
                op.responsavel, op.progresso,
                (SELECT COUNT(*) FROM etapas_producao ep WHERE ep.ordem_producao_id = op.id) as total_etapas,
                (SELECT COUNT(*) FROM etapas_producao ep WHERE ep.ordem_producao_id = op.id AND ep.status = 'concluida') as etapas_concluidas
            FROM ordens_producao op
            ${whereClause}
            ORDER BY
                CASE op.prioridade
                    WHEN 'critica' THEN 1
                    WHEN 'alta' THEN 2
                    WHEN 'media' THEN 3
                    ELSE 4
                END,
                op.data_prevista ASC
        `);

        res.json({ success: true, data: ordens });
    } catch (error) {
        console.error('[API_APONTAMENTOS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao listar OPs' });
    }
});

// Buscar etapas de uma OP
app.get('/api/pcp/ordens/:id/etapas', authRequired, async (req, res) => {
    const { id } = req.params;
    console.log(`[API_APONTAMENTOS] Buscando etapas da OP ${id}...`);
    try {
        const [etapas] = await db.query(`
            SELECT
                ep.*,
                (SELECT SUM(ap.quantidade_produzida) FROM apontamentos_producao ap WHERE ap.etapa_id = ep.id) as total_produzido,
                (SELECT SUM(ap.quantidade_refugo) FROM apontamentos_producao ap WHERE ap.etapa_id = ep.id) as total_refugo,
                (SELECT SUM(ap.tempo_producao) FROM apontamentos_producao ap WHERE ap.etapa_id = ep.id) as total_tempo
            FROM etapas_producao ep
            WHERE ep.ordem_producao_id = ?
            ORDER BY ep.sequencia ASC
        `, [id]);

        res.json({ success: true, data: etapas });
    } catch (error) {
        console.error('[API_APONTAMENTOS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao buscar etapas' });
    }
});

// Criar etapas padrão para uma OP
app.post('/api/pcp/ordens/:id/etapas/padrao', authRequired, async (req, res) => {
    const { id } = req.params;
    console.log(`[API_APONTAMENTOS] Criando etapas padrão para OP ${id}...`);
    try {
        // Verificar se já existem etapas
        const [existentes] = await db.query('SELECT COUNT(*) as total FROM etapas_producao WHERE ordem_producao_id = ?', [id]);

        if (existentes[0].total > 0) {
            return res.status(400).json({ success: false, message: 'Esta OP já possui etapas cadastradas' });
        }

        // Buscar dados da OP
        const [op] = await db.query('SELECT quantidade FROM ordens_producao WHERE id = ?', [id]);
        if (op.length === 0) {
            return res.status(404).json({ success: false, message: 'OP não encontrada' });
        }

        const quantidade = op[0].quantidade || 0;

        // Etapas padrão
        const etapasPadrao = [
            { nome: 'Corte', sequencia: 1, tempo_previsto_min: 30 },
            { nome: 'Preparação', sequencia: 2, tempo_previsto_min: 45 },
            { nome: 'Montagem', sequencia: 3, tempo_previsto_min: 60 },
            { nome: 'Acabamento', sequencia: 4, tempo_previsto_min: 30 },
            { nome: 'Inspeção', sequencia: 5, tempo_previsto_min: 15 }
        ];

        for (const etapa of etapasPadrao) {
            await db.query(`
                INSERT INTO etapas_producao
                (ordem_producao_id, nome, sequencia, status, quantidade_prevista, tempo_previsto_min)
                VALUES (?, ?, ?, 'pendente', ?, ?)
            `, [id, etapa.nome, etapa.sequencia, quantidade, etapa.tempo_previsto_min]);
        }

        res.json({ success: true, message: `${etapasPadrao.length} etapas criadas com sucesso` });
    } catch (error) {
        console.error('[API_APONTAMENTOS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao criar etapas' });
    }
});

// Registrar apontamento
// 🔒 SECURITY AUDIT: Added authRequired - production reporting requires authentication
app.post('/api/pcp/apontamentos', authRequired, async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const {
            ordem_producao_id,
            etapa_id,
            quantidade_produzida,
            quantidade_refugo,
            operador,
            maquina,
            turno,
            tempo_producao,
            tempo_setup,
            tempo_parada,
            observacoes
        } = req.body;

        // Validações
        if (!ordem_producao_id || !etapa_id) {
            connection.release();
            return res.status(400).json({ success: false, message: 'OP e Etapa são obrigatórios' });
        }

        if (!quantidade_produzida || quantidade_produzida <= 0) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Quantidade produzida deve ser maior que zero' });
        }

        // Inserir apontamento
        const [result] = await connection.query(`
            INSERT INTO apontamentos_producao
            (ordem_producao_id, etapa_id, data_apontamento, quantidade_produzida,
             quantidade_refugo, operador, maquina, turno, tempo_producao,
             tempo_setup, tempo_parada, observacoes)
            VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            ordem_producao_id, etapa_id, quantidade_produzida,
            quantidade_refugo || 0, operador || 'Operador', maquina || '',
            turno || '1', tempo_producao || 0, tempo_setup || 0,
            tempo_parada || 0, observacoes || ''
        ]);

        // Atualizar quantidade produzida na etapa
        await connection.query(`
            UPDATE etapas_producao
            SET quantidade_produzida = COALESCE(quantidade_produzida, 0) + ?,
                tempo_real_min = COALESCE(tempo_real_min, 0) + ?
            WHERE id = ?
        `, [quantidade_produzida, tempo_producao || 0, etapa_id]);

        // Verificar se etapa foi Concluída
        const [etapa] = await connection.query('SELECT quantidade_prevista, quantidade_produzida FROM etapas_producao WHERE id = ?', [etapa_id]);
        if (etapa.length > 0 && etapa[0].quantidade_produzida >= etapa[0].quantidade_prevista) {
            await connection.query("UPDATE etapas_producao SET status = 'concluida', data_fim = NOW() WHERE id = ?", [etapa_id]);
        } else if (etapa.length > 0 && etapa[0].quantidade_produzida > 0) {
            await connection.query("UPDATE etapas_producao SET status = 'em_andamento', data_inicio = COALESCE(data_inicio, NOW()) WHERE id = ?", [etapa_id]);
        }

        // Atualizar progresso da OP
        const [progressoData] = await connection.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as concluidas
            FROM etapas_producao WHERE ordem_producao_id = ?
        `, [ordem_producao_id]);

        if (progressoData.length > 0 && progressoData[0].total > 0) {
            const progresso = Math.round((progressoData[0].concluidas / progressoData[0].total) * 100);
            await connection.query('UPDATE ordens_producao SET progresso = ? WHERE id = ?', [progresso, ordem_producao_id]);

            // Se todas as etapas Concluídas, marcar OP como Concluída
            if (progresso >= 100) {
                await connection.query("UPDATE ordens_producao SET status = 'concluida', data_conclusao = NOW() WHERE id = ?", [ordem_producao_id]);
            } else if (progresso > 0) {
                await connection.query("UPDATE ordens_producao SET status = 'em_producao' WHERE id = ? AND status NOT IN ('concluida', 'cancelada')", [ordem_producao_id]);
            }
        }

        await connection.commit();

        // === NOTIFICAÇÃO PUSH: Emitir para todos os usuários PCP ===
        try {
            if (global.io) {
                global.io.emit('pcp-apontamento-registrado', {
                    tipo: 'apontamento',
                    operador: operador || req.user?.nome || 'Operador',
                    ordem_producao_id,
                    etapa_id,
                    quantidade_produzida,
                    mensagem: `${operador || req.user?.nome || 'Operador'} registrou apontamento na OP #${ordem_producao_id}`,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (notifErr) {
            console.error('[NOTIF_PCP] Erro ao emitir notificação:', notifErr.message);
        }

        res.json({
            success: true,
            message: 'Apontamento registrado com sucesso',
            id: result.insertId
        });
    } catch (error) {
        await connection.rollback();
        console.error('[API_APONTAMENTOS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao registrar apontamento' + (process.env.NODE_ENV === 'development' ? ': ' + error.message : '') });
    } finally {
        connection.release();
    }
});

// Listar apontamentos de uma OP
app.get('/api/pcp/ordens/:id/apontamentos', authRequired, async (req, res) => {
    const { id } = req.params;
    console.log(`[API_APONTAMENTOS] Listando apontamentos da OP ${id}...`);
    try {
        const [apontamentos] = await db.query(`
            SELECT
                ap.*,
                ep.nome as etapa_nome
            FROM apontamentos_producao ap
            LEFT JOIN etapas_producao ep ON ap.etapa_id = ep.id
            WHERE ap.ordem_producao_id = ?
            ORDER BY ap.data_apontamento DESC
        `, [id]);

        res.json({ success: true, data: apontamentos });
    } catch (error) {
        console.error('[API_APONTAMENTOS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao listar apontamentos' });
    }
});

// Atualizar status de uma etapa
// 🔒 SECURITY AUDIT: Added authRequired - stage status update requires authentication
app.put('/api/pcp/etapas/:id/status', authRequired, async (req, res) => {
    const { id } = req.params;
    const { status, operador_nome, maquina } = req.body;
    console.log(`[API_APONTAMENTOS] Atualizando status da etapa ${id} para ${status}...`);
    try {
        let updateFields = 'status = ?';
        let params = [status];

        if (status === 'em_andamento') {
            updateFields += ', data_inicio = COALESCE(data_inicio, NOW())';
        } else if (status === 'concluida') {
            updateFields += ', data_fim = NOW()';
        }

        if (operador_nome) {
            updateFields += ', operador_nome = ?';
            params.push(operador_nome);
        }

        if (maquina) {
            updateFields += ', maquina = ?';
            params.push(maquina);
        }

        params.push(id);

        await db.query(`UPDATE etapas_producao SET ${updateFields} WHERE id = ?`, params);

        res.json({ success: true, message: 'Status atualizado com sucesso' });
    } catch (error) {
        console.error('[API_APONTAMENTOS] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao atualizar status' });
    }
});

// ==================== ROTAS DE RELATÓRIOS PCP ====================

// 1. Cabos mais vendidos (ranking por quantidade e valor)
app.get('/api/pcp/relatorios/cabos-mais-vendidos', authRequired, async (req, res) => {
    try {
        const data_inicio = req.query.data_inicio || req.query.dataInicio;
        const data_fim = req.query.data_fim || req.query.dataFim;
        const maxResults = parseInt(req.query.limit) || 20;
        let whereClause = '';
        let params = [];

        if (data_inicio && data_fim) {
            whereClause = 'WHERE p.created_at BETWEEN ? AND ?';
            params = [data_inicio, data_fim];
        }

        // Buscar itens de pedidos agrupados por produto (cabos)
        const [porQuantidade] = await db.query(`
            SELECT
                pi.codigo,
                pi.descricao,
                SUM(pi.quantidade) as total_quantidade,
                pi.unidade,
                SUM(pi.subtotal) as total_valor,
                COUNT(DISTINCT pi.pedido_id) as total_pedidos,
                AVG(pi.preco_unitario) as preco_medio
            FROM pedido_itens pi
            LEFT JOIN pedidos p ON pi.pedido_id = p.id
            ${whereClause}
            GROUP BY pi.codigo, pi.descricao, pi.unidade
            ORDER BY total_quantidade DESC
            LIMIT ?
        `, [...params, maxResults]);

        // Buscar também por valor total vendido
        const [porValor] = await db.query(`
            SELECT
                pi.codigo,
                pi.descricao,
                SUM(pi.quantidade) as total_quantidade,
                pi.unidade,
                SUM(pi.subtotal) as total_valor,
                COUNT(DISTINCT pi.pedido_id) as total_pedidos,
                AVG(pi.preco_unitario) as preco_medio
            FROM pedido_itens pi
            LEFT JOIN pedidos p ON pi.pedido_id = p.id
            ${whereClause}
            GROUP BY pi.codigo, pi.descricao, pi.unidade
            ORDER BY total_valor DESC
            LIMIT ?
        `, [...params, maxResults]);

        // Resumo geral
        const [resumo] = await db.query(`
            SELECT
                COUNT(DISTINCT pi.codigo) as total_produtos_vendidos,
                SUM(pi.quantidade) as quantidade_total,
                SUM(pi.subtotal) as valor_total,
                COUNT(DISTINCT pi.pedido_id) as total_pedidos
            FROM pedido_itens pi
            LEFT JOIN pedidos p ON pi.pedido_id = p.id
            ${whereClause}
        `, params);

        // Também buscar da tabela ordens_producao para complementar
        let whereOP = '';
        let paramsOP = [];
        if (data_inicio && data_fim) {
            whereOP = 'WHERE data_inicio BETWEEN ? AND ?';
            paramsOP = [data_inicio, data_fim];
        }

        const [ordensProducao] = await db.query(`
            SELECT
                produto_nome,
                codigo,
                SUM(quantidade) as total_quantidade,
                SUM(metragem) as total_metragem,
                COUNT(*) as total_ordens,
                unidade
            FROM ordens_producao
            ${whereOP}
            GROUP BY produto_nome, codigo, unidade
            ORDER BY total_quantidade DESC
            LIMIT ?
        `, [...paramsOP, maxResults]);

        res.json({
            success: true,
            ranking_por_quantidade: porQuantidade,
            ranking_por_valor: porValor,
            ordens_producao: ordensProducao,
            resumo: resumo[0] || {},
            periodo: { data_inicio, data_fim }
        });
    } catch (err) {
        console.error('[PCP_RELATORIOS] Erro cabos mais vendidos:', err.message);
        res.status(500).json({ success: false, message: 'Erro ao gerar relatório de cabos mais vendidos.' });
    }
});

// 2. Ranking de vendas (por vendedor, cliente, produto)
app.get('/api/pcp/relatorios/ranking-vendas', authRequired, async (req, res) => {
    try {
        const { data_inicio, data_fim, agrupar } = req.query;
        let whereClause = '';
        let params = [];

        if (data_inicio && data_fim) {
            whereClause = 'WHERE p.data_pedido BETWEEN ? AND ?';
            params = [data_inicio, data_fim];
        }

        // Ranking por vendedor
        const [porVendedor] = await db.query(`
            SELECT
                COALESCE(p.vendedor_nome, 'Não informado') as vendedor,
                COUNT(*) as total_pedidos,
                SUM(p.valor_total) as valor_total,
                AVG(p.valor_total) as ticket_medio,
                COUNT(CASE WHEN p.status = 'faturado' THEN 1 END) as pedidos_faturados,
                COUNT(CASE WHEN p.status = 'aprovado' THEN 1 END) as pedidos_aprovados
            FROM pedidos p
            ${whereClause}
            GROUP BY p.vendedor_nome
            ORDER BY valor_total DESC
            LIMIT 20
        `, params);

        // Ranking por cliente
        const [porCliente] = await db.query(`
            SELECT
                COALESCE(p.cliente_nome, 'Não informado') as cliente,
                COUNT(*) as total_pedidos,
                SUM(p.valor_total) as valor_total,
                AVG(p.valor_total) as ticket_medio,
                MAX(p.data_pedido) as ultimo_pedido
            FROM pedidos p
            ${whereClause}
            GROUP BY p.cliente_nome
            ORDER BY valor_total DESC
            LIMIT 20
        `, params);

        // Total geral de vendas
        const [totais] = await db.query(`
            SELECT
                COUNT(*) as total_pedidos,
                SUM(p.valor_total) as valor_total,
                AVG(p.valor_total) as ticket_medio,
                COUNT(DISTINCT p.vendedor_nome) as total_vendedores,
                COUNT(DISTINCT p.cliente_nome) as total_clientes
            FROM pedidos p
            ${whereClause}
        `, params);

        // Evolução mensal
        const [evolucaoMensal] = await db.query(`
            SELECT
                DATE_FORMAT(p.data_pedido, '%Y-%m') as mes,
                COUNT(*) as total_pedidos,
                SUM(p.valor_total) as valor_total
            FROM pedidos p
            ${whereClause.length > 0 ? whereClause : 'WHERE p.data_pedido IS NOT NULL'}
            GROUP BY DATE_FORMAT(p.data_pedido, '%Y-%m')
            ORDER BY mes DESC
            LIMIT 12
        `, params);

        res.json({
            success: true,
            por_vendedor: porVendedor,
            por_cliente: porCliente,
            evolucao_mensal: evolucaoMensal.reverse(),
            totais: totais[0] || {},
            periodo: { data_inicio, data_fim }
        });
    } catch (err) {
        console.error('[PCP_RELATORIOS] Erro ranking vendas:', err.message);
        res.status(500).json({ success: false, message: 'Erro ao gerar ranking de vendas.' });
    }
});

// 3. Metros produzidos por dia
app.get('/api/pcp/relatorios/metros-produzidos', authRequired, async (req, res) => {
    try {
        const { data_inicio, data_fim } = req.query;

        // Usar últimos 30 dias como padrão
        const fim = data_fim || new Date().toISOString().slice(0, 10);
        const inicio = data_inicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // Metros a partir de apontamentos de produção
        const [apontamentosDiarios] = await db.query(`
            SELECT
                DATE(ap.data_apontamento) as data,
                SUM(ap.quantidade_produzida) as quantidade_produzida,
                SUM(ap.tempo_producao) as tempo_total_min,
                COUNT(*) as total_apontamentos,
                GROUP_CONCAT(DISTINCT ap.maquina SEPARATOR ', ') as maquinas,
                GROUP_CONCAT(DISTINCT ap.operador SEPARATOR ', ') as operadores
            FROM apontamentos_producao ap
            WHERE ap.data_apontamento BETWEEN ? AND ?
            GROUP BY DATE(ap.data_apontamento)
            ORDER BY data ASC
        `, [inicio, fim]);

        // Metragem a partir de ordens de produção concluídas
        const [ordensConcluidasDia] = await db.query(`
            SELECT
                DATE(COALESCE(data_conclusao, data_inicio)) as data,
                SUM(metragem) as total_metragem,
                SUM(quantidade) as total_quantidade,
                COUNT(*) as total_ordens,
                GROUP_CONCAT(DISTINCT produto_nome SEPARATOR ', ') as produtos
            FROM ordens_producao
            WHERE (data_conclusao BETWEEN ? AND ? OR data_inicio BETWEEN ? AND ?)
            GROUP BY DATE(COALESCE(data_conclusao, data_inicio))
            ORDER BY data ASC
        `, [inicio, fim, inicio, fim]);

        // Resumo do período
        const [resumoApontamentos] = await db.query(`
            SELECT
                SUM(quantidade_produzida) as total_produzido,
                AVG(quantidade_produzida) as media_diaria,
                MAX(quantidade_produzida) as max_dia,
                MIN(quantidade_produzida) as min_dia,
                SUM(tempo_producao) as tempo_total,
                COUNT(DISTINCT DATE(data_apontamento)) as dias_com_producao
            FROM apontamentos_producao
            WHERE data_apontamento BETWEEN ? AND ?
        `, [inicio, fim]);

        const [resumoOrdens] = await db.query(`
            SELECT
                SUM(metragem) as total_metragem,
                SUM(quantidade) as total_quantidade,
                COUNT(*) as total_ordens,
                COUNT(CASE WHEN status = 'Concluído' OR status = 'concluido' THEN 1 END) as ordens_concluidas,
                COUNT(CASE WHEN status = 'Em Produção' OR status = 'em_producao' THEN 1 END) as ordens_em_producao
            FROM ordens_producao
            WHERE data_inicio BETWEEN ? AND ? OR data_conclusao BETWEEN ? AND ?
        `, [inicio, fim, inicio, fim]);

        res.json({
            success: true,
            apontamentos_diarios: apontamentosDiarios,
            ordens_por_dia: ordensConcluidasDia,
            resumo_apontamentos: resumoApontamentos[0] || {},
            resumo_ordens: resumoOrdens[0] || {},
            periodo: { data_inicio: inicio, data_fim: fim }
        });
    } catch (err) {
        console.error('[PCP_RELATORIOS] Erro metros produzidos:', err.message);
        res.status(500).json({ success: false, message: 'Erro ao gerar relatório de metros produzidos.' });
    }
});

// 4. Faturamento mensal
app.get('/api/pcp/relatorios/faturamento-mensal', authRequired, async (req, res) => {
    try {
        const { ano } = req.query;
        const anoFiltro = parseInt(ano) || new Date().getFullYear();

        // Faturamento mensal a partir de pedidos faturados
        const [faturamentoPF] = await db.query(`
            SELECT
                DATE_FORMAT(data_faturamento, '%Y-%m') as mes,
                MONTH(data_faturamento) as mes_num,
                COUNT(*) as total_pedidos,
                SUM(total) as valor_total,
                AVG(total) as ticket_medio
            FROM pedidos_faturados
            WHERE YEAR(data_faturamento) = ?
            GROUP BY DATE_FORMAT(data_faturamento, '%Y-%m'), MONTH(data_faturamento)
            ORDER BY mes_num ASC
        `, [anoFiltro]);

        // Faturamento a partir de pedidos com status faturado
        const [faturamentoPedidos] = await db.query(`
            SELECT
                DATE_FORMAT(p.data_pedido, '%Y-%m') as mes,
                MONTH(p.data_pedido) as mes_num,
                COUNT(*) as total_pedidos,
                SUM(p.valor_total) as valor_total,
                AVG(p.valor_total) as ticket_medio
            FROM pedidos p
            WHERE p.status IN ('faturado', 'entregue', 'convertido')
            AND YEAR(p.data_pedido) = ?
            GROUP BY DATE_FORMAT(p.data_pedido, '%Y-%m'), MONTH(p.data_pedido)
            ORDER BY mes_num ASC
        `, [anoFiltro]);

        // Comparação com ano anterior
        const [faturamentoAnoAnterior] = await db.query(`
            SELECT
                SUM(total) as valor_total,
                COUNT(*) as total_pedidos
            FROM pedidos_faturados
            WHERE YEAR(data_faturamento) = ?
        `, [anoFiltro - 1]);

        const [faturamentoAnoAtual] = await db.query(`
            SELECT
                SUM(total) as valor_total,
                COUNT(*) as total_pedidos
            FROM pedidos_faturados
            WHERE YEAR(data_faturamento) = ?
        `, [anoFiltro]);

        // Top clientes no faturamento
        const [topClientes] = await db.query(`
            SELECT
                cliente,
                COUNT(*) as total_pedidos,
                SUM(total) as valor_total
            FROM pedidos_faturados
            WHERE YEAR(data_faturamento) = ?
            GROUP BY cliente
            ORDER BY valor_total DESC
            LIMIT 10
        `, [anoFiltro]);

        const totalAtual = faturamentoAnoAtual[0]?.valor_total || 0;
        const totalAnterior = faturamentoAnoAnterior[0]?.valor_total || 0;
        const variacao = totalAnterior > 0 ? ((totalAtual - totalAnterior) / totalAnterior * 100).toFixed(2) : 0;

        res.json({
            success: true,
            faturamento_mensal: faturamentoPF,
            faturamento_pedidos: faturamentoPedidos,
            top_clientes: topClientes,
            resumo: {
                ano: anoFiltro,
                valor_total_ano: totalAtual,
                total_pedidos_ano: faturamentoAnoAtual[0]?.total_pedidos || 0,
                valor_ano_anterior: totalAnterior,
                variacao_percentual: `${variacao}%`
            }
        });
    } catch (err) {
        console.error('[PCP_RELATORIOS] Erro faturamento mensal:', err.message);
        res.status(500).json({ success: false, message: 'Erro ao gerar relatório de faturamento mensal.' });
    }
});

// ============================================================
// NOTIFICAÇÃO PUSH: Início/Pausa/Retomada/Finalização de Atividade
// ============================================================
app.post('/api/pcp/notificar-atividade', authRequired, async (req, res) => {
    try {
        const { tipo_atividade, nome_atividade, operador, acao, duracao } = req.body;
        const nomeOperador = operador || req.user?.nome || req.user?.name || 'Operador';
        const acaoTexto = acao || 'iniciou';

        if (!tipo_atividade || !nome_atividade) {
            return res.status(400).json({ success: false, message: 'Tipo e nome da atividade são obrigatórios' });
        }

        // Montar mensagem conforme a ação
        let mensagem = `${nomeOperador} ${acaoTexto} ${nome_atividade}`;
        if (duracao) {
            mensagem += ` (Duração: ${duracao})`;
        }

        // Emitir via Socket.IO para todos os clientes conectados
        if (global.io) {
            global.io.emit('pcp-atividade-iniciada', {
                tipo: tipo_atividade,
                nome: nome_atividade,
                operador: nomeOperador,
                acao: acaoTexto,
                duracao: duracao || null,
                mensagem: mensagem,
                timestamp: new Date().toISOString()
            });
        }

        // Salvar notificação no banco para persistência
        try {
            const tituloMap = {
                'iniciou': 'Atividade Iniciada',
                'pausou': 'Atividade Pausada',
                'retomou': 'Atividade Retomada',
                'finalizou': 'Atividade Finalizada'
            };
            const titulo = `${tituloMap[acaoTexto] || 'Atividade'}: ${nome_atividade}`;

            await db.query(`
                INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo, modulo, prioridade, entidade_tipo)
                VALUES (NULL, ?, ?, 'info', 'pcp', 2, 'apontamento')
            `, [titulo, mensagem + ` às ${new Date().toLocaleTimeString('pt-BR')}`]);
        } catch (dbErr) {
            console.warn('[NOTIF_PCP] Aviso ao salvar no banco:', dbErr.message);
        }

        res.json({ success: true, message: 'Notificação enviada' });
    } catch (error) {
        console.error('[NOTIF_PCP] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao enviar notificação' });
    }
});

// Buscar notificações PCP recentes (para o bell)
app.get('/api/pcp/notificacoes', authRequired, async (req, res) => {
    try {
        const [notificacoes] = await db.query(`
            SELECT id, titulo, mensagem, tipo, modulo, prioridade, lida, created_at
            FROM notificacoes
            WHERE modulo = 'pcp' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ORDER BY created_at DESC
            LIMIT 50
        `);
        res.json({ success: true, notificacoes });
    } catch (error) {
        // Se tabela não existir, retornar vazio
        res.json({ success: true, notificacoes: [] });
    }
});

// ============================================================
// APONTAMENTOS CHÃO DE FÁBRICA (Timer-based)
// ============================================================

// Garantir que a tabela existe
(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS apontamentos_chao_fabrica (
                id INT PRIMARY KEY AUTO_INCREMENT,
                usuario_id INT,
                usuario_nome VARCHAR(100),
                usuario_email VARCHAR(150),
                tipo_atividade VARCHAR(20) NOT NULL,
                nome_atividade VARCHAR(100) NOT NULL,
                hora_inicio DATETIME NOT NULL,
                hora_fim DATETIME,
                duracao_segundos INT DEFAULT 0,
                data DATE,
                pedido_numero VARCHAR(50),
                produto_descricao VARCHAR(255),
                observacoes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_usuario_data (usuario_id, data),
                INDEX idx_tipo_data (tipo_atividade, data),
                INDEX idx_data (data)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[PCP] Tabela apontamentos_chao_fabrica verificada/criada');
    } catch (e) {
        console.warn('[PCP] Aviso ao criar tabela apontamentos_chao_fabrica:', e.message);
    }
})();

// POST: Salvar apontamento do chão de fábrica (timer)
app.post('/api/pcp/apontamentos/chao', authRequired, async (req, res) => {
    try {
        const {
            tipo_atividade, nome_atividade, hora_inicio, hora_fim,
            duracao_segundos, pedido_numero, produto_descricao, observacoes
        } = req.body;

        if (!tipo_atividade || !nome_atividade) {
            return res.status(400).json({ success: false, message: 'Tipo e nome da atividade são obrigatórios' });
        }

        const userId = req.user?.id || null;
        const userName = req.user?.nome || req.user?.name || 'Operador';
        const userEmail = req.user?.email || '';
        const dataApontamento = hora_inicio ? new Date(hora_inicio).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

        const [result] = await db.query(`
            INSERT INTO apontamentos_chao_fabrica
            (usuario_id, usuario_nome, usuario_email, tipo_atividade, nome_atividade,
             hora_inicio, hora_fim, duracao_segundos, data, pedido_numero,
             produto_descricao, observacoes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            userId, userName, userEmail, tipo_atividade, nome_atividade,
            hora_inicio ? new Date(hora_inicio) : new Date(),
            hora_fim ? new Date(hora_fim) : new Date(),
            duracao_segundos || 0, dataApontamento,
            pedido_numero || '', produto_descricao || '', observacoes || ''
        ]);

        // Emitir notificação de registro finalizado
        if (global.io) {
            global.io.emit('pcp-atividade-iniciada', {
                tipo: tipo_atividade,
                nome: nome_atividade,
                operador: userName,
                acao: 'finalizou',
                duracao: formatarDuracaoServer(duracao_segundos),
                mensagem: `${userName} finalizou ${nome_atividade} (${formatarDuracaoServer(duracao_segundos)})`,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`[APONTAMENTO_CHAO] Salvo: ${userName} - ${nome_atividade} (${duracao_segundos}s)`);
        res.json({ success: true, message: 'Apontamento salvo', id: result.insertId });
    } catch (error) {
        console.error('[APONTAMENTO_CHAO] Erro:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao salvar apontamento' + (process.env.NODE_ENV === 'development' ? ': ' + error.message : '') });
    }
});

// GET: Meus apontamentos de hoje (para o operador)
app.get('/api/pcp/apontamentos/meus', authRequired, async (req, res) => {
    try {
        const data = req.query.data || new Date().toISOString().split('T')[0];
        const userId = req.user?.id || null;
        const userName = req.user?.nome || req.user?.name || '';

        let query = `
            SELECT id, tipo_atividade as tipo, nome_atividade as nome,
                   TIME_FORMAT(hora_inicio, '%H:%i') as hora_inicio,
                   TIME_FORMAT(hora_fim, '%H:%i') as hora_fim,
                   duracao_segundos as duracao, data, pedido_numero,
                   produto_descricao, observacoes
            FROM apontamentos_chao_fabrica
            WHERE data = ?
        `;
        const params = [data];

        if (userId) {
            query += ' AND usuario_id = ?';
            params.push(userId);
        } else if (userName) {
            query += ' AND usuario_nome = ?';
            params.push(userName);
        }

        query += ' ORDER BY hora_inicio DESC';

        const [apontamentos] = await db.query(query, params);
        res.json({ success: true, apontamentos });
    } catch (error) {
        console.error('[APONTAMENTO_MEUS] Erro:', error.message);
        // Se tabela não existir, retornar vazio
        res.json({ success: true, apontamentos: [] });
    }
});

// GET: Relatório de apontamentos (para supervisores)
app.get('/api/pcp/apontamentos/relatorio', authRequired, async (req, res) => {
    try {
        const { dataInicio, dataFim, usuario, atividade, pedido } = req.query;
        const inicio = dataInicio || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const fim = dataFim || new Date().toISOString().split('T')[0];

        let whereClause = 'WHERE data BETWEEN ? AND ?';
        const params = [inicio, fim];

        if (usuario) {
            whereClause += ' AND usuario_id = ?';
            params.push(usuario);
        }
        if (atividade) {
            whereClause += ' AND tipo_atividade = ?';
            params.push(atividade);
        }
        if (pedido) {
            whereClause += ' AND pedido_numero LIKE ?';
            params.push(`%${pedido}%`);
        }

        // Buscar apontamentos
        const [apontamentos] = await db.query(`
            SELECT
                id, usuario_id, usuario_nome, usuario_email,
                tipo_atividade as tipo, nome_atividade as nome,
                TIME_FORMAT(hora_inicio, '%H:%i') as hora_inicio,
                TIME_FORMAT(hora_fim, '%H:%i') as hora_fim,
                duracao_segundos as duracao, data, pedido_numero,
                produto_descricao, observacoes,
                NULL as usuario_foto, NULL as op_codigo
            FROM apontamentos_chao_fabrica
            ${whereClause}
            ORDER BY data DESC, hora_inicio DESC
        `, params);

        // Buscar lista de funcionários distintos
        const [funcionarios] = await db.query(`
            SELECT DISTINCT usuario_id as id, usuario_nome as nome, usuario_email as email
            FROM apontamentos_chao_fabrica
            WHERE data BETWEEN ? AND ?
            ORDER BY usuario_nome
        `, [inicio, fim]);

        // Calcular totais
        const totalHoras = Math.round(apontamentos.reduce((acc, a) => acc + (a.duracao || 0), 0) / 3600 * 10) / 10;
        const prodTipos = ['1', '1A'];
        const horasProducao = Math.round(apontamentos.filter(a => prodTipos.includes(a.tipo)).reduce((acc, a) => acc + (a.duracao || 0), 0) / 3600 * 10) / 10;

        res.json({
            success: true,
            apontamentos,
            funcionarios,
            totalFuncionarios: funcionarios.length,
            totalHoras,
            horasProducao,
            totalApontamentos: apontamentos.length
        });
    } catch (error) {
        console.error('[RELATORIO_APONTAMENTOS] Erro:', error.message);
        // Se tabela não existir, retornar vazio
        res.json({
            success: true, apontamentos: [], funcionarios: [],
            totalFuncionarios: 0, totalHoras: 0, horasProducao: 0, totalApontamentos: 0
        });
    }
});

// Função auxiliar para formatar duração no servidor
function formatarDuracaoServer(segundos) {
    if (!segundos) return '00:00:00';
    const h = Math.floor(segundos / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    const s = segundos % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- Proxy missing routes to main app (port 3003) ---
// These routes exist in pcp-routes.js (main app) but not here
const httpProxy = require('http');
function proxyToMainApp(req, res) {
    const options = {
        hostname: '127.0.0.1', port: 3003, path: req.originalUrl,
        method: req.method, headers: { ...req.headers, host: '127.0.0.1:3003' }
    };
    const proxy = httpProxy.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });
    proxy.on('error', () => res.status(502).json({ error: 'Main app unavailable' }));
    req.pipe(proxy, { end: true });
}
app.get('/api/pcp/pedidos/:id/materiais', proxyToMainApp);
app.get('/api/pcp/ordens-producao/:id/itens', proxyToMainApp);
app.get('/api/pcp/ordens-producao/:id/etiqueta-bobina', proxyToMainApp);
app.get('/api/pcp/ordens-producao/:id/etiqueta-produto', proxyToMainApp);

// Serve shared assets from root _shared directory
app.use('/_shared', express.static(path.join(__dirname, '../../_shared'), { dotfiles: 'deny', index: false }));

// Serve static files (after ALL API routes) so API endpoints are not shadowed by static fallback
app.use(express.static(__dirname, { dotfiles: 'deny', index: false }));

// API JSON 404 handler: make sure any unmatched /api routes return JSON (not HTML)
app.use((req, res, next) => {
    if (req.isApi) {
        return res.status(404).json({ message: 'API endpoint not found' });
    }
    next();
});

// Error handling centralizado (Sprint 7)
app.use(errorHandler);






