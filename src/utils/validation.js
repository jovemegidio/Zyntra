/**
 * Módulo de Validação Centralizado - ALUFORCE ERP
 * 
 * Funções de validação para inputs do sistema
 * Criado durante auditoria de segurança - 30/01/2026
 */

/**
 * Valida se um ID é um inteiro positivo
 * @param {any} id - ID a ser validado
 * @returns {{valid: boolean, value: number|null, error: string|null}}
 */
function validateId(id) {
    const parsed = parseInt(id, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return { valid: false, value: null, error: 'ID deve ser um número inteiro positivo' };
    }
    return { valid: true, value: parsed, error: null };
}

/**
 * Valida um valor monetário
 * @param {any} value - Valor a ser validado
 * @param {object} options - Opções de validação
 * @param {boolean} options.allowNegative - Permitir valores negativos (default: false)
 * @param {boolean} options.allowZero - Permitir zero (default: true)
 * @param {number} options.maxValue - Valor máximo permitido (default: 999999999.99)
 * @returns {{valid: boolean, value: number|null, error: string|null}}
 */
function validateMoney(value, options = {}) {
    const { allowNegative = false, allowZero = true, maxValue = 999999999.99 } = options;
    
    const parsed = parseFloat(value);
    
    if (isNaN(parsed)) {
        return { valid: false, value: null, error: 'Valor deve ser um número' };
    }
    
    if (!allowNegative && parsed < 0) {
        return { valid: false, value: null, error: 'Valor não pode ser negativo' };
    }
    
    if (!allowZero && parsed === 0) {
        return { valid: false, value: null, error: 'Valor não pode ser zero' };
    }
    
    if (parsed > maxValue) {
        return { valid: false, value: null, error: `Valor não pode exceder ${maxValue}` };
    }
    
    // Arredondar para 2 casas decimais
    const rounded = Math.round(parsed * 100) / 100;
    return { valid: true, value: rounded, error: null };
}

/**
 * Valida uma data no formato ISO (YYYY-MM-DD)
 * @param {string} dateString - Data a ser validada
 * @returns {{valid: boolean, value: string|null, error: string|null}}
 */
function validateDate(dateString) {
    if (!dateString) {
        return { valid: false, value: null, error: 'Data é obrigatória' };
    }
    
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) {
        return { valid: false, value: null, error: 'Data deve estar no formato YYYY-MM-DD' };
    }
    
    const date = new Date(dateString + 'T00:00:00');
    if (isNaN(date.getTime())) {
        return { valid: false, value: null, error: 'Data inválida' };
    }
    
    // Validar se a data reconstituída é a mesma (evita 2026-02-30)
    const [year, month, day] = dateString.split('-').map(Number);
    if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
        return { valid: false, value: null, error: 'Data inválida' };
    }
    
    return { valid: true, value: dateString, error: null };
}

/**
 * Valida um período no formato YYYY-MM
 * @param {string} period - Período a ser validado
 * @returns {{valid: boolean, value: string|null, error: string|null}}
 */
function validatePeriod(period) {
    if (!period) {
        return { valid: false, value: null, error: 'Período é obrigatório' };
    }
    
    const regex = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (!regex.test(period)) {
        return { valid: false, value: null, error: 'Período deve estar no formato YYYY-MM' };
    }
    
    return { valid: true, value: period, error: null };
}

/**
 * Valida um email
 * @param {string} email - Email a ser validado
 * @returns {{valid: boolean, value: string|null, error: string|null}}
 */
function validateEmail(email) {
    if (!email) {
        return { valid: false, value: null, error: 'Email é obrigatório' };
    }
    
    const cleaned = String(email).trim().toLowerCase();
    
    // RFC 5322 compliant regex (simplificada)
    const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
    
    if (!emailRegex.test(cleaned) || cleaned.length > 254) {
        return { valid: false, value: null, error: 'Email inválido' };
    }
    
    // Validações adicionais
    if (cleaned.includes('..') || cleaned.startsWith('.') || cleaned.includes('.@')) {
        return { valid: false, value: null, error: 'Email inválido' };
    }
    
    return { valid: true, value: cleaned, error: null };
}

/**
 * Valida mês (1-12)
 * @param {any} month - Mês a ser validado
 * @returns {{valid: boolean, value: number|null, error: string|null}}
 */
function validateMonth(month) {
    const parsed = parseInt(month, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
        return { valid: false, value: null, error: 'Mês deve ser um número entre 1 e 12' };
    }
    return { valid: true, value: parsed, error: null };
}

/**
 * Valida ano (2000-2100)
 * @param {any} year - Ano a ser validado
 * @returns {{valid: boolean, value: number|null, error: string|null}}
 */
function validateYear(year) {
    const parsed = parseInt(year, 10);
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
        return { valid: false, value: null, error: 'Ano deve ser um número entre 2000 e 2100' };
    }
    return { valid: true, value: parsed, error: null };
}

/**
 * Valida limite de paginação
 * @param {any} limit - Limite a ser validado
 * @param {object} options - Opções de validação
 * @param {number} options.defaultValue - Valor padrão se não fornecido (default: 100)
 * @param {number} options.maxValue - Valor máximo permitido (default: 1000)
 * @returns {{valid: boolean, value: number, error: string|null}}
 */
function validateLimit(limit, options = {}) {
    const { defaultValue = 100, maxValue = 1000 } = options;
    
    if (limit === undefined || limit === null || limit === '') {
        return { valid: true, value: defaultValue, error: null };
    }
    
    const parsed = parseInt(limit, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return { valid: false, value: defaultValue, error: 'Limite deve ser um número positivo' };
    }
    
    const bounded = Math.min(parsed, maxValue);
    return { valid: true, value: bounded, error: null };
}

/**
 * Sanitiza uma string de texto
 * @param {string} str - String a ser sanitizada
 * @param {object} options - Opções de sanitização
 * @param {number} options.maxLength - Comprimento máximo (default: 5000)
 * @param {boolean} options.allowHtml - Permitir HTML básico (default: false)
 * @returns {string|null}
 */
function sanitizeString(str, options = {}) {
    const { maxLength = 5000, allowHtml = false } = options;
    
    if (!str) return null;
    
    let cleaned = String(str);
    
    if (!allowHtml) {
        // Remove tags HTML e caracteres perigosos
        cleaned = cleaned
            .replace(/[<>]/g, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+=/gi, '')
            .replace(/data:/gi, '');
    }
    
    return cleaned.trim().slice(0, maxLength);
}

/**
 * Escapa caracteres especiais do LIKE para MySQL
 * @param {string} str - String a ser escapada
 * @returns {string}
 */
function escapeLike(str) {
    if (!str) return '';
    return String(str).replace(/[%_\\]/g, '\\$&');
}

/**
 * Sanitiza nome de arquivo
 * @param {string} filename - Nome do arquivo a ser sanitizado
 * @returns {string}
 */
function sanitizeFilename(filename) {
    if (!filename) return 'file';
    
    return String(filename)
        .replace(/[^a-zA-Z0-9._-]/g, '_')  // Remove caracteres perigosos
        .replace(/\.{2,}/g, '.')            // Remove múltiplos pontos consecutivos
        .replace(/^\.+|\.+$/g, '')          // Remove pontos no início/fim
        .slice(0, 255)                       // Limite de tamanho
        || 'file';
}

/**
 * Valida um array de IDs
 * @param {any} ids - Array de IDs a ser validado
 * @returns {{valid: boolean, value: number[]|null, error: string|null}}
 */
function validateIdArray(ids) {
    if (!ids) {
        return { valid: false, value: null, error: 'Array de IDs é obrigatório' };
    }
    
    const idsArray = Array.isArray(ids) ? ids : [ids];
    
    if (idsArray.length === 0) {
        return { valid: true, value: [], error: null };
    }
    
    const validIds = [];
    for (const id of idsArray) {
        const validation = validateId(id);
        if (!validation.valid) {
            return { valid: false, value: null, error: `ID inválido no array: ${id}` };
        }
        validIds.push(validation.value);
    }
    
    return { valid: true, value: validIds, error: null };
}

/**
 * Valida nomes de colunas para queries dinâmicas
 * @param {string[]} columns - Colunas a serem validadas
 * @param {Set<string>} allowedColumns - Set de colunas permitidas
 * @returns {{valid: boolean, value: string[]|null, error: string|null}}
 */
function validateColumns(columns, allowedColumns) {
    if (!columns || columns.length === 0) {
        return { valid: false, value: null, error: 'Nenhuma coluna fornecida' };
    }
    
    const validColumns = [];
    for (const col of columns) {
        const cleaned = String(col).replace(/[^a-zA-Z0-9_]/g, '');
        if (!allowedColumns.has(cleaned)) {
            return { valid: false, value: null, error: `Coluna não permitida: ${col}` };
        }
        validColumns.push(cleaned);
    }
    
    return { valid: true, value: validColumns, error: null };
}

module.exports = {
    validateId,
    validateMoney,
    validateDate,
    validatePeriod,
    validateEmail,
    validateMonth,
    validateYear,
    validateLimit,
    sanitizeString,
    escapeLike,
    sanitizeFilename,
    validateIdArray,
    validateColumns
};
