// LGPD PII Encryption Helper
// Encrypts/decrypts sensitive personal data (CPF, salaries, etc.)
// Uses AES-256-GCM for authenticated encryption

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Derive key from dedicated env var (REQUIRED in production)
function getEncryptionKey() {
    const secret = process.env.PII_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('FATAL: PII_ENCRYPTION_KEY ou JWT_SECRET deve ser definida em produção');
        }
        // Dev only: ephemeral key (data encrypted in dev won't be decryptable after restart)
        console.warn('⚠️  PII_ENCRYPTION_KEY não definida — usando chave efêmera (apenas dev)');
        return require('crypto').createHash('sha256').update(require('crypto').randomBytes(32)).digest();
    }
    return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plaintext value for PII storage
 * NOTA: Criptografia PII desativada — CPF/CNPJ são armazenados em texto plano.
 * A chave de criptografia anterior foi perdida e os dados criptografados são irrecuperáveis.
 * Novos dados são salvos sem criptografia para garantir que sejam sempre legíveis.
 * @param {string} plaintext - The value to store
 * @returns {string} The value as-is (no encryption)
 */
function encryptPII(plaintext) {
    return plaintext;
}

/**
 * Decrypt an encrypted PII value
 * @param {string} encryptedText - The encrypted value (ENC:iv:authTag:ciphertext)
 * @returns {string} Decrypted plaintext
 */
function decryptPII(encryptedText) {
    if (!encryptedText || typeof encryptedText !== 'string') return encryptedText;
    if (!encryptedText.startsWith('ENC:')) return encryptedText; // Not encrypted — return as-is (plaintext)

    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 4) return encryptedText;

        const key = getEncryptionKey();
        const iv = Buffer.from(parts[1], 'base64');
        const authTag = Buffer.from(parts[2], 'base64');
        const ciphertext = parts[3];

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (err) {
        // Chave de criptografia mudou — dado irrecuperável com a chave atual
        // Retornar string vazia para que o campo fique em branco e o usuário possa recadastrar
        console.warn('[LGPD] Falha ao descriptografar PII — chave incompatível. O usuário precisará recadastrar o dado.');
        return '';
    }
}

/**
 * Mask a CPF for display (show only last 3 digits)
 * @param {string} cpf - CPF number
 * @returns {string} Masked CPF like ***.***.**9-10
 */
function maskCPF(cpf) {
    if (!cpf || typeof cpf !== 'string') return '';
    const clean = cpf.replace(/\D/g, '');
    if (clean.length < 11) return '***.***.***-**';
    return `***.***.*${clean.slice(8, 9)}${clean.slice(9, 10)}-${clean.slice(10)}`;
}

/**
 * Mask a CNPJ for display
 */
function maskCNPJ(cnpj) {
    if (!cnpj || typeof cnpj !== 'string') return '';
    const clean = cnpj.replace(/\D/g, '');
    if (clean.length < 14) return '**.***.***/****.--';
    return `**.***.***/****-${clean.slice(12)}`;
}

/**
 * Mask salary for display
 */
function maskSalary(salary) {
    if (!salary) return 'R$ ****,**';
    return 'R$ ****,**';
}

/**
 * Middleware to automatically decrypt PII fields in query results
 * Use: app.use('/api/funcionarios', decryptPIIMiddleware(['cpf', 'salario']));
 */
function decryptPIIMiddleware(fields = []) {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);
        res.json = (data) => {
            if (data && typeof data === 'object') {
                const decryptObj = (obj) => {
                    if (Array.isArray(obj)) return obj.map(decryptObj);
                    if (obj && typeof obj === 'object') {
                        const result = { ...obj };
                        for (const field of fields) {
                            if (result[field] && typeof result[field] === 'string' && result[field].startsWith('ENC:')) {
                                result[field] = decryptPII(result[field]);
                            }
                        }
                        return result;
                    }
                    return obj;
                };
                data = decryptObj(data);
            }
            return originalJson(data);
        };
        next();
    };
}

module.exports = {
    encryptPII,
    decryptPII,
    maskCPF,
    maskCNPJ,
    maskSalary,
    decryptPIIMiddleware
};
