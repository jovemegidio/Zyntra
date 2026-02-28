/**
 * ALUFORCE - Sistema de Alertas Profissional
 * Substitui os alerts nativos do navegador por modais elegantes
 * v1.0.0 - 26/01/2026
 */

(function() {
    'use strict';

    // Criar container de alertas se não existir
    function createAlertContainer() {
        if (document.getElementById('aluforce-alert-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'aluforce-alert-overlay';
        overlay.innerHTML = `
            <div class="aluforce-alert-modal">
                <div class="aluforce-alert-icon"></div>
                <div class="aluforce-alert-title"></div>
                <div class="aluforce-alert-message"></div>
                <div class="aluforce-alert-input-container"></div>
                <div class="aluforce-alert-buttons"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Adicionar estilos
        addAlertStyles();
    }

    // Adicionar estilos CSS
    function addAlertStyles() {
        if (document.getElementById('aluforce-alert-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'aluforce-alert-styles';
        styles.textContent = `
            #aluforce-alert-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 999999;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
            }

            #aluforce-alert-overlay.show {
                opacity: 1;
                visibility: visible;
            }

            .aluforce-alert-modal {
                background: linear-gradient(145deg, #1e2139 0%, #171928 100%);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 32px;
                min-width: 380px;
                max-width: 480px;
                text-align: center;
                box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5),
                            0 0 0 1px rgba(255, 255, 255, 0.05),
                            inset 0 1px 0 rgba(255, 255, 255, 0.1);
                transform: scale(0.8) translateY(-20px);
                transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }

            #aluforce-alert-overlay.show .aluforce-alert-modal {
                transform: scale(1) translateY(0);
            }

            .aluforce-alert-icon {
                width: 72px;
                height: 72px;
                margin: 0 auto 20px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 36px;
                animation: iconPulse 0.5s ease-out;
            }

            @keyframes iconPulse {
                0% { transform: scale(0); opacity: 0; }
                50% { transform: scale(1.2); }
                100% { transform: scale(1); opacity: 1; }
            }

            .aluforce-alert-icon.info {
                background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
                box-shadow: 0 8px 32px rgba(59, 130, 246, 0.4);
            }

            .aluforce-alert-icon.success {
                background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                box-shadow: 0 8px 32px rgba(34, 197, 94, 0.4);
            }

            .aluforce-alert-icon.warning {
                background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                box-shadow: 0 8px 32px rgba(245, 158, 11, 0.4);
            }

            .aluforce-alert-icon.error {
                background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                box-shadow: 0 8px 32px rgba(239, 68, 68, 0.4);
            }

            .aluforce-alert-icon.question {
                background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
                box-shadow: 0 8px 32px rgba(139, 92, 246, 0.4);
            }

            .aluforce-alert-title {
                font-size: 22px;
                font-weight: 700;
                color: #ffffff;
                margin-bottom: 12px;
                line-height: 1.3;
            }

            .aluforce-alert-message {
                font-size: 15px;
                color: rgba(255, 255, 255, 0.7);
                line-height: 1.6;
                margin-bottom: 24px;
            }

            .aluforce-alert-input-container {
                margin-bottom: 20px;
                display: none;
            }

            .aluforce-alert-input-container.show {
                display: block;
            }

            .aluforce-alert-input {
                width: 100%;
                padding: 14px 16px;
                background: rgba(255, 255, 255, 0.05);
                border: 2px solid rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                color: #ffffff;
                font-size: 15px;
                transition: all 0.3s ease;
                outline: none;
            }

            .aluforce-alert-input:focus {
                border-color: #3b82f6;
                background: rgba(59, 130, 246, 0.1);
                box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
            }

            .aluforce-alert-input::placeholder {
                color: rgba(255, 255, 255, 0.4);
            }

            .aluforce-alert-buttons {
                display: flex;
                gap: 12px;
                justify-content: center;
            }

            .aluforce-alert-btn {
                padding: 12px 28px;
                border-radius: 10px;
                font-size: 15px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                border: none;
                min-width: 120px;
            }

            .aluforce-alert-btn:hover {
                transform: translateY(-2px);
            }

            .aluforce-alert-btn:active {
                transform: translateY(0);
            }

            .aluforce-alert-btn.primary {
                background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                color: white;
                box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
            }

            .aluforce-alert-btn.primary:hover {
                box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
            }

            .aluforce-alert-btn.success {
                background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                color: white;
                box-shadow: 0 4px 15px rgba(34, 197, 94, 0.4);
            }

            .aluforce-alert-btn.danger {
                background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                color: white;
                box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);
            }

            .aluforce-alert-btn.secondary {
                background: rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.2);
            }

            .aluforce-alert-btn.secondary:hover {
                background: rgba(255, 255, 255, 0.15);
                color: white;
            }

            /* Toast Notifications */
            #aluforce-toast-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 999998;
                display: flex;
                flex-direction: column;
                gap: 12px;
                pointer-events: none;
            }

            .aluforce-toast {
                background: linear-gradient(145deg, #1e2139 0%, #171928 100%);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 16px 20px;
                min-width: 320px;
                max-width: 420px;
                display: flex;
                align-items: flex-start;
                gap: 14px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
                transform: translateX(120%);
                transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
                pointer-events: auto;
            }

            .aluforce-toast.show {
                transform: translateX(0);
            }

            .aluforce-toast.hide {
                transform: translateX(120%);
            }

            .aluforce-toast-icon {
                width: 42px;
                height: 42px;
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                flex-shrink: 0;
            }

            .aluforce-toast-icon.info {
                background: rgba(59, 130, 246, 0.2);
                color: #60a5fa;
            }

            .aluforce-toast-icon.success {
                background: rgba(34, 197, 94, 0.2);
                color: #4ade80;
            }

            .aluforce-toast-icon.warning {
                background: rgba(245, 158, 11, 0.2);
                color: #fbbf24;
            }

            .aluforce-toast-icon.error {
                background: rgba(239, 68, 68, 0.2);
                color: #f87171;
            }

            .aluforce-toast-content {
                flex: 1;
            }

            .aluforce-toast-title {
                font-size: 15px;
                font-weight: 600;
                color: #ffffff;
                margin-bottom: 4px;
            }

            .aluforce-toast-message {
                font-size: 13px;
                color: rgba(255, 255, 255, 0.6);
                line-height: 1.4;
            }

            .aluforce-toast-close {
                background: none;
                border: none;
                color: rgba(255, 255, 255, 0.4);
                cursor: pointer;
                padding: 4px;
                font-size: 18px;
                line-height: 1;
                transition: color 0.2s;
            }

            .aluforce-toast-close:hover {
                color: white;
            }

            .aluforce-toast-progress {
                position: absolute;
                bottom: 0;
                left: 0;
                height: 3px;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6);
                border-radius: 0 0 12px 12px;
                animation: toastProgress linear forwards;
            }

            @keyframes toastProgress {
                from { width: 100%; }
                to { width: 0%; }
            }
        `;
        document.head.appendChild(styles);
    }

    // Criar container de toasts
    function createToastContainer() {
        if (document.getElementById('aluforce-toast-container')) return;

        const container = document.createElement('div');
        container.id = 'aluforce-toast-container';
        document.body.appendChild(container);
    }

    // Ícones SVG
    const icons = {
        info: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        success: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        warning: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        error: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        question: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };

    const toastIcons = {
        info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    };

    // Função principal de alerta
    function showAlert(options) {
        return new Promise((resolve) => {
            createAlertContainer();

            const overlay = document.getElementById('aluforce-alert-overlay');
            const modal = overlay.querySelector('.aluforce-alert-modal');
            const iconEl = modal.querySelector('.aluforce-alert-icon');
            const titleEl = modal.querySelector('.aluforce-alert-title');
            const messageEl = modal.querySelector('.aluforce-alert-message');
            const inputContainer = modal.querySelector('.aluforce-alert-input-container');
            const buttonsEl = modal.querySelector('.aluforce-alert-buttons');

            // Configurações padrão
            const config = {
                type: 'info',
                title: '',
                message: '',
                confirmText: 'OK',
                cancelText: 'Cancelar',
                showCancel: false,
                showInput: false,
                inputPlaceholder: '',
                inputValue: '',
                ...options
            };

            // Configurar ícone
            iconEl.className = `aluforce-alert-icon ${config.type}`;
            iconEl.innerHTML = icons[config.type] || icons.info;

            // Configurar título e mensagem
            titleEl.textContent = config.title;
            messageEl.innerHTML = config.message;

            // Configurar input
            if (config.showInput) {
                inputContainer.className = 'aluforce-alert-input-container show';
                inputContainer.innerHTML = `<input type="text" class="aluforce-alert-input" placeholder="${config.inputPlaceholder}" value="${config.inputValue}">`;
            } else {
                inputContainer.className = 'aluforce-alert-input-container';
                inputContainer.innerHTML = '';
            }

            // Configurar botões
            let buttonsHTML = '';
            if (config.showCancel) {
                buttonsHTML += `<button class="aluforce-alert-btn secondary" data-action="cancel">${config.cancelText}</button>`;
            }
            buttonsHTML += `<button class="aluforce-alert-btn ${config.type === 'error' ? 'danger' : config.type === 'success' ? 'success' : 'primary'}" data-action="confirm">${config.confirmText}</button>`;
            buttonsEl.innerHTML = buttonsHTML;

            // Mostrar modal
            setTimeout(() => overlay.classList.add('show'), 10);

            // Focus no input se existir
            if (config.showInput) {
                setTimeout(() => {
                    const input = inputContainer.querySelector('input');
                    if (input) input.focus();
                }, 300);
            }

            // Event handlers
            function close(result) {
                overlay.classList.remove('show');
                setTimeout(() => {
                    resolve(result);
                }, 300);
            }

            buttonsEl.querySelectorAll('button').forEach(btn => {
                btn.onclick = () => {
                    const action = btn.dataset.action;
                    if (action === 'confirm') {
                        if (config.showInput) {
                            const input = inputContainer.querySelector('input');
                            close({ confirmed: true, value: input ? input.value : '' });
                        } else {
                            close({ confirmed: true });
                        }
                    } else {
                        close({ confirmed: false });
                    }
                };
            });

            // Enter para confirmar
            if (config.showInput) {
                const input = inputContainer.querySelector('input');
                if (input) {
                    input.onkeydown = (e) => {
                        if (e.key === 'Enter') {
                            close({ confirmed: true, value: input.value });
                        }
                    };
                }
            }

            // ESC para cancelar
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    close({ confirmed: false });
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);
        });
    }

    // Toast notification
    function showNotification(options) {
        createToastContainer();
        addAlertStyles();

        const container = document.getElementById('aluforce-toast-container');

        const config = {
            type: 'info',
            title: '',
            message: '',
            duration: 5000,
            ...options
        };

        const toast = document.createElement('div');
        toast.className = 'aluforce-toast';
        toast.style.position = 'relative';
        toast.innerHTML = `
            <div class="aluforce-toast-icon ${config.type}">${toastIcons[config.type] || toastIcons.info}</div>
            <div class="aluforce-toast-content">
                <div class="aluforce-toast-title">${config.title}</div>
                <div class="aluforce-toast-message">${config.message}</div>
            </div>
            <button class="aluforce-toast-close">×</button>
            <div class="aluforce-toast-progress" style="animation-duration: ${config.duration}ms;"></div>
        `;

        container.appendChild(toast);

        // Animar entrada
        setTimeout(() => toast.classList.add('show'), 10);

        // Função para remover
        function removeToast() {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 400);
        }

        // Auto-remover
        const timeout = setTimeout(removeToast, config.duration);

        // Botão fechar
        toast.querySelector('.aluforce-toast-close').onclick = () => {
            clearTimeout(timeout);
            removeToast();
        };

        // Pausar ao hover
        toast.onmouseenter = () => {
            clearTimeout(timeout);
            toast.querySelector('.aluforce-toast-progress').style.animationPlayState = 'paused';
        };

        toast.onmouseleave = () => {
            toast.querySelector('.aluforce-toast-progress').style.animationPlayState = 'running';
            setTimeout(removeToast, config.duration / 2);
        };
    }

    // API Pública
    window.AluforceAlert = {
        // Alerta simples (substitui alert())
        alert: (message, title = 'Informação') => showAlert({
            type: 'info',
            title: title,
            message: message
        }),

        // Sucesso
        success: (message, title = 'Sucesso!') => showAlert({
            type: 'success',
            title: title,
            message: message
        }),

        // Aviso
        warning: (message, title = 'Atenção') => showAlert({
            type: 'warning',
            title: title,
            message: message
        }),

        // Erro
        error: (message, title = 'Erro') => showAlert({
            type: 'error',
            title: title,
            message: message
        }),

        // Confirmação (substitui confirm())
        confirm: (message, title = 'Confirmação') => showAlert({
            type: 'question',
            title: title,
            message: message,
            showCancel: true,
            confirmText: 'Sim',
            cancelText: 'Não'
        }),

        // Prompt (substitui prompt())
        prompt: (message, title = 'Digite', placeholder = '', defaultValue = '') => showAlert({
            type: 'question',
            title: title,
            message: message,
            showCancel: true,
            showInput: true,
            inputPlaceholder: placeholder,
            inputValue: defaultValue,
            confirmText: 'Confirmar',
            cancelText: 'Cancelar'
        }),

        // Personalizado
        custom: showAlert,

        // Toast/Notificação
        toast: {
            info: (message, title = 'Informação') => showNotification({ type: 'info', title, message }),
            success: (message, title = 'Sucesso!') => showNotification({ type: 'success', title, message }),
            warning: (message, title = 'Atenção') => showNotification({ type: 'warning', title, message }),
            error: (message, title = 'Erro') => showNotification({ type: 'error', title, message }),
            show: showNotification
        }
    };

    // Sobrescrever alert nativo (opcional - ativar se necessário)
    // window.alert = (msg) => AluforceAlert.alert(msg);

    console.log('✅ ALUFORCE Alerts v1.0.0 carregado');
})();
