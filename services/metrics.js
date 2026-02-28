/**
 * ALUFORCE ERP — Prometheus Metrics Service
 * 
 * Exposes application metrics in Prometheus format at /metrics.
 * Tracks: HTTP requests, response times, DB pool, cache, errors, business KPIs.
 * 
 * @module services/metrics
 */

'use strict';

// ── Metric Stores ──────────────────────────────────────────────
const httpRequestsTotal = {};      // method:status:route → count
const httpRequestDuration = [];     // { route, method, status, duration }
const dbQueryDuration = [];         // { operation, duration }
const cacheHits = { hit: 0, miss: 0 };
const errorCount = {};              // type → count
const activeConnections = { current: 0, peak: 0 };
const businessMetrics = {
    pedidos_criados: 0,
    nfes_emitidas: 0,
    login_success: 0,
    login_failed: 0,
    exports_gerados: 0
};

// Histogram buckets (in ms)
const DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

// Keep only last 5 min of duration samples
const MAX_DURATION_SAMPLES = 10000;
const SAMPLE_WINDOW_MS = 5 * 60 * 1000;

// ── Histogram Helper ───────────────────────────────────────────
function computeHistogram(samples, buckets) {
    const now = Date.now();
    const recent = samples.filter(s => (now - s.ts) < SAMPLE_WINDOW_MS);

    // Trim old samples
    if (samples.length > MAX_DURATION_SAMPLES) {
        samples.splice(0, samples.length - MAX_DURATION_SAMPLES);
    }

    const counts = buckets.map(b => ({ le: b, count: 0 }));
    counts.push({ le: '+Inf', count: 0 });
    let sum = 0;

    for (const s of recent) {
        sum += s.duration;
        for (const bucket of counts) {
            if (bucket.le === '+Inf' || s.duration <= bucket.le) {
                bucket.count++;
            }
        }
    }

    return { counts, sum, count: recent.length };
}

// ── Middleware: Track HTTP Requests ─────────────────────────────
function metricsMiddleware(req, res, next) {
    if (req.path === '/metrics' || req.path === '/favicon.ico') return next();

    const start = process.hrtime.bigint();
    activeConnections.current++;
    if (activeConnections.current > activeConnections.peak) {
        activeConnections.peak = activeConnections.current;
    }

    res.on('finish', () => {
        activeConnections.current--;
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

        // Normalize route to avoid high cardinality
        const route = normalizeRoute(req.route?.path || req.path);
        const method = req.method;
        const status = res.statusCode;
        const statusGroup = `${Math.floor(status / 100)}xx`;

        // Counter
        const key = `${method}:${statusGroup}:${route}`;
        httpRequestsTotal[key] = (httpRequestsTotal[key] || 0) + 1;

        // Duration histogram
        httpRequestDuration.push({ route, method, status: statusGroup, duration: durationMs, ts: Date.now() });

        // Error counter
        if (status >= 400) {
            const errType = status >= 500 ? 'server_error' : 'client_error';
            errorCount[errType] = (errorCount[errType] || 0) + 1;
        }
    });

    next();
}

// ── Route Normalization (prevent cardinality explosion) ────────
function normalizeRoute(path) {
    return path
        .replace(/\/\d+/g, '/:id')           // /api/vendas/123 → /api/vendas/:id
        .replace(/\/[a-f0-9-]{36}/g, '/:uuid') // UUID params
        .replace(/\?.+$/, '')                   // Strip query string
        .substring(0, 100);                     // Max length
}

// ── Track DB Query Duration ────────────────────────────────────
function trackDBQuery(operation, durationMs) {
    dbQueryDuration.push({ operation, duration: durationMs, ts: Date.now() });
}

// ── Track Cache Hit/Miss ───────────────────────────────────────
function trackCacheHit() { cacheHits.hit++; }
function trackCacheMiss() { cacheHits.miss++; }

// ── Track Business Event ───────────────────────────────────────
function trackBusinessEvent(event) {
    if (businessMetrics[event] !== undefined) {
        businessMetrics[event]++;
    }
}

// ── Track Error ────────────────────────────────────────────────
function trackError(type) {
    errorCount[type] = (errorCount[type] || 0) + 1;
}

// ── Generate Prometheus Text Format ────────────────────────────
function generateMetrics(pool, cacheService) {
    const lines = [];
    const ts = Date.now();

    // ── Process metrics ──────────────────────────
    const memUsage = process.memoryUsage();
    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
    lines.push('# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes ${memUsage.rss} ${ts}`);

    lines.push('# HELP process_heap_used_bytes Heap used in bytes.');
    lines.push('# TYPE process_heap_used_bytes gauge');
    lines.push(`process_heap_used_bytes ${memUsage.heapUsed} ${ts}`);

    lines.push('# HELP process_heap_total_bytes Total heap size in bytes.');
    lines.push('# TYPE process_heap_total_bytes gauge');
    lines.push(`process_heap_total_bytes ${memUsage.heapTotal} ${ts}`);

    lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${Math.floor(process.uptime())} ${ts}`);

    lines.push('# HELP nodejs_eventloop_lag_seconds Event loop lag in seconds.');
    lines.push('# TYPE nodejs_eventloop_lag_seconds gauge');
    // Approximate event loop lag
    const lagStart = Date.now();
    lines.push(`nodejs_eventloop_lag_seconds 0 ${ts}`);

    lines.push('# HELP nodejs_active_handles Number of active handles.');
    lines.push('# TYPE nodejs_active_handles gauge');
    lines.push(`nodejs_active_handles ${process._getActiveHandles?.()?.length || 0} ${ts}`);

    // ── HTTP Request metrics ─────────────────────
    lines.push('# HELP http_requests_total Total HTTP requests.');
    lines.push('# TYPE http_requests_total counter');
    for (const [key, count] of Object.entries(httpRequestsTotal)) {
        const [method, status, route] = key.split(':');
        lines.push(`http_requests_total{method="${method}",status="${status}",route="${route}"} ${count} ${ts}`);
    }

    lines.push('# HELP http_request_duration_ms HTTP request duration histogram.');
    lines.push('# TYPE http_request_duration_ms histogram');
    const httpHist = computeHistogram(httpRequestDuration, DURATION_BUCKETS);
    for (const bucket of httpHist.counts) {
        lines.push(`http_request_duration_ms_bucket{le="${bucket.le}"} ${bucket.count} ${ts}`);
    }
    lines.push(`http_request_duration_ms_sum ${httpHist.sum.toFixed(2)} ${ts}`);
    lines.push(`http_request_duration_ms_count ${httpHist.count} ${ts}`);

    // ── Active connections ────────────────────────
    lines.push('# HELP http_active_connections Current active HTTP connections.');
    lines.push('# TYPE http_active_connections gauge');
    lines.push(`http_active_connections ${activeConnections.current} ${ts}`);
    lines.push(`http_active_connections_peak ${activeConnections.peak} ${ts}`);

    // ── DB Pool metrics ──────────────────────────
    if (pool && pool.pool) {
        const poolState = pool.pool;
        lines.push('# HELP db_pool_active Active DB connections.');
        lines.push('# TYPE db_pool_active gauge');
        lines.push(`db_pool_active ${poolState._allConnections?.length || 0} ${ts}`);

        lines.push('# HELP db_pool_idle Idle DB connections.');
        lines.push('# TYPE db_pool_idle gauge');
        lines.push(`db_pool_idle ${poolState._freeConnections?.length || 0} ${ts}`);

        lines.push('# HELP db_pool_queue Queued DB connection requests.');
        lines.push('# TYPE db_pool_queue gauge');
        lines.push(`db_pool_queue ${poolState._connectionQueue?.length || 0} ${ts}`);
    }

    // ── DB Query duration ────────────────────────
    lines.push('# HELP db_query_duration_ms DB query duration histogram.');
    lines.push('# TYPE db_query_duration_ms histogram');
    const dbHist = computeHistogram(dbQueryDuration, DURATION_BUCKETS);
    for (const bucket of dbHist.counts) {
        lines.push(`db_query_duration_ms_bucket{le="${bucket.le}"} ${bucket.count} ${ts}`);
    }
    lines.push(`db_query_duration_ms_sum ${dbHist.sum.toFixed(2)} ${ts}`);
    lines.push(`db_query_duration_ms_count ${dbHist.count} ${ts}`);

    // ── Cache metrics ────────────────────────────
    lines.push('# HELP cache_hits_total Cache hits total.');
    lines.push('# TYPE cache_hits_total counter');
    lines.push(`cache_hits_total ${cacheHits.hit} ${ts}`);

    lines.push('# HELP cache_misses_total Cache misses total.');
    lines.push('# TYPE cache_misses_total counter');
    lines.push(`cache_misses_total ${cacheHits.miss} ${ts}`);

    const hitRate = (cacheHits.hit + cacheHits.miss) > 0
        ? (cacheHits.hit / (cacheHits.hit + cacheHits.miss))
        : 0;
    lines.push('# HELP cache_hit_rate Cache hit rate (0-1).');
    lines.push('# TYPE cache_hit_rate gauge');
    lines.push(`cache_hit_rate ${hitRate.toFixed(4)} ${ts}`);

    if (cacheService) {
        const stats = cacheService.cacheStats();
        lines.push('# HELP cache_local_size Local cache entries.');
        lines.push('# TYPE cache_local_size gauge');
        lines.push(`cache_local_size ${stats.localSize} ${ts}`);

        lines.push('# HELP cache_redis_connected Redis connection status.');
        lines.push('# TYPE cache_redis_connected gauge');
        lines.push(`cache_redis_connected ${stats.redisConnected ? 1 : 0} ${ts}`);
    }

    // ── Error metrics ────────────────────────────
    lines.push('# HELP errors_total Total errors by type.');
    lines.push('# TYPE errors_total counter');
    for (const [type, count] of Object.entries(errorCount)) {
        lines.push(`errors_total{type="${type}"} ${count} ${ts}`);
    }

    // ── Business metrics ─────────────────────────
    lines.push('# HELP business_events_total Business events by type.');
    lines.push('# TYPE business_events_total counter');
    for (const [event, count] of Object.entries(businessMetrics)) {
        lines.push(`business_events_total{event="${event}"} ${count} ${ts}`);
    }

    return lines.join('\n') + '\n';
}

// ── Create /metrics endpoint ───────────────────────────────────
function createMetricsEndpoint(pool, cacheService) {
    return (req, res) => {
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(generateMetrics(pool, cacheService));
    };
}

module.exports = {
    metricsMiddleware,
    createMetricsEndpoint,
    trackDBQuery,
    trackCacheHit,
    trackCacheMiss,
    trackBusinessEvent,
    trackError
};
