/**
 * ALUFORCE v2.0 — Circuit Breaker + Query Wrapper
 * 
 * Provides:
 *   - Query timeout (prevents pool exhaustion from slow queries)
 *   - Circuit breaker for DB calls (prevents cascade failures)
 *   - Request timeout middleware
 *   - Pool health monitoring
 * 
 * @module services/resilience
 */
'use strict';

// ── Query Timeout Wrapper ──────────────────────────────────
/**
 * Wraps a MySQL2 pool with automatic query timeout.
 * Usage: const safePool = wrapPoolWithTimeout(pool, 15000);
 */
function wrapPoolWithTimeout(pool, defaultTimeoutMs = 15000) {
    if (!pool || pool._wrappedWithTimeout) return pool;

    const originalQuery = pool.query.bind(pool);
    const originalExecute = pool.execute ? pool.execute.bind(pool) : null;

    pool.query = function timeoutQuery(...args) {
        // Extract SQL string to check if it's a DDL (no timeout for DDL)
        const sql = typeof args[0] === 'string' ? args[0] : (args[0]?.sql || '');
        const isDDL = /^\s*(CREATE|ALTER|DROP|TRUNCATE)/i.test(sql);

        if (isDDL) return originalQuery(...args);

        const timeoutMs = parseInt(process.env.DB_QUERY_TIMEOUT) || defaultTimeoutMs;

        return Promise.race([
            originalQuery(...args),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(
                    `Query timeout após ${timeoutMs}ms: ${sql.substring(0, 100)}...`
                )), timeoutMs)
            )
        ]);
    };

    if (originalExecute) {
        pool.execute = function timeoutExecute(...args) {
            const sql = typeof args[0] === 'string' ? args[0] : (args[0]?.sql || '');
            const isDDL = /^\s*(CREATE|ALTER|DROP|TRUNCATE)/i.test(sql);
            if (isDDL) return originalExecute(...args);

            const timeoutMs = parseInt(process.env.DB_QUERY_TIMEOUT) || defaultTimeoutMs;

            return Promise.race([
                originalExecute(...args),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(
                        `Execute timeout após ${timeoutMs}ms: ${sql.substring(0, 100)}...`
                    )), timeoutMs)
                )
            ]);
        };
    }

    pool._wrappedWithTimeout = true;
    return pool;
}

// ── Circuit Breaker ────────────────────────────────────────
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 30000; // 30s
        this.halfOpenMax = options.halfOpenMax || 2;

        this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.halfOpenAttempts = 0;
    }

    async execute(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
                this.state = 'HALF_OPEN';
                this.halfOpenAttempts = 0;
            } else {
                throw new Error('Circuit breaker OPEN — serviço temporariamente indisponível');
            }
        }

        if (this.state === 'HALF_OPEN' && this.halfOpenAttempts >= this.halfOpenMax) {
            throw new Error('Circuit breaker HALF_OPEN — limite de tentativas atingido');
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (error) {
            this._onFailure();
            throw error;
        }
    }

    _onSuccess() {
        this.failureCount = 0;
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= 2) {
                this.state = 'CLOSED';
                this.successCount = 0;
                console.log('[CIRCUIT-BREAKER] ✅ Circuito fechado — serviço recuperado');
            }
        }
    }

    _onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
            console.warn('[CIRCUIT-BREAKER] 🔴 Circuito aberto — falha durante half-open');
        } else if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            console.warn(`[CIRCUIT-BREAKER] 🔴 Circuito aberto — ${this.failureCount} falhas consecutivas`);
        }
    }

    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime
        };
    }
}

// ── Request Timeout Middleware ──────────────────────────────
function requestTimeout(timeoutMs = 30000) {
    return (req, res, next) => {
        req.setTimeout(timeoutMs);
        res.setTimeout(timeoutMs, () => {
            if (!res.headersSent) {
                console.warn(`[TIMEOUT] Request timeout: ${req.method} ${req.path} (${timeoutMs}ms)`);
                res.status(504).json({
                    message: 'Tempo limite da requisição excedido',
                    timeout: timeoutMs
                });
            }
        });
        next();
    };
}

// ── Pool Health Monitor ────────────────────────────────────
function createPoolMonitor(pool, interval = 60000) {
    if (!pool) return null;

    const monitor = setInterval(() => {
        try {
            const poolInfo = pool.pool || pool;
            const stats = {
                total: poolInfo._allConnections?.length || 0,
                free: poolInfo._freeConnections?.length || 0,
                queued: poolInfo._connectionQueue?.length || 0,
                acquiring: poolInfo._acquiringConnections?.length || 0
            };

            // Alert if pool is >80% utilized
            if (stats.total > 0 && stats.free === 0 && stats.queued > 0) {
                console.warn(`[POOL-MONITOR] ⚠️ Pool esgotado! queued=${stats.queued} total=${stats.total}`);
            } else if (stats.total > 0 && (stats.free / stats.total) < 0.2) {
                console.warn(`[POOL-MONITOR] ⚠️ Pool >80% utilizado: free=${stats.free}/${stats.total}`);
            }
        } catch (e) {
            // Ignore monitoring errors
        }
    }, interval);

    monitor.unref(); // Don't prevent process exit
    return monitor;
}

// ── Enhanced Health Check ──────────────────────────────────
function createHealthEndpoint(pool, cacheService) {
    return async (req, res) => {
        const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
            server: 'ALUFORCE v2.0 Enterprise',
            version: process.env.npm_package_version || '2.1.7',
            node: process.version,
            pid: process.pid,
            memory: {
                rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
                heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
                heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
            }
        };

        // DB check
        if (pool) {
            try {
                const start = Date.now();
                await pool.query('SELECT 1');
                health.database = {
                    status: 'connected',
                    latency: (Date.now() - start) + 'ms'
                };

                // Pool stats
                const poolInfo = pool.pool || pool;
                health.pool = {
                    total: poolInfo._allConnections?.length || 'N/A',
                    free: poolInfo._freeConnections?.length || 'N/A',
                    queued: poolInfo._connectionQueue?.length || 0
                };
            } catch (err) {
                health.database = { status: 'error', error: err.message };
                health.status = 'degraded';
            }
        } else {
            health.database = { status: 'unavailable' };
            health.status = 'degraded';
        }

        // Cache check
        if (cacheService) {
            health.cache = cacheService.cacheStats();
        }

        const statusCode = health.status === 'ok' ? 200 : 503;
        res.status(statusCode).json(health);
    };
}

module.exports = {
    wrapPoolWithTimeout,
    CircuitBreaker,
    requestTimeout,
    createPoolMonitor,
    createHealthEndpoint
};
