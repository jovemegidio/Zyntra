/**
 * ALUFORCE - Cache e Otimização do Módulo Financeiro
 * Reduz chamadas à API e melhora performance de carregamento
 */

(function() {
    'use strict';

    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos
    const cache = {};

    // Função para buscar dados com cache
    window.fetchComCache = async function(url, options = {}) {
        const cacheKey = url;
        const now = Date.now();
        
        // Verificar se há cache válido
        if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_DURATION) {
            console.log('[Cache] Usando cache para:', url);
            return cache[cacheKey].data;
        }

        // Fazer requisição
        try {
            const response = await fetch(url, {
                credentials: 'include',
                ...options
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // Salvar no cache
                cache[cacheKey] = {
                    data: data,
                    timestamp: now
                };
                
                console.log('[Cache] Dados armazenados para:', url);
                return data;
            }
            
            throw new Error('Erro na requisição');
        } catch (error) {
            console.error('[Cache] Erro ao buscar:', url, error);
            
            // Se tiver cache antigo, usar mesmo assim
            if (cache[cacheKey]) {
                console.log('[Cache] Usando cache antigo para:', url);
                return cache[cacheKey].data;
            }
            
            throw error;
        }
    };

    // Invalidar cache específico
    window.invalidarCache = function(url) {
        if (url) {
            delete cache[url];
            console.log('[Cache] Cache invalidado para:', url);
        } else {
            // Invalidar todo o cache
            Object.keys(cache).forEach(key => delete cache[key]);
            console.log('[Cache] Todo o cache foi invalidado');
        }
    };

    // Pré-carregar dados comuns do Financeiro
    window.precarregarDadosFinanceiro = async function() {
        console.log('[Financeiro] Pré-carregando dados...');
        
        const endpoints = [
            '/api/financeiro/contas-bancarias',
            '/api/financeiro/resumo',
            '/api/financeiro/contas-receber/resumo',
            '/api/financeiro/contas-pagar/resumo'
        ];

        // Carregar todos em paralelo
        const promises = endpoints.map(endpoint => {
            return fetchComCache(endpoint).catch(e => {
                console.warn('[Financeiro] Erro ao pré-carregar:', endpoint);
                return null;
            });
        });

        await Promise.allSettled(promises);
        console.log('[Financeiro] Pré-carregamento concluído');
    };

    // Iniciar pré-carregamento quando a página carregar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            // Aguardar um pouco para não competir com a renderização inicial
            setTimeout(precarregarDadosFinanceiro, 100);
        });
    } else {
        setTimeout(precarregarDadosFinanceiro, 100);
    }

    // Exportar funções
    window.FinanceiroCache = {
        fetch: fetchComCache,
        invalidar: invalidarCache,
        precarregar: precarregarDadosFinanceiro
    };
})();
