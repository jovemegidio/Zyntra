/**
 * ALUFORCE Service Worker v4.0.0
 * Cache inteligente + Offline-first + Background Sync
 * SISTEMA COMPLETO OFFLINE
 * Atualizado: 01/03/2026
 */

const CACHE_VERSION = 'v4.0.0';
const STATIC_CACHE = `aluforce-static-${CACHE_VERSION}`;
const DATA_CACHE = `aluforce-data-${CACHE_VERSION}`;

// Assets essenciais para pre-cache (base)
const PRECACHE_ASSETS = [
    '/',
    '/login.html',
    '/manifest.json',
    '/css/style.css',
    '/css/login.css',
    '/css/responsive.css',
    '/css/flat-design.css',
    '/js/auth-unified.js',
    '/js/offline-sync-manager.js',
    '/js/pwa-manager.js',
    '/favicon.ico'
];

// Paginas dos modulos para cache progressivo (nao no install, mas na primeira visita)
const MODULE_PAGES = [
    '/PCP/index.html',
    '/PCP/apontamentos.html',
    '/PCP/materiais.html',
    '/PCP/ferramentas.html',
    '/Vendas/',
    '/Vendas/pedidos',
    '/Vendas/clientes',
    '/Vendas/dashboard',
    '/Vendas/relatorios',
    '/Vendas/estoque',
    '/Financeiro/index.html',
    '/Financeiro/contas-pagar.html',
    '/Financeiro/contas-receber.html',
    '/Financeiro/fluxo-caixa.html',
    '/Compras/public/index.html',
    '/NFe/index.html',
    '/RH/dashboard.html',
    '/RH/funcionario.html'
];

// Estrategias de cache
const CACHE_STRATEGIES = {
    cacheFirst: [
        /\.css(\?.*)?$/,
        /\.js(\?.*)?$/,
        /\.woff2?$/,
        /\.ttf$/,
        /\.eot$/,
        /\/icons\//,
        /\/avatars\//,
        /\/images\//,
        /\.png$/,
        /\.jpg$/,
        /\.jpeg$/,
        /\.gif$/,
        /\.webp$/,
        /\.svg$/,
        /\.ico$/,
        /fonts\.googleapis\.com/,
        /fonts\.gstatic\.com/,
        /cdnjs\.cloudflare\.com/
    ],
    networkFirst: [
        /\/api\//,
        /\.html$/
    ],
    staleWhileRevalidate: [
        /\/modules\//,
        /\/_shared\//
    ]
};

// INSTALACAO
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando v' + CACHE_VERSION);
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                return Promise.allSettled(
                    PRECACHE_ASSETS.map(url =>
                        cache.add(url).catch(err => {
                            console.warn('[SW] Falha ao cachear:', url);
                        })
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ATIVACAO
self.addEventListener('activate', (event) => {
    console.log('[SW] Ativando v' + CACHE_VERSION);
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name.startsWith('aluforce-') && name !== STATIC_CACHE && name !== DATA_CACHE)
                    .map(name => { console.log('[SW] Removendo cache antigo:', name); return caches.delete(name); })
            );
        }).then(() => self.clients.claim())
        .then(() => {
            // Cache progressivo: cachear paginas dos modulos em background
            caches.open(STATIC_CACHE).then(cache => {
                MODULE_PAGES.forEach(url => {
                    cache.match(url).then(cached => {
                        if (!cached) {
                            fetch(url, { credentials: 'include' })
                                .then(resp => { if (resp.ok) cache.put(url, resp); })
                                .catch(() => {});
                        }
                    });
                });
            });
        })
    );
});

// FETCH - Intercepta requisicoes
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const allowedOrigins = [self.location.origin, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'];
    if (!allowedOrigins.some(origin => event.request.url.startsWith(origin))) return;

    const strategy = getStrategy(event.request.url);
    event.respondWith(handleRequest(event.request, strategy));
});

function getStrategy(url) {
    for (const p of CACHE_STRATEGIES.cacheFirst) { if (p.test(url)) return 'cacheFirst'; }
    for (const p of CACHE_STRATEGIES.networkFirst) { if (p.test(url)) return 'networkFirst'; }
    for (const p of CACHE_STRATEGIES.staleWhileRevalidate) { if (p.test(url)) return 'staleWhileRevalidate'; }
    return 'networkFirst';
}

async function handleRequest(request, strategy) {
    switch (strategy) {
        case 'cacheFirst': return cacheFirstHandler(request);
        case 'networkFirst': return networkFirstHandler(request);
        case 'staleWhileRevalidate': return staleWhileRevalidateHandler(request);
        default: return networkFirstHandler(request);
    }
}

async function cacheFirstHandler(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
        const resp = await fetch(request);
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
    } catch (e) {
        return new Response('Offline', { status: 503 });
    }
}

async function networkFirstHandler(request) {
    const cacheName = request.url.includes('/api/') ? DATA_CACHE : STATIC_CACHE;
    const cache = await caches.open(cacheName);
    try {
        const resp = await fetch(request, { credentials: 'include', cache: 'no-cache' });
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
    } catch (e) {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.headers.get('Accept')?.includes('text/html')) return createOfflinePage();
        if (request.url.includes('/api/')) {
            return new Response(JSON.stringify({ error: 'offline', message: 'Sem conexao', offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Offline', { status: 503 });
    }
}

async function staleWhileRevalidateHandler(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    const fetchPromise = fetch(request).then(resp => { if (resp.ok) cache.put(request, resp.clone()); return resp; }).catch(() => null);
    return cached || fetchPromise;
}

function createOfflinePage() {
    const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>ALUFORCE - Offline</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,-apple-system,sans-serif;background:linear-gradient(135deg,#1a2744,#2d3548);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.c{background:#fff;border-radius:20px;padding:48px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)}.icon{width:100px;height:100px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;animation:p 2s ease-in-out infinite}@keyframes p{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}h1{font-size:22px;color:#1f2937;margin-bottom:12px}p{color:#6b7280;font-size:14px;line-height:1.6;margin-bottom:20px}.btn{background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;border:none;padding:14px 28px;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer}.s{margin-top:24px;padding:14px;background:#d1fae5;border-radius:8px;font-size:13px;color:#065f46;line-height:1.5}</style></head><body><div class="c"><div class="icon"><svg width="50" height="50" viewBox="0 0 24 24" fill="#fff"><path d="M1,21h22L12,2L1,21z M13,18h-2v-2h2V18z M13,14h-2v-4h2V14z"/></svg></div><h1>Voce esta offline</h1><p>Nao foi possivel conectar ao servidor ALUFORCE.</p><button class="btn" onclick="location.reload()">Tentar novamente</button><div class="s"><strong>Modo Offline Ativo</strong><br>Os dados registrados serao sincronizados automaticamente quando a internet voltar.</div></div></body></html>';
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// BACKGROUND SYNC
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-offline-queue') {
        event.waitUntil(notifyClientsToSync());
    }
});

async function notifyClientsToSync() {
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => client.postMessage({ action: 'syncOfflineQueue' }));
}

// MENSAGENS
self.addEventListener('message', (event) => {
    const { action } = event.data || {};
    if (action === 'skipWaiting') self.skipWaiting();
    if (action === 'clearCache') caches.keys().then(names => names.forEach(n => caches.delete(n)));
});

// PUSH
self.addEventListener('push', (event) => {
    const data = event.data?.json() || {};
    event.waitUntil(
        self.registration.showNotification(data.title || 'ALUFORCE', {
            body: data.body || 'Nova notificacao',
            icon: '/icons/icon-192x192.png',
            badge: '/icons/icon-72x72.png',
            vibrate: [100, 50, 100],
            data: data.url || '/'
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(self.clients.openWindow(event.notification.data || '/'));
});

console.log('[SW] Service Worker v' + CACHE_VERSION + ' OFFLINE COMPLETO carregado');
