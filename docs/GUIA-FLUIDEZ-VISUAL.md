# ALUFORCE - Guia de Fluidez Visual e Funcional

## 📋 Resumo das Melhorias Implementadas

Este documento descreve as otimizações de performance e fluidez visual implementadas no sistema ALUFORCE.

---

## 🎨 1. Animações Fluidas (CSS)

**Arquivo:** `/public/css/fluid-animations.css`

### Funcionalidades:
- **Transições otimizadas** para botões, cards, modais e inputs
- **Efeito ripple** estilo Material Design em cliques
- **Skeleton loading** para carregamento de conteúdo
- **Toasts/Notificações** animadas
- **Scroll suave** nativo
- **Animações de entrada** escalonadas para cards
- **Feedback visual** para sucesso/erro

### Variáveis CSS disponíveis:
```css
--ease-out-expo      /* Animação suave de saída */
--ease-spring        /* Animação com efeito de mola */
--duration-fast      /* 150ms */
--duration-normal    /* 200ms */
--duration-slow      /* 300ms */
```

---

## ⚡ 2. Sistema de UI Fluida (JavaScript)

**Arquivo:** `/public/js/aluforce-fluid-ui.js`

### APIs Disponíveis:

#### Toast/Notificações
```javascript
// Mostrar notificação
showToast('Salvo com sucesso!', 'success');
showToast('Erro ao salvar', 'error');
showToast('Atenção!', 'warning');
showToast('Informação', 'info');

// Com opções
showToast('Registro excluído', 'success', {
    title: 'Sucesso',
    duration: 5000,
    action: () => console.log('Desfazer'),
    actionText: 'Desfazer'
});
```

#### Skeleton Loading
```javascript
// Mostrar skeleton em um elemento
showSkeleton('#minha-div', { type: 'card', count: 3 });

// Tipos disponíveis: 'card', 'list', 'table', 'text', 'module'

// Esconder skeleton e mostrar conteúdo
hideSkeleton('#minha-div', '<p>Conteúdo carregado!</p>');
```

#### Botões com Loading
```javascript
const btn = document.getElementById('meu-botao');

// Iniciar loading
setButtonLoading(btn, 'Salvando...');

// Parar loading (com feedback de sucesso)
stopButtonLoading(btn, true);
```

#### Feedback Visual
```javascript
// Feedback de sucesso (pulso verde)
AluforceUI.feedback.success(elemento);

// Feedback de erro (shake vermelho)
AluforceUI.feedback.error(elemento);

// Destacar linha em tabela
AluforceUI.feedback.highlight(linhaTabela);
```

---

## 🚀 3. Otimizador de Performance (JavaScript)

**Arquivo:** `/public/js/aluforce-optimizer.js`

### APIs Disponíveis:

#### Cache de API
```javascript
// Fetch com cache automático (5 minutos)
const dados = await cachedFetch('/api/usuarios');

// Fetch autenticado com cache
const protegido = await authFetch('/api/me');

// Invalidar cache
AluforceOptimizer.apiCache.invalidate('/api/usuarios');
```

#### Debounce e Throttle
```javascript
// Debounce (executa após parar de digitar)
input.addEventListener('input', () => {
    debounce('busca', () => {
        buscar(input.value);
    }, 300);
});

// Throttle (executa no máximo 1x a cada 100ms)
window.addEventListener('scroll', () => {
    throttle('scroll', () => {
        atualizarPosicao();
    }, 100);
});
```

#### Preload Inteligente
```javascript
// Preload de scripts
AluforceOptimizer.preloader.preloadScript('/js/modulo-vendas.js');

// Preload de imagens
AluforceOptimizer.preloader.preloadImage('/images/logo.png');
```

#### Métricas de Performance
```javascript
// Medir tempo de execução
AluforceOptimizer.performance.start('minha-operacao');
// ... código ...
AluforceOptimizer.performance.end('minha-operacao');
// Output: 🟢 minha-operacao: 45.2ms
```

---

## 📱 4. Classes CSS Utilitárias

### Skeleton Loading
```html
<div class="skeleton skeleton-card"></div>
<div class="skeleton skeleton-text"></div>
<div class="skeleton skeleton-avatar"></div>
```

### Spinners
```html
<div class="spinner"></div>
<div class="spinner small"></div>
<div class="spinner large"></div>
```

### Loading Dots
```html
<div class="loading-dots">
    <span></span>
    <span></span>
    <span></span>
</div>
```

### Feedback
```html
<button class="success-feedback">...</button>
<input class="error-feedback">
<tr class="row-highlight">...</tr>
```

### Tooltips
```html
<button data-tooltip="Clique para salvar">Salvar</button>
```

### Desabilitar Ripple
```html
<button data-no-ripple>Sem Ripple</button>
```

---

## 🛠️ 5. Boas Práticas

### Para Carregamento de Dados
```javascript
async function carregarDados() {
    const container = document.getElementById('lista');
    
    // Mostrar skeleton enquanto carrega
    showSkeleton(container, { type: 'list', count: 5 });
    
    try {
        const dados = await authFetch('/api/dados');
        
        // Renderizar e esconder skeleton
        const html = dados.map(item => `<div>${item.nome}</div>`).join('');
        hideSkeleton(container, html);
        
    } catch (error) {
        hideSkeleton(container, '<p>Erro ao carregar</p>');
        showToast('Erro ao carregar dados', 'error');
    }
}
```

### Para Formulários
```javascript
async function salvarFormulario(form) {
    const btn = form.querySelector('button[type="submit"]');
    
    // Iniciar loading no botão
    setButtonLoading(btn, 'Salvando...');
    
    try {
        await fetch('/api/salvar', {
            method: 'POST',
            body: new FormData(form)
        });
        
        // Feedback de sucesso
        stopButtonLoading(btn, true);
        showToast('Salvo com sucesso!', 'success');
        
    } catch (error) {
        stopButtonLoading(btn, false);
        showToast('Erro ao salvar', 'error');
        AluforceUI.feedback.shake(form);
    }
}
```

### Para Tabelas com Atualização
```javascript
function atualizarLinha(linha, dados) {
    // Atualizar conteúdo
    linha.querySelector('.nome').textContent = dados.nome;
    
    // Destacar linha alterada
    AluforceUI.feedback.highlight(linha);
}
```

---

## ⚙️ 6. Configurações

### Desabilitar animações para usuários com preferência
O CSS já respeita automaticamente:
```css
@media (prefers-reduced-motion: reduce) {
    /* Animações desabilitadas */
}
```

### Personalizar duração de toasts
```javascript
showToast('Mensagem', 'info', { duration: 8000 }); // 8 segundos
showToast('Permanente', 'warning', { duration: 0 }); // Não fecha sozinho
```

---

## 📊 7. Debug de Performance

Abra o console do navegador para ver métricas:
```
⚡ Página carregada em 234ms
🟢 [Performance] init: 12.5ms
📊 LCP: 456ms
📊 FID: 23ms
```

---

## 🔧 8. Troubleshooting

### Animações não funcionam
1. Verifique se `/css/fluid-animations.css` está carregado
2. Verifique se não há `!important` conflitante

### Toast não aparece
1. Verifique se `/js/aluforce-fluid-ui.js` está carregado
2. Verifique o console por erros

### Skeleton fica infinito
1. Certifique-se de chamar `hideSkeleton()` após carregar dados
2. Trate erros com try/catch

---

## 📝 Changelog

**v1.0.0 (2026-01-11)**
- Implementação inicial
- CSS de animações fluidas
- Sistema de Toast
- Skeleton Loading
- Botões com Loading State
- Cache de API
- Otimizações de performance
