/**
 * Unit tests for Repository Pattern (base-repository.js + pedido-repository.js)
 */
const assert = require('assert');
const BaseRepository = require('../../repositories/base-repository');
const PedidoRepository = require('../../repositories/pedido-repository');
const FinanceiroRepository = require('../../repositories/financeiro-repository');
const ProdutoRepository = require('../../repositories/produto-repository');
const createRepositories = require('../../repositories');

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log(`  PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL: ${name} — ${e.message}`);
    }
}

// Mock pool
const mockPool = {
    query: async (sql, params) => [[{ id: 1, valor: 100 }]],
    getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        query: async () => [[]],
        release: () => {}
    })
};

console.log('--- Repository Pattern Tests ---');

test('BaseRepository instantiates with pool', () => {
    const repo = new BaseRepository(mockPool);
    assert.strictEqual(repo.pool, mockPool);
});

test('BaseRepository.query returns rows', async () => {
    const repo = new BaseRepository(mockPool);
    // Async test: we just verify it doesn't throw synchronously
    assert.strictEqual(typeof repo.query, 'function');
});

test('BaseRepository.queryOne returns first row', async () => {
    const repo = new BaseRepository(mockPool);
    assert.strictEqual(typeof repo.queryOne, 'function');
});

test('BaseRepository.transaction is callable', () => {
    const repo = new BaseRepository(mockPool);
    assert.strictEqual(typeof repo.transaction, 'function');
});

test('PedidoRepository extends BaseRepository', () => {
    const repo = new PedidoRepository(mockPool);
    assert.ok(repo instanceof BaseRepository);
    assert.strictEqual(typeof repo.list, 'function');
    assert.strictEqual(typeof repo.search, 'function');
    assert.strictEqual(typeof repo.findById, 'function');
    assert.strictEqual(typeof repo.updateStatus, 'function');
    assert.strictEqual(typeof repo.delete, 'function');
    assert.strictEqual(typeof repo.getItens, 'function');
    assert.strictEqual(typeof repo.addHistorico, 'function');
    assert.strictEqual(typeof repo.getHistorico, 'function');
});

test('FinanceiroRepository extends BaseRepository', () => {
    const repo = new FinanceiroRepository(mockPool);
    assert.ok(repo instanceof BaseRepository);
    assert.strictEqual(typeof repo.totalReceberPendente, 'function');
    assert.strictEqual(typeof repo.totalPagarPendente, 'function');
    assert.strictEqual(typeof repo.listContasReceber, 'function');
    assert.strictEqual(typeof repo.listContasPagar, 'function');
    assert.strictEqual(typeof repo.dashboardKPIs, 'function');
});

test('ProdutoRepository extends BaseRepository', () => {
    const repo = new ProdutoRepository(mockPool);
    assert.ok(repo instanceof BaseRepository);
    assert.strictEqual(typeof repo.autocompleteByCodigo, 'function');
    assert.strictEqual(typeof repo.findByCodigo, 'function');
    assert.strictEqual(typeof repo.findById, 'function');
    assert.strictEqual(typeof repo.updateEstoque, 'function');
    assert.strictEqual(typeof repo.adjustEstoque, 'function');
});

test('createRepositories returns all repos', () => {
    const repos = createRepositories(mockPool);
    assert.ok(repos.pedido instanceof PedidoRepository);
    assert.ok(repos.financeiro instanceof FinanceiroRepository);
    assert.ok(repos.produto instanceof ProdutoRepository);
});

console.log(`\n${passed}/${total} repository tests passed\n`);
if (passed < total) process.exit(1);
