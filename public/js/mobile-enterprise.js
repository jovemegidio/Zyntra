/**
 * Mobile Enterprise Enhancements
 * Melhorias de usabilidade para dispositivos móveis e tablets
 * @version 20260202
 */

(function() {
    'use strict';

    // Detectar se é dispositivo móvel
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isTablet = /iPad|Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent);

    // Adicionar classe ao body para estilos específicos
    if (isMobile) {
        document.body.classList.add('is-mobile');
    }
    if (isTablet) {
        document.body.classList.add('is-tablet');
    }

    // Melhorias de touch para botões
    function enhanceTouchTargets() {
        const buttons = document.querySelectorAll('button, .btn, [role="button"]');
        buttons.forEach(btn => {
            // Garantir área de toque mínima de 44px
            const rect = btn.getBoundingClientRect();
            if (rect.height < 44 || rect.width < 44) {
                btn.style.minHeight = '44px';
                btn.style.minWidth = '44px';
            }
        });
    }

    // Melhorar scroll em tabelas para mobile
    function enhanceTableScroll() {
        const tables = document.querySelectorAll('table');
        tables.forEach(table => {
            if (!table.parentElement.classList.contains('table-responsive')) {
                const wrapper = document.createElement('div');
                wrapper.className = 'table-responsive';
                wrapper.style.overflowX = 'auto';
                wrapper.style.webkitOverflowScrolling = 'touch';
                table.parentNode.insertBefore(wrapper, table);
                wrapper.appendChild(table);
            }
        });
    }

    // Fechar modais ao clicar fora (touch)
    function enhanceModals() {
        document.addEventListener('touchend', function(e) {
            if (e.target.classList.contains('modal-overlay') ||
                e.target.classList.contains('modal-backdrop')) {
                e.target.click();
            }
        });
    }

    // Prevenir zoom acidental em inputs
    function preventInputZoom() {
        const inputs = document.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            if (parseFloat(getComputedStyle(input).fontSize) < 16) {
                input.style.fontSize = '16px';
            }
        });
    }

    // Inicializar quando DOM estiver pronto
    function init() {
        if (isMobile || isTablet) {
            enhanceTouchTargets();
            enhanceTableScroll();
            enhanceModals();
            preventInputZoom();
        }

        console.log('[MobileEnterprise] Initialized', { isMobile, isTablet });
    }

    // Aguardar DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
