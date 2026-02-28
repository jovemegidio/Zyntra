/**
 * MÓDULO DE CONTROLE DE CONCORRÊNCIA - ALUFORCE ERP
 * AUDITORIA 02/02/2026: Implementação de Optimistic Locking
 * 
 * Evita que dois usuários editem o mesmo registro simultaneamente
 * Usa campo 'version' para detectar conflitos
 */

/**
 * Middleware para verificar versão do registro antes de atualizar
 * @param {string} tabela - Nome da tabela
 * @param {Object} pool - Pool de conexão MySQL
 */
function createOptimisticLockMiddleware(tabela, pool) {
    return async (req, res, next) => {
        const { id } = req.params;
        const { version } = req.body;
        
        if (!id) {
            return next();
        }
        
        // Se não passou version, permitir (compatibilidade)
        if (version === undefined || version === null) {
            console.warn(`⚠️ Atualização sem version em ${tabela}#${id}`);
            return next();
        }
        
        try {
            // Verificar versão atual no banco
            const [rows] = await pool.query(
                `SELECT version, updated_at, updated_by FROM ${tabela} WHERE id = ?`,
                [id]
            );
            
            if (rows.length === 0) {
                return res.status(404).json({ 
                    error: 'Registro não encontrado',
                    code: 'NOT_FOUND'
                });
            }
            
            const currentVersion = rows[0].version || 0;
            const requestedVersion = parseInt(version);
            
            if (currentVersion !== requestedVersion) {
                return res.status(409).json({
                    error: 'Conflito de edição',
                    code: 'CONFLICT',
                    message: 'Este registro foi modificado por outro usuário. Atualize a página para ver as alterações.',
                    details: {
                        sua_versao: requestedVersion,
                        versao_atual: currentVersion,
                        ultima_atualizacao: rows[0].updated_at,
                        atualizado_por: rows[0].updated_by
                    }
                });
            }
            
            // Incrementar versão para a próxima atualização
            req.newVersion = currentVersion + 1;
            next();
            
        } catch (error) {
            console.error(`Erro ao verificar versão em ${tabela}:`, error);
            next(); // Em caso de erro, permite continuar
        }
    };
}

/**
 * SQL helper para incluir version nas queries de UPDATE
 * @param {number} newVersion - Nova versão do registro
 * @returns {string} - SQL fragment
 */
function versionUpdateSQL(newVersion) {
    return `, version = ${newVersion}`;
}

/**
 * Bloqueia registro para edição exclusiva (pessimistic lock)
 * Usa SELECT ... FOR UPDATE
 * @param {Object} connection - Conexão MySQL (dentro de transação)
 * @param {string} tabela - Nome da tabela
 * @param {number} id - ID do registro
 * @param {number} timeoutMs - Timeout para aguardar lock (default: 5000ms)
 */
async function lockForUpdate(connection, tabela, id, timeoutMs = 5000) {
    // Definir timeout de lock
    await connection.query(`SET innodb_lock_wait_timeout = ${Math.ceil(timeoutMs / 1000)}`);
    
    try {
        const [rows] = await connection.query(
            `SELECT * FROM ${tabela} WHERE id = ? FOR UPDATE`,
            [id]
        );
        
        if (rows.length === 0) {
            throw new Error(`Registro ${tabela}#${id} não encontrado`);
        }
        
        return rows[0];
        
    } catch (error) {
        if (error.code === 'ER_LOCK_WAIT_TIMEOUT') {
            throw new Error(`Registro ${tabela}#${id} está sendo editado por outro usuário. Tente novamente em alguns segundos.`);
        }
        throw error;
    }
}

/**
 * Verifica se usuário pode editar registro (baseado em permissões e lock)
 * @param {Object} pool 
 * @param {string} tabela 
 * @param {number} registroId 
 * @param {number} userId 
 */
async function canUserEdit(pool, tabela, registroId, userId) {
    // Verificar se existe lock ativo por outro usuário
    const [locks] = await pool.query(`
        SELECT * FROM edit_locks 
        WHERE tabela = ? AND registro_id = ? AND user_id != ? AND expires_at > NOW()
    `, [tabela, registroId, userId]);
    
    if (locks.length > 0) {
        return {
            canEdit: false,
            reason: 'locked',
            lockedBy: locks[0].user_name,
            lockedAt: locks[0].created_at,
            expiresAt: locks[0].expires_at
        };
    }
    
    return { canEdit: true };
}

/**
 * Adquire lock de edição para um registro
 * @param {Object} pool 
 * @param {string} tabela 
 * @param {number} registroId 
 * @param {number} userId 
 * @param {string} userName 
 * @param {number} durationMinutes - Duração do lock em minutos (default: 15)
 */
async function acquireEditLock(pool, tabela, registroId, userId, userName, durationMinutes = 15) {
    // Remover locks expirados
    await pool.query(`DELETE FROM edit_locks WHERE expires_at < NOW()`);
    
    // Verificar se já existe lock
    const check = await canUserEdit(pool, tabela, registroId, userId);
    if (!check.canEdit) {
        throw new Error(`Registro bloqueado por ${check.lockedBy}`);
    }
    
    // Remover lock anterior do mesmo usuário (se existir)
    await pool.query(`
        DELETE FROM edit_locks 
        WHERE tabela = ? AND registro_id = ? AND user_id = ?
    `, [tabela, registroId, userId]);
    
    // Criar novo lock
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + durationMinutes);
    
    await pool.query(`
        INSERT INTO edit_locks (tabela, registro_id, user_id, user_name, created_at, expires_at)
        VALUES (?, ?, ?, ?, NOW(), ?)
    `, [tabela, registroId, userId, userName, expiresAt]);
    
    return { locked: true, expiresAt };
}

/**
 * Libera lock de edição
 * @param {Object} pool 
 * @param {string} tabela 
 * @param {number} registroId 
 * @param {number} userId 
 */
async function releaseEditLock(pool, tabela, registroId, userId) {
    await pool.query(`
        DELETE FROM edit_locks 
        WHERE tabela = ? AND registro_id = ? AND user_id = ?
    `, [tabela, registroId, userId]);
    
    return { released: true };
}

/**
 * SQL para criar tabela de locks (executar uma vez)
 */
const CREATE_LOCKS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS edit_locks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tabela VARCHAR(100) NOT NULL,
    registro_id INT NOT NULL,
    user_id INT NOT NULL,
    user_name VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    INDEX idx_tabela_registro (tabela, registro_id),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * SQL para adicionar coluna version em tabelas existentes
 * @param {string} tabela 
 */
function addVersionColumnSQL(tabela) {
    return `
        ALTER TABLE ${tabela} 
        ADD COLUMN IF NOT EXISTS version INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS updated_by INT NULL;
    `;
}

module.exports = {
    createOptimisticLockMiddleware,
    versionUpdateSQL,
    lockForUpdate,
    canUserEdit,
    acquireEditLock,
    releaseEditLock,
    CREATE_LOCKS_TABLE_SQL,
    addVersionColumnSQL
};
