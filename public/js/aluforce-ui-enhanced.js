/**
 * ALUFORCE JavaScript Enhanced - Sistema de funcionalidades aprimoradas
 * Versão: 2.0
 * Data: 02/11/2025
 */

(function() {
    'use strict';
    
    console.log('🚀 ALUFORCE UI Enhanced carregado');

    // ============================================================================
    // CONFIGURAÇÕES GLOBAIS
    // ============================================================================
    const ALUFORCE_CONFIG = {
        animations: {
            duration: 250,
            easing: 'ease-in-out'
        },
        mobile: {
            breakpoint: 768
        },
        notifications: {
            duration: 4000
        }
    };

    // ============================================================================
    // UTILITÁRIOS GERAIS
    // ============================================================================
    const Utils = {
        // Verificar se é dispositivo móvel
        isMobile() {
            return window.innerWidth <= ALUFORCE_CONFIG.mobile.breakpoint;
        },

        // Debounce para otimizar performance
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        // Throttle para scroll/resize
        throttle(func, limit) {
            let inThrottle;
            return function() {
                const args = arguments;
                const context = this;
                if (!inThrottle) {
                    func.apply(context, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        },

        // Animações suaves
        animate(element, properties, duration = ALUFORCE_CONFIG.animations.duration) {
            return new Promise(resolve => {
                const start = performance.now();
                const initialValues = {};
                
                // Capturar valores iniciais
                Object.keys(properties).forEach(prop => {
                    initialValues[prop] = parseFloat(getComputedStyle(element)[prop]) || 0;
                });

                function step(timestamp) {
                    const elapsed = timestamp - start;
                    const progress = Math.min(elapsed / duration, 1);
                    
                    // Aplicar easing
                    const easedProgress = 1 - Math.pow(1 - progress, 3);
                    
                    Object.keys(properties).forEach(prop => {
                        const initial = initialValues[prop];
                        const target = properties[prop];
                        const current = initial + (target - initial) * easedProgress;
                        element.style[prop] = current + (prop.includes('opacity') ? '' : 'px');
                    });

                    if (progress < 1) {
                        requestAnimationFrame(step);
                    } else {
                        resolve();
                    }
                }
                
                requestAnimationFrame(step);
            });
        }
    };

    // ============================================================================
    // SISTEMA DE NOTIFICAÇÕES APRIMORADO
    // ============================================================================
    const NotificationSystem = {
        container: null,

        init() {
            if (!this.container) {
                this.container = document.createElement('div');
                this.container.className = 'notification-container';
                this.container.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 10000;
                    max-width: 400px;
                    pointer-events: none;
                `;
                document.body.appendChild(this.container);
            }
        },

        show(message, type = 'info', duration = ALUFORCE_CONFIG.notifications.duration) {
            this.init();
            
            const notification = document.createElement('div');
            notification.className = `notification notification-${type}`;
            notification.style.cssText = `
                background: var(--white);
                border: 1px solid var(--gray-200);
                border-left: 4px solid var(--${type === 'success' ? 'success' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info'});
                border-radius: var(--border-radius);
                padding: var(--spacing-md);
                margin-bottom: var(--spacing-sm);
                box-shadow: var(--shadow-lg);
                transform: translateX(100%);
                transition: transform var(--transition-normal);
                pointer-events: auto;
                cursor: pointer;
            `;

            const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
            notification.innerHTML = `
                <div style="display: flex; align-items: center; gap: var(--spacing-sm);">
                    <span style="font-size: 1.2em;">${icon}</span>
                    <span style="flex: 1;">${message}</span>
                    <button style="background: none; border: none; cursor: pointer; opacity: 0.5;">×</button>
                </div>
            `;

            this.container.appendChild(notification);

            // Animação de entrada
            requestAnimationFrame(() => {
                notification.style.transform = 'translateX(0)';
            });

            // Auto-remove
            const autoRemove = setTimeout(() => {
                this.remove(notification);
            }, duration);

            // Remover ao clicar
            notification.addEventListener('click', () => {
                clearTimeout(autoRemove);
                this.remove(notification);
            });
        },

        remove(notification) {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 250);
        },

        success(message) { this.show(message, 'success'); },
        error(message) { this.show(message, 'error'); },
        warning(message) { this.show(message, 'warning'); },
        info(message) { this.show(message, 'info'); }
    };

    // ============================================================================
    // SIDEBAR MOBILE APRIMORADA
    // ============================================================================
    const SidebarMobile = {
        sidebar: null,
        overlay: null,
        isOpen: false,

        init() {
            this.createOverlay();
            this.bindEvents();
        },

        createOverlay() {
            if (!this.overlay) {
                this.overlay = document.createElement('div');
                this.overlay.className = 'sidebar-overlay';
                document.body.appendChild(this.overlay);
                
                this.overlay.addEventListener('click', () => {
                    this.close();
                });
            }
        },

        bindEvents() {
            // Toggle buttons
            document.addEventListener('click', (e) => {
                if (e.target.matches('.mobile-menu-toggle, .mobile-menu-toggle *')) {
                    e.preventDefault();
                    this.toggle();
                }
            });

            // Escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isOpen) {
                    this.close();
                }
            });

            // Resize handler
            window.addEventListener('resize', Utils.throttle(() => {
                if (!Utils.isMobile() && this.isOpen) {
                    this.close();
                }
            }, 250));
        },

        toggle() {
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        },

        open() {
            if (this.isOpen) return;
            
            this.sidebar = document.querySelector('.sidebar, .sidebar-mobile-enhanced');
            if (!this.sidebar) return;

            this.isOpen = true;
            this.sidebar.classList.add('open');
            this.overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        },

        close() {
            if (!this.isOpen) return;
            
            this.isOpen = false;
            if (this.sidebar) {
                this.sidebar.classList.remove('open');
            }
            this.overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    };

    // ============================================================================
    // LOADING STATES APRIMORADOS
    // ============================================================================
    const LoadingSystem = {
        create(text = 'Carregando...') {
            const loader = document.createElement('div');
            loader.className = 'loading-enhanced';
            loader.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; gap: var(--spacing-sm); padding: var(--spacing-lg);">
                    <div style="width: 20px; height: 20px; border: 2px solid var(--gray-200); border-top: 2px solid var(--aluforce-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <span>${text}</span>
                </div>
            `;
            return loader;
        },

        showInElement(element, text) {
            const loader = this.create(text);
            element.appendChild(loader);
            return loader;
        },

        remove(loader) {
            if (loader && loader.parentNode) {
                loader.parentNode.removeChild(loader);
            }
        }
    };

    // ============================================================================
    // FORM ENHANCEMENTS
    // ============================================================================
    const FormEnhancements = {
        init() {
            this.enhanceInputs();
            this.setupValidation();
        },

        enhanceInputs() {
            document.querySelectorAll('input, textarea, select').forEach(input => {
                if (!input.classList.contains('enhanced')) {
                    input.classList.add('input-enhanced', 'enhanced');
                    
                    // Floating labels
                    if (input.placeholder && !input.parentNode.querySelector('.floating-label')) {
                        this.addFloatingLabel(input);
                    }
                }
            });
        },

        addFloatingLabel(input) {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'position: relative;';
            
            const label = document.createElement('label');
            label.textContent = input.placeholder;
            label.style.cssText = `
                position: absolute;
                left: 12px;
                top: 50%;
                transform: translateY(-50%);
                background: var(--white);
                padding: 0 4px;
                color: var(--gray-400);
                transition: all var(--transition-fast);
                pointer-events: none;
                font-size: var(--font-size-sm);
            `;
            label.className = 'floating-label';

            input.parentNode.insertBefore(wrapper, input);
            wrapper.appendChild(input);
            wrapper.appendChild(label);

            const updateLabel = () => {
                if (input.value || input === document.activeElement) {
                    label.style.top = '0';
                    label.style.fontSize = 'var(--font-size-xs)';
                    label.style.color = 'var(--aluforce-primary)';
                } else {
                    label.style.top = '50%';
                    label.style.fontSize = 'var(--font-size-sm)';
                    label.style.color = 'var(--gray-400)';
                }
            };

            input.addEventListener('focus', updateLabel);
            input.addEventListener('blur', updateLabel);
            input.addEventListener('input', updateLabel);
            
            updateLabel();
        },

        setupValidation() {
            document.addEventListener('submit', (e) => {
                const form = e.target;
                if (form.tagName === 'FORM') {
                    this.validateForm(form);
                }
            });
        },

        validateForm(form) {
            const inputs = form.querySelectorAll('input[required], textarea[required], select[required]');
            let isValid = true;

            inputs.forEach(input => {
                if (!input.value.trim()) {
                    this.showFieldError(input, 'Este campo é obrigatório');
                    isValid = false;
                } else {
                    this.clearFieldError(input);
                }
            });

            return isValid;
        },

        showFieldError(input, message) {
            this.clearFieldError(input);
            
            input.classList.add('error');
            const error = document.createElement('div');
            error.className = 'field-error';
            error.textContent = message;
            error.style.cssText = `
                color: var(--error);
                font-size: var(--font-size-xs);
                margin-top: var(--spacing-xs);
            `;
            
            input.parentNode.appendChild(error);
        },

        clearFieldError(input) {
            input.classList.remove('error');
            const error = input.parentNode.querySelector('.field-error');
            if (error) {
                error.remove();
            }
        }
    };

    // ============================================================================
    // LAZY LOADING PARA IMAGENS
    // ============================================================================
    const LazyLoading = {
        observer: null,

        init() {
            if ('IntersectionObserver' in window) {
                this.observer = new IntersectionObserver(
                    this.handleIntersection.bind(this),
                    { rootMargin: '50px' }
                );
                
                this.observeImages();
            }
        },

        observeImages() {
            document.querySelectorAll('img[data-src]').forEach(img => {
                this.observer.observe(img);
            });
        },

        handleIntersection(entries) {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                    this.observer.unobserve(img);
                }
            });
        }
    };

    // ============================================================================
    // PERFORMANCE MONITOR
    // ============================================================================
    const PerformanceMonitor = {
        init() {
            this.monitorPageLoad();
            this.monitorInteractions();
        },

        monitorPageLoad() {
            window.addEventListener('load', () => {
                if ('performance' in window) {
                    const timing = performance.timing;
                    const loadTime = timing.loadEventEnd - timing.navigationStart;
                    
                    if (loadTime > 3000) {
                        console.warn(`⚠️ Página carregou em ${loadTime}ms (>3s)`);
                    } else {
                        console.log(`✅ Página carregou em ${loadTime}ms`);
                    }
                }
            });
        },

        monitorInteractions() {
            let interactionCount = 0;
            document.addEventListener('click', () => {
                interactionCount++;
                if (interactionCount % 50 === 0) {
                    console.log(`📊 ${interactionCount} interações registradas`);
                }
            });
        }
    };

    // ============================================================================
    // DARK MODE TOGGLE
    // ============================================================================
    const DarkModeToggle = {
        init() {
            this.setupToggle();
            this.applyStoredTheme();
        },

        setupToggle() {
            document.addEventListener('click', (e) => {
                if (e.target.matches('#btn-dark-mode-toggle, #btn-dark-mode-toggle *')) {
                    e.preventDefault();
                    this.toggle();
                }
            });
        },

        toggle() {
            const current = document.documentElement.getAttribute('data-theme');
            const newTheme = current === 'dark' ? 'light' : 'dark';
            
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            
            // Atualizar ícone
            const icon = document.querySelector('#dark-mode-icon');
            if (icon) {
                icon.className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
            
            NotificationSystem.info(`Tema ${newTheme === 'dark' ? 'escuro' : 'claro'} ativado`);
        },

        applyStoredTheme() {
            const stored = localStorage.getItem('theme');
            const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            const theme = stored || system;
            
            document.documentElement.setAttribute('data-theme', theme);
            
            // Atualizar ícone
            const icon = document.querySelector('#dark-mode-icon');
            if (icon) {
                icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }
    };

    // ============================================================================
    // INICIALIZAÇÁO
    // ============================================================================
    function init() {
        // Aguardar DOM
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        console.log('🎨 Inicializando ALUFORCE UI Enhanced...');

        // Inicializar componentes
        NotificationSystem.init();
        SidebarMobile.init();
        FormEnhancements.init();
        LazyLoading.init();
        PerformanceMonitor.init();
        DarkModeToggle.init();

        // Adicionar CSS de animação para spin
        if (!document.querySelector('#aluforce-animations')) {
            const style = document.createElement('style');
            style.id = 'aluforce-animations';
            style.textContent = `
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        // Expor APIs globais
        window.AluforceUI = {
            notify: NotificationSystem,
            utils: Utils,
            loading: LoadingSystem,
            forms: FormEnhancements,
            sidebar: SidebarMobile,
            darkMode: DarkModeToggle
        };

        console.log('✅ ALUFORCE UI Enhanced inicializado');
        NotificationSystem.success('Sistema de UI aprimorado carregado!');
    }

    // Auto-inicializar
    init();

})();