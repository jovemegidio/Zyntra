/**
 * ALUFORCE - Sistema de Permissões do Módulo Financeiro
 * Gerencia a visibilidade de itens da sidebar baseado nas permissões do usuário
 */

(function() {
    'use strict';

    // Executar verificação de acesso IMEDIATAMENTE (antes do DOM)
    verificarAcessoImediato();

    // Aguardar o carregamento do DOM e aplicar permissões na sidebar
    document.addEventListener('DOMContentLoaded', function() {
        // Carregar permissões e aplicar na sidebar
        carregarEAplicarPermissoesSidebar();
    });

    function verificarAcessoImediato() {
        // Buscar permissões do servidor imediatamente
        fetch('/api/financeiro/permissoes', { credentials: 'include' })
            .then(resp => {
                if (!resp.ok) {
                    console.log('[FinanceiroPermissions] Erro ao buscar permissões:', resp.status);
                    return null;
                }
                return resp.json();
            })
            .then(data => {
                if (data && data.permissoes) {
                    const perms = data.permissoes;
                    const pathname = window.location.pathname.toLowerCase();
                    
                    console.log('[FinanceiroPermissions] Permissões do servidor:', perms);
                    
                    // Salvar permissões para uso posterior
                    window.financeiroPermissoes = perms;
                    
                    // Verificar acesso à página atual
                    if (pathname.includes('contas_pagar') && !perms.contas_pagar) {
                        console.log('[FinanceiroPermissions] Usuário sem acesso a Contas a Pagar');
                        redirecionarParaPaginaPermitidaAPI(perms);
                    }
                    if (pathname.includes('contas_receber') && !perms.contas_receber) {
                        console.log('[FinanceiroPermissions] Usuário sem acesso a Contas a Receber');
                        redirecionarParaPaginaPermitidaAPI(perms);
                    }
                    
                    // Aplicar na sidebar se o DOM já estiver pronto
                    if (document.readyState !== 'loading') {
                        aplicarPermissoesSidebar(perms);
                    }
                }
            })
            .catch(err => {
                console.error('[FinanceiroPermissions] Erro:', err);
            });
    }

    function redirecionarParaPaginaPermitidaAPI(perms) {
        // Redirecionar para a primeira página que o usuário tem acesso
        if (perms.contas_receber) {
            window.location.href = 'contas_receber.html';
        } else if (perms.contas_pagar) {
            window.location.href = 'contas_pagar.html';
        } else if (perms.fluxo_caixa) {
            window.location.href = 'fluxo_caixa.html';
        } else {
            window.location.href = 'index.html';
        }
    }

    async function carregarEAplicarPermissoesSidebar() {
        try {
            // Usar permissões já carregadas ou buscar novamente
            if (window.financeiroPermissoes) {
                aplicarPermissoesSidebar(window.financeiroPermissoes);
                return;
            }

            // Buscar do servidor
            const resp = await fetch('/api/financeiro/permissoes', { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.permissoes) {
                    window.financeiroPermissoes = data.permissoes;
                    aplicarPermissoesSidebar(data.permissoes);
                }
            }
        } catch (e) {
            console.error('[FinanceiroPermissions] Erro:', e);
        }
    }

    function aplicarPermissoesSidebar(perms) {
        console.log('[FinanceiroPermissions] Aplicando permissões na sidebar:', perms);

        // Esconder itens da sidebar baseado nas permissões (usando IDs)
        ocultarItemSeNaoTemPermissao('menu-contas-receber', perms.contas_receber);
        ocultarItemSeNaoTemPermissao('menu-contas-pagar', perms.contas_pagar);
        ocultarItemSeNaoTemPermissao('menu-fluxo-caixa', perms.fluxo_caixa);
        ocultarItemSeNaoTemPermissao('menu-bancos', perms.bancos);
        ocultarItemSeNaoTemPermissao('menu-conciliacao', perms.conciliacao !== false); // default true
        ocultarItemSeNaoTemPermissao('menu-relatorios', perms.relatorios);

        // Também tentar por href se os IDs não existirem
        ocultarLinkPorHref('contas_receber.html', perms.contas_receber);
        ocultarLinkPorHref('contas_pagar.html', perms.contas_pagar);
        ocultarLinkPorHref('fluxo_caixa.html', perms.fluxo_caixa);
        ocultarLinkPorHref('contas_bancarias.html', perms.bancos);
        ocultarLinkPorHref('conciliacao_bancaria.html', perms.conciliacao !== false);
        ocultarLinkPorHref('relatorios.html', perms.relatorios);
    }

    function ocultarItemSeNaoTemPermissao(id, temPermissao) {
        const item = document.getElementById(id);
        if (item && !temPermissao) {
            item.style.display = 'none';
            console.log('[FinanceiroPermissions] Ocultando item:', id);
        }
    }

    function ocultarLinkPorHref(href, temPermissao) {
        if (temPermissao) return;
        
        const links = document.querySelectorAll('.sidebar-nav a[href*="' + href + '"]');
        links.forEach(link => {
            const li = link.closest('li');
            if (li) {
                li.style.display = 'none';
                console.log('[FinanceiroPermissions] Ocultando link:', href);
            }
        });
    }

    // Exportar para uso global
    window.FinanceiroPermissions = {
        aplicar: aplicarPermissoesSidebar,
        carregar: carregarEAplicarPermissoesSidebar
    };
})();
