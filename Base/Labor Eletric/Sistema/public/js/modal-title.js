/**
 * Aluforce: Sistema de Título Dinâmico para Modais
 * 
 * Quando um modal é aberto, o título da aba muda para:
 *   "Aluforce: [Nome do Modal]"
 * 
 * Quando o modal é fechado, o título volta ao original da página.
 * 
 * USO:
 * 1. Inclua este script em qualquer página:
 *    <script src="/js/modal-title.js?v=20260210"></script>
 *
 * 2. Automático: detecta modais com class "modal-overlay" ou "modal-backdrop"
 *    e usa o texto do <h2> ou <h3> dentro do .modal-header como nome do modal.
 *
 * 3. Manual (se necessário):
 *    AluforceTitle.onModalOpen('Nome do Modal');
 *    AluforceTitle.onModalClose();
 * 
 * Versão: 1.0.0
 */
(function () {
    'use strict';

    const PREFIXO = 'Aluforce: ';
    let tituloOriginal = document.title;

    const AluforceTitle = {
        /**
         * Muda o título da aba para refletir o modal aberto
         * @param {string} nomeModal - Nome do modal (ex: "Editar Comissão")
         */
        onModalOpen(nomeModal) {
            if (!tituloOriginal) tituloOriginal = document.title;
            if (nomeModal) {
                document.title = PREFIXO + nomeModal;
            }
        },

        /**
         * Restaura o título original da página
         */
        onModalClose() {
            if (tituloOriginal) {
                document.title = tituloOriginal;
            }
        },

        /**
         * Retorna o título original da página (sem modal)
         */
        getTituloOriginal() {
            return tituloOriginal;
        }
    };

    // Expor globalmente
    window.AluforceTitle = AluforceTitle;

    // ==========================================
    // AUTO-DETECÇÃO: Observar abertura/fechamento de modais
    // ==========================================

    function extrairNomeModal(modalEl) {
        // Tenta encontrar o título do modal
        const headerEl = modalEl.querySelector('.modal-header h2, .modal-header h3, .modal h2, .modal h3, [class*="modal"] h2, [class*="modal"] h3');
        if (headerEl) {
            // Pega só o texto, sem ícones ou botões
            let texto = '';
            headerEl.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    texto += node.textContent.trim();
                } else if (node.tagName && !['BUTTON', 'I', 'SVG', 'SPAN'].includes(node.tagName.toUpperCase())) {
                    texto += node.textContent.trim();
                } else if (node.tagName === 'SPAN' && !node.classList.contains('modal-close') && !node.classList.contains('close')) {
                    texto += node.textContent.trim();
                }
            });
            texto = texto.replace(/[×✕✖]/g, '').trim();
            if (texto) return texto;
            
            // Fallback: innerText sem o botão de fechar
            const clone = headerEl.cloneNode(true);
            const closeBtn = clone.querySelector('.modal-close, .close, button');
            if (closeBtn) closeBtn.remove();
            const text = clone.textContent.trim().replace(/[×✕✖]/g, '').trim();
            if (text) return text;
        }

        // Tenta pelo atributo title ou aria-label do modal
        const ariaLabel = modalEl.getAttribute('aria-label') || modalEl.getAttribute('title');
        if (ariaLabel) return ariaLabel;

        // Tenta pelo data-title
        const dataTitle = modalEl.getAttribute('data-title') || modalEl.getAttribute('data-modal-title');
        if (dataTitle) return dataTitle;

        return null;
    }

    // MutationObserver para detectar mudanças de classe (active, show, open, visible)
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const el = mutation.target;
                const isModal = el.classList.contains('modal-overlay') ||
                    el.classList.contains('modal-backdrop') ||
                    el.classList.contains('modal-container') ||
                    el.id?.includes('modal') || el.id?.includes('Modal');

                if (!isModal) continue;

                const isVisible = el.classList.contains('active') ||
                    el.classList.contains('show') ||
                    el.classList.contains('open') ||
                    el.classList.contains('visible') ||
                    (el.style.display !== 'none' && el.classList.length > 0);

                const wasVisible = !(el.classList.contains('active') ||
                    el.classList.contains('show') ||
                    el.classList.contains('open') ||
                    el.classList.contains('visible'));

                if (isVisible && el.classList.contains('active')) {
                    const nome = extrairNomeModal(el);
                    if (nome) AluforceTitle.onModalOpen(nome);
                } else if (!el.classList.contains('active') &&
                    !el.classList.contains('show') &&
                    !el.classList.contains('open')) {
                    // Verificar se ainda há algum modal aberto
                    const modaisAbertos = document.querySelectorAll(
                        '.modal-overlay.active, .modal-backdrop.active, .modal-overlay.show, .modal-backdrop.show'
                    );
                    if (modaisAbertos.length === 0) {
                        AluforceTitle.onModalClose();
                    }
                }
            }

            // Detectar modais adicionados/removidos do DOM (display: flex/none)
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                const el = mutation.target;
                const isModal = el.classList.contains('modal-overlay') ||
                    el.classList.contains('modal-backdrop') ||
                    el.id?.includes('modal') || el.id?.includes('Modal');

                if (!isModal) continue;

                const display = el.style.display;
                if (display === 'flex' || display === 'block' || display === 'grid') {
                    const nome = extrairNomeModal(el);
                    if (nome) AluforceTitle.onModalOpen(nome);
                } else if (display === 'none' || display === '') {
                    const modaisAbertos = document.querySelectorAll(
                        '.modal-overlay.active, .modal-backdrop.active, .modal-overlay.show'
                    );
                    if (modaisAbertos.length === 0) {
                        AluforceTitle.onModalClose();
                    }
                }
            }
        }
    });

    // Iniciar observação quando o DOM estiver pronto
    function iniciarObservacao() {
        // Observar todo o body por mudanças de classe e estilo em modais
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style'],
            subtree: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciarObservacao);
    } else {
        iniciarObservacao();
    }

    // Atualizar tituloOriginal se a página mudar o título programaticamente
    // (ex: SPA navigation)
    let titleUpdateTimer = null;
    const originalTitleDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title') ||
        Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'title');

    // Salvar título original ao carregar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            tituloOriginal = document.title;
        });
    }
})();
