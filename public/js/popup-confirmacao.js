/**
 * Popup de Confirmação - Script Global ALUFORCE V.2
 * Design Profissional e Institucional
 */

(function() {
    'use strict';
    
    // Função global para exibir popup de confirmação
    window.mostrarPopupConfirmacao = function(opcoes) {
        const {
            titulo = 'Confirmação',
            mensagem = 'Deseja continuar?',
            icone = 'fa-exclamation-triangle',
            tipoIcone = 'warning', // 'danger', 'warning', 'success', 'info'
            textoBtnConfirmar = 'Confirmar',
            textoBtnCancelar = 'Cancelar',
            tipoBtnConfirmar = 'confirm', // 'confirm', 'danger', 'success'
            iconeBtnConfirmar = 'fa-check',
            iconeBtnCancelar = 'fa-times',
            itemNome = null, // Nome do item sendo afetado (ex: nome do registro a excluir)
            avisoExtra = null, // Texto de aviso adicional
            onConfirmar = null,
            onCancelar = null
        } = opcoes;
        
        // Remover popup existente se houver
        const popupExistente = document.getElementById('popup-confirmacao-global');
        if (popupExistente) popupExistente.remove();
        
        // Criar overlay do popup
        const overlay = document.createElement('div');
        overlay.id = 'popup-confirmacao-global';
        overlay.className = 'popup-confirmacao-overlay';
        
        // Determinar classe do botão
        let btnClass = 'popup-confirmacao-btn-confirm';
        if (tipoBtnConfirmar === 'danger') btnClass = 'popup-confirmacao-btn-danger';
        if (tipoBtnConfirmar === 'success') btnClass = 'popup-confirmacao-btn-success';
        
        // Montar HTML do item nome se existir
        const itemNomeHtml = itemNome ? `<span class="item-name">${itemNome}</span>` : '';
        
        // Montar HTML do aviso extra se existir
        const avisoHtml = avisoExtra ? `
            <div class="popup-confirmacao-warning-text">
                <i class="fas fa-exclamation-circle"></i>
                <span>${avisoExtra}</span>
            </div>
        ` : '';
        
        // HTML do popup - Design Profissional
        overlay.innerHTML = `
            <div class="popup-confirmacao-content ${tipoBtnConfirmar === 'danger' ? 'popup-exclusao' : ''}">
                <div class="popup-confirmacao-header">
                    <div class="popup-confirmacao-icon-wrapper ${tipoIcone}">
                        <i class="fas ${icone} popup-confirmacao-icon ${tipoIcone}"></i>
                    </div>
                    <h3 class="popup-confirmacao-title">${titulo}</h3>
                </div>
                <div class="popup-confirmacao-body">
                    ${mensagem}
                    ${itemNomeHtml}
                    ${avisoHtml}
                </div>
                <div class="popup-confirmacao-footer">
                    <button class="popup-confirmacao-btn popup-confirmacao-btn-cancel" data-action="cancelar">
                        <i class="fas ${iconeBtnCancelar}"></i>
                        ${textoBtnCancelar}
                    </button>
                    <button class="popup-confirmacao-btn ${btnClass}" data-action="confirmar">
                        <i class="fas ${iconeBtnConfirmar}"></i>
                        ${textoBtnConfirmar}
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Adicionar eventos aos botões
        const btnConfirmar = overlay.querySelector('[data-action="confirmar"]');
        const btnCancelar = overlay.querySelector('[data-action="cancelar"]');
        
        const fecharPopup = () => {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        };
        
        btnConfirmar.addEventListener('click', () => {
            fecharPopup();
            if (onConfirmar) onConfirmar();
        });
        
        btnCancelar.addEventListener('click', () => {
            fecharPopup();
            if (onCancelar) onCancelar();
        });
        
        // Fechar ao clicar fora
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                fecharPopup();
                if (onCancelar) onCancelar();
            }
        });
        
        // Fechar com ESC
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                fecharPopup();
                if (onCancelar) onCancelar();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
        
        // Mostrar popup
        setTimeout(() => overlay.classList.add('active'), 10);
        
        // Focar no botão cancelar para segurança
        setTimeout(() => btnCancelar.focus(), 100);
    };
    
    // Função específica para exclusão - Design profissional
    window.confirmarExclusao = function(opcoes) {
        // Verificar se opcoes foi passado
        if (!opcoes || typeof opcoes !== 'object') {
            console.error('confirmarExclusao: opcoes inválidas', opcoes);
            opcoes = {};
        }
        
        const {
            titulo = 'Excluir Registro',
            mensagem = 'Tem certeza que deseja excluir este item?',
            itemNome = null,
            onConfirmar = null,
            onCancelar = null
        } = opcoes;
        
        mostrarPopupConfirmacao({
            titulo: titulo,
            mensagem: mensagem,
            icone: 'fa-trash-alt',
            tipoIcone: 'danger',
            textoBtnConfirmar: 'Sim, Excluir',
            textoBtnCancelar: 'Cancelar',
            tipoBtnConfirmar: 'danger',
            iconeBtnConfirmar: 'fa-trash-alt',
            iconeBtnCancelar: 'fa-times',
            itemNome: itemNome,
            avisoExtra: 'Esta ação não pode ser desfeita.',
            onConfirmar: onConfirmar,
            onCancelar: onCancelar
        });
    };
    
    // Função para confirmação de sucesso/ação positiva
    window.confirmarAcao = function(opcoes) {
        const {
            titulo = 'Confirmar Ação',
            mensagem = 'Deseja continuar?',
            itemNome = null,
            textoBtnConfirmar = 'Confirmar',
            onConfirmar = null,
            onCancelar = null
        } = opcoes;
        
        mostrarPopupConfirmacao({
            titulo: titulo,
            mensagem: mensagem,
            icone: 'fa-check-circle',
            tipoIcone: 'success',
            textoBtnConfirmar: textoBtnConfirmar,
            textoBtnCancelar: 'Cancelar',
            tipoBtnConfirmar: 'success',
            iconeBtnConfirmar: 'fa-check',
            iconeBtnCancelar: 'fa-times',
            itemNome: itemNome,
            onConfirmar: onConfirmar,
            onCancelar: onCancelar
        });
    };
    
    console.log('✅ Popup de Confirmação V.2 inicializado');
})();
