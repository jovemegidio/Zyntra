/**
 * ============================================================
 * ALUFORCE TURBO - Sistema Avançado de Performance
 * Otimização extrema para navegação instantnea entre módulos
 * ============================================================
 *
 * Recursos:
 * - Prefetch inteligente de módulos
 * - Cache de páginas HTML completas
 * - SPA-like navigation (sem reload completo)
 * - Skeleton loading instantneo
 * - IndexedDB para cache persistente
 * - Compressão de dados em memória
 * ============================================================
 */

(function() {
    'use strict';

    // ============================================================
    // 1. CONFIGURAÇÃO
    // ============================================================
    const CONFIG = {
        // Cache
        CACHE_VERSION: 'v1.0.0',
        CACHE_TTL: {
            api: 60 * 1000,           // 1 minuto para APIs
            apiStatic: 5 * 60 * 1000, // 5 minutos para dados estáticos
            page: 30 * 60 * 1000,     // 30 minutos para páginas
            userData: 10 * 60 * 1000  // 10 minutos para dados do usuário
        },

        // Prefetch
        PREFETCH_DELAY: 150,          // ms após hover para iniciar prefetch
        MAX_PREFETCH_CONCURRENT: 3,

        // Navegação
        TRANSITION_DURATION: 200,     // ms

        // IndexedDB
        DB_NAME: 'AluforceCache',
        DB_VERSION: 1
    };

    // ============================================================
    // 2. CACHE EM MEMÓRIA OTIMIZADO
    // ============================================================
    class TurboCache {
        constructor() {
            this.memoryCache = new Map();
            this.accessCount = new Map();
            this.maxSize = 100; // Máximo de itens
        }

        set(key, value, ttl = CONFIG.CACHE_TTL.api) {
            // LRU: Remove item menos usado se cache cheio
            if (this.memoryCache.size >= this.maxSize) {
                this._evictLRU();
            }

            this.memoryCache.set(key, {
                value,
                expires: Date.now() + ttl,
                created: Date.now()
            });
            this.accessCount.set(key, 1);

            return value;
        }

        get(key) {
            const item = this.memoryCache.get(key);
            if (!item) return null;

            if (Date.now() > item.expires) {
                this.delete(key);
                return null;
            }

            // Incrementar contador de acesso (LRU)
            this.accessCount.set(key, (this.accessCount.get(key) || 0) + 1);
            return item.value;
        }

        has(key) {
            return this.get(key) !== null;
        }

        delete(key) {
            this.memoryCache.delete(key);
            this.accessCount.delete(key);
        }

        clear() {
            this.memoryCache.clear();
            this.accessCount.clear();
        }

        _evictLRU() {
            let lruKey = null;
            let minAccess = Infinity;

            for (const [key, count] of this.accessCount) {
                if (count < minAccess) {
                    minAccess = count;
                    lruKey = key;
                }
            }

            if (lruKey) {
                this.delete(lruKey);
            }
        }

        // Retorna estatísticas do cache
        stats() {
            let expired = 0;
            let active = 0;
            const now = Date.now();

            for (const [key, item] of this.memoryCache) {
                if (now > item.expires) {
                    expired++;
                } else {
                    active++;
                }
            }

            return { total: this.memoryCache.size, active, expired };
        }
    }

    // ============================================================
    // 3. INDEXED DB PARA CACHE PERSISTENTE
    // ============================================================
    class PersistentCache {
        constructor() {
            this.db = null;
            this.ready = this._init();
        }

        async _init() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

                request.onerror = () => {
                    console.warn('⚠️ IndexedDB não disponível, usando apenas memória');
                    resolve(false);
                };

                request.onsuccess = (e) => {
                    this.db = e.target.result;
                    console.log('✅ IndexedDB inicializado');
                    resolve(true);
                };

                request.onupgradeneeded = (e) => {
                    const db = e.target.result;

                    // Store para páginas HTML
                    if (!db.objectStoreNames.contains('pages')) {
                        db.createObjectStore('pages', { keyPath: 'url' });
                    }

                    // Store para dados de API
                    if (!db.objectStoreNames.contains('api')) {
                        db.createObjectStore('api', { keyPath: 'key' });
                    }

                    // Store para assets
                    if (!db.objectStoreNames.contains('assets')) {
                        db.createObjectStore('assets', { keyPath: 'url' });
                    }
                };
            });
        }

        async set(store, key, value, ttl = CONFIG.CACHE_TTL.page) {
            await this.ready;
            if (!this.db) return false;

            return new Promise((resolve) => {
                try {
                    const tx = this.db.transaction(store, 'readwrite');
                    const os = tx.objectStore(store);

                    os.put({
                        key: key,
                        url: key,
                        value,
                        expires: Date.now() + ttl,
                        created: Date.now()
                    });

                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                } catch (e) {
                    resolve(false);
                }
            });
        }

        async get(store, key) {
            await this.ready;
            if (!this.db) return null;

            return new Promise((resolve) => {
                try {
                    const tx = this.db.transaction(store, 'readonly');
                    const os = tx.objectStore(store);
                    const request = os.get(key);

                    request.onsuccess = () => {
                        const item = request.result;
                        if (!item) return resolve(null);

                        if (Date.now() > item.expires) {
                            this.delete(store, key);
                            return resolve(null);
                        }

                        resolve(item.value);
                    };

                    request.onerror = () => resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }

        async delete(store, key) {
            await this.ready;
            if (!this.db) return;

            const tx = this.db.transaction(store, 'readwrite');
            tx.objectStore(store).delete(key);
        }

        async clearExpired() {
            await this.ready;
            if (!this.db) return;

            const stores = ['pages', 'api', 'assets'];
            const now = Date.now();

            for (const storeName of stores) {
                const tx = this.db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const request = store.openCursor();

                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        if (cursor.value.expires < now) {
                            cursor.delete();
                        }
                        cursor.continue();
                    }
                };
            }
        }
    }

    // ============================================================
    // 4. FETCH TURBINADO COM CACHE INTELIGENTE
    // ============================================================
    class TurboFetch {
        constructor(memoryCache, persistentCache) {
            this.memory = memoryCache;
            this.persistent = persistentCache;
            this.pendingRequests = new Map();
        }

        async fetch(url, options = {}) {
            const {
                cache = true,
                ttl = CONFIG.CACHE_TTL.api,
                priority = 'normal',
                retries = 2
            } = options;

            const cacheKey = this._generateKey(url, options);

            // 1. Verificar cache em memória (mais rápido)
            if (cache) {
                const memCached = this.memory.get(cacheKey);
                if (memCached) {
                    console.log('⚡ Turbo Cache HIT (memory):', url);
                    return memCached;
                }
            }

            // 2. Verificar cache persistente
            if (cache) {
                const persistCached = await this.persistent.get('api', cacheKey);
                if (persistCached) {
                    // Salvar em memória para próximo acesso
                    this.memory.set(cacheKey, persistCached, ttl);
                    console.log('💾 Turbo Cache HIT (persistent):', url);
                    return persistCached;
                }
            }

            // 3. Evitar requests duplicados
            if (this.pendingRequests.has(cacheKey)) {
                console.log('🔄 Request já em andamento, aguardando:', url);
                return this.pendingRequests.get(cacheKey);
            }

            // 4. Fazer request
            console.log('🌐 Fetching:', url);
            const fetchPromise = this._fetchWithRetry(url, options, retries);
            this.pendingRequests.set(cacheKey, fetchPromise);

            try {
                const data = await fetchPromise;

                // Cachear resultado
                if (cache && data) {
                    this.memory.set(cacheKey, data, ttl);
                    this.persistent.set('api', cacheKey, data, ttl);
                }

                return data;
            } finally {
                this.pendingRequests.delete(cacheKey);
            }
        }

        async _fetchWithRetry(url, options, retries) {
            // Remover propriedades internas que não são válidas para fetch nativo
            const { cache, ttl, priority, retries: _, ...fetchOptions } = options;

            for (let i = 0; i <= retries; i++) {
                try {
                    const response = await fetch(url, {
                        ...fetchOptions,
                        credentials: 'include'
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    return await response.json();
                } catch (error) {
                    if (i === retries) {
                        console.error('❌ Fetch falhou após', retries, 'tentativas:', url);
                        throw error;
                    }
                    // Esperar antes de retry (exponential backoff)
                    await new Promise(r => setTimeout(r, Math.pow(2, i) * 100));
                }
            }
        }

        _generateKey(url, options) {
            const method = options.method || 'GET';
            const body = options.body ? JSON.stringify(options.body) : '';
            return `${method}:${url}:${body}`;
        }

        // Invalidar cache para uma URL específica
        invalidate(url) {
            const keysToDelete = [];

            for (const key of this.memory.memoryCache.keys()) {
                if (key.includes(url)) {
                    keysToDelete.push(key);
                }
            }

            keysToDelete.forEach(key => {
                this.memory.delete(key);
                this.persistent.delete('api', key);
            });
        }

        // Invalidar todo cache
        clearAll() {
            this.memory.clear();
            this.persistent.clearExpired();
        }
    }

    // ============================================================
    // 5. PREFETCH INTELIGENTE DE MÓDULOS
    // ============================================================
    class ModulePrefetcher {
        constructor(turboFetch, persistentCache) {
            this.turboFetch = turboFetch;
            this.persistentCache = persistentCache;
            this.prefetchedUrls = new Set();
            this.prefetchQueue = [];
            this.activePrefetches = 0;
            this.hoverTimeout = null;

            this._init();
        }

        _init() {
            // Detectar navegação por hover
            document.addEventListener('mouseover', this._handleHover.bind(this), { passive: true });

            // Detectar navegação por touch (mobile)
            document.addEventListener('touchstart', this._handleTouch.bind(this), { passive: true });

            // Prefetch baseado em visibilidade
            this._observeLinks();

            // Prefetch dos módulos mais acessados
            this._prefetchPopularModules();
        }

        _handleHover(e) {
            const link = e.target.closest('a[href], [data-href]');
            if (!link) return;

            const href = link.getAttribute('href') || link.dataset.href;
            if (!this._isInternalLink(href)) return;

            clearTimeout(this.hoverTimeout);
            this.hoverTimeout = setTimeout(() => {
                this.prefetch(href);
            }, CONFIG.PREFETCH_DELAY);
        }

        _handleTouch(e) {
            const link = e.target.closest('a[href], [data-href]');
            if (!link) return;

            const href = link.getAttribute('href') || link.dataset.href;
            if (this._isInternalLink(href)) {
                this.prefetch(href);
            }
        }

        _observeLinks() {
            if (!('IntersectionObserver' in window)) return;

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const href = entry.target.getAttribute('href');
                        if (this._isInternalLink(href)) {
                            // Baixa prioridade para links visíveis
                            this.prefetchQueue.push({ url: href, priority: 'low' });
                            this._processQueue();
                        }
                    }
                });
            }, { rootMargin: '200px' });

            document.querySelectorAll('a[href]').forEach(link => {
                const href = link.getAttribute('href');
                if (this._isInternalLink(href)) {
                    observer.observe(link);
                }
            });
        }

        _prefetchPopularModules() {
            // Módulos mais acessados (baseado em analytics ou config)
            const popularModules = [
                '/modules/Financeiro/',
                '/modules/Vendas/public/',
                '/modules/PCP/',
                '/modules/Compras/',
                '/modules/RH/'  // RH index.html está na raiz, não em public
            ];

            // Prefetch com delay escalonado
            popularModules.forEach((module, index) => {
                setTimeout(() => {
                    this.prefetch(module + 'index.html', 'low');
                }, 2000 + (index * 500));
            });
        }

        async prefetch(url, priority = 'normal') {
            if (this.prefetchedUrls.has(url)) return;

            // Normalizar URL
            url = this._normalizeUrl(url);
            if (!url) return;

            this.prefetchedUrls.add(url);

            if (this.activePrefetches >= CONFIG.MAX_PREFETCH_CONCURRENT) {
                this.prefetchQueue.push({ url, priority });
                return;
            }

            this.activePrefetches++;

            try {
                // Prefetch da página HTML
                const response = await fetch(url, {
                    credentials: 'include',
                    priority: priority === 'high' ? 'high' : 'low'
                });

                if (response.ok) {
                    const html = await response.text();
                    await this.persistentCache.set('pages', url, html, CONFIG.CACHE_TTL.page);

                    // Prefetch de recursos da página (CSS, JS)
                    this._prefetchPageResources(html);

                    console.log('📄 Página prefetched:', url);
                }
            } catch (e) {
                // Silently fail - prefetch é opcional
            } finally {
                this.activePrefetches--;
                this._processQueue();
            }
        }

        _prefetchPageResources(html) {
            // Extrair URLs de CSS e JS
            const cssMatches = html.match(/href="([^"]+\.css[^"]*)"/g) || [];
            const jsMatches = html.match(/src="([^"]+\.js[^"]*)"/g) || [];

            cssMatches.slice(0, 5).forEach(match => {
                const url = match.match(/href="([^"]+)"/)?.[1];
                // Só prefetch de URLs absolutas (começam com /)
                if (url && url.startsWith('/') && !url.startsWith('//')) {
                    this._prefetchAsset(url, 'style');
                }
            });

            jsMatches.slice(0, 5).forEach(match => {
                const url = match.match(/src="([^"]+)"/)?.[1];
                // Só prefetch de URLs absolutas (começam com /)
                if (url && url.startsWith('/') && !url.startsWith('//')) {
                    this._prefetchAsset(url, 'script');
                }
            });
        }

        _prefetchAsset(url, type) {
            if (this.prefetchedUrls.has(url)) return;
            this.prefetchedUrls.add(url);

            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = url;
            link.as = type;
            document.head.appendChild(link);
        }

        _processQueue() {
            while (this.prefetchQueue.length > 0 && this.activePrefetches < CONFIG.MAX_PREFETCH_CONCURRENT) {
                const item = this.prefetchQueue.shift();
                this.prefetch(item.url, item.priority);
            }
        }

        _isInternalLink(href) {
            if (!href) return false;
            if (href.startsWith('#') || href.startsWith('javascript:')) return false;
            if (href.startsWith('http') && !href.includes(window.location.host)) return false;
            if (href.includes('logout') || href.includes('login')) return false;
            return true;
        }

        _normalizeUrl(url) {
            try {
                const base = window.location.origin;
                return new URL(url, base).pathname;
            } catch {
                return null;
            }
        }
    }

    // ============================================================
    // 6. NAVEGAÇÍO SPA-LIKE (OPCIONAL)
    // ============================================================
    class TurboNavigation {
        constructor(persistentCache, memoryCache) {
            this.persistentCache = persistentCache;
            this.memoryCache = memoryCache;
            this.isNavigating = false;
            this.enabled = true; // Pode ser desabilitado se causar problemas

            if (this.enabled) {
                this._init();
            }
        }

        _init() {
            // Interceptar cliques em links
            document.addEventListener('click', this._handleClick.bind(this), { capture: true });

            // Suporte a navegação do browser (back/forward)
            window.addEventListener('popstate', this._handlePopState.bind(this));
        }

        _handleClick(e) {
            if (!this.enabled || this.isNavigating) return;

            const link = e.target.closest('a[href]');
            if (!link) return;

            const href = link.getAttribute('href');
            if (!this._shouldIntercept(href, link)) return;

            e.preventDefault();
            this.navigate(href);
        }

        _shouldIntercept(href, link) {
            // Não interceptar
            if (!href) return false;
            if (link.target === '_blank') return false;
            if (link.hasAttribute('download')) return false;
            if (href.startsWith('#')) return false;
            if (href.startsWith('javascript:')) return false;
            if (href.startsWith('mailto:') || href.startsWith('tel:')) return false;
            if (href.startsWith('http') && !href.includes(window.location.host)) return false;
            if (href.includes('logout') || href.includes('login')) return false;

            // Não interceptar navegação para o dashboard (tem CSS inline pesado no <head>)
            if (href === '/dashboard' || href === '/index.html' || href === '/' || href.endsWith('/dashboard')) return false;

            // Não interceptar se tem data-turbo="false"
            if (link.dataset.turbo === 'false') return false;

            return true;
        }

        async navigate(url, pushState = true) {
            if (this.isNavigating) return;
            this.isNavigating = true;

            const normalizedUrl = this._normalizeUrl(url);

            // Mostrar loading
            this._showLoadingState();

            try {
                // Tentar cache primeiro
                let html = await this.persistentCache.get('pages', normalizedUrl);

                if (!html) {
                    // Buscar da rede
                    const response = await fetch(url, { credentials: 'include' });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    html = await response.text();

                    // Salvar no cache
                    this.persistentCache.set('pages', normalizedUrl, html, CONFIG.CACHE_TTL.page);
                }

                // Aplicar transição
                await this._transitionTo(html, url, pushState);

            } catch (error) {
                console.error('❌ Navegação falhou:', error);
                // Fallback: navegação tradicional
                window.location.href = url;
            } finally {
                this.isNavigating = false;
                this._hideLoadingState();
            }
        }

        async _transitionTo(html, url, pushState) {
            const container = document.querySelector('.main-area, .content, main, body');

            // Fade out
            container.style.opacity = '0';
            container.style.transition = `opacity ${CONFIG.TRANSITION_DURATION}ms ease`;

            await new Promise(r => setTimeout(r, CONFIG.TRANSITION_DURATION));

            // Parse e substituir conteúdo
            const parser = new DOMParser();
            const newDoc = parser.parseFromString(html, 'text/html');
            const newContainer = newDoc.querySelector('.main-area, .content, main, body');

            if (newContainer) {
                // Atualizar título
                document.title = newDoc.title;

                // Copiar <style> e <link rel=stylesheet> do <head> da nova página
                this._mergeHeadStyles(newDoc);

                // Atualizar conteúdo
                container.innerHTML = newContainer.innerHTML;

                // Executar scripts inline
                this._executeInlineScripts(container);

                // Atualizar URL
                if (pushState) {
                    history.pushState({ url }, '', url);
                }

                // Fade in
                container.style.opacity = '1';

                // Notificar que página mudou
                window.dispatchEvent(new CustomEvent('turbo:load', { detail: { url } }));
            } else {
                // Fallback: recarregar página completa
                window.location.href = url;
            }
        }

        _executeInlineScripts(container) {
            container.querySelectorAll('script').forEach(oldScript => {
                const newScript = document.createElement('script');
                Array.from(oldScript.attributes).forEach(attr => {
                    newScript.setAttribute(attr.name, attr.value);
                });
                newScript.textContent = oldScript.textContent;
                oldScript.parentNode.replaceChild(newScript, oldScript);
            });
        }

        /**
         * Copia <style> e <link rel=stylesheet> do <head> da nova página
         * para o documento atual, evitando duplicatas.
         */
        _mergeHeadStyles(newDoc) {
            try {
                // Remover styles injetados por turbo anteriormente
                document.querySelectorAll('[data-turbo-style]').forEach(el => el.remove());

                // Copiar <style> inline do novo documento
                newDoc.head.querySelectorAll('style').forEach(style => {
                    const newStyle = document.createElement('style');
                    newStyle.textContent = style.textContent;
                    newStyle.setAttribute('data-turbo-style', 'true');
                    document.head.appendChild(newStyle);
                });

                // Copiar <link rel=stylesheet> que não existem ainda
                newDoc.head.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                    const href = link.getAttribute('href');
                    if (href && !document.querySelector('link[href="' + href + '"]')) {
                        const newLink = link.cloneNode(true);
                        newLink.setAttribute('data-turbo-style', 'true');
                        document.head.appendChild(newLink);
                    }
                });
            } catch (e) {
                console.warn('[Turbo] Erro ao copiar estilos:', e);
            }
        }

        _handlePopState(e) {
            if (e.state?.url) {
                this.navigate(e.state.url, false);
            }
        }

        _showLoadingState() {
            // Criar ou mostrar indicador de loading
            let loader = document.getElementById('turbo-loader');
            if (!loader) {
                loader = document.createElement('div');
                loader.id = 'turbo-loader';
                loader.innerHTML = `
                    <style>
                        #turbo-loader {
                            position: fixed;
                            top: 0;
                            left: 0;
                            right: 0;
                            height: 3px;
                            background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
                            z-index: 999999;
                            animation: turboProgress 1s ease-in-out infinite;
                        }
                        @keyframes turboProgress {
                            0% { transform: translateX(-100%); }
                            50% { transform: translateX(0); }
                            100% { transform: translateX(100%); }
                        }
                    </style>
                `;
                document.body.appendChild(loader);
            }
            loader.style.display = 'block';
        }

        _hideLoadingState() {
            const loader = document.getElementById('turbo-loader');
            if (loader) {
                loader.style.display = 'none';
            }
        }

        _normalizeUrl(url) {
            try {
                return new URL(url, window.location.origin).pathname;
            } catch {
                return url;
            }
        }

        // Desabilitar navegação turbo
        disable() {
            this.enabled = false;
        }

        // Habilitar navegação turbo
        enable() {
            this.enabled = true;
        }
    }

    // ============================================================
    // 7. DATA PRELOADER - Pré-carrega dados frequentes
    // ============================================================
    class DataPreloader {
        constructor(turboFetch) {
            this.turboFetch = turboFetch;
            this._init();
        }

        _init() {
            // Pré-carregar dados do usuário
            this.preloadUserData();

            // Pré-carregar dados baseado no módulo atual
            this._preloadModuleData();
        }

        async preloadUserData() {
            // Dados que quase toda página precisa
            const criticalAPIs = [
                '/api/me'
            ];

            criticalAPIs.forEach(url => {
                this.turboFetch.fetch(url, {
                    cache: true,
                    ttl: CONFIG.CACHE_TTL.userData
                });
            });
        }

        _preloadModuleData() {
            const path = window.location.pathname.toLowerCase();

            if (path.includes('financeiro')) {
                this._preloadFinanceiroData();
            } else if (path.includes('vendas')) {
                this._preloadVendasData();
            } else if (path.includes('pcp')) {
                this._preloadPCPData();
            } else if (path.includes('compras')) {
                this._preloadComprasData();
            } else if (path.includes('rh')) {
                this._preloadRHData();
            }
        }

        _preloadFinanceiroData() {
            const apis = [
                '/api/financeiro/dashboard',
                '/api/financeiro/contas/resumo',
                '/api/financeiro/bancos'
            ];
            this._preloadAPIs(apis);
        }

        _preloadVendasData() {
            const apis = [
                '/api/vendas/dashboard',
                '/api/vendas/orcamentos/recentes',
                '/api/clientes?limit=50'
            ];
            this._preloadAPIs(apis);
        }

        _preloadPCPData() {
            const apis = [
                '/api/pcp/dashboard',
                '/api/pcp/ordens/ativas',
                '/api/pcp/materiais/estoque'
            ];
            this._preloadAPIs(apis);
        }

        _preloadComprasData() {
            const apis = [
                '/api/compras/dashboard',
                '/api/compras/pedidos/pendentes',
                '/api/fornecedores?limit=50'
            ];
            this._preloadAPIs(apis);
        }

        _preloadRHData() {
            const apis = [
                '/api/rh/dashboard',
                '/api/rh/funcionarios?limit=50',
                '/api/rh/avisos'
            ];
            this._preloadAPIs(apis);
        }

        _preloadAPIs(apis) {
            apis.forEach((url, index) => {
                // Escalonar requests para não sobrecarregar
                setTimeout(() => {
                    this.turboFetch.fetch(url, {
                        cache: true,
                        ttl: CONFIG.CACHE_TTL.api
                    }).catch(() => {}); // Ignorar erros no preload
                }, index * 200);
            });
        }
    }

    // ============================================================
    // 8. SKELETON LOADER - Loading instantneo
    // ============================================================
    class SkeletonManager {
        constructor() {
            this._injectStyles();
        }

        _injectStyles() {
            if (document.getElementById('skeleton-styles')) return;

            const style = document.createElement('style');
            style.id = 'skeleton-styles';
            style.textContent = `
                .skeleton {
                    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
                    background-size: 200% 100%;
                    animation: skeleton-shimmer 1.5s infinite;
                    border-radius: 4px;
                }

                @keyframes skeleton-shimmer {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }

                .skeleton-text {
                    height: 1em;
                    margin: 0.5em 0;
                }

                .skeleton-title {
                    height: 1.5em;
                    width: 60%;
                    margin-bottom: 1em;
                }

                .skeleton-card {
                    height: 120px;
                    margin-bottom: 1em;
                }

                .skeleton-table-row {
                    height: 48px;
                    margin-bottom: 4px;
                }

                .skeleton-avatar {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                }

                /* Fade in ao carregar conteúdo */
                .content-loading {
                    opacity: 0.5;
                    pointer-events: none;
                }

                .content-loaded {
                    opacity: 1;
                    transition: opacity 0.2s ease;
                }
            `;
            document.head.appendChild(style);
        }

        // Criar skeleton para tabela
        createTableSkeleton(rows = 5) {
            let html = '';
            for (let i = 0; i < rows; i++) {
                html += '<div class="skeleton skeleton-table-row"></div>';
            }
            return html;
        }

        // Criar skeleton para cards
        createCardSkeleton(count = 4) {
            let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px;">';
            for (let i = 0; i < count; i++) {
                html += '<div class="skeleton skeleton-card"></div>';
            }
            html += '</div>';
            return html;
        }

        // Aplicar skeleton a um elemento
        showSkeleton(element, type = 'table') {
            element.dataset.originalContent = element.innerHTML;
            element.classList.add('content-loading');

            if (type === 'table') {
                element.innerHTML = this.createTableSkeleton();
            } else if (type === 'cards') {
                element.innerHTML = this.createCardSkeleton();
            }
        }

        // Restaurar conteúdo original
        hideSkeleton(element) {
            element.classList.remove('content-loading');
            element.classList.add('content-loaded');

            if (element.dataset.originalContent) {
                element.innerHTML = element.dataset.originalContent;
                delete element.dataset.originalContent;
            }
        }
    }

    // ============================================================
    // 9. INICIALIZAÇÃO E EXPORTAÇÃO
    // ============================================================

    // Criar instncias
    const turboCache = new TurboCache();
    const persistentCache = new PersistentCache();
    const turboFetch = new TurboFetch(turboCache, persistentCache);
    const prefetcher = new ModulePrefetcher(turboFetch, persistentCache);
    const turboNav = new TurboNavigation(persistentCache, turboCache);
    const dataPreloader = new DataPreloader(turboFetch);
    const skeletonManager = new SkeletonManager();

    // Limpar cache expirado periodicamente
    setInterval(() => {
        persistentCache.clearExpired();
    }, 5 * 60 * 1000); // A cada 5 minutos

    // Exportar globalmente
    window.AluforceTurbo = {
        // Cache
        cache: turboCache,
        persistentCache,

        // Fetch otimizado
        fetch: (url, options) => turboFetch.fetch(url, options),

        // Invalidar cache
        invalidateCache: (url) => turboFetch.invalidate(url),
        clearCache: () => turboFetch.clearAll(),

        // Prefetch manual
        prefetch: (url) => prefetcher.prefetch(url, 'high'),

        // Navegação
        navigate: (url) => turboNav.navigate(url),
        disableTurboNav: () => turboNav.disable(),
        enableTurboNav: () => turboNav.enable(),

        // Skeleton
        skeleton: skeletonManager,

        // Estatísticas
        stats: () => ({
            memoryCache: turboCache.stats(),
            prefetchedUrls: prefetcher.prefetchedUrls.size
        }),

        // Configuração
        config: CONFIG
    };

    // Log de inicialização
    console.log('🚀 ALUFORCE Turbo inicializado!');
    console.log('📊 APIs disponíveis via window.AluforceTurbo:');
    console.log('   - fetch(url, options) - Fetch com cache inteligente');
    console.log('   - prefetch(url) - Pré-carregar página');
    console.log('   - invalidateCache(url) - Invalidar cache');
    console.log('   - skeleton.showSkeleton(el, type) - Mostrar loading');
    console.log('   - stats() - Ver estatísticas do cache');

})();
