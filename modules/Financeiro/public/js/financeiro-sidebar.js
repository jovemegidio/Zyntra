/**
 * ============================================================
 * FINANCEIRO - SIDEBAR + HEADER DECORATOR (RBAC)
 * ============================================================
 * 
 * Padrão PCP: HTML estático no body + JS decorador.
 * NÃO renderiza sidebar/header. Apenas:
 *   1. Aplica RBAC (oculta botões não autorizados)
 *   2. Marca botão ativo baseado na URL
 *   3. Preenche dados do usuário no header
 *   4. Gerencia mobile sidebar toggle
 * 
 * Layout: Sidebar 60px + Header fixo 56px (Padrão PCP)
 * Tooltips: Via CSS ::after (attr(title))
 * 
 * USO: Incluir no HTML ANTES do </body>
 *   <script src="js/financeiro-sidebar.js?v=20260211"></script>
 * 
 * REQUISITOS no HTML:
 *   - Sidebar com botões estáticos: data-id, data-rbac, title
 *   - Header com IDs: greeting-text, user-name, user-avatar,
 *     user-photo, user-initials, notification-count
 * ============================================================
 */

(function () {
    'use strict';

    // ========================================================
    // RBAC ENGINE
    // ========================================================

    function getUserRole(user) {
        if (!user) return 'viewer';
        if (user.is_admin === 1 || user.role === 'admin') return 'admin';

        const role = (user.role || '').toLowerCase().trim();
        if (['financeiro', 'vendas', 'rh', 'compras', 'pcp'].includes(role)) return role;

        const dept = (user.departamento || '').toLowerCase().trim();
        if (['financeiro', 'vendas', 'rh', 'compras', 'pcp'].includes(dept)) return dept;

        const permFin = user.permissões_financeiro || user.permissoes_financeiro || [];
        if (Array.isArray(permFin) && permFin.length > 0) return 'financeiro';

        return 'viewer';
    }

    // ========================================================
    // APLICAR RBAC NA SIDEBAR (oculta botões não autorizados)
    // ========================================================

    function applyRBAC(userRole) {
        const buttons = document.querySelectorAll('.sidebar .sidebar-btn[data-rbac]');
        buttons.forEach(btn => {
            const allowed = btn.dataset.rbac.split(',').map(r => r.trim());
            if (!allowed.includes('*') && !allowed.includes(userRole)) {
                btn.style.display = 'none';
            }
        });
    }

    // ========================================================
    // MARCAR BOTÃO ATIVO NA SIDEBAR
    // ========================================================

    function markActivePage() {
        const path = window.location.pathname;
        const filename = path.split('/').pop() || 'index.html';

        // Remover active de todos
        document.querySelectorAll('.sidebar .sidebar-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Encontrar e marcar o ativo
        let found = false;
        document.querySelectorAll('.sidebar .sidebar-btn[data-id]').forEach(btn => {
            const btnHref = btn.getAttribute('onclick') || '';
            if (btnHref.includes(filename)) {
                btn.classList.add('active');
                found = true;
            }
        });

        // Fallback para index.html = dashboard
        if (!found && (filename === 'index.html' || filename === '')) {
            const dashBtn = document.querySelector('.sidebar .sidebar-btn[data-id="dashboard"]');
            if (dashBtn) dashBtn.classList.add('active');
        }
    }

    // ========================================================
    // PREENCHER HEADER COM DADOS DO USUÁRIO
    // ========================================================

    function populateHeader(user) {
        // Saudação
        const hour = new Date().getHours();
        let greeting = 'Boa noite';
        if (hour >= 5 && hour < 12) greeting = 'Bom dia';
        else if (hour >= 12 && hour < 18) greeting = 'Boa tarde';

        const greetingEl = document.getElementById('greeting-text');
        if (greetingEl) greetingEl.textContent = greeting;

        // Nome do usuário
        const userName = user
            ? (user.apelido || (user.nome ? user.nome.split(' ')[0] : 'Usuário'))
            : 'Usuário';
        const userEl = document.getElementById('user-name');
        if (userEl) userEl.textContent = userName;

        // Iniciais do avatar
        const initial = userName.charAt(0).toUpperCase();
        const initialsEl = document.getElementById('user-initials');
        if (initialsEl) initialsEl.textContent = initial;

        // Foto do avatar
        const fotoUrl = user ? (user.avatar || user.foto || user.foto_perfil_url || '') : '';
        const fotoEl = document.getElementById('user-photo');
        const avatarEl = document.getElementById('user-avatar');

        if (fotoUrl && fotoUrl !== '/avatars/default.webp' && fotoEl) {
            fotoEl.src = fotoUrl;
            fotoEl.onload = () => {
                fotoEl.style.display = 'block';
                if (initialsEl) initialsEl.style.display = 'none';
            };
            fotoEl.onerror = () => {
                fotoEl.style.display = 'none';
                if (initialsEl) initialsEl.style.display = 'flex';
            };
        } else if (fotoEl) {
            fotoEl.style.display = 'none';
        }
    }

    // ========================================================
    // MOBILE SIDEBAR TOGGLE (Padrão PCP)
    // ========================================================

    window.toggleMobileSidebar = function () {
        const sidebar = document.getElementById('mobile-sidebar') || document.getElementById('financeiro-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar) sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('active');
    };

    // Funções de notificação (stubs - implementar conforme necessário)
    window.marcarTodasLidas = window.marcarTodasLidas || function () {};
    window.limparNotificacoes = window.limparNotificacoes || function () {};

    // Toggle notification panel
    const notifBtn = document.getElementById('btn-notifications');
    if (notifBtn) {
        notifBtn.addEventListener('click', function () {
            const panel = document.getElementById('notification-panel');
            if (panel) panel.classList.toggle('active');
        });
    }

    // ========================================================
    // REDIRECIONAR PÁGINAS DESATIVADAS
    // ========================================================

    function redirectIfDisabled() {
        var path = window.location.pathname;
        var page = path.split('/').pop() || 'index.html';
        var allowedPages = ['index.html', 'contas_receber.html', ''];
        if (path.indexOf('/Financeiro') !== -1 && allowedPages.indexOf(page) === -1) {
            window.location.href = '/Financeiro/index.html';
        }
    }

    // ========================================================
    // OCULTAR PÁGINAS DESATIVADAS (sidebar, quick-actions, links)
    // Mantém apenas: Dashboard (index.html) + Contas a Receber
    // ========================================================

    function hidePagesNotEnabled() {
        const allowedPages = ['index.html', 'contas_receber.html'];
        // Ocultar itens da sidebar
        var sidebarBtns = document.querySelectorAll('.sidebar-nav .sidebar-btn');
        sidebarBtns.forEach(function (btn) {
            var href = btn.getAttribute('href') || '';
            var page = href.split('/').pop() || '';
            if (!allowedPages.some(function (p) { return page === p || (p === 'index.html' && page === ''); })) {
                btn.style.display = 'none';
            }
        });
        // Ocultar quick-actions que linkam para páginas desativadas
        var quickActions = document.querySelectorAll('.quick-action');
        quickActions.forEach(function (qa) {
            var onclick = qa.getAttribute('onclick') || '';
            var disabledPages = ['contas_pagar', 'contas_bancarias', 'fluxo_caixa', 'relatorios', 'plano_contas', 'conciliacao', 'orcamentos', 'impostos'];
            if (disabledPages.some(function (p) { return onclick.indexOf(p) !== -1; })) {
                qa.style.display = 'none';
            }
        });
        // Ocultar cards que linkam para páginas desativadas
        var allLinks = document.querySelectorAll('a[href]');
        allLinks.forEach(function (link) {
            var href = link.getAttribute('href') || '';
            var page = href.split('/').pop() || '';
            var disabledFiles = ['contas_pagar.html', 'contas_bancarias.html', 'fluxo_caixa.html', 'relatorios.html', 'plano_contas.html', 'conciliacao.html', 'orcamentos.html', 'impostos.html'];
            if (disabledFiles.indexOf(page) !== -1 && !link.classList.contains('sidebar-btn') && !link.classList.contains('sidebar-logo')) {
                link.style.display = 'none';
            }
        });
    }

    // ========================================================
    // INIT - PONTO DE ENTRADA
    // ========================================================

    async function init() {
        let user = null;
        let userRole = 'viewer';

        try {
            if (window.AluforceData && typeof window.AluforceData.getUser === 'function') {
                user = await window.AluforceData.getUser();
            } else {
                const response = await fetch('/api/me', { credentials: 'include' });
                if (response.ok) {
                    user = await response.json();
                }
            }
            userRole = getUserRole(user);
        } catch (err) {
            console.warn('[FinSidebar] Erro ao buscar usuário, usando role viewer:', err.message);
        }

        // 1. RBAC: ocultar botões não autorizados
        applyRBAC(userRole);

        // 1.5. Ocultar páginas desativadas (manter apenas Dashboard + Contas a Receber)
        hidePagesNotEnabled();
        // 1.6. Redirecionar se estiver em página desativada
        redirectIfDisabled();

        // 2. Marcar página ativa na sidebar
        markActivePage();

        // 3. Preencher dados do usuário no header
        populateHeader(user);

        // 4. Dispatch evento para scripts dependentes
        window.dispatchEvent(new CustomEvent('financeiro-sidebar-ready', {
            detail: { user, role: userRole }
        }));

        // 5. Expor API para uso externo
        window.FinanceiroSidebar = {
            user,
            role: userRole,
            getUserRole,
            applyRBAC,
            markActivePage,
            populateHeader
        };
    }

    // Executar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
