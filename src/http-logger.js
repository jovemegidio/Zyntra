// src/http-logger.js - Express middleware for structured HTTP logging
const logger = require('./logger');

function httpRequestLogger(req, res, next) {
    // Skip health checks and static assets from logging
    if (req.url === '/health' || req.url === '/favicon.ico') {
        return next();
    }
    
    const start = process.hrtime.bigint();
    
    // Capture when response finishes
    const originalEnd = res.end;
    res.end = function(...args) {
        const duration = Number(process.hrtime.bigint() - start) / 1e6; // ms
        
        // Log the request
        logger.request(req, res.statusCode, Math.round(duration));
        
        // Security: log auth failures
        if (res.statusCode === 401 || res.statusCode === 403) {
            logger.security('Auth failure', {
                method: req.method,
                url: req.originalUrl,
                ip: req.ip,
                status: res.statusCode
            });
        }
        
        // Security: log rate limit hits
        if (res.statusCode === 429) {
            logger.security('Rate limit exceeded', {
                ip: req.ip,
                url: req.originalUrl
            });
        }
        
        originalEnd.apply(res, args);
    };
    
    next();
}

module.exports = httpRequestLogger;
