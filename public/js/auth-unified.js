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
    } catch(e) {
        console.warn('⚠️ Storage Isolator falhou:', e);
    }
})();

(function() {
    'use strict';
    
    console.log('🔐 Sistema de Autenticação Unificado ALUFORCE v7.2 (Tab-Isolated + Server Validation)');
    
    // Configurações
    const AUTH_CONFIG = {
        loginUrl: '/login.html',
        apiMeEndpoint: '/api/me',
        dashboardUrl: '/index.html',
        timeout: 5000,
        debug: true
    };
    
    // Flag para evitar múltiplos redirecionamentos
    let isRedirecting = false;
    
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
    
    // Salvar token nesta aba (e no localStorage para futuras abas)
    function setTabToken(token) {
        if (token) {
            sessionStorage.setItem('tabAuthToken', token);
            localStorage.setItem('authToken', token);
            localStorage.setItem('token', token);
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
        
        const cookieNames = ['authToken','token','connect.sid','rememberToken'];
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
        const search = window.location.search.toLowerCase();
        
        if (isLoginPage()) return true;
        if (search.includes('no-auth=1') || search.includes('skip-auth=1')) return true;
        
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
            
            // 🔐 v6.0: Usar token DESTA ABA (sessionStorage) como fonte primária
            const authToken = getTabToken();
            const headers = {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            };
            
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
                debugLog('🔑 Token da aba encontrado, enviando no header');
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
        
        // Verificação periódica a cada 15 minutos
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
        }, 15 * 60 * 1000);
    }
    
    // Expor funções para os módulos
    window.AluforceAuth = {
        checkAuth: checkAuthentication,
        clearAuth: clearAuthData,
        getCookie: getCookie,
        getDeviceId: getDeviceId,
        getTabToken: getTabToken, // 🔐 v6.0: Expor token da aba
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
        logout: () => {
            clearAuthData();
            window.location.href = AUTH_CONFIG.loginUrl;
        }
    };
    
    // Inicializar
    initAuth();
    
    debugLog('✅ Sistema de autenticação v7.2 (Tab-Isolated + Server Validation) inicializado');
    
})();