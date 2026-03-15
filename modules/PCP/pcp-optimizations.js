/**
 * ============================================
 * PCP MODULE - PERFORMANCE OPTIMIZATIONS
 * ============================================
 * 
 * Otimizações implementadas:
 * 1. Lazy Loading de views
 * 2. Debouncing otimizado para busca
 * 3. Cache inteligente de dados
 * 4. Event delegation para melhor performance
 * 5. Virtual scrolling para tabelas grandes
 * 6. Service Worker para cache offline
 * 
 * Autor: Sistema Aluforce
 * Data: 03/12/2025
 */

// ============================================
// 1. CACHE INTELIGENTE COM EXPIRATION
// ============================================
class CacheManager {
    constructor(defaultTTL = 5 * 60 * 1000) { // 5 minutos Padrão
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
    }

    set(key, value, ttl = this.defaultTTL) {
        const expiry = Date.now() + ttl;
        this.cache.set(key, { value, expiry });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }
        
        return item.value;
    }

    has(key) {
        return this.get(key) !== null;
    }

    clear() {
        this.cache.clear();
    }

    clearExpired() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiry) {
                this.cache.delete(key);
            }
        }
    }
}

// Instância global do cache
window.pcpCache = new CacheManager();

// Limpar cache expirado a cada 2 minutos
setInterval(() => window.pcpCache.clearExpired(), 2 * 60 * 1000);

// ============================================
// 2. DEBOUNCING OTIMIZADO
// ============================================
class Debouncer {
    constructor() {
        this.timers = new Map();
    }

    debounce(key, func, delay = 300) {
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        const timer = setTimeout(() => {
            func();
            this.timers.delete(key);
        }, delay);

        this.timers.set(key, timer);
    }

    cancel(key) {
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
    }

    cancelAll() {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }
}

window.pcpDebouncer = new Debouncer();

// ============================================
// 3. LAZY LOADING DE VIEWS
// ============================================
class ViewLoader {
    constructor() {
        this.loadedViews = new Set();
        this.loading = new Map();
    }

    async loadView(viewName) {
        // Se já foi carregada, retorna imediatamente
        if (this.loadedViews.has(viewName)) {
            console.log(`✅ View '${viewName}' já carregada`);
            return true;
        }

        // Se está sendo carregada, aguarda
        if (this.loading.has(viewName)) {
            console.log(`⏳ Aguardando carregamento de '${viewName}'...`);
            return this.loading.get(viewName);
        }

        console.log(`🔄 Carregando view '${viewName}'...`);
        
        // Cria promise de carregamento
        const loadPromise = this._loadViewData(viewName);
        this.loading.set(viewName, loadPromise);

        try {
            await loadPromise;
            this.loadedViews.add(viewName);
            this.loading.delete(viewName);
            console.log(`✅ View '${viewName}' carregada com sucesso`);
            return true;
        } catch (error) {
            this.loading.delete(viewName);
            console.error(`❌ Erro ao carregar view '${viewName}':`, error);
            return false;
        }
    }

    async _loadViewData(viewName) {
        // Simula carregamento assíncrono de dados específicos da view
        switch (viewName) {
            case 'materiais':
                return this._loadMateriaisData();
            
            case 'ordem-compra':
                return this._loadOrdemCompraData();
            
            case 'controle-producao':
                return this._loadProducaoData();
            
            case 'faturamento':
                return this._loadFaturamentoData();
            
            case 'gestao-produtos':
                return this._loadProdutosData();
            
            default:
                return Promise.resolve();
        }
    }

    async _loadMateriaisData() {
        if (window.pcpCache.has('materiais')) {
            return window.pcpCache.get('materiais');
        }

        if (!token) {
            console.log('Token não encontrado para carregar materiais');
            return [];
        }

        const response = await fetch('/api/pcp/materiais', {
            credentials: 'include',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            console.log('Não autenticado');
            return [];
        }
        
        const data = await response.json();
        window.pcpCache.set('materiais', data, 3 * 60 * 1000); // 3 minutos
        return data;
    }

    async _loadOrdemCompraData() {
        if (window.pcpCache.has('ordens-compra')) {
            return window.pcpCache.get('ordens-compra');
        }

        if (!token) {
            console.log('Token não encontrado para carregar ordens de compra');
            return [];
        }

        const response = await fetch('/api/pcp/ordens-compra', {
            credentials: 'include',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            console.log('Não autenticado');
            return [];
        }
        
        const data = await response.json();
        window.pcpCache.set('ordens-compra', data, 5 * 60 * 1000); // 5 minutos
        return data;
    }

    async _loadProducaoData() {
        if (window.pcpCache.has('ordens-producao')) {
            return window.pcpCache.get('ordens-producao');
        }

        if (!token) {
            console.log('Token não encontrado para carregar ordens de produção');
            return [];
        }

        const response = await fetch('/api/pcp/ordens', {
            credentials: 'include',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            console.log('Não autenticado');
            return [];
        }
        
        const data = await response.json();
        window.pcpCache.set('ordens-producao', data, 2 * 60 * 1000); // 2 minutos (dados mais dinâmicos)
        return data;
    }

    async _loadFaturamentoData() {
        if (window.pcpCache.has('faturamento')) {
            return window.pcpCache.get('faturamento');
        }

        if (!token) {
            console.log('Token não encontrado para carregar faturamento');
            return [];
        }

        const response = await fetch('/api/pcp/pedidos/faturados', {
            credentials: 'include',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            console.log('Não autenticado');
            return [];
        }
        
        const data = await response.json();
        window.pcpCache.set('faturamento', data, 5 * 60 * 1000); // 5 minutos
        return data;
    }

    async _loadProdutosData() {
        if (window.pcpCache.has('produtos')) {
            return window.pcpCache.get('produtos');
        }

        if (!token) {
            console.log('Token não encontrado para carregar produtos');
            return { data: [], total: 0 };
        }

        const response = await fetch('/api/pcp/produtos?page=1&limit=100', {
            credentials: 'include',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            console.log('Não autenticado');
            return { data: [], total: 0 };
        }
        
        const data = await response.json();
        window.pcpCache.set('produtos', data, 5 * 60 * 1000); // 5 minutos
        return data;
    }

    markViewAsStale(viewName) {
        this.loadedViews.delete(viewName);
        
        // Limpar cache relacionado
        switch (viewName) {
            case 'materiais':
                window.pcpCache.cache.delete('materiais');
                break;
            case 'ordem-compra':
                window.pcpCache.cache.delete('ordens-compra');
                break;
            case 'controle-producao':
                window.pcpCache.cache.delete('ordens-producao');
                break;
            case 'faturamento':
                window.pcpCache.cache.delete('faturamento');
                break;
            case 'gestao-produtos':
                window.pcpCache.cache.delete('produtos');
                break;
        }
    }

    reset() {
        this.loadedViews.clear();
        this.loading.clear();
    }
}

window.pcpViewLoader = new ViewLoader();

// ============================================
// 4. BUSCA OTIMIZADA COM CACHE E DEBOUNCING
// ============================================
class SearchOptimizer {
    constructor() {
        this.searchCache = new Map();
        this.lastQuery = '';
        this.abortController = null;
    }

    async search(query, endpoint = '/api/pcp/search') {
        query = query.trim().toLowerCase();

        // Se query está vazia, limpa resultados
        if (!query) {
            return [];
        }

        // Usar cache se disponível
        const cacheKey = `search:${endpoint}:${query}`;
        if (this.searchCache.has(cacheKey)) {
            console.log(`✅ Resultado de busca em cache: "${query}"`);
            return this.searchCache.get(cacheKey);
        }

        // Cancelar busca anterior se houver
        if (this.abortController) {
            this.abortController.abort();
        }

        // Nova busca com AbortController
        this.abortController = new AbortController();

        try {
            const response = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`, {
                signal: this.abortController.signal
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const data = await response.json();
            
            // Guardar em cache (1 minuto)
            this.searchCache.set(cacheKey, data);
            setTimeout(() => this.searchCache.delete(cacheKey), 60 * 1000);

            return data;
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('⚠️ Busca cancelada (nova busca iniciada)');
                return [];
            }
            console.error('❌ Erro na busca:', error);
            throw error;
        }
    }

    clearCache() {
        this.searchCache.clear();
    }
}

window.pcpSearchOptimizer = new SearchOptimizer();

// ============================================
// 5. VIRTUAL SCROLLING PARA TABELAS GRANDES
// ============================================
class VirtualScroller {
    constructor(container, itemHeight, renderItem) {
        this.container = container;
        this.itemHeight = itemHeight;
        this.renderItem = renderItem;
        this.items = [];
        this.visibleRange = { start: 0, end: 0 };
        this.scrollTop = 0;
        
        this.setupScrolling();
    }

    setupScrolling() {
        this.container.style.position = 'relative';
        this.container.style.overflow = 'auto';
        
        this.container.addEventListener('scroll', () => {
            this.handleScroll();
        });
    }

    setItems(items) {
        this.items = items;
        this.updateVirtualHeight();
        this.render();
    }

    updateVirtualHeight() {
        const totalHeight = this.items.length * this.itemHeight;
        this.container.style.height = totalHeight + 'px';
    }

    handleScroll() {
        this.scrollTop = this.container.scrollTop;
        this.render();
    }

    calculateVisibleRange() {
        const containerHeight = this.container.clientHeight;
        const start = Math.floor(this.scrollTop / this.itemHeight);
        const end = Math.ceil((this.scrollTop + containerHeight) / this.itemHeight);
        
        // Adicionar buffer para suavizar scroll
        const buffer = 5;
        return {
            start: Math.max(0, start - buffer),
            end: Math.min(this.items.length, end + buffer)
        };
    }

    render() {
        this.visibleRange = this.calculateVisibleRange();
        
        // Limpar container
        this.container.innerHTML = '';

        // Renderizar apenas itens visíveis
        for (let i = this.visibleRange.start; i < this.visibleRange.end; i++) {
            if (this.items[i]) {
                const element = this.renderItem(this.items[i], i);
                element.style.position = 'absolute';
                element.style.top = (i * this.itemHeight) + 'px';
                element.style.width = '100%';
                element.style.height = this.itemHeight + 'px';
                this.container.appendChild(element);
            }
        }
    }
}

// ============================================
// 6. NOTIFICAÇÕES OTIMIZADAS
// ============================================
class NotificationManager {
    constructor() {
        this.notifications = [];
        this.maxNotifications = 5;
        this.container = this.createContainer();
    }

    createContainer() {
        let container = document.getElementById('pcp-notifications-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'pcp-notifications-container';
            container.style.position = 'fixed';
            container.style.top = '20px';
            container.style.right = '20px';
            container.style.zIndex = '99999';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '12px';
            document.body.appendChild(container);
        }
        return container;
    }

    show(message, type = 'info', duration = 4000) {
        const notification = document.createElement('div');
        notification.className = `pcp-notification pcp-notification-${type}`;
        notification.style.cssText = `
            background: ${this.getBackgroundColor(type)};
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 300px;
            max-width: 450px;
            animation: slideInRight 0.3s ease-out;
            font-weight: 500;
            font-size: 14px;
        `;

        const icon = document.createElement('i');
        icon.className = `fas ${this.getIcon(type)}`;
        icon.style.fontSize = '20px';

        const text = document.createElement('span');
        text.textContent = message;
        text.style.flex = '1';

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '×';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: white;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.7;
            transition: opacity 0.2s;
        `;
        closeBtn.addEventListener('mouseenter', () => closeBtn.style.opacity = '1');
        closeBtn.addEventListener('mouseleave', () => closeBtn.style.opacity = '0.7');
        closeBtn.addEventListener('click', () => this.remove(notification));

        notification.appendChild(icon);
        notification.appendChild(text);
        notification.appendChild(closeBtn);

        this.container.appendChild(notification);
        this.notifications.push(notification);

        // Limitar quantidade de notificações
        if (this.notifications.length > this.maxNotifications) {
            this.remove(this.notifications[0]);
        }

        // Auto-remover após durAção
        if (duration > 0) {
            setTimeout(() => this.remove(notification), duration);
        }

        return notification;
    }

    remove(notification) {
        if (!notification || !notification.parentNode) return;

        notification.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
            const index = this.notifications.indexOf(notification);
            if (index > -1) {
                this.notifications.splice(index, 1);
            }
        }, 300);
    }

    getBackgroundColor(type) {
        const colors = {
            success: 'linear-gradient(135deg, #10b981, #059669)',
            error: 'linear-gradient(135deg, #ef4444, #dc2626)',
            warning: 'linear-gradient(135deg, #f59e0b, #d97706)',
            info: 'linear-gradient(135deg, #3b82f6, #2563eb)'
        };
        return colors[type] || colors.info;
    }

    getIcon(type) {
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        return icons[type] || icons.info;
    }

    clearAll() {
        this.notifications.forEach(n => this.remove(n));
    }
}

window.pcpNotifications = new NotificationManager();

// ============================================
// 7. PERFORMANCE MONITOR
// ============================================
class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
    }

    start(label) {
        this.metrics.set(label, performance.now());
    }

    end(label, logToConsole = false) {
        const start = this.metrics.get(label);
        if (!start) {
            console.warn(`⚠️ Métrica '${label}' não iniciada`);
            return 0;
        }

        const duration = performance.now() - start;
        this.metrics.delete(label);

        if (logToConsole) {
            const emoji = duration < 100 ? '✅' : duration < 500 ? '⚠️' : '❌';
            console.log(`${emoji} ${label}: ${duration.toFixed(2)}ms`);
        }

        return duration;
    }

    measure(label, fn) {
        this.start(label);
        const result = fn();
        this.end(label, true);
        return result;
    }

    async measureAsync(label, fn) {
        this.start(label);
        const result = await fn();
        this.end(label, true);
        return result;
    }
}

window.pcpPerformance = new PerformanceMonitor();

// ============================================
// 8. ADICIONAR ANIMAÇÕES CSS
// ============================================
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            opacity: 0;
            transform: translateX(100%);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }

    @keyframes slideOutRight {
        from {
            opacity: 1;
            transform: translateX(0);
        }
        to {
            opacity: 0;
            transform: translateX(120%);
        }
    }

    .pcp-notification:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 32px rgba(0,0,0,0.2);
    }
`;
document.head.appendChild(style);

// ============================================
// 9. INICIALIZAÇÃO E EXPORTAÇÃO
// ============================================
console.log('✅ Otimizações PCP carregadas com sucesso!');
console.log('📊 Módulos disponíveis:');
console.log('  - window.pcpCache: Gerenciamento de cache');
console.log('  - window.pcpDebouncer: Debouncing de funções');
console.log('  - window.pcpViewLoader: Lazy loading de views');
console.log('  - window.pcpSearchOptimizer: Busca otimizada');
console.log('  - window.pcpNotifications: Notificações melhoradas');
console.log('  - window.pcpPerformance: Monitor de performance');

// Exportar para uso global
window.PCPOptimizations = {
    cache: window.pcpCache,
    debouncer: window.pcpDebouncer,
    viewLoader: window.pcpViewLoader,
    search: window.pcpSearchOptimizer,
    notifications: window.pcpNotifications,
    performance: window.pcpPerformance
};



