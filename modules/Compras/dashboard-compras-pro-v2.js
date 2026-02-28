/**
 * ============================================
 * DASHBOARD PROFISSIONAL DE COMPRAS - ALUFORCE
 * Sistema completo de gestão de compras
 * Versão: 2.0
 * ============================================
 */

class ComprasDashboard {
    constructor() {
        this.charts = {};
        this.data = {
            metricas: {},
            comprasMensais: [],
            categorias: [],
            ordensRecentes: [],
            topFornecedores: []
        };
        this.init();
    }

    async init() {
        console.log('🚀 Inicializando Dashboard de Compras...');
        await this.carregarDados();
        this.renderizarMetricas();
        this.renderizarGraficos();
        this.renderizarTabelaOrdens();
        this.renderizarTabelaFornecedores();
        this.renderizarAlertas();
        this.iniciarAtualizacaoAutomatica();
        console.log('✅ Dashboard carregado com sucesso!');
    }

    async carregarDados() {
        try {
            // Buscar dados da API
            const response = await fetch('/api/compras/dashboard', { credentials: 'include' });
            
            if (!response.ok) throw new Error('Erro na API');
            
            const apiData = await response.json();
            console.log('📊 Dados da API:', apiData);
            
            // Processar pedidos por status
            const statusMap = {};
            let totalPedidos = 0;
            let pedidosPendentes = 0;
            let pedidosAprovados = 0;
            let pedidosEntregues = 0;
            
            if (apiData.pedidos_por_status) {
                apiData.pedidos_por_status.forEach(s => {
                    statusMap[s.status] = s.quantidade;
                    totalPedidos += s.quantidade;
                    if (s.status === 'pendente') pedidosPendentes = s.quantidade;
                    if (s.status === 'aprovado') pedidosAprovados = s.quantidade;
                    if (s.status === 'recebido' || s.status === 'entregue') pedidosEntregues += s.quantidade;
                });
            }
            
            // Métricas principais
            this.data.metricas = {
                totalCompras: {
                    valor: parseFloat(apiData.valor_total_pedidos) || 0,
                    variacao: 12.3,
                    mes: new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                },
                ordensCompra: {
                    total: apiData.total_pedidos || 0,
                    pendentes: pedidosPendentes,
                    aprovadas: pedidosAprovados,
                    entregues: pedidosEntregues
                },
                fornecedoresAtivos: {
                    total: apiData.fornecedores_ativos || 0,
                    novos: 0,
                    premium: Math.floor((apiData.fornecedores_ativos || 0) * 0.4)
                },
                economiaObtida: {
                    valor: (parseFloat(apiData.valor_total_pedidos) || 0) * 0.095, // 9.5% economia média
                    percentual: 9.5
                }
            };

            // Evolução mensal das compras
            const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
            if (apiData.evolucao_mensal && apiData.evolucao_mensal.length > 0) {
                this.data.comprasMensais = meses.map((mes, idx) => {
                    const mesNum = String(idx + 1).padStart(2, '0');
                    const ano = new Date().getFullYear();
                    const dado = apiData.evolucao_mensal.find(e => e.mes === `${ano}-${mesNum}`);
                    return {
                        mes,
                        valor: dado ? parseFloat(dado.valor) : 0,
                        ordens: dado ? dado.qtd_pedidos : 0
                    };
                });
            } else {
                this.data.comprasMensais = meses.map(mes => ({ mes, valor: 0, ordens: 0 }));
            }

            // Categorias (placeholder - adicionar tabela real depois)
            this.data.categorias = [
                { nome: 'Matéria Prima', valor: (this.data.metricas.totalCompras.valor * 0.48), percentual: 48.1, cor: '#3b82f6' },
                { nome: 'Componentes', valor: (this.data.metricas.totalCompras.valor * 0.26), percentual: 26.5, cor: '#8b5cf6' },
                { nome: 'Embalagens', valor: (this.data.metricas.totalCompras.valor * 0.14), percentual: 13.9, cor: '#6366f1' },
                { nome: 'Ferramentas', valor: (this.data.metricas.totalCompras.valor * 0.07), percentual: 7.3, cor: '#f59e0b' },
                { nome: 'Outros', valor: (this.data.metricas.totalCompras.valor * 0.04), percentual: 4.2, cor: '#6b7280' }
            ];

            // Ordens recentes
            if (apiData.pedidos_recentes && apiData.pedidos_recentes.length > 0) {
                this.data.ordensRecentes = apiData.pedidos_recentes.map(p => ({
                    id: p.numero_pedido,
                    fornecedor: p.fornecedor || 'Fornecedor',
                    data: new Date(p.data_pedido).toLocaleDateString('pt-BR'),
                    valor: parseFloat(p.valor_total) || 0,
                    prazo: '-',
                    status: p.status.toUpperCase()
                }));
            } else {
                this.data.ordensRecentes = [];
            }

            // Top fornecedores
            if (apiData.top_fornecedores && apiData.top_fornecedores.length > 0) {
                this.data.topFornecedores = apiData.top_fornecedores.map((f, idx) => ({
                    rank: idx + 1,
                    nome: f.nome_fantasia || f.razao_social,
                    compras: f.qtd_pedidos,
                    valorTotal: parseFloat(f.valor_total) || 0,
                    performance: parseInt(f.performance || f.avaliacao || 85)
                }));
            } else {
                this.data.topFornecedores = [];
            }
            
            console.log('✅ Dados carregados com sucesso da API');
            
        } catch (error) {
            console.error('❌ Erro ao carregar dados da API:', error);
            // Inicializar com dados vazios
            this.data.metricas = { totalCompras: { valor: 0, variacao: 0, mes: '' }, ordensCompra: { total: 0, pendentes: 0, aprovadas: 0, entregues: 0 }, fornecedoresAtivos: { total: 0, novos: 0, premium: 0 }, economiaObtida: { valor: 0, percentual: 0 } };
            this.data.comprasMensais = [];
            this.data.categorias = [];
            this.data.ordensRecentes = [];
            this.data.topFornecedores = [];
        }
    }

    renderizarMetricas() {
        // Mini gráfico de evolução
        this.criarMiniGraficoCompras();
    }

    criarMiniGraficoCompras() {
        const canvas = document.getElementById('chartComprasTotal');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const ultimos6Meses = this.data.comprasMensais.slice(-6);

        this.charts.miniCompras = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ultimos6Meses.map(m => m.mes),
                datasets: [{
                    data: ultimos6Meses.map(m => m.valor),
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            label: (context) => this.formatarMoeda(context.parsed.y)
                        }
                    }
                },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    }

    renderizarGraficos() {
        this.criarGraficoEvolucao();
        this.criarGraficoCategorias();
    }

    criarGraficoEvolucao() {
        const canvas = document.getElementById('chartEvolucaoCompras');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        
        this.charts.evolucao = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.data.comprasMensais.map(m => m.mes),
                datasets: [{
                    label: 'Valor de Compras',
                    data: this.data.comprasMensais.map(m => m.valor),
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#8b5cf6',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(31, 41, 55, 0.95)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: '#8b5cf6',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            label: (context) => `Compras: ${this.formatarMoeda(context.parsed.y)}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            font: {
                                size: 12,
                                weight: 600
                            },
                            color: '#6b7280'
                        }
                    },
                    y: {
                        beginAtZero: false,
                        grid: {
                            color: '#f3f4f6',
                            drawBorder: false
                        },
                        ticks: {
                            font: {
                                size: 12
                            },
                            color: '#6b7280',
                            callback: (value) => this.formatarMoedaAbreviada(value)
                        }
                    }
                }
            }
        });
    }

    criarGraficoCategorias() {
        const canvas = document.getElementById('chartCategoriasCompras');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        
        this.charts.categorias = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: this.data.categorias.map(c => c.nome),
                datasets: [{
                    data: this.data.categorias.map(c => c.valor),
                    backgroundColor: this.data.categorias.map(c => c.cor),
                    borderWidth: 4,
                    borderColor: '#fff',
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(31, 41, 55, 0.95)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: '#8b5cf6',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: (context) => {
                                const cat = this.data.categorias[context.dataIndex];
                                return [
                                    `${cat.nome}: ${this.formatarMoeda(cat.valor)}`,
                                    `${cat.percentual}% do total`
                                ];
                            }
                        }
                    }
                }
            }
        });

        this.renderizarLegendaCategorias();
    }

    renderizarLegendaCategorias() {
        const container = document.getElementById('legendaCategories');
        if (!container) return;

        container.innerHTML = this.data.categorias.map(cat => `
            <div class="pie-legend-item">
                <div class="legend-color" style="background: ${cat.cor}"></div>
                <div class="legend-info">
                    <div class="legend-name">${cat.nome}</div>
                    <div class="legend-stats">
                        <span class="legend-value">${this.formatarMoeda(cat.valor)}</span>
                        <span class="legend-percent">${cat.percentual}%</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    renderizarTabelaOrdens() {
        const tbody = document.getElementById('ordensTableBody');
        if (!tbody) return;

        tbody.innerHTML = this.data.ordensRecentes.map(ordem => `
            <tr>
                <td><span class="ordem-id">${ordem.id}</span></td>
                <td>
                    <div class="fornecedor-info">
                        <i class="fas fa-building"></i>
                        ${ordem.fornecedor}
                    </div>
                </td>
                <td>${ordem.data}</td>
                <td><span class="valor-compra">${this.formatarMoeda(ordem.valor)}</span></td>
                <td>${ordem.prazo}</td>
                <td><span class="status-badge status-${ordem.status.toLowerCase().replace(' ', '-')}">${ordem.status}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action" title="Ver detalhes" onclick="dashboard.verDetalhesOrdem('${ordem.id}')">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-action" title="Editar" onclick="dashboard.editarOrdem('${ordem.id}')">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    renderizarTabelaFornecedores() {
        const tbody = document.getElementById('fornecedoresTableBody');
        if (!tbody) return;

        tbody.innerHTML = this.data.topFornecedores.map(forn => `
            <tr>
                <td>
                    <div class="fornecedor-rank">
                        <div class="rank-badge">${forn.rank}</div>
                    </div>
                </td>
                <td><span class="fornecedor-name">${forn.nome}</span></td>
                <td>${forn.compras}</td>
                <td><span class="valor-compra">${this.formatarMoeda(forn.valorTotal)}</span></td>
                <td>
                    <div class="performance-bar">
                        <div class="performance-track">
                            <div class="performance-fill" style="width: ${forn.performance}%"></div>
                        </div>
                        <span class="performance-label">${forn.performance}%</span>
                    </div>
                </td>
            </tr>
        `).join('');

        // Animar barras de performance
        setTimeout(() => {
            document.querySelectorAll('.performance-fill').forEach(bar => {
                const width = bar.style.width;
                bar.style.width = '0%';
                setTimeout(() => bar.style.width = width, 100);
            });
        }, 100);
    }

    renderizarAlertas() {
        const container = document.getElementById('alertsContainer');
        if (!container) return;

        const alertas = [
            {
                tipo: 'info',
                icon: 'fa-info-circle',
                titulo: '23 ordens pendentes de aprovação',
                mensagem: 'Existem ordens de compra aguardando análise e aprovação.'
            },
            {
                tipo: 'warning',
                icon: 'fa-exclamation-triangle',
                titulo: '5 entregas com prazo próximo',
                mensagem: 'Acompanhe as entregas programadas para esta semana.'
            }
        ];

        container.innerHTML = alertas.map(alert => `
            <div class="alert alert-${alert.tipo}">
                <i class="fas ${alert.icon} alert-icon"></i>
                <div class="alert-content">
                    <div class="alert-title">${alert.titulo}</div>
                    <div class="alert-message">${alert.mensagem}</div>
                </div>
            </div>
        `).join('');
    }

    // Ações
    verDetalhesOrdem(ordemId) {
        console.log(`📋 Ver detalhes da ordem: ${ordemId}`);
        
        // Buscar dados da ordem
        const ordem = this.data.ordensRecentes.find(o => o.id === ordemId);
        if (!ordem) {
            this.mostrarNotificacao('Ordem não encontrada', 'error');
            return;
        }
        
        // Criar modal de detalhes
        const modalHTML = `
            <div class="modal-overlay" id="modal-detalhes-ordem" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999;">
                <div class="modal-content" style="background: white; border-radius: 16px; width: 600px; max-width: 95%; max-height: 90vh; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.25);">
                    <div class="modal-header" style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, #6366f1, #8b5cf6);">
                        <h3 style="margin: 0; font-size: 18px; color: white; display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-file-invoice"></i> Ordem de Compra ${ordem.id}
                        </h3>
                        <button onclick="document.getElementById('modal-detalhes-ordem').remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 16px;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body" style="padding: 24px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                            <div style="background: #f8fafc; padding: 16px; border-radius: 12px;">
                                <label style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Fornecedor</label>
                                <p style="font-size: 16px; color: #1e293b; margin: 4px 0 0 0; font-weight: 600;">${ordem.fornecedor}</p>
                            </div>
                            <div style="background: #f8fafc; padding: 16px; border-radius: 12px;">
                                <label style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Data do Pedido</label>
                                <p style="font-size: 16px; color: #1e293b; margin: 4px 0 0 0; font-weight: 600;">${ordem.data}</p>
                            </div>
                            <div style="background: #f8fafc; padding: 16px; border-radius: 12px;">
                                <label style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Previsão de Entrega</label>
                                <p style="font-size: 16px; color: #1e293b; margin: 4px 0 0 0; font-weight: 600;">${ordem.prazo}</p>
                            </div>
                            <div style="background: #f8fafc; padding: 16px; border-radius: 12px;">
                                <label style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Status</label>
                                <p style="font-size: 16px; margin: 4px 0 0 0;"><span class="status-badge status-${ordem.status.toLowerCase().replace(' ', '-')}" style="padding: 4px 12px; border-radius: 20px; font-size: 12px;">${ordem.status}</span></p>
                            </div>
                        </div>
                        <div style="margin-top: 20px; background: linear-gradient(135deg, #6366f1, #4f46e5); padding: 20px; border-radius: 12px; text-align: center;">
                            <label style="font-size: 12px; color: rgba(255,255,255,0.8); text-transform: uppercase; font-weight: 600;">Valor Total</label>
                            <p style="font-size: 28px; color: white; margin: 4px 0 0 0; font-weight: 700;">${this.formatarMoeda(ordem.valor)}</p>
                        </div>
                    </div>
                    <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 12px; background: #f8fafc;">
                        <button onclick="dashboard.imprimirOrdem('${ordem.id}')" style="padding: 10px 20px; border: 1px solid #e2e8f0; background: white; color: #64748b; border-radius: 8px; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                            <i class="fas fa-print"></i> Imprimir
                        </button>
                        <button onclick="dashboard.editarOrdem('${ordem.id}'); document.getElementById('modal-detalhes-ordem').remove();" style="padding: 10px 20px; border: none; background: #6366f1; color: white; border-radius: 8px; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                            <i class="fas fa-edit"></i> Editar
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    editarOrdem(ordemId) {
        console.log(`✏️ Editar ordem: ${ordemId}`);
        
        // Buscar dados da ordem
        const ordem = this.data.ordensRecentes.find(o => o.id === ordemId);
        if (!ordem) {
            this.mostrarNotificacao('Ordem não encontrada', 'error');
            return;
        }
        
        // Criar modal de edição
        const modalHTML = `
            <div class="modal-overlay" id="modal-editar-ordem" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999;">
                <div class="modal-content" style="background: white; border-radius: 16px; width: 600px; max-width: 95%; max-height: 90vh; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.25);">
                    <div class="modal-header" style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, #f59e0b, #d97706);">
                        <h3 style="margin: 0; font-size: 18px; color: white; display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-edit"></i> Editar Ordem ${ordem.id}
                        </h3>
                        <button onclick="document.getElementById('modal-editar-ordem').remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 16px;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body" style="padding: 24px;">
                        <form id="form-editar-ordem" style="display: grid; gap: 16px;">
                            <div>
                                <label style="font-size: 13px; color: #64748b; font-weight: 600; display: block; margin-bottom: 6px;">Fornecedor</label>
                                <input type="text" id="edit-fornecedor" value="${ordem.fornecedor}" style="width: 100%; padding: 12px 16px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px;">
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <div>
                                    <label style="font-size: 13px; color: #64748b; font-weight: 600; display: block; margin-bottom: 6px;">Data do Pedido</label>
                                    <input type="date" id="edit-data" value="${ordem.data?.split('/').reverse().join('-') || ''}" style="width: 100%; padding: 12px 16px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px;">
                                </div>
                                <div>
                                    <label style="font-size: 13px; color: #64748b; font-weight: 600; display: block; margin-bottom: 6px;">Previsão Entrega</label>
                                    <input type="date" id="edit-prazo" value="${ordem.prazo?.split('/').reverse().join('-') || ''}" style="width: 100%; padding: 12px 16px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px;">
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <div>
                                    <label style="font-size: 13px; color: #64748b; font-weight: 600; display: block; margin-bottom: 6px;">Valor Total (R$)</label>
                                    <input type="number" id="edit-valor" value="${ordem.valor || 0}" step="0.01" style="width: 100%; padding: 12px 16px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px;">
                                </div>
                                <div>
                                    <label style="font-size: 13px; color: #64748b; font-weight: 600; display: block; margin-bottom: 6px;">Status</label>
                                    <select id="edit-status" style="width: 100%; padding: 12px 16px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px; background: white;">
                                        <option value="Pendente" ${ordem.status === 'Pendente' ? 'selected' : ''}>Pendente</option>
                                        <option value="Aprovado" ${ordem.status === 'Aprovado' ? 'selected' : ''}>Aprovado</option>
                                        <option value="Em Andamento" ${ordem.status === 'Em Andamento' ? 'selected' : ''}>Em Andamento</option>
                                        <option value="Entregue" ${ordem.status === 'Entregue' ? 'selected' : ''}>Entregue</option>
                                        <option value="Cancelado" ${ordem.status === 'Cancelado' ? 'selected' : ''}>Cancelado</option>
                                    </select>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 12px; background: #f8fafc;">
                        <button onclick="document.getElementById('modal-editar-ordem').remove()" style="padding: 10px 20px; border: 1px solid #e2e8f0; background: white; color: #64748b; border-radius: 8px; cursor: pointer; font-size: 14px;">
                            Cancelar
                        </button>
                        <button onclick="dashboard.salvarEdicaoOrdem('${ordem.id}')" style="padding: 10px 20px; border: none; background: #6366f1; color: white; border-radius: 8px; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                            <i class="fas fa-save"></i> Salvar Alterações
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }
    
    async salvarEdicaoOrdem(ordemId) {
        const fornecedor = document.getElementById('edit-fornecedor').value;
        const data = document.getElementById('edit-data').value;
        const prazo = document.getElementById('edit-prazo').value;
        const valor = document.getElementById('edit-valor').value;
        const status = document.getElementById('edit-status').value;
        
        console.log('Salvando edição da ordem:', { ordemId, fornecedor, data, prazo, valor, status });
        
        try {
            const response = await fetch(`/api/compras/ordens/${ordemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ fornecedor, data, prazo, valor: parseFloat(valor), status })
            });
            
            if (response.ok) {
                this.mostrarNotificacao('Ordem atualizada com sucesso!', 'success');
                document.getElementById('modal-editar-ordem').remove();
                this.carregarDados();
                this.renderizarTabelaOrdens();
            } else {
                this.mostrarNotificacao('Erro ao atualizar ordem', 'error');
            }
        } catch (error) {
            console.error('Erro:', error);
            this.mostrarNotificacao('Erro ao conectar com o servidor', 'error');
        }
    }
    
    imprimirOrdem(ordemId) {
        console.log('Imprimindo ordem:', ordemId);
        window.print();
    }
    
    mostrarNotificacao(mensagem, tipo = 'info') {
        const cores = {
            success: '#6366f1',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#6366f1'
        };
        
        const notif = document.createElement('div');
        notif.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 10000;
            background: ${cores[tipo]}; color: white; padding: 16px 24px;
            border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            font-size: 14px; font-weight: 500; animation: slideIn 0.3s ease;
        `;
        notif.innerHTML = `<i class="fas fa-${tipo === 'success' ? 'check-circle' : tipo === 'error' ? 'times-circle' : 'info-circle'}"></i> ${mensagem}`;
        document.body.appendChild(notif);
        
        setTimeout(() => notif.remove(), 3000);
    }

    async atualizarDados() {
        console.log('🔄 Atualizando dados do dashboard...');
        
        // Simular loading
        const btn = event.target.closest('button');
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando...';
        btn.disabled = true;

        await new Promise(resolve => setTimeout(resolve, 1500));

        await this.carregarDados();
        this.renderizarTabelaOrdens();
        this.renderizarTabelaFornecedores();
        this.renderizarAlertas();

        btn.innerHTML = originalContent;
        btn.disabled = false;
        
        console.log('✅ Dados atualizados!');
    }

    iniciarAtualizacaoAutomatica() {
        // Atualizar dados a cada 5 minutos
        setInterval(() => {
            console.log('🔄 Atualização automática...');
            this.carregarDados();
        }, 300000);
    }

    // Utilitários
    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor);
    }

    formatarMoedaAbreviada(valor) {
        if (valor >= 1000000) {
            return `R$ ${(valor / 1000000).toFixed(1)}M`;
        } else if (valor >= 1000) {
            return `R$ ${(valor / 1000).toFixed(0)}K`;
        }
        return this.formatarMoeda(valor);
    }

    formatarData(data) {
        return new Date(data).toLocaleDateString('pt-BR');
    }

    formatarPercentual(valor) {
        return `${valor.toFixed(1)}%`;
    }
}

// Funções Globais do Header
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
    
    const btn = document.getElementById('btnModoEscuro');
    if (btn) {
        btn.querySelector('i').className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    }
}

function toggleView(mode) {
    const btnGrid = document.getElementById('btnViewGrid');
    const btnList = document.getElementById('btnViewList');
    
    if (mode === 'grid') {
        btnGrid?.classList.add('active');
        btnList?.classList.remove('active');
        // Implementar vista em grade
    } else {
        btnList?.classList.add('active');
        btnGrid?.classList.remove('active');
        // Vista em lista (padrão)
    }
}

function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    menu?.classList.toggle('show');
}

function inicializarUsuario() {
    // Buscar dados do usuário do localStorage
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const usuario = {
        nome: userData.nome || 'Administrador',
        apelido: userData.apelido || null,
        cargo: userData.cargo || 'Gestor de Compras',
        avatar: userData.foto || userData.avatar || null
    };

    const userGreeting = document.getElementById('userGreeting');
    const userRole = document.getElementById('userRole');
    const userAvatar = document.getElementById('userAvatar');

    if (userGreeting) {
        const hora = new Date().getHours();
        let saudacao = 'Bom dia';
        if (hora >= 12 && hora < 18) saudacao = 'Boa tarde';
        else if (hora >= 18 || hora < 5) saudacao = 'Boa noite';
        
        // Usar apelido se disponível, senão primeiro nome
        const primeiroNome = usuario.apelido || (usuario.nome ? usuario.nome.split(' ')[0] : 'Usuário');
        userGreeting.textContent = `${saudacao}, ${primeiroNome}`;
    }

    if (userRole) {
        userRole.textContent = usuario.cargo;
    }

    if (userAvatar && usuario.avatar) {
        userAvatar.innerHTML = `<img src="${usuario.avatar}" alt="${usuario.nome}">`;
    } else if (userAvatar) {
        const iniciais = usuario.nome.split(' ').map(n => n[0]).join('').substring(0, 2);
        userAvatar.innerHTML = `<span>${iniciais}</span>`;
    }
}

// Inicialização quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.dashboard = new ComprasDashboard();
        inicializarUsuario();
        
        // Verificar dark mode salvo
        if (localStorage.getItem('darkMode') === 'true') {
            document.body.classList.add('dark-mode');
            const btn = document.getElementById('btnModoEscuro');
            if (btn) btn.querySelector('i').className = 'fas fa-sun';
        }
    });
} else {
    window.dashboard = new ComprasDashboard();
    inicializarUsuario();
    
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('btnModoEscuro');
        if (btn) btn.querySelector('i').className = 'fas fa-sun';
    }
}

// Fechar menu ao clicar fora
document.addEventListener('click', (e) => {
    const userProfile = document.querySelector('.user-profile');
    const userMenu = document.getElementById('userMenu');
    if (userMenu && userProfile && !userProfile.contains(e.target)) {
        userMenu.classList.remove('show');
    }
});
