;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               /* ============================================
   ALUFORCE - Sistema de Modais
   Correção Global e Gerenciamento
   Versão 2.0 - Janeiro 2026
   ============================================ */

(function() {
    'use strict';
    
    // Aguardar DOM carregar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModalSystem);
    } else {
        initModalSystem();
    }
    
    function initModalSystem() {
        console.log('[ALUFORCE] Sistema de Modais v2.0 inicializado');
        
        // Aplicar correções de CSS inline para garantir funcionamento
        injectModalStyles();
        
        // Configurar todos os modais existentes
        setupAllModals();
        
        // Observer para modais criados dinamicamente
        observeDynamicModals();
        
        // Expor API global
        window.AluforceModal = {
            open: openModal,
            close: closeModal,
            closeAll: closeAllModals
        };
    }
    
    /**
     * Injeta estilos críticos inline para garantir funcionamento
     */
    function injectModalStyles() {
        const styleId = 'aluforce-modal-fix-styles';
        
        if (document.getElementById(styleId)) return;
        
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* MODAL FIX - Estilos prioritários */
            .modal-overlay {
                display: none !important;
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                background: rgba(15, 23, 42, 0.6) !important;
                backdrop-filter: blur(4px) !important;
                -webkit-backdrop-filter: blur(4px) !important;
                z-index: 9999 !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 20px !important;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.25s ease, visibility 0.25s ease;
            }
            
            .modal-overlay.active,
            .modal-overlay[style*="display: flex"],
            .modal-overlay.show,
            .modal-overlay.open {
                display: flex !important;
                opacity: 1 !important;
                visibility: visible !important;
            }
            
            .modal-overlay .modal {
                background: #ffffff !important;
                border-radius: 16px !important;
                width: 100% !important;
                max-width: 700px;
                max-height: 90vh !important;
                overflow: hidden !important;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25) !important;
                display: flex !important;
                flex-direction: column !important;
                transform: scale(0.95);
                opacity: 0;
                transition: transform 0.25s ease, opacity 0.25s ease;
            }
            
            .modal-overlay.active .modal,
            .modal-overlay.show .modal,
            .modal-overlay.open .modal {
                transform: scale(1) !important;
                opacity: 1 !important;
            }
            
            .modal-overlay .modal.modal-lg {
                max-width: 900px;
            }
            
            .modal-overlay .modal.modal-sm {
                max-width: 480px;
            }
            
            .modal .modal-header {
                padding: 20px 24px !important;
                border-bottom: 1px solid #e2e8f0 !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                background: #ffffff !important;
                flex-shrink: 0 !important;
            }
            
            .modal .modal-header h2 {
                font-size: 18px !important;
                font-weight: 700 !important;
                color: #0f172a !important;
                display: flex !important;
                align-items: center !important;
                gap: 12px !important;
                margin: 0 !important;
            }
            
            .modal .modal-header h2 i {
                width: 36px !important;
                height: 36px !important;
                background: rgba(37, 99, 235, 0.1) !important;
                color: #2563eb !important;
                border-radius: 8px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-size: 16px !important;
            }
            
            .modal .modal-close {
                width: 36px !important;
                height: 36px !important;
                border: none !important;
                background: #f1f5f9 !important;
                border-radius: 8px !important;
                cursor: pointer !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-size: 16px !important;
                color: #64748b !important;
                transition: all 0.15s ease !important;
            }
            
            .modal .modal-close:hover {
                background: #fef2f2 !important;
                color: #ef4444 !important;
            }
            
            .modal .modal-body {
                padding: 24px !important;
                overflow-y: auto !important;
                flex: 1 !important;
            }
            
            .modal .modal-footer {
                padding: 16px 24px !important;
                border-top: 1px solid #e2e8f0 !important;
                display: flex !important;
                justify-content: flex-end !important;
                gap: 12px !important;
                background: #f8fafc !important;
                flex-shrink: 0 !important;
            }
            
            /* Impedir scroll do body quando modal aberto */
            body.modal-open {
                overflow: hidden !important;
            }
        `;
        
        document.head.appendChild(style);
    }
    
    /**
     * Configura todos os modais existentes na página
     */
    function setupAllModals() {
        // Encontrar todos os overlays de modal
        const overlays = document.querySelectorAll('.modal-overlay, [id$="-modal"], [id$="Modal"]');
        
        overlays.forEach(overlay => {
            // Verificar se é um overlay ou o modal em si
            if (!overlay.classList.contains('modal-overlay')) {
                // Se for modal sem overlay, envolver
                if (!overlay.parentElement.classList.contains('modal-overlay')) {
                    wrapModalWithOverlay(overlay);
                }
            }
            
            setupModalOverlay(overlay);
        });
        
        // Configurar botões de abrir modal
        setupOpenButtons();
    }
    
    /**
     * Envolve modal com overlay se necessário
     */
    function wrapModalWithOverlay(modal) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = modal.id + '-overlay';
        
        modal.parentNode.insertBefore(overlay, modal);
        overlay.appendChild(modal);
        
        // Adicionar classe modal se não tiver
        if (!modal.classList.contains('modal')) {
            modal.classList.add('modal');
        }
    }
    
    /**
     * Configura overlay de modal
     */
    function setupModalOverlay(overlay) {
        if (overlay._aluforceSetup) return;
        overlay._aluforceSetup = true;
        
        // Fechar ao clicar no overlay (fora do modal)
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                closeModal(overlay);
            }
        });
        
        // Configurar botões de fechar
        const closeButtons = overlay.querySelectorAll('.modal-close, .btn-close, [data-dismiss="modal"], [data-close-modal]');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                closeModal(overlay);
            });
        });
        
        // Configurar botão cancelar
        const cancelButtons = overlay.querySelectorAll('.btn-cancel, [data-cancel]');
        cancelButtons.forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                closeModal(overlay);
            });
        });
    }
    
    /**
     * Configura botões que abrem modais
     */
    function setupOpenButtons() {
        // Botões com data-modal
        document.querySelectorAll('[data-modal], [data-open-modal]').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                const modalId = this.dataset.modal || this.dataset.openModal;
                const modal = document.getElementById(modalId);
                if (modal) openModal(modal);
            });
        });
        
        // Botões com onclick que contém openModal ou showModal
        document.querySelectorAll('[onclick*="openModal"], [onclick*="showModal"], [onclick*="abrirModal"]').forEach(btn => {
            // Os botões com onclick já têm handlers, não precisa adicionar
        });
    }
    
    /**
     * Abre um modal
     */
    function openModal(modalOrId) {
        let overlay;
        
        if (typeof modalOrId === 'string') {
            overlay = document.getElementById(modalOrId);
            if (!overlay) {
                // Tentar encontrar com sufixo -overlay
                overlay = document.getElementById(modalOrId + '-overlay');
            }
            if (!overlay) {
                overlay = document.querySelector(modalOrId);
            }
        } else {
            overlay = modalOrId;
        }
        
        if (!overlay) {
            console.warn('[ALUFORCE Modal] Modal não encontrado:', modalOrId);
            return false;
        }
        
        // Se é o modal e não o overlay, encontrar o overlay
        if (!overlay.classList.contains('modal-overlay')) {
            const parentOverlay = overlay.closest('.modal-overlay');
            if (parentOverlay) {
                overlay = parentOverlay;
            }
        }
        
        // Configurar se ainda não foi
        if (!overlay._aluforceSetup) {
            setupModalOverlay(overlay);
        }
        
        // Abrir
        overlay.classList.add('active');
        overlay.style.display = 'flex';
        document.body.classList.add('modal-open');
        
        // Focar primeiro input
        setTimeout(() => {
            const firstInput = overlay.querySelector('input:not([type="hidden"]), select, textarea');
            if (firstInput) firstInput.focus();
        }, 100);
        
        // Disparar evento
        overlay.dispatchEvent(new CustomEvent('modal:open', { bubbles: true }));
        
        console.log('[ALUFORCE Modal] Modal aberto:', overlay.id || 'sem-id');
        return true;
    }
    
    /**
     * Fecha um modal
     */
    function closeModal(modalOrId) {
        let overlay;
        
        if (typeof modalOrId === 'string') {
            overlay = document.getElementById(modalOrId);
            if (!overlay) overlay = document.querySelector(modalOrId);
        } else {
            overlay = modalOrId;
        }
        
        if (!overlay) return false;
        
        // Se é o modal e não o overlay, encontrar o overlay
        if (!overlay.classList.contains('modal-overlay')) {
            const parentOverlay = overlay.closest('.modal-overlay');
            if (parentOverlay) {
                overlay = parentOverlay;
            }
        }
        
        // Fechar
        overlay.classList.remove('active', 'show', 'open');
        overlay.style.display = 'none';
        
        // Verificar se ainda há modais abertos
        const openModals = document.querySelectorAll('.modal-overlay.active, .modal-overlay[style*="display: flex"]');
        if (openModals.length === 0) {
            document.body.classList.remove('modal-open');
        }
        
        // Disparar evento
        overlay.dispatchEvent(new CustomEvent('modal:close', { bubbles: true }));
        
        console.log('[ALUFORCE Modal] Modal fechado:', overlay.id || 'sem-id');
        return true;
    }
    
    /**
     * Fecha todos os modais
     */
    function closeAllModals() {
        const overlays = document.querySelectorAll('.modal-overlay');
        overlays.forEach(overlay => {
            overlay.classList.remove('active', 'show', 'open');
            overlay.style.display = 'none';
        });
        document.body.classList.remove('modal-open');
    }
    
    /**
     * Observer para modais criados dinamicamente
     */
    function observeDynamicModals() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        if (node.classList && node.classList.contains('modal-overlay')) {
                            setupModalOverlay(node);
                        }
                        const overlays = node.querySelectorAll ? node.querySelectorAll('.modal-overlay') : [];
                        overlays.forEach(setupModalOverlay);
                    }
                });
            });
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Fechar modal com ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const openModals = document.querySelectorAll('.modal-overlay.active, .modal-overlay[style*="display: flex"]');
            if (openModals.length > 0) {
                closeModal(openModals[openModals.length - 1]);
            }
        }
    });
    
    // Funções globais para compatibilidade
    window.openModal = function(modalId) {
        return openModal(modalId);
    };
    
    window.closeModal = function(modalId) {
        return closeModal(modalId);
    };
    
    window.abrirModal = function(modalId) {
        return openModal(modalId);
    };
    
    window.fecharModal = function(modalId) {
        return closeModal(modalId);
    };
    
    window.showModal = function(modalId) {
        return openModal(modalId);
    };
    
    window.hideModal = function(modalId) {
        return closeModal(modalId);
    };
    
})();
