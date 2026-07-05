/**
 * ALUFORCE - Mobile Auto Enhancement
 * Detecta dispositivos móveis e aplica melhorias automáticas de UI/UX
 * @version 20260202
 */
(function() {
    'use strict';

    // Detectar tipo de dispositivo
    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    var isTablet = /iPad|Android(?!.*Mobile)/i.test(navigator.userAgent) || 
                   (navigator.maxTouchPoints > 1 && window.innerWidth >= 768);
    var isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Aplicar classes ao body
    if (isMobile) document.documentElement.classList.add('is-mobile');
    if (isTablet) document.documentElement.classList.add('is-tablet');
    if (isTouchDevice) document.documentElement.classList.add('is-touch');

    // Prevenir zoom indesejado em inputs no iOS
    function preventInputZoom() {
        if (!isMobile) return;

        var metaViewport = document.querySelector('meta[name="viewport"]');
        if (metaViewport) {
            // Garantir que viewport não force zoom
            var content = metaViewport.getAttribute('content') || '';
            if (content.indexOf('maximum-scale') === -1) {
                // Não adicionar maximum-scale para manter acessibilidade
            }
        }

        // Ajustar font-size de inputs para evitar zoom automático no iOS
        var style = document.createElement('style');
        style.textContent = [
            '.is-mobile input[type="text"],',
            '.is-mobile input[type="email"],',
            '.is-mobile input[type="password"],',
            '.is-mobile input[type="number"],',
            '.is-mobile input[type="tel"],',
            '.is-mobile input[type="date"],',
            '.is-mobile input[type="search"],',
            '.is-mobile select,',
            '.is-mobile textarea {',
            '    font-size: 16px !important;',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // Melhorar áreas de toque
    function enhanceTouchTargets() {
        if (!isTouchDevice) return;

        var style = document.createElement('style');
        style.textContent = [
            '.is-touch button:not(.no-touch-enhance),',
            '.is-touch .btn:not(.no-touch-enhance),',
            '.is-touch [role="button"]:not(.no-touch-enhance) {',
            '    min-height: 44px;',
            '    min-width: 44px;',
            '}',
            '.is-touch a { -webkit-tap-highlight-color: transparent; }',
            '.is-touch { -webkit-touch-callout: none; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    // Ajustar tabelas para scroll horizontal em mobile
    function enhanceTables() {
        if (!isMobile && !isTablet) return;

        var tables = document.querySelectorAll('table:not(.no-responsive)');
        tables.forEach(function(table) {
            if (!table.parentElement.classList.contains('table-responsive')) {
                var wrapper = document.createElement('div');
                wrapper.className = 'table-responsive';
                wrapper.style.overflowX = 'auto';
                wrapper.style.webkitOverflowScrolling = 'touch';
                wrapper.style.width = '100%';
                table.parentNode.insertBefore(wrapper, table);
                wrapper.appendChild(table);
            }
        });
    }

    // Melhorar modais em mobile
    function enhanceModals() {
        if (!isMobile) return;

        var style = document.createElement('style');
        style.textContent = [
            '@media (max-width: 768px) {',
            '    .modal-content, .saas-modal-body, [class*="modal"] > div {',
            '        max-height: 90vh;',
            '        overflow-y: auto;',
            '        -webkit-overflow-scrolling: touch;',
            '    }',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // Inicializar quando o DOM estiver pronto
    function init() {
        preventInputZoom();
        enhanceTouchTargets();
        enhanceTables();
        enhanceModals();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
