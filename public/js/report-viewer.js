/**
 * ALUFORCE - Report Viewer v1.0.0
 * Visualizador de relatórios inline (sem abrir nova aba)
 * Intercepta window.open para PDFs, relatórios e impressões
 * Exibe tudo num modal fullscreen dentro do sistema
 * 01/03/2026
 */

(function () {
    'use strict';

    // ============================================================
    // CONFIGURAÇÃO
    // ============================================================

    const VIEWER_ID = 'aluforce-report-viewer';
    const originalWindowOpen = window.open.bind(window);

    // URLs que NÃO devem ser interceptadas (abrem normalmente)
    const SKIP_PATTERNS = [
        /wa\.me/i,
        /whatsapp/i,
        /mailto:/i,
        /tel:/i,
        /maps\.google/i,
        /youtube\.com/i,
        /github\.com/i,
        /linkedin/i,
        /facebook/i,
        /instagram/i,
        /twitter\.com/i,
        /x\.com/i,
        /^https?:\/\/(?!localhost|31\.97\.64)/i  // Links externos (exceto localhost e VPS)
    ];

    // Padrões que DEVEM ser interceptados
    const INTERCEPT_PATTERNS = [
        /^blob:/i,                    // Blob URLs (PDFs, HTML)
        /\/api\/.*\/(danfe|pdf|relatorio|report|etiqueta|dacte|boleto)/i,
        /\.pdf(\?|$)/i               // URLs de PDF diretas
    ];

    let viewerElement = null;
    let currentBlobUrl = null;

    // ============================================================
    // CRIAR ESTRUTURA DO VIEWER
    // ============================================================

    function createViewer() {
        if (document.getElementById(VIEWER_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = VIEWER_ID;
        overlay.innerHTML = `
            <style>
                #${VIEWER_ID} {
                    display: none;
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    z-index: 999999;
                    background: rgba(0,0,0,0.85);
                    backdrop-filter: blur(4px);
                    animation: rvFadeIn 0.25s ease;
                    font-family: 'Inter', 'Segoe UI', sans-serif;
                }
                #${VIEWER_ID}.active { display: flex; flex-direction: column; }

                @keyframes rvFadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes rvSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

                .rv-toolbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 20px;
                    background: linear-gradient(135deg, #1a2744, #243352);
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                    color: #fff;
                    min-height: 50px;
                    animation: rvSlideUp 0.3s ease;
                }

                .rv-toolbar-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .rv-toolbar-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: #e2e8f0;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .rv-toolbar-title svg {
                    opacity: 0.7;
                }

                .rv-toolbar-actions {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .rv-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 7px 14px;
                    border: 1px solid rgba(255,255,255,0.15);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.08);
                    color: #e2e8f0;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-family: inherit;
                }

                .rv-btn:hover {
                    background: rgba(255,255,255,0.15);
                    border-color: rgba(255,255,255,0.25);
                    transform: translateY(-1px);
                }

                .rv-btn-primary {
                    background: linear-gradient(135deg, #3b82f6, #2563eb);
                    border-color: #3b82f6;
                }

                .rv-btn-primary:hover {
                    background: linear-gradient(135deg, #60a5fa, #3b82f6);
                }

                .rv-btn-danger {
                    background: rgba(239,68,68,0.15);
                    border-color: rgba(239,68,68,0.3);
                    color: #fca5a5;
                }

                .rv-btn-danger:hover {
                    background: rgba(239,68,68,0.3);
                }

                .rv-content {
                    flex: 1;
                    position: relative;
                    overflow: hidden;
                    animation: rvSlideUp 0.35s ease;
                }

                .rv-iframe {
                    width: 100%;
                    height: 100%;
                    border: none;
                    background: #fff;
                }

                .rv-loading {
                    position: absolute;
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 16px;
                    color: #94a3b8;
                    font-size: 14px;
                }

                .rv-spinner {
                    width: 36px;
                    height: 36px;
                    border: 3px solid rgba(59,130,246,0.2);
                    border-top-color: #3b82f6;
                    border-radius: 50%;
                    animation: rvSpin 0.8s linear infinite;
                }

                @keyframes rvSpin { to { transform: rotate(360deg); } }

                /* Responsivo */
                @media (max-width: 768px) {
                    .rv-toolbar { padding: 8px 12px; }
                    .rv-btn span.rv-btn-text { display: none; }
                    .rv-btn { padding: 8px 10px; }
                }
            </style>

            <div class="rv-toolbar">
                <div class="rv-toolbar-left">
                    <div class="rv-toolbar-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                            <polyline points="10 9 9 9 8 9"/>
                        </svg>
                        <span id="rv-title">Visualização de Documento</span>
                    </div>
                </div>
                <div class="rv-toolbar-actions">
                    <button class="rv-btn rv-btn-primary" id="rv-btn-print" title="Imprimir">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"/>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                            <rect x="6" y="14" width="12" height="8"/>
                        </svg>
                        <span class="rv-btn-text">Imprimir</span>
                    </button>
                    <button class="rv-btn" id="rv-btn-newtab" title="Abrir em nova aba">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                        <span class="rv-btn-text">Nova Aba</span>
                    </button>
                    <button class="rv-btn" id="rv-btn-download" title="Download" style="display:none">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        <span class="rv-btn-text">Download</span>
                    </button>
                    <button class="rv-btn rv-btn-danger" id="rv-btn-close" title="Fechar (Esc)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                        <span class="rv-btn-text">Fechar</span>
                    </button>
                </div>
            </div>

            <div class="rv-content">
                <div class="rv-loading" id="rv-loading">
                    <div class="rv-spinner"></div>
                    <span>Carregando documento...</span>
                </div>
                <iframe class="rv-iframe" id="rv-iframe"></iframe>
            </div>
        `;

        document.body.appendChild(overlay);
        viewerElement = overlay;

        // Event listeners
        document.getElementById('rv-btn-close').addEventListener('click', closeViewer);
        document.getElementById('rv-btn-print').addEventListener('click', printDocument);
        document.getElementById('rv-btn-newtab').addEventListener('click', openInNewTab);
        document.getElementById('rv-btn-download').addEventListener('click', downloadDocument);

        // Fechar com Esc
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && viewerElement && viewerElement.classList.contains('active')) {
                closeViewer();
            }
        });

        // Fechar clicando fora (no overlay/toolbar)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeViewer();
        });
    }

    // ============================================================
    // CONTROLES DO VIEWER
    // ============================================================

    let currentUrl = null;
    let currentHtmlContent = null;
    let currentTitle = 'Visualização de Documento';

    function openViewer(url, title, htmlContent) {
        createViewer();

        currentUrl = url;
        currentHtmlContent = htmlContent;
        currentTitle = title || 'Visualização de Documento';

        document.getElementById('rv-title').textContent = currentTitle;
        const iframe = document.getElementById('rv-iframe');
        const loading = document.getElementById('rv-loading');
        const downloadBtn = document.getElementById('rv-btn-download');

        loading.style.display = 'flex';
        iframe.style.opacity = '0';

        iframe.onload = () => {
            loading.style.display = 'none';
            iframe.style.opacity = '1';
            iframe.style.transition = 'opacity 0.3s ease';
        };

        if (htmlContent) {
            // Conteúdo HTML direto
            iframe.srcdoc = htmlContent;
            downloadBtn.style.display = 'none';
        } else if (url) {
            // URL (PDF ou blob)
            iframe.removeAttribute('srcdoc');
            iframe.src = url;
            // Mostrar botão de download para PDFs
            const isPdf = url.includes('.pdf') || url.includes('/pdf') || url.includes('/danfe') || url.includes('/dacte') || url.includes('/boleto');
            downloadBtn.style.display = isPdf ? 'inline-flex' : 'none';
        }

        viewerElement.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeViewer() {
        if (!viewerElement) return;
        viewerElement.classList.remove('active');
        document.body.style.overflow = '';

        const iframe = document.getElementById('rv-iframe');
        if (iframe) {
            iframe.removeAttribute('src');
            iframe.removeAttribute('srcdoc');
        }

        // Limpar blob URL se existir
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }

        currentUrl = null;
        currentHtmlContent = null;
    }

    function printDocument() {
        const iframe = document.getElementById('rv-iframe');
        if (!iframe) return;

        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (e) {
            // Cross-origin — fallback
            if (currentUrl) {
                originalWindowOpen(currentUrl, '_blank');
            }
        }
    }

    function openInNewTab() {
        if (currentHtmlContent) {
            const blob = new Blob([currentHtmlContent], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            originalWindowOpen(url, '_blank');
        } else if (currentUrl) {
            originalWindowOpen(currentUrl, '_blank');
        }
    }

    function downloadDocument() {
        if (!currentUrl) return;
        const a = document.createElement('a');
        a.href = currentUrl;
        a.download = currentTitle.replace(/[^a-zA-Z0-9\-_\.]/g, '_') + '.pdf';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 100);
    }

    // ============================================================
    // DETECÇÃO DE TÍTULO
    // ============================================================

    function detectTitle(url, htmlContent) {
        if (htmlContent) {
            const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) return titleMatch[1].trim();

            // Detectar pelo h1 ou header
            const h1Match = htmlContent.match(/<h1[^>]*>([^<]+)<\/h1>/i);
            if (h1Match) return h1Match[1].trim();
        }

        if (url) {
            if (url.includes('/danfe')) return 'DANFE - Nota Fiscal';
            if (url.includes('/dacte')) return 'DACTE - Conhecimento de Transporte';
            if (url.includes('/boleto')) return 'Boleto Bancário';
            if (url.includes('/etiqueta')) return 'Etiqueta';
            if (url.includes('/relatorio')) return 'Relatório';
            if (url.includes('/orcamento')) return 'Orçamento';
            if (url.includes('/pdf')) return 'Documento PDF';
            if (url.includes('blob:')) return 'Documento';
        }

        return 'Visualização de Documento';
    }

    // ============================================================
    // INTERCEPTOR DE window.open
    // ============================================================

    function shouldIntercept(url) {
        if (!url && url !== '') return false;

        // Verificar se deve ser ignorado
        for (const pattern of SKIP_PATTERNS) {
            if (pattern.test(url)) return false;
        }

        // URL vazia com _blank = provavelmente document.write de relatório
        if (url === '' || url === 'about:blank') return true;

        // Verificar se é um padrão de relatório
        for (const pattern of INTERCEPT_PATTERNS) {
            if (pattern.test(url)) return true;
        }

        return false;
    }

    /**
     * Cria um objeto proxy que simula uma janela de navegador.
     * Quando o código faz printWindow.document.write(html),
     * capturamos o HTML e exibimos no viewer inline.
     */
    function createFakeWindow() {
        let htmlParts = [];
        let isClosed = false;

        const fakeDocument = {
            write: function (content) {
                htmlParts.push(content);
            },
            writeln: function (content) {
                htmlParts.push(content + '\n');
            },
            close: function () {
                if (isClosed) return;
                isClosed = true;

                const fullHtml = htmlParts.join('');
                const title = detectTitle(null, fullHtml);

                // Pequeno delay para garantir que o código chamador terminou
                setTimeout(() => {
                    openViewer(null, title, fullHtml);
                }, 50);
            },
            // Propriedades que o código pode acessar
            head: document.createElement('head'),
            body: document.createElement('body'),
            title: '',
            readyState: 'complete',
            createElement: (tag) => document.createElement(tag),
            createTextNode: (text) => document.createTextNode(text),
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: () => null,
            getElementsByTagName: () => [],
            getElementsByClassName: () => []
        };

        const fakeWindow = {
            document: fakeDocument,
            location: { href: '' },
            closed: false,
            focus: function () { },
            blur: function () { },
            close: function () { closeViewer(); },
            print: function () {
                // Se print() for chamado antes de document.close(), montar o HTML
                if (!isClosed && htmlParts.length > 0) {
                    isClosed = true;
                    const fullHtml = htmlParts.join('');
                    const title = detectTitle(null, fullHtml);
                    openViewer(null, title, fullHtml);
                }
                // Delay para garantir que o viewer está pronto
                setTimeout(() => printDocument(), 300);
            },
            // Métodos que podem ser chamados
            addEventListener: function () { },
            removeEventListener: function () { },
            postMessage: function () { },
            setTimeout: window.setTimeout.bind(window),
            clearTimeout: window.clearTimeout.bind(window),
            setInterval: window.setInterval.bind(window),
            clearInterval: window.clearInterval.bind(window),
            onload: null,
            onafterprint: null,
            onbeforeprint: null
        };

        return fakeWindow;
    }

    // Override window.open
    window.open = function (url, target, features) {
        // Se não deve interceptar, usar original
        if (!shouldIntercept(url || '')) {
            return originalWindowOpen(url, target, features);
        }

        // URL vazia = padrão document.write (HTML print)
        if (!url || url === '' || url === 'about:blank') {
            return createFakeWindow();
        }

        // Blob URL ou URL de relatório
        if (url) {
            const title = detectTitle(url, null);

            // Para blob URLs, verificar se é PDF ou HTML
            if (url.startsWith('blob:')) {
                currentBlobUrl = url; // Guardar para não revogar prematuramente
                openViewer(url, title, null);
                // Retornar fake window para evitar erros
                return { document: { write: () => { }, close: () => { } }, close: () => closeViewer(), focus: () => { }, print: () => printDocument() };
            }

            // URL direta (PDF, DANFE, etc.)
            openViewer(url, title, null);
            return { document: { write: () => { }, close: () => { } }, close: () => closeViewer(), focus: () => { }, print: () => printDocument() };
        }

        return originalWindowOpen(url, target, features);
    };

    // ============================================================
    // API PÚBLICA
    // ============================================================

    window.ReportViewer = {
        open: openViewer,
        close: closeViewer,
        print: printDocument,
        openInNewTab: openInNewTab,
        download: downloadDocument,
        // Permite abrir forçando nova aba (bypass do interceptor)
        openExternal: originalWindowOpen
    };

    // ============================================================
    // INIT
    // ============================================================

    function init() {
        createViewer();
        console.log('[ReportViewer] v1.0.0 ATIVO | Relatórios abrem inline no sistema');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
