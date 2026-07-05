// auth-unified.js - Sistema de autenticação unificado para todos os módulos ALUFORCE
// VERSAO 7.6 - ISOLAMENTO POR ABA + VALIDACAO VIA SERVIDOR + RESILIENCIA
// FIX v7.0: Resolve o problema de "espelhamento" onde o login de outro usuário em outra aba
//      sobrescreve a sessão da aba atual via localStorage/cookie compartilhados.
// FIX v7.1: NÃO copia mais token/userData de localStorage para sessionStorage em novas abas.
// FIX v7.2: Em novas abas, consulta o SERVIDOR via cookie antes de redirecionar para login.
//      Isso permite abrir módulos em novas abas sem forçar re-login, mantendo segurança.
// FIX v7.4: Remove lsToken undefined, injeta credentials:'include', trata 503,
//      exige 3 falhas consecutivas no check periódico antes de redirecionar.
// FIX v7.5: AUTH_INACTIVE retorna Response sintética (evita 401 no caller), 503 retry
//      sem signal abortado, proactive refresh usa config centralizada.
// FIX v7.6: 502/504 entram no mesmo caminho resiliente de retry/fallback.

// =============================================================================
// 🚦 DEDUP DE /api/me — fix F6 (14/jun/2026)
// Vários scripts (layout, header, perfil, kpis, sidebar...) chamam GET /api/me
// de forma independente — observado 8+ requisições por carregamento de página.
// Este interceptor envolve window.fetch APENAS para GET /api/me: requisições
// concorrentes compartilham a mesma promise e o resultado é cacheado por uma
// janela curta. Qualquer outra URL/método passa direto pelo fetch nativo, e
// qualquer erro inesperado degrada para o fetch nativo (sem regressão de auth).
// =============================================================================
;(function dedupMeFetch() {
    try {
        if (typeof window === 'undefined' || !window.fetch || window.__meDedupInstalled) return;
        window.__meDedupInstalled = true;
        var nativeFetch = window.fetch.bind(window);
        var TTL_MS = 2500;
        var cachedResponse = null;
        var cachedAt = 0;
        var inflight = null;

        function isMeGet(input, init) {
            try {
                var url = typeof input === 'string' ? input : (input && input.url) || '';
                var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
                return method === 'GET' && /(^|\/)api\/me(\?|#|$)/.test(url);
            } catch (e) { return false; }
        }

        window.fetch = function (input, init) {
            if (!isMeGet(input, init)) return nativeFetch(input, init);
            try {
                var now = Date.now();
                if (cachedResponse && (now - cachedAt) < TTL_MS) {
                    return Promise.resolve(cachedResponse.clone());
                }
                if (inflight) return inflight.then(function (r) { return r.clone(); });
                inflight = nativeFetch(input, init).then(function (r) {
                    cachedResponse = r; cachedAt = Date.now(); inflight = null;
                    return r;
                }, function (err) {
                    inflight = null; throw err;
                });
                return inflight.then(function (r) { return r.clone(); });
            } catch (e) {
                return nativeFetch(input, init);
            }
        };
    } catch (e) { /* fetch indisponível: nada a fazer */ }
})();

// =============================================================================
// ANTI-FOUC: restaurar somente header/sidebar escuros.
// Não aplica `dark-mode` no body para não alterar o conteúdo das páginas.
// =============================================================================
;(function antiFlashRestore() {
    try {
        var legacyDark = localStorage.getItem('darkMode') === '1';
        if (legacyDark && localStorage.getItem('a11yDarkMode') == null) {
            localStorage.setItem('a11yDarkMode', '1');
        }
        if (legacyDark) {
            localStorage.removeItem('darkMode');
        }
        if (localStorage.getItem('a11yDarkMode') === '1') {
            document.documentElement.classList.add('a11y-dark-mode');
        }
    } catch (e) { /* localStorage indisponivel */ }
})();

// =============================================================================
// 🧹 FRONTEND POLISH: corrige mojibake visível e padroniza modais básicos
// =============================================================================
;(function frontendPolish() {
    const suspiciousPattern = /(Ã.|Â.|â.|ðŸ)/;
    const modalSelector = '.modal-overlay, .modal, [role="dialog"]';
    const registeredModals = new WeakSet();
    const modalState = new WeakMap();

    function mojibakeScore(value) {
        const matches = String(value || '').match(/(?:Ã.|Â.|â.|ðŸ)/g);
        return matches ? matches.length : 0;
    }

    function repairMojibake(value) {
        if (!value || !suspiciousPattern.test(value)) return value;
        let current = value;

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const bytes = Uint8Array.from(Array.from(current), (char) => char.charCodeAt(0) & 0xff);
                const candidate = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                if (!candidate || mojibakeScore(candidate) >= mojibakeScore(current)) break;
                current = candidate;
            } catch (e) {
                break;
            }
        }

        return current;
    }

    function normalizeTextNode(node) {
        if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement) return;
        if (node.parentElement.closest('script, style, textarea, pre, code')) return;

        const fixedValue = repairMojibake(node.nodeValue);
        if (fixedValue !== node.nodeValue) {
            node.nodeValue = fixedValue;
        }
    }

    function normalizeAttributes(element) {
        if (!(element instanceof Element)) return;

        ['placeholder', 'title', 'aria-label', 'alt'].forEach((attributeName) => {
            const value = element.getAttribute(attributeName);
            if (!value) return;

            const fixedValue = repairMojibake(value);
            if (fixedValue !== value) {
                element.setAttribute(attributeName, fixedValue);
            }
        });
    }

    function normalizeTree(root) {
        if (!root) return;

        if (root.nodeType === Node.TEXT_NODE) {
            normalizeTextNode(root);
            return;
        }

        if (root instanceof Element) {
            normalizeAttributes(root);
        }

        if (root.childNodes) {
            root.childNodes.forEach((childNode) => normalizeTree(childNode));
        }
    }

    function isModalOpen(modal) {
        if (!(modal instanceof Element)) return false;
        if (modal.hasAttribute('hidden') || modal.getAttribute('aria-hidden') === 'true') return false;
        if (modal.classList.contains('show') || modal.classList.contains('active') || modal.classList.contains('open')) return true;

        const styles = window.getComputedStyle(modal);
        const rect = modal.getBoundingClientRect();
        return styles.display !== 'none' && styles.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    function syncBodyOverflow() {
        if (!document.body) return;
        const hasOpenModal = Array.from(document.querySelectorAll(modalSelector)).some((modal) => isModalOpen(modal));
        document.body.style.overflow = hasOpenModal ? 'hidden' : '';
    }

    function getFocusableElement(modal) {
        return modal.querySelector('[autofocus], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
    }

    function syncModalState(modal, force = false) {
        if (!(modal instanceof Element)) return;
        if (!modal.matches(modalSelector)) return;

        const state = modalState.get(modal) || {};
        const isOpen = isModalOpen(modal);
        if (!force && state.isOpen === isOpen) return;

        state.isOpen = isOpen;
        modalState.set(modal, state);

        if (isOpen) {
            if (!modal.hasAttribute('role')) modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.removeAttribute('aria-hidden');

            if (!state.previousFocus && document.activeElement instanceof HTMLElement) {
                state.previousFocus = document.activeElement;
            }

            syncBodyOverflow();

            window.requestAnimationFrame(() => {
                if (!isModalOpen(modal)) return;
                const target = getFocusableElement(modal) || modal;
                if (typeof target.focus === 'function') {
                    target.focus({ preventScroll: true });
                }
            });
            return;
        }

        modal.setAttribute('aria-hidden', 'true');
        syncBodyOverflow();

        if (state.previousFocus && document.contains(state.previousFocus) && typeof state.previousFocus.focus === 'function') {
            state.previousFocus.focus({ preventScroll: true });
        }
        state.previousFocus = null;
    }

    function closeModal(modal) {
        if (!(modal instanceof Element)) return;
        modal.classList.remove('show', 'active', 'open');
        if (modal.style.display && modal.style.display !== 'none') {
            modal.style.display = 'none';
        }
        syncModalState(modal, true);
    }

    function registerModal(modal) {
        if (!(modal instanceof Element) || registeredModals.has(modal)) return;

        registeredModals.add(modal);
        if (!modal.hasAttribute('role')) modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeModal(modal);
            }
        });

        modal.querySelectorAll('.modal-close, [data-close-modal], [data-dismiss="modal"]').forEach((button) => {
            button.addEventListener('click', () => closeModal(modal));
        });

        syncModalState(modal, true);
    }

    function enhanceModalTree(root) {
        if (!root) return;

        if (root instanceof Element && root.matches(modalSelector)) {
            registerModal(root);
        }

        if (root.querySelectorAll) {
            root.querySelectorAll(modalSelector).forEach((modal) => registerModal(modal));
        }

        document.querySelectorAll(modalSelector).forEach((modal) => syncModalState(modal));
    }

    function refreshUi(root = document.body || document.documentElement) {
        normalizeTree(root);
        enhanceModalTree(root);
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        const openModals = Array.from(document.querySelectorAll(modalSelector)).filter((modal) => isModalOpen(modal));
        const lastOpenModal = openModals[openModals.length - 1];
        if (lastOpenModal) {
            closeModal(lastOpenModal);
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => refreshUi(), { once: true });
    } else {
        refreshUi();
    }

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'characterData') {
                normalizeTextNode(mutation.target);
                return;
            }

            if (mutation.type === 'attributes' && mutation.target instanceof Element) {
                normalizeAttributes(mutation.target);
                syncModalState(mutation.target);
                return;
            }

            mutation.addedNodes.forEach((node) => {
                refreshUi(node);
            });
        });
    });

    observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'placeholder', 'title', 'aria-label', 'alt']
    });

    window.ZyntraUI = Object.assign(window.ZyntraUI || {}, {
        closeModal,
        refreshUi
    });
})();

// =============================================================================
// 🔒 STORAGE ISOLATOR - Deve rodar ANTES de qualquer outro código
// Intercepta localStorage.getItem para chaves de autenticação
// Retorna valores do sessionStorage (isolado por aba) quando disponíveis
// =============================================================================
(function StorageIsolator() {
    if (window.__storageIsolatorInitialized) return;
    window.__storageIsolatorInitialized = true;
    try {
        var _origGet = Storage.prototype.getItem;
        var _authKeyMap = {
            'userData': 'tabUserData',
            'user_data': 'tabUserData',
            'authToken': 'tabAuthToken',
            'token': 'tabAuthToken'
        };
        Storage.prototype.getItem = function (key) {
            // Só interceptar chamadas ao localStorage, não ao sessionStorage
            if (this === window.localStorage && _authKeyMap[key]) {
                var sessionVal = _origGet.call(window.sessionStorage, _authKeyMap[key]);
                if (sessionVal && sessionVal !== 'null' && sessionVal !== 'undefined') {
                    return sessionVal;
                }
            }
            return _origGet.call(this, key);
        };
        // Também interceptar setItem para SEMPRE manter sessionStorage sincronizado
        var _origSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            _origSet.call(this, key, value);
            // Quando qualquer código salva no localStorage, espelhar no sessionStorage
            if (this === window.localStorage && _authKeyMap[key] && value) {
                try { _origSet.call(window.sessionStorage, _authKeyMap[key], value); } catch (e) { }
            }
        };
        console.log('🔒 Storage Isolator v1.0 ativo - localStorage interceptado para isolamento por aba');
        // SECURITY A4: Limpar tokens legados do localStorage real
        // Tokens JWT NÃO devem ficar em localStorage (vulnerável a XSS)
        // A autenticação agora usa httpOnly cookies exclusivamente
        try {
            ['token', 'authToken'].forEach(function (k) {
                var val = _origGet.call(window.localStorage, k);
                if (val && val !== 'null' && val !== 'undefined') {
                    window.localStorage.removeItem(k);
                    console.log('[SECURITY] 🗑️ Token legado removido do localStorage:', k);
                }
            });
        } catch (cleanErr) {
            // Silently ignore cleanup errors
        }
    } catch (e) {
        console.warn('⚠️ Storage Isolator falhou:', e);
    }
})();

(function () {
    'use strict';

    if (window.__authUnifiedInitialized) return;
    window.__authUnifiedInitialized = true;

    console.log('[AUTH] Sistema de Autenticacao Unificado ALUFORCE v7.6 (Tab-Isolated + Server Validation + Token Refresh)');

    const AUTH_BASE_PATH = window.__BASE_PATH || window.__MOUNT_PATH__ || '';
    function withAuthBase(path) {
        if (AUTH_BASE_PATH && typeof path === 'string' && path.charAt(0) === '/' && path.indexOf(AUTH_BASE_PATH) !== 0) {
            return AUTH_BASE_PATH + path;
        }
        return path;
    }

    // Configurações
    const AUTH_CONFIG = {
        loginUrl: withAuthBase('/login.html'),
        apiMeEndpoint: withAuthBase('/api/me'),
        refreshEndpoint: withAuthBase('/api/auth/refresh'),
        dashboardUrl: withAuthBase('/dashboard'),
        timeout: 5000,
        accessTokenLifetimeMs: 15 * 60 * 1000, // 15 min
        refreshBeforeExpiryMs: 2 * 60 * 1000,  // Refresh 2 min antes de expirar
        debug: true
    };

    // Flag para evitar múltiplos redirecionamentos
    let isRedirecting = false;

    // =========================================================================
    // 🔄 TOKEN REFRESH INTERCEPTOR
    // Intercepta fetch globalmente: quando recebe 401 TOKEN_EXPIRED,
    // tenta refresh automático e re-executa a request original.
    // =========================================================================
    let _isRefreshing = false;
    let _refreshQueue = []; // Requests aguardando refresh
    let _refreshTimer = null;

    const _originalFetch = window.fetch.bind(window);

    async function _doRefresh() {
        if (_isRefreshing) {
            // Aguardar refresh em andamento
            return new Promise((resolve, reject) => {
                _refreshQueue.push({ resolve, reject });
            });
        }
        _isRefreshing = true;
        try {
            const refreshController = new AbortController();
            const refreshTimeout = setTimeout(() => refreshController.abort(), 10000); // 10s timeout
            const resp = await _originalFetch(AUTH_CONFIG.refreshEndpoint, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                signal: refreshController.signal
            });
            clearTimeout(refreshTimeout);
            if (resp.ok) {
                const data = await resp.json();
                if (data.user) {
                    setTabUserData(data.user);
                }
                // Reset proactive timer
                _scheduleProactiveRefresh();
                // Resolver requests da fila
                _refreshQueue.forEach(p => p.resolve(true));
                _refreshQueue = [];
                debugLog('🔄 Token refresh realizado com sucesso');
                return true;
            }
            _refreshQueue.forEach(p => p.resolve(false));
            _refreshQueue = [];
            return false;
        } catch (err) {
            _refreshQueue.forEach(p => p.reject(err));
            _refreshQueue = [];
            return false;
        } finally {
            _isRefreshing = false;
        }
    }

    // Proactive refresh: renova antes do access token expirar
    function _scheduleProactiveRefresh() {
        if (_refreshTimer) clearTimeout(_refreshTimer);
        // Access token dura 15 min — renovar 2 min antes
        var refreshDelay = AUTH_CONFIG.accessTokenLifetimeMs - AUTH_CONFIG.refreshBeforeExpiryMs;
        _refreshTimer = setTimeout(async () => {
            if (isLoginPage() || isRedirecting) return;
            debugLog('🔄 Refresh proativo (antes de expirar)...');
            const ok = await _doRefresh();
            if (!ok) {
                debugLog('⚠️ Refresh proativo falhou');
            }
        }, refreshDelay);
    }

    // Fetch interceptor: adiciona timeout padrão + detecta 401 TOKEN_EXPIRED e tenta refresh
    const DEFAULT_FETCH_TIMEOUT = 30000; // 30 segundos

    window.fetch = async function (input, init) {
        const url = (typeof input === 'string') ? input : (input?.url || '');
        init = init || {};

        // v7.4 FIX: Sempre injetar credentials:'include' para enviar httpOnly cookies
        // Sem isso, requests sem credentials explícito não enviam o authToken cookie
        // v7.5 FIX: também cobrir URLs absolutas do mesmo origin (ex: https://aluforce.api.br/api/...)
        if (!init.credentials && (url.startsWith('/') || url.startsWith(window.location.origin) || url.startsWith('https://aluforce.api.br'))) {
            init.credentials = 'include';
        }

        // Nunca interceptar a própria rota de refresh (evita loop infinito)
        if (url.includes('/api/auth/refresh')) {
            return _originalFetch(input, init);
        }

        // P3 SECURITY: Injetar AbortController com timeout se nenhum signal foi fornecido
        let timeoutId = null;
        let controller = null;
        if (!init.signal) {
            controller = new AbortController();
            init.signal = controller.signal;
            timeoutId = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT);
        }

        let response;
        try {
            response = await _originalFetch(input, init);
        } catch (err) {
            if (timeoutId) clearTimeout(timeoutId);
            throw err;
        }
        if (timeoutId) clearTimeout(timeoutId);

        // v7.6 FIX: Tratar 502/503/504 (gateway/cache/servico indisponivel) com retry limitado
        if ([502, 503, 504].includes(response.status)) {
            const retryCount = (init._retryCount || 0);
            if (retryCount < 2) {
                const delay = 2000 * (retryCount + 1); // backoff: 2s, 4s
                debugLog(`${response.status} retry ${retryCount + 1}/2 em ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                var retryInit = Object.assign({}, init);
                delete retryInit.signal;
                retryInit._retryCount = retryCount + 1;
                return window.fetch(input, retryInit);
            }
            debugLog(`${response.status} apos 2 retries - retornando resposta original`);
        }

        if (response.status === 401) {
            // Clonar antes de consumir o body
            const cloned = response.clone();
            try {
                const body = await cloned.json();
                const code = body && body.code;

                // Códigos irrecuperáveis — redirect direto
                if (code === 'AUTH_REVOKED' || code === 'AUTH_MISSING' || code === 'AUTH_INVALID') {
                    debugLog('🔒 Sessão encerrada — ' + (body.message || code));
                    clearAuthData();
                    redirectToLogin(body.message || 'Sessão encerrada');
                } else if (code === 'AUTH_INACTIVE') {
                    // Inatividade detectada pelo servidor — dar chance de continuar
                    // Se o InactivityManager estiver carregado, ele exibe o modal
                    // Caso contrário, tentar refresh (refreshToken ainda pode ser válido)
                    debugLog('⏰ Sessão inativa detectada pelo servidor');
                    if (window.InactivityManager) {
                        window.dispatchEvent(new CustomEvent('sessionInactive'));
                        // v7.5 FIX: Esperar que o usuário decida no modal.
                        // Retornar Response sintética 'pending' para evitar que o caller
                        // trate como erro. O modal vai renovar via refreshToken se o
                        // usuário clicar "Continuar".
                        return new Response(JSON.stringify({ code: 'AUTH_INACTIVE_PENDING', message: 'Aguardando decisão de inatividade' }), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    } else {
                        // Fallback: tentar refresh automático
                        debugLog('🔄 Tentando refresh após inatividade...');
                        var refreshOk = await _doRefresh();
                        if (refreshOk) {
                            return _originalFetch(input, init);
                        }
                        clearAuthData();
                        redirectToLogin(body.message || 'Sessão expirada por inatividade');
                    }
                } else if (code === 'TOKEN_EXPIRED' || code === 'AUTH_EXPIRED') {
                    debugLog('🔄 Access token expirado, tentando refresh...');
                    const refreshed = await _doRefresh();
                    if (refreshed) {
                        // Re-executar a request original com novos cookies
                        return _originalFetch(input, init);
                    }
                    // Refresh falhou — redirecionar para login
                    debugLog('❌ Refresh falhou — redirecionando para login');
                    clearAuthData();
                    redirectToLogin('Sessão expirada');
                } else if (!code) {
                    // v7.5 FIX: Módulos com authMiddleware local podem retornar 401 sem campo `code`.
                    // Tentar refresh antes de desistir — se o refreshToken cookie estiver válido,
                    // o servidor emitirá novo accessToken e a request original será reexecutada.
                    debugLog('🔄 401 sem código específico — tentando refresh preventivo...');
                    const refreshed = await _doRefresh();
                    if (refreshed) {
                        return _originalFetch(input, init);
                    }
                    // Refresh falhou — sessão realmente expirada
                    debugLog('❌ Refresh preventivo falhou — sessão expirada');
                    clearAuthData();
                    redirectToLogin(body.message || 'Sessão expirada');
                }
            } catch (e) {
                // Body não era JSON — tentar refresh como último recurso
                debugLog('🔄 401 sem body JSON — tentando refresh...');
                const refreshed = await _doRefresh();
                if (refreshed) {
                    return _originalFetch(input, init);
                }
            }
        }

        return response;
    };

    // Função para logs de debug
    function debugLog(message, data = null) {
        if (AUTH_CONFIG.debug) {
            console.log(`[AUTH-UNIFIED] ${message}`, data || '');
        }
    }

    // =========================================================================
    // 🔐 TOKEN ISOLATION: sessionStorage é a fonte PRIMÁRIA do token nesta aba
    // localStorage é usado APENAS para inicializar novas abas (lido UMA vez)
    // =========================================================================

    // Obter o token DESTA aba (sessionStorage APENAS - NÃO copiar de localStorage)
    // v7.1 FIX: Não copiar automaticamente de localStorage para evitar que o login
    // de outro usuário no mesmo computador "contamine" novas abas.
    // O token só vai para sessionStorage quando o PRÓPRIO usuário faz login nesta aba.
    function getTabToken() {
        // Token já isolado nesta aba (salvo durante login OU validação do servidor)
        let token = sessionStorage.getItem('tabAuthToken');
        if (token && token !== 'null' && token !== 'undefined') {
            return token;
        }
        // NÃO copiar de localStorage - isso causava o bug de "espelhamento" entre usuários
        // no mesmo computador. O token será obtido via checkAuthentication() se necessário.
        return null;
    }

    // Salvar token nesta aba (sessionStorage only — token NOT stored in localStorage)
    // SECURITY: JWT is delivered via httpOnly cookie, sessionStorage is kept only for
    // backward compatibility with code that calls localStorage.getItem('authToken')
    // via the StorageIsolator interceptor.
    function setTabToken(token) {
        if (token) {
            sessionStorage.setItem('tabAuthToken', token);
        }
    }

    // Obter deviceId deste dispositivo/aba
    function getDeviceId() {
        return sessionStorage.getItem('deviceId');
    }

    // Obter dados do usuário DESTA aba (sessionStorage APENAS)
    // v7.1 FIX: Não copiar de localStorage para evitar contaminação entre usuários
    function getTabUserData() {
        try {
            // Dados isolados desta aba (salvos durante login OU validação do servidor)
            let data = sessionStorage.getItem('tabUserData');
            if (data) {
                const user = JSON.parse(data);
                if (user && user.id && user.email) return user;
            }
            // NÃO copiar de localStorage - será obtido via checkAuthentication()
        } catch (e) {
            debugLog('⚠️ Erro ao ler userData:', e);
        }
        return null;
    }

    // Salvar dados do usuário nesta aba (e localStorage para futuras abas)
    function setTabUserData(userData) {
        if (userData) {
            const json = JSON.stringify(userData);
            sessionStorage.setItem('tabUserData', json);
            localStorage.setItem('userData', json);
        }
    }

    // Verificar se deviceId local corresponde ao do servidor
    function validateDeviceId(serverDeviceId) {
        const localDeviceId = getDeviceId();
        if (!localDeviceId || !serverDeviceId) return true;
        return localDeviceId === serverDeviceId;
    }

    // Função para obter cookie por nome
    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    // Função para remover dados de autenticação
    function clearAuthData() {
        debugLog('🧹 Limpando dados de autenticação...');

        const localKeys = [
            'authToken', 'token', 'userData', 'user', 'user_data', 'userName',
            'chatSupportUser', 'chatSupportConversations', 'chatSupportTickets',
            'chatUser', 'supportTickets', 'chatVoiceEnabled',
            'currentUser', 'loggedUser', 'userInfo', 'userProfile',
            'rememberToken', 'sessionUser', 'lastUser',
            'userEmail', 'userRole'
        ];

        try {
            localKeys.forEach(k => localStorage.removeItem(k));
        } catch (e) {
            debugLog('⚠️ Erro ao limpar localStorage:', e);
        }

        try {
            sessionStorage.clear();
        } catch (e) {
            debugLog('⚠️ Erro ao limpar sessionStorage:', e);
        }

        const cookieNames = ['authToken', 'token', 'connect.sid', 'rememberToken', 'refreshToken'];
        cookieNames.forEach(name => {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        });

        debugLog('✅ Dados de autenticação limpos');
    }

    // Função para verificar se está na página de login
    function isLoginPage() {
        const pathname = window.location.pathname.toLowerCase();
        return pathname.includes('login') || pathname.endsWith('login.html');
    }

    // Função para verificar se deve pular verificação
    function shouldSkipAuth() {
        const pathname = window.location.pathname.toLowerCase();
        // SECURITY FIX H-01: Removido bypass via query param (no-auth=1/skip-auth=1)
        // Apenas páginas de login e assets estáticos devem pular autenticação

        if (isLoginPage()) return true;

        if (pathname.endsWith('.css') || pathname.endsWith('.js') ||
            pathname.endsWith('.png') || pathname.endsWith('.jpg') ||
            pathname.endsWith('.ico') || pathname.endsWith('.woff') ||
            pathname.endsWith('.woff2') || pathname.endsWith('.svg')) {
            return true;
        }

        return false;
    }

    // Exibir banner de sessão expirada antes de redirecionar (BE-001)
    function _showSessionExpiredBanner(reason) {
        try {
            if (document.getElementById('__auth-session-banner')) return;
            const banner = document.createElement('div');
            banner.id = '__auth-session-banner';
            banner.setAttribute('role', 'alert');
            banner.style.cssText = [
                'position:fixed', 'top:0', 'left:0', 'width:100%', 'z-index:2147483647',
                'background:linear-gradient(90deg,#c0392b,#e74c3c)', 'color:#fff',
                'padding:14px 20px', 'font:600 14px/1.4 system-ui,sans-serif',
                'display:flex', 'align-items:center', 'gap:12px',
                'box-shadow:0 2px 12px rgba(0,0,0,0.3)',
                'animation:__bannerSlide .25s ease-out'
            ].join(';');
            const style = document.createElement('style');
            style.textContent = '@keyframes __bannerSlide{from{transform:translateY(-100%)}to{transform:translateY(0)}}';
            document.head.appendChild(style);
            const icon = document.createElement('span');
            icon.textContent = '🔒';
            icon.style.cssText = 'font-size:18px;flex-shrink:0';
            const text = document.createElement('span');
            text.textContent = reason && reason !== 'Não autenticado'
                ? `Sessão encerrada: ${reason}. Redirecionando para login…`
                : 'Sua sessão expirou. Redirecionando para login…';
            banner.appendChild(icon);
            banner.appendChild(text);
            document.body ? document.body.prepend(banner) : document.documentElement.prepend(banner);
        } catch(e) { /* não bloquear redirect por falha no banner */ }
    }

    // Função para redirecionar para login (com proteção contra loop)
    function redirectToLogin(reason = 'Não autenticado') {
        if (isRedirecting) {
            debugLog('⚠️ Redirecionamento já em andamento, ignorando...');
            return;
        }

        if (isLoginPage()) {
            debugLog('⚠️ Já está na página de login, não redirecionando');
            return;
        }

        isRedirecting = true;
        debugLog(`🚪 Redirecionando para login: ${reason}`);

        // BE-001: Mostrar banner visível por ~1.5s antes de redirecionar
        _showSessionExpiredBanner(reason);

        const currentPath = window.location.pathname + window.location.search + window.location.hash;
        const returnTo = encodeURIComponent(currentPath);

        let loginUrl = AUTH_CONFIG.loginUrl;
        if (currentPath !== '/' && currentPath !== '/dashboard' && currentPath.length > 1 && !currentPath.startsWith('/Zyntra-SGE/')) {
            loginUrl = `${AUTH_CONFIG.loginUrl}?returnTo=${returnTo}`;
        }

        setTimeout(() => window.location.assign(loginUrl), 1500);
    }

    // =========================================================================
    // 🛡️ LISTENER: Detectar quando OUTRA aba muda o localStorage
    // Se outro usuário fez login em outra aba, NÃO afetar esta aba
    // =========================================================================
    window.addEventListener('storage', (event) => {
        if (event.key === 'authToken' || event.key === 'userData') {
            debugLog(`🔔 Outra aba modificou ${event.key} - IGNORANDO (esta aba usa sessionStorage)`);
            // Não fazer nada - esta aba continua com seu próprio token/dados em sessionStorage
        }
    });

    // Função para verificar autenticação via API
    async function checkAuthentication(options = {}) {
        debugLog('🔍 Verificando autenticação no servidor...');

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), AUTH_CONFIG.timeout);

            // SECURITY: Auth via httpOnly cookie only — no Authorization header needed
            const headers = {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            };

            // SECURITY FIX: Checks passivos (periódico, proactive refresh) NÃO devem
            // resetar o timer de inatividade no servidor. Sem isso, o timeout de 30min
            // nunca dispara porque o health-check periódico reseta o timer a cada 15min.
            if (options.passive) {
                headers['X-Activity-Check'] = 'passive';
            }

            const response = await fetch(AUTH_CONFIG.apiMeEndpoint, {
                method: 'GET',
                credentials: 'include',
                headers: headers,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            debugLog(`📡 Resposta da API: ${response.status}`);

            if (response.ok) {
                const userData = await response.json();
                debugLog('✅ Usuário autenticado:', userData.nome || userData.email);

                // Ativar refresh proativo (access token dura 15m)
                _scheduleProactiveRefresh();

                // 🔐 MULTI-DEVICE: Verificar se deviceId corresponde
                if (userData.deviceId) {
                    const localDeviceId = getDeviceId();
                    if (localDeviceId && localDeviceId !== userData.deviceId) {
                        debugLog('⚠️ DeviceId não corresponde! Sessão de outro dispositivo/aba.');
                        debugLog(`   Local: ${localDeviceId.substring(0, 8)}... vs Server: ${userData.deviceId.substring(0, 8)}...`);
                        // A sessão no cookie/servidor pode ter sido sobrescrita por outra aba
                        // Forçar re-login nesta aba
                        return null;
                    }
                    if (!localDeviceId) {
                        sessionStorage.setItem('deviceId', userData.deviceId);
                        debugLog('📱 DeviceId salvo:', userData.deviceId.substring(0, 8) + '...');
                    }
                }

                // 🔐 v6.0: Salvar no sessionStorage DESTA ABA como fonte primária
                setTabUserData(userData);

                // Disparar evento de sucesso
                window.dispatchEvent(new CustomEvent('authSuccess', {
                    detail: { user: userData }
                }));

                return userData;
            } else {
                debugLog(`❌ Falha na autenticação: ${response.status}`);
                // v7.6 FIX: Diferenciar erros de servidor (500/502/503) de erros de auth (401/403)
                // Erros de servidor devem usar fallback local, não forçar logout
                if (response.status >= 500) {
                    const tabUser = getTabUserData();
                    if (tabUser) {
                        debugLog('⚠️ Erro de servidor — usando dados da aba como fallback');
                        return tabUser;
                    }
                }
                return null;
            }

        } catch (error) {
            debugLog(`🚨 Erro na verificação: ${error.message}`);

            // Em caso de erro de rede, usar dados DESTA ABA como fallback
            const tabUser = getTabUserData();
            if (tabUser) {
                debugLog('⚠️ Usando dados da aba como fallback (offline)');
                return tabUser;
            }

            return null;
        }
    }

    // Função para verificar se tem dados válidos (sessionStorage desta aba primeiro)
    function getLocalUserData() {
        return getTabUserData();
    }

    // Função principal de verificação (v6.0 - sessionStorage primeiro)
    async function verifyAuth() {
        if (shouldSkipAuth()) {
            debugLog('⏭️ Pulando verificação de autenticação');
            return;
        }

        debugLog('🚀 Iniciando verificação de autenticação v6.0...');

        // 1. PRIMEIRO: Verificar se tem dados válidos nesta aba (sessionStorage)
        const localUser = getTabUserData();
        if (localUser) {
            debugLog('✅ Usuário encontrado nesta aba:', localUser.email);
            debugLog('🎉 Autenticação confirmada via sessionStorage!');

            // Disparar evento de sucesso
            window.dispatchEvent(new CustomEvent('authSuccess', {
                detail: { user: localUser, source: 'sessionStorage' }
            }));

            // Mostrar a página
            document.body?.classList?.remove('auth-loading');

            // Verificar servidor em background (usando token DESTA aba)
            checkAuthentication({ passive: true }).then(serverUser => {
                if (serverUser) {
                    setTabUserData(serverUser);
                    debugLog('🔄 Dados atualizados do servidor');
                } else {
                    // v7.6 FIX: Não redirecionar imediatamente em background check.
                    // Pode ser um blip de rede ou erro transitório do servidor.
                    // O check periódico (3 falhas consecutivas) já trata isso.
                    debugLog('⚠️ Background check falhou — aguardando check periódico');
                }
            }).catch(() => {
                debugLog('⚠️ Não foi possível verificar servidor (offline?)');
            });

            return;
        }

        // 2. SEGUNDO: Se não tem dados nesta aba, tentar validar sessão via cookie no servidor
        // v7.2 FIX: Antes de forçar re-login, verificar se o servidor reconhece a sessão via cookie.
        // Isso permite abrir novas abas/links sem precisar re-logar, enquanto mantém
        // a segurança — apenas o servidor decide se o cookie é válido.
        debugLog('🔍 Nenhum token nesta aba - verificando sessão via cookie no servidor...');

        try {
            const serverUser = await checkAuthentication();
            if (serverUser) {
                debugLog('✅ Sessão válida confirmada pelo servidor - salvando nesta aba');
                setTabUserData(serverUser);

                // v7.4 FIX: Token vem via httpOnly cookie — não precisa copiar de localStorage
                // O checkAuthentication() já validou via cookie e setTabUserData() foi chamado acima

                // Mostrar a página
                document.body?.classList?.remove('auth-loading');

                // Disparar evento de sucesso
                window.dispatchEvent(new CustomEvent('authSuccess', {
                    detail: { user: serverUser, source: 'server-cookie' }
                }));
                return;
            }
        } catch (e) {
            debugLog('⚠️ Erro ao verificar sessão no servidor:', e.message);
        }

        // Servidor não reconheceu a sessão — agora sim, redirecionar para login
        debugLog('❌ Sessão não válida no servidor - redirecionando para login');
        redirectToLogin('Nova sessão - faça login');
    }

    // Função para inicializar sistema de auth
    function initAuth() {
        debugLog('🔧 Inicializando sistema de autenticação v7.5 (Tab-Isolated + Server Validation)...');

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', verifyAuth);
        } else {
            verifyAuth();
        }

        // v7.4 FIX: Verificação periódica com tolerância a falhas
        // Exige 3 falhas consecutivas antes de redirecionar (evita logout por blip de rede)
        let _periodicFailCount = 0;
        const MAX_PERIODIC_FAILURES = 3;
        setInterval(async () => {
            if (!shouldSkipAuth() && !isRedirecting) {
                debugLog('🔄 Verificação periódica (passive — não reseta inatividade)...');
                const serverUser = await checkAuthentication({ passive: true });
                if (!serverUser) {
                    _periodicFailCount++;
                    debugLog(`⚠️ Check periódico falhou (${_periodicFailCount}/${MAX_PERIODIC_FAILURES})`);
                    if (_periodicFailCount >= MAX_PERIODIC_FAILURES) {
                        debugLog('❌ Múltiplas falhas consecutivas — sessão expirada');
                        clearAuthData();
                        redirectToLogin('Sessão expirada');
                    }
                } else {
                    _periodicFailCount = 0;
                }
            }
        }, 15 * 60 * 1000); // 15 min — proactive refresh já mantém a sessão ativa
    }

    // Expor funções para os módulos
    window.AluforceAuth = {
        checkAuth: checkAuthentication,
        clearAuth: clearAuthData,
        getCookie: getCookie,
        getDeviceId: getDeviceId,
        getTabToken: getTabToken, // 🔐 v6.0: Expor token da aba
        refreshToken: _doRefresh, // 🔄 v7.3: Refresh manual se necessário
        isAuthenticated: async () => {
            const tabUser = getTabUserData();
            if (tabUser) return true;
            const userData = await checkAuthentication();
            return !!userData;
        },
        getUserData: async () => {
            const tabUser = getTabUserData();
            if (tabUser) return tabUser;
            return await checkAuthentication();
        },
        getLocalUserData: getLocalUserData,
        logout: async () => {
            try {
                await _originalFetch('/api/logout', { method: 'POST', credentials: 'include' });
            } catch (e) { /* ignore network errors during logout */ }
            clearAuthData();
            window.location.assign(AUTH_CONFIG.loginUrl);
        }
    };

    const EMPRESA_LOGO_SELECTOR = '.logo-empresa, .company-logo, #logo-sidebar, #logo-header, img[src*="logo"]';

    function isFixedBrandInstance() {
        return typeof window !== 'undefined' && !!window.__BRAND_LOGO__;
    }

    function isBrandLogoLocked(el) {
        return el && (
            el.getAttribute('data-brand-logo-locked') === 'true' ||
            el.id === 'zc-empresa-logo' ||
            el.id === 'alf-brand-logo'
        );
    }

    function forEachMutableEmpresaLogo(callback) {
        document.querySelectorAll(EMPRESA_LOGO_SELECTOR).forEach(img => {
            if (isBrandLogoLocked(img)) return;
            callback(img);
        });
    }

    function aplicarLogoFixoDaMarca() {
        if (!isFixedBrandInstance()) return false;

        localStorage.removeItem('empresa_logo_url');
        localStorage.removeItem('empresa_logo_timestamp');

        document.querySelectorAll('[data-brand-logo-locked="true"], #zc-empresa-logo, #alf-brand-logo').forEach(img => {
            if (img.tagName === 'IMG') {
                img.src = window.__BRAND_LOGO__;
                if (window.__BRAND_NAME__) img.alt = window.__BRAND_NAME__;
            }
        });

        return true;
    }

    // === BRANDING: Aplicar logo e favicon da empresa em todas as páginas ===
    function aplicarBrandingEmpresa() {
        try {
            // Aplicar favicon do localStorage
            const faviconUrl = localStorage.getItem('empresa_favicon_url');
            if (faviconUrl) {
                const ts = localStorage.getItem('empresa_favicon_timestamp') || '';
                const url = faviconUrl + '?v=' + ts;
                document.querySelectorAll('link[rel*="icon"]').forEach(l => l.href = url);
                // Se não existe, criar
                if (!document.querySelector('link[rel="icon"]')) {
                    const link = document.createElement('link');
                    link.rel = 'icon';
                    link.href = url;
                    document.head.appendChild(link);
                }
            }

            const usaLogoFixaDaMarca = aplicarLogoFixoDaMarca();

            // Aplicar logo do localStorage apenas na instância Aluforce multiempresa.
            // Nas instâncias Labor, a marca do tenant vem de window.__BRAND_LOGO__
            // injetado pelo middleware e não pode ser sobrescrita por cache/API.
            const logoUrl = usaLogoFixaDaMarca ? null : localStorage.getItem('empresa_logo_url');
            if (logoUrl) {
                const ts = localStorage.getItem('empresa_logo_timestamp') || '';
                const url = logoUrl + '?v=' + ts;
                forEachMutableEmpresaLogo(img => {
                    if (img.tagName === 'IMG') img.src = url;
                });
            }

            // Buscar do servidor caso não tenha no localStorage (primeira visita)
            // Pular requisição quando o usuário ainda não está autenticado (login page ou sem cookie)
            // — isso evita o 401 "Unauthorized" na rota /api/configuracoes/empresa antes do login.
            const hasAuthCookie = !!getCookie('authToken') || !!getCookie('token');
            if (!faviconUrl && !logoUrl && !isLoginPage() && hasAuthCookie) {
                fetch('/api/configuracoes/empresa', { credentials: 'include' })
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (!data) return;
                        if (data.logo_url && !usaLogoFixaDaMarca) {
                            localStorage.setItem('empresa_logo_url', data.logo_url);
                            localStorage.setItem('empresa_logo_timestamp', Date.now().toString());
                            forEachMutableEmpresaLogo(img => {
                                if (img.tagName === 'IMG') img.src = data.logo_url + '?v=' + Date.now();
                            });
                        }
                        if (data.favicon_url) {
                            localStorage.setItem('empresa_favicon_url', data.favicon_url);
                            localStorage.setItem('empresa_favicon_timestamp', Date.now().toString());
                            document.querySelectorAll('link[rel*="icon"]').forEach(l => l.href = data.favicon_url + '?v=' + Date.now());
                        }
                    })
                    .catch(() => {});
            }
        } catch (e) {
            // Branding is non-critical, don't block auth flow
        }
    }

    // Aplicar branding quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', aplicarBrandingEmpresa);
    } else {
        aplicarBrandingEmpresa();
    }

    // Inicializar
    initAuth();

    debugLog('Sistema de autenticacao v7.6 (Tab-Isolated + Server Validation + Token Refresh) inicializado');

})();
