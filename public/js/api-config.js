/**
 * ALUFORCE - Configuração de API para App Mobile
 * Detecta automaticamente se deve usar servidor local ou produção
 */

const ApiConfig = (function() {
    'use strict';

    // Configurações
    const CONFIG = {
        // Servidor local (WiFi)
        localServer: 'http://192.168.68.185:3000',
        
        // Servidor de produção (Railway)
        productionServer: 'https://aluforce.railway.app',
        
        // Timeout para verificar conexão (ms)
        connectionTimeout: 3000,
        
        // Intervalo para verificar conexão (ms)
        checkInterval: 30000,
        
        debug: true
    };

    let state = {
        currentServer: null,
        isLocalAvailable: false,
        isProductionAvailable: false,
        lastCheck: null
    };

    /**
     * Log de debug
     */
    function log(message, data = null) {
        if (CONFIG.debug) {
            console.log(`[ApiConfig] ${message}`, data || '');
        }
    }

    /**
     * Verifica se um servidor está acessível
     */
    async function checkServer(url) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.connectionTimeout);
            
            const response = await fetch(`${url}/api/health`, {
                method: 'GET',
                signal: controller.signal,
                cache: 'no-cache'
            });
            
            clearTimeout(timeoutId);
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Detecta o melhor servidor para usar
     */
    async function detectBestServer() {
        log('🔍 Detectando melhor servidor...');
        
        // Primeiro tenta o servidor local (mais rápido)
        state.isLocalAvailable = await checkServer(CONFIG.localServer);
        log(`Servidor local (${CONFIG.localServer}):`, state.isLocalAvailable ? '✅ OK' : '❌ Indisponível');
        
        if (state.isLocalAvailable) {
            state.currentServer = CONFIG.localServer;
            log('📍 Usando servidor LOCAL');
            saveServerPreference('local');
            return state.currentServer;
        }
        
        // Se local não está disponível, tenta produção
        state.isProductionAvailable = await checkServer(CONFIG.productionServer);
        log(`Servidor produção (${CONFIG.productionServer}):`, state.isProductionAvailable ? '✅ OK' : '❌ Indisponível');
        
        if (state.isProductionAvailable) {
            state.currentServer = CONFIG.productionServer;
            log('📍 Usando servidor de PRODUÇÍO');
            saveServerPreference('production');
            return state.currentServer;
        }
        
        // Nenhum servidor disponível - usa cache local
        log('⚠️ Nenhum servidor disponível - modo offline');
        state.currentServer = null;
        return null;
    }

    /**
     * Salva preferência de servidor
     */
    function saveServerPreference(type) {
        localStorage.setItem('preferredServer', type);
        localStorage.setItem('serverUrl', type === 'local' ? CONFIG.localServer : CONFIG.productionServer);
    }

    /**
     * Obtém URL base para API
     */
    function getBaseUrl() {
        return state.currentServer || localStorage.getItem('serverUrl') || CONFIG.localServer;
    }

    /**
     * Faz requisição para API com fallback automático
     */
    async function apiRequest(endpoint, options = {}) {
        const baseUrl = getBaseUrl();
        const url = `${baseUrl}${endpoint}`;
        
        try {
            const response = await fetch(url, {
                ...options,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            
            return response;
        } catch (error) {
            log(`❌ Erro na requisição ${endpoint}:`, error.message);
            
            // Se falhou com servidor local, tenta produção
            if (baseUrl === CONFIG.localServer) {
                log('🔄 Tentando servidor de produção...');
                
                try {
                    const productionUrl = `${CONFIG.productionServer}${endpoint}`;
                    const response = await fetch(productionUrl, {
                        ...options,
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json',
                            ...options.headers
                        }
                    });
                    
                    if (response.ok) {
                        state.currentServer = CONFIG.productionServer;
                        saveServerPreference('production');
                    }
                    
                    return response;
                } catch (prodError) {
                    log(`❌ Servidor de produção também falhou:`, prodError.message);
                }
            }
            
            throw error;
        }
    }

    /**
     * Inicializa
     */
    async function init() {
        log('🚀 Inicializando ApiConfig...');
        
        // Tenta usar servidor salvo primeiro
        const savedServer = localStorage.getItem('preferredServer');
        if (savedServer) {
            state.currentServer = savedServer === 'local' ? CONFIG.localServer : CONFIG.productionServer;
            log(`📍 Usando servidor salvo: ${savedServer}`);
        }
        
        // Detecta melhor servidor em background
        detectBestServer();
        
        // Verifica periodicamente
        setInterval(async () => {
            if (navigator.onLine) {
                await detectBestServer();
            }
        }, CONFIG.checkInterval);
        
        log('✅ ApiConfig inicializado');
    }

    /**
     * Força usar servidor local
     */
    function useLocalServer() {
        state.currentServer = CONFIG.localServer;
        saveServerPreference('local');
        log('📍 Forçado para servidor LOCAL');
    }

    /**
     * Força usar servidor de produção
     */
    function useProductionServer() {
        state.currentServer = CONFIG.productionServer;
        saveServerPreference('production');
        log('📍 Forçado para servidor de PRODUÇÍO');
    }

    // API Pública
    return {
        init,
        getBaseUrl,
        apiRequest,
        detectBestServer,
        checkServer,
        useLocalServer,
        useProductionServer,
        getState: () => ({ ...state }),
        CONFIG
    };
})();

// Auto-inicializa
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ApiConfig.init());
} else {
    ApiConfig.init();
}

// Expõe globalmente
window.ApiConfig = ApiConfig;
