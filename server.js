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
require('dotenv').config({ path: path.join(__dirname, '.env') });
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
const authUnified = require('./middleware/auth-unified');

// AUDIT-FIX R-17/R-18/R-19/R-20: Módulo LGPD compliance
const { createLGPDRouter } = require('./routes/lgpd');

// Importar express-validator para validação de dados
const { body, param, query, validationResult } = require('express-validator');

// Importar UUID para gerar deviceId único (MULTI-DEVICE)
const { v4: uuidv4 } = require('uuid');

// ⚡ ENTERPRISE: Cache distribuído (Redis/Map) e Resiliência
const cacheService = require('./services/cache');
const { wrapPoolWithTimeout, CircuitBreaker, requestTimeout, createPoolMonitor, createHealthEndpoint } = require('./services/resilience');
const { initRateLimitRedis } = require('./services/rate-limiter-redis');

// 📊 ENTERPRISE: Prometheus Metrics (HTTP histograms, DB pool, cache, business KPIs)
const { metricsMiddleware, createMetricsEndpoint, trackDBQuery, trackCacheHit, trackCacheMiss, trackBusinessEvent, trackError } = require('./services/metrics');

// 🤖 DISCORD: Notificações em tempo real via Webhook
let discordBot;
try {
    discordBot = require('./services/discord-notifier');
} catch (e) {
    console.warn('[Discord] Notifier não disponível:', e.message);
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
    console.log = function(...args) {
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

const PORT = parseInt(process.env.PORT) || 3000;
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
        emailTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true', // true para 465, false para outras portas
            auth: {
                user: process.env.SMTP_USER || 'sistema@aluforce.ind.br',
                pass: process.env.SMTP_PASS || '' // Deixe vazio se não configurado
            },
            tls: {
                rejectUnauthorized: process.env.NODE_ENV === 'production' // Validar certificado em produção
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
        const info = await emailTransporter.sendMail({
            from: `"ALUFORCE Sistema" <${process.env.SMTP_USER}>`,
            to: to,
            subject: subject,
            text: text || html.replace(/<[^>]*>/g, ''), // Fallback text
            html: html
        });

        logger.info(`[EMAIL] ✅ Email enviado: ${subject} → ${to} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error(`[EMAIL] ❌ Erro ao enviar email: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// =================================================================
// 3. MIDDLEWARES DE AUTORIZAÇÁO (declarados antes de serem usados)
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

// Middleware para autorizar apenas administradores ou RH (usado em RH)
const authorizeAdmin = async (req, res, next) => {
    const userRole = String(req.user?.role || '').toLowerCase().trim();
    const isAdmin = userRole === 'admin' || userRole === 'administrador' ||
                    req.user?.is_admin === 1 || req.user?.is_admin === true || req.user?.is_admin === '1';
    const isRH = userRole === 'rh' || userRole === 'recursos humanos';

    if (isAdmin || isRH) {
        return next();
    }

    // AUDIT-FIX: Verificar permissão via banco (permissoes_modulos) — consistente com authorizeArea
    try {
        const dbAreas = await getDbAreas(req.user?.id);
        if (dbAreas && dbAreas.has('rh')) {
            return next();
        }
    } catch (e) {
        // Ignora erros na checagem de permissão — fallback para deny
    }

    return res.status(403).json({ message: 'Acesso negado. Requer privilégios de administrador ou RH.' });
};

// ============================================================
// AUDIT-FIX HIGH-002: DB-driven permission cache
// ============================================================
const _permCache = new Map(); // key: userId → { areas: Set, ts: number }
global._permCache = _permCache; // Exposto para auth-rbac invalidar cache
const PERM_CACHE_TTL = 5 * 60 * 1000; // 5 min

async function getDbAreas(userId) {
    if (!pool || !userId) return null;
    const cached = _permCache.get(userId);
    if (cached && Date.now() - cached.ts < PERM_CACHE_TTL) return cached.areas;
    try {
        const [rows] = await pool.query(
            'SELECT modulo FROM permissoes_modulos WHERE usuario_id = ? AND visualizar = 1',
            [userId]
        );
        if (rows.length === 0) return null; // no DB rows → use hardcoded fallback
        const areas = new Set(rows.map(r => r.modulo.toLowerCase()));
        _permCache.set(userId, { areas, ts: Date.now() });
        return areas;
    } catch (e) {
        return null; // DB error → fall through to hardcoded
    }
}

// Middleware para controle de acesso por área baseado em permissões de usuário
// AUDIT-FIX HIGH-002: Checks DB (permissoes_modulos) first, hardcoded map as fallback
const authorizeArea = (area) => {
    return async (req, res, next) => {
        if (!req.user) {
            logger.warn(`[AUTH-AREA] Usuário não autenticado para área: ${area}`);
            return res.status(401).json({ message: 'Usuário não autenticado.' });
        }

        // Obter firstName de forma segura
        let firstName = 'unknown';
        if (req.user.nome) {
            firstName = req.user.nome.split(' ')[0].toLowerCase();
        } else if (req.user.email) {
            firstName = req.user.email.split('@')[0].split('.')[0].toLowerCase();
        }

        // Admin always has access
        const isAdmin = req.user.role === 'admin' ||
                        req.user.is_admin === true ||
                        req.user.is_admin === 1 ||
                        req.user.is_admin === '1' ||
                        String(req.user.role).toLowerCase() === 'admin';

        if (isAdmin) {
            logger.info(`[AUTH-AREA] Admin ${firstName} autorizado para ${area}`);
            return next();
        }

        // Consultoria: read-mostly access
        const isConsultoria = req.user.role === 'consultoria' ||
                              String(req.user.role).toLowerCase() === 'consultoria';
        if (isConsultoria) {
            logger.info(`[AUTH-AREA] Consultoria ${firstName} autorizado para ${area} (modo leitura)`);
            req.isConsultoria = true;
            req.canEdit = true;
            req.canCreate = false;
            req.canDelete = false;
            req.canApprove = false;
            return next();
        }

        // AUDIT-FIX HIGH-002: Check DB permissions first
        const dbAreas = await getDbAreas(req.user.id);
        if (dbAreas) {
            // DB has rows for this user — authoritative source
            if (dbAreas.has(area.toLowerCase())) {
                logger.info(`[AUTH-AREA] DB: ${firstName} autorizado para ${area}`);
                return next();
            }
            logger.warn(`[AUTH-AREA] DB: Acesso negado para ${firstName} à área ${area}`);
            return res.status(403).json({
                message: `Acesso negado à área ${area}. Você não tem permissão para acessar este módulo.`
            });
        }

        // Fallback to hardcoded map (transition period)
        if (userPermissions.hasAccess(firstName, area)) {
            logger.info(`[AUTH-AREA] Hardcoded: ${firstName} autorizado para ${area}`);
            return next();
        }

        logger.warn(`[AUTH-AREA] Acesso negado para ${firstName} à área ${area}`);
        return res.status(403).json({
            message: `Acesso negado à área ${area}. Você não tem permissão para acessar este módulo.`
        });
    };
};


// =================================================================
// AUDIT-FIX HIGH-002: DB-driven action permission cache
// =================================================================
const _actionCache = new Map(); // key: `${userId}:${modulo}` → { actions: Set, ts: number }
global._actionCache = _actionCache; // Exposto para auth-rbac invalidar cache

async function getDbActions(userId, modulo) {
    if (!pool || !userId) return null;
    const cacheKey = `${userId}:${modulo}`;
    const cached = _actionCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < PERM_CACHE_TTL) return cached.actions;
    try {
        const [rows] = await pool.query(
            'SELECT acao FROM permissoes_acoes WHERE usuario_id = ? AND modulo = ? AND permitido = 1',
            [userId, modulo]
        );
        if (rows.length === 0) return null; // no DB rows → use hardcoded fallback
        const actions = new Set(rows.map(r => r.acao));
        _actionCache.set(cacheKey, { actions, ts: Date.now() });
        return actions;
    } catch (e) {
        return null; // DB error → fall through to hardcoded
    }
}

// =================================================================
// Middleware de Autorização Granular por Ação
// AUDIT-FIX HIGH-002: DB-first with hardcoded fallback (transition period)
// =================================================================
const authorizeAction = (modulo, actions) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Usuário não autenticado.' });
        }

        // Admin sempre tem acesso total
        const isAdmin = req.user.role === 'admin' ||
                        req.user.is_admin === true ||
                        req.user.is_admin === 1 ||
                        req.user.is_admin === '1';

        if (isAdmin) {
            req.userPermissions = actions; // Admin tem todas as ações
            return next();
        }

        // Obter firstName
        let firstName = 'unknown';
        if (req.user.nome) {
            firstName = req.user.nome.split(' ')[0].toLowerCase();
        } else if (req.user.email) {
            firstName = req.user.email.split('@')[0].split('.')[0].toLowerCase();
        }

        const actionsArray = Array.isArray(actions) ? actions : [actions];

        // DB-first: Check permissoes_acoes
        const dbActions = await getDbActions(req.user.id, modulo);
        if (dbActions) {
            const permittedActions = actionsArray.filter(action => dbActions.has(action));
            if (permittedActions.length > 0) {
                logger.info(`[AUTH-ACTION] DB: ${firstName} autorizado para ${permittedActions.join(', ')} em ${modulo}`);
                req.userPermissions = permittedActions;
                return next();
            }
            logger.warn(`[AUTH-ACTION] DB: Acesso negado para ${firstName} - Ações: ${actionsArray.join(', ')} no módulo ${modulo}`);
            return res.status(403).json({
                message: `Acesso negado. Você não tem permissão para esta ação no módulo ${modulo}.`,
                required_actions: actionsArray,
                module: modulo
            });
        }

        // Fallback: hardcoded map (deprecation transition)
        const permittedActions = actionsArray.filter(action =>
            userPermissions.hasPermission(firstName, modulo, action)
        );

        if (permittedActions.length === 0) {
            console.log(`[AUTH-ACTION] Acesso negado para ${firstName} - Ações: ${actionsArray.join(', ')} no módulo ${modulo}`);
            return res.status(403).json({
                message: `Acesso negado. Você não tem permissão para esta ação no módulo ${modulo}.`,
                required_actions: actionsArray,
                module: modulo
            });
        }

        logger.info(`[AUTH-ACTION] Hardcoded fallback: ${firstName} autorizado para ${permittedActions.join(', ')} em ${modulo}`);
        req.userPermissions = permittedActions;
        return next();
    };
};

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
    if (dbPass === 'aluvendas01' || dbPass.length < 8) {
        logger.error('❌ ERRO CRÍTICO: Senha do banco insegura para produção');
        logger.error('💡 Use uma senha forte com pelo menos 12 caracteres');
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
    connectionLimit: parseInt(process.env.DB_CONN_LIMIT) || 200, // ENTERPRISE: 200 conexões para suportar 10K+ usuários
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
    cacheService.cacheClearByToken(token, jwt, JWT_SECRET).catch(() => {});
}
function cacheClearAllUserSessions(userId) {
    cacheService.cacheClearAllUserSessions(userId).catch(() => {});
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
    console.log(`(simulado) enviarEmail -> to=${to} subject=${subject} text=${String(text).slice(0,200)}`);
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

// CORS configurado para permitir cookies e acesso do app mobile
// AUDITORIA 02/02/2026: Restrito a origens autorizadas para segurança
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000',
    'https://aluforce.api.br',      // Domínio principal de produção
    'https://www.aluforce.api.br',  // WWW do domínio principal
    'https://aluforce.ind.br',
    'https://erp.aluforce.ind.br',
    'https://www.aluforce.ind.br',
    'http://31.97.64.102:3000',
    'http://31.97.64.102',
    process.env.CORS_ORIGIN, // Origem customizada via env
].filter(Boolean);

app.use(cors({
    origin: function(origin, callback) {
        // AUDIT-FIX: No-origin requests (mobile/server-to-server) allowed only in dev
        // In production, no-origin requests must use Bearer token (enforced by authenticateToken)
        if (!origin) {
            if (process.env.NODE_ENV === 'development') return callback(null, true);
            // In production, allow but don't set Access-Control-Allow-Origin
            // The request proceeds but cookies won't be sent cross-origin
            return callback(null, false);
        }

        if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS: Origem bloqueada: ${origin}`);
            callback(new Error('Origem não permitida pelo CORS'));
        }
    },
    credentials: true, // CRITICAL: Permite envio de cookies
    exposedHeaders: ['set-cookie'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-CSRF-Token']
}));

// FIX 19/02/2026: cookieParser DEVE rodar ANTES do csrfProtection
// para que req.cookies esteja populado quando o CSRF verificar o csrf_token cookie
app.use(cookieParser());
app.use(csrfProtection);

// Aplicar middlewares de segurança avançados (Auditoria 30/01/2026)
// AUDITORIA 02/02/2026: CSRF habilitado para proteção contra ataques
applySecurityMiddlewares(app, {
    pool: pool, // AUDIT-FIX R-04: Passar pool real para audit logs funcionarem
    enableCSRF: true, // AUDITORIA 02/02/2026: CSRF habilitado
    enableRateLimit: true,
    enableAudit: true,
    // AUDIT-FIX R-02: CSRF real — apenas rotas de auth/webhook/health isentas
    // Módulos de negócio (vendas, compras, financeiro, etc.) DEVEM ter proteção CSRF
    // Requisições com Bearer token já são isentas por design no security-middleware.js
    csrfIgnorePaths: [
        '/api/login',
        '/api/logout',
        '/api/auth',
        '/api/verify-2fa',
        '/api/resend-2fa',
        '/api/webhook',
        '/api/callback',
        '/api/health',
        '/api/status',
        '/api/sse',
        '/api/events',
        '/api/mobile', // App mobile usa token de dispositivo
        '/api/discord' // Discord webhooks/notificações
    ]
});

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
app.get('/favicon.ico', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 dias
    res.setHeader('Content-Type', 'image/x-icon');
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// ========================================
// ⚡ ENTERPRISE: Auto-inject do ConfirmDialog profissional em todas as páginas HTML
// Intercepta res.sendFile para injetar confirm-dialog.js antes de </body>
// ========================================
const CONFIRM_DIALOG_TAG = '\n<!-- ALUFORCE: Confirm Dialog Profissional v2.0 -->\n<script src="/_shared/confirm-dialog.js?v=20260217"></script>\n';
app.use((req, res, next) => {
    const _origSendFile = res.sendFile.bind(res);
    res.sendFile = function (filePath, opts, cb) {
        if (typeof filePath === 'string' && filePath.endsWith('.html')) {
            fs.readFile(filePath, 'utf8', (err, html) => {
                if (err || !html) return _origSendFile(filePath, opts, cb);
                // Não injetar se já inclui confirm-dialog.js
                if (html.includes('confirm-dialog.js')) {
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.send(html);
                }
                // Injetar antes de </body> ou </html>
                if (html.includes('</body>')) {
                    html = html.replace('</body>', CONFIRM_DIALOG_TAG + '</body>');
                } else if (html.includes('</html>')) {
                    html = html.replace('</html>', CONFIRM_DIALOG_TAG + '</html>');
                } else {
                    html += CONFIRM_DIALOG_TAG;
                }
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.send(html);
            });
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
    if (lp.endsWith('.html') || lp.startsWith('/chat/widget')) {
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

// Dashboard principal (Painel de Controle) — requer autenticação
app.get('/dashboard', authenticatePage, (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Compatibilidade: /index.html também serve o dashboard
app.get('/index.html', authenticatePage, (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Servir página de Ajuda (institucional) - DEVE VIR ANTES do express.static(public)
const ajudaPath = path.join(__dirname, 'ajuda');
const ajudaOptions = {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
};
app.use('/ajuda', express.static(ajudaPath, ajudaOptions));
app.use('/Ajuda', express.static(ajudaPath, ajudaOptions));

// ⚡ ENTERPRISE: Shared utilities (fetch-utils, confirm-dialog, etc.)
app.use('/_shared', express.static(path.join(__dirname, '_shared'), {
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
    index: false,
    maxAge: '7d',  // Cache de 7 dias para CSS
    etag: true,
    lastModified: true
}));

app.use('/js', express.static(path.join(__dirname, 'public', 'js'), {
    index: false,
    maxAge: '7d',  // Cache de 7 dias para JS
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
    index: false,
    maxAge: '30d',  // Cache de 30 dias - fundos mudam muito raramente
    etag: true,
    lastModified: true,
    immutable: true  // Diz ao browser que o conteúdo não muda (usa ?v= para cache busting)
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
        const ext = chatPath.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E6) + ext);
    }
});
const chatUpload = chatMulter({
    storage: chatUploadStorage,
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|mp3|wav|ogg|webm|mp4/;
        const ext = allowedTypes.test(chatPath.extname(file.originalname).toLowerCase());
        const mime = allowedTypes.test(file.mimetype);
        cb(null, ext || mime);
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

// Serve chat uploads
app.use('/chat/uploads', require('express').static(chatPath.join(__dirname, 'chat', 'uploads')));

// Serve chat static files (widget assets) - public/chat e Chat/public como fallback
app.use('/chat', require('express').static(chatPath.join(__dirname, 'public', 'chat')));
app.use('/chat', require('express').static(chatPath.join(__dirname, 'Chat', 'public')));

// Chat support page
app.get('/chat/suporte', (req, res) => {
    res.sendFile(chatPath.join(__dirname, 'public', 'chat', 'support.html'));
});

console.log('💬 Chat BOB AI: Rotas de upload e arquivos estáticos configuradas');

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

app.use(express.static(path.join(__dirname, 'public'), {
    index: false,
    maxAge: '1d',  // Cache de 1 dia para outros assets
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        // HTML e arquivos do chat widget: sempre revalidar
        if (filePath.endsWith('.html') || filePath.includes('chat')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
        }
    }
}));

// Servir Socket.io client library
app.use('/socket.io', express.static(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist')));

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
    setHeaders: (res, path) => {
        res.setHeader('Content-Type', 'application/javascript');
    }
}));

app.use('/Vendas/css', express.static(path.join(__dirname, 'modules', 'Vendas', 'public', 'css'), {
    setHeaders: (res, path) => {
        res.setHeader('Content-Type', 'text/css');
    }
}));

app.use('/Vendas/images', express.static(path.join(__dirname, 'modules', 'Vendas', 'public', 'images')));
app.use('/Vendas/assets', express.static(path.join(__dirname, 'modules', 'Vendas', 'public', 'assets')));

// Servir uploads específicos do Vendas
app.use('/uploads', express.static(path.join(__dirname, 'modules', 'Vendas', 'public', 'uploads'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
            res.setHeader('Content-Type', 'image/' + filePath.split('.').pop().replace('jpg', 'jpeg'));
        }
    }
}));
// /Sistema/Vendas removido - use rotas autenticadas /Vendas/*

// Rotas estáticas do PCP - Cache desabilitado para TODOS os tipos de arquivo
app.use('/PCP', express.static(path.join(__dirname, 'modules', 'PCP'), {
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

app.use('/NFe', express.static(path.join(__dirname, 'modules', 'NFe')));
app.use('/e-Nf-e', express.static(path.join(__dirname, 'modules', 'NFe'))); // Compatibilidade com URL antiga

// Servir templates de importação Zyntra (xlsx) para download direto
// Rota explícita para subpastas (zyntra/) + arquivo direto
app.get('/templates/:folder/:file', (req, res) => {
    // Security: block path traversal
    if (req.params.folder.includes('..') || req.params.file.includes('..')) {
        return res.status(400).json({ error: 'Caminho inválido' });
    }
    const filePath = path.join(__dirname, 'templates', req.params.folder, req.params.file);
    // Verify resolved path stays within templates dir
    if (!filePath.startsWith(path.join(__dirname, 'templates'))) {
        return res.status(400).json({ error: 'Caminho inválido' });
    }
    if (!filePath.endsWith('.xlsx')) {
        return res.status(400).json({ error: 'Apenas arquivos .xlsx são permitidos' });
    }
    res.download(filePath, req.params.file, (err) => {
        if (err && !res.headersSent) {
            console.error(`[Templates] Arquivo não encontrado: ${filePath}`);
            res.status(404).json({ error: 'Template não encontrado' });
        }
    });
});
app.get('/templates/:file', (req, res) => {
    // Security: block path traversal
    if (req.params.file.includes('..')) {
        return res.status(400).json({ error: 'Caminho inválido' });
    }
    const filePath = path.join(__dirname, 'templates', req.params.file);
    if (!filePath.startsWith(path.join(__dirname, 'templates'))) {
        return res.status(400).json({ error: 'Caminho inválido' });
    }
    if (!filePath.endsWith('.xlsx')) {
        return res.status(400).json({ error: 'Apenas arquivos .xlsx são permitidos' });
    }
    res.download(filePath, req.params.file, (err) => {
        if (err && !res.headersSent) {
            console.error(`[Templates] Arquivo não encontrado: ${filePath}`);
            res.status(404).json({ error: 'Template não encontrado' });
        }
    });
});

app.use('/Financeiro', express.static(path.join(__dirname, 'modules', 'Financeiro', 'public')));
app.use('/Compras', express.static(path.join(__dirname, 'modules', 'Compras')));
app.use('/RecursosHumanos', express.static(path.join(__dirname, 'modules', 'RH', 'public')));
app.use('/RH', express.static(path.join(__dirname, 'modules', 'RH', 'public'))); // Compatibilidade

// Servir arquivos compartilhados dos módulos
app.use('/_shared', express.static(path.join(__dirname, 'modules', '_shared')));

// Servir módulos diretamente com rotas específicas
app.use('/modules', express.static(path.join(__dirname, 'modules')));

// =================================================================
// ENDPOINT DE HEALTH CHECK — Enterprise Monitoring
// =================================================================
app.get('/api/health', createHealthEndpoint(pool, cacheService));

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

// 📊 ENTERPRISE: Prometheus /metrics endpoint (protected at app level + nginx)
app.get('/metrics', (req, res, next) => {
    // In production, require metrics auth token or localhost
    if (process.env.NODE_ENV === 'production') {
        const metricsToken = process.env.METRICS_TOKEN;
        const authHeader = req.headers['authorization'];
        const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
        if (!isLocalhost && (!metricsToken || authHeader !== `Bearer ${metricsToken}`)) {
            return res.status(403).json({ error: 'Acesso não autorizado' });
        }
    }
    next();
}, createMetricsEndpoint(pool, cacheService));

// ⚡ ENTERPRISE: Request timeout middleware (30s default)
app.use('/api', requestTimeout(parseInt(process.env.REQUEST_TIMEOUT) || 30000));

// =================================================================
// ENDPOINT DE FOTO DO USUÁRIO - Busca foto pelo email
// =================================================================
app.get('/api/usuarios/foto/:email', async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email).toLowerCase();

        // Busca a foto do usuário no banco
        const [usuarios] = await pool.query(
            'SELECT foto, avatar, nome, apelido FROM usuarios WHERE LOWER(email) = ?',
            [email]
        );

        if (usuarios.length > 0 && (usuarios[0].foto || usuarios[0].avatar)) {
            return res.json({
                success: true,
                foto: usuarios[0].foto || usuarios[0].avatar,
                nome: usuarios[0].nome,
                apelido: usuarios[0].apelido || null
            });
        }

        // Retornar dados mesmo sem foto (para apelido/nome)
        if (usuarios.length > 0) {
            return res.json({
                success: true,
                foto: null,
                nome: usuarios[0].nome,
                apelido: usuarios[0].apelido || null
            });
        }

        // Se não encontrou no usuarios, tenta buscar em funcionarios pelo email
        const [funcionarios] = await pool.query(
            'SELECT foto_perfil_url, nome_completo FROM funcionarios WHERE LOWER(email) = ?',
            [email]
        );

        if (funcionarios.length > 0) {
            return res.json({
                success: true,
                foto: funcionarios[0].foto_perfil_url || null,
                nome: funcionarios[0].nome_completo
            });
        }

        return res.json({ success: false, message: 'Usuário não encontrado' });
    } catch (error) {
        console.error('Erro ao buscar foto do usuário:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

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
        const unique = `${file.fieldname}-${Date.now()}-${Math.floor(Math.random()*1e9)}${ext}`;
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
function authenticatePage(req, res, next) {
    // SECURITY FIX: Exige token válido para servir páginas protegidas
    const token = req.cookies?.authToken || req.cookies?.token || req.headers['authorization']?.replace('Bearer ', '');
    if (!token) {
        console.log('[AUTH] Sem token ao acessar página protegida:', req.path);
        return res.redirect('/login.html');
    }
    // AUDIT-FIX HIGH-006: Enforce HS256 algorithm
    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
        if (err) {
            console.log('[AUTH] Token inválido ao acessar página protegida:', err.message);
            return res.redirect('/login.html');
        }
        req.user = user;
        return next();
    });
}

// Rota condicional para Recursos Humanos baseada no perfil do usuário
app.get('/RecursosHumanos', authenticatePage, (req, res) => {
    // Redirecionamento inteligente baseado no tipo de usuário
    if (req.user && (req.user.nome || req.user.email)) {
        const firstName = req.user.nome ? req.user.nome.split(' ')[0].toLowerCase() : '';
        const emailPrefix = req.user.email ? req.user.email.split('@')[0].toLowerCase() : '';

        // Se for admin, redireciona para área administrativa
        if (userPermissions.isAdmin(firstName) || userPermissions.isAdmin(emailPrefix)) {
            console.log('[RH] Usuário admin detectado - Redirecionando para areaadm.html');
            return res.redirect('/RH/areaadm.html');
        }
    }

    // Se não for admin, redireciona para página do funcionário
    console.log('[RH] Usuário funcionário - Redirecionando para funcionario.html');
    return res.redirect('/RH/funcionario.html');
});

// Rota principal /RH/ - Redirecionamento inteligente baseado no perfil
app.get('/RH/', authenticatePage, (req, res) => {
    if (req.user && (req.user.nome || req.user.email)) {
        const firstName = req.user.nome ? req.user.nome.split(' ')[0].toLowerCase() : '';
        const emailPrefix = req.user.email ? req.user.email.split('@')[0].toLowerCase() : '';

        if (userPermissions.hasAccess(firstName, 'rh') || userPermissions.hasAccess(emailPrefix, 'rh')) {
            // Se for admin, redireciona para área administrativa
            if (userPermissions.isAdmin(firstName) || userPermissions.isAdmin(emailPrefix)) {
                return res.redirect('/RH/areaadm.html');
            }
            // Se não for admin, redireciona para área do funcionário
            return res.redirect('/RH/funcionario.html');
        } else {
            return res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de RH.</p>');
        }
    } else {
        return res.redirect('/login.html');
    }
});

// Rotas diretas para os arquivos HTML do RH (para compatibilidade)
app.get('/RH/areaadm.html', authenticatePage, (req, res) => {
    if (req.user && (req.user.nome || req.user.email)) {
        // Verificar por nome e também por email (prefixo antes do @)
        const firstName = req.user.nome ? req.user.nome.split(' ')[0].toLowerCase() : '';
        const emailPrefix = req.user.email ? req.user.email.split('@')[0].toLowerCase() : '';

        if (userPermissions.isAdmin(firstName) || userPermissions.isAdmin(emailPrefix)) {
            res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'areaadm.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Esta área é restrita a administradores.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/RH/area.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'area.html'));
});

app.get('/RH/funcionario.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'funcionario.html'));
});

// Rotas específicas para páginas individuais do RH
app.get('/RH/dashboard.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'pages', 'dashboard.html'));
});

app.get('/RH/dados-pessoais.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'dados-pessoais.html'));
});

app.get('/RH/holerites.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'holerites.html'));
});

app.get('/RH/solicitacoes.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'solicitacoes.html'));
});

// Rotas para páginas do colaborador RH (em /rh/pages/)
app.get('/rh/pages/:page', authenticatePage, (req, res) => {
    const page = req.params.page;
    // Remove .html se vier na URL
    const fileName = page.endsWith('.html') ? page : `${page}.html`;
    const filePath = path.join(__dirname, 'modules', 'RH', 'public', 'pages', fileName);

    // Verifica se o arquivo existe
    if (require('fs').existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.log(`[RH] Arquivo não encontrado: ${filePath}`);
        res.status(404).send('<h1>Página não encontrada</h1>');
    }
});

// Rota para solicitações do RH (sem .html)
app.get('/rh/solicitacoes', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'solicitacoes.html'));
});

// Rota para área administrativa do RH (minúsculo)
app.get('/rh/areaadm', authenticatePage, (req, res) => {
    if (req.user && (req.user.nome || req.user.email)) {
        // Verificar por nome e também por email (prefixo antes do @)
        const firstName = req.user.nome ? req.user.nome.split(' ')[0].toLowerCase() : '';
        const emailPrefix = req.user.email ? req.user.email.split('@')[0].toLowerCase() : '';

        if (userPermissions.isAdmin(firstName) || userPermissions.isAdmin(emailPrefix)) {
            res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'areaadm.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Esta área é restrita a administradores.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Rota para funcionário/dashboard colaborador (minúsculo)
app.get('/rh/funcionario', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'funcionario.html'));
});

// Rotas para área administrativa do RH
app.get('/RH/admin-dashboard.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'admin-dashboard.html'));
});

app.get('/RH/admin-funcionarios.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'admin-funcionarios.html'));
});

app.get('/RH/admin-folha-pagamento.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'admin-folha-pagamento.html'));
});

app.get('/RH/admin-ponto.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'admin-ponto.html'));
});

app.get('/RH/gestao-ponto.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'pages', 'gestao-ponto.html'));
});

app.get('/RH/admin-beneficios.html', authenticatePage, (req, res) => {
    res.sendFile(path.join(__dirname, 'modules', 'RH', 'public', 'admin-beneficios.html'));
});

// ===== ROTAS DO MÓDULO DE VENDAS =====
// Rota principal: /Vendas/ - requer autenticação e permissão
app.get('/Vendas/', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'vendas')) {
            res.sendFile(path.join(__dirname, 'modules', 'Vendas', 'public', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Vendas.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Rota Kanban (redireciona para principal)
app.get('/Vendas/kanban.html', authenticatePage, (req, res) => res.redirect('/Vendas/'));

// Rotas alternativas redirecionam para /Vendas/
app.get('/Vendas/index.html', authenticatePage, (req, res) => res.redirect('/Vendas/'));
app.get('/Vendas/vendas.html', authenticatePage, (req, res) => res.redirect('/Vendas/'));

// Rotas das páginas do módulo Vendas
app.get('/Vendas/pedidos.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'vendas')) {
            res.sendFile(path.join(__dirname, 'modules', 'Vendas', 'public', 'pedidos.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Vendas.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/Vendas/clientes.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'vendas')) {
            res.sendFile(path.join(__dirname, 'modules', 'Vendas', 'public', 'clientes.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Vendas.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/Vendas/dashboard.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'vendas')) {
            res.sendFile(path.join(__dirname, 'modules', 'Vendas', 'public', 'dashboard.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Vendas.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/Vendas/dashboard-admin.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        const emailPrefix = (req.user.email || '').split('@')[0].toLowerCase();
        // Dashboard Admin - somente administradores
        if (userPermissions.isAdmin(firstName) || userPermissions.isAdmin(emailPrefix)) {
            res.sendFile(path.join(__dirname, 'modules', 'Vendas', 'public', 'dashboard-admin.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Esta página é restrita a administradores.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/Vendas/relatorios.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'vendas')) {
            res.sendFile(path.join(__dirname, 'modules', 'Vendas', 'public', 'relatorios.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Vendas.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/Vendas/prospeccao.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'vendas')) {
            res.sendFile(path.join(__dirname, 'modules', 'Vendas', 'public', 'prospeccao.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Vendas.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/Vendas/estoque.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'vendas')) {
            res.sendFile(path.join(__dirname, 'modules', 'Vendas', 'public', 'estoque.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Vendas.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/Vendas/comissoes.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'vendas')) {
            res.sendFile(path.join(__dirname, 'modules', 'Vendas', 'public', 'comissoes.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Vendas.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/Vendas/cte.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'vendas')) {
            res.sendFile(path.join(__dirname, 'modules', 'Vendas', 'public', 'cte.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Vendas.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Rota /modules/Vendas/ - redireciona para /Vendas/
app.get('/modules/Vendas/', authenticatePage, (req, res) => res.redirect('/Vendas/'));
app.get('/modules/Vendas/index.html', authenticatePage, (req, res) => res.redirect('/Vendas/'));

// Rotas protegidas para PCP - requer autenticação e permissão
app.get('/PCP/index.html', authenticatePage, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'pcp')) {
            res.sendFile(path.join(__dirname, 'modules', 'PCP', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de PCP.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/modules/PCP/index.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'pcp')) {
            res.sendFile(path.join(__dirname, 'modules', 'PCP', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de PCP.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Rotas protegidas para CRM - requer autenticação e permissão
app.get('/CRM/crm.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'crm')) {
            res.sendFile(path.join(__dirname, 'modules', 'CRM', 'crm.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de CRM.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Rotas protegidas para NFe - requer autenticação e permissão
app.get('/NFe/nfe.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'nfe')) {
            res.sendFile(path.join(__dirname, 'modules', 'NFe', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de NF-e.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Rotas protegidas para Compras - requer autenticação e permissão
app.get('/Compras/compras.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'compras')) {
            res.sendFile(path.join(__dirname, 'modules', 'Compras', 'public', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Compras.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Rota principal do módulo Compras
app.get('/Compras', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'compras')) {
            res.sendFile(path.join(__dirname, 'modules', 'Compras', 'public', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Compras.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Todas as rotas de Compras agora servem o novo index.html unificado
app.get('/Compras/:page', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'compras')) {
            res.sendFile(path.join(__dirname, 'modules', 'Compras', 'public', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Compras.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Rotas de acesso direto aos módulos (redirecionam para login se não autenticado)
app.get('/modules/RH/public/areaadm.html', authenticatePage, (req, res) => {
    res.redirect('/RH/areaadm.html');
});

app.get('/modules/RH/public/area.html', authenticatePage, (req, res) => {
    res.redirect('/RH/funcionario.html');
});

app.get('/modules/RH/public/funcionario.html', authenticatePage, (req, res) => {
    res.redirect('/RH/funcionario.html');
});

// Rota para página de teste de sincronização de estoque
app.get('/teste-sincronizacao-estoque.html', authenticatePage, (req, res) => {
    console.log('[TESTE] Acesso à página de teste de sincronização por:', req.user?.email);
    res.sendFile(path.join(__dirname, 'teste-sincronizacao-estoque.html'));
});

// Rota para Dashboard de Integração
app.get('/dashboard-integracao.html', authenticatePage, (req, res) => {
    console.log('[INTEGRACAO] Acesso ao dashboard de integração por:', req.user?.email);
    res.sendFile(path.join(__dirname, 'dashboard-integracao.html'));
});

app.get('/integracao', authenticatePage, (req, res) => {
    res.redirect('/dashboard-integracao.html');
});

// Rotas antigas de Vendas redirecionam para /Vendas/
app.get('/modules/Vendas/public/vendas.html', authenticatePage, (req, res) => res.redirect('/Vendas/'));
app.get('/modules/Vendas/public/', authenticatePage, (req, res) => res.redirect('/Vendas/'));
app.get('/modules/Vendas/public/index.html', authenticatePage, (req, res) => res.redirect('/Vendas/'));

// Rotas para Compras (COM autenticação)
app.get('/modules/Compras/', authenticatePage, (req, res) => {
    res.redirect('/Compras/compras.html');
});

app.get('/modules/Compras/index.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'compras')) {
            res.sendFile(path.join(__dirname, 'modules', 'Compras', 'public', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Compras.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/modules/Compras/public/', authenticatePage, (req, res) => {
    res.redirect('/Compras/compras.html');
});

app.get('/modules/Compras/public/index.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'compras')) {
            res.sendFile(path.join(__dirname, 'modules', 'Compras', 'public', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Compras.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Rotas para Financeiro (COM autenticação)
app.get('/modules/Financeiro/', authenticatePage, (req, res) => {
    res.redirect('/modules/Financeiro/index.html');
});

app.get('/modules/Financeiro/public/', authenticatePage, (req, res) => {
    res.redirect('/modules/Financeiro/index.html');
});

app.get('/modules/Financeiro/public/index.html', authenticatePage, (req, res) => {
    // Redireciona para a versão nova na raiz
    res.redirect('/modules/Financeiro/index.html');
});

// Redirecionamentos das subpáginas do Financeiro (public -> raiz)
app.get('/modules/Financeiro/public/contas_pagar.html', authenticatePage, (req, res) => {
    res.redirect('/modules/Financeiro/contas-pagar.html');
});

app.get('/modules/Financeiro/public/contas_receber.html', authenticatePage, (req, res) => {
    res.redirect('/modules/Financeiro/contas-receber.html');
});

app.get('/modules/Financeiro/public/fluxo_caixa.html', authenticatePage, (req, res) => {
    res.redirect('/modules/Financeiro/fluxo-caixa.html');
});

app.get('/modules/Financeiro/public/contas_bancarias.html', authenticatePage, (req, res) => {
    res.redirect('/modules/Financeiro/bancos.html');
});

app.get('/modules/Financeiro/public/relatorios.html', authenticatePage, (req, res) => {
    res.redirect('/modules/Financeiro/relatorios.html');
});

app.get('/modules/Financeiro/index.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'financeiro')) {
            res.sendFile(path.join(__dirname, 'modules', 'Financeiro', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo Financeiro.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

// Rota curinga para redirecionar qualquer arquivo .html da pasta public do Financeiro
app.get('/modules/Financeiro/public/*.html', authenticatePage, (req, res) => {
    // Pegar o nome do arquivo da URL
    const fileName = req.path.split('/').pop();
    // Mapear nomes de arquivo antigos para novos
    const fileMapping = {
        'index.html': 'index.html',
        'contas_pagar.html': 'contas-pagar.html',
        'contas_receber.html': 'contas-receber.html',
        'fluxo_caixa.html': 'fluxo-caixa.html',
        'contas_bancarias.html': 'bancos.html',
        'relatorios.html': 'relatorios.html'
    };
    const newFileName = fileMapping[fileName] || fileName.replace(/_/g, '-');
    res.redirect(`/modules/Financeiro/${newFileName}`);
});

// Rotas para NFe (COM autenticação)
app.get('/modules/NFe/', authenticatePage, (req, res) => {
    res.redirect('/NFe/nfe.html');
});

app.get('/modules/NFe/public/', authenticatePage, (req, res) => {
    res.redirect('/NFe/nfe.html');
});

app.get('/modules/NFe/index.html', authenticatePage, (req, res) => {
    if (req.user && req.user.nome) {
        const firstName = req.user.nome.split(' ')[0].toLowerCase();
        if (userPermissions.hasAccess(firstName, 'nfe')) {
            res.sendFile(path.join(__dirname, 'modules', 'NFe', 'index.html'));
        } else {
            res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de NF-e.</p>');
        }
    } else {
        res.redirect('/login.html');
    }
});

app.get('/modules/PCP/index.html', authenticatePage, (req, res) => {
    res.redirect('/PCP/index.html');
});

app.get('/modules/NFe/nfe.html', authenticatePage, (req, res) => {
    res.redirect('/NFe/nfe.html');
});

app.get('/NFe/', authenticatePage, (req, res) => {
    res.redirect('/NFe/nfe.html');
});

app.get('/modules/Compras/compras.html', authenticatePage, (req, res) => {
    res.redirect('/Compras/compras.html');
});

app.get('/Compras/', authenticatePage, (req, res) => {
    res.redirect('/Compras/compras.html');
});

app.get('/modules/Financeiro/financeiro.html', authenticatePage, (req, res) => {
    res.redirect('/modules/Financeiro/index.html');
});

app.get('/modules/Faturamento/index.html', authenticatePage, (req, res) => {
    if (req.user && req.user.permissoes && req.user.permissoes.includes('nfe')) {
        res.sendFile(path.join(__dirname, 'modules', 'Faturamento', 'public', 'index.html'));
    } else {
        res.status(403).send('<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de Faturamento.</p>');
    }
});

app.get('/Faturamento/', authenticatePage, (req, res) => {
    res.redirect('/modules/Faturamento/index.html');
});

app.get('/Financeiro/', authenticatePage, (req, res) => {
    res.redirect('/modules/Financeiro/index.html');
});

// Redirecionamento para URLs antigas do NFe
app.get('/e-Nf-e/nfe.html', authenticatePage, (req, res) => {
    res.redirect('/NFe/nfe.html');
});

app.get('/modules/e-Nf-e/nfe.html', authenticatePage, (req, res) => {
    res.redirect('/NFe/nfe.html');
});

// Força qualquer acesso a rotas de login de módulos para a tela de login central
// NOTA: /Vendas/ e /Vendas/public/ NÃO estão aqui - são tratadas com autenticação nas rotas específicas
app.get([
    '/Vendas/login.html', '/Vendas/login', '/Vendas/public/login.html', '/Vendas/public/login',
    '/PCP/login', '/PCP/login.html',
    '/CRM/login', '/CRM/login.html',
    '/Financeiro/login', '/Financeiro/login.html',
    '/NFe/login', '/NFe/login.html',
    '/Compras/login', '/Compras/login.html'
], (req, res) => {
    return res.redirect('/login.html');
});

// =================== AUTOMAÇÁO DE TAREFAS (NODE-CRON) ===================
// Inicialização assíncrona de cron jobs após servidor iniciar
const initCronJobs = () => {
    logger.info('⏰ Inicializando cron jobs...');

    // 1. Agendamento de envio de relatório diário por email
    cron.schedule('0 7 * * *', async () => {
        if (!DB_AVAILABLE) return;
        try {
            const [rows] = await pool.query('SELECT COUNT(*) AS total, SUM(valor) AS faturado FROM vendas WHERE DATE(data) = CURDATE()');
            const texto = `Relatório diário:\nTotal de vendas: ${rows[0].total}\nFaturamento: R$ ${rows[0].faturado}`;
            const destinatario = process.env.EMAIL_RELATORIO_DIARIO || process.env.EMAIL_ADMIN;
            if (destinatario) {
                await enviarEmail(destinatario, 'Relatório Diário de Vendas', texto);
                logger.info('Relatório diário enviado por email.');
            } else {
                logger.info('Relatório diário gerado mas sem destinatário configurado (EMAIL_RELATORIO_DIARIO).');
            }
        } catch (err) {
            console.warn('Erro no cron diário:', err && err.message ? err.message : err);
        }
    });

    // 2. Backup automático do banco de dados — SECURITY-FIX: use spawn instead of shell interpolation
    cron.schedule('0 2 * * *', async () => {
        if (!DB_AVAILABLE) return;
        try {
            const { spawnSync } = require('child_process');
            const backupDir = path.join(__dirname, 'backups', 'db');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const backupFile = path.join(backupDir, `aluforce_vendas_${ts}.sql.gz`);
            const dbHost = process.env.DB_HOST || 'localhost';
            const dbUser = process.env.DB_USER || 'aluforce';
            const dbPass = process.env.DB_PASSWORD || '';
            const dbName = process.env.DB_NAME || 'aluforce_vendas';
            // Safe: use spawnSync with argument arrays — no shell interpolation
            const mysqldump = spawnSync('mysqldump', [
                '-h', dbHost, '-u', dbUser, `--password=${dbPass}`,
                '--single-transaction', '--routines', '--triggers', dbName
            ], { timeout: 120000, maxBuffer: 100 * 1024 * 1024 });
            if (mysqldump.error) throw mysqldump.error;
            if (mysqldump.status !== 0) throw new Error(`mysqldump exited with code ${mysqldump.status}: ${(mysqldump.stderr || '').toString().slice(0, 500)}`);
            const zlib = require('zlib');
            const compressed = zlib.gzipSync(mysqldump.stdout);
            fs.writeFileSync(backupFile, compressed);
            // Limpar backups com mais de 30 dias
            const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
            for (const f of fs.readdirSync(backupDir)) {
                const fp = path.join(backupDir, f);
                if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
            }
            console.log(`✅ Backup DB realizado: ${backupFile}`);
        } catch (err) {
            console.warn('Erro no cron de backup:', err && err.message ? err.message : err);
        }
    });

    // 3. Notificação automática de cobranças
    cron.schedule('0 8 * * *', async () => {
        if (!DB_AVAILABLE) return;
        try {
            const [rows] = await pool.query('SELECT email, nome, valor FROM contas_receber WHERE status = "pendente" AND vencimento = CURDATE()');
            for (const cliente of rows) {
                await enviarEmail(cliente.email, 'Cobrança Pendente', `Olá ${cliente.nome}, sua cobrança de R$ ${cliente.valor} vence hoje.`);
            }
            console.log('Notificações de cobrança enviadas.');
        } catch (err) {
            console.warn('Erro no cron de cobranças:', err && err.message ? err.message : err);
        }
    });

    // =================== CRON JOBS DO MÓDULO DE COMPRAS ===================

    // 4. Verificar estoque mínimo e criar requisições automáticas (a cada 6 horas)
    cron.schedule('0 */6 * * *', async () => {
        if (!DB_AVAILABLE) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando estoque mínimo...');
            await pool.query('CALL sp_verificar_estoque_minimo()');
            logger.info('[COMPRAS-CRON] ✅ Verificação de estoque concluída');
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao verificar estoque:', err);
        }
    });

    // 5. Alertar sobre pedidos atrasados (todos os dias às 9h)
    cron.schedule('0 9 * * *', async () => {
        if (!DB_AVAILABLE) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando pedidos atrasados...');

            const [pedidosAtrasados] = await pool.query(`
                SELECT pc.id, pc.numero_pedido, pc.data_entrega_prevista,
                       f.razao_social as fornecedor,
                       u.id as solicitante_id, u.email as solicitante_email,
                       DATEDIFF(CURDATE(), pc.data_entrega_prevista) as dias_atraso
                FROM pedidos_compra pc
                JOIN fornecedores f ON pc.fornecedor_id = f.id
                JOIN usuarios u ON pc.usuario_solicitante = u.id
                WHERE pc.data_entrega_prevista < CURDATE()
                  AND pc.status NOT IN ('recebido', 'cancelado')
            `);

            for (const pedido of pedidosAtrasados) {
                // Criar notificação
                await pool.execute(
                    `INSERT INTO compras_notificacoes
                    (usuario_id, tipo, titulo, mensagem, entidade_tipo, entidade_id, prioridade, enviar_email)
                    VALUES (?, 'entrega_atrasada', ?, ?, 'pedido_compra', ?, 'alta', TRUE)`,
                    [
                        pedido.solicitante_id,
                        'Pedido com entrega atrasada',
                        `O pedido ${pedido.numero_pedido} do fornecedor ${pedido.fornecedor} está ${pedido.dias_atraso} dias atrasado.`,
                        pedido.id
                    ]
                );

                // Enviar email se configurado
                if (pedido.solicitante_email && emailTransporter) {
                    await sendEmail(
                        pedido.solicitante_email,
                        'Alerta: Pedido de compra atrasado',
                        `<h2>Pedido Atrasado</h2>
                        <p>O pedido <strong>${pedido.numero_pedido}</strong> está com <strong>${pedido.dias_atraso} dias</strong> de atraso.</p>
                        <p><strong>Fornecedor:</strong> ${pedido.fornecedor}</p>
                        <p><strong>Data prevista:</strong> ${pedido.data_entrega_prevista}</p>
                        <p>Por favor, entre em contato com o fornecedor.</p>`
                    );
                }
            }

            logger.info(`[COMPRAS-CRON] ✅ Verificados ${pedidosAtrasados.length} pedidos atrasados`);
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao verificar pedidos atrasados:', err);
        }
    });

    // 6. Alertar sobre documentação de fornecedores vencendo (toda segunda-feira às 8h)
    cron.schedule('0 8 * * 1', async () => {
        if (!DB_AVAILABLE) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando documentação de fornecedores...');

            const [fornecedores] = await pool.query(`
                SELECT id, razao_social, cnpj,
                       data_vencimento_certidao_federal,
                       data_vencimento_certidao_estadual,
                       data_vencimento_certidao_municipal,
                       data_vencimento_certidao_fgts,
                       data_vencimento_certidao_trabalhista
                FROM fornecedores
                WHERE status = 'ativo'
                  AND (
                      data_vencimento_certidao_federal BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                      OR data_vencimento_certidao_estadual BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                      OR data_vencimento_certidao_municipal BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                      OR data_vencimento_certidao_fgts BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                      OR data_vencimento_certidao_trabalhista BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                  )
            `);

            // Buscar responsável por compras para notificar
            const [comprador] = await pool.query(`
                SELECT id, email FROM usuarios
                WHERE area = 'compras' AND ativo = 1
                ORDER BY id LIMIT 1
            `);

            if (comprador.length > 0) {
                for (const fornecedor of fornecedores) {
                    const docsVencendo = [];

                    if (fornecedor.data_vencimento_certidao_federal) docsVencendo.push('Certidão Federal');
                    if (fornecedor.data_vencimento_certidao_estadual) docsVencendo.push('Certidão Estadual');
                    if (fornecedor.data_vencimento_certidao_municipal) docsVencendo.push('Certidão Municipal');
                    if (fornecedor.data_vencimento_certidao_fgts) docsVencendo.push('Certidão FGTS');
                    if (fornecedor.data_vencimento_certidao_trabalhista) docsVencendo.push('Certidão Trabalhista');

                    await pool.execute(
                        `INSERT INTO compras_notificacoes
                        (usuario_id, tipo, titulo, mensagem, entidade_tipo, entidade_id, prioridade, enviar_email)
                        VALUES (?, 'documentacao_vencendo', ?, ?, 'fornecedor', ?, 'normal', TRUE)`,
                        [
                            comprador[0].id,
                            'Documentação de fornecedor vencendo',
                            `Fornecedor ${fornecedor.razao_social} com documentação vencendo em até 30 dias: ${docsVencendo.join(', ')}`,
                            fornecedor.id
                        ]
                    );
                }
            }

            logger.info(`[COMPRAS-CRON] ✅ Verificados ${fornecedores.length} fornecedores com documentação vencendo`);
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao verificar documentação:', err);
        }
    });

    // 7. Enviar lembretes de aprovações pendentes (todos os dias às 10h)
    cron.schedule('0 10 * * *', async () => {
        if (!DB_AVAILABLE) return;
        try {
            logger.info('[COMPRAS-CRON] Verificando aprovações pendentes...');

            const [aprovacoesAtrasadas] = await pool.query(`
                SELECT wa.id, wa.aprovador_id, wa.entidade_tipo, wa.entidade_id,
                       u.email as aprovador_email,
                       pc.numero_pedido, pc.valor_total,
                       DATEDIFF(CURDATE(), wa.data_solicitacao) as dias_pendente
                FROM workflow_aprovacoes wa
                JOIN usuarios u ON wa.aprovador_id = u.id
                LEFT JOIN pedidos_compra pc ON wa.entidade_id = pc.id AND wa.entidade_tipo = 'pedido_compra'
                WHERE wa.status = 'pendente'
                  AND wa.lembrete_enviado = FALSE
                  AND DATEDIFF(CURDATE(), wa.data_solicitacao) >= 2
            `);

            for (const aprovacao of aprovacoesAtrasadas) {
                // Enviar email de lembrete
                if (aprovacao.aprovador_email && emailTransporter) {
                    await sendEmail(
                        aprovacao.aprovador_email,
                        'Lembrete: Aprovação pendente',
                        `<h2>Aprovação Pendente</h2>
                        <p>Você tem uma aprovação pendente há <strong>${aprovacao.dias_pendente} dias</strong>.</p>
                        <p><strong>Pedido:</strong> ${aprovacao.numero_pedido}</p>
                        <p><strong>Valor:</strong> R$ ${aprovacao.valor_total}</p>
                        <p>Por favor, acesse o sistema e faça a aprovação.</p>`
                    );
                }

                // Marcar lembrete como enviado
                await pool.execute(
                    'UPDATE workflow_aprovacoes SET lembrete_enviado = TRUE, data_lembrete = NOW() WHERE id = ?',
                    [aprovacao.id]
                );
            }

            logger.info(`[COMPRAS-CRON] ✅ Enviados ${aprovacoesAtrasadas.length} lembretes de aprovação`);
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao enviar lembretes:', err);
        }
    });

    // 8. Atualizar avaliações médias dos fornecedores (todos os domingos às 3h)
    cron.schedule('0 3 * * 0', async () => {
        if (!DB_AVAILABLE) return;
        try {
            logger.info('[COMPRAS-CRON] Atualizando avaliações de fornecedores...');

            await pool.query(`
                UPDATE fornecedores f
                SET
                    nota_qualidade = (SELECT AVG(nota_qualidade) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    nota_prazo = (SELECT AVG(nota_prazo) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    nota_preco = (SELECT AVG(nota_preco) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    nota_atendimento = (SELECT AVG(nota_atendimento) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    avaliacao_geral = (
                        SELECT AVG((nota_qualidade + nota_prazo + nota_preco + nota_atendimento + IFNULL(nota_entrega, 0)) / 5)
                        FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id
                    ),
                    total_pedidos = (SELECT COUNT(*) FROM pedidos_compra WHERE fornecedor_id = f.id AND status != 'cancelado'),
                    total_compras = (SELECT SUM(valor_total) FROM pedidos_compra WHERE fornecedor_id = f.id AND status = 'recebido')
                WHERE id IN (SELECT DISTINCT fornecedor_id FROM fornecedor_avaliacoes)
            `);

            logger.info('[COMPRAS-CRON] ✅ Avaliações de fornecedores atualizadas');
        } catch (err) {
            logger.error('[COMPRAS-CRON] Erro ao atualizar avaliações:', err);
        }
    });

    // =================== CRON JOBS DO ESTOQUE E RESERVAS ===================

    // Job diário: Expirar reservas e alertas de estoque (executa às 3h da manhã)
    cron.schedule('0 3 * * *', async () => {
        try {
            logger.info('[ESTOQUE-CRON] Executando jobs de estoque...');
            const { expirarReservas, alertasEstoqueBaixo } = require('./cron_jobs_estoque');

            await expirarReservas();
            await alertasEstoqueBaixo();

            logger.info('[ESTOQUE-CRON] ✅ Jobs de estoque executados');
        } catch (err) {
            logger.error('[ESTOQUE-CRON] Erro ao executar jobs de estoque:', err);
        }
    });

    // =================== CRON JOB INATIVAÇÃO DE CLIENTES (90 dias sem movimentação) ===================
    // Executa diariamente às 4h da manhã
    cron.schedule('0 4 * * *', async () => {
        try {
            logger.info('[CLIENTES-CRON] Verificando clientes para inativação automática...');

            // Buscar clientes ativos sem movimentação há mais de 90 dias
            const [clientesInativos] = await pool.query(`
                UPDATE empresas
                SET status_cliente = 'inativo',
                    data_inativacao = NOW(),
                    vendedor_id = NULL
                WHERE status_cliente = 'ativo'
                AND (
                    (ultima_movimentacao IS NOT NULL AND ultima_movimentacao < DATE_SUB(NOW(), INTERVAL 90 DAY))
                    OR
                    (ultima_movimentacao IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 90 DAY))
                )
            `);

            if (clientesInativos.affectedRows > 0) {
                logger.info(`[CLIENTES-CRON] ✅ ${clientesInativos.affectedRows} clientes inativados por falta de movimentação`);
            } else {
                logger.info('[CLIENTES-CRON] ✅ Nenhum cliente para inativar');
            }
        } catch (err) {
            logger.error('[CLIENTES-CRON] Erro ao inativar clientes:', err);
        }
    });

    logger.info('✅ Todos os cron jobs configurados (incluindo Compras e Estoque)');
};

// =================================================================
// 4. MIDDLEWARES DE AUTENTICAÇÁO E AUTORIZAÇÁO
// =================================================================

// Middleware para verificar o token JWT
const authenticateToken = (req, res, next) => {
    // Busca token em múltiplas fontes: Authorization header, cookie ou query string
    const authHeader = req.headers['authorization'];
    let token = null;

    // Extrair token do header Authorization (ignorar se for "null" ou "undefined")
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const headerToken = authHeader.split(' ')[1];
        if (headerToken && headerToken !== 'null' && headerToken !== 'undefined') {
            token = headerToken;
        }
    }

    // Se não encontrou no header, tentar cookies
    if (!token) {
        token = req.cookies?.authToken || req.cookies?.token;
    }

    // SECURITY: Não aceitar token via query string (expõe em logs/histórico)
    // Tokens devem vir apenas via header Authorization ou cookies httpOnly

    if (!token) {
        return res.status(401).json({ message: 'Token de autenticação não fornecido.' });
    }

    // AUDIT-FIX ARCH-004: Enforce HS256 algorithm (audience enforced in sign, verify-side after token rotation)
    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
        if (err) {
            logger.warn('[AUTH] Token inválido: ' + err.message);
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Token expirado. Faça login novamente.' });
            }
            return res.status(403).json({ message: 'Token inválido. Faça login novamente.' });
        }
        req.user = user;
        next();
    });
};

// Middleware para autorizar admin ou comercial para Vendas/CRM
const authorizeAdminOrComercial = (req, res, next) => {
    if (req.user?.role === 'admin' || req.user?.role === 'comercial') {
        return next();
    }
    return res.status(403).json({ message: 'Acesso negado. Requer privilégios de administrador ou comercial.' });
};

// ACL: Controle de acesso detalhado por nível de usuário (Exemplo para Financeiro)
function authorizeACL(permission) {
    return (req, res, next) => {
        if (req.user?.permissions?.includes(permission) || req.user?.role === 'admin') {
            return next();
        }
        return res.status(403).json({ message: 'Acesso negado. Permissão insuficiente.' });
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
    cacheMiddleware,
    CACHE_CONFIG,
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

// Endpoint de status/health (deve ficar ANTES do 404 e error handlers)
app.get('/status', async (req, res) => {
    const info = {
        status: 'ok',
        uptime_seconds: Math.floor(process.uptime()),
        dbAvailable: !!DB_AVAILABLE,
        timestamp: new Date().toISOString()
    };

    if (DB_AVAILABLE) {
        try {
            await pool.query('SELECT 1');
            info.dbPing = true;
        } catch (err) {
            info.dbPing = false;
            // Security: don't leak full error details in production
            if (process.env.NODE_ENV === 'development') {
                info.dbError = String(err && err.message ? err.message : err).slice(0, 200);
            }
        }
    }

    res.setHeader('X-DB-Available', DB_AVAILABLE ? '1' : '0');
    return res.json(info);
});

// 7. TRATAMENTO DE ERROS E INICIALIZAÇÁO DO SERVIDOR
// =================================================================

// 404 handler — rota não encontrada (deve vir antes do error handler)
app.use((req, res, next) => {
    // API routes return JSON
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Rota não encontrada', path: req.path });
    }
    // All others: generic 404
    res.status(404).send('<!DOCTYPE html><html><head><title>404</title></head><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>404</h1><p>Página não encontrada</p><a href="/">Voltar ao início</a></body></html>');
});

// Middleware para tratamento de erros (deve ser o último middleware)
app.use((err, req, res, next) => {
    // Log detalhado do erro com rota e método
    console.error(`❌ ERRO NO SERVIDOR [${req.method} ${req.path}]:`, err.message || err);
    if (err.stack) console.error('Stack:', err.stack);

    if (!res.headersSent) {
        // Erros de CORS: retornar 403 com mensagem clara
        if (err.message && err.message.includes('CORS')) {
            return res.status(403).json({
                message: 'Origem não autorizada (CORS).',
                error: process.env.NODE_ENV === 'development' ? err.message : {}
            });
        }
        res.status(500).json({
            message: 'Ocorreu um erro inesperado no servidor.',
            error: process.env.NODE_ENV === 'development' ? err.message : {}
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
                await pool.query('SELECT 1');
                console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
                console.log(`⚡ Conexão DB em ${Date.now() - startupTime}ms`);

                // ⚡ OTIMIZAÇÃO: Pular migrações se SKIP_MIGRATIONS=1
                if (SKIP_MIGRATIONS) {
                    console.log('⚡ SKIP_MIGRATIONS ativo - pulando verificações de schema');
                    console.log('💡 Use "npm run db:migrate" para executar migrações quando necessário\n');
                } else {
                    console.log('🔄 Executando verificações de schema...');
                    console.log('💡 Defina SKIP_MIGRATIONS=1 no .env para inicialização mais rápida\n');

                // Tentar criar apenas tabela nfe se não existir (crítica para módulo NFe)
                try {
                    await pool.query(`CREATE TABLE IF NOT EXISTS nfe (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        numero VARCHAR(20) UNIQUE NOT NULL,
                        cliente_id INT NOT NULL,
                        cliente_nome VARCHAR(100),
                        descricao_servico TEXT NOT NULL,
                        valor DECIMAL(10,2) NOT NULL,
                        iss DECIMAL(10,2) DEFAULT 0,
                        pis DECIMAL(10,2) DEFAULT 0,
                        cofins DECIMAL(10,2) DEFAULT 0,
                        irrf DECIMAL(10,2) DEFAULT 0,
                        csll DECIMAL(10,2) DEFAULT 0,
                        status ENUM('pendente', 'autorizada', 'cancelada', 'rejeitada') DEFAULT 'pendente',
                        data_emissao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        observacoes TEXT,
                        email_enviado BOOLEAN DEFAULT FALSE,
                        data_envio_email TIMESTAMP NULL,
                        usuario_id INT,
                        xml_arquivo LONGTEXT,
                        FOREIGN KEY (usuario_id) REFERENCES funcionarios(id) ON DELETE SET NULL
                    )`);

                    // Garantir que as colunas de impostos existem (para tabelas antigas)
                    try {
                        await pool.query(`ALTER TABLE nfe ADD COLUMN iss DECIMAL(10,2) DEFAULT 0`);
                        console.log('✅ Coluna iss adicionada a nfe');
                    } catch (e) {
                        // Coluna já existe - silencioso
                    }

                    try {
                        await pool.query(`ALTER TABLE nfe ADD COLUMN pis DECIMAL(10,2) DEFAULT 0`);
                        console.log('✅ Coluna pis adicionada a nfe');
                    } catch (e) {
                        // Coluna já existe - silencioso
                    }

                    try {
                        await pool.query(`ALTER TABLE nfe ADD COLUMN cofins DECIMAL(10,2) DEFAULT 0`);
                        console.log('✅ Coluna cofins adicionada a nfe');
                    } catch (e) {
                        // Coluna já existe - silencioso
                    }

                    try {
                        await pool.query(`ALTER TABLE nfe ADD COLUMN irrf DECIMAL(10,2) DEFAULT 0`);
                        console.log('✅ Coluna irrf adicionada a nfe');
                    } catch (e) {
                        // Coluna já existe - silencioso
                    }

                    try {
                        await pool.query(`ALTER TABLE nfe ADD COLUMN csll DECIMAL(10,2) DEFAULT 0`);
                        console.log('✅ Coluna csll adicionada a nfe');
                    } catch (e) {
                        console.log('⚠️ Coluna csll já existe em nfe');
                    }

                    console.log('✅ Tabela nfe verificada/criada.');
                } catch (e) {
                    console.warn('⚠️ Falha ao criar/verificar tabela nfe:', e.message || e);
                }

                try {
                    await pool.query(`CREATE TABLE IF NOT EXISTS clientes (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        nome VARCHAR(100) NOT NULL,
                        cnpj VARCHAR(18) UNIQUE,
                        cpf VARCHAR(14) UNIQUE,
                        email VARCHAR(100),
                        telefone VARCHAR(20),
                        endereco TEXT,
                        inscricao_municipal VARCHAR(20),
                        ativo BOOLEAN DEFAULT TRUE,
                        data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )`);

                    // Garantir que as colunas existem (para tabelas antigas)
                    try {
                        await pool.query(`ALTER TABLE clientes ADD COLUMN cnpj VARCHAR(18) UNIQUE`);
                        console.log('✅ Coluna cnpj adicionada a clientes');
                    } catch (e) {
                        // Coluna já existe
                        console.log('⚠️ Coluna cnpj já existe em clientes');
                    }

                    try {
                        await pool.query(`ALTER TABLE clientes ADD COLUMN cpf VARCHAR(14) UNIQUE`);
                        console.log('✅ Coluna cpf adicionada a clientes');
                    } catch (e) {
                        // Coluna já existe
                        console.log('⚠️ Coluna cpf já existe em clientes');
                    }

                    console.log('✅ Tabela clientes verificada/criada.');
                } catch (e) {
                    console.warn('⚠️ Falha ao criar/verificar tabela clientes:', e.message || e);
                }

                // Adicionar colunas de permissões de módulos na tabela usuarios
                const permissionColumns = ['permissoes_rh', 'permissoes_vendas', 'permissoes_compras', 'permissoes_financeiro', 'permissoes_nfe'];
                for (const col of permissionColumns) {
                    try {
                        await pool.query(`ALTER TABLE usuarios ADD COLUMN ${col} JSON DEFAULT NULL`);
                        console.log(`✅ Coluna ${col} adicionada com sucesso`);
                    } catch (e) {
                        if (e.code === 'ER_DUP_FIELDNAME') {
                            // Coluna já existe, tudo bem
                        } else {
                            console.warn(`⚠️ Erro ao adicionar coluna ${col}:`, e.message);
                        }
                    }
                }

                // Verifica se existe funcionário id=6, se não existir cria um exemplo
                try {
                    const [rows] = await pool.query('SELECT COUNT(*) as count FROM funcionarios WHERE id = 6');
                    if (rows[0].count === 0) {
                        // Inserir funcionário exemplo com senha e cpf obrigatórios usando INSERT IGNORE para evitar duplicação
                        await pool.query(`INSERT IGNORE INTO funcionarios (id, nome_completo, email, senha, departamento, cargo, data_nascimento, cpf) VALUES (6, 'Funcionário Exemplo', 'exemplo@aluforce.ind.br', 'aluvendas01', 'comercial', 'vendedor', '1990-01-01', '00000000000')`);
                        console.log('✅ Funcionário id=6 criado automaticamente.');

                        // Inserir usuário admin para testes
                        const bcryptAdmin = require('bcryptjs');
                        const adminHash = await bcryptAdmin.hash('admin123', 10);
                        await pool.query(`INSERT IGNORE INTO funcionarios (id, nome_completo, email, senha, senha_hash, departamento, cargo, data_nascimento, cpf, role, is_admin) VALUES (1, 'Administrador', 'admin@aluforce.com', 'admin123', ?, 'ti', 'administrador', '1985-01-01', '11111111111', 'admin', 1)`, [adminHash]);
                        console.log('✅ Usuário admin criado automaticamente.');

                        // Inserir usuários de teste adicionais
                        const testHash = await bcryptAdmin.hash('123456', 10);
                        await pool.query(`INSERT IGNORE INTO funcionarios (id, nome_completo, email, senha, senha_hash, departamento, cargo, data_nascimento, cpf, role, is_admin) VALUES (2, 'Thiago Scarcella', 'thiago@aluforce.com', '123456', ?, 'gestao', 'gerente', '1990-05-15', '22222222222', 'user', 0)`, [testHash]);
                        await pool.query(`INSERT IGNORE INTO funcionarios (id, nome_completo, email, senha, senha_hash, departamento, cargo, data_nascimento, cpf, role, is_admin) VALUES (3, 'Guilherme Silva', 'guilherme@aluforce.com', '123456', ?, 'pcp', 'analista', '1992-08-20', '33333333333', 'user', 0)`, [testHash]);
                        console.log('✅ Usuários de teste criados automaticamente.');
                    } else {
                        console.log('✅ Funcionário id=6 já existe (verificado).');
                    }
                } catch (e) {
                    // Tenta criar com INSERT IGNORE como fallback
                    try {
                        await pool.query(`INSERT IGNORE INTO funcionarios (id, nome_completo, email, senha, departamento, cargo, data_nascimento, cpf) VALUES (6, 'Funcionário Exemplo', 'exemplo@aluforce.ind.br', 'aluvendas01', 'comercial', 'vendedor', '1990-01-01', '00000000000')`);
                        console.log('✅ Funcionário id=6 criado com INSERT IGNORE.');
                    } catch (e2) {
                        console.warn('⚠️ Falha ao verificar/inserir funcionário id=6:', e2.message || e2);
                    }
                }

                // ============================================================
                // MIGRAÇÃO: Adicionar colunas necessárias para o módulo PCP
                // ============================================================
                console.log('\n🔄 Verificando estrutura da tabela produtos...');

                const produtosColumns = [
                    { name: 'categoria', sql: "ALTER TABLE produtos ADD COLUMN categoria VARCHAR(100) DEFAULT 'GERAL' AFTER descricao" },
                    { name: 'gtin', sql: "ALTER TABLE produtos ADD COLUMN gtin VARCHAR(20) DEFAULT NULL AFTER categoria" },
                    { name: 'ncm', sql: "ALTER TABLE produtos ADD COLUMN ncm VARCHAR(20) DEFAULT NULL AFTER sku" },
                    { name: 'estoque_atual', sql: "ALTER TABLE produtos ADD COLUMN estoque_atual DECIMAL(10,2) DEFAULT 0 AFTER ncm" },
                    { name: 'estoque_minimo', sql: "ALTER TABLE produtos ADD COLUMN estoque_minimo DECIMAL(10,2) DEFAULT 0 AFTER estoque_atual" },
                    { name: 'preco_custo', sql: "ALTER TABLE produtos ADD COLUMN preco_custo DECIMAL(10,2) DEFAULT 0 AFTER estoque_minimo" },
                    { name: 'preco_venda', sql: "ALTER TABLE produtos ADD COLUMN preco_venda DECIMAL(10,2) DEFAULT 0 AFTER preco_custo" },
                    { name: 'unidade_medida', sql: "ALTER TABLE produtos ADD COLUMN unidade_medida VARCHAR(10) DEFAULT 'UN' AFTER preco_venda" },
                    { name: 'embalagem', sql: "ALTER TABLE produtos ADD COLUMN embalagem VARCHAR(50) DEFAULT NULL AFTER unidade_medida" },
                    { name: 'imagem_url', sql: "ALTER TABLE produtos ADD COLUMN imagem_url VARCHAR(255) DEFAULT NULL AFTER embalagem" },
                    { name: 'status', sql: "ALTER TABLE produtos ADD COLUMN status VARCHAR(20) DEFAULT 'ativo' AFTER imagem_url" },
                    { name: 'data_criacao', sql: "ALTER TABLE produtos ADD COLUMN data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER status" }
                ];

                for (const column of produtosColumns) {
                    try {
                        await pool.query(column.sql);
                        console.log(`✅ Coluna '${column.name}' adicionada à tabela produtos`);
                    } catch (e) {
                        if (e.code === 'ER_DUP_FIELDNAME') {
                            // Coluna já existe, tudo bem
                        } else {
                            console.warn(`⚠️ Erro ao adicionar coluna '${column.name}':`, e.message);
                        }
                    }
                }

                // Atualizar produtos existentes com valores padrão
                try {
                    await pool.query("UPDATE produtos SET categoria = 'GERAL' WHERE categoria IS NULL OR categoria = ''");
                    await pool.query("UPDATE produtos SET unidade_medida = 'UN' WHERE unidade_medida IS NULL OR unidade_medida = ''");
                    await pool.query("UPDATE produtos SET status = 'ativo' WHERE status IS NULL OR status = ''");
                    console.log('✅ Valores padrão aplicados aos produtos existentes');
                } catch (e) {
                    console.warn('⚠️ Erro ao atualizar valores padrão:', e.message);
                }

                // Criar índices para melhor performance
                const produtosIndexes = [
                    { name: 'idx_produtos_categoria', sql: 'CREATE INDEX idx_produtos_categoria ON produtos(categoria)' },
                    { name: 'idx_produtos_gtin', sql: 'CREATE INDEX idx_produtos_gtin ON produtos(gtin)' },
                    { name: 'idx_produtos_sku', sql: 'CREATE INDEX idx_produtos_sku ON produtos(sku)' },
                    { name: 'idx_produtos_ncm', sql: 'CREATE INDEX idx_produtos_ncm ON produtos(ncm)' },
                    { name: 'idx_produtos_status', sql: 'CREATE INDEX idx_produtos_status ON produtos(status)' },
                    { name: 'idx_produtos_estoque', sql: 'CREATE INDEX idx_produtos_estoque ON produtos(estoque_atual)' }
                ];

                for (const index of produtosIndexes) {
                    try {
                        await pool.query(index.sql);
                        console.log(`✅ Índice '${index.name}' criado`);
                    } catch (e) {
                        if (e.code === 'ER_DUP_KEYNAME') {
                            // Índice já existe, tudo bem
                        } else {
                            console.warn(`⚠️ Erro ao criar índice '${index.name}':`, e.message);
                        }
                    }
                }

                // Adicionar coluna ativo à tabela clientes se não existir
                try {
                    await pool.query("ALTER TABLE clientes ADD COLUMN ativo TINYINT(1) DEFAULT 1");
                    console.log('✅ Coluna ativo adicionada à tabela clientes');
                } catch (e) {
                    if (e.code === 'ER_DUP_FIELDNAME') {
                        // Coluna já existe, tudo bem
                    } else {
                        console.warn('⚠️ Erro ao adicionar coluna ativo:', e.message);
                    }
                }

                console.log('✅ Migração da tabela produtos concluída!\n');

                // ============================================================
                // MIGRAÇÃO: Criar tabela de reset de senha
                // ============================================================
                console.log('🔄 Verificando tabela password_reset_tokens...');

                try {
                    await pool.query(`
                        CREATE TABLE IF NOT EXISTS password_reset_tokens (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            email VARCHAR(255) NOT NULL,
                            token VARCHAR(255) NOT NULL UNIQUE,
                            expira_em DATETIME NOT NULL,
                            usado TINYINT(1) DEFAULT 0,
                            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            INDEX idx_token (token),
                            INDEX idx_email (email),
                            INDEX idx_expira_em (expira_em)
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    `);
                    console.log('✅ Tabela password_reset_tokens verificada/criada');
                } catch (e) {
                    console.warn('⚠️ Erro ao criar tabela password_reset_tokens:', e.message);
                }

                // ========== MIGRAÇÃO: INTEGRAÇÃO COMPRAS-PCP ==========
                console.log('\n🔄 Verificando integração Compras-PCP...');

                try {
                    // Adicionar campos em pedidos_compras
                    await pool.query(`
                        ALTER TABLE pedidos_compras
                        ADD COLUMN IF NOT EXISTS origem ENUM('manual', 'pcp', 'estoque_minimo') DEFAULT 'manual' AFTER usuario_id
                    `);
                    console.log('✅ Campo origem adicionado em pedidos_compras');
                } catch (e) {
                    if (!e.message.includes('Duplicate column')) {
                        console.warn('⚠️ Coluna origem já existe em pedidos_compras');
                    }
                }

                try {
                    await pool.query(`
                        ALTER TABLE pedidos_compras
                        ADD COLUMN IF NOT EXISTS origem_id INT NULL COMMENT 'ID da ordem de produção ou outro registro de origem' AFTER origem
                    `);
                    console.log('✅ Campo origem_id adicionado em pedidos_compras');
                } catch (e) {
                    if (!e.message.includes('Duplicate column')) {
                        console.warn('⚠️ Coluna origem_id já existe em pedidos_compras');
                    }
                }

                try {
                    await pool.query(`
                        ALTER TABLE pedidos_compras
                        ADD COLUMN IF NOT EXISTS prioridade ENUM('baixa', 'media', 'alta', 'urgente') DEFAULT 'media' AFTER origem_id
                    `);
                    console.log('✅ Campo prioridade adicionado em pedidos_compras');
                } catch (e) {
                    if (!e.message.includes('Duplicate column')) {
                        console.warn('⚠️ Coluna prioridade já existe em pedidos_compras');
                    }
                }

                try {
                    // Adicionar campo em itens_pedido_compras
                    await pool.query(`
                        ALTER TABLE itens_pedido_compras
                        ADD COLUMN IF NOT EXISTS produto_id INT NULL COMMENT 'Referência ao produtos (materiais PCP)' AFTER pedido_id
                    `);
                    console.log('✅ Campo produto_id adicionado em itens_pedido_compras');
                } catch (e) {
                    if (!e.message.includes('Duplicate column')) {
                        console.warn('⚠️ Coluna produto_id já existe em itens_pedido_compras');
                    }
                }

                try {
                    // Adicionar campos em ordens_producao
                    await pool.query(`
                        ALTER TABLE ordens_producao
                        ADD COLUMN IF NOT EXISTS pedidos_compra_vinculados JSON NULL COMMENT 'Array de IDs de pedidos de compra relacionados' AFTER arquivo_xlsx
                    `);
                    console.log('✅ Campo pedidos_compra_vinculados adicionado em ordens_producao');
                } catch (e) {
                    if (!e.message.includes('Duplicate column')) {
                        console.warn('⚠️ Coluna pedidos_compra_vinculados já existe');
                    }
                }

                try {
                    await pool.query(`
                        ALTER TABLE ordens_producao
                        ADD COLUMN IF NOT EXISTS materiais_pendentes JSON NULL COMMENT 'Materiais aguardando compra' AFTER pedidos_compra_vinculados
                    `);
                    console.log('✅ Campo materiais_pendentes adicionado em ordens_producao');
                } catch (e) {
                    if (!e.message.includes('Duplicate column')) {
                        console.warn('⚠️ Coluna materiais_pendentes já existe');
                    }
                }

                try {
                    // Criar tabela de notificações de estoque
                    await pool.query(`
                        CREATE TABLE IF NOT EXISTS notificacoes_estoque (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            produto_id INT NOT NULL,
                            tipo ENUM('estoque_baixo', 'estoque_critico', 'estoque_zero') NOT NULL,
                            quantidade_atual DECIMAL(10,2) NOT NULL,
                            quantidade_minima DECIMAL(10,2) NOT NULL,
                            ordem_producao_id INT NULL COMMENT 'Ordem que gerou a necessidade',
                            pedido_compra_id INT NULL COMMENT 'Pedido de compra gerado',
                            status ENUM('pendente', 'em_compra', 'resolvido', 'ignorado') DEFAULT 'pendente',
                            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            resolvido_em TIMESTAMP NULL,
                            resolvido_por INT NULL,
                            observacoes TEXT,
                            FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
                            FOREIGN KEY (ordem_producao_id) REFERENCES ordens_producao(id) ON DELETE SET NULL,
                            FOREIGN KEY (pedido_compra_id) REFERENCES pedidos_compras(id) ON DELETE SET NULL,
                            FOREIGN KEY (resolvido_por) REFERENCES funcionarios(id) ON DELETE SET NULL,
                            INDEX idx_status_tipo (status, tipo),
                            INDEX idx_produto_status (produto_id, status)
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    `);
                    console.log('✅ Tabela notificacoes_estoque verificada/criada');
                } catch (e) {
                    console.warn('⚠️ Erro ao criar tabela notificacoes_estoque:', e.message);
                }

                // Criar tabela de notificações gerais do sistema
                try {
                    await pool.query(`
                        CREATE TABLE IF NOT EXISTS notificacoes (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            usuario_id INT NULL COMMENT 'NULL = broadcast para todos',
                            titulo VARCHAR(255) NOT NULL DEFAULT '',
                            mensagem TEXT NOT NULL,
                            tipo VARCHAR(50) DEFAULT 'info',
                            modulo VARCHAR(50) DEFAULT 'sistema',
                            link VARCHAR(500) NULL,
                            prioridade INT DEFAULT 3 COMMENT '1=alta, 2=média, 3=normal',
                            entidade_tipo VARCHAR(50) NULL COMMENT 'pedido, ordem, conta, etc',
                            entidade_id INT NULL,
                            lida TINYINT(1) DEFAULT 0,
                            lida_em TIMESTAMP NULL,
                            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            INDEX idx_usuario_lida (usuario_id, lida),
                            INDEX idx_modulo (modulo)
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    `);
                    // Migrar tabela existente: adicionar colunas faltantes
                    const colunasNotif = [
                        { nome: 'titulo', def: "VARCHAR(255) NOT NULL DEFAULT '' AFTER usuario_id" },
                        { nome: 'modulo', def: "VARCHAR(50) DEFAULT 'sistema' AFTER tipo" },
                        { nome: 'link', def: "VARCHAR(500) NULL AFTER modulo" },
                        { nome: 'prioridade', def: "INT DEFAULT 3 AFTER link" },
                        { nome: 'entidade_tipo', def: "VARCHAR(50) NULL AFTER prioridade" },
                        { nome: 'entidade_id', def: "INT NULL AFTER entidade_tipo" },
                        { nome: 'lida_em', def: "TIMESTAMP NULL AFTER lida" },
                        { nome: 'created_at', def: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER lida_em" }
                    ];
                    for (const col of colunasNotif) {
                        try {
                            const [exists] = await pool.query(`SHOW COLUMNS FROM notificacoes LIKE '${col.nome}'`);
                            if (exists.length === 0) {
                                await pool.query(`ALTER TABLE notificacoes ADD COLUMN ${col.nome} ${col.def}`);
                                console.log(`  ✅ Coluna notificacoes.${col.nome} adicionada`);
                            }
                        } catch(ce) { /* coluna já existe ou outro erro */ }
                    }
                    // Se tem criado_em mas não created_at preenchido, copiar valores
                    try {
                        await pool.query(`UPDATE notificacoes SET created_at = criado_em WHERE created_at IS NULL AND criado_em IS NOT NULL`);
                    } catch(ce) { /* ignore */ }
                    console.log('✅ Tabela notificacoes verificada/criada');
                } catch (e) {
                    console.warn('⚠️ Erro ao criar tabela notificacoes:', e.message);
                }

                try {
                    // Criar view de materiais críticos (versão simplificada sem produto_id)
                    await pool.query(`
                        CREATE OR REPLACE VIEW vw_materiais_criticos AS
                        SELECT
                            p.id,
                            p.codigo,
                            p.descricao,
                            p.estoque_atual,
                            p.estoque_minimo,
                            (p.estoque_minimo - p.estoque_atual) as deficit,
                            CASE
                                WHEN p.estoque_atual = 0 THEN 'zero'
                                WHEN p.estoque_atual < (p.estoque_minimo * 0.5) THEN 'critico'
                                WHEN p.estoque_atual < p.estoque_minimo THEN 'baixo'
                                ELSE 'normal'
                            END as nivel_criticidade,
                            (SELECT COUNT(*) FROM notificacoes_estoque WHERE produto_id = p.id AND status = 'pendente') as notificacoes_pendentes
                        FROM produtos p
                        WHERE p.estoque_atual < p.estoque_minimo
                        ORDER BY
                            CASE
                                WHEN p.estoque_atual = 0 THEN 1
                                WHEN p.estoque_atual < (p.estoque_minimo * 0.5) THEN 2
                                WHEN p.estoque_atual < p.estoque_minimo THEN 3
                                ELSE 4
                            END,
                            p.estoque_atual ASC
                    `);
                    console.log('✅ View vw_materiais_criticos criada/atualizada');
                } catch (e) {
                    console.warn('⚠️ Erro ao criar view vw_materiais_criticos:', e.message);
                }

                console.log('✅ Migração Compras-PCP concluída!\n');

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

                // Configurar Socket.io (SECURITY FIX: CORS restrito a origens autorizadas)
                const io = new Server(httpServer, {
                    cors: {
                        origin: function(origin, callback) {
                            // AUDIT-FIX: No-origin only in dev; prod requires valid origin
                            if (!origin) {
                                if (process.env.NODE_ENV === 'development') return callback(null, true);
                                return callback(null, false);
                            }
                            if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
                                callback(null, true);
                            } else {
                                console.warn(`⚠️ Socket.IO CORS bloqueado: ${origin}`);
                                callback(new Error('Origem não permitida'));
                            }
                        },
                        credentials: true,
                        methods: ['GET', 'POST']
                    }
                });

                // 🔄 ENTERPRISE: Socket.IO Redis Adapter — multi-node horizontal scaling
                // When REDIS_URL is set, all Socket.IO instances share events via Redis pub/sub
                try {
                    const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST;
                    if (redisUrl) {
                        const { createAdapter } = require('@socket.io/redis-adapter');
                        const { createClient } = require('redis');
                        const pubClient = createClient({ url: redisUrl.startsWith('redis://') ? redisUrl : `redis://${redisUrl}` });
                        const subClient = pubClient.duplicate();
                        Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
                            io.adapter(createAdapter(pubClient, subClient));
                            console.log('🔄 Socket.IO Redis Adapter: multi-node broadcasting ativo');
                        }).catch(e => {
                            console.warn('⚠️  Socket.IO Redis Adapter connection failed (fallback: single-node):', e.message);
                        });
                    }
                } catch (adapterErr) {
                    console.warn('⚠️  Socket.IO Redis Adapter indisponível (fallback: single-node):', adapterErr.message);
                }

                // Disponibilizar io globalmente para uso nas APIs
                global.io = io;

// ============================================================
// CHAT BOB AI - Socket.IO Handler
// ============================================================
try {
    const { setupChatSocket } = require('./chat/chat-handler');
    setupChatSocket(io, pool);
    console.log('💬 Chat BOB AI: Handler Socket.IO inicializado');
} catch (chatErr) {
    console.error('⚠️  Erro ao carregar Chat handler:', chatErr.message);
}


                // Socket.io - Conexões em tempo real
                io.on('connection', (socket) => {
                    console.log('🔌 Cliente Socket.io conectado:', socket.id);

                    // Evento de desconexão
                    socket.on('disconnect', () => {
                        console.log('🔌 Cliente Socket.io desconectado:', socket.id);
                    });

                    // Eventos customizados podem ser adicionados aqui
                    socket.on('chat-message', (msg) => {
                        io.emit('chat-message', msg);
                    });

                    socket.on('notification', (data) => {
                        io.emit('notification', data);
                    });

                    // Eventos do Chat Bob AI com transferência para humanos
                    socket.on('transfer-to-human', (data) => {
                        console.log('🤝 Transferência para atendente humano:', data);
                        // Notifica agentes disponíveis sobre nova transferência
                        socket.broadcast.to('support-agents').emit('new-chat-transfer', {
                            userId: data.userId,
                            conversationHistory: data.conversationHistory,
                            timestamp: new Date().toISOString()
                        });
                        // Confirma transferência para o cliente
                        socket.emit('transfer-confirmed', {
                            message: 'Um atendente será conectado em breve'
                        });
                    });

                    socket.on('user-message', (data) => {
                        console.log('💬 Mensagem do usuário:', data);
                        // Roteia mensagem para o agente atribuído
                        socket.broadcast.to('support-agents').emit('user-message-received', {
                            userId: data.userId,
                            userName: data.userName,
                            message: data.message,
                            timestamp: new Date().toISOString()
                        });
                    });

                    // Eventos para agentes humanos
                    socket.on('join-support-team', (agentData) => {
                        socket.join('support-agents');
                        console.log('👤 Agente entrou na equipe de suporte:', agentData);
                        socket.emit('agent-connected', { status: 'online' });
                    });

                    socket.on('agent-typing', (data) => {
                        // Envia indicador de digitação para o usuário específico
                        io.emit('agent-typing', { userId: data.userId, isTyping: data.isTyping });
                    });

                    socket.on('agent-message', (data) => {
                        console.log('📨 Mensagem do agente:', data);
                        // Envia mensagem do agente para o usuário específico
                        io.emit('agent-message', {
                            agentName: data.agentName,
                            message: data.message,
                            timestamp: new Date().toISOString()
                        });
                    });

                    // Eventos específicos para gestão de estoque
                    socket.on('join-stock-room', (data) => {
                        socket.join('stock-management');
                        console.log(`👤 Cliente ${socket.id} entrou na sala de gestão de estoque`);
                    });

                    socket.on('leave-stock-room', (data) => {
                        socket.leave('stock-management');
                        console.log(`👤 Cliente ${socket.id} saiu da sala de gestão de estoque`);
                    });

                    // Evento para solicitar dados atualizados
                    socket.on('request-products-update', () => {
                        socket.emit('products-update-requested');
                        console.log(`🔄 Cliente ${socket.id} solicitou atualização de produtos`);
                    });
                });

                // Tornar io disponível globalmente
                app.set('io', io);

// ============================================================
// ENDPOINT TEMPORÁRIO DE MIGRATION - FINANCEIRO
// ============================================================
app.post('/api/admin/describe-tabelas-financeiro', authenticateToken, async (req, res) => {
    try {
        const [pagar] = await pool.query('DESCRIBE contas_pagar');
        const [receber] = await pool.query('DESCRIBE contas_receber');
        const [bancos] = await pool.query('DESCRIBE contas_bancarias');

        res.json({
            contas_pagar: pagar.map(c => c.Field),
            contas_receber: receber.map(c => c.Field),
            contas_bancarias: bancos.map(c => c.Field)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/migration-financeiro', authenticateToken, async (req, res) => {
    if (req.user?.role !== 'admin' && req.user?.is_admin !== 1) {
        return res.status(403).json({ error: 'Apenas administradores' });
    }

    try {
        const results = [];

        // contas_pagar
        try {
            await pool.query('ALTER TABLE contas_pagar ADD COLUMN valor_pago DECIMAL(15,2) DEFAULT 0');
            results.push('✅ contas_pagar.valor_pago');
        } catch (err) { results.push(`⚠️ contas_pagar.valor_pago: ${err.code === 'ER_DUP_FIELDNAME' ? 'já existe' : err.message}`); }

        try {
            await pool.query('ALTER TABLE contas_pagar ADD COLUMN data_recebimento DATE NULL');
            results.push('✅ contas_pagar.data_recebimento');
        } catch (err) { results.push(`⚠️ contas_pagar.data_recebimento: ${err.code === 'ER_DUP_FIELDNAME' ? 'já existe' : err.message}`); }

        try {
            await pool.query('ALTER TABLE contas_pagar ADD COLUMN observacoes TEXT');
            results.push('✅ contas_pagar.observacoes');
        } catch (err) { results.push(`⚠️ contas_pagar.observacoes: ${err.code === 'ER_DUP_FIELDNAME' ? 'já existe' : err.message}`); }

        // contas_receber
        try {
            await pool.query('ALTER TABLE contas_receber ADD COLUMN valor_recebido DECIMAL(15,2) DEFAULT 0');
            results.push('✅ contas_receber.valor_recebido');
        } catch (err) { results.push(`⚠️ contas_receber.valor_recebido: ${err.code === 'ER_DUP_FIELDNAME' ? 'já existe' : err.message}`); }

        try {
            await pool.query('ALTER TABLE contas_receber ADD COLUMN data_recebimento DATE NULL');
            results.push('✅ contas_receber.data_recebimento');
        } catch (err) { results.push(`⚠️ contas_receber.data_recebimento: ${err.code === 'ER_DUP_FIELDNAME' ? 'já existe' : err.message}`); }

        try {
            await pool.query('ALTER TABLE contas_receber ADD COLUMN observacoes TEXT');
            results.push('✅ contas_receber.observacoes');
        } catch (err) { results.push(`⚠️ contas_receber.observacoes: ${err.code === 'ER_DUP_FIELDNAME' ? 'já existe' : err.message}`); }

        // contas_bancarias
        try {
            await pool.query('ALTER TABLE contas_bancarias ADD COLUMN observacoes TEXT');
            results.push('✅ contas_bancarias.observacoes');
        } catch (err) { results.push(`⚠️ contas_bancarias.observacoes: ${err.code === 'ER_DUP_FIELDNAME' ? 'já existe' : err.message}`); }

        try {
            await pool.query('ALTER TABLE contas_bancarias ADD COLUMN descricao TEXT');
            results.push('✅ contas_bancarias.descricao');
        } catch (err) { results.push(`⚠️ contas_bancarias.descricao: ${err.code === 'ER_DUP_FIELDNAME' ? 'já existe' : err.message}`); }

        res.json({ success: true, results });

    } catch (error) {
        console.error('[MIGRATION] Erro:', error);
        res.status(500).json({ error: error.message });
    }
});

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

                // Inicializar cron jobs após servidor estar online
                if (DB_AVAILABLE) {
                    setImmediate(() => {
                        initCronJobs();
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
    console.error('❌ ERRO NÃO TRATADO:', err?.stack || err?.message || err);
    // Apenas erros FATAIS (OOM, stack overflow) devem derrubar o servidor
    const fatalErrors = ['ERR_IPC_CHANNEL_CLOSED', 'ENOMEM'];
    if (fatalErrors.includes(err?.code)) {
        console.log('🔄 Encerrando processo devido a erro fatal:', err.code);
        process.exit(1);
    }
    console.log('🟡 Continuando execução apesar do erro não tratado (non-fatal)');
});

process.on('unhandledRejection', (reason, promise) => {
    // Log detalhado para diagnóstico
    const reasonStr = reason instanceof Error 
        ? reason.stack || reason.message 
        : (typeof reason === 'object' ? JSON.stringify(reason, null, 2) : String(reason));
    console.error('❌ PROMESSA NÃO TRATADA:', reasonStr);
    console.error('❌ Tipo do reason:', typeof reason, reason?.constructor?.name);
    if (reason instanceof Error) {
        console.error('❌ Stack:', reason.stack);
    }
    // NÃO encerrar processo - apenas logar o erro
    // Unhandled rejections não-críticas não devem derrubar o servidor
    console.log('🟡 Continuando execução apesar da promessa não tratada (non-fatal)');
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
