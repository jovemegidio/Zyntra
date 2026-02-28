/**
 * ALUFORCE v2.0 - Layout Manager
 * Carrega e inicializa o layout padrão em todos os módulos
 * 
 * USO:
 * 1. Incluir o CSS: <link rel="stylesheet" href="/modules/_shared/aluforce-layout.css">
 * 2. Incluir o JS: <script src="/modules/_shared/aluforce-layout.js"></script>
 * 3. O layout será carregado automaticamente
 */

(function() {
    'use strict';

    // Configuração do módulo atual
    const AluforceLayout = {
        // Dados do usuário
        user: null,
        
        // Configuração do módulo
        moduleConfig: {
            name: 'Módulo',
            color: '#ff6b35',
            icon: 'fa-cube',
            tabs: []
        },

        // Mapas de cores por módulo
        moduleColors: {
            'compras': { primary: '#38bdf8', icon: 'fa-shopping-cart', name: 'Compras' },
            'vendas': { primary: '#3b82f6', icon: 'fa-handshake', name: 'Vendas' },
            'pcp': { primary: '#ef4444', icon: 'fa-industry', name: 'PCP' },
            'financeiro': { primary: '#10b981', icon: 'fa-dollar-sign', name: 'Financeiro' },
            'rh': { primary: '#8b5cf6', icon: 'fa-users', name: 'RH' },
            'nfe': { primary: '#f59e0b', icon: 'fa-file-invoice', name: 'NF-e' },
            'faturamento': { primary: '#ec4899', icon: 'fa-file-invoice-dollar', name: 'Faturamento' }
        },

        /**
         * Inicializa o layout
         */
        init: function(config = {}) {
            this.moduleConfig = { ...this.moduleConfig, ...config };
            this.detectModule();
            this.loadUserData();
            this.initEventListeners();
            this.updateUI();
            console.log('✅ ALUFORCE Layout inicializado');
        },

        /**
         * Detecta o módulo atual pela URL
         */
        detectModule: function() {
            const path = window.location.pathname.toLowerCase();
            
            for (const [key, value] of Object.entries(this.moduleColors)) {
                if (path.includes(key)) {
                    this.moduleConfig = {
                        ...this.moduleConfig,
                        name: value.name,
                        color: value.primary,
                        icon: value.icon
                    };
                    
                    // Atualizar cor primária do CSS
                    document.documentElement.style.setProperty('--alu-primary', value.primary);
                    break;
                }
            }
        },

        /**
         * Carrega dados do usuário
         */
        loadUserData: function() {
            try {
                const userData = localStorage.getItem('userData');
                if (userData) {
                    this.user = JSON.parse(userData);
                }
            } catch (e) {
                console.warn('Erro ao carregar dados do usuário:', e);
            }
        },

        /**
         * Atualiza a interface com dados do usuário e módulo
         */
        updateUI: function() {
            // Atualizar nome do módulo
            const moduleNameEl = document.getElementById('alu-module-name');
            if (moduleNameEl) {
                moduleNameEl.textContent = this.moduleConfig.name;
            }

            // Atualizar dados do usuário
            if (this.user) {
                const nome = this.user.nome || 'Usuário';
                const primeiroNome = nome.split(/\s+/)[0];
                const role = this.user.role || 'Colaborador';
                const roleDisplay = role === 'admin' ? 'Administrador' : 'Colaborador';
                
                // Nome
                const userNameEl = document.getElementById('alu-user-name');
                if (userNameEl) userNameEl.textContent = primeiroNome;
                
                // Role
                const userRoleEl = document.getElementById('alu-user-role');
                if (userRoleEl) userRoleEl.textContent = roleDisplay;
                
                // Iniciais
                const initialsEl = document.getElementById('alu-user-initials');
                if (initialsEl) {
                    const iniciais = nome.split(/\s+/).map(n => n.charAt(0).toUpperCase()).slice(0, 2).join('');
                    initialsEl.textContent = iniciais || 'U';
                }
                
                // Avatar
                this.loadUserAvatar(primeiroNome);
            }

            // Atualizar tabs se configuradas
            this.updateTabs();
        },

        /**
         * Carrega o avatar do usuário
         */
        loadUserAvatar: function(nome) {
            const avatarImg = document.getElementById('alu-user-avatar-img');
            const initialsEl = document.getElementById('alu-user-initials');
            
            if (!avatarImg || !initialsEl) return;

            // Tentar carregar avatar
            const avatarPath = `/avatars/${nome}.webp`;
            const img = new Image();
            
            img.onload = function() {
                avatarImg.src = avatarPath;
                avatarImg.style.display = 'block';
                initialsEl.style.display = 'none';
            };
            
            img.onerror = function() {
                avatarImg.style.display = 'none';
                initialsEl.style.display = 'flex';
            };
            
            img.src = avatarPath;
        },

        /**
         * Atualiza as tabs do módulo
         */
        updateTabs: function() {
            const tabsContainer = document.getElementById('alu-header-tabs');
            if (!tabsContainer || !this.moduleConfig.tabs.length) return;

            tabsContainer.innerHTML = this.moduleConfig.tabs.map((tab, index) => `
                <button class="alu-tab ${index === 0 ? 'active' : ''}" data-tab="${tab.id}">
                    ${tab.name}
                    ${tab.closable ? '<i class="fas fa-times close-icon"></i>' : ''}
                </button>
            `).join('');
        },

        /**
         * Inicializa event listeners
         */
        initEventListeners: function() {
            // User dropdown toggle
            const userSection = document.getElementById('alu-user-section');
            const userDropdown = document.getElementById('alu-user-dropdown');
            
            if (userSection && userDropdown) {
                userSection.addEventListener('click', (e) => {
                    e.stopPropagation();
                    userDropdown.classList.toggle('show');
                });

                document.addEventListener('click', () => {
                    userDropdown.classList.remove('show');
                });
            }

            // Logout
            const logoutBtn = document.getElementById('alu-logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.logout();
                });
            }

            // Sidebar navigation
            const navBtns = document.querySelectorAll('.alu-nav-btn[data-section]');
            navBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    navBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    const section = btn.getAttribute('data-section');
                    this.navigateToSection(section);
                });
            });

            // Search
            const searchInput = document.getElementById('alu-global-search');
            if (searchInput) {
                searchInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.handleSearch(searchInput.value);
                    }
                });
            }

            // Tab clicks
            document.addEventListener('click', (e) => {
                if (e.target.closest('.alu-tab')) {
                    const tab = e.target.closest('.alu-tab');
                    const tabId = tab.getAttribute('data-tab');
                    
                    // Remove active de todas
                    document.querySelectorAll('.alu-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    
                    this.handleTabChange(tabId);
                }
            });

            // Mobile sidebar toggle
            const menuBtn = document.getElementById('btn-menu-mobile');
            const sidebar = document.getElementById('alu-sidebar');
            if (menuBtn && sidebar) {
                menuBtn.addEventListener('click', () => {
                    sidebar.classList.toggle('mobile-open');
                });
            }
        },

        /**
         * Navega para uma seção
         */
        navigateToSection: function(section) {
            // Emitir evento customizado para o módulo tratar
            const event = new CustomEvent('alu-navigate', { detail: { section } });
            document.dispatchEvent(event);
        },

        /**
         * Trata mudança de tab
         */
        handleTabChange: function(tabId) {
            const event = new CustomEvent('alu-tab-change', { detail: { tabId } });
            document.dispatchEvent(event);
        },

        /**
         * Trata busca global
         */
        handleSearch: function(query) {
            const event = new CustomEvent('alu-search', { detail: { query } });
            document.dispatchEvent(event);
        },

        /**
         * Logout
         */
        logout: function() {
            localStorage.clear();
            sessionStorage.clear();
            
            // Limpar cookies
            document.cookie.split(';').forEach(c => {
                document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
            });
            
            window.location.href = '/login.html';
        },

        /**
         * Adiciona uma tab dinamicamente
         */
        addTab: function(tab) {
            this.moduleConfig.tabs.push(tab);
            this.updateTabs();
        },

        /**
         * Remove uma tab
         */
        removeTab: function(tabId) {
            this.moduleConfig.tabs = this.moduleConfig.tabs.filter(t => t.id !== tabId);
            this.updateTabs();
        },

        /**
         * Atualiza badge de notificação
         */
        updateBadge: function(elementId, count) {
            const badge = document.getElementById(elementId);
            if (badge) {
                if (count > 0) {
                    badge.textContent = count > 99 ? '99+' : count;
                    badge.style.display = 'block';
                } else {
                    badge.style.display = 'none';
                }
            }
        },

        /**
         * Mostra/esconde dot de notificação
         */
        setNotificationDot: function(show) {
            const dot = document.getElementById('notification-dot');
            if (dot) {
                dot.style.display = show ? 'block' : 'none';
            }
        }
    };

    // Expor globalmente
    window.AluforceLayout = AluforceLayout;

    // Auto-inicializar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => AluforceLayout.init());
    } else {
        AluforceLayout.init();
    }

})();
