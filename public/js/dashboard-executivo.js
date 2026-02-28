/**
 * COMPONENTE: DASHBOARD EXECUTIVO
 * Widget de KPIs consolidados para o Painel de Controle
 * 
 * @author Aluforce ERP
 * @version 1.0.0
 * @date 2025-12-19
 */

class DashboardExecutivo {
    constructor(containerId, opcoes = {}) {
        this.container = document.getElementById(containerId);
        this.opcoes = {
            periodo: opcoes.periodo || 30,
            autoRefresh: opcoes.autoRefresh !== false,
            refreshInterval: opcoes.refreshInterval || 60000, // 1 minuto
            apiUrl: opcoes.apiUrl || '/api/dashboard/executivo'
        };
        this.dados = null;
        this.charts = {};
        this.intervalId = null;
    }

    async inicializar() {
        if (!this.container) {
            console.error('[DashboardExecutivo] Container não encontrado');
            return;
        }

        this.renderEstrutura();
        await this.carregarDados();
        
        if (this.opcoes.autoRefresh) {
            this.iniciarAutoRefresh();
        }
    }

    renderEstrutura() {
        this.container.innerHTML = `
            <div class="dashboard-executivo">
                <!-- Header do Dashboard -->
                <div class="dash-exec-header">
                    <div class="dash-exec-title">
                        <i class="fas fa-chart-line"></i>
                        <h2>Dashboard Executivo</h2>
                    </div>
                    <div class="dash-exec-controls">
                        <select id="dash-periodo" class="dash-periodo-select">
                            <option value="7">Últimos 7 dias</option>
                            <option value="15">Últimos 15 dias</option>
                            <option value="30" selected>Últimos 30 dias</option>
                            <option value="60">Últimos 60 dias</option>
                            <option value="90">Últimos 90 dias</option>
                        </select>
                        <button id="dash-refresh" class="dash-refresh-btn" title="Atualizar">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </div>

                <!-- KPIs Principais -->
                <div class="dash-kpis-principais">
                    <div class="kpi-card kpi-faturamento">
                        <div class="kpi-icon"><i class="fas fa-dollar-sign"></i></div>
                        <div class="kpi-content">
                            <span class="kpi-label">Faturamento</span>
                            <span class="kpi-valor" id="kpi-faturamento">R$ 0,00</span>
                            <span class="kpi-trend" id="kpi-faturamento-trend"></span>
                        </div>
                    </div>
                    <div class="kpi-card kpi-receitas">
                        <div class="kpi-icon"><i class="fas fa-arrow-up"></i></div>
                        <div class="kpi-content">
                            <span class="kpi-label">Receitas</span>
                            <span class="kpi-valor" id="kpi-receitas">R$ 0,00</span>
                            <span class="kpi-trend" id="kpi-receitas-trend"></span>
                        </div>
                    </div>
                    <div class="kpi-card kpi-despesas">
                        <div class="kpi-icon"><i class="fas fa-arrow-down"></i></div>
                        <div class="kpi-content">
                            <span class="kpi-label">Despesas</span>
                            <span class="kpi-valor" id="kpi-despesas">R$ 0,00</span>
                            <span class="kpi-trend" id="kpi-despesas-trend"></span>
                        </div>
                    </div>
                    <div class="kpi-card kpi-lucro">
                        <div class="kpi-icon"><i class="fas fa-chart-pie"></i></div>
                        <div class="kpi-content">
                            <span class="kpi-label">Resultado</span>
                            <span class="kpi-valor" id="kpi-lucro">R$ 0,00</span>
                            <span class="kpi-trend" id="kpi-margem"></span>
                        </div>
                    </div>
                </div>

                <!-- Gráficos -->
                <div class="dash-graficos">
                    <div class="dash-grafico-card">
                        <h3><i class="fas fa-chart-area"></i> Faturamento Mensal</h3>
                        <canvas id="chart-faturamento"></canvas>
                    </div>
                    <div class="dash-grafico-card">
                        <h3><i class="fas fa-exchange-alt"></i> Fluxo de Caixa</h3>
                        <canvas id="chart-fluxo-caixa"></canvas>
                    </div>
                </div>

                <!-- KPIs por Módulo -->
                <div class="dash-modulos-grid">
                    <!-- Vendas -->
                    <div class="dash-modulo-card vendas">
                        <div class="modulo-header">
                            <i class="fas fa-shopping-cart"></i>
                            <h4>Vendas</h4>
                        </div>
                        <div class="modulo-kpis">
                            <div class="mini-kpi">
                                <span class="mini-label">Pedidos</span>
                                <span class="mini-valor" id="vendas-pedidos">0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Aprovados</span>
                                <span class="mini-valor" id="vendas-aprovados">0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Ticket Médio</span>
                                <span class="mini-valor" id="vendas-ticket">R$ 0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Conversão</span>
                                <span class="mini-valor" id="vendas-conversao">0%</span>
                            </div>
                        </div>
                        <a href="/modules/Vendas/index.html" class="modulo-link">Ver detalhes →</a>
                    </div>

                    <!-- Compras -->
                    <div class="dash-modulo-card compras">
                        <div class="modulo-header">
                            <i class="fas fa-truck"></i>
                            <h4>Compras</h4>
                        </div>
                        <div class="modulo-kpis">
                            <div class="mini-kpi">
                                <span class="mini-label">Pedidos</span>
                                <span class="mini-valor" id="compras-pedidos">0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Pendentes</span>
                                <span class="mini-valor" id="compras-pendentes">0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Valor Total</span>
                                <span class="mini-valor" id="compras-valor">R$ 0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Economia</span>
                                <span class="mini-valor" id="compras-economia">R$ 0</span>
                            </div>
                        </div>
                        <a href="/modules/Compras/index.html" class="modulo-link">Ver detalhes →</a>
                    </div>

                    <!-- Financeiro -->
                    <div class="dash-modulo-card financeiro">
                        <div class="modulo-header">
                            <i class="fas fa-wallet"></i>
                            <h4>Financeiro</h4>
                        </div>
                        <div class="modulo-kpis">
                            <div class="mini-kpi">
                                <span class="mini-label">A Receber</span>
                                <span class="mini-valor" id="fin-receber">R$ 0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">A Pagar</span>
                                <span class="mini-valor" id="fin-pagar">R$ 0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Saldo</span>
                                <span class="mini-valor" id="fin-saldo">R$ 0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Vencidos</span>
                                <span class="mini-valor danger" id="fin-vencidos">R$ 0</span>
                            </div>
                        </div>
                        <a href="/modules/Financeiro/index.html" class="modulo-link">Ver detalhes →</a>
                    </div>

                    <!-- PCP -->
                    <div class="dash-modulo-card pcp">
                        <div class="modulo-header">
                            <i class="fas fa-industry"></i>
                            <h4>Produção</h4>
                        </div>
                        <div class="modulo-kpis">
                            <div class="mini-kpi">
                                <span class="mini-label">Ordens</span>
                                <span class="mini-valor" id="pcp-ordens">0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Em Andamento</span>
                                <span class="mini-valor" id="pcp-andamento">0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Eficiência</span>
                                <span class="mini-valor" id="pcp-eficiencia">0%</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Atrasadas</span>
                                <span class="mini-valor danger" id="pcp-atrasadas">0</span>
                            </div>
                        </div>
                        <a href="/modules/PCP/index.html" class="modulo-link">Ver detalhes →</a>
                    </div>

                    <!-- RH -->
                    <div class="dash-modulo-card rh">
                        <div class="modulo-header">
                            <i class="fas fa-users"></i>
                            <h4>RH</h4>
                        </div>
                        <div class="modulo-kpis">
                            <div class="mini-kpi">
                                <span class="mini-label">Funcionários</span>
                                <span class="mini-valor" id="rh-funcionarios">0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Férias</span>
                                <span class="mini-valor" id="rh-ferias">0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Folha</span>
                                <span class="mini-valor" id="rh-folha">R$ 0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Aniversários</span>
                                <span class="mini-valor" id="rh-aniversarios">0</span>
                            </div>
                        </div>
                        <a href="/modules/RH/public/pages/dashboard.html" class="modulo-link">Ver detalhes →</a>
                    </div>

                    <!-- NF-e -->
                    <div class="dash-modulo-card nfe">
                        <div class="modulo-header">
                            <i class="fas fa-file-invoice"></i>
                            <h4>Fiscal</h4>
                        </div>
                        <div class="modulo-kpis">
                            <div class="mini-kpi">
                                <span class="mini-label">NF-e Emitidas</span>
                                <span class="mini-valor" id="nfe-emitidas">0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Valor</span>
                                <span class="mini-valor" id="nfe-valor">R$ 0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Pendentes</span>
                                <span class="mini-valor" id="nfe-pendentes">0</span>
                            </div>
                            <div class="mini-kpi">
                                <span class="mini-label">Canceladas</span>
                                <span class="mini-valor" id="nfe-canceladas">0</span>
                            </div>
                        </div>
                        <a href="/modules/NFe/index.html" class="modulo-link">Ver detalhes →</a>
                    </div>
                </div>

                <!-- Alertas -->
                <div class="dash-alertas" id="dash-alertas">
                    <h3><i class="fas fa-bell"></i> Alertas e Pendências</h3>
                    <div class="alertas-lista" id="alertas-lista">
                        <!-- Alertas serão inseridos aqui -->
                    </div>
                </div>

                <!-- Footer com última atualização -->
                <div class="dash-footer">
                    <span id="dash-ultima-atualizacao">Carregando...</span>
                </div>
            </div>
        `;

        // Adicionar event listeners
        document.getElementById('dash-periodo').addEventListener('change', (e) => {
            this.opcoes.periodo = parseInt(e.target.value);
            this.carregarDados();
        });

        document.getElementById('dash-refresh').addEventListener('click', () => {
            this.carregarDados();
        });
    }

    async carregarDados() {
        const refreshBtn = document.getElementById('dash-refresh');
        if (refreshBtn) {
            refreshBtn.classList.add('loading');
            refreshBtn.querySelector('i').classList.add('fa-spin');
        }

        try {
            const response = await fetch(`${this.opcoes.apiUrl}?periodo=${this.opcoes.periodo}`, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Erro ao carregar dados');
            }

            this.dados = await response.json();
            this.atualizarUI();
            this.atualizarGraficos();

        } catch (error) {
            console.error('[DashboardExecutivo] Erro:', error);
            this.mostrarErro('Erro ao carregar dados do dashboard');
        } finally {
            if (refreshBtn) {
                refreshBtn.classList.remove('loading');
                refreshBtn.querySelector('i').classList.remove('fa-spin');
            }
        }
    }

    atualizarUI() {
        if (!this.dados) return;

        const { resumo_executivo, vendas, compras, financeiro, producao, rh, fiscal, alertas, atualizado_em } = this.dados;

        // KPIs Principais
        this.atualizarElemento('kpi-faturamento', this.formatarMoeda(resumo_executivo?.faturamento_periodo));
        this.atualizarElemento('kpi-receitas', this.formatarMoeda(resumo_executivo?.receitas));
        this.atualizarElemento('kpi-despesas', this.formatarMoeda(resumo_executivo?.despesas));
        this.atualizarElemento('kpi-lucro', this.formatarMoeda(resumo_executivo?.lucro_estimado));
        this.atualizarElemento('kpi-margem', `${resumo_executivo?.margem_percentual || 0}% margem`);

        // Vendas
        this.atualizarElemento('vendas-pedidos', vendas?.total_pedidos || 0);
        this.atualizarElemento('vendas-aprovados', vendas?.pedidos_aprovados || 0);
        this.atualizarElemento('vendas-ticket', this.formatarMoedaCurta(vendas?.ticket_medio));
        this.atualizarElemento('vendas-conversao', `${vendas?.taxa_conversao || 0}%`);

        // Compras
        this.atualizarElemento('compras-pedidos', compras?.total_pedidos || 0);
        this.atualizarElemento('compras-pendentes', compras?.pedidos_pendentes || 0);
        this.atualizarElemento('compras-valor', this.formatarMoedaCurta(compras?.valor_total));
        this.atualizarElemento('compras-economia', this.formatarMoedaCurta(compras?.economia_gerada));

        // Financeiro
        this.atualizarElemento('fin-receber', this.formatarMoedaCurta(financeiro?.contas_receber));
        this.atualizarElemento('fin-pagar', this.formatarMoedaCurta(financeiro?.contas_pagar));
        this.atualizarElemento('fin-saldo', this.formatarMoedaCurta(financeiro?.saldo_atual));
        this.atualizarElemento('fin-vencidos', this.formatarMoedaCurta(financeiro?.contas_receber_vencidas));

        // PCP
        this.atualizarElemento('pcp-ordens', producao?.ordens_producao || 0);
        this.atualizarElemento('pcp-andamento', producao?.ordens_em_andamento || 0);
        this.atualizarElemento('pcp-eficiencia', `${producao?.eficiencia_percentual || 0}%`);
        this.atualizarElemento('pcp-atrasadas', producao?.ordens_atrasadas || 0);

        // RH
        this.atualizarElemento('rh-funcionarios', rh?.total_funcionarios || 0);
        this.atualizarElemento('rh-ferias', rh?.ferias_programadas || 0);
        this.atualizarElemento('rh-folha', this.formatarMoedaCurta(rh?.folha_pagamento));
        this.atualizarElemento('rh-aniversarios', rh?.aniversariantes_mes || 0);

        // NF-e
        this.atualizarElemento('nfe-emitidas', fiscal?.nfes_emitidas || 0);
        this.atualizarElemento('nfe-valor', this.formatarMoedaCurta(fiscal?.valor_emitido));
        this.atualizarElemento('nfe-pendentes', fiscal?.nfes_pendentes || 0);
        this.atualizarElemento('nfe-canceladas', fiscal?.nfes_canceladas || 0);

        // Alertas
        this.renderAlertas(alertas || []);

        // Última atualização
        const dataAtualizacao = atualizado_em ? new Date(atualizado_em) : new Date();
        this.atualizarElemento('dash-ultima-atualizacao', 
            `Última atualização: ${dataAtualizacao.toLocaleString('pt-BR')}`
        );
    }

    atualizarElemento(id, valor) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = valor;
            el.classList.add('updated');
            setTimeout(() => el.classList.remove('updated'), 300);
        }
    }

    renderAlertas(alertas) {
        const container = document.getElementById('alertas-lista');
        if (!container) return;

        if (alertas.length === 0) {
            container.innerHTML = `
                <div class="alerta-vazio">
                    <i class="fas fa-check-circle"></i>
                    <span>Nenhum alerta no momento</span>
                </div>
            `;
            return;
        }

        container.innerHTML = alertas.map(alerta => `
            <div class="alerta-item alerta-${alerta.tipo}">
                <div class="alerta-icon">
                    <i class="fas fa-${this.getIconeAlerta(alerta.tipo)}"></i>
                </div>
                <div class="alerta-content">
                    <span class="alerta-modulo">${alerta.modulo}</span>
                    <span class="alerta-mensagem">${alerta.mensagem}</span>
                </div>
                ${alerta.link ? `<a href="${alerta.link}" class="alerta-link"><i class="fas fa-arrow-right"></i></a>` : ''}
            </div>
        `).join('');
    }

    getIconeAlerta(tipo) {
        const icones = {
            'danger': 'exclamation-circle',
            'warning': 'exclamation-triangle',
            'info': 'info-circle',
            'success': 'check-circle'
        };
        return icones[tipo] || 'bell';
    }

    async atualizarGraficos() {
        // Verificar se Chart.js está disponível
        if (typeof Chart === 'undefined') {
            console.warn('[DashboardExecutivo] Chart.js não carregado');
            return;
        }

        await this.renderGraficoFaturamento();
        await this.renderGraficoFluxoCaixa();
    }

    async renderGraficoFaturamento() {
        const ctx = document.getElementById('chart-faturamento');
        if (!ctx) return;

        try {
            const response = await fetch('/api/dashboard/grafico/faturamento?meses=6');
            const { dados } = await response.json();

            if (this.charts.faturamento) {
                this.charts.faturamento.destroy();
            }

            this.charts.faturamento = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: dados.map(d => d.mes),
                    datasets: [
                        {
                            label: 'Faturado',
                            data: dados.map(d => d.faturado),
                            backgroundColor: 'rgba(59, 130, 246, 0.8)',
                            borderRadius: 4
                        },
                        {
                            label: 'Meta',
                            data: dados.map(d => d.meta),
                            type: 'line',
                            borderColor: '#ef4444',
                            borderDash: [5, 5],
                            fill: false,
                            pointRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
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
        } catch (error) {
            console.error('[Gráfico Faturamento]', error);
        }
    }

    async renderGraficoFluxoCaixa() {
        const ctx = document.getElementById('chart-fluxo-caixa');
        if (!ctx) return;

        try {
            const response = await fetch('/api/dashboard/grafico/fluxo-caixa?dias=15');
            const { dados } = await response.json();

            if (this.charts.fluxoCaixa) {
                this.charts.fluxoCaixa.destroy();
            }

            this.charts.fluxoCaixa = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dados.map(d => new Date(d.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })),
                    datasets: [
                        {
                            label: 'Entradas',
                            data: dados.map(d => d.entradas),
                            borderColor: '#22c55e',
                            backgroundColor: 'rgba(34, 197, 94, 0.1)',
                            fill: true,
                            tension: 0.4
                        },
                        {
                            label: 'Saídas',
                            data: dados.map(d => d.saidas),
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            fill: true,
                            tension: 0.4
                        },
                        {
                            label: 'Saldo',
                            data: dados.map(d => d.saldo),
                            borderColor: '#3b82f6',
                            borderWidth: 3,
                            fill: false,
                            tension: 0.4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    },
                    scales: {
                        y: {
                            ticks: {
                                callback: (value) => 'R$ ' + (value / 1000).toFixed(0) + 'k'
                            }
                        }
                    }
                }
            });
        } catch (error) {
            console.error('[Gráfico Fluxo Caixa]', error);
        }
    }

    iniciarAutoRefresh() {
        this.intervalId = setInterval(() => {
            this.carregarDados();
        }, this.opcoes.refreshInterval);
    }

    pararAutoRefresh() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    formatarMoeda(valor) {
        if (valor === null || valor === undefined) return 'R$ 0,00';
        return parseFloat(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    formatarMoedaCurta(valor) {
        if (valor === null || valor === undefined) return 'R$ 0';
        const num = parseFloat(valor);
        if (num >= 1000000) {
            return 'R$ ' + (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return 'R$ ' + (num / 1000).toFixed(1) + 'k';
        }
        return 'R$ ' + num.toFixed(0);
    }

    mostrarErro(mensagem) {
        const container = document.getElementById('alertas-lista');
        if (container) {
            container.innerHTML = `
                <div class="alerta-item alerta-danger">
                    <div class="alerta-icon"><i class="fas fa-exclamation-circle"></i></div>
                    <div class="alerta-content">
                        <span class="alerta-mensagem">${mensagem}</span>
                    </div>
                </div>
            `;
        }
    }

    destruir() {
        this.pararAutoRefresh();
        Object.values(this.charts).forEach(chart => chart?.destroy());
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

// Auto-inicialização se houver container
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('dashboard-executivo-container');
    if (container) {
        window.dashboardExecutivo = new DashboardExecutivo('dashboard-executivo-container');
        window.dashboardExecutivo.inicializar();
    }
});

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.DashboardExecutivo = DashboardExecutivo;
}
