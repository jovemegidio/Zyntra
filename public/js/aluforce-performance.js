// ============================================================
// OTIMIZAÇÕES DE PERFORMANCE - SISTEMA ALUFORCE
// Arquivo de cache e utilitários de performance
// ============================================================

(function() {
    'use strict';

    // ============================================================
    // 1. SISTEMA DE CACHE
    // ============================================================
    class AluforceCache {
        constructor() {
            this.cache = new Map();
            this.ttls = new Map();
        }

        set(key, value, ttl = 300000) { // 5 minutos padrão
            this.cache.set(key, value);
            this.ttls.set(key, Date.now() + ttl);
            return value;
        }

        get(key) {
            if (!this.cache.has(key)) return null;
            
            const ttl = this.ttls.get(key);
            if (Date.now() > ttl) {
                this.delete(key);
                return null;
            }
            
            return this.cache.get(key);
        }

        has(key) {
            return this.get(key) !== null;
        }

        delete(key) {
            this.cache.delete(key);
            this.ttls.delete(key);
        }

        clear() {
            this.cache.clear();
            this.ttls.clear();
        }

        size() {
            return this.cache.size;
        }
    }

    // ============================================================
    // 2. FETCH COM CACHE AUTOMÁTICO
    // ============================================================
    class CachedFetch {
        constructor(cache) {
            this.cache = cache;
        }

        async fetch(url, options = {}, cacheTTL = 300000) {
            const cacheKey = `fetch_${url}_${JSON.stringify(options)}`;
            
            // Verificar cache
            const cached = this.cache.get(cacheKey);
            if (cached) {
                console.log('✅ Cache HIT:', url);
                return cached;
            }

            console.log('⏳ Cache MISS, fetching:', url);
            
            try {
                const response = await fetch(url, options);
                const data = await response.json();
                
                // Cachear apenas respostas bem-sucedidas
                if (response.ok) {
                    this.cache.set(cacheKey, data, cacheTTL);
                }
                
                return data;
            } catch (error) {
                console.error('❌ Fetch error:', url, error);
                throw error;
            }
        }
    }

    // ============================================================
    // 3. DEBOUNCER
    // ============================================================
    class Debouncer {
        constructor() {
            this.timeouts = new Map();
        }

        debounce(id, fn, delay = 300) {
            if (this.timeouts.has(id)) {
                clearTimeout(this.timeouts.get(id));
            }

            const timeout = setTimeout(() => {
                fn();
                this.timeouts.delete(id);
            }, delay);

            this.timeouts.set(id, timeout);
        }

        cancel(id) {
            if (this.timeouts.has(id)) {
                clearTimeout(this.timeouts.get(id));
                this.timeouts.delete(id);
            }
        }

        cancelAll() {
            this.timeouts.forEach(timeout => clearTimeout(timeout));
            this.timeouts.clear();
        }
    }

    // ============================================================
    // 4. LAZY IMAGE LOADER
    // ============================================================
    class LazyImageLoader {
        constructor() {
            this.observer = null;
            this.init();
        }

        init() {
            if ('IntersectionObserver' in window) {
                this.observer = new IntersectionObserver(this.handleIntersection.bind(this), {
                    rootMargin: '50px'
                });
            }
        }

        observe(element) {
            if (this.observer) {
                this.observer.observe(element);
            } else {
                this.loadImage(element);
            }
        }

        handleIntersection(entries) {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadImage(entry.target);
                    this.observer.unobserve(entry.target);
                }
            });
        }

        loadImage(element) {
            const src = element.dataset.src;
            if (src) {
                element.src = src;
                element.removeAttribute('data-src');
            }
        }

        observeAll(selector = '[data-src]') {
            document.querySelectorAll(selector).forEach(img => {
                this.observe(img);
            });
        }
    }

    // ============================================================
    // 5. PERFORMANCE MONITOR
    // ============================================================
    class PerformanceMonitor {
        constructor() {
            this.marks = new Map();
        }

        start(label) {
            this.marks.set(label, performance.now());
        }

        end(label, log = true) {
            const start = this.marks.get(label);
            if (!start) {
                console.warn('⚠️ Performance mark not found:', label);
                return 0;
            }

            const duration = performance.now() - start;
            this.marks.delete(label);

            if (log) {
                const emoji = duration < 100 ? '✅' : duration < 500 ? '⚠️' : '❌';
                console.log(`${emoji} ${label}: ${duration.toFixed(2)}ms`);
            }

            return duration;
        }

        async measure(label, fn) {
            this.start(label);
            const result = await fn();
            this.end(label);
            return result;
        }
    }

    // ============================================================
    // 6. RESOURCE PRELOADER
    // ============================================================
    class ResourcePreloader {
        preload(type, url) {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = type;
            link.href = url;
            document.head.appendChild(link);
        }

        preloadScript(url) {
            this.preload('script', url);
        }

        preloadStyle(url) {
            this.preload('style', url);
        }

        preloadImage(url) {
            this.preload('image', url);
        }

        preloadFont(url) {
            this.preload('font', url);
        }
    }

    // ============================================================
    // 7. INICIALIZAÇÃO E EXPORTAÇÃO
    // ============================================================
    
    // Criar instncias globais
    window.AluforceCache = new AluforceCache();
    window.AluforceFetch = new CachedFetch(window.AluforceCache);
    window.AluforceDebouncer = new Debouncer();
    window.AluforceLazyLoader = new LazyImageLoader();
    window.AluforcePerformance = new PerformanceMonitor();
    window.AluforcePreloader = new ResourcePreloader();

    // Inicializar lazy loading automaticamente
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.AluforceLazyLoader.observeAll();
        });
    } else {
        window.AluforceLazyLoader.observeAll();
    }

    console.log('✅ Aluforce Performance Utils inicializado');
    console.log('📊 APIs disponíveis:');
    console.log('  - window.AluforceCache');
    console.log('  - window.AluforceFetch');
    console.log('  - window.AluforceDebouncer');
    console.log('  - window.AluforceLazyLoader');
    console.log('  - window.AluforcePerformance');
    console.log('  - window.AluforcePreloader');
})();
