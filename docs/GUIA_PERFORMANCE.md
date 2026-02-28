# ALUFORCE - Guia de Otimização de Performance

## 📊 Resumo das Otimizações Implementadas

Este documento descreve as otimizações de performance implementadas para acelerar o carregamento de módulos e melhorar a navegação.

---

## 🚀 1. Sistema Turbo (aluforce-turbo.js)

### O que faz:
- **Cache em memória** com LRU (Least Recently Used)
- **Cache persistente** com IndexedDB (sobrevive a reloads)
- **Prefetch inteligente** de páginas ao passar o mouse em links
- **Navegação SPA-like** sem recarregar página completa
- **Evita requisições duplicadas** automaticamente

### Como usar:

```javascript
// Fetch com cache automático
const data = await window.AluforceTurbo.fetch('/api/clientes');

// Prefetch manual de uma página
window.AluforceTurbo.prefetch('/modules/Financeiro/index.html');

// Invalidar cache após atualização
window.AluforceTurbo.invalidateCache('/api/clientes');

// Ver estatísticas do cache
console.log(window.AluforceTurbo.stats());
```

---

## 📦 2. Data Manager (aluforce-data-manager.js)

### O que faz:
- **Gerenciador centralizado** de dados de API
- **Cache inteligente** com TTL configurável
- **Evita duplicação** de requisições
- **Helpers pré-configurados** para APIs comuns
- **Sistema de subscriptions** para dados reativos

### Como usar:

```javascript
// Buscar dados do usuário (com cache de 5 min)
const user = await window.AluforceData.getUser();

// Buscar clientes
const clientes = await window.AluforceData.getClientes({ limit: 50 });

// Fetch genérico com cache
const data = await window.AluforceData.fetch('/api/custom', {
    ttl: 60000,        // 1 minuto
    forceRefresh: false // usar cache se disponível
});

// POST/PUT/DELETE (invalida cache automaticamente)
await window.AluforceData.post('/api/clientes', { nome: 'Novo Cliente' });

// Múltiplas requisições em paralelo
const [clientes, produtos, user] = await window.AluforceData.fetchAll([
    '/api/clientes',
    '/api/produtos',
    '/api/me'
]);
```

---

## 🎨 3. CSS de Performance (performance-optimizations.css)

### O que inclui:
- **Skeleton loading** para feedback visual instantâneo
- **Transições otimizadas** para navegação
- **GPU acceleration** para elementos animados
- **Content containment** para melhor rendering

### Classes disponíveis:

```html
<!-- Skeleton loading -->
<div class="skeleton skeleton-text"></div>
<div class="skeleton skeleton-card"></div>
<div class="skeleton skeleton-row"></div>

<!-- Botão com loading -->
<button class="btn btn-loading">Salvando...</button>

<!-- Container com loading overlay -->
<div style="position: relative;">
    <div class="loading-overlay active">
        <div class="spinner"></div>
    </div>
    <!-- conteúdo -->
</div>

<!-- Fade in ao carregar -->
<div class="content-fade-in">Conteúdo carregado</div>
```

---

## 💡 4. Boas Práticas para Módulos

### 4.1 Ao carregar uma página:

```javascript
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Mostrar skeleton imediatamente
    document.getElementById('tabela-container').innerHTML = `
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
    `;
    
    // 2. Carregar dados com cache
    try {
        const data = await window.AluforceData.fetch('/api/dados');
        renderizarTabela(data);
    } catch (e) {
        mostrarErro(e);
    }
    
    // 3. Pré-carregar páginas relacionadas
    window.AluforceTurbo.prefetch('/modules/Financeiro/contas-pagar.html');
});
```

### 4.2 Ao fazer navegação interna:

```javascript
// O sistema intercepta automaticamente cliques em links
// Para forçar navegação tradicional:
<a href="/pagina" data-turbo="false">Link sem turbo</a>

// Para navegar programaticamente:
window.AluforceTurbo.navigate('/modules/Vendas/clientes.html');
```

### 4.3 Ao salvar dados:

```javascript
async function salvarCliente(dados) {
    const btn = document.querySelector('#btn-salvar');
    btn.classList.add('btn-loading');
    
    try {
        // POST invalida cache automaticamente
        await window.AluforceData.post('/api/clientes', dados);
        
        // Opcional: forçar refresh dos dados
        await window.AluforceData.getClientes({ forceRefresh: true });
        
        mostrarSucesso('Cliente salvo!');
    } catch (e) {
        mostrarErro(e);
    } finally {
        btn.classList.remove('btn-loading');
    }
}
```

---

## 📈 5. Monitorando Performance

### No Console do Browser:

```javascript
// Ver estatísticas do cache
window.AluforceTurbo.stats();
// { memoryCache: { total: 15, active: 12, expired: 3 }, prefetchedUrls: 8 }

window.AluforceData.stats();
// { cacheSize: 20, activeItems: 18, pendingRequests: 0 }

// Limpar todo cache (útil para debug)
window.AluforceTurbo.clearCache();
window.AluforceData.invalidate();
```

---

## 🔧 6. Configuração

### Ajustar TTL do cache:

```javascript
// No aluforce-turbo.js
CONFIG.CACHE_TTL = {
    api: 60 * 1000,           // 1 minuto
    apiStatic: 5 * 60 * 1000, // 5 minutos
    page: 30 * 60 * 1000,     // 30 minutos
    userData: 10 * 60 * 1000  // 10 minutos
};

// No aluforce-data-manager.js
window.AluforceData.config.defaultTTL = 60000;
window.AluforceData.config.userDataTTL = 300000;
```

### Desabilitar navegação turbo se necessário:

```javascript
// Desabilitar completamente
window.AluforceTurbo.disableTurboNav();

// Reabilitar
window.AluforceTurbo.enableTurboNav();

// Ou por link específico:
<a href="/pagina" data-turbo="false">Link normal</a>
```

---

## ✅ Checklist de Implementação por Módulo

Para cada módulo, verificar:

- [ ] Incluir os CSS/JS de performance no `<head>`
- [ ] Usar skeleton loading nas tabelas/cards
- [ ] Trocar `fetch()` por `window.AluforceData.fetch()`
- [ ] Adicionar `class="btn-loading"` em botões de ação
- [ ] Pré-carregar páginas relacionadas no DOMContentLoaded
- [ ] Testar navegação entre páginas

---

## 📱 Compatibilidade

- ✅ Chrome 80+
- ✅ Firefox 75+
- ✅ Safari 13+
- ✅ Edge 80+
- ✅ Mobile (iOS Safari, Chrome Android)
- ⚠️ IE11 não suportado (fallback para navegação tradicional)

---

## 🐛 Troubleshooting

### Cache não está funcionando:
```javascript
// Verificar se IndexedDB está disponível
console.log('IndexedDB:', 'indexedDB' in window);

// Ver conteúdo do cache
console.log(window.AluforceTurbo.stats());
```

### Navegação turbo causando problemas:
```javascript
// Desabilitar temporariamente
window.AluforceTurbo.disableTurboNav();

// Ou adicionar em links problemáticos:
<a href="/pagina" data-turbo="false">Link</a>
```

### Dados desatualizados:
```javascript
// Forçar refresh
await window.AluforceData.fetch('/api/dados', { forceRefresh: true });

// Ou invalidar cache específico
window.AluforceData.invalidate('/api/dados');
```
