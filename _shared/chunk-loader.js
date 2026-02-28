/**
 * ALUFORCE v2.0 — Enterprise HTML Chunk Loader
 * 
 * Sistema de lazy-loading para páginas HTML monolíticas.
 * Carrega seções pesadas (modais, tabelas, relatórios) sob demanda
 * quando o usuário navega até elas, reduzindo o First Contentful Paint.
 * 
 * Estratégias:
 * 1. IntersectionObserver — carrega quando a seção fica visível
 * 2. Deferred Scripts — adia parsing de scripts pesados
 * 3. Tab-based — carrega aba/seção somente ao clicar
 * 4. Idle Callback — carrega em background quando o browser está ocioso
 * 
 * <script src="/_shared/chunk-loader.js"></script>
 */
(function (global) {
    'use strict';

    // ── Performance Metrics ─────────────────────────────
    const metrics = {
        chunksLoaded: 0,
        totalBytes: 0,
        totalTime: 0,
        startTime: performance.now()
    };

    // ── DOM Ready Helper ────────────────────────────────
    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    // ── Lazy Image Loading ──────────────────────────────
    /**
     * Convert <img data-src="..."> to real loading when visible.
     * Also handles background images via data-bg.
     */
    function initLazyImages(root) {
        root = root || document;
        const images = root.querySelectorAll('img[data-src], [data-bg]');
        if (images.length === 0) return;

        if ('IntersectionObserver' in window) {
            const obs = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const el = entry.target;
                        if (el.dataset.src) {
                            el.src = el.dataset.src;
                            el.removeAttribute('data-src');
                        }
                        if (el.dataset.bg) {
                            el.style.backgroundImage = `url(${el.dataset.bg})`;
                            el.removeAttribute('data-bg');
                        }
                        obs.unobserve(el);
                    }
                });
            }, { rootMargin: '300px' });

            images.forEach(img => obs.observe(img));
        } else {
            // Fallback: load all immediately
            images.forEach(el => {
                if (el.dataset.src) { el.src = el.dataset.src; el.removeAttribute('data-src'); }
                if (el.dataset.bg) { el.style.backgroundImage = `url(${el.dataset.bg})`; el.removeAttribute('data-bg'); }
            });
        }
    }

    // ── Lazy Script Loading ─────────────────────────────
    /**
     * Defer loading of heavy <script data-lazy-src="..."> until idle or visible.
     */
    function initLazyScripts(root) {
        root = root || document;
        const scripts = root.querySelectorAll('script[data-lazy-src]');
        if (scripts.length === 0) return;

        const loadScript = (scriptEl) => {
            return new Promise((resolve, reject) => {
                const newScript = document.createElement('script');
                newScript.src = scriptEl.dataset.lazySrc;
                if (scriptEl.dataset.lazyAsync !== undefined) newScript.async = true;
                newScript.onload = resolve;
                newScript.onerror = reject;
                scriptEl.parentNode.replaceChild(newScript, scriptEl);
            });
        };

        if ('requestIdleCallback' in window) {
            scripts.forEach(s => {
                requestIdleCallback(() => loadScript(s), { timeout: 5000 });
            });
        } else {
            // Load after 2s delay
            setTimeout(() => {
                scripts.forEach(s => loadScript(s));
            }, 2000);
        }
    }

    // ── Lazy Tab Content ────────────────────────────────
    /**
     * Load tab content only when user clicks the tab.
     * 
     * Markup pattern:
     *   <button data-lazy-tab="financeiro" data-lazy-url="/api/section/financeiro">
     *     Financeiro
     *   </button>
     *   <div data-lazy-tab-content="financeiro"></div>
     */
    function initLazyTabs(root) {
        root = root || document;
        const tabs = root.querySelectorAll('[data-lazy-tab]');
        const loaded = new Set();

        tabs.forEach(tab => {
            tab.addEventListener('click', async () => {
                const tabId = tab.dataset.lazyTab;
                if (loaded.has(tabId)) return;

                const contentEl = root.querySelector(`[data-lazy-tab-content="${tabId}"]`);
                const url = tab.dataset.lazyUrl;
                if (!contentEl || !url) return;

                contentEl.innerHTML = '<div style="padding:2rem;text-align:center"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';

                try {
                    const t0 = performance.now();
                    const resp = await fetch(url, { credentials: 'include' });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const html = await resp.text();
                    contentEl.innerHTML = html;
                    loaded.add(tabId);

                    // Execute inline scripts
                    _executeScripts(contentEl);
                    initLazyImages(contentEl);

                    metrics.chunksLoaded++;
                    metrics.totalBytes += html.length;
                    metrics.totalTime += performance.now() - t0;
                } catch (err) {
                    contentEl.innerHTML = `<div style="padding:1rem;color:#e53e3e">❌ Erro: ${err.message}</div>`;
                }
            });
        });
    }

    // ── Deferred Modal Loading ──────────────────────────
    /**
     * Heavy modals are loaded only when first opened.
     * 
     * Markup pattern:
     *   <div class="modal" id="modalRelatorio" data-lazy-modal="/api/modal/relatorio">
     *     <div class="modal-content">
     *       <!-- Will be populated on first open -->
     *     </div>
     *   </div>
     */
    const loadedModals = new Set();

    function initLazyModals(root) {
        root = root || document;
        const modals = root.querySelectorAll('[data-lazy-modal]');

        modals.forEach(modal => {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach(m => {
                    if (m.attributeName === 'style' || m.attributeName === 'class') {
                        const isVisible = modal.style.display !== 'none' &&
                            !modal.classList.contains('hidden') &&
                            (modal.style.display === 'block' || modal.style.display === 'flex' ||
                             modal.classList.contains('show') || modal.classList.contains('active'));
                        if (isVisible && !loadedModals.has(modal.id)) {
                            _loadModal(modal);
                        }
                    }
                });
            });
            observer.observe(modal, { attributes: true });
        });
    }

    async function _loadModal(modal) {
        const url = modal.dataset.lazyModal;
        const contentEl = modal.querySelector('.modal-content, .modal-body, [data-modal-body]') || modal;

        if (loadedModals.has(modal.id)) return;
        loadedModals.add(modal.id);

        const placeholder = contentEl.innerHTML;
        contentEl.innerHTML = '<div style="padding:3rem;text-align:center"><i class="fas fa-spinner fa-spin fa-2x"></i><p>Carregando conteúdo...</p></div>';

        try {
            const t0 = performance.now();
            const resp = await fetch(url, { credentials: 'include' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();
            contentEl.innerHTML = html;
            _executeScripts(contentEl);
            initLazyImages(contentEl);

            metrics.chunksLoaded++;
            metrics.totalBytes += html.length;
            metrics.totalTime += performance.now() - t0;
        } catch (err) {
            contentEl.innerHTML = placeholder;
            loadedModals.delete(modal.id);
            console.error('[CHUNK-LOADER] Modal load error:', err);
        }
    }

    // ── Inline Section Chunking ─────────────────────────
    /**
     * For pages that are already loaded but have heavy sections,
     * hide sections below the fold and load them on scroll.
     * 
     * Usage:
     *   <section data-chunk="deferred" data-chunk-priority="low">
     *     ... heavy content already in HTML ...
     *   </section>
     * 
     * Sections with data-chunk="deferred" will have their content
     * hidden initially and revealed when scrolled into view.
     */
    function initDeferredSections(root) {
        root = root || document;
        const sections = root.querySelectorAll('[data-chunk="deferred"]');
        if (sections.length === 0) return;

        // Replace with placeholder
        sections.forEach(section => {
            section._originalContent = section.innerHTML;
            section._originalDisplay = section.style.display;
            section.innerHTML = '<div class="chunk-placeholder" style="min-height:200px;display:flex;align-items:center;justify-content:center;opacity:0.5"><i class="fas fa-layer-group"></i> Seção será carregada ao rolar...</div>';
        });

        const obs = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const t0 = performance.now();
                    el.innerHTML = el._originalContent;
                    el.style.display = el._originalDisplay || '';
                    delete el._originalContent;
                    delete el._originalDisplay;
                    _executeScripts(el);
                    initLazyImages(el);
                    obs.unobserve(el);

                    metrics.chunksLoaded++;
                    metrics.totalTime += performance.now() - t0;
                }
            });
        }, { rootMargin: '400px' });

        sections.forEach(s => obs.observe(s));
    }

    // ── Idle Prefetch ───────────────────────────────────
    /**
     * Prefetch likely-needed resources during browser idle time.
     * 
     *   <link data-prefetch="/modules/Vendas/relatorios.html">
     */
    function initIdlePrefetch() {
        const links = document.querySelectorAll('[data-prefetch]');
        if (links.length === 0) return;

        const prefetch = (url) => {
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = url;
            link.as = 'document';
            document.head.appendChild(link);
        };

        if ('requestIdleCallback' in window) {
            links.forEach(el => {
                requestIdleCallback(() => prefetch(el.dataset.prefetch), { timeout: 10000 });
            });
        } else {
            setTimeout(() => {
                links.forEach(el => prefetch(el.dataset.prefetch));
            }, 5000);
        }
    }

    // ── Script Executor ─────────────────────────────────
    function _executeScripts(container) {
        const scripts = container.querySelectorAll('script');
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => {
                newScript.setAttribute(attr.name, attr.value);
            });
            if (!oldScript.src) {
                newScript.textContent = oldScript.textContent;
            }
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    }

    // ── Virtual Scroll for Large Tables ─────────────────
    /**
     * Virtual scroll renderer for tables with thousands of rows.
     * Only renders visible rows + buffer, dramatically reducing DOM size.
     * 
     * Usage:
     *   const vs = new VirtualScroll({
     *       container: '#table-wrapper',
     *       rowHeight: 40,
     *       data: myArray,
     *       renderRow: (item, index) => `<tr><td>${item.nome}</td></tr>`,
     *       totalHeight: '600px'
     *   });
     */
    class VirtualScroll {
        constructor(opts) {
            this.container = typeof opts.container === 'string'
                ? document.querySelector(opts.container) : opts.container;
            this.rowHeight = opts.rowHeight || 40;
            this.buffer = opts.buffer || 10;
            this.data = opts.data || [];
            this.renderRow = opts.renderRow;

            if (!this.container) return;

            this.container.style.overflow = 'auto';
            this.container.style.height = opts.totalHeight || '500px';
            this.container.style.position = 'relative';

            // Spacer for total scroll height
            this._spacer = document.createElement('div');
            this._spacer.style.height = (this.data.length * this.rowHeight) + 'px';
            this._spacer.style.position = 'relative';
            this.container.innerHTML = '';
            this.container.appendChild(this._spacer);

            // Content container
            this._content = document.createElement('div');
            this._content.style.position = 'absolute';
            this._content.style.top = '0';
            this._content.style.left = '0';
            this._content.style.right = '0';
            this._spacer.appendChild(this._content);

            this._lastStart = -1;
            this.container.addEventListener('scroll', () => this._onScroll(), { passive: true });
            this._onScroll();
        }

        _onScroll() {
            const scrollTop = this.container.scrollTop;
            const viewHeight = this.container.clientHeight;
            const start = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.buffer);
            const end = Math.min(this.data.length, Math.ceil((scrollTop + viewHeight) / this.rowHeight) + this.buffer);

            if (start === this._lastStart) return;
            this._lastStart = start;

            const rows = [];
            for (let i = start; i < end; i++) {
                rows.push(this.renderRow(this.data[i], i));
            }

            this._content.style.top = (start * this.rowHeight) + 'px';
            this._content.innerHTML = rows.join('');
        }

        updateData(newData) {
            this.data = newData;
            this._spacer.style.height = (this.data.length * this.rowHeight) + 'px';
            this._lastStart = -1;
            this._onScroll();
        }

        get visibleRange() {
            const scrollTop = this.container.scrollTop;
            const viewHeight = this.container.clientHeight;
            return {
                start: Math.floor(scrollTop / this.rowHeight),
                end: Math.ceil((scrollTop + viewHeight) / this.rowHeight)
            };
        }
    }

    // ── Auto-initialize on DOM ready ────────────────────
    onReady(() => {
        initLazyImages();
        initLazyScripts();
        initLazyTabs();
        initLazyModals();
        initDeferredSections();
        initIdlePrefetch();

        // Log performance
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => {
                const loadTime = performance.now() - metrics.startTime;
                console.log(`[CHUNK-LOADER] ✅ Initialized in ${loadTime.toFixed(0)}ms — ${document.querySelectorAll('[data-chunk],[data-lazy-modal],[data-lazy-tab],[data-lazy-section]').length} deferred sections`);
            });
        }
    });

    // ── Exports ─────────────────────────────────────────
    const ChunkLoader = {
        initLazyImages,
        initLazyScripts,
        initLazyTabs,
        initLazyModals,
        initDeferredSections,
        initIdlePrefetch,
        VirtualScroll,
        metrics,
        // Re-init after dynamic content load
        reinit(root) {
            initLazyImages(root);
            initLazyScripts(root);
            initLazyTabs(root);
            initLazyModals(root);
            initDeferredSections(root);
        }
    };

    global.ChunkLoader = ChunkLoader;
    global.VirtualScroll = VirtualScroll;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ChunkLoader;
    }

})(typeof window !== 'undefined' ? window : this);
