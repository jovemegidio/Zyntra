/**
 * AUDIT LOGGING — Extracted from server.js
 * 
 * Provides unified audit trail for all operations.
 * Fire-and-forget pattern — does not block the main request.
 * 
 * @module utils/audit
 */

let _pool = null;
let _tableChecked = false;

/**
 * Initialize the audit module with a database pool.
 * @param {object} pool - mysql2/promise pool
 */
function initAudit(pool) {
    _pool = pool;
}

/**
 * Ensure the auditoria_logs table exists.
 * Called once on first audit write.
 */
async function ensureAuditoriaLogsTable(pool) {
    const p = pool || _pool;
    if (!p || _tableChecked) return;
    try {
        await p.query(`
            CREATE TABLE IF NOT EXISTS auditoria_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NULL,
                user_email VARCHAR(255) NULL,
                action VARCHAR(100) NOT NULL,
                module VARCHAR(100) NULL,
                entity_type VARCHAR(100) NULL,
                entity_id INT NULL,
                description TEXT NULL,
                previous_data JSON NULL,
                new_data JSON NULL,
                ip_address VARCHAR(45) NULL,
                user_agent TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id),
                INDEX idx_action (action),
                INDEX idx_module (module),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        _tableChecked = true;
    } catch (err) {
        console.error('[AUDIT] Erro ao criar tabela auditoria_logs:', err.message);
    }
}

/**
 * Write an audit log entry (fire-and-forget).
 * 
 * @param {object} opts
 * @param {number} [opts.userId] - User ID
 * @param {string} [opts.userEmail] - User email
 * @param {string} opts.action - Action performed (CREATE, UPDATE, DELETE, LOGIN, etc.)
 * @param {string} [opts.module] - Module name (financeiro, vendas, etc.)
 * @param {string} [opts.entityType] - Entity type (conta_pagar, pedido, etc.)
 * @param {number} [opts.entityId] - Entity ID
 * @param {string} [opts.description] - Human-readable description
 * @param {object} [opts.previousData] - Previous state (for updates/deletes)
 * @param {object} [opts.newData] - New state (for creates/updates)
 * @param {string} [opts.ip] - Client IP address
 * @param {string} [opts.userAgent] - Client user-agent header
 * @param {object} [opts.pool] - Database pool (optional, uses initialized pool)
 */
function writeAuditLog(opts) {
    const p = opts.pool || _pool;
    if (!p) return;

    // Fire and forget — no await
    ensureAuditoriaLogsTable(p).then(() => {
        const safeStringify = (v) => {
            if (!v) return null;
            try { return typeof v === 'string' ? v : JSON.stringify(v); }
            catch { return null; }
        };

        p.query(
            `INSERT INTO auditoria_logs (user_id, user_email, action, module, entity_type, entity_id, description, previous_data, new_data, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                opts.userId || null,
                opts.userEmail || null,
                opts.action || 'UNKNOWN',
                opts.module || null,
                opts.entityType || null,
                opts.entityId || null,
                opts.description || null,
                safeStringify(opts.previousData),
                safeStringify(opts.newData),
                opts.ip || null,
                opts.userAgent || null
            ]
        ).catch(err => {
            console.error('[AUDIT] Erro ao gravar log:', err.message);
        });
    }).catch(() => {});
}

module.exports = {
    initAudit,
    ensureAuditoriaLogsTable,
    writeAuditLog
};
