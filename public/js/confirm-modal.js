/**
 * Sistema de Modal de Confirmação Profissional
 * ALUFORCE v2.0
 * 
 * Substitui os confirm() nativos do navegador por modais elegantes
 */

(function() {
    'use strict';

    // Criar elementos do modal se não existirem
    function ensureModalExists() {
        if (document.getElementById('confirm-modal-overlay')) {
            return;
        }

        // Adicionar CSS
        const style = document.createElement('style');
        style.textContent = `
            .confirm-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(15, 23, 42, 0.7);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
            }

            .confirm-modal-overlay.active {
                opacity: 1;
                visibility: visible;
            }

            .confirm-modal {
                background: white;
                border-radius: 16px;
                width: 90%;
                max-width: 420px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                transform: scale(0.9) translateY(20px);
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                overflow: hidden;
            }

            .confirm-modal-overlay.active .confirm-modal {
                transform: scale(1) translateY(0);
            }

            .confirm-modal-header {
                padding: 24px 24px 0;
                display: flex;
                align-items: flex-start;
                gap: 16px;
            }

            .confirm-modal-icon {
                width: 48px;
                height: 48px;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }

            .confirm-modal-icon.warning {
                background: linear-gradient(135deg, #fef3c7, #fde68a);
                color: #d97706;
            }

            .confirm-modal-icon.danger {
                background: linear-gradient(135deg, #fee2e2, #fecaca);
                color: #dc2626;
            }

            .confirm-modal-icon.info {
                background: linear-gradient(135deg, #dbeafe, #bfdbfe);
                color: #2563eb;
            }

            .confirm-modal-icon.success {
                background: linear-gradient(135deg, #d1fae5, #a7f3d0);
                color: #059669;
            }

            .confirm-modal-icon i {
                font-size: 24px;
            }

            .confirm-modal-text {
                flex: 1;
            }

            .confirm-modal-title {
                font-size: 18px;
                font-weight: 600;
                color: #1f2937;
                margin: 0 0 8px;
            }

            .confirm-modal-message {
                font-size: 14px;
                color: #6b7280;
                margin: 0;
                line-height: 1.5;
            }

            .confirm-modal-footer {
                padding: 20px 24px 24px;
                display: flex;
                gap: 12px;
                justify-content: flex-end;
            }

            .confirm-modal-btn {
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
                border: none;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                font-family: inherit;
            }

            .confirm-modal-btn-cancel {
                background: #f3f4f6;
                color: #4b5563;
            }

            .confirm-modal-btn-cancel:hover {
                background: #e5e7eb;
            }

            .confirm-modal-btn-confirm {
                background: linear-gradient(135deg, #3b82f6, #2563eb);
                color: white;
                box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
            }

            .confirm-modal-btn-confirm:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
            }

            .confirm-modal-btn-danger {
                background: linear-gradient(135deg, #ef4444, #dc2626);
                color: white;
                box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4);
            }

            .confirm-modal-btn-danger:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 20px rgba(239, 68, 68, 0.5);
            }

            .confirm-modal-btn-warning {
                background: linear-gradient(135deg, #f59e0b, #d97706);
                color: white;
                box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);
            }

            .confirm-modal-btn-warning:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 20px rgba(245, 158, 11, 0.5);
            }

            .confirm-modal-btn-success {
                background: linear-gradient(135deg, #10b981, #059669);
                color: white;
                box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
            }

            .confirm-modal-btn-success:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
            }
        `;
        document.head.appendChild(style);

        // Criar HTML do modal
        const overlay = document.createElement('div');
        overlay.id = 'confirm-modal-overlay';
        overlay.className = 'confirm-modal-overlay';
        overlay.innerHTML = `
            <div class="confirm-modal">
                <div class="confirm-modal-header">
                    <div id="confirm-modal-icon" class="confirm-modal-icon warning">
                        <i id="confirm-modal-icon-i" class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div class="confirm-modal-text">
                        <h3 id="confirm-modal-title" class="confirm-modal-title">Confirmar ação</h3>
                        <p id="confirm-modal-message" class="confirm-modal-message">Tem certeza que deseja continuar?</p>
                    </div>
                </div>
                <div class="confirm-modal-footer">
                    <button id="confirm-modal-cancel" class="confirm-modal-btn confirm-modal-btn-cancel">
                        <i class="fas fa-times"></i> Cancelar
                    </button>
                    <button id="confirm-modal-confirm" class="confirm-modal-btn confirm-modal-btn-confirm">
                        <i class="fas fa-check"></i> Confirmar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    /**
     * Mostra o modal de confirmação
     * @param {Object} options - Opções do modal
     * @param {string} options.type - Tipo do modal: 'warning', 'danger', 'info', 'success'
     * @param {string} options.title - Título do modal
     * @param {string} options.message - Mensagem do modal
     * @param {string} options.confirmText - Texto do botão de confirmar
     * @param {string} options.cancelText - Texto do botão de cancelar
     * @returns {Promise<boolean>} - Resolve true se confirmado, false se cancelado
     */
    window.showConfirmModal = function(options = {}) {
        return new Promise((resolve) => {
            ensureModalExists();

            const overlay = document.getElementById('confirm-modal-overlay');
            const icon = document.getElementById('confirm-modal-icon');
            const iconI = document.getElementById('confirm-modal-icon-i');
            const title = document.getElementById('confirm-modal-title');
            const message = document.getElementById('confirm-modal-message');
            const cancelBtn = document.getElementById('confirm-modal-cancel');
            const confirmBtn = document.getElementById('confirm-modal-confirm');

            // Configurar tipo/tema
            const type = options.type || 'warning';
            icon.className = `confirm-modal-icon ${type}`;

            // Configurar ícone
            const icons = {
                warning: 'fa-exclamation-triangle',
                danger: 'fa-trash-alt',
                info: 'fa-info-circle',
                success: 'fa-check-circle'
            };
            iconI.className = `fas ${icons[type] || icons.warning}`;

            // Configurar textos
            title.textContent = options.title || 'Confirmar ação';
            message.textContent = options.message || 'Tem certeza que deseja continuar?';

            // Configurar botões
            cancelBtn.innerHTML = `<i class="fas fa-times"></i> ${options.cancelText || 'Cancelar'}`;
            confirmBtn.innerHTML = `<i class="fas fa-check"></i> ${options.confirmText || 'Confirmar'}`;

            // Configurar classe do botão de confirmar
            confirmBtn.className = 'confirm-modal-btn';
            const btnClass = {
                danger: 'confirm-modal-btn-danger',
                warning: 'confirm-modal-btn-warning',
                success: 'confirm-modal-btn-success',
                info: 'confirm-modal-btn-confirm'
            };
            confirmBtn.classList.add(btnClass[type] || 'confirm-modal-btn-confirm');

            // Handlers
            const handleConfirm = () => {
                cleanup();
                overlay.classList.remove('active');
                setTimeout(() => resolve(true), 300);
            };

            const handleCancel = () => {
                cleanup();
                overlay.classList.remove('active');
                setTimeout(() => resolve(false), 300);
            };

            const handleOverlayClick = (e) => {
                if (e.target === overlay) {
                    handleCancel();
                }
            };

            const handleKeydown = (e) => {
                if (e.key === 'Escape') {
                    handleCancel();
                } else if (e.key === 'Enter') {
                    handleConfirm();
                }
            };

            const cleanup = () => {
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
                overlay.removeEventListener('click', handleOverlayClick);
                document.removeEventListener('keydown', handleKeydown);
            };

            // Adicionar event listeners
            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
            overlay.addEventListener('click', handleOverlayClick);
            document.addEventListener('keydown', handleKeydown);

            // Mostrar modal
            overlay.classList.add('active');
            confirmBtn.focus();
        });
    };

    /**
     * Alias para uso mais simples
     */
    window.confirmAction = async function(message, options = {}) {
        return showConfirmModal({
            message,
            ...options
        });
    };

    console.log('✅ Sistema de Modal de Confirmação carregado');
})();
