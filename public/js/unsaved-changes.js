/**
 * Sistema de Confirmação de Alterações Não Salvas
 * ALUFORCE v2.0
 * 
 * Modal elegante para confirmar descarte de alterações
 * Baseado no design da imagem de referência
 */

(function() {
    'use strict';

    // Rastrear formulários com alterações
    const formsWithChanges = new Map();

    // CSS do modal
    const injectStyles = () => {
        if (document.getElementById('unsaved-changes-styles')) return;

        const style = document.createElement('style');
        style.id = 'unsaved-changes-styles';
        style.textContent = `
            /* Modal Overlay */
            .unsaved-changes-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(15, 23, 42, 0.5);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 999999;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
            }

            .unsaved-changes-overlay.active {
                opacity: 1;
                visibility: visible;
            }

            /* Modal Container */
            .unsaved-changes-modal {
                background: white;
                border-radius: 16px;
                width: 90%;
                max-width: 380px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                transform: scale(0.9) translateY(20px);
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                overflow: hidden;
                text-align: center;
                padding: 32px 24px 24px;
            }

            .unsaved-changes-overlay.active .unsaved-changes-modal {
                transform: scale(1) translateY(0);
            }

            /* Título */
            .unsaved-changes-title {
                font-size: 18px;
                font-weight: 600;
                color: #374151;
                margin: 0 0 16px;
                font-family: 'Outfit', 'Inter', -apple-system, sans-serif;
            }

            /* Link de detalhes */
            .unsaved-changes-details {
                color: #06b6d4;
                font-size: 14px;
                cursor: pointer;
                text-decoration: none;
                margin-bottom: 24px;
                display: inline-block;
                transition: color 0.2s ease;
            }

            .unsaved-changes-details:hover {
                color: #0891b2;
                text-decoration: underline;
            }

            /* Lista de alterações */
            .unsaved-changes-list {
                background: #f8fafc;
                border-radius: 8px;
                padding: 12px 16px;
                margin: 0 0 24px;
                text-align: left;
                display: none;
                max-height: 150px;
                overflow-y: auto;
            }

            .unsaved-changes-list.show {
                display: block;
            }

            .unsaved-changes-list ul {
                margin: 0;
                padding-left: 20px;
            }

            .unsaved-changes-list li {
                font-size: 13px;
                color: #64748b;
                margin: 4px 0;
            }

            /* Botões */
            .unsaved-changes-buttons {
                display: flex;
                gap: 12px;
                justify-content: center;
            }

            .unsaved-changes-btn {
                padding: 10px 24px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
                border: 1px solid #e5e7eb;
                font-family: inherit;
                min-width: 80px;
            }

            .unsaved-changes-btn-yes {
                background: white;
                color: #374151;
            }

            .unsaved-changes-btn-yes:hover {
                background: #f9fafb;
                border-color: #d1d5db;
            }

            .unsaved-changes-btn-no {
                background: #e0f2fe;
                color: #0284c7;
                border-color: #bae6fd;
            }

            .unsaved-changes-btn-no:hover {
                background: #bae6fd;
                border-color: #7dd3fc;
            }

            /* Animação de shake para feedback */
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-5px); }
                75% { transform: translateX(5px); }
            }

            .unsaved-changes-modal.shake {
                animation: shake 0.3s ease;
            }
        `;
        document.head.appendChild(style);
    };

    // Criar modal no DOM
    const createModal = () => {
        if (document.getElementById('unsaved-changes-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'unsaved-changes-overlay';
        overlay.className = 'unsaved-changes-overlay';
        overlay.innerHTML = `
            <div class="unsaved-changes-modal">
                <h3 class="unsaved-changes-title">Desprezar as alterações realizadas?</h3>
                <a class="unsaved-changes-details" id="unsaved-changes-details-link">quais alterações?</a>
                <div class="unsaved-changes-list" id="unsaved-changes-list">
                    <ul id="unsaved-changes-list-items"></ul>
                </div>
                <div class="unsaved-changes-buttons">
                    <button class="unsaved-changes-btn unsaved-changes-btn-yes" id="unsaved-changes-yes">Sim</button>
                    <button class="unsaved-changes-btn unsaved-changes-btn-no" id="unsaved-changes-no">Não</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Event listeners
        const detailsLink = document.getElementById('unsaved-changes-details-link');
        const detailsList = document.getElementById('unsaved-changes-list');

        detailsLink.addEventListener('click', (e) => {
            e.preventDefault();
            detailsList.classList.toggle('show');
        });
    };

    /**
     * Mostra o modal de confirmação para alterações não salvas
     * @param {Object} options - Opções do modal
     * @param {string} options.title - Título customizado (opcional)
     * @param {Array<string>} options.changes - Lista de alterações feitas (opcional)
     * @returns {Promise<boolean>} - true se descartar, false se manter
     */
    window.confirmarDescartarAlteracoes = function(options = {}) {
        return new Promise((resolve) => {
            injectStyles();
            createModal();

            const overlay = document.getElementById('unsaved-changes-overlay');
            const modal = overlay.querySelector('.unsaved-changes-modal');
            const title = overlay.querySelector('.unsaved-changes-title');
            const listItems = document.getElementById('unsaved-changes-list-items');
            const detailsLink = document.getElementById('unsaved-changes-details-link');
            const detailsList = document.getElementById('unsaved-changes-list');
            const yesBtn = document.getElementById('unsaved-changes-yes');
            const noBtn = document.getElementById('unsaved-changes-no');

            // Configurar título
            title.textContent = options.title || 'Desprezar as alterações realizadas?';

            // Configurar lista de alterações
            listItems.innerHTML = '';
            detailsList.classList.remove('show');

            if (options.changes && options.changes.length > 0) {
                detailsLink.style.display = 'inline-block';
                options.changes.forEach(change => {
                    const li = document.createElement('li');
                    li.textContent = change;
                    listItems.appendChild(li);
                });
            } else {
                detailsLink.style.display = 'none';
            }

            // Limpar listeners antigos
            const newYesBtn = yesBtn.cloneNode(true);
            const newNoBtn = noBtn.cloneNode(true);
            yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
            noBtn.parentNode.replaceChild(newNoBtn, noBtn);

            // Função para fechar
            const closeModal = (result) => {
                overlay.classList.remove('active');
                setTimeout(() => resolve(result), 300);
            };

            // Sim - descartar
            newYesBtn.addEventListener('click', () => closeModal(true));

            // Não - manter
            newNoBtn.addEventListener('click', () => closeModal(false));

            // Clicar fora fecha (mantém alterações)
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    closeModal(false);
                }
            });

            // ESC fecha (mantém alterações)
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    closeModal(false);
                    document.removeEventListener('keydown', handleEsc);
                }
            };
            document.addEventListener('keydown', handleEsc);

            // Mostrar modal
            setTimeout(() => {
                overlay.classList.add('active');
                newNoBtn.focus();
            }, 10);
        });
    };

    /**
     * Rastrear alterações em um formulário
     * @param {HTMLFormElement|string} form - Formulário ou seletor
     * @param {Object} options - Opções de rastreamento
     */
    window.rastrearAlteracoesFormulario = function(form, options = {}) {
        const formEl = typeof form === 'string' ? document.querySelector(form) : form;
        if (!formEl) return;

        const formId = formEl.id || `form_${Date.now()}`;
        if (!formEl.id) formEl.id = formId;

        // Estado inicial
        const initialState = {};
        const changedFields = new Set();

        // Capturar estado inicial
        const inputs = formEl.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            const name = input.name || input.id;
            if (!name) return;

            if (input.type === 'checkbox' || input.type === 'radio') {
                initialState[name] = input.checked;
            } else {
                initialState[name] = input.value;
            }

            // Listener de mudança
            input.addEventListener('input', () => {
                const currentValue = input.type === 'checkbox' || input.type === 'radio' 
                    ? input.checked 
                    : input.value;

                if (currentValue !== initialState[name]) {
                    changedFields.add(name);
                } else {
                    changedFields.delete(name);
                }

                formsWithChanges.set(formId, changedFields.size > 0 ? Array.from(changedFields) : null);
            });
        });

        formsWithChanges.set(formId, null);
    };

    /**
     * Verificar se um formulário tem alterações
     * @param {HTMLFormElement|string} form - Formulário ou seletor
     * @returns {boolean}
     */
    window.formularioTemAlteracoes = function(form) {
        const formEl = typeof form === 'string' ? document.querySelector(form) : form;
        if (!formEl || !formEl.id) return false;
        return formsWithChanges.get(formEl.id) !== null;
    };

    /**
     * Obter lista de alterações de um formulário
     * @param {HTMLFormElement|string} form - Formulário ou seletor
     * @returns {Array<string>}
     */
    window.obterAlteracoesFormulario = function(form) {
        const formEl = typeof form === 'string' ? document.querySelector(form) : form;
        if (!formEl || !formEl.id) return [];
        return formsWithChanges.get(formEl.id) || [];
    };

    /**
     * Limpar rastreamento de alterações
     * @param {HTMLFormElement|string} form - Formulário ou seletor
     */
    window.limparAlteracoesFormulario = function(form) {
        const formEl = typeof form === 'string' ? document.querySelector(form) : form;
        if (!formEl || !formEl.id) return;
        formsWithChanges.set(formEl.id, null);
    };

    /**
     * Verificar se há algum formulário com alterações na página
     * @returns {boolean}
     */
    window.temAlteracoesPendentes = function() {
        for (const [, changes] of formsWithChanges) {
            if (changes !== null) return true;
        }
        return false;
    };

    /**
     * Interceptar fechamento de modal com verificação de alterações
     * @param {HTMLElement|string} modal - Modal ou seletor
     * @param {HTMLElement|string} closeBtn - Botão de fechar ou seletor
     * @param {Function} onClose - Função a ser chamada ao fechar
     */
    window.interceptarFechamentoModal = function(modal, closeBtn, onClose) {
        const modalEl = typeof modal === 'string' ? document.querySelector(modal) : modal;
        const closeBtnEl = typeof closeBtn === 'string' ? document.querySelector(closeBtn) : closeBtn;

        if (!modalEl || !closeBtnEl) return;

        closeBtnEl.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Verificar se há formulário dentro do modal com alterações
            const form = modalEl.querySelector('form');
            if (form && formularioTemAlteracoes(form)) {
                const changes = obterAlteracoesFormulario(form);
                const descartar = await confirmarDescartarAlteracoes({
                    changes: changes.map(field => `Campo "${field}" foi modificado`)
                });

                if (descartar) {
                    limparAlteracoesFormulario(form);
                    if (onClose) onClose();
                }
            } else {
                if (onClose) onClose();
            }
        });
    };

    // Aviso antes de sair da página
    window.addEventListener('beforeunload', (e) => {
        if (temAlteracoesPendentes()) {
            e.preventDefault();
            e.returnValue = 'Você tem alterações não salvas. Deseja realmente sair?';
            return e.returnValue;
        }
    });

    console.log('✅ Sistema de Alterações Não Salvas inicializado');
})();
