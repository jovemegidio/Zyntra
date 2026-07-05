/**
 * ═══════════════════════════════════════════════════════════════════
 * ALUFORCE ERP — Gerenciador de Inatividade v1.0
 * ═══════════════════════════════════════════════════════════════════
 * Detecta inatividade do usuário (sem cliques, teclado, scroll, etc.)
 * e exibe modal de aviso antes de encerrar a sessão automaticamente.
 *
 * - Auto-inicializa após evento 'authSuccess'
 * - Modal segue o design system do ConfirmDialog (confirm-dialog.js)
 * - Integra com AluforceAuth para logout e refresh
 * - Configuração centralizada de tempos
 * - Zero dependências externas (CSS embutido)
 *
 * @version 1.0.0
 * @date 2026-03-24
 */
(function () {
   'use strict';

   // Evitar carregamento duplo
   if (window.__aluInactivityManagerLoaded) return;
   window.__aluInactivityManagerLoaded = true;

   // ═══════════════════════════════════════════════════════════
   // CONFIGURAÇÃO CENTRALIZADA (fácil de alterar)
   // ═══════════════════════════════════════════════════════════
   var CONFIG = {
      // Tempo de inatividade até exibir o modal de aviso (em milissegundos)
      // TC-AUTH-03-001: 4 horas de inatividade — aviso 5 min antes
      WARNING_TIMEOUT_MS: 3 * 60 * 60 * 1000 + 55 * 60 * 1000, // 3h55min

      // Tempo total de inatividade até logout automático (em milissegundos)
      // TC-AUTH-03-001: sessão encerrada após 4 horas de inatividade
      LOGOUT_TIMEOUT_MS: 4 * 60 * 60 * 1000,  // 4 horas

      // Intervalo de atualização do countdown no modal (em milissegundos)
      COUNTDOWN_INTERVAL_MS: 1000,

      // Debounce para eventos de atividade (evita overhead)
      ACTIVITY_DEBOUNCE_MS: 5000,

      // Eventos que contam como atividade do usuário
      // Reduzido para essenciais — 5s debounce para timer de 25min não precisa de mousemove
      ACTIVITY_EVENTS: [
         'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'focus'
      ],

      // Debug mode (logs no console)
      DEBUG: false
   };

   // Calcular tempo de graça (entre aviso e logout)
   var GRACE_PERIOD_MS = CONFIG.LOGOUT_TIMEOUT_MS - CONFIG.WARNING_TIMEOUT_MS;

   // Estado interno
   var _warningTimer = null;
   var _logoutTimer = null;
   var _countdownInterval = null;
   var _lastActivity = Date.now();
   var _isWarningVisible = false;
   var _isActive = false;       // Gerenciador está ativo?
   var _debounceTimeout = null;
   var _boundHandleActivity = null;

   function _debug(msg) {
      if (CONFIG.DEBUG) console.log('[INACTIVITY] ' + msg);
   }

   // ═══════════════════════════════════════════════════════════
   // CSS DO MODAL (mesmo padrão do ConfirmDialog)
   // ═══════════════════════════════════════════════════════════
   var MODAL_CSS = '' +
      '/* ALUFORCE INACTIVITY MODAL v1.0 */' +
      '.alu-inactivity-overlay {' +
      '    position: fixed; inset: 0;' +
      '    background: rgba(15, 23, 42, 0.55);' +
      '    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);' +
      '    display: flex; align-items: center; justify-content: center;' +
      '    z-index: 1000000; opacity: 0; visibility: hidden;' +
      '    transition: opacity 0.25s ease, visibility 0.25s ease;' +
      '    padding: 16px;' +
      '}' +
      '.alu-inactivity-overlay.active { opacity: 1; visibility: visible; }' +

      '.alu-inactivity-card {' +
      '    background: #ffffff; border-radius: 20px;' +
      '    box-shadow: 0 0 0 1px rgba(0,0,0,0.03), 0 20px 60px -12px rgba(0,0,0,0.28);' +
      '    max-width: 460px; width: 100%;' +
      '    transform: scale(0.92) translateY(18px);' +
      '    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);' +
      '    overflow: hidden;' +
      '}' +
      '.alu-inactivity-overlay.active .alu-inactivity-card { transform: scale(1) translateY(0); }' +

      '.alu-inactivity-topbar {' +
      '    height: 4px; width: 100%;' +
      '    background: linear-gradient(90deg, #F59E0B, #D97706);' +
      '}' +

      '.alu-inactivity-header {' +
      '    padding: 28px 28px 0; display: flex; align-items: flex-start; gap: 18px;' +
      '}' +

      '.alu-inactivity-icon {' +
      '    width: 52px; height: 52px; border-radius: 14px;' +
      '    display: flex; align-items: center; justify-content: center; flex-shrink: 0;' +
      '    background: linear-gradient(135deg, #FEF3C7, #FDE68A); color: #D97706;' +
      '}' +
      '.alu-inactivity-icon i { font-size: 24px; }' +

      '.alu-inactivity-body { flex: 1; padding-top: 2px; }' +
      '.alu-inactivity-title {' +
      '    font-size: 17px; font-weight: 700; color: #111827;' +
      '    margin: 0 0 8px 0; line-height: 1.35; letter-spacing: -0.01em;' +
      '}' +
      '.alu-inactivity-message {' +
      '    font-size: 14px; color: #6B7280; line-height: 1.6;' +
      '    margin: 0; word-break: break-word;' +
      '}' +
      '.alu-inactivity-message strong { color: #374151; font-weight: 600; }' +

      '.alu-inactivity-countdown {' +
      '    display: inline-flex; align-items: center; gap: 6px;' +
      '    margin-top: 12px; padding: 8px 14px; border-radius: 8px;' +
      '    background: #FEF3C7; color: #92400E; font-size: 13px; font-weight: 600;' +
      '    border: 1px solid #FDE68A;' +
      '}' +
      '.alu-inactivity-countdown i { font-size: 14px; }' +
      '.alu-inactivity-countdown .countdown-time {' +
      '    font-variant-numeric: tabular-nums; min-width: 36px;' +
      '}' +

      '.alu-inactivity-footer {' +
      '    padding: 22px 28px 26px; display: flex; gap: 10px; justify-content: flex-end;' +
      '}' +

      '.alu-inactivity-btn {' +
      '    padding: 10px 22px; border-radius: 10px; font-size: 13.5px; font-weight: 600;' +
      '    cursor: pointer; transition: all 0.18s ease; border: none;' +
      '    display: inline-flex; align-items: center; gap: 8px;' +
      '    letter-spacing: 0.01em; user-select: none; line-height: 1.4;' +
      '}' +
      '.alu-inactivity-btn:focus-visible {' +
      '    outline: 3px solid rgba(59,130,246,0.45); outline-offset: 2px;' +
      '}' +

      '.alu-inactivity-btn.cancel {' +
      '    background: #F3F4F6; color: #4B5563; border: 1px solid #E5E7EB;' +
      '}' +
      '.alu-inactivity-btn.cancel:hover { background: #E5E7EB; border-color: #D1D5DB; }' +

      '.alu-inactivity-btn.confirm {' +
      '    background: linear-gradient(135deg, #3B82F6, #2563EB); color: #fff;' +
      '    box-shadow: 0 2px 8px rgba(59,130,246,0.35);' +
      '}' +
      '.alu-inactivity-btn.confirm:hover {' +
      '    background: linear-gradient(135deg, #2563EB, #1D4ED8);' +
      '    transform: translateY(-1px); box-shadow: 0 4px 12px rgba(59,130,246,0.45);' +
      '}' +

      '@keyframes aluInactivityPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }' +
      '.alu-inactivity-overlay.active .alu-inactivity-icon {' +
      '    animation: aluInactivityPulse 0.5s ease 0.15s 1;' +
      '}' +

      '@media (max-width:480px) {' +
      '    .alu-inactivity-card { max-width:100%; border-radius:16px; }' +
      '    .alu-inactivity-header { padding:22px 20px 0; gap:14px; }' +
      '    .alu-inactivity-footer { padding:18px 20px 22px; flex-direction:column-reverse; }' +
      '    .alu-inactivity-btn { width:100%; justify-content:center; padding:12px 20px; }' +
      '}' +

      '@media (prefers-color-scheme:dark) {' +
      '    .alu-inactivity-card { background:#1F2937; box-shadow:0 20px 60px -12px rgba(0,0,0,0.6); }' +
      '    .alu-inactivity-title { color:#F9FAFB; }' +
      '    .alu-inactivity-message { color:#9CA3AF; }' +
      '    .alu-inactivity-message strong { color:#D1D5DB; }' +
      '    .alu-inactivity-countdown { background:#374151; color:#FDE68A; border-color:#4B5563; }' +
      '    .alu-inactivity-btn.cancel { background:#374151; color:#D1D5DB; border-color:#4B5563; }' +
      '    .alu-inactivity-btn.cancel:hover { background:#4B5563; border-color:#6B7280; }' +
      '}';

   // ═══════════════════════════════════════════════════════════
   // Injetar CSS (uma única vez)
   // ═══════════════════════════════════════════════════════════
   function _injectCSS() {
      if (document.getElementById('alu-inactivity-css')) return;
      var s = document.createElement('style');
      s.id = 'alu-inactivity-css';
      s.textContent = MODAL_CSS;
      document.head.appendChild(s);
   }

   // ═══════════════════════════════════════════════════════════
   // Criar Modal HTML (uma única vez, reutilizado)
   // ═══════════════════════════════════════════════════════════
   function _getOrCreateModal() {
      var el = document.getElementById('alu-inactivity-overlay');
      if (el) return el;

      el = document.createElement('div');
      el.id = 'alu-inactivity-overlay';
      el.className = 'alu-inactivity-overlay';
      el.setAttribute('role', 'alertdialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'alu-inactivity-title');
      el.setAttribute('aria-describedby', 'alu-inactivity-msg');
      el.innerHTML =
         '<div class="alu-inactivity-card">' +
         '<div class="alu-inactivity-topbar"></div>' +
         '<div class="alu-inactivity-header">' +
         '<div class="alu-inactivity-icon">' +
         '<i class="fas fa-clock"></i>' +
         '</div>' +
         '<div class="alu-inactivity-body">' +
         '<h3 class="alu-inactivity-title" id="alu-inactivity-title">' +
         'Sess\u00e3o quase expirada' +
         '</h3>' +
         '<p class="alu-inactivity-message" id="alu-inactivity-msg">' +
         'Voc\u00ea est\u00e1 h\u00e1 algum tempo sem interagir com o sistema. ' +
         'Para sua seguran\u00e7a, sua sess\u00e3o ser\u00e1 encerrada em breve.' +
         '</p>' +
         '<div class="alu-inactivity-countdown" id="alu-inactivity-countdown">' +
         '<i class="fas fa-hourglass-half"></i>' +
         '<span>Encerrando em </span>' +
         '<span class="countdown-time" id="alu-inactivity-timer">5:00</span>' +
         '</div>' +
         '</div>' +
         '</div>' +
         '<div class="alu-inactivity-footer">' +
         '<button class="alu-inactivity-btn cancel" id="alu-inactivity-logout">' +
         '<i class="fas fa-sign-out-alt"></i>' +
         '<span>Sair</span>' +
         '</button>' +
         '<button class="alu-inactivity-btn confirm" id="alu-inactivity-continue">' +
         '<i class="fas fa-check"></i>' +
         '<span>Continuar conectado</span>' +
         '</button>' +
         '</div>' +
         '</div>';

      document.body.appendChild(el);
      return el;
   }

   // ═══════════════════════════════════════════════════════════
   // Formatar tempo restante (mm:ss)
   // ═══════════════════════════════════════════════════════════
   function _formatTime(ms) {
      if (ms < 0) ms = 0;
      var totalSec = Math.ceil(ms / 1000);
      var min = Math.floor(totalSec / 60);
      var sec = totalSec % 60;
      return min + ':' + (sec < 10 ? '0' : '') + sec;
   }

   // ═══════════════════════════════════════════════════════════
   // Exibir o modal de aviso
   // ═══════════════════════════════════════════════════════════
   function _showWarningModal() {
      if (_isWarningVisible) return; // Evitar duplicação
      _isWarningVisible = true;
      _debug('Exibindo modal de inatividade');

      _injectCSS();
      var overlay = _getOrCreateModal();
      var timerEl = document.getElementById('alu-inactivity-timer');
      var continueBtn = document.getElementById('alu-inactivity-continue');
      var logoutBtn = document.getElementById('alu-inactivity-logout');

      // Calcular tempo restante até logout
      var logoutAt = _lastActivity + CONFIG.LOGOUT_TIMEOUT_MS;

      function updateCountdown() {
         var remaining = logoutAt - Date.now();
         if (remaining <= 0) {
            _hideWarningModal();
            _performAutoLogout();
            return;
         }
         if (timerEl) timerEl.textContent = _formatTime(remaining);
      }

      // Iniciar countdown
      updateCountdown();
      if (_countdownInterval) clearInterval(_countdownInterval);
      _countdownInterval = setInterval(updateCountdown, CONFIG.COUNTDOWN_INTERVAL_MS);

      // Handler: Continuar conectado
      function onContinue() {
         _debug('Usu\u00e1rio clicou em Continuar Conectado');
         _hideWarningModal();
         _renewSessionAndReset();
      }

      // Handler: Sair
      function onLogout() {
         _debug('Usu\u00e1rio clicou em Sair');
         _hideWarningModal();
         _performManualLogout();
      }

      // Handler: Tecla de atalho
      function onKeydown(e) {
         if (!_isWarningVisible) return;
         if (e.key === 'Escape') {
            e.preventDefault();
            onContinue(); // ESC = continuar conectado (ação segura)
         }
         if (e.key === 'Enter') {
            e.preventDefault();
            onContinue(); // Enter = continuar conectado
         }
      }

      // Registrar handlers
      continueBtn.onclick = onContinue;
      logoutBtn.onclick = onLogout;
      document.addEventListener('keydown', onKeydown);

      // Guardar referência ao handler do teclado para remover depois
      overlay._onKeydown = onKeydown;

      // Mostrar com animação
      requestAnimationFrame(function () {
         overlay.classList.add('active');
         continueBtn.focus();
      });

      // Disparar evento customizado
      window.dispatchEvent(new CustomEvent('inactivityWarning', {
         detail: { remainingMs: logoutAt - Date.now() }
      }));
   }

   // ═══════════════════════════════════════════════════════════
   // Ocultar o modal
   // ═══════════════════════════════════════════════════════════
   function _hideWarningModal() {
      _isWarningVisible = false;
      var overlay = document.getElementById('alu-inactivity-overlay');
      if (overlay) {
         overlay.classList.remove('active');
         if (overlay._onKeydown) {
            document.removeEventListener('keydown', overlay._onKeydown);
            overlay._onKeydown = null;
         }
      }
      if (_countdownInterval) {
         clearInterval(_countdownInterval);
         _countdownInterval = null;
      }
   }

   // ═══════════════════════════════════════════════════════════
   // Renovar sessão e resetar timers
   // ═══════════════════════════════════════════════════════════
   function _renewSessionAndReset() {
      _debug('Renovando sess\u00e3o...');

      // Resetar timers de inatividade
      _resetTimers();

      // Chamar refresh do token para renovar sessão no servidor
      if (window.AluforceAuth && typeof window.AluforceAuth.refreshToken === 'function') {
         window.AluforceAuth.refreshToken()
            .then(function (ok) {
               if (ok) {
                  _debug('Sess\u00e3o renovada com sucesso');
               } else {
                  _debug('Falha ao renovar sess\u00e3o (refresh retornou false)');
                  // Mesmo com falha no refresh, o timer foi resetado
                  // A próxima request com o cookie vai validar
               }
            })
            .catch(function (err) {
               _debug('Erro ao renovar sess\u00e3o: ' + err.message);
            });
      }

      window.dispatchEvent(new CustomEvent('inactivityReset'));
   }

   // ═══════════════════════════════════════════════════════════
   // Logout automático por inatividade
   // ═══════════════════════════════════════════════════════════
   function _performAutoLogout() {
      _debug('Logout autom\u00e1tico por inatividade');
      _stop();

      // Disparar evento antes do logout
      window.dispatchEvent(new CustomEvent('inactivityLogout', {
         detail: { reason: 'timeout' }
      }));

      // Limpar e redirecionar
      if (window.AluforceAuth && typeof window.AluforceAuth.logout === 'function') {
         window.AluforceAuth.logout();
      } else {
         // Fallback: limpar manualmente
         try { localStorage.clear(); } catch (e) { }
         try { sessionStorage.clear(); } catch (e) { }
         window.location.href = window.__withBasePath ? window.__withBasePath('/login.html?reason=inactivity') : '/login.html?reason=inactivity';
      }
   }

   // ═══════════════════════════════════════════════════════════
   // Logout manual (botão Sair)
   // ═══════════════════════════════════════════════════════════
   function _performManualLogout() {
      _debug('Logout manual pelo usu\u00e1rio');
      _stop();

      if (window.AluforceAuth && typeof window.AluforceAuth.logout === 'function') {
         window.AluforceAuth.logout();
      } else {
         try { localStorage.clear(); } catch (e) { }
         try { sessionStorage.clear(); } catch (e) { }
         window.location.href = window.__withBasePath ? window.__withBasePath('/login.html') : '/login.html';
      }
   }

   // ═══════════════════════════════════════════════════════════
   // Detectar atividade do usuário (com debounce)
   // ═══════════════════════════════════════════════════════════
   function _handleActivity() {
      // Se o modal de aviso está visível, a atividade não reseta automaticamente
      // O usuário deve clicar explicitamente em "Continuar conectado"
      if (_isWarningVisible) return;

      // Debounce: ignorar eventos muito frequentes
      if (_debounceTimeout) return;
      _debounceTimeout = setTimeout(function () {
         _debounceTimeout = null;
      }, CONFIG.ACTIVITY_DEBOUNCE_MS);

      _lastActivity = Date.now();
      _resetTimers();
   }

   // ═══════════════════════════════════════════════════════════
   // Resetar timers de inatividade
   // ═══════════════════════════════════════════════════════════
   function _resetTimers() {
      _lastActivity = Date.now();

      // Limpar timers existentes
      if (_warningTimer) { clearTimeout(_warningTimer); _warningTimer = null; }
      if (_logoutTimer) { clearTimeout(_logoutTimer); _logoutTimer = null; }

      // Agendar novo aviso
      _warningTimer = setTimeout(function () {
         _showWarningModal();
      }, CONFIG.WARNING_TIMEOUT_MS);

      // Agendar logout automático (safety net — o modal também tem countdown)
      _logoutTimer = setTimeout(function () {
         if (_isWarningVisible) {
            _hideWarningModal();
         }
         _performAutoLogout();
      }, CONFIG.LOGOUT_TIMEOUT_MS);

      _debug('Timers resetados. Aviso em ' + (CONFIG.WARNING_TIMEOUT_MS / 60000) + 'min, logout em ' + (CONFIG.LOGOUT_TIMEOUT_MS / 60000) + 'min');
   }

   var _boundVisibilityChange = null;

   // ═══════════════════════════════════════════════════════════
   // Iniciar monitoramento de inatividade
   // ═══════════════════════════════════════════════════════════
   function _start() {
      if (_isActive) return;
      _isActive = true;

      _debug('Iniciando monitoramento de inatividade');

      // Criar handler com bind (para poder remover depois)
      _boundHandleActivity = _handleActivity.bind(null);

      // Registrar listeners de atividade
      CONFIG.ACTIVITY_EVENTS.forEach(function (evt) {
         document.addEventListener(evt, _boundHandleActivity, { passive: true, capture: false });
      });

      // Também detectar foco na aba (quando o usuário volta para a aba)
      window.addEventListener('focus', _boundHandleActivity);

      // Detectar aba ficando visível (para checar inatividade acumulada)
      _boundVisibilityChange = function () {
         if (document.visibilityState === 'visible') {
            var elapsed = Date.now() - _lastActivity;
            if (elapsed >= CONFIG.LOGOUT_TIMEOUT_MS) {
               _performAutoLogout();
            } else if (elapsed >= CONFIG.WARNING_TIMEOUT_MS && !_isWarningVisible) {
               _showWarningModal();
            }
         }
      };
      document.addEventListener('visibilitychange', _boundVisibilityChange);

      // Iniciar timers
      _resetTimers();
   }

   // ═══════════════════════════════════════════════════════════
   // Parar monitoramento
   // ═══════════════════════════════════════════════════════════
   function _stop() {
      if (!_isActive) return;
      _isActive = false;

      _debug('Parando monitoramento de inatividade');

      // Remover listeners de atividade
      if (_boundHandleActivity) {
         CONFIG.ACTIVITY_EVENTS.forEach(function (evt) {
            document.removeEventListener(evt, _boundHandleActivity, { capture: false });
         });
         window.removeEventListener('focus', _boundHandleActivity);
         _boundHandleActivity = null;
      }
      if (_boundVisibilityChange) {
         document.removeEventListener('visibilitychange', _boundVisibilityChange);
         _boundVisibilityChange = null;
      }

      // Limpar timers
      if (_warningTimer) { clearTimeout(_warningTimer); _warningTimer = null; }
      if (_logoutTimer) { clearTimeout(_logoutTimer); _logoutTimer = null; }
      if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
      if (_debounceTimeout) { clearTimeout(_debounceTimeout); _debounceTimeout = null; }

      // Ocultar modal
      _hideWarningModal();
   }

   // ═══════════════════════════════════════════════════════════
   // Handler para AUTH_INACTIVE do servidor
   // ═══════════════════════════════════════════════════════════
   function _handleServerInactive() {
      _debug('Servidor reportou sess\u00e3o inativa (AUTH_INACTIVE)');

      // Mostrar o modal, permitindo ao usuário decidir
      // Se clicar "Continuar", o refresh token (7 dias) ainda é válido
      _isWarningVisible = false; // Reset para garantir que o modal abre
      _showWarningModal();
   }

   // ═══════════════════════════════════════════════════════════
   // API Pública
   // ═══════════════════════════════════════════════════════════
   window.InactivityManager = {
      start: _start,
      stop: _stop,
      reset: _resetTimers,
      isActive: function () { return _isActive; },
      isWarningVisible: function () { return _isWarningVisible; },
      handleServerInactive: _handleServerInactive,
      getConfig: function () {
         return {
            warningTimeoutMin: CONFIG.WARNING_TIMEOUT_MS / 60000,
            logoutTimeoutMin: CONFIG.LOGOUT_TIMEOUT_MS / 60000,
            graceMin: GRACE_PERIOD_MS / 60000
         };
      },
      setConfig: function (opts) {
         if (opts.warningTimeoutMin) CONFIG.WARNING_TIMEOUT_MS = opts.warningTimeoutMin * 60000;
         if (opts.logoutTimeoutMin) CONFIG.LOGOUT_TIMEOUT_MS = opts.logoutTimeoutMin * 60000;
         GRACE_PERIOD_MS = CONFIG.LOGOUT_TIMEOUT_MS - CONFIG.WARNING_TIMEOUT_MS;
         if (_isActive) _resetTimers();
      }
   };

   // ═══════════════════════════════════════════════════════════
   // AUTO-INICIALIZAÇÃO
   // ═══════════════════════════════════════════════════════════

   // Detectar página de login (não ativar nela)
   function _isLoginPage() {
      var path = window.location.pathname.toLowerCase();
      return path.includes('login') || path.endsWith('login.html');
   }

   if (_isLoginPage()) {
      _debug('P\u00e1gina de login detectada - inatividade n\u00e3o ser\u00e1 ativada');
      return;
   }

   // Iniciar quando autenticação for confirmada
   window.addEventListener('authSuccess', function () {
      _debug('Autentica\u00e7\u00e3o confirmada - iniciando monitoramento');
      _start();
   });

   // Escutar evento de inatividade do servidor (disparado pelo auth-unified.js)
   window.addEventListener('sessionInactive', function () {
      _handleServerInactive();
   });

   // Se a auth já foi verificada (caso o script carregou depois)
   if (window.AluforceAuth) {
      // Verificar se já há dados do usuário
      var localData = null;
      try {
         localData = JSON.parse(sessionStorage.getItem('tabUserData') || 'null');
      } catch (e) { }
      if (!localData) {
         try {
            localData = JSON.parse(localStorage.getItem('userData') || 'null');
         } catch (e) { }
      }
      if (localData && localData.id) {
         _debug('Usu\u00e1rio j\u00e1 autenticado - iniciando monitoramento imediatamente');
         _start();
      }
   }

   console.log('[INACTIVITY] Gerenciador de Inatividade v1.0 carregado (aviso: ' +
      (CONFIG.WARNING_TIMEOUT_MS / 60000) + 'min, logout: ' +
      (CONFIG.LOGOUT_TIMEOUT_MS / 60000) + 'min)');

})();
