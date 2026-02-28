// ============================================================================
// ALUFORCE v2.0 - Configurações de Performance e Otimização
// ============================================================================

module.exports = {
    // Cache de consultas frequentes (em milissegundos)
    cache: {
        enabled: true,
        ttl: 300000, // 5 minutos
        checkPeriod: 60000 // Verificar a cada 1 minuto
    },
    
    // Pool de conexões MySQL otimizado
    database: {
        connectionLimit: 20,
        queueLimit: 0,
        waitForConnections: true,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
    },
    
    // Compressão de respostas
    compression: {
        enabled: true,
        level: 6, // 0-9 (6 é um bom balanço)
        threshold: 1024 // Comprimir apenas respostas > 1KB
    },
    
    // Timeout de requisições
    timeout: {
        server: 30000,  // 30 segundos
        query: 15000    // 15 segundos para queries
    },
    
    // Logs
    logging: {
        level: process.env.NODE_ENV === 'production' ? 'error' : 'info',
        maxFiles: 5,
        maxSize: '10m'
    },
    
    // Inicialização
    startup: {
        preloadRoutes: true,      // Pré-carregar rotas
        preloadModels: true,      // Pré-carregar modelos
        warmupDatabase: true,     // Fazer query de warmup
        autoMigrate: true         // Migrar automaticamente
    },
    
    // Performance
    performance: {
        enableCORS: true,
        enableGzip: true,
        enableETag: true,
        enableStaticCache: true,
        staticCacheMaxAge: 86400000 // 24 horas
    }
};
