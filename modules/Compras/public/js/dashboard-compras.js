/* ========================================
   DASHBOARD DE COMPRAS
   KPIs, Gráficos e Informações Principais
   ======================================== */

class ComprasDashboard {
    constructor() {
        this.dados = {};
        this.graficos = {};
    }

    async init() {
        await this.loadData();
        this.render();
    }

    async loadData() {
        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const response = await fetch('/api/compras/dashboard', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data.success) {
                this.dados = data.dashboard || data || {};
                // Garantir estrutura mínima
                this.dados.kpis = this.dados.kpis || { pedidosAbertos: 0, aguardandoAprovacao: 0, valorTotalMes: 0, economia: 0 };
                this.dados.pedidosRecentes = this.dados.pedidosRecentes || [];
                this.dados.cotacoesPendentes = this.dados.cotacoesPendentes || [];
                this.dados.alertasEstoque = this.dados.alertasEstoque || [];
                this.dados.topFornecedores = this.dados.topFornecedores || [];
            } else {
                console.error('API retornou erro:', data.message);
                this.dados = this.getEmptyData();
            }
        } catch (error) {
            console.error('Erro ao carregar dashboard:', error);
            this.dados = this.getEmptyData();
        }
    }

    getEmptyData() {
        return {
            kpis: {
                pedidosAbertos: 0,
                aguardandoAprovacao: 0,
                valorTotalMes: 0,
                economia: 0
            },
            pedidosRecentes: [],
            cotacoesPendentes: [],
            alertasEstoque: [],
            topFornecedores: []
        };
    }

    render() {
        const container = document.getElementById('dashboard-container');
        if (!container) return;

        let html = '<div class="dashboard-compras">';

        // KPIs
        html += '<div class="kpis-grid">';
        html += this.renderKPI('Pedidos Abertos', this.dados.kpis.pedidosAbertos, 'fa-shopping-cart', '#3b82f6', '+5 esta semana');
        html += this.renderKPI('Aguardando Aprovação', this.dados.kpis.aguardandoAprovacao, 'fa-clock', '#f59e0b', 'Requer atenção');
        html += this.renderKPI('Valor Total (Mês)', this.formatCurrency(this.dados.kpis.valorTotalMes), 'fa-dollar-sign', '#6366f1', '+15% vs mês anterior');
        html += this.renderKPI('Economia Gerada', this.dados.kpis.economia + '%', 'fa-chart-line', '#8b5cf6', 'Em negociações');
        html += '</div>';

        // Grid Principal
        html += '<div class="dashboard-grid">';

        // Pedidos Recentes
        html += '<div class="dashboard-card">';
        html += '<div class="card-header">';
        html += '<h3><i class="fas fa-shopping-cart"></i> Pedidos Recentes</h3>';
        html += '<button class="btn-link" onclick="comprasNav.switchSection(\'btn-pedidos\')">Ver todos</button>';
        html += '</div>';
        html += '<div class="card-body">';
        html += this.renderPedidosRecentes();
        html += '</div>';
        html += '</div>';

        // Cotações Pendentes
        html += '<div class="dashboard-card">';
        html += '<div class="card-header">';
        html += '<h3><i class="fas fa-file-invoice-dollar"></i> Cotações Pendentes</h3>';
        html += '<button class="btn-link" onclick="comprasNav.switchSection(\'btn-cotacoes\')">Ver todas</button>';
        html += '</div>';
        html += '<div class="card-body">';
        html += this.renderCotacoesPendentes();
        html += '</div>';
        html += '</div>';

        // Alertas de Estoque
        html += '<div class="dashboard-card">';
        html += '<div class="card-header">';
        html += '<h3><i class="fas fa-exclamation-triangle"></i> Alertas de Estoque</h3>';
        html += '<button class="btn-link" onclick="comprasNav.switchSection(\'btn-estoque\')">Ver estoque</button>';
        html += '</div>';
        html += '<div class="card-body">';
        html += this.renderAlertasEstoque();
        html += '</div>';
        html += '</div>';

        // Top Fornecedores
        html += '<div class="dashboard-card">';
        html += '<div class="card-header">';
        html += '<h3><i class="fas fa-trophy"></i> Top Fornecedores</h3>';
        html += '<button class="btn-link" onclick="comprasNav.switchSection(\'btn-fornecedores\')">Ver todos</button>';
        html += '</div>';
        html += '<div class="card-body">';
        html += this.renderTopFornecedores();
        html += '</div>';
        html += '</div>';

        html += '</div>'; // dashboard-grid
        html += '</div>'; // dashboard-compras

        container.innerHTML = html;
    }

    renderKPI(titulo, valor, icon, cor, subtexto) {
        return `
            <div class="kpi-card">
                <div class="kpi-icon" style="background: ${cor}20; color: ${cor}">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="kpi-content">
                    <div class="kpi-label">${titulo}</div>
                    <div class="kpi-value">${valor}</div>
                    <div class="kpi-subtext">${subtexto}</div>
                </div>
            </div>
        `;
    }

    renderPedidosRecentes() {
        let html = '<div class="lista-pedidos">';
        
        this.dados.pedidosRecentes.forEach(pedido => {
            const statusClass = pedido.status === 'aprovado' ? 'status-success' : 
                               pedido.status === 'pendente' ? 'status-warning' : 'status-info';
            const statusText = pedido.status === 'aprovado' ? 'Aprovado' :
                              pedido.status === 'pendente' ? 'Pendente' : 'Em Análise';

            html += `
                <div class="pedido-item">
                    <div class="pedido-info">
                        <strong>#${pedido.id}</strong>
                        <span>${pedido.fornecedor}</span>
                    </div>
                    <div class="pedido-valor">${this.formatCurrency(pedido.valor)}</div>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                    <div class="pedido-data">${pedido.data}</div>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    }

    renderCotacoesPendentes() {
        let html = '<div class="lista-cotacoes">';
        
        this.dados.cotacoesPendentes.forEach(cotacao => {
            html += `
                <div class="cotacao-item">
                    <div class="cotacao-info">
                        <strong>#${cotacao.id}</strong>
                        <span>${cotacao.material}</span>
                    </div>
                    <div class="cotacao-fornecedores">
                        <i class="fas fa-truck"></i> ${cotacao.fornecedores} fornecedores
                    </div>
                    <div class="cotacao-preco">
                        Melhor: ${this.formatCurrency(cotacao.melhorPreco)}
                    </div>
                    <div class="cotacao-prazo">
                        <i class="fas fa-clock"></i> ${cotacao.prazo}
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    }

    renderAlertasEstoque() {
        let html = '<div class="lista-alertas">';
        
        this.dados.alertasEstoque.forEach(alerta => {
            const urgenciaClass = alerta.urgencia === 'alta' ? 'urgencia-alta' :
                                 alerta.urgencia === 'media' ? 'urgencia-media' : 'urgencia-baixa';
            const icon = alerta.urgencia === 'alta' ? 'fa-exclamation-circle' :
                        alerta.urgencia === 'media' ? 'fa-exclamation-triangle' : 'fa-info-circle';

            html += `
                <div class="alerta-item ${urgenciaClass}">
                    <div class="alerta-icon">
                        <i class="fas ${icon}"></i>
                    </div>
                    <div class="alerta-info">
                        <strong>${alerta.material}</strong>
                        <div class="alerta-detalhes">
                            <span>Estoque: ${alerta.estoque} un</span>
                            <span>Mínimo: ${alerta.minimo} un</span>
                        </div>
                    </div>
                    <button class="btn-small btn-primary" onclick="alert('Solicitar compra')">
                        <i class="fas fa-plus"></i> Solicitar
                    </button>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    }

    renderTopFornecedores() {
        let html = '<div class="lista-fornecedores">';
        
        this.dados.topFornecedores.forEach((fornecedor, index) => {
            const medalha = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : (index + 1);

            html += `
                <div class="fornecedor-item">
                    <div class="fornecedor-posicao">${medalha}</div>
                    <div class="fornecedor-info">
                        <strong>${fornecedor.nome}</strong>
                        <div class="fornecedor-stats">
                            <span><i class="fas fa-shopping-cart"></i> ${fornecedor.pedidos} pedidos</span>
                            <span class="fornecedor-valor">${this.formatCurrency(fornecedor.valor)}</span>
                        </div>
                    </div>
                    <div class="fornecedor-avaliacao">
                        <i class="fas fa-star"></i> ${fornecedor.avaliacao}
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    }

    formatCurrency(value) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    }
}

// Initialize
window.comprasDashboard = new ComprasDashboard();
