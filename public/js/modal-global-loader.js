/**
 * ALUFORCE - Modal Global Auto-Loader
 * Injeta automaticamente o CSS de upgrade visual para modais
 * Este script deve ser incluído no final de cada página
 */
(function() {
    'use strict';
    
    // Verificar se já foi carregado
    if (document.querySelector('link[href*="modal-global-upgrade.css"]')) {
        return;
    }
    
    // Criar e injetar o link do CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/modal-global-upgrade.css?v=' + Date.now();
    link.id = 'modal-global-upgrade-css';
    
    // Inserir no head
    document.head.appendChild(link);
    
    console.log('✨ Modal Global Upgrade CSS loaded');
})();
