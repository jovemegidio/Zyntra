/**
 * ALUFORCE ERP - Performance Utilities
 * Provides debounce, throttle, caching, skeleton loaders, and optimized fetch
 * @version 2.0.0
 */
(function (global) {
    'use strict';

    const AluPerf = {};

    // ========== DEBOUNCE ==========
    AluPerf.debounce = function (fn, delay = 300) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    };

    // ========== THROTTLE ==========
    AluPerf.throttle = function (fn, limit = 200) {
        let inThrottle;
        return function (...args) {
            if (!inThrottle) {
                fn.apply(this, args);
                inThrottle = true;
                setTimeout(() => (inThrottle = false), limit);
            }
        };
    };

    // ========== REQUEST CACHE ==========
    const _cache = new Map();
    const _pendingRequests = new Map();

    AluPerf.cachedFetch = async function (url, options = {}) {
        const ttl = options.cacheTTL || 60000; // default 60s
        const cacheKey = url + (options.body ? JSON.stringify(options.body) : '');
        const forceRefresh = options.forceRefresh || false;

        // Return cached if valid
        if (!forceRefresh && _cache.has(cacheKey)) {
            const cached = _cache.get(cacheKey);
            if (Date.now() - cached.timestamp < ttl) {
                return cached.data;
            }
            _cache.delete(cacheKey);
        }

        // Deduplicate in-flight requests
        if (_pendingRequests.has(cacheKey)) {
            return _pendingRequests.get(cacheKey);
        }

        const fetchOpts = { ...options };
        delete fetchOpts.cacheTTL;
        delete fetchOpts.forceRefresh;

        // Add auth token
        const token = sessionStorage.getItem('tabAuthToken') ||
            sessionStorage.getItem('authToken') ||
            localStorage.getItem('authToken');
        if (token) {
            fetchOpts.headers = {
                ...(fetchOpts.headers || {}),
                'Authorization': `Bearer ${token}`
            };
        }

        const promise = fetch(url, fetchOpts)
            .then(async (res) => {
                if (!res.ok) {
                    if (res.status === 401) {
                        window.location.href = '/login.html';
                        throw new Error('Sessão expirada');
                    }
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = await res.json();
                _cache.set(cacheKey, { data, timestamp: Date.now() });
                return data;
            })
            .finally(() => {
                _pendingRequests.delete(cacheKey);
            });

        _pendingRequests.set(cacheKey, promise);
        return promise;
    };

    AluPerf.invalidateCache = function (urlPattern) {
        if (!urlPattern) {
            _cache.clear();
            return;
        }
        for (const key of _cache.keys()) {
            if (key.includes(urlPattern)) _cache.delete(key);
        }
    };

    // ========== PARALLEL FETCH ==========
    AluPerf.fetchAll = function (requests) {
        return Promise.allSettled(
            requests.map(req => {
                if (typeof req === 'string') return AluPerf.cachedFetch(req);
                return AluPerf.cachedFetch(req.url, req.options || {});
            })
        ).then(results =>
            results.map((r, i) => ({
                url: typeof requests[i] === 'string' ? requests[i] : requests[i].url,
                ok: r.status === 'fulfilled',
                data: r.status === 'fulfilled' ? r.value : null,
                error: r.status === 'rejected' ? r.reason : null
            }))
        );
    };

    // ========== SKELETON LOADER ==========
    AluPerf.showSkeleton = function (containerId, type = 'table', rows = 5) {
        const container = typeof containerId === 'string'
            ? document.getElementById(containerId)
            : containerId;
        if (!container) return;

        let html = '';

        if (type === 'table') {
            html = `<div class="alu-skeleton-table">`;
            // Header row
            html += `<div class="alu-skeleton-row alu-skeleton-header">`;
            for (let c = 0; c < 5; c++) {
                const w = [120, 180, 100, 80, 90][c] || 100;
                html += `<div class="alu-skeleton-cell" style="width:${w}px"></div>`;
            }
            html += `</div>`;
            // Data rows
            for (let r = 0; r < rows; r++) {
                html += `<div class="alu-skeleton-row" style="animation-delay:${r * 0.08}s">`;
                for (let c = 0; c < 5; c++) {
                    const w = 60 + Math.random() * 120;
                    html += `<div class="alu-skeleton-cell" style="width:${w}px"></div>`;
                }
                html += `</div>`;
            }
            html += `</div>`;
        } else if (type === 'cards') {
            html = `<div class="alu-skeleton-cards">`;
            for (let i = 0; i < rows; i++) {
                html += `
                    <div class="alu-skeleton-card" style="animation-delay:${i * 0.1}s">
                        <div class="alu-skeleton-card-icon"></div>
                        <div class="alu-skeleton-card-title"></div>
                        <div class="alu-skeleton-card-value"></div>
                        <div class="alu-skeleton-card-sub"></div>
                    </div>`;
            }
            html += `</div>`;
        } else if (type === 'chart') {
            html = `<div class="alu-skeleton-chart" style="animation-delay:0.1s">
                <div class="alu-skeleton-chart-bar" style="height:60%"></div>
                <div class="alu-skeleton-chart-bar" style="height:80%"></div>
                <div class="alu-skeleton-chart-bar" style="height:45%"></div>
                <div class="alu-skeleton-chart-bar" style="height:70%"></div>
                <div class="alu-skeleton-chart-bar" style="height:90%"></div>
                <div class="alu-skeleton-chart-bar" style="height:55%"></div>
            </div>`;
        } else if (type === 'form') {
            html = `<div class="alu-skeleton-form">`;
            for (let i = 0; i < rows; i++) {
                html += `<div class="alu-skeleton-form-group" style="animation-delay:${i * 0.08}s">
                    <div class="alu-skeleton-label"></div>
                    <div class="alu-skeleton-input"></div>
                </div>`;
            }
            html += `</div>`;
        }

        container.innerHTML = html;
        container.classList.add('alu-skeleton-active');
    };

    AluPerf.hideSkeleton = function (containerId) {
        const container = typeof containerId === 'string'
            ? document.getElementById(containerId)
            : containerId;
        if (container) container.classList.remove('alu-skeleton-active');
    };

    // ========== BUTTON LOADING ==========
    AluPerf.setButtonLoading = function (btn, loading = true) {
        if (typeof btn === 'string') btn = document.getElementById(btn);
        if (!btn) return;
        if (loading) {
            btn.dataset.originalText = btn.innerHTML;
            btn.disabled = true;
            btn.classList.add('alu-btn-loading');
            const text = btn.querySelector('.btn-text') || btn;
            if (text !== btn) text.style.visibility = 'hidden';
        } else {
            btn.disabled = false;
            btn.classList.remove('alu-btn-loading');
            if (btn.dataset.originalText) {
                btn.innerHTML = btn.dataset.originalText;
                delete btn.dataset.originalText;
            }
        }
    };

    // ========== VIRTUAL SCROLL FOR LARGE TABLES ==========
    AluPerf.paginate = function (data, page = 1, perPage = 25) {
        const total = data.length;
        const pages = Math.ceil(total / perPage);
        const start = (page - 1) * perPage;
        return {
            data: data.slice(start, start + perPage),
            page,
            perPage,
            total,
            pages,
            hasNext: page < pages,
            hasPrev: page > 1
        };
    };

    // ========== INTERSECTION OBSERVER FOR LAZY LOADING ==========
    AluPerf.lazyLoad = function (selector, callback) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    callback(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        }, { rootMargin: '100px' });

        document.querySelectorAll(selector).forEach(el => observer.observe(el));
        return observer;
    };

    // ========== MEMOIZE EXPENSIVE COMPUTATIONS ==========
    AluPerf.memoize = function (fn) {
        const cache = new Map();
        return function (...args) {
            const key = JSON.stringify(args);
            if (cache.has(key)) return cache.get(key);
            const result = fn.apply(this, args);
            cache.set(key, result);
            // Keep cache bounded
            if (cache.size > 100) {
                const firstKey = cache.keys().next().value;
                cache.delete(firstKey);
            }
            return result;
        };
    };

    // ========== CLEANUP MANAGER ==========
    const _cleanups = [];
    AluPerf.addCleanup = function (fn) {
        _cleanups.push(fn);
    };

    AluPerf.cleanup = function () {
        _cleanups.forEach(fn => { try { fn(); } catch (e) { /* skip */ } });
        _cleanups.length = 0;
    };

    // Automatically cleanup on page unload
    window.addEventListener('beforeunload', AluPerf.cleanup);

    // ========== FORMAT CURRENCY (MEMOIZED) ==========
    const _currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    AluPerf.formatCurrency = function (value) {
        return _currencyFormatter.format(value || 0);
    };

    // ========== FORMAT NUMBER (MEMOIZED) ==========
    const _numberFormatter = new Intl.NumberFormat('pt-BR');
    AluPerf.formatNumber = function (value) {
        return _numberFormatter.format(value || 0);
    };

    // ========== BATCH DOM UPDATES ==========
    AluPerf.batchUpdate = function (fn) {
        requestAnimationFrame(() => {
            fn();
        });
    };

    // Expose globally
    global.AluPerf = AluPerf;

})(window);
