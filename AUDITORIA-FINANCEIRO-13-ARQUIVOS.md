# AUDITORIA COMPLETA — Módulo Financeiro (13 Arquivos HTML)

> Data: 2025-06-12  
> Escopo: 10 categorias de problemas, com linhas exatas e trechos de código para edição cirúrgica

---

## RESUMO EXECUTIVO

| Categoria                                                  | Arquivos Afetados | Severidade |
| ---------------------------------------------------------- | ----------------- | ---------- |
| 1. `--primary-orange` com valor errado (#225cfa = azul)    | 9 de 13           | ALTA       |
| 2. `--primary-blue` usado mas NUNCA declarado              | 7 de 13           | CRÍTICA    |
| 3. `auth-unified.js` sem `defer`                           | 5 de 13           | ALTA       |
| 4. Blocos `<style>` inline massivos (duplicam CSS externo) | 13 de 13          | MÉDIA      |
| 5. Classes de botão não-padrão                             | 9 de 13           | BAIXA      |
| 6. `global-header-sidebar.css` ausente                     | 0 de 13           | OK ✓       |
| 7. Sidebar inconsistente                                   | 3 de 13           | ALTA       |
| 8. `auth-unified.js` versão desatualizada                  | 2 de 13           | ALTA       |
| 9. `<main>` aninhado (HTML inválido)                       | 2 de 13           | CRÍTICA    |
| 10. Mismatch `user-initial` vs `user-initials`             | 9 de 13           | ALTA       |

---

## CATEGORIA 1: `--primary-orange` com valor incorreto

**Problema:** A variável se chama `--primary-orange` mas o valor atribuído é `#225cfa` (azul), não laranja.

### Arquivos com `--primary-orange: #225cfa` (NOME ERRADO — valor é azul):

| Arquivo                       | Linha | Código                       |
| ----------------------------- | ----- | ---------------------------- |
| contas-pagar.html             | L31   | `--primary-orange: #225cfa;` |
| contas-receber.html           | L31   | `--primary-orange: #225cfa;` |
| fluxo-caixa.html              | L31   | `--primary-orange: #225cfa;` |
| bancos.html                   | L31   | `--primary-orange: #225cfa;` |
| relatorios.html               | L68   | `--primary-orange: #225cfa;` |
| orcamentos.html               | L31   | `--primary-orange: #225cfa;` |
| plano-contas.html             | L29   | `--primary-orange: #225cfa;` |
| dashboard-contas-pagar.html   | L25   | `--primary-orange: #225cfa;` |
| dashboard-contas-receber.html | L25   | `--primary-orange: #225cfa;` |

### Arquivos com `--primary-orange: #f97316` (valor correto para laranja, mas variável pouco usada):

| Arquivo            | Linha | Código                       |
| ------------------ | ----- | ---------------------------- |
| conciliacao.html   | L26   | `--primary-orange: #f97316;` |
| impostos.html      | L26   | `--primary-orange: #f97316;` |
| centros-custo.html | L26   | `--primary-orange: #f97316;` |

### Arquivo SEM `--primary-orange`:

- **index.html** — não declara essa variável ✓

### Recomendação:

Renomear para `--primary-color` ou `--primary-blue` nos 9 arquivos que usam `#225cfa`, ou remover completamente e usar o design system externo.

---

## CATEGORIA 2: `--primary-blue` usado mas NUNCA declarado

**Problema CRÍTICO:** A variável `--primary-blue` é referenciada extensivamente no CSS inline, mas **nenhum arquivo a declara no `:root`**. Como resultado, todas as regras que usam `var(--primary-blue)` retornam valor vazio — botões, títulos e sidebar ficam sem cor.

### Ocorrências por arquivo:

#### fluxo-caixa.html (6 usos)

| Linha | Código                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------- |
| L67   | `.sidebar-btn.active { background: var(--primary-blue); color: white; }`                                        |
| L91   | `.page-title h1 i { color: var(--primary-blue); }`                                                              |
| L97   | `.btn-primary { background: var(--primary-blue); color: white; }`                                               |
| L130  | `.period-btn:hover, .period-btn.active { background: var(--primary-blue); border-color: var(--primary-blue); }` |
| L136  | `.card-header h3 i { color: var(--primary-blue); }`                                                             |

#### bancos.html (6 usos)

| Linha | Código                                                                   |
| ----- | ------------------------------------------------------------------------ |
| L145  | `.sidebar-btn.active { background: var(--primary-blue); color: white; }` |
| L186  | `.page-title-section h1 i { color: var(--primary-blue); }`               |
| L190  | `.btn-primary { background: var(--primary-blue); color: white; }`        |
| L233  | `.card-header h3 i { color: var(--primary-blue); }`                      |
| L433  | `.modal-header h2 i { color: var(--primary-blue); }`                     |
| L444  | `.form-group input:focus { border-color: var(--primary-blue); }`         |

#### relatorios.html (7+ usos)

| Linha | Código                                                                   |
| ----- | ------------------------------------------------------------------------ |
| L299  | `.sidebar-btn.active { background: var(--primary-blue); color: white; }` |
| L340  | `.page-title-section h1 i { color: var(--primary-blue); }`               |
| L344  | `.btn-primary { background: var(--primary-blue); color: white; }`        |
| L570  | `.report-card:hover { border-color: var(--primary-blue); }`              |
| L586  | `.relatorio-card:hover { border-color: var(--primary-blue); }`           |
| L604  | `.card-header h3 i { color: var(--primary-blue); }`                      |
| L657  | `.modal-header h2 i { color: var(--primary-blue); }`                     |

#### plano-contas.html (1 uso)

| Linha | Código                                                                   |
| ----- | ------------------------------------------------------------------------ |
| L45   | `.sidebar-btn.active { background: var(--primary-blue); color: white; }` |

#### orcamentos.html (1 uso)

| Linha | Código                                                                   |
| ----- | ------------------------------------------------------------------------ |
| L47   | `.sidebar-btn.active { background: var(--primary-blue); color: white; }` |

#### contas-pagar.html (1+ usos)

| Linha | Código                                                                   |
| ----- | ------------------------------------------------------------------------ |
| L67   | `.sidebar-btn.active { background: var(--primary-blue); color: white; }` |

#### contas-receber.html (2+ usos)

| Linha | Código                                                                                |
| ----- | ------------------------------------------------------------------------------------- |
| L77   | `.sidebar-btn.active { background: var(--primary-blue); color: white; }`              |
| L178  | `.btn-primary { background: linear-gradient(135deg, var(--primary-blue), #65a30d); }` |

### Arquivos SEM `--primary-blue`:

- index.html ✓
- conciliacao.html ✓ (usa `--primary-orange` em vez disso)
- impostos.html ✓ (usa `--purple`)
- centros-custo.html ✓ (usa `--primary-orange`)
- dashboard-contas-pagar.html ✓
- dashboard-contas-receber.html ✓

### Recomendação:

Adicionar `--primary-blue: #225cfa;` ao `:root` de cada arquivo afetado, ou melhor: **remover esses estilos inline** e usar `fin-header-sidebar.css` que já deveria defini-los.

---

## CATEGORIA 3: `auth-unified.js` sem `defer`

**Problema:** O script de autenticação é carregado sem `defer`, bloqueando o parsing do HTML.

| Arquivo                       | Linha | Código                                                   | Problema Adicional                               |
| ----------------------------- | ----- | -------------------------------------------------------- | ------------------------------------------------ |
| impostos.html                 | L11   | `<script src="/js/auth-unified.js?v=20260211"></script>` | Sem defer                                        |
| conciliacao.html              | L11   | `<script src="/js/auth-unified.js?v=20260211"></script>` | Sem defer                                        |
| centros-custo.html            | L11   | `<script src="/js/auth-unified.js?v=20260211"></script>` | Sem defer                                        |
| dashboard-contas-pagar.html   | L753  | `<script src="/js/auth-unified.js?v=20260131"></script>` | **Sem defer + versão antiga + no final do body** |
| dashboard-contas-receber.html | L753  | `<script src="/js/auth-unified.js?v=20260131"></script>` | **Sem defer + versão antiga + no final do body** |

### Arquivos COM `defer` (corretos) ✓:

- index.html (L17), contas-pagar.html (L17), contas-receber.html (L17), fluxo-caixa.html (L17), bancos.html (L17), relatorios.html (L17), orcamentos.html (L17), plano-contas.html (L17)

### Fix cirúrgico:

```html
<!-- DE: -->
<script src="/js/auth-unified.js?v=20260211"></script>
<!-- PARA: -->
<script src="/js/auth-unified.js?v=20260211" defer></script>
```

---

## CATEGORIA 4: Blocos `<style>` inline massivos

**Problema:** TODOS os 13 arquivos têm blocos `<style>` enormes que duplicam estilos já presentes em `fin-layout.css`, `fin-components.css`, e `fin-header-sidebar.css`.

| Arquivo                       | Linhas de CSS inline     | Duplicações principais                                                 |
| ----------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| index.html                    | ~198 linhas (L50-L248)   | KPI grid, modais, formulários                                          |
| contas-pagar.html             | ~262 linhas (L33-L295)   | Sidebar, header, botões, KPIs, tabela, badges, modais                  |
| contas-receber.html           | ~470+ linhas (L33-L504+) | Sidebar, header, notificações, KPIs, tabela, modais SaaS               |
| fluxo-caixa.html              | ~153 linhas (L33-L186)   | Sidebar, header, botões, stats, cards, tabela                          |
| bancos.html                   | ~450+ linhas (L31-L500+) | Sidebar, header, KPIs, logos banco, cards, toasts, modais, formulários |
| relatorios.html               | ~400+ linhas (L34-L500+) | Templates, sidebar, header, stats, filtros, cards                      |
| conciliacao.html              | ~300 linhas (L19-L321)   | Sidebar, header, KPIs, filtros, grid, tabela, modais                   |
| impostos.html                 | ~190 linhas (L18-L208)   | Sidebar, header, botões, KPIs, tabela, badges, modais                  |
| centros-custo.html            | ~190 linhas (L18-L208)   | Sidebar, header, botões, stats, tabela, badges, modais                 |
| orcamentos.html               | ~470+ linhas (L31-L500+) | Sidebar, header, KPIs, charts, budget list, modais profissionais       |
| plano-contas.html             | ~470+ linhas (L28-L500+) | Sidebar, header, tree view, modais profissionais, formulários          |
| dashboard-contas-pagar.html   | ~195 linhas (L22-L217)   | Sidebar completa, header completo, notificações, KPIs, cards           |
| dashboard-contas-receber.html | ~195 linhas (L22-L217)   | Sidebar completa, header completo, notificações, KPIs, cards           |

### Estilos mais duplicados entre arquivos:

1. **Sidebar**: `.sidebar-btn`, `.sidebar-logo`, `.sidebar-bottom` — em pelo menos 10 arquivos
2. **Header**: `.header-btn`, `.header-brand`, `.notification-*` — em pelo menos 10 arquivos
3. **User avatar**: `.user-avatar`, `.user-greeting` — em pelo menos 10 arquivos
4. **Page layout**: `.page-content`, `.page-header`, `.page-actions` — em todos
5. **Botões base**: `.btn`, `.btn-primary`, `.btn-secondary` — em todos
6. **KPIs**: `.kpi-grid`, `.kpi-card`, `.kpi-icon` — em pelo menos 8 arquivos
7. **Tabelas**: `.data-table th/td` — em pelo menos 8 arquivos
8. **Modais**: `.modal-overlay`, `.modal-header`, `.modal-body` — em pelo menos 8 arquivos

### Recomendação:

Extrair todos esses estilos comuns para os CSS externos já existentes (`fin-layout.css`, `fin-components.css`, `fin-header-sidebar.css`) e remover os blocos inline.

---

## CATEGORIA 5: Classes de botão não-padrão

**Problema:** Classes de botão customizadas fora do design system padrão (btn, btn-primary, btn-secondary, btn-success, btn-danger, btn-warning, btn-outline).

| Classe                                                                             | Arquivos                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `btn-importar`                                                                     | contas-pagar (L46), contas-receber (L46), fluxo-caixa (L46), bancos (L42) |
| `btn-movimentacao`                                                                 | bancos (L65)                                                              |
| `btn-transferencia`                                                                | bancos (L81)                                                              |
| `btn-novo-banco`                                                                   | bancos (L97)                                                              |
| `btn-templates`                                                                    | relatorios (L81)                                                          |
| `btn-agendar`                                                                      | relatorios (L93)                                                          |
| `btn-imprimir`                                                                     | relatorios (L105)                                                         |
| `btn-filtrar`                                                                      | relatorios (L454)                                                         |
| `btn-saas`, `btn-saas-ghost`, `btn-saas-primary`                                   | bancos, orcamentos, plano-contas, centros-custo, impostos, contas-receber |
| `btn-padrao-ghost`, `btn-padrao-primary`, `btn-padrão-ghost`, `btn-padrão-primary` | bancos, conciliacao, plano-contas                                         |
| `period-btn`                                                                       | fluxo-caixa (L112), orcamentos                                            |
| `tab-btn`                                                                          | impostos, plano-contas, orcamentos                                        |
| `match-btn`                                                                        | conciliacao (L207)                                                        |
| `template-download-btn`                                                            | relatorios                                                                |
| `tmpl-filter-btn`                                                                  | relatorios (L35)                                                          |

### Arquivos SEM classes não-padrão:

- index.html ✓
- dashboard-contas-pagar.html ✓ (usa apenas btn, btn-primary, btn-outline)
- dashboard-contas-receber.html ✓

---

## CATEGORIA 6: `global-header-sidebar.css` ausente

**Resultado: TODOS OS ARQUIVOS INCLUEM ✓**

| Arquivo                       | Linha | Versão     |
| ----------------------------- | ----- | ---------- |
| index.html                    | L270  | v=20260216 |
| contas-pagar.html             | L360  | v=20260216 |
| contas-receber.html           | L1837 | v=20260216 |
| fluxo-caixa.html              | L183  | v=20260216 |
| bancos.html                   | L1536 | v=20260216 |
| relatorios.html               | L738  | v=20260216 |
| conciliacao.html              | L328  | v=20260216 |
| impostos.html                 | L200  | v=20260216 |
| centros-custo.html            | L204  | v=20260216 |
| orcamentos.html               | L782  | v=20260216 |
| plano-contas.html             | L701  | v=20260216 |
| dashboard-contas-pagar.html   | L205  | v=20260217 |
| dashboard-contas-receber.html | L205  | v=20260217 |

> **Nota:** Os dashboards usam versão v=20260217 enquanto os demais usam v=20260216

---

## CATEGORIA 7: Sidebar inconsistente

**Problema:** 3 padrões diferentes de sidebar coexistem.

### Padrão A — `<a>` tags + SEM botão config (1 arquivo):

- **index.html** — Links com `<a href>`, sem botão Configurações no sidebar-bottom

### Padrão B — `<a>` tags + COM botão config (10 arquivos):

- contas-pagar.html, contas-receber.html, fluxo-caixa.html, bancos.html, relatorios.html, conciliacao.html, impostos.html, centros-custo.html, orcamentos.html, plano-contas.html

### Padrão C — `<button>` tags com RBAC + SEM botão config (2 arquivos):

- **dashboard-contas-pagar.html** — Usa `<button>` com `data-rbac` e `onclick`, SEM config
- **dashboard-contas-receber.html** — Usa `<button>` com `data-rbac` e `onclick`, SEM config

### Diferenças detalhadas:

| Aspecto         | Padrão A (index)         | Padrão B (maioria)       | Padrão C (dashboards)           |
| --------------- | ------------------------ | ------------------------ | ------------------------------- |
| Tag usada       | `<a>`                    | `<a>`                    | `<button>`                      |
| Config button   | NÃO                      | SIM                      | NÃO                             |
| RBAC data attrs | NÃO                      | NÃO                      | SIM                             |
| CSS do sidebar  | `fin-header-sidebar.css` | `fin-header-sidebar.css` | `financeiro-sidebar-header.css` |

### Diferença de CSS externo:

| Arquivo                                                                                        | CSS do sidebar                                 |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| index, contas-pagar, contas-receber, fluxo-caixa, bancos, relatorios, orcamentos, plano-contas | `css/fin-header-sidebar.css?v=20260215`        |
| conciliacao, impostos, centros-custo                                                           | `css/fin-header-sidebar.css?v=20260211`        |
| dashboard-contas-pagar, dashboard-contas-receber                                               | `css/financeiro-sidebar-header.css?v=20260211` |

### Recomendação:

1. Adicionar botão config ao index.html
2. Padronizar dashboards para usar `<a>` tags como os demais
3. Unificar o CSS: `fin-header-sidebar.css` vs `financeiro-sidebar-header.css`
4. Atualizar versão de conciliacao/impostos/centros-custo para v=20260215

---

## CATEGORIA 8: `auth-unified.js` versão desatualizada

| Arquivo                       | Linha | Versão       | Versão Atual |
| ----------------------------- | ----- | ------------ | ------------ |
| dashboard-contas-pagar.html   | L753  | `v=20260131` | `v=20260211` |
| dashboard-contas-receber.html | L753  | `v=20260131` | `v=20260211` |

Além disso, nesses 2 arquivos o script está **no final do body (L753)** em vez de no `<head>`, e o `<head>` tem um **comentário indicando que deveria ser carregado primeiro** mas o `<script>` tag está vazio/ausente.

```html
<!-- Linha ~9 do <head>: -->
<!-- Sistema de Autenticação Unificado - DEVE ser carregado primeiro -->
<!-- VAZIO — nenhum <script> aqui! -->

<!-- Linha 753 no final do body: -->
<script src="/js/auth-unified.js?v=20260131"></script>
```

### Fix:

Mover para o `<head>`, atualizar versão, adicionar `defer`:

```html
<script src="/js/auth-unified.js?v=20260211" defer></script>
```

---

## CATEGORIA 9: `<main>` aninhado dentro de `<main>` (HTML inválido)

**Problema CRÍTICO:** O spec HTML proíbe `<main>` dentro de `<main>`. Isso causa problemas de acessibilidade e pode quebrar screen readers.

### Arquivos afetados:

#### dashboard-contas-pagar.html

```html
<!-- Linha 262: -->
<main class="main-area">
    <!-- ... header ... -->
    <!-- Linha 317: -->
    <main class="main-content">
        <!-- ← INVÁLIDO! -->
        <!-- conteúdo -->
    </main>
</main>
```

#### dashboard-contas-receber.html

```html
<!-- Linha 262: -->
<main class="main-area">
    <!-- ... header ... -->
    <!-- Linha 317: -->
    <main class="main-content">
        <!-- ← INVÁLIDO! -->
        <!-- conteúdo -->
    </main>
</main>
```

### Todos os outros arquivos usam corretamente:

```html
<main class="main-area">
    <div class="main-content"><!-- ✓ CORRETO --></div>
</main>
```

### Fix cirúrgico:

Em ambos os dashboards, trocar:

```html
<main class="main-content">  →  <div class="main-content">
</main> <!-- /main-content -->  →  </div> <!-- /main-content -->
```

---

## CATEGORIA 10: Mismatch `user-initial` vs `user-initials`

**Problema:** O CSS usa o seletor de CLASSE `.user-initial` (singular), mas o HTML usa `id="user-initials"` (plural com ID). O seletor `.user-initial` (classe) nunca vai fazer match com `#user-initials` (ID).

### CSS com `.user-initial` (classe, singular):

| Arquivo             | Linhas   | Código                                                                                                           |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| contas-pagar.html   | L80-81   | `.user-avatar .user-initial { display: block; }` / `.user-avatar img.visible + .user-initial { display: none; }` |
| contas-receber.html | L101-102 | idem                                                                                                             |
| fluxo-caixa.html    | L82-83   | idem                                                                                                             |
| bancos.html         | L179-180 | idem                                                                                                             |
| relatorios.html     | L333-334 | idem                                                                                                             |
| orcamentos.html     | L60-61   | idem                                                                                                             |
| plano-contas.html   | L58-59   | idem                                                                                                             |

### HTML com `id="user-initials"` (ID, plural):

Todos os 13 arquivos usam:

```html
<span id="user-initials">U</span>
```

### JS com `getElementById('user-initial')` (singular, sem S):

| Arquivo                       | Linhas     | Código                                    |
| ----------------------------- | ---------- | ----------------------------------------- |
| dashboard-contas-pagar.html   | L447, L452 | `document.getElementById('user-initial')` |
| dashboard-contas-receber.html | L447, L452 | `document.getElementById('user-initial')` |

**Triplo mismatch nos dashboards:**

- CSS: `.user-initial` (classe, singular)
- HTML: `id="user-initials"` (ID, plural)
- JS: `getElementById('user-initial')` (ID, singular)

### Recomendação:

Padronizar para `id="user-initials"` no HTML e CSS seletor `#user-initials` ou classe `.user-initials`. Atualizar JS para `getElementById('user-initials')`.

---

## BÔNUS: Problemas adicionais encontrados

### B1. `conciliacao.html` usa `--primary-orange` extensivamente como cor de destaque

O arquivo conciliacao.html usa `var(--primary-orange)` em **11 locais** (linhas 113, 117, 188, 198, 212, 224, 231, 235x2, 253, 267, 305) como cor principal de UI. O valor é `#f97316` (laranja real), mas isso é inconsistente com os outros arquivos que usam verde-lima (#84cc16) ou azul (#225cfa) como cor primária do Financeiro.

### B2. Versões inconsistentes de `fin-header-sidebar.css`

| Versão     | Arquivos                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- |
| v=20260215 | index, contas-pagar, contas-receber, fluxo-caixa, bancos, relatorios, orcamentos, plano-contas |
| v=20260211 | conciliacao, impostos, centros-custo                                                           |

### B3. `dashboard-contas-pagar.html` e `dashboard-contas-receber.html` — Isolados do design system

Esses 2 arquivos:

- NÃO importam `fin-layout.css` nem `fin-components.css` nem `fin-header-sidebar.css`
- Usam CSS externo diferente: `financeiro-sidebar-header.css`
- Usam design system mobile: `design-system-mobile.css`, `responsive-global.css`, `mobile-master-2026.css`, `mobile-enterprise-enhancements.css`
- Têm sidebar completamente diferente (buttons com RBAC vs links estáticos)

### B4. Cor primária inconsistente entre arquivos

| Cor primária usada                          | Arquivos                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `#225cfa` (azul) como `--primary-orange`    | contas-pagar, contas-receber, fluxo-caixa, bancos, relatorios, orcamentos, plano-contas, dash-pagar, dash-receber |
| `#f97316` (laranja) como `--primary-orange` | conciliacao, impostos, centros-custo                                                                              |
| `#84cc16` (verde-lima)                      | index.html (gradientes, badges), bancos (modais padrão), plano-contas (modais), orcamentos (modais)               |
| `var(--purple)` #8b5cf6                     | impostos (.btn-primary)                                                                                           |
| `var(--teal)` #14b8a6                       | plano-contas (.btn-primary)                                                                                       |
| `var(--indigo)` #6366f1                     | orcamentos (.btn-primary)                                                                                         |
| `var(--danger-red)` #ef4444                 | dashboard-contas-pagar (.btn-primary)                                                                             |
| `var(--success-green)` #22c55e              | dashboard-contas-receber (.btn-primary)                                                                           |

**6 cores primárias diferentes** em 13 arquivos do mesmo módulo.

---

## PLANO DE AÇÃO PRIORITÁRIO

### Prioridade 1 (CRÍTICA):

1. **Declarar `--primary-blue`** no `:root` de 7 arquivos (ou melhor, remover CSS inline e usar o externo)
2. **Corrigir `<main>` aninhado** nos 2 dashboards → trocar por `<div>`
3. **Mover auth-unified.js** para `<head>` com `defer` nos 2 dashboards

### Prioridade 2 (ALTA):

4. **Adicionar `defer`** ao auth-unified.js de impostos, conciliacao, centros-custo
5. **Atualizar auth-unified.js** de v=20260131 para v=20260211 nos 2 dashboards
6. **Padronizar sidebar** — adicionar config button ao index.html, converter dashboards para `<a>` tags
7. **Corrigir mismatch user-initial/user-initials** — padronizar CSS, HTML e JS

### Prioridade 3 (MÉDIA):

8. **Renomear `--primary-orange`** para `--primary-color` ou remover e usar CSS externo
9. **Extrair CSS inline** para os arquivos CSS externos (4000+ linhas de duplicação)
10. **Padronizar cor primária** — escolher UMA cor primária para todo o módulo Financeiro
11. **Unificar versões** de `fin-header-sidebar.css` e `global-header-sidebar.css`
