// Zyntra - Desktop Application
// Tauri v2 · Professional Enterprise Client
// Connects to VPS at https://erp.aluforce.ind.br (or IP fallback)

use tauri::{Manager, Listener};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri::image::Image;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Check if the VPS server is reachable (production-safe, no SSL bypass)
#[tauri::command]
async fn check_server_health(server_url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/health", server_url);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(body)
}

/// Get app version info
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Open external URL in default browser
#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

/// Set the zoom level of the webview (1.0 = 100%)
#[tauri::command]
async fn set_zoom(window: tauri::WebviewWindow, level: f64) -> Result<(), String> {
    let clamped = level.clamp(0.5, 3.0);
    window.set_zoom(clamped).map_err(|e| e.to_string())
}

/// Toggle fullscreen mode
#[tauri::command]
async fn toggle_fullscreen(window: tauri::WebviewWindow) -> Result<bool, String> {
    let is_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(!is_fullscreen).map_err(|e| e.to_string())?;
    Ok(!is_fullscreen)
}

/// Navigate back in webview history
#[tauri::command]
async fn navigate_back(webview: tauri::WebviewWindow) -> Result<(), String> {
    webview.eval("window.history.back()").map_err(|e| e.to_string())
}

/// Navigate forward in webview history
#[tauri::command]
async fn navigate_forward(webview: tauri::WebviewWindow) -> Result<(), String> {
    webview.eval("window.history.forward()").map_err(|e| e.to_string())
}

/// Reload the current page
#[tauri::command]
async fn reload_page(webview: tauri::WebviewWindow) -> Result<(), String> {
    webview.eval("window.location.reload()").map_err(|e| e.to_string())
}

/// Send a native desktop notification
#[tauri::command]
async fn send_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

/// Navigate to a specific module/page via deep link
#[tauri::command]
async fn navigate_to(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    let script = format!(
        "(() => {{ const s = localStorage.getItem('zyntra_server_url') || 'https://zyntraerp.com.br'; window.location.href = s + '{}'; }})()",
        path
    );
    window.eval(&script).map_err(|e| e.to_string())
}

/// Inject the Zyntra desktop toolbar + accessibility features into every page
fn get_injection_script() -> String {
    r##"
    (function() {
        // Prevent double injection
        if (window.__ZYNTRA_INJECTED__) return;
        window.__ZYNTRA_INJECTED__ = true;

        // Reset injection flag on navigation so it re-injects on new pages
        window.addEventListener('beforeunload', () => { window.__ZYNTRA_INJECTED__ = false; });

        // Don't inject on splash/local pages (tauri:// or file:// or about:blank)
        const loc = window.location.href || '';
        const isSplash = loc.startsWith('tauri://') || loc.startsWith('file://') || loc === 'about:blank' || document.getElementById('splash');
        if (isSplash) return;

        // ==========================================
        //  OFFLINE MODE — Service Worker + Cache
        // ==========================================
        (function initOfflineMode() {
            const CACHE_KEY = 'zyntra_offline_cache';
            const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

            window.__zyntraCache = {
                get(key) {
                    try {
                        const raw = localStorage.getItem(CACHE_KEY + '_' + key);
                        if (!raw) return null;
                        const parsed = JSON.parse(raw);
                        if (Date.now() - parsed.ts > CACHE_TTL) {
                            localStorage.removeItem(CACHE_KEY + '_' + key);
                            return null;
                        }
                        return parsed.data;
                    } catch { return null; }
                },
                set(key, data) {
                    try {
                        localStorage.setItem(CACHE_KEY + '_' + key, JSON.stringify({ ts: Date.now(), data }));
                    } catch {}
                }
            };

            // Smart fetch interceptor — caches GET API calls for offline use
            const origFetch = window.fetch;
            window.fetch = async function(input, init) {
                const url = typeof input === 'string' ? input : input?.url || '';
                const method = init?.method?.toUpperCase() || 'GET';
                const isApiGet = method === 'GET' && url.includes('/api/');

                try {
                    const resp = await origFetch.call(this, input, init);
                    if (isApiGet && resp.ok) {
                        const clone = resp.clone();
                        clone.json().then(data => {
                            window.__zyntraCache.set(url, data);
                        }).catch(() => {});
                    }
                    return resp;
                } catch (err) {
                    // Offline — try cached response
                    if (isApiGet) {
                        const cached = window.__zyntraCache.get(url);
                        if (cached) {
                            console.log('[Zyntra Offline] Serving cached:', url);
                            return new Response(JSON.stringify(cached), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', 'X-Zyntra-Cached': 'true' }
                            });
                        }
                    }
                    throw err;
                }
            };

            // Connection status indicator
            function updateOnlineStatus() {
                const isOffline = !navigator.onLine;
                let indicator = document.getElementById('zyntra-offline-indicator');
                if (isOffline && !indicator) {
                    indicator = document.createElement('div');
                    indicator.id = 'zyntra-offline-indicator';
                    indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;height:28px;background:linear-gradient(90deg,#f59e0b,#d97706);color:#000;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;font-family:Inter,sans-serif;z-index:2147483647;letter-spacing:0.5px;';
                    indicator.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a5 5 0 01-1.414-2.77m-1.414 5.942a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414 1 1 0 01-1.414-1.414z"/></svg>Modo Offline — Exibindo dados em cache';
                    document.body.prepend(indicator);
                } else if (!isOffline && indicator) {
                    indicator.remove();
                }
            }
            window.addEventListener('online', updateOnlineStatus);
            window.addEventListener('offline', updateOnlineStatus);
            updateOnlineStatus();
        })();

        // ==========================================
        //  NOTIFICATIONS — Listen for server events
        // ==========================================
        (function initNotifications() {
            if (!window.__TAURI__) return;
            const CHECK_INTERVAL = 60000; // 1 min
            const LAST_CHECK_KEY = 'zyntra_notif_last_check';

            async function checkNotifications() {
                try {
                    const serverUrl = localStorage.getItem('zyntra_server_url') || 'https://zyntraerp.com.br';
                    const token = localStorage.getItem('token') || '';
                    if (!token) return;

                    const lastCheck = localStorage.getItem(LAST_CHECK_KEY) || new Date(Date.now() - 3600000).toISOString();
                    const resp = await fetch(serverUrl + '/api/notifications?since=' + encodeURIComponent(lastCheck), {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    if (!resp.ok) return;
                    const data = await resp.json();
                    localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());

                    if (data.notifications && data.notifications.length > 0) {
                        for (const n of data.notifications.slice(0, 3)) {
                            window.__TAURI__.core.invoke('send_notification', {
                                title: n.title || 'Zyntra',
                                body: n.message || n.body || ''
                            }).catch(() => {});
                        }
                    }
                } catch {}
            }
            setInterval(checkNotifications, CHECK_INTERVAL);
            setTimeout(checkNotifications, 5000);
        })();

        // ==========================================
        //  PRINT — Optimized templates for NF-e
        // ==========================================
        (function initPrintOptimizations() {
            const printStyle = document.createElement('style');
            printStyle.textContent = `
                @media print {
                    /* Hide non-printable UI elements */
                    #zyntra-toolbar, .sidebar, .nav-top, .breadcrumb-bar,
                    .chat-widget, .btn-floating, .modal-overlay,
                    #zyntra-offline-indicator, .toast-container { display: none !important; }

                    body { background: white !important; color: black !important; font-size: 11pt !important; }
                    * { box-shadow: none !important; text-shadow: none !important; }

                    /* NF-e optimizations */
                    .nfe-content, .danfe-container, .invoice-print {
                        width: 100% !important; max-width: none !important;
                        margin: 0 !important; padding: 10mm !important;
                        page-break-inside: avoid;
                    }
                    .nfe-header { border-bottom: 2px solid #000 !important; margin-bottom: 5mm !important; }
                    .nfe-items table { width: 100% !important; border-collapse: collapse !important; }
                    .nfe-items td, .nfe-items th {
                        border: 1px solid #333 !important; padding: 2mm !important;
                        font-size: 9pt !important;
                    }

                    /* Reports */
                    .report-table { width: 100% !important; border-collapse: collapse !important; }
                    .report-table th { background: #eee !important; -webkit-print-color-adjust: exact; }
                    .report-table td, .report-table th { border: 1px solid #ccc !important; padding: 4px 8px !important; }

                    /* Page breaks */
                    .page-break { page-break-before: always; }
                    h1, h2, h3 { page-break-after: avoid; }
                    table, figure { page-break-inside: avoid; }

                    @page { margin: 10mm 15mm; size: A4 portrait; }
                }
            `;
            document.head.appendChild(printStyle);
        })();

        // ==========================================
        //  STATE
        // ==========================================
        const ZOOM_KEY = 'zyntra_zoom_level';
        const FONT_KEY = 'zyntra_font_size';
        const CONTRAST_KEY = 'zyntra_high_contrast';
        const REDUCE_MOTION_KEY = 'zyntra_reduce_motion';
        const DYSLEXIA_KEY = 'zyntra_dyslexia_font';

        let currentZoom = parseFloat(localStorage.getItem(ZOOM_KEY)) || 1.0;
        let fontSize = parseInt(localStorage.getItem(FONT_KEY)) || 0;
        let highContrast = localStorage.getItem(CONTRAST_KEY) === 'true';
        let reduceMotion = localStorage.getItem(REDUCE_MOTION_KEY) === 'true';
        let dyslexiaFont = localStorage.getItem(DYSLEXIA_KEY) === 'true';

        // Apply saved zoom
        if (window.__TAURI__ && currentZoom !== 1.0) {
            window.__TAURI__.core.invoke('set_zoom', { level: currentZoom }).catch(() => {});
        }

        // ==========================================
        //  STYLES — Lime/Green Zyntra branding
        // ==========================================
        const accessStyle = document.createElement('style');
        accessStyle.id = 'zyntra-accessibility-styles';
        accessStyle.textContent = `
            /* High Contrast */
            body.zyntra-high-contrast a:focus,
            body.zyntra-high-contrast button:focus,
            body.zyntra-high-contrast input:focus,
            body.zyntra-high-contrast select:focus,
            body.zyntra-high-contrast textarea:focus {
                outline: 3px solid #00ffff !important;
                outline-offset: 2px !important;
            }

            /* Reduce Motion */
            body.zyntra-reduce-motion,
            body.zyntra-reduce-motion * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
                scroll-behavior: auto !important;
            }

            /* Dyslexia Font */
            body.zyntra-dyslexia-font,
            body.zyntra-dyslexia-font * {
                font-family: 'OpenDyslexic', 'Comic Sans MS', 'Verdana', sans-serif !important;
                letter-spacing: 0.05em !important;
                word-spacing: 0.15em !important;
                line-height: 1.8 !important;
            }

            /* Font Size */
            body.zyntra-font-1 { font-size: 110% !important; }
            body.zyntra-font-2 { font-size: 120% !important; }
            body.zyntra-font-3 { font-size: 135% !important; }
            body.zyntra-font-4 { font-size: 150% !important; }

            /* =========================================
               NAV BUTTONS — Lime/Green theme
               ========================================= */
            .zyntra-nav-row {
                display: flex;
                align-items: center;
                gap: 4px;
                padding-bottom: 10px;
                margin-bottom: 10px;
                border-bottom: 1px solid rgba(200,230,0,0.15);
            }
            .zyntra-nav-btn {
                width: 30px; height: 28px;
                border-radius: 6px; border: 1px solid rgba(200,230,0,0.15);
                background: rgba(200,230,0,0.06);
                color: #94a3b8; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.15s ease; padding: 0;
            }
            .zyntra-nav-btn:hover { background: rgba(200,230,0,0.18); color: #d9f99d; border-color: rgba(200,230,0,0.3); }
            .zyntra-nav-btn:active { transform: scale(0.92); }
            .zyntra-nav-btn svg { width: 14px; height: 14px; }
            .zyntra-nav-zoom {
                font-size: 10px; color: #C8E600; font-weight: 600;
                font-variant-numeric: tabular-nums;
                padding: 2px 6px; border-radius: 4px;
                background: rgba(200,230,0,0.08); user-select: none;
                margin-left: auto;
            }

            /* =========================================
               TOOLBAR — Lime/Green Zyntra branding
               ========================================= */
            #zyntra-toolbar {
                position: fixed;
                bottom: 16px;
                left: 16px;
                z-index: 2147483645;
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
                font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
                pointer-events: none;
            }
            #zyntra-toolbar * { pointer-events: auto; }

            .zyntra-toggle-btn {
                width: 40px; height: 40px;
                border-radius: 10px;
                border: 1px solid rgba(200,230,0,0.25);
                background: rgba(10,10,10,0.88);
                backdrop-filter: blur(16px);
                color: #C8E600; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.2s ease;
                box-shadow: 0 2px 12px rgba(0,0,0,0.25);
            }
            .zyntra-toggle-btn:hover {
                background: rgba(200,230,0,0.15);
                color: #d9f99d; transform: scale(1.05);
            }
            .zyntra-toggle-btn svg { width: 18px; height: 18px; }

            .zyntra-panel {
                background: rgba(10,10,10,0.96);
                backdrop-filter: blur(24px);
                border: 1px solid rgba(200,230,0,0.2);
                border-radius: 14px;
                padding: 14px;
                min-width: 260px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                display: none;
                animation: zyntra-panel-in 0.2s ease;
            }
            .zyntra-panel.open { display: block; }
            @keyframes zyntra-panel-in {
                from { opacity: 0; transform: translateY(8px) scale(0.97); }
                to   { opacity: 1; transform: translateY(0) scale(1); }
            }

            .zyntra-panel-title {
                font-size: 10px; font-weight: 700; text-transform: uppercase;
                letter-spacing: 1.5px; color: #C8E600;
                margin: 0 0 10px; padding-bottom: 7px;
                border-bottom: 1px solid rgba(200,230,0,0.15);
            }
            .zyntra-section { margin-bottom: 12px; }
            .zyntra-section:last-child { margin-bottom: 0; }
            .zyntra-section-label {
                font-size: 9px; font-weight: 600; text-transform: uppercase;
                letter-spacing: 1px; color: #64748b; margin: 0 0 6px;
            }
            .zyntra-zoom-row { display: flex; align-items: center; gap: 6px; }
            .zyntra-zoom-btn {
                width: 30px; height: 30px; border-radius: 6px;
                border: 1px solid rgba(200,230,0,0.2);
                background: rgba(200,230,0,0.08);
                color: #d9f99d; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                font-size: 14px; font-weight: 600; transition: all 0.15s ease;
            }
            .zyntra-zoom-btn:hover {
                background: rgba(200,230,0,0.2);
                border-color: rgba(200,230,0,0.4);
            }
            .zyntra-zoom-label {
                flex: 1; text-align: center; font-size: 12px;
                font-weight: 600; color: #e2e8f0; font-variant-numeric: tabular-nums;
            }
            .zyntra-toggle-row {
                display: flex; align-items: center;
                justify-content: space-between; padding: 5px 0;
            }
            .zyntra-toggle-label {
                font-size: 11px; color: #cbd5e1;
                display: flex; align-items: center; gap: 6px;
            }
            .zyntra-toggle-label svg { width: 13px; height: 13px; color: #64748b; }
            .zyntra-switch {
                position: relative; width: 36px; height: 18px;
                border-radius: 9px; background: rgba(100,116,139,0.3);
                cursor: pointer; transition: background 0.2s ease;
                border: none; padding: 0;
            }
            .zyntra-switch::after {
                content: ''; position: absolute; top: 2px; left: 2px;
                width: 14px; height: 14px; border-radius: 50%;
                background: #94a3b8; transition: all 0.2s ease;
            }
            .zyntra-switch.on { background: rgba(200,230,0,0.5); }
            .zyntra-switch.on::after { left: 20px; background: #C8E600; }
            .zyntra-shortcuts {
                font-size: 9px; color: #475569; line-height: 1.6;
                padding-top: 8px; border-top: 1px solid rgba(200,230,0,0.1);
            }
            .zyntra-shortcuts kbd {
                display: inline-block; padding: 1px 4px; border-radius: 3px;
                background: rgba(200,230,0,0.12);
                border: 1px solid rgba(200,230,0,0.2);
                color: #C8E600; font-family: 'Consolas', monospace; font-size: 8px;
                margin: 0 1px;
            }

            /* Context Menu */
            .zyntra-context-menu {
                position: fixed;
                background: rgba(10,10,10,0.96);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(200,230,0,0.15);
                border-radius: 10px;
                padding: 4px;
                min-width: 180px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.6);
                z-index: 2147483646;
                font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
                animation: zyntra-panel-in 0.15s ease;
            }
            .zyntra-context-item {
                display: flex; align-items: center; gap: 8px;
                padding: 7px 12px;
                font-size: 12px; color: #cbd5e1;
                border-radius: 6px; cursor: pointer;
                transition: all 0.1s ease;
                border: none; background: none; width: 100%;
                text-align: left; font-family: inherit;
            }
            .zyntra-context-item:hover { background: rgba(200,230,0,0.1); color: #f1f5f9; }
            .zyntra-context-item svg { width: 14px; height: 14px; color: #64748b; flex-shrink: 0; }
            .zyntra-context-item:hover svg { color: #C8E600; }
            .zyntra-context-item .shortcut {
                margin-left: auto; font-size: 10px; color: #475569;
                font-family: 'Consolas', monospace;
            }
            .zyntra-context-sep { height: 1px; background: rgba(200,230,0,0.08); margin: 3px 8px; }
        `;
        document.head.appendChild(accessStyle);

        // Apply saved accessibility
        if (highContrast) document.body.classList.add('zyntra-high-contrast');
        if (reduceMotion) document.body.classList.add('zyntra-reduce-motion');
        if (dyslexiaFont) document.body.classList.add('zyntra-dyslexia-font');
        if (fontSize > 0) document.body.classList.add('zyntra-font-' + fontSize);

        // ==========================================
        //  CONTEXT MENU — Right-click menu
        // ==========================================
        (function initContextMenu() {
            function removeCtx() {
                const existing = document.getElementById('zyntra-ctx-menu');
                if (existing) existing.remove();
            }

            document.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                removeCtx();

                const selectedText = window.getSelection()?.toString()?.trim() || '';
                const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
                const isLink = e.target.closest('a');
                const isImage = e.target.tagName === 'IMG';

                const menu = document.createElement('div');
                menu.id = 'zyntra-ctx-menu';
                menu.className = 'zyntra-context-menu';

                let items = [];

                if (selectedText) {
                    items.push({ icon: 'copy', label: 'Copiar', shortcut: 'Ctrl+C', action: () => navigator.clipboard.writeText(selectedText) });
                }
                if (isInput) {
                    items.push({ icon: 'paste', label: 'Colar', shortcut: 'Ctrl+V', action: async () => {
                        const text = await navigator.clipboard.readText();
                        document.execCommand('insertText', false, text);
                    }});
                    items.push({ icon: 'selectAll', label: 'Selecionar Tudo', shortcut: 'Ctrl+A', action: () => e.target.select?.() });
                }
                if (isLink) {
                    const href = isLink.href;
                    items.push({ sep: true });
                    items.push({ icon: 'link', label: 'Copiar Link', action: () => navigator.clipboard.writeText(href) });
                    items.push({ icon: 'external', label: 'Abrir no Navegador', action: () => {
                        if (window.__TAURI__) window.__TAURI__.core.invoke('open_external', { url: href }).catch(() => {});
                        else window.open(href, '_blank');
                    }});
                }
                if (isImage) {
                    items.push({ sep: true });
                    items.push({ icon: 'image', label: 'Copiar Imagem', action: async () => {
                        try {
                            const resp = await fetch(e.target.src);
                            const blob = await resp.blob();
                            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                        } catch {}
                    }});
                }

                items.push({ sep: true });
                items.push({ icon: 'back', label: 'Voltar', shortcut: 'Alt+\u2190', action: () => window.history.back() });
                items.push({ icon: 'forward', label: 'Avan\u00e7ar', shortcut: 'Alt+\u2192', action: () => window.history.forward() });
                items.push({ icon: 'reload', label: 'Recarregar', shortcut: 'F5', action: () => window.location.reload() });
                items.push({ sep: true });
                items.push({ icon: 'print', label: 'Imprimir', shortcut: 'Ctrl+P', action: () => window.print() });

                const icons = {
                    copy: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/>',
                    paste: '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>',
                    selectAll: '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"/>',
                    link: '<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.19-5.192a4.5 4.5 0 00-6.364 0l-4.5 4.5a4.5 4.5 0 006.364 6.364l1.757-1.757"/>',
                    external: '<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/>',
                    image: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M18 3.75h.75M12 3.75H8.25A2.25 2.25 0 006 6v12m0 0h12a2.25 2.25 0 002.25-2.25V6m-18 12V6"/>',
                    back: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5"/>',
                    forward: '<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/>',
                    reload: '<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"/>',
                    print: '<path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m0 0a48.549 48.549 0 0110.5 0M7.75 7.7v-.7A2.25 2.25 0 0110 4.75h4a2.25 2.25 0 012.25 2.25v.7"/>'
                };

                for (const item of items) {
                    if (item.sep) {
                        menu.innerHTML += '<div class="zyntra-context-sep"></div>';
                        continue;
                    }
                    const btn = document.createElement('button');
                    btn.className = 'zyntra-context-item';
                    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
                        (icons[item.icon] || '') + '</svg>' +
                        '<span>' + item.label + '</span>' +
                        (item.shortcut ? '<span class="shortcut">' + item.shortcut + '</span>' : '');
                    btn.addEventListener('click', () => { removeCtx(); item.action(); });
                    menu.appendChild(btn);
                }

                document.body.appendChild(menu);

                // Position
                const rect = menu.getBoundingClientRect();
                let x = e.clientX, y = e.clientY;
                if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
                if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
                menu.style.left = x + 'px';
                menu.style.top = y + 'px';
            });

            document.addEventListener('click', removeCtx);
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') removeCtx(); });
        })();

        // ==========================================
        //  TOOLBAR — bottom LEFT
        // ==========================================
        const toolbar = document.createElement('div');
        toolbar.id = 'zyntra-toolbar';
        toolbar.innerHTML = `
            <div class="zyntra-panel" id="zyntra-panel">
                <div class="zyntra-panel-title">Ferramentas Zyntra</div>
                <div class="zyntra-nav-row">
                    <button class="zyntra-nav-btn" id="zyntra-btn-back" title="Voltar (Alt+\u2190)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5"/></svg>
                    </button>
                    <button class="zyntra-nav-btn" id="zyntra-btn-forward" title="Avan\u00e7ar (Alt+\u2192)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                    </button>
                    <button class="zyntra-nav-btn" id="zyntra-btn-reload" title="Recarregar (F5)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"/></svg>
                    </button>
                    <button class="zyntra-nav-btn" id="zyntra-btn-home" title="Dashboard (Alt+Home)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/></svg>
                    </button>
                    <button class="zyntra-nav-btn" id="zyntra-btn-fullscreen" title="Tela Cheia (F11)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/></svg>
                    </button>
                    <span class="zyntra-nav-zoom" id="zyntra-nav-zoom">100%</span>
                </div>
                <div class="zyntra-section">
                    <div class="zyntra-section-label">Zoom</div>
                    <div class="zyntra-zoom-row">
                        <button class="zyntra-zoom-btn" id="zyntra-zoom-out" title="Ctrl+-">\u2212</button>
                        <span class="zyntra-zoom-label" id="zyntra-zoom-value">100%</span>
                        <button class="zyntra-zoom-btn" id="zyntra-zoom-in" title="Ctrl++">+</button>
                        <button class="zyntra-zoom-btn" id="zyntra-zoom-reset" title="Ctrl+0" style="font-size:10px;">\u21BA</button>
                    </div>
                </div>
                <div class="zyntra-section">
                    <div class="zyntra-section-label">Tamanho da Fonte</div>
                    <div class="zyntra-zoom-row">
                        <button class="zyntra-zoom-btn" id="zyntra-font-down">A\u2212</button>
                        <span class="zyntra-zoom-label" id="zyntra-font-value">Normal</span>
                        <button class="zyntra-zoom-btn" id="zyntra-font-up">A+</button>
                        <button class="zyntra-zoom-btn" id="zyntra-font-reset" style="font-size:10px;">\u21BA</button>
                    </div>
                </div>
                <div class="zyntra-section">
                    <div class="zyntra-section-label">Acessibilidade</div>
                    <div class="zyntra-toggle-row">
                        <span class="zyntra-toggle-label">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                            Alto Contraste
                        </span>
                        <button class="zyntra-switch ${highContrast ? 'on' : ''}" id="zyntra-contrast-toggle"></button>
                    </div>
                    <div class="zyntra-toggle-row">
                        <span class="zyntra-toggle-label">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5"/></svg>
                            Reduzir Anima\u00e7\u00f5es
                        </span>
                        <button class="zyntra-switch ${reduceMotion ? 'on' : ''}" id="zyntra-motion-toggle"></button>
                    </div>
                    <div class="zyntra-toggle-row">
                        <span class="zyntra-toggle-label">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"/></svg>
                            Fonte Dislexia
                        </span>
                        <button class="zyntra-switch ${dyslexiaFont ? 'on' : ''}" id="zyntra-dyslexia-toggle"></button>
                    </div>
                </div>
                <div class="zyntra-shortcuts">
                    <kbd>Ctrl</kbd>+<kbd>+/-</kbd> Zoom &nbsp;
                    <kbd>Ctrl</kbd>+<kbd>0</kbd> Reset &nbsp;
                    <kbd>F11</kbd> Tela cheia<br>
                    <kbd>F5</kbd> Recarregar &nbsp;
                    <kbd>Alt</kbd>+<kbd>\u2190\u2192</kbd> Navegar &nbsp;
                    <kbd>Ctrl</kbd>+<kbd>U</kbd> Painel
                </div>
            </div>
            <button class="zyntra-toggle-btn" id="zyntra-toggle-btn" title="Ferramentas (Ctrl+U)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            </button>
        `;
        document.body.appendChild(toolbar);

        // ==========================================
        //  ZOOM FUNCTIONS
        // ==========================================
        function updateZoomUI() {
            const pct = Math.round(currentZoom * 100);
            const el = document.getElementById('zyntra-zoom-value');
            const nz = document.getElementById('zyntra-nav-zoom');
            if (el) el.textContent = pct + '%';
            if (nz) nz.textContent = pct + '%';
        }
        async function applyZoom(level) {
            currentZoom = Math.max(0.5, Math.min(3.0, level));
            localStorage.setItem(ZOOM_KEY, currentZoom.toString());
            updateZoomUI();
            if (window.__TAURI__) {
                await window.__TAURI__.core.invoke('set_zoom', { level: currentZoom }).catch(() => {});
            }
        }
        function zoomIn()  { applyZoom(Math.round((currentZoom + 0.1) * 10) / 10); }
        function zoomOut() { applyZoom(Math.round((currentZoom - 0.1) * 10) / 10); }
        function zoomReset(){ applyZoom(1.0); }

        // ==========================================
        //  FONT SIZE
        // ==========================================
        const fontLabels = ['Normal', '110%', '120%', '135%', '150%'];
        function updateFontUI() {
            const el = document.getElementById('zyntra-font-value');
            if (el) el.textContent = fontLabels[fontSize] || 'Normal';
        }
        function applyFontSize(level) {
            for (let i = 1; i <= 4; i++) document.body.classList.remove('zyntra-font-' + i);
            fontSize = Math.max(0, Math.min(4, level));
            if (fontSize > 0) document.body.classList.add('zyntra-font-' + fontSize);
            localStorage.setItem(FONT_KEY, fontSize.toString());
            updateFontUI();
        }

        // ==========================================
        //  TOGGLES
        // ==========================================
        function toggleContrast() {
            highContrast = !highContrast;
            document.body.classList.toggle('zyntra-high-contrast', highContrast);
            localStorage.setItem(CONTRAST_KEY, highContrast.toString());
            document.getElementById('zyntra-contrast-toggle')?.classList.toggle('on', highContrast);
        }
        function toggleMotion() {
            reduceMotion = !reduceMotion;
            document.body.classList.toggle('zyntra-reduce-motion', reduceMotion);
            localStorage.setItem(REDUCE_MOTION_KEY, reduceMotion.toString());
            document.getElementById('zyntra-motion-toggle')?.classList.toggle('on', reduceMotion);
        }
        function toggleDyslexia() {
            dyslexiaFont = !dyslexiaFont;
            document.body.classList.toggle('zyntra-dyslexia-font', dyslexiaFont);
            localStorage.setItem(DYSLEXIA_KEY, dyslexiaFont.toString());
            document.getElementById('zyntra-dyslexia-toggle')?.classList.toggle('on', dyslexiaFont);
        }

        // ==========================================
        //  EVENT LISTENERS
        // ==========================================
        const panel = document.getElementById('zyntra-panel');
        document.getElementById('zyntra-toggle-btn')?.addEventListener('click', () => panel?.classList.toggle('open'));
        document.getElementById('zyntra-zoom-in')?.addEventListener('click', zoomIn);
        document.getElementById('zyntra-zoom-out')?.addEventListener('click', zoomOut);
        document.getElementById('zyntra-zoom-reset')?.addEventListener('click', zoomReset);
        document.getElementById('zyntra-font-up')?.addEventListener('click', () => applyFontSize(fontSize + 1));
        document.getElementById('zyntra-font-down')?.addEventListener('click', () => applyFontSize(fontSize - 1));
        document.getElementById('zyntra-font-reset')?.addEventListener('click', () => applyFontSize(0));
        document.getElementById('zyntra-contrast-toggle')?.addEventListener('click', toggleContrast);
        document.getElementById('zyntra-motion-toggle')?.addEventListener('click', toggleMotion);
        document.getElementById('zyntra-dyslexia-toggle')?.addEventListener('click', toggleDyslexia);

        // Navigation
        document.getElementById('zyntra-btn-back')?.addEventListener('click', () => window.history.back());
        document.getElementById('zyntra-btn-forward')?.addEventListener('click', () => window.history.forward());
        document.getElementById('zyntra-btn-reload')?.addEventListener('click', () => window.location.reload());
        document.getElementById('zyntra-btn-home')?.addEventListener('click', () => {
            const s = localStorage.getItem('zyntra_server_url') || 'https://zyntraerp.com.br';
            window.location.href = s + '/dashboard';
        });
        document.getElementById('zyntra-btn-fullscreen')?.addEventListener('click', async () => {
            if (window.__TAURI__) await window.__TAURI__.core.invoke('toggle_fullscreen').catch(() => {});
        });

        // ==========================================
        //  KEYBOARD SHORTCUTS
        // ==========================================
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
            if (e.ctrlKey && e.key === '-') { e.preventDefault(); zoomOut(); }
            if (e.ctrlKey && e.key === '0') { e.preventDefault(); zoomReset(); }
            if (e.key === 'F11') { e.preventDefault(); if (window.__TAURI__) window.__TAURI__.core.invoke('toggle_fullscreen').catch(()=>{}); }
            if (e.key === 'F5') { e.preventDefault(); window.location.reload(); }
            if (e.ctrlKey && e.key === 'r') { e.preventDefault(); window.location.reload(); }
            if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); window.history.back(); }
            if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); window.history.forward(); }
            if (e.altKey && e.key === 'Home') {
                e.preventDefault();
                const s = localStorage.getItem('zyntra_server_url') || 'https://zyntraerp.com.br';
                window.location.href = s + '/dashboard';
            }
            if (e.ctrlKey && e.key === 'u') { e.preventDefault(); panel?.classList.toggle('open'); }
            if (e.key === 'Escape') { panel?.classList.remove('open'); }
            if (e.ctrlKey && e.key === 'p') { e.preventDefault(); window.print(); }
        });

        updateZoomUI();
        updateFontUI();
    })();
    "##.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── Existing plugins ──
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        // ── New plugins ──
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // ── Commands ──
        .invoke_handler(tauri::generate_handler![
            check_server_health,
            get_app_version,
            open_external,
            set_zoom,
            toggle_fullscreen,
            navigate_back,
            navigate_forward,
            reload_page,
            send_notification,
            navigate_to,
        ])
        .setup(|app| {
            // ==========================================
            //  MAIN WINDOW
            // ==========================================
            let main_window = app.get_webview_window("main")
                .expect("Failed to get main window");
            let _ = main_window.set_title("Zyntra - Sistema de Gestão Empresarial");

            // ==========================================
            //  TRAY ICON — System tray with context menu
            // ==========================================
            let tray_menu = MenuBuilder::new(app)
                .item(&MenuItemBuilder::with_id("tray_open", "Abrir Zyntra").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("tray_dashboard", "Dashboard").build(app)?)
                .item(&MenuItemBuilder::with_id("tray_vendas", "Vendas").build(app)?)
                .item(&MenuItemBuilder::with_id("tray_financeiro", "Financeiro").build(app)?)
                .item(&MenuItemBuilder::with_id("tray_pcp", "PCP").build(app)?)
                .item(&MenuItemBuilder::with_id("tray_rh", "RH").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("tray_quit", "Sair").build(app)?)
                .build()?;

            let tray_icon_image = Image::from_bytes(include_bytes!("../icons/icon.png"))
                .expect("Failed to load tray icon");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon_image)
                .tooltip("Zyntra - Sistema de Gestão Empresarial")
                .menu(&tray_menu)
                .on_menu_event(|app, event| {
                    let id = event.id().as_ref();
                    match id {
                        "tray_open" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                                let _ = w.unminimize();
                            }
                        }
                        "tray_dashboard" | "tray_vendas" | "tray_financeiro" | "tray_pcp" | "tray_rh" => {
                            let path = match id {
                                "tray_dashboard" => "/dashboard",
                                "tray_vendas" => "/vendas",
                                "tray_financeiro" => "/financeiro",
                                "tray_pcp" => "/pcp",
                                "tray_rh" => "/rh",
                                _ => "/dashboard",
                            };
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                                let script = format!(
                                    "(() => {{ const s = localStorage.getItem('zyntra_server_url') || 'https://zyntraerp.com.br'; window.location.href = s + '{}'; }})()",
                                    path
                                );
                                let _ = w.eval(&script);
                            }
                        }
                        "tray_quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Double-click on tray icon → show/focus window
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.unminimize();
                        }
                    }
                })
                .build(app)?;

            // ==========================================
            //  DEEP LINKS — zyntra:// protocol handler
            // ==========================================
            let deep_link_window = main_window.clone();
            app.listen("deep-link://new-url", move |event: tauri::Event| {
                let payload = event.payload();
                // Payload is a URL like zyntra://vendas/pedidos/123
                // Extract path after zyntra://
                if let Some(path_str) = payload.strip_prefix("\"zyntra://") {
                    let path = path_str.trim_end_matches('"');
                    let clean_path = if path.starts_with('/') {
                        path.to_string()
                    } else {
                        format!("/{}", path)
                    };
                    let script = format!(
                        "(() => {{ const s = localStorage.getItem('zyntra_server_url') || 'https://zyntraerp.com.br'; window.location.href = s + '{}'; }})()",
                        clean_path
                    );
                    let _ = deep_link_window.eval(&script);
                    let _ = deep_link_window.show();
                    let _ = deep_link_window.set_focus();
                }
            });

            // ==========================================
            //  GLOBAL SHORTCUTS — Ctrl+Shift+Z to focus
            // ==========================================
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::ShortcutState;

                let shortcut_window = main_window.clone();
                app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+Z", move |_app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = shortcut_window.show();
                        let _ = shortcut_window.set_focus();
                        let _ = shortcut_window.unminimize();
                        println!("🎯 Global shortcut {} triggered — focusing Zyntra", shortcut);
                    }
                })?;
            }

            // ==========================================
            //  INJECTION LOOP — Toolbar + features
            // ==========================================
            let injection = get_injection_script();
            let win_clone = main_window.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                    let _ = win_clone.eval(&injection);
                }
            });

            // Log startup
            println!("🚀 Zyntra Desktop v{} initialized", env!("CARGO_PKG_VERSION"));
            println!("   🔧 Tray icon: active");
            println!("   🔗 Deep links: zyntra:// registered");
            println!("   ⌨️  Global shortcut: Ctrl+Shift+Z");
            println!("   📴 Offline mode: enabled");
            println!("   🖨️  Print optimization: enabled");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Erro ao executar Zyntra");
}
