/**
 * ALUFORCE v2.0 — Enterprise Rate Limiter with Redis Store
 * 
 * Drop-in replacement for the rate limiters in security-middleware.js
 * that uses Redis as a shared store (required for PM2 cluster mode).
 * 
 * When Redis is unavailable, falls back to default in-memory store.
 * 
 * @module services/rate-limiter-redis
 */
'use strict';

let RedisStore = null;
let redisClient = null;
let storeReady = false;

/**
 * Initialize the Redis store for rate limiting.
 * Call once at startup. Safe to call multiple times.
 */
async function initRateLimitRedis() {
    const url = process.env.REDIS_URL || process.env.REDIS_HOST;
    if (!url) {
        console.log('[RATE-LIMIT] ℹ️  Sem REDIS_URL — usando store em memória');
        return false;
    }

    try {
        // rate-limit-redis v4+ exports
        const rateLimitRedis = require('rate-limit-redis');
        const { createClient } = require('redis');

        redisClient = createClient({
            url: url.startsWith('redis://') ? url : `redis://${url}`,
            socket: {
                connectTimeout: 5000,
                reconnectStrategy: (retries) => Math.min(retries * 500, 5000)
            }
        });

        redisClient.on('error', (err) => {
            if (storeReady) {
                console.warn('[RATE-LIMIT] ⚠️ Redis disconnected:', err.message);
                storeReady = false;
            }
        });

        redisClient.on('connect', () => {
            storeReady = true;
        });

        await redisClient.connect();

        // rate-limit-redis v4 uses a factory function
        RedisStore = rateLimitRedis.default || rateLimitRedis;

        storeReady = true;
        console.log('[RATE-LIMIT] 🚀 Redis store ativo para rate limiting distribuído');
        return true;
    } catch (err) {
        console.warn('[RATE-LIMIT] ⚠️ Redis store não disponível:', err.message);
        console.log('[RATE-LIMIT] 📦 Usando store em memória (ok para fork mode)');
        return false;
    }
}

/**
 * Create a Redis-backed store for express-rate-limit.
 * Returns undefined if Redis is not available (uses default MemoryStore).
 */
function createRedisStore(prefix) {
    if (!storeReady || !RedisStore || !redisClient) return undefined;

    try {
        return new RedisStore({
            sendCommand: (...args) => redisClient.sendCommand(args),
            prefix: `rl:${prefix}:`
        });
    } catch (e) {
        return undefined;
    }
}

module.exports = {
    initRateLimitRedis,
    createRedisStore,
    get isRedisReady() { return storeReady; }
};
