# R-10: Monolith Extraction Plan
## ALUFORCE V.2 — server.js → Modular Architecture

### Current State
- **server.js**: ~30,600 lines (single file)
- Already uses Express Routers internally (`apiFinanceiroRouter`, `apiVendasRouter`, `apiRHRouter`)
- `modules/` directory has standalone copies (NOT used by main server)
- All routes share: `pool`, `authenticateToken`, `authorizeArea`, `authorizeAction`, `writeAuditLog`, helper functions

---

### Phase 1: Extract Shared Dependencies (Week 1)

Create `utils/shared-deps.js`:
```js
// Already exists: config/database.js, middleware/auth-unified.js
// New files needed:
// utils/parse-helpers.js    → parseValor, parseDataBR, parseBool
// utils/audit.js            → writeAuditLog (already quasi-independent)
// utils/permission-cache.js → getDbAreas, _permCache
```

**Files to create:**
| File | Extracts from server.js | Lines |
|------|------------------------|-------|
| `utils/parse-helpers.js` | `parseValor`, `parseDataBR`, `parseBool` | ~50 |
| `utils/audit.js` | `writeAuditLog`, `ensureAuditoriaLogsTable` | ~40 |
| `utils/permission-cache.js` | `getDbAreas`, `_permCache` | ~30 |

---

### Phase 2: Extract Route Modules (Weeks 2-4)

**Priority order** (by size and isolation):

#### 2a. `routes/financeiro-import.js` (~600 lines)
- 5 import routes: contas-pagar, contas-receber, bancos, movimentacoes, fluxo-caixa
- Self-contained, no dependencies on other routes
- Pattern: `const router = express.Router(); router.post('/contas-pagar', ...); module.exports = (deps) => router;`
- Mount: `app.use('/api/financeiro/importar', require('./routes/financeiro-import')({ pool }))`

#### 2b. `routes/financeiro-crud.js` (~1200 lines)
- CRUD for: contas_pagar, contas_receber, bancos, movimentacoes, formas_pagamento
- Depends on: `checkFinanceiroPermission`, `writeAuditLog`
- Lines: ~21000-22800

#### 2c. `routes/financeiro-dashboard.js` (~800 lines)
- Dashboard, reports, KPIs
- Lines: ~25000-27500

#### 2d. `routes/vendas.js` (~3000 lines)
- apiVendasRouter routes (already a Router)
- Lines: ~18800-21000
- Mount: `app.use('/api/vendas', require('./routes/vendas')({ pool, ... }))`

#### 2e. `routes/rh.js` (~2500 lines)
- apiRHRouter routes (already a Router)
- Lines: ~14000-16500
- Mount: `app.use('/api/rh', require('./routes/rh')({ pool, ... }))`

#### 2f. `routes/compras.js` (~1500 lines)
- Compras CRUD routes
- Lines: ~22800-24500

#### 2g. `routes/pcp.js` (~1000 lines)
- PCP order management
- Lines: ~10500-11500

#### 2h. `routes/auth.js` (~500 lines)
- Login, logout, session management
- Lines: ~19700-20200

---

### Phase 3: Slim server.js (Week 5)

After extraction, server.js becomes an orchestrator:
```js
// server.js (~500 lines)
const app = express();
// ... middleware setup ...
// ... pool creation ...

// Mount route modules
app.use('/api/financeiro/importar', require('./routes/financeiro-import')({ pool }));
app.use('/api/financeiro', require('./routes/financeiro-crud')({ pool, writeAuditLog }));
app.use('/api/vendas', require('./routes/vendas')({ pool, authorizeArea }));
app.use('/api/rh', require('./routes/rh')({ pool, authorizeAdmin }));
app.use('/api/compras', require('./routes/compras')({ pool }));
app.use('/api/pcp', require('./routes/pcp')({ pool }));
app.use('/api/auth', require('./routes/auth')({ pool }));

// ... static file serving ...
// ... error handlers ...
```

---

### Extraction Pattern (Template)

```js
// routes/example.js
const express = require('express');
const router = express.Router();

module.exports = function({ pool, authenticateToken, authorizeArea, writeAuditLog }) {
    
    router.get('/items', authenticateToken, async (req, res) => {
        // ... route handler ...
    });

    router.post('/items', authenticateToken, async (req, res) => {
        // ... route handler ...
    });

    return router;
};
```

---

### Risk Mitigation
1. **Extract ONE module at a time**, deploy, verify, then proceed
2. **Keep original routes commented** in server.js for 2 weeks as rollback
3. **Integration tests** (tests/integration/critical-routes.test.js) must pass after each extraction
4. **Start with financeiro-import** (most isolated, recently refactored with transactions)

---

### Estimated Timeline
| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Shared deps | 1 week | Low |
| Phase 2a: Import routes | 2 days | Low |
| Phase 2b-c: Financeiro | 1 week | Medium |
| Phase 2d: Vendas | 1 week | Medium |
| Phase 2e: RH | 1 week | Medium |
| Phase 2f-h: Other | 1 week | Low |
| Phase 3: Slim orchestrator | 3 days | Low |
| **Total** | **~5-6 weeks** | |
