/**
 * 🔌 SISTEMA DE MONITORAMENTO DE CONEXÍO
 * Monitora a conexão com o servidor e exibe popup quando há instabilidade
 *
 * @author Sistema Aluforce v2.0
 * @date 23/12/2025
 *
 * CONFIGURAÇÕES:
 * - PING_INTERVAL: Intervalo entre verificações (padrão: 10 segundos)
 * - MAX_FAILURES: Número de falhas consecutivas antes de mostrar popup (padrão: 3)
 * - PING_TIMEOUT: Tempo máximo de espera por resposta (padrão: 5 segundos)
 */

(function() {
    'use strict';

    // ==========================================
    // CONFIGURAÇÕES
    // ==========================================
    const CONFIG = {
        PING_INTERVAL: 10000,        // 10 segundos entre verificações
        MAX_FAILURES: 3,             // 3 falhas consecutivas = popup
        PING_TIMEOUT: 5000,          // 5 segundos de timeout
        RECONNECT_DELAY: 2000,       // 2 segundos entre tentativas de reconexão
        PING_ENDPOINT: '/api/health' // Endpoint para verificar saúde do servidor
    };

    // ==========================================
    // VARIÁVEIS GLOBAIS
    // ==========================================
    let consecutiveFailures = 0;
    let pingInterval = null;
    let isPopupShown = false;
    let isReconnecting = false;

    // ==========================================
    // CRIAR POPUP DE DESCONEXÍO (Estilo da imagem)
    // ==========================================
    function createDisconnectionModal() {
        // Verificar se já existe
        if (document.getElementById('connection-lost-modal')) {
            return;
        }

        const modalHTML = `
            <div id="connection-lost-modal" style="
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                z-index: 9999999;
                justify-content: center;
                align-items: center;
                animation: connectionFadeIn 0.3s ease-in-out;
            ">
                <style>
                    @keyframes connectionFadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    @keyframes connectionSlideIn {
                        from {
                            opacity: 0;
                            transform: translateY(-20px) scale(0.95);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                        }
                    }
                    @keyframes connectionPulse {
                        0%, 100% { transform: scale(1); }
                        50% { transform: scale(1.05); }
                    }
                    @keyframes connectionSpin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                    #connection-lost-modal .reconnect-btn:hover {
                        background: #5a6875 !important;
                        transform: translateY(-1px);
                        box-shadow: 0 4px 12px rgba(108, 117, 125, 0.3);
                    }
                    #connection-lost-modal .reconnect-btn:active {
                        transform: translateY(0);
                    }
                    #connection-lost-modal .reconnect-btn.loading {
                        pointer-events: none;
                        opacity: 0.8;
                    }
                </style>
                <div style="
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
                    max-width: 420px;
                    width: 90%;
                    animation: connectionSlideIn 0.3s ease-out;
                    overflow: hidden;
                    text-align: center;
                ">
                    <!-- Body -->
                    <div style="padding: 40px 32px 32px 32px;">
                        <!-- Ícone de Alerta -->
                        <div style="
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            width: 56px;
                            height: 56px;
                            background: #fff3e0;
                            border-radius: 50%;
                            margin-bottom: 20px;
                        ">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e65100" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            </svg>
                        </div>

                        <!-- Mensagem Principal -->
                        <p style="
                            font-size: 16px;
                            color: #374151;
                            margin: 0 0 28px 0;
                            line-height: 1.6;
                            font-weight: 400;
                        ">
                            A conexão com o servidor foi encerrada e seu aplicativo precisa ser reiniciado.
                        </p>

                        <!-- Botão Reconectar -->
                        <button id="connection-reconnect-btn" class="reconnect-btn" style="
                            background: #6c757d;
                            color: white;
                            border: none;
                            padding: 12px 28px;
                            border-radius: 6px;
                            font-size: 14px;
                            font-weight: 500;
                            cursor: pointer;
                            transition: all 0.2s ease;
                            display: inline-flex;
                            align-items: center;
                            gap: 8px;
                            min-width: 130px;
                            justify-content: center;
                        ">
                            <span id="reconnect-btn-text">Reconectar</span>
                            <span id="reconnect-btn-spinner" style="display: none;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: connectionSpin 1s linear infinite;">
                                    <circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle>
                                </svg>
                            </span>
                        </button>

                        <!-- Status de reconexão -->
                        <div id="reconnect-status" style="
                            margin-top: 16px;
                            font-size: 13px;
                            color: #6b7280;
                            min-height: 20px;
                        "></div>
                    </div>
                </div>
            </div>
        `;

        // Inserir no body
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Adicionar evento ao botão de reconectar
        const reconnectBtn = document.getElementById('connection-reconnect-btn');
        if (reconnectBtn) {
            reconnectBtn.addEventListener('click', handleReconnect);
        }
    }

    // ==========================================
    // MOSTRAR POPUP
    // ==========================================
    function showDisconnectionPopup() {
        if (isPopupShown) return;

        createDisconnectionModal();
        const modal = document.getElementById('connection-lost-modal');
        if (modal) {
            modal.style.display = 'flex';
            isPopupShown = true;

            // Parar o ping enquanto o popup está aberto
            stopPing();

            console.warn('🔴 Conexão perdida - Popup exibido');
        }
    }

    // ==========================================
    // ESCONDER POPUP
    // ==========================================
    function hideDisconnectionPopup() {
        const modal = document.getElementById('connection-lost-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        isPopupShown = false;
        isReconnecting = false;
        resetReconnectButton();
    }

    // ==========================================
    // RESETAR BOTÍO DE RECONECTAR
    // ==========================================
    function resetReconnectButton() {
        const btn = document.getElementById('connection-reconnect-btn');
        const text = document.getElementById('reconnect-btn-text');
        const spinner = document.getElementById('reconnect-btn-spinner');
        const status = document.getElementById('reconnect-status');

        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
        if (text) text.textContent = 'Reconectar';
        if (spinner) spinner.style.display = 'none';
        if (status) status.textContent = '';
    }

    // ==========================================
    // TRATAR RECONEXÍO
    // ==========================================
    async function handleReconnect() {
        if (isReconnecting) return;
        isReconnecting = true;

        const btn = document.getElementById('connection-reconnect-btn');
        const text = document.getElementById('reconnect-btn-text');
        const spinner = document.getElementById('reconnect-btn-spinner');
        const status = document.getElementById('reconnect-status');

        // Mostrar estado de loading
        if (btn) {
            btn.classList.add('loading');
            btn.disabled = true;
        }
        if (text) text.textContent = 'Reconectando...';
        if (spinner) spinner.style.display = 'inline';
        if (status) status.textContent = 'Verificando conexão com o servidor...';

        try {
            // Tentar reconectar
            const isConnected = await checkConnection();

            if (isConnected) {
                if (status) status.textContent = '✅ Conexão restaurada! Recarregando...';

                // Aguardar um pouco e recarregar a página
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                if (status) status.textContent = '❌ Servidor indisponível. Tente novamente.';
                resetReconnectButton();
                isReconnecting = false;
            }
        } catch (error) {
            console.error('Erro ao reconectar:', error);
            if (status) status.textContent = '❌ Erro ao conectar. Tente novamente.';
            resetReconnectButton();
            isReconnecting = false;
        }
    }

    // ==========================================
    // VERIFICAR CONEXÍO
    // ==========================================
    async function checkConnection() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.PING_TIMEOUT);

            // Tentar múltiplos endpoints
            const endpoints = [
                CONFIG.PING_ENDPOINT,
                '/api/auth/check',
                '/api/usuarios/profile',
                '/' // Fallback para a página principal
            ];

            for (const endpoint of endpoints) {
                try {
                    const response = await fetch(endpoint, {
                        method: 'GET',
                        signal: controller.signal,
                        cache: 'no-store',
                        headers: {
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        }
                    });

                    clearTimeout(timeoutId);

                    if (response.ok || response.status === 401 || response.status === 403 || response.status === 429) {
                        // Se receber qualquer resposta válida (mesmo 401/403/429), o servidor está vivo
                        // 429 = rate limit, mas servidor respondeu — não é falha de conexão
                        return true;
                    }
                } catch (e) {
                    // Continuar para o próximo endpoint
                    continue;
                }
            }

            clearTimeout(timeoutId);
            return false;
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('⏱️ Timeout na verificação de conexão');
            }
            return false;
        }
    }

    // ==========================================
    // REALIZAR PING
    // ==========================================
    async function doPing() {
        const isConnected = await checkConnection();

        if (isConnected) {
            // Conexão OK - resetar contador de falhas
            if (consecutiveFailures > 0) {
                console.log('✅ Conexão restaurada após', consecutiveFailures, 'falhas');
            }
            consecutiveFailures = 0;

            // Se o popup estava aberto, fechar
            if (isPopupShown) {
                hideDisconnectionPopup();
                startPing(); // Reiniciar monitoramento
            }
        } else {
            // Falha na conexão
            consecutiveFailures++;
            console.warn(`⚠️ Falha de conexão ${consecutiveFailures}/${CONFIG.MAX_FAILURES}`);

            if (consecutiveFailures >= CONFIG.MAX_FAILURES) {
                showDisconnectionPopup();
            }
        }
    }

    // ==========================================
    // INICIAR MONITORAMENTO
    // ==========================================
    function startPing() {
        if (pingInterval) {
            clearInterval(pingInterval);
        }

        // Fazer uma verificação inicial após um pequeno delay
        setTimeout(doPing, 3000);

        // Configurar intervalo de verificação
        pingInterval = setInterval(doPing, CONFIG.PING_INTERVAL);
        console.log('🔍 Monitoramento de conexão iniciado');
    }

    // ==========================================
    // PARAR MONITORAMENTO
    // ==========================================
    function stopPing() {
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
    }

    // ==========================================
    // DETECTAR MUDANÇAS DE ESTADO DE REDE
    // ==========================================
    function setupNetworkListeners() {
        // Quando a rede cair
        window.addEventListener('offline', () => {
            console.warn('📴 Rede offline detectada');
            consecutiveFailures = CONFIG.MAX_FAILURES;
            showDisconnectionPopup();
        });

        // Quando a rede voltar
        window.addEventListener('online', () => {
            console.log('📶 Rede online detectada');
            // Tentar reconectar automaticamente
            doPing();
        });
    }

    // ==========================================
    // DETECTAR ERROS DE FETCH GLOBAIS
    // ==========================================
    function setupFetchErrorHandler() {
        // Interceptar erros de fetch para detectar problemas de conexão
        // E automaticamente adicionar token de autenticação
        const originalFetch = window.fetch;

        window.fetch = async function(url, options = {}) {
            // Adicionar token de autenticação automaticamente para rotas /api/
            if (typeof url === 'string' && url.includes('/api/')) {
                const authToken = localStorage.getItem('authToken') || localStorage.getItem('token');
                if (authToken && authToken !== 'null' && authToken !== 'undefined') {
                    options.headers = options.headers || {};
                    // Não sobrescrever se já existe Authorization
                    if (!options.headers['Authorization'] && !options.headers['authorization']) {
                        options.headers['Authorization'] = `Bearer ${authToken}`;
                    }
                }
                // Garantir credentials: include para enviar cookies
                if (!options.credentials) {
                    options.credentials = 'include';
                }

                // CSRF: enviar token em requisições de escrita (POST/PUT/DELETE/PATCH)
                const method = (options.method || 'GET').toUpperCase();
                if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
                    options.headers = options.headers || {};
                    if (!options.headers['X-CSRF-Token'] && !options.headers['x-csrf-token']) {
                        // Ler token do cookie csrf_token
                        const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
                        if (csrfMatch) {
                            options.headers['X-CSRF-Token'] = decodeURIComponent(csrfMatch[1]);
                        }
                    }
                }
            }

            try {
                const response = await originalFetch.apply(this, [url, options]);

                // Se o servidor respondeu (qualquer status), resetar contador de falhas de conexão
                // 401/403 = servidor vivo, apenas sem permissão
                // 500/502 = servidor vivo, mas com erro interno
                if (response.status > 0) {
                    consecutiveFailures = 0;
                }

                return response;
            } catch (error) {
                // Verificar se é um erro de rede
                if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                    consecutiveFailures++;
                    console.warn(`⚠️ Erro de fetch detectado ${consecutiveFailures}/${CONFIG.MAX_FAILURES}`);

                    if (consecutiveFailures >= CONFIG.MAX_FAILURES && !isPopupShown) {
                        showDisconnectionPopup();
                    }
                }
                throw error;
            }
        };
    }

    // ==========================================
    // INICIALIZAÇÍO
    // ==========================================
    function init() {
        // Não executar em páginas de login
        if (window.location.pathname.includes('login')) {
            return;
        }

        console.log('🔌 Iniciando monitor de conexão...');

        // Criar modal
        createDisconnectionModal();

        // Configurar listeners de rede
        setupNetworkListeners();

        // Configurar interceptação de fetch
        setupFetchErrorHandler();

        // Iniciar ping
        startPing();

        // Expor funções para debug
        window.ConnectionMonitor = {
            checkConnection,
            showPopup: showDisconnectionPopup,
            hidePopup: hideDisconnectionPopup,
            getStatus: () => ({
                consecutiveFailures,
                isPopupShown,
                isReconnecting
            })
        };
    }

    // ==========================================
    // AUTO-INICIALIZAÇÍO
    // ==========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // DOM já carregado, aguardar um momento
        setTimeout(init, 500);
    }

})();
