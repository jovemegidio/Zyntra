/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║                    ALUFORCE - MODAL UNIFIED MANAGER                       ║
 * ║══════════════════════════════════════════════════════════════════════════║
 * ║  JavaScript para gerenciar modais padronizados                            ║
 * ║  Versão: 3.0 - Janeiro 2026                                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 * 
 * COMO USAR:
 * ---------
 * 1. Incluir este JS após o modal-unified.css
 * 
 * 2. Abrir modal:
 *    ModalUnified.open('meu-modal');
 *    
 * 3. Fechar modal:
 *    ModalUnified.close('meu-modal');
 *    
 * 4. Modal de confirmação:
 *    ModalUnified.confirm({
 *        title: 'Excluir item?',
 *        message: 'Esta ação não pode ser desfeita.',
 *        type: 'danger', // danger, warning, success, info
 *        confirmText: 'Excluir',
 *        cancelText: 'Cancelar',
 *        onConfirm: () => { ... },
 *        onCancel: () => { ... }
 *    });
 *    
 * 5. Modal de alerta:
 *    ModalUnified.alert({
 *        title: 'Sucesso!',
 *        message: 'Operação realizada.',
 *        type: 'success'
 *    });
 *    
 * 6. Criar modal dinamicamente:
 *    ModalUnified.create({
 *        id: 'modal-dinamico',
 *        title: 'Meu Modal',
 *        icon: 'fas fa-cog',
 *        size: 'md', // sm, md, lg, xl, full
 *        headerType: 'dark', // primary, dark, info, warning, danger, success
 *        body: '<p>Conteúdo HTML</p>',
 *        footer: true, // true, false, ou HTML custom
 *        onOpen: () => { ... },
 *        onClose: () => { ... },
 *        buttons: [
 *            { text: 'Cancelar', type: 'secondary', close: true },
 *            { text: 'Salvar', type: 'primary', onClick: () => { ... } }
 *        ]
 *    });
 *    
 * 7. Eventos:
 *    document.getElementById('meu-modal').addEventListener('modal:open', (e) => { ... });
 *    document.getElementById('meu-modal').addEventListener('modal:close', (e) => { ... });
 */

const ModalUnified = (function() {
    'use strict';
    
    // Estado dos modais
    const state = {
        openModals: [],
        zIndexBase: 10000
    };
    
    // Configurações padrão
    const defaults = {
        size: 'lg',
        headerType: 'dark',
        closeOnEscape: true,
        closeOnBackdrop: true,
        preventScroll: true
    };
    
    /**
     * Inicializa o sistema de modais
     */
    function init() {
        // Delegação de eventos para fechar modais
        document.addEventListener('click', function(e) {
            // Clique no botão de fechar
            if (e.target.matches('[data-close-modal], [data-close-modal] *')) {
                const btn = e.target.closest('[data-close-modal]');
                const modal = btn.closest('.modal-unified');
                if (modal) close(modal.id);
            }
            
            // Clique no backdrop
            if (e.target.classList.contains('modal-unified') && e.target.classList.contains('active')) {
                const modal = e.target;
                if (modal.dataset.closeOnBackdrop !== 'false') {
                    close(modal.id);
                }
            }
        });
        
        // Fechar com ESC
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && state.openModals.length > 0) {
                const topModal = state.openModals[state.openModals.length - 1];
                const modalEl = document.getElementById(topModal);
                if (modalEl && modalEl.dataset.closeOnEscape !== 'false') {
                    close(topModal);
                }
            }
        });
        
        console.log('🎯 ModalUnified inicializado');
    }
    
    /**
     * Abre um modal
     * @param {string} modalId - ID do modal
     * @param {Object} options - Opções adicionais
     */
    function open(modalId, options = {}) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            console.error(`Modal #${modalId} não encontrado`);
            return false;
        }
        
        // Já está aberto?
        if (modal.classList.contains('active')) return true;
        
        // Z-index para múltiplos modais
        modal.style.zIndex = state.zIndexBase + state.openModals.length;
        
        // Prevenir scroll do body
        if (defaults.preventScroll) {
            document.body.classList.add('modal-open');
        }
        
        // Abrir
        modal.classList.add('active');
        state.openModals.push(modalId);
        
        // Focus trap - focar no primeiro elemento focável
        setTimeout(() => {
            const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (focusable) focusable.focus();
        }, 100);
        
        // Disparar evento
        modal.dispatchEvent(new CustomEvent('modal:open', { detail: { modalId } }));
        
        // Callback
        if (options.onOpen) options.onOpen(modal);
        
        return true;
    }
    
    /**
     * Fecha um modal
     * @param {string} modalId - ID do modal
     * @param {Object} options - Opções adicionais
     */
    function close(modalId, options = {}) {
        const modal = document.getElementById(modalId);
        if (!modal) return false;
        
        // Não está aberto?
        if (!modal.classList.contains('active')) return true;
        
        // Remover da lista
        const index = state.openModals.indexOf(modalId);
        if (index > -1) state.openModals.splice(index, 1);
        
        // Fechar
        modal.classList.remove('active');
        
        // Restaurar scroll se não há mais modais
        if (state.openModals.length === 0) {
            document.body.classList.remove('modal-open');
        }
        
        // Disparar evento
        modal.dispatchEvent(new CustomEvent('modal:close', { detail: { modalId } }));
        
        // Callback
        if (options.onClose) options.onClose(modal);
        
        // Limpar modal dinâmico após animação
        if (modal.dataset.dynamic === 'true') {
            setTimeout(() => modal.remove(), 300);
        }
        
        return true;
    }
    
    /**
     * Fecha todos os modais abertos
     */
    function closeAll() {
        [...state.openModals].forEach(id => close(id));
    }
    
    /**
     * Cria um modal dinamicamente
     * @param {Object} config - Configuração do modal
     * @returns {HTMLElement} - Elemento do modal
     */
    function create(config = {}) {
        const {
            id = `modal-${Date.now()}`,
            title = 'Modal',
            icon = 'fas fa-window-maximize',
            size = defaults.size,
            headerType = defaults.headerType,
            body = '',
            footer = true,
            buttons = [],
            closeOnEscape = defaults.closeOnEscape,
            closeOnBackdrop = defaults.closeOnBackdrop,
            onOpen = null,
            onClose = null
        } = config;
        
        // Gerar HTML dos botões
        let footerHTML = '';
        if (footer === true && buttons.length > 0) {
            footerHTML = buttons.map(btn => {
                const closeAttr = btn.close ? 'data-close-modal' : '';
                const clickHandler = btn.onClick ? `onclick="(${btn.onClick.toString()})()"` : '';
                return `<button class="btn btn-${btn.type || 'secondary'}" ${closeAttr} ${clickHandler}>${btn.text}</button>`;
            }).join('');
        } else if (typeof footer === 'string') {
            footerHTML = footer;
        }
        
        // Criar elemento
        const modalHTML = `
            <div class="modal-unified" id="${id}" data-dynamic="true" data-close-on-escape="${closeOnEscape}" data-close-on-backdrop="${closeOnBackdrop}">
                <div class="modal-unified-content modal-${size}">
                    <div class="modal-unified-header header-${headerType}">
                        <h2><i class="${icon}"></i> ${title}</h2>
                        <button class="modal-unified-close" data-close-modal>&times;</button>
                    </div>
                    <div class="modal-unified-body">
                        ${body}
                    </div>
                    ${footerHTML ? `<div class="modal-unified-footer">${footerHTML}</div>` : ''}
                </div>
            </div>
        `;
        
        // Adicionar ao DOM
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById(id);
        
        // Adicionar callbacks aos eventos
        if (onOpen) modal.addEventListener('modal:open', onOpen);
        if (onClose) modal.addEventListener('modal:close', onClose);
        
        return modal;
    }
    
    /**
     * Modal de confirmação
     * @param {Object} config - Configuração
     * @returns {Promise} - Resolve com true se confirmado, false se cancelado
     */
    function confirm(config = {}) {
        return new Promise((resolve) => {
            const {
                title = 'Confirmar',
                message = 'Deseja continuar?',
                type = 'warning', // danger, warning, success, info
                confirmText = 'Confirmar',
                cancelText = 'Cancelar',
                confirmType = type === 'danger' ? 'danger' : 'primary',
                onConfirm = null,
                onCancel = null
            } = config;
            
            const icons = {
                danger: 'fas fa-exclamation-triangle',
                warning: 'fas fa-exclamation-circle',
                success: 'fas fa-check-circle',
                info: 'fas fa-info-circle'
            };
            
            const modal = create({
                id: `confirm-${Date.now()}`,
                title: title,
                icon: icons[type] || icons.warning,
                size: 'sm',
                headerType: type,
                closeOnBackdrop: false,
                body: `
                    <div class="confirm-box">
                        <div class="confirm-icon ${type}">
                            <i class="${icons[type] || icons.warning}"></i>
                        </div>
                        <p class="confirm-message">${message}</p>
                    </div>
                `,
                buttons: [
                    { 
                        text: cancelText, 
                        type: 'secondary', 
                        close: true,
                        onClick: () => {
                            if (onCancel) onCancel();
                            resolve(false);
                        }
                    },
                    { 
                        text: confirmText, 
                        type: confirmType,
                        close: true,
                        onClick: () => {
                            if (onConfirm) onConfirm();
                            resolve(true);
                        }
                    }
                ]
            });
            
            open(modal.id);
        });
    }
    
    /**
     * Modal de alerta simples
     * @param {Object} config - Configuração
     * @returns {Promise} - Resolve quando fechado
     */
    function alert(config = {}) {
        return new Promise((resolve) => {
            const {
                title = 'Aviso',
                message = '',
                type = 'info', // danger, warning, success, info
                buttonText = 'OK'
            } = config;
            
            const icons = {
                danger: 'fas fa-times-circle',
                warning: 'fas fa-exclamation-circle',
                success: 'fas fa-check-circle',
                info: 'fas fa-info-circle'
            };
            
            const modal = create({
                id: `alert-${Date.now()}`,
                title: title,
                icon: icons[type] || icons.info,
                size: 'sm',
                headerType: type,
                body: `
                    <div class="confirm-box">
                        <div class="confirm-icon ${type}">
                            <i class="${icons[type] || icons.info}"></i>
                        </div>
                        <p class="confirm-message">${message}</p>
                    </div>
                `,
                buttons: [
                    { 
                        text: buttonText, 
                        type: 'primary',
                        close: true,
                        onClick: () => resolve()
                    }
                ]
            });
            
            open(modal.id);
        });
    }
    
    /**
     * Atualiza o conteúdo do body de um modal
     * @param {string} modalId - ID do modal
     * @param {string} html - Novo conteúdo HTML
     */
    function setBody(modalId, html) {
        const modal = document.getElementById(modalId);
        if (!modal) return false;
        const body = modal.querySelector('.modal-unified-body');
        if (body) body.innerHTML = html;
        return true;
    }
    
    /**
     * Mostra loading no modal
     * @param {string} modalId - ID do modal
     * @param {string} message - Mensagem de loading
     */
    function showLoading(modalId, message = 'Carregando...') {
        setBody(modalId, `
            <div class="loading">
                <div class="loading-spinner"></div>
                <span>${message}</span>
            </div>
        `);
    }
    
    /**
     * Verifica se um modal está aberto
     * @param {string} modalId - ID do modal
     * @returns {boolean}
     */
    function isOpen(modalId) {
        return state.openModals.includes(modalId);
    }
    
    /**
     * Retorna quantidade de modais abertos
     * @returns {number}
     */
    function getOpenCount() {
        return state.openModals.length;
    }
    
    // Inicializar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // API pública
    return {
        open,
        close,
        closeAll,
        create,
        confirm,
        alert,
        setBody,
        showLoading,
        isOpen,
        getOpenCount,
        init
    };
})();

// Expor globalmente
window.ModalUnified = ModalUnified;
