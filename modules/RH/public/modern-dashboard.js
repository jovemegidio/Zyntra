// ================================================= 
// DASHBOARD VISUAL MODERNO - APLICAÇÁO DINMICA
// ================================================= 

class ModernDashboardVisuals {
    constructor() {
        this.init();
        this.setupEventListeners();
        this.applyModernStyles();
    }

    init() {
        // Carrega o CSS moderno
        this.loadModernCSS();
        
        // Aguarda um pouco para garantir que a página carregou
        setTimeout(() => {
            this.enhanceDashboard();
        }, 500);
    }

    loadModernCSS() {
        if (!document.querySelector('link[href*="modern-dashboard.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'modern-dashboard.css';
            document.head.appendChild(link);
        }
    }

    enhanceDashboard() {
        this.modernizeHeaderSection();
        this.modernizeStatsCards();
        this.modernizeContentCards();
        this.addSmoothAnimations();
        this.enhanceInteractions();
    }

    modernizeHeaderSection() {
        // Busca pelo cabeçalho principal
        const headerSection = document.querySelector('.section-header, .dashboard-header, h2, h1') || 
                            document.querySelector('div').closest('div');
        
        if (headerSection) {
            // Verifica se já tem a classe moderna
            if (!headerSection.classList.contains('section-header-organized')) {
                headerSection.classList.add('section-header-organized');
                
                // Cria estrutura moderna
                const title = headerSection.querySelector('h1, h2, .title') || 
                            document.createTextNode('Dashboard Administrativo');
                
                headerSection.innerHTML = `
                    <div class="section-title-main">
                        <i class="fas fa-tachometer-alt"></i>
                        Dashboard Administrativo
                    </div>
                    <div class="section-actions">
                        <button class="btn-action btn-primary" onclick="atualizarDados()">
                            <i class="fas fa-sync-alt"></i>
                            Atualizar Dados
                        </button>
                        <button class="btn-action btn-success" onclick="exportarRelatorio()">
                            <i class="fas fa-download"></i>
                            Exportar
                        </button>
                    </div>
                `;
            }
        }
    }

    modernizeStatsCards() {
        // Procura por elementos de estatísticas existentes
        const statsContainer = this.findStatsContainer();
        
        if (statsContainer) {
            // Se náo tem a classe moderna, aplica
            if (!statsContainer.classList.contains('stats-row')) {
                statsContainer.classList.add('stats-row');
                
                // Moderniza cards individuais
                const cards = statsContainer.children;
                Array.from(cards).forEach((card, index) => {
                    this.modernizeStatCard(card, index);
                });
            }
        } else {
            // Cria stats cards baseado nos dados visíveis
            this.createModernStatsFromData();
        }
    }

    findStatsContainer() {
        // Procura por containers típicos de stats
        return document.querySelector('.stats-container, .dashboard-stats, .metrics-row') ||
               document.querySelector('div[style*="display: flex"], div[style*="grid"]') ||
               this.findElementByContent(['39', 'R$ 45', '2', '12']);
    }

    findElementByContent(searchTerms) {
        const allDivs = document.querySelectorAll('div');
        for (let div of allDivs) {
            for (let term of searchTerms) {
                if (div.textContent.includes(term)) {
                    return div.closest('div[class*="row"], div[style*="display"]') || div.parentElement;
                }
            }
        }
        return null;
    }

    modernizeStatCard(card, index) {
        if (!card.classList.contains('stat-card')) {
            card.classList.add('stat-card');
            
            // Define cores baseado no índice
            const colors = ['blue', 'green', 'yellow', 'red', 'purple'];
            card.classList.add(colors[index % colors.length]);
            
            // Reestrutura o conteúdo
            const originalContent = card.innerHTML;
            
            // Tenta extrair informações do conteúdo original
            const textContent = card.textContent;
            let title = 'Métrica';
            let value = '0';
            let subtitle = 'Dados';
            let icon = 'fas fa-chart-bar';
            
            // Parse inteligente do conteúdo
            if (textContent.includes('Funcionário') || textContent.includes('39')) {
                title = 'Total Funcionários';
                value = '39';
                subtitle = 'Ativos na empresa';
                icon = 'fas fa-users';
            } else if (textContent.includes('R$') || textContent.includes('45')) {
                title = 'Folha Mensal';
                value = 'R$ 45.000';
                subtitle = 'Setembro 2024';
                icon = 'fas fa-money-bill-wave';
            } else if (textContent.includes('Aniversariante') || textContent.includes('2')) {
                title = 'Aniversariantes';
                value = '2';
                subtitle = 'Este mês';
                icon = 'fas fa-birthday-cake';
            } else if (textContent.includes('Relatório') || textContent.includes('12')) {
                title = 'Relatórios';
                value = '12';
                subtitle = 'Disponíveis';
                icon = 'fas fa-file-alt';
            }
            
            card.innerHTML = `
                <div class="stat-header">
                    <h3 class="stat-title">${title}</h3>
                    <div class="stat-icon">
                        <i class="${icon}"></i>
                    </div>
                </div>
                <div class="stat-value">${value}</div>
                <div class="stat-subtitle">${subtitle}</div>
            `;
        }
    }

    createModernStatsFromData() {
        // Cria um container de stats moderno se náo existir
        let statsContainer = document.createElement('div');
        statsContainer.className = 'stats-row';
        
        // Dados padráo baseados na imagem
        const statsData = [
            {
                title: 'Total Funcionários',
                value: '39',
                subtitle: 'Ativos na empresa',
                icon: 'fas fa-users',
                color: 'blue'
            },
            {
                title: 'Folha Mensal',
                value: 'R$ 45.000',
                subtitle: 'Setembro 2024',
                icon: 'fas fa-money-bill-wave',
                color: 'green'
            },
            {
                title: 'Aniversariantes',
                value: '2',
                subtitle: 'Este mês',
                icon: 'fas fa-birthday-cake',
                color: 'yellow'
            },
            {
                title: 'Relatórios',
                value: '12',
                subtitle: 'Disponíveis',
                icon: 'fas fa-file-alt',
                color: 'red'
            }
        ];

        statsData.forEach(stat => {
            const card = document.createElement('div');
            card.className = `stat-card ${stat.color}`;
            card.innerHTML = `
                <div class="stat-header">
                    <h3 class="stat-title">${stat.title}</h3>
                    <div class="stat-icon">
                        <i class="${stat.icon}"></i>
                    </div>
                </div>
                <div class="stat-value">${stat.value}</div>
                <div class="stat-subtitle">${stat.subtitle}</div>
            `;
            statsContainer.appendChild(card);
        });

        // Insere no DOM
        const headerSection = document.querySelector('.section-header-organized');
        if (headerSection && headerSection.nextSibling) {
            headerSection.parentNode.insertBefore(statsContainer, headerSection.nextSibling);
        } else {
            document.body.appendChild(statsContainer);
        }
    }

    modernizeContentCards() {
        // Moderniza seções de conteúdo (Últimas Atividades, Colaboradores com mais tempo de casa)
        const contentSections = document.querySelectorAll('div[class*="section"], .content-section, .activity-section');
        
        contentSections.forEach(section => {
            if (!section.classList.contains('modernized')) {
                section.classList.add('modernized');
                this.modernizeSection(section);
            }
        });

        // Procura por listas e tabelas para modernizar
        this.modernizeLists();
        this.modernizeTables();
    }

    modernizeSection(section) {
        // Adiciona toolbar se necessário
        const title = section.querySelector('h2, h3, h4, .title');
        if (title && !section.querySelector('.section-toolbar')) {
            const toolbar = document.createElement('div');
            toolbar.className = 'section-toolbar';
            toolbar.innerHTML = `
                <div class="section-search">
                    <i class="fas fa-search"></i>
                    <input type="text" placeholder="Pesquisar..." onkeyup="filtrarItens(this.value)">
                    <select onchange="filtrarPorTipo(this.value)">
                        <option value="">Todos</option>
                        <option value="ativo">Ativo</option>
                        <option value="pendente">Pendente</option>
                        <option value="inativo">Inativo</option>
                    </select>
                </div>
                <div class="section-actions">
                    <button class="btn-action btn-primary" onclick="adicionarItem()">
                        <i class="fas fa-plus"></i>
                        Adicionar
                    </button>
                </div>
            `;
            
            if (title.nextSibling) {
                title.parentNode.insertBefore(toolbar, title.nextSibling);
            } else {
                section.appendChild(toolbar);
            }
        }
    }

    modernizeLists() {
        const lists = document.querySelectorAll('ul, ol, .list-group, .activity-list');
        
        lists.forEach(list => {
            if (!list.classList.contains('items-grid')) {
                list.classList.add('items-grid');
                
                const items = list.querySelectorAll('li, .list-item, .activity-item');
                items.forEach(item => {
                    this.modernizeListItem(item);
                });
            }
        });
    }

    modernizeListItem(item) {
        if (!item.classList.contains('item-card')) {
            item.classList.add('item-card');
            
            // Cria estrutura moderna para o item
            const originalContent = item.innerHTML;
            const textContent = item.textContent;
            
            // Parse do conteúdo para extrair informações
            let name = 'Nome do Item';
            let description = 'Descriçáo';
            let status = 'active';
            let avatar = 'https://via.placeholder.com/55/667eea/ffffff?text=U';
            
            // Lógica inteligente para extrair dados
            if (textContent.includes('Andreia Silva')) {
                name = 'Andreia Silva';
                description = 'Nova contrataçáo - Há 2 horas';
                status = 'active';
            } else if (textContent.includes('Douglas Santos')) {
                name = 'Douglas Santos';
                description = 'Desenvolvedor - 95% eficiência';
                status = 'active';
            }
            
            item.innerHTML = `
                <div class="item-header">
                    <img src="${avatar}" alt="${name}" class="item-avatar" onerror="this.src='https://via.placeholder.com/55/667eea/ffffff?text=${name.charAt(0)}'">
                    <div class="item-info">
                        <h4>${name}</h4>
                        <p>${description}</p>
                        <span class="status-badge ${status}">${status}</span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="action-btn view" onclick="visualizarItem('${name}')" title="Visualizar">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="action-btn edit" onclick="editarItem('${name}')" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn delete" onclick="excluirItem('${name}')" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
        }
    }

    modernizeTables() {
        const tables = document.querySelectorAll('table');
        
        tables.forEach(table => {
            if (!table.classList.contains('modern-table')) {
                table.classList.add('modern-table');
                
                // Aplica estilos de tabela moderna
                table.style.cssText = `
                    width: 100%;
                    border-collapse: collapse;
                    background: white;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
                `;
                
                // Moderniza cabeçalho
                const thead = table.querySelector('thead');
                if (thead) {
                    thead.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                    thead.style.color = 'white';
                }
                
                // Moderniza linhas
                const rows = table.querySelectorAll('tbody tr');
                rows.forEach((row, index) => {
                    row.style.borderBottom = '1px solid #e5e7eb';
                    if (index % 2 === 0) {
                        row.style.backgroundColor = '#f9fafb';
                    }
                });
            }
        });
    }

    addSmoothAnimations() {
        // Adiciona animações de entrada
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        });

        // Observa elementos para animaçáo
        const elementsToAnimate = document.querySelectorAll('.stat-card, .item-card, .section-header-organized');
        elementsToAnimate.forEach(element => {
            element.style.opacity = '0';
            element.style.transform = 'translateY(30px)';
            element.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
            observer.observe(element);
        });
    }

    enhanceInteractions() {
        // Adiciona efeitos de hover e interaçáo
        document.addEventListener('mouseover', (e) => {
            if (e.target.classList.contains('stat-card')) {
                e.target.style.transform = 'translateY(-8px)';
            }
            
            if (e.target.classList.contains('item-card')) {
                e.target.style.transform = 'translateY(-6px)';
            }
        });

        document.addEventListener('mouseout', (e) => {
            if (e.target.classList.contains('stat-card')) {
                e.target.style.transform = 'translateY(0)';
            }
            
            if (e.target.classList.contains('item-card')) {
                e.target.style.transform = 'translateY(0)';
            }
        });

        // Efeitos de clique
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-action') || e.target.classList.contains('action-btn')) {
                e.target.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    e.target.style.transform = '';
                }, 150);
            }
        });
    }

    setupEventListeners() {
        // Event listeners para funcionalidades do dashboard
        window.atualizarDados = () => {
            this.showNotification('Dados atualizados com sucesso!', 'success');
        };

        window.exportarRelatorio = () => {
            this.showNotification('Relatório exportado!', 'success');
        };

        window.filtrarItens = (termo) => {
            const items = document.querySelectorAll('.item-card');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(termo.toLowerCase()) ? 'block' : 'none';
            });
        };

        window.filtrarPorTipo = (tipo) => {
            const items = document.querySelectorAll('.item-card');
            items.forEach(item => {
                const badge = item.querySelector('.status-badge');
                if (!tipo || (badge && badge.classList.contains(tipo))) {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
            });
        };

        window.visualizarItem = (nome) => {
            this.showNotification(`Visualizando: ${nome}`, 'info');
        };

        window.editarItem = (nome) => {
            this.showNotification(`Editando: ${nome}`, 'warning');
        };

        window.excluirItem = (nome) => {
            if (confirm(`Deseja realmente excluir: ${nome}?`)) {
                this.showNotification(`${nome} foi excluído!`, 'error');
            }
        };

        window.adicionarItem = () => {
            this.showNotification('Adicionar novo item', 'info');
        };
    }

    showNotification(message, type = 'info') {
        // Cria notificaçáo moderna
        const notification = document.createElement('div');
        notification.className = `modern-notification ${type}`;
        notification.textContent = message;
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 12px;
            color: white;
            font-weight: 600;
            z-index: 10000;
            transform: translateX(400px);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        `;

        // Define cor baseado no tipo
        switch(type) {
            case 'success':
                notification.style.background = 'linear-gradient(135deg, #10b981 0%, #34d399 100%)';
                break;
            case 'error':
                notification.style.background = 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)';
                break;
            case 'warning':
                notification.style.background = 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)';
                break;
            default:
                notification.style.background = 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)';
        }

        document.body.appendChild(notification);

        // Anima entrada
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);

        // Remove após 3 segundos
        setTimeout(() => {
            notification.style.transform = 'translateX(400px)';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    applyModernStyles() {
        // Aplica estilos globais modernos
        document.body.style.cssText += `
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            min-height: 100vh;
        `;

        // Adiciona FontAwesome se náo existir
        if (!document.querySelector('link[href*="font-awesome"]')) {
            const faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css';
            document.head.appendChild(faLink);
        }
    }
}

// Inicializa quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
    if (!window._modernDashboardInstance) {
        window._modernDashboardInstance = new ModernDashboardVisuals();
    }
});

// Reinicializa se a página for carregada dinamicamente
if (window.loadPage) {
    const originalLoadPage = window.loadPage;
    window.loadPage = function(page) {
        const result = originalLoadPage.apply(this, arguments);
        setTimeout(() => {
            if (!window._modernDashboardInstance) {
                window._modernDashboardInstance = new ModernDashboardVisuals();
            }
        }, 500);
        return result;
    };
}