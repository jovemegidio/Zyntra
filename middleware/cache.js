/**
 * CACHE MIDDLEWARE — Extracted from server.js
 * 
 * In-memory cache with TTL, LRU eviction, and middleware factory.
 * 
 * @module middleware/cache
 */

const memoryCache = new Map();

const CACHE_CONFIG = {
    default: 60000,           // 1 minuto
    user_session: 60000,      // 1 minuto — sessão do usuário
    dashboard: 300000,        // 5 minutos — dados do dashboard
    reports: 600000,          // 10 minutos — relatórios
    config: 1800000           // 30 minutos — configurações do sistema
};

/**
 * Express middleware factory for response caching.
 * @param {number} ttl - Time-to-live in milliseconds
 * @returns {Function} Express middleware
 */
function cacheMiddleware(ttl = CACHE_CONFIG.default) {
    return (req, res, next) => {
        // Só cachear GET
        if (req.method !== 'GET') return next();

        const key = `__cache__${req.originalUrl || req.url}`;
        const cached = cacheGet(key);
        if (cached) {
            return res.json(cached);
        }

        // Override res.json para capturar e cachear a resposta
        const originalJson = res.json.bind(res);
        res.json = (data) => {
            cacheSet(key, data, ttl);
            return originalJson(data);
        };
        next();
    };
}

function cacheSet(key, value, ttl = CACHE_CONFIG.default) {
    memoryCache.set(key, {
        value,
        expiresAt: Date.now() + ttl,
        lastAccess: Date.now()
    });
}

function cacheGet(key) {
    const item = memoryCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
        memoryCache.delete(key);
        return null;
    }
    item.lastAccess = Date.now();
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

/**
 * Clear cache entries for a specific JWT token (used on logout).
 * MULTI-DEVICE: Clears cache based on userId AND deviceId.
 */
function cacheClearByToken(token, jwt, JWT_SECRET) {
    if (!token) return;
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        if (decoded && decoded.id) {
            if (decoded.deviceId) {
                const deviceCacheKey = `user_session_${decoded.id}_${decoded.deviceId}`;
                memoryCache.delete(deviceCacheKey);
            }
            const userCacheKey = `user_session_id_${decoded.id}`;
            memoryCache.delete(userCacheKey);
        }
    } catch (e) {
        const oldCacheKey = `user_session_${token.substring(0, 32)}`;
        memoryCache.delete(oldCacheKey);
    }
}

/**
 * Clear ALL sessions for a user (force re-login).
 */
function cacheClearAllUserSessions(userId) {
    if (!userId) return;
    let deleted = 0;
    for (const key of memoryCache.keys()) {
        if (key.startsWith(`user_session_${userId}_`) || key === `user_session_id_${userId}`) {
            memoryCache.delete(key);
            deleted++;
        }
    }
    return deleted;
}

/**
 * Start periodic cache cleanup (every 5 minutes).
 * Removes expired entries and applies LRU eviction if cache > 1000 items.
 */
function startCacheCleanup(logger) {
    return setInterval(() => {
        const now = Date.now();
        let deleted = 0;
        for (const [key, item] of memoryCache.entries()) {
            if (now > item.expiresAt) {
                memoryCache.delete(key);
                deleted++;
            }
        }
        // LRU eviction: if cache > 1000 items, remove least recently accessed
        if (memoryCache.size > 1000) {
            const entries = Array.from(memoryCache.entries())
                .sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0));
            const toDelete = entries.slice(0, Math.floor(entries.length / 3));
            toDelete.forEach(([key]) => memoryCache.delete(key));
            if (logger) logger.warn(`[CACHE] LRU eviction: ${toDelete.length} items removed. Remaining: ${memoryCache.size}`);
        }
    }, 300000);
}

module.exports = {
    memoryCache,
    CACHE_CONFIG,
    cacheMiddleware,
    cacheSet,
    cacheGet,
    cacheDelete,
    cacheClear,
    cacheClearByToken,
    cacheClearAllUserSessions,
    startCacheCleanup
};
