// vendas-permission-modal.js - Modal profissional para erros de permissão

window.VendasPermissionModal = (function() {
    
    // Ícones SVG
    const ICONS = {
        lock: '<svg viewBox="0 0 24 24"><path d="M12 17a2 2 0 0 0 2-2 2 2 0 0 0-2-2 2 2 0 0 0-2 2 2 2 0 0 0 2 2m6-9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h1V6a5 5 0 0 1 5-5 5 5 0 0 1 5 5v2h1m-6-5a3 3 0 0 0-3 3v2h6V6a3 3 0 0 0-3-3z"/></svg>',
        warning: '<svg viewBox="0 0 24 24"><path d="M12 2L1 21h22M12 6l7.53 13H4.47M11 10v4h2v-4m-2 6v2h2v-2"/></svg>',
        error: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
        info: '<svg viewBox="0 0 24 24"><path d="M11 9h2V7h-2m1 13c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m0-18A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2m-1 15h2v-6h-2v6z"/></svg>'
    };
    
    // Remove modal existente
    function removeModal() {
        const existing = document.querySelector('.permission-modal-overlay');
        if (existing) {
            existing.style.opacity = '0';
            setTimeout(() => existing.remove(), 200);
        }
    }
    
    // Cria e exibe modal
    function show(options) {
        removeModal();
        
        const defaults = {
            type: 'permission', // permission, error, warning, info
            title: 'Acesso Negado',
            message: 'Você não tem permissão para realizar esta ação.',
            detail: '',
            showInfo: true,
            infoText: 'Apenas o vendedor responsável pelo pedido ou administradores podem editar.',
            buttonText: 'Entendi',
            onClose: null
        };
        
        const config = { ...defaults, ...options };
        
        // Configura ícone e classe baseado no tipo
        let icon = ICONS.lock;
        let modalClass = 'permission-modal';
        
        if (config.type === 'error') {
            icon = ICONS.error;
            modalClass += ' error-generic';
        } else if (config.type === 'warning') {
            icon = ICONS.warning;
        } else if (config.type === 'info') {
            icon = ICONS.info;
        }
        
        const overlay = document.createElement('div');
        overlay.className = 'permission-modal-overlay';
        overlay.innerHTML = `
            <div class="${modalClass}">
                <div class="permission-modal-header">
                    <div class="permission-icon">
                        ${icon}
                    </div>
                    <h3>${escapeHtml(config.title)}</h3>
                </div>
                <div class="permission-modal-body">
                    <p>${escapeHtml(config.message)}</p>
                    ${config.detail ? `<p class="detail-text">${escapeHtml(config.detail)}</p>` : ''}
                    ${config.showInfo ? `
                        <div class="info-box">
                            <svg class="info-box-icon" viewBox="0 0 24 24">
                                <path d="M11 9h2V7h-2m1 13c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m0-18A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2m-1 15h2v-6h-2v6z"/>
                            </svg>
                            <span class="info-box-text">${escapeHtml(config.infoText)}</span>
                        </div>
                    ` : ''}
                </div>
                <div class="permission-modal-footer">
                    <button class="permission-modal-btn permission-modal-btn-primary btn-close-modal">
                        ${escapeHtml(config.buttonText)}
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Shake animation
        setTimeout(() => {
            const modal = overlay.querySelector('.permission-modal');
            modal.classList.add('shake');
        }, 100);
        
        // Event listeners
        const closeBtn = overlay.querySelector('.btn-close-modal');
        
        function closeModal() {
            removeModal();
            if (typeof config.onClose === 'function') {
                config.onClose();
            }
        }
        
        closeBtn.addEventListener('click', closeModal);
        
        // Fechar ao clicar fora
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal();
            }
        });
        
        // Fechar com ESC
        function handleEsc(e) {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEsc);
            }
        }
        document.addEventListener('keydown', handleEsc);
        
        // Focus no botão
        closeBtn.focus();
    }
    
    // Helper para escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Métodos específicos
    function showPermissionDenied(customMessage, customDetail) {
        show({
            type: 'permission',
            title: 'Acesso Negado',
            message: customMessage || 'Você não tem permissão para editar este pedido.',
            detail: customDetail || '',
            showInfo: true,
            infoText: 'Apenas o vendedor responsável pelo pedido ou administradores podem realizar edições.'
        });
    }
    
    function showError(message, detail) {
        show({
            type: 'error',
            title: 'Erro',
            message: message || 'Ocorreu um erro ao processar sua solicitação.',
            detail: detail || '',
            showInfo: false,
            buttonText: 'Fechar'
        });
    }
    
    function showWarning(message, detail) {
        show({
            type: 'warning',
            title: 'Atenção',
            message: message,
            detail: detail || '',
            showInfo: false
        });
    }
    
    // Handler para erros de API
    function handleApiError(response, errorData) {
        if (response.status === 403) {
            // Erro de permissão
            const message = errorData?.message || 'Você não tem permissão para realizar esta ação.';
            const detail = errorData?.detail || '';
            showPermissionDenied(message, detail);
            return true; // Handled
        } else if (response.status === 404) {
            showError('Registro não encontrado', 'O item que você está tentando acessar não existe ou foi removido.');
            return true;
        } else if (response.status === 401) {
            showWarning('Sessão expirada', 'Por favor, faça login novamente.');
            setTimeout(() => {
                window.location.href = '/login.html';
            }, 2000);
            return true;
        }
        return false; // Not handled - let caller handle it
    }
    
    // Retorna API pública
    return {
        show: show,
        showPermissionDenied: showPermissionDenied,
        showError: showError,
        showWarning: showWarning,
        handleApiError: handleApiError,
        close: removeModal
    };
    
})();
