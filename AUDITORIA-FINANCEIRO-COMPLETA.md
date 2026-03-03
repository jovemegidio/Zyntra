# AUDITORIA COMPLETA - Módulo Financeiro (13 HTMLs)

## Padronização contra Padrão PCP/Financeiro Unificado

**Data:** 2025-06-30  
**Escopo:** Todos os 13 arquivos HTML ativos do módulo Financeiro  
**Referência:** Padrão PCP (sidebar `<a>` tags, header unificado, CSS externo, variáveis consistentes)

---

## SUMÁRIO EXECUTIVO

### Classificação dos Arquivos em 3 Grupos Arquiteturais

| Grupo                                       | Arquivos                                                                                                                               | Status                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **A - Parcialmente Padronizado**            | index.html, contas-pagar.html, contas-receber.html, fluxo-caixa.html, bancos.html, relatorios.html, orcamentos.html, plano-contas.html | Sidebar/Header OK, CSS inline excessivo                   |
| **B - HEAD Diferente**                      | conciliacao.html, impostos.html, centros-custo.html                                                                                    | HEAD incompleto, auth sem defer, variáveis diferentes     |
| **C - Arquitetura Completamente Diferente** | dashboard-contas-pagar.html, dashboard-contas-receber.html                                                                             | CSS stack diferente, sidebar com `<button>`, auth ausente |

### Métricas Globais de Problemas

| Categoria                                | Qtd Problemas | Severidade |
| ---------------------------------------- | ------------- | ---------- |
| CSS Variables Inconsistentes             | 13 arquivos   | 🔴 CRÍTICO |
| Estilos Inline Massivos                  | 11 arquivos   | 🔴 CRÍTICO |
| HEAD/Meta Tags Faltantes                 | 3 arquivos    | 🟡 MÉDIO   |
| auth-unified.js Ausente/Sem Defer        | 5 arquivos    | 🔴 CRÍTICO |
| Versões de CSS Desatualizadas            | 3 arquivos    | 🟡 MÉDIO   |
| Sidebar com `<button>` ao invés de `<a>` | 2 arquivos    | 🔴 CRÍTICO |
| Modais com Classes Não-Padrão            | 10 arquivos   | 🟡 MÉDIO   |
| Botões com Classes Customizadas          | 4 arquivos    | 🟡 MÉDIO   |
| CSS Syntax Errors                        | 2 arquivos    | 🔴 CRÍTICO |

---

## 1. HEAD / CSS IMPORTS

### 1.1 Meta Tags Faltantes (Grupo B)

**Arquivos afetados:** conciliacao.html, impostos.html, centros-custo.html

**Problema:** Esses 3 arquivos NÃO possuem as seguintes metas presentes nos outros 8 arquivos do Grupo A:

```
Linha ~6: Faltam viewport-fit=cover, theme-color, cache-control
```

| Arquivo            | Linha         | Código Atual                                                             | Deveria Ser                                                                                  |
| ------------------ | ------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| conciliacao.html   | ~5            | `<meta name="viewport" content="width=device-width, initial-scale=1.0">` | `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">` |
| conciliacao.html   | após viewport | (ausente)                                                                | `<meta name="theme-color" content="#1a1a2e">`                                                |
| conciliacao.html   | após viewport | (ausente)                                                                | `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">`            |
| impostos.html      | ~5            | Idem conciliacao                                                         | Idem                                                                                         |
| centros-custo.html | ~5            | Idem conciliacao                                                         | Idem                                                                                         |

### 1.2 Stack de CSS Completamente Diferente (Grupo C)

**Arquivos afetados:** dashboard-contas-pagar.html, dashboard-contas-receber.html

| Arquivo                       | Linha  | CSS Atual                                                                                                                                    | CSS Padrão (deveria ter)                   |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| dashboard-contas-pagar.html   | ~10-20 | `notifications-fix.css`, `design-system-mobile.css`, `responsive-global.css`, `mobile-master-2026.css`, `mobile-enterprise-enhancements.css` | `fin-layout.css`, `fin-components.css`     |
| dashboard-contas-pagar.html   | ~22    | `financeiro-sidebar-header.css`                                                                                                              | `fin-header-sidebar.css`                   |
| dashboard-contas-pagar.html   | ~23    | `modais-saas-unified.css`                                                                                                                    | (OK, mas deveria estar com a mesma versão) |
| dashboard-contas-receber.html | Idem   | Idem                                                                                                                                         | Idem                                       |

### 1.3 Versões de fin-header-sidebar.css Desatualizadas

| Arquivo            | Linha | Versão Atual                        | Versão Correta                      |
| ------------------ | ----- | ----------------------------------- | ----------------------------------- |
| conciliacao.html   | ~335  | `fin-header-sidebar.css?v=20260211` | `fin-header-sidebar.css?v=20260215` |
| impostos.html      | ~26   | `fin-header-sidebar.css?v=20260211` | `fin-header-sidebar.css?v=20260215` |
| centros-custo.html | ~26   | `fin-header-sidebar.css?v=20260211` | `fin-header-sidebar.css?v=20260215` |

### 1.4 auth-unified.js - Problemas

| Arquivo                       | Linha | Problema                                                               | Correção                                                       |
| ----------------------------- | ----- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| conciliacao.html              | ~8    | `<script src="/js/auth-unified.js?v=20260131"></script>` (sem `defer`) | Adicionar `defer`                                              |
| impostos.html                 | ~8    | `<script src="/js/auth-unified.js?v=20260131"></script>` (sem `defer`) | Adicionar `defer`                                              |
| centros-custo.html            | ~8    | `<script src="/js/auth-unified.js?v=20260131"></script>` (sem `defer`) | Adicionar `defer`                                              |
| dashboard-contas-pagar.html   | ~25   | `<script src="" defer></script>` (VAZIO - auth AUSENTE!)               | `<script src="/js/auth-unified.js?v=20260131" defer></script>` |
| dashboard-contas-receber.html | ~25   | `<script src="" defer></script>` (VAZIO - auth AUSENTE!)               | `<script src="/js/auth-unified.js?v=20260131" defer></script>` |

---

## 2. SIDEBAR

### 2.1 Sidebar com `<button>` em vez de `<a>` (Grupo C)

**Arquivos afetados:** dashboard-contas-pagar.html, dashboard-contas-receber.html

| Arquivo                       | Linha   | Código Atual                                                                                           | Padrão Correto                                                                                     |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| dashboard-contas-pagar.html   | ~90-130 | `<button class="sidebar-btn" onclick="..." data-rbac="..."><i class="fas fa-chart-line"></i></button>` | `<a href="index.html" class="sidebar-btn" title="Dashboard"><i class="fas fa-chart-line"></i></a>` |
| dashboard-contas-receber.html | ~90-130 | Idem                                                                                                   | Idem                                                                                               |

**Detalhes:** Os dashboards usam `<button>` com `onclick="window.location.href='...';"` e `data-rbac` em vez de `<a href>`. O padrão correto (usado nos outros 11 arquivos) é `<a>` tags com `href` e `title`.

### 2.2 Botão Configurações Ausente nos Dashboards

| Arquivo                       | Seção          | Problema                                                           | Padrão                        |
| ----------------------------- | -------------- | ------------------------------------------------------------------ | ----------------------------- |
| dashboard-contas-pagar.html   | sidebar-bottom | Não tem `<button id="btn-config" onclick="toggleConfiguracoes()">` | Adicionar botão Configurações |
| dashboard-contas-receber.html | sidebar-bottom | Idem                                                               | Idem                          |

### 2.3 Sidebar Width Inconsistente

| Arquivo                       | Linha | Valor Atual             | Padrão                       |
| ----------------------------- | ----- | ----------------------- | ---------------------------- |
| dashboard-contas-pagar.html   | ~55   | `--sidebar-width: 48px` | `60px` (ou usar CSS externo) |
| dashboard-contas-receber.html | ~55   | `--sidebar-width: 48px` | `60px` (ou usar CSS externo) |

### 2.4 Tooltip Spans (Único em fluxo-caixa.html)

| Arquivo          | Linhas   | Código                                                                                          | Observação                                                                                               |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| fluxo-caixa.html | ~220-260 | `<a href="..." class="sidebar-btn"><i class="fas ..."></i><span class="tooltip">...</span></a>` | Os outros 10 arquivos usam `title=""` no `<a>`, sem `<span class="tooltip">`. Padronizar usando `title`. |

---

## 3. HEADER

### 3.1 Header Brand com Inline Styles Excessivos

**Afeta TODOS os 13 arquivos.** O `header-brand` tem estilos inline em todos os arquivos:

```html
<div class="header-brand" style="display:flex;align-items:center;gap:10px;">
    <img src="..." alt="ALUFORCE" style="height:22px;object-fit:contain;" />
    <span style="color:rgba(255,...);font-weight:300;...">|</span>
    <img src="..." alt="Zyntra" style="height:22px;object-fit:contain;" />
    <span style="...">—</span>
    <span style="font-size:13px;...">Financeiro</span>
</div>
```

**Recomendação:** Mover esses estilos inline para `fin-header-sidebar.css` e usar classes: `.header-brand-logo`, `.header-brand-separator`, `.header-brand-module`.

### 3.2 Header Height Inconsistente

| Arquivo                       | Linha | Valor Atual             | Padrão                       |
| ----------------------------- | ----- | ----------------------- | ---------------------------- |
| dashboard-contas-pagar.html   | ~54   | `--header-height: 42px` | `56px` (ou usar CSS externo) |
| dashboard-contas-receber.html | ~54   | `--header-height: 42px` | `56px` (ou usar CSS externo) |

### 3.3 user-photo `src=""` vs `style="display:none"`

| Arquivo                       | Localização | Código Atual                              | Padrão                                                  |
| ----------------------------- | ----------- | ----------------------------------------- | ------------------------------------------------------- |
| dashboard-contas-pagar.html   | user-avatar | `<img src="" alt="Foto" id="user-photo">` | `<img alt="Foto" id="user-photo" style="display:none">` |
| dashboard-contas-receber.html | user-avatar | `<img src="" alt="Foto" id="user-photo">` | `<img alt="Foto" id="user-photo" style="display:none">` |

**Problema:** `src=""` causa uma requisição HTTP desnecessária ao carregar a página.

### 3.4 user-initials vs user-initial (Bug de ID)

| Arquivo                       | JS                  | Problema                                                                      |
| ----------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| dashboard-contas-pagar.html   | `carregarUsuario()` | Referencia `getElementById('user-initial')` mas HTML tem `id="user-initials"` |
| dashboard-contas-receber.html | `carregarUsuario()` | Idem                                                                          |

---

## 4. CSS VARIABLES (:root)

### 4.1 `--primary-orange` com Valores Conflitantes

| Arquivo(s)                                                                                                                             | Valor                           | Cor Real                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------- |
| index.html, contas-pagar.html, contas-receber.html, fluxo-caixa.html, bancos.html, relatorios.html, orcamentos.html, plano-contas.html | `--primary-orange: #225cfa`     | **AZUL** (nome misleading!)         |
| conciliacao.html, impostos.html, centros-custo.html                                                                                    | `--primary-orange: #f97316`     | **LARANJA** (correto mas diferente) |
| dashboard-contas-pagar.html, dashboard-contas-receber.html                                                                             | (não define `--primary-orange`) | N/A                                 |

### 4.2 `var(--primary-blue)` NUNCA Definida

**CRÍTICO:** `var(--primary-blue)` é referenciada em MÚLTIPLOS arquivos mas NUNCA definida no `:root`:

| Arquivo             | Onde é usada                                                    | Exemplo                           |
| ------------------- | --------------------------------------------------------------- | --------------------------------- |
| contas-pagar.html   | `.sidebar-btn:hover`, `.btn-primary`, `.form-group input:focus` | `color: var(--primary-blue)`      |
| contas-receber.html | Idem                                                            | Idem                              |
| fluxo-caixa.html    | `.sidebar-btn:hover`                                            | `color: var(--primary-blue)`      |
| bancos.html         | `.sidebar-btn:hover`, botões                                    | `color: var(--primary-blue)`      |
| relatorios.html     | `.btn-primary`, `.card-header h3 i`                             | `background: var(--primary-blue)` |
| orcamentos.html     | `.sidebar-btn:hover`                                            | `color: var(--primary-blue)`      |
| plano-contas.html   | `.sidebar-btn:hover`                                            | `color: var(--primary-blue)`      |

**Resultado:** O browser ignora essas regras, causando estilos não-renderizados ou fallbacks inesperados.

**Correção:** Adicionar `--primary-blue: #225cfa;` ao `:root` de todos os arquivos, OU mover para `fin-components.css`.

### 4.3 `--primary-dark` Inconsistente

| Arquivo(s)           | Valor                     |
| -------------------- | ------------------------- |
| Grupo A (8 arquivos) | `--primary-dark: #1a1a2e` |
| Grupo B (3 arquivos) | `--primary-dark: #1e3a5f` |

### 4.4 `.btn-primary` com COR DIFERENTE em Cada Arquivo

| Arquivo                  | Cor do `.btn-primary`                                       | Cor Hex       |
| ------------------------ | ----------------------------------------------------------- | ------------- |
| index.html               | `var(--primary-orange)` = `#225cfa`                         | Azul          |
| contas-pagar.html        | `var(--danger)` = vermelho                                  | Vermelho      |
| contas-receber.html      | `var(--primary-blue)` (INDEFINIDA) + `#65a30d` hover        | Verde         |
| fluxo-caixa.html         | `var(--primary-orange)` = `#225cfa`                         | Azul          |
| bancos.html              | `var(--primary-blue)` (INDEFINIDA)                          | Nenhum        |
| relatorios.html          | `var(--primary-blue)` (INDEFINIDA)                          | Nenhum        |
| orcamentos.html          | `var(--indigo)` = `#6366f1`                                 | Indigo        |
| plano-contas.html        | `var(--teal)` = `#14b8a6`                                   | Teal          |
| conciliacao.html         | `#225cfa` (hardcoded)                                       | Azul          |
| impostos.html            | `var(--purple)` = `#8b5cf6`                                 | Roxo          |
| centros-custo.html       | `var(--primary-orange)` = `#f97316` + hover `#65a30d` verde | Laranja→Verde |
| dashboard-c-pagar.html   | (definido em CSS externo)                                   | N/A           |
| dashboard-c-receber.html | (definido em CSS externo)                                   | N/A           |

**Recomendação:** `.btn-primary` deve ter UMA cor consistente em todos os arquivos. Definir em `fin-components.css` e remover redefinições inline.

---

## 5. ESTILOS INLINE MASSIVOS

### 5.1 Quantidade de CSS Inline por Arquivo

| Arquivo                  | Lines de `<style>` inline | Componentes Redefinidos                                                                                                                         |
| ------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| index.html               | ~200 linhas               | KPI, charts, vencimentos, modais-omie, cadastro                                                                                                 |
| contas-pagar.html        | ~350 linhas               | sidebar, header, KPIs, filters, table, badges, buttons, modal, form, pagination, notification, btn-action                                       |
| contas-receber.html      | ~500+ linhas              | TUDO (sidebar, header, KPIs, filters, table, badges, buttons, modal, modal-saas, form, pagination, notification, btn-action, status-badge-saas) |
| fluxo-caixa.html         | ~150 linhas               | KPIs, stats, chart, period-selector, list-items, badge-saldo                                                                                    |
| bancos.html              | ~300 linhas               | toast, modal-overlay, modal-padrão, modal-saas, form-saas, banco-card, notification                                                             |
| relatorios.html          | ~400+ linhas              | sidebar, header, notification, page, btn, filters, stats-grid, stat-card, report-card, section-header, summary, card                            |
| conciliacao.html         | ~230 linhas               | notification-panel, KPIs, filters, conciliacao-grid, match-btn, modal-padrao, upload-area                                                       |
| impostos.html            | ~200 linhas               | notification-panel, KPIs, tabs, card, badge, btn-action                                                                                         |
| centros-custo.html       | ~200 linhas               | notification-panel, stats-grid, stat-card, progress-bar, badge, btn-action, search-input                                                        |
| orcamentos.html          | ~300 linhas               | modal-profissional, modal-header-pro, form-section-pro, form-group-pro                                                                          |
| plano-contas.html        | ~300 linhas               | modal-profissional, modal-header-pro, form-section-pro, tree-view                                                                               |
| dashboard-c-pagar.html   | ~200 linhas               | CSS reset, KPIs, cards, charts, tables, badges, vencimento-item                                                                                 |
| dashboard-c-receber.html | ~200 linhas               | Idem dashboard-c-pagar                                                                                                                          |

**Recomendação:** Mover TODO CSS inline para `fin-components.css` ou arquivos CSS específicos. Os componentes compartilhados (notificações, modais, badges, btn-action) devem ser definidos UMA vez.

---

## 6. MODAIS - Classes Não-Padrão

### 6.1 Sistemas de Modal em Uso

| Sistema                        | Arquivos                                                | Classes                                                                     |
| ------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `.modal` + `.modal.active`     | contas-pagar.html                                       | `.modal`, `.modal-content`, `.modal-header`, `.modal-body`, `.modal-footer` |
| `.modal-overlay` + `.active`   | bancos.html                                             | `.modal-overlay`, `.modal-padrão`, `.modal-header-padrão`                   |
| `.modal-overlay-padrao`        | conciliacao.html                                        | `.modal-overlay-padrao`, `.modal-padrao`, `.modal-header-padrao`            |
| `.modal-overlay-padrão` (UTF8) | bancos.html                                             | `.modal-overlay-padrão` (com ã)                                             |
| `.modal-overlay-saas`          | impostos.html, centros-custo.html                       | `.modal-overlay-saas`, `.modal-saas`, `.modal-header-saas`                  |
| `.modal-overlay-omie`          | index.html, contas-pagar.html                           | `.modal-overlay-omie`, `.modal-omie`, `.modal-header-omie`                  |
| `.modal-profissional`          | contas-receber.html, orcamentos.html, plano-contas.html | `.modal-profissional`, `.modal-header-pro-*`                                |
| Modal header SaaS inline       | contas-receber.html, bancos.html                        | `.modal-header-saas`, `.modal-body-saas`, `.modal-footer-saas`              |
| Sem modal (JS dinâmico)        | impostos.html `verImposto()`                            | `document.createElement('div')` inline                                      |

**Recomendação:** Unificar em UM sistema:

```
.modal-overlay > .modal-content > .modal-header + .modal-body + .modal-footer
```

E definir em `modais-saas-unified.css` (que já existe mas não é usado por todos os arquivos).

### 6.2 Encoding Issues em Classes CSS

| Arquivo           | Classe                                                           | Problema                                                              |
| ----------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| bancos.html       | `.modal-overlay-padrão`, `.modal-padrão`, `.modal-header-padrão` | Caractere `ã` em nome de classe CSS pode causar problemas de encoding |
| plano-contas.html | `.modal-overlay-padrão`                                          | Idem                                                                  |

**Correção:** Usar `.modal-overlay-padrao` (sem acento) em todos os lugares.

### 6.3 CSS Syntax Errors em Modais

| Arquivo          | Linha | Problema                                       |
| ---------------- | ----- | ---------------------------------------------- |
| conciliacao.html | ~233  | `.panel-` seletor incompleto (bloco CSS vazio) |
| conciliacao.html | ~240  | `.modal-` seletor incompleto                   |
| impostos.html    | ~230  | `.modal-` seletor incompleto                   |

---

## 7. BOTÕES - Classes Não-Padrão

### 7.1 Classes Customizadas de Botão

| Arquivo           | Classe               | Uso               | Deveria Ser                                  |
| ----------------- | -------------------- | ----------------- | -------------------------------------------- |
| contas-pagar.html | `.btn-importar`      | Importar XLSX     | `.btn .btn-secondary` ou `.btn .btn-outline` |
| fluxo-caixa.html  | `.btn-importar`      | Importar          | Idem                                         |
| bancos.html       | `.btn-importar`      | Importar CSV      | Idem                                         |
| bancos.html       | `.btn-movimentacao`  | Nova Movimentação | `.btn .btn-primary`                          |
| bancos.html       | `.btn-transferencia` | Transferência     | `.btn .btn-secondary`                        |
| bancos.html       | `.btn-novo-banco`    | Novo Banco        | `.btn .btn-success`                          |
| relatorios.html   | `.btn-templates`     | Templates         | `.btn .btn-secondary`                        |
| relatorios.html   | `.btn-agendar`       | Agendar           | `.btn .btn-secondary`                        |
| relatorios.html   | `.btn-imprimir`      | Imprimir          | `.btn .btn-secondary`                        |
| relatorios.html   | `.btn-filtrar`       | Filtrar           | `.btn .btn-primary`                          |

### 7.2 `.btn-saas` vs `.btn` Padrão

Múltiplos arquivos definem `.btn-saas`, `.btn-saas-ghost`, `.btn-saas-primary` inline:

- contas-receber.html (inline)
- bancos.html (inline)

**Recomendação:** Unificar em `fin-components.css` usando classes `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-outline`, `.btn-ghost`.

---

## 8. TABELAS

### 8.1 Classes de Tabela Utilizadas

| Arquivo                  | Classe                   | Padrão?                      |
| ------------------------ | ------------------------ | ---------------------------- |
| index.html               | `<table>` (sem classe)   | ❌ Deveria ser `.data-table` |
| contas-pagar.html        | `<table>` (sem classe)   | ❌                           |
| contas-receber.html      | `.data-table`            | ✅                           |
| fluxo-caixa.html         | `.data-table`            | ✅                           |
| bancos.html              | (sem tabela - usa cards) | N/A                          |
| relatorios.html          | (sem tabela principal)   | N/A                          |
| conciliacao.html         | `.data-table`            | ✅                           |
| impostos.html            | `<table>` (sem classe)   | ❌                           |
| centros-custo.html       | `<table>` (sem classe)   | ❌                           |
| orcamentos.html          | `<table>` (sem classe)   | ❌                           |
| plano-contas.html        | (usa tree-view)          | N/A                          |
| dashboard-c-pagar.html   | `<table>` (sem classe)   | ❌                           |
| dashboard-c-receber.html | `<table>` (sem classe)   | ❌                           |

**Correção:** Adicionar `class="data-table"` a todas as `<table>` sem classe.

---

## 9. CARDS / KPIs

### 9.1 Sistemas de KPI em Uso

| Arquivo                  | Sistema                                     | Classes                                                                                 |
| ------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| index.html               | `.kpi-grid` + `.kpi-card`                   | `.kpi-header`, `.kpi-icon`, `.kpi-content`, `.kpi-value`, `.kpi-trend`, `.kpi-progress` |
| contas-pagar.html        | `.stats-grid` + `.stat-card`                | `.stat-card h3`, `.value`                                                               |
| contas-receber.html      | `.kpi-grid` + `.kpi-card`                   | Mesmo que index                                                                         |
| fluxo-caixa.html         | `.stats-grid` + `.stat-card`                | `.stat-card.entradas`, `.value`                                                         |
| bancos.html              | `.bancos-grid` + `.banco-card`              | Componente customizado                                                                  |
| relatorios.html          | `.stats-grid` + `.stat-card` + `.stat-icon` | Pattern diferente: `.stat-header`, `.stat-label`, `.stat-value`, `.stat-footer`         |
| conciliacao.html         | `.kpi-grid` + `.kpi-card`                   | Mesmo que index                                                                         |
| impostos.html            | `.kpi-grid` + `.kpi-card`                   | Mesmo que index                                                                         |
| centros-custo.html       | `.stats-grid` + `.stat-card` + `.stat-icon` | Diferente: `.stat-info`                                                                 |
| orcamentos.html          | `.kpi-grid` + `.kpi-card`                   | Mesmo que index                                                                         |
| plano-contas.html        | `.kpi-grid` + `.kpi-card`                   | Mesmo que index (se existir)                                                            |
| dashboard-c-pagar.html   | `.kpi-grid` + `.kpi-card`                   | `.label`, `.value`, `.trend` (sem classes kpi-\*)                                       |
| dashboard-c-receber.html | Idem                                        | Idem                                                                                    |

**Recomendação:** Unificar em UM sistema `.kpi-grid` + `.kpi-card` com sub-classes padronizadas.

---

## 10. SCRIPTS - Referências no Footer

### 10.1 Scripts Compartilhados - Presença por Arquivo

| Script                      | index | c-pagar | c-receber | fluxo | bancos | relat | concil | impost | centros | orcam | plano | dash-cp  | dash-cr  |
| --------------------------- | ----- | ------- | --------- | ----- | ------ | ----- | ------ | ------ | ------- | ----- | ----- | -------- | -------- |
| `financeiro-shared.js`      | ✅    | ❓      | ❓        | ✅    | ❓     | ❓    | ❓     | ✅     | ✅      | ❓    | ❓    | ❌       | ❌       |
| `financeiro-sidebar.js`     | ✅    | ✅      | ✅        | ❌    | ✅     | ✅    | ✅     | ✅     | ✅      | ✅    | ✅    | ✅       | ✅       |
| `auth-unified.js`           | ✅    | ✅      | ✅        | ❌    | ✅     | ✅    | ✅     | ✅     | ✅      | ✅    | ✅    | ⚠️ VAZIO | ⚠️ VAZIO |
| `mobile-auto-enhance.js`    | ✅    | ✅      | ✅        | ✅    | ✅     | ✅    | ✅     | ✅     | ✅      | ✅    | ✅    | ✅       | ✅       |
| `widget.js` (chat)          | ✅    | ✅      | ✅        | ✅    | ✅     | ✅    | ✅     | ✅     | ✅      | ✅    | ✅    | ✅       | ✅       |
| `confirm-dialog.js`         | ❌    | ✅      | ✅        | ❌    | ✅     | ❌    | ✅     | ✅     | ✅      | ✅    | ✅    | ❌       | ❌       |
| `accessibility-widget.js`   | ✅    | ❌      | ❌        | ✅    | ❌     | ❌    | ✅     | ✅     | ✅      | ✅    | ✅    | ✅       | ✅       |
| `tooltips-professional.js`  | ✅    | ✅      | ✅        | ✅    | ✅     | ✅    | ✅     | ❌     | ❌      | ❌    | ❌    | ❌       | ❌       |
| `popup-confirmacao.js`      | ✅    | ❌      | ❌        | ❌    | ❌     | ❌    | ❌     | ❌     | ❌      | ❌    | ❌    | ✅       | ✅       |
| `financeiro-user-loader.js` | ❌    | ❌      | ❌        | ❌    | ❌     | ❌    | ❌     | ❌     | ❌      | ❌    | ❌    | ✅       | ✅       |
| `user-profile-loader.js`    | ❌    | ❌      | ❌        | ❌    | ❌     | ❌    | ❌     | ❌     | ❌      | ❌    | ❌    | ✅       | ✅       |

### 10.2 auth-unified.js Ausente no fluxo-caixa.html

| Arquivo          | Problema                                                     | Correção                                                                 |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| fluxo-caixa.html | Não carrega `auth-unified.js` — sem proteção de autenticação | Adicionar `<script src="/js/auth-unified.js?v=20260131" defer></script>` |

### 10.3 Funções carregarUsuario() Duplicadas

Cada arquivo redefine `carregarUsuario()` inline. Deveria estar em `financeiro-shared.js` uma vez.

**Arquivos com carregarUsuario() inline:** index.html, contas-pagar.html, contas-receber.html, fluxo-caixa.html, bancos.html, conciliacao.html, impostos.html, centros-custo.html, orcamentos.html, plano-contas.html, dashboard-c-pagar.html, dashboard-c-receber.html

---

## 11. PROBLEMAS ADICIONAIS

### 11.1 CSS Reset nos Dashboards

| Arquivo                       | Linha | Problema                                                                                                |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| dashboard-contas-pagar.html   | ~60   | `* { margin: 0; padding: 0; box-sizing: border-box; }` — Reset global que pode conflitar com outros CSS |
| dashboard-contas-receber.html | ~60   | Idem                                                                                                    |

### 11.2 `<main>` Aninhado

| Arquivo                       | Problema                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| dashboard-contas-pagar.html   | `<main class="main-area">` contém `<main class="main-content">` — HTML inválido (dois `<main>` aninhados) |
| dashboard-contas-receber.html | Idem                                                                                                      |

**Correção:** O `<main class="main-content">` interno deveria ser `<div class="main-content">`.

### 11.3 content vs page-content vs main-content

| Arquivo                | Wrapper de conteúdo                                    |
| ---------------------- | ------------------------------------------------------ |
| Grupo A (8 arquivos)   | `<div class="main-content"><div class="page-content">` |
| Grupo B (3 arquivos)   | `<div class="main-content"><div class="page-content">` |
| Grupo C (2 dashboards) | `<main class="main-content"><div class="content">`     |

O Grupo C usa `.content` em vez de `.page-content`.

---

## 12. PLANO DE AÇÃO PRIORIZADO

### Prioridade 1 - CRÍTICO (Funcionalidade Comprometida)

1. **Definir `--primary-blue`** em `:root` de todos os 8 arquivos do Grupo A (ou em `fin-components.css`)
2. **Corrigir auth-unified.js** nos dashboards (src vazio)
3. **Adicionar auth-unified.js** ao fluxo-caixa.html
4. **Adicionar `defer`** ao auth nos 3 arquivos do Grupo B
5. **Corrigir bug de ID** `user-initial` → `user-initials` nos dashboards
6. **Remover CSS syntax errors** em conciliacao.html e impostos.html

### Prioridade 2 - ALTO (Consistência Visual)

7. **Unificar cor do `.btn-primary`** — escolher UMA cor (sugestão: `#225cfa`) e usar em todos
8. **Padronizar `--primary-orange`** — renomear para `--primary-blue: #225cfa` em todos
9. **Converter sidebar dos dashboards** de `<button>` para `<a>` tags
10. **Atualizar versão de `fin-header-sidebar.css`** nos 3 arquivos do Grupo B
11. **Adicionar `class="data-table"`** às tabelas sem classe

### Prioridade 3 - MÉDIO (Redução de Dívida Técnica)

12. **Extrair CSS inline** para `fin-components.css` (componentes compartilhados: notificações, badges, btn-action, filters, stats)
13. **Unificar sistema de modais** em `modais-saas-unified.css`
14. **Remover acentos de nomes de classes CSS** (`.modal-padrão` → `.modal-padrao`)
15. **Mover `carregarUsuario()` para `financeiro-shared.js`**
16. **Adicionar meta tags faltantes** nos 3 arquivos do Grupo B
17. **Corrigir `<main>` aninhado** nos dashboards

### Prioridade 4 - BAIXO (Cleanup)

18. **Remover CSS inline dos header-brand** — mover para fin-header-sidebar.css
19. **Padronizar referências a CSS/JS** (mesmas versões em todos os arquivos)
20. **Unificar sistema de KPIs** em classes consistentes
21. **Remover tooltip spans** do fluxo-caixa.html (usar `title=""`)
22. **Remover `src=""` das img** nos dashboards
23. **Padronizar stack de CSS** dos dashboards (adicionar fin-layout.css + fin-components.css)

---

## APÊNDICE: Mapa de CSS Externo por Arquivo

| CSS File                      | index | c-pagar | c-receber | fluxo | bancos | relat | concil | impost | centros | orcam | plano | dash-cp | dash-cr |
| ----------------------------- | ----- | ------- | --------- | ----- | ------ | ----- | ------ | ------ | ------- | ----- | ----- | ------- | ------- |
| fin-layout.css                | ✅    | ✅      | ✅        | ✅    | ✅     | ✅    | ✅     | ✅     | ✅      | ✅    | ✅    | ❌      | ❌      |
| fin-components.css            | ✅    | ✅      | ✅        | ✅    | ✅     | ✅    | ✅     | ✅     | ✅      | ✅    | ✅    | ❌      | ❌      |
| fin-header-sidebar.css        | ✅    | ✅      | ✅        | ✅    | ✅     | ✅    | ✅     | ✅     | ✅      | ✅    | ✅    | ❌      | ❌      |
| global-header-sidebar.css     | ✅    | ✅      | ✅        | ✅    | ✅     | ✅    | ✅     | ✅     | ✅      | ✅    | ✅    | ✅      | ✅      |
| tooltips-professional.css     | ✅    | ✅      | ✅        | ✅    | ✅     | ✅    | ✅     | ❌     | ❌      | ❌    | ❌    | ❌      | ❌      |
| widget.css (chat)             | ✅    | ✅      | ✅        | ❌    | ✅     | ✅    | ✅     | ✅     | ❌      | ✅    | ✅    | ❌      | ❌      |
| modais-saas-unified.css       | ❌    | ❌      | ❌        | ❌    | ❌     | ❌    | ✅     | ❌     | ❌      | ❌    | ❌    | ✅      | ✅      |
| modais-saas.css               | ❌    | ❌      | ❌        | ❌    | ❌     | ❌    | ❌     | ✅     | ✅      | ❌    | ❌    | ❌      | ❌      |
| modais-padrao.css             | ❌    | ❌      | ❌        | ❌    | ❌     | ❌    | ✅     | ❌     | ❌      | ❌    | ❌    | ❌      | ❌      |
| design-system-mobile.css      | ❌    | ❌      | ❌        | ❌    | ❌     | ❌    | ❌     | ❌     | ❌      | ❌    | ❌    | ✅      | ✅      |
| financeiro-sidebar-header.css | ❌    | ❌      | ❌        | ❌    | ❌     | ❌    | ❌     | ❌     | ❌      | ❌    | ❌    | ✅      | ✅      |
