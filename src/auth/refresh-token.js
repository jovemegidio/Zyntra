/**
 * MÓDULO DE REFRESH TOKEN - ALUFORCE ERP
 * AUDITORIA 02/02/2026: Implementação de rotação segura de tokens
 * 
 * Implementa:
 * - Access Token (curta duração: 15 min)
 * - Refresh Token (longa duração: 7 dias)
 * - Rotação automática de refresh tokens
 * - Blacklist de tokens revogados
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Configurações
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';
// SEGURANÇA: JWT_SECRET obrigatório via variável de ambiente
if (!process.env.JWT_SECRET) {
    console.error('❌ FATAL: JWT_SECRET não configurado. Defina a variável de ambiente JWT_SECRET.');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET || JWT_SECRET + '_refresh';

/**
 * Gera par de tokens (access + refresh)
 * @param {Object} user - Dados do usuário
 * @param {Object} pool - Pool MySQL para salvar refresh token
 * @param {string} deviceId - Identificador do dispositivo
 * @returns {Promise<Object>}
 */
async function generateTokenPair(user, pool, deviceId = 'default') {
    const { id, username, nome, role, empresa_id, area } = user;
    
    // Payload mínimo para access token (curto, vai no header de cada request)
    const accessPayload = {
        userId: id,
        username,
        role,
        empresa_id,
        type: 'access'
    };
    
    // Access token - curta duração
    const accessToken = jwt.sign(accessPayload, JWT_SECRET, {
        expiresIn: ACCESS_TOKEN_EXPIRY,
        issuer: 'aluforce-erp'
    });
    
    // Refresh token - longa duração, com ID único para revogação
    const refreshTokenId = crypto.randomBytes(32).toString('hex');
    const refreshPayload = {
        userId: id,
        tokenId: refreshTokenId,
        deviceId,
        type: 'refresh'
    };
    
    const refreshToken = jwt.sign(refreshPayload, REFRESH_SECRET, {
        expiresIn: REFRESH_TOKEN_EXPIRY,
        issuer: 'aluforce-erp'
    });
    
    // Salvar refresh token no banco para rastreamento
    if (pool) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        
        // Revogar tokens anteriores deste dispositivo
        await pool.query(`
            UPDATE refresh_tokens 
            SET revoked = 1, revoked_at = NOW() 
            WHERE user_id = ? AND device_id = ? AND revoked = 0
        `, [id, deviceId]);
        
        // Inserir novo token
        await pool.query(`
            INSERT INTO refresh_tokens 
            (token_id, user_id, device_id, expires_at, created_at)
            VALUES (?, ?, ?, ?, NOW())
        `, [refreshTokenId, id, deviceId, expiresAt]);
    }
    
    return {
        accessToken,
        refreshToken,
        accessExpiresIn: ACCESS_TOKEN_EXPIRY,
        refreshExpiresIn: REFRESH_TOKEN_EXPIRY,
        tokenId: refreshTokenId
    };
}

/**
 * Renova tokens usando refresh token
 * @param {string} refreshToken - Refresh token atual
 * @param {Object} pool - Pool MySQL
 * @returns {Promise<Object>}
 */
async function refreshTokens(refreshToken, pool) {
    try {
        // Verificar e decodificar refresh token
        const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
        
        if (decoded.type !== 'refresh') {
            throw new Error('Token inválido: não é um refresh token');
        }
        
        // Verificar se token está no banco e não foi revogado
        const [tokens] = await pool.query(`
            SELECT * FROM refresh_tokens 
            WHERE token_id = ? AND user_id = ? AND revoked = 0 AND expires_at > NOW()
        `, [decoded.tokenId, decoded.userId]);
        
        if (tokens.length === 0) {
            throw new Error('Refresh token inválido ou revogado');
        }
        
        // Buscar dados atualizados do usuário
        const [users] = await pool.query(`
            SELECT id, username, nome, role, empresa_id, area, status
            FROM usuarios WHERE id = ? AND status = 'ativo'
        `, [decoded.userId]);
        
        if (users.length === 0) {
            // Revogar todos os tokens deste usuário
            await revokeAllUserTokens(pool, decoded.userId);
            throw new Error('Usuário não encontrado ou inativo');
        }
        
        // Gerar novos tokens (rotação)
        const newTokens = await generateTokenPair(users[0], pool, decoded.deviceId);
        
        // Marcar token antigo como usado (para detectar reuso)
        await pool.query(`
            UPDATE refresh_tokens 
            SET used = 1, used_at = NOW(), replaced_by = ?
            WHERE token_id = ?
        `, [newTokens.tokenId, decoded.tokenId]);
        
        return {
            success: true,
            ...newTokens,
            user: {
                id: users[0].id,
                username: users[0].username,
                nome: users[0].nome,
                role: users[0].role
            }
        };
        
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            throw new Error('Refresh token expirado. Faça login novamente.');
        }
        if (error.name === 'JsonWebTokenError') {
            throw new Error('Refresh token inválido');
        }
        throw error;
    }
}

/**
 * Revoga um refresh token específico (logout de um dispositivo)
 * @param {Object} pool 
 * @param {string} tokenId 
 */
async function revokeToken(pool, tokenId) {
    await pool.query(`
        UPDATE refresh_tokens 
        SET revoked = 1, revoked_at = NOW() 
        WHERE token_id = ?
    `, [tokenId]);
    
    return { revoked: true };
}

/**
 * Revoga todos os tokens de um usuário (logout de todos os dispositivos)
 * @param {Object} pool 
 * @param {number} userId 
 */
async function revokeAllUserTokens(pool, userId) {
    const [result] = await pool.query(`
        UPDATE refresh_tokens 
        SET revoked = 1, revoked_at = NOW() 
        WHERE user_id = ? AND revoked = 0
    `, [userId]);
    
    return { revoked: true, count: result.affectedRows };
}

/**
 * Lista dispositivos/sessões ativas do usuário
 * @param {Object} pool 
 * @param {number} userId 
 */
async function listActiveSessions(pool, userId) {
    const [sessions] = await pool.query(`
        SELECT 
            device_id,
            created_at as login_at,
            expires_at,
            CASE 
                WHEN device_id LIKE 'mobile-%' THEN 'Mobile'
                WHEN device_id LIKE 'tablet-%' THEN 'Tablet'
                ELSE 'Desktop'
            END as device_type
        FROM refresh_tokens
        WHERE user_id = ? AND revoked = 0 AND expires_at > NOW()
        ORDER BY created_at DESC
    `, [userId]);
    
    return sessions;
}

/**
 * Detecta possível roubo de token (reuso de token já utilizado)
 * @param {Object} pool 
 * @param {string} tokenId 
 * @returns {Promise<boolean>}
 */
async function detectTokenReuse(pool, tokenId) {
    const [tokens] = await pool.query(`
        SELECT used, revoked FROM refresh_tokens WHERE token_id = ?
    `, [tokenId]);
    
    if (tokens.length > 0 && (tokens[0].used || tokens[0].revoked)) {
        console.warn(`🚨 ALERTA DE SEGURANÇA: Tentativa de reuso de refresh token ${tokenId}`);
        return true;
    }
    
    return false;
}

/**
 * Middleware para verificar access token
 */
function verifyAccessToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ 
            error: 'Token não fornecido',
            code: 'NO_TOKEN'
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        if (decoded.type !== 'access') {
            return res.status(401).json({ 
                error: 'Token inválido',
                code: 'INVALID_TOKEN_TYPE'
            });
        }
        
        req.user = decoded;
        next();
        
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                error: 'Token expirado',
                code: 'TOKEN_EXPIRED'
            });
        }
        return res.status(401).json({ 
            error: 'Token inválido',
            code: 'INVALID_TOKEN'
        });
    }
}

/**
 * Limpa tokens expirados do banco (executar periodicamente)
 * @param {Object} pool 
 */
async function cleanupExpiredTokens(pool) {
    const [result] = await pool.query(`
        DELETE FROM refresh_tokens 
        WHERE expires_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
    
    console.log(`🧹 Limpeza de tokens: ${result.affectedRows} tokens expirados removidos`);
    return result.affectedRows;
}

/**
 * SQL para criar tabela de refresh tokens
 */
const CREATE_REFRESH_TOKENS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token_id VARCHAR(64) NOT NULL UNIQUE,
    user_id INT NOT NULL,
    device_id VARCHAR(100) DEFAULT 'default',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    revoked TINYINT(1) DEFAULT 0,
    revoked_at DATETIME NULL,
    used TINYINT(1) DEFAULT 0,
    used_at DATETIME NULL,
    replaced_by VARCHAR(64) NULL,
    INDEX idx_user_device (user_id, device_id),
    INDEX idx_token (token_id),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

module.exports = {
    generateTokenPair,
    refreshTokens,
    revokeToken,
    revokeAllUserTokens,
    listActiveSessions,
    detectTokenReuse,
    verifyAccessToken,
    cleanupExpiredTokens,
    CREATE_REFRESH_TOKENS_TABLE_SQL,
    ACCESS_TOKEN_EXPIRY,
    REFRESH_TOKEN_EXPIRY
};
