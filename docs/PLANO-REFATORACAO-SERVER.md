# Plano de Refatoração do server.js - ALUFORCE v2.0

## Objetivo
Dividir o server.js monolítico (29.524 linhas) em módulos menores e mais gerenciáveis.

## Módulos Criados

### ✅ Já Implementados
1. **config/database.js** - Configuração e pool MySQL
2. **utils/cache.js** - Sistema de cache em memória
3. **utils/email.js** - Configuração e envio de emails
4. **routes/static-routes.js** - Rotas de arquivos estáticos
5. **routes/page-routes.js** - Rotas de páginas autenticadas

### 📁 Estrutura de Pastas Existente
```
config/
├── database.js      ✅ (novo)
├── env.js
├── https.config.js
├── jwt-config.js
├── nfe.config.js
├── performance.js

middleware/
├── auth.js
├── auth-refactored.js
├── rbac-integration.js

routes/
├── auth-rbac.js
├── companySettings.js
├── controlid.js
├── dashboard-api.js
├── documentos-fiscais.js
├── page-routes.js    ✅ (novo)
├── rh-extras.js
├── static-routes.js  ✅ (novo)

utils/
├── cache.js          ✅ (novo)
├── email.js          ✅ (novo)
```

## Migração Gradual (Recomendado)

### Fase 1 - Atual ✅
- Criar módulos auxiliares sem modificar server.js
- Testar que os módulos funcionam isoladamente

### Fase 2 - Próxima
- Modificar server.js para importar os módulos criados
- Substituir código duplicado por chamadas aos módulos
- Manter compatibilidade total

### Fase 3 - Futura
- Extrair rotas de API para arquivos separados:
  - routes/api-clientes.js
  - routes/api-produtos.js
  - routes/api-pedidos.js
  - routes/api-financeiro.js
  - routes/api-pcp.js
  - routes/api-compras.js
  - routes/api-nfe.js

## Como Usar os Novos Módulos

### No server.js, adicionar no topo:
```javascript
// Importar módulos refatorados
const { getPool, checkDB, initializePool } = require('./config/database');
const { cacheSet, cacheGet, cacheClear } = require('./utils/cache');
const { sendEmail, initEmailTransporter } = require('./utils/email');
const { setupStaticRoutes } = require('./routes/static-routes');
const { setupPageRoutes } = require('./routes/page-routes');
```

### Substituir inicialização do banco:
```javascript
// Ao invés de criar pool inline, usar:
const pool = initializePool();
```

### Substituir rotas estáticas:
```javascript
// Ao invés de dezenas de app.use('/xxx', express.static(...))
// Usar uma única chamada:
setupStaticRoutes(app, __dirname);
```

### Substituir rotas de páginas:
```javascript
// Ao invés de dezenas de app.get('/Vendas/...', authenticatePage, ...)
// Usar uma única chamada:
setupPageRoutes(app, __dirname, authenticatePage, userPermissions);
```

## Benefícios da Divisão

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Tamanho do server.js | 29.524 linhas | ~5.000 linhas |
| Tempo de carregamento IDE | Lento | Rápido |
| Navegação no código | Difícil | Fácil |
| Testes unitários | Impossível | Possível |
| Colaboração em equipe | Conflitos frequentes | Trabalho paralelo |

## Próximos Passos

1. [ ] Testar módulos criados
2. [ ] Integrar gradualmente no server.js
3. [ ] Extrair rotas de API
4. [ ] Documentar cada módulo
5. [ ] Adicionar testes unitários

---
Data: 2026-01-18
Versão: 1.0
