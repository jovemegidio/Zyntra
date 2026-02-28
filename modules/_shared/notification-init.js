;/**
 * Inicializador de Notificações para Módulos
 * Inclua este script em qualquer módulo para habilitar o sistema de notificações
 */

(function() {
    'use strict';
    
    // Verificar se o NotificationManager já existe
    if (typeof NotificationManager !== 'undefined') {
        console.log('[ModuleNotif] NotificationManager já carregado');
        return;
    }
    
    // Carregar o NotificationManager dinamicamente
    const script = document.createElement('script');
    script.src = '/js/notification-manager.js';
    script.onload = function() {
        console.log('[ModuleNotif] NotificationManager carregado dinamicamente');
        
        // Configurar o botão de notificações se existir
        setupNotificationButton();
    };
    script.onerror = function() {
        console.error('[ModuleNotif] Erro ao carregar NotificationManager');
    };
    document.head.appendChild(script);
    
    function setupNotificationButton() {
        // Procurar por botões de notificação existentes
        const notifButtons = document.querySelectorAll(
            '.notification-btn, ' +
            '#notification-bell, ' +
            '#notifications-btn, ' +
            '[title="Notificações"], ' +
            'button:has(.fa-bell)'
        );
        
        notifButtons.forEach(btn => {
            // Remover onclick existente
            btn.removeAttribute('onclick');
            
            // Adicionar novo listener
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.togglePanel();
                } else {
                    console.warn('[ModuleNotif] NotificationManager não disponível');
                }
            });
            
            // Adicionar estilo de posição relativa se não tiver
            if (getComputedStyle(btn).position === 'static') {
                btn.style.position = 'relative';
            }
        });
        
        console.log('[ModuleNotif] ✅', notifButtons.length, 'botões configurados');
    }
    
    // Quando o DOM estiver pronto, configurar botões
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupNotificationButton);
    } else {
        setTimeout(setupNotificationButton, 100);
    }
})();
