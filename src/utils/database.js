/**
 * Utilitários de Banco de Dados - ALUFORCE ERP
 * 
 * Wrappers e funções auxiliares para operações de banco de dados
 * Criado durante auditoria de segurança - 30/01/2026
 */

/**
 * Executa uma operação dentro de uma transação
 * Faz commit se a operação for bem-sucedida, rollback em caso de erro
 * 
 * @param {Pool} pool - Pool de conexões MySQL
 * @param {Function} callback - Função assíncrona que recebe a conexão e executa as operações
 * @returns {Promise<any>} - Resultado da operação
 * 
 * @example
 * const result = await withTransaction(pool, async (connection) => {
 *     await connection.execute('INSERT INTO ...', [...]);
 *     await connection.execute('UPDATE ...', [...]);
 *     return { success: true };
 * });
 */
async function withTransaction(pool, callback) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Executa uma operação com bloqueio pessimista (SELECT FOR UPDATE)
 * Útil para evitar race conditions em atualizações concorrentes
 * 
 * @param {Pool} pool - Pool de conexões MySQL
 * @param {string} tableName - Nome da tabela (será validado)
 * @param {number} id - ID do registro a ser bloqueado
 * @param {Function} callback - Função que recebe (connection, row) e executa as operações
 * @returns {Promise<any>} - Resultado da operação
 */
async function withLock(pool, tableName, id, callback) {
    // Validar nome da tabela (previne SQL injection)
    const validTables = new Set([
        'pedidos', 'pedido_itens', 'funcionarios', 'contas_pagar', 'contas_receber',
        'usuarios', 'clientes', 'fornecedores', 'produtos', 'nfes', 'ctes',
        'ordens_producao', 'op_materiais', 'depositos', 'compras', 'compras_itens',
        'controle_ponto', 'ferias', 'historico_cargos', 'historico_salarial'
    ]);
    
    if (!validTables.has(tableName)) {
        throw new Error(`Tabela não permitida para bloqueio: ${tableName}`);
    }
    
    const parsedId = parseInt(id, 10);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
        throw new Error('ID inválido para bloqueio');
    }
    
    return withTransaction(pool, async (connection) => {
        const [rows] = await connection.execute(
            `SELECT * FROM ${tableName} WHERE id = ? FOR UPDATE`,
            [parsedId]
        );
        
        if (rows.length === 0) {
            throw new Error(`Registro não encontrado: ${tableName} id=${parsedId}`);
        }
        
        return callback(connection, rows[0]);
    });
}

/**
 * Constrói cláusula SET para UPDATE de forma segura
 * Valida os nomes das colunas contra uma whitelist
 * 
 * @param {Object} data - Objeto com dados a serem atualizados
 * @param {Set<string>} allowedColumns - Set de colunas permitidas
 * @returns {{setClause: string, values: any[]}}
 */
function buildSafeSetClause(data, allowedColumns) {
    const setClauses = [];
    const values = [];
    
    for (const [key, value] of Object.entries(data)) {
        // Limpar nome da coluna
        const cleanKey = String(key).replace(/[^a-zA-Z0-9_]/g, '');
        
        if (allowedColumns.has(cleanKey)) {
            setClauses.push(`\`${cleanKey}\` = ?`);
            values.push(value);
        }
    }
    
    if (setClauses.length === 0) {
        throw new Error('Nenhum campo válido para atualização');
    }
    
    return {
        setClause: setClauses.join(', '),
        values
    };
}

/**
 * Constrói cláusula WHERE IN de forma segura
 * Retorna null se o array estiver vazio
 * 
 * @param {number[]} ids - Array de IDs
 * @returns {{clause: string, values: number[]}|null}
 */
function buildWhereIn(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
        return null;
    }
    
    const validIds = ids.filter(id => {
        const parsed = parseInt(id, 10);
        return Number.isInteger(parsed) && parsed > 0;
    }).map(id => parseInt(id, 10));
    
    if (validIds.length === 0) {
        return null;
    }
    
    const placeholders = validIds.map(() => '?').join(',');
    return {
        clause: `IN (${placeholders})`,
        values: validIds
    };
}

/**
 * Executa query com retry automático em caso de deadlock
 * 
 * @param {Function} queryFn - Função assíncrona que executa a query
 * @param {number} maxRetries - Número máximo de tentativas (default: 3)
 * @param {number} delay - Delay entre tentativas em ms (default: 100)
 * @returns {Promise<any>}
 */
async function executeWithRetry(queryFn, maxRetries = 3, delay = 100) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await queryFn();
        } catch (error) {
            lastError = error;
            
            // Retry apenas para deadlocks e lock wait timeout
            const retryableCodes = ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ECONNRESET'];
            if (!retryableCodes.includes(error.code)) {
                throw error;
            }
            
            if (attempt < maxRetries) {
                console.warn(`[DB] Retry ${attempt}/${maxRetries} após ${error.code}`);
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }
    
    throw lastError;
}

/**
 * Formata data para MySQL (YYYY-MM-DD)
 * 
 * @param {Date|string} date - Data a ser formatada
 * @returns {string|null}
 */
function formatDateForMysql(date) {
    if (!date) return null;
    
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

/**
 * Formata datetime para MySQL (YYYY-MM-DD HH:MM:SS)
 * 
 * @param {Date|string} datetime - Datetime a ser formatada
 * @returns {string|null}
 */
function formatDatetimeForMysql(datetime) {
    if (!datetime) return null;
    
    const d = datetime instanceof Date ? datetime : new Date(datetime);
    if (isNaN(d.getTime())) return null;
    
    const date = formatDateForMysql(d);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    
    return `${date} ${hours}:${minutes}:${seconds}`;
}

/**
 * Classe para operações com valores monetários
 * Evita problemas de precisão de ponto flutuante
 */
class Money {
    constructor(cents) {
        this.cents = Math.round(Number(cents) || 0);
    }
    
    /**
     * Cria Money a partir de valor decimal
     * @param {number|string} value - Valor em reais (ex: 10.99)
     * @returns {Money}
     */
    static fromDecimal(value) {
        const parsed = parseFloat(value) || 0;
        return new Money(Math.round(parsed * 100));
    }
    
    /**
     * Retorna valor em centavos
     * @returns {number}
     */
    toCents() {
        return this.cents;
    }
    
    /**
     * Retorna valor decimal
     * @returns {number}
     */
    toDecimal() {
        return this.cents / 100;
    }
    
    /**
     * Formata como string de moeda
     * @returns {string}
     */
    toString() {
        return this.toDecimal().toFixed(2);
    }
    
    /**
     * Soma com outro Money
     * @param {Money} other
     * @returns {Money}
     */
    add(other) {
        return new Money(this.cents + other.cents);
    }
    
    /**
     * Subtrai outro Money
     * @param {Money} other
     * @returns {Money}
     */
    subtract(other) {
        return new Money(this.cents - other.cents);
    }
    
    /**
     * Multiplica por um fator
     * @param {number} factor
     * @returns {Money}
     */
    multiply(factor) {
        return new Money(Math.round(this.cents * factor));
    }
    
    /**
     * Divide por um divisor
     * @param {number} divisor
     * @returns {Money}
     */
    divide(divisor) {
        if (divisor === 0) throw new Error('Divisão por zero');
        return new Money(Math.round(this.cents / divisor));
    }
    
    /**
     * Calcula percentual
     * @param {number} percent - Percentual (ex: 5 para 5%)
     * @returns {Money}
     */
    percent(percent) {
        return new Money(Math.round(this.cents * percent / 100));
    }
    
    /**
     * Verifica se é igual a outro Money
     * @param {Money} other
     * @returns {boolean}
     */
    equals(other) {
        return this.cents === other.cents;
    }
    
    /**
     * Verifica se é maior que outro Money
     * @param {Money} other
     * @returns {boolean}
     */
    greaterThan(other) {
        return this.cents > other.cents;
    }
    
    /**
     * Verifica se é menor que outro Money
     * @param {Money} other
     * @returns {boolean}
     */
    lessThan(other) {
        return this.cents < other.cents;
    }
    
    /**
     * Verifica se é zero
     * @returns {boolean}
     */
    isZero() {
        return this.cents === 0;
    }
    
    /**
     * Verifica se é negativo
     * @returns {boolean}
     */
    isNegative() {
        return this.cents < 0;
    }
}

/**
 * Arredonda valor para 2 casas decimais (para compatibilidade)
 * @param {number} value
 * @returns {number}
 */
function roundMoney(value) {
    return Math.round((parseFloat(value) || 0) * 100) / 100;
}

module.exports = {
    withTransaction,
    withLock,
    buildSafeSetClause,
    buildWhereIn,
    executeWithRetry,
    formatDateForMysql,
    formatDatetimeForMysql,
    Money,
    roundMoney
};
