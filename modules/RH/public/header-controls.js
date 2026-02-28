/* ============================================= */
/* FUNCIONALIDADES DOS BOTÕES DO CABEÇALHO     */
/* ============================================= */

// Classe para gerenciar as funcionalidades do cabeçalho
class HeaderControls {
    constructor() {
        this.currentView = 'grid'; // grid ou list
        this.initializeButtons();
    }

    initializeButtons() {
        this.setupGridButton();
        this.setupListButton();
        this.setupRefreshButton();
        this.setupBackButton();
        
        console.log('✅ Botões do cabeçalho inicializados');
    }

    // Botáo de visualizaçáo em Grid
    setupGridButton() {
        const gridButton = document.querySelector('.header-icon[title="Visualizaçáo em Grid"]');
        if (gridButton) {
            gridButton.addEventListener('click', () => {
                this.switchToGridView();
            });
        }
    }

    // Botáo de visualizaçáo em Lista
    setupListButton() {
        const listButton = document.querySelector('.header-icon[title="Visualizaçáo em Lista"]');
        if (listButton) {
            listButton.addEventListener('click', () => {
                this.switchToListView();
            });
        }
    }

    // Botáo de atualizar
    setupRefreshButton() {
        const refreshButton = document.querySelector('.header-icon[title="Atualizar"]');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                this.refreshCurrentSection();
            });
        }
    }

    // Botáo de voltar
    setupBackButton() {
        const backButton = document.querySelector('.header-icon[title="Voltar"]');
        if (backButton) {
            backButton.addEventListener('click', () => {
                this.goBack();
            });
        }
    }

    // Alternar para visualizaçáo em Grid
    switchToGridView() {
        console.log('🔲 Alternando para visualizaçáo em Grid');
        
        this.currentView = 'grid';
        this.updateViewButtons();
        
        const activeSection = document.querySelector('.content-section.active');
        if (activeSection) {
            // Aplicar classes de grid
            activeSection.classList.remove('list-view');
            activeSection.classList.add('grid-view');
            
            // Atualizar visualizaçáo específica da seçáo
            this.updateSectionView(activeSection, 'grid');
        }
        
        // Náo mostrar notificaçáo automática
        console.log('✅ Modo Grid ativado');
    }

    // Alternar para visualizaçáo em Lista
    switchToListView() {
        console.log('📋 Alternando para visualizaçáo em Lista');
        
        this.currentView = 'list';
        this.updateViewButtons();
        
        const activeSection = document.querySelector('.content-section.active');
        if (activeSection) {
            // Aplicar classes de lista
            activeSection.classList.remove('grid-view');
            activeSection.classList.add('list-view');
            
            // Atualizar visualizaçáo específica da seçáo
            this.updateSectionView(activeSection, 'list');
        }
        
        // Náo mostrar notificaçáo automática
        console.log('✅ Modo Lista ativado');
    }

    // Atualizar estado visual dos botões
    updateViewButtons() {
        const gridButton = document.querySelector('.header-icon[title="Visualizaçáo em Grid"]');
        const listButton = document.querySelector('.header-icon[title="Visualizaçáo em Lista"]');
        
        if (gridButton && listButton) {
            // Remover active de ambos
            gridButton.classList.remove('active');
            listButton.classList.remove('active');
            
            // Adicionar active no botáo atual
            if (this.currentView === 'grid') {
                gridButton.classList.add('active');
            } else {
                listButton.classList.add('active');
            }
        }
    }

    // Atualizar visualizaçáo da seçáo específica
    updateSectionView(section, view) {
        // Identificar tipo de página atual pelos elementos presentes
        const grid = document.querySelector('.items-grid, #funcionarios-grid, .stats-row');
        
        if (grid) {
            this.updateGenericPageView(view);
        }
    }
    
    // Atualizar visualizaçáo genérica para páginas carregadas dinamicamente
    updateGenericPageView(view) {
        const itemsGrids = document.querySelectorAll('.items-grid');
        const statsRows = document.querySelectorAll('.stats-row');
        
        itemsGrids.forEach(grid => {
            if (view === 'grid') {
                grid.style.display = 'grid';
                grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
                grid.style.gap = '20px';
            } else {
                grid.style.display = 'block';
                // Converter cards em lista
                const cards = grid.querySelectorAll('.item-card');
                cards.forEach(card => {
                    if (view === 'list') {
                        card.style.display = 'flex';
                        card.style.width = '100%';
                        card.style.marginBottom = '10px';
                    } else {
                        card.style.display = '';
                        card.style.width = '';
                        card.style.marginBottom = '';
                    }
                });
            }
        });
    }

    // Atualizar visualizaçáo de Funcionários
    updateFuncionariosView(view) {
        const grid = document.getElementById('funcionarios-grid');
        const table = document.getElementById('funcionarios-table');
        
        if (view === 'grid') {
            if (grid) {
                grid.style.display = 'grid';
                grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(300px, 1fr))';
                grid.style.gap = '20px';
            }
            if (table) table.style.display = 'none';
        } else {
            if (grid) grid.style.display = 'none';
            if (table) {
                table.style.display = 'block';
                // Criar tabela se náo existir
                this.createFuncionariosTable();
            }
        }
    }

    // Atualizar visualizaçáo de Holerites
    updateHoleritesView(view) {
        const container = document.querySelector('#holerites-section .holerites-content');
        
        if (container) {
            if (view === 'grid') {
                container.style.display = 'grid';
                container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(250px, 1fr))';
                container.style.gap = '15px';
            } else {
                container.style.display = 'block';
            }
        }
    }

    // Atualizar visualizaçáo de Relatórios
    updateRelatoriosView(view) {
        const container = document.querySelector('#relatórios-section .relatórios-content');
        
        if (container) {
            if (view === 'grid') {
                container.style.display = 'grid';
                container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
                container.style.gap = '20px';
            } else {
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.gap = '10px';
            }
        }
    }

    // Atualizar visualizaçáo do Dashboard
    updateDashboardView(view) {
        const widgets = document.querySelector('.widgets-grid');
        
        if (widgets) {
            if (view === 'grid') {
                widgets.style.display = 'grid';
                widgets.style.gridTemplateColumns = 'repeat(auto-fit, minmax(250px, 1fr))';
                widgets.style.gap = '20px';
            } else {
                widgets.style.display = 'flex';
                widgets.style.flexDirection = 'column';
                widgets.style.gap = '15px';
            }
        }
    }

    // Criar tabela de funcionários
    createFuncionariosTable() {
        const tableContainer = document.getElementById('funcionarios-table');
        if (!tableContainer) return;

        tableContainer.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Foto</th>
                        <th>Nome</th>
                        <th>Cargo</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><img src="Interativo-Aluforce.jpg" alt="Avatar" class="table-avatar"></td>
                        <td>Andreia Silva</td>
                        <td>Gerente RH</td>
                        <td>andreia@empresa.com</td>
                        <td><span class="status-badge active">Ativo</span></td>
                        <td>
                            <button class="btn-sm btn-primary" title="Visualizar">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn-sm btn-warning" title="Editar">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-sm btn-danger" title="Excluir">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                    <tr>
                        <td><img src="Interativo-Aluforce.jpg" alt="Avatar" class="table-avatar"></td>
                        <td>Douglas Santos</td>
                        <td>Desenvolvedor</td>
                        <td>douglas@empresa.com</td>
                        <td><span class="status-badge active">Ativo</span></td>
                        <td>
                            <button class="btn-sm btn-primary" title="Visualizar">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn-sm btn-warning" title="Editar">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-sm btn-danger" title="Excluir">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        `;
    }

    // Atualizar seçáo atual
    refreshCurrentSection() {
        console.log('🔄 Atualizando seçáo atual...');
        
        const activeSection = document.querySelector('.content-section.active');
        if (!activeSection) {
            this.showToast('Nenhuma seçáo ativa para atualizar', 'warning');
            return;
        }

        const sectionId = activeSection.id;
        
        // Animaçáo de refresh
        const refreshButton = document.querySelector('.header-icon[title="Atualizar"]');
        if (refreshButton) {
            refreshButton.style.transform = 'rotate(360deg)';
            refreshButton.style.transition = 'transform 0.5s ease';
            
            setTimeout(() => {
                refreshButton.style.transform = '';
            }, 500);
        }

        // Recarregar dados da seçáo específica
        switch(sectionId) {
            case 'funcionarios-section':
                this.refreshFuncionarios();
                break;
            case 'holerites-section':
                this.refreshHolerites();
                break;
            case 'relatórios-section':
                this.refreshRelatorios();
                break;
            case 'dashboard-home':
                this.refreshDashboard();
                break;
        }

        console.log(`✅ ${this.getSectionName(sectionId)} atualizado`);
    }

    // Refresh específico para funcionários
    refreshFuncionarios() {
        console.log('👥 Atualizando funcionários...');
        // Simular carregamento de dados
        const grid = document.getElementById('funcionarios-grid');
        if (grid) {
            grid.style.opacity = '0.5';
            setTimeout(() => {
                grid.style.opacity = '1';
                // Aqui seria feita a chamada real para a API
            }, 1000);
        }
    }

    // Refresh específico para holerites
    refreshHolerites() {
        console.log('💰 Atualizando holerites...');
        // Simular recarregamento
        const section = document.getElementById('holerites-section');
        if (section) {
            section.style.opacity = '0.5';
            setTimeout(() => {
                section.style.opacity = '1';
            }, 800);
        }
    }

    // Refresh específico para relatórios
    refreshRelatorios() {
        console.log('📊 Atualizando relatórios...');
        const section = document.getElementById('relatórios-section');
        if (section) {
            section.style.opacity = '0.5';
            setTimeout(() => {
                section.style.opacity = '1';
            }, 600);
        }
    }

    // Refresh específico para dashboard
    refreshDashboard() {
        console.log('🏠 Atualizando dashboard...');
        
        // Atualizar widgets
        const widgets = document.querySelectorAll('.widget');
        widgets.forEach(widget => {
            widget.style.opacity = '0.5';
        });

        setTimeout(() => {
            widgets.forEach(widget => {
                widget.style.opacity = '1';
            });
            
            // Recarregar dados do dashboard se disponível
            if (typeof window.loadDashboardData === 'function') {
                window.loadDashboardData();
            }
        }, 1200);
    }

    // Voltar para seçáo anterior
    goBack() {
        console.log('⬅️ Voltando...');
        
        // Se está em uma seçáo, voltar para dashboard
        const activeSection = document.querySelector('.content-section.active');
        if (activeSection && activeSection.id !== 'dashboard-home') {
            if (typeof window.navigateToSection === 'function') {
                window.navigateToSection('dashboard-home');
            }
            console.log('⬅️ Voltando ao Dashboard');
        } else {
            console.log('ℹ️ Já está na página inicial');
        }
    }

    // Obter nome da seçáo
    getSectionName(sectionId) {
        const names = {
            'funcionarios-section': 'Funcionários',
            'holerites-section': 'Holerites',
            'relatórios-section': 'Relatórios',
            'dashboard-home': 'Dashboard'
        };
        return names[sectionId] || 'Seçáo';
    }

    // Mostrar notificaçáo no sino (SEM toast automático)
    showToast(message, type = 'info') {
        // Apenas adicionar à lista de notificações, SEM mostrar toast
        this.addNotification(message, type);
    }
    
    // Mostrar toast temporário APENAS quando solicitado explicitamente
    showTemporaryToastOnly(message, type = 'info') {
        this.showTemporaryToast(message, type);
    }

    // Adicionar notificaçáo ao painel do sino
    addNotification(message, type = 'info') {
        const notificationsList = document.getElementById('notifications-list');
        const notificationCount = document.getElementById('notification-count');
        
        if (!notificationsList || !notificationCount) return;

        // Definir ícones e cores por tipo
        const config = {
            success: { icon: 'fas fa-check-circle', color: '#10b981' },
            info: { icon: 'fas fa-info-circle', color: '#3b82f6' },
            warning: { icon: 'fas fa-exclamation-triangle', color: '#f59e0b' },
            error: { icon: 'fas fa-times-circle', color: '#ef4444' }
        };

        const { icon, color } = config[type] || config.info;
        const timestamp = new Date().toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        // Criar elemento de notificaçáo
        const notification = document.createElement('div');
        notification.className = 'notification-item';
        notification.innerHTML = `
            <div class="notification-icon" style="color: ${color};">
                <i class="${icon}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-message">${message}</div>
                <div class="notification-time">${timestamp}</div>
            </div>
            <button class="notification-close" onclick="this.parentElement.remove(); updateNotificationCount();">
                <i class="fas fa-times"></i>
            </button>
        `;

        // Adicionar no topo da lista
        notificationsList.insertBefore(notification, notificationsList.firstChild);

        // Atualizar contador
        this.updateNotificationCount();

        // Fazer o sino piscar
        this.blinkBell();
    }

    // Mostrar toast temporário
    showTemporaryToast(message, type = 'info') {
        // Criar ou reutilizar container de toast
        let toastContainer = document.getElementById('temp-toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'temp-toast-container';
            toastContainer.style.cssText = `
                position: fixed;
                top: 70px;
                right: 20px;
                z-index: 10000;
                pointer-events: none;
            `;
            document.body.appendChild(toastContainer);
        }

        // Definir cores por tipo
        const colors = {
            success: '#10b981',
            info: '#3b82f6',
            warning: '#f59e0b',
            error: '#ef4444'
        };

        // Criar toast
        const toast = document.createElement('div');
        toast.style.cssText = `
            background: ${colors[type] || colors.info};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            animation: slideInRight 0.3s ease;
            font-size: 14px;
            font-weight: 500;
            pointer-events: auto;
        `;

        toast.textContent = message;
        toastContainer.appendChild(toast);

        // Remover toast após 3 segundos
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => {
                    toast.remove();
                }, 300);
            }
        }, 3000);
    }

    // Atualizar contador de notificações
    updateNotificationCount() {
        const notificationsList = document.getElementById('notifications-list');
        const notificationCount = document.getElementById('notification-count');
        
        if (!notificationsList || !notificationCount) return;

        const count = notificationsList.children.length;
        notificationCount.textContent = count;
        
        // Mostrar/ocultar badge
        notificationCount.style.display = count > 0 ? 'block' : 'none';
    }

    // Fazer sino piscar
    blinkBell() {
        const bellBtn = document.getElementById('notifications-btn');
        if (!bellBtn) return;

        bellBtn.classList.add('notification-blink');
        setTimeout(() => {
            bellBtn.classList.remove('notification-blink');
        }, 1000);
    }
}

// Adicionar estilos para os toasts
function addToastStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        .header-icon.active {
            background: #3b82f6 !important;
            color: white !important;
        }
        
        .table-avatar {
            width: 32px !important;
            height: 32px !important;
            border-radius: 50% !important;
            object-fit: cover !important;
        }
        
        .data-table {
            width: 100% !important;
            border-collapse: collapse !important;
            background: white !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
        }
        
        .data-table th,
        .data-table td {
            padding: 12px !important;
            text-align: left !important;
            border-bottom: 1px solid #e5e7eb !important;
        }
        
        .data-table th {
            background: #f9fafb !important;
            font-weight: 600 !important;
            color: #374151 !important;
        }
        
        .btn-sm {
            padding: 4px 8px !important;
            margin: 0 2px !important;
            border: none !important;
            border-radius: 4px !important;
            cursor: pointer !important;
            font-size: 12px !important;
        }
        
        .btn-primary { background: #3b82f6 !important; color: white !important; }
        .btn-warning { background: #f59e0b !important; color: white !important; }
        .btn-danger { background: #ef4444 !important; color: white !important; }
        
        /* Painel de Notificações */
        .notifications-panel {
            position: absolute !important;
            top: 60px !important;
            right: 0 !important;
            width: 350px !important;
            max-height: 400px !important;
            background: white !important;
            border-radius: 12px !important;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15) !important;
            border: 1px solid #e5e7eb !important;
            z-index: 10000 !important;
            overflow: hidden !important;
        }
        
        .notifications-header {
            padding: 16px 20px !important;
            border-bottom: 1px solid #f3f4f6 !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            background: #f9fafb !important;
        }
        
        .notifications-header h4 {
            margin: 0 !important;
            font-size: 16px !important;
            font-weight: 600 !important;
            color: #111827 !important;
        }
        
        .clear-btn {
            background: none !important;
            border: none !important;
            color: #6b7280 !important;
            font-size: 12px !important;
            cursor: pointer !important;
            padding: 4px 8px !important;
            border-radius: 6px !important;
            transition: all 0.2s !important;
        }
        
        .clear-btn:hover {
            background: #f3f4f6 !important;
            color: #374151 !important;
        }
        
        .notifications-list {
            max-height: 320px !important;
            overflow-y: auto !important;
        }
        
        .notification-item {
            display: flex !important;
            align-items: flex-start !important;
            gap: 12px !important;
            padding: 16px 20px !important;
            border-bottom: 1px solid #f3f4f6 !important;
            transition: background 0.2s !important;
        }
        
        .notification-item:hover {
            background: #f9fafb !important;
        }
        
        .notification-item:last-child {
            border-bottom: none !important;
        }
        
        .notification-icon {
            font-size: 16px !important;
            margin-top: 2px !important;
        }
        
        .notification-content {
            flex: 1 !important;
        }
        
        .notification-message {
            font-size: 14px !important;
            color: #111827 !important;
            margin-bottom: 4px !important;
            line-height: 1.4 !important;
        }
        
        .notification-time {
            font-size: 12px !important;
            color: #6b7280 !important;
        }
        
        .notification-close {
            background: none !important;
            border: none !important;
            color: #9ca3af !important;
            cursor: pointer !important;
            padding: 4px !important;
            border-radius: 4px !important;
            font-size: 12px !important;
            transition: all 0.2s !important;
        }
        
        .notification-close:hover {
            background: #f3f4f6 !important;
            color: #6b7280 !important;
        }
        
        .notification-blink {
            animation: bellBlink 1s ease-in-out !important;
        }
        
        @keyframes bellBlink {
            0%, 100% { transform: scale(1); }
            25% { transform: scale(1.1); }
            50% { transform: scale(1); }
            75% { transform: scale(1.1); }
        }
        
        @keyframes fadeInDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes fadeOutUp {
            from { opacity: 1; transform: translateY(0); }
            to { opacity: 0; transform: translateY(-10px); }
        }
        
        .badge {
            position: absolute !important;
            top: -5px !important;
            right: -5px !important;
            background: #ef4444 !important;
            color: white !important;
            border-radius: 50% !important;
            width: 18px !important;
            height: 18px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-size: 11px !important;
            font-weight: 600 !important;
        }
    `;
    document.head.appendChild(style);
}

// Inicializaçáo
function initializeHeaderControls() {
    console.log('🚀 Inicializando controles do cabeçalho...');
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeHeaderControls);
        return;
    }
    
    // Aguardar um pouco para garantir que outros scripts carregaram
    setTimeout(() => {
        addToastStyles();
        window.headerControls = new HeaderControls();
        
        // Definir visualizaçáo inicial como grid
        window.headerControls.switchToGridView();
        
        console.log('✅ Controles do cabeçalho inicializados');
    }, 500);
}

// Funções globais para o painel de notificações
function toggleNotifications() {
    // Primeiro, ocultar qualquer outro painel de notificaçáo que náo seja do sino
    if (window.showOnlyBellNotifications) {
        window.showOnlyBellNotifications();
    }
    
    const panel = document.getElementById('notifications-panel');
    if (!panel) return;
    
    // Adicionar uma notificaçáo de exemplo quando abrir o painel pela primeira vez
    if (panel.style.display === 'none' || !panel.style.display || panel.style.visibility === 'hidden') {
        // Mostrar painel
        panel.style.display = 'block';
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';
        panel.style.animation = 'fadeInDown 0.3s ease';
        
        console.log('🔔 Painel de notificações do sino aberto');
    } else {
        // Ocultar painel
        panel.style.animation = 'fadeOutUp 0.3s ease';
        setTimeout(() => {
            panel.style.display = 'none';
            panel.style.visibility = 'hidden';
            panel.style.opacity = '0';
        }, 300);
        
        console.log('🔔 Painel de notificações do sino fechado');
    }
}

function toggleMessages() {
    console.log('📧 Botáo de mensagens clicado');
    
    // Primeiro mostrar o painel de notificações (se náo estiver visível)
    const panel = document.getElementById('notifications-panel');
    if (!panel) return;
    
    // Ocultar outros painéis primeiro
    if (window.showOnlyBellNotifications) {
        window.showOnlyBellNotifications();
    }
    
    // Adicionar mensagens de exemplo
    if (window.headerControls) {
        window.headerControls.addNotification('📧 Nova mensagem de Joáo Silva', 'info');
        window.headerControls.addNotification('📧 Resposta: Relatório aprovado', 'success');
        window.headerControls.addNotification('📧 3 mensagens náo lidas', 'warning');
    }
    
    // Mostrar painel se estiver oculto
    if (panel.style.display === 'none' || !panel.style.display || panel.style.visibility === 'hidden') {
        panel.style.display = 'block';
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';
        panel.style.animation = 'fadeInDown 0.3s ease';
        
        console.log('📧 Painel de mensagens aberto');
    }
}

function clearAllNotifications() {
    const notificationsList = document.getElementById('notifications-list');
    if (!notificationsList) return;
    
    notificationsList.innerHTML = '';
    updateNotificationCount();
}

function updateNotificationCount() {
    const notificationsList = document.getElementById('notifications-list');
    const notificationCount = document.getElementById('notification-count');
    
    if (!notificationsList || !notificationCount) return;

    const count = notificationsList.children.length;
    notificationCount.textContent = count;
    notificationCount.style.display = count > 0 ? 'block' : 'none';
}

// Fechar painel ao clicar fora
document.addEventListener('click', function(e) {
    const panel = document.getElementById('notifications-panel');
    const btn = document.getElementById('notifications-btn');
    
    if (panel && btn && 
        !panel.contains(e.target) && 
        !btn.contains(e.target) && 
        panel.style.display === 'block') {
        toggleNotifications();
    }
});

// Event listeners
/*OTIMIZADO*/ //document.addEventListener('DOMContentLoaded', initializeHeaderControls);
window.addEventListener('load', initializeHeaderControls);

console.log('📱 Header Controls carregado');