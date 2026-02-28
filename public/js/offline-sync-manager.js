/**
 * ALUFORCE - Offline Sync Manager
 * Sistema de cache local + sincronização com servidor
 * 
 * DESABILITADO - PWA/Offline não é mais utilizado
 */

// PWA/Offline DESABILITADO - Este arquivo não faz mais nada
const OfflineSyncManager = (function() {
    'use strict';
    
    // Retorna objeto vazio - funcionalidade desabilitada
    console.log('[OfflineSyncManager] PWA/Offline está desabilitado');
    return {
        init: function() { return Promise.resolve(); },
        isOnline: function() { return true; },
        sync: function() { return Promise.resolve(); },
        clearCache: function() { return Promise.resolve(); },
        getStatus: function() { return { enabled: false, reason: 'PWA desabilitado' }; }
    };
})();

// Expor globalmente como objeto vazio
window.OfflineSyncManager = OfflineSyncManager;

// CÓDIGO ORIGINAL REMOVIDO - Comentário grande não executável foi apagado para evitar erros de sintaxe
