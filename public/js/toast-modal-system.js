/**
 * ALUFORCE - Sistema de Toasts e Modais Profissionais
 * Substitui alerts nativos por componentes modernos
 * @version 2.0
 */

(function() {
    'use strict';

    // =============================================
    // SISTEMA DE TOASTS
    // =============================================
    
    // Container de toasts
    let toastContainer = null;
    
    function createToastContainer() {
        if (toastContainer) return toastContainer;
        
        toastContainer = document.createElement('div');
        toastContainer.id = 'aluforce-toast-container';
        toastContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-width: 400px;
        `;
        document.body.appendChild(toastContainer);
        return toastContainer;
    }

    /**
     * Exibe um toast de notificação
     * @param {string} message - Mensagem do toast
     * @param {string} type - Tipo: 'success', 'error', 'warning', 'info'
     * @param {number} duration - Duração em ms (padrão 4000)
     */
    window.showToast = function(message, type = 'info', duration = 4000) {
        const container = createToastContainer();
        
        const icons = {
            success: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            warning: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        };

        const themes = {
            success: { 
                bg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                shadow: 'rgba(16, 185, 129, 0.4)',
                glow: '#10b981'
            },
            error: { 
                bg: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', 
                shadow: 'rgba(239, 68, 68, 0.4)',
                glow: '#ef4444'
            },
            warning: { 
                bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', 
                shadow: 'rgba(245, 158, 11, 0.4)',
                glow: '#f59e0b'
            },
            info: { 
                bg: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', 
                shadow: 'rgba(59, 130, 246, 0.4)',
                glow: '#3b82f6'
            }
        };

        const theme = themes[type] || themes.info;
        const icon = icons[type] || icons.info;

        const toast = document.createElement('div');
        toast.className = 'aluforce-toast';
        toast.style.cssText = `
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 16px 20px;
            background: ${theme.bg};
            border-radius: 14px;
            box-shadow: 0 10px 40px ${theme.shadow}, 0 0 0 1px rgba(255,255,255,0.1) inset;
            color: #ffffff;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 14px;
            font-weight: 500;
            transform: translateX(120%);
            transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            cursor: pointer;
            min-width: 280px;
            backdrop-filter: blur(10px);
        `;

        toast.innerHTML = `
            <div style="
                flex-shrink: 0;
                width: 40px;
                height: 40px;
                background: rgba(255,255,255,0.2);
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
            ">${icon}</div>
            <div style="flex: 1; line-height: 1.5;">${message}</div>
            <button onclick="event.stopPropagation(); this.parentElement.style.transform='translateX(120%)'; setTimeout(() => this.parentElement.remove(), 300);" style="
                background: rgba(255,255,255,0.2);
                border: none;
                color: inherit;
                cursor: pointer;
                padding: 6px;
                border-radius: 6px;
                font-size: 16px;
                line-height: 1;
                transition: background 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
            " onmouseenter="this.style.background='rgba(255,255,255,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.2)'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;

        // Barra de progresso
        const progressBar = document.createElement('div');
        progressBar.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            height: 3px;
            background: rgba(255,255,255,0.5);
            border-radius: 0 0 14px 14px;
            width: 100%;
            transform-origin: left;
            animation: toastProgress ${duration}ms linear forwards;
        `;
        toast.style.position = 'relative';
        toast.style.overflow = 'hidden';
        toast.appendChild(progressBar);

        // Adicionar keyframes para a barra de progresso
        if (!document.getElementById('toast-progress-style')) {
            const style = document.createElement('style');
            style.id = 'toast-progress-style';
            style.textContent = `
                @keyframes toastProgress {
                    from { transform: scaleX(1); }
                    to { transform: scaleX(0); }
                }
            `;
            document.head.appendChild(style);
        }

        container.appendChild(toast);

        // Animar entrada
        requestAnimationFrame(() => {
            toast.style.transform = 'translateX(0)';
        });

        // Auto-remover
        const timeout = setTimeout(() => {
            toast.style.transform = 'translateX(120%)';
            setTimeout(() => toast.remove(), 400);
        }, duration);

        // Click para fechar
        toast.addEventListener('click', () => {
            clearTimeout(timeout);
            toast.style.transform = 'translateX(120%)';
            setTimeout(() => toast.remove(), 400);
        });
    };

    // =============================================
    // SISTEMA DE MODAIS
    // =============================================

    let modalContainer = null;

    function createModalContainer() {
        if (modalContainer) return modalContainer;
        
        modalContainer = document.createElement('div');
        modalContainer.id = 'aluforce-modal-container';
        document.body.appendChild(modalContainer);
        return modalContainer;
    }

    /**
     * Exibe um modal de alerta (substitui alert())
     * @param {string} message - Mensagem
     * @param {string} title - Título opcional
     * @param {string} type - Tipo: 'success', 'error', 'warning', 'info'
     */
    window.showAlert = function(message, title = '', type = 'info') {
        return new Promise((resolve) => {
            const container = createModalContainer();
            
            const themes = {
                success: {
                    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    bgLight: '#ecfdf5',
                    color: '#059669',
                    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
                    title: 'Sucesso!'
                },
                error: {
                    gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                    bgLight: '#fef2f2',
                    color: '#dc2626',
                    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
                    title: 'Erro!'
                },
                warning: {
                    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    bgLight: '#fffbeb',
                    color: '#d97706',
                    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
                    title: 'Atenção!'
                },
                info: {
                    gradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    bgLight: '#eff6ff',
                    color: '#2563eb',
                    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
                    title: 'Informação'
                }
            };

            const theme = themes[type] || themes.info;

            const modal = document.createElement('div');
            modal.className = 'aluforce-modal-overlay';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(15, 23, 42, 0.6);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 999999;
                opacity: 0;
                transition: opacity 0.25s ease;
                padding: 20px;
            `;

            modal.innerHTML = `
                <div class="aluforce-modal-box" style="
                    background: #ffffff;
                    border-radius: 24px;
                    box-shadow: 0 25px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0,0,0,0.05);
                    max-width: 420px;
                    width: 100%;
                    transform: scale(0.9) translateY(20px);
                    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
                    overflow: hidden;
                ">
                    <!-- Header com gradiente -->
                    <div style="
                        background: ${theme.gradient};
                        padding: 28px 24px;
                        text-align: center;
                        position: relative;
                        overflow: hidden;
                    ">
                        <!-- Decoração de fundo -->
                        <div style="
                            position: absolute;
                            top: -50%;
                            left: -50%;
                            width: 200%;
                            height: 200%;
                            background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 60%);
                            pointer-events: none;
                        "></div>
                        
                        <!-- Ícone circular -->
                        <div style="
                            width: 80px;
                            height: 80px;
                            background: rgba(255,255,255,0.2);
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            margin: 0 auto 16px;
                            color: white;
                            backdrop-filter: blur(10px);
                            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                        ">${theme.icon}</div>
                        
                        <h3 style="
                            margin: 0;
                            font-size: 22px;
                            font-weight: 700;
                            color: white;
                            font-family: 'Outfit', 'Inter', sans-serif;
                            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
                        ">${title || theme.title}</h3>
                    </div>
                    
                    <!-- Body -->
                    <div style="
                        padding: 28px 24px;
                        text-align: center;
                    ">
                        <p style="
                            margin: 0;
                            font-size: 15px;
                            color: #475569;
                            line-height: 1.6;
                            font-family: 'Inter', -apple-system, sans-serif;
                        ">${message}</p>
                    </div>
                    
                    <!-- Footer -->
                    <div style="
                        padding: 16px 24px 24px;
                        display: flex;
                        justify-content: center;
                    ">
                        <button class="modal-btn-ok" style="
                            padding: 14px 48px;
                            background: ${theme.gradient};
                            color: white;
                            border: none;
                            border-radius: 12px;
                            font-size: 15px;
                            font-weight: 600;
                            cursor: pointer;
                            transition: all 0.2s;
                            font-family: 'Inter', sans-serif;
                            box-shadow: 0 4px 14px ${theme.color}40;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                        ">
                            <span>Entendido</span>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                        </button>
                    </div>
                </div>
            `;

            container.appendChild(modal);

            // Animar entrada
            requestAnimationFrame(() => {
                modal.style.opacity = '1';
                modal.querySelector('.aluforce-modal-box').style.transform = 'scale(1) translateY(0)';
            });

            // Hover no botão
            const btn = modal.querySelector('.modal-btn-ok');
            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'translateY(-2px)';
                btn.style.boxShadow = `0 8px 20px ${theme.color}50`;
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = 'translateY(0)';
                btn.style.boxShadow = `0 4px 14px ${theme.color}40`;
            });

            const closeModal = () => {
                modal.style.opacity = '0';
                modal.querySelector('.aluforce-modal-box').style.transform = 'scale(0.9) translateY(20px)';
                setTimeout(() => {
                    modal.remove();
                    resolve();
                }, 250);
            };

            modal.querySelector('.modal-btn-ok').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });

            // ESC para fechar
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    closeModal();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);
            
            // Enter para confirmar
            const enterHandler = (e) => {
                if (e.key === 'Enter') {
                    closeModal();
                    document.removeEventListener('keydown', enterHandler);
                }
            };
            document.addEventListener('keydown', enterHandler);
        });
    };

    /**
     * Exibe um modal de confirmação (substitui confirm())
     * @param {string} message - Mensagem
     * @param {string} title - Título opcional
     * @param {object} options - Opções {confirmText, cancelText, type}
     */
    window.showConfirm = function(message, title = 'Confirmar', options = {}) {
        return new Promise((resolve) => {
            const container = createModalContainer();
            const { confirmText = 'Confirmar', cancelText = 'Cancelar', type = 'warning' } = options;
            
            const colors = {
                success: '#10b981',
                error: '#ef4444',
                warning: '#f59e0b',
                info: '#3b82f6',
                danger: '#ef4444'
            };

            const color = colors[type] || colors.warning;

            const modal = document.createElement('div');
            modal.className = 'aluforce-modal-overlay';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                opacity: 0;
                transition: opacity 0.2s ease;
            `;

            modal.innerHTML = `
                <div class="aluforce-modal-box" style="
                    background: #ffffff;
                    border-radius: 16px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    max-width: 420px;
                    width: 90%;
                    transform: scale(0.9);
                    transition: transform 0.2s ease;
                    overflow: hidden;
                ">
                    <div style="padding: 24px 24px 20px; text-align: center;">
                        <div style="
                            width: 56px;
                            height: 56px;
                            background: ${color}15;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            margin: 0 auto 16px;
                        ">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                        </div>
                        <h3 style="
                            margin: 0 0 8px;
                            font-size: 18px;
                            font-weight: 600;
                            color: #1e293b;
                            font-family: 'Inter', sans-serif;
                        ">${title}</h3>
                        <p style="
                            margin: 0;
                            font-size: 14px;
                            color: #64748b;
                            line-height: 1.5;
                            font-family: 'Inter', sans-serif;
                        ">${message}</p>
                    </div>
                    <div style="
                        padding: 16px 24px;
                        background: #f8fafc;
                        border-top: 1px solid #e2e8f0;
                        display: flex;
                        justify-content: center;
                        gap: 12px;
                    ">
                        <button class="modal-btn-cancel" style="
                            padding: 10px 24px;
                            background: #f1f5f9;
                            color: #64748b;
                            border: 1px solid #e2e8f0;
                            border-radius: 8px;
                            font-size: 14px;
                            font-weight: 500;
                            cursor: pointer;
                            transition: all 0.2s;
                            font-family: 'Inter', sans-serif;
                        ">${cancelText}</button>
                        <button class="modal-btn-confirm" style="
                            padding: 10px 24px;
                            background: ${color};
                            color: white;
                            border: none;
                            border-radius: 8px;
                            font-size: 14px;
                            font-weight: 600;
                            cursor: pointer;
                            transition: all 0.2s;
                            font-family: 'Inter', sans-serif;
                        ">${confirmText}</button>
                    </div>
                </div>
            `;

            container.appendChild(modal);

            requestAnimationFrame(() => {
                modal.style.opacity = '1';
                modal.querySelector('.aluforce-modal-box').style.transform = 'scale(1)';
            });

            const closeModal = (result) => {
                modal.style.opacity = '0';
                modal.querySelector('.aluforce-modal-box').style.transform = 'scale(0.9)';
                setTimeout(() => {
                    modal.remove();
                    resolve(result);
                }, 200);
            };

            modal.querySelector('.modal-btn-confirm').addEventListener('click', () => closeModal(true));
            modal.querySelector('.modal-btn-cancel').addEventListener('click', () => closeModal(false));
        });
    };

    /**
     * Exibe um modal de input (substitui prompt())
     * @param {string} message - Mensagem
     * @param {string} defaultValue - Valor padrão
     * @param {object} options - Opções {title, placeholder, type}
     */
    window.showPrompt = function(message, defaultValue = '', options = {}) {
        return new Promise((resolve) => {
            const container = createModalContainer();
            const { title = 'Entrada', placeholder = '', type = 'text' } = options;

            const modal = document.createElement('div');
            modal.className = 'aluforce-modal-overlay';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                opacity: 0;
                transition: opacity 0.2s ease;
            `;

            modal.innerHTML = `
                <div class="aluforce-modal-box" style="
                    background: #ffffff;
                    border-radius: 16px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    max-width: 420px;
                    width: 90%;
                    transform: scale(0.9);
                    transition: transform 0.2s ease;
                    overflow: hidden;
                ">
                    <div style="padding: 24px;">
                        <h3 style="
                            margin: 0 0 8px;
                            font-size: 18px;
                            font-weight: 600;
                            color: #1e293b;
                            font-family: 'Inter', sans-serif;
                        ">${title}</h3>
                        <p style="
                            margin: 0 0 16px;
                            font-size: 14px;
                            color: #64748b;
                            line-height: 1.5;
                            font-family: 'Inter', sans-serif;
                        ">${message}</p>
                        <input type="${type}" class="modal-input" value="${defaultValue}" placeholder="${placeholder}" style="
                            width: 100%;
                            padding: 12px 14px;
                            border: 1px solid #e2e8f0;
                            border-radius: 8px;
                            font-size: 14px;
                            font-family: 'Inter', sans-serif;
                            outline: none;
                            transition: border-color 0.2s;
                            box-sizing: border-box;
                        ">
                    </div>
                    <div style="
                        padding: 16px 24px;
                        background: #f8fafc;
                        border-top: 1px solid #e2e8f0;
                        display: flex;
                        justify-content: flex-end;
                        gap: 12px;
                    ">
                        <button class="modal-btn-cancel" style="
                            padding: 10px 24px;
                            background: #f1f5f9;
                            color: #64748b;
                            border: 1px solid #e2e8f0;
                            border-radius: 8px;
                            font-size: 14px;
                            font-weight: 500;
                            cursor: pointer;
                            font-family: 'Inter', sans-serif;
                        ">Cancelar</button>
                        <button class="modal-btn-confirm" style="
                            padding: 10px 24px;
                            background: #10b981;
                            color: white;
                            border: none;
                            border-radius: 8px;
                            font-size: 14px;
                            font-weight: 600;
                            cursor: pointer;
                            font-family: 'Inter', sans-serif;
                        ">Confirmar</button>
                    </div>
                </div>
            `;

            container.appendChild(modal);

            const input = modal.querySelector('.modal-input');
            
            requestAnimationFrame(() => {
                modal.style.opacity = '1';
                modal.querySelector('.aluforce-modal-box').style.transform = 'scale(1)';
                input.focus();
                input.select();
            });

            const closeModal = (value) => {
                modal.style.opacity = '0';
                modal.querySelector('.aluforce-modal-box').style.transform = 'scale(0.9)';
                setTimeout(() => {
                    modal.remove();
                    resolve(value);
                }, 200);
            };

            modal.querySelector('.modal-btn-confirm').addEventListener('click', () => closeModal(input.value));
            modal.querySelector('.modal-btn-cancel').addEventListener('click', () => closeModal(null));
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') closeModal(input.value);
            });

            input.addEventListener('focus', () => {
                input.style.borderColor = '#10b981';
            });
            input.addEventListener('blur', () => {
                input.style.borderColor = '#e2e8f0';
            });
        });
    };

    /**
     * Modal de seleção de status para logística
     */
    window.showStatusSelect = function(currentStatus, pedidoId) {
        return new Promise((resolve) => {
            const container = createModalContainer();

            const statusOptions = [
                { value: 'aguardando_separacao', label: 'Aguardando Separação', icon: '⏳', color: '#f59e0b' },
                { value: 'em_separacao', label: 'Em Separação', icon: '📦', color: '#3b82f6' },
                { value: 'em_expedicao', label: 'Em Expedição', icon: '🚛', color: '#8b5cf6' },
                { value: 'em_transporte', label: 'Em Transporte', icon: '🚚', color: '#ec4899' },
                { value: 'entregue', label: 'Entregue', icon: '✅', color: '#10b981' }
            ];

            const modal = document.createElement('div');
            modal.className = 'aluforce-modal-overlay';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                opacity: 0;
                transition: opacity 0.2s ease;
            `;

            modal.innerHTML = `
                <div class="aluforce-modal-box" style="
                    background: #ffffff;
                    border-radius: 16px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    max-width: 380px;
                    width: 90%;
                    transform: scale(0.9);
                    transition: transform 0.2s ease;
                    overflow: hidden;
                ">
                    <div style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0;">
                        <h3 style="
                            margin: 0;
                            font-size: 16px;
                            font-weight: 600;
                            color: #1e293b;
                            font-family: 'Inter', sans-serif;
                        ">Alterar Status - Pedido #${pedidoId}</h3>
                    </div>
                    <div style="padding: 16px 24px;">
                        <p style="margin: 0 0 16px; font-size: 13px; color: #64748b;">Selecione o novo status:</p>
                        <div class="status-options" style="display: flex; flex-direction: column; gap: 8px;">
                            ${statusOptions.map(opt => `
                                <button class="status-option" data-value="${opt.value}" style="
                                    display: flex;
                                    align-items: center;
                                    gap: 12px;
                                    padding: 12px 16px;
                                    border: 2px solid ${currentStatus === opt.value ? opt.color : '#e2e8f0'};
                                    background: ${currentStatus === opt.value ? opt.color + '10' : '#ffffff'};
                                    border-radius: 10px;
                                    cursor: pointer;
                                    transition: all 0.2s;
                                    font-family: 'Inter', sans-serif;
                                ">
                                    <span style="font-size: 20px;">${opt.icon}</span>
                                    <span style="font-size: 14px; font-weight: 500; color: #1e293b;">${opt.label}</span>
                                    ${currentStatus === opt.value ? '<span style="margin-left: auto; font-size: 12px; color: ' + opt.color + '; font-weight: 600;">ATUAL</span>' : ''}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <div style="
                        padding: 16px 24px;
                        background: #f8fafc;
                        border-top: 1px solid #e2e8f0;
                        display: flex;
                        justify-content: flex-end;
                    ">
                        <button class="modal-btn-cancel" style="
                            padding: 10px 24px;
                            background: #f1f5f9;
                            color: #64748b;
                            border: 1px solid #e2e8f0;
                            border-radius: 8px;
                            font-size: 14px;
                            font-weight: 500;
                            cursor: pointer;
                            font-family: 'Inter', sans-serif;
                        ">Cancelar</button>
                    </div>
                </div>
            `;

            container.appendChild(modal);

            requestAnimationFrame(() => {
                modal.style.opacity = '1';
                modal.querySelector('.aluforce-modal-box').style.transform = 'scale(1)';
            });

            const closeModal = (value) => {
                modal.style.opacity = '0';
                modal.querySelector('.aluforce-modal-box').style.transform = 'scale(0.9)';
                setTimeout(() => {
                    modal.remove();
                    resolve(value);
                }, 200);
            };

            modal.querySelectorAll('.status-option').forEach(btn => {
                btn.addEventListener('click', () => {
                    closeModal(btn.dataset.value);
                });
                btn.addEventListener('mouseenter', () => {
                    if (btn.dataset.value !== currentStatus) {
                        btn.style.borderColor = '#10b981';
                        btn.style.background = '#f0fdf4';
                    }
                });
                btn.addEventListener('mouseleave', () => {
                    const opt = statusOptions.find(o => o.value === btn.dataset.value);
                    btn.style.borderColor = currentStatus === btn.dataset.value ? opt.color : '#e2e8f0';
                    btn.style.background = currentStatus === btn.dataset.value ? opt.color + '10' : '#ffffff';
                });
            });

            modal.querySelector('.modal-btn-cancel').addEventListener('click', () => closeModal(null));
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal(null);
            });
        });
    };

    // =============================================
    // INTERCEPTAR ALERT NATIVO
    // =============================================
    
    // Salvar referência original
    const originalAlert = window.alert;
    
    // Sobrescrever alert nativo com versão moderna
    window.alert = function(message) {
        // Detectar tipo baseado na mensagem
        let type = 'info';
        let title = 'Informação';
        
        const msgLower = (message || '').toLowerCase();
        
        if (msgLower.includes('sucesso') || msgLower.includes('atualizado') || 
            msgLower.includes('salvo') || msgLower.includes('criado') || 
            msgLower.includes('excluído') || msgLower.includes('removido') ||
            msgLower.includes('enviado') || msgLower.includes('confirmado')) {
            type = 'success';
            title = 'Sucesso!';
        } else if (msgLower.includes('erro') || msgLower.includes('falha') || 
                   msgLower.includes('inválido') || msgLower.includes('não encontrado') ||
                   msgLower.includes('não foi possível')) {
            type = 'error';
            title = 'Erro!';
        } else if (msgLower.includes('atenção') || msgLower.includes('aviso') || 
                   msgLower.includes('cuidado') || msgLower.includes('pendente')) {
            type = 'warning';
            title = 'Atenção!';
        }
        
        // Usar o showAlert moderno
        showAlert(message, title, type);
    };
    
    // Sobrescrever confirm nativo
    const originalConfirm = window.confirm;
    window.confirm = function(message) {
        // Para manter compatibilidade síncrona, usar o original em contextos síncronos
        // Em contextos modernos, usar showConfirm
        return originalConfirm.call(window, message);
    };

    console.log('✅ Sistema de Toasts e Modais ALUFORCE carregado');
    console.log('📢 Alert nativo substituído por versão moderna');
})();
