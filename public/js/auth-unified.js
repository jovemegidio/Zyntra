// auth-unified.js - Sistema de autenticação unificado para todos os módulos ALUFORCE
// VERSÃO 7.2 - ISOLAMENTO POR ABA + VALIDAÇÃO VIA SERVIDOR
// FIX v7.0: Resolve o problema de "espelhamento" onde o login de outro usuário em outra aba
//      sobrescreve a sessão da aba atual via localStorage/cookie compartilhados.
// FIX v7.1: NÃO copia mais token/userData de localStorage para sessionStorage em novas abas.
// FIX v7.2: Em novas abas, consulta o SERVIDOR via cookie antes de redirecionar para login.
//      Isso permite abrir módulos em novas abas sem forçar re-login, mantendo segurança.

// =============================================================================
// 🔒 STORAGE ISOLATOR - Deve rodar ANTES de qualquer outro código
// Intercepta localStorage.getItem para chaves de autenticação
// Retorna valores do sessionStorage (isolado por aba) quando disponíveis
// =============================================================================
(function StorageIsolator() {
    try {
        var _origGet = Storage.prototype.getItem;
        var _authKeyMap = {
            'userData': 'tabUserData',
            'user_data': 'tabUserData',
            'authToken': 'tabAuthToken',
            'token': 'tabAuthToken'
        };
        Storage.prototype.getItem = function(key) {
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
        Storage.prototype.setItem = function(key, value) {
            _origSet.call(this, key, value);
            // Quando qualquer código salva no localStorage, espelhar no sessionStorage
            if (this === window.localStorage && _authKeyMap[key] && value) {
                try { _origSet.call(window.sessionStorage, _authKeyMap[key], value); } catch(e) {}
            }
        };
        console.log('🔒 Storage Isolator v1.0 ativo - localStorage interceptado para isolamento por aba');
        // SECURITY A4: Limpar tokens legados do localStorage real
        // Tokens JWT NÃO devem ficar em localStorage (vulnerável a XSS)
        // A autenticação agora usa httpOnly cookies exclusivamente
        try {
            ['token', 'authToken'].forEach(function(k) {
                var val = _origGet.call(window.localStorage, k);
                if (val && val !== 'null' && val !== 'undefined') {
                    window.localStorage.removeItem(k);
                    console.log('[SECURITY] 🗑️ Token legado removido do localStorage:', k);
                }
            });
        } catch(cleanErr) {
            // Silently ignore cleanup errors
        }
    } catch(e) {
        console.warn('⚠️ Storage Isolator falhou:', e);
    }
})();

(function() {
    'use strict';
    
    console.log('🔐 Sistema de Autenticação Unificado ALUFORCE v7.3 (Tab-Isolated + Server Validation + Token Refresh)');
    
    // Configurações
    const AUTH_CONFIG = {
        loginUrl: '/login.html',
        apiMeEndpoint: '/api/me',
        refreshEndpoint: '/api/auth/refresh',
        dashboardUrl: '/index.html',
        timeout: 5000,
        refreshBeforeExpiry: 2 * 60 * 1000, // Refresh 2 min antes de expirar
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
        // Access token dura 15 min — renovar aos 13 min (2 min antes)
        _refreshTimer = setTimeout(async () => {
            if (isLoginPage() || isRedirecting) return;
            debugLog('🔄 Refresh proativo (antes de expirar)...');
            const ok = await _doRefresh();
            if (!ok) {
                debugLog('⚠️ Refresh proativo falhou');
            }
        }, 13 * 60 * 1000); // 13 minutos
    }

    // Fetch interceptor: adiciona timeout padrão + detecta 401 TOKEN_EXPIRED e tenta refresh
    const DEFAULT_FETCH_TIMEOUT = 30000; // 30 segundos

    window.fetch = async function(input, init) {
        const url = (typeof input === 'string') ? input : (input?.url || '');
        init = init || {};

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

        if (response.status === 401) {
            // Clonar antes de consumir o body
            const cloned = response.clone();
            try {
                const body = await cloned.json();
                const code = body && body.code;

                // Códigos que indicam sessão irrecuperável — redirect direto
                if (code === 'AUTH_INACTIVE' || code === 'AUTH_REVOKED' || code === 'AUTH_MISSING' || code === 'AUTH_INVALID') {
                    debugLog('🔒 Sessão encerrada — ' + (body.message || code));
                    clearAuthData();
                    redirectToLogin(body.message || 'Sessão encerrada');
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
                }
            } catch (e) {
                // Body não era JSON, retornar resposta original
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
            'authToken','token','userData','user','user_data','userName',
            'chatSupportUser','chatSupportConversations','chatSupportTickets',
            'chatUser','supportTickets','chatVoiceEnabled',
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
        
        const cookieNames = ['authToken','token','connect.sid','rememberToken','refreshToken'];
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
        
        const currentPath = window.location.pathname + window.location.search + window.location.hash;
        const returnTo = encodeURIComponent(currentPath);
        
        let loginUrl = AUTH_CONFIG.loginUrl;
        if (currentPath !== '/' && currentPath !== '/index.html' && currentPath.length > 1) {
            loginUrl = `${AUTH_CONFIG.loginUrl}?returnTo=${returnTo}`;
        }
        
        window.location.href = loginUrl;
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
    async function checkAuthentication() {
        debugLog('🔍 Verificando autenticação no servidor...');
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), AUTH_CONFIG.timeout);
            
            // SECURITY: Auth via httpOnly cookie only — no Authorization header needed
            const headers = {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            };
            
            const response = await fetch(AUTH_CONFIG.apiMeEndpoint, { credentials: 'include', method: 'GET',
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
            checkAuthentication().then(serverUser => {
                if (serverUser) {
                    setTabUserData(serverUser);
                    debugLog('🔄 Dados atualizados do servidor');
                } else {
                    debugLog('⚠️ Sessão expirada no servidor - redirecionando para login');
                    clearAuthData();
                    redirectToLogin('Sessão expirada no servidor');
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

                // v7.3 FIX: Copiar token do localStorage para sessionStorage desta aba
                // O servidor confirmou a sessao via cookie, entao o localStorage tem token valido
                // Precisamos salvar em sessionStorage para que getAuthHeaders() funcione isolado
                if (!getTabToken()) {
                    if (lsToken && lsToken !== 'null') {
                        setTabToken(lsToken);
                        debugLog('Token copiado do localStorage para esta aba (server-cookie validou)');
                    }
                }
                
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
        debugLog('🔧 Inicializando sistema de autenticação v7.2 (Tab-Isolated + Server Validation)...');
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', verifyAuth);
        } else {
            verifyAuth();
        }
        
        // Verificação periódica a cada 5 minutos (access token dura 15m, com refresh proativo aos 13m)
        setInterval(async () => {
            if (!shouldSkipAuth() && !isRedirecting) {
                debugLog('🔄 Verificação periódica...');
                const tabUser = getTabUserData();
                if (!tabUser) {
                    const serverUser = await checkAuthentication();
                    if (!serverUser) {
                        redirectToLogin('Sessão expirada');
                    }
                } else {
                    // Verificar se a sessão ainda é válida no servidor
                    const serverUser = await checkAuthentication();
                    if (!serverUser) {
                        debugLog('⚠️ Sessão expirada no servidor durante check periódico');
                        clearAuthData();
                        redirectToLogin('Sessão expirada');
                    }
                }
            }
        }, 5 * 60 * 1000);
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
            window.location.href = AUTH_CONFIG.loginUrl;
        }
    };
    
    // Inicializar
    initAuth();
    
    debugLog('✅ Sistema de autenticação v7.3 (Tab-Isolated + Server Validation + Token Refresh) inicializado');
    
})();