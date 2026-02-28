// =================================================================
// SISTEMA DE CACHE EM MEMÓRIA - ALUFORCE v2.0
// Cache centralizado para performance
// =================================================================
'use strict';

const memoryCache = new Map();

const CACHE_CONFIG = {
    userSession: 300000,   // 5 minutos para sessão de usuário (aumentado)
    dashboardKPIs: 60000,  // 1 minuto para KPIs (aumentado)
    listagens: 300000,     // 5 minutos para listagens (aumentado)
    produtos: 600000,      // 10 minutos para produtos (novo)
    clientes: 600000,      // 10 minutos para clientes (novo)
    default: 120000        // 2 minutos padrão (aumentado)
};

// Funções de cache
function cacheSet(key, value, ttl = CACHE_CONFIG.default) {
    memoryCache.set(key, {
        value,
        expiresAt: Date.now() + ttl
    });
}

function cacheGet(key) {
    const item = memoryCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
        memoryCache.delete(key);
        return null;
    }
    return item.value;
}

function cacheDelete(key) {
    memoryCache.delete(key);
}

function cacheClear(pattern) {
    if (!pattern) {
        memoryCache.clear();
        return;
    }
    for (const key of memoryCache.keys()) {
        if (key.includes(pattern)) {
            memoryCache.delete(key);
        }
    }
}

// Função global para limpar cache por token (usada no logout)
function cacheClearByToken(token) {
    if (!token) return;
    try {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret';
        const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
        if (decoded && decoded.id) {
            cacheDelete(`session:${decoded.id}`);
            console.log('[CACHE] ✅ Cache de sessão removido para userId:', decoded.id);
        }
    } catch (e) {
        console.log('[CACHE] ✅ Cache de sessão removido para token expirado');
    }
}

// Limpeza periódica de cache expirado
function cleanupExpiredCache() {
    const now = Date.now();
    let deleted = 0;
    
    // Se cache muito grande, limpar itens mais antigos
    if (memoryCache.size > 1000) {
        const toDelete = [];
        for (const [key, item] of memoryCache) {
            if (now > item.expiresAt || toDelete.length < memoryCache.size - 500) {
                toDelete.push(key);
            }
        }
        toDelete.forEach(key => memoryCache.delete(key));
        console.log(`✅ Cache muito grande, limpeza forçada: ${toDelete.length} itens removidos`);
        return;
    }
    
    for (const [key, item] of memoryCache) {
        if (now > item.expiresAt) {
            memoryCache.delete(key);
            deleted++;
        }
    }
    console.log(`✅ Cache: ${deleted} itens expirados removidos. Total: ${memoryCache.size}`);
}

// Retornar tamanho do cache
function cacheSize() {
    return memoryCache.size;
}

module.exports = {
    CACHE_CONFIG,
    cacheSet,
    cacheGet,
    cacheDelete,
    cacheClear,
    cacheClearByToken,
    cleanupExpiredCache,
    cacheSize,
    memoryCache
};
