/**
 * ALUFORCE v2.0 - Auto Layout Injector
 * 
 * Este script injeta automaticamente o layout unificado em qualquer página
 * Basta incluir este script no final do body de qualquer módulo
 * 
 * Uso: <script src="/modules/_shared/aluforce-auto-layout.js" data-module="vendas"></script>
 */

(function() {
    'use strict';
    
    // Detectar módulo atual pelo script tag ou URL
    const scriptTag = document.currentScript;
    const moduleName = scriptTag?.dataset?.module || detectModule();
    
    function detectModule() {
        const path = window.location.pathname.toLowerCase();
        if (path.includes('/compras')) return 'compras';
        if (path.includes('/vendas')) return 'vendas';
        if (path.includes('/pcp')) return 'pcp';
        if (path.includes('/financeiro')) return 'financeiro';
        if (path.includes('/rh')) return 'rh';
        if (path.includes('/nfe') || path.includes('/logistica')) return 'nfe';
        return 'vendas'; // default
    }
    
    // Configurações por módulo
    const moduleConfigs = {
        compras: {
            name: 'Compras',
            icon: 'fa-shopping-cart',
            color: '#38bdf8',
            theme: 'theme-compras.css',
            navItems: [
                { id: 'dashboard', icon: 'fa-th-large', tooltip: 'Dashboard', href: '/compras' },
                { id: 'pedidos', icon: 'fa-file-invoice', tooltip: 'Pedidos', href: '/compras/pedidos.html' },
                { id: 'cotacoes', icon: 'fa-calculator', tooltip: 'Cotações', href: '/compras/cotacoes.html' },
                { id: 'requisicoes', icon: 'fa-clipboard-list', tooltip: 'Requisições', href: '/compras/requisicoes.html' },
                { id: 'fornecedores', icon: 'fa-users', tooltip: 'Fornecedores', href: '/compras/fornecedores.html' },
                { id: 'materiais', icon: 'fa-boxes', tooltip: 'Materiais', href: '/compras/materiais.html' },
                { id: 'relatorios', icon: 'fa-chart-bar', tooltip: 'Relatórios', href: '/compras/relatorios.html' }
            ]
        },
        vendas: {
            name: 'Vendas',
            icon: 'fa-handshake',
            color: '#3b82f6',
            theme: 'theme-vendas.css',
            navItems: [
                { id: 'dashboard', icon: 'fa-th-large', tooltip: 'Dashboard', href: '/vendas' },
                { id: 'pedidos', icon: 'fa-file-invoice', tooltip: 'Pedidos', href: '/vendas/pedidos.html' },
                { id: 'clientes', icon: 'fa-users', tooltip: 'Clientes', href: '/vendas/clientes.html' },
                { id: 'estoque', icon: 'fa-boxes', tooltip: 'Estoque', href: '/vendas/estoque.html' },
                { id: 'relatorios', icon: 'fa-chart-bar', tooltip: 'Relatórios', href: '/vendas/relatorios.html' }
            ]
        },
        pcp: {
            name: 'PCP',
            icon: 'fa-industry',
            color: '#ef4444',
            theme: 'theme-pcp.css',
            navItems: [
                { id: 'dashboard', icon: 'fa-th-large', tooltip: 'Dashboard', href: '/pcp' },
                { id: 'ordens', icon: 'fa-clipboard-list', tooltip: 'Ordens', href: '/pcp/ordens-producao.html' },
                { id: 'produtos', icon: 'fa-boxes', tooltip: 'Produtos', href: '/pcp' },
                { id: 'estoque', icon: 'fa-warehouse', tooltip: 'Estoque', href: '/pcp' }
            ]
        },
        financeiro: {
            name: 'Financeiro',
            icon: 'fa-wallet',
            color: '#10b981',
            theme: 'theme-financeiro.css',
            navItems: [
                { id: 'dashboard', icon: 'fa-th-large', tooltip: 'Dashboard', href: '/financeiro' },
                { id: 'receber', icon: 'fa-arrow-down', tooltip: 'Contas a Receber', href: '/financeiro/contas_receber.html' },
                { id: 'pagar', icon: 'fa-arrow-up', tooltip: 'Contas a Pagar', href: '/financeiro/contas_pagar.html' },
                { id: 'fluxo', icon: 'fa-chart-line', tooltip: 'Fluxo de Caixa', href: '/financeiro/fluxo_caixa.html' },
                { id: 'bancos', icon: 'fa-university', tooltip: 'Contas Bancárias', href: '/financeiro/contas_bancarias.html' },
                { id: 'relatorios', icon: 'fa-chart-bar', tooltip: 'Relatórios', href: '/financeiro/relatorios.html' }
            ]
        },
        rh: {
            name: 'RH',
            icon: 'fa-user-tie',
            color: '#8b5cf6',
            theme: 'theme-rh.css',
            navItems: [
                { id: 'dashboard', icon: 'fa-th-large', tooltip: 'Dashboard', href: '/rh' },
                { id: 'funcionarios', icon: 'fa-users', tooltip: 'Funcionários', href: '/rh' },
                { id: 'solicitacoes', icon: 'fa-clipboard-list', tooltip: 'Solicitações', href: '/rh/solicitacoes.html' },
                { id: 'dados', icon: 'fa-id-card', tooltip: 'Dados Pessoais', href: '/rh/dados-pessoais.html' }
            ]
        },
        nfe: {
            name: 'NF-e',
            icon: 'fa-file-invoice-dollar',
            color: '#f59e0b',
            theme: 'theme-nfe.css',
            navItems: [
                { id: 'dashboard', icon: 'fa-th-large', tooltip: 'Dashboard', href: '/nfe/dashboard.html' },
                { id: 'emitir', icon: 'fa-plus-circle', tooltip: 'Emitir NF-e', href: '/nfe/emitir.html' },
                { id: 'consultar', icon: 'fa-search', tooltip: 'Consultar', href: '/nfe/consultar.html' },
                { id: 'logistica', icon: 'fa-truck', tooltip: 'Logística', href: '/nfe/logistica.html' },
                { id: 'relatorios', icon: 'fa-chart-bar', tooltip: 'Relatórios', href: '/nfe/relatorios.html' }
            ]
        }
    };
    
    const config = moduleConfigs[moduleName] || moduleConfigs.vendas;
    
    // Carregar CSS do layout
    function loadCSS() {
        // Base CSS
        if (!document.querySelector('link[href*="aluforce-layout.css"]')) {
            const baseLink = document.createElement('link');
            baseLink.rel = 'stylesheet';
            baseLink.href = '/modules/_shared/aluforce-layout.css';
            document.head.appendChild(baseLink);
        }
        
        // Theme CSS
        if (!document.querySelector(`link[href*="${config.theme}"]`)) {
            const themeLink = document.createElement('link');
            themeLink.rel = 'stylesheet';
            themeLink.href = `/modules/_shared/themes/${config.theme}`;
            document.head.appendChild(themeLink);
        }
    }
    
    // Gerar HTML do sidebar
    function generateSidebar() {
        const currentPath = window.location.pathname;
        
        const navItemsHTML = config.navItems.map(item => {
            const isActive = currentPath.includes(item.href) || 
                           (item.id === 'dashboard' && (currentPath.endsWith('/') || currentPath.endsWith('/index.html')));
            return `
                <a href="${item.href}" class="alu-nav-btn ${isActive ? 'active' : ''}" data-tooltip="${item.tooltip}">
                    <i class="fas ${item.icon}"></i>
                </a>
            `;
        }).join('');
        
        return `
            <aside class="alu-sidebar" id="alu-sidebar">
                <a href="/dashboard" class="alu-sidebar-logo" title="ALUFORCE - Voltar ao Painel">
                    <i class="fas fa-industry"></i>
                </a>
                
                <nav class="alu-sidebar-nav">
                    ${navItemsHTML}
                </nav>
                
                <div class="alu-sidebar-divider"></div>
                
                <div class="alu-sidebar-bottom">
                    <button class="alu-nav-btn" data-tooltip="Configurações" id="btn-settings">
                        <i class="fas fa-cog"></i>
                    </button>
                    <a href="/dashboard" class="alu-nav-btn" data-tooltip="Painel Principal">
                        <i class="fas fa-home"></i>
                    </a>
                </div>
            </aside>
        `;
    }
    
    // Gerar HTML do header
    function generateHeader() {
        return `
            <header class="alu-header" id="alu-header">
                <div class="alu-header-left">
                    <div class="alu-header-brand">
                        <img src="/modules/Compras/Logo Monocromatico - Azul - Aluforce.webp" 
                             alt="ALUFORCE" 
                             onerror="this.style.display='none'">
                        <span class="alu-header-title">
                            <span id="alu-module-name">${config.name}</span>
                        </span>
                    </div>
                    
                    <div class="alu-header-tabs" id="alu-header-tabs"></div>
                </div>
                
                <div class="alu-header-center">
                    <div class="alu-search-box">
                        <i class="fas fa-search alu-search-icon"></i>
                        <input type="text" 
                               class="alu-search-input" 
                               id="alu-global-search"
                               placeholder="Digite o que deseja pesquisar"
                               autocomplete="off">
                    </div>
                </div>
                
                <div class="alu-header-right">
                    <button class="alu-header-btn" title="Notificações" id="btn-notifications">
                        <i class="fas fa-bell"></i>
                        <span class="notification-dot" id="notification-dot" style="display: none;"></span>
                    </button>
                    
                    <button class="alu-header-btn" title="Apps" id="btn-apps">
                        <i class="fas fa-th"></i>
                    </button>
                    
                    <div class="alu-user-section" id="alu-user-section">
                        <div class="alu-user-info">
                            <span class="alu-user-name" id="alu-user-name">Carregando...</span>
                            <span class="alu-user-role" id="alu-user-role">...</span>
                        </div>
                        <div class="alu-user-avatar" id="alu-user-avatar">
                            <span id="alu-user-initials">?</span>
                            <img src="" alt="" id="alu-user-avatar-img" style="display: none;">
                        </div>
                        
                        <div class="alu-user-dropdown" id="alu-user-dropdown">
                            <a href="/dashboard" class="alu-dropdown-item">
                                <i class="fas fa-home"></i>
                                <span>Painel de Controle</span>
                            </a>
                            <a href="#perfil" class="alu-dropdown-item">
                                <i class="fas fa-user"></i>
                                <span>Meu Perfil</span>
                            </a>
                            <div class="alu-dropdown-divider"></div>
                            <button class="alu-dropdown-item danger" id="alu-logout-btn">
                                <i class="fas fa-sign-out-alt"></i>
                                <span>Sair do Sistema</span>
                            </button>
                        </div>
                    </div>
                </div>
            </header>
        `;
    }
    
    // Injetar layout
    function injectLayout() {
        // Verificar se já foi injetado
        if (document.getElementById('alu-sidebar')) {
            console.log('[ALU-LAYOUT] Layout já injetado');
            return;
        }
        
        // Carregar CSS
        loadCSS();
        
        // Adicionar classe ao body
        document.body.classList.add('alu-layout', `alu-module-${moduleName}`);
        
        // Criar container wrapper se não existir
        let existingContent = document.body.innerHTML;
        
        // Verificar se tem sidebar/header antigo
        const oldSidebar = document.querySelector('.sidebar, #sidebar');
        const oldHeader = document.querySelector('.header:not(.alu-header), #header:not(#alu-header), .main-header');
        
        // Remover elementos antigos se existirem
        if (oldSidebar) {
            console.log('[ALU-LAYOUT] Removendo sidebar antigo');
            oldSidebar.remove();
        }
        if (oldHeader) {
            console.log('[ALU-LAYOUT] Removendo header antigo');
            oldHeader.remove();
        }
        
        // Buscar área de conteúdo principal
        const mainContent = document.querySelector('.main-content, main, .content, #content, .container') 
                          || document.body;
        
        // Criar estrutura do layout
        const layoutWrapper = document.createElement('div');
        layoutWrapper.className = 'alu-app-container';
        layoutWrapper.innerHTML = generateSidebar() + generateHeader();
        
        // Criar área principal
        const mainArea = document.createElement('main');
        mainArea.className = 'alu-main-area';
        mainArea.id = 'alu-main-area';
        
        // Mover conteúdo existente para área principal
        if (mainContent !== document.body) {
            mainArea.appendChild(mainContent.cloneNode(true));
            mainContent.remove();
        } else {
            // Mover todo conteúdo (exceto scripts e links)
            const toMove = [];
            document.body.childNodes.forEach(node => {
                if (node.nodeType === 1 && !['SCRIPT', 'LINK', 'STYLE'].includes(node.tagName)) {
                    toMove.push(node);
                }
            });
            toMove.forEach(node => mainArea.appendChild(node));
        }
        
        layoutWrapper.appendChild(mainArea);
        document.body.insertBefore(layoutWrapper, document.body.firstChild);
        
        // Inicializar eventos
        initEvents();
        
        // Carregar dados do usuário
        loadUserData();
        
        console.log(`[ALU-LAYOUT] Layout do módulo ${config.name} injetado com sucesso`);
    }
    
    // Inicializar eventos
    function initEvents() {
        // Toggle dropdown do usuário
        const userSection = document.getElementById('alu-user-section');
        const userDropdown = document.getElementById('alu-user-dropdown');
        
        if (userSection && userDropdown) {
            userSection.addEventListener('click', (e) => {
                e.stopPropagation();
                userDropdown.classList.toggle('active');
            });
            
            document.addEventListener('click', () => {
                userDropdown.classList.remove('active');
            });
        }
        
        // Logout
        const logoutBtn = document.getElementById('alu-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                document.cookie = 'authToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = '/login.html';
            });
        }
        
        // Pesquisa global
        const searchInput = document.getElementById('alu-global-search');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const term = searchInput.value.trim();
                    if (term && window.pesquisarGlobal) {
                        window.pesquisarGlobal(term);
                    }
                }
            });
        }
    }
    
    // Carregar dados do usuário
    async function loadUserData() {
        try {
            const response = await fetch('/api/me', { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                const user = data.user || data;
                
                // Atualizar nome
                const nameEl = document.getElementById('alu-user-name');
                if (nameEl && user.nome) {
                    const firstName = user.nome.split(' ')[0];
                    nameEl.textContent = firstName;
                }
                
                // Atualizar role
                const roleEl = document.getElementById('alu-user-role');
                if (roleEl) {
                    roleEl.textContent = user.role === 'admin' ? 'Administrador' : (user.cargo || 'Colaborador');
                }
                
                // Atualizar avatar
                updateAvatarDisplay(user.avatar || user.foto || user.foto_perfil_url, user.nome);
            }
        } catch (error) {
            console.error('[ALU-LAYOUT] Erro ao carregar dados do usuário:', error);
        }
    }
    
    // Função para atualizar exibição do avatar
    function updateAvatarDisplay(avatarUrl, nome) {
        const initialsEl = document.getElementById('alu-user-initials');
        const avatarImg = document.getElementById('alu-user-avatar-img');
        
        if (avatarUrl && avatarUrl !== '/avatars/default.webp') {
            if (avatarImg) {
                avatarImg.src = avatarUrl;
                avatarImg.style.display = 'block';
                avatarImg.onerror = () => {
                    avatarImg.style.display = 'none';
                    if (initialsEl) initialsEl.style.display = 'flex';
                };
            }
            if (initialsEl) initialsEl.style.display = 'none';
        } else if (initialsEl && nome) {
            initialsEl.textContent = nome.charAt(0).toUpperCase();
            if (avatarImg) avatarImg.style.display = 'none';
            initialsEl.style.display = 'flex';
        }
    }
    
    // Listener para evento de avatar atualizado
    window.addEventListener('avatar-updated', function(e) {
        if (e.detail && e.detail.avatarUrl) {
            console.log('[ALU-LAYOUT] Avatar atualizado via evento:', e.detail.avatarUrl);
            updateAvatarDisplay(e.detail.avatarUrl, '');
        }
    });
    
    // Executar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectLayout);
    } else {
        // Aguardar um pouco para outros scripts carregarem
        setTimeout(injectLayout, 100);
    }
    
    // Expor função globalmente para uso manual
    window.AluforceLayout = {
        inject: injectLayout,
        loadUserData: loadUserData,
        config: config,
        moduleName: moduleName
    };
    
})();
