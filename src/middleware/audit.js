/**
 * Audit Log - Sistema de Auditoria - ALUFORCE ERP
 * 
 * Registra todas as operações sensíveis do sistema:
 * - DELETE em qualquer entidade
 * - Alterações em dados financeiros
 * - Mudanças de permissões/roles
 * - Ações administrativas
 * 
 * Criado durante auditoria de segurança - 30/01/2026
 */

const fs = require('fs');
const path = require('path');

// Configurações
const AUDIT_CONFIG = {
    // Diretório para arquivos de log
    logDir: process.env.AUDIT_LOG_DIR || path.join(__dirname, '../../logs/audit'),
    // Tabela no banco de dados (opcional)
    tableName: 'audit_logs',
    // Nível de log: 'all', 'write', 'delete', 'admin'
    level: process.env.AUDIT_LEVEL || 'all',
    // Tempo de retenção em dias
    retentionDays: 90,
    // Ações que sempre são logadas
    criticalActions: [
        'DELETE',
        'UPDATE_PASSWORD',
        'UPDATE_ROLE',
        'UPDATE_PERMISSIONS',
        'LOGIN_FAILED',
        'LOGIN_SUCCESS',
        'LOGOUT',
        'EXPORT_DATA',
        'BACKUP',
        'RESTORE'
    ],
    // Entidades sensíveis
    sensitiveEntities: [
        'usuarios',
        'funcionarios',
        'contas_pagar',
        'contas_receber',
        'pedidos',
        'nfes',
        'configuracoes',
        'permissoes'
    ]
};

// Buffer de logs para batch insert
let logBuffer = [];
const BUFFER_SIZE = 50;
const FLUSH_INTERVAL = 30000; // 30 segundos

// Garantir que diretório de logs existe
if (!fs.existsSync(AUDIT_CONFIG.logDir)) {
    fs.mkdirSync(AUDIT_CONFIG.logDir, { recursive: true });
}

/**
 * Estrutura de um registro de auditoria
 */
class AuditEntry {
    constructor(data) {
        this.id = generateUUID();
        this.timestamp = new Date().toISOString();
        this.action = data.action || 'UNKNOWN';
        this.entity = data.entity || null;
        this.entityId = data.entityId || null;
        this.userId = data.userId || null;
        this.userEmail = data.userEmail || null;
        this.userRole = data.userRole || null;
        this.ip = data.ip || null;
        this.userAgent = data.userAgent || null;
        this.method = data.method || null;
        this.path = data.path || null;
        this.requestBody = data.requestBody || null;
        this.previousData = data.previousData || null;
        this.newData = data.newData || null;
        this.status = data.status || 'success';
        this.errorMessage = data.errorMessage || null;
        this.duration = data.duration || null;
        this.metadata = data.metadata || {};
    }
    
    toJSON() {
        return {
            id: this.id,
            timestamp: this.timestamp,
            action: this.action,
            entity: this.entity,
            entityId: this.entityId,
            user: {
                id: this.userId,
                email: this.userEmail,
                role: this.userRole
            },
            request: {
                ip: this.ip,
                userAgent: this.userAgent,
                method: this.method,
                path: this.path,
                body: this.requestBody
            },
            changes: {
                previous: this.previousData,
                new: this.newData
            },
            result: {
                status: this.status,
                error: this.errorMessage,
                duration: this.duration
            },
            metadata: this.metadata
        };
    }
    
    toString() {
        return JSON.stringify(this.toJSON());
    }
}

/**
 * Gera UUID v4
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Sanitiza dados sensíveis antes de logar
 */
function sanitizeData(data) {
    if (!data) return null;
    
    const sensitiveFields = [
        'password', 'senha', 'token', 'secret', 
        'credit_card', 'cartao', 'cvv', 'cpf_completo'
    ];
    
    const sanitized = { ...data };
    
    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = '***REDACTED***';
        }
    }
    
    // Recursivamente sanitizar objetos aninhados
    for (const key of Object.keys(sanitized)) {
        if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitizeData(sanitized[key]);
        }
    }
    
    return sanitized;
}

/**
 * Escreve log em arquivo
 */
function writeToFile(entry) {
    const date = new Date().toISOString().split('T')[0];
    const filename = `audit-${date}.log`;
    const filepath = path.join(AUDIT_CONFIG.logDir, filename);
    
    const line = entry.toString() + '\n';
    
    fs.appendFile(filepath, line, (err) => {
        if (err) {
            console.error('[AUDIT] Erro ao escrever log:', err.message);
        }
    });
}

/**
 * Escreve log no banco de dados
 * @param {AuditEntry} entry 
 * @param {Object} pool - Pool de conexão MySQL
 */
async function writeToDatabase(entry, pool) {
    if (!pool) return;
    
    try {
        await pool.execute(`
            INSERT INTO ${AUDIT_CONFIG.tableName} 
            (id, timestamp, action, entity, entity_id, user_id, user_email, 
             ip, method, path, request_body, previous_data, new_data, 
             status, error_message, duration, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            entry.id,
            entry.timestamp,
            entry.action,
            entry.entity,
            entry.entityId,
            entry.userId,
            entry.userEmail,
            entry.ip,
            entry.method,
            entry.path,
            JSON.stringify(entry.requestBody),
            JSON.stringify(entry.previousData),
            JSON.stringify(entry.newData),
            entry.status,
            entry.errorMessage,
            entry.duration,
            JSON.stringify(entry.metadata)
        ]);
    } catch (error) {
        console.error('[AUDIT] Erro ao escrever no banco:', error.message);
        // Fallback para arquivo
        writeToFile(entry);
    }
}

/**
 * Flush buffer de logs
 */
async function flushBuffer(pool) {
    if (logBuffer.length === 0) return;
    
    const toFlush = [...logBuffer];
    logBuffer = [];
    
    for (const entry of toFlush) {
        if (pool) {
            await writeToDatabase(entry, pool);
        } else {
            writeToFile(entry);
        }
    }
}

// Flush periódico
setInterval(() => flushBuffer(null), FLUSH_INTERVAL);

/**
 * Registra uma entrada de auditoria
 * @param {Object} data - Dados do log
 * @param {Object} pool - Pool de conexão MySQL (opcional)
 */
async function log(data, pool = null) {
    const entry = new AuditEntry({
        ...data,
        requestBody: sanitizeData(data.requestBody),
        previousData: sanitizeData(data.previousData),
        newData: sanitizeData(data.newData)
    });
    
    // Determinar se deve logar baseado no nível
    const level = AUDIT_CONFIG.level;
    const action = data.action || '';
    
    if (level === 'delete' && !action.includes('DELETE')) {
        return;
    }
    
    if (level === 'write' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(data.method)) {
        return;
    }
    
    if (level === 'admin' && !AUDIT_CONFIG.criticalActions.includes(action)) {
        return;
    }
    
    // Log crítico vai direto para arquivo
    if (AUDIT_CONFIG.criticalActions.includes(action)) {
        writeToFile(entry);
        if (pool) {
            await writeToDatabase(entry, pool);
        }
        return;
    }
    
    // Outros vão para buffer
    logBuffer.push(entry);
    
    if (logBuffer.length >= BUFFER_SIZE) {
        await flushBuffer(pool);
    }
}

/**
 * Middleware de auditoria para operações DELETE
 * @param {Object} options - Opções
 * @returns {Function} Middleware Express
 */
function auditDeleteMiddleware(options = {}) {
    const { pool = null, getEntityData = null } = options;
    
    return async (req, res, next) => {
        // Apenas interceptar DELETE
        if (req.method !== 'DELETE') {
            return next();
        }
        
        const startTime = Date.now();
        
        // Extrair informações da requisição
        const entityMatch = req.path.match(/\/api\/([^\/]+)\/(\d+)/);
        const entity = entityMatch ? entityMatch[1] : null;
        const entityId = entityMatch ? entityMatch[2] : req.params?.id;
        
        // Tentar obter dados anteriores
        let previousData = null;
        if (getEntityData && entity && entityId) {
            try {
                previousData = await getEntityData(entity, entityId);
            } catch (e) {
                console.warn('[AUDIT] Não foi possível obter dados anteriores:', e.message);
            }
        }
        
        // Interceptar resposta
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);
        
        let responseSent = false;
        
        const logAndContinue = async (status, errorMessage = null) => {
            if (responseSent) return;
            responseSent = true;
            
            await log({
                action: 'DELETE',
                entity,
                entityId,
                userId: req.user?.id,
                userEmail: req.user?.email,
                userRole: req.user?.role,
                ip: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers['user-agent'],
                method: req.method,
                path: req.path,
                requestBody: req.body,
                previousData,
                status: status >= 200 && status < 300 ? 'success' : 'failure',
                errorMessage,
                duration: Date.now() - startTime,
                metadata: {
                    query: req.query,
                    params: req.params
                }
            }, pool);
        };
        
        res.json = function(body) {
            logAndContinue(res.statusCode, body?.error || body?.message);
            return originalJson(body);
        };
        
        res.send = function(body) {
            logAndContinue(res.statusCode);
            return originalSend(body);
        };
        
        // Lidar com erros
        res.on('finish', () => {
            if (!responseSent) {
                logAndContinue(res.statusCode);
            }
        });
        
        next();
    };
}

/**
 * Middleware de auditoria para todas as operações de escrita
 */
function auditWriteMiddleware(options = {}) {
    const { pool = null } = options;
    
    return async (req, res, next) => {
        // Apenas interceptar operações de escrita
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            return next();
        }
        
        const startTime = Date.now();
        
        // Extrair informações
        const pathParts = req.path.split('/').filter(p => p);
        const entity = pathParts[1] || null; // /api/[entity]/...
        const entityId = req.params?.id || pathParts[2] || null;
        
        // Determinar ação
        const actionMap = {
            'POST': 'CREATE',
            'PUT': 'UPDATE',
            'PATCH': 'UPDATE',
            'DELETE': 'DELETE'
        };
        const action = actionMap[req.method];
        
        // Interceptar resposta
        const originalJson = res.json.bind(res);
        
        res.json = function(body) {
            const duration = Date.now() - startTime;
            
            log({
                action,
                entity,
                entityId: body?.id || entityId,
                userId: req.user?.id,
                userEmail: req.user?.email,
                userRole: req.user?.role,
                ip: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers['user-agent'],
                method: req.method,
                path: req.path,
                requestBody: req.body,
                newData: body,
                status: res.statusCode >= 200 && res.statusCode < 300 ? 'success' : 'failure',
                errorMessage: body?.error || body?.message,
                duration,
                metadata: {
                    query: req.query,
                    statusCode: res.statusCode
                }
            }, pool);
            
            return originalJson(body);
        };
        
        next();
    };
}

/**
 * Função helper para logar ações manuais
 */
async function logAction(action, data, pool = null) {
    await log({
        action,
        ...data
    }, pool);
}

/**
 * SQL para criar tabela de audit_logs
 */
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    timestamp DATETIME NOT NULL,
    action VARCHAR(50) NOT NULL,
    entity VARCHAR(100),
    entity_id VARCHAR(100),
    user_id INT,
    user_email VARCHAR(255),
    ip VARCHAR(45),
    method VARCHAR(10),
    path VARCHAR(500),
    request_body JSON,
    previous_data JSON,
    new_data JSON,
    status ENUM('success', 'failure') DEFAULT 'success',
    error_message TEXT,
    duration INT,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_timestamp (timestamp),
    INDEX idx_action (action),
    INDEX idx_entity (entity, entity_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/**
 * Inicializa tabela de auditoria
 */
async function initAuditTable(pool) {
    try {
        await pool.execute(CREATE_TABLE_SQL);
        console.log('[AUDIT] ✅ Tabela de auditoria inicializada');
    } catch (error) {
        console.error('[AUDIT] Erro ao criar tabela:', error.message);
    }
}

/**
 * Limpa logs antigos baseado na retenção
 */
async function cleanOldLogs(pool = null) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - AUDIT_CONFIG.retentionDays);
    
    // Limpar arquivos
    try {
        const files = fs.readdirSync(AUDIT_CONFIG.logDir);
        for (const file of files) {
            const match = file.match(/audit-(\d{4}-\d{2}-\d{2})\.log/);
            if (match) {
                const fileDate = new Date(match[1]);
                if (fileDate < cutoffDate) {
                    fs.unlinkSync(path.join(AUDIT_CONFIG.logDir, file));
                    console.log(`[AUDIT] Arquivo removido: ${file}`);
                }
            }
        }
    } catch (error) {
        console.error('[AUDIT] Erro ao limpar arquivos:', error.message);
    }
    
    // Limpar banco de dados
    if (pool) {
        try {
            const [result] = await pool.execute(
                `DELETE FROM ${AUDIT_CONFIG.tableName} WHERE timestamp < ?`,
                [cutoffDate.toISOString()]
            );
            console.log(`[AUDIT] ${result.affectedRows} registros antigos removidos do banco`);
        } catch (error) {
            console.error('[AUDIT] Erro ao limpar banco:', error.message);
        }
    }
}

module.exports = {
    AuditEntry,
    log,
    logAction,
    auditDeleteMiddleware,
    auditWriteMiddleware,
    initAuditTable,
    cleanOldLogs,
    flushBuffer,
    AUDIT_CONFIG,
    CREATE_TABLE_SQL
};
