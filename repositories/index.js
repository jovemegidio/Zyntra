/**
 * Repository Index — factory that creates all repository instances.
 * Usage: const repos = require('./repositories')(pool);
 * Then: repos.pedido.list(), repos.financeiro.dashboardKPIs(), etc.
 */
const PedidoRepository = require('./pedido-repository');
const FinanceiroRepository = require('./financeiro-repository');
const ProdutoRepository = require('./produto-repository');

module.exports = function createRepositories(pool) {
    return {
        pedido: new PedidoRepository(pool),
        financeiro: new FinanceiroRepository(pool),
        produto: new ProdutoRepository(pool),
    };
};
