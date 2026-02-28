/**
 * ALUFORCE v2.0 — Enterprise Cache Service
 * 
 * Abstração de cache que suporta:
 *   - Map local (desenvolvimento / single instance)
 *   - Redis (produção / cluster mode)
 * 
 * Basta definir REDIS_URL no .env para ativar Redis automaticamente.
 * Sem REDIS_URL, usa Map local (compatível com fork mode).
 * 
 * @module services/cache
 */
'use strict';

const CACHE_CONFIG = {
    userSession: 60000,       // 1 min
    dashboardKPIs: 300000,    // 5 min
    dashboardExec: 300000,    // 5 min
    dashboardVendas: 300000,  // 5 min
    dashboardFinan: 300000,   // 5 min
    dashboardPCP: 300000,     // 5 min
    relatorios: 600000,       // 10 min
    configuracoes: 1800000,   // 30 min
    listagens: 120000,        // 2 min
    default: 60000            // 1 min
};

// ── Estratégia: Redis (produção) ou Map (dev) ──────────────
let redis = null;
let useRedis = false;

async function initRedis() {
    const url = process.env.REDIS_URL || process.env.REDIS_HOST;
    if (!url) return false;

    try {
        const { createClient } = require('redis');
        redis = createClient({
            url: url.startsWith('redis://') ? url : `redis://${url}`,
            socket: {
                connectTimeout: 5000,
                reconnectStrategy: (retries) => Math.min(retries * 500, 5000)
            }
        });

        redis.on('error', (err) => {
            console.warn('[CACHE] ⚠️ Redis error:', err.message);
            // Fallback para Map se Redis falhar
            if (useRedis) {
                console.warn('[CACHE] 🔄 Fallback para cache em memória local');
                useRedis = false;
            }
        });

        redis.on('connect', () => {
            console.log('[CACHE] ✅ Redis conectado');
            useRedis = true;
        });

        await redis.connect();
        useRedis = true;
        console.log('[CACHE] 🚀 Redis ativo como cache distribuído');
        return true;
    } catch (err) {
        console.warn('[CACHE] ⚠️ Redis não disponível:', err.message);
        console.log('[CACHE] 📦 Usando cache em memória local (Map)');
        return false;
    }
}

// ── Fallback: Map local com LRU eviction ───────────────────
const localCache = new Map();
const MAX_LOCAL_ENTRIES = 2000;

// ── API Pública ────────────────────────────────────────────

async function cacheSet(key, value, ttlMs = CACHE_CONFIG.default) {
    if (useRedis && redis) {
        try {
            const ttlSec = Math.ceil(ttlMs / 1000);
            await redis.set(key, JSON.stringify(value), { EX: ttlSec });
            return;
        } catch (e) {
            // fallback
        }
    }
    // Map local
    localCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
        accessedAt: Date.now()
    });
    // LRU eviction
    if (localCache.size > MAX_LOCAL_ENTRIES) {
        _evictLRU();
    }
}

async function cacheGet(key) {
    if (useRedis && redis) {
        try {
            const raw = await redis.get(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            // fallback
        }
    }
    // Map local
    const item = localCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
        localCache.delete(key);
        return null;
    }
    item.accessedAt = Date.now(); // LRU touch
    return item.value;
}

async function cacheDelete(key) {
    if (useRedis && redis) {
        try { await redis.del(key); } catch (e) { /* fallback */ }
    }
    localCache.delete(key);
}

async function cacheClear(pattern) {
    if (useRedis && redis) {
        try {
            if (!pattern) {
                await redis.flushDb();
            } else {
                const keys = await redis.keys(`*${pattern}*`);
                if (keys.length > 0) await redis.del(keys);
            }
        } catch (e) { /* fallback */ }
    }
    if (!pattern) {
        localCache.clear();
        return;
    }
    for (const key of localCache.keys()) {
        if (key.includes(pattern)) localCache.delete(key);
    }
}

function cacheStats() {
    return {
        engine: useRedis ? 'redis' : 'local-map',
        localSize: localCache.size,
        maxEntries: MAX_LOCAL_ENTRIES,
        redisConnected: useRedis
    };
}

// ── Cache Middleware (Express) ─────────────────────────────
function cacheMiddleware(prefix, ttl = CACHE_CONFIG.default, perUser = false) {
    return async (req, res, next) => {
        if (req.method !== 'GET') return next();

        const userPart = perUser && req.user ? `_u${req.user.id}` : '';
        const queryPart = Object.keys(req.query).length > 0 ? `_${JSON.stringify(req.query)}` : '';
        const cacheKey = `${prefix}${userPart}${queryPart}`;

        const cached = await cacheGet(cacheKey);
        if (cached) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(cached);
        }

        res.setHeader('X-Cache', 'MISS');
        const originalJson = res.json.bind(res);
        res.json = (data) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                cacheSet(cacheKey, data, ttl).catch(() => {});
            }
            return originalJson(data);
        };
        next();
    };
}

// ── Session cache helpers (multi-device) ───────────────────
async function cacheClearByToken(token, jwt, JWT_SECRET) {
    if (!token) return;
    try {
        const decoded = require('jsonwebtoken').verify(
            token,
            JWT_SECRET || process.env.JWT_SECRET,
            { algorithms: ['HS256'] }
        );
        if (decoded?.id) {
            if (decoded.deviceId) {
                await cacheDelete(`user_session_${decoded.id}_${decoded.deviceId}`);
            }
            await cacheDelete(`user_session_id_${decoded.id}`);
        }
    } catch (e) {
        await cacheDelete(`user_session_${token.substring(0, 32)}`);
    }
}

async function cacheClearAllUserSessions(userId) {
    if (!userId) return;
    // For Redis, use pattern scan; for local, iterate
    await cacheClear(`user_session_${userId}`);
    await cacheDelete(`user_session_id_${userId}`);
}

// ── Eviction + cleanup ─────────────────────────────────────
function _evictLRU() {
    const entries = Array.from(localCache.entries())
        .sort((a, b) => (a[1].accessedAt || 0) - (b[1].accessedAt || 0));
    const toDelete = entries.slice(0, Math.floor(entries.length / 3));
    toDelete.forEach(([key]) => localCache.delete(key));
}

// Cleanup expired entries every 5 min
setInterval(() => {
    const now = Date.now();
    for (const [key, item] of localCache.entries()) {
        if (now > item.expiresAt) localCache.delete(key);
    }
}, 300000);

// ── Export ──────────────────────────────────────────────────
module.exports = {
    initRedis,
    cacheSet,
    cacheGet,
    cacheDelete,
    cacheClear,
    cacheStats,
    cacheMiddleware,
    cacheClearByToken,
    cacheClearAllUserSessions,
    CACHE_CONFIG,
    // Expose for backwards compatibility
    get useRedis() { return useRedis; },
    get localCache() { return localCache; }
};
