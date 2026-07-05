// =================================================================
// SERVIDOR UNIFICADO - ALUFORCE v2.0
// Combina funcionalidades de server.js e server-improved.js
// =================================================================
'use strict';

// ⚡ MEDIÇÃO DE TEMPO DE INICIALIZAÇÃO
const SERVER_START_TIME = Date.now();
console.log('🚀 Iniciando ALUFORCE v2.0...\n');

// Detectar se está rodando em modo empacotado (Electron)
const isPackaged = __dirname.includes('app.asar') || process.env.NODE_ENV === 'production';
if (isPackaged) {
    console.log('📦 Modo empacotado detectado');
}

// =================================================================
// 1. IMPORTAÇÕES DE MÓDULOS
// =================================================================

// AUDIT-FIX R-21: Sanitização de PII em logs (ativar antes de qualquer output)
try {
    const { installPIISanitizer } = require('./utils/pii-sanitizer');
    installPIISanitizer();
} catch (e) {
    console.warn('[PII] Sanitizador não disponível:', e.message);
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cron = require('node-cron');
const mysql = require('mysql2/promise');
const path = require('path');
const nodemailer = require('nodemailer');
const { spawn } = require('child_process');
const compression = require('compression'); // PERFORMANCE: Compressão gzip

// Carrega variáveis de ambiente de um arquivo .env (se existir)
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

// ⚡ VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE NO STARTUP
try {
    const { validateEnv } = require('./config/env');
    validateEnv();
} catch (e) {
    console.warn('[ENV] Validação não executada:', e.message);
}

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const authRouter = require('./src/routes/auth');
const userPermissions = require('./src/permissions-server');
const logger = require('./src/logger');
const rateLimit = require('express-rate-limit');

// Importar security middleware centralizado
const {
    generalLimiter,
    authLimiter,
    apiLimiter,
    sanitizeInput,
    securityHeaders,
    csrfProtection,
    cleanExpiredSessions
} = require('./security-middleware');

// Importar middlewares de segurança avançados (Auditoria 30/01/2026)
const {
    applySecurityMiddlewares,
    logAdminAction
} = require('./src/middleware/security-integration');

// AUDIT-FIX R-01: Sistema de autenticação unificado

// Zyntra Branding Middleware (ativado via env BRAND=zyntra)
const { zyntraBrandingMiddleware, zyntraBrandInfo, transformHtml } = require('./middleware/zyntra-branding');

// AUDIT-FIX R-17/R-18/R-19/R-20: Módulo LGPD compliance
const { createLGPDRouter } = require('./routes/lgpd');

// Importar express-validator para validação de dados
const { body, param, query, validationResult } = require('express-validator');

// Importar UUID para gerar deviceId único (MULTI-DEVICE)
const { v4: uuidv4 } = require('uuid');

// Request-ID tracing middleware (observability)
const { requestIdMiddleware } = require('./middleware/request-id');

// ⚡ ENTERPRISE: Cache distribuído (Redis/Map) e Resiliência
const cacheService = require('./services/cache');
const { wrapPoolWithTimeout, CircuitBreaker, requestTimeout, createPoolMonitor, createHealthEndpoint } = require('./services/resilience');
const { initRateLimitRedis } = require('./services/rate-limiter-redis');
const { smtpBreaker, discordBreaker, n8nBreaker, getAllBreakerStates } = require('./services/external-breakers');

// 📊 ENTERPRISE: Prometheus Metrics (HTTP histograms, DB pool, cache, business KPIs)
const { metricsMiddleware, createMetricsEndpoint, trackDBQuery, trackCacheHit, trackCacheMiss, trackBusinessEvent, trackError } = require('./services/metrics');

// 🤖 DISCORD: Notificações em tempo real via Webhook
let discordBot;
try {
    discordBot = require('./services/discord-notifier');
} catch (e) {
    console.warn('[Discord] Notifier não disponível:', e.message);
}

// 🤖 N8N: Integração com n8n Workflow Automation
let n8nIntegration;
try {
    const { getN8nIntegration } = require('./services/n8n-integration');
    n8nIntegration = getN8nIntegration();
} catch (e) {
    console.warn('[n8n] Integration não disponível:', e.message);
}

// 📊 N8N: Middleware interceptor de relatórios → notificação email
let reportInterceptorMiddleware;
try {
    const { reportInterceptor } = require('./middleware/report-interceptor');
    reportInterceptorMiddleware = reportInterceptor();
    console.log('✅ Report Interceptor n8n carregado');
} catch (e) {
    console.warn('[n8n] Report Interceptor não disponível:', e.message);
}

// Função utilitária para parse seguro de JSON
function safeParseJSON(str, fallback = null) {
    if (!str) return fallback;
    if (typeof str === 'object') return str;
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

// =================================================================
// 2. CONFIGURAÇÕES INICIAIS E VARIÁVEIS GLOBAIS
// =================================================================

// PRODUÇÃO: Silenciar console.log para evitar vazamento de dados e melhorar performance
// console.error e console.warn continuam funcionando normalmente
if (process.env.NODE_ENV === 'production') {
    const _originalLog = console.log;
    console.log = function (...args) {
        // Em produção, só loga se for startup crítico (primeiros 30s)
        // Depois disso, silencia para evitar logs volumosos
        if (process.uptime && process.uptime() < 30) {
            _originalLog.apply(console, args);
        }
        // Silenciado em produção após startup
    };
}

// Middleware para capturar erros async
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// =================================================================
const app = express();

// Trust proxy - necessário quando atrás de Nginx/reverse proxy
// Isso permite que express-rate-limit e outros middlewares identifiquem corretamente o IP real do cliente
app.set('trust proxy', 1);

const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// reference to the running http.Server (set when app.listen is called)
let serverInstance = null;
let DB_AVAILABLE = true;

// AUDIT-FIX: JWT secret MUST come from env. Dev gets ephemeral random secret (tokens won't survive restart).
const JWT_SECRET = process.env.JWT_SECRET || (() => {
    const devSecret = require('crypto').randomBytes(64).toString('hex');
    console.warn('⚠️  JWT_SECRET não definida — usando segredo efêmero (tokens invalidados a cada restart)');
    return devSecret;
})();

// Validar JWT Secret em produção
if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET) {
        logger.error('FATAL: variável de ambiente JWT_SECRET não definida. Em produção, JWT_SECRET é obrigatória.');
        process.exit(1);
    }
    if (JWT_SECRET.length < 32) {
        logger.error('FATAL: JWT_SECRET deve ter pelo menos 32 caracteres em produção.');
        process.exit(1);
    }
}

// =================================================================
// 2.1. CONFIGURAÇÃO DE EMAIL (NODEMAILER)
// =================================================================

// Configurar transporter do Nodemailer
let emailTransporter = null;

// Função para inicializar o transporter de email
function initEmailTransporter() {
    try {
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            logger.warn('[EMAIL] ⚠️  SMTP_USER/SMTP_PASS não definidos — emails desabilitados');
            return;
        }
        emailTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            tls: {
                rejectUnauthorized: false // mail.aluforce.ind.br usa cert do hospedador, não valida SNI estrito
            }
        });

        // Verificar conexão SMTP
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            emailTransporter.verify((error, success) => {
                if (error) {
                    logger.warn('[EMAIL] ⚠️  SMTP não configurado ou erro na conexão:', error.message);
                    logger.warn('[EMAIL] 📧 Emails não serão enviados. Configure variáveis de ambiente SMTP_*');
                } else {
                    logger.info('[EMAIL] ✅ Servidor SMTP configurado e pronto para enviar emails');
                }
            });
        } else {
            logger.warn('[EMAIL] ⚠️  Credenciais SMTP não configuradas. Emails não serão enviados.');
            logger.warn('[EMAIL] 💡 Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS no .env');
        }
    } catch (error) {
        logger.error('[EMAIL] ❌ Erro ao inicializar Nodemailer:', error);
    }
}

// Inicializar email transporter
initEmailTransporter();

// Função auxiliar para enviar emails
async function sendEmail(to, subject, html, text) {
    if (!emailTransporter || !process.env.SMTP_USER) {
        logger.warn(`[EMAIL] Email não enviado (SMTP não configurado): ${subject}`);
        return { success: false, error: 'SMTP não configurado' };
    }

    try {
        const info = await smtpBreaker.execute(() => emailTransporter.sendMail({
            from: `"ALUFORCE Sistema" <${process.env.SMTP_USER}>`,
            to: to,
            subject: subject,
            text: text || html.replace(/<[^>]*>/g, ''), // Fallback text
            html: html
        }));

        logger.info(`[EMAIL] ✅ Email enviado: ${subject} → ${to} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error(`[EMAIL] ❌ Erro ao enviar email: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// =================================================================
// 3. MIDDLEWARES DE AUTORIZAÇÃO (declarados antes de serem usados)
// =================================================================

// Middleware para validar resultado das validações
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            message: 'Dados inválidos',
            errors: errors.array()
        });
    }
    next();
};

// Validações para fornecedores
const fornecedorValidation = [
    body('nome').isString().notEmpty().withMessage('Nome é obrigatório'),
    body('cnpj').isString().notEmpty().withMessage('CNPJ é obrigatório'),
    body('email').optional().isEmail().withMessage('Email inválido'),
    body('telefone').optional().isString(),
    body('endereco').optional().isString(),
    body('contato_principal').optional().isString(),
    body('ativo').optional().isBoolean(),
    validate
];

// Validações para pedidos de compra
const pedidoValidation = [
    body('fornecedor_id').isInt().withMessage('Fornecedor é obrigatório'),
    body('itens').isArray({ min: 1 }).withMessage('Itens são obrigatórios'),
    body('itens.*.descricao').isString().notEmpty().withMessage('Descrição do item é obrigatória'),
    body('itens.*.quantidade').isNumeric().withMessage('Quantidade do item deve ser numérica'),
    body('itens.*.preco_unitario').isNumeric().withMessage('Preço unitário do item deve ser numérico'),
    body('observacoes').optional().isString(),
    validate
];

// [REFACTORED 10/03/2026] Delegado para middleware/auth-central.js
const authCentral = require('./middleware/auth-central');
const authorizeAdmin = authCentral.requireAdminOrRH;

// [REFACTORED 10/03/2026] Cache e lógica movidos para services/permission.service.js
// Expondo global._permCache para backward compat (auth-rbac.js pode invalidar)
global._permCache = authCentral.permissionService._moduleCache || new Map();
const PERM_CACHE_TTL = 5 * 60 * 1000; // 5 min (lido por outros módulos)

// Função mantida para backward compat (usada pelo authorizeACL e authenticatePage)
async function getDbAreas(userId) {
    if (!pool || !userId) return null;
    const modules = await authCentral.permissionService.getUserModules(pool, userId);
    return modules && modules.size > 0 ? modules : null;
}

// [REFACTORED 10/03/2026] Delegado para middleware/auth-central.js
const authorizeArea = authCentral.requireModule;


// [REFACTORED 10/03/2026] Action cache movido para services/permission.service.js
global._actionCache = authCentral.permissionService._actionCache || new Map();

// [REFACTORED 10/03/2026] Delegado para middleware/auth-central.js
const authorizeAction = authCentral.requireAction;

// Configuração do Banco de Dados (use variáveis de ambiente para testes/produção)
// Permite sobrescrever host/user/password/database sem editar o código.

// ⚠️ VALIDAÇÃO DE SEGURANÇA - DB_PASSWORD obrigatório em TODOS os ambientes
if (!process.env.DB_PASSWORD) {
    logger.error('❌ ERRO CRÍTICO: DB_PASSWORD não definido');
    logger.error('💡 Configure DB_PASSWORD no arquivo .env');
    logger.error('📋 Exemplo: DB_PASSWORD=sua_senha_segura');
    process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
    const dbPass = process.env.DB_PASSWORD || '';
    if (dbPass.length < 12 || !/[A-Z]/.test(dbPass) || !/[a-z]/.test(dbPass) || !/[0-9]/.test(dbPass)) {
        logger.error('❌ ERRO CRÍTICO: Senha do banco insegura para produção');
        logger.error('💡 Use uma senha forte com pelo menos 12 caracteres, incluindo maiúsculas, minúsculas e números');
        process.exit(1);
    }
}

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD, // OBRIGATÓRIO - sem fallback por segurança
    database: process.env.DB_NAME || 'aluforce_vendas',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONN_LIMIT) || 25, // Limite seguro abaixo do max_connections padrão do MySQL (151)
    queueLimit: parseInt(process.env.DB_QUEUE_LIMIT) || 500, // ENTERPRISE: Fila ampla para picos
    // ⚡ ENTERPRISE: Otimizações de performance
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 10000,
    maxIdle: 50, // Manter 50 conexões idle para resposta rápida
    idleTimeout: 60000, // Liberar conexões idle após 60s
    timezone: '+00:00',
    multipleStatements: false,
    dateStrings: true,
    charset: 'utf8mb4',
    // ENTERPRISE: Named placeholders para queries complexas
    namedPlaceholders: true
};

// Criação do Pool de Conexão com o Banco de Dados
let pool;
try {
    pool = mysql.createPool(DB_CONFIG);

    // ⚡ ENTERPRISE: Wrap pool with automatic query timeout (15s)
    wrapPoolWithTimeout(pool, parseInt(process.env.DB_QUERY_TIMEOUT) || 15000);
    console.log('⚡ Pool wrapeado com query timeout de ' + (parseInt(process.env.DB_QUERY_TIMEOUT) || 15000) + 'ms');

    // [MD-e] Expor pool globalmente p/ a API de Manifestacao do Destinatario
    global.dbPool = pool;

    // ⚡ ENTERPRISE: MySQL Circuit Breaker — previne cascade failures
    const { createMySQLBreaker } = require('./services/mysql-circuit-breaker');
    const dbCircuitBreaker = createMySQLBreaker(pool, {
        failureThreshold: parseInt(process.env.DB_CB_THRESHOLD) || 5,
        resetTimeoutMs: parseInt(process.env.DB_CB_RESET_MS) || 30000
    });
    global.dbCircuitBreaker = dbCircuitBreaker;
    console.log('⚡ MySQL Circuit Breaker ativo (threshold: ' + (parseInt(process.env.DB_CB_THRESHOLD) || 5) + ')');

    // ⚡ ENTERPRISE: Monitor pool health every 60s
    createPoolMonitor(pool, 60000);

    // ⚡ ENTERPRISE: Initialize Redis cache (falls back to Map if unavailable)
    cacheService.initRedis().then(ok => {
        if (ok) console.log('⚡ Cache Redis distribuído ativo');
        else console.log('📦 Cache local (Map) ativo — defina REDIS_URL para cache distribuído');
    });

    // ⚡ ENTERPRISE: Initialize Redis rate-limit store (falls back to MemoryStore)
    initRateLimitRedis().then(ok => {
        if (ok) console.log('⚡ Rate limiting Redis distribuído ativo (cluster-safe)');
        else console.log('📦 Rate limiting em memória — defina REDIS_URL para store distribuído');
    });

    // Testar conexão imediatamente
    pool.query('SELECT 1').then(async () => {
        console.log('✅ Pool de conexões MySQL criado e testado com sucesso');
        // AUDIT-FIX R-13: Executar migrações de estrutura na inicialização
        try {
            const { runMigrations } = require('./database/migrations/startup-tables');
            await runMigrations(pool);
        } catch (migErr) {
            console.warn('[MIGRATION] ⚠️ Migrações não executadas:', migErr.message);
        }
        // ENTERPRISE: Executar migrações enterprise (tabelas + indexes)
        try {
            const { runEnterpriseMigrations } = require('./database/migrations/startup-tables-enterprise');
            await runEnterpriseMigrations(pool);
        } catch (entMigErr) {
            console.warn('[MIGRATION] ⚠️ Enterprise migrations não executadas:', entMigErr.message);
        }
        // AUDIT-FIX HIGH-002: Seed permissions from hardcoded map (idempotent)
        try {
            const { seedPermissions } = require('./database/migrations/seed-permissions');
            await seedPermissions(pool);
        } catch (seedErr) {
            console.warn('[SEED-PERM] ⚠️ Seed não executado:', seedErr.message);
        }
        // AUDIT-FIX HIGH-002: Complete RBAC migration — action-level permissions (idempotent)
        try {
            const { completeRbacMigration } = require('./database/migrations/complete-rbac-migration');
            await completeRbacMigration(pool);
        } catch (rbacErr) {
            console.warn('[RBAC-MIGRATION] ⚠️ Migration não executada:', rbacErr.message);
        }
        // Admin Panel migration — tabelas para /admin/usuarios.html
        try {
            const { adminPanelMigration } = require('./database/migrations/admin-panel-migration');
            await adminPanelMigration(pool);
        } catch (adminErr) {
            console.warn('[ADMIN-MIGRATION] ⚠️ Migration não executada:', adminErr.message);
        }
        // FIX: Restore missing CNPJ data for transportadoras (one-time, idempotent)
        try {
            const { fixTransportadorasCnpj } = require('./database/migrations/fix-transportadoras-cnpj');
            await fixTransportadorasCnpj(pool);
        } catch (cnpjErr) {
            console.warn('[FIX-CNPJ] ⚠️ Migration não executada:', cnpjErr.message);
        }
    }).catch((err) => {
        console.error('⚠️  Aviso: Pool criado mas teste de conexão falhou:', err.message);
        console.log('➡️  Sistema continuará e tentará reconectar automaticamente');
    });
} catch (err) {
    console.error('❌ Erro ao criar pool MySQL:', err.message);
    pool = null;
}

// Middleware para verificar disponibilidade do banco
const checkDB = (req, res, next) => {
    if (!pool) {
        return res.status(503).json({
            message: 'Banco de dados indisponível no momento. Tente novamente em instantes.',
            error: 'DB_UNAVAILABLE'
        });
    }
    next();
};

// Disponibilizar pool para todas as rotas via app.locals
app.locals.pool = pool;

console.log(`🔌 MySQL pool config -> host=${DB_CONFIG.host} user=${DB_CONFIG.user} port=${DB_CONFIG.port} database=${DB_CONFIG.database}`);

// ============================================================
// AUDIT-FIX HIGH-008: Unified Audit Log (DB-persisted)
// ============================================================
async function ensureAuditoriaLogsTable() {
    if (!pool) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auditoria_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT,
            acao VARCHAR(50) NOT NULL,
            modulo VARCHAR(50),
            descricao TEXT,
            dados_anteriores JSON,
            dados_novos JSON,
            ip_address VARCHAR(45),
            user_agent VARCHAR(500),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_usuario (usuario_id),
            INDEX idx_acao (acao),
            INDEX idx_modulo (modulo),
            INDEX idx_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}
ensureAuditoriaLogsTable().catch(e => console.log('[AUDIT] auditoria_logs init:', e.message));

/**
 * Write a unified audit log entry to auditoria_logs table.
 * Fire-and-forget — never throws to the caller.
 */
async function writeAuditLog({ userId, action, module: mod, description, previousData, newData, ip, userAgent } = {}) {
    try {
        if (!pool) return;
        await pool.query(
            `INSERT INTO auditoria_logs (usuario_id, acao, modulo, descricao, dados_anteriores, dados_novos, ip_address, user_agent, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                userId || null,
                action || 'UNKNOWN',
                mod || null,
                description || null,
                previousData ? JSON.stringify(previousData) : null,
                newData ? JSON.stringify(newData) : null,
                ip || null,
                userAgent || null
            ]
        );
    } catch (e) {
        console.log('[AUDIT] writeAuditLog falhou:', e.message);
    }
}

// =================================================================
// ⚡ SISTEMA DE CACHE ENTERPRISE (Redis/Map) PARA PERFORMANCE
// =================================================================
// Cache agora é gerenciado pelo módulo services/cache.js
// Suporta Redis (cluster mode) com fallback para Map local
const memoryCache = cacheService.localCache; // Compatibilidade
const CACHE_CONFIG = cacheService.CACHE_CONFIG;

/**
 * Middleware de cache para rotas GET — usa Redis quando disponível.
 */
const cacheMiddleware = cacheService.cacheMiddleware;

// Funções de cache — delegam para services/cache.js (Redis-ready)
const cacheSet = cacheService.cacheSet;
const cacheGet = cacheService.cacheGet;
const cacheDelete = cacheService.cacheDelete;
const cacheClear = cacheService.cacheClear;

// Funções de cache de sessão — delegam para services/cache.js
function cacheClearByToken(token) {
    cacheService.cacheClearByToken(token, jwt, JWT_SECRET).catch(() => { });
}
function cacheClearAllUserSessions(userId) {
    cacheService.cacheClearAllUserSessions(userId).catch(() => { });
}
global.cacheClearAllUserSessions = cacheClearAllUserSessions;
global.cacheClearByToken = cacheClearByToken;

// Cleanup e LRU eviction agora gerenciados por services/cache.js
logger.info('[CACHE] ⚡ Sistema de cache Enterprise ativado (Redis-ready)');
// =================================================================

// Helper: enviarEmail - tenta usar nodemailer se configurado via env, senão faz log
async function enviarEmail(to, subject, text, html) {
    // Requer variáveis de ambiente para envio real (SMTP)
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (host && user && pass) {
        try {
            const transporter = nodemailer.createTransport({ host, port: parseInt(port) || 587, secure: false, auth: { user, pass } });
            await transporter.sendMail({ from: user, to, subject, text, html });
            console.log(`✉️ Email enviado para ${to} assunto='${subject}'`);
            return true;
        } catch (err) {
            console.error('Falha ao enviar email via SMTP:', err);
            return false;
        }
    }
    // Fallback: apenas log
    console.log(`(simulado) enviarEmail -> to=${to} subject=${subject} text=${String(text).slice(0, 200)}`);
    return true;
}

// =================================================================
// 3. MIDDLEWARES GERAIS
// =================================================================

// ⚡ PERFORMANCE: Compressão gzip/deflate para reduzir tamanho das respostas em ~70%
app.use(compression({
    filter: (req, res) => {
        // Não comprimir server-sent events
        if (req.headers['accept'] === 'text/event-stream') {
            return false;
        }
        // Usar compressão padrão para outros tipos
        return compression.filter(req, res);
    },
    level: 6, // Nível de compressão (1-9, 6 é bom balanço performance/compressão)
    threshold: 1024 // Mínimo de 1KB para comprimir
}));

// HTTPS redirect — forces HTTPS in production (no-op in development)
const { forceHttpsMiddleware } = require('./config/https.config');
app.use(forceHttpsMiddleware);

// é ENTERPRISE: Request-ID tracing — end-to-end observability
app.use(requestIdMiddleware());

// 📊 ENTERPRISE: Prometheus metrics middleware — tracks request duration, status, active connections
app.use(metricsMiddleware);

// Middleware para interpretar JSON no corpo das requisições
// SEGURANÇA: Limite de 2MB para prevenir ataques DoS com payloads gigantes
app.use(express.json({ limit: '2mb' }));
// Middleware para interpretar bodies de formulários (application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Aplicar security middleware centralizado
app.use(securityHeaders());

// RATE LIMIT: Isentar assets estáticos (avatars, images, css, js, fonts) para não gastar o limite
app.use((req, res, next) => {
    const staticPaths = ['/avatars/', '/images/', '/image/', '/assets/', '/css/', '/js/', '/fonts/'];
    const staticExts = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.css', '.js', '.woff', '.woff2', '.ttf', '.eot', '.map'];
    const lowerPath = req.path.toLowerCase();
    if (staticPaths.some(p => lowerPath.startsWith(p)) || staticExts.some(ext => lowerPath.endsWith(ext))) {
        return next();
    }
    return generalLimiter(req, res, next);
});

app.use(sanitizeInput);

// é ENTERPRISE: Swagger/OpenAPI documentation at /api-docs
try {
    const { setupSwagger } = require('./config/swagger');
    setupSwagger(app);
} catch (e) {
    logger.warn('Swagger docs not available: ' + e.message);
}

// 📊 N8N: Interceptor global — detecta automaticamente quando relatórios
// (PDF, Excel, CSV, XML, ZIP) são gerados e notifica por email via n8n
if (reportInterceptorMiddleware) {
    app.use(reportInterceptorMiddleware);
}

// CORS configurado para permitir cookies e acesso do app mobile/desktop
// AUDITORIA 02/02/2026: Restrito a origens autorizadas para segurança
const allowedOrigins = [
    // Origens de desenvolvimento (apenas em dev)
    ...(process.env.NODE_ENV !== 'production' ? [
        'http://localhost:3000',
        'http://localhost:5000',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5000',
    ] : []),
    'https://zyntraerp.com.br',     // Novo dominio principal de producao
    'https://www.zyntraerp.com.br', // WWW do novo dominio principal
    'https://aluforce.api.br',      // Domínio principal de produção
    'https://www.aluforce.api.br',  // WWW do domínio principal
    'https://aluforce.ind.br',
    'https://erp.aluforce.ind.br',
    'https://www.aluforce.ind.br',
    // AUDIT-FIX R2: VPS IP movido para env var (não expor IP no código-fonte)
    process.env.VPS_CORS_ORIGIN,     // Ex: 'https://31.97.64.102'
    'http://tauri.localhost',        // App Desktop Tauri (ALUFORCE ERP Desktop)
    'https://tauri.localhost',       // App Desktop Tauri (HTTPS variant)
    'tauri://localhost',             // App Desktop Tauri (custom scheme)
    ...String(process.env.CORS_ORIGIN || '').split(',').map(function(x){return x.trim();}).filter(function(x){return x && x !== '*';}), // Origens customizadas via env (CSV)
].filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        // AUDIT-FIX: No-origin requests (mobile/server-to-server) allowed only in dev
        // In production, no-origin requests must use Bearer token (enforced by authenticateToken)
        if (!origin) {
            if (process.env.NODE_ENV === 'development') return callback(null, true);
            // In production, allow but don't set Access-Control-Allow-Origin
            // The request proceeds but cookies won't be sent cross-origin
            return callback(null, false);
        }

        const __corsWildcard = String(process.env.CORS_ORIGIN || '').split(',').map(function(x){return x.trim();}).indexOf('*') !== -1;
        if (__corsWildcard || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            // Bloquear origens não permitidas em qualquer ambiente
            console.warn(`⚠️ CORS: Origem bloqueada: ${origin}`);
            callback(new Error('Origem não permitida pelo CORS'));
        }
    },
    credentials: true, // CRITICAL: Permite envio de cookies
    exposedHeaders: ['set-cookie', 'X-CSRF-Token'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-CSRF-Token']
}));

// FIX 19/02/2026: cookieParser DEVE rodar ANTES do csrfProtection
// para que req.cookies esteja populado quando o CSRF verificar o csrf_token cookie
app.use(cookieParser());
app.use(csrfProtection);

// Zyntra Branding: aplica branding e banner demo em respostas HTML
app.use(zyntraBrandInfo);
app.use(zyntraBrandingMiddleware);

// Aplicar middlewares de segurança avançados (Auditoria 30/01/2026)
// FIX: CSRF desabilitado aqui pois já é aplicado acima via security-middleware.js (csrfProtection)
// O segundo CSRF (src/middleware/csrf.js) usa tokens one-time em server-side store + cookie _csrf,
// incompatível com o primeiro que usa Double Submit Cookie (csrf_token).
// Ter dois CRSFs causava 403 quando Bearer token não estava presente.
applySecurityMiddlewares(app, {
    pool: pool, // AUDIT-FIX R-04: Passar pool real para audit logs funcionarem
    enableCSRF: false, // FIX: Desabilitado - CSRF já ativo via security-middleware.js acima
    enableRateLimit: true,
    enableAudit: true
});

// ⚡ ENTERPRISE: Request timeout middleware (30s default)
// AUDIT-FIX: Movido para ANTES das rotas — estava depois e era ineficaz
app.use('/api', requestTimeout(parseInt(process.env.REQUEST_TIMEOUT) || 30000));

// DEBUG: Log de todos os cookies recebidos
app.use((req, res, next) => {
    // Logs de cookies removidos para produção
    // if (req.path.startsWith('/api/')) {
    //     console.log(`[${req.method}] ${req.path} - Cookies:`, req.cookies);
    //     console.log(`[${req.method}] ${req.path} - Cookie header:`, req.headers.cookie);
    // }
    next();
});

// Configurações de MIME type para arquivos estáticos
app.use((req, res, next) => {
    const ext = path.extname(req.url).toLowerCase();
    switch (ext) {
        case '.css':
            res.setHeader('Content-Type', 'text/css');
            break;
        case '.js':
            res.setHeader('Content-Type', 'application/javascript');
            break;
        case '.png':
            res.setHeader('Content-Type', 'image/png');
            break;
        case '.jpg':
        case '.jpeg':
            res.setHeader('Content-Type', 'image/jpeg');
            break;
        case '.svg':
            res.setHeader('Content-Type', 'image/svg+xml');
            break;
        case '.ico':
            res.setHeader('Content-Type', 'image/x-icon');
            break;
    }
    next();
});

// NOTA: Compressão gzip já configurada no início do arquivo (MIDDLEWARES GERAIS)

// Middleware para servir avatar — verifica uploads (produção) e public (fallback)
app.get('/avatars/:filename', (req, res, next) => {
    // Security: block path traversal - only allow simple filenames
    const filename = path.basename(req.params.filename);
    if (filename !== req.params.filename || filename.includes('..')) {
        return res.status(400).json({ error: 'Nome de arquivo inválido' });
    }

    // Detectar Content-Type correto pela extensão
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
        '.webp': 'image/webp',
        '.jpeg': 'image/jpeg',
        '.jpg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
    };
    const contentType = mimeTypes[ext] || 'image/webp';

    // Caminhos possíveis (uploads de produção primeiro, depois public como fallback)
    const uploadsPath = '/var/www/uploads/avatars/' + filename;
    const publicPath = path.join(__dirname, 'public', 'avatars', filename);
    const defaultAvatar = path.join(__dirname, 'public', 'avatars', 'default.webp');

    // Cache headers para reduzir requisições repetidas
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

    // 1º: Verificar em /var/www/uploads/avatars/ (uploads de produção)
    fs.access(uploadsPath, fs.constants.F_OK, (err1) => {
        if (!err1) {
            res.setHeader('Content-Type', contentType);
            return res.sendFile(uploadsPath);
        }
        // 2º: Verificar em public/avatars/ (fallback local)
        fs.access(publicPath, fs.constants.F_OK, (err2) => {
            if (!err2) {
                res.setHeader('Content-Type', contentType);
                return res.sendFile(publicPath);
            }
            // 3º: Retornar avatar padrão
            res.setHeader('Content-Type', 'image/webp');
            res.sendFile(defaultAvatar);
        });
    });
});

// ========================================
// FAVICON — rota explícita com cache longo (deve vir antes das demais)
// ========================================
const FAVICON_VERSION = '20260613-roxo';
const FAVICON_ASSET_BASE = (process.env.MOUNT_PATH || '').replace(/\/$/, '');
const FAVICON_ASSET_URL = (assetPath) => `${FAVICON_ASSET_BASE}${assetPath}?v=${FAVICON_VERSION}`;
const CANONICAL_FAVICON_TAGS = [
    `<link rel="icon" type="image/x-icon" href="${FAVICON_ASSET_URL('/favicon.ico')}" data-zyntra-favicon>`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${FAVICON_ASSET_URL('/icons/favicon-32x32.png')}" data-zyntra-favicon>`,
    `<link rel="icon" type="image/png" sizes="16x16" href="${FAVICON_ASSET_URL('/icons/favicon-16x16.png')}" data-zyntra-favicon>`,
    `<link rel="apple-touch-icon" href="${FAVICON_ASSET_URL('/icons/apple-touch-icon.png')}" data-zyntra-favicon>`,
    `<script>window.__ZYNTRA_FAVICON_URL__=${JSON.stringify(FAVICON_ASSET_URL('/favicon.ico'))};</script>`
].join('\n');

function injectCanonicalFavicon(html) {
    if (!html || html.includes('data-zyntra-favicon') || !html.includes('</head>')) {
        return html;
    }
    return html.replace('</head>', `${CANONICAL_FAVICON_TAGS}\n</head>`);
}

app.get('/favicon.ico', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 dias
    res.setHeader('Content-Type', 'image/x-icon');
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// ========================================
// ⚡ ENTERPRISE: Auto-inject de scripts globais em todas as páginas HTML
// Intercepta res.sendFile para injetar confirm-dialog.js + offline-sync + pwa antes de </body>
// Isso garante que TODAS as 60+ páginas do sistema tenham suporte offline
// ========================================
const GLOBAL_INJECT_SCRIPTS = [
    '\n<!-- ALUFORCE: Confirm Dialog Profissional v2.0 -->',
    '<script src="/_shared/confirm-dialog.js?v=20260429"></script>',
    '<!-- ALUFORCE: Accessibility Widget v1.0 - Acessibilidade global -->',
    '<script src="/_shared/accessibility-widget.js?v=20260615"></script>',
    '<!-- ALUFORCE: Offline Sync Manager v4.0 - Sistema completo offline -->',
    '<script src="/js/offline-sync-manager.js?v=20260301"></script>',
    '<!-- ALUFORCE: Report Viewer v1.0 - Relatórios inline -->',
    '<script src="/js/report-viewer.js?v=20260615"></script>',
    '<!-- ALUFORCE: PWA Manager v3.0 -->',
    '<script src="/js/pwa-manager.js?v=20260301"></script>',
    '<!-- ALUFORCE: Inactivity Manager v1.0 - Detecção de inatividade -->',
    '<script src="/js/inactivity-manager.js?v=20260324" defer></script>',
    '<!-- ALUFORCE: Zyntra Chat Teams Widget v2.0 -->',
    '<link rel="stylesheet" href="/chat-teams/chat-widget.css?v=20260615">',
    '<script src="/chat-teams/chat-widget.js?v=20260615" defer></script>\n'
].join('\n');
const PCP_DASHBOARD_SCRIPT_VERSION = '20260626';

function injectBeforeClosingBody(html, injectTag) {
    if (!injectTag) return html;
    const bodyIdx = html.lastIndexOf('</body>');
    const htmlIdx = html.lastIndexOf('</html>');
    if (bodyIdx !== -1) {
        return html.substring(0, bodyIdx) + injectTag + html.substring(bodyIdx);
    }
    if (htmlIdx !== -1) {
        return html.substring(0, htmlIdx) + injectTag + html.substring(htmlIdx);
    }
    return html + injectTag;
}

function ensurePcpApprovedDashboardScript(html) {
    const scriptTag = '\n<!-- ALUFORCE: PCP pedidos aprovados dashboard v2 -->\n' +
        `<script src="/dashboard-v2/pcp-pedidos-aprovados.js?v=${PCP_DASHBOARD_SCRIPT_VERSION}" defer></script>\n`;
    html = html.replace(
        /pcp-pedidos-aprovados\.js\?v=[0-9A-Za-z_-]+/g,
        `pcp-pedidos-aprovados.js?v=${PCP_DASHBOARD_SCRIPT_VERSION}`
    );
    if (!html.includes('pcp-pedidos-aprovados.js')) {
        html = injectBeforeClosingBody(html, scriptTag);
    }
    return html;
}

function ensureGlobalHtmlScripts(html) {
    if (!html.includes('offline-sync-manager.js')) {
        return injectBeforeClosingBody(html, GLOBAL_INJECT_SCRIPTS);
    }

    let missing = '';
    if (!html.includes('confirm-dialog.js')) {
        missing += '\n<script src="/_shared/confirm-dialog.js?v=20260429"></script>';
    }
    if (!html.includes('report-viewer.js')) {
        missing += '\n<script src="/js/report-viewer.js?v=20260615"></script>';
    }
    if (!html.includes('inactivity-manager.js')) {
        missing += '\n<script src="/js/inactivity-manager.js?v=20260324" defer></script>';
    }
    if (!html.includes('chat-widget.css')) {
        missing += '\n<link rel="stylesheet" href="/chat-teams/chat-widget.css?v=20260615">';
    }
    if (!html.includes('chat-widget.js')) {
        missing += '\n<script src="/chat-teams/chat-widget.js?v=20260615" defer></script>';
    }
    return injectBeforeClosingBody(html, missing);
}

// Paginas que NAO devem receber offline-sync (login precisa de rede)
const SKIP_OFFLINE_INJECT = ['login.html', 'forgot-password.html', 'reset-password.html', 'register.html'];

app.use((req, res, next) => {
    const _origSendFile = res.sendFile.bind(res);
    res.sendFile = function (filePath, opts, cb) {
        if (typeof filePath === 'string' && filePath.endsWith('.html')) {
            try {
                fs.readFile(filePath, 'utf8', (err, html) => {
                    if (err || !html) return _origSendFile(filePath, opts, cb);

                    const fileName = path.basename(filePath);
                    const isLoginPage = SKIP_OFFLINE_INJECT.includes(fileName);

                    // Montar scripts a injetar
                    let injectTag = '';
                    if (isLoginPage) {
                        // Login: só confirm-dialog, sem offline
                        if (!html.includes('confirm-dialog.js')) {
                            injectTag = '\n<script src="/_shared/confirm-dialog.js?v=20260429"></script>\n';
                        }
                    } else {
                        // Todas as outras páginas: inject completo (confirm + offline + report-viewer + pwa + chat)
                        if (!html.includes('offline-sync-manager.js')) {
                            injectTag = GLOBAL_INJECT_SCRIPTS;
                        } else {
                            // Já tem offline-sync, verificar componentes faltantes
                            let missing = '';
                            if (!html.includes('confirm-dialog.js')) {
                                missing += '\n<script src="/_shared/confirm-dialog.js?v=20260429"></script>';
                            }
                            if (!html.includes('report-viewer.js')) {
                                missing += '\n<script src="/js/report-viewer.js?v=20260615"></script>';
                            }
                            if (!html.includes('inactivity-manager.js')) {
                                missing += '\n<script src="/js/inactivity-manager.js?v=20260324" defer></script>';
                            }
                            if (!html.includes('chat-widget.css')) {
                                missing += '\n<link rel="stylesheet" href="/chat-teams/chat-widget.css?v=20260615">';
                            }
                            if (!html.includes('chat-widget.js')) {
                                missing += '\n<script src="/chat-teams/chat-widget.js?v=20260615" defer></script>';
                            }
                            injectTag = missing;
                        }
                    }

                    // [UNIFICADO] inject PCP pedidos aprovados no dashboard-v2/pcp
                    if (filePath.replace(/\\/g, '/').endsWith('/public/dashboard-v2/pcp.html')) {
                        html = ensurePcpApprovedDashboardScript(html);
                    }
                    if (injectTag) {
                        // IMPORTANTE: Usar lastIndexOf para injetar antes do ÚLTIMO </body>
                        // (o primeiro pode estar dentro de um template literal JS)
                        const bodyIdx = html.lastIndexOf('</body>');
                        const htmlIdx = html.lastIndexOf('</html>');
                        if (bodyIdx !== -1) {
                            html = html.substring(0, bodyIdx) + injectTag + html.substring(bodyIdx);
                        } else if (htmlIdx !== -1) {
                            html = html.substring(0, htmlIdx) + injectTag + html.substring(htmlIdx);
                        } else {
                            html += injectTag;
                        }
                    }

                    html = ensureCurrentHeaderSidebar(html);
                    html = injectCanonicalFavicon(html);

                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.send(html);
                });
            } catch (readErr) {
                console.error('[INJECT] Erro ao ler HTML para injeção:', readErr.message);
                _origSendFile(filePath, opts, cb);
            }
        } else {
            _origSendFile(filePath, opts, cb);
        }
    };
    next();
});

// ========================================
// ROTAS ESPECÍFICAS (devem vir ANTES do express.static(public))
// ========================================

// 🔄 ANTI-CACHE GLOBAL: HTML e arquivos do chat widget nunca ficam em cache
app.use((req, res, next) => {
    const lp = req.path.toLowerCase();
    if (lp.endsWith('.html') || lp.startsWith('/chat/widget') || lp.startsWith('/chat-teams/')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Rota raiz: redirecionar para página de login
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// Empresas/: localização canônica dos arquivos do seletor "Meus Aplicativos".
// As páginas usam <base href="/Empresas/"> com reescrita mount-aware para
// /labor-eletric/Empresas/ ou /labor-energy/Empresas/ via JS in-page.
const empresasPath = path.join(__dirname, 'Empresas');

function setNoCacheHtmlHeaders(res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}

function serveZyntraApps(req, res) {
    setNoCacheHtmlHeaders(res);
    res.sendFile(path.join(empresasPath, 'dashboard.html'));
}

const zyntraAppPages = {
    'dashboard': 'dashboard.html',
    'meus-aplicativos': 'dashboard.html',
    'treinamentos': 'treinamentos.html',
    'zyntra-store': 'zyntra-store.html',
    'extrato-financeiro': 'extrato-financeiro.html',
    'gerenciar-usuarios': 'gerenciar-usuarios.html',
    'grupos-de-acesso': 'grupos-de-acesso.html',
    'seguranca': 'seguranca.html',
    'termos-de-contrato': 'termos-de-contrato.html',
    'minha-conta': 'minha-conta.html',
    'resumo-app': 'resumo-app.html',
};

function serveZyntraAppPage(req, res, next) {
    const pageKey = String(req.params.page || '').toLowerCase().replace(/\.html$/, '');
    const pageFile = zyntraAppPages[pageKey];
    if (!pageFile) return next();

    setNoCacheHtmlHeaders(res);
    res.sendFile(path.join(empresasPath, pageFile));
}

// Atalho curto para o seletor "Meus Aplicativos" do Zyntra.
// Aceita também /labor-eletric/apps quando o request bate na instância principal
// (cross-instance redirect pós-login de @labor.com.br).
app.get(['/apps', '/aplicativos', '/labor-eletric/apps', '/labor-energy/apps'], authenticatePage, serveZyntraApps);

// Rotas limpas dos apps internos do hub (servidas a partir de Empresas/).
app.get(['/apps/treinamentos', '/aplicativos/treinamentos', '/labor-eletric/apps/treinamentos', '/labor-energy/apps/treinamentos'], authenticatePage, (req, res) => {
    setNoCacheHtmlHeaders(res);
    res.sendFile(path.join(empresasPath, 'treinamentos.html'));
});
app.get(['/apps/zyntra-store', '/aplicativos/zyntra-store', '/labor-eletric/apps/zyntra-store', '/labor-energy/apps/zyntra-store'], authenticatePage, (req, res) => {
    setNoCacheHtmlHeaders(res);
    res.sendFile(path.join(empresasPath, 'zyntra-store.html'));
});
app.get([
    '/apps/:page',
    '/aplicativos/:page',
    '/labor-eletric/apps/:page',
    '/labor-energy/apps/:page',
], authenticatePage, serveZyntraAppPage);
app.get([
    '/treinamentos',
    '/zyntra-store',
    '/labor-eletric/treinamentos',
    '/labor-eletric/zyntra-store',
    '/labor-energy/treinamentos',
    '/labor-energy/zyntra-store',
], authenticatePage, (req, res, next) => {
    req.params.page = String(req.path || '').split('/').filter(Boolean).pop();
    serveZyntraAppPage(req, res, next);
});

// Servir páginas e assets internos a partir da pasta /Empresas/* (e mounts Labor).
// HTML exige auth; assets (css/js/imagens) são públicos para evitar quebra visual.
function serveMountedEmpresasStatic(prefix) {
    app.use(`${prefix}/Empresas`, (req, res, next) => {
        if (String(req.path || '').toLowerCase().endsWith('.html')) {
            return authenticatePage(req, res, next);
        }
        next();
    }, express.static(empresasPath, {
        dotfiles: 'deny',
        index: false,
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) {
                setNoCacheHtmlHeaders(res);
            }
        }
    }));
}

serveMountedEmpresasStatic('');
serveMountedEmpresasStatic('/labor-eletric');
serveMountedEmpresasStatic('/labor-energy');

// Compatibilidade: URLs antigas /Zyntra-SGE/* -> /Empresas/* (bookmarks/sessões
// antigas e e-mails). Remover quando não houver mais acessos legados.
app.get(/^(\/labor-eletric|\/labor-energy)?\/Zyntra-SGE(\/.*)?$/, (req, res) => {
    res.redirect(301, req.originalUrl.replace('/Zyntra-SGE', '/Empresas'));
});

// Dashboard principal (Painel de Controle) — requer autenticação
// Dashboard principal (Painel de Controle) — serve o dashboard V2 (Next.js)
// com brand e usuário injetados. (Restaurado: havia sido revertido p/ index.html.)
const dashboardV2Path = path.join(__dirname, 'public', 'index.html');
const dashboardV2PcpPath = path.join(__dirname, 'public', 'dashboard-v2', 'pcp.html');

async function _buildDashboardContextScript(req) {
    const brand = process.env.BRAND || 'aluforce';
    const u = req.user || {};
    let avatar = '';
    try {
        if (pool && u.id) {
            const [rows] = await pool.query(
                'SELECT foto, avatar FROM usuarios WHERE id = ? LIMIT 1', [u.id]
            );
            if (rows.length > 0) {
                avatar = rows[0].foto || rows[0].avatar || '';
                if (avatar && !avatar.startsWith('/') && !avatar.startsWith('http')) {
                    avatar = '/avatars/' + avatar;
                }
            }
        }
    } catch (e) { /* silencioso — avatar fica vazio, fallback usa iniciais */ }

    const userObj = {
        name: u.nome || u.name || 'Usuário',
        email: u.email || '',
        role: u.role || 'Usuário',
        isAdmin: u.role === 'admin' || u.is_admin === true,
        avatar: avatar
    };

    return `<script>window.__ZYNTRA_BRAND="${brand}";window.__ZYNTRA_USER=${JSON.stringify(userObj)};</script>`;
}

async function _buildDashboardHtml(req) {
    let html = fs.readFileSync(dashboardV2Path, 'utf8');
    const injectScript = await _buildDashboardContextScript(req);
    return html.replace('</head>', injectScript + '</head>');
}

app.get('/dashboard', authenticatePage, async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (fs.existsSync(dashboardV2Path)) {
        try {
            const html = await _buildDashboardHtml(req);
            res.send(html);
        } catch (e) {
            logger.error('[DASHBOARD] Falha ao montar dashboard atual:', e);
            res.status(500).send('Dashboard indisponivel no momento.');
        }
    } else {
        logger.error('[DASHBOARD] Build atual nao encontrado:', dashboardV2Path);
        res.status(503).send('Dashboard indisponivel no momento.');
    }
});

app.get(['/dashboard-v2/pcp', '/dashboard-v2/pcp/', '/dashboard-v2/pcp.html'], authenticatePage, async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (!fs.existsSync(dashboardV2PcpPath)) {
        return res.redirect('/dashboard');
    }

    try {
        let html = fs.readFileSync(dashboardV2PcpPath, 'utf8');
        html = ensurePcpApprovedDashboardScript(html);
        html = ensureGlobalHtmlScripts(html);

        if (!html.includes('window.__ZYNTRA_USER')) {
            const injectScript = await _buildDashboardContextScript(req);
            html = html.replace('</head>', injectScript + '</head>');
        }

        html = transformHtml(injectCanonicalFavicon(html));
        res.send(html);
    } catch (e) {
        logger.error('[DASHBOARD-V2/PCP] Falha ao montar HTML PCP:', e);
        res.status(500).send('Dashboard PCP indisponivel no momento.');
    }
});

// Assets do dashboard V2 (JS/CSS chunks do Next.js)
app.use('/dashboard-v2', authenticatePage, express.static(path.join(__dirname, 'public', 'dashboard-v2'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '7d',
}));

// SPA fallback para /dashboard-v2/* — evita 404 ao recarregar (F5) rotas do Next.js
app.get('/dashboard-v2/*', authenticatePage, async (req, res) => {
    if (fs.existsSync(dashboardV2Path)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        try {
            const html = await _buildDashboardHtml(req);
            res.send(html);
        } catch (e) {
            res.sendFile(dashboardV2Path);
        }
    } else {
        res.redirect('/dashboard');
    }
});

// Compatibilidade: /index.html também serve o dashboard
app.get('/index.html', authenticatePage, (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Configurações do sistema — apenas administradores (link na sidebar)
app.get(["/configuracoes", "/configuracoes/"], authenticatePage, (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.join(__dirname, "public", "config.html"));
});

// Servir página de Ajuda (institucional) - DEVE VIR ANTES do express.static(public)
const ajudaPath = path.join(__dirname, 'ajuda');
const ajudaOptions = {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
};
// A página INICIAL de Ajuda passa a exibir Treinamentos (Empresas/treinamentos.html),
// por instância (mount-aware, sem redirect cross-instância). Os artigos /ajuda/<arquivo>
// continuam sendo servidos normalmente pelo static abaixo.
app.get(['/ajuda', '/ajuda/', '/ajuda/index.html', '/Ajuda', '/Ajuda/', '/Ajuda/index.html',
         '/labor-eletric/ajuda', '/labor-energy/ajuda'], authenticatePage, (req, res) => {
    setNoCacheHtmlHeaders(res);
    res.sendFile(path.join(empresasPath, 'treinamentos.html'));
});
app.use('/ajuda', express.static(ajudaPath, ajudaOptions));
app.use('/Ajuda', express.static(ajudaPath, ajudaOptions));

// ⚡ ENTERPRISE: Shared utilities (fetch-utils, confirm-dialog, etc.)
app.use('/_shared', express.static(path.join(__dirname, '_shared'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '7d',
    etag: true,
    lastModified: true
}));

// Redirect legado /Ajuda-Aluforce → /ajuda (app.use para compatibilidade Express 4.22+)
app.use('/Ajuda-Aluforce', (req, res) => {
    const subPath = req.url && req.url !== '/' ? req.url : '/index.html';
    res.redirect(301, '/ajuda' + subPath);
});

// CSS e JS - Cache longo para performance (assets versionados)
app.use('/css', express.static(path.join(__dirname, 'public', 'css'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '7d',
    etag: true,
    lastModified: true
}));

app.use('/js', express.static(path.join(__dirname, 'public', 'js'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '7d',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        // 🔒 MULTI-LOGIN: Forçar no-cache para auth-unified.js
        // Garante que o navegador SEMPRE baixa a versão mais recente
        if (filePath.includes('auth-unified')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// 🖼️ Fundos/Backgrounds - Cache longo (imagens WebP otimizadas, mudam raramente)
app.use('/Fundos', express.static(path.join(__dirname, 'public', 'Fundos'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '30d',
    etag: true,
    lastModified: true,
    immutable: true
}));

// ============================================================
// CHAT BOB AI - Upload Routes
// ============================================================
const chatMulter = require('multer');
const chatPath = require('path');
const chatUploadDir = chatPath.join(__dirname, 'chat', 'uploads');
if (!require('fs').existsSync(chatUploadDir)) {
    require('fs').mkdirSync(chatUploadDir, { recursive: true });
}
const chatUploadStorage = chatMulter.diskStorage({
    destination: (req, file, cb) => cb(null, chatUploadDir),
    filename: (req, file, cb) => {
        const ext = chatPath.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E6) + ext);
    }
});
const chatUpload = chatMulter({
    storage: chatUploadStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|mp3|wav|ogg|webm/;
        const ext = allowedTypes.test(chatPath.extname(file.originalname).toLowerCase());
        const mime = allowedTypes.test(file.mimetype);
        if (ext && mime) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não permitido'));
        }
    }
});

// AUDIT-FIX R-03: Auth on chat uploads - using wrapper to avoid TDZ (authenticateToken defined later)
app.post('/api/chat/upload', (req, res, next) => authenticateToken(req, res, next), chatUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const url = '/chat/uploads/' + req.file.filename;
    res.json({ url, originalName: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype });
});

app.post('/api/chat/upload-audio', (req, res, next) => authenticateToken(req, res, next), chatUpload.single('audio'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum áudio enviado' });
    const url = '/chat/uploads/' + req.file.filename;
    res.json({ url, originalName: req.file.originalname, size: req.file.size });
});

// Serve chat uploads — protegido por autenticação JWT
app.use('/chat/uploads', (req, res, next) => authenticateToken(req, res, next), require('express').static(chatPath.join(__dirname, 'chat', 'uploads')));

// Serve chat static files (widget assets) - public/chat e Chat/public como fallback
app.use('/chat', require('express').static(chatPath.join(__dirname, 'public', 'chat')));
app.use('/chat', require('express').static(chatPath.join(__dirname, 'Chat', 'public')));

// Chat support page
app.get('/chat/suporte', (req, res) => {
    res.sendFile(chatPath.join(__dirname, 'public', 'chat', 'support.html'));
});

console.log('💬 Chat BOB AI: Rotas de upload e arquivos estáticos configuradas');

// ============================================================
// AI PROXY — /api/ai (OPENAI_API_KEY nunca exposta ao frontend)
// ============================================================
const aiProxyRouter = require('./routes/ai-proxy');
app.use('/api/ai', (req, res, next) => authenticateToken(req, res, next), aiProxyRouter);
console.log('🤖 AI Proxy: Rota /api/ai/chat montada');

// 🔄 CHAT WIDGET: No-cache para widget.css e widget.js (mudanças frequentes)
app.use('/chat', (req, res, next) => {
    const lp = req.path.toLowerCase();
    if (lp.includes('widget.css') || lp.includes('widget.js')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// 📱 iOS: Servir .well-known para Universal Links / Deep Links
// SECURITY: dotfiles 'ignore' — apenas arquivos JSON legítimos do .well-known são servidos
app.use('/.well-known', express.static(path.join(__dirname, 'public', '.well-known'), {
    dotfiles: 'ignore',
    maxAge: '1d',
    setHeaders: (res) => {
        res.setHeader('Content-Type', 'application/json');
    }
}));

app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    let requestPath;
    try {
        requestPath = decodeURIComponent(req.path || '');
    } catch (_) {
        return next();
    }

    if (!requestPath.toLowerCase().endsWith('.html') || requestPath.includes('\0')) {
        return next();
    }

    const publicRoot = path.resolve(__dirname, 'public');
    const htmlPath = path.resolve(path.join(publicRoot, requestPath));
    if (!htmlPath.startsWith(publicRoot + path.sep) && htmlPath !== publicRoot) {
        return next();
    }

    fs.readFile(htmlPath, 'utf8', (err, html) => {
        if (err || !html) return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        html = ensureCurrentHeaderSidebar(html);
        res.send(injectCanonicalFavicon(html));
    });
});

// /Vendas precisa vencer o arquivo legado vazio public/Vendas antes do express.static(public).
app.get(['/Vendas', '/Vendas/'], authenticateModuleHtml, redirectToCanonicalModule('/Vendas/index.html'));

app.use(express.static(path.join(__dirname, 'public'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '1d',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        // HTML e arquivos do chat widget: sempre revalidar
        if (filePath.endsWith('.html') || filePath.includes('chat')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
        }
        // iOS OTA: MIME type correto para manifest.plist
        if (filePath.endsWith('.plist')) {
            res.setHeader('Content-Type', 'text/xml');
        }
        // iOS OTA: MIME type correto para .ipa
        if (filePath.endsWith('.ipa')) {
            res.setHeader('Content-Type', 'application/octet-stream');
        }
        // Apple App Site Association (sem extensão)
        if (filePath.endsWith('apple-app-site-association')) {
            res.setHeader('Content-Type', 'application/json');
        }
    }
}));

// Servir Socket.io client library
app.use('/socket.io', express.static(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist'), { dotfiles: 'deny', index: false }));

// AUDIT-FIX HIGH-013: Removed CORS wildcard override — CORS is handled by the cors() middleware
// Middleware específico para correção de MIME types
app.use((req, res, next) => {
    // Configurar MIME types corretos baseado na extensão do arquivo
    // Usar req.path ao invés de req.url para ignorar query strings (?v=20260213)
    const urlPath = req.path.toLowerCase();
    if (urlPath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css');
    } else if (urlPath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript');
    } else if (urlPath.endsWith('.png')) {
        res.setHeader('Content-Type', 'image/png');
    } else if (urlPath.endsWith('.jpg') || urlPath.endsWith('.jpeg')) {
        res.setHeader('Content-Type', 'image/jpeg');
    } else if (urlPath.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }

    next();
});

// Servir arquivos estáticos dos módulos (APENAS JS, CSS e imagens - NÃO HTML)
app.use('/Vendas/js', express.static(path.join(__dirname, 'modules', 'Vendas', 'public', 'js'), {
    dotfiles: 'deny',
    index: false,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
}));

app.use('/Vendas/css', express.static(path.join(__dirname, 'modules', 'Vendas', 'public', 'css'), {
    dotfiles: 'deny',
    index: false,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        res.setHeader('Content-Type', 'text/css');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
}));

app.use('/Vendas/images', express.static(path.join(__dirname, 'modules', 'Vendas', 'public', 'images'), {
    dotfiles: 'deny',
    index: false,
    etag: true,
    lastModified: true,
    setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache, must-revalidate'); }
}));
app.use('/Vendas/assets', express.static(path.join(__dirname, 'modules', 'Vendas', 'public', 'assets'), {
    dotfiles: 'deny',
    index: false,
    etag: true,
    lastModified: true,
    setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache, must-revalidate'); }
}));

// Servir uploads específicos do Vendas
app.use('/uploads', express.static(path.join(__dirname, 'modules', 'Vendas', 'public', 'uploads'), {
    dotfiles: 'deny',
    index: false,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        // Fotos e uploads sempre revalidam para mostrar versão mais recente
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
            res.setHeader('Content-Type', 'image/' + filePath.split('.').pop().replace('jpg', 'jpeg'));
        }
    }
}));
// /Sistema/Vendas removido - use rotas autenticadas /Vendas/*

// ========================================
// ⚡ HTML INTERCEPTOR: Capturar TODOS os .html de módulos via sendFile
// Isso garante que o middleware de inject funcione para express.static também
// ========================================

// Scripts injetados automaticamente em todas as páginas HTML dos módulos
const AUTO_INJECT_SCRIPTS = `
<!-- Auto-injected: Report Viewer + Inactivity Manager + Chat Teams -->
<script src="/js/inactivity-manager.js?v=20260324" defer></script>
<script src="/js/report-viewer.js?v=20260615" defer></script>
<script src="/socket.io/socket.io.js"></script>
<script src="/chat-teams/chat-widget.js?v=20260615" defer></script>
`;

const GLOBAL_HEADER_SIDEBAR_VERSION = '20260626b';
const GLOBAL_HEADER_SIDEBAR_ASSETS = {
    css: `<link rel="stylesheet" href="/css/global-header-sidebar.css?v=${GLOBAL_HEADER_SIDEBAR_VERSION}">`,
    js: `<script src="/js/global-sidebar-submenu.js?v=${GLOBAL_HEADER_SIDEBAR_VERSION}" defer></script>`
};

function injectBeforeHtmlTag(html, tagName, snippet) {
    const idx = html.lastIndexOf(tagName);
    return idx !== -1 ? html.slice(0, idx) + snippet + html.slice(idx) : html + snippet;
}

function ensureCurrentHeaderSidebar(html) {
    if (/<body[^>]+data-no-global-sidebar=["']true["']/i.test(html)) {
        return html;
    }
    if (!html || !/<(aside|nav)[^>]+class=["'][^"']*\bsidebar\b/i.test(html)) {
        return html;
    }

    html = html
        .replace(/\/css\/global-header-sidebar\.css(?:\?v=[^"'\s>]*)?/g, `/css/global-header-sidebar.css?v=${GLOBAL_HEADER_SIDEBAR_VERSION}`)
        .replace(/\/js\/global-sidebar-submenu\.js(?:\?v=[^"'\s>]*)?/g, `/js/global-sidebar-submenu.js?v=${GLOBAL_HEADER_SIDEBAR_VERSION}`);

    if (!html.includes('global-header-sidebar.css')) {
        html = injectBeforeHtmlTag(html, '</head>', `\n${GLOBAL_HEADER_SIDEBAR_ASSETS.css}\n`);
    }

    if (!html.includes('global-sidebar-submenu.js')) {
        html = injectBeforeHtmlTag(html, '</body>', `\n${GLOBAL_HEADER_SIDEBAR_ASSETS.js}\n`);
    }

    return html;
}

// SECURITY FIX C-06: Helper para sanitizar path e prevenir Path Traversal (CWE-22)
function safeSendModuleHtml(req, res, next, moduleDir) {
    const rawParam = req.params[0];
    // Bloquear path traversal: não permitir .. ou barras absolutas
    if (!rawParam || rawParam.includes('..') || rawParam.includes('\\') || /^[/\\]/.test(rawParam)) {
        return res.status(400).json({ error: 'Caminho inválido' });
    }
    const safeRelative = String(rawParam).replace(/\\/g, '/').split('/').filter(Boolean).join('/');
    // Evitar duplicacao de .html (route wildcard ja captura .html)
    const htmlFile = safeRelative.endsWith('.html') ? safeRelative : safeRelative + '.html';
    const htmlPath = path.join(moduleDir, htmlFile);
    // Verificar se o caminho resolvido está dentro do diretório do módulo
    const resolvedPath = path.resolve(htmlPath);
    const resolvedDir = path.resolve(moduleDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
        return res.status(400).json({ error: 'Caminho fora do diretório permitido' });
    }
    if (fs.existsSync(htmlPath)) {
        // Ler HTML, injetar scripts automáticos e enviar
        let html = fs.readFileSync(htmlPath, 'utf8');
        // Evitar duplicação: só injetar se report-viewer não estiver presente
        if (!html.includes('report-viewer.js')) {
            const lastBody = html.lastIndexOf('</body>');
            if (lastBody !== -1) {
                html = html.slice(0, lastBody) + AUTO_INJECT_SCRIPTS + html.slice(lastBody);
            } else {
                html += AUTO_INJECT_SCRIPTS;
            }
        }
        // Evitar duplicação do chat-widget
        if (!html.includes('chat-widget.js') && html.includes('report-viewer.js')) {
            // report-viewer já presente, mas chat-widget não — injetar só o chat
            const chatScripts = `<script src="/socket.io/socket.io.js"></script>\n<script src="/chat-teams/chat-widget.js?v=20260615" defer></script>\n`;
            const lastBody = html.lastIndexOf('</body>');
            if (lastBody !== -1) {
                html = html.slice(0, lastBody) + chatScripts + html.slice(lastBody);
            }
        }
        // Garantir inactivity-manager em páginas que já tinham report-viewer mas não tinham inactivity
        if (!html.includes('inactivity-manager.js') && html.includes('report-viewer.js')) {
            const inactScript = `<script src="/js/inactivity-manager.js?v=20260324" defer></script>\n`;
            const lastBody = html.lastIndexOf('</body>');
            if (lastBody !== -1) {
                html = html.slice(0, lastBody) + inactScript + html.slice(lastBody);
            }
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        // ZYNTRA: current header + sidebar for module pages.
        html = ensureCurrentHeaderSidebar(html);
        html = injectCanonicalFavicon(html);
        res.send(html);
    } else {
        next();
    }
}

function authenticateModuleHtml(req, res, next) {
    const pageName = path.basename(req.path || '').toLowerCase();
    if (pageName === 'login.html' || pageName === 'login') {
        return res.redirect('/login.html');
    }
    return authenticatePage(req, res, next);
}

// SECURITY FIX 2026-06-29: authenticateModuleHtml só verifica login (JWT válido),
// nunca se o usuário tem acesso ao MÓDULO/setor — um usuário sem acesso a Financeiro,
// por exemplo, conseguia abrir qualquer página do módulo só por estar logado e ter o
// link. Esta variante adiciona a verificação de área via authCentral.requirePageAccess
// (mesmo permissionService usado pelas APIs), mantendo o tratamento de login.html.
function authenticateModuleHtmlArea(moduleNames) {
    const pageGuard = authCentral.requirePageAccess(moduleNames);
    return (req, res, next) => {
        const pageName = path.basename(req.path || '').toLowerCase();
        if (pageName === 'login.html' || pageName === 'login') {
            return res.redirect('/login.html');
        }
        return pageGuard(req, res, next);
    };
}

// RH mistura autoatendimento (férias, holerite, ponto — TODO funcionário precisa ver os
// próprios, e só 55/60 usuários têm a área 'rh' no DB) com páginas administrativas que
// listam/gerenciam dados de OUTROS funcionários. Gate só nas admin-tier; autoatendimento
// continua exigindo apenas login (cada página já filtra por req.user.id na API).
const RH_ADMIN_PAGES = new Set([
    'areaadm.html', 'gestao-holerites.html', 'funcionarios.html', 'gestao-ponto.html',
    'gestao-solicitacoes.html', 'holerites.html', 'folha.html', 'importar-ponto.html',
    'importar-ponto_new.html', 'relatorios.html'
]);
const rhAdminGuard = authCentral.requirePageAccess('rh');
function authenticateRhHtml(req, res, next) {
    const pageName = path.basename(req.path || '').toLowerCase();
    if (pageName === 'login.html' || pageName === 'login') {
        return res.redirect('/login.html');
    }
    if (RH_ADMIN_PAGES.has(pageName)) {
        return rhAdminGuard(req, res, next);
    }
    return authenticatePage(req, res, next);
}

function normalizeLegacyUrlPath(urlPath) {
    if (!urlPath || !urlPath.includes('.html')) return urlPath;
    return urlPath.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!String(req.path || '').toLowerCase().endsWith('.html')) return next();

    const normalizedPath = normalizeLegacyUrlPath(req.path);
    if (normalizedPath && normalizedPath !== req.path) {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return res.redirect(302, normalizedPath + query);
    }

    next();
});

// =================================================================
// CLEAN URL ROUTING — Mascarar .html nas URLs para todos os módulos
// /Modulo/pagina → serve /Modulo/pagina.html automaticamente
// =================================================================

// Helper: serve HTML sem extensão (clean URLs)
function serveCleanUrl(req, res, next, moduleDir) {
    const rawParam = req.params[0];
    if (!rawParam || rawParam.includes('..') || rawParam.includes('\\') || /^[/\\]/.test(rawParam)) {
        return res.status(400).json({ error: 'Caminho inválido' });
    }
    const safeRelative = String(rawParam).replace(/\\/g, '/').split('/').filter(Boolean).join('/');
    const safeDir = path.posix.dirname(safeRelative);
    const safeName = path.posix.basename(safeRelative);
    const prefix = safeDir && safeDir !== '.' ? `${safeDir}/` : '';
    // Tentar com underscore e com hyphen (contas-pagar -> contas_pagar.html)
    const variations = [
        prefix + safeName + '.html',
        prefix + safeName.replace(/-/g, '_') + '.html',
        prefix + safeName.replace(/_/g, '-') + '.html'
    ];
    for (const htmlFile of variations) {
        const htmlPath = path.join(moduleDir, htmlFile);
        const resolvedPath = path.resolve(htmlPath);
        const resolvedDir = path.resolve(moduleDir);
        if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) continue;
        if (fs.existsSync(htmlPath)) {
            // Reutilizar a lógica de injeção de scripts
            req.params[0] = htmlFile;
            return safeSendModuleHtml(req, res, next, moduleDir);
        }
    }
    next();
}

// Canonical module roots. Keep bare and trailing-slash module URLs as
// compatibility aliases, but redirect them before wildcard clean-URL routes.
function redirectToCanonicalModule(target) {
    return (req, res) => res.redirect(302, target);
}

function redirectToCanonicalRh(req, res) {
    const firstName = req.user?.nome ? req.user.nome.split(' ')[0].toLowerCase() : '';
    const emailPrefix = req.user?.email ? req.user.email.split('@')[0].toLowerCase() : '';
    if (userPermissions.isAdmin(firstName) || userPermissions.isAdmin(emailPrefix)) {
        return res.redirect(302, '/RH/areaadm.html');
    }
    return res.redirect(302, '/RH/funcionario.html');
}

app.get(['/PCP', '/PCP/'], authenticateModuleHtmlArea('pcp'), redirectToCanonicalModule('/PCP/index.html'));
app.get(['/NFe', '/NFe/', '/e-Nf-e', '/e-Nf-e/'], authenticateModuleHtmlArea('nfe'), redirectToCanonicalModule('/NFe/index.html'));
app.get(['/Financeiro', '/Financeiro/'], authenticateModuleHtmlArea('financeiro'), redirectToCanonicalModule('/Financeiro/resumo'));
// Guard de Vendas: destrava acesso ao módulo p/ kanban-only e restringe não-vendedores ao Kanban (index.html)
const vendasPageGuard = authCentral.requireVendasPage();
app.get(['/Vendas', '/Vendas/'], vendasPageGuard, redirectToCanonicalModule('/Vendas/index.html'));
app.get(['/CRM', '/CRM/', '/crm', '/crm/'], vendasPageGuard, redirectToCanonicalModule('/Vendas/prospeccao.html'));
app.get(['/Contador', '/Contador/'], authenticateModuleHtmlArea('contador'), redirectToCanonicalModule('/modules/Contador/index.html'));
app.get(['/Contador/produtos-fiscais', '/Contador/produtos-fiscais.html'], authenticateModuleHtmlArea('contador'), (req, res) => res.sendFile(path.join(__dirname, 'modules', 'Contador', 'produtos-fiscais.html')));
app.get(['/Contador/parametros-fiscais', '/Contador/parametros-fiscais.html'], authenticateModuleHtmlArea('contador'), (req, res) => res.sendFile(path.join(__dirname, 'modules', 'Contador', 'parametros-fiscais.html')));
app.get(['/Compras', '/Compras/'], authenticateModuleHtmlArea('compras'), redirectToCanonicalModule('/Compras/index.html'));
app.get(['/RH', '/RH/', '/RecursosHumanos', '/RecursosHumanos/'], authenticatePage, redirectToCanonicalRh);
app.get(['/Logistica', '/Logistica/'], authenticateModuleHtmlArea(['logistica', 'nfe', 'vendas']), redirectToCanonicalModule('/Logistica/index.html'));
app.get(['/Faturamento', '/Faturamento/'], authenticateModuleHtmlArea(['faturamento', 'nfe', 'financeiro']), redirectToCanonicalModule('/Faturamento/index.html'));

// PCP
app.get('/PCP/*.html', authenticateModuleHtmlArea('pcp'), (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'PCP'));
});
app.get('/PCP/*', (req, res, next) => {
    if (req.params[0].includes('.')) return next(); // skip static assets
    authenticateModuleHtmlArea('pcp')(req, res, () => serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'PCP')));
});
app.get('/modules/PCP/*.html', authenticateModuleHtmlArea('pcp'), (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'PCP'));
});

// NFe
app.get('/NFe/*.html', authenticateModuleHtmlArea('nfe'), (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'NFe'));
});
app.get('/NFe/*', (req, res, next) => {
    if (req.params[0].includes('.')) return next();
    authenticateModuleHtmlArea('nfe')(req, res, () => serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'NFe')));
});
app.get('/e-Nf-e/*.html', authenticateModuleHtmlArea('nfe'), (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'NFe'));
});
app.get('/e-Nf-e/*', (req, res, next) => {
    if (req.params[0].includes('.')) return next();
    authenticateModuleHtmlArea('nfe')(req, res, () => serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'NFe')));
});

// Financeiro — com clean URLs e aliases root-level
// Todas as páginas disponíveis no módulo Financeiro
const finEnabledPages = ['index', 'contas_pagar', 'contas_receber', 'contas_bancarias', 'fluxo_caixa', 'relatorios', 'plano_contas', 'centros_custo', 'conciliacao', 'orcamentos', 'impostos'];
function serveFinanceiroDashboard(req, res, next) {
    req.params = { 0: 'index.html' };
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'Financeiro'));
}
app.get(['/Financeiro/centros-custo', '/Financeiro/centros-custo.html'], authenticateModuleHtmlArea('financeiro'), (req, res, next) => {
    req.params = { 0: 'centros_custo.html' };
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'Financeiro', 'public'));
});
app.get(['/Financeiro/bancos', '/Financeiro/bancos.html'], (req, res) => res.redirect(301, '/Financeiro/contas-bancarias'));
app.get('/Financeiro/*.html', authenticateModuleHtmlArea('financeiro'), (req, res, next) => {
    const rawPage = req.params[0].split('/').pop(); // Express strip .html from wildcard
    const page = rawPage.replace(/-/g, '_');
    if (page === 'index') {
        return serveFinanceiroDashboard(req, res, next);
    }
    if (!finEnabledPages.includes(page)) {
        return res.redirect('/Financeiro/index.html');
    }
    req.params[0] = `${page}.html`;
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'Financeiro', 'public'));
});
app.get('/Financeiro/*', (req, res, next) => {
    if (req.params[0].includes('.')) return next();
    authenticateModuleHtmlArea('financeiro')(req, res, () => {
        const cleanPage = path.basename(req.params[0]).replace(/-/g, '_');
        if (cleanPage === 'index') {
            return serveFinanceiroDashboard(req, res, next);
        }
        serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'Financeiro', 'public'));
    });
});

// Aliases root-level para páginas do Financeiro (apenas habilitadas)
const finRootAliases = {
    'contas-pagar': 'contas_pagar',
    'contas-receber': 'contas_receber',
    'contas-bancarias': 'contas_bancarias',
    'bancos': 'contas_bancarias',
    'fluxo-caixa': 'fluxo_caixa',
    'plano-contas': 'plano_contas',
    'centros-custo': 'centros_custo',
    'relatorios': 'relatorios'
};
// Alias singular /relatorio → redireciona para /relatorios
app.get('/relatorio', (req, res) => res.redirect(301, '/relatorios'));
Object.entries(finRootAliases).forEach(([alias, file]) => {
    app.get(`/${alias}`, authenticateModuleHtmlArea('financeiro'), (req, res, next) => {
        req.params = { 0: `${file}.html` };
        safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'Financeiro', 'public'));
    });
});

// Vendas — 'vendas' é área real e bem populada no DB (43/60 usuários), sem padrão de
// autoatendimento universal como o RH, então o gate estrito não corre risco de travar
// ninguém que já não devesse estar fora do módulo.
app.get(['/CRM/*.html', '/crm/*.html'], vendasPageGuard, redirectToCanonicalModule('/Vendas/prospeccao.html'));
app.get(['/CRM/*', '/crm/*'], (req, res, next) => {
    if (req.params[0].includes('.')) return next();
    vendasPageGuard(req, res, () => res.redirect(302, '/Vendas/prospeccao.html'));
});
app.get('/Vendas/*.html', vendasPageGuard, (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'Vendas', 'public'));
});
app.get('/Vendas/*', (req, res, next) => {
    if (req.params[0].includes('.')) return next();
    vendasPageGuard(req, res, () => serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'Vendas', 'public')));
});

// Compras
app.get('/Compras/*.html', authenticateModuleHtmlArea('compras'), (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'Compras'));
});
app.get('/Compras/*', (req, res, next) => {
    if (req.params[0].includes('.')) return next();
    authenticateModuleHtmlArea('compras')(req, res, () => serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'Compras')));
});

// RH
app.get('/RecursosHumanos/*.html', authenticateRhHtml, (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'RH', 'public'));
});
app.get('/RecursosHumanos/*', (req, res, next) => {
    if (req.params[0].includes('.')) return next();
    authenticateRhHtml(req, res, () => serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'RH', 'public')));
});
// Página "Dados Pessoais" descontinuada — consolidada em "Dados Cadastrais"
app.get(['/RH/dados-pessoais.html', '/RecursosHumanos/dados-pessoais.html', '/rh/dados-pessoais.html'], (req, res) => {
    return res.redirect(301, '/RH/pages/dados-cadastrais.html');
});
app.get('/RH/*.html', authenticateRhHtml, (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'RH', 'public'));
});
app.get('/RH/*', (req, res, next) => {
    if (req.params[0].includes('.')) return next();
    authenticateRhHtml(req, res, () => serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'RH', 'public')));
});

// Logistica — só 1/60 usuários tem a área 'logistica' explícita no DB (é tratada como
// permissão de especialista, não "departamento"); CT-e/MDF-e no dia a dia é operado por
// quem já tem nfe/vendas. Gate any-of evita travar esse uso real enquanto ainda fecha o
// buraco original (ex.: usuário só de RH/PCP não entrava mais aqui).
app.get('/Logistica/*.html', authenticateModuleHtmlArea(['logistica', 'nfe', 'vendas']), (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'Logistica', 'public'));
});
app.get('/Logistica/*', (req, res, next) => {
    if (req.params[0].includes('.')) return next();
    authenticateModuleHtmlArea(['logistica', 'nfe', 'vendas'])(req, res, () => serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'Logistica', 'public')));
});

// Faturamento — mesmo raciocínio da Logistica: só 3/60 usuários têm 'faturamento'
// explícito (especialista fiscal), enquanto o uso real do dia a dia (emissão de NF-e,
// consulta) é de quem já tem nfe/financeiro. Gate any-of fecha o buraco sem travar
// o fluxo fiscal real.
app.get('/Faturamento/*.html', authenticateModuleHtmlArea(['faturamento', 'nfe', 'financeiro']), (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'Faturamento', 'public'));
});
app.get('/Faturamento/*', (req, res, next) => {
    if (req.params[0].includes('.')) return next();
    authenticateModuleHtmlArea(['faturamento', 'nfe', 'financeiro'])(req, res, () => serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'Faturamento', 'public')));
});

app.use('/modules', (req, res, next) => {
    if (req.path.toLowerCase().endsWith('.html')) {
        return authenticateModuleHtml(req, res, next);
    }
    next();
});

// Catch-all modules
app.get('/modules/*.html', authenticateModuleHtml, (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules'));
});

// Rotas estáticas do PCP - Cache desabilitado para TODOS os tipos de arquivo
app.use('/PCP', express.static(path.join(__dirname, 'modules', 'PCP'), {
    dotfiles: 'deny',
    index: false,
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => {
        // Desabilitar cache para TODOS os arquivos do PCP
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.png')) {
            res.setHeader('Content-Type', 'image/png');
        } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
            res.setHeader('Content-Type', 'image/jpeg');
        } else if (filePath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
    }
}));

// Rota para servir módulo PCP com /modules/PCP - Cache desabilitado para TODOS os tipos
app.use('/modules/PCP', express.static(path.join(__dirname, 'modules', 'PCP'), {
    dotfiles: 'deny',
    index: false,
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => {
        // Desabilitar cache para TODOS os arquivos do PCP
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
    }
}));

// FRENTE-4 FIX: setHeaders para MIME types explícitos em todos os módulos
const moduleStaticOpts = (res, filePath) => {
    if (filePath.endsWith('.css'))       res.setHeader('Content-Type', 'text/css; charset=utf-8');
    else if (filePath.endsWith('.js'))   res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    else if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    else if (filePath.endsWith('.png'))  res.setHeader('Content-Type', 'image/png');
    else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) res.setHeader('Content-Type', 'image/jpeg');
    else if (filePath.endsWith('.svg'))  res.setHeader('Content-Type', 'image/svg+xml');
    else if (filePath.endsWith('.woff2')) res.setHeader('Content-Type', 'font/woff2');
    else if (filePath.endsWith('.woff')) res.setHeader('Content-Type', 'font/woff');
    // PERF: Cache-Control para assets estaticos de modulos (paginas usam ?v=... para invalidar)
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    } else if (/\.(png|jpg|jpeg|gif|ico|svg|webp|woff|woff2|ttf|eot)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    } else if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
    }
};
const mso = { dotfiles: 'deny', index: false, setHeaders: moduleStaticOpts };

const nfeStaticOptions = {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res, filePath) => {
        moduleStaticOpts(res, filePath);
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
};
app.use('/NFe', express.static(path.join(__dirname, 'modules', 'NFe'), nfeStaticOptions));
app.use('/e-Nf-e', express.static(path.join(__dirname, 'modules', 'NFe'), nfeStaticOptions));

// Servir templates de importação Zyntra (xlsx) para download direto
// Rota explícita para subpastas (zyntra/) + arquivo direto
app.get('/templates/:folder/:file', (req, res) => {
    // Security: block path traversal (decode first to catch %2e%2e)
    const folder = decodeURIComponent(req.params.folder);
    const file = decodeURIComponent(req.params.file);
    if (folder.includes('..') || file.includes('..') || folder.includes('/') || folder.includes('\\') || file.includes('/') || file.includes('\\')) {
        return res.status(400).json({ error: 'Caminho inválido' });
    }
    const filePath = path.join(__dirname, 'templates', folder, file);
    // Verify resolved path stays within templates dir
    const resolvedPath = path.resolve(filePath);
    const templatesDir = path.resolve(path.join(__dirname, 'templates'));
    if (!resolvedPath.startsWith(templatesDir + path.sep)) {
        return res.status(400).json({ error: 'Caminho inválido' });
    }
    if (!resolvedPath.endsWith('.xlsx')) {
        return res.status(400).json({ error: 'Apenas arquivos .xlsx são permitidos' });
    }
    res.download(resolvedPath, file, (err) => {
        if (err && !res.headersSent) {
            res.status(404).json({ error: 'Template não encontrado' });
        }
    });
});
app.get('/templates/:file', (req, res) => {
    // Security: block path traversal (decode first to catch %2e%2e)
    const file = decodeURIComponent(req.params.file);
    if (file.includes('..') || file.includes('/') || file.includes('\\')) {
        return res.status(400).json({ error: 'Caminho inválido' });
    }
    const filePath = path.join(__dirname, 'templates', file);
    const resolvedPath = path.resolve(filePath);
    const templatesDir = path.resolve(path.join(__dirname, 'templates'));
    if (!resolvedPath.startsWith(templatesDir + path.sep)) {
        return res.status(400).json({ error: 'Caminho inválido' });
    }
    if (!resolvedPath.endsWith('.xlsx')) {
        return res.status(400).json({ error: 'Apenas arquivos .xlsx são permitidos' });
    }
    res.download(resolvedPath, file, (err) => {
        if (err && !res.headersSent) {
            console.error(`[Templates] Arquivo não encontrado: ${filePath}`);
            res.status(404).json({ error: 'Template não encontrado' });
        }
    });
});

// __FIX_BANCO_VETORES_ROUTE__ bank logos (bancos-vetores não está dentro de /public, precisa de rota própria)
app.use('/bancos-vetores', express.static(path.join(__dirname, 'modules', 'Financeiro', 'bancos-vetores'), mso));
app.use('/Financeiro/js', express.static(path.join(__dirname, 'modules', 'Financeiro', 'js'), mso));
app.use('/Financeiro/css', express.static(path.join(__dirname, 'modules', 'Financeiro', 'css'), mso));
app.use('/Financeiro', express.static(path.join(__dirname, 'modules', 'Financeiro', 'public'), mso));
app.use('/Compras', express.static(path.join(__dirname, 'modules', 'Compras'), mso));
app.use('/Logistica/css', express.static(path.join(__dirname, 'modules', 'Logistica', 'css'), mso));
app.use('/Logistica', express.static(path.join(__dirname, 'modules', 'Logistica', 'public'), mso));

// Qualidade (Controle de Qualidade) — restrito a quem tem a área 'qualidade' (hoje só
// Felipe Simões, 29/06/2026) + admins. Antes não tinha nenhum gate de área porque nenhum
// usuário tinha essa permissão no DB (gate estrito travaria todo mundo); agora que existe
// ao menos uma concessão real, o gate passa a fazer sentido.
app.get('/qualidade', authenticateModuleHtmlArea('qualidade'), (req, res) => res.redirect('/Qualidade/index.html'));
app.get('/Qualidade/*.html', authenticateModuleHtmlArea('qualidade'), (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'Qualidade', 'public'));
});
app.get('/Qualidade/*', (req, res, next) => {
    if (!req.params[0]) return next();
    if (req.params[0].includes('.')) return next();
    authenticateModuleHtmlArea('qualidade')(req, res, () => serveCleanUrl(req, res, next, path.join(__dirname, 'modules', 'Qualidade', 'public')));
});
app.get('/Qualidade', authenticateModuleHtmlArea('qualidade'), (req, res) => {
    res.redirect(302, '/Qualidade/index.html');
});
app.use('/Qualidade', express.static(path.join(__dirname, 'modules', 'Qualidade', 'public'), mso));

// Painel de Tarefas (geral) — branding via zyntra-branding
app.get('/tarefas', authenticatePage, (req, res) => res.redirect('/Tarefas/index.html'));
app.get('/Tarefas/*.html', authenticateModuleHtml, (req, res, next) => {
    safeSendModuleHtml(req, res, next, path.join(__dirname, 'modules', 'Tarefas', 'public'));
});
app.get('/Tarefas', authenticateModuleHtml, (req, res) => {
    res.redirect(302, '/Tarefas/index.html');
});
app.use('/Tarefas', express.static(path.join(__dirname, 'modules', 'Tarefas', 'public'), mso));
app.use('/Faturamento/css', express.static(path.join(__dirname, 'modules', 'Faturamento', 'public', 'css'), mso));
app.use('/Faturamento/js', express.static(path.join(__dirname, 'modules', 'Faturamento', 'public', 'js'), mso));
app.use('/RecursosHumanos', express.static(path.join(__dirname, 'modules', 'RH', 'public'), mso));
app.use('/RH', express.static(path.join(__dirname, 'modules', 'RH', 'public'), mso));

// Servir arquivos compartilhados dos módulos
app.use('/_shared', express.static(path.join(__dirname, 'modules', '_shared'), { dotfiles: 'deny', index: false }));

// Servir módulos diretamente com rotas específicas
app.use('/modules', express.static(path.join(__dirname, 'modules'), {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res, filePath) => {
        moduleStaticOpts(res, filePath);
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Preview publico do colaborador usado na tela de login.
// Retorna apenas dados minimos nao sensiveis para saudacao antes da autenticacao.
const loginPreviewLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Muitas consultas. Tente novamente em instantes.' }
});

app.get('/api/public/usuarios/preview', loginPreviewLimiter, asyncHandler(async (req, res) => {
    try {
        const rawEmail = String(req.query.email || '').trim().toLowerCase();
        const rawCpf = String(req.query.cpf || '').replace(/\D/g, '');

        if (!rawEmail && !rawCpf) {
            return res.status(400).json({ success: false, message: 'Informe email ou CPF' });
        }
        if (rawEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) {
            return res.status(400).json({ success: false, message: 'Email invalido' });
        }
        if (rawCpf && rawCpf.length !== 11) {
            return res.status(400).json({ success: false, message: 'CPF invalido' });
        }

        const normalizeFoto = (value) => {
            if (!value || String(value).endsWith('.svg')) return null;
            return String(value).startsWith('/') ? String(value) : `/avatars/${value}`;
        };
        const sanitize = (value) => value ? String(value).trim() : null;

        let usuario = null;
        if (rawEmail) {
            const loginPart = rawEmail.split('@')[0];
            const [rows] = await pool.query(
                `SELECT u.nome, u.email, u.apelido, u.foto, u.avatar, u.setor, u.departamento,
                        f.nome_completo, f.cargo, f.departamento AS departamento_func,
                        f.foto_perfil_url, f.foto_thumb_url
                   FROM usuarios u
              LEFT JOIN funcionarios f ON (LOWER(u.email) = LOWER(f.email) OR u.login = SUBSTRING_INDEX(f.email, '@', 1) OR (u.nome IS NOT NULL AND f.nome_completo IS NOT NULL AND TRIM(LOWER(u.nome)) = TRIM(LOWER(f.nome_completo))))
                  WHERE LOWER(u.email) = ? OR u.login = ?
                  LIMIT 1`,
                [rawEmail, loginPart]
            );
            usuario = rows && rows[0] ? rows[0] : null;

            if (!usuario) {
                const [funcionarios] = await pool.query(
                    `SELECT nome_completo, email, cargo, departamento, foto_perfil_url, foto_thumb_url
                       FROM funcionarios
                      WHERE LOWER(email) = ?
                      LIMIT 1`,
                    [rawEmail]
                );
                usuario = funcionarios && funcionarios[0] ? funcionarios[0] : null;
            }
        } else if (rawCpf) {
            const [funcionarios] = await pool.query(
                `SELECT nome_completo, email, cargo, departamento, foto_perfil_url, foto_thumb_url
                   FROM funcionarios
                  WHERE REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = ?
                  LIMIT 1`,
                [rawCpf]
            );
            usuario = funcionarios && funcionarios[0] ? funcionarios[0] : null;
        }

        if (!usuario) {
            return res.json({ success: false, message: 'Usuario nao encontrado' });
        }

        const nome = sanitize(usuario.nome_completo || usuario.nome || usuario.apelido);
        const cargo = sanitize(usuario.cargo || usuario.departamento_func || usuario.departamento || usuario.setor);
        let foto = normalizeFoto(usuario.foto_perfil_url || usuario.foto_thumb_url || usuario.foto || usuario.avatar);

        // @labor.com.br herda a foto do colaborador equivalente na Aluforce (mesmo local-part do e-mail).
        // As fotos ficam em /var/www/uploads (compartilhado) e o mount /uploads ja existe nesta instancia.
        if (!foto && rawEmail.endsWith('@labor.com.br')) {
            try {
                const aluLogin = rawEmail.split('@')[0];
                const [aluRows] = await pool.query(
                    `SELECT COALESCE(NULLIF(u.foto, ''), NULLIF(u.avatar, '')) AS foto_usuario,
                            f.foto_perfil_url, f.foto_thumb_url
                       FROM aluforce_vendas.usuarios u
                  LEFT JOIN aluforce_vendas.funcionarios f
                         ON LOWER(SUBSTRING_INDEX(f.email, '@', 1)) = LOWER(SUBSTRING_INDEX(u.email, '@', 1))
                      WHERE LOWER(SUBSTRING_INDEX(u.email, '@', 1)) = ?
                      LIMIT 1`,
                    [aluLogin]
                );
                const alu = aluRows && aluRows[0] ? aluRows[0] : null;
                if (alu) {
                    foto = normalizeFoto(alu.foto_perfil_url || alu.foto_thumb_url || alu.foto_usuario);
                }
            } catch (aluErr) {
                console.warn('[LOGIN PREVIEW] Falha ao herdar foto da Aluforce:', aluErr.message);
            }
        }

        return res.json({
            success: true,
            nome,
            apelido: sanitize(usuario.apelido),
            cargo,
            departamento: sanitize(usuario.departamento_func || usuario.departamento || usuario.setor),
            foto,
            email: sanitize(usuario.email)
        });
    } catch (error) {
        console.error('[LOGIN PREVIEW] Erro ao buscar colaborador:', error.message);
        return res.status(500).json({ success: false, message: 'Erro interno' });
    }
}));

// =================================================================
// ENDPOINT DE HEALTH CHECK — Enterprise Monitoring
// =================================================================
const healthEndpoint = createHealthEndpoint(pool, cacheService);
app.get('/api/health', healthEndpoint);
app.get('/health', healthEndpoint);

// =================================================================
// 🤖 DISCORD — Rotas de notificação em tempo real
// =================================================================
try {
    const discordRoutes = require('./routes/discord');
    app.use('/api/discord', discordRoutes);
    console.log('✅ Rotas Discord carregadas: /api/discord/*');
} catch (e) {
    console.warn('⚠️  Rotas Discord não disponíveis:', e.message);
}

// =================================================================
// 🤖 N8N — Rotas de integração com n8n Workflow Automation
// =================================================================
try {
    const n8nRoutes = require('./routes/n8n-webhooks');
    app.use('/api/n8n', n8nRoutes);
    // Disponibilizar pool e cache para as rotas n8n
    app.set('dbPool', pool);
    app.set('cacheService', cacheService);
    console.log('✅ Rotas n8n carregadas: /api/n8n/*');
} catch (e) {
    console.warn('⚠️  Rotas n8n não disponíveis:', e.message);
}

// =================================================================
// 📲 WhatsApp Alertas — Rotas para alertas automáticos via WhatsApp
// =================================================================
try {
    const whatsappAlertasRoutes = require('./routes/whatsapp-alertas');
    app.use('/api/whatsapp-alertas', whatsappAlertasRoutes);
    console.log('✅ Rotas WhatsApp Alertas carregadas: /api/whatsapp-alertas/*');
} catch (e) {
    console.warn('⚠️  Rotas WhatsApp Alertas não disponíveis:', e.message);
}

// =================================================================
// 🚀 Zyntra SGE — Rotas de Teste Grátis / Trials
// =================================================================
try {
    const zyntraTrialsRoutes = require('./routes/zyntra-trials');
    app.use('/api/zyntra', zyntraTrialsRoutes);
    console.log('✅ Rotas Zyntra Trials carregadas: /api/zyntra/*');
} catch (e) {
    console.warn('⚠️  Rotas Zyntra Trials não disponíveis:', e.message);
}

// =================================================================
// 4. MIDDLEWARES DE AUTENTICAÇÃO E AUTORIZAÇÃO
// [REFACTORED 10/03/2026] Delegado para middleware/auth-central.js
// =================================================================
const authenticateToken = authCentral.authenticateToken;

// Middleware para autorizar admin, comercial ou financeiro para Vendas/CRM
const authorizeAdminOrComercial = (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase().trim();
    const isAdm = role === 'admin' || role === 'administrador' ||
                  req.user?.is_admin === 1 || req.user?.is_admin === true || req.user?.is_admin === '1';
    const isComercial = role === 'comercial';
    const isFinanceiro = role === 'financeiro';
    const isGerente = role === 'gerente' || role === 'gerente_comercial' || role === 'supervisor' || role === 'diretor' || role === 'diretoria';
    if (isAdm || isComercial || isFinanceiro || isGerente) {
        return next();
    }
    return res.status(403).json({ message: 'Acesso negado. Requer privilégios de administrador, comercial ou financeiro.' });
};

// =================================================================
// é PROXY — Consulta CNPJ (BrasilAPI) e CEP (ViaCEP) sem CORS
// =================================================================
const axios = require('axios');

app.get('/api/proxy/cnpj/:cnpj', authenticateToken, asyncHandler(async (req, res) => {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
    try {
        const { data } = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { timeout: 15000 });
        res.json(data);
    } catch (err) {
        // Fallback para ReceitaWS
        try {
            const { data: data2 } = await axios.get(`https://receitaws.com.br/v1/cnpj/${cnpj}`, { timeout: 15000 });
            if (data2 && data2.status !== 'ERROR') {
                res.json({ ...data2, _fonte: 'receitaws' });
            } else {
                res.status(404).json({ error: 'CNPJ não encontrado' });
            }
        } catch (err2) {
            const status = err.response?.status || 502;
            res.status(status).json({ error: 'Erro ao consultar CNPJ' });
        }
    }
}));

// Proxy IBGE Municípios
app.get('/api/proxy/ibge/municipios/:uf', authenticateToken, asyncHandler(async (req, res) => {
    const uf = req.params.uf;
    try {
        const { data } = await axios.get(`https://brasilapi.com.br/api/ibge/municipios/v1/${uf}?providers=dados-abertos-br,gov,wikipedia`, { timeout: 10000 });
        res.json(data);
    } catch (err) {
        res.status(err.response?.status || 502).json({ error: 'Erro ao consultar IBGE' });
    }
}));

// Proxy CNAE
app.get('/api/proxy/cnae/:codigo', authenticateToken, asyncHandler(async (req, res) => {
    const codigo = req.params.codigo;
    try {
        const { data } = await axios.get(`https://brasilapi.com.br/api/cnae/v2/${codigo}`, { timeout: 10000 });
        res.json(data);
    } catch (err) {
        res.status(err.response?.status || 502).json({ error: 'Erro ao consultar CNAE' });
    }
}));

// Proxy DDD
app.get('/api/proxy/ddd/:ddd', authenticateToken, asyncHandler(async (req, res) => {
    const ddd = req.params.ddd;
    try {
        const { data } = await axios.get(`https://brasilapi.com.br/api/ddd/v1/${ddd}`, { timeout: 10000 });
        res.json(data);
    } catch (err) {
        res.status(err.response?.status || 502).json({ error: 'Erro ao consultar DDD' });
    }
}));

app.get('/api/proxy/cep/:cep', authenticateToken, asyncHandler(async (req, res) => {
    const cep = req.params.cep.replace(/\D/g, '');
    if (cep.length !== 8) return res.status(400).json({ error: 'CEP inválido' });
    try {
        const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 10000 });
        res.json(data);
    } catch (err) {
        const status = err.response?.status || 502;
        res.status(status).json({ error: 'Erro ao consultar CEP' });
    }
}));

// =================================================================
// 📄 RELATÓRIOS HTML — render server-side (UNIFICADO)
// =================================================================
try {
    const relatoriosHtmlRouter = require('./routes/relatorios-html')({ pool, authenticateToken });
    app.use('/api/relatorios-html', relatoriosHtmlRouter);
    console.log('✅ Rotas Relatórios HTML carregadas: /api/relatorios-html/*');
} catch (err) {
    console.error('❌ Erro ao carregar relatorios-html:', err.message);
}

// =================================================================
// 🧮 CONTADOR API — Painel do Contador (UNIFICADO)
// =================================================================
try {
    const createContadorRoutes = require('./routes/contador-routes');
    app.use('/api/contador', createContadorRoutes({ pool, authenticateToken, authorizeArea }));
    console.log('✅ Rotas Contador API carregadas: /api/contador/*');
} catch (err) {
    console.error('❌ Erro ao carregar rotas Contador:', err.message);
}

// =================================================================
// 📄 NFe API — Extracted to routes/nfe-api.js
// =================================================================
const nfeApiRouter = require('./routes/nfe-api')({ authenticateToken, pool });
// AUDIT-FIX: Adicionado authorizeArea('nfe') — antes qualquer usuário autenticado acessava
app.use('/api/nfe', authenticateToken, authorizeArea('nfe'), nfeApiRouter);
console.log('✅ Rotas NFe API carregadas (modular): /api/nfe/*');

// =================================================================
// 🧾 CONFIGURAÇÃO FISCAL API — regras por NCM (IPI/CST/ICMS) e ICMS-ST editáveis
// =================================================================
try {
    const { requireAdmin: fiscalRequireAdmin } = require('./middleware/auth');
    const fiscalConfigRouter = require('./routes/api-fiscal-config')(pool, authenticateToken, fiscalRequireAdmin);
    app.use('/api/fiscal-config', fiscalConfigRouter);
    console.log('✅ Rotas Configuração Fiscal carregadas: /api/fiscal-config/*');
} catch (err) {
    console.error('❌ Erro ao carregar rotas Configuração Fiscal:', err.message);
}

// =================================================================
// 🚚 LOGÍSTICA API — AUDIT-FIX: Removido mount duplicado
// Já montado via routes/index.js → registerAllRoutes()
// =================================================================
// (logistica-routes agora carregado apenas em routes/index.js)

// =================================================================
// 📄 FATURAMENTO API — Módulo de Faturamento/NFe (SEFAZ, certificado)
// =================================================================
try {
    const faturamentoRouter = require('./modules/Faturamento/api/faturamento');
    const { idempotency } = require('./middleware/idempotency');
    const { auditTrail } = require('./middleware/audit-trail');
    app.use('/api/faturamento', idempotency(), auditTrail('faturamento'), faturamentoRouter(pool, authenticateToken));
    console.log('✅ Rotas Faturamento API carregadas: /api/faturamento/*');
} catch (err) {
    console.error('❌ Erro ao carregar rotas Faturamento:', err.message);
}

// =================================================================
// 📊 CONTÁBIL-FISCAL API — SPED EFD, Bloco K, Apurações ICMS/PIS/COFINS
// =================================================================
try {
    const createContabilFiscalRouter = require('./routes/api-contabil-fiscal');
    app.use('/api/contabil', authenticateToken, createContabilFiscalRouter(pool, authenticateToken));
    console.log('✅ Rotas Contábil-Fiscal API carregadas: /api/contabil/*');
} catch (err) {
    console.error('❌ Erro ao carregar rotas Contábil-Fiscal:', err.message);
}

// =================================================================
// é FINANCEIRO API — Módulo Financeiro (contas, fluxo de caixa, etc.)
// =================================================================
try {
    const financeiroRoutes = require('./src/routes/financeiro');
    app.use('/api/financeiro', financeiroRoutes);
    try { const financeiroCobrancaRoutes = require('./src/routes/financeiro-cobranca'); app.use('/api/financeiro', financeiroCobrancaRoutes); console.log('Rotas Financeiro/Cobranca carregadas'); } catch(e){ console.error('cobranca mount err', e.message); }
    console.log('✅ Rotas Financeiro API carregadas: /api/financeiro/*');
} catch (err) {
    console.error('❌ Erro ao carregar rotas Financeiro:', err.message);
}

// =================================================================
// 🛒 COMPRAS API — Módulo de Compras (fornecedores, pedidos, etc.)
// =================================================================
try {
    const comprasDb = require('./modules/Compras/database');
    comprasDb.initMySQLPool().then(() => {
        console.log('✅ Pool MySQL Compras inicializado');
    }).catch(err => {
        console.error('❌ Erro ao inicializar pool Compras:', err.message);
    });

    const comprasFornecedoresRoutes = require('./modules/Compras/api/fornecedores');
    const comprasPedidosRoutes = require('./modules/Compras/api/pedidos');
    const comprasCotacoesRoutes = require('./modules/Compras/api/cotacoes');
    const comprasEstoqueRoutes = require('./modules/Compras/api/estoque');
    const comprasMateriaisRoutes = require('./modules/Compras/api/materiais');
    const comprasRequisicoesRoutes = require('./modules/Compras/api/requisicoes');
    const comprasRecebimentoRoutes = require('./modules/Compras/api/recebimento');
    const comprasRelatoriosRoutes = require('./modules/Compras/api/relatorios');
    const comprasCentrosCustoRoutes = require('./modules/Compras/api/centros-custo');

    app.use('/api/compras/fornecedores', authenticateToken, authorizeArea('compras'), comprasFornecedoresRoutes);
    app.use('/api/compras/pedidos', authenticateToken, authorizeArea('compras'), comprasPedidosRoutes);
    app.use('/api/compras/cotacoes', authenticateToken, authorizeArea('compras'), comprasCotacoesRoutes);
    app.use('/api/compras/estoque', authenticateToken, authorizeArea('compras'), comprasEstoqueRoutes);
    app.use('/api/compras/materiais', authenticateToken, authorizeArea('compras'), comprasMateriaisRoutes);
    app.use('/api/compras/requisicoes', authenticateToken, authorizeArea('compras'), comprasRequisicoesRoutes);
    app.use('/api/compras/recebimento', authenticateToken, authorizeArea('compras'), comprasRecebimentoRoutes);
    app.use('/api/compras/relatorios', authenticateToken, authorizeArea('compras'), comprasRelatoriosRoutes);
    app.use('/api/compras/centros-custo', authenticateToken, authorizeArea('compras'), comprasCentrosCustoRoutes);

    console.log('✅ Rotas Compras API carregadas: /api/compras/*');
} catch (err) {
    console.error('❌ Erro ao carregar rotas Compras:', err.message);
}

// 📊 ENTERPRISE: Prometheus /metrics endpoint (protected at app level + nginx)
app.get('/metrics', (req, res, next) => {
    // SECURITY: Require auth in ALL environments (metrics expose internal data)
    const metricsToken = process.env.METRICS_TOKEN;
    const authHeader = req.headers['authorization'];
    const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
    if (!isLocalhost && (!metricsToken || authHeader !== `Bearer ${metricsToken}`)) {
        return res.status(403).json({ error: 'Acesso não autorizado' });
    }
    next();
}, createMetricsEndpoint(pool, cacheService));

// AUDIT-FIX: requestTimeout movido para antes das rotas (agora após applySecurityMiddlewares)

// =================================================================
// ENDPOINT DE FOTO DO USUÁRIO - Busca foto pelo email (autenticado)
// =================================================================


// Rota específica para módulo Vendas - APENAS recursos estáticos (CSS, JS, imagens)
// Bloqueia acesso direto a arquivos HTML (requer autenticação via rotas específicas)
app.use('/modules/Vendas', (req, res, next) => {
    // Bloquear acesso a arquivos HTML - devem passar pelas rotas autenticadas
    if (req.path.endsWith('.html') || req.path === '/' || req.path === '') {
        return res.redirect('/login.html');
    }
    next();
}, express.static(path.join(__dirname, 'modules', 'Vendas'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// Configuração do Multer para upload de arquivos
// Em produção (Linux/VPS), salvar fora do projeto para não perder em deploys
const uploadDir = process.platform !== 'win32'
    ? '/var/www/uploads/RH'
    : path.join(__dirname, 'public', 'uploads', 'RH');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let subfolder = 'outros';
        if (file.fieldname === 'foto') subfolder = 'fotos';
        if (file.fieldname === 'holerite') subfolder = 'holerites';
        if (file.fieldname === 'atestado') subfolder = 'atestados';
        if (file.fieldname === 'logo' || file.fieldname === 'favicon') subfolder = 'empresa';
        if (file.fieldname === 'avatar') subfolder = 'avatars';
        const dest = path.join(uploadDir, subfolder);
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const unique = `${file.fieldname}-${Date.now()}-${Math.floor(Math.random() * 1e9)}${ext}`;
        cb(null, unique);
    }
});
const upload = multer({ storage });

// Em produção (VPS), servir uploads e avatars de /var/www/uploads/ (fora do projeto, protegido de deploys)
if (process.platform !== 'win32') {
    app.use('/avatars', express.static('/var/www/uploads/avatars', {
        maxAge: '1d',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']
    }));
    app.use('/uploads', express.static('/var/www/uploads', {
        maxAge: '1d',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif']
    }));
}

// Middleware para servir avatares (fallback / desenvolvimento)
app.use('/avatars', express.static(path.join(__dirname, 'public', 'avatars'), {
    maxAge: '1d',
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']
}));

// Middleware para servir arquivos de upload do RH (fallback / desenvolvimento)
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Middleware para servir arquivos de upload do módulo RH (fotos funcionários)
app.use('/uploads', express.static(path.join(__dirname, 'modules', 'RH', 'public', 'uploads'), {
    maxAge: '1d',
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif']
}));

// ============================================================
// PAGE AUTHENTICATION MIDDLEWARE
// ============================================================
// AUDIT-FIX R2: REFRESH_SECRET não deve derivar do JWT_SECRET
const crypto = require('crypto');
const REFRESH_SECRET = process.env.REFRESH_SECRET || crypto.createHmac('sha256', JWT_SECRET).update('refresh-token-secret').digest('hex');

function authenticatePage(req, res, next) {
    // SECURITY FIX: Exige token válido para servir páginas protegidas
    const token = req.cookies?.authToken || req.cookies?.token || req.headers['authorization']?.replace('Bearer ', '');
    if (!token) {
        // Sem access token — tentar refresh antes de redirecionar
        return _tryRefreshOrRedirect(req, res, next);
    }
    // AUDIT-FIX HIGH-006: Enforce HS256 algorithm
    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                // Access token expirado — tentar renovar via refresh token
                return _tryRefreshOrRedirect(req, res, next);
            }
            console.log('[AUTH] Token inválido ao acessar página protegida:', err.message);
            return redirectToLogin(req, res);
        }
        req.user = user;
        return next();
    });
}

function getPublicBasePath() {
    const brand = String(process.env.BRAND || '').toLowerCase();
    if (brand === 'labor-eletric') return '/labor-eletric';
    if (brand === 'labor-energy') return '/labor-energy';
    return '';
}

function getLoginRedirectUrl(req) {
    const basePath = getPublicBasePath();
    const requestedUrl = req.originalUrl || req.url || '/dashboard';
    const returnTo = basePath && !requestedUrl.startsWith(basePath)
        ? `${basePath}${requestedUrl.startsWith('/') ? requestedUrl : `/${requestedUrl}`}`
        : requestedUrl;
    const loginUrl = `/login.html?returnTo=${encodeURIComponent(returnTo)}`;
    if (!basePath) return loginUrl;
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host') || 'zyntraerp.com.br';
    return `${proto}://${host}${loginUrl}`;
}

function redirectToLogin(req, res) {
    return res.redirect(getLoginRedirectUrl(req));
}

/**
 * Tenta renovar o access token usando o refresh token cookie.
 * Se conseguir, seta novo cookie e continua; senão, redireciona para login.
 */
async function _tryRefreshOrRedirect(req, res, next) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
        console.log('[AUTH] Sem token ao acessar página protegida:', req.path);
        return redirectToLogin(req, res);
    }

    try {
        const refreshTokenModule = require('./src/auth/refresh-token');
        const decoded = jwt.verify(refreshToken, REFRESH_SECRET, { algorithms: ['HS256'] });
        if (decoded.type !== 'refresh') throw new Error('Not a refresh token');

        const result = await refreshTokenModule.refreshTokens(refreshToken, pool);
        if (!result || !result.success) throw new Error('Refresh failed');

        // Gerar novo access token com campos completos
        const newAccessToken = jwt.sign({
            id: result.user.id,
            nome: result.user.nome,
            email: result.user.username,
            role: result.user.role,
            empresa_id: result.user.empresa_id || decoded.empresa_id || null,
            is_admin: result.user.is_admin || false,
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

        console.log(`[AUTH] ✅ Token renovado via refresh para userId ${result.user.id} ao acessar: ${req.path}`);

        // Setar req.user com dados do novo token
        req.user = jwt.verify(newAccessToken, JWT_SECRET, { algorithms: ['HS256'] });
        return next();
    } catch (refreshErr) {
        console.log('[AUTH] Refresh token inválido/expirado ao acessar página protegida:', refreshErr.message);
        return redirectToLogin(req, res);
    }
}

// =================================================================
// PAGE ROUTES — Extracted to routes/page-auth-routes.js
// =================================================================
require('./routes/page-auth-routes')(app, { authenticatePage, userPermissions });
console.log('✅ Page auth routes carregadas (modular)');

// =================== AUTOMAÇÃO DE TAREFAS (NODE-CRON) ===================
// AUDIT-FIX ARCH-002: Cron jobs extracted to services/scheduler.service.js
const { initScheduler } = require('./services/scheduler.service');
const initCronJobs = () => {
    initScheduler({
        pool,
        logger,
        enviarEmail: typeof enviarEmail === 'function' ? enviarEmail : null,
        sendEmail: typeof sendEmail === 'function' ? sendEmail : null,
        emailTransporter: typeof emailTransporter !== 'undefined' ? emailTransporter : null,
        DB_AVAILABLE_FN: () => DB_AVAILABLE
    });
};

// =================================================================
// ENDPOINT PÚBLICO DE FOTO/AVATAR - Usado na tela de login (sem auth)
// Retorna apenas foto, nome e apelido — dados não sensíveis
// =================================================================
app.get('/api/public/usuarios/foto/:email', loginPreviewLimiter, asyncHandler(async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return res.status(400).json({ success: false, message: 'Email inválido' });
        }
        const loginPart = email.split('@')[0]; // e.g. "fabiano.marques"
        let nome = null, apelido = null, foto = null;
        try {
            // Match by exact email OR by login field (allows alias logins like fabiano.marques@aluforce.ind.br)
            const [usuarios] = await pool.query(
                'SELECT foto, avatar, nome, apelido FROM usuarios WHERE LOWER(email) = ? OR login = ? LIMIT 1',
                [email, loginPart]
            );
            if (usuarios.length > 0) {
                nome = usuarios[0].nome;
                apelido = usuarios[0].apelido;
                let fotoUsuario = usuarios[0].foto || null;
                if (!fotoUsuario || fotoUsuario.endsWith('.svg')) {
                    fotoUsuario = usuarios[0].avatar || null;
                }
                if (fotoUsuario && !fotoUsuario.endsWith('.svg')) {
                    foto = fotoUsuario;
                }
            }
        } catch (e) { /* silencioso */ }
        if (!foto) {
            try {
                const [funcionarios] = await pool.query(
                    'SELECT foto_perfil_url, foto_thumb_url, nome_completo FROM funcionarios WHERE LOWER(email) = ? LIMIT 1', [email]
                );
                if (funcionarios.length > 0) {
                    foto = funcionarios[0].foto_perfil_url || funcionarios[0].foto_thumb_url || null;
                    if (!nome) nome = funcionarios[0].nome_completo;
                }
            } catch (e) { /* silencioso */ }
        }
        if (nome || foto) {
            return res.json({ success: true, foto, nome, apelido: apelido || null });
        }
        return res.json({ success: false, message: 'Usuário não encontrado' });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'Erro interno' });
    }
}));

// =================================================================
// ENDPOINT DE FOTO DO USUÁRIO - Busca foto pelo email (autenticado)
// [REFACTORED 10/03/2026] Extraído de dentro do authorizeACL para evitar side-effect
// =================================================================
app.get('/api/usuarios/foto/:email', authenticateToken, asyncHandler(async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email).toLowerCase();
        let nome = null, apelido = null, foto = null;
        try {
            const [usuarios] = await pool.query(
                'SELECT foto, avatar, nome, apelido FROM usuarios WHERE LOWER(email) = ?', [email]
            );
            if (usuarios.length > 0) {
                nome = usuarios[0].nome;
                apelido = usuarios[0].apelido;
                let fotoUsuario = usuarios[0].foto || null;
                if (!fotoUsuario || fotoUsuario.endsWith('.svg')) {
                    fotoUsuario = usuarios[0].avatar || null;
                }
                if (fotoUsuario && !fotoUsuario.endsWith('.svg')) {
                    foto = fotoUsuario;
                }
            }
        } catch (e) {
            console.warn('Erro ao buscar foto em usuarios:', e.message);
        }
        if (!foto) {
            try {
                const [funcionarios] = await pool.query(
                    'SELECT foto_perfil_url, foto_thumb_url, nome_completo FROM funcionarios WHERE LOWER(email) = ? LIMIT 1', [email]
                );
                if (funcionarios.length > 0) {
                    foto = funcionarios[0].foto_perfil_url || funcionarios[0].foto_thumb_url || null;
                    if (!nome) nome = funcionarios[0].nome_completo;
                }
            } catch (e) {
                console.warn('Erro ao buscar foto em funcionarios:', e.message);
            }
        }
        if (nome || foto) {
            return res.json({ success: true, foto, nome, apelido: apelido || null });
        }
        return res.json({ success: false, message: 'Usuário não encontrado' });
    } catch (error) {
        console.error('Erro ao buscar foto do usuário:', error);
        return res.status(500).json({ success: false, error: 'Erro interno ao buscar foto' });
    }
}));

// ACL: Controle de acesso detalhado por nível de usuário
// [REFACTORED 10/03/2026] Simplificado — usa permission.service para verificação
function authorizeACL(permission) {
    return async (req, res, next) => {
        try {
            if (await authCentral.permissionService.isAdmin(req.user)) return next();

            const [rows] = await pool.query(
                'SELECT acao FROM permissoes_acoes WHERE usuario_id = ? AND acao = ? AND permitido = 1',
                [req.user?.id, permission]
            );
            if (rows.length > 0) return next();

            if (req.user?.permissions?.includes(permission)) return next();

            return res.status(403).json({ message: 'Acesso negado. Permissão insuficiente.' });
        } catch (err) {
            console.error('[ACL] Erro ao verificar permissão:', err.message);
            return res.status(403).json({ message: 'Acesso negado. Permissão insuficiente.' });
        }
    };
}


// =================================================================
// 5. ROTAS DA API

// allow tests to toggle DB availability
function setDbAvailable(val) {
    DB_AVAILABLE = !!val;
}

// Middleware para proteger rotas /api quando o banco de dados estiver indisponível.
// Deve ser montado ANTES dos routers da API para garantir que chamadas a endpoints
// dependentes do banco sejam interceptadas em modo degradado.
const apiDbGuard = (req, res, next) => {
    // Quando DB_AVAILABLE for true, tudo segue normalmente
    if (typeof DB_AVAILABLE === 'undefined' || DB_AVAILABLE === true) return next();

    // Em modo degradado (DB indisponível), permitir apenas um pequeno conjunto de endpoints
    // que verificam autenticação local via JWT (não consultam o DB).
    const whitelist = ['/me', '/permissions', '/login', '/logout', '/verify-2fa', '/resend-2fa'];
    try {
        const relPath = req.path || '/';
        if (whitelist.includes(relPath) || whitelist.some(p => relPath.startsWith(p + '/'))) {
            return next();
        }
    } catch (e) {
        // ignore
    }

    // Para todas as outras rotas da API, retornar 503 (service unavailable)
    return res.status(503).json({
        message: 'Serviço temporariamente indisponível: conexão com o banco de dados indisponível. Tente novamente mais tarde.'
    });
};

// Expor um header útil em todas as respostas indicando disponibilidade do DB
app.use((req, res, next) => {
    res.setHeader('X-DB-Available', DB_AVAILABLE ? '1' : '0');
    next();
});

// Montar o guard e o router de autenticação ANTES de registrar os routers específicos
app.use('/api', apiDbGuard);
// Protege o endpoint de login contra brute-force via authLimiter do security-middleware
app.use('/api/login', authLimiter);
// Protege endpoints 2FA contra brute-force
app.use('/api/verify-2fa', authLimiter);
app.use('/api/resend-2fa', authLimiter);
// Injeta o pool de conexão principal no authRouter para evitar pools duplicados
if (typeof authRouter.setPool === 'function') {
    authRouter.setPool(pool);
    console.log('[SERVER] ✅ Pool principal injetado no authRouter');
}
// Monta o router de autenticação (fornece /api/login e /api/logout entre outros)
app.use('/api', authRouter);

// ===================== ROTAS CONFIGURAÇÕES DA EMPRESA =====================
const { authenticateToken: authToken, requireAdmin: reqAdmin } = require('./middleware/auth');
const companySettingsFactory = require('./routes/companySettings');
const companySettingsRouter = companySettingsFactory({
    pool,
    authenticateToken: authToken,
    requireAdmin: reqAdmin
});
app.use('/api', companySettingsRouter);

// ===================== ROTAS CENTRAL DE AJUDA (engajamento) =====================
// /api/ajuda/artigo-stats, /api/ajuda/comentarios, /api/ajuda/curtida
try {
    const createAjudaRouter = require('./routes/api-ajuda');
    app.use('/api', createAjudaRouter(pool, authToken));
} catch (e) {
    console.error('[ROUTES] ⚠️ api-ajuda não carregou:', e.message);
}

// ===================== TREINAMENTOS — CONTEÚDO DE VÍDEO (upload local) =====================
// /api/treinamentos-conteudo (GET mapa+isAdmin), /upload (admin), DELETE (admin)
try {
    const createTreinamentosConteudoRouter = require('./routes/treinamentos-conteudo');
    app.use('/api', createTreinamentosConteudoRouter(authToken, reqAdmin));
    // Os vídeos são servidos pelo mount /uploads -> /var/www/uploads já existente
    // (rota /uploads/treinamentos/<arquivo>, com suporte a Range/seek).
} catch (e) {
    console.error('[ROUTES] ⚠️ treinamentos-conteudo não carregou:', e.message);
}
// =================================================================


// =================================================================
// API ROUTES  MODULAR ARCHITECTURE
// All 665+ API routes extracted to separate modules in routes/
// See routes/index.js for the route orchestrator
// =================================================================
const registerAllRoutes = require('./routes/index');
registerAllRoutes(app, {
    pool,
    jwt,
    JWT_SECRET,
    authenticateToken,
    authenticatePage,
    authorizeArea,
    authorizeAdmin,
    authorizeAction,
    authorizeAdminOrComercial,
    authorizeACL,
    writeAuditLog,
    sendEmail,
    enviarEmail,
    cacheMiddleware,
    CACHE_CONFIG,
    // AUDIT-FIX SEC-001: Pass checkOwnership for IDOR protection on data endpoints
    checkOwnership: authCentral.checkOwnership,
    // AUDIT-FIX PERM-004: Write-guard blocks consultoria/restricted roles from mutations
    writeGuard: authCentral.writeGuard,
    VENDAS_DB_CONFIG: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'aluforce',
        password: process.env.DB_PASSWORD || '',
        database: process.env.VENDAS_DB_NAME || 'aluforce_vendas',
        waitForConnections: true,
        connectionLimit: 10,
        charset: 'utf8mb4',
        timezone: '-03:00'
    }
});
console.log('[SERVER]  All modular routes registered');

// =================================================================
// AUDIT LOG API — Extracted to routes/audit-api.js
// =================================================================
const auditApiRouter = require('./routes/audit-api')({ authenticateToken, authorizeAdmin, pool, writeAuditLog });
app.use('/api/audit-log', auditApiRouter);
console.log('✅ Audit API carregada (modular)');

// =================================================================
// HEALTH & STATUS — Extracted to routes/health-api.js
// =================================================================
const healthRouter = require('./routes/health-api')({
    authenticateToken,
    authorizeAdmin,
    pool,
    getDbAvailable: () => DB_AVAILABLE,
    getAllBreakerStates
});
app.use(healthRouter);
console.log('✅ Health/Status endpoints carregados (modular)');

// ─── FOLHA DE PAGAMENTO MANUAL (RH) ───────────────────────────────

// GET /api/rh/folha-manual/competencia - Buscar folhas por mês/ano
app.get('/api/rh/folha-manual/competencia', authenticateToken, authorizeArea('rh'), asyncHandler(async (req, res) => {
    const mes = parseInt(req.query.mes);
    const ano = parseInt(req.query.ano);
    if (!mes || !ano) return res.status(400).json({ error: 'mes e ano são obrigatórios' });
    try {
        const [folhas] = await pool.query(
            'SELECT * FROM rh_folha_manual WHERE mes = ? AND ano = ? ORDER BY FIELD(tipo, "SALARIO", "ADIANTAMENTO")',
            [mes, ano]
        );
        for (const f of folhas) {
            const [itens] = await pool.query('SELECT * FROM rh_folha_manual_itens WHERE folha_id = ? ORDER BY empresa, colaborador_nome', [f.id]);
            f.itens = itens;
        }
        res.json(folhas);
    } catch (error) {
        logger.error('Erro ao buscar folha manual:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
}));

// GET /api/rh/folha-manual/listar - Listar todas as folhas manuais
app.get('/api/rh/folha-manual/listar', authenticateToken, authorizeArea('rh'), asyncHandler(async (req, res) => {
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
}));

// POST /api/rh/folha-manual/salvar - Criar ou atualizar folha com todos os itens
app.post('/api/rh/folha-manual/salvar', authenticateToken, authorizeAdmin, asyncHandler(async (req, res) => {
    const mes = parseInt(req.body.mes);
    const ano = parseInt(req.body.ano);
    const tipo = req.body.tipo;
    const itens = req.body.itens;
    if (!mes || !ano || !tipo) return res.status(400).json({ error: 'mes, ano e tipo são obrigatórios' });
    if (!Array.isArray(itens)) return res.status(400).json({ error: 'itens deve ser um array' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [existing] = await conn.query(
            'SELECT id, status FROM rh_folha_manual WHERE mes = ? AND ano = ? AND tipo = ?',
            [mes, ano, tipo]
        );
        let folhaId;
        if (existing.length > 0) {
            if (existing[0].status === 'fechada') {
                await conn.rollback();
                return res.status(400).json({ error: 'Folha já fechada. Não é possível editar.' });
            }
            folhaId = existing[0].id;
            await conn.query('DELETE FROM rh_folha_manual_itens WHERE folha_id = ?', [folhaId]);
        } else {
            const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
            const titulo = tipo === 'SALARIO'
                ? `${MESES[mes]} - SALÁRIO, POR FORA E HORA EXTRAS`
                : `${MESES[mes]} - ADIANTAMENTO`;
            const [result] = await conn.query(
                'INSERT INTO rh_folha_manual (mes, ano, tipo, titulo, criado_por) VALUES (?, ?, ?, ?, ?)',
                [mes, ano, tipo, titulo, req.user.nome || req.user.email]
            );
            folhaId = result.insertId;
        }

        let totalGeralCentavos = 0;
        for (const item of itens) {
            if (!item.colaborador_nome || !item.colaborador_nome.trim()) continue;
            const vb = parseFloat(item.valor_base) || 0;
            const spf = parseFloat(item.salario_por_fora) || 0;
            const h50 = parseFloat(item.he_50) || 0;
            const h100 = parseFloat(item.he_100) || 0;
            const desc = parseFloat(item.desconto_emprestimo) || 0;
            // Aritmética em centavos inteiros para evitar erro de ponto flutuante
            const totalItemCentavos = Math.round(vb * 100) + Math.round(spf * 100) + Math.round(h50 * 100) + Math.round(h100 * 100) - Math.round(desc * 100);
            const totalItem = totalItemCentavos / 100;
            totalGeralCentavos += totalItemCentavos;
            await conn.query(
                `INSERT INTO rh_folha_manual_itens (folha_id, empresa, colaborador_nome, funcionario_id, valor_base, salario_por_fora, he_50, he_100, desconto_emprestimo, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [folhaId, item.empresa || '', item.colaborador_nome.trim(), item.funcionario_id || null, vb, spf, h50, h100, desc, totalItem]
            );
        }
        const totalGeral = totalGeralCentavos / 100;
        await conn.query('UPDATE rh_folha_manual SET total_geral = ? WHERE id = ?', [totalGeral, folhaId]);
        await conn.commit();
        res.json({ success: true, folha_id: folhaId, total_geral: totalGeral });
    } catch (error) {
        await conn.rollback();
        logger.error('Erro ao salvar folha manual:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    } finally {
        conn.release();
    }
}));

// PUT /api/rh/folha-manual/:id/fechar - Fechar folha manual e enviar ao Contas a Pagar
app.put('/api/rh/folha-manual/:id/fechar', authenticateToken, authorizeAdmin, asyncHandler(async (req, res) => {
    const folhaId = parseInt(req.params.id);
    try {
        const [folhaRows] = await pool.query('SELECT * FROM rh_folha_manual WHERE id = ?', [folhaId]);
        if (folhaRows.length === 0) return res.status(404).json({ error: 'Folha não encontrada' });
        const folha = folhaRows[0];
        if (folha.status === 'fechada') return res.status(400).json({ error: 'Folha já está fechada' });

        const [itens] = await pool.query('SELECT total FROM rh_folha_manual_itens WHERE folha_id = ?', [folhaId]);
        const valorTotalCentavos = itens.reduce((acc, i) => acc + Math.round((parseFloat(i.total || 0)) * 100), 0);
        const valorTotal = valorTotalCentavos / 100;
        if (valorTotal <= 0) return res.status(400).json({ error: 'Folha sem itens ou valor total zero' });

        await pool.query("UPDATE rh_folha_manual SET status = 'fechada', fechado_em = NOW(), total_geral = ? WHERE id = ?", [valorTotal, folhaId]);

        const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        const tipoLabel = folha.tipo === 'SALARIO' ? 'Salário' : 'Adiantamento';
        const descricao = `Folha ${tipoLabel} - ${MESES[folha.mes]} ${folha.ano}`;
        const data_emissao = new Date().toISOString().slice(0, 10);
        const vencimentoDate = new Date(folha.ano, folha.mes, 5);
        const data_vencimento = vencimentoDate.toISOString().slice(0, 10);

        const token = req.cookies?.authToken || req.cookies?.token || (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);
        if (!token) return res.status(401).json({ error: 'Token de autenticação não encontrado.' });

        const financeiroUrl = process.env.FINANCEIRO_URL || 'http://localhost:3006/api/financeiro/contas-pagar';
        const payload = { descricao, valor_total: valorTotal, data_emissao, data_vencimento, observacoes: `Folha manual ${tipoLabel} integrada. ID: ${folhaId}` };
        try {
            const financeiroResp = await axios.post(financeiroUrl, payload, { headers: { Authorization: `Bearer ${token}` } });
            res.json({ success: true, folha_id: folhaId, valor_total: valorTotal, financeiro: financeiroResp.data });
        } catch (err) {
            logger.error('Erro ao integrar folha com Financeiro:', err?.response?.data || err.message);
            res.status(500).json({ error: 'Erro ao criar conta a pagar no Financeiro' });
        }
    } catch (error) {
        logger.error('Erro ao fechar folha manual:', error);
        res.status(500).json({ error: 'Erro ao fechar folha manual' });
    }
}));

// PUT /api/rh/folha-manual/:id/reabrir - Reabrir folha fechada
app.put('/api/rh/folha-manual/:id/reabrir', authenticateToken, authorizeAdmin, asyncHandler(async (req, res) => {
    try {
        const [result] = await pool.query("UPDATE rh_folha_manual SET status = 'rascunho', fechado_em = NULL WHERE id = ? AND status = 'fechada'", [parseInt(req.params.id)]);
        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'Folha não encontrada ou não está fechada' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('Erro ao reabrir folha:', error);
        res.status(500).json({ error: 'Erro ao reabrir folha' });
    }
}));

// GET /api/rh/funcionarios-empresas - Listar funcionários agrupados por empresa
app.get('/api/rh/funcionarios-empresas', authenticateToken, authorizeArea('rh'), asyncHandler(async (req, res) => {
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
}));

// =====================================================
// HOLERITES (COLABORADOR) - CONSENTIMENTO E VISUALIZAÇÃO
// =====================================================

const isAdminRHUser = (user) => {
    return user?.role === 'admin' || user?.is_admin === true || user?.rh_admin === true;
};

const getUserFuncionarioId = (user) => {
    const id = Number(user?.funcionario_id);
    return Number.isFinite(id) && id > 0 ? id : null;
};

const resolveUserFuncionarioId = async (user) => {
    const explicitId = getUserFuncionarioId(user);
    if (explicitId) return explicitId;

    const userId = Number(user?.id);
    const userEmail = String(user?.email || '').trim();

    try {
        if (Number.isFinite(userId) && userId > 0) {
            const [rows] = await pool.query(`
                SELECT f.id
                FROM usuarios u
                INNER JOIN funcionarios f
                    ON LOWER(f.email) = LOWER(u.email)
                    OR LOWER(f.email) = LOWER(u.login)
                WHERE u.id = ?
                LIMIT 1
            `, [userId]);
            if (rows.length > 0) return Number(rows[0].id);
        }

        if (userEmail) {
            const [rows] = await pool.query(
                'SELECT id FROM funcionarios WHERE LOWER(email) = LOWER(?) LIMIT 1',
                [userEmail]
            );
            if (rows.length > 0) return Number(rows[0].id);
        }
    } catch (error) {
        logger.warn('Aviso ao resolver funcionario do usuario logado:', error.message);
    }

    return Number.isFinite(userId) && userId > 0 ? userId : null;
};

// ─── PENSÃO ALIMENTÍCIA (RH) ───────────────────────────────────────────

// Ensure table exists
pool.query(`CREATE TABLE IF NOT EXISTS rh_pensao_alimenticia (
  id INT AUTO_INCREMENT PRIMARY KEY,
  funcionario_id INT NOT NULL,
  valor DECIMAL(10,2) DEFAULT 0,
  nome_recebedor VARCHAR(255),
  cpf_recebedor VARCHAR(14),
  banco_recebedor VARCHAR(100),
  agencia_recebedor VARCHAR(20),
  conta_recebedor VARCHAR(30),
  observacoes TEXT,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_func_pensao (funcionario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(e => {
    if (e && !String(e.message || '').includes('already exists')) logger.warn('rh_pensao_alimenticia:', e.message);
});

[
    "ALTER TABLE rh_pensao_alimenticia ADD COLUMN valor DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE rh_pensao_alimenticia ADD COLUMN nome_recebedor VARCHAR(255)",
    "ALTER TABLE rh_pensao_alimenticia ADD COLUMN cpf_recebedor VARCHAR(14)",
    "ALTER TABLE rh_pensao_alimenticia ADD COLUMN banco_recebedor VARCHAR(100)",
    "ALTER TABLE rh_pensao_alimenticia ADD COLUMN agencia_recebedor VARCHAR(20)",
    "ALTER TABLE rh_pensao_alimenticia ADD COLUMN conta_recebedor VARCHAR(30)",
    "ALTER TABLE rh_pensao_alimenticia ADD COLUMN observacoes TEXT",
    "ALTER TABLE rh_pensao_alimenticia ADD COLUMN criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE rh_pensao_alimenticia ADD COLUMN atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
].forEach((sql) => pool.query(sql).catch(e => {
    if (e.code !== 'ER_DUP_FIELDNAME' && !String(e.message || '').includes('Duplicate column')) {
        logger.warn('rh_pensao_alimenticia alter:', e.message);
    }
}));

const normalizePensaoRows = (rows) => (rows || []).map((row) => ({
    ...row,
    observacoes: row.observacoes || row['observações'] || '',
    ativo: row.ativo === undefined ? 1 : row.ativo
}));

app.get('/api/rh/funcionarios/:id/pensao', authenticateToken, authorizeArea('rh'), asyncHandler(async (req, res) => {
    try {
        let rows;
        try {
            [rows] = await pool.query('SELECT * FROM rh_pensao_alimenticia WHERE funcionario_id = ? ORDER BY criado_em DESC', [req.params.id]);
        } catch (error) {
            if (error.code !== 'ER_BAD_FIELD_ERROR') throw error;
            [rows] = await pool.query('SELECT * FROM rh_pensao_alimenticia WHERE funcionario_id = ? ORDER BY id DESC', [req.params.id]);
        }
        res.json(normalizePensaoRows(rows));
    } catch (error) {
        logger.error('Erro ao listar pensões:', error);
        res.status(500).json({ error: 'Erro ao listar pensões' });
    }
}));

app.post('/api/rh/funcionarios/:id/pensao', authenticateToken, authorizeArea('rh'), asyncHandler(async (req, res) => {
    const { valor, nome_recebedor, cpf_recebedor, banco_recebedor, agencia_recebedor, conta_recebedor } = req.body;
    const observacoes = req.body.observacoes || req.body['observa\u00e7\u00f5es'] || null;
    try {
        const [result] = await pool.query(
            `INSERT INTO rh_pensao_alimenticia (funcionario_id, valor, nome_recebedor, cpf_recebedor, banco_recebedor, agencia_recebedor, conta_recebedor, observacoes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.params.id, valor || 0, nome_recebedor || null, cpf_recebedor || null, banco_recebedor || null, agencia_recebedor || null, conta_recebedor || null, observacoes || null]
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        logger.error('Erro ao criar pensão:', error);
        res.status(500).json({ error: 'Erro ao criar pensão' });
    }
}));

app.put('/api/rh/funcionarios/:id/pensao/:pensaoId', authenticateToken, authorizeArea('rh'), asyncHandler(async (req, res) => {
    const { valor, nome_recebedor, cpf_recebedor, banco_recebedor, agencia_recebedor, conta_recebedor } = req.body;
    const observacoes = req.body.observacoes || req.body['observa\u00e7\u00f5es'] || null;
    try {
        const [result] = await pool.query(
            `UPDATE rh_pensao_alimenticia
             SET valor = ?, nome_recebedor = ?, cpf_recebedor = ?, banco_recebedor = ?,
                 agencia_recebedor = ?, conta_recebedor = ?, observacoes = ?
             WHERE id = ? AND funcionario_id = ?`,
            [
                valor || 0,
                nome_recebedor || null,
                cpf_recebedor || null,
                banco_recebedor || null,
                agencia_recebedor || null,
                conta_recebedor || null,
                observacoes || null,
                req.params.pensaoId,
                req.params.id
            ]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Pensao nao encontrada' });
        res.json({ success: true });
    } catch (error) {
        logger.error('Erro ao atualizar pensÃ£o:', error);
        res.status(500).json({ error: 'Erro ao atualizar pensÃ£o' });
    }
}));

app.delete('/api/rh/funcionarios/:id/pensao/:pensaoId', authenticateToken, authorizeArea('rh'), asyncHandler(async (req, res) => {
    try {
        await pool.query('DELETE FROM rh_pensao_alimenticia WHERE id=? AND funcionario_id=?', [req.params.pensaoId, req.params.id]);
        res.json({ success: true });
    } catch (error) {
        logger.error('Erro ao remover pensão:', error);
        res.status(500).json({ error: 'Erro ao remover pensão' });
    }
}));

// ─── SALÁRIO FAMÍLIA (RH) ──────────────────────────────────────────────

pool.query(`CREATE TABLE IF NOT EXISTS rh_salario_familia (
  id INT AUTO_INCREMENT PRIMARY KEY,
  funcionario_id INT NOT NULL UNIQUE,
  recebe TINYINT(1) DEFAULT 0,
  quantidade_dependentes INT DEFAULT 0,
  observacoes TEXT,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_func_sf (funcionario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(e => {
    if (e && !String(e.message || '').includes('already exists')) logger.warn('rh_salario_familia:', e.message);
});

pool.query(`CREATE TABLE IF NOT EXISTS rh_sf_dependentes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  funcionario_id INT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  parentesco VARCHAR(50),
  data_nascimento DATE,
  cpf VARCHAR(14),
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_func_sf_dep (funcionario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(e => {
    if (e && !String(e.message || '').includes('already exists')) logger.warn('rh_sf_dependentes:', e.message);
});

app.get('/api/rh/funcionarios/:id/salario-familia', authenticateToken, authorizeArea('rh'), asyncHandler(async (req, res) => {
    try {
        const [sfRows] = await pool.query('SELECT * FROM rh_salario_familia WHERE funcionario_id = ?', [req.params.id]);
        let depRows;
        try {
            [depRows] = await pool.query('SELECT * FROM rh_sf_dependentes WHERE funcionario_id = ? ORDER BY criado_em DESC', [req.params.id]);
        } catch (error) {
            if (error.code !== 'ER_BAD_FIELD_ERROR') throw error;
            [depRows] = await pool.query('SELECT * FROM rh_sf_dependentes WHERE funcionario_id = ? ORDER BY id DESC', [req.params.id]);
        }
        const sf = sfRows[0] || { recebe: 0, observacoes: '' };
        res.json({ recebe: sf.recebe, observacoes: sf.observacoes || '', dependentes: depRows });
    } catch (error) {
        logger.error('Erro ao carregar salário família:', error);
        res.status(500).json({ error: 'Erro ao carregar salário família' });
    }
}));

const salvarSalarioFamiliaRh = async (req, res) => {
    const { recebe, dependentes } = req.body;
    const observacoes = req.body.observacoes || req.body['observa\u00e7\u00f5es'] || null;
    try {
        await pool.query(
            `INSERT INTO rh_salario_familia (funcionario_id, recebe, observacoes) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE recebe=VALUES(recebe), observacoes=VALUES(observacoes)`,
            [req.params.id, recebe ? 1 : 0, observacoes || null]
        );
        if (Array.isArray(dependentes)) {
            await pool.query('DELETE FROM rh_sf_dependentes WHERE funcionario_id = ?', [req.params.id]);
            for (const dep of dependentes) {
                await pool.query(
                    'INSERT INTO rh_sf_dependentes (funcionario_id, nome, parentesco, data_nascimento, cpf) VALUES (?, ?, ?, ?, ?)',
                    [req.params.id, dep.nome, dep.parentesco || null, dep.data_nascimento || null, dep.cpf || null]
                );
            }
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('Erro ao salvar salário família:', error);
        res.status(500).json({ error: 'Erro ao salvar salário família' });
    }
};

app.post('/api/rh/funcionarios/:id/salario-familia', authenticateToken, authorizeArea('rh'), asyncHandler(salvarSalarioFamiliaRh));
app.put('/api/rh/funcionarios/:id/salario-familia', authenticateToken, authorizeArea('rh'), asyncHandler(salvarSalarioFamiliaRh));

app.post('/api/rh/funcionarios/:id/salario-familia/dependente', authenticateToken, authorizeArea('rh'), asyncHandler(async (req, res) => {
    const { nome, parentesco, data_nascimento, cpf } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome do dependente e obrigatorio' });

    try {
        const [result] = await pool.query(
            'INSERT INTO rh_sf_dependentes (funcionario_id, nome, parentesco, data_nascimento, cpf) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, nome, parentesco || null, data_nascimento || null, cpf || null]
        );
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        logger.error('Erro ao salvar dependente salÃ¡rio famÃ­lia:', error);
        res.status(500).json({ error: 'Erro ao salvar dependente' });
    }
}));

app.delete('/api/rh/funcionarios/:id/salario-familia/dependente/:depId', authenticateToken, authorizeArea('rh'), asyncHandler(async (req, res) => {
    try {
        await pool.query('DELETE FROM rh_sf_dependentes WHERE id = ? AND funcionario_id = ?', [req.params.depId, req.params.id]);
        res.json({ success: true });
    } catch (error) {
        logger.error('Erro ao remover dependente salÃ¡rio famÃ­lia:', error);
        res.status(500).json({ error: 'Erro ao remover dependente' });
    }
}));

[
    "ALTER TABLE rh_holerites ADD COLUMN visualizado TINYINT(1) DEFAULT 0",
    "ALTER TABLE rh_holerites ADD COLUMN total_visualizacoes INT DEFAULT 0",
    "ALTER TABLE rh_holerites ADD COLUMN confirmado_recebimento TINYINT(1) DEFAULT 0",
    "ALTER TABLE rh_holerites ADD COLUMN data_confirmacao DATETIME NULL",
    "ALTER TABLE rh_holerites ADD COLUMN arquivo_pdf VARCHAR(255)",
    "ALTER TABLE rh_holerites ADD COLUMN status VARCHAR(20) DEFAULT 'rascunho'",
    "ALTER TABLE rh_holerites ADD COLUMN tipo VARCHAR(30) DEFAULT 'salario'"
].forEach((sql) => pool.query(sql).catch((e) => {
    if (e.code !== 'ER_DUP_FIELDNAME' && !String(e.message || '').includes('Duplicate')) {
        logger.warn('Aviso ao ajustar colunas rh_holerites:', e.message);
    }
}));

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
pool.query(ensureHoleritesConsentTable).catch((e) => {
    logger.warn('Aviso ao criar tabela rh_holerites_consentimentos:', e.message);
});

// GET /api/rh/holerites/consentimento - Verificar consentimento digital do usuário logado
app.get('/api/rh/holerites/consentimento', authenticateToken, asyncHandler(async (req, res) => {
    try {
        if (isAdminRHUser(req.user)) {
            return res.json({ consentimento: true, admin: true });
        }

        const funcionarioId = await resolveUserFuncionarioId(req.user);
        if (!funcionarioId) {
            return res.status(400).json({ message: 'Funcionário não identificado para o usuário logado.' });
        }

        const [rows] = await pool.query(
            'SELECT id, assinatura_digital, created_at, updated_at FROM rh_holerites_consentimentos WHERE funcionario_id = ? AND aceito = 1 LIMIT 1',
            [funcionarioId]
        );

        const consent = rows.length > 0;
        res.json({
            consentimento: consent,
            admin: false,
            registro: consent ? rows[0] : null
        });
    } catch (error) {
        logger.error('Erro ao verificar consentimento digital de holerites:', error);
        res.status(500).json({ error: 'Erro ao verificar consentimento digital' });
    }
}));

// POST /api/rh/holerites/consentimento - Registrar/atualizar consentimento digital
app.post('/api/rh/holerites/consentimento', authenticateToken, asyncHandler(async (req, res) => {
    try {
        if (isAdminRHUser(req.user)) {
            return res.json({ success: true, admin: true, message: 'Usuário admin não precisa de consentimento.' });
        }

        const assinatura = String(req.body?.assinatura_digital || '').trim();
        if (assinatura.length < 3) {
            return res.status(400).json({ message: 'assinatura_digital é obrigatória e deve ter ao menos 3 caracteres.' });
        }

        const funcionarioId = await resolveUserFuncionarioId(req.user);
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
}));

// GET /api/rh/holerites/meus - Listar holerites publicados do funcionário logado
app.get('/api/rh/holerites/meus', authenticateToken, asyncHandler(async (req, res) => {
    try {
        const funcionarioId = await resolveUserFuncionarioId(req.user);
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
}));

// GET /api/rh/holerites/:id - Buscar holerite por id (restrito ao dono/admin)
app.get('/api/rh/holerites/:id', authenticateToken, asyncHandler(async (req, res, next) => {
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

        const userFuncId = await resolveUserFuncionarioId(req.user);
        if (userFuncId && Number(holerite[0].funcionario_id) !== userFuncId && !isAdminRHUser(req.user)) {
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
}));

// POST /api/rh/holerites/:id/visualizar - Registrar visualização
app.post('/api/rh/holerites/:id/visualizar', authenticateToken, asyncHandler(async (req, res) => {
    try {
        const holeriteId = req.params.id;
        const userFuncId = await resolveUserFuncionarioId(req.user);

        if (userFuncId && !isAdminRHUser(req.user)) {
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
}));

// POST /api/rh/holerites/:id/confirmar - Confirmar recebimento
app.post('/api/rh/holerites/:id/confirmar', authenticateToken, asyncHandler(async (req, res) => {
    try {
        const holeriteId = req.params.id;
        const userFuncId = await resolveUserFuncionarioId(req.user);

        if (userFuncId && !isAdminRHUser(req.user)) {
            const [rows] = await pool.query('SELECT funcionario_id FROM rh_holerites WHERE id = ? LIMIT 1', [holeriteId]);
            if (rows.length > 0 && Number(rows[0].funcionario_id) !== userFuncId) {
                return res.status(403).json({ message: 'Acesso negado.' });
            }
        }

        await pool.query(
            'UPDATE rh_holerites SET confirmado_recebimento = 1, data_confirmacao = NOW() WHERE id = ?',
            [holeriteId]
        );
        res.json({ success: true, message: 'Recebimento confirmado com sucesso!' });
    } catch (error) {
        logger.error('Erro ao confirmar recebimento:', error);
        res.status(500).json({ error: 'Erro ao confirmar recebimento' });
    }
}));

console.log('✅ Rotas Folha de Pagamento Manual (RH) carregadas');

// 7. TRATAMENTO DE ERROS E INICIALIZAÇÃO DO SERVIDOR
// =================================================================

// 404 handler — rota não encontrada (deve vir antes do error handler)
app.use((req, res, next) => {
    // API routes return JSON
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Rota não encontrada' }); // AUDIT-FIX: removido path leak
    }
    // All others: serve branded 404 page
    const page404 = path.join(__dirname, 'public', '404.html');
    res.status(404).sendFile(page404, (err) => {
        if (err) {
            res.status(404).send('<h1>404 — Página não encontrada</h1><p><a href="/dashboard">Voltar ao Dashboard</a></p>');
        }
    });
});

// AUDIT-FIX ARCH-003: Centralized error handler with structured logging
app.use((err, req, res, next) => {
    // Determine error type and severity
    const statusCode = err.statusCode || err.status || 500;
    const isServerError = statusCode >= 500;

    // Structured error logging via logger
    const errorContext = {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userId: req.user?.id || 'anonymous',
        statusCode,
        message: err.message
    };

    if (isServerError) {
        logger.error(`[ERROR-HANDLER] ${req.method} ${req.path}:`, err.message);
        if (err.stack) logger.error('[ERROR-HANDLER] Stack:', err.stack);
    } else {
        logger.warn(`[ERROR-HANDLER] ${req.method} ${req.path}: ${err.message}`);
    }

    if (!res.headersSent) {
        // CORS errors
        if (err.message && err.message.includes('CORS')) {
            return res.status(403).json({
                message: 'Origem não autorizada (CORS).',
                code: 'CORS_ERROR'
            });
        }

        // Validation errors (express-validator)
        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({
                message: 'JSON malformado no corpo da requisição.',
                code: 'INVALID_JSON'
            });
        }

        // Multer file size errors
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                message: 'Arquivo muito grande.',
                code: 'FILE_TOO_LARGE'
            });
        }

        res.status(statusCode).json({
            message: isServerError ? 'Ocorreu um erro inesperado no servidor.' : err.message,
            code: err.code || 'INTERNAL_ERROR',
            // Only expose details in development
            ...(process.env.NODE_ENV === 'development' ? { error: err.message, stack: err.stack } : {})
        });
    }
});

// Global flag indicando disponibilidade do banco (declarado acima, antes das rotas)

// ⚡ Flag para pular migrações (SKIP_MIGRATIONS=1)
const SKIP_MIGRATIONS = process.env.SKIP_MIGRATIONS === '1' || process.env.SKIP_MIGRATIONS === 'true';

// Função para iniciar o servidor
const startServer = async () => {
    const startupTime = Date.now();
    console.log('🚀 Starting ALUFORCE Dashboard Server...');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

    try {
        // Testa a conexão com o banco de dados antes de iniciar o servidor
        if (process.env.DEV_MOCK === '1' || process.env.DEV_MOCK === 'true') {
            DB_AVAILABLE = false;
            console.log('⚠️  Iniciando em modo DEV_MOCK — pulando checagem/criação de tabelas no MySQL.');
        } else {
            try {
                // Retry DB connection up to 5x (30s total) to survive slow MySQL startup
                let dbReady = false;
                for (let attempt = 1; attempt <= 5 && !dbReady; attempt++) {
                    try {
                        await pool.query('SELECT 1');
                        dbReady = true;
                    } catch (e) {
                        if (attempt < 5) {
                            console.warn(`⏳ DB not ready (attempt ${attempt}/5): ${e.message} — retrying in 6s...`);
                            await new Promise(r => setTimeout(r, 6000));
                        }
                    }
                }
                if (!dbReady) throw new Error('MySQL não respondeu após 5 tentativas');
                console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
                console.log(`⚡ Conexão DB em ${Date.now() - startupTime}ms`);

                // ⚡ OTIMIZAÇÃO: Pular migrações se SKIP_MIGRATIONS=1
                if (SKIP_MIGRATIONS) {
                    console.log('⚡ SKIP_MIGRATIONS ativo - pulando verificações de schema');
                    console.log('💡 Use "npm run db:migrate" para executar migrações quando necessário\n');
                } else {
                    console.log('🔄 Executando verificações de schema...');
                    console.log('💡 Defina SKIP_MIGRATIONS=1 no .env para inicialização mais rápida\n');

                    // Inline migrations extracted to database/migrations/startup-inline-migrations.js
                    const { runInlineMigrations } = require('./database/migrations/startup-inline-migrations');
                    await runInlineMigrations(pool);

                } // ⚡ Fim do bloco SKIP_MIGRATIONS

            } catch (err) {
                DB_AVAILABLE = false;
                console.error('❌ Não foi possível conectar ao banco de dados MySQL:', err && err.message ? err.message : err);
                console.log('Continuando a inicialização do servidor em modo degradado (DB indisponível).');
            }
        }

        // Função para tentar iniciar o servidor com HOST e PORT
        const tryPort = async (portToTry) => {
            return new Promise((resolve, reject) => {
                // Criar servidor HTTP/HTTPS baseado no .env
                let httpServer;
                const ENABLE_HTTPS = process.env.ENABLE_HTTPS === 'true';

                if (ENABLE_HTTPS) {
                    const fs = require('fs');
                    const https = require('https');
                    const path = require('path');

                    let credentials = null;
                    const SSL_PFX_PATH = process.env.SSL_PFX_PATH;
                    const SSL_PFX_PASSWORD = process.env.SSL_PFX_PASSWORD;
                    const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
                    const SSL_KEY_PATH = process.env.SSL_KEY_PATH;

                    if (SSL_PFX_PATH && fs.existsSync(SSL_PFX_PATH)) {
                        credentials = {
                            pfx: fs.readFileSync(SSL_PFX_PATH),
                            passphrase: SSL_PFX_PASSWORD || ''
                        };
                        console.log('🔒 HTTPS habilitado (PFX):', SSL_PFX_PATH);
                    } else if (SSL_CERT_PATH && SSL_KEY_PATH && fs.existsSync(SSL_CERT_PATH) && fs.existsSync(SSL_KEY_PATH)) {
                        credentials = {
                            key: fs.readFileSync(SSL_KEY_PATH, 'utf8'),
                            cert: fs.readFileSync(SSL_CERT_PATH, 'utf8')
                        };
                        console.log('🔒 HTTPS habilitado (PEM)');
                    } else {
                        console.warn('⚠️  ENABLE_HTTPS=true mas certificados não encontrados. Usando HTTP.');
                    }

                    if (credentials) {
                        httpServer = https.createServer(credentials, app);
                    } else {
                        httpServer = http.createServer(app);
                    }
                } else {
                    httpServer = http.createServer(app);
                }

                // Socket.IO setup extracted to config/socket-setup.js
                const { setupSocketIO } = require('./config/socket-setup');
                const io = setupSocketIO(httpServer, { Server, allowedOrigins, JWT_SECRET, pool });
                app.set('io', io);

                // Chat Teams — REST routes já registradas via routes/index.js (evitar duplicação)
                // Socket.IO handlers são configurados em config/socket-setup.js

                httpServer.listen(portToTry, HOST)
                    .on('listening', () => {
                        resolve({ server: httpServer, port: portToTry });
                    })
                    .on('error', (err) => {
                        if (err.code === 'EADDRINUSE') {
                            reject({ code: 'EADDRINUSE', port: portToTry });
                        } else {
                            reject(err);
                        }
                    });
            });
        };

        // Tenta iniciar o servidor em portas alternativas se necessário
        const maxPortAttempts = 10;
        let currentPort = PORT;
        let serverStarted = false;

        for (let attempt = 0; attempt < maxPortAttempts && !serverStarted; attempt++) {
            try {
                const result = await tryPort(currentPort);
                serverInstance = result.server;
                const actualPort = result.port;

                console.log('\n' + '='.repeat(60));
                console.log(`🚀 Servidor ALUFORCE v2.0 iniciado com sucesso!`);
                console.log('='.repeat(60));
                console.log(`📍 URL: http://${HOST}:${actualPort}`);
                console.log(`🔌 Banco de Dados: ${DB_AVAILABLE ? '✅ Conectado' : '❌ Modo Degradado (sem DB)'}`);
                console.log(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);

                if (actualPort !== PORT) {
                    console.log(`⚠️  AVISO: Porta ${PORT} estava ocupada`);
                    console.log(`✅ Servidor iniciado na porta alternativa ${actualPort}`);
                }

                console.log('='.repeat(60));
                console.log('\n💡 Dica: Pressione Ctrl+C para encerrar o servidor\n');

                // Notificar PM2 que o app está pronto (para wait_ready: true)
                if (typeof process.send === 'function') {
                    process.send('ready');
                }

                // Inicializar cron jobs após servidor estar online
                if (DB_AVAILABLE) {
                    setImmediate(() => {
                        initCronJobs();
                        // Auto-importação de ponto (Control iD / RHiD)
                        try {
                            const { initAutoImportPonto } = require('./services/auto-import-ponto');
                            initAutoImportPonto({ pool }, 30 * 60 * 1000); // A cada 30 minutos
                        } catch (e) {
                            console.warn('[AUTO-PONTO] ⚠️ Não foi possível inicializar:', e.message);
                        }
                    });
                }

                // 🤖 Inicializar Discord Notifier + Publicar startup
                if (discordBot) {
                    setImmediate(async () => {
                        try {
                            const started = await discordBot.init();
                            if (started) {
                                console.log('🤖 [Discord] Notifier ativo (Webhook)');
                                // Notificar que o servidor iniciou
                                await discordBot.publicarStartup();
                            }
                        } catch (err) {
                            console.warn('⚠️  [Discord] Falha ao inicializar:', err.message);
                        }
                    });
                }

                // 🤖 Notificar n8n que o servidor iniciou
                if (n8nIntegration) {
                    setImmediate(async () => {
                        try {
                            await n8nIntegration.onServerStart({ versao: '2.1.7' });
                            console.log('🤖 [n8n] Evento de startup enviado');
                        } catch (err) {
                            console.warn('⚠️  [n8n] Falha ao notificar startup:', err.message);
                        }
                    });
                }

                // 🔐 Auto-carregar certificado digital NFe (se configurado)
                setImmediate(async () => {
                    const certPath = process.env.NFE_CERT_PATH;
                    const certSenha = process.env.NFE_CERT_SENHA;
                    if (!certPath || !certSenha) {
                        console.log('⚠️  NFe: Certificado não configurado (NFE_CERT_PATH / NFE_CERT_SENHA)');
                        return;
                    }
                    try {
                        const certificadoService = require('./modules/Faturamento/services/certificado.service');
                        const fullPath = require('path').resolve(certPath);
                        await certificadoService.carregarCertificadoA1(fullPath, certSenha);
                        const validade = certificadoService.verificarValidade();
                        console.log('🔐 Certificado digital carregado com sucesso!');
                        console.log(`   ✅ ${validade.diasRestantes} dia(s) restantes`);
                        if (validade.diasRestantes <= 30) {
                            console.log(`   ⚠️  ATENÇÃO: Certificado expira em ${validade.diasRestantes} dia(s)!`);
                        }
                    } catch (err) {
                        console.error(`❌ Erro ao carregar certificado digital: ${err.message}`);
                    }
                });

                serverStarted = true;
                return serverInstance;
            } catch (error) {
                if (error.code === 'EADDRINUSE') {
                    console.log(`⚠️  Porta ${currentPort} em uso, tentando ${currentPort + 1}...`);
                    currentPort++;
                } else {
                    throw error;
                }
            }
        }

        if (!serverStarted) {
            throw new Error(`❌ Não foi possível iniciar o servidor. Todas as portas de ${PORT} a ${currentPort - 1} estão em uso.`);
        }
    } catch (error) {
        // Erros inesperados aqui não devem impedir o servidor de iniciar — tentamos seguir em modo degradado
        console.error('❌ ERRO INESPERADO AO INICIAR:', error && error.stack ? error.stack : error);
        process.exit(1);
    }
};

// Função para parar o servidor (útil para testes in-process e graceful shutdown)
// AUDIT-FIX: Added force-kill timeout to prevent zombie processes
async function stopServer() {
    console.log('🔄 Encerrando servidor...');

    // Set a hard timeout to force-kill if graceful shutdown hangs
    const forceKillTimer = setTimeout(() => {
        console.error('⛔ Graceful shutdown excedeu timeout (15s) — forçando encerramento');
        process.exit(1);
    }, 15000);
    forceKillTimer.unref(); // Don't keep process alive just for this timer

    // Fechar servidor HTTP (stop accepting new connections)
    if (serverInstance) {
        await new Promise((resolve, reject) => {
            try {
                serverInstance.close((err) => {
                    if (err) {
                        console.error('❌ Erro ao fechar servidor:', err);
                        reject(err);
                    } else {
                        console.log('✅ Servidor HTTP encerrado');
                        serverInstance = null;
                        resolve();
                    }
                });
            } catch (e) {
                console.error('❌ Erro ao fechar servidor:', e);
                reject(e);
            }
        });
    }

    // Fechar pool de conexões do banco de dados
    if (pool && typeof pool.end === 'function') {
        try {
            await pool.end();
            console.log('✅ Pool de conexões do banco encerrado');
        } catch (err) {
            console.error('⚠️  Erro ao encerrar pool do banco:', err);
        }
    }

    // 🤖 Notificar shutdown no Discord e desconectar
    if (discordBot && typeof discordBot.shutdown === 'function') {
        try {
            await discordBot.publicarShutdown('Desligamento gracioso');
            await discordBot.shutdown();
            console.log('✅ Discord Notifier encerrado');
        } catch (err) {
            console.error('⚠️  Erro ao encerrar Discord:', err);
        }
    }

    clearTimeout(forceKillTimer);
    console.log('✅ Shutdown completo');
}

// Captura erros globais não tratados
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err?.message, stack: err?.stack, code: err?.code });
    // Apenas erros FATAIS (OOM, stack overflow) devem derrubar o servidor
    const fatalErrors = ['ERR_IPC_CHANNEL_CLOSED', 'ENOMEM'];
    if (fatalErrors.includes(err?.code)) {
        logger.error('Fatal error — shutting down', { code: err.code });
        process.exit(1);
    }
    logger.warn('Continuing despite uncaught exception (non-fatal)');
});

process.on('unhandledRejection', (reason, promise) => {
    // Log detalhado para diagnóstico
    const reasonStr = reason instanceof Error
        ? reason.stack || reason.message
        : (typeof reason === 'object' ? JSON.stringify(reason, null, 2) : String(reason));
    logger.error('Unhandled rejection', { reason: reasonStr, type: typeof reason });
    // NÃO encerrar processo - apenas logar o erro
    // Unhandled rejections não-críticas não devem derrubar o servidor
    logger.warn('Continuing despite unhandled rejection (non-fatal)');
});

// ======================================
// Graceful shutdown on signals (apenas em produção ou quando explicitamente solicitado)
process.on('SIGINT', async () => {
    console.log('\n🛑 SIGINT received: iniciando shutdown gracioso...');

    // Em desenvolvimento, perguntar se realmente quer encerrar
    if (process.env.NODE_ENV !== 'production') {
        console.log('🟡 Modo desenvolvimento: Use Ctrl+C novamente em 2 segundos para forçar encerramento');

        // Aguarda 2 segundos antes de realmente encerrar
        setTimeout(async () => {
            try {
                await stopServer();
                process.exit(0);
            } catch (error) {
                console.error('❌ Erro durante shutdown:', error);
                process.exit(1);
            }
        }, 2000);

        return;
    }

    try {
        await stopServer();
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro durante shutdown:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 SIGTERM received: iniciando shutdown gracioso...');
    try {
        await stopServer();
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro durante shutdown:', error);
        process.exit(1);
    }
});

// Export app and control functions for in-process tests and external control
module.exports = { app, startServer, stopServer, setDbAvailable };

// If this file is run directly, start the server normally
if (require.main === module) {
    startServer();
}
