# AUDITORIA COMPLETA — fetch() no Módulo PCP

**Data:** Gerada automaticamente  
**Escopo:** 11 arquivos JavaScript do frontend PCP  
**Objetivo:** Mapear TODA chamada `fetch()`, identificar rotas quebradas, funções indefinidas e IDs HTML ausentes

---

## RESUMO EXECUTIVO

| Métrica                                          | Valor                                   |
| ------------------------------------------------ | --------------------------------------- |
| Arquivos auditados                               | 11                                      |
| Total de chamadas `fetch()`                      | **~120**                                |
| Rotas QUEBRADAS (endpoint não existe no backend) | **14 ocorrências em 6 rotas distintas** |
| Chamadas sem tratamento de erro                  | 0 (todas têm try/catch ou .catch())     |
| Funções JS potencialmente indefinidas            | 5                                       |
| Duplicação de funções entre arquivos             | Severa (pcp_modern.js vs pcp-modals.js) |

---

## ROTAS QUEBRADAS — RESUMO RÁPIDO

| Rota inexistente                            | Arquivos que chamam                                  | Linhas         |
| ------------------------------------------- | ---------------------------------------------------- | -------------- |
| `GET /api/pcp/search`                       | pcp.js                                               | ~L1805, ~L1914 |
| `GET /api/pcp/dashboard/stats`              | pcp-dashboard.js                                     | ~L28           |
| `GET/PUT/DELETE /api/pcp/ordens-compra/:id` | pcp-modals.js (js/), pcp_modern.js, ordens-compra.js | Múltiplas      |
| `GET /api/pcp/produtos/export-pdf`          | pcp_modern.js                                        | ~L3008         |
| `GET /api/pcp/materiais/export-pdf`         | pcp_modern.js                                        | ~L4006         |
| `PUT /api/pcp/ordens/:id/status`            | pcp.js                                               | ~L418          |

---

## 1. pcp.js (2759 linhas)

**Localização:** `modules/PCP/pcp.js`  
**Variável base:** `const API_BASE_URL = '/api/pcp'`

| #   | Linha | Método | URL                                        | Função / Trigger                   | Erro      | Status                                               |
| --- | ----- | ------ | ------------------------------------------ | ---------------------------------- | --------- | ---------------------------------------------------- |
| 1   | ~93   | GET    | `/api/pcp/pedidos`                         | click em btnVerTodosFaturados      | try/catch | ✅ OK                                                |
| 2   | ~356  | GET    | `/api/pcp/ordens`                          | `carregarOrdens()`                 | try/catch | ✅ OK                                                |
| 3   | ~418  | PUT    | `/api/pcp/ordens/${cardId}/status`         | kanban drag-drop                   | try/catch | ⛔ **QUEBRADA** — PUT /api/pcp/ordens/:id não existe |
| 4   | ~444  | POST   | `/api/pcp/ordens`                          | form submit novaOrdem              | try/catch | ✅ OK                                                |
| 5   | ~468  | PUT    | `/api/pcp/materiais/${editingId}`          | form submit novoMaterial (edição)  | try/catch | ✅ OK                                                |
| 6   | ~481  | POST   | `/api/pcp/materiais`                       | form submit novoMaterial (criação) | try/catch | ✅ OK                                                |
| 7   | ~509  | POST   | `/api/pcp/ordens-compra`                   | form submit ordemCompra            | try/catch | ✅ OK                                                |
| 8   | ~543  | GET    | `/api/pcp/materiais`                       | `carregarMateriais()`              | try/catch | ✅ OK                                                |
| 9   | ~587  | DELETE | `/api/pcp/materiais/${id}`                 | click btn-excluir                  | try/catch | ✅ OK                                                |
| 10  | ~616  | GET    | `/api/pcp/produtos?page=&limit=`           | `carregarProdutos()`               | try/catch | ✅ OK                                                |
| 11  | ~703  | DELETE | `/api/pcp/produtos/${id}`                  | click btn-excluir-prod             | try/catch | ✅ OK                                                |
| 12  | ~746  | GET    | `/api/pcp/materiais/${id}`                 | `carregarMaterialParaEdicao()`     | try/catch | ✅ OK                                                |
| 13  | ~785  | GET    | `/api/pcp/ordens-compra`                   | `carregarOrdensDeCompra()`         | try/catch | ✅ OK                                                |
| 14  | ~818  | GET    | `/api/pcp/materiais`                       | `carregarMateriaisParaSelect()`    | try/catch | ✅ OK                                                |
| 15  | ~1087 | PUT    | `/api/pcp/produtos/${id}`                  | productForm submit (edição)        | try/catch | ✅ OK                                                |
| 16  | ~1089 | POST   | `/api/pcp/produtos`                        | productForm submit (criação)       | try/catch | ✅ OK                                                |
| 17  | ~1339 | POST   | `/api/pcp/ordens-producao`                 | orderForm submit                   | try/catch | ✅ OK                                                |
| 18  | ~1481 | GET    | `/api/pcp/produtos?q=${code}&limit=1`      | lookup produto no modal de ordem   | try/catch | ✅ OK                                                |
| 19  | ~1528 | GET    | `/api/pcp/clientes?q=${q}`                 | autocomplete de cliente            | try/catch | ✅ OK                                                |
| 20  | ~1617 | GET    | `/api/pcp/produtos/${id}`                  | `handleEditProduct()`              | try/catch | ✅ OK                                                |
| 21  | ~1801 | GET    | `/api/pcp/pedidos/${id}`                   | lookup pedido por ID               | try/catch | ✅ OK                                                |
| 22  | ~1805 | GET    | `/api/pcp/search?q=...&limit=20`           | `performSearch()`                  | .catch()  | ⛔ **QUEBRADA** — rota não existe                    |
| 23  | ~1806 | GET    | `/api/pcp/produtos?page=1&limit=20&q=...`  | `performSearch()` fallback         | .catch()  | ✅ OK                                                |
| 24  | ~1896 | GET    | `/api/pcp/pedidos/${id}`                   | `openPedidoFromSearch()`           | try/catch | ✅ OK                                                |
| 25  | ~1914 | GET    | `/api/pcp/search?q=...&type=...&limit=100` | `performSearch()`                  | try/catch | ⛔ **QUEBRADA** — rota não existe                    |
| 26  | ~1925 | GET    | `/api/pcp/pedidos/${id}`                   | pedido quick view                  | try/catch | ✅ OK                                                |
| 27  | ~2048 | GET    | `/api/pcp/me`                              | `loadCurrentUser()`                | try/catch | ✅ OK                                                |
| 28  | ~2078 | POST   | `/api/pcp/logout`                          | click btn-logout                   | try/catch | ✅ OK                                                |
| 29  | ~2104 | GET    | `/api/pcp/produtos`                        | `renderPainelCustos()`             | try/catch | ✅ OK                                                |
| 30  | ~2130 | GET    | `/api/pcp/produtos`                        | `renderPainelDashboard()`          | .catch()  | ✅ OK                                                |
| 31  | ~2131 | GET    | `/api/pcp/materiais`                       | `renderPainelDashboard()`          | .catch()  | ✅ OK                                                |
| 32  | ~2132 | GET    | `/api/pcp/ordens`                          | `renderPainelDashboard()`          | .catch()  | ✅ OK                                                |
| 33  | ~2176 | GET    | `/api/pcp/pedidos/faturados`               | `renderPainelFaturados()`          | try/catch | ✅ OK                                                |
| 34  | ~2211 | GET    | `/api/pcp/pedidos/faturados?page=&limit=`  | `openTodosFaturadosModal()`        | try/catch | ✅ OK                                                |
| 35  | ~2235 | GET    | `/api/pcp/pedidos/${id}`                   | click item faturado                | try/catch | ✅ OK                                                |
| 36  | ~2265 | GET    | `/api/pcp/pedidos/prazos?page=&limit=`     | `openTodosPrazosModal()`           | try/catch | ✅ OK                                                |
| 37  | ~2296 | GET    | `/api/pcp/pedidos/prazos`                  | `renderPainelPrazosLista()`        | try/catch | ✅ OK                                                |
| 38  | ~2315 | GET    | `/api/pcp/acompanhamento`                  | `renderPainelAcompanhamento()`     | try/catch | ✅ OK                                                |
| 39  | ~2431 | GET    | `/api/pcp/produtos`                        | `renderPCPKPIs()`                  | .catch()  | ✅ OK                                                |
| 40  | ~2432 | GET    | `/api/pcp/materiais`                       | `renderPCPKPIs()`                  | .catch()  | ✅ OK                                                |
| 41  | ~2433 | GET    | `/api/pcp/ordens`                          | `renderPCPKPIs()`                  | .catch()  | ✅ OK                                                |
| 42  | ~2512 | GET    | `/api/pcp/pedidos?page=1&limit=...`        | `renderPCPRecentOrders()`          | try/catch | ✅ OK                                                |
| 43  | ~2515 | GET    | `/api/pcp/pedidos`                         | `renderPCPRecentOrders()` fallback | try/catch | ✅ OK                                                |
| 44  | ~2573 | GET    | `/api/pcp/materiais`                       | `renderPCPLowStock()`              | try/catch | ✅ OK                                                |
| 45  | ~2613 | GET    | `/api/pcp/materiais`                       | `renderMateriaisModalList()`       | try/catch | ✅ OK                                                |
| 46  | ~2678 | POST   | `/api/pcp/materiais`                       | criar material no modal            | try/catch | ✅ OK                                                |
| 47  | ~2681 | PUT    | `/api/pcp/materiais/${editingId}`          | editar material no modal           | try/catch | ✅ OK                                                |
| 48  | ~2706 | DELETE | `/api/pcp/materiais/${id}`                 | excluir material no modal          | try/catch | ✅ OK                                                |
| 49  | ~2745 | POST   | `/api/pcp/materiais`                       | novo material no modal             | try/catch | ✅ OK                                                |

---

## 2. pcp_modern.js (4149 linhas)

**Localização:** `modules/PCP/pcp_modern.js`  
**Variável base:** `const API_BASE_URL = '/api/pcp'` (definida na L1735)

| #   | Linha | Método | URL                                    | Função / Trigger                                                           | Erro         | Status                            |
| --- | ----- | ------ | -------------------------------------- | -------------------------------------------------------------------------- | ------------ | --------------------------------- |
| 1   | ~25   | GET    | `/api/pcp/produtos?${params}`          | `buscarProdutosGestao()` (chamada na L25 do arquivo via import/referência) | try/catch    | ✅ OK                             |
| 2   | ~945  | POST   | `/api/pcp/logout`                      | `performLogout()`                                                          | .catch()     | ✅ OK                             |
| 3   | ~1735 | GET    | `/api/pcp/materiais`                   | `carregarMateriais()`                                                      | try/catch    | ✅ OK                             |
| 4   | ~1814 | GET    | `/api/pcp/produtos?page=&limit=`       | `carregarProdutos()`                                                       | try/catch    | ✅ OK                             |
| 5   | ~1951 | GET    | `/api/pcp/materiais`                   | `updateCounters()` - contadores de materiais                               | try/catch    | ✅ OK                             |
| 6   | ~1975 | GET    | `/api/pcp/produtos?page=1&limit=10000` | `updateCounters()` - contadores de produtos                                | try/catch    | ✅ OK                             |
| 7   | ~2209 | DELETE | `/api/pcp/produtos/${id}`              | `excluirProduto()` (global)                                                | .then/.catch | ✅ OK                             |
| 8   | ~2259 | GET    | `/api/pcp/produtos/catalogo`           | `gerarCatalogoProdutos()`                                                  | try/catch    | ✅ OK                             |
| 9   | ~2420 | GET    | `/api/pcp/materiais`                   | `testMateriais()`                                                          | try/catch    | ✅ OK                             |
| 10  | ~2451 | GET    | `/api/pcp/produtos?q=...&limit=10`     | `searchProducts()`                                                         | try/catch    | ✅ OK                             |
| 11  | ~2467 | GET    | `/api/pcp/produtos/${productId}`       | `getProductDetails()`                                                      | try/catch    | ✅ OK                             |
| 12  | ~2964 | POST   | `/api/pcp/produtos`                    | `salvarNovoProduto()`                                                      | try/catch    | ✅ OK                             |
| 13  | ~3008 | GET    | `/api/pcp/produtos/export-pdf`         | `exportarProdutos()`                                                       | try/catch    | ⛔ **QUEBRADA** — rota não existe |
| 14  | ~3424 | PUT    | `/api/pcp/produtos/${produtoId}`       | form submit edição produto (inline)                                        | .then/.catch | ✅ OK                             |
| 15  | ~3815 | POST   | `/api/pcp/materiais`                   | `salvarNovoMaterial()`                                                     | try/catch    | ✅ OK                             |
| 16  | ~4006 | GET    | `/api/pcp/materiais/export-pdf`        | `exportarMateriais()`                                                      | try/catch    | ⛔ **QUEBRADA** — rota não existe |

**Funções duplicadas neste arquivo (também em pcp-modals.js):**

| #   | Linha\* | Método   | URL                                           | Função                          | Status          |
| --- | ------- | -------- | --------------------------------------------- | ------------------------------- | --------------- |
| 17  | ~3600\* | GET      | `${API_BASE}/api/pcp/produtos/${produtoId}`   | `editarProdutoForm()`           | ✅ OK           |
| 18  | ~3700\* | DELETE   | `${API_BASE}/api/pcp/produtos/${produtoId}`   | `excluirProduto()` (redefinida) | ✅ OK           |
| 19  | ~3750\* | PUT/POST | `${API_BASE}/api/pcp/produtos/${produtoId}`   | `salvarProdutoPCP()`            | ✅ OK           |
| 20  | ~3850\* | GET      | `${API_BASE}/api/pcp/materiais/${materialId}` | `editarMaterial()`              | ✅ OK           |
| 21  | ~3900\* | DELETE   | `${API_BASE}/api/pcp/materiais/${id}`         | `excluirMaterial()`             | ✅ OK           |
| 22  | ~3950\* | PUT/POST | `${API_BASE}/api/pcp/materiais/${materialId}` | `salvarMaterial()`              | ✅ OK           |
| 23  | ~4050\* | GET      | `${API_BASE}/api/pcp/ordens-compra/${id}`     | `visualizarOC()`                | ⛔ **QUEBRADA** |
| 24  | ~4100\* | PUT      | `${API_BASE}/api/pcp/ordens-compra/${id}`     | `salvarEdicaoOC()`              | ⛔ **QUEBRADA** |
| 25  | ~4130\* | DELETE   | `${API_BASE}/api/pcp/ordens-compra/${id}`     | `excluirOC()`                   | ⛔ **QUEBRADA** |

> \*Linhas aproximadas — estas funções estão entre L3500 e L4149 do arquivo.

---

## 3. pcp-dashboard.js (~230 linhas)

**Localização:** `modules/PCP/js/pcp-dashboard.js`  
**Variável base:** `getAPIBase()` → retorna `''` em produção

| #   | Linha | Método | URL                                                     | Função / Trigger           | Erro      | Status                                                |
| --- | ----- | ------ | ------------------------------------------------------- | -------------------------- | --------- | ----------------------------------------------------- |
| 1   | ~28   | GET    | `/api/pcp/dashboard/stats`                              | `carregarEstatisticas()`   | try/catch | ⛔ **QUEBRADA** — rota correta é `/api/pcp/dashboard` |
| 2   | ~90   | GET    | `/api/pcp/ordens?limit=5&orderBy=created_at&order=DESC` | `carregarOrdensRecentes()` | try/catch | ✅ OK                                                 |
| 3   | ~153  | GET    | `/api/pcp/produtos?estoque_critico=true&limit=5`        | `carregarEstoqueCritico()` | try/catch | ✅ OK                                                 |

---

## 4. pcp-modals.js (~2085 linhas)

**Localização:** `modules/PCP/js/pcp-modals.js`  
**Variável base:** `getAPIBase()` → retorna `''` em produção

### Primeira metade (L1–500, lido previamente):

| #   | Linha | Método | URL                                                      | Função / Trigger                 | Erro      | Status |
| --- | ----- | ------ | -------------------------------------------------------- | -------------------------------- | --------- | ------ |
| 1   | ~165  | GET    | `/api/pcp/produtos/${produtoId}`                         | `verProduto()`                   | try/catch | ✅ OK  |
| 2   | ~337  | GET    | `/api/pcp/estoque/movimentacoes?produto_id=...&limit=20` | `carregarHistoricoProdutoView()` | try/catch | ✅ OK  |
| 3   | ~449  | PUT    | `/api/pcp/produtos/${id}`                                | `salvarEdicaoProduto()`          | try/catch | ✅ OK  |

### Segunda metade (L500–2085):

| #   | Linha   | Método   | URL                                | Função / Trigger      | Erro      | Status          |
| --- | ------- | -------- | ---------------------------------- | --------------------- | --------- | --------------- |
| 4   | ~909\*  | GET      | `/api/pcp/produtos/${produtoId}`   | `editarProdutoForm()` | try/catch | ✅ OK           |
| 5   | ~1115\* | PUT/POST | `/api/pcp/produtos/${produtoId}`   | `salvarProdutoPCP()`  | try/catch | ✅ OK           |
| 6   | ~1203\* | DELETE   | `/api/pcp/produtos/${produtoId}`   | `excluirProduto()`    | try/catch | ✅ OK           |
| 7   | ~1412\* | GET      | `/api/pcp/materiais/${materialId}` | `editarMaterial()`    | try/catch | ✅ OK           |
| 8   | ~1483\* | PUT/POST | `/api/pcp/materiais/${materialId}` | `salvarMaterial()`    | try/catch | ✅ OK           |
| 9   | ~1535\* | DELETE   | `/api/pcp/materiais/${id}`         | `excluirMaterial()`   | try/catch | ✅ OK           |
| 10  | ~1638\* | GET      | `/api/pcp/ordens-compra/${id}`     | `visualizarOC()`      | try/catch | ⛔ **QUEBRADA** |
| 11  | ~1853\* | PUT      | `/api/pcp/ordens-compra/${id}`     | `salvarEdicaoOC()`    | try/catch | ⛔ **QUEBRADA** |
| 12  | ~1885\* | DELETE   | `/api/pcp/ordens-compra/${id}`     | `excluirOC()`         | try/catch | ⛔ **QUEBRADA** |

> \*Linhas aproximadas — baseadas na posição no output lido.

---

## 5. pcp-common.js (~600 linhas)

**Localização:** `modules/PCP/js/pcp-common.js`  
**Variável base:** `getAPIBase()` → `''` em produção, `'http://localhost:3000'` em dev

| #   | Linha | Método | URL                      | Função / Trigger                     | Erro      | Status |
| --- | ----- | ------ | ------------------------ | ------------------------------------ | --------- | ------ |
| 1   | ~50   | GET    | `/api/me`                | `atualizarSaudacao()`                | try/catch | ✅ OK  |
| 2   | ~322  | GET    | `/api/me`                | `verificarAuth()`                    | .catch()  | ✅ OK  |
| 3   | ~354  | \*     | `url` (wrapper genérico) | `fetchAuth()` — interceptor para 401 | auto      | ✅ OK  |
| 4   | ~516  | GET    | `/api/pcp/alertas`       | `pcpCarregarNotificacoes()`          | try/catch | ✅ OK  |
| 5   | ~562  | GET    | `/api/pcp/alertas`       | `pcpCarregarBadge()`                 | try/catch | ✅ OK  |

---

## 6. producao-faturamento.js (736 linhas)

**Localização:** `modules/PCP/producao-faturamento.js`

| #   | Linha | Método | URL                              | Função / Trigger       | Erro      | Status |
| --- | ----- | ------ | -------------------------------- | ---------------------- | --------- | ------ |
| 1   | ~46   | GET    | `/api/pcp/ordens-producao`       | `loadOrdensProducao()` | try/catch | ✅ OK  |
| 2   | ~207  | GET    | `/api/pcp/faturamentos`          | `loadFaturamentos()`   | try/catch | ✅ OK  |
| 3   | ~518  | POST   | `/api/pcp/ordens-producao`       | `salvarNovaOrdem()`    | try/catch | ✅ OK  |
| 4   | ~644  | PUT    | `/api/pcp/ordens-producao/${id}` | `salvarProgresso()`    | try/catch | ✅ OK  |
| 5   | ~704  | PUT    | `/api/pcp/ordens-producao/${id}` | `salvarEdicaoOrdem()`  | try/catch | ✅ OK  |

---

## 7. materiais-functions.js (1189 linhas)

**Localização:** `modules/PCP/materiais-functions.js`  
**Formato:** IIFE — todas funções são locais, exportadas via `window.*`

| #   | Linha  | Método | URL                                    | Função / Trigger                             | Erro      | Status       |
| --- | ------ | ------ | -------------------------------------- | -------------------------------------------- | --------- | ------------ |
| 1   | ~111   | GET    | `/api/pcp/materiais`                   | `loadMateriais()`                            | try/catch | ✅ OK        |
| 2   | ~143   | GET    | `/api/pcp/produtos?page=1&limit=10000` | `loadProdutos()`                             | try/catch | ✅ OK        |
| 3   | ~701\* | PUT    | `/api/pcp/materiais/${id}`             | `editarMaterial()` (código comentado/backup) | try/catch | ⚠️ COMENTADO |
| 4   | ~730   | DELETE | `/api/pcp/materiais/${id}`             | `excluirMaterial()`                          | try/catch | ✅ OK        |
| 5   | ~952\* | PUT    | `/api/pcp/produtos/${id}`              | `editarProduto_OLD_MATERIALFUNC()` (backup)  | try/catch | ⚠️ COMENTADO |
| 6   | ~1114  | DELETE | `/api/pcp/produtos/${id}`              | `excluirProduto()` confirm + fetch           | try/catch | ✅ OK        |

> Linhas 701 e 952 contêm código antigo comentado — os fetch calls dentro deles NÃO são executados.

---

## 8. busca-estoque.js (610 linhas)

**Localização:** `modules/PCP/busca-estoque.js`  
**Variável base:** `const API_BASE_URL = '/api/pcp'`  
**Formato:** IIFE

| #   | Linha | Método | URL                            | Função / Trigger            | Erro      | Status |
| --- | ----- | ------ | ------------------------------ | --------------------------- | --------- | ------ |
| 1   | ~25   | GET    | `/api/pcp/produtos?limit=1000` | `buscarProdutosAvancado()`  | try/catch | ✅ OK  |
| 2   | ~235  | GET    | `/api/pcp/produtos?limit=1000` | `verificarAlertasEstoque()` | try/catch | ✅ OK  |
| 3   | ~403  | GET    | `/api/pcp/produtos?limit=1000` | `buscarProdutosGestao()`    | try/catch | ✅ OK  |

---

## 9. ordens-compra.js (~500 linhas)

**Localização:** `modules/PCP/ordens-compra.js`  
**Formato:** IIFE

| #   | Linha | Método | URL                            | Função / Trigger            | Erro      | Status          |
| --- | ----- | ------ | ------------------------------ | --------------------------- | --------- | --------------- |
| 1   | ~46   | GET    | `/api/pcp/materiais`           | `carregarMateriaisCompra()` | try/catch | ✅ OK           |
| 2   | ~70   | GET    | `/api/pcp/ordens-compra`       | `loadOrdensCompra()`        | try/catch | ✅ OK           |
| 3   | ~306  | POST   | `/api/pcp/ordens-compra`       | `salvarNovaOrdemCompra()`   | try/catch | ✅ OK           |
| 4   | ~340  | DELETE | `/api/pcp/ordens-compra/${id}` | `excluirOrdemCompra()`      | try/catch | ⛔ **QUEBRADA** |

---

## 10. modal-produto-enriquecido.js (~500 linhas)

**Localização:** `modules/PCP/modal-produto-enriquecido.js`  
**Formato:** IIFE

| #   | Fetch calls                                                                  | Status |
| --- | ---------------------------------------------------------------------------- | ------ |
| —   | **NENHUM** — este arquivo é puramente UI (abas, validação, cards, progresso) | ✅ OK  |

---

## 11. pcp-integration.js (~500 linhas)

**Localização:** `modules/PCP/pcp-integration.js`  
**Formato:** IIFE — intercepta `window.fetch` globalmente

| #   | Linha | Método | URL                                                                                                | Função / Trigger                      | Erro     | Status                                       |
| --- | ----- | ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------- | -------- | -------------------------------------------- |
| 1   | ~254  | GET    | `/api/pcp/produtos/${productId}`                                                                   | `handleDelete()` via event delegation | implicit | ✅ OK                                        |
| 2   | ~299  | DELETE | `/api/pcp/produtos/${itemId}` _OU_ `/api/pcp/materiais/${itemId}` _OU_ `/api/pcp/ordens/${itemId}` | `handleDelete()` — endpoint dinâmico  | implicit | ⚠️ DELETE `/api/pcp/ordens/:id` **QUEBRADA** |

**Nota crítica:** Este arquivo intercepta TODAS as chamadas `fetch()` via wrapper de `window.fetch` para invalidação automática de cache (seção 7, L~230). Toda chamada POST/PUT/DELETE que contenha `/materiais`, `/produtos`, `/ordens` ou `/pedidos` na URL dispara invalidação de cache.

---

## DETALHAMENTO DAS ROTAS QUEBRADAS

### 1. `GET /api/pcp/search` — NÃO EXISTE

**Arquivos afetados:** pcp.js  
**Linhas:** ~L1805, ~L1914  
**Impacto:** A busca global do PCP tenta primeiro essa rota; como ela falha, cai no fallback (`/api/pcp/produtos?q=...`), que funciona. O usuário pode ver um erro no console mas a busca funciona via fallback.  
**Correção sugerida:** Remover a chamada a `/api/pcp/search` e usar diretamente o fallback, OU criar a rota no backend.

### 2. `GET /api/pcp/dashboard/stats` — NÃO EXISTE

**Arquivos afetados:** pcp-dashboard.js  
**Linha:** ~L28  
**Impacto:** A função `carregarEstatisticas()` falha silenciosamente (try/catch). O painel de dashboard não carrega estatísticas.  
**Correção sugerida:** Alterar a URL para `/api/pcp/dashboard` (rota que existe) ou criar `/api/pcp/dashboard/stats`.

### 3. `GET/PUT/DELETE /api/pcp/ordens-compra/:id` — NÃO EXISTEM

**Arquivos afetados:**

- pcp-modals.js (js/) — `visualizarOC()`, `salvarEdicaoOC()`, `excluirOC()`
- pcp_modern.js — mesmas funções duplicadas
- ordens-compra.js — `excluirOrdemCompra()`

**Impacto:** Não é possível visualizar detalhe, editar nem excluir ordens de compra individuais. O `GET /api/pcp/ordens-compra` (lista) funciona, mas operações em recurso individual falham.  
**Correção sugerida:** Implementar as rotas `GET/PUT/DELETE /api/pcp/ordens-compra/:id` no backend.

### 4. `GET /api/pcp/produtos/export-pdf` — NÃO EXISTE

**Arquivos afetados:** pcp_modern.js  
**Linha:** ~L3008  
**Impacto:** Botão "Exportar PDF" de produtos não funciona — o download falha.  
**Correção sugerida:** Implementar a rota no backend ou remover o botão.

### 5. `GET /api/pcp/materiais/export-pdf` — NÃO EXISTE

**Arquivos afetados:** pcp_modern.js  
**Linha:** ~L4006  
**Impacto:** Botão "Exportar PDF" de materiais não funciona.  
**Correção sugerida:** Implementar a rota no backend ou remover o botão.

### 6. `PUT /api/pcp/ordens/:id/status` — NÃO EXISTE

**Arquivos afetados:** pcp.js  
**Linha:** ~L418  
**Impacto:** Drag-and-drop no kanban de ordens de produção falha ao tentar atualizar o status.  
**Correção sugerida:** Implementar `PUT /api/pcp/ordens/:id` ou `/api/pcp/ordens/:id/status` no backend.

---

## FUNÇÕES JS POTENCIALMENTE INDEFINIDAS

| Função chamada                     | Arquivo que chama                                                 | Onde deveria estar definida                                                                                                      | Risco                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `window.abrirModalEditarProduto()` | pcp_modern.js (L2041, L2057), materiais-functions.js (L701, L790) | Deve ser exportada por pcp-modals.js ou outro arquivo — existe como `editarProdutoForm()` mas NÃO como `abrirModalEditarProduto` | **ALTO** — se o arquivo que define essa função não for carregado primeiro, clique em "Editar" falha |
| `window.searchMaterials()`         | pcp_modern.js (L2900\*)                                           | Não encontrada em nenhum arquivo auditado                                                                                        | **BAIXO** — apenas called se o input existir                                                        |
| `window.searchPurchaseOrders()`    | pcp_modern.js (L2930\*)                                           | Não encontrada em nenhum arquivo auditado                                                                                        | **BAIXO** — apenas called se o input existir                                                        |
| `buscarProdutos()`                 | pcp-modals.js (exports, reloads)                                  | Definida em busca-estoque.js como `buscarProdutosGestao` mas NÃO como `buscarProdutos`                                           | **MÉDIO** — pode causar erro ao salvar produto                                                      |
| `buscarMateriais()`                | pcp-modals.js (exports, reloads)                                  | Não encontrada com esse nome exato                                                                                               | **MÉDIO** — pode causar erro ao salvar material                                                     |

---

## DUPLICAÇÃO DE FUNÇÕES ENTRE ARQUIVOS

A seguinte tabela mostra funções que são definidas em múltiplos arquivos, causando potenciais conflitos de sobrescrita:

| Função                       | Definida em                                                  | Comportamento                                                                 |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `window.editarProduto()`     | pcp.js, pcp_modern.js, materiais-functions.js                | Todas redirecionam para `abrirModalEditarProduto()` — última a carregar vence |
| `window.excluirProduto()`    | pcp.js, pcp_modern.js, materiais-functions.js, pcp-modals.js | Implementações ligeiramente diferentes — risco de comportamento inconsistente |
| `window.editarMaterial()`    | pcp.js, pcp_modern.js, materiais-functions.js, pcp-modals.js | Comportamento varia (algumas redireciona, outras abrem modal inline)          |
| `window.excluirMaterial()`   | pcp.js, pcp_modern.js, materiais-functions.js, pcp-modals.js | Mesma rota de API mas UX diferente                                            |
| `window.carregarMateriais()` | pcp_modern.js, materiais-functions.js                        | Ambas fazem GET /api/pcp/materiais mas renderizam em containers diferentes    |
| `window.carregarProdutos()`  | pcp_modern.js, materiais-functions.js                        | Ambas buscam da API; pcp-integration.js wrapa com cache                       |
| `showToast()`                | pcp_modern.js, materiais-functions.js, pcp-common.js         | Implementações separadas — a de pcp-integration.js wrapa com pcpNotifications |

---

## IDS HTML REFERENCIADOS MAS POTENCIALMENTE AUSENTES

Estes IDs são referenciados por `getElementById()` nos JS auditados. Se o HTML correspondente não os definir, o código falha silenciosamente (a maioria tem null-checks):

| ID                                                | Arquivo que referencia                                  | Contexto                                                                            |
| ------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `tabela-materiais-container`                      | pcp_modern.js, materiais-functions.js                   | Container para renderizar tabela de materiais                                       |
| `tabela-produtos-container`                       | pcp_modern.js, materiais-functions.js, busca-estoque.js | Container para tabela de produtos                                                   |
| `tabela-produtos-gestao-container`                | pcp_modern.js, busca-estoque.js                         | Container na seção Gestão de Produtos                                               |
| `product-details-modal`                           | pcp_modern.js                                           | Modal de detalhes do produto                                                        |
| `modal-editar-produto`                            | pcp_modern.js, modal-produto-enriquecido.js             | Modal de edição (criado dinamicamente se não existir)                               |
| `modal-novo-produto`                              | pcp_modern.js, pcp-modals.js                            | Modal para novo/editar produto (estilo Omie)                                        |
| `modal-material-professional`                     | pcp_modern.js                                           | Modal profissional de material                                                      |
| `modal-nova-ordem-compra`                         | ordens-compra.js                                        | Modal de nova ordem de compra                                                       |
| `modal-movimentacao-estoque`                      | pcp-modals.js                                           | Modal de movimentação de estoque                                                    |
| `stat-materiais`, `stat-produtos`, `stat-alertas` | materiais-functions.js                                  | Cards de estatísticas na view de materiais                                          |
| `notification-count`                              | busca-estoque.js                                        | Badge de contagem de notificações                                                   |
| `confirm-modal-overlay`                           | pcp_modern.js                                           | Modal de confirmação profissional — fallback para `confirm()` nativo se não existir |

---

## MAPA RESUMO — ENDPOINTS UTILIZADOS vs EXISTÊNCIA

| Endpoint                         | Método | Existe? | Arquivos que usam                                               |
| -------------------------------- | ------ | ------- | --------------------------------------------------------------- |
| `/api/pcp/produtos`              | GET    | ✅      | pcp.js, pcp_modern.js, materiais-functions.js, busca-estoque.js |
| `/api/pcp/produtos`              | POST   | ✅      | pcp.js, pcp_modern.js, pcp-modals.js                            |
| `/api/pcp/produtos/:id`          | GET    | ✅      | pcp.js, pcp_modern.js, pcp-modals.js, pcp-integration.js        |
| `/api/pcp/produtos/:id`          | PUT    | ✅      | pcp.js, pcp_modern.js, pcp-modals.js                            |
| `/api/pcp/produtos/:id`          | DELETE | ✅      | pcp.js, pcp_modern.js, materiais-functions.js, pcp-modals.js    |
| `/api/pcp/produtos/catalogo`     | GET    | ✅      | pcp_modern.js                                                   |
| `/api/pcp/produtos/export-pdf`   | GET    | ⛔      | pcp_modern.js                                                   |
| `/api/pcp/materiais`             | GET    | ✅      | pcp.js, pcp_modern.js, materiais-functions.js, ordens-compra.js |
| `/api/pcp/materiais`             | POST   | ✅      | pcp.js, pcp_modern.js, pcp-modals.js                            |
| `/api/pcp/materiais/:id`         | GET    | ✅      | pcp.js, pcp-modals.js                                           |
| `/api/pcp/materiais/:id`         | PUT    | ✅      | pcp.js, pcp-modals.js                                           |
| `/api/pcp/materiais/:id`         | DELETE | ✅      | pcp.js, materiais-functions.js, pcp-modals.js                   |
| `/api/pcp/materiais/export-pdf`  | GET    | ⛔      | pcp_modern.js                                                   |
| `/api/pcp/ordens`                | GET    | ✅      | pcp.js                                                          |
| `/api/pcp/ordens`                | POST   | ✅      | pcp.js                                                          |
| `/api/pcp/ordens/:id/status`     | PUT    | ⛔      | pcp.js                                                          |
| `/api/pcp/ordens/:id`            | DELETE | ⛔      | pcp-integration.js                                              |
| `/api/pcp/ordens-compra`         | GET    | ✅      | pcp.js, ordens-compra.js                                        |
| `/api/pcp/ordens-compra`         | POST   | ✅      | pcp.js, ordens-compra.js                                        |
| `/api/pcp/ordens-compra/:id`     | GET    | ⛔      | pcp-modals.js, pcp_modern.js                                    |
| `/api/pcp/ordens-compra/:id`     | PUT    | ⛔      | pcp-modals.js, pcp_modern.js                                    |
| `/api/pcp/ordens-compra/:id`     | DELETE | ⛔      | pcp-modals.js, pcp_modern.js, ordens-compra.js                  |
| `/api/pcp/ordens-producao`       | GET    | ✅      | producao-faturamento.js                                         |
| `/api/pcp/ordens-producao`       | POST   | ✅      | pcp.js, producao-faturamento.js                                 |
| `/api/pcp/ordens-producao/:id`   | PUT    | ✅      | producao-faturamento.js                                         |
| `/api/pcp/pedidos`               | GET    | ✅      | pcp.js                                                          |
| `/api/pcp/pedidos/:id`           | GET    | ✅      | pcp.js                                                          |
| `/api/pcp/pedidos/faturados`     | GET    | ✅      | pcp.js                                                          |
| `/api/pcp/pedidos/prazos`        | GET    | ✅      | pcp.js                                                          |
| `/api/pcp/faturamentos`          | GET    | ✅      | producao-faturamento.js                                         |
| `/api/pcp/clientes?q=`           | GET    | ✅      | pcp.js                                                          |
| `/api/pcp/dashboard/stats`       | GET    | ⛔      | pcp-dashboard.js                                                |
| `/api/pcp/dashboard`             | GET    | ✅      | (rota correta, não usada no frontend!)                          |
| `/api/pcp/search`                | GET    | ⛔      | pcp.js                                                          |
| `/api/pcp/acompanhamento`        | GET    | ✅      | pcp.js                                                          |
| `/api/pcp/alertas`               | GET    | ✅      | pcp-common.js                                                   |
| `/api/pcp/estoque/movimentacoes` | GET    | ✅      | pcp-modals.js                                                   |
| `/api/me`                        | GET    | ✅      | pcp-common.js                                                   |
| `/api/pcp/me`                    | GET    | ✅      | pcp.js                                                          |
| `/api/pcp/logout`                | POST   | ✅      | pcp.js, pcp_modern.js                                           |

---

## RECOMENDAÇÕES

### Prioridade ALTA (Funcionalidade quebrada)

1. **Criar rotas CRUD para `/api/pcp/ordens-compra/:id`** (GET, PUT, DELETE) — Impacta visualização, edição e exclusão de OCs
2. **Corrigir URL do dashboard** em pcp-dashboard.js: trocar `/api/pcp/dashboard/stats` → `/api/pcp/dashboard`
3. **Implementar `/api/pcp/ordens/:id`** (PUT para atualizar status) — Kanban de produção não funciona

### Prioridade MÉDIA (Funcionalidade parcialmente quebrada)

4. **Remover chamadas a `/api/pcp/search`** em pcp.js — A busca já tem fallback funcional, mas gera erros no console
5. **Implementar `/api/pcp/produtos/export-pdf`** e `/api/pcp/materiais/export-pdf`\*\* — Ou remover botões de exportação

### Prioridade BAIXA (Dívida técnica)

6. **Resolver duplicação massiva de funções** entre pcp_modern.js e pcp-modals.js — 10+ funções duplicadas
7. **Padronizar o nome de `abrirModalEditarProduto`** — Chamado em 4 arquivos mas definido com nomes diferentes
8. **Consolidar implementações de `showToast()`** — 3 implementações diferentes
9. **Remover código comentado/backup** (funções `*_OLD_BACKUP`, `*_OLD_MATERIALFUNC`) em pcp_modern.js e materiais-functions.js
