// =================================================================
// ÍNDICE DE ROTAS API - ALUFORCE v2.0
// Centraliza todos os módulos de API
// =================================================================
'use strict';

const createClientesRouter = require('./api-clientes');
const createProdutosRouter = require('./api-produtos');
const createFiscalConfigRouter = require('./api-fiscal-config');
const createNFEntradaRouter = require('./api-nf-entrada');
const createFornecedoresRouter = require('./api-fornecedores');
const createContabilFiscalRouter = require('./api-contabil-fiscal');
const createCTeRouter = require('./api-cte');

/**
 * Configura todas as rotas de API modularizadas
 * @param {Express} app - Instncia do Express
 * @param {Object} dependencies - Dependências (pool, middlewares, etc.)
 */
function setupApiRoutes(app, dependencies) {
    const { pool, authenticateToken, registrarAuditLog, io } = dependencies;
    
    // Rotas que podem substituir as existentes no server.js
    // Para ativar, descomente as linhas abaixo e remova as rotas duplicadas do server.js
    
    // app.use('/api/clientes-v2', createClientesRouter(pool, authenticateToken, registrarAuditLog));
    // app.use('/api/produtos-v2', createProdutosRouter(pool, authenticateToken, io));
    
    console.log('✅ Módulos de API disponíveis:');
    console.log('   - api-clientes.js (CRUD clientes)');
    console.log('   - api-produtos.js (CRUD produtos)');
    console.log('   - Para ativar, use setupApiRoutes() ou importe individualmente');
}

/**
 * Ativa as rotas modularizadas substituindo as do server.js
 * CUIDADO: Remover rotas duplicadas do server.js antes de ativar
 */
function activateModularRoutes(app, dependencies) {
    const { pool, authenticateToken, registrarAuditLog, io } = dependencies;
    
    // Clientes API
    const clientesRouter = createClientesRouter(pool, authenticateToken, registrarAuditLog);
    app.use('/api/clientes', clientesRouter);
    console.log('✅ Rotas /api/clientes ativadas (módulo)');
    
    // Produtos API
    const produtosRouter = createProdutosRouter(pool, authenticateToken, io);
    app.use('/api/produtos', produtosRouter);
    console.log('✅ Rotas /api/produtos ativadas (módulo)');

    // Fiscal Config API
    const fiscalRouter = createFiscalConfigRouter(pool, authenticateToken, registrarAuditLog || ((req, res, next) => next()));
    app.use('/api/fiscal', fiscalRouter);
    console.log('✅ Rotas /api/fiscal ativadas (regime tributário, regras NCM)');

    // NF Entrada API
    const nfEntradaRouter = createNFEntradaRouter(pool, authenticateToken);
    app.use('/api/nf-entrada', nfEntradaRouter);
    console.log('✅ Rotas /api/nf-entrada ativadas (importação XML, escrituração)');

    // Fornecedores API
    const fornecedoresRouter = createFornecedoresRouter(pool, authenticateToken);
    app.use('/api/fornecedores', fornecedoresRouter);
    console.log('✅ Rotas /api/fornecedores ativadas (CRUD fornecedores)');

    // Contábil-Fiscal API (SPED, Sintegra, Apurações)
    const contabilRouter = createContabilFiscalRouter(pool, authenticateToken);
    app.use('/api/contabil', contabilRouter);
    console.log('✅ Rotas /api/contabil ativadas (SPED, Sintegra, apurações)');

    // CT-e API
    const cteRouter = createCTeRouter(pool, authenticateToken);
    app.use('/api/cte', cteRouter);
    console.log('✅ Rotas /api/cte ativadas (CT-e emissão, veículos, motoristas)');
}

module.exports = {
    setupApiRoutes,
    activateModularRoutes,
    createClientesRouter,
    createProdutosRouter,
    createFiscalConfigRouter,
    createNFEntradaRouter,
    createFornecedoresRouter,
    createContabilFiscalRouter,
    createCTeRouter
};
