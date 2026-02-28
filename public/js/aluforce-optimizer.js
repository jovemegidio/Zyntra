/**
 * ============================================================
 * ALUFORCE - OTIMIZADOR DE CARREGAMENTO
 * Melhora a performance e velocidade percebida
 * ============================================================
 */

(function() {
    'use strict';

    // ============================================================
    // 1. MÉTRICAS DE PERFORMANCE
    // ============================================================
    const PerformanceTracker = {
        marks: {},
        
        start(name) {
            this.marks[name] = performance.now();
            if (window.performance && performance.mark) {
                performance.mark(`${name}-start`);
            }
        },
        
        end(name, log = true) {
            if (!this.marks[name]) return 0;
            
            const duration = performance.now() - this.marks[name];
            
            if (window.performance && performance.mark) {
                performance.mark(`${name}-end`);
                performance.measure(name, `${name}-start`, `${name}-end`);
            }
            
            if (log) {
                const emoji = duration < 100 ? '🟢' : duration < 500 ? '🟡' : '🔴';
                console.log(`${emoji} [Performance] ${name}: ${duration.toFixed(1)}ms`);
            }
            
            delete this.marks[name];
            return duration;
        },
        
        // Report Web Vitals
        reportVitals() {
            if ('PerformanceObserver' in window) {
                // LCP - Largest Contentful Paint
                try {
                    new PerformanceObserver((list) => {
                        const entries = list.getEntries();
                        const lastEntry = entries[entries.length - 1];
                        console.log(`📊 LCP: ${lastEntry.startTime.toFixed(0)}ms`);
                    }).observe({ entryTypes: ['largest-contentful-paint'] });
                } catch (e) {}

                // FID - First Input Delay
                try {
                    new PerformanceObserver((list) => {
                        list.getEntries().forEach(entry => {
                            console.log(`📊 FID: ${entry.processingStart - entry.startTime}ms`);
                        });
                    }).observe({ entryTypes: ['first-input'] });
                } catch (e) {}

                // CLS - Cumulative Layout Shift
                try {
                    let clsValue = 0;
                    new PerformanceObserver((list) => {
                        list.getEntries().forEach(entry => {
                            if (!entry.hadRecentInput) {
                                clsValue += entry.value;
                            }
                        });
                    }).observe({ entryTypes: ['layout-shift'] });
                    
                    // Report CLS when page unloads
                    window.addEventListener('visibilitychange', () => {
                        if (document.visibilityState === 'hidden') {
                            console.log(`📊 CLS: ${clsValue.toFixed(3)}`);
                        }
                    });
                } catch (e) {}
            }
        }
    };

    // Iniciar tracking
    PerformanceTracker.start('page-load');
    PerformanceTracker.reportVitals();

    // ============================================================
    // 2. PRELOADER INTELIGENTE
    // ============================================================
    const SmartPreloader = {
        preloadedUrls: new Set(),
        
        // Prefetch de recursos que podem ser usados em breve (não críticos)
        preloadCritical() {
            // Fonts críticas - usar prefetch para evitar warning
            this.prefetchStyle('/css/outfit-font.css');
            
            // Scripts que serão usados em breve - usar prefetch
            const futureScripts = [
                '/js/aluforce-fluid-ui.js',
                '/js/auth.js'
            ];
            
            futureScripts.forEach(url => this.prefetchScript(url));
        },
        
        // Prefetch baseado em hover (links)
        initHoverPreload() {
            document.addEventListener('mouseover', (e) => {
                const link = e.target.closest('a[href]');
                if (!link) return;
                
                const href = link.getAttribute('href');
                if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
                if (href.startsWith('http') && !href.includes(window.location.host)) return;
                
                this.prefetchPage(href);
            }, { passive: true });
        },
        
        prefetchPage(url) {
            if (this.preloadedUrls.has(url)) return;
            this.preloadedUrls.add(url);
            
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = url;
            link.as = 'document';
            document.head.appendChild(link);
        },
        
        // Prefetch para scripts (baixa prioridade, sem warning)
        prefetchScript(url) {
            if (this.preloadedUrls.has(url)) return;
            this.preloadedUrls.add(url);
            
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = url;
            link.as = 'script';
            document.head.appendChild(link);
        },
        
        // Preload para scripts críticos (alta prioridade, usar só quando realmente necessário)
        preloadScript(url) {
            if (this.preloadedUrls.has(url)) return;
            this.preloadedUrls.add(url);
            
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = url;
            link.as = 'script';
            document.head.appendChild(link);
        },
        
        // Prefetch para estilos (baixa prioridade)
        prefetchStyle(url) {
            if (this.preloadedUrls.has(url)) return;
            this.preloadedUrls.add(url);
            
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = url;
            link.as = 'style';
            document.head.appendChild(link);
        },
        
        preloadStyle(url) {
            if (this.preloadedUrls.has(url)) return;
            this.preloadedUrls.add(url);
            
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = url;
            link.as = 'style';
            document.head.appendChild(link);
        },
        
        preloadFont(url) {
            if (this.preloadedUrls.has(url)) return;
            this.preloadedUrls.add(url);
            
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = url;
            link.as = 'font';
            link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        },
        
        preloadImage(url) {
            if (this.preloadedUrls.has(url)) return;
            this.preloadedUrls.add(url);
            
            const img = new Image();
            img.src = url;
        }
    };

    // ============================================================
    // 3. LAZY LOADING OTIMIZADO
    // ============================================================
    const LazyLoader = {
        observer: null,
        
        init() {
            if (!('IntersectionObserver' in window)) {
                this.loadAllImmediately();
                return;
            }
            
            this.observer = new IntersectionObserver(
                this.handleIntersection.bind(this),
                {
                    rootMargin: '100px',
                    threshold: 0.01
                }
            );
            
            this.observeAll();
        },
        
        observeAll() {
            // Imagens lazy
            document.querySelectorAll('img[data-src], [data-lazy-bg]').forEach(el => {
                this.observer.observe(el);
            });
            
            // Iframes lazy
            document.querySelectorAll('iframe[data-src]').forEach(el => {
                this.observer.observe(el);
            });
            
            // Componentes lazy
            document.querySelectorAll('[data-lazy-component]').forEach(el => {
                this.observer.observe(el);
            });
        },
        
        handleIntersection(entries) {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadElement(entry.target);
                    this.observer.unobserve(entry.target);
                }
            });
        },
        
        loadElement(el) {
            // Imagem
            if (el.tagName === 'IMG' && el.dataset.src) {
                el.src = el.dataset.src;
                el.removeAttribute('data-src');
                el.classList.add('lazy-loaded');
            }
            
            // Background
            if (el.dataset.lazyBg) {
                el.style.backgroundImage = `url(${el.dataset.lazyBg})`;
                el.removeAttribute('data-lazy-bg');
                el.classList.add('lazy-loaded');
            }
            
            // Iframe
            if (el.tagName === 'IFRAME' && el.dataset.src) {
                el.src = el.dataset.src;
                el.removeAttribute('data-src');
            }
            
            // Componente dinmico
            if (el.dataset.lazyComponent) {
                this.loadComponent(el);
            }
        },
        
        async loadComponent(el) {
            const componentPath = el.dataset.lazyComponent;
            try {
                const module = await import(componentPath);
                if (module.default && typeof module.default === 'function') {
                    module.default(el);
                }
            } catch (error) {
                console.error('Erro ao carregar componente lazy:', error);
            }
        },
        
        loadAllImmediately() {
            document.querySelectorAll('img[data-src]').forEach(img => {
                img.src = img.dataset.src;
            });
        }
    };

    // ============================================================
    // 4. OTIMIZADOR DE SCROLL
    // ============================================================
    const ScrollOptimizer = {
        scrolling: false,
        scrollTimeout: null,
        
        init() {
            window.addEventListener('scroll', () => {
                if (!this.scrolling) {
                    document.body.classList.add('is-scrolling');
                    this.scrolling = true;
                }
                
                clearTimeout(this.scrollTimeout);
                this.scrollTimeout = setTimeout(() => {
                    document.body.classList.remove('is-scrolling');
                    this.scrolling = false;
                }, 100);
            }, { passive: true });
        }
    };

    // ============================================================
    // 5. CACHE DE API INTELIGENTE
    // ============================================================
    const APICache = {
        cache: new Map(),
        pending: new Map(),
        
        async fetch(url, options = {}) {
            const cacheKey = this.getCacheKey(url, options);
            const cacheDuration = options.cacheDuration || 5 * 60 * 1000; // 5 min default
            
            // Verificar cache
            const cached = this.cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < cacheDuration) {
                return cached.data;
            }
            
            // Evitar requests duplicados
            if (this.pending.has(cacheKey)) {
                return this.pending.get(cacheKey);
            }
            
            // Fazer request
            const fetchPromise = this.doFetch(url, options, cacheKey, cacheDuration);
            this.pending.set(cacheKey, fetchPromise);
            
            try {
                return await fetchPromise;
            } finally {
                this.pending.delete(cacheKey);
            }
        },
        
        async doFetch(url, options, cacheKey, cacheDuration) {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // Cachear apenas GETs bem sucedidos
            if (!options.method || options.method === 'GET') {
                this.cache.set(cacheKey, {
                    data,
                    timestamp: Date.now()
                });
            }
            
            return data;
        },
        
        getCacheKey(url, options) {
            return `${options.method || 'GET'}_${url}_${JSON.stringify(options.body || {})}`;
        },
        
        invalidate(pattern) {
            if (typeof pattern === 'string') {
                this.cache.forEach((_, key) => {
                    if (key.includes(pattern)) {
                        this.cache.delete(key);
                    }
                });
            } else {
                this.cache.clear();
            }
        },
        
        // Alias para uso com auth
        async fetchWithAuth(url, options = {}) {
            const token = localStorage.getItem('authToken');
            return this.fetch(url, {
                ...options,
                credentials: 'include',
                headers: {
                    ...options.headers,
                    'Authorization': token ? `Bearer ${token}` : ''
                }
            });
        }
    };

    // ============================================================
    // 6. DEBOUNCE E THROTTLE OTIMIZADOS
    // ============================================================
    const RateLimiters = {
        debounceTimers: new Map(),
        throttleTimers: new Map(),
        
        debounce(id, fn, delay = 300) {
            clearTimeout(this.debounceTimers.get(id));
            this.debounceTimers.set(id, setTimeout(() => {
                fn();
                this.debounceTimers.delete(id);
            }, delay));
        },
        
        throttle(id, fn, delay = 100) {
            if (this.throttleTimers.has(id)) return;
            
            fn();
            this.throttleTimers.set(id, true);
            
            setTimeout(() => {
                this.throttleTimers.delete(id);
            }, delay);
        },
        
        // RAF-based throttle for animations
        rafThrottle(fn) {
            let rafId = null;
            return function(...args) {
                if (rafId) return;
                rafId = requestAnimationFrame(() => {
                    fn.apply(this, args);
                    rafId = null;
                });
            };
        }
    };

    // ============================================================
    // 7. OBSERVER DE MUTAÇÕES OTIMIZADO
    // ============================================================
    const MutationHandler = {
        observer: null,
        callbacks: [],
        
        init() {
            this.observer = new MutationObserver(
                RateLimiters.rafThrottle(this.handleMutations.bind(this))
            );
            
            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        },
        
        handleMutations(mutations) {
            const addedNodes = [];
            
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        addedNodes.push(node);
                    }
                });
            });
            
            if (addedNodes.length > 0) {
                // Re-observar lazy elements novos
                addedNodes.forEach(node => {
                    const lazyElements = node.querySelectorAll ? 
                        node.querySelectorAll('[data-src], [data-lazy-bg]') : [];
                    lazyElements.forEach(el => LazyLoader.observer?.observe(el));
                });
                
                // Chamar callbacks registrados
                this.callbacks.forEach(cb => cb(addedNodes));
            }
        },
        
        onNewElements(callback) {
            this.callbacks.push(callback);
        }
    };

    // ============================================================
    // 8. INICIALIZAÇÍO
    // ============================================================
    
    // Executar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    function init() {
        PerformanceTracker.start('init');
        
        // Inicializar módulos
        SmartPreloader.preloadCritical();
        SmartPreloader.initHoverPreload();
        LazyLoader.init();
        ScrollOptimizer.init();
        MutationHandler.init();
        
        PerformanceTracker.end('init');
        
        // Report quando página carregar completamente
        window.addEventListener('load', () => {
            PerformanceTracker.end('page-load');
            
            // Adicionar classe de página carregada
            document.body.classList.add('page-fully-loaded');
            
            // Log de tempo total
            const timing = performance.timing;
            if (timing) {
                const loadTime = timing.loadEventEnd - timing.navigationStart;
                console.log(`⚡ Página carregada em ${loadTime}ms`);
            }
        });
    }

    // Exportar para uso global
    window.AluforceOptimizer = {
        performance: PerformanceTracker,
        preloader: SmartPreloader,
        lazyLoader: LazyLoader,
        apiCache: APICache,
        rateLimiters: RateLimiters,
        mutationHandler: MutationHandler
    };

    // Aliases úteis
    window.cachedFetch = (url, opts) => APICache.fetch(url, opts);
    window.authFetch = (url, opts) => APICache.fetchWithAuth(url, opts);
    window.debounce = (id, fn, delay) => RateLimiters.debounce(id, fn, delay);
    window.throttle = (id, fn, delay) => RateLimiters.throttle(id, fn, delay);

    console.log('✅ Aluforce Optimizer inicializado');

})();
