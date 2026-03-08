/**
 * Unit tests for Repository Pattern (all repositories)
 */
const assert = require('assert');
const BaseRepository = require('../../repositories/base-repository');
const PedidoRepository = require('../../repositories/pedido-repository');
const FinanceiroRepository = require('../../repositories/financeiro-repository');
const ProdutoRepository = require('../../repositories/produto-repository');
const ClienteRepository = require('../../repositories/cliente-repository');
const EmpresaRepository = require('../../repositories/empresa-repository');
const UsuarioRepository = require('../../repositories/usuario-repository');
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

// Mock pool that records queries
const queryCalls = [];
const mockPool = {
    query: async (sql, params) => {
        queryCalls.push({ sql, params });
        return [[{ id: 1, valor: 100, total: '500.00' }]];
    },
    getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        query: async () => [[]],
        release: () => {}
    })
};

console.log('--- Repository Pattern Tests ---');

// Base
test('BaseRepository instantiates with pool', () => {
    const repo = new BaseRepository(mockPool);
    assert.strictEqual(repo.pool, mockPool);
});

test('BaseRepository.query returns rows', () => {
    const repo = new BaseRepository(mockPool);
    assert.strictEqual(typeof repo.query, 'function');
});

test('BaseRepository.queryOne is callable', () => {
    const repo = new BaseRepository(mockPool);
    assert.strictEqual(typeof repo.queryOne, 'function');
});

test('BaseRepository.transaction is callable', () => {
    const repo = new BaseRepository(mockPool);
    assert.strictEqual(typeof repo.transaction, 'function');
});

test('BaseRepository.execute is callable', () => {
    const repo = new BaseRepository(mockPool);
    assert.strictEqual(typeof repo.execute, 'function');
});

// Pedido
test('PedidoRepository extends BaseRepository', () => {
    const repo = new PedidoRepository(mockPool);
    assert.ok(repo instanceof BaseRepository);
    assert.strictEqual(typeof repo.list, 'function');
    assert.strictEqual(typeof repo.search, 'function');
    assert.strictEqual(typeof repo.findById, 'function');
    assert.strictEqual(typeof repo.updateStatus, 'function');
    assert.strictEqual(typeof repo.updateValor, 'function');
    assert.strictEqual(typeof repo.delete, 'function');
    assert.strictEqual(typeof repo.getItens, 'function');
    assert.strictEqual(typeof repo.addHistorico, 'function');
    assert.strictEqual(typeof repo.getHistorico, 'function');
});

// Financeiro
test('FinanceiroRepository extends BaseRepository', () => {
    const repo = new FinanceiroRepository(mockPool);
    assert.ok(repo instanceof BaseRepository);
    assert.strictEqual(typeof repo.totalReceberPendente, 'function');
    assert.strictEqual(typeof repo.totalPagarPendente, 'function');
    assert.strictEqual(typeof repo.listContasReceber, 'function');
    assert.strictEqual(typeof repo.listContasPagar, 'function');
    assert.strictEqual(typeof repo.marcarRecebido, 'function');
    assert.strictEqual(typeof repo.marcarPago, 'function');
    assert.strictEqual(typeof repo.dashboardKPIs, 'function');
});

// Produto
test('ProdutoRepository extends BaseRepository', () => {
    const repo = new ProdutoRepository(mockPool);
    assert.ok(repo instanceof BaseRepository);
    assert.strictEqual(typeof repo.autocompleteByCodigo, 'function');
    assert.strictEqual(typeof repo.findByCodigo, 'function');
    assert.strictEqual(typeof repo.findById, 'function');
    assert.strictEqual(typeof repo.updateEstoque, 'function');
    assert.strictEqual(typeof repo.adjustEstoque, 'function');
});

// Cliente
test('ClienteRepository extends BaseRepository', () => {
    const repo = new ClienteRepository(mockPool);
    assert.ok(repo instanceof BaseRepository);
    assert.strictEqual(typeof repo.list, 'function');
    assert.strictEqual(typeof repo.findById, 'function');
    assert.strictEqual(typeof repo.search, 'function');
});

// Empresa
test('EmpresaRepository extends BaseRepository', () => {
    const repo = new EmpresaRepository(mockPool);
    assert.ok(repo instanceof BaseRepository);
    assert.strictEqual(typeof repo.list, 'function');
    assert.strictEqual(typeof repo.findById, 'function');
    assert.strictEqual(typeof repo.search, 'function');
});

// Usuario
test('UsuarioRepository extends BaseRepository', () => {
    const repo = new UsuarioRepository(mockPool);
    assert.ok(repo instanceof BaseRepository);
    assert.strictEqual(typeof repo.findById, 'function');
    assert.strictEqual(typeof repo.findByEmail, 'function');
    assert.strictEqual(typeof repo.findByLogin, 'function');
    assert.strictEqual(typeof repo.listVendedores, 'function');
    assert.strictEqual(typeof repo.updateLastLogin, 'function');
    assert.strictEqual(typeof repo.getProfilePhoto, 'function');
});

// Factory
test('createRepositories returns all 6 repos', () => {
    const repos = createRepositories(mockPool);
    assert.ok(repos.pedido instanceof PedidoRepository);
    assert.ok(repos.financeiro instanceof FinanceiroRepository);
    assert.ok(repos.produto instanceof ProdutoRepository);
    assert.ok(repos.cliente instanceof ClienteRepository);
    assert.ok(repos.empresa instanceof EmpresaRepository);
    assert.ok(repos.usuario instanceof UsuarioRepository);
});

console.log(`\n${passed}/${total} repository tests passed\n`);
if (passed < total) process.exit(1);
if (passed < total) process.exit(1);
