/**
 * ALUFORCE - Mobile Orientation Handler
 * Detecta e gerencia orientação do dispositivo (Portrait/Landscape)
 * Versão: 1.0 - Janeiro 2026
 */

(function() {
    'use strict';

    // Verificar se já foi inicializado
    if (window.AluforceOrientationHandler) return;

    const OrientationHandler = {
        // Estado atual
        currentOrientation: null,
        isTouch: false,
        isMobile: false,
        isTablet: false,
        
        // Breakpoints
        breakpoints: {
            mobile: 767,
            tablet: 1024,
            landscapeHeight: 500
        },

        /**
         * Inicialização
         */
        init() {
            this.detectDevice();
            this.detectOrientation();
            this.bindEvents();
            this.applyOrientationClass();
            
            console.log('[ALUFORCE] Orientation Handler inicializado:', {
                orientation: this.currentOrientation,
                isMobile: this.isMobile,
                isTablet: this.isTablet
            });
        },

        /**
         * Detectar tipo de dispositivo
         */
        detectDevice() {
            this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            
            const width = window.innerWidth;
            const height = window.innerHeight;
            
            this.isMobile = width <= this.breakpoints.mobile || 
                           (height <= this.breakpoints.landscapeHeight && this.isTouch);
            
            this.isTablet = width > this.breakpoints.mobile && 
                           width <= this.breakpoints.tablet && 
                           this.isTouch;
        },

        /**
         * Detectar orientação atual
         */
        detectOrientation() {
            const width = window.innerWidth;
            const height = window.innerHeight;
            
            // Usar screen.orientation se disponível
            if (screen.orientation && screen.orientation.type) {
                this.currentOrientation = screen.orientation.type.includes('portrait') 
                    ? 'portrait' 
                    : 'landscape';
            } else {
                // Fallback para comparação de dimensões
                this.currentOrientation = height > width ? 'portrait' : 'landscape';
            }
            
            return this.currentOrientation;
        },

        /**
         * Aplicar classes de orientação no body
         */
        applyOrientationClass() {
            const body = document.body;
            const html = document.documentElement;
            
            // Remover classes antigas
            body.classList.remove('orientation-portrait', 'orientation-landscape');
            body.classList.remove('device-mobile', 'device-tablet', 'device-desktop');
            html.classList.remove('orientation-portrait', 'orientation-landscape');
            
            // Adicionar orientação atual
            body.classList.add(`orientation-${this.currentOrientation}`);
            html.classList.add(`orientation-${this.currentOrientation}`);
            
            // Adicionar tipo de dispositivo
            if (this.isMobile) {
                body.classList.add('device-mobile');
            } else if (this.isTablet) {
                body.classList.add('device-tablet');
            } else {
                body.classList.add('device-desktop');
            }
            
            // Adicionar classe para touch
            if (this.isTouch) {
                body.classList.add('touch-device');
            }
            
            // Data attributes para CSS
            body.dataset.orientation = this.currentOrientation;
            body.dataset.device = this.isMobile ? 'mobile' : (this.isTablet ? 'tablet' : 'desktop');
        },

        /**
         * Vincular eventos
         */
        bindEvents() {
            // Evento de mudança de orientação
            if (screen.orientation) {
                screen.orientation.addEventListener('change', () => {
                    this.handleOrientationChange();
                });
            }
            
            // Fallback com resize
            let resizeTimeout;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    this.handleResize();
                }, 100);
            });
            
            // Evento legado (orientationchange)
            window.addEventListener('orientationchange', () => {
                setTimeout(() => {
                    this.handleOrientationChange();
                }, 100);
            });
        },

        /**
         * Handler para mudança de orientação
         */
        handleOrientationChange() {
            const previousOrientation = this.currentOrientation;
            this.detectDevice();
            this.detectOrientation();
            
            if (previousOrientation !== this.currentOrientation) {
                this.applyOrientationClass();
                this.adjustModalsForOrientation();
                this.dispatchOrientationEvent();
                
                console.log('[ALUFORCE] Orientação alterada:', {
                    de: previousOrientation,
                    para: this.currentOrientation
                });
            }
        },

        /**
         * Handler para resize
         */
        handleResize() {
            const previousOrientation = this.currentOrientation;
            this.detectDevice();
            this.detectOrientation();
            
            if (previousOrientation !== this.currentOrientation) {
                this.applyOrientationClass();
                this.adjustModalsForOrientation();
                this.dispatchOrientationEvent();
            }
        },

        /**
         * Ajustar modais abertos para nova orientação
         */
        adjustModalsForOrientation() {
            const openModals = document.querySelectorAll(
                '.modal.show, .modal.active, .popup.show, .popup.active, ' +
                '.dialog.show, .drawer.open, .side-panel.open'
            );
            
            openModals.forEach(modal => {
                const content = modal.querySelector('.modal-content, .popup-content, .dialog-content');
                if (content) {
                    // Forçar recálculo de layout
                    content.style.display = 'none';
                    content.offsetHeight; // Trigger reflow
                    content.style.display = '';
                    
                    // Ajustar scroll para o topo do body
                    const body = content.querySelector('.modal-body, .popup-body');
                    if (body) {
                        body.scrollTop = 0;
                    }
                }
            });
        },

        /**
         * Disparar evento customizado
         */
        dispatchOrientationEvent() {
            const event = new CustomEvent('aluforce:orientationchange', {
                detail: {
                    orientation: this.currentOrientation,
                    isMobile: this.isMobile,
                    isTablet: this.isTablet,
                    width: window.innerWidth,
                    height: window.innerHeight
                }
            });
            
            window.dispatchEvent(event);
            document.dispatchEvent(event);
        },

        /**
         * Verificar se está em modo landscape
         */
        isLandscape() {
            return this.currentOrientation === 'landscape';
        },

        /**
         * Verificar se está em modo portrait
         */
        isPortrait() {
            return this.currentOrientation === 'portrait';
        },

        /**
         * Obter informações do dispositivo
         */
        getDeviceInfo() {
            return {
                orientation: this.currentOrientation,
                isMobile: this.isMobile,
                isTablet: this.isTablet,
                isTouch: this.isTouch,
                width: window.innerWidth,
                height: window.innerHeight,
                pixelRatio: window.devicePixelRatio || 1
            };
        }
    };

    // Inicializar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            OrientationHandler.init();
        });
    } else {
        OrientationHandler.init();
    }

    // Expor globalmente
    window.AluforceOrientationHandler = OrientationHandler;

    // Função helper global
    window.getDeviceOrientation = function() {
        return OrientationHandler.currentOrientation;
    };

    window.isMobileDevice = function() {
        return OrientationHandler.isMobile || OrientationHandler.isTablet;
    };

})();

/**
 * Modal Orientation Adjustments
 * Ajustes automáticos para modais em diferentes orientações
 */
(function() {
    'use strict';

    const ModalOrientationAdjuster = {
        
        /**
         * Inicialização
         */
        init() {
            this.observeModals();
            this.bindOrientationEvent();
        },

        /**
         * Observar abertura de modais
         */
        observeModals() {
            // Observer para detectar quando modais são abertos
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && 
                        (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
                        const target = mutation.target;
                        if (target.classList.contains('show') || target.classList.contains('active')) {
                            this.adjustModalLayout(target);
                        }
                    }
                });
            });

            // Observar body para novos modais
            observer.observe(document.body, {
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style']
            });
        },

        /**
         * Vincular evento de orientação
         */
        bindOrientationEvent() {
            window.addEventListener('aluforce:orientationchange', (e) => {
                this.handleOrientationChange(e.detail);
            });
        },

        /**
         * Ajustar layout do modal
         */
        adjustModalLayout(modal) {
            if (!window.AluforceOrientationHandler) return;
            
            const info = window.AluforceOrientationHandler.getDeviceInfo();
            const content = modal.querySelector('.modal-content, .popup-content');
            
            if (!content) return;
            
            // Em landscape mobile, garantir que o footer dos botões esteja visível
            if (info.orientation === 'landscape' && info.isMobile) {
                const footer = content.querySelector('.modal-footer, .popup-footer');
                const body = content.querySelector('.modal-body, .popup-body');
                
                if (footer && body) {
                    const footerHeight = footer.offsetHeight || 52;
                    body.style.paddingBottom = (footerHeight + 10) + 'px';
                }
            }
        },

        /**
         * Handler para mudança de orientação
         */
        handleOrientationChange(detail) {
            const openModals = document.querySelectorAll(
                '.modal.show, .modal.active, .popup.show, .popup.active'
            );
            
            openModals.forEach(modal => {
                this.adjustModalLayout(modal);
            });
        }
    };

    // Inicializar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ModalOrientationAdjuster.init();
        });
    } else {
        ModalOrientationAdjuster.init();
    }

})();
