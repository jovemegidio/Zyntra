// =================================================================
// CONFIGURAÇáO DO BANCO DE DADOS - ALUFORCE v2.0
// Módulo centralizado para conexão MySQL
// =================================================================
'use strict';

const mysql = require('mysql2/promise');
const logger = require('../src/logger');

// Configuração do Banco de Dados (use variáveis de ambiente para testes/produção)
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aluforce_vendas',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONN_LIMIT) || 200,
    queueLimit: parseInt(process.env.DB_QUEUE_LIMIT) || 500,
    // Enterprise: Keep-alive e timeouts otimizados
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 10000,
    maxIdle: 50,
    idleTimeout: 60000,
    timezone: '+00:00',
    multipleStatements: false,
    dateStrings: true,
    charset: 'utf8mb4',
    namedPlaceholders: true
};

// Pool de conexões
let pool = null;
let dbConnected = false;

// Função de teste de conexão com retry
async function testDBConnection(retries = 3, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            await pool.query('SELECT 1');
            console.log('✅ Pool de conexões MySQL criado e testado com sucesso');
            dbConnected = true;
            return true;
        } catch (err) {
            console.warn(`❌ Tentativa ${i + 1}/${retries} falhou: ${err.message}`);
            if (i < retries - 1) {
                console.log(`⏳ Aguardando ${delay/1000}s para nova tentativa...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    console.error('❌ Pool criado mas conexão não estabelecida após todas tentativas');
    console.log('⚠️ Sistema continuará e tentará reconectar automaticamente');
    return false;
}

// Inicializar pool
function initializePool() {
    try {
        pool = mysql.createPool(DB_CONFIG);
        
        // Testar conexão com retry (não bloqueia a inicialização)
        testDBConnection(3, 5000);
        
        console.log(`✅ MySQL pool config -> host=${DB_CONFIG.host} user=${DB_CONFIG.user} port=${DB_CONFIG.port} database=${DB_CONFIG.database}`);
    } catch (err) {
        console.error('❌ Erro ao criar pool MySQL:', err.message);
        pool = null;
    }
    
    return pool;
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

// Getter para o pool
function getPool() {
    if (!pool) {
        initializePool();
    }
    return pool;
}

// Verificar se está conectado
function isConnected() {
    return dbConnected;
}

module.exports = {
    DB_CONFIG,
    initializePool,
    getPool,
    checkDB,
    isConnected,
    testDBConnection
};
