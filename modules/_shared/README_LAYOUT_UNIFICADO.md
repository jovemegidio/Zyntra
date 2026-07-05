# Layout Unificado

O shell atual de cabecalho e menu usa somente os assets globais:

```html
<link rel="stylesheet" href="/css/global-header-sidebar.css?v=20260610">
<script src="/js/global-sidebar-submenu.js?v=20260610b" defer></script>
```

As paginas de modulo devem manter a estrutura padrao com:

```html
<div class="app-container">
  <div class="sidebar-overlay" id="sidebar-overlay"></div>
  <aside class="sidebar" id="mobile-sidebar"></aside>
  <main class="main-area">
    <header class="header"></header>
    <div class="page-content"></div>
  </main>
</div>
```

O JavaScript global reconstrui o menu, aplica marca ativa, respeita os prefixes dos tenants e controla o comportamento mobile. Arquivos antigos nesta pasta existem apenas como wrappers de compatibilidade para paginas legadas que ainda possam chama-los indiretamente.
