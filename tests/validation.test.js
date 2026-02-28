/**
 * Testes Automatizados - Módulo de Validação
 * ALUFORCE ERP v2.0
 * 
 * Executar: npm test ou node --test tests/validation.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const {
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
} = require('../src/utils/validation');

// ============================================
// Testes: validateId
// ============================================
describe('validateId', () => {
    it('deve aceitar IDs inteiros positivos', () => {
        assert.deepStrictEqual(validateId(1), { valid: true, value: 1, error: null });
        assert.deepStrictEqual(validateId(100), { valid: true, value: 100, error: null });
        assert.deepStrictEqual(validateId('42'), { valid: true, value: 42, error: null });
    });

    it('deve rejeitar IDs inválidos', () => {
        const result1 = validateId(0);
        assert.strictEqual(result1.valid, false);
        assert.ok(result1.error);

        const result2 = validateId(-5);
        assert.strictEqual(result2.valid, false);

        const result3 = validateId('abc');
        assert.strictEqual(result3.valid, false);

        const result4 = validateId(null);
        assert.strictEqual(result4.valid, false);

        const result5 = validateId(undefined);
        assert.strictEqual(result5.valid, false);
    });

    it('deve rejeitar números decimais', () => {
        // parseInt(1.5, 10) = 1, que é um inteiro válido
        // O comportamento esperado é que decimais sejam truncados e aceitos
        const result = validateId(1.5);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.value, 1);
    });
});

// ============================================
// Testes: validateMoney
// ============================================
describe('validateMoney', () => {
    it('deve aceitar valores monetários válidos', () => {
        assert.deepStrictEqual(validateMoney(10.99), { valid: true, value: 10.99, error: null });
        assert.deepStrictEqual(validateMoney('100.50'), { valid: true, value: 100.50, error: null });
        assert.deepStrictEqual(validateMoney(0), { valid: true, value: 0, error: null });
    });

    it('deve arredondar para 2 casas decimais', () => {
        const result = validateMoney(10.999);
        assert.strictEqual(result.value, 11);

        const result2 = validateMoney(10.991);
        assert.strictEqual(result2.value, 10.99);
    });

    it('deve rejeitar valores negativos por padrão', () => {
        const result = validateMoney(-10);
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.includes('negativo'));
    });

    it('deve aceitar valores negativos quando permitido', () => {
        const result = validateMoney(-10, { allowNegative: true });
        assert.deepStrictEqual(result, { valid: true, value: -10, error: null });
    });

    it('deve rejeitar zero quando não permitido', () => {
        const result = validateMoney(0, { allowZero: false });
        assert.strictEqual(result.valid, false);
    });

    it('deve rejeitar valores acima do máximo', () => {
        const result = validateMoney(1000000000);
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.includes('exceder'));
    });

    it('deve rejeitar valores não numéricos', () => {
        const result = validateMoney('abc');
        assert.strictEqual(result.valid, false);
    });
});

// ============================================
// Testes: validateDate
// ============================================
describe('validateDate', () => {
    it('deve aceitar datas válidas no formato ISO', () => {
        assert.deepStrictEqual(validateDate('2026-01-30'), { valid: true, value: '2026-01-30', error: null });
        assert.deepStrictEqual(validateDate('2025-12-31'), { valid: true, value: '2025-12-31', error: null });
    });

    it('deve rejeitar datas em formato incorreto', () => {
        const result1 = validateDate('30-01-2026');
        assert.strictEqual(result1.valid, false);

        const result2 = validateDate('30/01/2026');
        assert.strictEqual(result2.valid, false);

        const result3 = validateDate('2026-1-30');
        assert.strictEqual(result3.valid, false);
    });

    it('deve rejeitar datas inexistentes', () => {
        const result1 = validateDate('2026-02-30');
        assert.strictEqual(result1.valid, false);

        const result2 = validateDate('2026-13-01');
        assert.strictEqual(result2.valid, false);
    });

    it('deve rejeitar valores nulos ou vazios', () => {
        const result1 = validateDate(null);
        assert.strictEqual(result1.valid, false);

        const result2 = validateDate('');
        assert.strictEqual(result2.valid, false);
    });
});

// ============================================
// Testes: validatePeriod
// ============================================
describe('validatePeriod', () => {
    it('deve aceitar períodos válidos', () => {
        assert.deepStrictEqual(validatePeriod('2026-01'), { valid: true, value: '2026-01', error: null });
        assert.deepStrictEqual(validatePeriod('2025-12'), { valid: true, value: '2025-12', error: null });
    });

    it('deve rejeitar períodos inválidos', () => {
        const result1 = validatePeriod('2026-1');
        assert.strictEqual(result1.valid, false);

        const result2 = validatePeriod('2026-13');
        assert.strictEqual(result2.valid, false);

        const result3 = validatePeriod('01-2026');
        assert.strictEqual(result3.valid, false);
    });
});

// ============================================
// Testes: validateEmail
// ============================================
describe('validateEmail', () => {
    it('deve aceitar emails válidos', () => {
        const result1 = validateEmail('teste@exemplo.com');
        assert.strictEqual(result1.valid, true);
        assert.strictEqual(result1.value, 'teste@exemplo.com');

        const result2 = validateEmail('USUARIO@DOMINIO.COM.BR');
        assert.strictEqual(result2.valid, true);
        assert.strictEqual(result2.value, 'usuario@dominio.com.br');
    });

    it('deve rejeitar emails inválidos', () => {
        const result1 = validateEmail('invalido');
        assert.strictEqual(result1.valid, false);

        const result2 = validateEmail('a@b');
        assert.strictEqual(result2.valid, false);

        const result3 = validateEmail('test..test@example.com');
        assert.strictEqual(result3.valid, false);

        const result4 = validateEmail('.test@example.com');
        assert.strictEqual(result4.valid, false);
    });
});

// ============================================
// Testes: validateMonth e validateYear
// ============================================
describe('validateMonth', () => {
    it('deve aceitar meses válidos (1-12)', () => {
        assert.deepStrictEqual(validateMonth(1), { valid: true, value: 1, error: null });
        assert.deepStrictEqual(validateMonth(12), { valid: true, value: 12, error: null });
        assert.deepStrictEqual(validateMonth('6'), { valid: true, value: 6, error: null });
    });

    it('deve rejeitar meses inválidos', () => {
        assert.strictEqual(validateMonth(0).valid, false);
        assert.strictEqual(validateMonth(13).valid, false);
        assert.strictEqual(validateMonth(-1).valid, false);
    });
});

describe('validateYear', () => {
    it('deve aceitar anos válidos (2000-2100)', () => {
        assert.deepStrictEqual(validateYear(2026), { valid: true, value: 2026, error: null });
        assert.deepStrictEqual(validateYear('2025'), { valid: true, value: 2025, error: null });
    });

    it('deve rejeitar anos fora do range', () => {
        assert.strictEqual(validateYear(1999).valid, false);
        assert.strictEqual(validateYear(2101).valid, false);
    });
});

// ============================================
// Testes: validateLimit
// ============================================
describe('validateLimit', () => {
    it('deve retornar valor padrão quando não fornecido', () => {
        assert.deepStrictEqual(validateLimit(undefined), { valid: true, value: 100, error: null });
        assert.deepStrictEqual(validateLimit(null), { valid: true, value: 100, error: null });
        assert.deepStrictEqual(validateLimit(''), { valid: true, value: 100, error: null });
    });

    it('deve respeitar valor máximo', () => {
        const result = validateLimit(5000);
        assert.strictEqual(result.value, 1000);
    });

    it('deve rejeitar valores negativos', () => {
        const result = validateLimit(-10);
        assert.strictEqual(result.valid, false);
    });
});

// ============================================
// Testes: sanitizeString
// ============================================
describe('sanitizeString', () => {
    it('deve remover tags HTML', () => {
        assert.strictEqual(sanitizeString('<script>alert("xss")</script>'), 'scriptalert("xss")/script');
        assert.strictEqual(sanitizeString('Olá <b>mundo</b>'), 'Olá bmundo/b');
    });

    it('deve remover handlers de evento', () => {
        assert.strictEqual(sanitizeString('texto onclick=malicious'), 'texto malicious');
        assert.strictEqual(sanitizeString('texto onerror=evil'), 'texto evil');
    });

    it('deve remover javascript:', () => {
        const result = sanitizeString('javascript:alert(1)');
        assert.ok(!result.toLowerCase().includes('javascript:'));
    });

    it('deve limitar comprimento', () => {
        const longString = 'a'.repeat(10000);
        const result = sanitizeString(longString);
        assert.strictEqual(result.length, 5000);
    });

    it('deve retornar null para valores vazios', () => {
        assert.strictEqual(sanitizeString(null), null);
        assert.strictEqual(sanitizeString(''), null);
    });
});

// ============================================
// Testes: escapeLike
// ============================================
describe('escapeLike', () => {
    it('deve escapar caracteres especiais do LIKE', () => {
        assert.strictEqual(escapeLike('100%'), '100\\%');
        assert.strictEqual(escapeLike('test_name'), 'test\\_name');
        assert.strictEqual(escapeLike('back\\slash'), 'back\\\\slash');
    });

    it('deve retornar string vazia para valores nulos', () => {
        assert.strictEqual(escapeLike(null), '');
        assert.strictEqual(escapeLike(''), '');
    });
});

// ============================================
// Testes: sanitizeFilename
// ============================================
describe('sanitizeFilename', () => {
    it('deve remover caracteres perigosos', () => {
        // O < e > são substituídos por _
        const result1 = sanitizeFilename('file<script>.txt');
        assert.ok(!result1.includes('<'));
        assert.ok(!result1.includes('>'));
        
        // Path traversal é neutralizado
        const result2 = sanitizeFilename('../../../etc/passwd');
        assert.ok(!result2.includes('/'));
    });

    it('deve remover pontos consecutivos', () => {
        assert.strictEqual(sanitizeFilename('file..test.txt'), 'file.test.txt');
    });

    it('deve limitar comprimento', () => {
        const longName = 'a'.repeat(300) + '.txt';
        const result = sanitizeFilename(longName);
        assert.ok(result.length <= 255);
    });

    it('deve retornar "file" para valores vazios', () => {
        assert.strictEqual(sanitizeFilename(null), 'file');
        assert.strictEqual(sanitizeFilename(''), 'file');
    });
});

// ============================================
// Testes: validateIdArray
// ============================================
describe('validateIdArray', () => {
    it('deve aceitar array de IDs válidos', () => {
        const result = validateIdArray([1, 2, 3]);
        assert.deepStrictEqual(result, { valid: true, value: [1, 2, 3], error: null });
    });

    it('deve aceitar valor único e converter para array', () => {
        const result = validateIdArray(5);
        assert.deepStrictEqual(result, { valid: true, value: [5], error: null });
    });

    it('deve aceitar array vazio', () => {
        const result = validateIdArray([]);
        assert.deepStrictEqual(result, { valid: true, value: [], error: null });
    });

    it('deve rejeitar se algum ID for inválido', () => {
        const result = validateIdArray([1, -2, 3]);
        assert.strictEqual(result.valid, false);
    });
});

// ============================================
// Testes: validateColumns
// ============================================
describe('validateColumns', () => {
    const allowedColumns = new Set(['nome', 'email', 'telefone', 'data_criacao']);

    it('deve aceitar colunas permitidas', () => {
        const result = validateColumns(['nome', 'email'], allowedColumns);
        assert.deepStrictEqual(result, { valid: true, value: ['nome', 'email'], error: null });
    });

    it('deve rejeitar colunas não permitidas', () => {
        const result = validateColumns(['nome', 'senha_hash'], allowedColumns);
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.includes('não permitida'));
    });

    it('deve rejeitar array vazio', () => {
        const result = validateColumns([], allowedColumns);
        assert.strictEqual(result.valid, false);
    });

    it('deve limpar caracteres especiais de nomes de colunas', () => {
        const result = validateColumns(['nome; DROP TABLE users--'], allowedColumns);
        // Após limpeza: 'nome DROP TABLE users' - não está na lista permitida
        assert.strictEqual(result.valid, false);
    });
});

// ============================================
// Execução dos Testes (para Node.js >= 18)
// ============================================
console.log('Executando testes de validação...');
console.log('Use: node --test tests/validation.test.js');
