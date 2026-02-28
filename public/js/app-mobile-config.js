/**
 * ALUFORCE - Configuração do App Mobile
 *
 * Este arquivo gerencia a conexão do app Android com o servidor.
 * Importar este script em todas as páginas HTML do sistema.
 * 
 * CORREÇÃO 06/02/2026: Corrigido interceptor de fetch que causava erro 500 no login
 * - Não muta mais o objeto options original
 * - Não sobrescreve signals existentes
 * - Só adiciona headers padrão em chamadas de API (não em GETs de arquivos estáticos)
 * - Retry agora também tem timeout
 * - URL de produção corrigida
 */

(function() {
    'use strict';

    // ============================================
    // CONFIGURAÇÃO DO SERVIDOR
    // ============================================
    const APP_CONFIG = {
        serverMode: 'auto',

        servers: {
            local: 'http://192.168.68.133:3000',
            production: 'https://aluforce.api.br',
            fallback: window.location.origin
        },

        // Timeout para requisições (ms)
        requestTimeout: 30000,

        // Retry automático em caso de falha
        autoRetry: true,
        retryAttempts: 3,
        retryDelay: 2000
    };

    // Detecta se está rodando no Capacitor (app nativo)
    function isCapacitorApp() {
        return window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    }

    // Detecta se está em ambiente de desenvolvimento
    function isDevelopment() {
        return window.location.hostname === 'localhost' ||
               window.location.hostname === '127.0.0.1' ||
               window.location.hostname.startsWith('192.168');
    }

    // Obtém a URL base do servidor
    function getServerUrl() {
        if (APP_CONFIG.serverMode === 'local') {
            return APP_CONFIG.servers.local;
        }

        if (APP_CONFIG.serverMode === 'production') {
            return APP_CONFIG.servers.production;
        }

        // Modo auto
        if (isCapacitorApp()) {
            // No app nativo, usar servidor de produção como base
            return APP_CONFIG.servers.production;
        }

        // No browser, usa a origem atual (mesmo domínio)
        return window.location.origin;
    }

    // ============================================
    // INTERCEPTOR DE FETCH - APENAS PARA CAPACITOR
    // ============================================
    // SÓ intercepta fetch quando rodando no app Capacitor.
    // No browser normal, o fetch nativo funciona sem problemas.
    // Isso evita interferência com o login e outros fluxos do browser.
    // ============================================

    if (isCapacitorApp()) {
        const originalFetch = window.fetch;

        window.fetch = async function(url, options) {
            // Cria cópia das options para NÃO mutar o objeto original
            const opts = Object.assign({}, options);
            let finalUrl = url;

            // Se a URL é relativa, prepende a URL base do servidor
            if (typeof url === 'string' && url.startsWith('/')) {
                const baseUrl = getServerUrl();
                if (baseUrl) {
                    finalUrl = baseUrl + url;
                }
            }

            // Adiciona headers padrão apenas para chamadas de API
            if (typeof url === 'string' && url.includes('/api/')) {
                const existingHeaders = opts.headers || {};
                // Preserva headers existentes, só adiciona defaults se não existirem
                opts.headers = Object.assign(
                    { 'Accept': 'application/json' },
                    existingHeaders
                );
            }

            // Adiciona timeout via AbortController
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), APP_CONFIG.requestTimeout);

            // Se o chamador já passou um signal, combina com o nosso
            if (opts.signal) {
                const userSignal = opts.signal;
                // Se o signal do usuário já está abortado, não faz a requisição
                if (userSignal.aborted) {
                    clearTimeout(timeoutId);
                    throw new DOMException('The user aborted a request.', 'AbortError');
                }
                // Aborta nosso controller se o signal do usuário abortar
                userSignal.addEventListener('abort', () => controller.abort(), { once: true });
            }
            opts.signal = controller.signal;

            try {
                const response = await originalFetch(finalUrl, opts);
                clearTimeout(timeoutId);
                return response;
            } catch (error) {
                clearTimeout(timeoutId);

                // Retry automático apenas para timeout (AbortError)
                if (APP_CONFIG.autoRetry && error.name === 'AbortError') {
                    console.warn('[ALUFORCE] Timeout na requisição, tentando novamente...', finalUrl);
                    return retryFetch(originalFetch, finalUrl, options, 1);
                }

                throw error;
            }
        };

        // Função de retry com timeout próprio
        async function retryFetch(originalFetch, url, options, attempt) {
            if (attempt > APP_CONFIG.retryAttempts) {
                throw new Error('Falha após ' + APP_CONFIG.retryAttempts + ' tentativas');
            }

            await new Promise(resolve => setTimeout(resolve, APP_CONFIG.retryDelay));

            // Cria novo AbortController para o retry (com timeout)
            const retryController = new AbortController();
            const retryTimeout = setTimeout(() => retryController.abort(), APP_CONFIG.requestTimeout);
            const retryOpts = Object.assign({}, options, { signal: retryController.signal });

            try {
                const response = await originalFetch(url, retryOpts);
                clearTimeout(retryTimeout);
                return response;
            } catch (error) {
                clearTimeout(retryTimeout);

                // Se deu timeout de novo, tenta o próximo retry
                if (error.name === 'AbortError') {
                    return retryFetch(originalFetch, url, options, attempt + 1);
                }
                throw error;
            }
        }
    }

    // Handler de conectividade
    function setupConnectivityHandler() {
        if (!isCapacitorApp()) return;

        window.addEventListener('online', () => {
            console.log('[ALUFORCE] Conexão restabelecida');
            showToast('Conexão restabelecida', 'success');
        });

        window.addEventListener('offline', () => {
            console.log('[ALUFORCE] Sem conexão');
            showToast('Sem conexão com a internet', 'warning');
        });
    }

    // Toast notification simples
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `app-toast app-toast-${type}`;
        toast.innerHTML = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 24px;
            border-radius: 8px;
            background: ${type === 'success' ? '#10b981' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
            color: white;
            font-size: 14px;
            font-weight: 500;
            z-index: 99999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: toastSlideUp 0.3s ease;
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toastSlideDown 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Adiciona estilos de animação
    function addAnimationStyles() {
        if (document.getElementById('app-mobile-styles')) return;

        const style = document.createElement('style');
        style.id = 'app-mobile-styles';
        style.textContent = `
            @keyframes toastSlideUp {
                from { transform: translateX(-50%) translateY(100px); opacity: 0; }
                to { transform: translateX(-50%) translateY(0); opacity: 1; }
            }
            @keyframes toastSlideDown {
                from { transform: translateX(-50%) translateY(0); opacity: 1; }
                to { transform: translateX(-50%) translateY(100px); opacity: 0; }
            }

            /* Ajustes mobile para o app */
            @media (max-width: 768px) {
                .capacitor-app .sidebar {
                    transform: translateX(-100%);
                    transition: transform 0.3s ease;
                }
                .capacitor-app .sidebar.open {
                    transform: translateX(0);
                }
                .capacitor-app .main-content {
                    margin-left: 0 !important;
                    padding-bottom: 70px;
                }
            }

            /* Safe area para notch e barra de navegação */
            .capacitor-app {
                padding-top: env(safe-area-inset-top);
                padding-bottom: env(safe-area-inset-bottom);
                padding-left: env(safe-area-inset-left);
                padding-right: env(safe-area-inset-right);
            }
        `;
        document.head.appendChild(style);
    }

    // Handler do botão voltar no Android
    function setupBackButtonHandler() {
        if (!isCapacitorApp()) return;

        document.addEventListener('backbutton', (e) => {
            e.preventDefault();

            // Se há modal aberto, fecha
            const modal = document.querySelector('.modal.show, .modal[style*="display: block"]');
            if (modal) {
                const closeBtn = modal.querySelector('[data-dismiss="modal"], .btn-close, .close');
                if (closeBtn) closeBtn.click();
                return;
            }

            // Se a sidebar está aberta, fecha
            const sidebar = document.querySelector('.sidebar.open');
            if (sidebar) {
                sidebar.classList.remove('open');
                return;
            }

            // Se não está na página inicial, volta
            if (window.history.length > 1) {
                window.history.back();
            } else {
                // Confirma saída do app
                if (confirm('Deseja sair do ALUFORCE?')) {
                    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
                        window.Capacitor.Plugins.App.exitApp();
                    }
                }
            }
        });
    }

    // Inicialização
    function init() {
        console.log('[ALUFORCE] Inicializando app mobile...');
        console.log('[ALUFORCE] Capacitor:', isCapacitorApp() ? 'Sim' : 'Não');
        console.log('[ALUFORCE] Servidor:', getServerUrl() || 'Local');

        // Marca o body quando está no app
        if (isCapacitorApp()) {
            document.body.classList.add('capacitor-app');
        }

        addAnimationStyles();
        setupConnectivityHandler();
        setupBackButtonHandler();

        // Esconde splash screen quando página carregar
        if (isCapacitorApp() && window.Capacitor.Plugins && window.Capacitor.Plugins.SplashScreen) {
            window.addEventListener('load', () => {
                setTimeout(() => {
                    window.Capacitor.Plugins.SplashScreen.hide();
                }, 500);
            });
        }
    }

    // Expõe configuração globalmente
    window.ALUFORCE_APP = {
        config: APP_CONFIG,
        isCapacitorApp: isCapacitorApp,
        isDevelopment: isDevelopment,
        getServerUrl: getServerUrl,
        showToast: showToast
    };

    // Inicializa quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
