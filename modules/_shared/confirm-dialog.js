/**
 * ═══════════════════════════════════════════════════════════════════
 * ALUFORCE ERP — Sistema de Confirmação Profissional v2.0
 * ═══════════════════════════════════════════════════════════════════
 * Substitui automaticamente TODOS os confirm() nativos do navegador
 * por um modal elegante, profissional e padronizado.
 *
 * Uso manual (async):
 *   const ok = await ConfirmDialog.show({ title, message, type });
 *   const ok = await ConfirmDialog.delete('Nome do Item', 'Tipo');
 *   const ok = await ConfirmDialog.action('Descrição da ação');
 *
 * Uso automático:
 *   Qualquer chamada confirm('...') existente no código será
 *   interceptada automaticamente. Nenhuma alteração necessária.
 *
 * @version 2.0.0
 * @date 2026-02-17
 */

(function () {
    'use strict';

    // Evitar carregamento duplo
    if (window.__aluConfirmDialogLoaded) return;
    window.__aluConfirmDialogLoaded = true;

    // ═══════════════════════════════════════════════════════════
    // CSS — Estilos do Modal
    // ═══════════════════════════════════════════════════════════
    var STYLES = '' +
    '/* ALUFORCE CONFIRM DIALOG v2.0 */' +
    '.alu-confirm-overlay {' +
    '    position: fixed; inset: 0;' +
    '    background: rgba(15, 23, 42, 0.55);' +
    '    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);' +
    '    display: flex; align-items: center; justify-content: center;' +
    '    z-index: 999999; opacity: 0; visibility: hidden;' +
    '    transition: opacity 0.25s ease, visibility 0.25s ease;' +
    '    padding: 16px;' +
    '}' +
    '.alu-confirm-overlay.active { opacity: 1; visibility: visible; }' +

    '.alu-confirm-card {' +
    '    background: #ffffff; border-radius: 20px;' +
    '    box-shadow: 0 0 0 1px rgba(0,0,0,0.03), 0 20px 60px -12px rgba(0,0,0,0.28);' +
    '    max-width: 440px; width: 100%;' +
    '    transform: scale(0.92) translateY(18px);' +
    '    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);' +
    '    overflow: hidden;' +
    '}' +
    '.alu-confirm-overlay.active .alu-confirm-card { transform: scale(1) translateY(0); }' +

    '.alu-confirm-topbar { height: 4px; width: 100%; }' +
    '.alu-confirm-topbar.danger  { background: linear-gradient(90deg, #EF4444, #DC2626); }' +
    '.alu-confirm-topbar.warning { background: linear-gradient(90deg, #F59E0B, #D97706); }' +
    '.alu-confirm-topbar.info    { background: linear-gradient(90deg, #3B82F6, #2563EB); }' +
    '.alu-confirm-topbar.success { background: linear-gradient(90deg, #10B981, #059669); }' +

    '.alu-confirm-header { padding: 28px 28px 0; display: flex; align-items: flex-start; gap: 18px; }' +

    '.alu-confirm-icon {' +
    '    width: 52px; height: 52px; border-radius: 14px;' +
    '    display: flex; align-items: center; justify-content: center; flex-shrink: 0;' +
    '}' +
    '.alu-confirm-icon i { font-size: 24px; }' +
    '.alu-confirm-icon.danger  { background: linear-gradient(135deg, #FEE2E2, #FECACA); color: #DC2626; }' +
    '.alu-confirm-icon.warning { background: linear-gradient(135deg, #FEF3C7, #FDE68A); color: #D97706; }' +
    '.alu-confirm-icon.info    { background: linear-gradient(135deg, #DBEAFE, #BFDBFE); color: #2563EB; }' +
    '.alu-confirm-icon.success { background: linear-gradient(135deg, #D1FAE5, #A7F3D0); color: #059669; }' +

    '.alu-confirm-body { flex: 1; padding-top: 2px; }' +
    '.alu-confirm-title {' +
    '    font-size: 17px; font-weight: 700; color: #111827;' +
    '    margin: 0 0 8px 0; line-height: 1.35; letter-spacing: -0.01em;' +
    '}' +
    '.alu-confirm-message {' +
    '    font-size: 14px; color: #6B7280; line-height: 1.6;' +
    '    margin: 0; word-break: break-word;' +
    '}' +
    '.alu-confirm-message strong { color: #374151; font-weight: 600; }' +

    '.alu-confirm-footer { padding: 22px 28px 26px; display: flex; gap: 10px; justify-content: flex-end; }' +

    '.alu-confirm-btn {' +
    '    padding: 10px 22px; border-radius: 10px; font-size: 13.5px; font-weight: 600;' +
    '    cursor: pointer; transition: all 0.18s ease; border: none;' +
    '    display: inline-flex; align-items: center; gap: 8px;' +
    '    letter-spacing: 0.01em; user-select: none; line-height: 1.4;' +
    '}' +
    '.alu-confirm-btn:focus-visible { outline: 3px solid rgba(59,130,246,0.45); outline-offset: 2px; }' +

    '.alu-confirm-btn.cancel {' +
    '    background: #F3F4F6; color: #4B5563; border: 1px solid #E5E7EB;' +
    '}' +
    '.alu-confirm-btn.cancel:hover { background: #E5E7EB; border-color: #D1D5DB; }' +

    '.alu-confirm-btn.confirm {' +
    '    background: linear-gradient(135deg, #3B82F6, #2563EB); color: #fff;' +
    '    box-shadow: 0 2px 8px rgba(59,130,246,0.35);' +
    '}' +
    '.alu-confirm-btn.confirm:hover {' +
    '    background: linear-gradient(135deg, #2563EB, #1D4ED8);' +
    '    transform: translateY(-1px); box-shadow: 0 4px 12px rgba(59,130,246,0.45);' +
    '}' +

    '.alu-confirm-btn.confirm.danger {' +
    '    background: linear-gradient(135deg, #EF4444, #DC2626);' +
    '    box-shadow: 0 2px 8px rgba(239,68,68,0.35);' +
    '}' +
    '.alu-confirm-btn.confirm.danger:hover {' +
    '    background: linear-gradient(135deg, #DC2626, #B91C1C);' +
    '    box-shadow: 0 4px 12px rgba(239,68,68,0.45);' +
    '}' +

    '.alu-confirm-btn.confirm.warning-btn {' +
    '    background: linear-gradient(135deg, #F59E0B, #D97706);' +
    '    box-shadow: 0 2px 8px rgba(245,158,11,0.35);' +
    '}' +
    '.alu-confirm-btn.confirm.warning-btn:hover {' +
    '    background: linear-gradient(135deg, #D97706, #B45309);' +
    '    box-shadow: 0 4px 12px rgba(245,158,11,0.45);' +
    '}' +

    '.alu-confirm-btn.confirm.success {' +
    '    background: linear-gradient(135deg, #10B981, #059669);' +
    '    box-shadow: 0 2px 8px rgba(16,185,129,0.35);' +
    '}' +
    '.alu-confirm-btn.confirm.success:hover {' +
    '    background: linear-gradient(135deg, #059669, #047857);' +
    '    box-shadow: 0 4px 12px rgba(16,185,129,0.45);' +
    '}' +

    '@keyframes aluConfirmPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }' +
    '.alu-confirm-overlay.active .alu-confirm-icon { animation: aluConfirmPulse 0.5s ease 0.15s 1; }' +

    '@media (max-width:480px) {' +
    '    .alu-confirm-card { max-width:100%; border-radius:16px; }' +
    '    .alu-confirm-header { padding:22px 20px 0; gap:14px; }' +
    '    .alu-confirm-footer { padding:18px 20px 22px; flex-direction:column-reverse; }' +
    '    .alu-confirm-btn { width:100%; justify-content:center; padding:12px 20px; }' +
    '}' +

    '@media (prefers-color-scheme:dark) {' +
    '    .alu-confirm-card { background:#1F2937; box-shadow:0 20px 60px -12px rgba(0,0,0,0.6); }' +
    '    .alu-confirm-title { color:#F9FAFB; }' +
    '    .alu-confirm-message { color:#9CA3AF; }' +
    '    .alu-confirm-message strong { color:#D1D5DB; }' +
    '    .alu-confirm-btn.cancel { background:#374151; color:#D1D5DB; border-color:#4B5563; }' +
    '    .alu-confirm-btn.cancel:hover { background:#4B5563; border-color:#6B7280; }' +
    '}';

    // ═══════════════════════════════════════════════════════════
    // MAPA DE ÍCONES
    // ═══════════════════════════════════════════════════════════
    var ICON_MAP = {
        danger:  'fa-trash-alt',
        warning: 'fa-exclamation-triangle',
        info:    'fa-info-circle',
        success: 'fa-check-circle'
    };

    // ═══════════════════════════════════════════════════════════
    // Injetar CSS (uma única vez)
    // ═══════════════════════════════════════════════════════════
    function _injectCSS() {
        if (document.getElementById('alu-confirm-css')) return;
        var s = document.createElement('style');
        s.id = 'alu-confirm-css';
        s.textContent = STYLES;
        document.head.appendChild(s);
    }

    // ═══════════════════════════════════════════════════════════
    // Criar / reutilizar overlay
    // ═══════════════════════════════════════════════════════════
    function _getOverlay() {
        var el = document.getElementById('alu-confirm-overlay');
        if (el) return el;

        el = document.createElement('div');
        el.id = 'alu-confirm-overlay';
        el.className = 'alu-confirm-overlay';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.innerHTML =
            '<div class="alu-confirm-card">' +
                '<div class="alu-confirm-topbar" id="alu-cf-topbar"></div>' +
                '<div class="alu-confirm-header">' +
                    '<div class="alu-confirm-icon" id="alu-cf-icon"><i class="fas"></i></div>' +
                    '<div class="alu-confirm-body">' +
                        '<h3 class="alu-confirm-title" id="alu-cf-title"></h3>' +
                        '<p class="alu-confirm-message" id="alu-cf-msg"></p>' +
                    '</div>' +
                '</div>' +
                '<div class="alu-confirm-footer">' +
                    '<button class="alu-confirm-btn cancel" id="alu-cf-cancel">' +
                        '<i class="fas fa-times"></i><span></span>' +
                    '</button>' +
                    '<button class="alu-confirm-btn confirm" id="alu-cf-ok">' +
                        '<i class="fas"></i><span></span>' +
                    '</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(el);
        return el;
    }

    // ═══════════════════════════════════════════════════════════
    // showConfirmDialog — API principal (Promise)
    // ═══════════════════════════════════════════════════════════
    function showConfirmDialog(options) {
        options = options || {};
        return new Promise(function (resolve) {
            _injectCSS();
            var overlay = _getOverlay();

            var type        = options.type        || 'warning';
            var title       = options.title       || 'Confirmar Ação';
            var message     = options.message     || 'Tem certeza que deseja continuar?';
            var confirmText = options.confirmText || 'Confirmar';
            var cancelText  = options.cancelText  || 'Cancelar';
            var confirmIcon = options.confirmIcon || 'fa-check';
            var danger      = options.danger      || false;
            var showCancel  = options.showCancel !== undefined ? options.showCancel : true;

            // Topbar
            var topbar = document.getElementById('alu-cf-topbar');
            topbar.className = 'alu-confirm-topbar ' + type;

            // Ícone
            var iconBox = document.getElementById('alu-cf-icon');
            iconBox.className = 'alu-confirm-icon ' + type;
            iconBox.querySelector('i').className = 'fas ' + (ICON_MAP[type] || ICON_MAP.warning);

            // Título e mensagem
            document.getElementById('alu-cf-title').textContent = title;
            document.getElementById('alu-cf-msg').innerHTML = message;

            // Botão Cancelar
            var cancelBtn = document.getElementById('alu-cf-cancel');
            cancelBtn.querySelector('span').textContent = cancelText;
            cancelBtn.style.display = showCancel ? '' : 'none';

            // Botão Confirmar
            var okBtn = document.getElementById('alu-cf-ok');
            okBtn.querySelector('i').className = 'fas ' + confirmIcon;
            okBtn.querySelector('span').textContent = confirmText;
            // Cor do botão
            okBtn.className = 'alu-confirm-btn confirm';
            if (danger || type === 'danger') {
                okBtn.classList.add('danger');
            } else if (type === 'warning') {
                okBtn.classList.add('warning-btn');
            } else if (type === 'success') {
                okBtn.classList.add('success');
            }

            // ── Função para fechar ──
            function close(result) {
                overlay.classList.remove('active');
                cancelBtn.onclick = null;
                okBtn.onclick = null;
                overlay.onclick = null;
                document.removeEventListener('keydown', onKey);
                setTimeout(function () { resolve(result); }, 260);
            }

            function onKey(e) {
                if (e.key === 'Escape') close(false);
                if (e.key === 'Enter')  close(true);
            }

            cancelBtn.onclick = function () { close(false); };
            okBtn.onclick     = function () { close(true);  };
            overlay.onclick   = function (e) { if (e.target === overlay) close(false); };
            document.addEventListener('keydown', onKey);

            // Mostrar com requestAnimationFrame para a animação funcionar
            requestAnimationFrame(function () {
                overlay.classList.add('active');
                okBtn.focus();
            });
        });
    }

    // ═══════════════════════════════════════════════════════════
    // Atalhos semânticos
    // ═══════════════════════════════════════════════════════════

    function _escapeHtml(str) {
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    /** Confirmação de exclusão */
    function confirmDelete(itemName, itemType) {
        itemType = itemType || 'item';
        return showConfirmDialog({
            title: 'Excluir ' + itemType,
            message: 'Tem certeza que deseja excluir <strong>' + _escapeHtml(itemName) +
                     '</strong>?<br><small style="color:#9CA3AF;margin-top:6px;display:block">' +
                     'Esta ação não pode ser desfeita.</small>',
            type: 'danger',
            confirmText: 'Excluir',
            confirmIcon: 'fa-trash-alt',
            danger: true
        });
    }

    /** Confirmação genérica */
    function confirmAction(actionMsg) {
        return showConfirmDialog({
            title: 'Confirmar Ação',
            message: actionMsg,
            type: 'warning',
            confirmText: 'Sim, continuar',
            confirmIcon: 'fa-check'
        });
    }

    // ═══════════════════════════════════════════════════════════
    // AUTO-INTERCEPT — Substitui window.confirm automaticamente
    // ═══════════════════════════════════════════════════════════

    var _lastClickTarget = null;
    var _bypassMessage   = null;
    var _dialogActive    = false;

    // Rastrear cliques na fase de captura (antes dos handlers dos elementos)
    document.addEventListener('click', function (e) {
        _lastClickTarget =
            e.target.closest('button, a, [onclick], .btn, [role="button"], td, tr, li, .action-btn, .btn-danger, .btn-delete') ||
            e.target;
    }, true);

    // Salvar o confirm nativo
    var _nativeConfirm = window.confirm;

    /**
     * Detecta automaticamente o tipo/contexto a partir da mensagem.
     */
    function _autoDetect(msg) {
        var lower = (msg || '').toLowerCase();

        // Exclusão / Remoção
        if (/exclu|delet|remov|apag|elimina/i.test(lower)) {
            return {
                title: 'Confirmar Exclusão',
                message: msg.replace(/\n/g, '<br>'),
                type: 'danger', confirmText: 'Excluir',
                confirmIcon: 'fa-trash-alt', danger: true
            };
        }
        // Cancelamento / Irreversível / Inutilização
        if (/cancelar|cancelamento|irrevers|inutiliza/i.test(lower)) {
            return {
                title: '⚠️ Ação Irreversível',
                message: msg.replace(/\n/g, '<br>'),
                type: 'danger', confirmText: 'Sim, continuar',
                confirmIcon: 'fa-exclamation-triangle', danger: true
            };
        }
        // Inativação / Bloqueio
        if (/inativ|desativ|bloquear/i.test(lower)) {
            return {
                title: 'Confirmar Ação',
                message: msg.replace(/\n/g, '<br>'),
                type: 'warning', confirmText: 'Sim, continuar',
                confirmIcon: 'fa-ban'
            };
        }
        // Sair / Fechar / Logout
        if (/\bsair\b|fechar|logout/i.test(lower)) {
            return {
                title: 'Sair',
                message: msg.replace(/\n/g, '<br>'),
                type: 'warning', confirmText: 'Sair',
                confirmIcon: 'fa-sign-out-alt'
            };
        }
        // Limpar / Restaurar / Resetar
        if (/limpar|restaurar|resetar|padr[aã]o/i.test(lower)) {
            return {
                title: 'Confirmar',
                message: msg.replace(/\n/g, '<br>'),
                type: 'warning', confirmText: 'Sim, continuar',
                confirmIcon: 'fa-undo'
            };
        }
        // Enviar / Publicar / Emitir / Aprovar / Gerar
        if (/enviar|publicar|emitir|emiss[aã]o|aprovar|gerar|executar/i.test(lower)) {
            return {
                title: 'Confirmar',
                message: msg.replace(/\n/g, '<br>'),
                type: 'info', confirmText: 'Confirmar',
                confirmIcon: 'fa-paper-plane'
            };
        }
        // Alterações não salvas
        if (/altera[çc][oõ]es|n[aã]o salv/i.test(lower)) {
            return {
                title: 'Alterações não salvas',
                message: msg.replace(/\n/g, '<br>'),
                type: 'warning', confirmText: 'Sim, descartar',
                confirmIcon: 'fa-exclamation-triangle'
            };
        }
        // Converter
        if (/converter/i.test(lower)) {
            return {
                title: 'Confirmar Conversão',
                message: msg.replace(/\n/g, '<br>'),
                type: 'info', confirmText: 'Converter',
                confirmIcon: 'fa-exchange-alt'
            };
        }
        // Padrão
        return {
            title: 'Confirmar Ação',
            message: msg.replace(/\n/g, '<br>'),
            type: 'warning', confirmText: 'Confirmar',
            confirmIcon: 'fa-check'
        };
    }

    // ── Override de window.confirm ──
    window.confirm = function (message) {
        // Modo bypass: re-click após confirmação → retornar true
        if (_bypassMessage !== null && _bypassMessage === message) {
            _bypassMessage = null;
            return true;
        }

        // Prevenir diálogos duplicados
        if (_dialogActive) return false;
        _dialogActive = true;

        // Capturar o elemento que disparou o clique
        var triggerEl = _lastClickTarget;
        var config = _autoDetect(message);

        // Mostrar diálogo profissional (async)
        showConfirmDialog(config).then(function (confirmed) {
            _dialogActive = false;
            if (confirmed && triggerEl && triggerEl.isConnected) {
                _bypassMessage = message;
                try { triggerEl.click(); }
                catch (e) { console.warn('[ConfirmDialog] Falha ao re-disparar:', e); }
            }
        });

        // Retorna false para bloquear a ação síncrona original
        return false;
    };

    // ═══════════════════════════════════════════════════════════
    // Exportar API pública
    // ═══════════════════════════════════════════════════════════
    window.ConfirmDialog = {
        show:    showConfirmDialog,
        delete:  confirmDelete,
        action:  confirmAction,
        /** Restaurar confirm nativo (para debug) */
        restoreNative: function () { window.confirm = _nativeConfirm; }
    };

    // Aliases globais para compatibilidade
    window.showConfirmDialog = showConfirmDialog;
    window.confirmDelete     = confirmDelete;
    window.confirmAction     = confirmAction;

    console.log('[ConfirmDialog] \u2705 v2.0 — Sistema de confirmação profissional ativo (auto-intercept ON)');
})();
