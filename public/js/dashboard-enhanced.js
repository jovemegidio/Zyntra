/**
 * ALUFORCE - Dashboard Enhanced
 * Versão: 2026-01-18
 * Gestão de KPIs, Alertas e Métricas do Dashboard
 */

(function() {
    'use strict';

    const DashboardEnhanced = {
        // Cache de dados
        cache: {
            kpis: null,
            alerts: null,
            lastUpdate: null
        },
        
        // Configurações
        config: {
            refreshInterval: 60000, // 1 minuto
            animationDelay: 100,
            // Emails de administradores que podem ver KPIs, alertas e contadores
            adminEmails: [
                'ti@aluforce.ind.br',
                'andreia@aluforce.ind.br',
                'fernando@aluforce.ind.br',
                'douglas@aluforce.ind.br'
            ],
            // Cargos/funções que podem ver KPIs, alertas e contadores
            allowedRoles: ['admin', 'administrador', 'consultoria', 'consultor', 'diretoria', 'gerente']
        },

        /**
         * Verifica se o usuário logado é administrador ou consultoria
         */
        isAdminUser() {
            try {
                // Buscar dados do usuário do localStorage
                const userData = localStorage.getItem('userData');
                if (!userData) return false;
                
                const user = JSON.parse(userData);
                const userEmail = (user.email || '').toLowerCase().trim();
                const userRole = (user.role || user.cargo || user.funcao || '').toLowerCase().trim();
                
                // Verificar se é admin por flag - VERIFICAÇÃO MAIS RESTRITIVA
                const isAdminFlag = user.is_admin === 1 || 
                                   user.is_admin === true || 
                                   user.is_admin === '1';
                
                // Verificar se está na lista de emails de admin
                const isAdminEmail = this.config.adminEmails.includes(userEmail);
                
                // Verificar se o cargo/role é explicitamente admin ou consultoria
                const isAdminRole = userRole === 'admin' || 
                                   userRole === 'administrador' ||
                                   userRole === 'consultoria' ||
                                   userRole === 'consultor';
                
                console.log('[Dashboard] Verificação acesso:', { 
                    email: userEmail, 
                    role: userRole,
                    isAdminFlag, 
                    isAdminEmail, 
                    isAdminRole
                });
                
                // Retornar true APENAS se for explicitamente admin ou consultoria
                return isAdminFlag || isAdminEmail || isAdminRole;
            } catch (e) {
                console.error('[Dashboard] Erro ao verificar admin:', e);
                return false;
            }
        },

        /**
         * Inicializa o dashboard
         */
        init() {
            console.log('🚀 Dashboard Enhanced: Inicializando...');
            
            // Aguardar DOM carregar
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.setup());
            } else {
                this.setup();
            }
        },

        /**
         * Configura o dashboard
         */
        async setup() {
            // Verificar se estamos na página do dashboard
            const dashboardArea = document.getElementById('dashboard-area');
            if (!dashboardArea) return;

            // Criar estrutura do dashboard aprimorado
            await this.createEnhancedStructure();
            
            // Carregar dados
            await this.loadDashboardData();
            
            // Configurar atualização automática
            this.setupAutoRefresh();
            
            // Configurar interações
            this.setupInteractions();
            
            console.log('✅ Dashboard Enhanced: Pronto!');
        },

        /**
         * Cria a estrutura HTML do dashboard aprimorado
         */
        async createEnhancedStructure() {
            const mainDashboard = document.querySelector('.main-dashboard');
            if (!mainDashboard) return;

            const greetingSection = mainDashboard.querySelector('.greeting-section-premium');
            const modulesContainer = mainDashboard.querySelector('.modules-container');

            if (!greetingSection || !modulesContainer) return;

            // Verificar se usuário é admin para mostrar KPIs e alertas
            const isAdmin = this.isAdminUser();
            console.log('[Dashboard] Usuário é admin?', isAdmin);

            if (isAdmin) {
                // Criar seção de KPIs (grid 4x1) - APENAS PARA ADMINS
                const kpisSection = document.createElement('div');
                kpisSection.className = 'dashboard-kpis';
                kpisSection.id = 'dashboard-kpis';
                kpisSection.innerHTML = this.getKPIsHTML();

                // ALERTAS REMOVIDOS - Não criar seção de alertas

                // Inserir KPIs após o greeting e antes dos módulos
                greetingSection.insertAdjacentElement('afterend', kpisSection);

                // Adicionar badges de status aos cards de módulos - APENAS PARA ADMINS
                this.addModuleStatusBadges();
            } else {
                console.log('[Dashboard] Usuário não é admin - KPIs, alertas e contadores ocultos');
            }
        },

        /**
         * Retorna HTML dos KPIs
         */
        getKPIsHTML() {
            return `
                <div class="kpi-card kpi-vendas" data-kpi="vendas" title="Clique para ver detalhes de vendas">
                    <div class="kpi-header">
                        <div class="kpi-icon">
                            <i class="fas fa-chart-line"></i>
                        </div>
                    </div>
                    <div class="kpi-content">
                        <div class="kpi-label">VENDAS DO MÊS</div>
                        <div class="kpi-value">
                            <span id="kpi-vendas-valor">R$ 0,00</span>
                            <span class="kpi-trend up" id="kpi-vendas-trend" style="display:none;">
                                <i class="fas fa-arrow-up"></i>
                                <span></span>
                            </span>
                        </div>
                    </div>
                </div>

                <div class="kpi-card kpi-compras" data-kpi="compras" title="Clique para ver pedidos em aberto">
                    <div class="kpi-header">
                        <div class="kpi-icon">
                            <i class="fas fa-shopping-cart"></i>
                        </div>
                    </div>
                    <div class="kpi-content">
                        <div class="kpi-label">PEDIDOS EM ABERTO</div>
                        <div class="kpi-value">
                            <span id="kpi-pedidos-valor">0</span>
                        </div>
                    </div>
                </div>

                <div class="kpi-card kpi-financeiro" data-kpi="financeiro" title="Clique para ver contas a receber">
                    <div class="kpi-header">
                        <div class="kpi-icon">
                            <i class="fas fa-wallet"></i>
                        </div>
                    </div>
                    <div class="kpi-content">
                        <div class="kpi-label">A RECEBER HOJE</div>
                        <div class="kpi-value">
                            <span id="kpi-receber-valor">R$ 0,00</span>
                        </div>
                    </div>
                </div>

                <div class="kpi-card kpi-producao" data-kpi="producao" title="Clique para ver ordens de produção">
                    <div class="kpi-header">
                        <div class="kpi-icon">
                            <i class="fas fa-industry"></i>
                        </div>
                    </div>
                    <div class="kpi-content">
                        <div class="kpi-label">ORDENS ATIVAS</div>
                        <div class="kpi-value">
                            <span id="kpi-ordens-valor">0</span>
                        </div>
                    </div>
                </div>
            `;
        },

        /**
         * Retorna HTML dos Alertas
         */
        getAlertsHTML() {
            return `
                <div class="alert-item alert-warning" data-alert="vencidos" title="Ver contas vencidas">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Contas Vencidas</span>
                    <span class="alert-count" id="alert-vencidos">0</span>
                </div>

                <div class="alert-item alert-info" data-alert="vencer" title="Ver contas a vencer">
                    <i class="fas fa-clock"></i>
                    <span>Vencendo Hoje</span>
                    <span class="alert-count" id="alert-vencer">0</span>
                </div>

                <div class="alert-item alert-danger" data-alert="estoque" title="Ver alertas de estoque">
                    <i class="fas fa-box-open"></i>
                    <span>Estoque Crítico</span>
                    <span class="alert-count" id="alert-estoque">0</span>
                </div>

                <div class="alert-item alert-success" data-alert="aprovados" title="Ver pedidos aprovados">
                    <i class="fas fa-check-circle"></i>
                    <span>Aprovados Hoje</span>
                    <span class="alert-count" id="alert-aprovados">0</span>
                </div>
            `;
        },

        /**
         * Adiciona badges de status aos módulos
         */
        addModuleStatusBadges() {
            const moduleCards = document.querySelectorAll('.module-card');
            
            moduleCards.forEach(card => {
                const area = card.dataset.area;
                if (!area) return;

                // Adicionar status badge
                const statusBadge = document.createElement('div');
                statusBadge.className = 'module-status';
                statusBadge.innerHTML = `
                    <span class="module-status-dot"></span>
                    <span>Online</span>
                `;
                card.appendChild(statusBadge);

                // Adicionar contador baseado no módulo
                const counter = document.createElement('div');
                counter.className = 'module-counter';
                counter.id = `module-counter-${area}`;
                counter.style.display = 'none';
                card.appendChild(counter);
            });
        },

        /**
         * Carrega dados do dashboard
         */
        async loadDashboardData() {
            // Não carregar dados se não for admin
            if (!this.isAdminUser()) {
                console.log('[Dashboard] Usuário não é admin - dados não serão carregados');
                return;
            }

            try {
                // Carregar KPIs em paralelo
                const [kpisData, alertsData] = await Promise.allSettled([
                    this.fetchKPIs(),
                    this.fetchAlerts()
                ]);

                if (kpisData.status === 'fulfilled') {
                    this.updateKPIs(kpisData.value);
                }

                if (alertsData.status === 'fulfilled') {
                    this.updateAlerts(alertsData.value);
                }

                // Atualizar contadores dos módulos
                await this.updateModuleCounters();

                this.cache.lastUpdate = new Date();

            } catch (error) {
                console.warn('Dashboard: Erro ao carregar dados', error);
                this.showFallbackData();
            }
        },

        /**
         * Busca KPIs do servidor
         */
        async fetchKPIs() {
            try {
                // Tentar buscar dados reais
                const response = await fetch('/api/dashboard/kpis', {
                    credentials: 'include'
                });
                
                if (response.ok) {
                    return await response.json();
                }
            } catch (e) {
                console.log('Dashboard: Usando dados simulados para KPIs');
            }

            // Dados simulados para demonstração
            return {
                vendas: {
                    valor: 'R$ 127.450',
                    trend: '+12%',
                    trendUp: true,
                    chart: [40, 55, 30, 65, 50, 75, 60]
                },
                pedidosAbertos: 8,
                aReceber: 'R$ 45.320',
                ordensAtivas: 12
            };
        },

        /**
         * Busca alertas do servidor
         */
        async fetchAlerts() {
            try {
                const response = await fetch('/api/dashboard/alerts', {
                    credentials: 'include'
                });
                
                if (response.ok) {
                    return await response.json();
                }
            } catch (e) {
                console.log('Dashboard: Usando dados simulados para alertas');
            }

            // Dados simulados
            return {
                vencidos: 3,
                vencerHoje: 5,
                estoqueCritico: 2,
                aprovadosHoje: 7
            };
        },

        /**
         * Atualiza KPIs no DOM
         */
        updateKPIs(data) {
            // Vendas
            const vendasValor = document.getElementById('kpi-vendas-valor');
            if (vendasValor && data.vendas) {
                this.animateValue(vendasValor, data.vendas.valor);
                
                // Trend
                const vendaTrend = document.getElementById('kpi-vendas-trend');
                if (vendaTrend && data.vendas.trend) {
                    vendaTrend.style.display = 'inline-flex';
                    vendaTrend.className = `kpi-trend ${data.vendas.trendUp ? 'up' : 'down'}`;
                    vendaTrend.querySelector('i').className = `fas fa-arrow-${data.vendas.trendUp ? 'up' : 'down'}`;
                    vendaTrend.querySelector('span').textContent = data.vendas.trend;
                }

                // Mini chart
                if (data.vendas.chart) {
                    this.renderMiniChart('chart-vendas', data.vendas.chart);
                }
            }

            // Pedidos
            const pedidosValor = document.getElementById('kpi-pedidos-valor');
            if (pedidosValor && data.pedidosAbertos !== undefined) {
                this.animateValue(pedidosValor, data.pedidosAbertos);
            }

            // A Receber
            const receberValor = document.getElementById('kpi-receber-valor');
            if (receberValor && data.aReceber) {
                this.animateValue(receberValor, data.aReceber);
            }

            // Ordens
            const ordensValor = document.getElementById('kpi-ordens-valor');
            if (ordensValor && data.ordensAtivas !== undefined) {
                this.animateValue(ordensValor, data.ordensAtivas);
            }
        },

        /**
         * Atualiza alertas no DOM
         */
        updateAlerts(data) {
            const elements = {
                'alert-vencidos': data.vencidos || 0,
                'alert-vencer': data.vencerHoje || 0,
                'alert-estoque': data.estoqueCritico || 0,
                'alert-aprovados': data.aprovadosHoje || 0
            };

            Object.entries(elements).forEach(([id, value]) => {
                const el = document.getElementById(id);
                if (el) {
                    el.textContent = value;
                    // Adicionar atributo data-count para estilização CSS
                    const parentAlert = el.closest('.alert-item');
                    if (parentAlert) {
                        parentAlert.setAttribute('data-count', value);
                    }
                }
            });
        },

        /**
         * Atualiza contadores dos módulos com dados reais
         */
        async updateModuleCounters() {
            console.log('[Dashboard] Atualizando contadores dos módulos...');
            try {
                // Buscar dados reais da API
                const response = await fetch('/api/dashboard/modules', {
                    credentials: 'include'
                });
                
                console.log('[Dashboard] Resposta modules:', response.status);
                
                let data = {};
                if (response.ok) {
                    data = await response.json();
                    console.log('[Dashboard] Dados modules:', data);
                }
                
                // Mapear áreas para configuração de exibição
                const moduleConfig = {
                    compras: { icon: 'fa-shopping-cart', label: 'pedidos', key: 'compras' },
                    vendas: { icon: 'fa-chart-line', label: 'orçamentos', key: 'vendas' },
                    nfe: { icon: 'fa-file-invoice', label: 'pendentes', key: 'nfe' },
                    pcp: { icon: 'fa-cogs', label: 'ordens', key: 'pcp' },
                    financeiro: { icon: 'fa-dollar-sign', label: 'lançamentos', key: 'financeiro' },
                    rh: { icon: 'fa-users', label: 'funcionários', key: 'rh' }
                };

                Object.entries(moduleConfig).forEach(([area, config]) => {
                    const counter = document.getElementById(`module-counter-${area}`);
                    if (counter) {
                        const moduleData = data[config.key] || { count: 0, label: config.label };
                        const count = moduleData.count || 0;
                        const label = moduleData.label || config.label;
                        counter.innerHTML = `<i class="fas ${config.icon}"></i> ${count} ${label}`;
                        counter.style.display = 'flex';
                    }
                });
            } catch (error) {
                console.warn('Dashboard: Erro ao carregar contadores dos módulos', error);
            }
        },

        /**
         * Renderiza mini chart
         */
        renderMiniChart(containerId, data) {
            const container = document.getElementById(containerId);
            if (!container || !data.length) return;

            const max = Math.max(...data);
            const bars = data.map(value => {
                const height = Math.round((value / max) * 24);
                return `<div class="mini-chart-bar" style="height: ${height}px"></div>`;
            }).join('');

            container.innerHTML = bars;
        },

        /**
         * Anima transição de valor
         */
        animateValue(element, newValue) {
            element.style.opacity = '0';
            element.style.transform = 'translateY(10px)';
            
            setTimeout(() => {
                element.textContent = newValue;
                element.style.transition = 'all 0.3s ease';
                element.style.opacity = '1';
                element.style.transform = 'translateY(0)';
            }, 100);
        },

        /**
         * Mostra dados fallback quando não há conexão
         */
        showFallbackData() {
            const kpis = document.querySelectorAll('.kpi-value span');
            kpis.forEach(kpi => {
                if (kpi.textContent === '--') {
                    kpi.textContent = '-';
                }
            });
        },

        /**
         * Configura atualização automática
         */
        setupAutoRefresh() {
            setInterval(() => {
                this.loadDashboardData();
            }, this.config.refreshInterval);
        },

        /**
         * Configura interações do dashboard
         */
        setupInteractions() {
            // Clique nos KPIs
            document.querySelectorAll('.kpi-card').forEach(card => {
                card.addEventListener('click', () => {
                    const kpiType = card.dataset.kpi;
                    this.handleKPIClick(kpiType);
                });
            });

            // Clique nos alertas
            document.querySelectorAll('.alert-item').forEach(alert => {
                alert.addEventListener('click', () => {
                    const alertType = alert.dataset.alert;
                    this.handleAlertClick(alertType);
                });
            });

            // Teclado - acessibilidade
            document.querySelectorAll('.kpi-card, .alert-item').forEach(el => {
                el.setAttribute('tabindex', '0');
                el.setAttribute('role', 'button');
                
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        el.click();
                    }
                });
            });
        },

        /**
         * Manipula clique em KPI
         */
        handleKPIClick(type) {
            const routes = {
                'vendas': '/Vendas/index.html',
                'compras': '/modules/Compras/index.html',
                'financeiro': '/modules/Financeiro/index.html',
                'producao': '/modules/PCP/index.html'
            };

            if (routes[type]) {
                window.location.href = routes[type];
            }
        },

        /**
         * Manipula clique em alerta
         */
        handleAlertClick(type) {
            const routes = {
                'vencidos': '/modules/Financeiro/contas-pagar.html?filter=vencidas',
                'vencer': '/modules/Financeiro/contas-pagar.html?filter=hoje',
                'estoque': '/modules/PCP/index.html?view=produtos',
                'aprovados': '/Vendas/pedidos.html?filter=aprovados'
            };

            if (routes[type]) {
                window.location.href = routes[type];
            }
        },

        /**
         * Formata valores monetários
         */
        formatCurrency(value) {
            return new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL'
            }).format(value);
        }
    };

    // Inicializar
    DashboardEnhanced.init();

    // Expor globalmente
    window.DashboardEnhanced = DashboardEnhanced;

})();
