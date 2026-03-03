/**
 * ROUTE ORCHESTRATOR — Central route registration
 * 
 * Requires all route modules and mounts them on the Express app.
 * This replaces the ~25,000 lines of inline routes previously in server.js.
 * 
 * Architecture:
 *   server.js (orchestrator ~500 lines)
 *     └── routes/index.js (this file)
 *           ├── routes/nfe-routes.js ............... NF-e (12 routes)
 *           ├── routes/logistica-routes.js ......... Logística (8 routes)
 *           ├── routes/compras-routes.js ........... Compras base (15 routes)
 *           ├── routes/compras-extended.js ......... Compras extended (35 routes)
 *           ├── routes/financeiro-routes.js ........ Financeiro base (20 routes)
 *           ├── routes/financeiro-extended.js ...... Financeiro extended (57 routes)
 *           ├── routes/financeiro-core.js .......... Financeiro CRUD core (25 routes)
 *           ├── routes/pcp-routes.js ............... PCP (204 routes)
 *           ├── routes/rh-routes.js ................ RH (43 routes)
 *           ├── routes/vendas-routes.js ............ Vendas base (70 routes)
 *           ├── routes/vendas-extended.js .......... Vendas extended (56 routes)
 *           ├── routes/integracao-routes.js ........ Integração (11 routes)
 *           ├── routes/companySettings.js .......... Company settings
 *           ├── routes/lgpd.js .................... LGPD compliance
 *           ├── routes/dashboard-api.js ........... Dashboard
 *           ├── routes/page-routes.js ............. HTML page serving
 *           ├── routes/static-routes.js ........... Static assets
 *           ├── routes/auth-rbac.js ............... Auth + RBAC
 *           └── (external modules in src/routes/)
 * 
 * @module routes/index
 */

const path = require('path');

module.exports = function registerAllRoutes(app, deps) {
    const {
        pool,
        jwt,
        JWT_SECRET,
        authenticateToken,
        authenticatePage,
        authorizeArea,
        authorizeAdmin,
        authorizeAction,
        authorizeAdminOrComercial,
        authorizeACL,
        writeAuditLog,
        cacheMiddleware,
        CACHE_CONFIG,
        VENDAS_DB_CONFIG,
        checkFinanceiroPermission
    } = deps;

    // Shared deps object passed to all route factories
    const sharedDeps = {
        pool, jwt, JWT_SECRET,
        authenticateToken, authenticatePage, authorizeArea, authorizeAdmin, authorizeAction,
        authorizeAdminOrComercial, authorizeACL,
        writeAuditLog, cacheMiddleware, CACHE_CONFIG, VENDAS_DB_CONFIG,
        checkFinanceiroPermission
    };

    console.log('[ROUTES] 📦 Registering modular routes...');

    // ============================================================
    // 1. NF-e — /api/nfe
    // ============================================================
    try {
        const createNfeRoutes = require('./nfe-routes');
        app.use('/api/nfe', createNfeRoutes(sharedDeps));
        console.log('[ROUTES] ✅ NF-e routes mounted at /api/nfe');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load nfe-routes:', err.message);
    }

    // External NF-e modules (from src/)
    try {
        app.use('/api/nfe', require(path.join(__dirname, '..', 'src', 'routes', 'apiNfe'))({ pool, authenticateToken, authorizeArea }));
        app.use('/api/nfe/certificado', require(path.join(__dirname, '..', 'src', 'nfe', 'controllers', 'CertificadoController'))(pool));
        const NFeController = require(path.join(__dirname, '..', 'src', 'nfe', 'controllers', 'NFeController'));
        const nfeCtrl = new NFeController(pool);
        app.use('/api/nfe', nfeCtrl.getRouter());
        console.log('[ROUTES] ✅ NF-e external modules mounted');
    } catch (err) {
        console.error('[ROUTES] ⚠️ NF-e external modules not available:', err.message);
    }

    // ============================================================
    // 2. Logística — /api/logistica
    // ============================================================
    try {
        const createLogisticaRoutes = require('./logistica-routes');
        app.use('/api/logistica', createLogisticaRoutes(sharedDeps));
        console.log('[ROUTES] ✅ Logística routes mounted at /api/logistica');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load logistica-routes:', err.message);
    }

    // ============================================================
    // 3. Compras — /api/compras (CONSOLIDATED from 3 sections)
    // ============================================================
    try {
        const createComprasRoutes = require('./compras-routes');
        app.use('/api/compras', createComprasRoutes(sharedDeps));

        const createComprasExtended = require('./compras-extended');
        app.use('/api/compras', createComprasExtended(sharedDeps));

        // External compras module
        try {
            app.use('/api/compras', require(path.join(__dirname, '..', 'api', 'integracao-compras-financeiro'))({ pool, authenticateToken }));
        } catch (_) {}

        console.log('[ROUTES] ✅ Compras routes mounted at /api/compras (consolidated)');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load compras routes:', err.message);
    }

    // ============================================================
    // 4. Financeiro — /api/financeiro (CONSOLIDATED from 3 sections)
    // ============================================================
    try {
        // Load core FIRST to get checkFinanceiroPermission middleware
        const createFinanceiroCore = require('./financeiro-core');
        const financeiroCoreResult = createFinanceiroCore(sharedDeps);
        app.use('/api/financeiro', financeiroCoreResult.router);

        // Make checkFinanceiroPermission available to other financeiro modules
        sharedDeps.checkFinanceiroPermission = financeiroCoreResult.checkFinanceiroPermission;

        const createFinanceiroRoutes = require('./financeiro-routes');
        app.use('/api/financeiro', createFinanceiroRoutes(sharedDeps));

        const createFinanceiroExtended = require('./financeiro-extended');
        app.use('/api/financeiro', createFinanceiroExtended(sharedDeps));

        // External financeiro module
        try {
            app.use('/api/financeiro', require(path.join(__dirname, '..', 'api', 'conciliacao-bancaria'))({ pool, authenticateToken }));
        } catch (_) {}

        console.log('[ROUTES] ✅ Financeiro routes mounted at /api/financeiro (consolidated)');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load financeiro routes:', err.message);
    }

    // ============================================================
    // 5. PCP — /api/pcp (LARGEST: ~204 routes)
    // ============================================================
    try {
        const createPCPRoutes = require('./pcp-routes');
        const pcpRouter = createPCPRoutes(sharedDeps);
        app.use('/api/pcp', pcpRouter);
        // FIX 23/02/2026: Rotas /api/configuracoes/* agora são servidas diretamente
        // sem bridge pelo pcpRouter (evita triple-auth e conflitos de routing)
        app.get('/api/configuracoes/empresa', authenticateToken, cacheMiddleware('cfg_empresa', CACHE_CONFIG.configuracoes), async (req, res) => {
            try {
                const [rows] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
                if (rows.length > 0) {
                    res.json(rows[0]);
                } else {
                    res.json({
                        razao_social: 'I. M. DOS REIS - ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES',
                        nome_fantasia: 'ALUFORCE INDUSTRIA E COMERCIO DE CONDUTORES ELETRICOS',
                        cnpj: '68.192.475/0001-60',
                        telefone: '(11) 91793-9089',
                        cep: '08537-400',
                        estado: 'SP',
                        cidade: 'Ferraz de Vasconcelos (SP)',
                        bairro: 'VILA SÃO JOÃO',
                        endereco: 'RUA ERNESTINA',
                        numero: '270',
                        complemento: ''
                    });
                }
            } catch (error) {
                console.error('❌ Erro ao buscar configurações empresa:', error);
                res.status(500).json({ error: 'Erro ao buscar configurações' });
            }
        });
        app.get('/api/configuracoes/impostos', authenticateToken, async (req, res) => {
            try {
                const [rows] = await pool.query('SELECT * FROM configuracoes_impostos LIMIT 1');
                if (rows && rows.length > 0) {
                    res.json(rows[0]);
                } else {
                    await pool.query(`
                        INSERT INTO configuracoes_impostos (icms, ipi, pis, cofins, iss)
                        VALUES (18.00, 5.00, 1.65, 7.60, 5.00)
                    `);
                    res.json({ icms: 18.00, ipi: 5.00, pis: 1.65, cofins: 7.60, iss: 5.00, csll: 9.00, irpj: 15.00 });
                }
            } catch (error) {
                console.error('❌ Erro ao buscar configurações impostos:', error);
                res.status(500).json({ error: 'Erro ao buscar configurações de impostos' });
            }
        });
        // Demais rotas /api/configuracoes/* continuam via bridge para pcpRouter
        app.use('/api/configuracoes', authenticateToken, (req, res, next) => {
            req.url = '/api/configuracoes' + req.url;
            pcpRouter(req, res, next);
        });
        console.log('[ROUTES] ✅ PCP routes mounted at /api/pcp (204 routes)');
        console.log('[ROUTES] ✅ Configuracoes empresa/impostos servidas diretamente');
        console.log('[ROUTES] ✅ Demais configuracoes bridged at /api/configuracoes/*');

        // Bridge: /api/servicos/* → pcpRouter (tipos de serviço, contratos, SLA)
        app.use('/api/servicos', authenticateToken, (req, res, next) => {
            req.url = '/api/servicos' + req.url;
            pcpRouter(req, res, next);
        });
        console.log('[ROUTES] ✅ Bridge: /api/servicos → pcpRouter');

        // Bridge: /api/clientes/grupos → pcpRouter (grupos de clientes CRUD)
        app.use('/api/clientes/grupos', authenticateToken, (req, res, next) => {
            req.url = '/api/clientes/grupos' + req.url;
            pcpRouter(req, res, next);
        });
        console.log('[ROUTES] ✅ Bridge: /api/clientes/grupos → pcpRouter');

        // Bridge: /api/fornecedores/tipos → pcpRouter (tipos de fornecedor CRUD)
        app.use('/api/fornecedores/tipos', authenticateToken, (req, res, next) => {
            req.url = '/api/fornecedores/tipos' + req.url;
            pcpRouter(req, res, next);
        });
        console.log('[ROUTES] ✅ Bridge: /api/fornecedores/tipos → pcpRouter');

        // Bridge: /api/transportadoras → pcpRouter (autocomplete de transportadoras)
        app.use('/api/transportadoras', authenticateToken, (req, res, next) => {
            req.url = '/api/transportadoras' + req.url;
            pcpRouter(req, res, next);
        });
        console.log('[ROUTES] ✅ Bridge: /api/transportadoras → pcpRouter');

        // Bridge: /api/gerar-ordem-excel → pcpRouter (geração de ordem Excel)
        app.post('/api/gerar-ordem-excel', authenticateToken, (req, res, next) => {
            req.url = '/api/gerar-ordem-excel';
            pcpRouter(req, res, next);
        });
        console.log('[ROUTES] ✅ Bridge: /api/gerar-ordem-excel → pcpRouter');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load pcp-routes:', err.message);
    }

    // ============================================================
    // 6. RH — /api/rh
    // ============================================================
    try {
        const createRHRoutes = require('./rh-routes');
        app.use('/api/rh', createRHRoutes(sharedDeps));

        // External RH modules
        try {
            app.use('/api/rh', require(path.join(__dirname, '..', 'src', 'routes', 'rh_apis_completas'))({ pool, authenticateToken }));
        } catch (_) {}
        try {
            app.use('/api/rh/controlid', require(path.join(__dirname, 'controlid')));
            console.log('[ROUTES] ✅ controlid montado em /api/rh/controlid');
        } catch (e) { console.error('[ROUTES] ❌ controlid falhou:', e.message); }
        try {
            app.use('/api/rh', require(path.join(__dirname, 'rh-extras'))({ pool, authenticateToken }));
        } catch (_) {}
        try {
            app.use('/api/rh', require(path.join(__dirname, 'rh-treinamentos'))({ pool, authenticateToken }));
            console.log('[ROUTES] ✅ rh-treinamentos montado em /api/rh');
        } catch (e) { console.error('[ROUTES] ⚠️ rh-treinamentos não carregou:', e.message); }

        console.log('[ROUTES] ✅ RH routes mounted at /api/rh');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load rh-routes:', err.message);
    }

    // ============================================================
    // 7. Vendas — /api/vendas (CONSOLIDATED from 2 sections)
    // ============================================================
    let vendasRouter = null;
    try {
        const createVendasRoutes = require('./vendas-routes');
        vendasRouter = createVendasRoutes(sharedDeps);
        app.use('/api/vendas', vendasRouter);

        const createVendasExtended = require('./vendas-extended');
        app.use('/api/vendas', createVendasExtended(sharedDeps));

        console.log('[ROUTES] ✅ Vendas routes mounted at /api/vendas (consolidated)');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load vendas routes:', err.message);
    }

    // ============================================================
    // 8. Integração — /api/integracao
    // ============================================================
    try {
        const createIntegracaoRoutes = require('./integracao-routes');
        app.use('/api/integracao', createIntegracaoRoutes(sharedDeps));
        console.log('[ROUTES] ✅ Integração routes mounted at /api/integracao');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load integracao-routes:', err.message);
    }

    // ============================================================
    // 9. External API modules (from api/ directory)
    // ============================================================
    const externalApis = [
        { path: '/api', file: '../api/dashboard-executivo', name: 'Dashboard Executivo' },
        { path: '/api', file: '../api/notificacoes', name: 'Notificações' },
        { path: '/api', file: '../api/workflow-aprovacoes', name: 'Workflow Aprovações' },
        { path: '/api', file: '../api/relatorios-gerenciais', name: 'Relatórios Gerenciais' },
        { path: '/api', file: '../api/esocial', name: 'eSocial' },
        { path: '/api', file: '../api/auditoria', name: 'Auditoria' },
        { path: '/api', file: '../api/backup', name: 'Backup' },
        { path: '/api', file: '../api/permissoes', name: 'Permissões' },
        { path: '/api/nfe', file: '../api/nfe-melhorias', name: 'NF-e Melhorias' },
    ];

    for (const api of externalApis) {
        try {
            const router = require(path.resolve(__dirname, api.file));
            if (typeof router === 'function') {
                app.use(api.path, router({ pool, authenticateToken, authorizeAdmin }));
            } else {
                app.use(api.path, router);
            }
        } catch (_) {
            // Module not available — skip silently
        }
    }

    // ============================================================
    // 10. LGPD Routes
    // ============================================================
    try {
        const lgpdModule = require('./lgpd');
        if (lgpdModule.createLGPDRouter) {
            app.use('/api/lgpd', lgpdModule.createLGPDRouter(pool, authenticateToken));
        } else if (typeof lgpdModule === 'function') {
            app.use('/api/lgpd', lgpdModule({ pool, authenticateToken }));
        }
        console.log('[ROUTES] ✅ LGPD routes mounted');
    } catch (_) {}

    // ============================================================
    // 9.4. Dashboard API (KPIs, Alerts, Modules)
    // ============================================================
    try {
        const dashboardRouter = require('./dashboard-api');
        app.use('/api/dashboard', dashboardRouter);
        console.log('[ROUTES] ✅ Dashboard API mounted at /api/dashboard');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load dashboard-api:', err.message);
    }

    // ============================================================
    // 9.5. Misc APIs (User, Dashboard, Kanban, Notifications)
    // ============================================================
    try {
        const createMiscRoutes = require('./misc-routes');
        app.use('/api', createMiscRoutes(sharedDeps));
        console.log('[ROUTES] ✅ Misc API routes mounted (user, dashboard, kanban)');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load misc-routes:', err.message);
    }

    // ============================================================
    // 9.6. Auth Section Routes (LGPD, login fallback, password reset)
    // ============================================================
    try {
        const createAuthSectionRoutes = require('./auth-section-routes');
        app.use('/api', createAuthSectionRoutes(sharedDeps));
        console.log('[ROUTES] ✅ Auth section routes mounted');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load auth-section-routes:', err.message);
    }

    // ============================================================
    // 9.7. Post-Exports Routes (categorias, bancos, estoque, etc.)
    // ============================================================
    try {
        const createPostExportsRoutes = require('./post-exports-routes');
        app.use('/api', createPostExportsRoutes(sharedDeps));
        console.log('[ROUTES] ✅ Post-exports routes mounted (65 routes)');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load post-exports-routes:', err.message);
    }

    // ============================================================
    // 11. Admin routes
    // ============================================================
    try {
        app.use('/api/admin', require(path.join(__dirname, '..', 'src', 'routes', 'apiAdmin'))(pool));
    } catch (_) {}

    // ============================================================
    // 11b. Auth RBAC — Admin Panel (/api/auth/admin/*)
    // Rotas para gerenciamento de usuários, roles, módulos e logs
    // ============================================================
    try {
        const { router: authRbacRouter } = require('./auth-rbac');
        app.use('/api/auth', authRbacRouter);
        console.log('[ROUTES] ✅ Auth RBAC routes mounted at /api/auth (admin panel)');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load auth-rbac:', err.message);
    }

    // ============================================================
    // 12. Bridge routes — aliases para endpoints que o frontend
    //     chama em caminhos raiz mas estão montados em sub-módulos
    // ============================================================

    // /api/clientes/* → redireciona internamente para vendas router (que tem /clientes/*)
    if (vendasRouter) {
        app.use('/api/clientes', (req, res, next) => {
            // vendas-routes define rotas como /clientes, /clientes/:id etc.
            // Quando montado em /api/vendas, /api/vendas/clientes funciona.
            // Aqui fazemos /api/clientes → chamar vendasRouter com url=/clientes/...
            const originalUrl = req.url;
            req.url = '/clientes' + (originalUrl === '/' ? '' : originalUrl);
            vendasRouter(req, res, (err) => {
                // Se não encontrou, restaura url e passa adiante
                req.url = originalUrl;
                next(err);
            });
        });

        app.use('/api/empresas', (req, res, next) => {
            const originalUrl = req.url;
            req.url = '/empresas' + (originalUrl === '/' ? '' : originalUrl);
            vendasRouter(req, res, (err) => {
                req.url = originalUrl;
                next(err);
            });
        });

        console.log('[ROUTES] ✅ Bridge: /api/clientes → vendas /clientes');
        console.log('[ROUTES] ✅ Bridge: /api/empresas → vendas /empresas');
    }

    // /api/fornecedores — agora servido pelo módulo api-fornecedores.js (CRUD completo)
    // Bridge simples removido — ativado via api-index.js activateModularRoutes()
    console.log('[ROUTES] ℹ️ /api/fornecedores → módulo CRUD completo (api-fornecedores.js)');

    // /api/usuarios — lista de usuários (usado por PCP ordem-compra.html)
    app.get('/api/usuarios', authenticateToken, async (req, res) => {
        try {
            const role = req.query.role;
            let sql = 'SELECT id, nome, email, role, departamento FROM funcionarios WHERE status = "Ativo"';
            const params = [];
            if (role) {
                sql += ' AND (role = ? OR departamento = ?)';
                params.push(role, role);
            }
            sql += ' ORDER BY nome ASC';
            const [rows] = await pool.query(sql, params);
            res.json(rows);
        } catch (error) {
            console.error('[USUARIOS] Erro:', error.message);
            res.status(500).json({ message: 'Erro ao buscar usuários', error: error.message });
        }
    });

    // /api/vendas/ligacoes/status — agora servido via vendas-extended.js (cdr-scraper)
    // Stub removido - rota ativa em routes/vendas-extended.js

    console.log('[ROUTES] 📦 All modular routes registered successfully');

    // ============================================================
    // 13. Discord Bot Routes — /api/discord
    // ============================================================
    try {
        const createDiscordRoutes = require('./discord-routes');
        app.use('/api/discord', createDiscordRoutes({
            authenticateToken,
            authorizeAdmin
        }));
        console.log('[ROUTES] ✅ Discord Bot routes mounted at /api/discord');
    } catch (err) {
        console.error('[ROUTES] ⚠️ Discord routes not available:', err.message);
    }

    console.log(`[ROUTES] 📊 Total: 16 route modules (670+ endpoints)`);
    console.log(`[ROUTES] 📊 Modules: NFe, Logística, Compras(×2), Financeiro(×3), PCP, RH, Vendas(×2), Integração, Misc, Auth, PostExports, Discord + externals`);

    // ============================================================
    // 14. NOVAS ROTAS FATURAMENTO v2.0 (Fases 1-6)
    // Fiscal Config, NF Entrada, Contábil-Fiscal/SPED, CT-e
    // ============================================================
    try {
        const { activateModularRoutes } = require('./api-index');
        activateModularRoutes(app, {
            pool,
            authenticateToken,
            registrarAuditLog: writeAuditLog,
            io: null
        });
        console.log('[ROUTES] ✅ Faturamento v2.0 modular routes activated (Fiscal, NF Entrada, Contábil, CT-e)');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load Faturamento v2.0 routes:', err.message);
    }

    // ============================================================
    // 15. Chat Corporativo (Teams) — /api/chat/*
    // ============================================================
    try {
        const registerChatRoutes = require('./chat-routes');
        registerChatRoutes(app, { pool, authenticateToken });
        console.log('[ROUTES] ✅ Chat Teams routes mounted at /api/chat/*');
    } catch (err) {
        console.error('[ROUTES] ❌ Failed to load chat-routes:', err.message);
    }

    console.log(`[ROUTES] 📊 Total atualizado: 24 route modules (760+ endpoints)`);

    return app;
};
