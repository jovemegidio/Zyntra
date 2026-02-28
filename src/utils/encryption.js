/**
 * MÓDULO DE CRIPTOGRAFIA - ALUFORCE ERP
 * AUDITORIA 02/02/2026: Implementação de criptografia para dados sensíveis
 * 
 * Usa AES-256-GCM para criptografia simétrica de dados como:
 * - CPF, CNPJ
 * - Dados bancários
 * - Senhas de certificados
 * - Informações pessoais sensíveis
 */

const crypto = require('crypto');

// Chave de criptografia - DEVE ser definida via variável de ambiente em produção
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').slice(0, 32);
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Criptografa um valor de texto plano
 * @param {string} text - Texto a ser criptografado
 * @returns {string} - Texto criptografado em formato: iv:authTag:encrypted
 */
function encrypt(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }
    
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        // Formato: iv:authTag:encrypted
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
        console.error('Erro ao criptografar:', error.message);
        return text; // Em caso de erro, retorna texto original
    }
}

/**
 * Descriptografa um valor criptografado
 * @param {string} encryptedText - Texto no formato iv:authTag:encrypted
 * @returns {string} - Texto descriptografado
 */
function decrypt(encryptedText) {
    if (!encryptedText || typeof encryptedText !== 'string') {
        return encryptedText;
    }
    
    // Se não está no formato correto, provavelmente não está criptografado
    if (!encryptedText.includes(':')) {
        return encryptedText;
    }
    
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) {
            return encryptedText; // Não está no formato correto
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        
        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('Erro ao descriptografar:', error.message);
        return encryptedText; // Em caso de erro, retorna texto original
    }
}

/**
 * Verifica se um texto está criptografado
 * @param {string} text - Texto para verificar
 * @returns {boolean}
 */
function isEncrypted(text) {
    if (!text || typeof text !== 'string') return false;
    
    const parts = text.split(':');
    if (parts.length !== 3) return false;
    
    // Verifica se IV tem 32 caracteres hex (16 bytes)
    if (parts[0].length !== 32) return false;
    // Verifica se authTag tem 32 caracteres hex (16 bytes)
    if (parts[1].length !== 32) return false;
    
    return true;
}

/**
 * Mascara um CPF para exibição (xxx.xxx.xxx-xx → ***.***.xxx-xx)
 * @param {string} cpf - CPF (criptografado ou não)
 * @returns {string} - CPF mascarado
 */
function maskCPF(cpf) {
    if (!cpf) return '';
    
    // Se estiver criptografado, descriptografa primeiro
    const decrypted = isEncrypted(cpf) ? decrypt(cpf) : cpf;
    
    // Remove formatação
    const clean = decrypted.replace(/\D/g, '');
    
    if (clean.length !== 11) return '***.***.***-**';
    
    // Mostra apenas os últimos 4 dígitos
    return `***.***.${ clean.slice(6, 9)}-${clean.slice(9, 11)}`;
}

/**
 * Mascara um CNPJ para exibição
 * @param {string} cnpj - CNPJ (criptografado ou não)
 * @returns {string} - CNPJ mascarado
 */
function maskCNPJ(cnpj) {
    if (!cnpj) return '';
    
    const decrypted = isEncrypted(cnpj) ? decrypt(cnpj) : cnpj;
    const clean = decrypted.replace(/\D/g, '');
    
    if (clean.length !== 14) return '**.***.***/****.****-**';
    
    // Mostra apenas os últimos 6 dígitos (filial e dígitos)
    return `**.***.***/${clean.slice(8, 12)}-${clean.slice(12, 14)}`;
}

/**
 * Mascara dados bancários
 * @param {string} conta - Número da conta (criptografado ou não)
 * @returns {string} - Conta mascarada
 */
function maskBankAccount(conta) {
    if (!conta) return '';
    
    const decrypted = isEncrypted(conta) ? decrypt(conta) : conta;
    const clean = decrypted.replace(/\D/g, '');
    
    if (clean.length < 4) return '****';
    
    // Mostra apenas os últimos 4 dígitos
    return '*'.repeat(clean.length - 4) + clean.slice(-4);
}

/**
 * Hash de senha para certificado digital (não é reversível)
 * Usa bcrypt-like hashing
 * @param {string} password 
 * @returns {string}
 */
function hashCertificatePassword(password) {
    if (!password) return '';
    
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    
    return `${salt}:${hash}`;
}

/**
 * Verifica senha de certificado
 * @param {string} password - Senha em texto plano
 * @param {string} hashedPassword - Senha hasheada
 * @returns {boolean}
 */
function verifyCertificatePassword(password, hashedPassword) {
    if (!password || !hashedPassword) return false;
    
    const parts = hashedPassword.split(':');
    if (parts.length !== 2) return false;
    
    const [salt, hash] = parts;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    
    return hash === verifyHash;
}

/**
 * Criptografa objeto inteiro, apenas campos especificados
 * @param {Object} obj - Objeto com dados
 * @param {string[]} fields - Campos a criptografar
 * @returns {Object}
 */
function encryptFields(obj, fields = []) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const encrypted = { ...obj };
    
    for (const field of fields) {
        if (encrypted[field] && typeof encrypted[field] === 'string') {
            // Não re-criptografa se já estiver criptografado
            if (!isEncrypted(encrypted[field])) {
                encrypted[field] = encrypt(encrypted[field]);
            }
        }
    }
    
    return encrypted;
}

/**
 * Descriptografa campos de um objeto
 * @param {Object} obj - Objeto com dados criptografados
 * @param {string[]} fields - Campos a descriptografar
 * @returns {Object}
 */
function decryptFields(obj, fields = []) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const decrypted = { ...obj };
    
    for (const field of fields) {
        if (decrypted[field] && isEncrypted(decrypted[field])) {
            decrypted[field] = decrypt(decrypted[field]);
        }
    }
    
    return decrypted;
}

// Campos sensíveis por tabela
const SENSITIVE_FIELDS = {
    funcionarios: ['cpf', 'rg', 'pis_pasep', 'conta_bancaria', 'agencia', 'salario_base'],
    clientes: ['cpf_cnpj', 'inscricao_estadual'],
    fornecedores: ['cpf_cnpj', 'inscricao_estadual', 'conta_bancaria', 'agencia'],
    empresas_emissoras: ['certificado_senha', 'cpf_responsavel'],
    usuarios: [] // Senha já usa bcrypt
};

module.exports = {
    encrypt,
    decrypt,
    isEncrypted,
    maskCPF,
    maskCNPJ,
    maskBankAccount,
    hashCertificatePassword,
    verifyCertificatePassword,
    encryptFields,
    decryptFields,
    SENSITIVE_FIELDS
};
