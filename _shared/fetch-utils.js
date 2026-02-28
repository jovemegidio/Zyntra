/**
 * ALUFORCE v2.0 — Universal Fetch Utilities
 * 
 * Inclua este script em qualquer módulo HTML para obter:
 *   - fetchDebounce()  — debounce universal para busca/search
 *   - fetchPaginated() — paginação automática com lazy scroll
 *   - PaginatedTable    — classe que gerencia tabelas paginadas
 *   - SearchController — controller de busca com debounce + cancel
 * 
 * <script src="/_shared/fetch-utils.js"></script>
 */
(function (global) {
    'use strict';

    // ── Config padrão ────────────────────────────────────
    const DEFAULTS = {
        debounceMs: 350,           // ms para debounce de busca
        pageSize: 50,              // itens por página
        maxPageSize: 200,          // máximo permitido
        scrollThreshold: 200,     // px antes do fim para carregar mais
        retryAttempts: 2,          // tentativas em caso de erro de rede
        retryDelay: 1000,          // ms entre tentativas
        cacheEnabled: true,        // cache em memória para resultados
        cacheTTL: 60000            // 1 min de cache
    };

    // ── Cache de resultados em memória ───────────────────
    const resultCache = new Map();
    const MAX_CACHE = 100;

    function cacheKey(url, params) {
        return `${url}?${new URLSearchParams(params).toString()}`;
    }

    function getCached(key) {
        const entry = resultCache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            resultCache.delete(key);
            return null;
        }
        return entry.value;
    }

    function setCache(key, value) {
        if (resultCache.size >= MAX_CACHE) {
            // Evict oldest
            const first = resultCache.keys().next().value;
            resultCache.delete(first);
        }
        resultCache.set(key, { value, expiresAt: Date.now() + DEFAULTS.cacheTTL });
    }

    // ── Debounce universal ──────────────────────────────
    const debounceTimers = {};

    /**
     * Debounce a function call by key.
     * @param {string} key - Unique identifier (e.g., 'search-clientes')
     * @param {Function} fn - Function to call
     * @param {number} [delay=350] - Debounce delay in ms
     */
    function fetchDebounce(key, fn, delay) {
        delay = delay || DEFAULTS.debounceMs;
        if (debounceTimers[key]) {
            clearTimeout(debounceTimers[key]);
        }
        debounceTimers[key] = setTimeout(() => {
            delete debounceTimers[key];
            fn();
        }, delay);
    }

    // ── AbortController Manager ─────────────────────────
    const activeControllers = {};

    /**
     * Create or replace an AbortController for a request group.
     * Automatically cancels any in-flight request for the same key.
     * @param {string} key - Request group key
     * @returns {AbortSignal}
     */
    function getSignal(key) {
        if (activeControllers[key]) {
            activeControllers[key].abort();
        }
        activeControllers[key] = new AbortController();
        return activeControllers[key].signal;
    }

    // ── fetchRetry — fetch with retry + abort ───────────
    async function fetchRetry(url, options, attempts) {
        attempts = attempts || DEFAULTS.retryAttempts;
        let lastError;

        for (let i = 0; i <= attempts; i++) {
            try {
                const resp = await fetch(url, options);
                if (!resp.ok) {
                    const body = await resp.json().catch(() => ({}));
                    throw Object.assign(new Error(body.error || body.message || `HTTP ${resp.status}`), { status: resp.status });
                }
                return await resp.json();
            } catch (err) {
                if (err.name === 'AbortError') throw err; // Don't retry aborted
                lastError = err;
                if (i < attempts) {
                    await new Promise(r => setTimeout(r, DEFAULTS.retryDelay * (i + 1)));
                }
            }
        }
        throw lastError;
    }

    // ── SearchController ────────────────────────────────
    /**
     * Controller para campos de busca com debounce, cancel, e loading state.
     * 
     * Uso:
     *   const search = new SearchController({
     *       inputEl: document.getElementById('search-input'),
     *       onResults: (data) => renderTable(data),
     *       fetchUrl: '/api/clientes',
     *       paramName: 'search',
     *       debounceMs: 400
     *   });
     */
    class SearchController {
        constructor(opts) {
            this.inputEl = typeof opts.inputEl === 'string' ? document.querySelector(opts.inputEl) : opts.inputEl;
            this.fetchUrl = opts.fetchUrl;
            this.paramName = opts.paramName || 'search';
            this.debounceMs = opts.debounceMs || DEFAULTS.debounceMs;
            this.onResults = opts.onResults;
            this.onError = opts.onError || console.error;
            this.onLoading = opts.onLoading || (() => {});
            this.minLength = opts.minLength ?? 0;
            this.extraParams = opts.extraParams || {};
            this.key = opts.key || 'search-' + Math.random().toString(36).slice(2, 8);
            this._lastQuery = '';

            if (this.inputEl) {
                this.inputEl.addEventListener('input', () => this._onInput());
                // Trigger initial load
                if (this.minLength === 0) {
                    this.search('');
                }
            }
        }

        _onInput() {
            const query = (this.inputEl.value || '').trim();
            if (query === this._lastQuery) return;
            this._lastQuery = query;

            if (query.length > 0 && query.length < this.minLength) return;

            fetchDebounce(this.key, () => this.search(query), this.debounceMs);
        }

        async search(query) {
            this.onLoading(true);
            const signal = getSignal(this.key);
            const params = { ...this.extraParams, [this.paramName]: query || '' };
            const url = `${this.fetchUrl}?${new URLSearchParams(params).toString()}`;

            try {
                const data = await fetchRetry(url, {
                    signal,
                    credentials: 'include',
                    headers: { 'Accept': 'application/json' }
                });
                this.onResults(data);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    this.onError(err);
                }
            } finally {
                this.onLoading(false);
            }
        }

        destroy() {
            if (activeControllers[this.key]) {
                activeControllers[this.key].abort();
                delete activeControllers[this.key];
            }
            if (debounceTimers[this.key]) {
                clearTimeout(debounceTimers[this.key]);
                delete debounceTimers[this.key];
            }
        }
    }

    // ── PaginatedTable ──────────────────────────────────
    /**
     * Controller para tabelas com paginação e scroll infinito.
     * 
     * Uso:
     *   const table = new PaginatedTable({
     *       fetchUrl: '/api/pedidos',
     *       containerEl: '#table-body',
     *       renderRow: (item) => `<tr><td>${item.nome}</td></tr>`,
     *       pageSize: 50,
     *       scrollContainer: window   // ou '#table-wrapper'
     *   });
     *   table.load(); // Carrega primeira página
     */
    class PaginatedTable {
        constructor(opts) {
            this.fetchUrl = opts.fetchUrl;
            this.containerEl = typeof opts.containerEl === 'string'
                ? document.querySelector(opts.containerEl)
                : opts.containerEl;
            this.renderRow = opts.renderRow;
            this.pageSize = Math.min(opts.pageSize || DEFAULTS.pageSize, DEFAULTS.maxPageSize);
            this.onCountUpdate = opts.onCountUpdate || (() => {});
            this.onLoading = opts.onLoading || (() => {});
            this.onError = opts.onError || console.error;
            this.extraParams = opts.extraParams || {};
            this.key = opts.key || 'page-' + Math.random().toString(36).slice(2, 8);

            this._page = 1;
            this._hasMore = true;
            this._loading = false;
            this._totalCount = 0;
            this._allItems = [];

            // Scroll infinito
            const scrollEl = opts.scrollContainer
                ? (typeof opts.scrollContainer === 'string'
                    ? document.querySelector(opts.scrollContainer) : opts.scrollContainer)
                : window;

            if (scrollEl && opts.infiniteScroll !== false) {
                const target = scrollEl === window ? document.documentElement : scrollEl;
                scrollEl.addEventListener('scroll', () => {
                    if (this._loading || !this._hasMore) return;
                    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
                    if (scrollBottom < DEFAULTS.scrollThreshold) {
                        this.loadMore();
                    }
                }, { passive: true });
            }
        }

        async load(reset) {
            if (reset) {
                this._page = 1;
                this._hasMore = true;
                this._allItems = [];
                if (this.containerEl) this.containerEl.innerHTML = '';
            }

            if (this._loading || !this._hasMore) return;
            this._loading = true;
            this.onLoading(true);

            const signal = getSignal(this.key);
            const params = {
                ...this.extraParams,
                page: this._page,
                limit: this.pageSize
            };

            const url = `${this.fetchUrl}?${new URLSearchParams(params).toString()}`;

            // Check cache for first page
            const ck = cacheKey(this.fetchUrl, params);
            const cached = this._page === 1 ? getCached(ck) : null;

            try {
                const data = cached || await fetchRetry(url, {
                    signal,
                    credentials: 'include',
                    headers: { 'Accept': 'application/json' }
                });

                if (!cached && this._page === 1) {
                    setCache(ck, data);
                }

                // Normalize response: support both { data: [] } and raw array
                const items = Array.isArray(data) ? data : (data.data || data.items || data.rows || []);
                const total = data.pagination?.total ?? data.total ?? data.totalCount ?? items.length;

                this._totalCount = total;
                this._allItems = this._allItems.concat(items);
                this.onCountUpdate(this._totalCount, this._allItems.length);

                // Render new items
                if (this.containerEl && this.renderRow) {
                    const fragment = document.createDocumentFragment();
                    const temp = document.createElement('tbody');
                    temp.innerHTML = items.map(this.renderRow).join('');
                    while (temp.firstChild) {
                        fragment.appendChild(temp.firstChild);
                    }
                    this.containerEl.appendChild(fragment);
                }

                // Check if more pages
                this._hasMore = items.length >= this.pageSize;
                this._page++;

            } catch (err) {
                if (err.name !== 'AbortError') {
                    this.onError(err);
                }
            } finally {
                this._loading = false;
                this.onLoading(false);
            }
        }

        loadMore() {
            return this.load(false);
        }

        reload() {
            return this.load(true);
        }

        setExtraParams(params) {
            this.extraParams = { ...this.extraParams, ...params };
            return this.reload();
        }

        get items() { return this._allItems; }
        get total() { return this._totalCount; }
        get loading() { return this._loading; }
    }

    // ── Lazy Section Loader ─────────────────────────────
    /**
     * Carrega seções HTML sob demanda quando ficam visíveis na tela.
     * Complementa o chunk-loader.js para lazy-loading interno.
     * 
     * Uso:
     *   <div data-lazy-section="/api/section/financeiro"></div>
     *   LazySection.init();
     */
    const LazySection = {
        observer: null,

        init(rootSelector) {
            const root = rootSelector ? document.querySelector(rootSelector) : document;
            const sections = root.querySelectorAll('[data-lazy-section]');

            if (sections.length === 0) return;

            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this._loadSection(entry.target);
                        this.observer.unobserve(entry.target);
                    }
                });
            }, { rootMargin: '200px' });

            sections.forEach(el => this.observer.observe(el));
        },

        async _loadSection(el) {
            const url = el.dataset.lazySection;
            if (!url) return;

            el.innerHTML = '<div class="lazy-loading-placeholder" style="padding:2rem;text-align:center;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';

            try {
                const resp = await fetch(url, { credentials: 'include' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const html = await resp.text();
                el.innerHTML = html;

                // Execute scripts in loaded content
                el.querySelectorAll('script').forEach(script => {
                    const newScript = document.createElement('script');
                    if (script.src) {
                        newScript.src = script.src;
                    } else {
                        newScript.textContent = script.textContent;
                    }
                    script.parentNode.replaceChild(newScript, script);
                });
            } catch (err) {
                el.innerHTML = `<div class="lazy-error" style="padding:1rem;color:#e53e3e;">❌ Erro ao carregar seção: ${err.message}</div>`;
            }
        }
    };

    // ── Paginação UI helpers ────────────────────────────
    function renderPaginationBar(current, totalPages, onChange) {
        const nav = document.createElement('nav');
        nav.className = 'pagination-bar';
        nav.setAttribute('aria-label', 'Paginação');

        const maxVisible = 7;
        let start = Math.max(1, current - 3);
        let end = Math.min(totalPages, start + maxVisible - 1);
        if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

        const btn = (label, page, active, disabled) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.className = `pagination-btn${active ? ' active' : ''}${disabled ? ' disabled' : ''}`;
            b.disabled = disabled;
            if (!disabled && !active) b.onclick = () => onChange(page);
            return b;
        };

        nav.appendChild(btn('«', 1, false, current === 1));
        nav.appendChild(btn('‹', current - 1, false, current === 1));

        for (let i = start; i <= end; i++) {
            nav.appendChild(btn(String(i), i, i === current, false));
        }

        nav.appendChild(btn('›', current + 1, false, current === totalPages));
        nav.appendChild(btn('»', totalPages, false, current === totalPages));

        return nav;
    }

    // ── CSS injection ───────────────────────────────────
    if (typeof document !== 'undefined') {
        const style = document.createElement('style');
        style.textContent = `
            .pagination-bar { display:flex; align-items:center; justify-content:center; gap:4px; padding:12px 0; }
            .pagination-btn { min-width:36px; height:36px; border:1px solid #d1d5db; background:#fff; color:#374151; border-radius:6px; cursor:pointer; font-size:14px; transition:all .15s; }
            .pagination-btn:hover:not(.disabled):not(.active) { background:#f3f4f6; border-color:#9ca3af; }
            .pagination-btn.active { background:#1a73e8; color:#fff; border-color:#1a73e8; font-weight:600; }
            .pagination-btn.disabled { opacity:.4; cursor:not-allowed; }
            .lazy-loading-placeholder { animation: pulse-lazy 1.5s infinite; }
            @keyframes pulse-lazy { 0%,100%{opacity:1} 50%{opacity:.5} }
        `;
        document.head.appendChild(style);
    }

    // ── Exports ─────────────────────────────────────────
    const AluFetch = {
        fetchDebounce,
        fetchRetry,
        getSignal,
        SearchController,
        PaginatedTable,
        LazySection,
        renderPaginationBar,
        DEFAULTS,
        clearCache: () => resultCache.clear()
    };

    // Expose globally
    global.AluFetch = AluFetch;
    global.fetchDebounce = fetchDebounce;
    global.SearchController = SearchController;
    global.PaginatedTable = PaginatedTable;

    // AMD/CommonJS
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AluFetch;
    }

})(typeof window !== 'undefined' ? window : this);
