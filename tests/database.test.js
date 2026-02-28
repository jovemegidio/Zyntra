/**
 * Testes Automatizados - Módulo de Banco de Dados
 * ALUFORCE ERP v2.0
 * 
 * Executar: npm test ou node --test tests/database.test.js
 */

const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const {
    buildSafeSetClause,
    buildWhereIn,
    formatDateForMysql,
    formatDatetimeForMysql,
    Money,
    roundMoney
} = require('../src/utils/database');

// ============================================
// Testes: buildSafeSetClause
// ============================================
describe('buildSafeSetClause', () => {
    const allowedColumns = new Set(['nome', 'email', 'telefone', 'valor', 'updated_at']);

    it('deve construir cláusula SET válida', () => {
        const data = { nome: 'João', email: 'joao@teste.com' };
        const result = buildSafeSetClause(data, allowedColumns);
        
        assert.ok(result.setClause.includes('`nome` = ?'));
        assert.ok(result.setClause.includes('`email` = ?'));
        assert.deepStrictEqual(result.values, ['João', 'joao@teste.com']);
    });

    it('deve ignorar colunas não permitidas', () => {
        const data = { nome: 'João', senha_hash: 'xxx', email: 'joao@teste.com' };
        const result = buildSafeSetClause(data, allowedColumns);
        
        assert.ok(!result.setClause.includes('senha_hash'));
        assert.strictEqual(result.values.length, 2);
    });

    it('deve lançar erro quando não há colunas válidas', () => {
        const data = { senha_hash: 'xxx', admin: true };
        
        assert.throws(() => {
            buildSafeSetClause(data, allowedColumns);
        }, /Nenhum campo válido/);
    });

    it('deve escapar backticks em nomes de colunas', () => {
        const data = { nome: 'João' };
        const result = buildSafeSetClause(data, allowedColumns);
        
        // Verifica que a coluna está entre backticks
        assert.ok(result.setClause.includes('`nome`'));
    });
});

// ============================================
// Testes: buildWhereIn
// ============================================
describe('buildWhereIn', () => {
    it('deve construir cláusula WHERE IN válida', () => {
        const result = buildWhereIn([1, 2, 3]);
        
        assert.strictEqual(result.clause, 'IN (?,?,?)');
        assert.deepStrictEqual(result.values, [1, 2, 3]);
    });

    it('deve retornar null para array vazio', () => {
        const result = buildWhereIn([]);
        assert.strictEqual(result, null);
    });

    it('deve retornar null para null/undefined', () => {
        assert.strictEqual(buildWhereIn(null), null);
        assert.strictEqual(buildWhereIn(undefined), null);
    });

    it('deve filtrar IDs inválidos', () => {
        const result = buildWhereIn([1, -2, 'abc', 3]);
        
        assert.strictEqual(result.clause, 'IN (?,?)');
        assert.deepStrictEqual(result.values, [1, 3]);
    });

    it('deve retornar null se todos os IDs forem inválidos', () => {
        const result = buildWhereIn([-1, 'abc', 0]);
        assert.strictEqual(result, null);
    });
});

// ============================================
// Testes: formatDateForMysql
// ============================================
describe('formatDateForMysql', () => {
    it('deve formatar Date object corretamente', () => {
        const date = new Date(2026, 0, 30); // 30 de janeiro de 2026
        const result = formatDateForMysql(date);
        assert.strictEqual(result, '2026-01-30');
    });

    it('deve formatar string de data corretamente', () => {
        const result = formatDateForMysql('2026-01-30T10:00:00');
        assert.strictEqual(result, '2026-01-30');
    });

    it('deve retornar null para data inválida', () => {
        assert.strictEqual(formatDateForMysql('invalid'), null);
        assert.strictEqual(formatDateForMysql(null), null);
        assert.strictEqual(formatDateForMysql(''), null);
    });

    it('deve lidar com datas de um dígito (padding)', () => {
        const date = new Date(2026, 0, 5);
        const result = formatDateForMysql(date);
        assert.strictEqual(result, '2026-01-05');
    });
});

// ============================================
// Testes: formatDatetimeForMysql
// ============================================
describe('formatDatetimeForMysql', () => {
    it('deve formatar datetime completo', () => {
        const date = new Date(2026, 0, 30, 14, 30, 45);
        const result = formatDatetimeForMysql(date);
        assert.strictEqual(result, '2026-01-30 14:30:45');
    });

    it('deve adicionar padding em horários', () => {
        const date = new Date(2026, 0, 5, 9, 5, 1);
        const result = formatDatetimeForMysql(date);
        assert.strictEqual(result, '2026-01-05 09:05:01');
    });

    it('deve retornar null para datetime inválido', () => {
        assert.strictEqual(formatDatetimeForMysql('invalid'), null);
        assert.strictEqual(formatDatetimeForMysql(null), null);
    });
});

// ============================================
// Testes: Money Class
// ============================================
describe('Money', () => {
    describe('criação', () => {
        it('deve criar Money a partir de centavos', () => {
            const money = new Money(1099);
            assert.strictEqual(money.toCents(), 1099);
            assert.strictEqual(money.toDecimal(), 10.99);
        });

        it('deve criar Money a partir de valor decimal', () => {
            const money = Money.fromDecimal(10.99);
            assert.strictEqual(money.toCents(), 1099);
            assert.strictEqual(money.toDecimal(), 10.99);
        });

        it('deve arredondar valores decimais', () => {
            const money = Money.fromDecimal(10.999);
            assert.strictEqual(money.toCents(), 1100); // Arredonda para cima
        });
    });

    describe('operações aritméticas', () => {
        it('deve somar corretamente', () => {
            const a = Money.fromDecimal(10.50);
            const b = Money.fromDecimal(5.75);
            const result = a.add(b);
            
            assert.strictEqual(result.toDecimal(), 16.25);
        });

        it('deve subtrair corretamente', () => {
            const a = Money.fromDecimal(10.50);
            const b = Money.fromDecimal(5.75);
            const result = a.subtract(b);
            
            assert.strictEqual(result.toDecimal(), 4.75);
        });

        it('deve multiplicar corretamente', () => {
            const money = Money.fromDecimal(10.00);
            const result = money.multiply(3);
            
            assert.strictEqual(result.toDecimal(), 30.00);
        });

        it('deve dividir corretamente', () => {
            const money = Money.fromDecimal(30.00);
            const result = money.divide(3);
            
            assert.strictEqual(result.toDecimal(), 10.00);
        });

        it('deve lançar erro ao dividir por zero', () => {
            const money = Money.fromDecimal(10.00);
            
            assert.throws(() => {
                money.divide(0);
            }, /Divisão por zero/);
        });

        it('deve calcular percentual corretamente', () => {
            const money = Money.fromDecimal(100.00);
            const result = money.percent(5);
            
            assert.strictEqual(result.toDecimal(), 5.00);
        });
    });

    describe('comparações', () => {
        it('deve verificar igualdade', () => {
            const a = Money.fromDecimal(10.00);
            const b = Money.fromDecimal(10.00);
            const c = Money.fromDecimal(20.00);
            
            assert.strictEqual(a.equals(b), true);
            assert.strictEqual(a.equals(c), false);
        });

        it('deve comparar maior/menor', () => {
            const a = Money.fromDecimal(10.00);
            const b = Money.fromDecimal(20.00);
            
            assert.strictEqual(a.lessThan(b), true);
            assert.strictEqual(b.greaterThan(a), true);
        });

        it('deve verificar zero', () => {
            const zero = Money.fromDecimal(0);
            const notZero = Money.fromDecimal(0.01);
            
            assert.strictEqual(zero.isZero(), true);
            assert.strictEqual(notZero.isZero(), false);
        });

        it('deve verificar negativo', () => {
            const negative = Money.fromDecimal(-10.00);
            const positive = Money.fromDecimal(10.00);
            
            assert.strictEqual(negative.isNegative(), true);
            assert.strictEqual(positive.isNegative(), false);
        });
    });

    describe('formatação', () => {
        it('deve converter para string com 2 casas decimais', () => {
            const money = Money.fromDecimal(10.5);
            assert.strictEqual(money.toString(), '10.50');
        });
    });

    describe('precisão', () => {
        it('deve evitar erros de ponto flutuante em soma', () => {
            // 0.1 + 0.2 em JS = 0.30000000000000004
            const a = Money.fromDecimal(0.1);
            const b = Money.fromDecimal(0.2);
            const result = a.add(b);
            
            assert.strictEqual(result.toDecimal(), 0.3);
        });

        it('deve manter precisão em multiplicações', () => {
            const money = Money.fromDecimal(19.99);
            const result = money.multiply(100);
            
            assert.strictEqual(result.toDecimal(), 1999.00);
        });
    });
});

// ============================================
// Testes: roundMoney
// ============================================
describe('roundMoney', () => {
    it('deve arredondar para 2 casas decimais', () => {
        assert.strictEqual(roundMoney(10.999), 11.00);
        assert.strictEqual(roundMoney(10.991), 10.99);
        assert.strictEqual(roundMoney(10.994), 10.99);
        assert.strictEqual(roundMoney(10.995), 11.00);
    });

    it('deve retornar 0 para valores inválidos', () => {
        assert.strictEqual(roundMoney('abc'), 0);
        assert.strictEqual(roundMoney(null), 0);
        assert.strictEqual(roundMoney(undefined), 0);
    });

    it('deve aceitar strings numéricas', () => {
        assert.strictEqual(roundMoney('10.999'), 11.00);
    });
});

// ============================================
// Execução dos Testes
// ============================================
console.log('Executando testes de banco de dados...');
console.log('Use: node --test tests/database.test.js');
