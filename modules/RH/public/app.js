/**
 * Script unificado para o Portal do Funcionário e para a Área Administrativa.
 * Detecta a página (admin ou funcionário) e inicializa as funcionalidades relevantes.
 */
document.addEventListener('DOMContentLoaded', () => {
    const isAdminPage = document.getElementById('tabela-funcionarios');
    const isEmployeePage = document.getElementById('welcome-message');
    
    // Debug: identificar qual página estamos
    console.log('🔍 DEBUG Page Detection:', {
        currentURL: window.location.href,
        isAdminPage: !!isAdminPage,
        isEmployeePage: !!isEmployeePage,
        pageTitle: document.title
    });

    // VERIFICAÇÁO DE REDIRECIONAMENTO BASEADO NO ROLE DO USUÁRIO
    try {
        const userData = JSON.parse(localStorage.getItem('userData') || 'null');
        if (userData) {
            const isUserAdmin = userData.role === 'admin' || userData.is_admin || userData.rh_admin;
            
            // Se é admin mas está na página de funcionário
            if (isUserAdmin && isEmployeePage) {
                console.warn('⚠️ Usuário admin na página de funcionário, redirecionando...');
                window.location.href = '/RecursosHumanos/areaadm.html';
                return;
            }
            
            // Se é funcionário mas está na página admin
            if (!isUserAdmin && isAdminPage) {
                console.warn('⚠️ Usuário funcionário na página admin, redirecionando...');
                window.location.href = '/RecursosHumanos/area.html';
                return;
            }
            
            console.log('✅ Usuário na página correta:', { isAdmin: isUserAdmin, onAdminPage: !!isAdminPage, onEmployeePage: !!isEmployeePage });
        }
    } catch (e) {
        console.error('Erro ao verificar redirecionamento:', e);
    }

    // If we have cached user data, populate header immediately to avoid "Carregando..."
    try {
        const cached = JSON.parse(localStorage.getItem('userData') || 'null');
        if (cached) populateUserData(cached);
    } catch (e) { /* ignore parse errors */ }

    // Global avatar -> open a small dropdown with logout (better UX than immediate logout)
    function setupAvatarMenu() {
        const avatar = document.getElementById('header-avatar-img');
        if (!avatar) return;
        avatar.style.cursor = 'pointer';
    // ensure fallback if image 404s
    try { avatar.onerror = function(){ this.onerror=null; this.src = '/Interativo-Aluforce.jpg'; }; } catch(e){}
        // create menu if missing
        let menu = document.getElementById('avatar-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'avatar-menu';
            menu.className = 'avatar-menu';
            menu.style.display = 'none';
            // Minimal menu: only the logout button to keep UI compact
            menu.innerHTML = `
                <div class="avatar-menu-inner">
                    <button id="avatar-home" class="btn avatar-home">Página Inicial</button>
                    <button id="avatar-logout" class="btn avatar-logout">Sair</button>
                </div>
            `;
            document.body.appendChild(menu);
        }

        // position and toggle
        avatar.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const rect = avatar.getBoundingClientRect();
            // toggle visibility
            if (menu.style.display === 'block') {
                menu.style.display = 'none';
                return;
            }
            // small delay to ensure offsetWidth is available
            menu.style.display = 'block';
            menu.style.position = 'absolute';
            // place to the right edge of avatar, aligned to top of avatar
            const left = Math.min(window.innerWidth - 220, rect.right - 200);
            menu.style.left = (left < 8 ? 8 : left) + 'px';
            menu.style.top = (rect.bottom + 8) + 'px';
            // position only; no name displayed in the compact menu
        });

        // hide when clicking outside (but not when interacting with the menu)
        document.addEventListener('click', (ev) => { if (menu && !menu.contains(ev.target) && ev.target !== avatar) menu.style.display = 'none'; });

        // menu click handlers: Home and Logout
        menu.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetId = e.target && e.target.id ? e.target.id : '';
            if (targetId === 'avatar-logout') {
                localStorage.clear();
                safeRedirectToLogin();
            } else if (targetId === 'avatar-home') {
                // If we're already on area.html, just show the dashboard section
                const current = window.location.pathname || '';
                if (current.endsWith('/area.html') || current.endsWith('/area')) {
                    // navigate within the SPA to the dashboard section
                    const dash = document.getElementById('dashboard');
                    if (dash) {
                        // hide visible sections and show dashboard
                        document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
                        dash.classList.add('active');
                        // close sidebar for clarity
                        const sb = document.querySelector('.sidebar'); if (sb) { sb.classList.remove('open'); localStorage.setItem('sidebarOpen', 'false'); }
                    } else {
                        // fallback: ensure we are on the area page
                        window.location.href = '/area.html';
                    }
                } else {
                    window.location.href = '/area.html';
                }
                // hide menu after action
                menu.style.display = 'none';
            }
        });
    }
    setupAvatarMenu();

    // Track first user interaction to avoid auto-opening modals before user intent
    function markUserInteracted() { 
        window._userInteracted = true; 
        window._modalAllowed = true; // Adicional: permitir modais após interaçáo
        ['click','keydown','touchstart'].forEach(ev => document.removeEventListener(ev, markUserInteracted)); 
    }
    ['click','keydown','touchstart'].forEach(ev => document.addEventListener(ev, markUserInteracted, { once: true }));
    
    // Resetar permissões de modal a cada carregamento de página
    window._modalAllowed = false;
    window._modalExplicitlyRequested = false;
    
    // Garantir que todos os modais estejam fechados na inicializaçáo
    setTimeout(() => {
        const allModals = document.querySelectorAll('.modal');
        allModals.forEach(modal => {
            modal.classList.remove('open');
            modal.style.display = 'none';
        });
        console.log('🔒 Todos os modais forçadamente fechados na inicializaçáo');
    }, 100);

    if (isAdminPage) {
        console.log("Inicializando a Área do Administrador...");
        initAdminPage();
    } else if (isEmployeePage) {
        console.log("Inicializando o Portal do Funcionário...");
        initEmployeePage();
    }

        // Carregar avisos do admin para todos os funcionários
        if (isEmployeePage) {
            fetch('/api/avisos', { headers: getAuthHeaders() })
                .then(r => r.json())
                .then(data => {
                    const avisosBox = document.getElementById('avisos-box');
                    if (avisosBox && Array.isArray(data) && data.length) {
                        avisosBox.innerHTML = data.map(a => `<div class="aviso-item"><strong>${a.titulo}</strong><p>${a.mensagem}</p></div>`).join('');
                    } else if (avisosBox) {
                        avisosBox.innerHTML = '<p class="muted">Nenhum aviso disponível.</p>';
                    }
                })
                .catch(() => {
                    const avisosBox = document.getElementById('avisos-box');
                    if (avisosBox) avisosBox.innerHTML = '<p class="muted">Erro ao carregar avisos.</p>';
                });
        }

        // Desabilitar/ocultar holerite e ponto se náo houver arquivos anexados
        if (isEmployeePage) {
            try {
                const user = JSON.parse(localStorage.getItem('userData') || 'null') || {}
                const id = user.id
                // If cached userData already contains holerites/espelho_ponto, enable widgets immediately
                try {
                    const holLinkCached = document.getElementById('widget-holerite-link')
                    const pontoLinkCached = document.getElementById('widget-ponto-link')
                    if (user && user.holerites && Array.isArray(user.holerites) && user.holerites.length > 0) {
                        if (holLinkCached) enableControl(holLinkCached)
                    }
                    if (user && (user.espelho_ponto || user.ponto) ) {
                        if (pontoLinkCached) enableControl(pontoLinkCached)
                    }
                } catch (e) { /* ignore DOM errors */ }
                if (id) {
                    fetch(`/api/funcionarios/${id}/doc-status`, { headers: getAuthHeaders() })
                        .then(r => r.json())
                        .then(s => {
                            const holLink = document.getElementById('widget-holerite-link')
                            const pontoLink = document.getElementById('widget-ponto-link')
                            if (holLink) {
                                if (!s || !s.hasHolerite) disableControl(holLink, 'Aguardando holerite anexado pelo administrador.')
                                else enableControl(holLink)
                            }
                            if (pontoLink) {
                                if (!s || !s.hasPonto) disableControl(pontoLink, 'Aguardando espelho de ponto anexado pelo administrador.')
                                else enableControl(pontoLink)
                            }
                        }).catch(() => {})
                }
            } catch (e) { /* ignore */ }
        }

        // Corrigir menu lateral do funcionário (garantir toggle)
        if (isEmployeePage) {
            const menuToggle = document.getElementById('menu-toggle');
            const sidebar = document.querySelector('.sidebar');
            if (menuToggle && sidebar) {
                menuToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    sidebar.classList.toggle('open');
                    localStorage.setItem('sidebarOpen', sidebar.classList.contains('open'));
                });
                document.addEventListener('click', (ev) => {
                    if (!sidebar.classList.contains('open')) return;
                    const target = ev.target;
                    if (target === menuToggle || menuToggle.contains(target)) return;
                    if (sidebar.contains(target)) return;
                    sidebar.classList.remove('open');
                    localStorage.setItem('sidebarOpen', 'false');
                });
            }
        }

        // Corrigir aniversariantes na área admin
        if (isAdminPage) {
            fetch('/api/aniversariantes', { headers: getAuthHeaders() })
                .then(r => r.json())
                .then(data => {
                    const ul = document.getElementById('dashboard-aniversariantes-list');
                    if (ul && Array.isArray(data) && data.length) {
                        ul.innerHTML = data.map(a => `<li><strong>${a.nome}</strong> - ${formatDayMonth(a.nascimento)}</li>`).join('');
                    } else if (ul) {
                        ul.innerHTML = '<li>Nenhum aniversariante encontrado.</li>';
                    }
                })
                .catch(() => {
                    const ul = document.getElementById('dashboard-aniversariantes-list');
                    if (ul) ul.innerHTML = '<li>Erro ao carregar aniversariantes.</li>';
                });
        }

    // Global: wire menu-toggle if present to open/close sidebar for both pages
    const menuToggleGlobal = document.getElementById('menu-toggle');
    const sidebarGlobal = document.querySelector('.sidebar');
    if (menuToggleGlobal && sidebarGlobal) {
        // restore persisted state on load
        try {
            const stored = localStorage.getItem('sidebarOpen');
            if (stored === 'true') sidebarGlobal.classList.add('open');
            else sidebarGlobal.classList.remove('open');
            menuToggleGlobal.setAttribute('aria-expanded', sidebarGlobal.classList.contains('open') ? 'true' : 'false');
            // update icon to reflect state
            const initialIcon = menuToggleGlobal.querySelector('i');
            if (initialIcon) {
                if (sidebarGlobal.classList.contains('open')) { initialIcon.classList.remove('fa-bars'); initialIcon.classList.add('fa-times'); }
                else { initialIcon.classList.remove('fa-times'); initialIcon.classList.add('fa-bars'); }
            }
        } catch (e) { /* ignore storage errors */ }

        menuToggleGlobal.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = !sidebarGlobal.classList.contains('open');
            sidebarGlobal.classList.toggle('open');
            localStorage.setItem('sidebarOpen', sidebarGlobal.classList.contains('open'));
            menuToggleGlobal.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            // swap icon between bars and times for clearer UX
            const icon = menuToggleGlobal.querySelector('i');
            if (icon) {
                if (willOpen) { icon.classList.remove('fa-bars'); icon.classList.add('fa-times'); }
                else { icon.classList.remove('fa-times'); icon.classList.add('fa-bars'); }
            }
        });
        // close sidebar when clicking outside
        document.addEventListener('click', (ev) => {
            if (!sidebarGlobal.classList.contains('open')) return;
            const target = ev.target;
            if (target === menuToggleGlobal || menuToggleGlobal.contains(target)) return;
            if (sidebarGlobal.contains(target)) return;
            sidebarGlobal.classList.remove('open');
            localStorage.setItem('sidebarOpen', 'false');
            menuToggleGlobal.setAttribute('aria-expanded', 'false');
        });
    }
});

// Helper: cria headers com Authorization se token existir
function getAuthHeaders(additional = {}) {
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    const headers = Object.assign({}, additional || {});
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

// SSO Helper: cria configuração de fetch com credentials para cookies httpOnly
function ssoFetch(url, options = {}) {
    return fetch(url, {
        ...options,
        credentials: 'include', // SSO: envia cookie automaticamente
        headers: {
            ...getAuthHeaders(options.headers || {})
        }
    });
}

// Debug helpers for redirect tracing
// Enable by setting `window.DEBUG_REDIRECTS = true` in the browser console
window.DEBUG_REDIRECTS = window.DEBUG_REDIRECTS || false;
window.redirectEventLog = window.redirectEventLog || [];
function notifyRedirectAttempt(source, details) {
    try {
        const from = window.location.href;
        const entry = { time: new Date().toISOString(), source, from, details: details || '' };
        try { window.redirectEventLog.push(entry); } catch (e) { /* ignore */ }
        console.info('[redirect-debug]', entry);
        if (window.DEBUG_REDIRECTS && typeof showToast === 'function') {
            showToast(`Redirecionamento: ${source} — ${details || ''}`, 'info', 6000);
        }
    } catch (e) { console.debug('notifyRedirectAttempt failed', e); }
}

// Redirect to login in a safe way: wait briefly for any injected token (polling window.__APP_READY)
// to avoid racing with injected storage before forcing navigation. Uses a small timeout to avoid hanging.
function safeRedirectToLogin() {
    try {
        // Allow tests or other callers to opt-out
        if (window.SKIP_LOGIN_REDIRECT) {
            console.debug('safeRedirectToLogin: skip flag set, not redirecting');
            return;
        }

        // Only consider redirecting when on a protected route (area pages or root)
        const path = (window.location.pathname || '').toLowerCase();
        const protectedPatterns = ['/area', '/areaadm', '/', '/index.html', '/dashboard', '/area.html', '/areaadm.html'];
        const isProtected = protectedPatterns.some(p => path === p || path.endsWith(p) || path.includes(p));
        if (!isProtected) {
            console.debug('safeRedirectToLogin: not a protected path (', path, '), skipping redirect');
            return;
        }

        // If the app has the overlay/polling logic, allow it to finish first
        const start = Date.now();
        const maxWait = 3000; // ms
        const check = () => new Promise((resolve) => {
            const iv = setInterval(() => {
                try {
                    // If app explicitly signals ready, do not redirect
                    if (window.__APP_READY === true) { clearInterval(iv); return resolve(false); }

                    // if localStorage has a token and userData now, bail and don't redirect
                    const t = window.localStorage.getItem('authToken') || window.localStorage.getItem('token');
                    const u = window.localStorage.getItem('userData');
                    if (t && u) { clearInterval(iv); return resolve(false); }

                    // if timeout reached, allow redirect
                    if (Date.now() - start > maxWait) { clearInterval(iv); return resolve(true); }
                } catch (e) { clearInterval(iv); return resolve(true); }
            }, 200);
        });

        check().then((shouldRedirect) => {
            if (!shouldRedirect) return;
            try {
                // final check before redirecting
                const t = window.localStorage.getItem('authToken') || window.localStorage.getItem('token');
                const u = window.localStorage.getItem('userData');
                if (t && u) {
                    console.debug('safeRedirectToLogin: token/userData present at final check, not redirecting');
                    return;
                }
                // avoid redirect loop if already on login page
                if (window.location.pathname && window.location.pathname.toLowerCase().includes('login.html')) return;
                notifyRedirectAttempt('safeRedirectToLogin', 'final-check');
                
                // SSO: Preservar URL atual para retornar após login
                const returnTo = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
                window.location.href = `/login.html?returnTo=${returnTo}`;
            } catch (e) { try { notifyRedirectAttempt('safeRedirectToLogin', 'catch-fallback'); window.location.href = '/login.html'; } catch (_) {} }
        });
    } catch (e) { try { notifyRedirectAttempt('safeRedirectToLogin', 'outer-catch'); window.location.href = '/login.html'; } catch (_) {} }
}

// Consistent control disabling helper: accepts an Element or id and marks it disabled for anchors/buttons
function disableControl(elOrId, title) {
    try {
        const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
        if (!el) return;
        el.classList.add('disabled');
        el.setAttribute('aria-disabled', 'true');
        if (title) el.title = title;
        if (el.tagName && el.tagName.toLowerCase() === 'a') {
            // remove href to prevent navigation but keep visual semantics
            el.dataset.href = el.getAttribute('href') || '';
            el.removeAttribute('href');
        }
        if (typeof el.disabled !== 'undefined') el.disabled = true;
        // ensure not focusable
        el.setAttribute('tabindex', '-1');
    } catch (e) { /* ignore */ }
}

function enableControl(elOrId) {
    try {
        const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
        if (!el) return;
        el.classList.remove('disabled');
        el.removeAttribute('aria-disabled');
        if (el.dataset && el.dataset.href) { el.setAttribute('href', el.dataset.href); delete el.dataset.href; }
        if (typeof el.disabled !== 'undefined') el.disabled = false;
        el.removeAttribute('tabindex');
    } catch (e) { /* ignore */ }
}

// Reveal the UI after initialization completes. This removes any test overlay,
// clears the body visibility:hidden (used to prevent login-flash) and sets a
// global flag window.__APP_READY=true so headless tests can wait deterministically.
function revealUI() {
    try {
        // remove auth overlay if present
        const ov = document.getElementById('auth-overlay');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    } catch (e) { /* ignore */ }
    try {
    if (document.body.style && document.body.style.visibility) document.body.style.visibility = '';
    // Mark DOM as ready for automated tests
    try { if (document.body && document.body.dataset) document.body.dataset.appReady = '1'; } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
    try { window.__APP_READY = true; } catch (e) { /* ignore */ }
}

// Ensure employee widgets (holerite/ponto) are enabled if localStorage userData indicates files exist.
function ensureEmployeeWidgets() {
    try {
        const user = JSON.parse(localStorage.getItem('userData') || 'null') || {}
        const holLink = document.getElementById('widget-holerite-link') || document.getElementById('view-holerite')
        const pontoLink = document.getElementById('widget-ponto-link') || document.getElementById('view-ponto')
        if (user && Array.isArray(user.holerites) && user.holerites.length > 0) {
            if (holLink) enableControl(holLink)
        }
        if (user && (user.espelho_ponto || user.ponto)) {
            if (pontoLink) enableControl(pontoLink)
        }
    } catch (e) { /* ignore */ }
}

// ===================================================================================
// == FUNÇÁO AUXILIAR PARA FORMATAR DATAS
// ===================================================================================
function formatDateToBR(isoString) {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        const day = String(date.getUTCDate()).padStart(2, '0');
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const year = date.getUTCFullYear();
        return `${day}/${month}/${year}`;
    } catch (error) {
        console.error("Erro ao formatar data:", isoString, error);
        return '';
    }
}

// Formata data para exibir apenas dia e mês em português: "05 de agosto"
function formatDayMonth(isoString) {
    if (!isoString) return '';
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return '';
        // use toLocaleString to respect pt-BR month names
        return d.toLocaleString('pt-BR', { day: '2-digit', month: 'long' });
    } catch (e) { return ''; }
}

// Helper para mostrar estado de carregamento em botões (insere spinner e desabilita)
function setBtnLoading(btn, loading, text) {
    if (!btn) return;
    // Use a CSS spinner element (.btn-spinner) defined in area-admin.css
    if (loading) {
        try { btn.dataset.orig = btn.innerHTML; } catch (e) { btn.dataset.orig = btn.textContent; }
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        const spinnerHtml = `<span class="btn-spinner" aria-hidden="true"></span>`;
        if (text) btn.innerHTML = spinnerHtml + ' ' + text;
        else btn.innerHTML = spinnerHtml + ' ' + (btn.dataset && btn.dataset.origText ? btn.dataset.origText : 'Enviando...');
    } else {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        if (btn.dataset && btn.dataset.orig) {
            btn.innerHTML = btn.dataset.orig;
            try { delete btn.dataset.orig; } catch (e) { btn.removeAttribute('data-orig'); }
        }
        // ensure any leftover spinner elements removed
        const maybeSpinner = btn.querySelector && btn.querySelector('.btn-spinner');
        if (maybeSpinner && maybeSpinner.parentNode) maybeSpinner.parentNode.removeChild(maybeSpinner);
    }
}

// Toast helper (global) - small notification toasts bottom-right
function showToast(message, type = 'success', timeout = 4000) {
    // ensure a11y container exists
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        // accessibility: polite announcements
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'true');
        container.style.position = 'fixed';
        container.style.right = '12px';
        container.style.bottom = '12px';
        container.style.zIndex = '9999';
        document.body.appendChild(container);
    }
    const node = document.createElement('div');
    node.className = `toast ${type === 'error' ? 'error' : 'success'} toast-enter`;
    node.setAttribute('role', 'status');

    // inner message container for accessibility and layout
    const msgSpan = document.createElement('div');
    msgSpan.className = 'toast-message';
    msgSpan.textContent = message;
    node.appendChild(msgSpan);

    // close button for manual dismissal
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Fechar notificaçáo');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // animate out then remove
        node.classList.remove('toast-enter');
        node.classList.add('toast-exit');
        setTimeout(() => node.remove(), 320);
        if (timeoutHandle) clearTimeout(timeoutHandle);
    });
    node.appendChild(closeBtn);

    container.appendChild(node);
    // ensure screen readers see the update immediately
    container.scrollTop = container.scrollHeight;

    // auto-dismiss with pause on hover/focus
    let timeoutHandle = setTimeout(() => {
        node.classList.remove('toast-enter');
        node.classList.add('toast-exit');
        setTimeout(() => { try { node.remove(); } catch (e) {} }, 300);
    }, timeout);

    node.addEventListener('mouseenter', () => { if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; } });
    node.addEventListener('mouseleave', () => { if (!timeoutHandle) { timeoutHandle = setTimeout(() => { node.classList.remove('toast-enter'); node.classList.add('toast-exit'); setTimeout(() => node.remove(), 300); }, 2000); } });
    node.addEventListener('focusin', () => { if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; } });
    node.addEventListener('focusout', () => { if (!timeoutHandle) { timeoutHandle = setTimeout(() => { node.classList.remove('toast-enter'); node.classList.add('toast-exit'); setTimeout(() => node.remove(), 300); }, 2000); } });
}

// Accessible confirm modal helper that returns a Promise<boolean>
function showConfirm(message) {
    // Prevenir modais de confirmaçáo automáticos sem interaçáo do usuário
    if (!window._userInteracted) {
        console.warn('showConfirm: blocked auto-confirm, waiting for user interaction');
        return Promise.resolve(false); // Cancelar automaticamente
    }
    
    // Promise-based accessible confirm. If a static modal with id="modal-confirm" exists, use it.
    // Otherwise create a lightweight injected modal fallback to guarantee non-blocking UX.
    return new Promise((resolve) => {
        try {
            const staticModal = document.getElementById('modal-confirm');
            const staticMsg = document.getElementById('modal-confirm-message');
            const staticOk = document.getElementById('modal-confirm-ok');
            const staticCancel = document.getElementById('modal-confirm-cancel');
            if (staticModal && staticMsg && staticOk && staticCancel) {
                // use existing static modal
                if (!staticMsg.id) staticMsg.id = 'modal-confirm-message-' + Date.now();
                staticMsg.textContent = message;
                openModal(staticModal);
                staticModal.setAttribute('aria-hidden', 'false');

                const previouslyFocused = document.activeElement;
                let cleaned = false;
                const cleanup = (value) => {
                    if (cleaned) return; cleaned = true;
                    try { closeModal(staticModal); staticModal.setAttribute('aria-hidden', 'true'); } catch (e) {}
                    try { staticOk.removeEventListener('click', onOk); } catch (e) {}
                    try { staticCancel.removeEventListener('click', onCancel); } catch (e) {}
                    try { if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus(); } catch (e) {}
                    resolve(!!value);
                };
                const onOk = () => cleanup(true);
                const onCancel = () => cleanup(false);
                staticOk.addEventListener('click', onOk);
                staticCancel.addEventListener('click', onCancel);
                try { staticOk.setAttribute('aria-describedby', staticMsg.id); staticCancel.setAttribute('aria-describedby', staticMsg.id); } catch (e) {}
                try { staticOk.focus(); } catch (e) { try { staticCancel.focus(); } catch (e) {} }
                try { activateModalFocus(staticModal); } catch (e) {}
                return;
            }

            // Fallback: inject a small accessible modal into the DOM
            const id = 'modal-confirm-fallback-' + Date.now();
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = id;
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-hidden', 'false');
            modal.innerHTML = `
                <div class="modal-dialog" role="document">
                    <div class="modal-header"><div class="modal-title">Confirmaçáo</div><button class="close-button" aria-label="Fechar">&times;</button></div>
                    <div class="modal-content"><p id="${id}-msg" class="modal-confirm-text">${String(message)}</p></div>
                    <div class="modal-footer"><button class="btn" id="${id}-ok">OK</button><button class="btn btn-secondary" id="${id}-cancel">Cancelar</button></div>
                </div>`;
            document.body.appendChild(modal);
            const msgEl = document.getElementById(`${id}-msg`);
            const okBtn = document.getElementById(`${id}-ok`);
            const cancelBtn = document.getElementById(`${id}-cancel`);
            const closeBtn = modal.querySelector('.close-button');

            const previouslyFocused = document.activeElement;
            let cleaned = false;
            let cleanup = (value) => {
                if (cleaned) return; cleaned = true;
                try { closeModal(modal); } catch (e) {}
                try { modal.remove(); } catch (e) {}
                try { if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus(); } catch (e) {}
                resolve(!!value);
            };

            const onOk = () => cleanup(true);
            const onCancel = () => cleanup(false);

            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            closeBtn.addEventListener('click', onCancel);

            // open and trap focus
            openModal(modal);
            try { msgEl.id = msgEl.id || (id + '-msg'); okBtn.setAttribute('aria-describedby', msgEl.id); cancelBtn.setAttribute('aria-describedby', msgEl.id); } catch (e) {}
            try { okBtn.focus(); } catch (e) {}
            try { activateModalFocus(modal); } catch (e) {}

            // Safety: if nothing happens for 2 minutes, auto-cancel
            const safety = setTimeout(() => cleanup(false), 120000);
            // ensure cleanup clears safety
            const origCleanup = cleanup;
            cleanup = (value) => { clearTimeout(safety); origCleanup(value); };

        } catch (e) {
            console.warn('showConfirm failed:', e);
            resolve(false);
        }
    });
}

// Modal helpers: open/close modals while preventing body scroll
function openModal(modal) {
    if (!modal) return;
    // Prevent programmatic auto-opening of modals before the user interacted with the page.
    // This avoids unexpected popups on load (e.g., injected markup or race conditions).
    if ((!window._userInteracted || !window._modalAllowed) && !modal.dataset.forceOpen) {
        console.warn('openModal: prevented auto-open until user interaction and modal permission');
        return;
    }
    // If this modal is already open, keep it (idempotent)
    if (modal.classList.contains('open')) return;
    // Close any other open modals first to avoid stacking
    const others = Array.from(document.querySelectorAll('.modal.open')).filter(m => m !== modal);
    others.forEach(m => {
        try { closeModal(m); } catch (e) { /* ignore */ }
    });

    modal.classList.add('open');
    try { modal.style.display = 'flex'; } catch (e) { /* ignore */ }
    // lock body scroll with compensation for scrollbar width to avoid layout shift
    try { lockBodyScroll(); document.body.classList.add('modal-open'); } catch (e) { document.body.classList.add('modal-open'); }
    try { activateModalFocus(modal); } catch (e) { /* ignore */ }
}
function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    try { modal.style.display = 'none'; modal.removeAttribute('style'); } catch (e) { /* ignore */ }
    // if there are no other open modals, unlock body scroll and remove body class
    const anyOpen = document.querySelectorAll('.modal.open').length > 0;
    if (!anyOpen) {
        try { unlockBodyScroll(); } catch (e) { /* ignore */ }
        document.body.classList.remove('modal-open');
        // Resetar todas as permissões de modal quando náo há mais modais abertos
        window._modalExplicitlyRequested = false;
    }
    try { deactivateModalFocus(modal); } catch (e) { /* ignore */ }
}

// Body scroll lock helpers with reference counting and scrollbar compensation
let _modalOpenCount = 0;
function lockBodyScroll() {
    try {
        if (_modalOpenCount === 0) {
            const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
            if (scrollBarWidth > 0) document.body.style.paddingRight = scrollBarWidth + 'px';
            document.body.style.overflow = 'hidden';
        }
        _modalOpenCount++;
    } catch (e) { /* ignore */ }
}
function unlockBodyScroll() {
    try {
        _modalOpenCount = Math.max(0, _modalOpenCount - 1);
        if (_modalOpenCount === 0) {
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }
    } catch (e) { /* ignore */ }
}

// Defensive cleanup on script load: ensure no modal is left open (e.g., from inline markup)
(function cleanupStaleModals() {
    try {
        const stale = document.querySelectorAll('.modal.open, .modal[style*="display: flex"], .modal[style*="display:flex"], .modal[style*="display: block"], .modal[style*="display:block"]');
        stale.forEach(m => {
            try { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); if (m.style) { m.style.display = 'none'; m.removeAttribute('style'); } } catch (e) { /* ignore */ }
        });
        document.body.classList.remove('modal-open');
    } catch (e) { /* ignore */ }
})();

// Dev helper: inject admin token / simulate admin for local testing only
// ...existing code...

// ===================================================================================
// == ÁREA DO ADMINISTRADOR
// ===================================================================================
function initAdminPage() {
    // --- Validaçáo de Acesso ---
    const localUserData = JSON.parse(localStorage.getItem('userData'));
    
    // Debug: mostrar informações detalhadas do usuário
    console.log('🔍 DEBUG initAdminPage - Dados do usuário:', {
        userData: localUserData,
        role: localUserData?.role,
        hasUserData: !!localUserData,
        debugInfo: localStorage.getItem('debugInfo')
    });
    
    if (!localUserData || localUserData.role !== 'admin') {
        console.log('❌ DEBUG initAdminPage - Acesso negado. Redirecionando para login.');
        console.log('❌ Motivo:', !localUserData ? 'Sem userData' : `Role inválido: ${localUserData.role}`);
        
        // Se o usuário tem role de funcionário, redirecionar para area.html ao invés de login
        if (localUserData && localUserData.role === 'funcionario') {
            console.log('🔄 DEBUG initAdminPage - Redirecionando funcionário para área correta');
            window.location.href = '/area.html';
            return;
        }
        
        showToast("Acesso negado. Apenas administradores podem aceder a está página.", 'error');
        window.location.href = '/login.html';
        return;
    }
    
    console.log('✅ DEBUG initAdminPage - Acesso autorizado para admin');

    // --- Seletores de Elementos ---
    // use relative URL so the frontend works regardless of host/port
    const API_URL = '/api/funcionarios';
    const tabelaCorpo = document.querySelector('#tabela-funcionarios tbody');
    const modal = document.getElementById('modal-detalhes');
    const closeModalButton = document.querySelector('.close-button');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const formNovoFuncionario = document.getElementById('form-novo-funcionario');
    const formUploadFoto = document.getElementById('form-upload-foto');
    const formUploadHolerite = document.getElementById('form-upload-holerite');
    const formUploadAtestado = document.getElementById('form-upload-atéstado');
    let currentFuncionarioId = null;

    // --- Funções ---
    // Preenche cabeçalho com info do usuário autenticado
    async function preencherHeaderUsuario() {
        try {
            const resp = await fetch('/api/me', { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
            if (!resp.ok) return; // náo bloqueante
            const me = await resp.json();
            const avatar = document.getElementById('header-avatar-img');
            const greeting = document.getElementById('header-greeting');
            if (avatar) avatar.src = me.foto_perfil_url || me.foto_url || 'Interativo-Aluforce.jpg';
            if (greeting) {
                // Use first and last name only
                const parts = (me.nome_completo || '').trim().split(/\s+/);
                const first = parts[0] || '';
                const last = parts.length > 1 ? parts[parts.length-1] : '';
                const display = `${first}${last ? ' ' + last : ''}`.trim();
                greeting.textContent = display ? `Olá, ${display}` : 'Olá, Usuário';
            }
        } catch (err) {
            console.warn('Náo foi possível preencher header com /api/me', err);
        }
    }

    
    async function carregarFuncionarios() {
        try {
            const q = document.getElementById('search-input') ? document.getElementById('search-input').value.trim() : '';
            const url = q ? `${API_URL}?q=${encodeURIComponent(q)}` : API_URL;
            const response = await fetch(url, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
            if (response.status === 401) {
                // token expirado ou inválido
                showToast('Sessáo expirada. Faça login novamente.', 'error');
                localStorage.clear();
                safeRedirectToLogin();
                return;
            }
            if (!response.ok) throw new Error('Erro ao buscar dados da API.');
            const funcionarios = await response.json();

            tabelaCorpo.innerHTML = '';
            if (!Array.isArray(funcionarios) || funcionarios.length === 0) {
                tabelaCorpo.innerHTML = `<tr><td colspan="6">Nenhum funcionário encontrado.</td></tr>`;
                return;
            }

            // reset selection index when reloading
            selectedRowIndex = -1;
            funcionarios.forEach((func, idx) => {
                const tr = document.createElement('tr');
                // prefer thumbnail if available for list performance
                const fotoUrl = func.foto_thumb_url || func.foto_url || func.foto || 'Interativo-Aluforce.jpg';
                const nome = func.nome_completo || func.nome || func.name || '';
                const cargo = func.cargo || func.role || func.position || '';
                const email = func.email || func.email_perfil || '';
                tr.setAttribute('data-nome', (nome || '').toLowerCase());
                tr.setAttribute('data-email', (email || '').toLowerCase());
                tr.setAttribute('data-index', String(idx));
                tr.tabIndex = 0; // make focusable for keyboard navigation
                tr.innerHTML = `
                    <td>${func.id}</td>
                    <td><img src="${fotoUrl}" alt="Foto de ${nome}" class="foto-funcionario"></td>
                    <td>${nome}</td>
                    <td>${cargo}</td>
                    <td>${email}</td>
                    <td><button class="btn btn-detalhes" data-id="${func.id}">Detalhes</button></td>
                `;
                // Remover clique automático na linha para evitar abertura indesejada do modal
                // tr.style.cursor = 'pointer';
                // tr.addEventListener('click', (e) => {
                //     // avoid double-opening when clicking the Detalhes button
                //     if (e.target && e.target.classList && e.target.classList.contains('btn-detalhes')) return;
                //     abrirModalDetalhes(func.id);
                // });
                tabelaCorpo.appendChild(tr);
            });
        } catch (error) {
            tabelaCorpo.innerHTML = `<tr><td colspan="6" style="color: red;">${error.message}</td></tr>`;
        }
    }

    // Focus trap helpers for modals: keep keyboard focus inside the open modal and restore on close
    let _activeModal = null;
    let _previouslyFocused = null;
    function _getFocusable(el) {
        if (!el) return [];
        return Array.from(el.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'))
            .filter(n => n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement);
    }
    function activateModalFocus(modalEl) {
        if (!modalEl) return;
        _activeModal = modalEl;
        _previouslyFocused = document.activeElement;
        const focusables = _getFocusable(modalEl);
        if (focusables.length) focusables[0].focus();
        // add keydown handler to trap Tab and close on Escape
        modalEl._handleKeydown = function(e) {
            if (e.key === 'Escape') {
                // close this modal
                try { closeModal(modalEl); } catch (err) { /* ignore */ }
                return;
            }
            if (e.key !== 'Tab') return;
            const nodes = _getFocusable(modalEl);
            if (nodes.length === 0) { e.preventDefault(); return; }
            const first = nodes[0]; const last = nodes[nodes.length-1];
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        };
        document.addEventListener('keydown', modalEl._handleKeydown);
    }
    function deactivateModalFocus(modalEl) {
        if (!modalEl) return;
        if (modalEl._handleKeydown) document.removeEventListener('keydown', modalEl._handleKeydown);
        if (_previouslyFocused && typeof _previouslyFocused.focus === 'function') _previouslyFocused.focus();
        _activeModal = null; _previouslyFocused = null;
    }

    // Selection state for keyboard navigation
    let selectedRowIndex = -1;

    function clearSelectedRow() {
        const prev = tabelaCorpo.querySelector('tr.selected');
        if (prev) prev.classList.remove('selected');
    }

    function setSelectedRow(index) {
        clearSelectedRow();
        const row = tabelaCorpo.querySelector(`tr[data-index="${index}"]`);
        if (!row) return;
        row.classList.add('selected');
        selectedRowIndex = index;
        // ensure visible
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // Move selection up/down and optionally open
    function moveSelection(delta) {
        const rows = tabelaCorpo.querySelectorAll('tr');
        if (!rows || rows.length === 0) return;
        let next = selectedRowIndex + delta;
        if (next < 0) next = 0;
        if (next > rows.length - 1) next = rows.length - 1;
        setSelectedRow(next);
    }

    // Open currently selected row
    function openSelectedRow() {
        const row = tabelaCorpo.querySelector(`tr[data-index="${selectedRowIndex}"]`);
        if (!row) return;
        const btn = row.querySelector('.btn-detalhes');
        if (btn) btn.click();
    }

    // Global key handler for arrow navigation and Enter
    document.addEventListener('keydown', (e) => {
        // don't interfere when focus is in input fields other than search
        const active = document.activeElement;
        const isTypingField = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.id !== 'search-input';
        if (isTypingField) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            moveSelection(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveSelection(-1);
        } else if (e.key === 'Enter') {
            // If focus is on search input, pressing Enter handled earlier to open first result
            if (document.activeElement && document.activeElement.id === 'search-input') return;
            openSelectedRow();
        }
    });

    // --- Pesquisa com debounce ---
    let searchTimer = null;
    const searchInput = document.getElementById('search-input');
    const headerSearchInput = document.getElementById('search-input-top');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                carregarFuncionarios();
            }, 300);
        });
        // Allow Enter to open first result
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                // fetch current list and open first row if exists
                setTimeout(async () => {
                    await carregarFuncionarios();
                    const firstRow = tabelaCorpo.querySelector('tr');
                    if (firstRow) {
                        const btn = firstRow.querySelector('.btn-detalhes');
                        if (btn) btn.click();
                    }
                }, 0);
            }
        });
    }

        // Header search (top) mirrors into main search and triggers same behavior
        if (headerSearchInput) {
            headerSearchInput.addEventListener('input', () => {
                const main = document.getElementById('search-input');
                if (main) main.value = headerSearchInput.value;
                if (searchTimer) clearTimeout(searchTimer);
                searchTimer = setTimeout(() => carregarFuncionarios(), 300);
            });
            headerSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const main = document.getElementById('search-input');
                    if (main) main.value = headerSearchInput.value;
                    // open first result after loading
                    setTimeout(async () => {
                        await carregarFuncionarios();
                        const firstRow = tabelaCorpo.querySelector('tr');
                        if (firstRow) {
                            const btn = firstRow.querySelector('.btn-detalhes');
                            if (btn) btn.click();
                        }
                    }, 0);
                }
            });
        }

    // --- Carregar aniversariantes do mês ---
    async function carregarAniversariantes() {
        try {
            // Verificar se estamos no dashboard antes de carregar
            const dashboardSection = document.getElementById('dashboard-home');
            if (!dashboardSection || !dashboardSection.classList.contains('active')) {
                return; // Náo carregar se náo estivermos no dashboard
            }
            
            // Use dedicated endpoint for aniversariantes (server provides /api/aniversariantes)
            const response = await fetch('/api/aniversariantes', { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
            if (!response.ok) throw new Error('Erro ao buscar aniversariantes.');
            const list = await response.json();
            // support both possible container ids used in templates
            const ulPrimary = dashboardSection.querySelector('#dashboard-aniversariantes-list');
            const ulFallback = dashboardSection.querySelector('#birthdays-list');
            const targets = [];
            if (ulPrimary) targets.push(ulPrimary);
            if (ulFallback) targets.push(ulFallback);
            // if no target in DOM, nothing to do
            if (!targets.length) return;
            // render list into all present targets
            targets.forEach(ul => { ul.innerHTML = ''; });
            if (!list || list.length === 0) {
                targets.forEach(ul => { ul.innerHTML = '<li>Nenhum aniversariante encontrado.</li>'; });
                return;
            }
            list.forEach(f => {
                const liHtml = (f) => {
                    const photo = f.foto_thumb_url || f.foto_perfil_url || f.foto_url || 'Interativo-Aluforce.jpg';
                    // tolerate several possible date field names returned by the API
                    const dateField = f.data_nascimento || f.nascimento || f.nascimento_data || f.data || null;
                    const diaMes = dateField ? formatDayMonth(dateField) : '-';
                    const nome = f.nome || f.nome_completo || f.name || 'Usuário';
                    return `
                        <li class="aniver-item">
                            <div class="aniver-avatar"><img src="${photo}" alt="Avatar de ${nome}" class="aniver-avatar-img" onerror="this.onerror=null;this.src='Interativo-Aluforce.jpg'"></div>
                            <div class="aniver-info"><strong>${nome}</strong><span>${diaMes}</span></div>
                        </li>`;
                };
                targets.forEach(ul => { ul.insertAdjacentHTML('beforeend', liHtml(f)); });
            });
        } catch (err) {
            const ulPrimary = document.getElementById('dashboard-aniversariantes-list');
            const ulFallback = document.getElementById('birthdays-list');
            if (ulPrimary) ulPrimary.innerHTML = `<li style="color:red;">${err.message}</li>`;
            if (ulFallback) ulFallback.innerHTML = `<li style="color:red;">${err.message}</li>`;
        }
    }

    // --- Novo: Carregar dados para a nova aba Dashboard (náo altera a aba Funcionários) ---
    async function carregarDashboard() {
        try {
            // Verificar se estamos no dashboard antes de carregar
            const dashboardSection = document.getElementById('dashboard-home');
            if (!dashboardSection || !dashboardSection.classList.contains('active')) {
                return; // Náo carregar se náo estivermos no dashboard
            }
            
            // usa endpoint agregado para dashboard
            const resp = await fetch('/api/dashboard/summary', { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
            if (!resp.ok) throw new Error('Erro ao carregar resumo do dashboard');
            const summary = await resp.json();

            // aniversariantes - apenas no dashboard
            const ul = dashboardSection.querySelector('#dashboard-aniversariantes-list');
            if (ul) {
                ul.innerHTML = '';
                const list = summary.aniversariantes || [];
                if (!list || list.length === 0) ul.innerHTML = '<li>Nenhum aniversariante encontrado.</li>';
                else list.forEach(f => {
                    const li = document.createElement('li');
                    li.className = 'aniver-item';
                    const photo = f.foto_thumb_url || f.foto_perfil_url || f.foto_url || 'Interativo-Aluforce.jpg';
                    const diaMes = f.data_nascimento ? formatDayMonth(f.data_nascimento) : '-';
                    li.innerHTML = `
                        <div class="aniver-avatar"><img src="${photo}" alt="Avatar de ${f.nome}" class="aniver-avatar-img" onerror="this.onerror=null;this.src='Interativo-Aluforce.jpg';"></div>
                        <div class="aniver-info"><strong>${f.nome}</strong>
                        <span>${diaMes}</span></div>`;
                    ul.appendChild(li);
                });
            }

            // avisos - apenas no dashboard
            const divAvisos = dashboardSection.querySelector('#dashboard-avisos-list');
            if (divAvisos) {
                const avisos = summary.avisos || [];
                if (!avisos || avisos.length === 0) divAvisos.innerHTML = '<p>Nenhum aviso.</p>';
                else {
                    divAvisos.innerHTML = '';
                    // detect if current user is admin to show edit/delete controls
                    let isAdminLocal = false;
                    try { const u = JSON.parse(localStorage.getItem('userData') || 'null'); if (u && u.role === 'admin') isAdminLocal = true; } catch (e) { /* ignore */ }
                    avisos.forEach(a => {
                        const node = document.createElement('div');
                        node.className = 'aviso-card';
                        node.setAttribute('data-aviso-id', String(a.id));
                        node.innerHTML = `
                            <div class="aviso-media">
                                <div class="aviso-avatar"><img src="${escapeHtml(a.foto_thumb_url || a.foto_perfil_url || a.created_by_photo || 'Interativo-Aluforce.jpg')}" alt="Aviso" onerror="this.onerror=null;this.src='Interativo-Aluforce.jpg'"/></div>
                                <div class="aviso-body">
                                    <div class="aviso-title">${escapeHtml(a.titulo || '')}</div>
                                    <div class="aviso-desc">${escapeHtml(a.mensagem || '')}</div>
                                    <div class="aviso-meta small">${a.created_by ? 'Criado por: ' + escapeHtml(a.created_by) : ''} ${a.created_at ? new Date(a.created_at).toLocaleString() : ''}</div>
                                </div>
                            </div>
                        `;
                        const actions = document.createElement('div'); actions.className = 'aviso-actions';
                        const btnMark = document.createElement('button'); btnMark.className='btn btn-secondary marcar-lido action-mark'; btnMark.setAttribute('aria-label', a.lido ? 'Lido' : 'Marcar como lido'); btnMark.innerHTML = `<i class="fas fa-check"></i> <span class="action-text">${a.lido ? 'Lido' : 'Marcar como lido'}</span>`;
                        if (a.lido) { btnMark.disabled = true; node.classList.add('lido'); }
                        btnMark.addEventListener('click', async (e) => { e.stopPropagation(); await markAvisoRead(a.id); btnMark.innerHTML = `<i class="fas fa-check"></i> <span class="action-text">Lido</span>`; btnMark.disabled = true; node.classList.add('lido'); });
                        actions.appendChild(btnMark);

                        if (isAdminLocal) {
                            const edit = document.createElement('button'); edit.className = 'btn action-edit'; edit.setAttribute('aria-label','Editar aviso'); edit.innerHTML = '<i class="fas fa-edit"></i> <span class="action-text">Editar</span>';
                            edit.addEventListener('click', (e) => { e.stopPropagation(); openAvisosModal(); openEditAviso(a); });
                            const del = document.createElement('button'); del.className = 'btn btn-secondary action-delete'; del.setAttribute('aria-label','Apagar aviso'); del.innerHTML = '<i class="fas fa-trash"></i> <span class="action-text">Apagar</span>';
                            del.addEventListener('click', async (e) => {
                                const ok = await showConfirm('Apagar este aviso?');
                                if (!ok) return;
                                try {
                                    const dres = await fetch(`/api/avisos/${a.id}`, { method: 'DELETE', headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
                                    const dj = await dres.json(); if (!dres.ok) throw new Error(dj.message || 'Erro');
                                    showToast('Aviso apagado.', 'success');
                                    carregarDashboard();
                                    carregarFuncionarios();
                                } catch (err) { showToast('Falha ao apagar: ' + err.message, 'error'); }
                            });
                            actions.appendChild(edit);
                            actions.appendChild(del);
                        }

                        node.appendChild(actions);
                        divAvisos.appendChild(node);
                    });
                }
            }

            // preencher banner de fotos ausentes - apenas no dashboard
            const missingBanner = dashboardSection.querySelector('#missing-photos-banner');
            if (missingBanner) {
                const missing = summary.semFoto || [];
                if (missing && missing.length > 0) {
                    missingBanner.textContent = missing.map(m => m.nome || m).join(', ');
                } else {
                    // fallback: query API for funcionarios without foto (limit 10)
                    try {
                        const resp = await fetch(`${API_URL}?no_foto=1&limit=10`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
                        if (resp.ok) {
                            const list = await resp.json();
                            if (Array.isArray(list) && list.length > 0) missingBanner.textContent = list.map(f => f.nome_completo || f.nome).join(', ');
                            else missingBanner.textContent = 'Sergio, Lucas, Ramon, Renata';
                        } else {
                            missingBanner.textContent = 'Sergio, Lucas, Ramon, Renata';
                        }
                    } catch (e) {
                        missingBanner.textContent = 'Nenhum usuário sem foto.';
                    }
                }
            }

            // tempo de casa - apenas no dashboard
            const tempoDiv = dashboardSection.querySelector('#tempo-casa-list');
            if (tempoDiv) {
                tempoDiv.innerHTML = '';
                const tc = summary.tempoCasa || [];
                if (!tc || tc.length === 0) {
                    tempoDiv.innerHTML = '<p>—</p>';
                } else {
                    // Ordena por dias (maior para menor), pega só os 3 primeiros
                    const medalhas = ['<i class="fas fa-crown" style="color: #ffd700"></i>', '<i class="fas fa-award" style="color: #c0c0c0"></i>', '<i class="fas fa-star" style="color: #cd7f32"></i>'];
                    tc.sort((a, b) => (b.dias || 0) - (a.dias || 0));
                    tc.slice(0, 3).forEach((t, idx) => {
                        const item = document.createElement('div');
                        item.className = 'tempo-item';
                        // Calcula anos, meses, dias
                        let anos = 0, meses = 0, dias = 0;
                        if (t.dias !== null && t.dias !== undefined) {
                            let total = t.dias;
                            anos = Math.floor(total / 365);
                            total = total % 365;
                            meses = Math.floor(total / 30);
                            dias = total % 30;
                        }
                        let tempoStr = t.dias !== null && t.dias !== undefined
                            ? `${anos > 0 ? anos + 'a ' : ''}${meses > 0 ? meses + 'm ' : ''}${dias > 0 ? dias + 'd' : ''}`.trim() || '0d'
                            : 'Data adm. náo informada';
                        item.innerHTML = `<span class="medalha">${medalhas[idx] || ''}</span> <strong>${t.nome}</strong><div>${tempoStr}</div>`;
                        tempoDiv.appendChild(item);
                    });
                }
            }

            // relatório medico (atéstados) - apenas no dashboard
            const relMedDiv = dashboardSection.querySelector('#dashboard-relatório-medico');
            if (relMedDiv) {
                const at = summary.atéstados || [];
                if (!at || at.length === 0) relMedDiv.innerHTML = '<p>Sem atéstados recentes.</p>';
                else { relMedDiv.innerHTML = ''; at.forEach(a => { const node = document.createElement('div'); node.className='atéstado-item'; node.innerHTML = `<strong>${a.nome}</strong><div><a href="${a.url_arquivo}" target="_blank">${a.nome_arquivo}</a> <small>${a.data_envio ? new Date(a.data_envio).toLocaleString() : ''}</small></div>`; relMedDiv.appendChild(node); }); }
            }

        } catch (error) {
            console.error('Erro ao carregar dashboard:', error);
        }
    }

    // Hook para o novo nav dashboard
    const navDashboard = document.getElementById('nav-dashboard');
    if (navDashboard) {
        navDashboard.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            document.getElementById('dashboard-home').classList.add('active');
            navDashboard.classList.add('active');
            carregarDashboard();
        });
    }

    async function abrirModalDetalhes(id, forceOpen = false) {
        console.log(`🔍 abrirModalDetalhes chamado: id=${id}, forceOpen=${forceOpen}, _userInteracted=${window._userInteracted}, _modalExplicitlyRequested=${window._modalExplicitlyRequested}`);
        
        // PROTEÇÁO ABSOLUTA: Modal só deve abrir com interaçáo EXPLÍCITA do usuário
        if (!forceOpen && (!window._userInteracted || !window._modalExplicitlyRequested)) {
            console.warn('🚫 abrirModalDetalhes: BLOCKED - modal requires explicit user request');
            return;
        }
        
        console.log('✅ abrirModalDetalhes: PERMITIDO - abrindo modal');
        
        currentFuncionarioId = id;
        const detalhesContent = document.getElementById('detalhes-funcionario-content');
        const fotoPreview = document.getElementById('modal-foto-preview');
        const listaAtestados = document.getElementById('lista-atéstados');
        const listaHolerites = document.getElementById('lista-holerites');

        detalhesContent.innerHTML = '<p>Carregando...</p>';
        listaAtestados.innerHTML = '';
        listaHolerites.innerHTML = '';
    openModal(modal);
        
        try {
            const response = await fetch(`${API_URL}/${id}`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
            if (!response.ok) throw new Error('Náo foi possível buscar os detalhes.');
            const func = await response.json();
            
            fotoPreview.src = func.foto_url || func.foto_perfil_url || 'Interativo-Aluforce.jpg';
            
            // Preencher todos os campos editáveis do modal
            const modalNome = document.getElementById('modal-nome');
            const modalCargo = document.getElementById('modal-cargo');
            const modalEmail = document.getElementById('modal-email');
            const modalDataNasc = document.getElementById('modal-data_nascimento');
            const modalCpf = document.getElementById('modal-cpf');
            const modalRg = document.getElementById('modal-rg');
            const modalTelefone = document.getElementById('modal-telefone');
            const modalSalario = document.getElementById('modal-salario');
            const modalEndereco = document.getElementById('modal-endereco');
            const modalNacionalidade = document.getElementById('modal-nacionalidade');
            const modalMae = document.getElementById('modal-mae');
            const modalPai = document.getElementById('modal-pai');
            const modalEstadoCivil = document.getElementById('modal-estado-civil');
            const modalBanco = document.getElementById('modal-banco');
            const modalAgencia = document.getElementById('modal-agencia');
            const modalConta = document.getElementById('modal-conta');
            // Preencher os campos básicos
            if (modalNome) modalNome.value = func.nome_completo || '';
            if (modalCargo) modalCargo.value = func.cargo || func.role || '';
            if (modalEmail) modalEmail.value = func.email || '';
            if (modalDataNasc) modalDataNasc.value = func.data_nascimento ? func.data_nascimento.substring(0,10) : '';
            if (modalCpf) modalCpf.value = func.cpf || '';
            if (modalRg) modalRg.value = func.rg || '';
            if (modalTelefone) modalTelefone.value = func.telefone || '';
            if (modalSalario) modalSalario.value = func.salario || '';
            if (modalEndereco) modalEndereco.value = func.endereco || '';
            if (modalNacionalidade) modalNacionalidade.value = func.nacionalidade || '';
            if (modalMae) modalMae.value = func.filiacao_mae || '';
            if (modalPai) modalPai.value = func.filiacao_pai || '';
            if (modalEstadoCivil) modalEstadoCivil.value = func.estado_civil || '';
            if (modalTelefone) modalTelefone.value = func.telefone || '';
            if (modalBanco) modalBanco.value = func.banco || '';
            if (modalAgencia) modalAgencia.value = func.agencia || '';
            if (modalConta) modalConta.value = func.conta_corrente || '';
            // Campos extras (se existirem no HTML)
            const modalSobrenome = document.getElementById('modal-sobrenome');
            const modalDependentes = document.getElementById('modal-dependentes');
            if (modalSobrenome) modalSobrenome.value = func.sobrenome || '';
            if (modalEndereco) modalEndereco.value = func.endereco || '';
            if (modalDependentes) modalDependentes.value = (func.dependentes !== undefined && func.dependentes !== null) ? String(func.dependentes) : '';
            detalhesContent.innerHTML = `
                <p><strong>ID:</strong> ${func.id}</p>
                <p><strong>Nome:</strong> ${func.nome_completo}</p>
                <p><strong>Email:</strong> ${func.email}</p>
                <p><strong>Cargo (Role):</strong> ${func.role}</p>
                <p><strong>Admissáo:</strong> ${formatDateToBR(func.data_admissao)}</p>
            `;

            // Preenche a lista de atéstados
            if (func.atéstados && func.atéstados.length > 0) {
                func.atéstados.forEach(atéstado => {
                    const li = document.createElement('li');
                    li.innerHTML = `<a href="${atéstado.url_arquivo}" target="_blank">${atéstado.nome_arquivo}</a> <span>(Enviado em: ${formatDateToBR(atéstado.data_envio)})</span>`;
                    listaAtestados.appendChild(li);
                });
            } else {
                listaAtestados.innerHTML = '<li>Nenhum atéstado anexado.</li>';
            }

            // Preenche a lista de holerites
            if (func.holerites && func.holerites.length > 0) {
                 func.holerites.forEach(holerite => {
                    const li = document.createElement('li');
                    li.innerHTML = `<a href="${holerite.url_pdf}" target="_blank">Competência ${holerite.competencia.substring(5, 7)}/${holerite.competencia.substring(0, 4)}</a>`;
                    listaHolerites.appendChild(li);
                });
            } else {
                listaHolerites.innerHTML = '<li>Nenhum holerite anexado.</li>';
            }

            // Preenche data de nascimento (ediçáo rápida pelo admin)
            const modalNascimento = document.getElementById('modal-data-nascimento');
            if (modalNascimento) modalNascimento.value = func.data_nascimento ? func.data_nascimento.substring(0,10) : '';

            // preencher exibiçáo legível de data de nascimento (ex: "05 de agosto")
            const dobDisplay = document.getElementById('modal-dob-display');
            if (dobDisplay) dobDisplay.textContent = func.data_nascimento ? formatDayMonth(func.data_nascimento) : '—';

            // foco no primeiro campo do formulário para ediçáo rápida
            setTimeout(() => {
                const first = document.getElementById('modal-nome'); if (first) first.focus();
            }, 40);

            // Reset status/messages nos formulários do modal
            const uploadHoleriteStatus = document.getElementById('upload-holerite-status');
            if (uploadHoleriteStatus) uploadHoleriteStatus.textContent = '';
            const uploadAtestadoStatus = document.getElementById('upload-atéstado-status');
            if (uploadAtestadoStatus) uploadAtestadoStatus.textContent = '';

            } catch (error) {
            console.error('Erro ao carregar funcionários:', error);
            tabelaCorpo.innerHTML = `<tr><td colspan="5" style="color: red;">Náo foi possível carregar os dados. Verifique se a API está online.</td></tr>`;
        }
    }

    function fecharModal() { 
        // Resetar permissáo ao fechar o modal
        window._modalExplicitlyRequested = false;
        console.log('🔒 Permissáo de modal resetada ao fechar');
        closeModal(modal); 
    }

    // fechar modal com Escape para acessibilidade
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const anyOpen = document.querySelector('.modal.open') || document.querySelector('.modal[style*="display: block"]');
            if (anyOpen) closeModal(anyOpen);
        }
    });

    // --- Event Listeners ---
    // Sidebar toggle with persistence
    // NOTE: avatar click logout handled globally by setupAvatarMenu(); avoid duplicate handlers here

    document.querySelectorAll('.nav-link').forEach(link => {
        if (!link || link.classList.contains('logout')) return;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            const href = link.getAttribute && link.getAttribute('href') ? link.getAttribute('href') : '';
            const id = href && href.startsWith('#') ? href.substring(1) : href;
            const targetSection = id ? document.getElementById(id) : null;
            if (targetSection) targetSection.classList.add('active');
            link.classList.add('active');
            // close sidebar when navigating (for better UX on desktop/mobile)
            if (typeof sidebar !== 'undefined' && sidebar && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                localStorage.setItem('sidebarOpen', 'false');
                if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
            }
        });
    });

    // Novo colaborador via botáo do header
    const btnNewCol = document.getElementById('btn-new-collaborator');
    if (btnNewCol) {
        btnNewCol.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
            const cadastro = document.getElementById('cadastro-section');
            if (cadastro) cadastro.classList.add('active');
            // mark nav link active
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            const link = document.querySelector('.nav-link[href="#cadastro-section"]');
            if (link) link.classList.add('active');
            // focus first input
            setTimeout(() => { const email = document.getElementById('email'); if (email) email.focus(); }, 50);
        });
    }

    if (tabelaCorpo) {
        tabelaCorpo.addEventListener('click', e => {
            if (e.target && e.target.classList && e.target.classList.contains('btn-detalhes')) {
                // Marcar que o modal foi EXPLICITAMENTE solicitado pelo usuário
                window._modalExplicitlyRequested = true;
                console.log('✅ Modal explicitamente solicitado pelo usuário via botáo Detalhes');
                abrirModalDetalhes(e.target.dataset.id, true); // forceOpen = true
            }
        });
    }
    if (closeModalButton) closeModalButton.addEventListener('click', fecharModal);
    if (typeof window !== 'undefined') window.addEventListener('click', e => { if (e.target === modal) fecharModal(); });

    if (formNovoFuncionario) formNovoFuncionario.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(formNovoFuncionario);
        const dadosFuncionario = Object.fromEntries(formData.entries());
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(dadosFuncionario)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message);
            showToast('Funcionário cadastrado com sucesso!', 'success');
            formNovoFuncionario.reset();
            carregarFuncionarios();
            document.querySelector('.nav-link[href="#dashboard-section"]').click();
        } catch (error) {
            showToast(`Erro ao cadastrar: ${error.message}`, 'error');
        }
    });

    if (formUploadFoto) formUploadFoto.addEventListener('submit', async (e) => {
        e.preventDefault();
        const statusDiv = document.getElementById('upload-foto-status');
        const fotoInput = document.getElementById('arquivo-foto');
        const submitBtn = formUploadFoto.querySelector('button[type="submit"]');
        if (!currentFuncionarioId || !fotoInput || fotoInput.files.length === 0) {
            if (statusDiv) statusDiv.textContent = "Selecione um funcionário e um ficheiro.";
            return;
        }
        const file = fotoInput.files[0];
    // match server multer limits (5MB) and allow webp which server accepts
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB (server limit)
        if (!allowed.includes(file.type)) { if (statusDiv) statusDiv.textContent = 'Tipo inválido. Use PNG, JPG ou WEBP.'; return; }
        if (file.size > maxSize) { if (statusDiv) statusDiv.textContent = 'Ficheiro demasiado grande. Max 5MB.'; return; }

        const formData = new FormData();
        formData.append('foto', file);
        if (statusDiv) statusDiv.textContent = 'A enviar...';
        setBtnLoading(submitBtn, true, 'Enviando...');
        try {
            const response = await fetch(`${API_URL}/${currentFuncionarioId}/foto`, { method: 'POST', headers: getAuthHeaders(), body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Falha no upload');
            if (statusDiv) statusDiv.textContent = "Foto enviada com sucesso!";
            showToast('Foto enviada com sucesso.', 'success');
            const preview = document.getElementById('modal-foto-preview'); if (preview && result.foto_url) preview.src = result.foto_url;
            fotoInput.value = '';
            carregarFuncionarios();
        } catch (error) {
            if (statusDiv) statusDiv.textContent = `Erro: ${error.message}`;
            showToast(`Erro ao enviar foto: ${error.message}`, 'error');
        } finally {
            setBtnLoading(submitBtn, false);
        }
    });

    // Modal edit form submit -> persist changes in real-time
    const modalEditarForm = document.getElementById('modal-editar-form');
    if (modalEditarForm) {
        modalEditarForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentFuncionarioId) return showToast('Selecione um colaborador primeiro.', 'error');
            const statusDiv = document.getElementById('modal-save-status');
            statusDiv.textContent = 'Salvando...';
            // Collect expanded fields
            const payload = {};
            const fields = ['modal-nome','modal-cargo','modal-email','modal-data_nascimento','modal-cpf','modal-rg','modal-nacionalidade','modal-filiacao_mae','modal-filiacao_pai','modal-estado_civil','modal-telefone','modal-banco','modal-agencia','modal-conta_corrente'];
            fields.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const val = el.value === '' ? null : el.value.trim ? el.value.trim() : el.value;
                // map ids to payload keys
                const map = {
                    'modal-nome': 'nome_completo', 'modal-cargo': 'cargo', 'modal-email': 'email', 'modal-data_nascimento': 'data_nascimento',
                    'modal-cpf': 'cpf', 'modal-rg': 'rg', 'modal-nacionalidade': 'nacionalidade', 'modal-filiacao_mae': 'filiacao_mae',
                    'modal-filiacao_pai': 'filiacao_pai', 'modal-estado_civil': 'estado_civil', 'modal-telefone': 'telefone',
                    'modal-banco': 'banco', 'modal-agencia': 'agencia', 'modal-conta_corrente': 'conta_corrente'
                };
                if (map[id]) payload[map[id]] = val;
            });
            try {
                const resp = await fetch(`${API_URL}/${currentFuncionarioId}`, {
                    method: 'PUT',
                    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(payload)
                });
                const j = await resp.json();
                if (!resp.ok) throw new Error(j.message || 'Erro ao salvar.');
                statusDiv.textContent = 'Salvo.';
                // refresh UI pieces
                carregarFuncionarios();
                carregarDashboard();
                abrirModalDetalhes(currentFuncionarioId);
                // also refresh header if the logged in user updated their own name
                const localUser = JSON.parse(localStorage.getItem('userData') || 'null');
                if (localUser && Number(localUser.id) === Number(currentFuncionarioId)) preencherHeaderUsuario();
            } catch (err) {
                statusDiv.textContent = `Erro: ${err.message}`;
            }
        });
    }

    if (formUploadHolerite) formUploadHolerite.addEventListener('submit', async (e) => {
        e.preventDefault();
        const statusDiv = document.getElementById('upload-holerite-status');
        const fileInput = document.getElementById('arquivo-holerite');
        const competenciaInput = document.getElementById('holerite-competencia');
        const submitBtn = formUploadHolerite.querySelector('button[type="submit"]');

        if (!currentFuncionarioId || !fileInput || fileInput.files.length === 0 || !competenciaInput || !competenciaInput.value) {
            if (statusDiv) statusDiv.textContent = "Selecione um ficheiro e a competência.";
            return;
        }

        const file = fileInput.files[0];
    const allowed = ['application/pdf'];
    const maxSize = 6 * 1024 * 1024; // 6MB (server limit)
        if (!allowed.includes(file.type)) { if (statusDiv) statusDiv.textContent = 'Apenas PDF permitido.'; return; }
        if (file.size > maxSize) { if (statusDiv) statusDiv.textContent = 'Ficheiro demasiado grande. Max 6MB.'; return; }

        const formData = new FormData();
        formData.append('holerite', file);
        formData.append('competencia', competenciaInput.value);
        if (statusDiv) statusDiv.textContent = 'A enviar...';
        setBtnLoading(submitBtn, true, 'Enviando...');
        try {
            const response = await fetch(`${API_URL}/${currentFuncionarioId}/holerite`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: formData,
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Falha no upload');
            if (statusDiv) statusDiv.textContent = result.message || 'Holerite enviado.';
            formUploadHolerite.reset();
            abrirModalDetalhes(currentFuncionarioId); // Recarrega os detalhes do modal
            showToast('Holerite enviado.', 'success');
        } catch (error) {
            if (statusDiv) statusDiv.textContent = `Erro: ${error.message}`;
            showToast(`Erro ao enviar holerite: ${error.message}`, 'error');
        } finally {
            setBtnLoading(submitBtn, false);
        }
    });

    // handler para upload de atéstado no modal (admin)
    if (formUploadAtestado) {
        formUploadAtestado.addEventListener('submit', async (e) => {
            e.preventDefault();
            const statusDiv = document.getElementById('upload-atéstado-status');
            const fileInput = document.getElementById('arquivo-atéstado');
            const submitBtn = formUploadAtestado.querySelector('button[type="submit"]');
            if (!currentFuncionarioId || !fileInput || fileInput.files.length === 0) {
                if (statusDiv) statusDiv.textContent = 'Selecione um funcionário e um ficheiro.';
                return;
            }
            const file = fileInput.files[0];
            const allowed = ['application/pdf','image/png','image/jpeg'];
            const maxSize = 5 * 1024 * 1024; // 5MB (server limit)
            if (!allowed.includes(file.type)) { if (statusDiv) statusDiv.textContent = 'Tipo inválido. Use PDF, JPG ou PNG.'; return; }
            if (file.size > maxSize) { if (statusDiv) statusDiv.textContent = 'Ficheiro demasiado grande. Max 5MB.'; return; }

            const formData = new FormData();
            formData.append('atéstado', file);
            if (statusDiv) statusDiv.textContent = 'A enviar...';
            setBtnLoading(submitBtn, true, 'Enviando...');
            try {
                const response = await fetch(`${API_URL}/${currentFuncionarioId}/atéstado`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: formData
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message || 'Falha no upload');
                if (statusDiv) statusDiv.textContent = result.message || 'Atéstado enviado.';
                formUploadAtestado.reset();
                abrirModalDetalhes(currentFuncionarioId);
                showToast('Atéstado enviado.', 'success');
            } catch (err) {
                if (statusDiv) statusDiv.textContent = `Erro: ${err.message}`;
                showToast(`Erro ao enviar atéstado: ${err.message}`, 'error');
            } finally {
                setBtnLoading(submitBtn, false);
            }
        });
    }

    // Form de ediçáo rápida de data_nascimento dentro do modal
    const modalNascimentoForm = document.getElementById('modal-nascimento-form');
    if (modalNascimentoForm) {
        modalNascimentoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('modal-data-nascimento');
            if (!input) return showToast('Campo de data náo encontrado.', 'error');
            const val = input.value || null;
            try {
                const resp = await fetch(`${API_URL}/${currentFuncionarioId}`, {
                    method: 'PUT',
                    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ data_nascimento: val })
                });
                const j = await resp.json();
                if (!resp.ok) throw new Error(j.message || 'Erro ao atualizar.');
                showToast(j.message, 'success');
                // refresh dashboards
                carregarAniversariantes();
                carregarFuncionarios();
                abrirModalDetalhes(currentFuncionarioId);
            } catch (err) {
                showToast(`Falha ao atualizar data: ${err.message}`, 'error');
            }
        });
    }

    // --------------------
    // Avisos (CRUD simples)
    // --------------------
    async function carregarAvisos() {
        try {
            // Verificar se estamos no dashboard antes de carregar
            const dashboardSection = document.getElementById('dashboard-home');
            if (!dashboardSection || !dashboardSection.classList.contains('active')) {
                return; // Náo carregar se náo estivermos no dashboard
            }
            
            const res = await fetch('/api/avisos', { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
            if (!res.ok) throw new Error('Náo foi possível carregar avisos.');
            const avisos = await res.json();
            const div = dashboardSection.querySelector('#avisos-list');
            if (!div) return;
            if (!avisos || avisos.length === 0) {
                div.innerHTML = '<p>Nenhum aviso.</p>';
                return;
            }
            div.innerHTML = '';
            avisos.forEach(a => {
                const card = document.createElement('div');
                card.className = 'aviso-card';
                card.setAttribute('data-aviso-id', String(a.id));
                // structured media layout: avatar + body
                card.innerHTML = `
                    <div class="aviso-media">
                        <div class="aviso-avatar"><img src="${escapeHtml(a.foto_thumb_url || a.foto_perfil_url || a.created_by_photo || 'Interativo-Aluforce.jpg')}" alt="Aviso" onerror="this.onerror=null;this.src='Interativo-Aluforce.jpg'"/></div>
                        <div class="aviso-body">
                            <div class="aviso-title">${escapeHtml(a.titulo || '')}</div>
                            <div class="aviso-desc">${escapeHtml(a.mensagem || '')}</div>
                            <div class="aviso-meta small">${a.created_by ? 'Criado por: ' + escapeHtml(a.created_by) : ''} ${a.created_at ? new Date(a.created_at).toLocaleString() : ''}</div>
                        </div>
                    </div>
                `;
                // actions container
                const actions = document.createElement('div'); actions.className = 'aviso-actions';
                const del = document.createElement('button');
                del.className = 'btn btn-secondary action-delete';
                del.setAttribute('aria-label', 'Apagar aviso');
                del.innerHTML = '<i class="fas fa-trash"></i> <span class="action-text">Apagar</span>';
                del.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const ok = await showConfirm('Apagar este aviso?');
                    if (!ok) return;
                    try {
                        const dres = await fetch(`/api/avisos/${a.id}`, { method: 'DELETE', headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
                        const dj = await dres.json();
                        if (!dres.ok) throw new Error(dj.message || 'Erro');
                        carregarAvisos();
                        showToast('Aviso apagado.', 'success');
                    } catch (err) { showToast('Falha ao apagar: ' + err.message, 'error'); }
                });
                const mark = document.createElement('button');
                mark.className = 'btn btn-primary marcar-lido action-mark';
                mark.setAttribute('aria-label', a.lido ? 'Lido' : 'Marcar como lido');
                mark.innerHTML = `<i class="fas fa-check"></i> <span class="action-text">${a.lido ? 'Lido' : 'Marcar como lido'}</span>`;
                if (a.lido) { mark.disabled = true; card.classList.add('lido'); }
                mark.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await markAvisoRead(a.id);
                    mark.innerHTML = `<i class="fas fa-check"></i> <span class="action-text">Lido</span>`;
                    mark.disabled = true;
                    card.classList.add('lido');
                });
                actions.appendChild(mark);
                actions.appendChild(del);
                card.appendChild(actions);
                div.appendChild(card);
            });
            // collapse the avisos card if no items remain (compact header)
            const cardAvisos = document.getElementById('card-avisos');
            if (cardAvisos) {
                const remaining = div.querySelectorAll('.aviso-card').length;
                if (!remaining) cardAvisos.classList.add('avisos-collapsed');
                else cardAvisos.classList.remove('avisos-collapsed');
            }
        } catch (err) {
            const div = document.getElementById('avisos-list');
            if (div) div.innerHTML = `<p style="color:red;">${err.message}</p>`;
        }
    }

    const btnNewAviso = document.getElementById('btn-new-aviso');
    if (btnNewAviso) {
        // open the modal-based aviso manager
        btnNewAviso.addEventListener('click', (e) => { e.preventDefault(); openAvisosModal(); });
    }

    // Modal-based avisos management
    function openAvisosModal() {
        const modal = document.getElementById('modal-avisos');
    if (!modal) return showToast('Modal de avisos náo encontrado.', 'error');
    openModal(modal);
        // ensure tab default
        document.querySelectorAll('#modal-avisos .tab-content').forEach(t => t.style.display = 'none');
        document.getElementById('tab-listar').style.display = 'block';
        document.querySelectorAll('#modal-avisos .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('#modal-avisos .tab-btn[data-tab="listar"]').classList.add('active');
        renderModalAvisosList();
    }

    // close modal handlers - support any .close-button with data-target
    document.querySelectorAll('.close-button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const target = btn.getAttribute('data-target');
            if (!target) {
                // fallback: close nearest ancestor modal
                const modalAncestor = btn.closest('.modal');
                if (modalAncestor) { closeModal(modalAncestor); }
                return;
            }
            const modal = document.querySelector(target);
            if (modal) {
                closeModal(modal);
            }
        });
    });

    // Close modal when clicking on backdrop (outside dialog)
    document.addEventListener('click', (e) => {
        try {
            const modal = e.target.closest && e.target.closest('.modal');
            if (!modal) return;
            const dialog = modal.querySelector('.modal-dialog');
            if (!dialog) return;
            // if click landed directly on modal (backdrop) and not inside dialog, close
            if (!dialog.contains(e.target)) {
                closeModal(modal);
            }
        } catch (err) { /* ignore */ }
    });

    // tab switching for avisos modal (updates ARIA and focuses first element in panel)
    document.addEventListener('click', (e) => {
        const tab = e.target.closest && e.target.closest('#modal-avisos .tab-btn');
        if (!tab) return;
        const which = tab.getAttribute('data-tab');
        // hide all panels
        document.querySelectorAll('#modal-avisos .tab-content').forEach(t => t.style.display = 'none');
        // update all tab buttons ARIA state
        document.querySelectorAll('#modal-avisos .tab-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
            b.setAttribute('tabindex', '-1');
        });
        // show selected panel and set aria
        const panel = document.getElementById('tab-' + which);
        if (panel) panel.style.display = 'block';
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        tab.setAttribute('tabindex', '0');
        // ensure focus lands on the first focusable element inside panel
        try { const focusables = _getFocusable(panel); if (focusables && focusables.length) focusables[0].focus(); } catch (err) { /* ignore */ }
    });

    async function renderModalAvisosList() {
        const list = document.getElementById('modal-avisos-list');
        if (!list) return;
        list.innerHTML = '<p>Carregando...</p>';
        try {
            const res = await fetch('/api/avisos', { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
            if (!res.ok) throw new Error('Falha ao carregar avisos');
            const avisos = await res.json();
            if (!avisos || avisos.length === 0) { list.innerHTML = '<p>Nenhum aviso cadastrado.</p>'; return; }
            list.innerHTML = '';
            avisos.forEach(a => {
                const row = document.createElement('div');
                row.className = 'modal-aviso-row';
                row.setAttribute('data-aviso-id', a.id);
                row.innerHTML = `
                    <div class="aviso-media">
                        <div class="aviso-avatar"><img src="${escapeHtml(a.foto_thumb_url || a.foto_perfil_url || a.created_by_photo || 'Interativo-Aluforce.jpg')}" alt="Aviso" onerror="this.onerror=null;this.src='Interativo-Aluforce.jpg'"/></div>
                        <div class="aviso-body">
                            <div class="aviso-title">${escapeHtml(a.titulo)}</div>
                            <div class="aviso-desc muted">${escapeHtml(a.mensagem)}</div>
                            <div class="aviso-meta small">${a.created_by ? 'Criado por: ' + escapeHtml(a.created_by) : ''} ${a.created_at ? new Date(a.created_at).toLocaleString() : ''}</div>
                        </div>
                    </div>
                `;
                const actions = document.createElement('div'); actions.className = 'aviso-actions';
                const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'Editar';
                const del = document.createElement('button'); del.className = 'btn btn-secondary'; del.textContent = 'Apagar';
                edit.addEventListener('click', () => openEditAviso(a));
                del.addEventListener('click', async () => {
                    const ok = await showConfirm('Apagar este aviso definitivamente?');
                    if (!ok) return;
                    try {
                        const dres = await fetch(`/api/avisos/${a.id}`, { method: 'DELETE', headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
                        const dj = await dres.json(); if (!dres.ok) throw new Error(dj.message || 'Erro');
                        showToast('Aviso apagado.', 'success');
                        renderModalAvisosList(); carregarAvisos();
                        try { const newBtn = document.getElementById('btn-new-aviso'); if (newBtn) newBtn.focus(); } catch (e) { /* ignore */ }
                    } catch (err) { showToast('Falha ao apagar: ' + err.message, 'error'); }
                });
                actions.appendChild(edit); actions.appendChild(del);
                row.appendChild(actions);
                list.appendChild(row);
            });
        } catch (err) { list.innerHTML = `<p style="color:red">${err.message}</p>`; }
    }

    // open edit flow: prefill Novo tab with data
    function openEditAviso(aviso) {
        document.querySelector('#modal-avisos .tab-btn[data-tab="novo"]').click();
        const titulo = document.getElementById('aviso-titulo');
        const mensagem = document.getElementById('aviso-mensagem');
        const form = document.getElementById('modal-aviso-form');
        if (!form || !titulo || !mensagem) return;
        titulo.value = aviso.titulo || '';
        mensagem.value = aviso.mensagem || '';
        form.setAttribute('data-edit-id', aviso.id);
    }

    // modal form submit (create or update)
    const modalAvisoForm = document.getElementById('modal-aviso-form');
    if (modalAvisoForm) {
        // auto-resize behavior for textarea to improve UX
        const avisoTextarea = document.getElementById('aviso-mensagem');
        if (avisoTextarea) {
            const resize = (el) => { el.style.height = 'auto'; el.style.height = (el.scrollHeight) + 'px'; };
            avisoTextarea.addEventListener('input', (e) => resize(e.target));
            // initial resize in case placeholder text exists
            setTimeout(() => resize(avisoTextarea), 30);
        }
        modalAvisoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const titulo = document.getElementById('aviso-titulo').value.trim();
            const mensagem = document.getElementById('aviso-mensagem').value.trim();
            const status = document.getElementById('modal-aviso-status');
            if (!titulo || !mensagem) { if (status) status.textContent = 'Preencha título e mensagem.'; return; }
            const editId = modalAvisoForm.getAttribute('data-edit-id');
            try {
                if (editId) {
                    const resp = await fetch(`/api/avisos/${editId}`, { method: 'PUT', headers: getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ titulo, mensagem }) });
                    const j = await resp.json(); if (!resp.ok) throw new Error(j.message || 'Erro');
                    showToast('Aviso atualizado.', 'success');
                    modalAvisoForm.removeAttribute('data-edit-id');
                } else {
                    const resp = await fetch('/api/avisos', { method: 'POST', headers: getAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ titulo, mensagem }) });
                    const j = await resp.json(); if (!resp.ok) throw new Error(j.message || 'Erro');
                    showToast('Aviso criado.', 'success');
                }
                document.getElementById('aviso-titulo').value = '';
                document.getElementById('aviso-mensagem').value = '';
                renderModalAvisosList(); carregarAvisos();
                try { const newBtn = document.getElementById('btn-new-aviso'); if (newBtn) newBtn.focus(); } catch (e) { /* ignore */ }
            } catch (err) { if (status) status.textContent = 'Erro: ' + err.message; }
        });
        // cancel button
        const cancelBtn = document.getElementById('modal-aviso-cancel'); if (cancelBtn) cancelBtn.addEventListener('click', () => {
            document.getElementById('aviso-titulo').value = ''; document.getElementById('aviso-mensagem').value = '';
            const m = document.getElementById('modal-avisos'); if (m) closeModal(m);
        });
    }

    function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    // Definir o dashboard como tela principal por defeito
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.getElementById('dashboard-home').classList.add('active');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    if (navDashboard) navDashboard.classList.add('active');

    // Carrega os dados iniciais do dashboard e widgets auxiliares
    carregarDashboard();
    carregarAniversariantes();
    carregarAvisos();
    carregarFuncionarios();
    // preencher header com /api/me
    preencherHeaderUsuario();
    // show UI after admin init
    try { revealUI(); } catch (e) { /* ignore */ }
}

// ===================================================================================
// == PORTAL DO FUNCIONÁRIO
// ===================================================================================
async function initEmployeePage() {
    let authToken = localStorage.getItem('authToken');
    let localUserData = JSON.parse(localStorage.getItem('userData'));

    // Diagnostic: log initial localStorage state to help debug white-screen reports
    try { console.log('initEmployeePage start', { authTokenPresent: !!(localStorage.getItem('authToken') || localStorage.getItem('token')), userDataPresent: !!localUserData, bodyVisibility: document && document.body && document.body.style ? document.body.style.visibility : null }); } catch (e) {}

    // Debug: verificar se usuário deveria ir para área admin
    console.log('🔍 DEBUG initEmployeePage - Verificando redirecionamento admin:', {
        userData: localUserData,
        role: localUserData?.role,
        shouldRedirectToAdmin: localUserData && localUserData.role === 'admin'
    });
    
    if (localUserData && localUserData.role === 'admin') {
        console.log('✅ DEBUG initEmployeePage - Redirecionando admin para área administrativa');
        window.location.href = '/areaadm.html';
        return;
    }

    // Re-read localStorage to catch tokens injected after initial script evaluation
    try { authToken = localStorage.getItem('authToken') || localStorage.getItem('token'); } catch (e) { authToken = authToken; }
    try { localUserData = JSON.parse(localStorage.getItem('userData') || 'null') || localUserData; } catch (e) { /* ignore */ }
    if (!authToken || !localUserData || !localUserData.id) {
        console.log('initEmployeePage: no token or userData at start', { authToken: !!authToken, localUserDataExists: !!localUserData });
        // If token exists but userData is missing, try to populate it synchronously via /api/me
        try {
            const tokenCheck = localStorage.getItem('authToken') || localStorage.getItem('token');
            if (tokenCheck && (!localUserData || !localUserData.id)) {
                try {
                    const resp = await fetch('/api/me', { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
                    if (resp && resp.ok) {
                        const me = await resp.json();
                        if (me && me.id) {
                            localUserData = me;
                            try { localStorage.setItem('userData', JSON.stringify(me)); } catch (e) { /* ignore */ }
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }

        // If still no token/userData, show overlay and poll for injected values (automation or delayed writes)
        if (!localStorage.getItem('authToken') && !localStorage.getItem('token') || !localUserData || !localUserData.id) {
            try {
                // create overlay only once
                if (!document.getElementById('auth-overlay')) {
                    const overlay = document.createElement('div');
                    overlay.id = 'auth-overlay';
                    overlay.style.position = 'fixed';
                    overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.right = '0'; overlay.style.bottom = '0';
                    overlay.style.background = 'rgba(0,0,0,0.45)';
                    overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
                    overlay.style.zIndex = '99999';
                    overlay.innerHTML = `<div style="background:#fff;padding:20px;border-radius:6px;max-width:420px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.2);">
                        <h3 style="margin:0 0 8px 0">Sessáo náo encontrada</h3>
                        <p style="margin:0 0 12px 0;color:#555">Aguardo token de autenticaçáo. Se náo houver açáo, clique para ir ao login.</p>
                        <div style="display:flex;gap:8px;justify-content:center;margin-top:8px;">
                          <button id="auth-overlay-wait" class="btn btn-secondary">Aguardar</button>
                          <a id="auth-overlay-login" class="btn btn-primary" href="/login.html">Ir ao Login</a>
                        </div>
                    </div>`;
                    document.body.appendChild(overlay);
                    // make overlay accessible
                    overlay.setAttribute('role', 'alertdialog');
                }
            } catch (e) { /* ignore DOM errors */ }

            // Poll localStorage for an injected token for up to 3s
            const start = Date.now();
            const waitForToken = () => new Promise((resolve) => {
                const iv = setInterval(() => {
                    try {
                        const t = localStorage.getItem('authToken') || localStorage.getItem('token');
                        const u = JSON.parse(localStorage.getItem('userData') || 'null');
                        if (t && u && u.id) {
                            console.log('initEmployeePage: detected token/userData via polling', { tokenPresent: !!t, userId: u && u.id ? u.id : null, elapsed: Date.now() - start });
                            clearInterval(iv);
                            // remove overlay
                            try { const o = document.getElementById('auth-overlay'); if (o) o.remove(); } catch (e) {}
                            return resolve(true);
                        }
                    } catch (err) { console.warn('initEmployeePage: poll parse error', err); }
                    if (Date.now() - start > 3000) {
                        console.log('initEmployeePage: token poll timeout');
                        clearInterval(iv);
                        return resolve(false);
                    }
                }, 250);
            });

            const tokenPresent = await waitForToken();
            if (!tokenPresent) {
                // Instead of leaving a blank screen, provide a reachable fallback UI
                try {
                    const o = document.getElementById('auth-overlay');
                    if (o) {
                        o.innerHTML = `
                            <div style="background:#fff;padding:20px;border-radius:6px;max-width:520px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.2);">
                                <h3 style="margin:0 0 8px 0">Sessáo náo encontrada</h3>
                                <p style="margin:0 0 12px 0;color:#555">Náo detectei um token de autenticaçáo. Você pode tentar novamente ou ir para a tela de login.</p>
                                <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;">
                                    <button id="auth-overlay-wait" class="btn btn-secondary">Tentar novamente</button>
                                    <a id="auth-overlay-login" class="btn btn-primary" href="/login.html">Ir ao Login</a>
                                </div>
                                <div id="auth-overlay-diagnostics" style="margin-top:12px;color:#333;font-size:0.9rem"></div>
                            </div>`;
                        // wire the retry button to restart the polling check
                        const retry = document.getElementById('auth-overlay-wait');
                        if (retry) retry.addEventListener('click', (ev) => {
                            ev.preventDefault();
                            // re-run the polling sequence once more (non-blocking)
                            (async function rePoll(){
                                try {
                                    const start2 = Date.now();
                                    let found = false;
                                    while (Date.now() - start2 < 3000 && !found) {
                                        await new Promise(r => setTimeout(r, 250));
                                        try { const t = localStorage.getItem('authToken') || localStorage.getItem('token'); const u = JSON.parse(localStorage.getItem('userData') || 'null'); if (t && u && u.id) { found = true; break; } } catch(e){}
                                    }
                                    if (found) {
                                        try { const ov2 = document.getElementById('auth-overlay'); if (ov2) ov2.remove(); } catch(e){}
                                        // continue normal init by calling initEmployeePage again
                                        try { initEmployeePage(); } catch(e) { console.warn('retry initEmployeePage failed', e); }
                                    } else {
                                        // leave message in place; user may click login
                                        try { showToast('Ainda náo há token detectado. Você pode ir ao login.', 'error'); } catch (e) {}
                                    }
                                } catch(e) { console.warn('rePoll failed', e); }
                            })();
                        });
                        // populate diagnostics area with a short summary of localStorage state
                        try {
                            const diag = document.getElementById('auth-overlay-diagnostics');
                            if (diag) {
                                try {
                                    const rawToken = localStorage.getItem('authToken') || localStorage.getItem('token') || null;
                                    let userRaw = null;
                                    try { userRaw = localStorage.getItem('userData') || null; } catch(e) { userRaw = null; }
                                    const diagObj = {
                                        tokenPresent: !!rawToken,
                                        tokenMasked: rawToken ? (String(rawToken).substring(0,8) + '...') : null,
                                        userData: (function(){ try { return userRaw ? JSON.parse(userRaw) : null; } catch(e) { return userRaw; } })(),
                                        ua: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '(no navigator)'
                                    };
                                    // small helper to escape HTML
                                    function _escape(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
                                    diag.innerHTML = `<pre style="text-align:left;max-height:140px;overflow:auto;background:#f7f7f7;padding:8px;border-radius:6px;border:1px solid #ddd;color:#111;">${_escape(JSON.stringify(diagObj, null, 2))}</pre><div style="margin-top:8px;display:flex;gap:8px;justify-content:center;"><button id="auth-copy-diagnostics" class="btn btn-secondary">Copiar diagnóstico</button><button id="auth-open-login" class="btn btn-primary">Ir ao Login</button></div>`;
                                    try {
                                        const copyBtn = document.getElementById('auth-copy-diagnostics');
                                        if (copyBtn) copyBtn.addEventListener('click', function(){
                                            try {
                                                const text = JSON.stringify(diagObj, null, 2);
                                                if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                                                    navigator.clipboard.writeText(text).then(function(){ showToast('Diagnóstico copiado para a área de transferência.', 'success'); }, function(){ showToast('Náo foi possível copiar automaticamente. Abra o console.', 'error'); });
                                                } else {
                                                    // fallback: select and prompt
                                                    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); showToast('Diagnóstico copiado.', 'success'); } catch(e){ showToast('Cópia automática falhou.', 'error'); } ta.remove();
                                                }
                                            } catch(e) { showToast('Erro ao copiar diagnóstico.', 'error'); }
                                        });
                                        const openLoginBtn = document.getElementById('auth-open-login');
                                        if (openLoginBtn) openLoginBtn.addEventListener('click', function(){ window.location.href = '/login.html'; });
                                    } catch(e) {}
                                } catch (e) { diag.textContent = 'Diagnostics indisponível'; }
                            }
                        } catch(e) { /* ignore diagnostics errors */ }
                    }
                } catch (e) { /* ignore DOM errors */ }
                return;
            }
            // else token injected: refresh local values and continue
            try { localUserData = JSON.parse(localStorage.getItem('userData') || 'null'); } catch (e) { /* ignore */ }
        }
        // If we have a token but no userData yet, try to fetch /api/me using the token (final attempt)
        if ((!localUserData || !localUserData.id) && (localStorage.getItem('authToken') || localStorage.getItem('token'))) {
            try {
                const resp = await fetch('/api/me', { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
                if (resp && resp.ok) {
                    const me = await resp.json();
                    if (me && me.id) {
                        localUserData = me;
                        try { localStorage.setItem('userData', JSON.stringify(me)); } catch (e) { /* ignore */ }
                    }
                }
            } catch (e) { /* ignore */ }
        }
        // fallthrough to fetch fresh data below
    }

    try {
        const response = await fetch(`/api/funcionarios/${localUserData.id}`, { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
        if (!response.ok) throw new Error("Náo foi possível carregar os seus dados.");
        
        const freshUserData = await response.json();
        localStorage.setItem('userData', JSON.stringify(freshUserData));
        
        populateUserData(freshUserData);
        setupEmployeeEventListeners(freshUserData);

    // carregar dashboard específico do funcionário (avisos, holerite destaque, fechamento de ponto)
    carregarEmployeeDashboard(freshUserData);

        // Ensure menu toggle behavior in employee page (same UX as admin)
        const menuToggle = document.getElementById('menu-toggle');
        const sidebar = document.querySelector('.sidebar');
        if (menuToggle && sidebar) {
            // prevent double-binding
            if (!window._menuToggleInit) {
                const stored = localStorage.getItem('sidebarOpen');
                if (stored === 'true') sidebar.classList.add('open');
                else sidebar.classList.remove('open');
                menuToggle.setAttribute('aria-expanded', sidebar.classList.contains('open') ? 'true' : 'false');
                menuToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const willOpen = !sidebar.classList.contains('open');
                    sidebar.classList.toggle('open');
                    localStorage.setItem('sidebarOpen', sidebar.classList.contains('open'));
                    menuToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
                });
                window._menuToggleInit = true;
            }
            document.addEventListener('click', (ev) => {
                if (!sidebar.classList.contains('open')) return;
                const target = ev.target;
                if (target === menuToggle || menuToggle.contains(target)) return;
                if (sidebar.contains(target)) return;
                sidebar.classList.remove('open');
                localStorage.setItem('sidebarOpen', 'false');
                menuToggle.setAttribute('aria-expanded', 'false');
            });
            document.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape' && sidebar.classList.contains('open')) {
                    sidebar.classList.remove('open');
                    localStorage.setItem('sidebarOpen', 'false');
                    menuToggle.setAttribute('aria-expanded', 'false');
                    menuToggle.focus();
                }
            });
        }

    } catch (error) {
        showToast(error.message, 'error');
        localStorage.clear();
        safeRedirectToLogin();
    }
    // reveal UI for employee after successful init
    try { revealUI(); } catch (e) { /* ignore */ }
    // schedule a few retries to enable widgets in case userData/token arrived late
    try { scheduleWidgetEnableRetries(); } catch (e) {}
}

// Busca dados do dashboard e popula avisos e widgets na página do funcionário
async function carregarEmployeeDashboard(userData) {
    try {
        const resp = await fetch('/api/dashboard/summary', { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
        if (!resp.ok) return;
        const summary = await resp.json();

        // Avisos
        const avisosBox = document.getElementById('avisos-box');
        if (avisosBox) {
            avisosBox.innerHTML = '';
                if (Array.isArray(summary.avisos) && summary.avisos.length > 0) {
                summary.avisos.forEach(a => {
                    const node = document.createElement('div');
                        node.className = 'aviso-card';
                        node.setAttribute('data-aviso-id', String(a.id));
                    node.innerHTML = `
                        <div class="aviso-media">
                            <div class="aviso-avatar"><img loading="lazy" src="${escapeHtml(a.foto_thumb_url || a.foto_perfil_url || a.created_by_photo || 'Interativo-Aluforce.jpg')}" alt="Aviso" onerror="this.onerror=null;this.src='Interativo-Aluforce.jpg'"/></div>
                            <div class="aviso-body"><div class="aviso-title">${escapeHtml(a.titulo || '')}</div><div class="aviso-desc">${escapeHtml(a.mensagem || a.conteudo || '')}</div></div>
                        </div>
                    `;
                        // add mark-as-read button
                        const btn = document.createElement('button'); btn.className = 'btn btn-secondary marcar-lido action-mark'; btn.setAttribute('aria-label', a.lido ? 'Lido' : 'Marcar como lido'); btn.innerHTML = `<i class="fas fa-check"></i> <span class="action-text">${a.lido ? 'Lido' : 'Marcar como lido'}</span>`;
                        if (a.lido) { btn.disabled = true; node.classList.add('lido'); }
                        btn.addEventListener('click', async () => { await markAvisoRead(a.id); btn.innerHTML = `<i class="fas fa-check"></i> <span class="action-text">Lido</span>`; btn.disabled = true; node.classList.add('lido'); });
                        node.appendChild(btn);
                        avisosBox.appendChild(node);
                });
                // collapse the avisos card if no items remain
                const parentCard = avisosBox.closest('.card') || document.getElementById('card-avisos');
                if (parentCard) {
                    const remaining = avisosBox.querySelectorAll('.aviso-card').length;
                    if (!remaining) parentCard.classList.add('avisos-collapsed');
                    else parentCard.classList.remove('avisos-collapsed');
                }
            } else {
                avisosBox.innerHTML = '<div style="color:#6b7280;">Nenhum aviso no momento.</div>';
            }
        }

        // Holerite destaque (usa dados do usuário quando disponíveis)
        try {
            const holeriteP = document.querySelector('.dashboard-widgets .widget:nth-child(1) p');
            const holeriteLink = document.querySelector('.dashboard-widgets .widget:nth-child(1) .widget-link');
            const viewBtn = document.getElementById('view-holerite');
            // default: disabled
            if (viewBtn) disableControl(viewBtn, 'Aguardando holerite anexado pelo administrador.');
            if (holeriteP) {
                if (userData.holerites && userData.holerites.length > 0) {
                    const h = userData.holerites[0];
                    if (h.competencia) holeriteP.textContent = 'Competência: ' + (h.competencia.substring(5,7) + '/' + h.competencia.substring(0,4));
                    if (holeriteLink && (h.url_pdf || h.url)) {
                        holeriteLink.href = h.url_pdf || h.url;
                        enableControl(holeriteLink);
                        holeriteLink.title = 'Visualizar holerite.';
                    }
                    if (viewBtn) enableControl(viewBtn);
                } else {
                    // no holerites attached
                    if (holeriteP) holeriteP.textContent = 'Nenhum holerite disponível.';
                    if (holeriteLink) disableControl(holeriteLink, 'Aguardando holerite anexado pelo administrador.');
                }
            }
        } catch (e) { /* ignore */ }

        // Status do ponto (usa summary.espelho_ponto ou summary.tempoCasa se disponível)
        try {
            const pontoP = document.querySelector('.dashboard-widgets .widget:nth-child(2) p');
            const pontoLink = document.querySelector('.dashboard-widgets .widget:nth-child(2) .widget-link');
            const viewPontoBtn = document.getElementById('view-ponto');
            // default: disable ponto link/button
            if (pontoLink) disableControl(pontoLink, 'Aguardando RH anexar o espelho de ponto.');
            if (viewPontoBtn) { disableControl(viewPontoBtn, 'Aguardando RH anexar o espelho de ponto.'); viewPontoBtn.removeAttribute('data-url'); }

            // Prefer explicit espelho_ponto returned for non-admin users
            const espelho = summary.espelho_ponto || (summary.tempoCasa && summary.tempoCasa.espelho) || null;
            if (espelho) {
                if (pontoP) pontoP.textContent = 'Fechamento: ' + (espelho.competencia || (summary.tempoCasa && summary.tempoCasa.fechamento) || '—');
                if (pontoLink) { enableControl(pontoLink); pontoLink.title = 'Ver espelho de ponto'; }
                if (viewPontoBtn && espelho.arquivo_url) {
                    enableControl(viewPontoBtn); viewPontoBtn.setAttribute('data-url', espelho.arquivo_url);
                }
            } else if (summary.tempoCasa && summary.tempoCasa.fechamento) {
                // fallback: show tempoCasa info but no espelho file
                if (pontoP) pontoP.textContent = 'Fechamento: ' + summary.tempoCasa.fechamento;
                if (pontoLink) enableControl(pontoLink);
            } else {
                if (pontoP) pontoP.textContent = 'Status do ponto náo disponível.';
            }
        } catch (e) { /* ignore */ }

    } catch (err) {
        console.warn('Erro ao carregar dashboard do funcionário:', err);
    }
}

// Real-time updates: subscribe to server-sent events for new avisos
function subscribeAvisosSSE() {
    if (!window.EventSource) return; // browser doesn't support SSE
    try {
        let triedNoToken = false;
        let triedHandshake = false;
        const tryOpen = (useToken) => {
            const token = localStorage.getItem('authToken') || localStorage.getItem('token');
            const url = (useToken && token) ? `/api/avisos/stream?token=${encodeURIComponent(token)}` : '/api/avisos/stream';
            const es = new EventSource(url, { withCredentials: false });
            let opened = false;
            es.addEventListener('open', () => { opened = true; console.log('Conectado ao stream de avisos (SSE).', { url }); });
            es.addEventListener('error', (e) => {
                console.warn('Erro no stream de avisos SSE', e, { url, opened });
                try { es.close(); } catch (err) {}
                // If we failed before opening and we used the main token, prefer attempting an authenticated handshake
                // (this is necessary because EventSource cannot set custom headers). Only if handshake fails, retry
                // without token once as a final attempt before falling back to polling.
                if (!opened && useToken && !triedHandshake) {
                    triedHandshake = true;
                    (async () => {
                        try {
                            const resp = await fetch('/api/avisos/sse-handshake', { method: 'POST', headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
                            if (resp && resp.ok) {
                                const j = await resp.json();
                                if (j && j.url) {
                                    console.log('SSE handshake succeeded, opening EventSource with temporary URL');
                                    tryOpenUrl(j.url);
                                    return;
                                }
                            }
                        } catch (handErr) {
                            console.warn('SSE handshake failed', handErr);
                        }
                        // handshake failed; try once without token
                        if (!triedNoToken) {
                            triedNoToken = true;
                            console.log('SSE handshake failed; retrying without token as fallback.');
                            setTimeout(() => tryOpen(false), 300);
                            return;
                        }
                        // fallback: start polling
                        try { startAvisosPolling(); } catch (err) {}
                    })();
                    return;
                }
                // If we failed before opening and haven't yet tried the no-token fallback, try it
                if (!opened && useToken && !triedNoToken) {
                    triedNoToken = true;
                    console.log('SSE failed with token; retrying without token as fallback.');
                    setTimeout(() => tryOpen(false), 300);
                    return;
                }
                // start polling fallback so avisos still update
                try { startAvisosPolling(); } catch (err) { /* ignore */ }
            });
            es.addEventListener('novo_aviso', (ev) => {
                try {
                    const aviso = JSON.parse(ev.data);
                    const action = aviso && aviso.action ? aviso.action : 'created';

                    // Handle deleted avisos: remove from DOM
                    if (action === 'deleted') {
                        try {
                            ['#avisos-list', '#dashboard-avisos-list', '#avisos-box', '#modal-avisos-list'].forEach(sel => {
                                const container = document.querySelector(sel);
                                if (!container) return;
                                const card = container.querySelector(`[data-aviso-id='${aviso.id}']`);
                                if (card) {
                                    card.style.transition = 'opacity 250ms ease, height 250ms ease, margin 250ms ease';
                                    card.style.opacity = '0'; card.style.height = '0px'; card.style.margin = '0px';
                                    setTimeout(() => { if (card && card.parentNode) card.parentNode.removeChild(card); }, 300);
                                }
                            });
                            showToast('Aviso removido.', 'success', 2200);
                        } catch (e) { console.warn('Erro ao remover aviso SSE', e); }
                        return;
                    }

                    // Handle updated avisos: find existing nodes and update content
                    if (action === 'updated') {
                        try {
                            const nodes = Array.from(document.querySelectorAll(`[data-aviso-id='${aviso.id}']`));
                            nodes.forEach(node => {
                                const title = node.querySelector('.aviso-title');
                                const desc = node.querySelector('.aviso-desc');
                                const meta = node.querySelector('.aviso-meta');
                                if (title) title.textContent = aviso.titulo || '';
                                if (desc) desc.textContent = aviso.mensagem || aviso.conteudo || '';
                                if (meta) meta.textContent = (aviso.created_by ? 'Criado por: ' + aviso.created_by + ' ' : '') + (aviso.created_at ? new Date(aviso.created_at).toLocaleString() : '');
                            });
                            showToast('Aviso atualizado.', 'success', 1800);
                        } catch (e) { console.warn('Erro ao atualizar aviso SSE', e); }
                        return;
                    }

                    // Default: treat as created/new aviso
                    const avisosBox = document.getElementById('avisos-box');
                    if (!avisosBox) return;
                    const node = document.createElement('div');
                    node.className = 'aviso-card novo';
                    node.setAttribute('data-aviso-id', aviso.id || '');
                    node.innerHTML = `
                        <div class="aviso-media">
                            <div class="aviso-avatar"><img loading="lazy" src="${escapeHtml(aviso.foto_thumb_url || aviso.foto_perfil_url || aviso.created_by_photo || 'Interativo-Aluforce.jpg')}" alt="Aviso" onerror="this.onerror=null;this.src='Interativo-Aluforce.jpg'"/></div>
                            <div class="aviso-body"><div class="aviso-title">${escapeHtml(aviso.titulo || '')}</div><div class="aviso-desc">${escapeHtml(aviso.mensagem || aviso.conteudo || '')}</div></div>
                        </div>
                    `;
                    const btn = document.createElement('button'); btn.className = 'btn btn-secondary marcar-lido action-mark'; btn.setAttribute('aria-label','Marcar como lido'); btn.innerHTML = `<i class="fas fa-check"></i> <span class="action-text">Marcar como lido</span>`;
                    btn.addEventListener('click', () => { markAvisoRead(aviso.id); node.classList.add('lido'); btn.disabled = true; btn.innerHTML = `<i class="fas fa-check"></i> <span class="action-text">Lido</span>`; });
                    node.appendChild(btn);
                    if (avisosBox.firstChild) avisosBox.insertBefore(node, avisosBox.firstChild);
                    else avisosBox.appendChild(node);
                    showToast('Novo aviso publicado.', 'success', 2500);
                } catch (e) { console.warn('Falha ao processar aviso SSE', e); }
            });
            // expose es for debugging
            window._avisosSSE = es;
            return es;
        };
        // initial attempt: prefer token if present
        tryOpen(true);
        // helper to open using an explicit url (temporary token)
        function tryOpenUrl(explicitUrl) {
            try {
                const es2 = new EventSource(explicitUrl, { withCredentials: false });
                es2.addEventListener('open', () => { console.log('Conectado ao stream de avisos (SSE) via handshake.', { explicitUrl }); });
                es2.addEventListener('error', (e) => { console.warn('Erro no stream de avisos SSE (handshake url)', e, { explicitUrl }); try { es2.close(); } catch(_){}; try { startAvisosPolling(); } catch(_){} });
                es2.addEventListener('novo_aviso', (ev) => { try { const aviso = JSON.parse(ev.data); /* reuse existing handler logic by dispatching a custom event */ const ev2 = new MessageEvent('novo_aviso', { data: ev.data }); window.dispatchEvent(ev2); } catch (e) { console.warn('Falha ao processar aviso SSE (handshake) ', e); } });
                window._avisosSSE = es2;
                return es2;
            } catch (e) { console.warn('tryOpenUrl failed', e); try { startAvisosPolling(); } catch(_){} }
        }
    } catch (e) {
        console.warn('Náo foi possível abrir EventSource para avisos:', e);
    }
}

// Start SSE subscription for avisos (non-blocking)
subscribeAvisosSSE();

// Polling fallback: if EventSource not supported or connection fails, poll every 30s
let _avisosPollingTimer = null;
function startAvisosPolling() {
    if (window.EventSource) return; // prefer SSE
    if (_avisosPollingTimer) return;
    async function poll() {
        try {
            const resp = await fetch('/api/dashboard/summary', { headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
            if (!resp.ok) return;
            const summary = await resp.json();
            const avisos = summary.avisos || [];
            const avisosBox = document.getElementById('avisos-box');
            if (!avisosBox) return;
            // track existing ids to avoid duplicates
            const existing = new Set(Array.from(avisosBox.querySelectorAll('[data-aviso-id]')).map(n => n.getAttribute('data-aviso-id')));
            avisos.forEach(a => {
                if (!a || !a.id) return;
                if (existing.has(String(a.id))) return; // skip duplicates
                const node = document.createElement('div');
                node.className = 'aviso-card';
                node.setAttribute('data-aviso-id', a.id);
                node.innerHTML = `
                    <div class="aviso-media">
                        <div class="aviso-avatar"><img loading="lazy" src="${escapeHtml(a.foto_thumb_url || a.foto_perfil_url || a.created_by_photo || 'Interativo-Aluforce.jpg')}" alt="Aviso" onerror="this.onerror=null;this.src='Interativo-Aluforce.jpg'"/></div>
                        <div class="aviso-body"><div class="aviso-title">${escapeHtml(a.titulo || '')}</div><div class="aviso-desc">${escapeHtml(a.mensagem || a.conteudo || '')}</div></div>
                    </div>
                `;
                const btn = document.createElement('button'); btn.className = 'btn btn-secondary marcar-lido action-mark'; btn.setAttribute('aria-label','Marcar como lido'); btn.innerHTML = `<i class="fas fa-check"></i> <span class="action-text">Marcar como lido</span>`;
                btn.addEventListener('click', () => { markAvisoRead(a.id); node.classList.add('lido'); btn.disabled = true; btn.innerHTML = `<i class="fas fa-check"></i> <span class="action-text">Lido</span>`; });
                node.appendChild(btn);
                // append at bottom for polling so newest still at top when admin creates
                avisosBox.insertBefore(node, avisosBox.firstChild);
            });
        } catch (e) { /* silent */ }
    }
    poll();
    _avisosPollingTimer = setInterval(poll, 30000);
}

// mark-as-read persistence (localStorage simple implementation)
function readAvisosSet() {
    try { return new Set(JSON.parse(localStorage.getItem('readAvisos') || '[]').map(String)); } catch (e) { return new Set(); }
}
function markAvisoRead(id) {
    // Prefer server-side persistence; fall back to localStorage if network fails
    (async () => {
        try {
            const resp = await fetch(`/api/avisos/${id}/read`, { method: 'POST', headers: getAuthHeaders({ 'Content-Type': 'application/json' }) });
            if (!resp.ok) throw new Error('Falha ao marcar como lido no servidor');
        } catch (e) {
            // network error or server failure -> persist locally
            try { const s = readAvisosSet(); s.add(String(id)); localStorage.setItem('readAvisos', JSON.stringify(Array.from(s))); } catch (err) { /* ignore */ }
        }

        // Remove aviso card(s) from DOM and shrink avisos container smoothly
        try {
            // remove from admin and employee avisos containers
            ['#avisos-list', '#dashboard-avisos-list', '#avisos-box', '#dashboard-avisos-list'].forEach(sel => {
                const container = document.querySelector(sel);
                if (!container) return;
                const card = container.querySelector(`[data-aviso-id='${id}']`);
                if (card) {
                    // animate fade out then remove
                    card.style.transition = 'opacity 250ms ease, height 250ms ease, margin 250ms ease';
                    card.style.opacity = '0';
                    card.style.height = '0px';
                    card.style.margin = '0px';
                    setTimeout(() => { if (card && card.parentNode) card.parentNode.removeChild(card); }, 300);
                }
            });

            // After a short delay, if the avisos container is empty collapse it
            setTimeout(() => {
                const avisosCard = document.getElementById('card-avisos');
                const avisosBox = document.getElementById('dashboard-avisos-list');
                const adminBox = document.getElementById('avisos-list');
                const countLeft = (avisosBox ? avisosBox.querySelectorAll('.aviso-card').length : 0) + (adminBox ? adminBox.querySelectorAll('.aviso-card').length : 0);
                if (countLeft === 0 && avisosCard) {
                    avisosCard.classList.add('avisos-collapsed');
                }
            }, 350);
        } catch (err) { /* ignore DOM errors */ }
    })();
}

// Utility to render read state for avisos already in DOM
function renderReadStateForAvisos() {
    const s = readAvisosSet();
    document.querySelectorAll('#avisos-box [data-aviso-id]').forEach(n => {
        const id = n.getAttribute('data-aviso-id');
        if (s.has(String(id))) {
            n.classList.add('lido');
            const btn = n.querySelector('.marcar-lido'); if (btn) btn.disabled = true;
        }
    });
}

// start polling only if SSE is not supported
if (!window.EventSource) startAvisosPolling();
// also render read state after initial load
setTimeout(renderReadStateForAvisos, 600);

// Intercept clicks on disabled controls to provide helpful feedback
document.addEventListener('click', (e) => {
    const target = e.target.closest && e.target.closest('.widget-link.disabled, button.disabled, .btn.disabled');
    if (!target) return;
    e.preventDefault();
    const title = target.getAttribute('title') || target.getAttribute('aria-disabled') || 'Açáo indisponível no momento.';
    showToast(title, 'error', 3000);
});

// NOTE: single canonical showToast implementation is defined earlier in this file.

function populateUserData(userData) {
    // populate header avatar and greeting to match admin UI
    const headerAvatar = document.getElementById('header-avatar-img');
    const headerGreeting = document.getElementById('header-greeting') || document.getElementById('welcome-message');
    if (headerAvatar) headerAvatar.src = userData.foto_thumb_url || userData.foto_perfil_url || userData.foto_perfil || 'Interativo-Aluforce.jpg';
    if (headerGreeting) {
        const parts = (userData.nome_completo || '').trim().split(/\s+/);
        const first = parts[0] || '';
        const last = parts.length > 1 ? parts[parts.length-1] : '';
        const display = `${first}${last ? ' ' + last : ''}`.trim();
        headerGreeting.textContent = display ? `Olá, ${display}` : 'Olá, Usuário';
    }
    const lastLoginEl = document.getElementById('last-login');
    if (lastLoginEl) lastLoginEl.textContent = new Date().toLocaleString('pt-BR');

    const fields = {
        'nome_completo': userData.nome_completo,
    'sobrenome': userData.sobrenome,
        'data_nascimento': formatDateToBR(userData.data_nascimento),
        'cpf': userData.cpf, 'rg': userData.rg, 'endereco': userData.endereco,
        'telefone': userData.telefone, 'email': userData.email,
        'estado_civil': userData.estado_civil, 'dependentes': userData.dependentes,
        'data_admissao': formatDateToBR(userData.data_admissao)
    };

    Object.entries(fields).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.value = (value !== null && value !== undefined) ? value : '';
    });

    const bancoEl = document.getElementById('banco');
    if (bancoEl) bancoEl.textContent = userData.banco || 'Náo informado';
    const agenciaEl = document.getElementById('agencia');
    if (agenciaEl) agenciaEl.textContent = userData.agencia || 'Náo informado';
    const contaEl = document.getElementById('conta_corrente');
    if (contaEl) contaEl.textContent = userData.conta_corrente || 'Náo informado';

    // Preenche o seletor de holerites
    const holeriteSelect = document.getElementById('holerite-mes');
    if (holeriteSelect) {
        holeriteSelect.innerHTML = '<option value="">Selecione um mês</option>';
        if (userData.holerites && userData.holerites.length > 0) {
            userData.holerites.forEach(h => {
                const option = document.createElement('option');
                option.value = h.url_pdf;
                option.textContent = `Competência ${h.competencia.substring(5, 7)}/${h.competencia.substring(0, 4)}`;
                holeriteSelect.appendChild(option);
            });
        }
    }
    // try enabling widgets based on the fresh userData
    try { ensureEmployeeWidgets(); } catch (e) {}
}

// Retry enabler: call ensureEmployeeWidgets() several times after page reveal
function scheduleWidgetEnableRetries() {
    let attempts = 0;
    const maxAttempts = 12; // ~2.4s total
    const intervalMs = 200;
    const timer = setInterval(() => {
        try { ensureEmployeeWidgets(); } catch (e) {}
        const hol = document.getElementById('widget-holerite-link');
        const pto = document.getElementById('widget-ponto-link');
        const holEnabled = hol && hol.getAttribute('href') && hol.getAttribute('href') !== '#';
        const ptoEnabled = pto && pto.getAttribute('href') && pto.getAttribute('href') !== '#';
        attempts += 1;
        if ((holEnabled || ptoEnabled) || attempts >= maxAttempts) {
            clearInterval(timer);
        }
    }, intervalMs);
}

function setupEmployeeEventListeners(userData) {
    document.querySelectorAll('.sidebar-nav .nav-link, .widget-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            try {
                const href = e.currentTarget.getAttribute && e.currentTarget.getAttribute('href');
                if (!href || !href.startsWith('#')) return;
                const targetId = href.substring(1);
                document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
                document.querySelectorAll('.sidebar-nav .nav-link').forEach(l => l.classList.remove('active'));
                const targetSection = document.getElementById(targetId);
                const targetLink = document.querySelector(`.sidebar-nav .nav-link[href="#${targetId}"]`);
                if (targetSection) targetSection.classList.add('active');
                if (targetLink) targetLink.classList.add('active');
            } catch (err) { /* ignore malformed hrefs */ }
        });
    });

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.clear();
            showToast("Você foi desconectado.", 'success');
            safeRedirectToLogin();
        });
    }

    const editBtn = document.getElementById('edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            ['telefone', 'estado_civil', 'dependentes'].forEach(id => {
                const el = document.getElementById(id); if (el) el.disabled = false;
            });
            editBtn.style.display = 'none';
            const saveBtn = document.getElementById('save-btn'); if (saveBtn) saveBtn.style.display = 'inline-block';
        });
    }

    const dadosFormEl = document.getElementById('dados-form');
    if (dadosFormEl) dadosFormEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const saveBtn = document.getElementById('save-btn');
        saveBtn.textContent = 'Salvando...';
        saveBtn.disabled = true;
        // Apenas permitir salvar campos permitidos e validar antes de enviar
        const telefoneVal = document.getElementById('telefone').value.trim();
        const estadoCivilVal = document.getElementById('estado_civil').value.trim();
        const dependentesValRaw = document.getElementById('dependentes').value;
        const dependentesVal = dependentesValRaw === '' ? 0 : Number(dependentesValRaw);

        // Validações básicas
        const errors = [];
        if (dependentesValRaw !== '' && (!Number.isInteger(dependentesVal) || dependentesVal < 0)) {
            errors.push('Número de dependentes deve ser um inteiro >= 0.');
        }
        if (telefoneVal && telefoneVal.length < 8) {
            errors.push('Telefone parece inválido (muito curto).');
        }

        if (errors.length > 0) {
            showToast('Corrija os seguintes erros antes de salvar:- ' + errors.join('- '), 'error');
            saveBtn.textContent = 'Salvar Alterações';
            saveBtn.disabled = false;
            return;
        }

        // Construir objeto com apenas os campos permitidos
        const dadosParaSalvar = {
            telefone: telefoneVal || null,
            estado_civil: estadoCivilVal || null,
            dependentes: dependentesVal
        };

        // Mostrar confirmaçáo ao utilizador antes de qualquer alteraçáo
        const summaryLines = [
            `Telefone: ${dadosParaSalvar.telefone || '(vazio)'}`,
            `Estado civil: ${dadosParaSalvar.estado_civil || '(vazio)'}`,
            `Dependentes: ${dadosParaSalvar.dependentes}`
        ];
    const confirmed = await showConfirm('Confirme as alterações abaixo:' + summaryLines.join(''));
    if (!confirmed) {
            saveBtn.textContent = 'Salvar Alterações';
            saveBtn.disabled = false;
            return;
        }

        try {
            const response = await fetch(`/api/funcionarios/${userData.id}`, {
                method: 'PUT',
                headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(dadosParaSalvar),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message);
                showToast(result.message, 'success');
            ['telefone', 'estado_civil', 'dependentes'].forEach(id => {
                document.getElementById(id).disabled = true;
            });
            document.getElementById('edit-btn').style.display = 'inline-block';
            document.getElementById('save-btn').style.display = 'none';
        } catch (error) {
                showToast(`Falha ao salvar: ${error.message}`, 'error');
        } finally {
            saveBtn.textContent = 'Salvar Alterações';
            saveBtn.disabled = false;
        }
    });

    // Event listener para o formulário de atéstado
    const atéstadoForm = document.getElementById('atéstado-form');
    if (atéstadoForm) {
        atéstadoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const statusDiv = document.getElementById('upload-status');
            const fileInput = document.getElementById('atéstado-file');
            if (fileInput.files.length === 0) {
                statusDiv.textContent = "Por favor, selecione um ficheiro.";
                return;
            }
            const formData = new FormData();
            formData.append('atéstado', fileInput.files[0]);
            // append optional description if provided
            const descEl = document.getElementById('atéstado-descriçáo');
            if (descEl && descEl.value && descEl.value.trim()) formData.append('descriçáo', descEl.value.trim());
            statusDiv.textContent = 'A enviar...';
            try {
                const response = await fetch(`/api/funcionarios/${userData.id}/atéstado`, {
                    method: 'POST',
                    body: formData,
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message);
                statusDiv.textContent = result.message;
                showToast(result.message, 'success');
                atéstadoForm.reset();
                const desc = document.getElementById('atéstado-descriçáo'); if (desc) desc.value = '';
            } catch (error) {
                statusDiv.textContent = `Erro: ${error.message}`;
                showToast(`Erro ao enviar atéstado: ${error.message}`, 'error');
            }
        });
    }

    // Event listener para o botáo de visualizar holerite
    const viewHoleriteBtn = document.getElementById('view-holerite');
    const holeriteViewer = document.getElementById('holerite-viewer');
    if(viewHoleriteBtn) {
        viewHoleriteBtn.addEventListener('click', () => {
            const selectedUrl = document.getElementById('holerite-mes').value;
            if (selectedUrl) {
                holeriteViewer.innerHTML = `<iframe src="${selectedUrl}" width="100%" height="600px" title="Visualizador de Holerite"></iframe>`;
            } else {
                    holeriteViewer.innerHTML = '<p>Por favor, selecione um holerite para visualizar.</p>';
                    showToast('Selecione um holerite antes de visualizar.', 'error');
            }
        });
    }

    const viewPontoBtn = document.getElementById('view-ponto');
    const pontoViewer = document.getElementById('ponto-viewer');
    if (viewPontoBtn) {
        viewPontoBtn.addEventListener('click', () => {
            const url = viewPontoBtn.getAttribute('data-url');
            if (!url) { showToast('Nenhum espelho de ponto disponível para visualizaçáo.', 'error'); return; }
            // decide embed strategy by extension
            if (url.toLowerCase().endsWith('.pdf')) {
                pontoViewer.innerHTML = `<iframe src="${url}" width="100%" height="700px" title="Espelho de Ponto"></iframe>`;
            } else {
                pontoViewer.innerHTML = `<img src="${url}" alt="Espelho de Ponto" style="max-width:100%;height:auto;display:block;margin:0 auto;" />`;
            }
            // navigate to ponto section
            document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
            const pontoSection = document.getElementById('ponto'); if (pontoSection) pontoSection.classList.add('active');
        });
    }

    // Back button for 'Meus Dados' section: return to dashboard and close sidebar if open
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Hide all content sections and show dashboard
            document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
            const dash = document.getElementById('dashboard');
            if (dash) dash.classList.add('active');

            // Close sidebar if it's open (keep state in localStorage)
            const sidebar = document.querySelector('.sidebar');
            const menuToggle = document.getElementById('menu-toggle');
            if (sidebar && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                localStorage.setItem('sidebarOpen', 'false');
                if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
            }

            // Smooth scroll to top of dashboard for better UX
            if (dash) dash.scrollIntoView({ behavior: 'smooth' });
        });
    }

    /* 
    // Integraçáo com Omie Layout (métodos comentados devido a erro de sintaxe)
    // TODO: Reorganizar em classe ou objeto apropriado
    
    updateViewMode(mode) {
        this.currentViewMode = mode;
        
        if (mode === 'grid') {
            this.displayEmployeesGrid();
        } else {
            this.displayEmployeesTable();
        }
    }

    displayEmployeesGrid() {
        const container = document.getElementById('employees-cards-container');
        if (!container || !this.funcionarios) return;

        container.innerHTML = this.funcionarios.map(func => `
            <div class="employee-card">
                <div class="employee-avatar" style="background-image: url('${func.foto ? 'uploads/' + func.foto : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23d1d5db"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'}')"></div>
                <div class="employee-name">${func.nome}</div>
                <div class="employee-role">${func.cargo || 'Funcionário'}</div>
                <div class="employee-email">${func.email}</div>
                <div class="employee-status ${func.status || 'active'}">${func.status === 'active' || !func.status ? 'Ativo' : 'Inativo'}</div>
                <div class="employee-actions">
                    <button class="btn btn-secondary btn-sm" onclick="app.visualizarFuncionario(${func.id})">
                        <i class="fas fa-eye"></i> Ver
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="app.editarFuncionario(${func.id})">
                        <i class="fas fa-edit"></i> Editar
                    </button>
                </div>
            </div>
        `).join('');
    }

    displayEmployeesTable() {
        // Usar a funçáo existente displayFuncionarios com ajustes
        if (this.funcionarios) {
            this.displayFuncionarios(this.funcionarios);
        }
    }

    // Métodos para integraçáo com omie-layout.js
    viewEmployee(id) {
        this.visualizarFuncionario(id);
    }

    editEmployee(id) {
        this.editarFuncionario(id);
    }

    deleteEmployee(id) {
        this.excluirFuncionario(id);
    }
    
    // Funçáo para recarregar dados do usuário
    reloadUserData() {
        const token = localStorage.getItem('authToken');
        if (!token) {
            console.log('Náo há token de autenticaçáo');
            return;
        }

        fetch('/api/user-data', {
            headers: this.getAuthHeaders()
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.userData) {
                // Atualizar localStorage com dados frescos
                localStorage.setItem('userData', JSON.stringify(data.userData));
                
                // Repopular interface com novos dados
                populateUserData(data.userData);
                
                // Atualizar último acesso
                this.updateLastAccess();
                
                console.log('Dados do usuário recarregados com sucesso');
            }
        })
        .catch(error => {
            console.error('Erro ao recarregar dados do usuário:', error);
        });
    }
    
    // Atualizar último acesso
    updateLastAccess() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        const dateString = now.toLocaleDateString('pt-BR');
        
        const lastAccessEl = document.getElementById('last-access-time');
        if (lastAccessEl) {
            lastAccessEl.textContent = `Hoje, ${timeString}`;
        }
        
        // Salvar no localStorage para próxima visita
        localStorage.setItem('lastAccess', now.toISOString());
    }
    */
}

// Funçáo para inicializar dados do dashboard
function initializeDashboard() {
    // Atualizar data atual
    const currentDateEl = document.getElementById('current-date');
    if (currentDateEl) {
        currentDateEl.textContent = new Date().toLocaleDateString('pt-BR');
    }
    
    // Carregar último acesso do localStorage ou usar padráo
    const lastAccess = localStorage.getItem('lastAccess');
    const lastAccessEl = document.getElementById('last-access-time');
    if (lastAccessEl) {
        if (lastAccess) {
            const lastDate = new Date(lastAccess);
            const timeString = lastDate.toLocaleTimeString('pt-BR', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            lastAccessEl.textContent = `Hoje, ${timeString}`;
        } else {
            lastAccessEl.textContent = 'Primeiro acesso';
        }
    }
    
    // Carregar dados do usuário se disponível
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    if (userData && Object.keys(userData).length > 0) {
        populateUserData(userData);
    }
    
    // Inicializar contagem de notificações
    if (window.omieLayout && window.omieLayout.updateNotificationsCount) {
        window.omieLayout.updateNotificationsCount();
    }
    
    // Atualizar último acesso para está sessáo
    if (window.app && window.app.updateLastAccess) {
        window.app.updateLastAccess();
    }
}

// Inicializar quando o DOM estiver pronto
/*OTIMIZADO*/ //// OTIMIZADO: DOMContentLoaded duplicado removido (162 chars)
