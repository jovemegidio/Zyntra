/**
 * ALUFORCE - Loading Screen Controller
 * Sistema de controle da tela de carregamento para módulo RH
 * 
 * USO:
 * 1. Inclua este script antes do </body>
 * 2. Adicione o HTML do loading overlay no início do <body>
 * 3. Adicione id="app-container" ao container principal
 */

(function() {
    'use strict';
    
    // Função para esconder a tela de loading
    function hideLoadingScreen() {
        const loadingOverlay = document.getElementById('loading-overlay');
        const appContainer = document.getElementById('app-container');
        
        if (loadingOverlay && appContainer) {
            appContainer.classList.add('loaded');
            loadingOverlay.classList.add('hidden');
            
            // Remover o overlay do DOM após a animação
            setTimeout(function() {
                if (loadingOverlay.parentNode) {
                    loadingOverlay.parentNode.removeChild(loadingOverlay);
                }
            }, 500);
        }
    }
    
    // Verificar se Font Awesome carregou
    function checkFontAwesome() {
        var testElement = document.createElement('i');
        testElement.className = 'fas fa-check';
        testElement.style.cssText = 'position:absolute;left:-9999px;';
        document.body.appendChild(testElement);
        
        var computedStyle = window.getComputedStyle(testElement, ':before');
        var fontFamily = computedStyle.getPropertyValue('font-family');
        
        document.body.removeChild(testElement);
        return fontFamily.indexOf('Font Awesome') !== -1 || fontFamily.indexOf('FontAwesome') !== -1;
    }
    
    // Aguardar todos os recursos carregarem
    window.addEventListener('load', function() {
        var attempts = 0;
        var maxAttempts = 20;
        
        function checkAndHide() {
            attempts++;
            if (checkFontAwesome() || attempts >= maxAttempts) {
                // Pequeno delay adicional para garantir renderização suave
                setTimeout(hideLoadingScreen, 150);
            } else {
                setTimeout(checkAndHide, 100);
            }
        }
        
        checkAndHide();
    });
    
    // Fallback: esconder após timeout máximo de 4 segundos
    setTimeout(function() {
        hideLoadingScreen();
    }, 4000);
    
    // Expor função globalmente caso precise chamar manualmente
    window.hideLoadingScreen = hideLoadingScreen;
})();
