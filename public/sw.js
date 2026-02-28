/**
 * ALUFORCE Service Worker
 * Gerencia cache e funcionalidade offline
 * Versão: 2.1.8
 * 
 * ========================================
 * PWA/OFFLINE DESABILITADO COMPLETAMENTE
 * ========================================
 * 
 * Este Service Worker foi desativado para remover
 * toda funcionalidade PWA/Offline do sistema.
 */

// SERVICE WORKER DESABILITADO - Não executa nenhuma funcionalidade
console.log('[SW] Service Worker DESABILITADO - PWA/Offline não está ativo');

// Desregistrar este service worker se já estiver registrado
self.addEventListener('install', (event) => {
    console.log('[SW] SW desabilitado - pulando instalação');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] SW desabilitado - limpando caches antigos');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    console.log('[SW] Removendo cache:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(() => {
            // Desregistra o próprio service worker
            return self.registration.unregister();
        })
    );
});

// Não intercepta nenhuma requisição - deixa passar diretamente para a rede
self.addEventListener('fetch', (event) => {
    // Não faz nada - permite que a requisição vá diretamente para a rede
    return;
});

// Código original desabilitado abaixo
/*
const CACHE_VERSION = 'v2.1.8';
const STATIC_CACHE = `aluforce-static-${CACHE_VERSION}`;
const DATA_CACHE = `aluforce-data-${CACHE_VERSION}`;
const IMAGE_CACHE = `aluforce-images-${CACHE_VERSION}`;

// Assets estáticos essenciais (pré-cache)
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/login.html',
    '/manifest.json',
    '/css/style.css',
    '/css/login.css',
    '/css/pwa-mobile.css',
    '/css/responsive.css',
    '/css/flat-design.css',
    '/js/auth-unified.js',
    '/js/offline-sync-manager.js',
    '/favicon.ico'
];
*/

// Padrões de URL para estratégias de cache
const CACHE_STRATEGIES = {
    // Cache First - para assets estáticos
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
    
    // Network First - para APIs e páginas dinâmicas
    networkFirst: [
        /\/api\//,
        /\.html$/
    ],
    
    // Stale While Revalidate - para recursos que podem ser atualizados
    staleWhileRevalidate: [
        /\/modules\//,
        /\/_shared\//
    ]
};

// Instalação do Service Worker
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando Service Worker...');
    
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('[SW] Pré-cacheando assets essenciais...');
                return cache.addAll(PRECACHE_ASSETS);
            })
            .then(() => {
                console.log('[SW] Instalação concluída');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('[SW] Erro na instalação:', error);
            })
    );
});

// Ativação do Service Worker
self.addEventListener('activate', (event) => {
    console.log('[SW] Ativando Service Worker...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => {
                            // Remove caches antigos
                            return name.startsWith('aluforce-') && 
                                   name !== STATIC_CACHE && 
                                   name !== DATA_CACHE && 
                                   name !== IMAGE_CACHE;
                        })
                        .map((name) => {
                            console.log('[SW] Removendo cache antigo:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Ativação concluída');
                return self.clients.claim();
            })
    );
});

// Intercepta requisições
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Ignora requisições não-GET para cache
    if (event.request.method !== 'GET') {
        return;
    }
    
    // Ignora requisições para outros domínios (exceto CDNs conhecidas)
    const allowedOrigins = [
        self.location.origin,
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com',
        'https://cdnjs.cloudflare.com'
    ];
    
    if (!allowedOrigins.some(origin => event.request.url.startsWith(origin))) {
        return;
    }
    
    // Determina estratégia de cache
    const strategy = getStrategy(event.request.url);
    
    event.respondWith(handleRequest(event.request, strategy));
});

/**
 * Determina a estratégia de cache baseada na URL
 */
function getStrategy(url) {
    for (const pattern of CACHE_STRATEGIES.cacheFirst) {
        if (pattern.test(url)) return 'cacheFirst';
    }
    
    for (const pattern of CACHE_STRATEGIES.networkFirst) {
        if (pattern.test(url)) return 'networkFirst';
    }
    
    for (const pattern of CACHE_STRATEGIES.staleWhileRevalidate) {
        if (pattern.test(url)) return 'staleWhileRevalidate';
    }
    
    // Padrão: network first
    return 'networkFirst';
}

/**
 * Manipula requisição baseada na estratégia
 */
async function handleRequest(request, strategy) {
    switch (strategy) {
        case 'cacheFirst':
            return cacheFirst(request);
        case 'networkFirst':
            return networkFirst(request);
        case 'staleWhileRevalidate':
            return staleWhileRevalidate(request);
        default:
            return networkFirst(request);
    }
}

/**
 * Cache First - Tenta cache, depois rede
 */
async function cacheFirst(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
        return cachedResponse;
    }
    
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.warn('[SW] Falha na rede (cache first):', request.url);
        return new Response('Offline', { status: 503 });
    }
}

/**
 * Network First - Tenta rede, depois cache
 */
async function networkFirst(request) {
    const cacheName = request.url.includes('/api/') ? DATA_CACHE : STATIC_CACHE;
    const cache = await caches.open(cacheName);
    
    try {
        const networkResponse = await fetch(request, { 
            credentials: 'include',
            cache: 'no-cache'
        });
        
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.warn('[SW] Falha na rede, usando cache:', request.url);
        
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Se é uma página HTML, retorna página offline
        if (request.headers.get('Accept')?.includes('text/html')) {
            return createOfflinePage();
        }
        
        // Se é API, retorna JSON vazio
        if (request.url.includes('/api/')) {
            return new Response(JSON.stringify({ 
                error: 'offline',
                message: 'Sem conexão com o servidor',
                cached: false
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        return new Response('Offline', { status: 503 });
    }
}

/**
 * Stale While Revalidate - Retorna cache e atualiza em background
 */
async function staleWhileRevalidate(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    const fetchPromise = fetch(request)
        .then((networkResponse) => {
            if (networkResponse.ok) {
                cache.put(request, networkResponse.clone());
            }
            return networkResponse;
        })
        .catch(() => null);
    
    return cachedResponse || fetchPromise;
}

/**
 * Cria página offline
 */
function createOfflinePage() {
    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ALUFORCE - Offline</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a2744 0%, #2d3548 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            padding: 48px;
            max-width: 400px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .icon {
            width: 100px;
            height: 100px;
            background: linear-gradient(135deg, #f59e0b, #d97706);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
        }
        h1 { font-size: 24px; color: #1f2937; margin-bottom: 12px; }
        p { color: #6b7280; font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
        button {
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            color: white;
            border: none;
            padding: 14px 28px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
        }
        .status {
            margin-top: 24px;
            padding: 12px;
            background: #fef3c7;
            border-radius: 8px;
            font-size: 13px;
            color: #92400e;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">
            <svg width="50" height="50" viewBox="0 0 24 24" fill="white">
                <path d="M1,21h22L12,2L1,21z M13,18h-2v-2h2V18z M13,14h-2v-4h2V14z"/>
            </svg>
        </div>
        <h1>Você está offline</h1>
        <p>Não foi possível conectar ao servidor ALUFORCE. Verifique sua conexão WiFi e tente novamente.</p>
        <button onclick="location.reload()">Tentar novamente</button>
        <div class="status">
            💡 Os dados que você já baixou estão disponíveis no cache.
        </div>
    </div>
</body>
</html>`;
    
    return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
    });
}

// Listener para mensagens do app
self.addEventListener('message', (event) => {
    if (event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
    
    if (event.data.action === 'clearCache') {
        caches.keys().then((names) => {
            names.forEach((name) => caches.delete(name));
        });
    }
});

// Sync event para sincronização em background
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-pending-changes') {
        event.waitUntil(syncPendingChanges());
    }
});

async function syncPendingChanges() {
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
        client.postMessage({ action: 'syncPendingChanges' });
    });
}

// Push notifications
self.addEventListener('push', (event) => {
    const data = event.data?.json() || {};
    
    const options = {
        body: data.body || 'Nova notificação do ALUFORCE',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        vibrate: [100, 50, 100],
        data: data.url || '/'
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'ALUFORCE', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(self.clients.openWindow(event.notification.data || '/'));
});

console.log('[SW] Service Worker carregado - versão', CACHE_VERSION);
