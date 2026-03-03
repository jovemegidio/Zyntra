# AUDITORIA COMPLETA — MÓDULO VENDAS (HTML Pages)

**Gerado em:** 2025  
**Arquivos auditados:**

- `modules/Vendas/public/index.html` (20.908 linhas, 67 fetch calls, 80+ onclick handlers)
- `modules/Vendas/public/pedidos.html` (3.858 linhas, 16 fetch calls, 80+ onclick handlers)
- `modules/Vendas/public/clientes.html` (2.543 linhas, 8 fetch calls, 55 onclick handlers)
- `modules/Vendas/public/prospeccao.html` (3.006 linhas, 16 fetch calls, 40 onclick handlers)
- `modules/Vendas/public/estoque.html` (2.074 linhas, 3 fetch calls, 29 onclick handlers)

---

## SUMÁRIO EXECUTIVO DE PROBLEMAS

| Severidade | Qtd | Descrição                                              |
| ---------- | --- | ------------------------------------------------------ |
| 🔴 CRÍTICO | 3   | Falhas de autenticação que expõem APIs                 |
| 🟠 ALTO    | 6   | Funções ausentes, código morto, duplicatas             |
| 🟡 MÉDIO   | 10  | Stubs, dados mockados, inconsistências                 |
| 🔵 BAIXO   | 8   | Hardcoded data, IDs duplicados, padrões inconsistentes |

---

## 1. PROBLEMAS CRÍTICOS (🔴)

### 1.1 — clientes.html: ZERO AUTENTICAÇÃO em todas as chamadas API CRUD

**Severidade: 🔴 CRÍTICA — Vulnerabilidade de segurança**

Todas as chamadas fetch em `clientes.html` para o endpoint `/api/vendas/clientes/*` NÃO possuem **nenhum** header de autenticação (`Authorization`) nem `credentials: 'include'`. Qualquer requisição pode ser feita sem autenticação.

| Linha | Endpoint                               | Método   | Auth?                       |
| ----- | -------------------------------------- | -------- | --------------------------- |
| ~1385 | `/api/vendas/clientes?limit=2000`      | GET      | ❌ NENHUMA                  |
| ~1651 | `/api/vendas/clientes/${id}`           | GET      | ❌ NENHUMA                  |
| ~1659 | `/api/vendas/clientes/${id}`           | PUT      | ❌ NENHUMA                  |
| ~1694 | `/api/vendas/clientes/${id}`           | DELETE   | ❌ NENHUMA                  |
| ~1760 | `/api/vendas/clientes`                 | POST/PUT | ❌ NENHUMA                  |
| ~1943 | `/api/vendas/clientes/${id}/resumo`    | GET      | ❌ NENHUMA                  |
| ~2303 | `/api/vendas/clientes/${id}/historico` | GET      | ❌ NENHUMA                  |
| ~2462 | `/api/me`                              | GET      | ✅ `credentials: 'include'` |

**Impacto:** Qualquer pessoa com acesso à rede pode ler, criar, editar e excluir clientes sem autenticação.  
**Correção:** Adicionar `headers: getAuthHeaders()` ou ao mínimo `credentials: 'include'` em todas as chamadas.

---

### 1.2 — index.html: Notificações DELETE sem auth

**Severidade: 🔴 CRÍTICA**

| Linha | Endpoint                              | Método | Auth?                                     |
| ----- | ------------------------------------- | ------ | ----------------------------------------- |
| 19304 | `/api/notifications/${notif.id}`      | DELETE | ❌ NENHUMA — sem headers, sem credentials |
| 19584 | `/api/notifications/history?page=...` | GET    | ❌ NENHUMA — sem headers, sem credentials |

Estas chamadas não possuem nem `credentials: 'include'` nem `Authorization` header. Qualquer usuário pode deletar notificações de outros ou ler histórico completo.

**Correção:** Adicionar `credentials: 'include'` e/ou `Authorization` header.

---

### 1.3 — Padrão de autenticação INCONSISTENTE entre páginas

| Página              | Padrão de Auth                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **index.html**      | Mix: `getAuthHeaders()` + `credentials: 'include'` na maioria. Inline `Authorization: Bearer` em alguns. Mas 2 endpoints sem NADA |
| **pedidos.html**    | `getAuthHeaders()` com JWT na maioria, mas `excluirPedido()` usa apenas `credentials: 'include'`                                  |
| **clientes.html**   | ❌ NADA (exceto `/api/me`)                                                                                                        |
| **estoque.html**    | `credentials: 'include'` (cookie-based) em tudo ✅                                                                                |
| **prospeccao.html** | `CRM.getAuthHeaders()` JWT + `credentials: 'include'` em tudo ✅                                                                  |

---

## 2. PROBLEMAS ALTOS (🟠)

### 2.1 — index.html: `toggleMobileSidebar()` chamada mas NÃO DEFINIDA

**Linhas HTML:** 5472, 5521  
**Situação:** A função é chamada em `onclick` no overlay do sidebar e no botão de menu mobile, mas **não existe nenhuma definição** desta função no JavaScript do arquivo, nem nos scripts externos carregados.

**Impacto:** No mobile, clicar no botão de menu ou no overlay **gera erro JavaScript** (`toggleMobileSidebar is not defined`), deixando o menu inutilizável.

---

### 2.2 — index.html: `adicionarItem()` definida DUAS VEZES

**Primeira definição (linha 13672):**

```javascript
function adicionarItem() {
    novoItemPedido(); // Chama novoItemPedido() que NÃO EXISTE
}
```

**Segunda definição (linha 14300):**

```javascript
function adicionarItem() {
    if (!pedidoAtual) { ... }
    // Implementação completa real
}
```

A segunda definição **sobrescreve** a primeira (JavaScript hoisting). A primeira vira dead code. Mas note que `novoItemPedido()` (chamada pela primeira versão) **não existe em nenhum lugar**.

---

### 2.3 — index.html: `showToast()` definida DUAS VEZES

**Linhas:** 9058 e 12355  
A segunda definição sobrescreve a primeira. Pode causar comportamento inesperado se a lógica é diferente.

---

### 2.4 — pedidos.html: `excluirPedido()` usa auth diferente de todas as outras funções

**Linha ~3300:**

```javascript
const response = await fetch(`/api/vendas/pedidos/${id}`, {
    method: 'DELETE',
    credentials: 'include' // ← Cookie-based
    // FALTA: headers: getAuthHeaders()
});
```

Todas as outras funções em `pedidos.html` usam `headers: getAuthHeaders()` com JWT. Esta usa apenas `credentials: 'include'`.

---

### 2.5 — pedidos.html: `faturarPedidoModalComOpcoes()` — DEAD CODE

A função está definida mas **nenhum onclick** ou event listener a invoca. O onclick do botão de faturamento aponta para `faturarPedidoModal()` (sem "ComOpcoes").

---

### 2.6 — index.html: `cancelarPedido()` e `excluirPedido()` sem JWT

**`cancelarPedido()` (linha 13617):** Usa apenas `credentials: 'include'` + `Content-Type`, sem `Authorization` header.
**`excluirPedido()` (linha 15158):** Idem — `credentials: 'include'` + `Content-Type`, sem JWT.

Enquanto isso, `salvarPedido()`, `duplicarPedido()`, `faturarPedido()` e outros usam `Authorization: Bearer`.

---

## 3. PROBLEMAS MÉDIOS (🟡)

### 3.1 — clientes.html: Funcionalidades STUB (não implementadas)

| Função                   | Linha | Comportamento                                                |
| ------------------------ | ----- | ------------------------------------------------------------ |
| `buscarEndereco()`       | ~1500 | Mostra toast "Use o campo CEP" — não faz nada                |
| Upload de anexos (botão) | ~2100 | Toast "Funcionalidade de upload será implementada em breve"  |
| `abrirEmailsEnviados()`  | ~2250 | Abre painel mas **não faz fetch** para carregar emails reais |

---

### 3.2 — clientes.html: Monitoramento e Tarefas são localStorage-only

| Feature                       | Persistência                           |
| ----------------------------- | -------------------------------------- |
| `toggleMonitoramento()`       | `localStorage` apenas, sem API backend |
| `adicionarTarefa()` / Tarefas | `localStorage` apenas, sem API backend |

**Impacto:** Dados são perdidos se o usuário trocar de navegador/dispositivo ou limpar o cache.

---

### 3.3 — pedidos.html: `editarParcela()` — STUB

Mostra toast "em desenvolvimento". A função existe mas não tem implementação real.

---

### 3.4 — index.html: `verEmailsEnviados()` usa dados SIMULADOS

**Linha 13257:**

```javascript
emailsPedido[pedidoAtual.id] = [
    {
        destinatario: 'cliente@empresa.com',
        assunto: `Orçamento Nº ${pedidoAtual.id}Aluforce:  `,
        data: '15/12/2025 14:30',
        status: 'lido'
    }
];
```

Não há chamada API para buscar emails reais. Dados são hardcoded/simulados.
Também note o texto corrompido no assunto: `Aluforce:  ` (colado errado).

---

### 3.5 — index.html: `verTarefas()` e `adicionarTarefa()` são localStorage-only

**Linhas 13480-13555:** Tarefas de pedidos são armazenadas apenas em `localStorage('tarefas_pedido_' + id)`, sem persistência no backend.

---

### 3.6 — index.html: `verAnexos()` sem funcionalidade de upload

**Linha 12238:** A função abre modal de anexos e lista arquivos, mas o upload mostra alert.

---

### 3.7 — index.html: `abrirEnviarEmail()` simplesmente troca de aba

**Linha 13303:** Apenas chama `switchModalTab('email')`. O formulário de email depende de uma aba no modal de edição que pode não existir para todos os pedidos.

---

### 3.8 — index.html: `abrirModalEtapas()` definida DUAS VEZES

**Primeira definição (linha 5453):** `function abrirModalEtapas() { console.log('Carregando...'); }` — stub  
**Segunda definição (linha 12548):** Implementação completa real.  
A segunda sobrescreve a primeira. A primeira é dead code.

---

### 3.9 — index.html: `marcarTodasLidas()` definida DUAS VEZES

**Primeira definição (linha 5454):** `function marcarTodasLidas() { console.log('Carregando...'); }` — stub  
**Segunda definição (linha 19187):** Implementação real com fetch POST.

---

### 3.10 — prospeccao.html: `atualizarStatusLead()` salva no localStorage em caso de erro (fallback silencioso)

**Linha ~1808:** Se a API falhar, salva localmente sem avisar o usuário:

```javascript
} catch (e) {
    localStorage.setItem('crm_leads', JSON.stringify(this.leads));
}
```

Usuário pensa que salvou quando na verdade é local.

---

## 4. PROBLEMAS BAIXOS (🔵)

### 4.1 — estoque.html: `id="btn-refresh"` duplicado

**Linhas:** 1057 e 1166 — Dois elementos HTML com o mesmo ID.

### 4.2 — estoque.html: `mostrarErro()` usa `alert()` em vez de toast

Inconsistente com o padrão de toast/notification usado em todas as outras páginas.

### 4.3 — pedidos.html: Vendedores HARDCODED no select de edição

```html
<option value="Augusto">Augusto</option>
<option value="Fabiano">Fabiano</option>
...
```

Deveria carregar da API `/api/vendas/vendedores`.

### 4.4 — index.html: `abrirModalVendedor()` carrega vendedores com only `credentials: 'include'`

**Linha 13066:** `fetch('/api/vendas/vendedores', { credentials: 'include' })` — sem JWT header.
Compare com `index.html` linha 15799 que usa a mesma API da mesma forma — consistente internamente, mas diferente do padrão JWT usado em outras chamadas.

### 4.5 — estoque.html: Template download endpoint possivelmente inexistente

`baixarTemplateEstoque()` cria link para `/api/estoque/template/download` — endpoint pode não existir no backend.

### 4.6 — index.html: `incluirPedido()` é wrapper desnecessário

**Linha 13667:** Apenas redireciona para `novoOrcamento()`:

```javascript
function incluirPedido() {
    novoOrcamento();
}
```

### 4.7 — index.html: `criarNotificacaoServidor()` sem JWT

**Linha 19917:** POST para `/api/notifications` com `credentials: 'include'` mas sem `Authorization` header.

### 4.8 — prospeccao.html: `buscarPorTexto()` tem tratamento silencioso de API inexistente

**Linha ~1850:** Comentário explícito `/* API pode não existir ainda */` no catch.

---

## 5. INVENTÁRIO COMPLETO DE API ENDPOINTS

### 5.1 — index.html (67 fetch calls)

| Endpoint                                          | Método   | Auth             | Função                            | Linha  |
| ------------------------------------------------- | -------- | ---------------- | --------------------------------- | ------ |
| `/api/vendas/kanban/pedidos`                      | GET      | JWT + cookie ✅  | `carregarDadosKanban()`           | 9190   |
| `/api/vendas/pedidos/${id}/status`                | PUT      | JWT + cookie ✅  | `salvarStatusPedido()`            | 9293   |
| `/api/vendas/pedidos/${id}`                       | GET      | JWT + cookie ✅  | (dentro de abrirCardPedido)       | 9530   |
| `/api/vendas/pedidos/${id}/itens`                 | GET      | JWT + cookie ✅  | (carregar itens)                  | 9826   |
| `/api/vendas/pedidos/${id}`                       | PUT      | JWT + cookie ✅  | `salvarPedido()`                  | 10258  |
| `/api/vendas/pedidos/${id}/itens`                 | POST/PUT | JWT + cookie ✅  | (salvar itens)                    | 10411  |
| `/api/vendas/pedidos`                             | POST     | JWT ✅           | `duplicarPedido()`                | 10507  |
| `/api/vendas/pedidos/${id}/danfe`                 | GET      | JWT + cookie ✅  | `verDanfe()`                      | 10555  |
| `/api/vendas/pedidos/${id}/recibo*`               | GET      | JWT + cookie ✅  | `verRecibo()`                     | 10625  |
| `/api/vendas/pedidos/${id}/orcamento-pdf`         | GET      | JWT + cookie ✅  | `imprimirPedido()`                | 10932  |
| `/api/vendas/pedidos/${id}/faturar`               | POST     | JWT + cookie ✅  | `faturarPedido()`                 | 11551  |
| `/api/vendas/pedidos/${id}`                       | PUT      | JWT + cookie ✅  | (fallback faturar)                | 11612  |
| `/api/vendas/pedidos/${id}/faturamento-parcial`   | POST     | JWT + cookie ✅  | faturamento parcial kanban        | 11884  |
| `/api/vendas/pedidos/${id}/remessa-entrega`       | POST     | JWT + cookie ✅  | remessa entrega kanban            | 11964  |
| `/api/vendas/faturamento/parciais-pendentes`      | GET      | JWT + cookie ✅  | `abrirModalNovoPedido()`          | 12012  |
| `/api/vendas/vendedores`                          | GET      | cookie only      | `abrirModalVendedor()`            | 13066  |
| `/api/vendas/pedidos/${id}/historico`             | GET      | JWT + cookie ✅  | `verHistorico()`                  | 13324  |
| `/api/vendas/pedidos/${id}/tarefas`               | POST     | JWT + cookie ✅  | `adicionarTarefa()` (server part) | 13464  |
| `/api/vendas/pedidos/${id}/status`                | PUT      | cookie only ⚠️   | `cancelarPedido()`                | 13639  |
| `/api/vendas/produtos/autocomplete/${termo}`      | GET      | JWT + cookie ✅  | autocomplete produtos             | 13788  |
| `/api/estoque/search?q=`                          | GET      | JWT + cookie ✅  | autocomplete estoque              | 14123  |
| `/api/vendas/pedidos/${id}/itens`                 | POST     | JWT + cookie ✅  | confirmar item pedido             | 14223  |
| `/api/vendas/pedidos/${id}/itens/${itemId}`       | PUT/POST | JWT + cookie ✅  | salvar item editado               | 14575  |
| `/api/vendas/pedidos/${id}/itens/${itemId}`       | DELETE   | JWT + cookie ✅  | `excluirItemSelecionado()`        | 14683  |
| `/api/vendas/clientes/${clienteId}/historico`     | GET      | JWT ⚠️ no cookie | `abrirHistoricoCliente()`         | 14973  |
| `/api/vendas/produtos/${item.produto_id}/fiscal`  | GET      | JWT ✅           | `atualizarImpostosDosItens()`     | 15110  |
| `/api/vendas/pedidos/${id}`                       | DELETE   | cookie only ⚠️   | `excluirPedido()`                 | 15179  |
| `/api/vendas/empresas/buscar?termo=`              | GET      | cookie only      | `buscarClientesEditAPI()`         | 15259  |
| `/api/transportadoras?termo=`                     | GET      | cookie only      | autocomplete transportadora       | 15356  |
| `/api/vendas/empresas/buscar?tipo=transportadora` | GET      | cookie only      | fallback transportadora           | 15396  |
| `/api/vendas/credito/${clienteId}`                | GET      | cookie only      | modal crédito                     | 15470  |
| `/api/empresas/${clienteId}`                      | GET      | cookie only      | fallback crédito                  | 15475  |
| `/api/vendas/empresas/search?q=`                  | GET      | cookie only      | `buscarClientesAPI()`             | 15597  |
| `/api/vendas/empresas/${id}/credito`              | GET      | cookie only      | crédito novo pedido               | 15690  |
| `/api/vendas/vendedores`                          | GET      | cookie only      | novo pedido vendedores            | 15799  |
| `/api/vendas/condicoes-pagamento`                 | GET      | JWT + cookie ✅  | carregar condições                | 15862  |
| `/api/vendas/impostos/cenarios/${codigo}`         | GET      | cookie only      | cenários fiscais                  | 16085  |
| `/api/vendas/pedidos/${id}/faturar`               | POST     | JWT + cookie ✅  | faturar do modal kanban           | 16972  |
| `/api/vendas/pedidos/${id}`                       | PUT      | JWT + cookie ✅  | fallback faturar kanban           | 17013  |
| `/api/vendas/pedidos/${id}/faturamento-parcial`   | POST     | JWT + cookie ✅  | fatur. parcial modal              | ---    |
| `/api/nfe/${pedido.nfe_id}/transmitir`            | POST     | JWT ✅           | `comunicarSefaz()`                | 17467  |
| `/api/me`                                         | GET      | JWT + cookie ✅  | carregar usuário                  | 18047  |
| `/api/vendas/proxy/cep/${cep}`                    | GET      | cookie only      | buscar CEP novo cliente           | 18539  |
| `/api/vendas/clientes`                            | POST     | cookie only      | `salvarNovoCliente()`             | 18589  |
| `/api/vendas/produtos`                            | GET      | cookie only      | products search novo produto      | 18954  |
| `/api/notifications?filter=`                      | GET      | cookie only ⚠️   | carregar notificações             | 18987  |
| `/api/notifications/${id}/read`                   | POST     | cookie only      | marcar como lida                  | 19146  |
| `/api/notifications/read-all`                     | POST     | cookie only      | marcar todas lidas                | 19189  |
| `/api/notifications/${notif.id}`                  | DELETE   | ❌ NENHUMA       | `limparNotificacoes()`            | 19304  |
| `/api/notifications/history?page=`                | GET      | ❌ NENHUMA       | histórico notificações            | 19584  |
| `/api/notifications`                              | POST     | cookie only      | `criarNotificacaoServidor()`      | 19917  |
| `/api/vendas/condicoes-pagamento`                 | POST     | ---              | nova condição                     | 19962+ |
| `/api/vendas/tipos-frete`                         | POST     | ---              | novo tipo frete                   | 20030  |
| `/api/vendas/regioes`                             | POST     | ---              | nova região                       | 20077  |

### 5.2 — pedidos.html (16 fetch calls)

| Endpoint                                        | Método            | Auth           | Função                           |
| ----------------------------------------------- | ----------------- | -------------- | -------------------------------- |
| `/api/vendas/pedidos?limit=200`                 | GET               | JWT ✅         | `carregarPedidos()`              |
| `/api/vendas/pedidos/${id}/itens`               | GET               | JWT ✅         | `verPedido()`                    |
| `/api/vendas/pedidos/${id}/historico`           | GET               | JWT ✅         | `verHistoricoPedido()`           |
| `/api/vendas/pedidos/${id}`                     | PATCH             | JWT ✅         | `salvarEdicaoPedido()`           |
| `/api/vendas/pedidos`                           | POST              | JWT ✅         | `duplicarPedidoModal()`          |
| `/api/vendas/pedidos/${id}/faturar`             | POST              | JWT ✅         | `faturarPedidoModal()`           |
| `/api/vendas/pedidos/${id}`                     | PUT               | JWT ✅         | fallback faturar                 |
| `/api/vendas/pedidos/${id}`                     | DELETE            | cookie only ⚠️ | `excluirPedido()`                |
| `/api/vendas/condicoes-pagamento`               | GET               | JWT ✅         | `carregarCondicoesPagamento()`   |
| `/api/vendas/condicoes-pagamento`               | POST              | JWT ✅         | `confirmarNovaParcelamento()`    |
| `/api/vendas/pedidos/${id}/faturamento-status`  | GET               | JWT ✅         | `abrirModalFaturamentoParcial()` |
| `/api/vendas/pedidos/${id}/faturamento-parcial` | POST              | JWT ✅         | `executarFaturamentoParcial()`   |
| `/api/vendas/pedidos/${id}/remessa-entrega`     | POST              | JWT ✅         | `executarRemessaEntrega()`       |
| `/api/vendas/pedidos/${id}/orcamento-pdf`       | GET (window.open) | —              | sidebar ação                     |
| `/api/me`                                       | GET               | JWT ✅         | `carregarUsuarioLogado()`        |

### 5.3 — clientes.html (8 fetch calls)

| Endpoint                               | Método   | Auth       | Função                       |
| -------------------------------------- | -------- | ---------- | ---------------------------- |
| `/api/vendas/clientes?limit=2000`      | GET      | ❌ NENHUMA | `carregarClientes()`         |
| `/api/vendas/clientes/${id}`           | GET      | ❌ NENHUMA | `editarCliente()`            |
| `/api/vendas/clientes/${id}`           | PUT      | ❌ NENHUMA | `editarCliente()` toggle     |
| `/api/vendas/clientes/${id}`           | DELETE   | ❌ NENHUMA | `excluirCliente()`           |
| `/api/vendas/clientes`                 | POST/PUT | ❌ NENHUMA | `salvarCliente()`            |
| `/api/vendas/clientes/${id}/resumo`    | GET      | ❌ NENHUMA | `carregarResumoCliente()`    |
| `/api/vendas/clientes/${id}/historico` | GET      | ❌ NENHUMA | `abrirHistoricoFinanceiro()` |
| `/api/me`                              | GET      | cookie ✅  | `carregarUsuarioLogado()`    |

### 5.4 — prospeccao.html (16 fetch calls)

| Endpoint                                        | Método | Auth            | Função                                   |
| ----------------------------------------------- | ------ | --------------- | ---------------------------------------- |
| `/api/vendas/leads`                             | GET    | JWT + cookie ✅ | `carregarLeads()`                        |
| `/api/vendas/leads`                             | POST   | JWT + cookie ✅ | `salvarLead()` / `buscarPorCNPJ()`       |
| `/api/vendas/leads/${id}`                       | PUT    | JWT + cookie ✅ | `salvarLead()` / `atualizarStatusLead()` |
| `/api/vendas/empresas/buscar?termo=`            | GET    | JWT + cookie ✅ | `buscarPorTexto()`                       |
| `/api/vendas/proxy/cep/${cep}`                  | GET    | cookie only     | `buscarPorCEP()` / `buscarPorCNPJ()`     |
| `/api/vendas/clientes`                          | POST   | JWT + cookie ✅ | `converterCliente()`                     |
| `/api/me`                                       | GET    | JWT + cookie ✅ | `carregarUsuario()`                      |
| `brasilapi.com.br/api/cnpj/v1/${cnpj}`          | GET    | — (pública)     | `buscarPorCNPJ()`                        |
| `receitaws.com.br/v1/cnpj/${cnpj}`              | GET    | — (pública)     | fallback CNPJ                            |
| `brasilapi.com.br/api/ibge/municipios/v1/${uf}` | GET    | — (pública)     | dados IBGE                               |
| `brasilapi.com.br/api/cnae/v2/${cnae}`          | GET    | — (pública)     | dados CNAE                               |
| `brasilapi.com.br/api/ddd/v1/${ddd}`            | GET    | — (pública)     | dados DDD                                |

### 5.5 — estoque.html (3 fetch calls)

| Endpoint                      | Método | Auth      | Função               |
| ----------------------------- | ------ | --------- | -------------------- |
| `/api/me`                     | GET    | cookie ✅ | `carregarUsuario()`  |
| `/api/estoque`                | GET    | cookie ✅ | `carregarProdutos()` |
| `/api/estoque/${id}/detalhes` | GET    | cookie ✅ | `verDetalhes()`      |

---

## 6. INVENTÁRIO DE FUNÇÕES POR PÁGINA

### 6.1 — index.html — Funções definidas vs chamadas

| Função                        | Linha              | Chamada por onclick? | Observações                          |
| ----------------------------- | ------------------ | -------------------- | ------------------------------------ |
| `toggleMobileSidebar()`       | ❌ NÃO EXISTE      | ✅ SIM (5472, 5521)  | 🔴 **MISSING FUNCTION**              |
| `toggleNotificacoes()`        | 5449, 19058 (2x!)  | ✅                   | Definida 2 vezes                     |
| `abrirModalEtapas()`          | 5453, 12548 (2x!)  | ✅                   | 1ª é stub, 2ª é real                 |
| `marcarTodasLidas()`          | 5454, 19187 (2x!)  | ✅                   | 1ª é stub, 2ª é real                 |
| `showToast()`                 | 9058, 12355 (2x!)  | JS interno           | Definida 2 vezes                     |
| `switchModalTab()`            | 10074              | ✅                   | OK                                   |
| `fecharModalEditar()`         | 10092              | ✅                   | OK                                   |
| `salvarPedido()`              | 10135              | ✅                   | OK — JWT + cookie                    |
| `duplicarPedido()`            | 10487              | ✅                   | OK — JWT                             |
| `verDanfe()`                  | 10530              | ✅                   | OK — JWT + cookie                    |
| `verRecibo()`                 | 10592              | ✅                   | OK — JWT + cookie                    |
| `imprimirPedido()`            | 10893              | ✅                   | OK — JWT + cookie                    |
| `conferirPedido()`            | 11339              | ✅                   | OK                                   |
| `faturarPedido()`             | 11354              | ✅                   | OK — JWT + cookie                    |
| `abrirModalNovoPedido()`      | 12048              | ✅                   | OK                                   |
| `verAnexos()`                 | 12238              | ✅                   | ⚠️ Upload não funcional              |
| `abrirModalEtapas()`          | 12548              | ✅                   | OK                                   |
| `adicionarNovaEtapa()`        | 12603              | ✅                   | OK                                   |
| `fecharModalEtapas()`         | 12695              | ✅                   | OK                                   |
| `confirmarEtapas()`           | 12699              | ✅                   | OK                                   |
| `desfazerFiltros()`           | 12980              | ✅                   | OK                                   |
| `aplicarFiltros()`            | 13018              | ✅                   | OK                                   |
| `abrirModalVendedor()`        | 13055              | ✅                   | ⚠️ Sem JWT                           |
| `abrirModalProjeto()`         | 13132              | ✅                   | OK                                   |
| `verEmailsEnviados()`         | 13257              | ✅                   | ⚠️ Dados simulados                   |
| `abrirEnviarEmail()`          | 13303              | ✅                   | Apenas troca aba                     |
| `verHistorico()`              | 13314              | ✅                   | OK — JWT + cookie                    |
| `verTarefas()`                | 13480              | ✅                   | ⚠️ localStorage only                 |
| `adicionarTarefa()`           | 13517              | ✅                   | ⚠️ Tenta API + localStorage fallback |
| `pedidoParcial()`             | 13559              | ✅                   | OK                                   |
| `cancelarPedido()`            | 13617              | ✅                   | ⚠️ Sem JWT                           |
| `incluirPedido()`             | 13667              | ✅                   | Wrapper → `novoOrcamento()`          |
| `adicionarItem()`             | 13672, 14300 (2x!) | ✅                   | 2ª sobrescreve 1ª                    |
| `editarItemSelecionado()`     | 14364              | ✅                   | OK                                   |
| `excluirItemSelecionado()`    | 14649              | ✅                   | OK — JWT + cookie                    |
| `abrirHistoricoCliente()`     | 14907              | ✅                   | OK — JWT                             |
| `atualizarImpostosDosItens()` | 15061              | ✅                   | OK — JWT                             |
| `excluirPedido()`             | 15158              | ✅                   | ⚠️ Sem JWT                           |
| `novoOrcamento()`             | 16448              | ✅                   | OK                                   |
| `faturarTodos()`              | 17196              | ✅                   | OK                                   |
| `comunicarSefaz()`            | 17400              | ✅                   | OK — JWT                             |
| `abrirModalNovoCliente()`     | 18167              | ✅                   | OK                                   |
| `filtrarNotificacoes()`       | 19133              | ✅                   | OK                                   |
| `limparNotificacoes()`        | 19294              | ✅                   | 🔴 Sem auth no DELETE                |
| `verTodasNotificacoes()`      | 19331              | ✅                   | 🔴 Sem auth no GET history           |
| `abrirModalExportar()`        | 19931              | ✅                   | OK                                   |
| `abrirModalNovaCondicao()`    | 19962              | ✅                   | OK                                   |
| `abrirModalICMSTransporte()`  | 16856              | ✅                   | OK (abre modal)                      |
| `buscarClientes()`            | 15636              | ✅                   | OK                                   |
| `ativarAbaOrcamento()`        | 16475              | ✅                   | OK                                   |

### 6.2 — pedidos.html — Funções definidas

| Função                           | Auth           | Status                    |
| -------------------------------- | -------------- | ------------------------- |
| `getAuthHeaders()`               | —              | ✅ Definida, usa JWT      |
| `fetchWithTimeout()`             | —              | ✅ Wrapper com timeout    |
| `carregarPedidos()`              | JWT ✅         | OK                        |
| `filtrarPedidos()`               | —              | OK (local)                |
| `renderizarTabela()`             | —              | OK (local)                |
| `setTab()`                       | —              | OK (local)                |
| `verPedido(id)`                  | JWT ✅         | OK                        |
| `editarPedido(id)`               | JWT ✅         | OK (com check permissões) |
| `salvarEdicaoPedido()`           | JWT ✅ (PATCH) | OK                        |
| `faturarPedidoModal()`           | JWT ✅         | OK                        |
| `faturarPedidoModalComOpcoes()`  | JWT ✅         | 🟠 Dead code              |
| `duplicarPedidoModal()`          | JWT ✅         | OK                        |
| `excluirPedido()`                | cookie ⚠️      | 🟠 Auth inconsistente     |
| `abrirModalParcelas()`           | —              | OK (local)                |
| `editarParcela()`                | —              | 🟡 Stub                   |
| `abrirModalFaturamentoParcial()` | JWT ✅         | OK                        |
| `executarFaturamentoParcial()`   | JWT ✅         | OK                        |
| `executarRemessaEntrega()`       | JWT ✅         | OK                        |
| `imprimirPedido()`               | —              | OK (window.open)          |
| `exportarPedidos()`              | —              | OK (local export)         |

### 6.3 — clientes.html — Funções definidas

| Função                                        | Auth      | Status                 |
| --------------------------------------------- | --------- | ---------------------- |
| `carregarClientes()`                          | ❌        | 🔴 Sem auth            |
| `editarCliente(id)`                           | ❌        | 🔴 Sem auth            |
| `excluirCliente()`                            | ❌        | 🔴 Sem auth            |
| `salvarCliente()`                             | ❌        | 🔴 Sem auth            |
| `buscarCep()`                                 | —         | OK (viacep pública)    |
| `buscarCnpj()`                                | —         | OK (receitaws pública) |
| `buscarEndereco()`                            | —         | 🟡 Stub                |
| `carregarResumoCliente()`                     | ❌        | 🔴 Sem auth            |
| `abrirHistoricoFinanceiro()`                  | ❌        | 🔴 Sem auth            |
| `abrirEmailsEnviados()`                       | —         | 🟡 Sem fetch           |
| `toggleMonitoramento()`                       | —         | 🟡 localStorage only   |
| `abrirTarefasCliente()` / `adicionarTarefa()` | —         | 🟡 localStorage only   |
| `exportarClientes()`                          | —         | OK (local export)      |
| `novoPedido(id)`                              | —         | OK (redirect)          |
| `carregarUsuarioLogado()`                     | cookie ✅ | OK                     |

### 6.4 — prospeccao.html — Métodos CRM

| Método                      | Auth            | Status                  |
| --------------------------- | --------------- | ----------------------- |
| `CRM.init()`                | —               | OK                      |
| `CRM.getAuthHeaders()`      | —               | ✅ Retorna JWT          |
| `CRM.carregarUsuario()`     | JWT + cookie ✅ | OK                      |
| `CRM.carregarLeads()`       | JWT + cookie ✅ | OK                      |
| `CRM.atualizarStatusLead()` | JWT + cookie ✅ | ⚠️ Fallback silencioso  |
| `CRM.buscarEmpresas()`      | —               | OK (dispatcher)         |
| `CRM.buscarPorTexto()`      | JWT + cookie ✅ | ⚠️ API pode não existir |
| `CRM.buscarPorCEP()`        | cookie only     | OK                      |
| `CRM.buscarPorCNPJ()`       | JWT + cookie ✅ | OK                      |
| `CRM.salvarLead()`          | JWT + cookie ✅ | OK                      |
| `CRM.verDetalhes()`         | —               | OK (local)              |
| `CRM.editarLeadById()`      | —               | OK (local)              |
| `CRM.editarLead()`          | —               | OK (proxy)              |
| `CRM.converterCliente()`    | JWT + cookie ✅ | OK                      |
| `CRM.abrirWhatsApp()`       | —               | OK (window.open)        |
| `CRM.abrirEmail()`          | —               | OK (mailto)             |
| `CRM.exportarLeads()`       | —               | OK (local XML/XLS)      |
| `CRM.importarCNPJs()`       | —               | OK (abre modal)         |
| `CRM.iniciarImportacao()`   | JWT + cookie ✅ | OK                      |

### 6.5 — estoque.html — Funções definidas

| Função                    | Auth      | Status                       |
| ------------------------- | --------- | ---------------------------- |
| `carregarProdutos()`      | cookie ✅ | OK                           |
| `carregarUsuario()`       | cookie ✅ | OK                           |
| `filtrarProdutos()`       | —         | OK (local)                   |
| `ordenar()`               | —         | OK (local)                   |
| `renderizarProdutos()`    | —         | OK (local)                   |
| `verDetalhes(id)`         | cookie ✅ | OK                           |
| `setView()`               | —         | OK (local)                   |
| `baixarTemplateEstoque()` | —         | ⚠️ Endpoint pode não existir |
| `fecharModal()`           | —         | OK                           |
| `escapeHtml()`            | —         | OK (utility)                 |

---

## 7. SCRIPTS EXTERNOS COMPARTILHADOS

Todos os 5 arquivos incluem estes scripts:

| Script                             | Propósito                                                   |
| ---------------------------------- | ----------------------------------------------------------- |
| `/js/anti-copy-protection.js`      | Proteção contra cópia                                       |
| `/js/vendas-admin-check.js`        | Verificação de admin                                        |
| `/js/vendas-access-control.js`     | Controle de acesso/permissões                               |
| `/js/auth-unified.js`              | Autenticação unificada                                      |
| `/js/confirm-modal.js`             | Modal de confirmação (`showConfirmDialog`, `confirmDelete`) |
| `/js/popup-confirmacao.js`         | Popup de confirmação (`mostrarConfirmacao`)                 |
| `/js/connection-monitor.js`        | Monitor de conexão                                          |
| `/js/mobile-auto-enhance.js`       | Melhorias mobile                                            |
| `/js/user-dropdown.js`             | Dropdown de usuário                                         |
| `/js/sidebar-click-animation.js`   | Animação do sidebar                                         |
| `/_shared/accessibility-widget.js` | Widget de acessibilidade                                    |

**Nota:** `showConfirmDialog()`, `confirmDelete()`, e `mostrarConfirmacao()` são chamadas em vários arquivos mas **não definidas inline** — presume-se que estão nos scripts externos (`confirm-modal.js` / `popup-confirmacao.js`).

---

## 8. RECOMENDAÇÕES PRIORITÁRIAS

### Prioridade 1 — Segurança (IMEDIATO)

1. **clientes.html:** Adicionar `headers: { 'Authorization': \`Bearer \${token}\` }`e/ou`credentials: 'include'` em TODAS as chamadas fetch
2. **index.html:** Adicionar `credentials: 'include'` nas chamadas DELETE e GET de notificações (linhas 19304, 19584)
3. **Padronizar auth:** Escolher UM padrão (JWT + cookie) e aplicar em todas as páginas

### Prioridade 2 — Bugs Funcionais (URGENTE)

4. **index.html:** Criar a função `toggleMobileSidebar()` ou importar de script externo
5. **index.html:** Remover a primeira definição duplicada de `adicionarItem()` (linha 13672)
6. **index.html:** Remover stubs dead-code nas linhas 5453-5454 (`abrirModalEtapas`, `marcarTodasLidas`)
7. **index.html:** Remover definição duplicada de `showToast()` (linha 9058 ou 12355)

### Prioridade 3 — Funcionalidades Incompletas (PLANEJADO)

8. **clientes.html:** Implementar upload de anexos
9. **clientes.html:** Migrar monitoramento e tarefas de localStorage para API
10. **clientes.html:** Implementar `abrirEmailsEnviados()` com fetch real
11. **index.html:** Implementar `verEmailsEnviados()` com dados reais (não simulados)
12. **pedidos.html:** Implementar `editarParcela()` (atualmente stub)
13. **pedidos.html:** Carregar vendedores dinamicamente no select de edição

### Prioridade 4 — Qualidade de Código (MELHORIA)

14. Remover dead code (`faturarPedidoModalComOpcoes` em pedidos.html)
15. Padronizar tratamento de erros (estoque.html usa `alert()`, outros usam toast)
16. Corrigir ID duplicado `btn-refresh` em estoque.html
17. Corrigir texto corrompido no assunto de email simulado em index.html

---

_Fim do relatório de auditoria._
