/**
 * Modal Fix Global - ALUFORCE V.2
 * Script para garantir funcionamento consistente dos modais
 * Versão melhorada - não interfere com onclick existentes
 */

(function() {
    'use strict';
    
    console.log('🔧 Modal Fix Global inicializando...');
    
    // Aguardar DOM carregar
    document.addEventListener('DOMContentLoaded', function() {
        
        // Adicionar listener para fechar modais ao clicar no overlay
        document.addEventListener('click', function(e) {
            // Se clicou no overlay (não no conteúdo do modal)
            if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
                // Verificar se o modal tem onclick próprio - se tiver, não interferir
                if (!e.target.hasAttribute('onclick')) {
                    e.target.classList.remove('active');
                }
            }
        });
        
        // Adicionar listener para fechar modais com ESC
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const modalAtivo = document.querySelector('.modal-overlay.active');
                if (modalAtivo) {
                    modalAtivo.classList.remove('active');
                }
            }
        });
        
        // Re-vincular botões de fechar que NÍO têm onclick próprio
        setTimeout(function() {
            // Botões de fechar modal - APENAS se não tiverem onclick
            document.querySelectorAll('.modal-close, .modal-close-saas, [data-dismiss="modal"]').forEach(function(btn) {
                // Pular se já tem onclick ou já foi processado
                if (btn.hasAttribute('onclick') || btn.hasAttribute('data-modal-fix-bound')) {
                    return;
                }
                btn.setAttribute('data-modal-fix-bound', 'true');
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    const modal = btn.closest('.modal-overlay');
                    if (modal) {
                        modal.classList.remove('active');
                    }
                });
            });
            
            console.log('✅ Modal Fix Global: eventos vinculados');
        }, 500);
        
        // Observar mudanças no DOM para novos modais
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) { // Element node
                        // Verificar se é um modal ou contém modais
                        if (node.classList && node.classList.contains('modal-overlay')) {
                            setupModalClose(node);
                        }
                        const modais = node.querySelectorAll ? node.querySelectorAll('.modal-overlay') : [];
                        modais.forEach(setupModalClose);
                    }
                });
            });
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        function setupModalClose(modal) {
            if (!modal.hasAttribute('data-modal-fix-setup')) {
                modal.setAttribute('data-modal-fix-setup', 'true');
                
                // Fechar ao clicar no overlay - APENAS se não tiver onclick próprio
                if (!modal.hasAttribute('onclick')) {
                    modal.addEventListener('click', function(e) {
                        if (e.target === modal) {
                            modal.classList.remove('active');
                        }
                    });
                }
                
                // Vincular botões de fechar - APENAS se não tiverem onclick
                modal.querySelectorAll('.modal-close, .modal-close-saas').forEach(function(btn) {
                    if (!btn.hasAttribute('onclick')) {
                        btn.addEventListener('click', function(e) {
                            e.preventDefault();
                            modal.classList.remove('active');
                        });
                    }
                });
            }
        }
        
    });
    
    // Funções globais de fallback para modais
    window.fecharModalGlobal = function() {
        const modal = document.querySelector('.modal-overlay.active');
        if (modal) {
            modal.classList.remove('active');
        }
    };
    
    window.abrirModalPorId = function(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.add('active');
        } else {
            console.warn('Modal não encontrado:', id);
        }
    };
    
    window.fecharModalPorId = function(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('active');
        }
    };
    
    console.log('✅ Modal Fix Global carregado');
})();
