/**
 * Fix para o modal de configurações
 * Adiciona event delegation para tabs e cards
 */

(function() {
    'use strict';
    
    console.log('[Config Fix] Inicializando correções...');
    
    // Aguardar DOM estar pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initConfigFixes);
    } else {
        initConfigFixes();
    }
    
    function initConfigFixes() {
        console.log('[Config Fix] DOM pronto, aplicando correções...');
        
        // Event delegation para tabs do modal de configurações
        document.addEventListener('click', function(e) {
            // Tabs de navegação
            const tab = e.target.closest('.modal-config-tab');
            if (tab) {
                e.preventDefault();
                handleTabClick(tab);
                return;
            }
            
            // Cards de configuração
            const card = e.target.closest('.modal-config-card');
            if (card) {
                e.preventDefault();
                e.stopPropagation();
                handleCardClick(card);
                return;
            }
        }, true);
        
        // Event delegation para teclado (Enter/Space)
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                const tab = e.target.closest('.modal-config-tab');
                if (tab) {
                    e.preventDefault();
                    handleTabClick(tab);
                    return;
                }
                
                const card = e.target.closest('.modal-config-card');
                if (card) {
                    e.preventDefault();
                    handleCardClick(card);
                    return;
                }
            }
        });
        
        console.log('[Config Fix] Correções aplicadas com sucesso!');
    }
    
    function handleTabClick(tab) {
        const targetTab = tab.getAttribute('data-tab');
        console.log('[Config Fix] Tab clicada:', targetTab);
        
        if (!targetTab) {
            console.warn('[Config Fix] Tab sem data-tab');
            return;
        }
        
        const tabs = document.querySelectorAll('.modal-config-tab');
        const tabContents = document.querySelectorAll('.modal-config-tab-content');
        
        // Remove active de todas as tabs
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(content => {
            content.classList.remove('active');
            content.style.display = 'none';
        });
        
        // Adiciona active na tab clicada
        tab.classList.add('active');
        
        // Mostra o conteúdo correspondente
        const targetContent = document.getElementById('tab-' + targetTab);
        if (targetContent) {
            targetContent.classList.add('active');
            targetContent.style.display = 'block';
            console.log('[Config Fix] Conteúdo ativado:', 'tab-' + targetTab);
        } else {
            console.warn('[Config Fix] Conteúdo não encontrado:', 'tab-' + targetTab);
        }
    }
    
    function handleCardClick(card) {
        // Tenta pegar o tipo do onclick original
        const onclickAttr = card.getAttribute('onclick');
        let tipo = null;
        
        if (onclickAttr) {
            const match = onclickAttr.match(/abrirConfiguracao\(['"](.*?)['"]\)/);
            if (match) {
                tipo = match[1];
            }
        }
        
        console.log('[Config Fix] Card clicado, tipo:', tipo);
        
        if (tipo && typeof window.abrirConfiguracao === 'function') {
            window.abrirConfiguracao(tipo);
        } else if (tipo) {
            console.error('[Config Fix] Função abrirConfiguracao não disponível');
            // Tentar carregar o script
            const script = document.createElement('script');
            script.src = '/js/config-modals.js';
            script.onload = function() {
                if (typeof window.abrirConfiguracao === 'function') {
                    window.abrirConfiguracao(tipo);
                }
            };
            document.head.appendChild(script);
        } else {
            console.warn('[Config Fix] Tipo não encontrado no card');
        }
    }
    
    // Garantir que as tabs iniciais estejam corretas
    setTimeout(function() {
        const activeTab = document.querySelector('.modal-config-tab.active');
        const activeContent = document.querySelector('.modal-config-tab-content.active');
        
        if (activeTab && !activeContent) {
            const targetTab = activeTab.getAttribute('data-tab');
            const targetContent = document.getElementById('tab-' + targetTab);
            if (targetContent) {
                targetContent.classList.add('active');
                targetContent.style.display = 'block';
            }
        }
        
        // Garantir que conteúdos não ativos estejam ocultos
        document.querySelectorAll('.modal-config-tab-content:not(.active)').forEach(content => {
            content.style.display = 'none';
        });
    }, 500);
    
})();
