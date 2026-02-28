/**
 * ============================================================
 * ALUFORCE - API DATA MANAGER
 * Gerenciador centralizado de dados com cache inteligente
 * Para evitar requisições duplicadas entre módulos
 * ============================================================
 */

(function() {
    'use strict';

    class DataManager {
        constructor() {
            this.cache = new Map();
            this.pendingRequests = new Map();
            this.subscribers = new Map();
            this.config = {
                defaultTTL: 60000,      // 1 minuto
                userDataTTL: 300000,    // 5 minutos
                staticDataTTL: 600000,  // 10 minutos
                maxCacheSize: 200
            };
        }

        // ============================================================
        // CORE FETCH COM CACHE
        // ============================================================

        async fetch(url, options = {}) {
            const {
                method = 'GET',
                body = null,
                cache = method === 'GET',
                ttl = this.config.defaultTTL,
                forceRefresh = false
            } = options;

            const cacheKey = this._getCacheKey(url, method, body);

            // Verificar cache (apenas para GET)
            if (cache && !forceRefresh && method === 'GET') {
                const cached = this._getFromCache(cacheKey);
                if (cached !== null) {
                    return cached;
                }
            }

            // Evitar requests duplicados
            if (this.pendingRequests.has(cacheKey)) {
                return this.pendingRequests.get(cacheKey);
            }

            // Fazer request
            const requestPromise = this._doFetch(url, method, body);
            this.pendingRequests.set(cacheKey, requestPromise);

            try {
                const data = await requestPromise;
                
                // Cachear resultado (apenas GET bem-sucedidos)
                if (cache && method === 'GET' && data) {
                    this._setCache(cacheKey, data, ttl);
                }

                // Notificar subscribers
                this._notifySubscribers(url, data);

                return data;
            } finally {
                this.pendingRequests.delete(cacheKey);
            }
        }

        async _doFetch(url, method, body) {
            const options = {
                method,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            if (body && method !== 'GET') {
                options.body = JSON.stringify(body);
            }

            const response = await fetch(url, options);
            
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                error.response = response;
                throw error;
            }

            return response.json();
        }

        // ============================================================
        // CACHE MANAGEMENT
        // ============================================================

        _getCacheKey(url, method, body) {
            const bodyStr = body ? JSON.stringify(body) : '';
            return `${method}:${url}:${bodyStr}`;
        }

        _getFromCache(key) {
            const item = this.cache.get(key);
            if (!item) return null;

            if (Date.now() > item.expires) {
                this.cache.delete(key);
                return null;
            }

            return item.data;
        }

        _setCache(key, data, ttl) {
            // LRU: remover item mais antigo se cache cheio
            if (this.cache.size >= this.config.maxCacheSize) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }

            this.cache.set(key, {
                data,
                expires: Date.now() + ttl,
                created: Date.now()
            });
        }

        invalidate(urlPattern) {
            if (!urlPattern) {
                this.cache.clear();
                return;
            }

            for (const key of this.cache.keys()) {
                if (key.includes(urlPattern)) {
                    this.cache.delete(key);
                }
            }
        }

        // ============================================================
        // SUBSCRIPTIONS (para atualização reativa)
        // ============================================================

        subscribe(url, callback) {
            if (!this.subscribers.has(url)) {
                this.subscribers.set(url, new Set());
            }
            this.subscribers.get(url).add(callback);

            // Retornar função para unsubscribe
            return () => {
                const subs = this.subscribers.get(url);
                if (subs) {
                    subs.delete(callback);
                }
            };
        }

        _notifySubscribers(url, data) {
            const subs = this.subscribers.get(url);
            if (subs) {
                subs.forEach(callback => {
                    try {
                        callback(data);
                    } catch (e) {
                        console.error('Subscriber error:', e);
                    }
                });
            }
        }

        // ============================================================
        // API HELPERS - Métodos pré-configurados
        // ============================================================

        // Dados do usuário logado
        async getUser(forceRefresh = false) {
            return this.fetch('/api/me', { 
                ttl: this.config.userDataTTL,
                forceRefresh 
            });
        }

        // Clientes
        async getClientes(params = {}) {
            const query = new URLSearchParams(params).toString();
            const url = `/api/clientes${query ? '?' + query : ''}`;
            return this.fetch(url, { ttl: this.config.defaultTTL });
        }

        async getCliente(id) {
            return this.fetch(`/api/clientes/${id}`, { ttl: this.config.defaultTTL });
        }

        // Fornecedores
        async getFornecedores(params = {}) {
            const query = new URLSearchParams(params).toString();
            const url = `/api/fornecedores${query ? '?' + query : ''}`;
            return this.fetch(url, { ttl: this.config.defaultTTL });
        }

        // Produtos
        async getProdutos(params = {}) {
            const query = new URLSearchParams(params).toString();
            const url = `/api/produtos${query ? '?' + query : ''}`;
            return this.fetch(url, { ttl: this.config.defaultTTL });
        }

        // Financeiro
        async getContasPagar(params = {}) {
            const query = new URLSearchParams(params).toString();
            const url = `/api/financeiro/contas-pagar${query ? '?' + query : ''}`;
            return this.fetch(url, { ttl: this.config.defaultTTL });
        }

        async getContasReceber(params = {}) {
            const query = new URLSearchParams(params).toString();
            const url = `/api/financeiro/contas-receber${query ? '?' + query : ''}`;
            return this.fetch(url, { ttl: this.config.defaultTTL });
        }

        async getBancos() {
            return this.fetch('/api/financeiro/bancos', { 
                ttl: this.config.staticDataTTL 
            });
        }

        // Vendas
        async getOrcamentos(params = {}) {
            const query = new URLSearchParams(params).toString();
            const url = `/api/vendas/orcamentos${query ? '?' + query : ''}`;
            return this.fetch(url, { ttl: this.config.defaultTTL });
        }

        async getPedidosVenda(params = {}) {
            const query = new URLSearchParams(params).toString();
            const url = `/api/vendas/pedidos${query ? '?' + query : ''}`;
            return this.fetch(url, { ttl: this.config.defaultTTL });
        }

        // Compras
        async getPedidosCompra(params = {}) {
            const query = new URLSearchParams(params).toString();
            const url = `/api/compras/pedidos${query ? '?' + query : ''}`;
            return this.fetch(url, { ttl: this.config.defaultTTL });
        }

        // PCP
        async getOrdensProducao(params = {}) {
            const query = new URLSearchParams(params).toString();
            const url = `/api/pcp/ordens${query ? '?' + query : ''}`;
            return this.fetch(url, { ttl: this.config.defaultTTL });
        }

        // RH
        async getFuncionarios(params = {}) {
            const query = new URLSearchParams(params).toString();
            const url = `/api/rh/funcionarios${query ? '?' + query : ''}`;
            return this.fetch(url, { ttl: this.config.defaultTTL });
        }

        // ============================================================
        // BATCH REQUESTS - Múltiplas requisições em paralelo
        // ============================================================

        async fetchAll(requests) {
            return Promise.all(
                requests.map(req => 
                    typeof req === 'string' 
                        ? this.fetch(req) 
                        : this.fetch(req.url, req.options)
                )
            );
        }

        async fetchAllSettled(requests) {
            return Promise.allSettled(
                requests.map(req => 
                    typeof req === 'string' 
                        ? this.fetch(req) 
                        : this.fetch(req.url, req.options)
                )
            );
        }

        // ============================================================
        // MUTATIONS (POST, PUT, DELETE)
        // ============================================================

        async post(url, data, options = {}) {
            const result = await this.fetch(url, { 
                ...options, 
                method: 'POST', 
                body: data,
                cache: false 
            });
            
            // Invalidar cache relacionado após mutation
            this._invalidateRelated(url);
            
            return result;
        }

        async put(url, data, options = {}) {
            const result = await this.fetch(url, { 
                ...options, 
                method: 'PUT', 
                body: data,
                cache: false 
            });
            
            this._invalidateRelated(url);
            
            return result;
        }

        async delete(url, options = {}) {
            const result = await this.fetch(url, { 
                ...options, 
                method: 'DELETE',
                cache: false 
            });
            
            this._invalidateRelated(url);
            
            return result;
        }

        _invalidateRelated(url) {
            // Extrair recurso base da URL
            const parts = url.split('/');
            const resource = parts.slice(0, 4).join('/'); // /api/resource
            this.invalidate(resource);
        }

        // ============================================================
        // ESTATÍSTICAS
        // ============================================================

        stats() {
            let active = 0;
            let expired = 0;
            const now = Date.now();

            for (const item of this.cache.values()) {
                if (now > item.expires) {
                    expired++;
                } else {
                    active++;
                }
            }

            return {
                cacheSize: this.cache.size,
                activeItems: active,
                expiredItems: expired,
                pendingRequests: this.pendingRequests.size,
                subscriptions: this.subscribers.size
            };
        }
    }

    // ============================================================
    // INSTNCIA GLOBAL
    // ============================================================
    
    window.AluforceData = new DataManager();

    console.log('✅ AluforceData Manager inicializado');
    console.log('📊 Uso: window.AluforceData.fetch(url) ou helpers como .getUser()');

})();
