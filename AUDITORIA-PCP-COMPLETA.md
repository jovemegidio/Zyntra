# AUDITORIA COMPLETA DO MÓDULO PCP — ALUFORCE V.2

**Data:** Junho 2025  
**Escopo:** Todos os botões, event handlers, chamadas de API do frontend × rotas do backend  
**Arquivos analisados:**

| Arquivo                                                                                                                                                                              | Tipo           | Linhas | Status                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------ | -------------------------------------- |
| `modules/PCP/js/pcp.js`                                                                                                                                                              | Frontend JS    | 2759   | ✅ Leitura completa                    |
| `modules/PCP/js/pcp_modern.js`                                                                                                                                                       | Frontend JS    | 4149   | ✅ Leitura completa                    |
| `modules/PCP/js/pcp-modals.js`                                                                                                                                                       | Frontend JS    | 2085   | ✅ Leitura completa                    |
| `modules/PCP/js/pcp-dashboard.js`                                                                                                                                                    | Frontend JS    | ~236   | ✅ Leitura completa                    |
| `modules/PCP/js/pcp-common.js`                                                                                                                                                       | Frontend JS    | 594    | ✅ Leitura completa                    |
| `modules/PCP/producao-faturamento.js`                                                                                                                                                | Frontend JS    | ~750   | ✅ Leitura completa                    |
| `modules/PCP/ordens-compra.js`                                                                                                                                                       | Frontend JS    | ~400   | ✅ Leitura completa                    |
| `routes/pcp-routes.js`                                                                                                                                                               | Backend Router | 10892  | ✅ Todas as rotas catalogadas via grep |
| `modules/PCP/index_new.html`                                                                                                                                                         | HTML           | —      | ✅ Botões catalogados via grep         |
| `modules/PCP/ordens-producao.html`                                                                                                                                                   | HTML           | —      | ✅ Botões catalogados via grep         |
| Outros JS (pcp-correcoes, pcp-integration, pcp-optimizations, pcp-contadores, busca-estoque, materiais-functions, login, usuario-system, auth-check-pcp, auth-redirect, mobile/scan) | Frontend JS    | —      | ✅ Fetch calls catalogados via grep    |

---

## RESUMO EXECUTIVO

| Métrica                                     | Valor        |
| ------------------------------------------- | ------------ |
| Total de botões/ações mapeados              | **180+**     |
| Total de chamadas `fetch()` no frontend     | **136**      |
| Total de rotas no backend (`pcp-routes.js`) | **150+**     |
| **ERROS CRÍTICOS encontrados**              | **15**       |
| **AVISOS (warnings)**                       | **8**        |
| Rotas duplicadas no backend                 | **7 grupos** |
| Endpoints frontend sem rota backend         | **11**       |

---

## 1. INVENTÁRIO DE BOTÕES/AÇÕES POR PÁGINA

### 1.1 Dashboard (pcp.js)

| Botão/Ação            | ID / Seletor                  | Função JS                                              | Endpoint API                                                   | Método |
| --------------------- | ----------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | ------ |
| Toggle Menu           | `btn-toggle-menu`             | `toggleSidebar()`                                      | — (UI)                                                         | —      |
| Logout                | `btn-logout`                  | `POST /api/pcp/logout`                                 | `/api/pcp/logout`                                              | POST   |
| Brand Logo            | `brand-logo` / `logo-sidebar` | `showView('dashboard')`                                | — (UI)                                                         | —      |
| Refresh               | `pcp-refresh`                 | `carregarOrdens()` + `carregarMateriais()`             | `/api/pcp/ordens` + `/api/pcp/materiais`                       | GET    |
| Dashboard Nav         | `.nav-link[dashboard]`        | `showView('dashboard')`                                | — (UI)                                                         | —      |
| Nova Ordem Nav        | `.nav-link[novaOrdem]`        | `showView('novaOrdem')`                                | — (UI)                                                         | —      |
| Materiais Nav         | `.nav-link[materiais]`        | `showView('materiais')` + `carregarMateriais()`        | `/api/pcp/materiais`                                           | GET    |
| Ordem Compra Nav      | `.nav-link[ordemCompra]`      | `showView('ordemCompra')` + `carregarOrdensDeCompra()` | `/api/pcp/ordens-compra`                                       | GET    |
| Controle Produção Nav | `.nav-link[controleProducao]` | `showView('controleProducao')`                         | — (UI)                                                         | —      |
| Faturamento Nav       | `.nav-link[faturamento]`      | `showView('faturamento')`                              | — (UI)                                                         | —      |
| Busca Principal       | `main-search-input`           | `handleMainSearch()`                                   | `/api/pcp/search?q=&type=&limit=`                              | GET    |
| Ver Todos Faturados   | `btn-open-todos-faturados`    | `openTodosFaturadosModal()`                            | `/api/pcp/pedidos/faturados?page=&limit=`                      | GET    |
| Ver Todos Prazos      | `btn-open-todos-prazos`       | `openTodosPrazosModal()`                               | `/api/pcp/pedidos/prazos?page=&limit=`                         | GET    |
| Painel Custos         | renderPainelCustos            | auto-render                                            | `/api/pcp/produtos`                                            | GET    |
| Painel Faturados      | renderPainelFaturados         | auto-render                                            | `/api/pcp/pedidos/faturados`                                   | GET    |
| Painel Prazos         | renderPainelPrazosLista       | auto-render                                            | `/api/pcp/pedidos/prazos`                                      | GET    |
| Painel Acompanhamento | renderPainelAcompanhamento    | auto-render                                            | `/api/pcp/acompanhamento`                                      | GET    |
| KPIs                  | renderPCPKPIs                 | auto-render                                            | `/api/pcp/ordens` + `/api/pcp/materiais` + `/api/pcp/produtos` | GET    |

### 1.2 Kanban Board (pcp.js)

| Botão/Ação        | ID / Seletor           | Função JS                 | Endpoint API                  | Método |
| ----------------- | ---------------------- | ------------------------- | ----------------------------- | ------ |
| Drag & Drop Card  | `.kanban-card` dragend | handler inline            | `/api/pcp/ordens/{id}/status` | PUT    |
| Quick View Pedido | card click             | `openPedidoQuickView(id)` | `/api/pcp/pedidos/{id}`       | GET    |

### 1.3 Formulário Nova Ordem (pcp.js)

| Botão/Ação              | ID / Seletor                | Função JS        | Endpoint API               | Método |
| ----------------------- | --------------------------- | ---------------- | -------------------------- | ------ |
| Submit Nova Ordem       | `form-nova-ordem` submit    | handler          | `/api/pcp/ordens`          | POST   |
| Submit Ordem Produção   | form submit                 | handler          | `/api/pcp/ordens-producao` | POST   |
| Client Autocomplete     | `client-search` input       | debounce handler | `/api/pcp/clientes?q=`     | GET    |
| Adicionar Produto Linha | `adicionarProdutoLinha()`   | onclick HTML     | — (UI)                     | —      |
| Remover Produto Linha   | `removerProdutoLinha(this)` | onclick HTML     | — (UI)                     | —      |

### 1.4 Produtos/Estoque (pcp.js + pcp_modern.js + pcp-modals.js)

| Botão/Ação             | ID / Seletor                                   | Função JS                                        | Endpoint API                                            | Método |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- | ------ |
| Novo Produto           | `btn-novo-produto` / `pcp-new-product`         | `abrirModalNovoProduto()` / `abrirNovoProduto()` | — (UI modal)                                            | —      |
| Salvar Produto (novo)  | form submit                                    | `salvarNovoProduto()` / `salvarProdutoPCP()`     | `/api/pcp/produtos`                                     | POST   |
| Editar Produto         | `onclick="editarProduto(id)"`                  | `editarProduto(id)`                              | `/api/pcp/produtos/{id}`                                | GET    |
| Salvar Edição          | form submit                                    | `salvarEdicaoProduto()`                          | `/api/pcp/produtos/{id}`                                | PUT    |
| Excluir Produto        | `onclick="excluirProduto(id)"`                 | `excluirProduto(id)`                             | `/api/pcp/produtos/{id}`                                | DELETE |
| Ver Produto            | `onclick="verProduto(id)"`                     | `verProduto(id)`                                 | `/api/pcp/produtos/{id}`                                | GET    |
| Buscar Produtos        | search input / `buscarProdutosGestao()`        | handler                                          | `/api/pcp/produtos?q=&categoria=&estoque=&page=&limit=` | GET    |
| Exportar PDF           | `exportarProdutos()`                           | button onclick                                   | `/api/pcp/produtos/export-pdf`                          | GET    |
| Gerar Catálogo         | `btn-gerar-catalogo`                           | `gerarCatalogoProdutos()`                        | `/api/pcp/produtos/catalogo`                            | GET    |
| Duplicar Produto       | sidebar button                                 | `duplicarProdutoPCP()`                           | — (stub/UI)                                             | —      |
| Inativar Produto       | sidebar button                                 | `inativarProdutoPCP()`                           | — (stub/UI)                                             | —      |
| Product Details Modal  | card click                                     | `openProductDetailsModal(id)`                    | `/api/pcp/produtos/{id}`                                | GET    |
| Histórico Produto View | toggle button                                  | `carregarHistoricoProdutoView(id)`               | `/api/pcp/estoque/movimentacoes?produto_id=&limit=`     | GET    |
| Refresh Header         | `btn-refresh-header`                           | `location.reload()`                              | —                                                       | —      |
| Dark Mode Toggle       | `btn-dark-mode-toggle`                         | `toggleDarkMode()`                               | — (UI)                                                  | —      |
| Preview Produto        | `btn-preview-produto`                          | UI handler                                       | — (UI)                                                  | —      |
| Cancelar Edição        | `close-editar-produto` / `btn-cancelar-edicao` | close modal                                      | — (UI)                                                  | —      |

### 1.5 Materiais (pcp.js + pcp_modern.js + pcp-modals.js)

| Botão/Ação             | ID / Seletor                                 | Função JS                                   | Endpoint API                    | Método |
| ---------------------- | -------------------------------------------- | ------------------------------------------- | ------------------------------- | ------ |
| Abrir Modal Materiais  | `btn-open-materiais-modal`                   | handler                                     | `/api/pcp/materiais`            | GET    |
| Novo Material          | `materiais-new` / `abrirModalNovoMaterial()` | handler                                     | — (UI modal)                    | —      |
| Salvar Material (novo) | form submit                                  | `salvarNovoMaterial()` / `salvarMaterial()` | `/api/pcp/materiais`            | POST   |
| Editar Material        | `onclick="editarMaterial(id)"`               | `editarMaterial(id)`                        | `/api/pcp/materiais/{id}`       | GET    |
| Salvar Edição Material | form submit                                  | `salvarMaterial()`                          | `/api/pcp/materiais/{id}`       | PUT    |
| Excluir Material       | `onclick="excluirMaterial(id)"`              | `excluirMaterial(id)`                       | `/api/pcp/materiais/{id}`       | DELETE |
| Exportar Materiais PDF | `exportarMateriais()`                        | button onclick                              | `/api/pcp/materiais/export-pdf` | GET    |
| Reload Materiais       | `btn-reload-materiais`                       | `carregarMateriais()`                       | `/api/pcp/materiais`            | GET    |
| Refresh Header Mat.    | `btn-refresh-header-materiais`               | `location.reload()`                         | —                               | —      |
| Dark Mode Mat.         | `btn-dark-mode-toggle-materiais`             | `toggleDarkMode()`                          | — (UI)                          | —      |
| Logout Mat.            | `btn-logout-materiais`                       | `performLogout()`                           | `/api/pcp/logout`               | POST   |

### 1.6 Ordens de Compra (pcp.js + ordens-compra.js + pcp-modals.js)

| Botão/Ação                | ID / Seletor                                               | Função JS                     | Endpoint API                  | Método |
| ------------------------- | ---------------------------------------------------------- | ----------------------------- | ----------------------------- | ------ |
| Submit Ordem Compra       | `form-ordem-compra` submit                                 | handler                       | `/api/pcp/ordens-compra`      | POST   |
| Carregar OCs              | auto / initOrdensCompra                                    | `loadOrdensCompra()`          | `/api/pcp/ordens-compra`      | GET    |
| Nova Ordem Compra         | `btn-nova-ordem-compra`                                    | `abrirModalNovaOrdemCompra()` | — (UI modal)                  | —      |
| Salvar Nova OC            | `form-nova-ordem-compra` submit                            | `salvarNovaOrdemCompra()`     | `/api/pcp/ordens-compra`      | POST   |
| Visualizar OC             | `onclick="visualizarOrdemCompra(id)"` / `visualizarOC(id)` | handler                       | `/api/pcp/ordens-compra/{id}` | GET    |
| Editar OC                 | `onclick="editarOrdemCompra(id)"` / `editarOC(id)`         | handler                       | — (stub em ordens-compra.js)  | —      |
| Salvar Edição OC          | `salvarEdicaoOC()`                                         | handler (pcp-modals.js)       | `/api/pcp/ordens-compra/{id}` | PUT    |
| Excluir OC                | `onclick="excluirOrdemCompra(id)"` / `excluirOC(id)`       | handler                       | `/api/pcp/ordens-compra/{id}` | DELETE |
| Carregar Materiais Select | auto                                                       | `carregarMateriaisCompra()`   | `/api/pcp/materiais`          | GET    |
| Filtrar OCs               | `.filter-btn` click                                        | `filtrarOrdensCompra(status)` | — (client-side)               | —      |

### 1.7 Controle de Produção (producao-faturamento.js)

| Botão/Ação          | ID / Seletor                                 | Função JS                   | Endpoint API                    | Método |
| ------------------- | -------------------------------------------- | --------------------------- | ------------------------------- | ------ |
| Nova Ordem Produção | `btn-nova-ordem-producao`                    | `abrirModalNovaOrdem()`     | — (UI modal)                    | —      |
| Salvar Nova Ordem   | `form-nova-ordem` submit                     | `salvarNovaOrdem()`         | `/api/pcp/ordens-producao`      | POST   |
| Filtros Status      | `.production-filters .filter-btn`            | `renderOrdensProducao()`    | — (client-side)                 | —      |
| Busca Produção      | `search-producao` input                      | `buscarProducao()`          | — (client-side)                 | —      |
| Visualizar Ordem    | `onclick="window.visualizarOrdem(id)"`       | `visualizarOrdem(id)`       | — (client-side)                 | —      |
| Atualizar Progresso | `onclick="window.abrirModalProgresso(id)"`   | `abrirModalProgresso(id)`   | — (UI modal)                    | —      |
| Salvar Progresso    | `form-atualizar-progresso` submit            | `salvarProgresso()`         | `/api/pcp/ordens-producao/{id}` | PUT    |
| Editar Ordem        | `onclick="window.abrirModalEditarOrdem(id)"` | `abrirModalEditarOrdem(id)` | — (UI modal)                    | —      |
| Salvar Edição Ordem | `form-editar-ordem` submit                   | `salvarEdicaoOrdem()`       | `/api/pcp/ordens-producao/{id}` | PUT    |

### 1.8 Programação de Faturamento (producao-faturamento.js)

| Botão/Ação           | ID / Seletor                   | Função JS                     | Endpoint API    | Método |
| -------------------- | ------------------------------ | ----------------------------- | --------------- | ------ |
| Novo Faturamento     | `btn-novo-faturamento`         | `abrirModalNovoFaturamento()` | — (stub)        | —      |
| Gerar NF-e           | `btn-gerar-nfe`                | `abrirModalGerarNFe()`        | — (stub)        | —      |
| Mês Anterior         | `btn-prev-month`               | `changeMonth(-1)`             | — (UI)          | —      |
| Mês Seguinte         | `btn-next-month`               | `changeMonth(1)`              | — (UI)          | —      |
| Filtros Status       | `.billing-filters .filter-btn` | `renderFaturamentos()`        | — (client-side) | —      |
| Ver Faturamento      | billing item click             | `visualizarFaturamento(id)`   | — (stub)        | —      |
| Ver Faturamentos Dia | calendar day click             | `verFaturamentosDia(date)`    | — (stub)        | —      |

### 1.9 Ordens de Produção — Kanban (ordens-producao.html inline JS)

| Botão/Ação            | ID / Seletor                                 | Função JS                              | Endpoint API                                     | Método |
| --------------------- | -------------------------------------------- | -------------------------------------- | ------------------------------------------------ | ------ |
| Nova Ordem (Kanban)   | `btn-new-card`                               | `openNovaOrdemModal()`                 | — (UI modal)                                     | —      |
| Salvar Ordem Modal    | sidebar action                               | `salvarOrdemModal()`                   | (endpoint interno)                               | —      |
| Incluir Item          | sidebar action                               | `incluirItemOrdem()`                   | — (UI)                                           | —      |
| Imprimir Ordem        | sidebar action                               | `imprimirOrdem()`                      | `/api/pcp/ordens-producao/{id}/etiqueta-*`       | GET    |
| Duplicar Ordem        | sidebar action                               | `duplicarOrdemModal()`                 | `/api/pcp/ordens-producao/{id}/duplicar`         | POST   |
| Ver Anexos            | sidebar action                               | `verAnexosOrdem()`                     | `/api/pcp/ordens-producao/{id}/anexos`           | GET    |
| Ver Histórico         | sidebar action                               | `verHistoricoOrdem()`                  | `/api/pcp/ordens-producao/{id}/historico`        | GET    |
| Ver Tarefas           | sidebar action                               | `verTarefasOrdem()`                    | `/api/pcp/ordens-producao/{id}/tarefas`          | GET    |
| Concluir Ordem        | sidebar action                               | `concluirOrdemModal()`                 | `/api/pcp/ordens-producao/{id}/concluir`         | POST   |
| Excluir Ordem         | sidebar action                               | `excluirOrdemModal()`                  | `/api/pcp/ordens-producao/{id}`                  | DELETE |
| Filtros               | `abrirModalFiltros()` / `confirmarFiltros()` | — (UI)                                 | —                                                | —      |
| Novo Apontamento      | `btn-novo-apontamento`                       | `abrirNovoApontamento()`               | — (UI)                                           | —      |
| Etiqueta Bobina       | btn-view onclick                             | `abrirModalSelecaoEtiqueta('bobina')`  | `/api/pcp/ordens-producao/{id}/etiqueta-bobina`  | GET    |
| Etiqueta Produto      | btn-view onclick                             | `abrirModalSelecaoEtiqueta('produto')` | `/api/pcp/ordens-producao/{id}/etiqueta-produto` | GET    |
| Enviar Email          | btn onclick                                  | `enviarEmailOrdem()`                   | — (implementação inline)                         | —      |
| Menu Card             | `card-menu` onclick                          | `showCardMenu(id)`                     | — (UI)                                           | —      |
| Editar Item           | btn-opcao onclick                            | `editarItemOrdem(index)`               | — (UI)                                           | —      |
| Remover Item          | btn-opcao danger onclick                     | `removerItemOrdem(index)`              | — (UI)                                           | —      |
| Salvar Item Estrutura | btn onclick                                  | `salvarItemEstrutura()`                | — (UI)                                           | —      |
| Excluir Tarefa        | btn onclick                                  | `excluirTarefa(id)`                    | (endpoint interno)                               | —      |
| Excluir Anexo         | btn onclick                                  | `excluirAnexo(id)`                     | (endpoint interno)                               | —      |

### 1.10 Autenticação / Login (login.js, auth-check-pcp.js, auth-redirect.js, usuario-system.js)

| Botão/Ação       | Função JS                 | Endpoint API                 | Método |
| ---------------- | ------------------------- | ---------------------------- | ------ |
| Login            | form submit               | `/api/pcp/login`             | POST   |
| Logout           | `btn-sair` / `btn-logout` | `/api/pcp/logout`            | POST   |
| Check Sessão     | auto on load              | `/api/pcp/me` ou `/api/me`   | GET    |
| Users List       | auto on login page        | `/api/pcp/users-list`        | GET    |
| Verify Email     | form submit               | `/api/auth/verify-email`     | POST   |
| Verify User Data | form submit               | `/api/auth/verify-user-data` | POST   |
| Change Password  | form submit               | `/api/auth/change-password`  | POST   |

### 1.11 Mobile/Scan (mobile/scan.js)

| Botão/Ação           | Função JS   | Endpoint API               | Método |
| -------------------- | ----------- | -------------------------- | ------ |
| Login Mobile         | form submit | `/api/pcp/login`           | POST   |
| Buscar Locais        | auto        | `/api/pcp/locations`       | GET    |
| Movimentação Estoque | form submit | `/api/pcp/stock_movements` | POST   |

### 1.12 index_new.html — Botões Inline

| Botão/Ação            | onclick                                    | Endpoint API                    |
| --------------------- | ------------------------------------------ | ------------------------------- |
| Nova Ordem            | `showModal('modal-nova-ordem')`            | — (UI)                          |
| Novo Produto          | `showModal('modal-novo-produto')`          | — (UI)                          |
| Ir para Materiais     | `navigateTo('materiais')`                  | — (UI)                          |
| Gerar Relatório       | `gerarRelatorio('producao'/'estoque'/...)` | — (não implementado)            |
| Exportar Produtos     | `exportarProdutos()`                       | `/api/pcp/produtos/export-pdf`  |
| Exportar Materiais    | `exportarMateriais()`                      | `/api/pcp/materiais/export-pdf` |
| Buscar Produtos       | `buscarProdutos()`                         | `/api/pcp/produtos?q=...`       |
| Buscar Materiais      | `buscarMateriais()`                        | `/api/pcp/materiais`            |
| Salvar Produto        | `salvarProduto()`                          | `/api/pcp/produtos`             |
| Nova OC               | `showModal('modal-nova-oc')`               | — (UI)                          |
| Novo Faturamento      | `showModal('modal-novo-faturamento')`      | — (UI)                          |
| Tabs OP Modal         | `switchOPTab('itens'/'materiais'/...)`     | — (UI)                          |
| Novo Item OP          | `novoItemOP()`                             | — (UI)                          |
| Salvar Ordem Produção | `salvarOrdemProducao()`                    | `/api/pcp/ordens-producao`      |
| Imprimir OP           | `imprimirOP()`                             | —                               |
| Duplicar OP           | `duplicarOP()`                             | —                               |
| Excluir OP            | `excluirOP()`                              | —                               |
| Cancelar OP           | `cancelarOP()`                             | —                               |

---

## 2. TODAS AS ROTAS DO BACKEND (pcp-routes.js — 10.892 linhas)

### 2.1 Rotas Core (linhas 78-527)

| Rota                 | Método | Linha | Descrição                 |
| -------------------- | ------ | ----- | ------------------------- |
| `/me`                | GET    | 78    | Dados do usuário logado   |
| `/dashboard`         | GET    | 134   | Dashboard (stats gerais)  |
| `/alertas`           | GET    | —     | Alertas/Notificações      |
| `/ordens`            | GET    | 378   | Listar ordens de produção |
| `/ordens`            | POST   | —     | Criar nova ordem          |
| `/ordens/:id/status` | PUT    | —     | Atualizar status da ordem |
| `/materiais`         | GET    | 422   | Listar materiais          |
| `/materiais`         | POST   | —     | Criar material            |
| `/materiais/:id`     | PUT    | —     | Atualizar material        |
| `/materiais/:id`     | DELETE | —     | Excluir material          |

### 2.2 Rotas de Comércio (linhas 529-1094)

| Rota                          | Método              | Linha | Descrição                         |
| ----------------------------- | ------------------- | ----- | --------------------------------- |
| `/ordens-compra`              | GET                 | 529   | Listar ordens de compra           |
| `/ordens-compra`              | POST                | 536   | Criar ordem de compra             |
| `/produtos`                   | GET                 | 552   | Listar produtos (paginado, busca) |
| `/produtos/estoque-baixo`     | GET                 | —     | Produtos com estoque baixo        |
| `/produtos/search`            | GET                 | 684   | Buscar produtos                   |
| `/produtos/:id`               | GET                 | —     | Detalhe do produto                |
| `/produtos/:id/movimentacoes` | GET                 | —     | Movimentações de estoque          |
| `/produtos`                   | POST                | —     | Criar produto                     |
| `/produtos/:id`               | PUT                 | —     | Atualizar produto                 |
| `/produtos/:id`               | DELETE              | —     | Excluir produto                   |
| `/faturamentos`               | GET/POST/PUT/DELETE | —     | CRUD faturamentos                 |

### 2.3 Rotas Kanban (linhas 1095-1464)

| Rota                            | Método                    | Linha | Descrição                |
| ------------------------------- | ------------------------- | ----- | ------------------------ |
| `/ordens-kanban/proximo-numero` | GET                       | —     | Próximo número do kanban |
| `/ordens-kanban`                | GET/POST/PUT/PATCH/DELETE | —     | CRUD kanban              |

### 2.4 Rotas de Produção (linhas 1465-1578)

| Rota               | Método | Linha | Descrição                 |
| ------------------ | ------ | ----- | ------------------------- |
| `/ordens-producao` | GET    | 1465  | Listar ordens de produção |
| `/ultimo-pedido`   | GET    | 1484  | Último pedido             |
| `/health`          | GET    | —     | Health check              |
| `/metrics`         | GET    | —     | Métricas                  |

### 2.5 Templates, Clientes, Usuários (linhas 1579-2504)

| Rota                          | Método              | Linha     | Descrição                 |
| ----------------------------- | ------------------- | --------- | ------------------------- |
| `/api/templates/*`            | GET/POST            | 1579-1819 | CRUD templates            |
| `/api/clientes`               | GET/POST            | 1820-2238 | CRUD clientes             |
| `/api/clientes/:id`           | GET/PUT             | —         | Detalhe/atualizar cliente |
| `/api/clientes/:id/resumo`    | GET                 | —         | Resumo do cliente         |
| `/api/clientes/:id/historico` | GET                 | —         | Histórico do cliente      |
| `/users-list`                 | GET                 | 2239      | Lista de usuários         |
| `/dashboard`                  | GET                 | 2286      | **⚠️ DUPLICADO**          |
| `/diario-producao`            | GET/POST/PUT/DELETE | —         | Diário de produção        |

### 2.6 Estoque e Materiais (linhas 2505-2879)

| Rota                     | Método | Linha | Descrição                |
| ------------------------ | ------ | ----- | ------------------------ |
| `/materiais`             | GET    | 2505  | **⚠️ DUPLICADO**         |
| `/produtos/com-entrada`  | GET    | —     | Produtos com entrada     |
| `/estoque/movimentacoes` | GET    | —     | Movimentações de estoque |
| `/produtos`              | GET    | 2837  | **⚠️ DUPLICADO**         |

### 2.7 Transportadoras e Empresas (linhas 2880-3112)

| Rota                          | Método | Linha | Descrição              |
| ----------------------------- | ------ | ----- | ---------------------- |
| `/api/transportadoras`        | GET    | 2880  | Listar transportadoras |
| `/api/empresas/buscar`        | GET    | —     | Buscar empresas        |
| `/api/empresas`               | GET    | —     | Listar empresas        |
| `/api/transportadoras/buscar` | GET    | —     | Buscar transportadoras |

### 2.8 Produtos CRUD Duplicados (linhas 3113-3761)

| Rota                   | Método | Linha | Descrição             |
| ---------------------- | ------ | ----- | --------------------- |
| `/api/produtos/buscar` | GET    | 3113  | Buscar produtos       |
| `/api/produtos`        | GET    | 3267  | **⚠️ DUPLICADO (3º)** |
| `/api/produtos`        | POST   | 3563  | **⚠️ DUPLICADO**      |
| `/api/produtos/:id`    | PUT    | 3638  | **⚠️ DUPLICADO**      |
| `/api/produtos/:id`    | GET    | 3753  | **⚠️ DUPLICADO**      |

### 2.9 Configurações, Alertas, Etapas (linhas 3782-5199)

| Rota                                          | Método          | Linha | Descrição            |
| --------------------------------------------- | --------------- | ----- | -------------------- |
| `/api/alertas-estoque`                        | GET             | 3782  | Alertas de estoque   |
| `/api/configuracoes/empresa`                  | GET/POST        | —     | Config empresa       |
| `/api/configuracoes/impostos`                 | GET/POST/DELETE | —     | Config impostos      |
| `/api/configuracoes/familias-produtos`        | GET/POST/DELETE | —     | Famílias de produtos |
| `/api/configuracoes/caracteristicas-produtos` | GET/POST/DELETE | —     | Características      |
| `/api/configuracoes/vendedores`               | GET/POST/DELETE | —     | Vendedores           |
| `/api/configuracoes/compradores`              | GET/POST/DELETE | —     | Compradores          |
| `/api/configuracoes/categorias`               | GET/POST/DELETE | —     | Categorias           |
| `/api/configuracoes/departamentos`            | GET/POST/DELETE | —     | Departamentos        |
| `/api/configuracoes/projetos`                 | GET/POST/DELETE | —     | Projetos             |
| `/api/configuracoes/certificado`              | GET/POST        | 5200  | Certificado digital  |
| `/api/configuracoes/nfe-import`               | GET/POST        | —     | Import NF-e          |
| `/api/estoque/baixar`                         | POST            | 4341  | Baixar estoque       |
| `/estoque/produtos`                           | GET             | —     | Produtos do estoque  |
| `/etapas`                                     | GET/POST        | —     | Etapas de produção   |

### 2.10 Impressão (linhas 5456-5694)

| Rota                  | Método   | Linha | Descrição               |
| --------------------- | -------- | ----- | ----------------------- |
| `/api/print/queue`    | GET/POST | —     | Fila de impressão       |
| `/api/print/history`  | GET      | —     | Histórico de impressão  |
| `/api/print/printers` | GET      | —     | Impressoras disponíveis |
| `/api/print/settings` | GET/POST | —     | Config impressão        |

### 2.11 Geração de Ordens/Excel (linhas 5695-6442)

| Rota                     | Método | Linha | Descrição             |
| ------------------------ | ------ | ----- | --------------------- |
| `/ultimo-pedido`         | GET    | 5695  | **⚠️ DUPLICADO (2º)** |
| `/api/gerar-ordem-excel` | POST   | —     | Gerar Excel           |

### 2.12 Pedidos/Vendas e Acompanhamento (linhas 6443-6572)

| Rota                 | Método | Linha | Descrição                      |
| -------------------- | ------ | ----- | ------------------------------ |
| `/pedidos`           | GET    | 6443  | Listar pedidos                 |
| `/pedidos/faturados` | GET    | 6468  | Pedidos faturados              |
| `/pedidos/prazos`    | GET    | 6486  | Prazos de pedidos              |
| `/acompanhamento`    | GET    | 6494  | Acompanhamento                 |
| `/clientes`          | GET    | —     | Listar clientes (autocomplete) |
| `/transportadoras`   | GET    | —     | Listar transportadoras         |

### 2.13 Ordens Complexas (linhas 6573-7134)

| Rota                       | Método | Linha | Descrição                |
| -------------------------- | ------ | ----- | ------------------------ |
| `/ordem-producao-completa` | POST   | 6573  | Criar ordem completa     |
| `/gerar-ordem`             | POST   | —     | Gerar ordem              |
| `/ordens`                  | GET    | 6991  | **⚠️ DUPLICADO**         |
| `/ultimo-pedido`           | GET    | 7052  | **⚠️ DUPLICADO (3º)**    |
| `/ordens/:id`              | GET    | —     | Detalhe da ordem         |
| `/ordens/:id/status`       | PATCH  | —     | Atualizar status (PATCH) |

### 2.14 Materiais, Máquinas, Gestão (linhas 7135-8540)

| Rota                                | Método              | Linha     | Descrição              |
| ----------------------------------- | ------------------- | --------- | ---------------------- |
| `/vendedores`                       | GET                 | 7135      | Listar vendedores      |
| `/materiais-criticos`               | GET                 | —         | Materiais críticos     |
| `/gerar-pedido-compra`              | POST                | —         | Gerar pedido de compra |
| `/notificacoes-estoque`             | GET/PATCH           | —         | Notificações estoque   |
| `/ordens/:id/materiais-necessarios` | GET                 | —         | Materiais necessários  |
| `/estoque/produtos-disponiveis`     | GET                 | —         | Produtos disponíveis   |
| `/maquinas`                         | GET/POST/PUT/DELETE | 7522-7650 | CRUD máquinas          |
| `/maquinas/:id/manutencoes`         | GET/POST            | —         | Manutenções            |
| `/gestao-producao`                  | GET                 | 7651      | Gestão (com filtros)   |
| `/gestao-producao/dashboard`        | GET                 | —         | Dashboard gestão       |
| `/gestao-producao/:id`              | POST/PUT/GET        | —         | CRUD gestão            |
| `/controle-pcp`                     | GET                 | 8047      | Controle PCP           |
| `/controle-producao`                | GET                 | —         | Alias controle         |
| `/controle-pcp/:id/status`          | PUT                 | —         | Atualizar status       |
| `/controle-pcp/:id/materiais`       | GET                 | —         | Materiais do controle  |
| `/ordens-producao/:id/itens`        | GET                 | 8123      | Itens da ordem         |
| `/kanban-colunas`                   | GET/POST/PUT/DELETE | —         | CRUD colunas kanban    |
| `/kanban-colunas/reordenar`         | PUT                 | —         | Reordenar colunas      |

### 2.15 Gestão Ordens Produção (linhas 8541-9407)

| Rota                                        | Método     | Linha | Descrição         |
| ------------------------------------------- | ---------- | ----- | ----------------- |
| `/ordens-producao/:id`                      | DELETE/PUT | 8541  | Excluir/Atualizar |
| `/ordens-producao/:id/duplicar`             | POST       | —     | Duplicar ordem    |
| `/ordens-producao/:id/concluir`             | POST       | —     | Concluir ordem    |
| `/ordens-producao/:id/anexos`               | GET        | —     | Anexos            |
| `/ordens-producao/:id/historico`            | GET        | —     | Histórico         |
| `/ordens-producao/:id/tarefas`              | GET/POST   | —     | Tarefas           |
| `/ordens-producao/:id/etiqueta-bobina`      | GET        | 8832  | Etiqueta bobina   |
| `/ordens-producao/:id/etiqueta-produto`     | GET        | —     | Etiqueta produto  |
| `/ordens-producao/:id/etiqueta-produto-pdf` | GET        | —     | Etiqueta PDF      |

### 2.16 Multiplexado e Apontamentos (linhas 9408-10240+)

| Rota                         | Método   | Linha | Descrição               |
| ---------------------------- | -------- | ----- | ----------------------- |
| `/multiplexado`              | POST/GET | 9408  | Multiplexado            |
| `/cabos-composicao/:codigo`  | GET      | —     | Composição cabos        |
| `/cabos-composicao/calcular` | POST     | —     | Calcular composição     |
| `/cabos-composicao`          | GET      | —     | Listar composições      |
| `/pedidos/:id/materiais`     | GET      | 9822  | Materiais do pedido     |
| `/operadores`                | GET      | —     | Listar operadores       |
| `/materias-primas`           | GET      | —     | Matérias-primas         |
| `/apontamentos/stats`        | GET      | —     | Stats apontamentos      |
| `/apontamentos/ordens`       | GET      | —     | Ordens para apontamento |
| `/apontamentos/relatorio`    | GET      | —     | Relatório               |

---

## 3. CROSS-REFERENCE: FRONTEND → BACKEND

### 3.1 ✅ Endpoints que EXISTEM no backend

| Frontend Call                        | Backend Route                                  | Status             |
| ------------------------------------ | ---------------------------------------------- | ------------------ |
| `GET /api/pcp/me`                    | `GET /me` (linha 78)                           | ✅ OK              |
| `GET /api/pcp/ordens`                | `GET /ordens` (linhas 378, 6991)               | ✅ OK (duplicado)  |
| `POST /api/pcp/ordens`               | `POST /ordens`                                 | ✅ OK              |
| `PUT /api/pcp/ordens/{id}/status`    | `PUT /ordens/:id/status`                       | ✅ OK              |
| `GET /api/pcp/materiais`             | `GET /materiais` (linhas 422, 2505)            | ✅ OK (duplicado)  |
| `POST /api/pcp/materiais`            | `POST /materiais`                              | ✅ OK              |
| `PUT /api/pcp/materiais/{id}`        | `PUT /materiais/:id`                           | ✅ OK              |
| `DELETE /api/pcp/materiais/{id}`     | `DELETE /materiais/:id`                        | ✅ OK              |
| `GET /api/pcp/materiais/{id}`        | _(ver nota 1)_                                 | ⚠️ Ver erro #6     |
| `GET /api/pcp/produtos`              | `GET /produtos` (linhas 552, 2837, 3267)       | ✅ OK (triplicado) |
| `POST /api/pcp/produtos`             | `POST /produtos` (linhas ~595, 3563)           | ✅ OK (duplicado)  |
| `PUT /api/pcp/produtos/{id}`         | `PUT /produtos/:id` (linhas ~650, 3638)        | ✅ OK (duplicado)  |
| `DELETE /api/pcp/produtos/{id}`      | `DELETE /produtos/:id`                         | ✅ OK              |
| `GET /api/pcp/produtos/{id}`         | `GET /produtos/:id` (linhas ~700, 3753)        | ✅ OK (duplicado)  |
| `GET /api/pcp/ordens-compra`         | `GET /ordens-compra` (linha 529)               | ✅ OK              |
| `POST /api/pcp/ordens-compra`        | `POST /ordens-compra` (linha 536)              | ✅ OK              |
| `GET /api/pcp/pedidos`               | `GET /pedidos` (linha 6443)                    | ✅ OK              |
| `GET /api/pcp/pedidos/{id}`          | _(via /pedidos ou /ordens/:id)_                | ✅ OK              |
| `GET /api/pcp/pedidos/faturados`     | `GET /pedidos/faturados` (linha 6468)          | ✅ OK              |
| `GET /api/pcp/pedidos/prazos`        | `GET /pedidos/prazos` (linha 6486)             | ✅ OK              |
| `GET /api/pcp/acompanhamento`        | `GET /acompanhamento` (linha 6494)             | ✅ OK              |
| `GET /api/pcp/clientes?q=`           | `GET /clientes` (linha ~6560)                  | ✅ OK              |
| `GET /api/pcp/ordens-producao`       | `GET /ordens-producao` (linha 1465)            | ✅ OK              |
| `POST /api/pcp/ordens-producao`      | `POST /(ordem-producao-completa\|gerar-ordem)` | ✅ OK              |
| `PUT /api/pcp/ordens-producao/{id}`  | `PUT /ordens-producao/:id` (linha 8541+)       | ✅ OK              |
| `GET /api/pcp/faturamentos`          | `GET /faturamentos`                            | ✅ OK              |
| `GET /api/pcp/alertas`               | `GET /alertas`                                 | ✅ OK              |
| `GET /api/pcp/users-list`            | `GET /users-list` (linha 2239)                 | ✅ OK              |
| `GET /api/pcp/dashboard`             | `GET /dashboard` (linhas 134, 2286)            | ✅ OK (duplicado)  |
| `GET /api/pcp/produtos?q=...`        | `GET /produtos` (suporta query params)         | ✅ OK              |
| `GET /api/pcp/estoque/movimentacoes` | `GET /estoque/movimentacoes`                   | ✅ OK              |

### 3.2 ❌ Endpoints NÃO encontrados no backend

| Frontend Call                         | Arquivo Fonte                         | Rota Esperada           | Status                                          |
| ------------------------------------- | ------------------------------------- | ----------------------- | ----------------------------------------------- |
| `GET /api/pcp/search?q=&type=&limit=` | pcp.js (busca unificada)              | `/search`               | ❌ **NÃO EXISTE**                               |
| `GET /api/pcp/produtos/catalogo`      | pcp_modern.js (gerarCatalogoProdutos) | `/produtos/catalogo`    | ❌ **NÃO EXISTE**                               |
| `GET /api/pcp/produtos/export-pdf`    | pcp_modern.js (exportarProdutos)      | `/produtos/export-pdf`  | ❌ **NÃO EXISTE**                               |
| `GET /api/pcp/materiais/export-pdf`   | pcp_modern.js (exportarMateriais)     | `/materiais/export-pdf` | ❌ **NÃO EXISTE**                               |
| `GET /api/pcp/dashboard/stats`        | pcp-dashboard.js                      | `/dashboard/stats`      | ❌ **NÃO EXISTE** (só `/dashboard`)             |
| `GET /api/pcp/ordens-compra/{id}`     | pcp-modals.js (visualizarOC)          | `/ordens-compra/:id`    | ❌ **NÃO EXISTE**                               |
| `PUT /api/pcp/ordens-compra/{id}`     | pcp-modals.js (salvarEdicaoOC)        | `/ordens-compra/:id`    | ❌ **NÃO EXISTE**                               |
| `DELETE /api/pcp/ordens-compra/{id}`  | pcp-modals.js e ordens-compra.js      | `/ordens-compra/:id`    | ❌ **NÃO EXISTE**                               |
| `GET /api/pcp/locations`              | mobile/scan.js                        | `/locations`            | ❌ **NÃO EXISTE**                               |
| `POST /api/pcp/stock_movements`       | mobile/scan.js                        | `/stock_movements`      | ❌ **NÃO EXISTE**                               |
| `POST /api/pcp/logout`                | vários (via pcp router)               | `/logout`               | ⚠️ Existe em auth-rbac.js, NÃO em pcp-routes.js |

---

## 4. ERROS ENCONTRADOS

### ERRO #1 — CRÍTICO: Busca unificada sem rota backend

- **Frontend:** `pcp.js` → `handleMainSearch()` chama `GET /api/pcp/search?q=&type=&limit=`
- **Backend:** Rota `/search` **NÃO EXISTE** em `pcp-routes.js`
- **Impacto:** A busca principal do sistema retorna **404** para qualquer pesquisa
- **Correção:** Criar rota `GET /search` em pcp-routes.js que busca em pedidos, produtos, materiais e ordens

### ERRO #2 — CRÍTICO: Dashboard stats com endpoint errado

- **Frontend:** `pcp-dashboard.js` chama `GET /api/pcp/dashboard/stats`
- **Backend:** Só existe `GET /dashboard` (sem `/stats`). Retorna 404.
- **Impacto:** Painel de dashboard não carrega estatísticas
- **Correção:** Alterar frontend para `/api/pcp/dashboard` ou criar rota `/dashboard/stats`

### ERRO #3 — CRÍTICO: CRUD de Ordens de Compra por ID inexistente

- **Frontend:** `pcp-modals.js` e `ordens-compra.js` chamam:
    - `GET /api/pcp/ordens-compra/{id}` (visualizar OC)
    - `PUT /api/pcp/ordens-compra/{id}` (editar OC)
    - `DELETE /api/pcp/ordens-compra/{id}` (excluir OC)
- **Backend:** Só existem `GET /ordens-compra` (lista) e `POST /ordens-compra` (criar)
- **Impacto:** Visualizar, editar e excluir ordens de compra sempre retorna **404**
- **Correção:** Adicionar rotas `GET/PUT/DELETE /ordens-compra/:id` em pcp-routes.js

### ERRO #4 — CRÍTICO: Export PDF sem rotas

- **Frontend:** `pcp_modern.js` chama:
    - `GET /api/pcp/produtos/export-pdf` (botão Exportar Produtos)
    - `GET /api/pcp/materiais/export-pdf` (botão Exportar Materiais)
- **Backend:** Nenhuma rota `/produtos/export-pdf` ou `/materiais/export-pdf` existe
- **Impacto:** Botões de exportação PDF **não funcionam** (404)
- **Correção:** Criar rotas que geram PDF com PDFKit ou similar

### ERRO #5 — CRÍTICO: Catálogo de produtos sem rota

- **Frontend:** `pcp_modern.js` → `gerarCatalogoProdutos()` chama `GET /api/pcp/produtos/catalogo`
- **Backend:** Rota **NÃO EXISTE**
- **Impacto:** Botão "Gerar Catálogo" retorna 404
- **Correção:** Criar rota `/produtos/catalogo`

### ERRO #6 — BUG FUNCIONAL: editarMaterial abre modal de PRODUTO

- **Arquivo:** `pcp_modern.js` (função `window.editarMaterial`)
- **Código problemático:**
    ```javascript
    window.editarMaterial = function (id) {
        if (window.abrirModalEditarProduto) {
            window.abrirModalEditarProduto(id); // ← ERRADO! Abre modal de PRODUTO
        }
    };
    ```
- **Impacto:** Clicar em "Editar" em qualquer material abre o formulário de edição de PRODUTO com dados errados
- **Correção:** Alterar para `window.abrirModalEditarMaterial(id)` ou chamar a função correta de `pcp-modals.js`

### ERRO #7 — BUG: ID do botão não corresponde ao event listener

- **Arquivo:** `pcp.js` → `renderPainelFaturados()`
- **Problema:** O HTML renderizado cria botão com `id="btn-ver-todos-faturados"`, mas o event listener busca `id="btn-open-todos-faturados"`
- **Código:**
    ```javascript
    // Renderizado:
    <button id="btn-ver-todos-faturados">
    // Event listener:
    document.getElementById('btn-open-todos-faturados')?.addEventListener(...)
    ```
- **Impacto:** Botão "Ver Todos Faturados" **nunca funciona** — handler nunca é vinculado
- **Correção:** Alinhar o ID para `btn-ver-todos-faturados` em ambos os locais

### ERRO #8 — DUPLICAÇÃO MASSIVA DE ROTAS no backend

- **Arquivo:** `pcp-routes.js`
- **Rotas duplicadas:**
  | Rota | Ocorrências | Linhas |
  |------|------------|--------|
  | `GET /dashboard` | 2× | 134, 2286 |
  | `GET /materiais` | 2× | 422, 2505 |
  | `GET /produtos` | 3× | 552, 2837, 3267 |
  | `POST /produtos` | 2× | ~595, 3563 |
  | `PUT /produtos/:id` | 2× | ~650, 3638 |
  | `GET /produtos/:id` | 2× | ~700, 3753 |
  | `GET /ultimo-pedido` | 3× | 1484, 5695, 7052 |
  | `GET /ordens` | 2× | 378, 6991 |
- **Impacto:** Express usa a PRIMEIRA rota definida. As duplicatas são **código morto** que:
    - Confunde manutenção (qual versão é a "certa"?)
    - As versões podem ter implementações SQL diferentes
    - Bug silencioso: alguém corrige a duplicata achando que é a "real"
- **Correção:** Consolidar cada grupo mantendo apenas UMA implementação

### ERRO #9 — DUPLICATE requires

- **Arquivo:** `pcp-routes.js` (primeiras 25 linhas)
- **Problema:** `const path = require('path')` e `const multer = require('multer')` são declarados DUAS VEZES
- **Impacto:** Node.js permite redeclaração de `const` em blocos diferentes, mas no mesmo escopo causa warning. Pode falhar em strict mode dependendo da versão do Node.
- **Correção:** Remover as declarações duplicadas

### ERRO #10 — CONFLITO: showToast definido múltiplas vezes

- **Arquivos:** `pcp-common.js` define `window.showToast` E `pcp_modern.js` também define `window.showToast`
- **Impacto:** A implementação que carrega por último sobrescreve a primeira. Se `pcp-common.js` carrega depois, o toast de `pcp_modern.js` (que tem mais features como tipos diferentes, animações) é perdido — ou vice-versa.
- **Correção:** Unificar em um único arquivo ou verificar `if (!window.showToast)` antes de definir

### ERRO #11 — PARÂMETROS IGNORADOS: orderBy/order nas ordens

- **Frontend:** `pcp-dashboard.js` chama `GET /api/pcp/ordens?limit=5&orderBy=created_at&order=DESC`
- **Backend:** A rota `GET /ordens` (linha 378) usa `ORDER BY id DESC` **hardcoded** — ignora `orderBy` e `order`
- **Impacto:** A ordenação solicitada pelo frontend é ignorada silenciosamente
- **Correção:** Implementar parsing dos parâmetros `orderBy`/`order` com whitelist de colunas válidas

### ERRO #12 — Mobile/Scan: Rotas inexistentes

- **Arquivo:** `mobile/scan.js`
- **Problema:** Chama `GET /api/pcp/locations` e `POST /api/pcp/stock_movements`
- **Backend:** Nenhuma dessas rotas existe
- **Impacto:** App mobile de scanner de estoque **completamente não funcional**
- **Correção:** Criar rotas `/locations` e `/stock_movements` ou redirecionar para rotas existentes

### ERRO #13 — GET /materiais/:id pode não existir como rota dedicada

- **Frontend:** `pcp-modals.js` → `editarMaterial(id)` chama `GET /api/pcp/materiais/{id}`
- **Backend:** A busca por `router.get('/materiais/:id'` retorna apenas rotas como `/materiais` (lista). **Não há rota dedicada `GET /materiais/:id`**.
- **Impacto:** Editar material individual pode retornar 404 (depende da ordem de registro das rotas)
- **Correção:** Verificar se a rota existe; se não, criá-la

### ERRO #14 — ordens-compra.js usa `alert()` em vez de `showToast()`

- **Arquivo:** `ordens-compra.js`
- **Problema:** Usa `alert('✅ Ordem criada...')` diretamente em vez do sistema de toast
- **Impacto:** UX inconsistente — alertas bloqueantes do browser em vez de toasts não-intrusivos
- **Correção:** Substituir `alert()` por `showToast()` ou `window.showToast()`

### ERRO #15 — producao-faturamento.js: Várias funções são stubs

- **Arquivo:** `producao-faturamento.js`
- **Funções stub:**
    - `abrirModalNovaOrdem()` → `showToast('Modal de nova ordem em desenvolvimento', 'info')`
    - `abrirModalNovoFaturamento()` → `showToast('Modal de novo faturamento em desenvolvimento', 'info')`
    - `abrirModalGerarNFe()` → `showToast('Modal de NF-e em desenvolvimento', 'info')`
    - `visualizarFaturamento(id)` → `showToast('Funcionalidade em desenvolvimento', 'info')`
    - `editarOrdemProducao(id)` → `showToast('Funcionalidade em desenvolvimento', 'info')`
- **Impacto:** Botões existem na interface mas **não fazem nada** — experiência incompleta
- **Nota:** `abrirModalNovaOrdem()` é redefinida como `window.abrirModalNovaOrdem` mais adiante no mesmo arquivo com implementação funcional, então é auto-corrigida

---

## 5. AVISOS (WARNINGS)

### AVISO #1 — `confirmarMovimentacao()` em pcp-modals.js não salva no backend

- **Problema:** A função `confirmarMovimentacao()` mostra toast de sucesso mas NÃO faz `fetch()` para salvar
- **Código:** `showNotification('Entrada registrado com sucesso!', 'success')` sem chamada API
- **Impacto:** Movimentação de estoque parece funcionar mas dados NÃO são persistidos

### AVISO #2 — `POST /api/pcp/logout` depende de montagem correta no server.js

- **Problema:** A rota `POST /logout` não está definida em `pcp-routes.js`, mas sim em `auth-rbac.js` ou `auth-section-routes.js`
- **Impacto:** Se o server.js montar os routers na ordem correta, funciona. Caso contrário, 404.

### AVISO #3 — `pcp-optimizations.js` redefine funções de carregamento

- **Problema:** Otimiza (debounce/cache) funções como `carregarMateriais`, `carregarProdutos` etc. Se carregar antes dos arquivos originais, pode sobrescrever corretamente; se carregar depois, substitui.

### AVISO #4 — ordens-compra.js: `excluirOrdemCompra()` sem `credentials: 'include'`

- **Problema:** `fetch(url, { method: 'DELETE' })` não envia cookies de sessão
- **Impacto:** Se o backend exigir autenticação por cookie, a exclusão falhará com 401

### AVISO #5 — `busca-estoque.js`: URL hardcoded com `${API_BASE_URL}`

- **Problema:** Usa `${API_BASE_URL}/produtos?limit=1000` — depende de variável global estar definida
- **Impacto:** Se `API_BASE_URL` não estiver definida, a URL será `undefined/produtos?limit=1000` → erro de rede

### AVISO #6 — pcp-routes.js: Arquivo com 10.892 linhas

- **Problema:** Arquivo extremamente grande misturando rotas de 15+ domínios diferentes
- **Impacto:** Manutenção difícil, conflitos de merge, rotas duplicadas (já identificadas)
- **Recomendação:** Separar em arquivos menores por domínio (produtos-routes.js, materiais-routes.js, etc.)

### AVISO #7 — `pcp-dashboard.js` chama `GET /api/pcp/produtos?estoque_critico=true`

- **Problema:** Parâmetro `estoque_critico` pode não ser suportado pela rota `/produtos`. Existe rota separada `/produtos/estoque-baixo` para isso.
- **Impacto:** Pode retornar TODOS os produtos em vez dos críticos

### AVISO #8 — pcp.js: normalizeListResponse() aceita formatos múltiplos

- **Código:** Aceita `{ data: [] }`, `{ registros: [] }`, `{ results: [] }`, array direto
- **Problema:** Indica que o backend inconsistente — diferentes rotas retornam formatos de resposta diferentes
- **Recomendação:** Padronizar formato de resposta para `{ success: true, data: [], total: N }`

---

## 6. MAPA DE DEPENDÊNCIAS DE FUNÇÕES GLOBAIS

```
pcp-common.js      → window.showToast (CONFLITA com pcp_modern.js)
                    → window.pcpCarregarNotificacoes, pcpCarregarBadge
                    → window.atualizarSaudacao

pcp-modals.js       → window.editarProduto, verProduto, excluirProduto
                    → window.editarMaterial, verMaterial, excluirMaterial
                    → window.visualizarOC, editarOC, excluirOC
                    → window.showModal, hideModal
                    → window.mostrarConfirmacaoPCP

pcp_modern.js       → window.showToast (CONFLITA com pcp-common.js)
                    → window.editarMaterial (SOBRESCREVE com bug - abre modal de PRODUTO)
                    → window.editarProduto (pode SOBRESCREVER pcp-modals.js)
                    → window.excluirProduto, excluirMaterial

pcp.js              → Depende de window.showToast, showView
                    → Define handleMainSearch, carregarOrdens, carregarMateriais
                    → Depende de carregarProdutos (definida em múltiplos arquivos)

pcp-dashboard.js    → Depende de window.showToast (qual versão?)
                    → Define initDashboard, renderDashboard

pcp-optimizations.js → SOBRESCREVE carregarMateriais, carregarProdutos (com cache)

pcp-contadores.js   → Depende de /api/pcp/materiais, /api/pcp/produtos
```

**Ordem de carregamento importa!** Se `pcp_modern.js` carrega depois de `pcp-modals.js`, a função `editarMaterial` correta (de pcp-modals.js) será SOBRESCRITA pela versão com bug (de pcp_modern.js).

---

## 7. TABELA CONSOLIDADA DE PRIORIDADES

| #   | Erro                                    | Severidade | Impacto no Usuário             | Esforço |
| --- | --------------------------------------- | ---------- | ------------------------------ | ------- |
| 1   | Busca unificada `/search` não existe    | 🔴 CRÍTICO | Busca principal não funciona   | Médio   |
| 2   | Dashboard `/dashboard/stats` não existe | 🔴 CRÍTICO | Dashboard sem stats            | Baixo   |
| 3   | CRUD ordens-compra por ID não existe    | 🔴 CRÍTICO | Editar/excluir OC impossível   | Médio   |
| 4   | Export PDF sem rotas                    | 🔴 CRÍTICO | Botões de exportação quebrados | Médio   |
| 5   | Catálogo produt. sem rota               | 🟡 ALTO    | Botão catálogo quebrado        | Médio   |
| 6   | editarMaterial abre PRODUTO             | 🔴 CRÍTICO | Bug funcional confuso          | Baixo   |
| 7   | ID botão faturados errado               | 🟡 ALTO    | Botão não funciona             | Baixo   |
| 8   | Rotas duplicadas (7 grupos)             | 🟡 ALTO    | Código morto, confusão         | Alto    |
| 9   | Requires duplicados                     | 🟢 BAIXO   | Warning potencial              | Baixo   |
| 10  | showToast conflito                      | 🟡 ALTO    | Comportamento imprevisível     | Baixo   |
| 11  | orderBy ignorado                        | 🟢 BAIXO   | Ordenação errada silenciosa    | Baixo   |
| 12  | Mobile/Scan sem rotas                   | 🔴 CRÍTICO | App mobile não funciona        | Médio   |
| 13  | GET /materiais/:id ausente              | 🟡 ALTO    | Edição material pode falhar    | Baixo   |
| 14  | alert() vs showToast()                  | 🟢 BAIXO   | UX inconsistente               | Baixo   |
| 15  | Funções stub não implementadas          | 🟡 ALTO    | Botões sem ação                | Alto    |

---

## 8. RECOMENDAÇÕES DE CORREÇÃO PRIORITÁRIA

### Prioridade 1 (Correção Imediata)

1. **Criar rotas CRUD para ordens-compra por ID** (`GET/PUT/DELETE /ordens-compra/:id`)
2. **Corrigir `editarMaterial` em pcp_modern.js** — trocar `abrirModalEditarProduto` por `abrirModalEditarMaterial` ou removê-la (pcp-modals.js já define a versão correta)
3. **Corrigir ID do botão** `btn-ver-todos-faturados` → `btn-open-todos-faturados` (ou vice-versa)
4. **Criar rota `/search`** para busca unificada ou alterar frontend para usar `GET /produtos/search`
5. **Corrigir endpoint dashboard** de `/dashboard/stats` para `/dashboard`

### Prioridade 2 (Curto Prazo)

6. **Criar rotas de export PDF** para produtos e materiais
7. **Criar rota `/produtos/catalogo`**
8. **Criar rota GET `/materiais/:id`** se não existir
9. **Resolver conflito `showToast`** — unificar ou guardar com `if (!window.showToast)`
10. **Implementar `confirmarMovimentacao()`** com chamada real ao backend

### Prioridade 3 (Médio Prazo)

11. **Refatorar pcp-routes.js** — separar em múltiplos arquivos por domínio
12. **Remover rotas duplicadas** — consolidar cada grupo
13. **Padronizar formato de resposta** do backend (`{ success, data, total }`)
14. **Substituir `alert()` por `showToast()`** em ordens-compra.js
15. **Implementar funções stub** de producao-faturamento.js
16. **Criar rotas mobile** (`/locations`, `/stock_movements`) se o app mobile for necessário

---

_Fim da Auditoria_
