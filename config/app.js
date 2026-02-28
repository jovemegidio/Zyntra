/**
 * APPLICATION CONFIGURATION — Centralized config extracted from server.js
 * 
 * Single source of truth for all app configuration values.
 * All values prefer environment variables with sensible defaults.
 * 
 * @module config/app
 */

const crypto = require('crypto');
const path = require('path');

// ============================================================
// SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// ============================================================
// JWT / AUTH
// ============================================================
// AUDIT-FIX: JWT secret MUST come from env in production.
// Dev uses ephemeral random secret (tokens invalidate on restart — acceptable for dev).
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION
    ? (() => { throw new Error('JWT_SECRET env var is REQUIRED in production'); })()
    : crypto.randomBytes(64).toString('hex'));

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

// ============================================================
// DATABASE
// ============================================================
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'aluforce',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aluforce_db',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_POOL_SIZE) || 50,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    charset: 'utf8mb4',
    timezone: '-03:00',
    connectTimeout: 30000,
    multipleStatements: false  // Security: prevent SQL injection via stacked queries
};

// Vendas module may use a separate database
const VENDAS_DB_CONFIG = {
    ...DB_CONFIG,
    database: process.env.VENDAS_DB_NAME || 'aluforce_vendas'
};

// ============================================================
// EMAIL / SMTP
// ============================================================
const SMTP_CONFIG = {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@aluforce.com.br',
    enabled: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
};

// AUDIT-FIX: Email recipients from env, not hardcoded
const EMAIL_RECIPIENTS = {
    diretoria: process.env.EMAIL_DIRETORIA || '',
    financeiro: process.env.EMAIL_FINANCEIRO || '',
    admin: process.env.EMAIL_ADMIN || ''
};

// ============================================================
// CORS
// ============================================================
const CORS_ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000',
    'https://aluforce.api.br',
    'https://www.aluforce.api.br',
    'https://aluforce.ind.br',
    'https://erp.aluforce.ind.br',
    'https://www.aluforce.ind.br',
    'http://31.97.64.102:3000',
    'http://31.97.64.102',
    process.env.CORS_ORIGIN
].filter(Boolean);

// ============================================================
// SECURITY
// ============================================================
const CSRF_IGNORE_PATHS = [
    '/api/login', '/api/logout', '/api/auth',
    '/api/webhook', '/api/callback',
    '/api/health', '/api/status',
    '/api/sse', '/api/events',
    '/api/mobile'
];

const RATE_LIMIT = {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 min
    max: parseInt(process.env.RATE_LIMIT_MAX) || 1000
};

// ============================================================
// BACKUP
// ============================================================
const BACKUP_CONFIG = {
    dir: process.env.BACKUP_DIR || '/var/backups/aluforce',
    retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30,
    cronSchedule: process.env.BACKUP_CRON || '0 2 * * *' // 2 AM daily
};

// ============================================================
// PATHS
// ============================================================
const PATHS = {
    root: path.resolve(__dirname, '..'),
    public: path.resolve(__dirname, '..', 'public'),
    modules: path.resolve(__dirname, '..', 'modules'),
    uploads: path.resolve(__dirname, '..', 'uploads'),
    logs: path.resolve(__dirname, '..', 'logs'),
    templates: path.resolve(__dirname, '..', 'templates')
};

module.exports = {
    PORT,
    HOST,
    NODE_ENV,
    IS_PRODUCTION,
    JWT_SECRET,
    JWT_EXPIRES_IN,
    JWT_REFRESH_EXPIRES,
    DB_CONFIG,
    VENDAS_DB_CONFIG,
    SMTP_CONFIG,
    EMAIL_RECIPIENTS,
    CORS_ALLOWED_ORIGINS,
    CSRF_IGNORE_PATHS,
    RATE_LIMIT,
    BACKUP_CONFIG,
    PATHS
};
