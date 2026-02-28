/**
 * NFe Layout System — Sidebar + Header + Tabs
 * =============================================
 * Single Source of Truth para o layout do módulo NFe.
 * 
 * USO: Inclua em qualquer página NFe:
 *   <link rel="stylesheet" href="nfe-layout.css">
 *   <script src="nfe-layout.js"></script>
 * 
 * O script detecta automaticamente a página ativa e renderiza
 * a sidebar, header e tabs-bar no container correto.
 * 
 * Requisitos:
 * - O <body> deve conter um elemento: <div id="nfe-layout-root"></div>
 *   OU o script pode ser chamado manualmente: NFeLayout.init({ page: 'emitir' })
 * - Font Awesome deve estar carregado
 */

(function () {
    'use strict';

    // ── Configuração de Navegação ───────────────────
    const NAV_ITEMS = [
        { id: 'dashboard', href: 'index.html',       icon: 'fas fa-chart-pie',      label: 'Dashboard' },
        { id: 'emitir',    href: 'emitir.html',      icon: 'fas fa-file-invoice',   label: 'Emitir NFe' },
        { id: 'consultar', href: 'consultar.html',   icon: 'fas fa-search',         label: 'Consultar NFe' },
        { id: 'nfse',      href: 'nfse.html',        icon: 'fas fa-file-contract',  label: 'NFSe - Serviços' },
        { id: 'danfe',     href: 'danfe.html',       icon: 'fas fa-print',          label: 'Gerar DANFE' },
        { id: 'relatorios',href: 'relatorios.html',  icon: 'fas fa-chart-bar',      label: 'Relatórios' },
        { id: 'eventos',   href: 'eventos.html',     icon: 'fas fa-history',        label: 'Eventos' },
        { id: 'logistica', href: 'logistica.html',   icon: 'fas fa-truck',          label: 'Logística' },
        { id: 'inutilizacao', href: 'inutilizacao.html', icon: 'fas fa-ban',        label: 'Inutilização' },
        { id: 'pix',       href: '/modules/Faturamento/public/pix.html', icon: 'fas fa-qrcode', label: 'Gateway PIX' },
        { id: 'regua',     href: '/modules/Faturamento/public/regua.html', icon: 'fas fa-bell', label: 'Régua de Cobrança' },
    ];

    const TAB_ITEMS = [
        { id: 'dashboard', href: 'index.html',     icon: 'fas fa-chart-pie',      label: 'Dashboard' },
        { id: 'emitir',    href: 'emitir.html',    icon: 'fas fa-file-invoice',   label: 'Emitir NFe' },
        { id: 'consultar', href: 'consultar.html', icon: 'fas fa-search',         label: 'Consultar' },
    ];

    // ── Detectar página atual ───────────────────────
    function detectCurrentPage() {
        const path = window.location.pathname.toLowerCase();
        const filename = path.split('/').pop() || 'index.html';
        
        for (const item of NAV_ITEMS) {
            if (filename === item.href || filename === item.id) {
                return item.id;
            }
        }
        // Fallback: index
        if (filename === '' || filename === '/' || filename.includes('index')) {
            return 'dashboard';
        }
        return 'dashboard';
    }

    // ── Gerar HTML da Sidebar ───────────────────────
    function renderSidebar(activePage) {
        const navLinks = NAV_ITEMS.map(item => {
            const isActive = item.id === activePage ? ' active' : '';
            return `<a href="${item.href}" class="nfe-sidebar-btn${isActive}" data-tooltip="${item.label}" role="menuitem" tabindex="0">
                <i class="${item.icon}"></i>
            </a>`;
        }).join('\n                ');

        return `
        <!-- Skip to content (Acessibilidade WCAG 2.1) -->
        <a href="#nfe-main-content" class="nfe-skip-link">Pular para o conteúdo</a>
        
        <!-- Overlay Mobile -->
        <div class="nfe-sidebar-overlay" id="nfe-sidebar-overlay"></div>
        
        <!-- Sidebar NFe -->
        <aside class="nfe-sidebar" id="nfe-sidebar" role="navigation" aria-label="Navegação principal NFe">
            <a href="/dashboard" class="nfe-sidebar-logo" data-tooltip="Voltar ao Painel" aria-label="Voltar ao Painel Principal">
                <i class="fas fa-file-invoice"></i>
            </a>
            
            <nav class="nfe-sidebar-nav" role="menubar" aria-label="Menu NFe">
                ${navLinks}
            </nav>

            <div class="nfe-sidebar-bottom">
                <a href="/dashboard" class="nfe-sidebar-btn" data-tooltip="Voltar ao Painel" role="menuitem" tabindex="0">
                    <i class="fas fa-home"></i>
                </a>
            </div>
        </aside>`;
    }

    // ── Gerar HTML do Header ────────────────────────
    function renderHeader() {
        return `
            <!-- Header NFe -->
            <header class="nfe-header" role="banner">
                <div class="nfe-header-left">
                    <button class="nfe-mobile-menu-btn" id="nfe-mobile-menu-btn" aria-label="Abrir menu" aria-expanded="false">
                        <i class="fas fa-bars"></i>
                    </button>
                    <div class="nfe-header-brand">
                        <img src="/images/Logo Monocromatico - Branco - Aluforce.png" alt="ALUFORCE" loading="lazy">
                        <span>|</span>
                        <span>Faturamento</span>
                    </div>
                </div>
                <div class="nfe-header-right">
                    <button class="nfe-header-btn" data-tooltip="Atualizar" aria-label="Atualizar página" id="nfe-btn-refresh">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button class="nfe-header-btn" data-tooltip="Notificações" aria-label="Ver notificações" id="nfe-btn-notifications">
                        <i class="fas fa-bell"></i>
                    </button>
                    <button class="nfe-header-btn" data-tooltip="Configurações" aria-label="Abrir configurações" id="nfe-btn-settings">
                        <i class="fas fa-cog"></i>
                    </button>
                    <div class="nfe-user-greeting">
                        <span><span id="greeting-text">Bom dia</span>, <strong id="user-name">Usuário</strong></span>
                        <div class="nfe-user-avatar user-avatar" id="user-avatar" role="button" aria-label="Menu do usuário" tabindex="0">
                            <img id="user-photo" src="" alt="Foto do usuário" style="display: none;">
                            <span id="user-initial">U</span>
                        </div>
                    </div>
                </div>
            </header>`;
    }

    // ── Gerar HTML dos Tabs ─────────────────────────
    function renderTabs(activePage) {
        const tabs = TAB_ITEMS.map(item => {
            const isActive = item.id === activePage ? ' active' : '';
            return `<a href="${item.href}" class="nfe-tab${isActive}" role="tab" aria-selected="${item.id === activePage}">
                    <i class="${item.icon}"></i>
                    ${item.label}
                </a>`;
        }).join('\n                ');

        return `
            <!-- Tabs Bar -->
            <nav class="nfe-tabs-bar" role="tablist" aria-label="Abas de navegação">
                ${tabs}
            </nav>`;
    }

    // ── Saudação automática por hora ────────────────
    function getGreeting() {
        const hour = new Date().getHours();
        if (hour < 12) return 'Bom dia';
        if (hour < 18) return 'Boa tarde';
        return 'Boa noite';
    }

    // ── Inicializar User Info (estratégia Vendas/Compras) ──
    function initUserInfo() {
        // 1. Saudação imediata
        var hour = new Date().getHours();
        var greeting = 'Bom dia';
        if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
        else if (hour >= 18 || hour < 5) greeting = 'Boa noite';

        var greetingEl = document.getElementById('greeting-text');
        if (greetingEl) greetingEl.textContent = greeting;

        // 2. Tentar localStorage primeiro (instantâneo)
        try {
            var raw = localStorage.getItem('userData');
            if (raw) {
                var cached = JSON.parse(raw);
                if (cached && (cached.nome || cached.name)) {
                    _popularHeaderComUsuario(cached);
                }
            }
        } catch (e) { /* ignore */ }

        // 3. Fetch /api/me (mesma abordagem do Vendas) — fonte definitiva
        fetch('/api/me', { credentials: 'include' })
            .then(function (response) {
                if (response.ok) return response.json();
                return null;
            })
            .then(function (user) {
                if (user) _popularHeaderComUsuario(user);
            })
            .catch(function (err) {
                console.log('[NFeLayout] Erro ao carregar usuário:', err);
            });

        // 4. Escutar evento authSuccess como backup
        window.addEventListener('authSuccess', function (e) {
            if (e.detail && e.detail.user) _popularHeaderComUsuario(e.detail.user);
        });
    }

    // ── Popular header com dados do usuário (idêntico ao Vendas) ──
    function _popularHeaderComUsuario(user) {
        if (!user) return;

        // Nome — prioriza apelido, depois primeiro nome
        var userName = user.apelido || user.nome || user.name || 'Usuário';
        var primeiroNome = user.apelido || (user.nome ? user.nome.split(' ')[0] : (user.name ? user.name.split(' ')[0] : 'Usuário'));

        // Avatar — prioridade: avatar > foto > foto_perfil_url
        var userAvatar = user.avatar || user.foto || user.foto_perfil_url || user.foto_url || '';
        if (userAvatar === '/avatars/default.webp') userAvatar = '';

        // Atualizar saudação
        var greetingEl = document.getElementById('greeting-text');
        if (greetingEl) {
            var hour = new Date().getHours();
            var greeting = 'Bom dia';
            if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
            else if (hour >= 18 || hour < 5) greeting = 'Boa noite';
            greetingEl.textContent = greeting;
        }

        // Atualizar nome
        var userNameEl = document.getElementById('user-name');
        if (userNameEl) userNameEl.textContent = primeiroNome;

        // Atualizar foto e iniciais
        var userPhotoEl = document.getElementById('user-photo');
        var userInitialEl = document.getElementById('user-initial');

        if (userAvatar && userPhotoEl) {
            userPhotoEl.src = userAvatar;
            userPhotoEl.onload = function () {
                userPhotoEl.classList.add('visible');
                userPhotoEl.style.display = 'block';
                if (userInitialEl) userInitialEl.style.display = 'none';
            };
            userPhotoEl.onerror = function () {
                userPhotoEl.style.display = 'none';
                if (userInitialEl) {
                    userInitialEl.textContent = userName.charAt(0).toUpperCase();
                    userInitialEl.style.display = 'flex';
                }
            };
        } else if (userInitialEl) {
            userInitialEl.textContent = userName.charAt(0).toUpperCase();
            userInitialEl.style.display = 'flex';
            if (userPhotoEl) userPhotoEl.style.display = 'none';
        }

        console.log('[NFeLayout] Usuário carregado:', primeiroNome, '| Foto:', userAvatar ? 'Sim' : 'Não');
    }

    // ── Inicializar Event Listeners ─────────────────
    function initEventListeners() {
        // Mobile menu toggle
        const menuBtn = document.getElementById('nfe-mobile-menu-btn');
        const sidebar = document.getElementById('nfe-sidebar');
        const overlay = document.getElementById('nfe-sidebar-overlay');

        if (menuBtn && sidebar) {
            menuBtn.addEventListener('click', function () {
                const isOpen = sidebar.classList.toggle('open');
                menuBtn.setAttribute('aria-expanded', isOpen);
                if (overlay) overlay.classList.toggle('show', isOpen);
            });
        }

        if (overlay && sidebar) {
            overlay.addEventListener('click', function () {
                sidebar.classList.remove('open');
                overlay.classList.remove('show');
                if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
            });
        }

        // Header buttons
        const refreshBtn = document.getElementById('nfe-btn-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                location.reload();
            });
        }

        const settingsBtn = document.getElementById('nfe-btn-settings');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', function () {
                if (typeof abrirModalConfiguracoes === 'function') {
                    abrirModalConfiguracoes();
                }
            });
        }

        // Keyboard navigation — ESC fecha sidebar mobile
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('show');
                if (menuBtn) {
                    menuBtn.setAttribute('aria-expanded', 'false');
                    menuBtn.focus();
                }
            }
        });
    }

    // ── API Pública ─────────────────────────────────
    window.NFeLayout = {
        /**
         * Inicializa o layout NFe
         * @param {Object} opts
         * @param {string} opts.page - ID da página ativa (auto-detectado se omitido)
         * @param {boolean} opts.tabs - Mostrar tabs bar (default: true)
         * @param {string} opts.containerId - ID do container onde injetar (default: 'nfe-layout-root')
         * @param {string} opts.contentId - ID do elemento de conteúdo existente a mover para dentro do layout
         */
        init: function (opts) {
            opts = opts || {};
            const activePage = opts.page || detectCurrentPage();
            const showTabs = opts.tabs !== false;
            const containerId = opts.containerId || 'nfe-layout-root';

            // Se já inicializado, skip
            if (document.getElementById('nfe-sidebar')) {
                console.log('[NFeLayout] Já inicializado, pulando.');
                return;
            }

            const root = document.getElementById(containerId);
            
            if (root) {
                // Modo 1: Container root definido — injeta tudo dentro
                const sidebarHTML = renderSidebar(activePage);
                const headerHTML = renderHeader();
                const tabsHTML = showTabs ? renderTabs(activePage) : '';

                // Captura o conteúdo existente dentro do root
                const existingContent = root.innerHTML;

                root.className = 'nfe-app-container';
                root.innerHTML = `
                    ${sidebarHTML}
                    <main class="nfe-main-area" id="nfe-main-content" role="main">
                        ${headerHTML}
                        ${tabsHTML}
                        <div class="nfe-content-area">
                            ${existingContent}
                        </div>
                    </main>`;
            } else {
                // Modo 2: Sem container root — procura .app-container existente
                // e substitui sidebar/header inline por componentes padronizados
                this._upgradeExistingLayout(activePage, showTabs);
            }

            // Inicializar comportamentos
            initUserInfo();
            initEventListeners();

            console.log(`[NFeLayout] Inicializado — página: ${activePage}`);
        },

        /**
         * Modo upgrade: substitui sidebar/header existentes
         */
        _upgradeExistingLayout: function (activePage, showTabs) {
            // Procurar container existente
            const appContainer = document.querySelector('.app-container') || document.querySelector('.nfe-app-container');
            if (!appContainer) {
                console.warn('[NFeLayout] Nenhum container encontrado. Use <div id="nfe-layout-root"> ou .app-container');
                return;
            }

            // Renomear classe para o novo padrão
            appContainer.className = 'nfe-app-container';

            // Remover sidebar antiga
            const oldSidebar = appContainer.querySelector('aside.sidebar, .nfe-sidebar');
            if (oldSidebar) oldSidebar.remove();

            // Remover overlay antigo
            const oldOverlay = appContainer.querySelector('.sidebar-overlay-mobile');
            if (oldOverlay) oldOverlay.remove();

            // Encontrar ou criar main area
            let mainArea = appContainer.querySelector('main.main-area, main, .main-area');
            if (!mainArea) {
                // Criar main area e mover conteúdo restante
                mainArea = document.createElement('main');
                while (appContainer.firstChild) {
                    mainArea.appendChild(appContainer.firstChild);
                }
                appContainer.appendChild(mainArea);
            }
            mainArea.className = 'nfe-main-area';
            mainArea.id = 'nfe-main-content';
            mainArea.setAttribute('role', 'main');

            // Remover header antigo
            const oldHeader = mainArea.querySelector('header.header, .nfe-header');
            if (oldHeader) oldHeader.remove();

            // Remover tabs bar antiga
            const oldTabs = mainArea.querySelector('.tabs-bar, .nfe-tabs-bar');
            if (oldTabs) oldTabs.remove();

            // Encontrar conteúdo existente
            let contentArea = mainArea.querySelector('.content-area, .dashboard-content, .nfe-content-area');
            
            // Injetar sidebar no app-container (antes do main)
            appContainer.insertAdjacentHTML('afterbegin', renderSidebar(activePage));

            // Injetar header no main (antes de tudo)
            mainArea.insertAdjacentHTML('afterbegin', (showTabs ? renderTabs(activePage) : ''));
            mainArea.insertAdjacentHTML('afterbegin', renderHeader());

            // Adicionar classe de conteúdo se não existir
            if (contentArea && !contentArea.classList.contains('nfe-content-area')) {
                contentArea.classList.add('nfe-content-area');
            }
        },

        /** Retorna lista de itens de navegação */
        getNavItems: function () { return NAV_ITEMS.slice(); },
        
        /** Retorna a página detectada */
        getCurrentPage: function () { return detectCurrentPage(); },

        /** Abre sidebar mobile programaticamente */
        openSidebar: function () {
            const sidebar = document.getElementById('nfe-sidebar');
            const overlay = document.getElementById('nfe-sidebar-overlay');
            if (sidebar) sidebar.classList.add('open');
            if (overlay) overlay.classList.add('show');
        },

        /** Fecha sidebar mobile programaticamente */
        closeSidebar: function () {
            const sidebar = document.getElementById('nfe-sidebar');
            const overlay = document.getElementById('nfe-sidebar-overlay');
            if (sidebar) sidebar.classList.remove('open');
            if (overlay) overlay.classList.remove('show');
        }
    };

    // ── Auto-init se existir o root container ───────
    document.addEventListener('DOMContentLoaded', function () {
        if (document.getElementById('nfe-layout-root') || document.querySelector('[data-nfe-layout]')) {
            NFeLayout.init();
        }
    });

})();
