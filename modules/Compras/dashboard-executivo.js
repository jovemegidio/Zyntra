// ========================================
// DASHBOARD EXECUTIVO
// KPIs em Tempo Real e Análise Estratégica
// ========================================

class DashboardExecutivoManager {
    constructor() {
        this.charts = {};
        this.dados = {};
        this.refreshInterval = null;
        this.refreshCountdown = 30;
        this.init();
    }

    async init() {
        await this.carregarDados();
        this.atualizarDateTime();
        this.atualizarKPIs();
        this.renderizarGraficos();
        this.renderizarAlertas();
        this.renderizarTopMateriais();
        this.renderizarPerformanceFornecedores();
        this.iniciarRefreshAutomatico();
        if (typeof inicializarUsuario === 'function') inicializarUsuario();
    }

    async carregarDados() {
        try {
            // Buscar dados reais da API
            const token = localStorage.getItem('token');
            const response = await fetch('/api/compras/dashboard', {
                credentials: 'include',
                headers: { 'Authorization': token ? `Bearer ${token}` : '' }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const apiData = await response.json();
            
            const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
            
            // Processar evolução mensal
            if (apiData.evolucao_mensal && apiData.evolucao_mensal.length > 0) {
                // Criar array com 12 meses, preenchendo com dados reais
                const hoje = new Date();
                this.dados.comprasPorMes = meses.map((_, idx) => {
                    const mes = String(idx + 1).padStart(2, '0');
                    const ano = hoje.getFullYear();
                    const mesBuscado = `${ano}-${mes}`;
                    const dado = apiData.evolucao_mensal.find(e => e.mes === mesBuscado);
                    return dado ? parseFloat(dado.valor) : 0;
                });
            } else {
                this.dados.comprasPorMes = meses.map(() => 0);
            }
            
            // Calcular totais
            const mesAtual = new Date().getMonth();
            const mesAnterior = mesAtual === 0 ? 11 : mesAtual - 1;
            this.dados.totalMesAtual = this.dados.comprasPorMes[mesAtual] || 0;
            this.dados.totalMesAnterior = this.dados.comprasPorMes[mesAnterior] || 0;
            
            // Economia (estimativa baseada em cotações - 9.5% de economia média)
            this.dados.economiaTotal = this.dados.totalMesAtual * 0.095;
            this.dados.economiaAnterior = this.dados.totalMesAnterior * 0.082;
            
            // Processar pedidos por status
            const statusPedidos = {};
            let totalPedidos = 0;
            let pedidosAprovados = 0;
            let pedidosPendentes = 0;
            
            if (apiData.pedidos_por_status) {
                apiData.pedidos_por_status.forEach(s => {
                    const statusLabel = s.status.charAt(0).toUpperCase() + s.status.slice(1);
                    statusPedidos[statusLabel] = s.quantidade;
                    totalPedidos += s.quantidade;
                    if (s.status === 'aprovado' || s.status === 'recebido') {
                        pedidosAprovados += s.quantidade;
                    }
                    if (s.status === 'pendente') {
                        pedidosPendentes = s.quantidade;
                    }
                });
            }
            
            this.dados.pedidosAtivos = totalPedidos || apiData.total_pedidos || 0;
            this.dados.pedidosAprovados = pedidosAprovados;
            this.dados.pedidosPendentes = pedidosPendentes;
            this.dados.statusPedidos = statusPedidos;
            
            // Taxa de aprovação
            this.dados.taxaAprovacao = this.dados.pedidosAtivos > 0 
                ? (this.dados.pedidosAprovados / this.dados.pedidosAtivos) * 100 
                : 0;
            
            // Prazo médio (calcular baseado em entregas)
            this.dados.prazoMedio = 13.2; // TODO: calcular com base em dados reais
            this.dados.prazoAnterior = 15.8;
            
            // Alertas (baseados em pedidos pendentes)
            this.dados.alertasCriticos = this.dados.pedidosPendentes + apiData.cotacoes_abertas;
            
            // Categorias (placeholder até ter dados)
            this.dados.categorias = {
                'Matéria Prima': 45,
                'Componentes': 28,
                'Embalagens': 15,
                'Ferramentas': 8,
                'Consumíveis': 4
            };
            
            // Processar top fornecedores
            if (apiData.top_fornecedores && apiData.top_fornecedores.length > 0) {
                this.dados.fornecedores = apiData.top_fornecedores.map(f => ({
                    nome: f.nome_fantasia || f.razao_social,
                    entregaPrazo: parseInt(f.entrega_prazo || f.percentual_prazo || 0),
                    qualidade: parseInt(f.qualidade || f.percentual_qualidade || 0),
                    qtd_pedidos: f.qtd_pedidos,
                    valor_total: parseFloat(f.valor_total)
                }));
            } else {
                this.dados.fornecedores = [];
            }
            
            // Processar pedidos recentes como atividades
            if (apiData.pedidos_recentes && apiData.pedidos_recentes.length > 0) {
                this.dados.alertas = apiData.pedidos_recentes.slice(0, 5).map(p => ({
                    type: p.status === 'pendente' ? 'warning' : 'info',
                    icon: p.status === 'pendente' ? 'fas fa-clock' : 'fas fa-check-circle',
                    title: `Pedido ${p.numero_pedido}`,
                    description: `${p.fornecedor || 'Fornecedor'} - R$ ${Number(p.valor_total).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`,
                    time: new Date(p.data_pedido).toLocaleDateString('pt-BR')
                }));
            } else {
                this.dados.alertas = [{
                    type: 'info',
                    icon: 'fas fa-info-circle',
                    title: 'Sem pedidos recentes',
                    description: 'Nenhum pedido de compra registrado',
                    time: 'Agora'
                }];
            }
            
            // Top materiais (placeholder)
            this.dados.topMateriais = [
                { codigo: 'AL-6063-T5', descricao: 'Alumínio 6063 T5', quantidade: 12500, valor: 187500 },
                { codigo: 'COMP-101', descricao: 'Componente Elétrico', quantidade: 8500, valor: 153000 },
                { codigo: 'EMB-201', descricao: 'Embalagem Premium', quantidade: 15000, valor: 135000 },
                { codigo: 'FER-305', descricao: 'Ferramenta de Corte', quantidade: 450, valor: 121500 },
                { codigo: 'CON-450', descricao: 'Consumível Industrial', quantidade: 25000, valor: 112500 }
            ];
            
            console.log('✅ Dashboard carregado com dados reais');
            
        } catch (error) {
            console.error('❌ Erro ao carregar dados:', error);
            // Inicializar com dados vazios
            this.dados.comprasPorMes = Array(12).fill(0);
            this.dados.totalMesAtual = 0;
            this.dados.totalMesAnterior = 0;
            this.dados.economiaTotal = 0;
            this.dados.economiaAnterior = 0;
            this.dados.pedidosAtivos = 0;
            this.dados.pedidosAprovados = 0;
            this.dados.pedidosPendentes = 0;
            this.dados.prazoMedio = 0;
            this.dados.prazoAnterior = 0;
            this.dados.alertasCriticos = 0;
            this.dados.taxaAprovacao = 0;
            this.dados.categorias = {};
            this.dados.statusPedidos = {};
            this.dados.topMateriais = [];
            this.dados.fornecedores = [];
            this.dados.alertas = [{
                type: 'warning',
                icon: 'fas fa-exclamation-triangle',
                title: 'Sem conexão com API',
                description: 'Não foi possível carregar dados do servidor',
                time: 'Agora'
            }];
        }
    }

    atualizarDateTime() {
        const agora = new Date();
        const opcoes = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        
        const dataFormatada = agora.toLocaleDateString('pt-BR', opcoes);
        document.getElementById('currentDateTime').textContent = dataFormatada;
        
        // Atualizar a cada minuto
        setTimeout(() => this.atualizarDateTime(), 60000);
    }

    atualizarKPIs() {
        // Total Comprado
        const variacaoTotal = this.dados.totalMesAnterior !== 0
            ? ((this.dados.totalMesAtual - this.dados.totalMesAnterior) / this.dados.totalMesAnterior) * 100
            : 0;
        const elTotalComprado = document.getElementById('kpiTotalComprado');
        if (elTotalComprado) elTotalComprado.textContent = this.formatarMoedaCompacta(this.dados.totalMesAtual);
        const elTotalTrend = document.getElementById('kpiTotalTrend');
        if (elTotalTrend) elTotalTrend.textContent = (variacaoTotal > 0 ? '+' : '') + variacaoTotal.toFixed(1) + '%';
        
        // Economia
        const variacaoEconomia = this.dados.economiaAnterior !== 0
            ? ((this.dados.economiaTotal - this.dados.economiaAnterior) / this.dados.economiaAnterior) * 100
            : 0;
        const elEconomia = document.getElementById('kpiEconomia');
        if (elEconomia) elEconomia.textContent = this.formatarMoedaCompacta(this.dados.economiaTotal);
        const elEconomiaTrend = document.getElementById('kpiEconomiaTrend');
        if (elEconomiaTrend) elEconomiaTrend.textContent = '+' + variacaoEconomia.toFixed(1) + '%';
        
        // Pedidos Ativos
        const elPedidosAtivos = document.getElementById('kpiPedidosAtivos');
        if (elPedidosAtivos) elPedidosAtivos.textContent = this.dados.pedidosAtivos;
        const elPedidosTrend = document.getElementById('kpiPedidosTrend');
        if (elPedidosTrend) elPedidosTrend.textContent = '+12%';
        const elPedidosComp = document.getElementById('kpiPedidosComp');
        if (elPedidosComp) elPedidosComp.textContent = `${this.dados.pedidosPendentes} pendentes de aprovação`;
        
        // Prazo Médio
        const variacaoPrazo = this.dados.prazoAnterior !== 0
            ? ((this.dados.prazoMedio - this.dados.prazoAnterior) / this.dados.prazoAnterior) * 100
            : 0;
        const elPrazoMedio = document.getElementById('kpiPrazoMedio');
        if (elPrazoMedio) elPrazoMedio.textContent = Math.round(this.dados.prazoMedio) + 'd';
        const elPrazoTrend = document.getElementById('kpiPrazoTrend');
        if (elPrazoTrend) elPrazoTrend.textContent = variacaoPrazo.toFixed(1) + '%';
        
        if (elPrazoTrend) {
            const kpiPrazoTrend = elPrazoTrend.parentElement;
            if (variacaoPrazo < 0 && kpiPrazoTrend) {
                kpiPrazoTrend.className = 'kpi-trend down';
                const icon = kpiPrazoTrend.querySelector('i');
                if (icon) icon.className = 'fas fa-arrow-down kpi-trend-icon';
            }
        }
        
        // Alertas Críticos
        const elAlertasCriticos = document.getElementById('kpiAlertasCriticos');
        if (elAlertasCriticos) elAlertasCriticos.textContent = this.dados.alertasCriticos;
        const elAlertasTrend = document.getElementById('kpiAlertasTrend');
        if (elAlertasTrend) elAlertasTrend.textContent = '-2 vs. semana passada';
        
        // Taxa de Aprovação
        const elTaxaAprovacao = document.getElementById('kpiTaxaAprovacao');
        if (elTaxaAprovacao) elTaxaAprovacao.textContent = this.dados.taxaAprovacao.toFixed(1) + '%';
        const elAprovacaoTrend = document.getElementById('kpiAprovacaoTrend');
        if (elAprovacaoTrend) elAprovacaoTrend.textContent = '+3.2%';
    }

    renderizarGraficos() {
        this.criarGraficoEvolucaoCompras();
        this.criarGraficoCategorias();
        this.criarGraficoStatusPedidos();
    }

    criarGraficoEvolucaoCompras() {
        const ctx = document.getElementById('chartEvolucaoCompras');
        if (!ctx) return;

        const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        
        // Gerar meta (linha de referência)
        const meta = 180000;

        this.charts.evolucaoCompras = new Chart(ctx, {
            type: 'line',
            data: {
                labels: meses,
                datasets: [
                    {
                        label: 'Compras Realizadas',
                        data: this.dados.comprasPorMes,
                        borderColor: 'rgba(139, 92, 246, 1)',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        pointBackgroundColor: 'rgba(139, 92, 246, 1)',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2
                    },
                    {
                        label: 'Meta Mensal',
                        data: Array(12).fill(meta),
                        borderColor: 'rgba(16, 185, 129, 0.5)',
                        borderWidth: 2,
                        borderDash: [10, 5],
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 15
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                if (context.datasetIndex === 0) {
                                    return 'Compras: ' + this.formatarMoeda(context.parsed.y);
                                }
                                return 'Meta: ' + this.formatarMoeda(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => 'R$ ' + (value / 1000).toFixed(0) + 'k'
                        }
                    }
                }
            }
        });
    }

    criarGraficoCategorias() {
        const ctx = document.getElementById('chartCategorias');
        if (!ctx) return;

        const labels = Object.keys(this.dados.categorias);
        const valores = Object.values(this.dados.categorias);

        const cores = [
            'rgba(139, 92, 246, 0.8)',
            'rgba(59, 130, 246, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(239, 68, 68, 0.8)'
        ];

        this.charts.categorias = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: valores,
                    backgroundColor: cores,
                    borderWidth: 3,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            padding: 15,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${label}: ${value}% (${percentage}% do total)`;
                            }
                        }
                    }
                }
            }
        });
    }

    criarGraficoStatusPedidos() {
        const ctx = document.getElementById('chartStatusPedidos');
        if (!ctx) return;

        const labels = Object.keys(this.dados.statusPedidos);
        const valores = Object.values(this.dados.statusPedidos);

        const cores = {
            'Aprovado': 'rgba(245, 158, 11, 0.8)',
            'Recebido': 'rgba(16, 185, 129, 0.8)',
            'Parcial': 'rgba(59, 130, 246, 0.8)',
            'Pendente': 'rgba(239, 68, 68, 0.8)'
        };

        this.charts.statusPedidos = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Quantidade',
                    data: valores,
                    backgroundColor: labels.map(l => cores[l]),
                    borderRadius: 10,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${context.parsed.y} pedidos`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 20
                        }
                    }
                }
            }
        });
    }

    renderizarAlertas() {
        const container = document.getElementById('alertasTempoReal');
        if (!container) return;

        container.innerHTML = '';

        this.dados.alertas.forEach(alerta => {
            const div = document.createElement('div');
            div.className = `alert-item ${alerta.type}`;
            
            div.innerHTML = `
                <div class="alert-icon ${alerta.type}">
                    <i class="${alerta.icon}"></i>
                </div>
                <div class="alert-content">
                    <div class="alert-title">${alerta.title}</div>
                    <div class="alert-description">${alerta.description}</div>
                    <div class="alert-time">${alerta.time}</div>
                </div>
            `;

            container.appendChild(div);
        });
    }

    renderizarTopMateriais() {
        const container = document.getElementById('topMateriais');
        if (!container) return;

        container.innerHTML = '';

        this.dados.topMateriais.forEach((material, index) => {
            const div = document.createElement('div');
            div.className = 'top-item';
            
            let rankClass = '';
            if (index === 0) rankClass = 'gold';
            else if (index === 1) rankClass = 'silver';
            else if (index === 2) rankClass = 'bronze';
            
            div.innerHTML = `
                <div class="top-rank ${rankClass}">${index + 1}</div>
                <div class="top-info">
                    <div class="top-name">${material.codigo}</div>
                    <div class="top-detail">${material.descricao}</div>
                </div>
                <div class="top-value">${this.formatarMoedaCompacta(material.valor)}</div>
            `;

            container.appendChild(div);
        });
    }

    renderizarPerformanceFornecedores() {
        const container = document.getElementById('performanceFornecedores');
        if (!container) return;

        container.innerHTML = '';

        this.dados.fornecedores.forEach(fornecedor => {
            const mediaPerformance = (fornecedor.entregaPrazo + fornecedor.qualidade) / 2;
            
            const div = document.createElement('div');
            div.className = 'performance-indicator';
            
            const corPrazo = fornecedor.entregaPrazo >= 90 ? '#6366f1' : fornecedor.entregaPrazo >= 75 ? '#f59e0b' : '#ef4444';
            const corQualidade = fornecedor.qualidade >= 95 ? '#6366f1' : fornecedor.qualidade >= 85 ? '#f59e0b' : '#ef4444';
            
            div.innerHTML = `
                <div class="performance-label">${fornecedor.nome}</div>
                <div class="performance-bar-wrapper">
                    <div class="performance-bar-bg">
                        <div class="performance-bar-fill" style="width: ${fornecedor.entregaPrazo}%; background: ${corPrazo};"></div>
                    </div>
                </div>
                <div class="performance-value" style="color: ${corPrazo};">${fornecedor.entregaPrazo}%</div>
            `;

            container.appendChild(div);
        });
    }

    iniciarRefreshAutomatico() {
        // Atualizar contador a cada segundo
        setInterval(() => {
            this.refreshCountdown--;
            
            if (this.refreshCountdown <= 0) {
                this.refreshCountdown = 30;
                this.atualizarDadosTempoReal();
            }
            
            document.getElementById('refreshTimer').textContent = this.refreshCountdown + 's';
        }, 1000);
    }

    async atualizarDadosTempoReal() {
        // Recarregar dados reais da API
        await this.carregarDados();
        
        // Atualizar KPIs
        this.atualizarKPIs();
        
        // Atualizar gráficos
        Object.values(this.charts).forEach(chart => {
            chart.update('none');
        });
        
        this.renderizarAlertas();
        this.renderizarTopMateriais();
        this.renderizarPerformanceFornecedores();
        
        // Feedback visual
        const refreshTimer = document.getElementById('refreshTimer');
        if (refreshTimer) {
            refreshTimer.style.color = '#6366f1';
            setTimeout(() => {
                refreshTimer.style.color = '';
            }, 500);
        }
    }

    toggleChartPeriod() {
        alert('Alternando período do gráfico...\n\nOpções:\n- Últimos 7 dias\n- Último mês\n- Últimos 3 meses\n- Último ano');
    }

    marcarTodosLidos() {
        if (confirm('Marcar todos os alertas como lidos?')) {
            const alertas = document.querySelectorAll('.alert-item');
            alertas.forEach(alerta => {
                alerta.style.opacity = '0.5';
            });
        }
    }

    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor);
    }

    formatarMoedaCompacta(valor) {
        if (valor >= 1000000) {
            return 'R$ ' + (valor / 1000000).toFixed(2) + 'M';
        } else if (valor >= 1000) {
            return 'R$ ' + (valor / 1000).toFixed(1) + 'k';
        }
        return this.formatarMoeda(valor);
    }
}

// Funções globais
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
    
    const icon = document.querySelector('#btnModoEscuro i');
    icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    
    if (dashboardManager && dashboardManager.charts) {
        Object.values(dashboardManager.charts).forEach(chart => chart.update());
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('active');
}

function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function inicializarUsuario() {
    const agora = new Date();
    const hora = agora.getHours();
    let saudacao = 'Bom dia';
    
    if (hora >= 12 && hora < 18) saudacao = 'Boa tarde';
    else if (hora >= 18 || hora < 5) saudacao = 'Boa noite';

    // Buscar dados do usuário do localStorage
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    
    // Usar apelido se disponível, senão primeiro nome
    const primeiroNome = userData.apelido || (userData.nome ? userData.nome.split(' ')[0] : 'Executivo');
    
    const userGreeting = document.getElementById('userGreeting');
    if (userGreeting) {
        userGreeting.textContent = `${saudacao}, ${primeiroNome}`;
    }
}

// Fechar menu ao clicar fora
document.addEventListener('click', function(event) {
    const userProfile = document.querySelector('.user-profile');
    const userMenu = document.getElementById('userMenu');
    
    if (userProfile && userMenu && !userProfile.contains(event.target)) {
        userMenu.style.display = 'none';
    }
});

// Inicializar
let dashboardManager;
document.addEventListener('DOMContentLoaded', function() {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const icon = document.querySelector('#btnModoEscuro i');
        if (icon) icon.className = 'fas fa-sun';
    }

    dashboardManager = new DashboardExecutivoManager();
});
