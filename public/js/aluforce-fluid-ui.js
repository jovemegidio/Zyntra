/**
 * ============================================================
 * ALUFORCE - SISTEMA DE UI FLUIDO
 * Utilitários para melhorar a fluidez visual e funcional
 * ============================================================
 */

(function() {
    'use strict';

    // ============================================================
    // 1. CONFIGURAÇÕES GLOBAIS
    // ============================================================
    const CONFIG = {
        ripple: {
            enabled: true,
            duration: 600,
            color: 'rgba(255, 255, 255, 0.4)'
        },
        toast: {
            duration: 4000,
            position: 'top-right',
            maxVisible: 5
        },
        skeleton: {
            minDuration: 300 // Duração mínima para evitar flash
        },
        transitions: {
            fast: 150,
            normal: 200,
            slow: 300
        }
    };

    // ============================================================
    // 2. EFEITO RIPPLE (Material Design)
    // ============================================================
    class RippleEffect {
        constructor() {
            this.init();
        }

        init() {
            if (!CONFIG.ripple.enabled) return;
            
            // Aplicar em botões e cards
            document.addEventListener('click', this.handleClick.bind(this), true);
        }

        handleClick(e) {
            const target = e.target.closest('button, .btn, .module-card, .card, [data-ripple]');
            if (!target || target.hasAttribute('data-no-ripple')) return;

            this.createRipple(e, target);
        }

        createRipple(event, element) {
            const rect = element.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = event.clientX - rect.left - size / 2;
            const y = event.clientY - rect.top - size / 2;

            // Garantir que o elemento tem position relative
            const computedStyle = window.getComputedStyle(element);
            if (computedStyle.position === 'static') {
                element.style.position = 'relative';
            }
            element.style.overflow = 'hidden';

            const ripple = document.createElement('span');
            ripple.className = 'ripple';
            ripple.style.cssText = `
                position: absolute;
                width: ${size}px;
                height: ${size}px;
                left: ${x}px;
                top: ${y}px;
                background: ${CONFIG.ripple.color};
                border-radius: 50%;
                transform: scale(0);
                pointer-events: none;
                animation: ripple-effect ${CONFIG.ripple.duration}ms linear;
            `;

            element.appendChild(ripple);

            setTimeout(() => {
                ripple.remove();
            }, CONFIG.ripple.duration);
        }
    }

    // ============================================================
    // 3. SISTEMA DE SKELETON LOADING
    // ============================================================
    class SkeletonLoader {
        constructor() {
            this.skeletons = new Map();
        }

        /**
         * Mostra skeleton em um container
         * @param {HTMLElement|string} container - Elemento ou seletor
         * @param {Object} options - Configurações do skeleton
         */
        show(container, options = {}) {
            const el = typeof container === 'string' 
                ? document.querySelector(container) 
                : container;
            
            if (!el) return;

            const config = {
                type: options.type || 'card', // card, list, table, text
                count: options.count || 1,
                height: options.height || 'auto'
            };

            // Salvar conteúdo original
            this.skeletons.set(el, {
                originalContent: el.innerHTML,
                startTime: Date.now()
            });

            // Gerar HTML do skeleton
            el.innerHTML = this.generateSkeleton(config);
            el.classList.add('skeleton-loading');
        }

        /**
         * Esconde skeleton e restaura ou insere novo conteúdo
         * @param {HTMLElement|string} container 
         * @param {string|null} newContent - Novo conteúdo (opcional)
         */
        hide(container, newContent = null) {
            const el = typeof container === 'string' 
                ? document.querySelector(container) 
                : container;
            
            if (!el) return;

            const data = this.skeletons.get(el);
            if (!data) return;

            // Garantir duração mínima para evitar flash
            const elapsed = Date.now() - data.startTime;
            const delay = Math.max(0, CONFIG.skeleton.minDuration - elapsed);

            setTimeout(() => {
                el.classList.remove('skeleton-loading');
                el.classList.add('skeleton-fade-out');
                
                setTimeout(() => {
                    el.innerHTML = newContent !== null ? newContent : data.originalContent;
                    el.classList.remove('skeleton-fade-out');
                    el.classList.add('content-loaded');
                    
                    // Trigger animation de entrada
                    requestAnimationFrame(() => {
                        el.classList.add('content-visible');
                    });

                    // Cleanup
                    setTimeout(() => {
                        el.classList.remove('content-loaded', 'content-visible');
                    }, 300);
                }, 150);

                this.skeletons.delete(el);
            }, delay);
        }

        generateSkeleton(config) {
            let html = '';
            
            for (let i = 0; i < config.count; i++) {
                switch (config.type) {
                    case 'card':
                        html += this.cardSkeleton();
                        break;
                    case 'list':
                        html += this.listItemSkeleton();
                        break;
                    case 'table':
                        html += this.tableRowSkeleton();
                        break;
                    case 'text':
                        html += this.textSkeleton();
                        break;
                    case 'module':
                        html += this.moduleSkeleton();
                        break;
                    default:
                        html += this.genericSkeleton(config.height);
                }
            }
            
            return html;
        }

        cardSkeleton() {
            return `
                <div class="skeleton-card" style="padding: 20px; margin-bottom: 16px;">
                    <div class="skeleton skeleton-avatar" style="margin-bottom: 16px;"></div>
                    <div class="skeleton skeleton-text" style="width: 80%;"></div>
                    <div class="skeleton skeleton-text short" style="width: 50%;"></div>
                </div>
            `;
        }

        listItemSkeleton() {
            return `
                <div class="skeleton-list-item" style="display: flex; align-items: center; padding: 12px; gap: 12px;">
                    <div class="skeleton skeleton-avatar"></div>
                    <div style="flex: 1;">
                        <div class="skeleton skeleton-text" style="width: 70%;"></div>
                        <div class="skeleton skeleton-text short" style="width: 40%; height: 0.8em;"></div>
                    </div>
                </div>
            `;
        }

        tableRowSkeleton() {
            return `
                <div class="skeleton-table-row" style="display: flex; padding: 12px; gap: 16px; border-bottom: 1px solid #f0f0f0;">
                    <div class="skeleton" style="width: 50px; height: 1em;"></div>
                    <div class="skeleton" style="flex: 2; height: 1em;"></div>
                    <div class="skeleton" style="flex: 1; height: 1em;"></div>
                    <div class="skeleton" style="width: 80px; height: 1em;"></div>
                </div>
            `;
        }

        textSkeleton() {
            return `
                <div class="skeleton-text-block" style="padding: 8px 0;">
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text" style="width: 90%;"></div>
                    <div class="skeleton skeleton-text medium"></div>
                </div>
            `;
        }

        moduleSkeleton() {
            return `
                <div class="skeleton-module" style="padding: 24px; border-radius: 16px; text-align: center;">
                    <div class="skeleton" style="width: 48px; height: 48px; border-radius: 12px; margin: 0 auto 16px;"></div>
                    <div class="skeleton skeleton-text" style="width: 60%; margin: 0 auto;"></div>
                </div>
            `;
        }

        genericSkeleton(height) {
            return `<div class="skeleton" style="height: ${height || '100px'}; width: 100%; border-radius: 8px;"></div>`;
        }
    }

    // ============================================================
    // 4. SISTEMA DE TOAST/NOTIFICAÇÕES FLUIDAS
    // ============================================================
    class FluidToast {
        constructor() {
            this.container = null;
            this.toasts = [];
            this.init();
        }

        init() {
            this.createContainer();
        }

        createContainer() {
            this.container = document.createElement('div');
            this.container.id = 'fluid-toast-container';
            this.container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 380px;
                pointer-events: none;
            `;
            document.body.appendChild(this.container);
        }

        /**
         * Mostrar toast
         * @param {string} message - Mensagem
         * @param {string} type - success, error, warning, info
         * @param {Object} options - Configurações adicionais
         */
        show(message, type = 'info', options = {}) {
            const config = {
                duration: options.duration || CONFIG.toast.duration,
                title: options.title || null,
                action: options.action || null,
                actionText: options.actionText || 'Desfazer',
                closable: options.closable !== false
            };

            // Limitar número de toasts visíveis
            while (this.toasts.length >= CONFIG.toast.maxVisible) {
                this.close(this.toasts[0]);
            }

            const toast = this.createToast(message, type, config);
            this.container.appendChild(toast);
            this.toasts.push(toast);

            // Auto-close
            if (config.duration > 0) {
                toast.dataset.timeout = setTimeout(() => {
                    this.close(toast);
                }, config.duration);
            }

            return toast;
        }

        createToast(message, type, config) {
            const icons = {
                success: '✓',
                error: '✕',
                warning: '⚠',
                info: 'ℹ'
            };

            const colors = {
                success: { bg: '#10b981', icon: '#065f46' },
                error: { bg: '#ef4444', icon: '#7f1d1d' },
                warning: { bg: '#f59e0b', icon: '#78350f' },
                info: { bg: '#3b82f6', icon: '#1e3a8a' }
            };

            const toast = document.createElement('div');
            toast.className = `fluid-toast fluid-toast-${type}`;
            toast.style.cssText = `
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 16px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.15), 0 2px 10px rgba(0,0,0,0.1);
                pointer-events: auto;
                transform: translateX(100%);
                opacity: 0;
                animation: toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                border-left: 4px solid ${colors[type].bg};
                position: relative;
                overflow: hidden;
            `;

            toast.innerHTML = `
                <div class="toast-icon" style="
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    background: ${colors[type].bg}20;
                    color: ${colors[type].bg};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    flex-shrink: 0;
                ">${icons[type]}</div>
                <div class="toast-content" style="flex: 1; min-width: 0;">
                    ${config.title ? `<div class="toast-title" style="font-weight: 600; margin-bottom: 4px; color: #1f2937;">${config.title}</div>` : ''}
                    <div class="toast-message" style="color: #4b5563; font-size: 14px; line-height: 1.4;">${message}</div>
                    ${config.action ? `<button class="toast-action" style="
                        background: none;
                        border: none;
                        color: ${colors[type].bg};
                        padding: 4px 0;
                        margin-top: 8px;
                        cursor: pointer;
                        font-weight: 600;
                        font-size: 13px;
                    ">${config.actionText}</button>` : ''}
                </div>
                ${config.closable ? `<button class="toast-close" style="
                    background: none;
                    border: none;
                    color: #9ca3af;
                    cursor: pointer;
                    padding: 4px;
                    font-size: 18px;
                    line-height: 1;
                    margin: -4px -4px -4px 0;
                ">&times;</button>` : ''}
                <div class="toast-progress" style="
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    height: 3px;
                    background: ${colors[type].bg};
                    width: 100%;
                    animation: toastProgress ${config.duration}ms linear forwards;
                "></div>
            `;

            // Event listeners
            const closeBtn = toast.querySelector('.toast-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.close(toast));
            }

            const actionBtn = toast.querySelector('.toast-action');
            if (actionBtn && config.action) {
                actionBtn.addEventListener('click', () => {
                    config.action();
                    this.close(toast);
                });
            }

            return toast;
        }

        close(toast) {
            if (!toast || !toast.parentNode) return;

            clearTimeout(toast.dataset.timeout);
            toast.style.animation = 'toastSlideOut 0.2s ease forwards';
            
            setTimeout(() => {
                toast.remove();
                this.toasts = this.toasts.filter(t => t !== toast);
            }, 200);
        }

        // Atalhos
        success(message, options = {}) {
            return this.show(message, 'success', options);
        }

        error(message, options = {}) {
            return this.show(message, 'error', options);
        }

        warning(message, options = {}) {
            return this.show(message, 'warning', options);
        }

        info(message, options = {}) {
            return this.show(message, 'info', options);
        }
    }

    // ============================================================
    // 5. BOTÕES COM LOADING STATE
    // ============================================================
    class LoadingButton {
        static start(button, text = 'Carregando...') {
            if (!button || button.classList.contains('btn-loading')) return;

            button.dataset.originalText = button.innerHTML;
            button.dataset.originalWidth = button.offsetWidth + 'px';
            
            button.style.width = button.dataset.originalWidth;
            button.classList.add('btn-loading');
            button.disabled = true;
            
            button.innerHTML = `
                <span class="spinner small" style="
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    border: 2px solid currentColor;
                    border-top-color: transparent;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                    margin-right: 8px;
                    vertical-align: middle;
                "></span>
                <span style="vertical-align: middle;">${text}</span>
            `;
        }

        static stop(button, success = true) {
            if (!button || !button.classList.contains('btn-loading')) return;

            button.classList.remove('btn-loading');
            button.disabled = false;
            button.innerHTML = button.dataset.originalText;
            button.style.width = '';

            // Feedback visual
            if (success) {
                button.classList.add('success-feedback');
                setTimeout(() => button.classList.remove('success-feedback'), 600);
            }
        }
    }

    // ============================================================
    // 6. TRANSIÇÕES DE PÁGINA SUAVES
    // ============================================================
    class PageTransition {
        constructor() {
            this.init();
        }

        init() {
            // Interceptar cliques em links internos
            document.addEventListener('click', (e) => {
                const link = e.target.closest('a[href]');
                if (!link || link.target === '_blank' || link.hasAttribute('data-no-transition')) return;
                
                const href = link.getAttribute('href');
                if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('http')) return;

                e.preventDefault();
                this.navigate(href);
            });

            // Marcar página como carregada
            document.body.classList.add('page-loaded');
        }

        navigate(url) {
            document.body.classList.add('page-transitioning');
            
            setTimeout(() => {
                window.location.href = url;
            }, 200);
        }
    }

    // ============================================================
    // 7. SCROLL SUAVE PARA NCORAS
    // ============================================================
    class SmoothScroll {
        constructor() {
            this.init();
        }

        init() {
            document.addEventListener('click', (e) => {
                const link = e.target.closest('a[href^="#"]');
                if (!link) return;

                const targetId = link.getAttribute('href').slice(1);
                const target = document.getElementById(targetId);
                
                if (target) {
                    e.preventDefault();
                    this.scrollTo(target);
                }
            });
        }

        scrollTo(element, offset = 80) {
            const top = element.getBoundingClientRect().top + window.pageYOffset - offset;
            
            window.scrollTo({
                top,
                behavior: 'smooth'
            });
        }
    }

    // ============================================================
    // 8. FEEDBACK VISUAL DE AÇÕES
    // ============================================================
    class ActionFeedback {
        static success(element) {
            element.classList.add('success-feedback');
            setTimeout(() => element.classList.remove('success-feedback'), 600);
        }

        static error(element) {
            element.classList.add('error-feedback');
            setTimeout(() => element.classList.remove('error-feedback'), 500);
        }

        static highlight(element) {
            element.classList.add('row-highlight');
            setTimeout(() => element.classList.remove('row-highlight'), 1000);
        }

        // Confirmação com shake
        static shake(element) {
            element.style.animation = 'none';
            element.offsetHeight; // Trigger reflow
            element.style.animation = 'errorShake 0.5s ease';
            setTimeout(() => element.style.animation = '', 500);
        }
    }

    // ============================================================
    // 9. RESIZE HANDLER (Desativa animações durante resize)
    // ============================================================
    class ResizeHandler {
        constructor() {
            this.timeout = null;
            this.init();
        }

        init() {
            window.addEventListener('resize', () => {
                document.body.classList.add('resize-animation-stopper');
                
                clearTimeout(this.timeout);
                this.timeout = setTimeout(() => {
                    document.body.classList.remove('resize-animation-stopper');
                }, 400);
            });
        }
    }

    // ============================================================
    // 10. INICIALIZAÇÍO
    // ============================================================
    
    // Criar instncias globais
    window.AluforceUI = {
        ripple: new RippleEffect(),
        skeleton: new SkeletonLoader(),
        toast: new FluidToast(),
        button: LoadingButton,
        feedback: ActionFeedback,
        scroll: new SmoothScroll(),
        pageTransition: new PageTransition(),
        resize: new ResizeHandler()
    };

    // Funções de conveniência globais
    window.showToast = (msg, type, opts) => window.AluforceUI.toast.show(msg, type, opts);
    window.showSkeleton = (el, opts) => window.AluforceUI.skeleton.show(el, opts);
    window.hideSkeleton = (el, content) => window.AluforceUI.skeleton.hide(el, content);
    window.setButtonLoading = (btn, text) => LoadingButton.start(btn, text);
    window.stopButtonLoading = (btn, success) => LoadingButton.stop(btn, success);

    // Log de inicialização
    console.log('✅ Aluforce UI Fluido inicializado');
    console.log('📊 APIs disponíveis em window.AluforceUI:');
    console.log('  - toast.success/error/warning/info(message, options)');
    console.log('  - skeleton.show(element, options) / skeleton.hide(element)');
    console.log('  - button.start(btn) / button.stop(btn)');
    console.log('  - feedback.success/error/shake(element)');

})();
