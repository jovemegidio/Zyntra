/**
 * ZYNTRA ERP — Layout Component
 * Injeta header + sidebar padronizados em qualquer página do sistema.
 *
 * Uso: adicione ao <body>:
 *   data-empresa-id="1"          — ID da empresa (opcional, usa sessionStorage se omitido)
 *   data-modulo-ativo="faturamento" — slug do módulo atual (para marcar ativo na sidebar)
 *   data-titulo-modulo="NF-e"    — título exibido no header após o logo
 *   data-empresa-nome="Aluforce" — nome da empresa (opcional, usa sessionStorage)
 *
 * Versão: 1.0 | Data: 2026-05-01
 */
(function () {
    'use strict';

    // ── 1. CONFIGURAÇÃO DOS MÓDULOS ────────────────────────────────
    const MODULOS = [
        { slug: 'dashboard',   icon: 'fas fa-home',               label: 'Painel',           href: '/dashboard' },
        { slug: 'vendas',      icon: 'fas fa-shopping-cart',      label: 'Vendas',            href: '/Vendas/' },
        { slug: 'faturamento', icon: 'fas fa-file-invoice-dollar',label: 'Faturamento',       href: '/Faturamento/emitir' },
        { slug: 'financeiro',  icon: 'fas fa-wallet',             label: 'Financeiro',        href: '/Financeiro/contas_pagar' },
        { slug: 'compras',     icon: 'fas fa-truck-loading',      label: 'Compras',           href: '/Compras/' },
        { slug: 'pcp',         icon: 'fas fa-industry',           label: 'PCP',               href: '/PCP/' },
        { slug: 'logistica',   icon: 'fas fa-shipping-fast',      label: 'Log\u00edstica',    href: '/Logistica/index.html' },
        { slug: 'rh',          icon: 'fas fa-users',              label: 'RH',                href: '/RH/' },
        { slug: 'relatorios',  icon: 'fas fa-chart-bar',          label: 'Relat\u00f3rios',   href: '/relatorios', bottom: true },
        { slug: 'config',      icon: 'fas fa-cog',                label: 'Configura\u00e7\u00f5es', href: '/config.html', bottom: true },
    ];

    // ── 2. LEITURA DOS ATRIBUTOS ───────────────────────────────────
    function getBodyAttr(name, fallback) {
        return document.body.getAttribute('data-' + name) || fallback;
    }

    function getUserData() {
        try {
            const raw = sessionStorage.getItem('userData') || localStorage.getItem('userData');
            if (raw) return JSON.parse(raw);
        } catch (_) {}
        return null;
    }

    function getEmpresaNome() {
        const fromAttr = getBodyAttr('empresa-nome', null);
        if (fromAttr) return fromAttr;
        const user = getUserData();
        if (user && user.empresa_nome) return user.empresa_nome;
        return 'Zyntra ERP';
    }

    function getUserNome() {
        const user = getUserData();
        if (!user) return '';
        return user.nome || user.name || user.username || 'Usuário';
    }

    function getModuloAtivo() {
        return getBodyAttr('modulo-ativo', '');
    }

    function getTituloModulo() {
        return getBodyAttr('titulo-modulo', '');
    }

    // ── 3. SAUDAÇÃO TEMPORAL ───────────────────────────────────────
    function getGreeting() {
        const h = new Date().getHours();
        if (h < 12) return 'Bom dia';
        if (h < 18) return 'Boa tarde';
        return 'Boa noite';
    }

    // ── 4. CSS CRÍTICO — injetar se não estiver no <head> ─────────
    const REQUIRED_CSS = [
        { id: 'css-design-system',     href: '/css/design-system.css?v=20260610a' },
        { id: 'css-global-header',     href: '/css/global-header-sidebar.css?v=20260610' },
        { id: 'css-components',        href: '/css/components.css?v=20260501' },
    ];

    function injectCSS() {
        const head = document.head;
        REQUIRED_CSS.forEach(function (css) {
            if (!document.getElementById(css.id)) {
                const link = document.createElement('link');
                link.id = css.id;
                link.rel = 'stylesheet';
                link.href = css.href;
                head.insertBefore(link, head.firstChild);
            }
        });

        // Estilos do dropdown do usuário (saudação/avatar) — injetado uma vez
        if (!document.getElementById('zc-user-dd-css')) {
            const st = document.createElement('style');
            st.id = 'zc-user-dd-css';
            st.textContent = [
                '.zc-user-area{position:relative;display:flex;align-items:center;gap:10px;cursor:pointer;}',
                '.zc-user-area .user-greeting{user-select:none;}',
                '.zc-ud-caret{font-size:10px;margin-left:6px;opacity:.7;}',
                '.zc-user-dropdown{position:absolute;top:calc(100% + 10px);right:0;min-width:224px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.15);padding:6px;opacity:0;visibility:hidden;transform:translateY(-6px);transition:opacity .15s,transform .15s,visibility .15s;z-index:10000;}',
                '.zc-user-dropdown.open{opacity:1;visibility:visible;transform:translateY(0);}',
                '.zc-ud-head{padding:10px 12px 8px;border-bottom:1px solid #f1f5f9;margin-bottom:4px;}',
                '.zc-ud-name{font-weight:700;font-size:13px;color:#111827;}',
                '.zc-ud-email{font-size:11px;color:#6b7280;margin-top:2px;word-break:break-all;}',
                '.zc-ud-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;font-size:13px;color:#334155;background:none;border:none;border-radius:7px;cursor:pointer;text-decoration:none;text-align:left;font-family:inherit;}',
                '.zc-ud-item:hover{background:#f1f5f9;color:#0f172a;}',
                '.zc-ud-item i{width:16px;text-align:center;color:#64748b;}',
                '.zc-ud-item.zc-ud-logout{color:#dc2626;}',
                '.zc-ud-item.zc-ud-logout:hover{background:#fef2f2;}',
                '.zc-ud-item.zc-ud-logout i{color:#dc2626;}',
                '.zc-ud-divider{height:1px;background:#f1f5f9;margin:4px 6px;}'
            ].join('');
            head.appendChild(st);
        }
    }

    // ── 5. CONSTRUIR HTML DO SIDEBAR ──────────────────────────────
    function buildSidebar(moduloAtivo) {
        const mainItems = MODULOS.filter(function (m) { return !m.bottom; });
        const bottomItems = MODULOS.filter(function (m) { return m.bottom; });

        function renderItem(m) {
            const isActive = moduloAtivo && m.slug === moduloAtivo;
            return '<a href="' + m.href + '" class="sidebar-btn' + (isActive ? ' active' : '') + '" data-title="' + m.label + '">' +
                   '<i class="' + m.icon + '"></i></a>';
        }

        const navHTML = mainItems.map(renderItem).join('\n');
        const bottomHTML = bottomItems.map(renderItem).join('\n');

        return '' +
            '<div class="sidebar-overlay" id="zc-sidebar-overlay"></div>' +
            '<aside class="sidebar" id="zc-sidebar">' +
            '  <a href="/dashboard" class="sidebar-logo" data-title="Painel Principal"><i class="fas fa-home"></i></a>' +
            '  <nav class="sidebar-nav" id="zc-sidebar-nav">' +
            navHTML +
            '  </nav>' +
            '  <div class="sidebar-bottom">' +
            bottomHTML +
            '  </div>' +
            '</aside>';
    }

    // ── 6. CONSTRUIR HTML DO HEADER ───────────────────────────────
    function buildHeader(empresaNome, tituloModulo, userNome) {
        const greeting = getGreeting();
        const moduloLabel = tituloModulo ? ' \u2014 ' + tituloModulo : '';

        // Iniciais do usuário para avatar
        const initials = userNome
            ? userNome.split(' ').map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase()
            : 'U';

        // Logo da marca: instâncias Labor injetam window.__BRAND_LOGO__ via o
        // middleware de branding (zyntra-branding.js). Sem isto, o header usava
        // a logo da Aluforce hardcoded em todas as páginas/módulos das instâncias.
        var brandLogo = (typeof window !== 'undefined' && window.__BRAND_LOGO__) || '/images/Logo Monocromatico - Branco - Aluforce.png';
        var brandName = (typeof window !== 'undefined' && window.__BRAND_NAME__) || empresaNome;
        // Se a logo branca da marca não existir (ex.: Labor Eletric), degrada para
        // o nome da marca em texto — nunca volta a exibir a Aluforce.
        var logoOnError = "this.onerror=null;var s=document.createElement('span');s.textContent=this.alt||'';s.style.cssText='color:#fff;font-weight:600;font-size:14px;white-space:nowrap;';this.replaceWith(s);";

        return '<header class="header" id="zc-header">' +
            '  <div class="header-left">' +
            '    <button class="mobile-menu-btn" id="zc-mobile-menu-btn" title="Menu" aria-label="Abrir menu">' +
            '      <i class="fas fa-bars"></i>' +
            '    </button>' +
            '    <div class="header-brand">' +
            '      <img id="zc-empresa-logo" src="' + brandLogo + '" alt="' + brandName + '" data-brand-logo-locked="true" onerror="' + logoOnError + '" style="height:22px;object-fit:contain;">' +
            '      <span style="color:rgba(255,255,255,0.2);font-weight:300;font-size:18px;">|</span>' +
            '      <img src="/images/zyntra-header.png" alt="Zyntra" style="height:22px;object-fit:contain;">' +
            '      <span id="zc-modulo-label" style="color:rgba(255,255,255,0.3);font-size:12px;margin-left:4px;">' + moduloLabel + '</span>' +
            '    </div>' +
            '  </div>' +
            '  <div class="header-right">' +
            '    <button class="header-btn" title="Atualizar" onclick="location.reload()">' +
            '      <i class="fas fa-sync-alt"></i>' +
            '    </button>' +
            '    <button class="header-btn" id="zc-notification-btn" title="Notificações">' +
            '      <i class="fas fa-bell"></i>' +
            '    </button>' +
            '    <div class="zc-user-area" id="zc-user-area">' +
            '      <div class="user-greeting">' +
            '        <span id="zc-greeting">' + greeting + '</span>, <strong id="zc-user-name">' + userNome + '</strong>' +
            '        <i class="fas fa-chevron-down zc-ud-caret"></i>' +
            '      </div>' +
            '      <div class="user-avatar" id="zc-user-avatar" title="' + userNome + '">' +
            '        <span id="zc-user-initials">' + initials + '</span>' +
            '      </div>' +
            '      <div class="zc-user-dropdown" id="zc-user-dropdown" role="menu" aria-hidden="true">' +
            '        <div class="zc-ud-head"><div class="zc-ud-name" id="zc-ud-name">' + userNome + '</div><div class="zc-ud-email" id="zc-ud-email"></div></div>' +
            '        <a class="zc-ud-item" href="/apps/minha-conta" role="menuitem"><i class="fas fa-user"></i> Minha Conta</a>' +
            '        <a class="zc-ud-item" href="/treinamentos" role="menuitem"><i class="fas fa-graduation-cap"></i> Treinamentos</a>' +
            '        <a class="zc-ud-item" href="/ajuda" role="menuitem"><i class="fas fa-question-circle"></i> Ajuda &amp; Suporte</a>' +
            '        <div class="zc-ud-divider"></div>' +
            '        <button class="zc-ud-item zc-ud-logout" id="zc-ud-logout" type="button" role="menuitem"><i class="fas fa-sign-out-alt"></i> Sair da conta</button>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</header>';
    }

    // ── 7. INJEÇÃO NO DOM ─────────────────────────────────────────
    function injectLayout() {
        const moduloAtivo   = getModuloAtivo();
        const tituloModulo  = getTituloModulo();
        const empresaNome   = getEmpresaNome();
        const userNome      = getUserNome();

        // Garante que .app-container existe
        let container = document.querySelector('.app-container');
        if (!container) {
            const wrapper = document.createElement('div');
            wrapper.className = 'app-container';
            while (document.body.firstChild) {
                wrapper.appendChild(document.body.firstChild);
            }
            document.body.appendChild(wrapper);
            container = wrapper;
        }

        // Remover sidebar e header existentes (hardcoded ou gerenciados) para substituir pelo padronizado
        const existingSidebar = container.querySelector('aside.sidebar');
        if (existingSidebar) existingSidebar.remove();

        const zcSidebar  = document.getElementById('zc-sidebar');
        const zcOverlay  = document.getElementById('zc-sidebar-overlay');
        const zcHeader   = document.getElementById('zc-header');
        if (zcSidebar)  zcSidebar.remove();
        if (zcOverlay)  zcOverlay.remove();
        if (zcHeader)   zcHeader.remove();

        const existingHeader = container.querySelector('header.header');
        if (existingHeader) existingHeader.remove();

        // Garantir .main-area
        let mainArea = container.querySelector('.main-area');
        if (!mainArea) {
            mainArea = document.createElement('main');
            mainArea.className = 'main-area';
            const children = Array.from(container.children);
            children.forEach(function (child) {
                if (!child.classList.contains('sidebar') &&
                    !child.classList.contains('sidebar-overlay') &&
                    !child.classList.contains('header')) {
                    mainArea.appendChild(child);
                }
            });
            container.appendChild(mainArea);
        }

        // Sempre injetar o sidebar padronizado dark
        const sidebarFrag = document.createElement('div');
        sidebarFrag.innerHTML = buildSidebar(moduloAtivo);
        while (sidebarFrag.firstChild) {
            container.insertBefore(sidebarFrag.firstChild, mainArea);
        }

        // Sempre injetar/substituir o header (padronização visual)
        const headerFrag = document.createElement('div');
        headerFrag.innerHTML = buildHeader(empresaNome, tituloModulo, userNome);
        mainArea.insertBefore(headerFrag.firstChild, mainArea.firstChild);

        // Eventos mobile (funciona com qualquer sidebar)
        setupMobileEvents();

        // Atualizar dados do usuário via sessionStorage (assíncrono)
        refreshUserData();
    }

    // ── 8. MOBILE — abrir/fechar sidebar ─────────────────────────
    function setupMobileEvents() {
        const menuBtn = document.getElementById('zc-mobile-menu-btn');
        // Compatível com sidebar gerenciado (#zc-sidebar) e pré-existente
        const getSidebar = function () {
            return document.getElementById('zc-sidebar') ||
                   document.querySelector('aside.sidebar');
        };
        const getOverlay = function () {
            return document.getElementById('zc-sidebar-overlay') ||
                   document.getElementById('sidebar-overlay') ||
                   document.querySelector('.sidebar-overlay');
        };

        function openSidebar() {
            const s = getSidebar();
            const o = getOverlay();
            if (s) s.classList.add('open');
            if (o) o.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeSidebar() {
            const s = getSidebar();
            const o = getOverlay();
            if (s) s.classList.remove('open');
            if (o) o.classList.remove('active');
            document.body.style.overflow = '';
        }

        if (menuBtn) {
            menuBtn.removeEventListener('click', menuBtn._zcOpen);
            menuBtn._zcOpen = openSidebar;
            menuBtn.addEventListener('click', openSidebar);
        }
        const overlay = getOverlay();
        if (overlay && !overlay._zcBound) {
            overlay._zcBound = true;
            overlay.addEventListener('click', closeSidebar);
        }

        // Fechar ao pressionar Escape
        if (!window._zcEscBound) {
            window._zcEscBound = true;
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeSidebar();
            });
        }

        // Expor globalmente para compatibilidade com código legado
        window.toggleMobileSidebar = function () {
            const s = getSidebar();
            if (s && s.classList.contains('open')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        };
    }

    // ── 9. ATUALIZAR DADOS DO USUÁRIO ─────────────────────────────
    function refreshUserData() {
        // Verificar se auth-unified.js já expôs os dados
        const tryUpdate = function () {
            const user = getUserData();
            if (!user) return;

            const nameEl     = document.getElementById('zc-user-name');
            const initialsEl = document.getElementById('zc-user-initials');
            const avatarEl   = document.getElementById('zc-user-avatar');

            const nome = user.nome || user.name || user.username || 'Usuário';
            // Padroniza a saudação do cabeçalho para o PRIMEIRO nome (consistente com
            // user-loader-global.js). Antes exibia o nome completo, gerando inconsistência
            // entre módulos ("Andreia" vs "Andreia Trovão").
            const primeiroNome = String(nome).trim().split(/\s+/)[0] || 'Usuário';

            if (nameEl)     nameEl.textContent = primeiroNome;
            if (initialsEl) {
                const initials = nome.split(' ').map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase();
                initialsEl.textContent = initials;
            }

            // Avatar com foto se disponível (auth retorna foto/avatar; legado retorna avatar_url)
            const avatarSrc = user.avatar_url || user.foto || user.avatar;
            if (avatarEl && avatarSrc) {
                avatarEl.innerHTML = '<img src="' + avatarSrc + '" alt="' + nome + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
            }

            // Atualizar saudação
            const greetingEl = document.getElementById('zc-greeting');
            if (greetingEl) greetingEl.textContent = getGreeting();

            // Dropdown do usuário (saudação/avatar): preencher e-mail/nome e ligar eventos
            const udEmailEl = document.getElementById('zc-ud-email');
            if (udEmailEl && (user.email || user.login)) udEmailEl.textContent = user.email || user.login;
            const udNameEl = document.getElementById('zc-ud-name');
            if (udNameEl) udNameEl.textContent = nome;

            const userArea = document.getElementById('zc-user-area');
            const dropdown = document.getElementById('zc-user-dropdown');
            if (userArea && dropdown && !userArea.dataset.ddWired) {
                userArea.dataset.ddWired = '1';
                userArea.addEventListener('click', function (e) {
                    if (e.target.closest('.zc-ud-item')) return; // não fechar antes de navegar
                    e.stopPropagation();
                    const open = dropdown.classList.toggle('open');
                    dropdown.setAttribute('aria-hidden', open ? 'false' : 'true');
                });
                document.addEventListener('click', function () {
                    dropdown.classList.remove('open');
                    dropdown.setAttribute('aria-hidden', 'true');
                });
                const logoutBtn = document.getElementById('zc-ud-logout');
                if (logoutBtn) logoutBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (window.AluforceAuth && typeof window.AluforceAuth.logout === 'function') window.AluforceAuth.logout();
                    else if (window.AuthUnified && typeof window.AuthUnified.logout === 'function') window.AuthUnified.logout();
                    else window.location.href = '/login.html';
                });
            }

            // Atualizar logo da empresa por empresa_id (apenas na instância
            // Aluforce multi-empresa). Em instâncias de marca (Labor), a logo já
            // vem fixada por window.__BRAND_LOGO__ e NÃO deve ser sobrescrita.
            const logoEl = document.getElementById('zc-empresa-logo');
            if (logoEl && !window.__BRAND_LOGO__ && user.empresa_id) {
                const logoMap = {
                    1: '/images/Logo Monocromatico - Branco - Aluforce.png',
                    2: '/images/labor-eletric-logo.png',
                    3: '/images/labor-energy-logo-branco.png',
                };
                const src = logoMap[user.empresa_id];
                if (src) {
                    logoEl.src = src;
                    logoEl.onerror = function () {
                        // Sem logo da marca: degrada para texto, nunca volta à Aluforce.
                        this.onerror = null;
                        var s = document.createElement('span');
                        s.textContent = this.alt || '';
                        s.style.cssText = 'color:#fff;font-weight:600;font-size:14px;white-space:nowrap;';
                        this.replaceWith(s);
                    };
                }
            }
        };

        tryUpdate();
        // Tentativas progressivas caso auth-unified.js ainda não finalizou
        setTimeout(tryUpdate, 300);
        setTimeout(tryUpdate, 800);
    }

    // ── 10. MARCAR MÓDULO ATIVO COM BASE NA URL ───────────────────
    function detectModuloAtivo() {
        const moduloAtivo = getModuloAtivo();
        if (moduloAtivo) return moduloAtivo;

        const path = window.location.pathname.toLowerCase();
        for (let i = 0; i < MODULOS.length; i++) {
            const m = MODULOS[i];
            if (path.includes('/' + m.slug + '/') || path.includes('/' + m.slug + '.html')) {
                return m.slug;
            }
        }
        if (path === '/' || path.includes('/dashboard')) return 'dashboard';
        return '';
    }

    // ── 11. INICIALIZAÇÃO ─────────────────────────────────────────
    function init() {
        injectCSS();

        // Definir modulo ativo via auto-detecção se não definido
        if (!document.body.getAttribute('data-modulo-ativo')) {
            const detected = detectModuloAtivo();
            if (detected) document.body.setAttribute('data-modulo-ativo', detected);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectLayout);
        } else {
            injectLayout();
        }
    }

    init();

    // ── 12. API PÚBLICA ───────────────────────────────────────────
    window.ZyntraLayout = {
        /** Re-renderizar o layout (útil após troca de empresa) */
        refresh: function () { injectLayout(); },
        /** Atualizar apenas os dados do usuário no header */
        refreshUser: function () { refreshUserData(); },
        /** Fechar sidebar mobile */
        closeSidebar: function () {
            const sidebar = document.getElementById('zc-sidebar');
            const overlay  = document.getElementById('zc-sidebar-overlay');
            if (sidebar) sidebar.classList.remove('open');
            if (overlay) overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    };

})();
