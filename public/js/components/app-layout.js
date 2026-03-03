/**
 * ============================================================
 * ALUFORCE DESIGN SYSTEM — App Layout Component
 * Componente global de layout: Sidebar + Header + Auth Guard
 * Padrão extraído do módulo Vendas (gold standard)
 * v1.0 — Vanilla JS, zero dependências de framework
 * ============================================================
 *
 * USO: Adicionar no <head> de qualquer módulo:
 *   <link rel="stylesheet" href="/css/global-layout.css">
 *   <script src="/js/auth-unified.js" defer></script>
 *   <script src="/js/components/app-layout.js" defer></script>
 *
 * HTML:
 *   <body class="alf-body alf-auth-loading" data-module="vendas" data-page="kanban">
 *     <main id="alf-page-content">
 *       <!-- conteúdo da página aqui -->
 *     </main>
 *   </body>
 */

(function AluforceLayout() {
    'use strict';

    // =========================================================================
    // 1. MODULE NAVIGATION CONFIGURATION
    // =========================================================================
    const MODULE_CONFIG = {
        vendas: {
            label: 'Vendas',
            basePath: '/Vendas/',
            color: 'vendas',
            items: [
                { icon: 'fas fa-columns',       title: 'Kanban',                page: 'index.html',          key: 'kanban' },
                { icon: 'fas fa-clipboard-list', title: 'Pedidos',              page: 'pedidos.html',        key: 'pedidos' },
                { icon: 'fas fa-users',          title: 'Clientes',             page: 'clientes.html',       key: 'clientes' },
                { icon: 'fas fa-crosshairs',     title: 'Prospecções & Leads',  page: 'prospeccao.html',     key: 'prospeccao' },
                { icon: 'fas fa-boxes-stacked',  title: 'Estoque',              page: 'estoque.html',        key: 'estoque' },
                { icon: 'fas fa-chart-pie',      title: 'Meu Dashboard',        page: 'dashboard.html',      key: 'dashboard' },
                { icon: 'fas fa-chart-line',     title: 'Gestão de Vendas',     page: 'dashboard-admin.html',key: 'dashboard-admin', adminOnly: true },
                { icon: 'fas fa-chart-bar',      title: 'Relatórios',           page: 'relatorios.html',     key: 'relatorios' },
                { icon: 'fas fa-percentage',     title: 'Comissões',            page: 'comissoes.html',      key: 'comissoes' },
            ],
            bottomItems: [
                { icon: 'fas fa-cog', title: 'Configurar Etapas', action: 'abrirModalEtapas', key: 'config' }
            ]
        },

        financeiro: {
            label: 'Financeiro',
            basePath: '/Financeiro/',
            color: 'financeiro',
            items: [
                { icon: 'fas fa-chart-line',          title: 'Dashboard',         page: 'index.html',            key: 'dashboard' },
                { icon: 'fas fa-file-invoice-dollar',  title: 'Contas a Pagar',   page: 'contas_pagar.html',     key: 'contas-pagar' },
                { icon: 'fas fa-hand-holding-usd',     title: 'Contas a Receber', page: 'contas_receber.html',   key: 'contas-receber' },
                { icon: 'fas fa-university',           title: 'Contas Bancárias', page: 'contas_bancarias.html', key: 'contas-bancarias' },
                { icon: 'fas fa-money-bill-wave',      title: 'Fluxo de Caixa',   page: 'fluxo_caixa.html',     key: 'fluxo-caixa' },
                { icon: 'fas fa-chart-bar',            title: 'Relatórios',       page: 'relatorios.html',       key: 'relatorios' },
            ],
            bottomItems: []
        },

        pcp: {
            label: 'PCP',
            basePath: '/PCP/',
            color: 'pcp',
            items: [
                { icon: 'fas fa-chart-line',    title: 'Dashboard',          page: 'index.html',         key: 'dashboard' },
                { icon: 'fas fa-industry',      title: 'Ordens de Produção', page: 'index.html#producao',key: 'producao' },
                { icon: 'fas fa-cogs',          title: 'Planejamento',       page: 'index.html#plano',   key: 'planejamento' },
                { icon: 'fas fa-boxes-stacked', title: 'Estoque PCP',        page: 'index.html#estoque', key: 'estoque' },
                { icon: 'fas fa-chart-bar',     title: 'Relatórios',         page: 'index.html#relatorio',key: 'relatorios' },
            ],
            bottomItems: []
        },

        compras: {
            label: 'Compras',
            basePath: '/Compras/',
            color: 'compras',
            items: [
                { icon: 'fas fa-chart-line',          title: 'Dashboard',            page: 'index.html',                key: 'dashboard' },
                { icon: 'fas fa-shopping-cart',        title: 'Pedidos de Compra',    page: 'index.html#pedidos',        key: 'pedidos' },
                { icon: 'fas fa-truck',                title: 'Fornecedores',         page: 'index.html#fornecedores',   key: 'fornecedores' },
                { icon: 'fas fa-file-invoice',         title: 'Cotações',             page: 'index.html#cotacoes',       key: 'cotacoes' },
                { icon: 'fas fa-boxes-stacked',        title: 'Recebimento',          page: 'index.html#recebimento',    key: 'recebimento' },
                { icon: 'fas fa-chart-bar',            title: 'Relatórios',           page: 'index.html#relatorios',     key: 'relatorios' },
            ],
            bottomItems: []
        },

        nfe: {
            label: 'NFe & Logística',
            basePath: '/NFe/',
            color: 'nfe',
            items: [
                { icon: 'fas fa-chart-line',    title: 'Dashboard',     page: 'index.html',            key: 'dashboard' },
                { icon: 'fas fa-file-invoice',  title: 'Emitir NF-e',   page: 'index.html#emitir',     key: 'emitir' },
                { icon: 'fas fa-search',        title: 'Consultar',     page: 'index.html#consultar',  key: 'consultar' },
                { icon: 'fas fa-truck',         title: 'Logística',     page: 'index.html#logistica',  key: 'logistica' },
                { icon: 'fas fa-chart-bar',     title: 'Relatórios',    page: 'index.html#relatorios', key: 'relatorios' },
            ],
            bottomItems: []
        },

        rh: {
            label: 'RH',
            basePath: '/RH/',
            color: 'rh',
            items: [
                { icon: 'fas fa-chart-pie',         title: 'Dashboard RH',     page: 'areaadm.html',             key: 'areaadm' },
                { icon: 'fas fa-users',              title: 'Funcionários',     page: 'admin-funcionarios.html',  key: 'admin-funcionarios' },
                { icon: 'fas fa-user',               title: 'Dados Pessoais',   page: 'dados-pessoais.html',     key: 'dados-pessoais' },
                { icon: 'fas fa-file-invoice-dollar', title: 'Holerites',       page: 'holerites.html',          key: 'holerites' },
                { icon: 'fas fa-clock',              title: 'Ponto',            page: 'admin-ponto.html',        key: 'admin-ponto', adminOnly: true },
                { icon: 'fas fa-clipboard-list',     title: 'Solicitações',     page: 'solicitacoes.html',       key: 'solicitacoes' },
                { icon: 'fas fa-money-bill-wave',    title: 'Folha Pagamento',  page: 'admin-folha-pagamento.html', key: 'folha-pagamento', adminOnly: true },
                { icon: 'fas fa-gift',               title: 'Benefícios',       page: 'admin-beneficios.html',   key: 'beneficios', adminOnly: true },
            ],
            bottomItems: []
        },

        admin: {
            label: 'Admin',
            basePath: '/admin/',
            color: 'vendas',
            items: [
                { icon: 'fas fa-cog',           title: 'Configurações',  page: 'index.html',           key: 'config' },
                { icon: 'fas fa-users-cog',     title: 'Usuários',       page: 'index.html#usuarios',  key: 'usuarios' },
                { icon: 'fas fa-shield-alt',    title: 'Permissões',     page: 'index.html#permissoes',key: 'permissoes' },
                { icon: 'fas fa-database',      title: 'Backup',         page: 'index.html#backup',    key: 'backup' },
                { icon: 'fas fa-chart-bar',     title: 'Auditoria',      page: 'index.html#auditoria', key: 'auditoria' },
            ],
            bottomItems: []
        }
    };

    // =========================================================================
    // 2. GLOBAL MODULES MENU (for sidebar home icon hover)
    // =========================================================================
    const GLOBAL_MODULES = [
        { icon: 'fas fa-home',          label: 'Painel Principal',  path: '/dashboard',     module: 'dashboard' },
        { icon: 'fas fa-shopping-bag',  label: 'Vendas',            path: '/Vendas/',       module: 'vendas' },
        { icon: 'fas fa-dollar-sign',   label: 'Financeiro',        path: '/Financeiro/',   module: 'financeiro' },
        { icon: 'fas fa-industry',      label: 'PCP',               path: '/PCP/',          module: 'pcp' },
        { icon: 'fas fa-shopping-cart',  label: 'Compras',          path: '/Compras/',      module: 'compras' },
        { icon: 'fas fa-file-invoice',  label: 'NFe & Logística',   path: '/NFe/',          module: 'nfe' },
        { icon: 'fas fa-users',         label: 'RH',                path: '/RecursosHumanos', module: 'rh' },
    ];

    // =========================================================================
    // 3. STATE
    // =========================================================================
    let currentUser = null;
    let currentModule = null;
    let currentPage = null;
    let isAdmin = false;
    let mobileMenuOpen = false;

    // =========================================================================
    // 4. HELPER FUNCTIONS
    // =========================================================================

    function getGreeting() {
        const hour = new Date().getHours();
        if (hour < 12) return 'Bom dia';
        if (hour < 18) return 'Boa tarde';
        return 'Boa noite';
    }

    function getInitial(name) {
        if (!name) return 'U';
        return name.charAt(0).toUpperCase();
    }

    function getFirstName(fullName) {
        if (!fullName) return 'Usuário';
        return fullName.split(' ')[0];
    }

    function checkIsAdmin(user) {
        if (!user) return false;
        const role = (user.role || user.perfil || '').toLowerCase();
        if (role === 'admin' || role === 'administrador' || role === 'super_admin') return true;
        if (user.is_admin === true || user.is_admin === 1) return true;
        return false;
    }

    // =========================================================================
    // 5. RENDER SIDEBAR
    // =========================================================================
    function renderSidebar(config) {
        const aside = document.createElement('aside');
        aside.className = 'alf-sidebar';
        aside.setAttribute('data-module-color', config.color);
        aside.id = 'alf-sidebar';

        // Home / Dashboard link
        const logo = document.createElement('a');
        logo.className = 'alf-sidebar-logo';
        logo.href = '/dashboard';
        logo.title = 'Voltar ao Painel';
        logo.innerHTML = '<i class="fas fa-home"></i>';
        aside.appendChild(logo);

        // Nav items
        const nav = document.createElement('nav');
        nav.className = 'alf-sidebar-nav';

        config.items.forEach(item => {
            // Skip admin-only items for non-admin users
            if (item.adminOnly && !isAdmin) return;

            const btn = document.createElement('a');
            btn.className = 'alf-sidebar-btn';
            if (item.key === currentPage) btn.classList.add('active');
            btn.setAttribute('data-tooltip', item.title);
            btn.href = config.basePath + item.page;

            btn.innerHTML = `<i class="${item.icon}"></i><span class="alf-nav-label">${item.title}</span>`;
            nav.appendChild(btn);
        });

        aside.appendChild(nav);

        // Bottom items (settings etc.)
        if (config.bottomItems && config.bottomItems.length > 0) {
            const bottom = document.createElement('div');
            bottom.className = 'alf-sidebar-bottom';

            config.bottomItems.forEach(item => {
                const btn = document.createElement('button');
                btn.className = 'alf-sidebar-btn';
                btn.setAttribute('data-tooltip', item.title);
                btn.type = 'button';
                btn.innerHTML = `<i class="${item.icon}"></i><span class="alf-nav-label">${item.title}</span>`;

                if (item.action && typeof window[item.action] === 'function') {
                    btn.addEventListener('click', () => window[item.action]());
                } else if (item.action) {
                    // Defer — the function might not be defined yet
                    btn.addEventListener('click', () => {
                        if (typeof window[item.action] === 'function') {
                            window[item.action]();
                        }
                    });
                }

                bottom.appendChild(btn);
            });

            aside.appendChild(bottom);
        }

        return aside;
    }

    // =========================================================================
    // 6. RENDER HEADER
    // =========================================================================
    function renderHeader(config) {
        const header = document.createElement('header');
        header.className = 'alf-header';
        header.id = 'alf-header';

        const userName = currentUser ? getFirstName(currentUser.nome || currentUser.name) : 'Usuário';
        const userInitial = getInitial(userName);
        const greeting = getGreeting();

        header.innerHTML = `
            <div class="alf-header-left">
                <button class="alf-mobile-menu-btn" id="alf-mobile-menu" type="button" aria-label="Menu">
                    <i class="fas fa-bars"></i>
                </button>
                <div class="alf-header-brand">
                    <img src="/images/Logo Monocromatico - Branco - Aluforce.png" alt="ALUFORCE">
                    <span class="alf-separator">|</span>
                    <span class="alf-module-name">${config.label}</span>
                </div>
            </div>
            <div class="alf-header-right">
                <div class="alf-notification-container" id="alf-notification-container">
                    <button class="alf-header-btn" id="alf-notification-btn" type="button" title="Notificações">
                        <i class="fas fa-bell"></i>
                        <span class="alf-notification-badge hidden" id="alf-notification-count">0</span>
                    </button>
                    <div class="alf-notification-panel" id="alf-notification-panel">
                        <div class="alf-notification-header">
                            <h3><i class="fas fa-bell"></i> Notificações</h3>
                            <div class="alf-notification-actions">
                                <button title="Marcar todas como lidas" id="alf-mark-all-read"><i class="fas fa-check-double"></i></button>
                                <button title="Limpar todas" id="alf-clear-notifications"><i class="fas fa-trash-alt"></i></button>
                            </div>
                        </div>
                        <div class="alf-notification-tabs">
                            <button class="alf-notif-tab active" data-filter="todas">Todas</button>
                            <button class="alf-notif-tab" data-filter="nao-lidas">Não lidas</button>
                            <button class="alf-notif-tab" data-filter="importantes">Importantes</button>
                        </div>
                        <div class="alf-notification-list" id="alf-notification-list">
                            <div style="padding: 24px; text-align: center; color: #999; font-size: 13px;">
                                <i class="fas fa-bell-slash" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>
                                Nenhuma notificação
                            </div>
                        </div>
                        <div class="alf-notification-footer">
                            <a href="#" id="alf-view-all-notifications">Ver histórico completo</a>
                        </div>
                    </div>
                </div>
                <div class="alf-user-greeting" style="position: relative;">
                    <span><span id="alf-greeting-text">${greeting}</span>, <strong id="alf-user-name">${userName}</strong></span>
                    <div class="alf-user-avatar" id="alf-user-avatar" title="Menu do Usuário">
                        <img src="" alt="Foto" id="alf-user-photo">
                        <span id="alf-user-initial">${userInitial}</span>
                    </div>
                    <div class="alf-user-dropdown" id="alf-user-dropdown">
                        <div class="alf-user-dropdown-header">
                            <div class="name" id="alf-dropdown-name">${userName}</div>
                            <div class="email" id="alf-dropdown-email">${currentUser?.email || ''}</div>
                        </div>
                        <a href="/RH/dados-pessoais.html" class="alf-user-dropdown-item">
                            <i class="fas fa-user"></i> Meu Perfil
                        </a>
                        <a href="/dashboard" class="alf-user-dropdown-item">
                            <i class="fas fa-th-large"></i> Painel Principal
                        </a>
                        <button class="alf-user-dropdown-item danger" id="alf-logout-btn" type="button">
                            <i class="fas fa-sign-out-alt"></i> Sair
                        </button>
                    </div>
                </div>
            </div>
        `;

        return header;
    }

    // =========================================================================
    // 7. BIND EVENTS
    // =========================================================================
    function bindEvents() {
        // Mobile menu toggle
        const mobileBtn = document.getElementById('alf-mobile-menu');
        const sidebar = document.getElementById('alf-sidebar');
        const overlay = document.getElementById('alf-sidebar-overlay');

        if (mobileBtn && sidebar) {
            mobileBtn.addEventListener('click', () => {
                mobileMenuOpen = !mobileMenuOpen;
                sidebar.classList.toggle('mobile-open', mobileMenuOpen);
                if (overlay) overlay.classList.toggle('active', mobileMenuOpen);
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                mobileMenuOpen = false;
                sidebar?.classList.remove('mobile-open');
                overlay.classList.remove('active');
            });
        }

        // Notification toggle
        const notifBtn = document.getElementById('alf-notification-btn');
        const notifPanel = document.getElementById('alf-notification-panel');
        if (notifBtn && notifPanel) {
            notifBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                notifPanel.classList.toggle('active');
            });
        }

        // Notification tab filtering
        document.querySelectorAll('.alf-notif-tab').forEach(tab => {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.alf-notif-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                // Emit event for module to handle filtering
                window.dispatchEvent(new CustomEvent('alf:notificationFilter', { 
                    detail: { filter: this.dataset.filter } 
                }));
            });
        });

        // User avatar / dropdown toggle
        const avatar = document.getElementById('alf-user-avatar');
        const dropdown = document.getElementById('alf-user-dropdown');
        if (avatar && dropdown) {
            avatar.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('active');
            });
        }

        // Close dropdowns on outside click
        document.addEventListener('click', () => {
            notifPanel?.classList.remove('active');
            dropdown?.classList.remove('active');
        });

        // Logout
        const logoutBtn = document.getElementById('alf-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                if (window.AluforceAuth && typeof window.AluforceAuth.logout === 'function') {
                    window.AluforceAuth.logout();
                } else {
                    // Fallback: clear storage and redirect
                    localStorage.clear();
                    sessionStorage.clear();
                    document.cookie.split(";").forEach(c => {
                        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
                    });
                    window.location.href = '/login.html';
                }
            });
        }

        // Mark all notifications read
        const markAllRead = document.getElementById('alf-mark-all-read');
        if (markAllRead) {
            markAllRead.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('alf:markAllNotificationsRead'));
            });
        }

        // Clear notifications
        const clearNotifs = document.getElementById('alf-clear-notifications');
        if (clearNotifs) {
            clearNotifs.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('alf:clearAllNotifications'));
            });
        }
    }

    // =========================================================================
    // 8. POPULATE USER DATA (after auth resolves)
    // =========================================================================
    function populateUserData(user) {
        if (!user) return;

        currentUser = user;
        isAdmin = checkIsAdmin(user);

        const firstName = getFirstName(user.nome || user.name);
        const initial = getInitial(firstName);

        // Update header elements
        const nameEl = document.getElementById('alf-user-name');
        if (nameEl) nameEl.textContent = firstName;

        const initialEl = document.getElementById('alf-user-initial');
        if (initialEl) initialEl.textContent = initial;

        const greetingEl = document.getElementById('alf-greeting-text');
        if (greetingEl) greetingEl.textContent = getGreeting();

        const dropdownName = document.getElementById('alf-dropdown-name');
        if (dropdownName) dropdownName.textContent = user.nome || user.name || firstName;

        const dropdownEmail = document.getElementById('alf-dropdown-email');
        if (dropdownEmail) dropdownEmail.textContent = user.email || '';

        // Load user photo
        if (user.foto || user.avatar) {
            const photoEl = document.getElementById('alf-user-photo');
            if (photoEl) {
                photoEl.src = user.foto || user.avatar;
                photoEl.onload = () => photoEl.classList.add('visible');
                photoEl.onerror = () => photoEl.classList.remove('visible');
            }
        } else if (user.email) {
            // Try to load from API
            fetch(`/api/usuarios/foto/${encodeURIComponent(user.email)}`)
                .then(r => r.json())
                .then(data => {
                    if (data.success && data.foto) {
                        const photoEl = document.getElementById('alf-user-photo');
                        if (photoEl) {
                            photoEl.src = data.foto;
                            photoEl.onload = () => photoEl.classList.add('visible');
                        }
                    }
                })
                .catch(() => {}); // Silent fail
        }

        // Backward-compatible: Also populate legacy IDs (for modules not yet fully migrated)
        const legacyIds = ['user-name', 'userName', 'greeting-text', 'user-initial', 'user-photo'];
        const legacyValues = { 'user-name': firstName, 'userName': firstName, 'greeting-text': getGreeting(), 'user-initial': initial };
        legacyIds.forEach(id => {
            const el = document.getElementById(id);
            if (el && legacyValues[id]) el.textContent = legacyValues[id];
        });

        // Re-render sidebar to show/hide admin items
        rebuildSidebarIfNeeded();

        // Dispatch event for modules to react
        window.dispatchEvent(new CustomEvent('alf:userReady', { detail: { user, isAdmin } }));
    }

    function rebuildSidebarIfNeeded() {
        // Only rebuild if admin status changed and there are admin-only items
        const config = MODULE_CONFIG[currentModule];
        if (!config) return;

        const hasAdminItems = config.items.some(i => i.adminOnly);
        if (!hasAdminItems) return;

        const oldSidebar = document.getElementById('alf-sidebar');
        if (oldSidebar) {
            const newSidebar = renderSidebar(config);
            oldSidebar.replaceWith(newSidebar);
        }
    }

    // =========================================================================
    // 9. INIT — Main Entry Point (with migration support for existing layouts)
    // =========================================================================
    function initLayout() {
        const body = document.body;
        currentModule = body.dataset.module || detectModuleFromUrl();
        currentPage = body.dataset.page || detectPageFromUrl();

        const config = MODULE_CONFIG[currentModule];
        if (!config) {
            console.warn('[ALF-LAYOUT] Módulo não reconhecido:', currentModule);
            return;
        }

        // Check if layout was already injected (avoid double-init)
        if (document.getElementById('alf-sidebar')) {
            console.log('[ALF-LAYOUT] Layout já inicializado, pulando...');
            return;
        }

        // Ensure body classes
        body.classList.add('alf-body');

        // =====================================================================
        // MIGRATION: Remove existing old sidebar/header from the HTML
        // This allows modules to keep their old HTML temporarily while the
        // global layout takes over. The old inline CSS is harmless (dead code).
        // =====================================================================
        const oldSidebars = body.querySelectorAll(
            'aside.sidebar, .nfe-sidebar, .sidebar-container, nav.sidebar'
        );
        oldSidebars.forEach(el => {
            console.log('[ALF-LAYOUT] 🔄 Migrando: removendo sidebar antigo:', el.className);
            el.remove();
        });

        const oldHeaders = body.querySelectorAll(
            '.app-container > .main-area > header.header, ' +
            '.container-principal > header.header, ' +
            'header.header:not(.alf-header), ' +
            '.nfe-header, ' +
            '.topbar:not(.alf-header)'
        );
        oldHeaders.forEach(el => {
            console.log('[ALF-LAYOUT] 🔄 Migrando: removendo header antigo:', el.className);
            el.remove();
        });

        // Find content — look for known content containers
        let pageContent = document.getElementById('alf-page-content')
            || body.querySelector('.content-area')
            || body.querySelector('.main-content')
            || body.querySelector('main.main-area')
            || body.querySelector('.app-container > .main-area')
            || body.querySelector('.container-principal > main')
            || body.querySelector('.container-principal .main-content');

        // Remove old layout wrappers (.app-container, .container-principal)
        const oldWrappers = body.querySelectorAll('.app-container, .container-principal');
        oldWrappers.forEach(wrapper => {
            // Extract content from wrapper before removing
            if (!pageContent) {
                pageContent = wrapper.querySelector('.main-area') || wrapper.querySelector('.main-content');
            }
            // Move children out of wrapper
            if (pageContent && wrapper.contains(pageContent)) {
                wrapper.replaceWith(pageContent);
            } else {
                // Move all non-script children out
                const children = Array.from(wrapper.children);
                const frag = document.createDocumentFragment();
                children.forEach(child => {
                    if (child.tagName !== 'SCRIPT') frag.appendChild(child);
                });
                wrapper.replaceWith(frag);
            }
        });

        // Re-query pageContent after wrapper removal
        if (!pageContent || !body.contains(pageContent)) {
            pageContent = document.getElementById('alf-page-content')
                || body.querySelector('.content-area')
                || body.querySelector('.main-content')
                || body.querySelector('main');
        }

        // Create wrapper structure
        const layout = document.createElement('div');
        layout.className = 'alf-layout';

        // 1. Sidebar
        loadUserForHeader();
        const sidebar = renderSidebar(config);

        // 2. Main area (header + content)
        const mainArea = document.createElement('div');
        mainArea.className = 'alf-main';

        const header = renderHeader(config);
        mainArea.appendChild(header);

        // Content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'alf-content';
        contentWrapper.id = 'alf-content-area';

        // Move existing page content into the wrapper
        if (pageContent) {
            contentWrapper.appendChild(pageContent);
            pageContent.style.display = '';
        } else {
            // Fallback: move all remaining body children (except scripts and our layout)
            const children = Array.from(body.children);
            children.forEach(child => {
                if (child !== layout && child.tagName !== 'SCRIPT' && child.tagName !== 'LINK' 
                    && !child.classList.contains('alf-layout') && !child.classList.contains('alf-sidebar-overlay')) {
                    contentWrapper.appendChild(child);
                }
            });
        }

        mainArea.appendChild(contentWrapper);

        // 3. Mobile overlay
        const overlay = document.createElement('div');
        overlay.className = 'alf-sidebar-overlay';
        overlay.id = 'alf-sidebar-overlay';

        // Assemble
        layout.appendChild(sidebar);
        layout.appendChild(mainArea);

        // Insert into body (before scripts)
        body.insertBefore(overlay, body.firstChild);
        body.insertBefore(layout, body.firstChild);

        // Bind events
        bindEvents();

        // Remove auth-loading state
        body.classList.remove('alf-auth-loading');

        console.log(`[ALF-LAYOUT] ✅ Layout global inicializado — Módulo: ${config.label}, Página: ${currentPage}`);
    }

    // =========================================================================
    // 10. AUTO-DETECT MODULE & PAGE FROM URL
    // =========================================================================
    function detectModuleFromUrl() {
        const path = window.location.pathname.toLowerCase();
        if (path.includes('/vendas')) return 'vendas';
        if (path.includes('/financeiro')) return 'financeiro';
        if (path.includes('/pcp')) return 'pcp';
        if (path.includes('/compras')) return 'compras';
        if (path.includes('/nfe') || path.includes('/e-nf-e')) return 'nfe';
        if (path.includes('/rh') || path.includes('/recursoshumanos')) return 'rh';
        if (path.includes('/admin')) return 'admin';
        return 'vendas'; // Default
    }

    function detectPageFromUrl() {
        const path = window.location.pathname;
        const filename = path.split('/').pop();
        if (!filename || filename === '' || filename === '/') return 'dashboard';
        return filename.replace('.html', '');
    }

    // =========================================================================
    // 11. AUTH INTEGRATION
    // =========================================================================
    function loadUserForHeader() {
        // Try to get user data synchronously first (from sessionStorage)
        try {
            const tabUserData = sessionStorage.getItem('tabUserData');
            if (tabUserData) {
                const user = JSON.parse(tabUserData);
                if (user && user.id) {
                    currentUser = user;
                    isAdmin = checkIsAdmin(user);
                    return;
                }
            }

            const localUserData = localStorage.getItem('userData');
            if (localUserData) {
                const user = JSON.parse(localUserData);
                if (user && user.id) {
                    currentUser = user;
                    isAdmin = checkIsAdmin(user);
                    return;
                }
            }
        } catch (e) { /* ignore */ }
    }

    // Listen for auth events to update header
    window.addEventListener('authSuccess', (e) => {
        if (e.detail && e.detail.user) {
            populateUserData(e.detail.user);
        }
    });

    // Also listen for our own event
    window.addEventListener('alf:userReady', () => {
        // Sidebar might need updating for admin items
    });

    // =========================================================================
    // 12. PUBLIC API
    // =========================================================================
    window.AluforceLayout = {
        // Re-init (useful for SPA-like navigation)
        init: initLayout,

        // Get module config
        getModuleConfig: (mod) => MODULE_CONFIG[mod || currentModule],

        // Get current state
        getCurrentModule: () => currentModule,
        getCurrentPage: () => currentPage,
        isUserAdmin: () => isAdmin,

        // Update notification count
        setNotificationCount: (count) => {
            const badge = document.getElementById('alf-notification-count');
            if (badge) {
                badge.textContent = count;
                badge.classList.toggle('hidden', count <= 0);
            }
        },

        // Set active page programmatically
        setActivePage: (pageKey) => {
            currentPage = pageKey;
            document.querySelectorAll('.alf-sidebar-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            const activeBtn = document.querySelector(`.alf-sidebar-btn[data-tooltip]`);
            // Find by key match
            const config = MODULE_CONFIG[currentModule];
            if (config) {
                const item = config.items.find(i => i.key === pageKey);
                if (item) {
                    document.querySelectorAll('.alf-sidebar-btn').forEach(btn => {
                        if (btn.getAttribute('data-tooltip') === item.title) {
                            btn.classList.add('active');
                        }
                    });
                }
            }
        },

        // Add notification to panel
        addNotification: (notif) => {
            const list = document.getElementById('alf-notification-list');
            if (!list) return;

            // Remove "no notifications" placeholder
            const placeholder = list.querySelector('[style*="text-align: center"]');
            if (placeholder) placeholder.remove();

            const item = document.createElement('div');
            item.className = `alf-notification-item ${notif.unread ? 'unread' : ''} ${notif.important ? 'important' : ''}`;
            item.innerHTML = `
                <div class="alf-notification-icon ${notif.type || 'info'}">
                    <i class="${notif.icon || 'fas fa-bell'}"></i>
                </div>
                <div class="alf-notification-content">
                    <div class="alf-notification-title">${notif.title}</div>
                    <div class="alf-notification-message">${notif.message}</div>
                    <div class="alf-notification-time">${notif.time || 'Agora'}</div>
                </div>
            `;
            list.insertBefore(item, list.firstChild);
        },

        // Update user info dynamically
        updateUser: populateUserData,

        // Module configs (for external use)
        MODULE_CONFIG,
        GLOBAL_MODULES
    };

    // =========================================================================
    // 13. AUTO-INITIALIZE
    // =========================================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLayout);
    } else {
        // Already loaded — run immediately
        initLayout();
    }

})();
