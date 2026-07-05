'use strict';

/**
 * Configuração CORS centralizada — ÚNICA FONTE para todos os módulos.
 * Substitui blocos CORS duplicados em 6+ server.js de módulos.
 *
 * Uso:
 *   const { corsOptions } = require('../../config/cors');
 *   app.use(cors(corsOptions));
 *
 * Criado: Sprint 7 — Consolidação de Arquitetura
 */

const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000',
    'https://zyntraerp.com.br',
    'https://www.zyntraerp.com.br',
    'https://aluforce.api.br',
    'https://www.aluforce.api.br',
    'https://aluforce.ind.br',
    'https://erp.aluforce.ind.br',
    'https://www.aluforce.ind.br',
    'http://YOUR_VPS_IP:3000',
    'http://YOUR_VPS_IP',
    'http://tauri.localhost',
    'https://tauri.localhost',
    'tauri://localhost',
    process.env.CORS_ORIGIN
].filter(Boolean);

const corsOptions = {
    origin: function(origin, callback) {
        // Permitir requests sem origin (same-origin, ferramentas, mobile apps)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            // SECURITY: Bloquear origens não listadas em qualquer ambiente
            // Em dev, logar para facilitar debug mas NÃO permitir
            if (process.env.NODE_ENV === 'development') {
                console.warn(`⚠️ CORS: Origem '${origin}' bloqueada. Adicione ao allowedOrigins se necessário.`);
            }
            callback(new Error('Origem não permitida pelo CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'X-CSRF-Token',
        'X-Idempotency-Key'
    ]
};

module.exports = { corsOptions, allowedOrigins };
