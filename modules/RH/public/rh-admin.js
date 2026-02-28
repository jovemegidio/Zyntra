/**
 * Sistema RH Admin - JavaScript Principal
 * Baseado no padrão PCP ALUFORCE
 */

class SistemaRHAdmin {
    constructor() {
        this.apiBaseUrl = '/api/rh';
        this.currentSection = 'dashboard';
        this.sidebarExpanded = false;
        
        console.log('🚀 Inicializando Sistema RH Admin...');
        this.init();
    }

    async init() {
        try {
            await this.setupEventListeners();
            await this.loadInitialData();
            console.log('✅ Sistema RH Admin inicializado com sucesso!');
        } catch (error) {
            console.error('❌ Erro na inicialização:', error);
        }
    }

    setupEventListeners() {
        // Auto-expandir sidebar no desktop
        if (window.innerWidth > 768) {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            
            sidebar.addEventListener('mouseenter', () => {
                sidebar.classList.add('expanded');
                this.sidebarExpanded = true;
            });
            
            sidebar.addEventListener('mouseleave', () => {
                sidebar.classList.remove('expanded');
                this.sidebarExpanded = false;
            });
        }

        // Busca
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
        }

        // Atalhos de teclado
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                searchInput?.focus();
            }
        });
    }

    async loadInitialData() {
        // Carregar dados do dashboard por padráo
        await this.loadDashboardData();
    }

    // Navegaçáo entre seções
    showSection(sectionId, navElement) {
        // Esconder todas as seções
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });

        // Remover active de todos os nav-links
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });

        // Mostrar seçáo selecionada
        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.classList.add('active');
        }
        
        // Adicionar active ao nav-link
        if (navElement) {
            navElement.classList.add('active');
        }

        // Atualizar seçáo atual
        this.currentSection = sectionId;

        // Carregar dados da seçáo
        this.loadSectionData(sectionId);
    }

    async loadSectionData(sectionId) {
        console.log(`📊 Carregando dados da seçáo: ${sectionId}`);
        
        switch(sectionId) {
            case 'dashboard':
                await this.loadDashboardData();
                break;
            case 'funcionarios':
                await this.loadFuncionarios();
                break;
            case 'folha-pagamento':
                await this.loadFolhaPagamento();
                break;
            case 'ponto':
                await this.loadControlePonto();
                break;
            case 'beneficios':
                await this.loadBeneficios();
                break;
            case 'documentos':
                await this.loadDocumentos();
                break;
            case 'relatórios':
                await this.loadRelatorios();
                break;
            case 'configuracoes':
                await this.loadConfiguracoes();
                break;
            default:
                console.warn(`Seçáo ${sectionId} náo implementada`);
        }
    }

    // Dashboard
    async loadDashboardData() {
        try {
            // Tentar carregar dados reais da API
            const stats = await this.fetchStats();
            const funcionariosRecentes = await this.fetchFuncionariosRecentes();
            
            this.updateDashboardStats(stats);
            this.updateFuncionariosRecentes(funcionariosRecentes);
            
        } catch (error) {
            console.log('⚠️ API náo disponível, usando dados mock');
            this.loadMockDashboardData();
        }
    }

    async fetchStats() {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${this.apiBaseUrl}/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('API Stats náo disponível');
        return await response.json();
    }

    async fetchFuncionariosRecentes() {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${this.apiBaseUrl}/funcionarios/recentes`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('API Funcionários náo disponível');
        return await response.json();
    }

    loadMockDashboardData() {
        // Simular carregamento com delay realista
        setTimeout(() => {
            const tbody = document.getElementById('funcionarios-recentes');
            if (tbody) {
                tbody.innerHTML = this.getFuncionariosRecentesHTML();
            }
        }, 800);
    }

    updateDashboardStats(stats) {
        // Atualizar estatísticas reais
        const statValues = document.querySelectorAll('.stat-value');
        if (stats && statValues.length >= 4) {
            statValues[0].textContent = stats.totalFuncionarios || '147';
            statValues[1].textContent = stats.funcionariosAtivos || '142';
            statValues[2].textContent = this.formatCurrency(stats.folhaPagamento) || 'R$ 298.5K';
            statValues[3].textContent = stats.faltasMes || '23';
        }
    }

    updateFuncionariosRecentes(funcionarios) {
        const tbody = document.getElementById('funcionarios-recentes');
        if (tbody && funcionarios) {
            tbody.innerHTML = funcionarios.map(f => this.getFuncionarioRowHTML(f)).join('');
        }
    }

    // Funcionários
    async loadFuncionarios() {
        try {
            const token = localStorage.getItem('authToken');
            const response = await fetch(`${this.apiBaseUrl}/funcionarios`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const funcionarios = await response.json();
                this.updateFuncionariosList(funcionarios);
            } else {
                throw new Error('API náo disponível');
            }
        } catch (error) {
            console.log('⚠️ Carregando dados mock de funcionários');
            this.loadMockFuncionarios();
        }
    }

    loadMockFuncionarios() {
        setTimeout(() => {
            const tbody = document.getElementById('funcionarios-lista');
            if (tbody) {
                tbody.innerHTML = this.getFuncionariosListaHTML();
            }
        }, 600);
    }

    updateFuncionariosList(funcionarios) {
        const tbody = document.getElementById('funcionarios-lista');
        if (tbody && funcionarios) {
            tbody.innerHTML = funcionarios.map(f => this.getFuncionarioCompleteRowHTML(f)).join('');
        }
    }

    // Folha de Pagamento
    async loadFolhaPagamento() {
        console.log('📊 Carregando dados de folha de pagamento...');
        // Implementar quando necessário
    }

    // Controle de Ponto
    async loadControlePonto() {
        console.log('🕐 Carregando dados de controle de ponto...');
        // Implementar quando necessário
    }

    // Benefícios
    async loadBeneficios() {
        console.log('🎁 Carregando dados de benefícios...');
        // Implementar quando necessário
    }

    // Documentos
    async loadDocumentos() {
        console.log('📄 Carregando dados de documentos...');
        // Implementar quando necessário
    }

    // Relatórios
    async loadRelatorios() {
        console.log('📊 Carregando relatórios...');
        // Implementar quando necessário
    }

    // Configurações
    async loadConfiguracoes() {
        console.log('⚙️ Carregando configurações...');
        // Implementar quando necessário
    }

    // Busca
    handleSearch(query) {
        if (query.length < 2) return;
        
        console.log(`🔍 Buscando: ${query}`);
        // Implementar busca global
    }

    // Utilitários
    formatCurrency(value) {
        if (!value) return 'R$ 0,00';
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    }

    formatDate(date) {
        if (!date) return '-';
        return new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).format(new Date(date));
    }

    getStatusBadge(status) {
        const badges = {
            'ativo': 'badge-success',
            'inativo': 'badge-danger',
            'licença': 'badge-warning',
            'férias': 'badge-info'
        };
        
        const badgeClass = badges[status?.toLowerCase()] || 'badge-info';
        return `<span class="badge ${badgeClass}">${status || 'N/A'}</span>`;
    }

    // Templates HTML
    getFuncionariosRecentesHTML() {
        return `
            <tr>
                <td><strong>Joáo Silva</strong><br><small>joao.silva@aluforce.com</small></td>
                <td>Desenvolvedor Full Stack</td>
                <td>Tecnologia</td>
                <td>15/10/2025</td>
                <td>${this.getStatusBadge('ativo')}</td>
                <td>
                    <button class="btn btn-primary" style="padding: 6px 12px; font-size: 11px;" onclick="rhAdmin.viewFuncionario(1)">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
            <tr>
                <td><strong>Maria Santos</strong><br><small>maria.santos@aluforce.com</small></td>
                <td>Analista de RH Senior</td>
                <td>Recursos Humanos</td>
                <td>10/10/2025</td>
                <td>${this.getStatusBadge('ativo')}</td>
                <td>
                    <button class="btn btn-primary" style="padding: 6px 12px; font-size: 11px;" onclick="rhAdmin.viewFuncionario(2)">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
            <tr>
                <td><strong>Pedro Costa</strong><br><small>pedro.costa@aluforce.com</small></td>
                <td>Supervisor de Produçáo</td>
                <td>Produçáo</td>
                <td>08/10/2025</td>
                <td>${this.getStatusBadge('licença')}</td>
                <td>
                    <button class="btn btn-primary" style="padding: 6px 12px; font-size: 11px;" onclick="rhAdmin.viewFuncionario(3)">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
            <tr>
                <td><strong>Ana Oliveira</strong><br><small>ana.oliveira@aluforce.com</small></td>
                <td>Coordenadora Comercial</td>
                <td>Vendas</td>
                <td>05/10/2025</td>
                <td>${this.getStatusBadge('ativo')}</td>
                <td>
                    <button class="btn btn-primary" style="padding: 6px 12px; font-size: 11px;" onclick="rhAdmin.viewFuncionario(4)">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    getFuncionariosListaHTML() {
        return `
            <tr>
                <td>001</td>
                <td><strong>Joáo Silva</strong><br><small>joao.silva@aluforce.com</small></td>
                <td>123.456.789-00</td>
                <td>Desenvolvedor Full Stack</td>
                <td>Tecnologia</td>
                <td>R$ 8.500,00</td>
                <td>${this.getStatusBadge('ativo')}</td>
                <td>
                    <button class="btn btn-primary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;" onclick="rhAdmin.editFuncionario(1)">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="rhAdmin.deleteFuncionario(1)">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
            <tr>
                <td>002</td>
                <td><strong>Maria Santos</strong><br><small>maria.santos@aluforce.com</small></td>
                <td>987.654.321-00</td>
                <td>Analista de RH Senior</td>
                <td>Recursos Humanos</td>
                <td>R$ 6.200,00</td>
                <td>${this.getStatusBadge('ativo')}</td>
                <td>
                    <button class="btn btn-primary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;" onclick="rhAdmin.editFuncionario(2)">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="rhAdmin.deleteFuncionario(2)">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
            <tr>
                <td>003</td>
                <td><strong>Pedro Costa</strong><br><small>pedro.costa@aluforce.com</small></td>
                <td>456.789.123-00</td>
                <td>Supervisor de Produçáo</td>
                <td>Produçáo</td>
                <td>R$ 7.800,00</td>
                <td>${this.getStatusBadge('licença')}</td>
                <td>
                    <button class="btn btn-primary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;" onclick="rhAdmin.editFuncionario(3)">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="rhAdmin.deleteFuncionario(3)">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
            <tr>
                <td>004</td>
                <td><strong>Ana Oliveira</strong><br><small>ana.oliveira@aluforce.com</small></td>
                <td>789.123.456-00</td>
                <td>Coordenadora Comercial</td>
                <td>Vendas</td>
                <td>R$ 9.200,00</td>
                <td>${this.getStatusBadge('ativo')}</td>
                <td>
                    <button class="btn btn-primary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;" onclick="rhAdmin.editFuncionario(4)">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="rhAdmin.deleteFuncionario(4)">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
            <tr>
                <td>005</td>
                <td><strong>Carlos Mendes</strong><br><small>carlos.mendes@aluforce.com</small></td>
                <td>321.654.987-00</td>
                <td>Gerente Financeiro</td>
                <td>Financeiro</td>
                <td>R$ 12.500,00</td>
                <td>${this.getStatusBadge('ativo')}</td>
                <td>
                    <button class="btn btn-primary" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;" onclick="rhAdmin.editFuncionario(5)">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="rhAdmin.deleteFuncionario(5)">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    // Ações de funcionário
    viewFuncionario(id) {
        console.log(`👁️ Visualizando funcionário ID: ${id}`);
        // Implementar modal ou navegaçáo para detalhes
    }

    editFuncionario(id) {
        console.log(`✏️ Editando funcionário ID: ${id}`);
        // Implementar modal de ediçáo
    }

    deleteFuncionario(id) {
        if (confirm('Tem certeza que deseja excluir este funcionário?')) {
            console.log(`🗑️ Excluindo funcionário ID: ${id}`);
            // Implementar exclusáo
        }
    }

    // Toggle da sidebar
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('expanded');
        this.sidebarExpanded = !this.sidebarExpanded;
    }

    // Notificações
    showNotification(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);
        // Implementar sistema de notificações
    }
}

// Funções globais para compatibilidade
function toggleSidebar() {
    window.rhAdmin?.toggleSidebar();
}

function showSection(sectionId, navElement) {
    window.rhAdmin?.showSection(sectionId, navElement);
}

// Inicializaçáo
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Inicializando Sistema RH Admin...');
    window.rhAdmin = new SistemaRHAdmin();
});

// Exportar para uso global
window.SistemaRHAdmin = SistemaRHAdmin;