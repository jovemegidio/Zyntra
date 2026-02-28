// ============================================================
// ALUFORCE PWA - Gerenciamento do Progressive Web App
// Versão: 2.0.0 - DESABILITADO
// ============================================================

(function() {
    'use strict';

    // PWA DESABILITADO - não registrar service worker nem mostrar prompts de instalação
    const PWA_DISABLED = true;
    
    if (PWA_DISABLED) {
        console.log('[PWA] PWA está desabilitado');
        return; // Sai imediatamente sem executar nada
    }

    const PWA_CONFIG = {
        swPath: '/sw.js',
        updateCheckInterval: 60000, // 1 minuto
        showInstallPrompt: false, // Desabilitado
        debug: false
    };

    // Variável para armazenar o evento de instalação
    let deferredPrompt = null;
    let swRegistration = null;

    // ============================================================
    // 1. REGISTRO DO SERVICE WORKER
    // ============================================================

    async function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            log('❌ Service Worker não suportado neste navegador');
            return null;
        }

        try {
            const registration = await navigator.serviceWorker.register(PWA_CONFIG.swPath, {
                scope: '/'
            });

            swRegistration = registration;
            log('✅ Service Worker registrado com sucesso');
            log('   Escopo:', registration.scope);

            // Verificar estado do SW
            if (registration.installing) {
                log('📦 Service Worker instalando...');
                trackInstallation(registration.installing);
            } else if (registration.waiting) {
                log('⏳ Nova versão disponível - aguardando ativação');
                showUpdateNotification();
            } else if (registration.active) {
                log('🟢 Service Worker ativo');
            }

            // Escutar por atualizações
            registration.addEventListener('updatefound', () => {
                log('🔄 Atualização do Service Worker encontrada');
                const newWorker = registration.installing;
                trackInstallation(newWorker);
            });

            // Verificar atualizações periodicamente
            setInterval(() => {
                registration.update();
            }, PWA_CONFIG.updateCheckInterval);

            return registration;

        } catch (error) {
            console.error('❌ Erro ao registrar Service Worker:', error);
            return null;
        }
    }

    function trackInstallation(worker) {
        worker.addEventListener('statechange', () => {
            log('   Estado do SW:', worker.state);
            
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                // Nova versão instalada, usuário deve atualizar
                showUpdateNotification();
            }
        });
    }

    // ============================================================
    // 2. PROMPT DE INSTALAÇÍO DO PWA
    // ============================================================

    function setupInstallPrompt() {
        // Capturar evento beforeinstallprompt
        window.addEventListener('beforeinstallprompt', (e) => {
            log('📲 Evento de instalação capturado');
            e.preventDefault();
            deferredPrompt = e;
            
            // Mostrar botão de instalação customizado
            if (PWA_CONFIG.showInstallPrompt) {
                showInstallButton();
            }
        });

        // Detectar quando o app foi instalado
        window.addEventListener('appinstalled', () => {
            log('✅ ALUFORCE instalado com sucesso!');
            deferredPrompt = null;
            hideInstallButton();
            
            // Analytics ou notificação
            showToast('ALUFORCE instalado com sucesso!', 'success');
        });
    }

    function showInstallButton() {
        // Verificar se já existe
        if (document.getElementById('pwa-install-btn')) return;

        const installBtn = document.createElement('button');
        installBtn.id = 'pwa-install-btn';
        installBtn.className = 'pwa-install-button';
        installBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Instalar App</span>
        `;
        installBtn.onclick = installPWA;
        
        // Adicionar estilos
        addInstallStyles();
        
        document.body.appendChild(installBtn);
        
        // Animar entrada
        setTimeout(() => {
            installBtn.classList.add('visible');
        }, 100);
    }

    function hideInstallButton() {
        const btn = document.getElementById('pwa-install-btn');
        if (btn) {
            btn.classList.remove('visible');
            setTimeout(() => btn.remove(), 300);
        }
    }

    async function installPWA() {
        if (!deferredPrompt) {
            log('⚠️ Prompt de instalação não disponível');
            return;
        }

        // Mostrar prompt nativo
        deferredPrompt.prompt();
        
        // Aguardar escolha do usuário
        const { outcome } = await deferredPrompt.userChoice;
        log('📱 Escolha do usuário:', outcome);
        
        deferredPrompt = null;
        hideInstallButton();
    }

    // Expor função globalmente
    window.installAluforce = installPWA;

    // ============================================================
    // 3. NOTIFICAÇÍO DE ATUALIZAÇÍO
    // ============================================================

    function showUpdateNotification() {
        // Verificar se já existe
        if (document.getElementById('pwa-update-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'pwa-update-banner';
        banner.className = 'pwa-update-banner';
        banner.innerHTML = `
            <div class="pwa-update-content">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 1 1-9-9"></path>
                    <polyline points="21 3 21 9 15 9"></polyline>
                </svg>
                <span>Nova versão disponível!</span>
            </div>
            <button class="pwa-update-btn" onclick="window.updateAluforce()">
                Atualizar
            </button>
            <button class="pwa-update-close" onclick="this.parentElement.remove()">
                ✕
            </button>
        `;
        
        document.body.appendChild(banner);
        
        // Animar entrada
        setTimeout(() => {
            banner.classList.add('visible');
        }, 100);
    }

    function updateServiceWorker() {
        if (swRegistration && swRegistration.waiting) {
            // Enviar mensagem para o SW ativar imediatamente
            swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        
        // Recarregar página
        window.location.reload();
    }

    // Expor globalmente
    window.updateAluforce = updateServiceWorker;

    // ============================================================
    // 4. DETECÇÍO DE MODO DE EXIBIÇÍO
    // ============================================================

    function detectDisplayMode() {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
        const isFullscreen = window.matchMedia('(display-mode: fullscreen)').matches;
        const isMinimalUI = window.matchMedia('(display-mode: minimal-ui)').matches;
        const isIOSStandalone = window.navigator.standalone === true;
        
        if (isStandalone || isFullscreen || isMinimalUI || isIOSStandalone) {
            log('📱 Executando como PWA instalado');
            document.body.classList.add('pwa-standalone');
            return 'standalone';
        } else {
            log('🌐 Executando no navegador');
            document.body.classList.add('pwa-browser');
            return 'browser';
        }
    }

    // ============================================================
    // 5. VERIFICAÇÍO DE CONECTIVIDADE
    // ============================================================

    function setupConnectivityCheck() {
        function updateOnlineStatus() {
            if (navigator.onLine) {
                document.body.classList.remove('pwa-offline');
                document.body.classList.add('pwa-online');
                hideOfflineBanner();
            } else {
                document.body.classList.remove('pwa-online');
                document.body.classList.add('pwa-offline');
                showOfflineBanner();
            }
        }

        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
        
        // Verificar estado inicial
        updateOnlineStatus();
    }

    function showOfflineBanner() {
        if (document.getElementById('pwa-offline-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'pwa-offline-banner';
        banner.className = 'pwa-offline-banner';
        banner.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                <line x1="12" y1="20" x2="12.01" y2="20"></line>
            </svg>
            <span>Você está offline - Algumas funcionalidades podem não estar disponíveis</span>
        `;
        
        document.body.appendChild(banner);
    }

    function hideOfflineBanner() {
        const banner = document.getElementById('pwa-offline-banner');
        if (banner) banner.remove();
    }

    // ============================================================
    // 6. ESTILOS DO PWA
    // ============================================================

    function addInstallStyles() {
        if (document.getElementById('pwa-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'pwa-styles';
        styles.textContent = `
            /* Botão de Instalação */
            .pwa-install-button {
                position: fixed;
                bottom: 20px;
                right: 20px;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 12px 20px;
                background: linear-gradient(135deg, #1a2744, #2d4a7c);
                color: white;
                border: none;
                border-radius: 50px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 600;
                font-family: inherit;
                box-shadow: 0 4px 15px rgba(26, 39, 68, 0.4);
                transform: translateY(100px);
                opacity: 0;
                transition: all 0.3s ease;
                z-index: 9999;
            }
            
            .pwa-install-button.visible {
                transform: translateY(0);
                opacity: 1;
            }
            
            .pwa-install-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(26, 39, 68, 0.5);
            }
            
            .pwa-install-button:active {
                transform: translateY(0);
            }

            /* Banner de Atualização */
            .pwa-update-banner {
                position: fixed;
                top: -60px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                background: linear-gradient(135deg, #1a2744, #2d4a7c);
                color: white;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                transition: top 0.4s ease;
                z-index: 10000;
                font-size: 14px;
            }
            
            .pwa-update-banner.visible {
                top: 20px;
            }
            
            .pwa-update-content {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .pwa-update-btn {
                padding: 8px 16px;
                background: white;
                color: #1a2744;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                font-size: 13px;
                transition: all 0.2s;
            }
            
            .pwa-update-btn:hover {
                background: #f0f0f0;
            }
            
            .pwa-update-close {
                padding: 4px 8px;
                background: transparent;
                border: none;
                color: rgba(255, 255, 255, 0.7);
                cursor: pointer;
                font-size: 16px;
            }
            
            .pwa-update-close:hover {
                color: white;
            }

            /* Banner Offline */
            .pwa-offline-banner {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                padding: 12px;
                background: #ef4444;
                color: white;
                font-size: 14px;
                z-index: 9998;
            }

            /* Ajustes para modo standalone (PWA instalado) */
            .pwa-standalone {
                /* Safe area para notch em iPhones */
                padding-top: env(safe-area-inset-top);
                padding-bottom: env(safe-area-inset-bottom);
                padding-left: env(safe-area-inset-left);
                padding-right: env(safe-area-inset-right);
            }

            /* Hide install button em PWA instalado */
            .pwa-standalone .pwa-install-button {
                display: none !important;
            }

            /* Responsivo - Mobile */
            @media (max-width: 480px) {
                .pwa-install-button {
                    bottom: 80px;
                    right: 16px;
                    padding: 10px 16px;
                    font-size: 13px;
                }
                
                .pwa-update-banner {
                    left: 10px;
                    right: 10px;
                    transform: none;
                    flex-wrap: wrap;
                    justify-content: center;
                }
            }
        `;
        
        document.head.appendChild(styles);
    }

    // ============================================================
    // 7. UTILIDADES
    // ============================================================

    function log(...args) {
        if (PWA_CONFIG.debug || window.location.hostname === 'localhost') {
            console.log('[PWA]', ...args);
        }
    }

    function showToast(message, type = 'info') {
        // Usar sistema de toast existente se disponível
        if (window.showToast) {
            window.showToast(message, type);
        } else if (window.Toastify) {
            Toastify({
                text: message,
                duration: 3000,
                gravity: "bottom",
                position: "center",
                style: {
                    background: type === 'success' ? '#10b981' : '#3b82f6'
                }
            }).showToast();
        } else {
            console.log('Toast:', message);
        }
    }

    // ============================================================
    // 8. INICIALIZAÇÍO
    // ============================================================

    function init() {
        log('🚀 Inicializando PWA...');
        
        // Adicionar estilos
        addInstallStyles();
        
        // Registrar Service Worker
        registerServiceWorker();
        
        // Configurar prompt de instalação
        setupInstallPrompt();
        
        // Detectar modo de exibição
        const displayMode = detectDisplayMode();
        log('📺 Modo de exibição:', displayMode);
        
        // Configurar verificação de conectividade
        setupConnectivityCheck();
        
        log('✅ PWA inicializado');
    }

    // Iniciar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Escutar mensagens do Service Worker
    navigator.serviceWorker?.addEventListener('message', (event) => {
        log('📩 Mensagem do SW:', event.data);
    });

    // Escutar mudanças de controlador
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
        log('🔄 Controlador do SW mudou - recarregando...');
        window.location.reload();
    });

})();
