/**
 * ALUFORCE - Offline Sync Manager v4.0.0
 * SISTEMA COMPLETO OFFLINE
 * Interceptor global de fetch + IndexedDB queue + auto-sync
 * 01/03/2026
 *
 * Este script intercepta TODAS as chamadas fetch() do sistema:
 * - GET: tenta rede, se falhar retorna dados cacheados do IndexedDB
 * - POST/PUT/PATCH/DELETE: tenta rede, se falhar enfileira no IndexedDB
 * - Quando a conexao volta, sincroniza automaticamente toda a fila
 *
 * Resultado: TODO o sistema funciona offline (exceto login)
 */

(function() {
    'use strict';

    // ============================================================
    // CONFIGURACAO
    // ============================================================

    const DB_NAME = 'AluforceOfflineDB';
    const DB_VERSION = 2;
    const STORE_QUEUE = 'offlineQueue';
    const STORE_CACHE = 'apiCache';
    const MAX_RETRIES = 5;
    const SYNC_INTERVAL = 15000; // 15 segundos
    const GET_CACHE_TTL = 600000; // 10 minutos de cache para GETs
    const RETRY_BASE = 2000;

    // Endpoints que NAO devem ser interceptados
    const SKIP_INTERCEPT = [
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/forgot-password',
        '/api/auth/reset-password',
        '/api/auth/2fa',
        '/sw.js'
    ];

    // Endpoints de escrita que devem ser enfileirados (aceita regex)
    const WRITE_QUEUE_PATTERNS = [
        /\/api\//  // Qualquer chamada de API
    ];

    let db = null;
    let isSyncing = false;
    let pendingCount = 0;
    let syncTimer = null;
    const originalFetch = window.fetch; // Guardar fetch original

    // ============================================================
    // INDEXEDDB
    // ============================================================

    function openDB() {
        return new Promise((resolve, reject) => {
            if (db) return resolve(db);
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const d = e.target.result;
                // Fila offline (POST/PUT/PATCH/DELETE)
                if (!d.objectStoreNames.contains(STORE_QUEUE)) {
                    const q = d.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
                    q.createIndex('timestamp', 'timestamp');
                    q.createIndex('status', 'status');
                    q.createIndex('module', 'module');
                }
                // Cache de respostas de API (GET)
                if (!d.objectStoreNames.contains(STORE_CACHE)) {
                    const c = d.createObjectStore(STORE_CACHE, { keyPath: 'url' });
                    c.createIndex('expiry', 'expiry');
                }
            };
            req.onsuccess = (e) => { db = e.target.result; resolve(db); };
            req.onerror = (e) => { console.error('[Offline] Erro IndexedDB:', e.target.error); reject(e.target.error); };
        });
    }

    // ============================================================
    // CACHE DE RESPOSTAS GET
    // ============================================================

    async function cacheAPIResponse(url, data, ttl) {
        try {
            const d = await openDB();
            const tx = d.transaction(STORE_CACHE, 'readwrite');
            tx.objectStore(STORE_CACHE).put({
                url: url,
                data: data,
                expiry: Date.now() + (ttl || GET_CACHE_TTL),
                cached_at: Date.now()
            });
        } catch(e) { /* silencioso */ }
    }

    async function getCachedResponse(url) {
        try {
            const d = await openDB();
            return new Promise((resolve) => {
                const tx = d.transaction(STORE_CACHE, 'readonly');
                const req = tx.objectStore(STORE_CACHE).get(url);
                req.onsuccess = () => {
                    const r = req.result;
                    // Retorna mesmo se expirado quando offline (melhor que nada)
                    if (r && r.data) {
                        resolve({ data: r.data, expired: r.expiry < Date.now(), cached_at: r.cached_at });
                    } else {
                        resolve(null);
                    }
                };
                req.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }

    // ============================================================
    // FILA OFFLINE (QUEUE)
    // ============================================================

    async function enqueue(url, method, body, headers) {
        try {
            const d = await openDB();
            const tx = d.transaction(STORE_QUEUE, 'readwrite');
            const entry = {
                url: url,
                method: method,
                body: body,
                headers: cleanHeaders(headers),
                timestamp: Date.now(),
                retries: 0,
                status: 'pending',
                module: detectModule(url),
                lastError: null
            };
            await new Promise((res, rej) => {
                const r = tx.objectStore(STORE_QUEUE).add(entry);
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
            });
            pendingCount++;
            updateBadge();

            // Registrar background sync se disponivel
            if ('serviceWorker' in navigator && 'SyncManager' in window) {
                const reg = await navigator.serviceWorker.ready;
                reg.sync.register('sync-offline-queue').catch(() => {});
            }

            return true;
        } catch(e) {
            console.error('[Offline] Erro ao enfileirar:', e);
            // Fallback: localStorage
            try {
                const q = JSON.parse(localStorage.getItem('offlineQueueFallback') || '[]');
                q.push({ url, method, body, timestamp: Date.now() });
                localStorage.setItem('offlineQueueFallback', JSON.stringify(q));
            } catch(x) {}
            return false;
        }
    }

    function cleanHeaders(headers) {
        // Remove headers que nao devem ser armazenados
        const clean = {};
        if (headers) {
            const skip = ['content-length', 'host', 'connection', 'cookie'];
            for (const [k, v] of Object.entries(headers)) {
                if (!skip.includes(k.toLowerCase())) clean[k] = v;
            }
        }
        return clean;
    }

    function detectModule(url) {
        if (url.includes('/pcp/')) return 'PCP';
        if (url.includes('/vendas/')) return 'Vendas';
        if (url.includes('/financeiro/')) return 'Financeiro';
        if (url.includes('/compras/')) return 'Compras';
        if (url.includes('/rh/')) return 'RH';
        if (url.includes('/nfe/')) return 'NFe';
        if (url.includes('/faturamento/')) return 'Faturamento';
        if (url.includes('/configuracoes/')) return 'Config';
        return 'Geral';
    }

    async function getAllPending() {
        try {
            const d = await openDB();
            return new Promise((resolve) => {
                const tx = d.transaction(STORE_QUEUE, 'readonly');
                const items = [];
                tx.objectStore(STORE_QUEUE).openCursor().onsuccess = (e) => {
                    const c = e.target.result;
                    if (c) {
                        if (c.value.status === 'pending') items.push(c.value);
                        c.continue();
                    } else resolve(items);
                };
            });
        } catch(e) { return []; }
    }

    async function removeFromQueue(id) {
        const d = await openDB();
        const tx = d.transaction(STORE_QUEUE, 'readwrite');
        tx.objectStore(STORE_QUEUE).delete(id);
    }

    async function updateQueueItem(id, updates) {
        const d = await openDB();
        const tx = d.transaction(STORE_QUEUE, 'readwrite');
        const store = tx.objectStore(STORE_QUEUE);
        const req = store.get(id);
        req.onsuccess = () => {
            if (req.result) {
                Object.assign(req.result, updates);
                store.put(req.result);
            }
        };
    }

    // ============================================================
    // PROCESSAMENTO DA FILA (SYNC)
    // ============================================================

    async function processQueue() {
        if (isSyncing || !navigator.onLine) return;
        isSyncing = true;

        let processed = 0, failed = 0;

        try {
            const items = await getAllPending();
            if (!items.length) { isSyncing = false; return; }

            console.log('[Offline] Sincronizando', items.length, 'itens pendentes...');
            showSyncBanner(items.length);

            // Ordenar por timestamp (mais antigos primeiro)
            items.sort((a, b) => a.timestamp - b.timestamp);

            for (const item of items) {
                if (!navigator.onLine) break;

                try {
                    // Atualizar token (pode ter renovado)
                    const headers = { ...item.headers };
                    if (token && token !== 'unified-session-active') {
                    }
                    if (!headers['Content-Type']) {
                        headers['Content-Type'] = 'application/json';
                    }

                    const opts = {
                        method: item.method,
                        headers: headers,
                        credentials: 'include'
                    };

                    if (item.body && ['POST','PUT','PATCH'].includes(item.method)) {
                        opts.body = typeof item.body === 'string' ? item.body : JSON.stringify(item.body);
                    }

                    const resp = await originalFetch(item.url, opts);

                    if (resp.ok || resp.status === 201 || resp.status === 204) {
                        await removeFromQueue(item.id);
                        processed++;
                        pendingCount = Math.max(0, pendingCount - 1);
                    } else if (resp.status >= 400 && resp.status < 500 && resp.status !== 401 && resp.status !== 408 && resp.status !== 429) {
                        // 4xx (exceto 401/408/429) = erro permanente, remover
                        await updateQueueItem(item.id, { status: 'failed_permanent', lastError: 'HTTP ' + resp.status });
                        failed++;
                        pendingCount = Math.max(0, pendingCount - 1);
                    } else {
                        // 5xx, 401, 408, 429 = tentar de novo
                        item.retries = (item.retries || 0) + 1;
                        if (item.retries >= MAX_RETRIES) {
                            await updateQueueItem(item.id, { status: 'max_retries', retries: item.retries });
                            failed++;
                            pendingCount = Math.max(0, pendingCount - 1);
                        } else {
                            await updateQueueItem(item.id, { retries: item.retries });
                            await sleep(RETRY_BASE * Math.pow(2, item.retries - 1));
                        }
                    }
                } catch (fetchErr) {
                    // Rede caiu durante sync
                    console.warn('[Offline] Rede caiu durante sync:', fetchErr.message);
                    break;
                }
            }

            updateBadge();
            hideSyncBanner();

            if (processed > 0) {
                showToast(processed + ' dado' + (processed > 1 ? 's' : '') + ' sincronizado' + (processed > 1 ? 's' : '') + ' com sucesso!', 'success');
            }
            if (failed > 0) {
                showToast(failed + ' operacao' + (failed > 1 ? 'es' : '') + ' nao puderam ser sincronizadas', 'warning');
            }

        } catch(e) {
            console.error('[Offline] Erro no processamento:', e);
        } finally {
            isSyncing = false;
        }
    }

    // Processar fallback do localStorage
    async function processFallback() {
        try {
            const raw = localStorage.getItem('offlineQueueFallback');
            if (!raw) return;
            const items = JSON.parse(raw);
            if (!items.length) return;
            for (const item of items) {
                await enqueue(item.url, item.method, item.body, {});
            }
            localStorage.removeItem('offlineQueueFallback');
        } catch(e) {}
    }

    // ============================================================
    // INTERCEPTOR GLOBAL DE FETCH
    // ============================================================

    function shouldIntercept(url) {
        // So intercepta chamadas de API
        if (!url.includes('/api/')) return false;
        // Nao intercepta login/auth
        for (const skip of SKIP_INTERCEPT) {
            if (url.includes(skip)) return false;
        }
        return true;
    }

    window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
        const method = ((init && init.method) || 'GET').toUpperCase();

        // Se nao e API ou e auth, usar fetch original
        if (!shouldIntercept(url)) {
            return originalFetch(input, init);
        }

        // ---- LEITURA (GET) ----
        if (method === 'GET') {
            // Se online: tentar rede, cachear resposta
            if (navigator.onLine) {
                try {
                    const resp = await originalFetch(input, init);
                    if (resp.ok) {
                        // Cachear resposta em background
                        const clone = resp.clone();
                        clone.json().then(data => {
                            cacheAPIResponse(url, data);
                        }).catch(() => {});
                    }
                    return resp;
                } catch(e) {
                    // Rede falhou apesar de navigator.onLine
                    const cached = await getCachedResponse(url);
                    if (cached) {
                        console.log('[Offline] GET servido do cache:', url);
                        return new Response(JSON.stringify(cached.data), {
                            status: 200,
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Offline-Cache': 'true',
                                'X-Cached-At': new Date(cached.cached_at).toISOString()
                            }
                        });
                    }
                    throw e; // Sem cache, propagar erro
                }
            } else {
                // Offline: servir do cache
                const cached = await getCachedResponse(url);
                if (cached) {
                    console.log('[Offline] GET offline servido do cache:', url);
                    return new Response(JSON.stringify(cached.data), {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Offline-Cache': 'true',
                            'X-Cache-Expired': String(cached.expired),
                            'X-Cached-At': new Date(cached.cached_at).toISOString()
                        }
                    });
                }
                // Sem cache disponivel
                return new Response(JSON.stringify({
                    error: 'offline',
                    message: 'Voce esta offline e nao ha dados em cache para esta pagina.',
                    offline: true
                }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // ---- ESCRITA (POST/PUT/PATCH/DELETE) ----
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {

            // Se online: tentar normalmente
            if (navigator.onLine) {
                try {
                    const resp = await originalFetch(input, init);

                    // Se o servidor retornou 5xx, enfileirar para retry
                    if (resp.status >= 500) {
                        let body = null;
                        if (init && init.body) {
                            try { body = JSON.parse(init.body); } catch(e) { body = init.body; }
                        }
                        const headers = {};
                        if (init && init.headers) {
                            if (init.headers instanceof Headers) {
                                init.headers.forEach((v, k) => { headers[k] = v; });
                            } else {
                                Object.assign(headers, init.headers);
                            }
                        }
                        await enqueue(url, method, body, headers);
                        showToast('Erro no servidor  dados salvos para reenvio automatico', 'warning');
                        return new Response(JSON.stringify({
                            success: true,
                            offline: true,
                            queued: true,
                            message: 'Salvo para sincronizacao automatica.'
                        }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Offline-Queued': 'true' } });
                    }

                    return resp;
                } catch(e) {
                    // Rede caiu durante a requisicao  enfileirar
                    let body = null;
                    if (init && init.body) {
                        try { body = JSON.parse(init.body); } catch(ex) { body = init.body; }
                    }
                    const headers = {};
                    if (init && init.headers) {
                        if (init.headers instanceof Headers) {
                            init.headers.forEach((v, k) => { headers[k] = v; });
                        } else {
                            Object.assign(headers, init.headers);
                        }
                    }
                    await enqueue(url, method, body, headers);
                    showToast('Conexao perdida  dados salvos localmente!', 'warning');
                    return new Response(JSON.stringify({
                        success: true,
                        offline: true,
                        queued: true,
                        message: 'Conexao perdida. Sera sincronizado automaticamente.'
                    }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Offline-Queued': 'true' } });
                }
            } else {
                // Offline: enfileirar diretamente
                let body = null;
                if (init && init.body) {
                    try { body = JSON.parse(init.body); } catch(ex) { body = init.body; }
                }
                const headers = {};
                if (init && init.headers) {
                    if (init.headers instanceof Headers) {
                        init.headers.forEach((v, k) => { headers[k] = v; });
                    } else {
                        Object.assign(headers, init.headers);
                    }
                }
                await enqueue(url, method, body, headers);
                showToast('Sem conexao  dados salvos localmente!', 'warning');
                return new Response(JSON.stringify({
                    success: true,
                    offline: true,
                    queued: true,
                    message: 'Voce esta offline. Dados salvos e serao sincronizados automaticamente.',
                    queuedAt: new Date().toISOString()
                }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Offline-Queued': 'true' } });
            }
        }

        // Outros metodos: nao interceptar
        return originalFetch(input, init);
    };

    // ============================================================
    // UI: Banners e Toasts
    // ============================================================

    function showOfflineBanner() {
        if (document.getElementById('aluforce-offline-banner')) return;
        const b = document.createElement('div');
        b.id = 'aluforce-offline-banner';
        b.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 20px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;font-size:13px;font-weight:600;font-family:Inter,sans-serif;position:fixed;top:0;left:0;right:0;z-index:99999;box-shadow:0 2px 10px rgba(0,0,0,.3);animation:oSlide .3s ease"><style>@keyframes oSlide{from{transform:translateY(-100%)}to{transform:translateY(0)}}@keyframes oPulse{0%,100%{opacity:1}50%{opacity:.4}}</style><span style="animation:oPulse 1.5s ease-in-out infinite;font-size:10px">&#11044;</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg> <span>MODO OFFLINE</span> <span style="font-weight:400;opacity:.9"> Seus dados serao salvos localmente e sincronizados automaticamente</span> <span id="offline-pending-badge" style="background:#fff;color:#dc2626;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700;display:none;margin-left:4px">0</span></div>';
        document.body.prepend(b);
    }

    function hideOfflineBanner() {
        const b = document.getElementById('aluforce-offline-banner');
        if (b) { b.style.animation = 'oSlide .3s ease reverse'; setTimeout(() => b.remove(), 300); }
    }

    function showSyncBanner(count) {
        const old = document.getElementById('aluforce-sync-banner');
        if (old) old.remove();
        const b = document.createElement('div');
        b.id = 'aluforce-sync-banner';
        b.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 20px;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;font-size:13px;font-weight:500;font-family:Inter,sans-serif;position:fixed;top:0;left:0;right:0;z-index:99999;animation:oSlide .3s ease"><style>@keyframes oSpin{to{transform:rotate(360deg)}}</style><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:oSpin 1s linear infinite"><path d="M21 12a9 9 0 1 1-9-9"/></svg> Sincronizando ' + count + ' registro' + (count > 1 ? 's' : '') + '...</div>';
        document.body.prepend(b);
    }

    function hideSyncBanner() {
        const b = document.getElementById('aluforce-sync-banner');
        if (b) { b.style.animation = 'oSlide .3s ease reverse'; setTimeout(() => b.remove(), 300); }
    }

    function updateBadge() {
        const b = document.getElementById('offline-pending-badge');
        if (b) {
            b.textContent = pendingCount;
            b.style.display = pendingCount > 0 ? 'inline' : 'none';
        }
    }

    function showToast(message, type) {
        // Usar notificacao global se disponivel
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
            return;
        }
        const colors = { success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#3b82f6' };
        const icons = { success: '&#10004;', warning: '&#9888;', error: '&#10008;', info: '&#8505;' };
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;background:' + (colors[type]||colors.info) + ';color:#fff;border-radius:10px;font-size:13px;font-weight:500;font-family:Inter,sans-serif;box-shadow:0 4px 15px rgba(0,0,0,.3);z-index:99999;max-width:380px;display:flex;align-items:center;gap:8px;animation:oToast .3s ease';
        const style = document.createElement('style');
        style.textContent = '@keyframes oToast{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}';
        t.appendChild(style);
        t.innerHTML += '<span style="font-size:16px">' + (icons[type]||'') + '</span> ' + message;
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 4500);
    }

    // ============================================================
    // CONNECTIVITY
    // ============================================================

    function setupConnectivity() {
        window.addEventListener('online', () => {
            console.log('[Offline] Conexao restabelecida!');
            hideOfflineBanner();
            showToast('Conexao restabelecida! Sincronizando dados...', 'success');
            setTimeout(() => processQueue(), 1500);
        });

        window.addEventListener('offline', () => {
            console.log('[Offline] Conexao perdida!');
            showOfflineBanner();
        });

        if (!navigator.onLine) {
            showOfflineBanner();
        }
    }

    // ============================================================
    // UTILIDADES
    // ============================================================

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ============================================================
    // INIT
    // ============================================================

    async function init() {
        try {
            await openDB();
            setupConnectivity();
            await processFallback();

            // Contar pendentes
            const items = await getAllPending();
            pendingCount = items.length;
            updateBadge();

            // Sync periodico
            syncTimer = setInterval(() => {
                if (navigator.onLine && pendingCount > 0) processQueue();
            }, SYNC_INTERVAL);

            // Se online com pendentes, sincronizar
            if (navigator.onLine && pendingCount > 0) {
                setTimeout(() => processQueue(), 3000);
            }

            // Escutar SW
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.addEventListener('message', (e) => {
                    if (e.data?.action === 'syncOfflineQueue') processQueue();
                });
            }

            console.log('[Offline] v4.0.0 ATIVO | Fetch global interceptado | Pendentes:', pendingCount, '| Online:', navigator.onLine);
        } catch(e) {
            console.error('[Offline] Erro na inicializacao:', e);
        }
    }

    // ============================================================
    // API PUBLICA
    // ============================================================

    window.OfflineSyncManager = {
        init,
        enqueue: (url, method, body, opts) => enqueue(url, method, body, opts || {}),
        processQueue,
        getStatus: async () => {
            const items = await getAllPending();
            return { enabled: true, online: navigator.onLine, pending: items.length, syncing: isSyncing };
        },
        getQueueItems: getAllPending,
        clearQueue: async () => {
            const d = await openDB();
            d.transaction(STORE_QUEUE, 'readwrite').objectStore(STORE_QUEUE).clear();
            pendingCount = 0;
            updateBadge();
        },
        isOnline: () => navigator.onLine,
        getPendingCount: () => pendingCount,
        cacheAPIResponse,
        getCachedResponse,
        originalFetch // Expor fetch original para uso direto se necessario
    };

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
