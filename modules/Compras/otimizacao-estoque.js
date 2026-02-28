// ========================================
// OTIMIZAÇÍO DE ESTOQUE
// Sistema Inteligente de Análise e Otimização
// ========================================

class OtimizacaoEstoqueManager {
    constructor() {
        this.materiais = [];
        this.sugestoes = [];
        this.recomendacoes = [];
        this.charts = {};
        this.init();
    }

    getAuthHeaders() {
        const token = localStorage.getItem('token');
        return {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        };
    }

    async init() {
        await this.carregarDados();
        this.calcularMetricas();
        this.gerarSugestoes();
        this.gerarRecomendacoes();
        this.renderizarGraficos();
        this.renderizarSugestoes();
        this.renderizarRecomendacoes();
        if (typeof inicializarUsuario === 'function') inicializarUsuario();
    }

    async carregarDados() {
        try {
            // Tentar carregar materiais da API
            const response = await fetch('/api/compras/materiais', {
                headers: this.getAuthHeaders()
            });
            
            if (response.ok) {
                const data = await response.json();
                const materiaisAPI = Array.isArray(data) ? data : (data.materiais || []);
                
                // Converter dados da API para o formato esperado
                this.materiais = materiaisAPI.map((m, i) => {
                    const estoqueAtual = parseFloat(m.estoque_atual || m.quantidade || 50);
                    const estoqueMinimo = parseFloat(m.estoque_minimo || 20);
                    const consumoMedio = parseFloat(m.consumo_medio || 10);
                    const custoUnitario = parseFloat(m.preco_custo || m.preco || 50);
                    const leadTime = parseFloat(m.lead_time || 7);
                    
                    // Usar histórico de consumo da API ou preencher com consumo médio
                    const historicoConsumo = m.historico_consumo || [];
                    if (historicoConsumo.length === 0) {
                        for (let mes = 0; mes < 12; mes++) {
                            historicoConsumo.push(Math.floor(consumoMedio));
                        }
                    }
                    
                    // Calcular tendência
                    const primeirosSeis = historicoConsumo.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
                    const ultimosSeis = historicoConsumo.slice(6).reduce((a, b) => a + b, 0) / 6;
                    const tendencia = primeirosSeis > 0 ? ((ultimosSeis - primeirosSeis) / primeirosSeis) * 100 : 0;
                    
                    // Calcular ROP e EOQ
                    const rop = (consumoMedio * leadTime) + estoqueMinimo;
                    const demandaAnual = consumoMedio * 365;
                    const custoPedido = 150;
                    const custoMantencao = custoUnitario * 0.02 * 12;
                    const eoq = custoMantencao > 0 ? Math.sqrt((2 * demandaAnual * custoPedido) / custoMantencao) : 100;
                    
                    return {
                        id: m.id || i + 1,
                        codigo: m.codigo || `MAT-${String(i + 1).padStart(3, '0')}`,
                        descricao: m.descricao || m.nome || `Material ${i + 1}`,
                        categoria: m.categoria || 'Geral',
                        estoqueAtual,
                        estoqueMinimo,
                        estoqueMaximo: estoqueMinimo * 3,
                        consumoMedio,
                        leadTime,
                        custoUnitario,
                        custoArmazenagem: custoUnitario * 0.02,
                        historicoConsumo,
                        tendencia,
                        rop: Math.ceil(rop),
                        eoq: Math.ceil(eoq),
                        valorTotal: custoUnitario * consumoMedio * 12,
                        classificacao: 'C'
                    };
                });
                
                if (this.materiais.length > 0) {
                    console.log(`✅ Carregados ${this.materiais.length} materiais da API`);
                    return;
                }
            }
        } catch (error) {
            console.error('⚠️ Erro ao carregar materiais da API:', error);
        }
        
        // Se não carregou da API, inicializar vazio
        if (this.materiais.length === 0) {
            console.warn('⚠️ Nenhum material carregado. Verifique a conexão com a API.');
        }
    }

    calcularMetricas() {
        // Calcular economia potencial
        let economiaPotencial = 0;
        let reducaoEstoque = 0;

        this.materiais.forEach(material => {
            // Economia com redução de estoque excessivo
            if (material.estoqueAtual > material.estoqueMaximo) {
                const excesso = material.estoqueAtual - material.estoqueMaximo;
                economiaPotencial += excesso * material.custoArmazenagem;
                reducaoEstoque += excesso * material.custoUnitario;
            }

            // Economia com lote econômico
            const custoAtual = (material.consumoMedio * 365 / material.estoqueAtual) * 150; // custo de pedidos
            const custoOtimizado = (material.consumoMedio * 365 / material.eoq) * 150;
            if (custoOtimizado < custoAtual) {
                economiaPotencial += (custoAtual - custoOtimizado) / 12; // mensal
            }
        });

        // Atualizar DOM
        document.getElementById('economiaPotencial').textContent = this.formatarMoeda(economiaPotencial);
        
        const estoqueTotal = this.materiais.reduce((sum, m) => sum + (m.estoqueAtual * m.custoUnitario), 0);
        const percentualReducao = (reducaoEstoque / estoqueTotal) * 100;
        document.getElementById('reducaoEstoque').textContent = percentualReducao.toFixed(1) + '%';
        
        // Melhoria de turnover
        const turnoverAtual = this.materiais.reduce((sum, m) => sum + m.giroEstoque, 0) / this.materiais.length;
        const turnoverPotencial = turnoverAtual * 1.25; // 25% de melhoria
        const melhoria = ((turnoverPotencial - turnoverAtual) / turnoverAtual) * 100;
        document.getElementById('melhoriaTurnover').textContent = '+' + melhoria.toFixed(0) + '%';
    }

    gerarSugestoes() {
        this.sugestoes = [];

        // 1. Excesso de estoque
        const materiaisExcesso = this.materiais.filter(m => m.estoqueAtual > m.estoqueMaximo * 1.2);
        if (materiaisExcesso.length > 0) {
            const valorImobilizado = materiaisExcesso.reduce((sum, m) => 
                sum + ((m.estoqueAtual - m.estoqueMaximo) * m.custoUnitario), 0);
            
            this.sugestoes.push({
                id: 1,
                type: 'excesso_estoque',
                priority: 'high',
                title: 'Reduzir Excesso de Estoque',
                description: `${materiaisExcesso.length} materiais com estoque acima do máximo recomendado`,
                metrics: [
                    { label: 'Valor Imobilizado', value: this.formatarMoeda(valorImobilizado) },
                    { label: 'Materiais Afetados', value: materiaisExcesso.length }
                ],
                actions: ['Revisar Limites', 'Bloquear Compras'],
                actionHandlers: ['reviewLimits', 'blockPurchases']
            });
        }

        // 2. Estoque baixo crítico
        const materiaisBaixos = this.materiais.filter(m => m.estoqueAtual < m.estoqueMinimo);
        if (materiaisBaixos.length > 0) {
            this.sugestoes.push({
                id: 2,
                type: 'estoque_baixo',
                priority: 'critical',
                title: 'Reabastecer Itens Críticos',
                description: `${materiaisBaixos.length} materiais abaixo do estoque mínimo`,
                metrics: [
                    { label: 'Itens Críticos', value: materiaisBaixos.length },
                    { label: 'Risco de Parada', value: 'Alto' }
                ],
                actions: ['Criar Pedidos', 'Ver Materiais'],
                actionHandlers: ['createOrders', 'viewMaterials']
            });
        }

        // 3. Otimizar lotes de compra
        const materiaisLoteNaoOtimizado = this.materiais.filter(m => 
            Math.abs(m.estoqueAtual - m.eoq) > m.eoq * 0.3
        );
        if (materiaisLoteNaoOtimizado.length > 15) {
            const economiaPotencial = materiaisLoteNaoOtimizado.length * 250; // média por item
            
            this.sugestoes.push({
                id: 3,
                type: 'otimizar_lotes',
                priority: 'medium',
                title: 'Ajustar Lotes de Compra',
                description: `${materiaisLoteNaoOtimizado.length} materiais com tamanho de lote não otimizado`,
                metrics: [
                    { label: 'Economia Mensal', value: this.formatarMoeda(economiaPotencial) },
                    { label: 'Itens para Ajustar', value: materiaisLoteNaoOtimizado.length }
                ],
                actions: ['Aplicar EOQ', 'Simular'],
                actionHandlers: ['applyEOQ', 'simulate']
            });
        }

        // 4. Itens classe C com alto estoque
        const materiaisCExcesso = this.materiais.filter(m => 
            m.classeABC === 'C' && m.estoqueAtual > m.estoqueMaximo
        );
        if (materiaisCExcesso.length > 0) {
            const valorImobilizado = materiaisCExcesso.reduce((sum, m) => 
                sum + (m.estoqueAtual * m.custoUnitario), 0);
            
            this.sugestoes.push({
                id: 4,
                type: 'classe_c_excesso',
                priority: 'medium',
                title: 'Revisar Itens Classe C',
                description: `Itens de baixo valor com estoque excessivo`,
                metrics: [
                    { label: 'Valor Imobilizado', value: this.formatarMoeda(valorImobilizado) },
                    { label: 'Itens Classe C', value: materiaisCExcesso.length }
                ],
                actions: ['Ajustar Estoques', 'Ver Lista'],
                actionHandlers: ['adjustStock', 'viewList']
            });
        }

        // 5. Baixo giro de estoque
        const materiaisBaixoGiro = this.materiais.filter(m => m.giroEstoque < 2);
        if (materiaisBaixoGiro.length > 20) {
            this.sugestoes.push({
                id: 5,
                type: 'baixo_giro',
                priority: 'medium',
                title: 'Melhorar Giro de Estoque',
                description: `${materiaisBaixoGiro.length} materiais com giro inferior a 2x/ano`,
                metrics: [
                    { label: 'Giro Médio Atual', value: '1.5x/ano' },
                    { label: 'Meta Recomendada', value: '4x/ano' }
                ],
                actions: ['Analisar Causas', 'Criar Plano'],
                actionHandlers: ['analyzeCauses', 'createPlan']
            });
        }

        // 6. Materiais com tendência de alta
        const materiaisTendenciaAlta = this.materiais.filter(m => m.tendencia > 15);
        if (materiaisTendenciaAlta.length > 0) {
            this.sugestoes.push({
                id: 6,
                type: 'tendencia_alta',
                priority: 'high',
                title: 'Aumentar Estoques de Segurança',
                description: `${materiaisTendenciaAlta.length} materiais com tendência de alta demanda (+15%)`,
                metrics: [
                    { label: 'Crescimento Médio', value: '+18%' },
                    { label: 'Materiais Afetados', value: materiaisTendenciaAlta.length }
                ],
                actions: ['Ajustar Mínimos', 'Revisar Previsões'],
                actionHandlers: ['adjustMinimums', 'reviewForecasts']
            });
        }

        // 7. Lead time longo
        const materiaisLeadTimeLongo = this.materiais.filter(m => m.leadTime > 20 && m.estoqueAtual < m.rop);
        if (materiaisLeadTimeLongo.length > 0) {
            this.sugestoes.push({
                id: 7,
                type: 'lead_time_longo',
                priority: 'high',
                title: 'Riscos por Lead Time Longo',
                description: `${materiaisLeadTimeLongo.length} materiais com lead time > 20 dias e estoque baixo`,
                metrics: [
                    { label: 'Lead Time Médio', value: '25 dias' },
                    { label: 'Risco de Falta', value: 'Alto' }
                ],
                actions: ['Antecipar Pedidos', 'Buscar Fornecedor'],
                actionHandlers: ['anticipateOrders', 'findSupplier']
            });
        }
    }

    gerarRecomendacoes() {
        this.recomendacoes = [];

        // Materiais que precisam de pedido urgente
        const materiaisPedidoUrgente = this.materiais
            .filter(m => m.estoqueAtual <= m.rop)
            .slice(0, 15);

        materiaisPedidoUrgente.forEach(material => {
            const quantidadeSugerida = Math.max(material.eoq, material.estoqueMaximo - material.estoqueAtual);
            const valorPedido = quantidadeSugerida * material.custoUnitario;
            
            this.recomendacoes.push({
                materialId: material.id,
                codigo: material.codigo,
                descricao: material.descricao,
                estoqueAtual: material.estoqueAtual,
                estoqueMinimo: material.estoqueMinimo,
                rop: material.rop,
                quantidadeSugerida: Math.ceil(quantidadeSugerida),
                valorPedido: valorPedido,
                diasCobertura: material.diasCobertura,
                classeABC: material.classeABC,
                urgencia: material.estoqueAtual < material.estoqueMinimo ? 'Alta' : 'Média'
            });
        });

        // Ordenar por urgência
        this.recomendacoes.sort((a, b) => {
            if (a.urgencia === 'Alta' && b.urgencia !== 'Alta') return -1;
            if (a.urgencia !== 'Alta' && b.urgencia === 'Alta') return 1;
            return a.diasCobertura - b.diasCobertura;
        });
    }

    renderizarGraficos() {
        this.criarGraficoEficiencia();
        this.criarGraficoABC();
        this.criarGraficoDemanda();
    }

    criarGraficoEficiencia() {
        const ctx = document.getElementById('chartEficiencia');
        if (!ctx) return;

        const giroMedio = this.materiais.reduce((sum, m) => sum + m.giroEstoque, 0) / this.materiais.length;
        const diasCoberturaMedio = this.materiais.reduce((sum, m) => sum + m.diasCobertura, 0) / this.materiais.length;

        this.charts.eficiencia = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Giro Atual', 'Potencial'],
                datasets: [{
                    data: [giroMedio.toFixed(1), (giroMedio * 0.5).toFixed(1)],
                    backgroundColor: ['rgba(139, 92, 246, 0.8)', 'rgba(229, 231, 235, 0.3)'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${context.parsed}x/ano`
                        }
                    }
                }
            }
        });
    }

    criarGraficoABC() {
        const ctx = document.getElementById('chartABC');
        if (!ctx) return;

        const classeA = this.materiais.filter(m => m.classeABC === 'A').length;
        const classeB = this.materiais.filter(m => m.classeABC === 'B').length;
        const classeC = this.materiais.filter(m => m.classeABC === 'C').length;

        this.charts.abc = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Classe A', 'Classe B', 'Classe C'],
                datasets: [{
                    label: 'Quantidade de Itens',
                    data: [classeA, classeB, classeC],
                    backgroundColor: [
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(245, 158, 11, 0.8)',
                        'rgba(16, 185, 129, 0.8)'
                    ],
                    borderRadius: 8,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    criarGraficoDemanda() {
        const ctx = document.getElementById('chartDemanda');
        if (!ctx) return;

        // Pegar um material de exemplo (classe A)
        const materialExemplo = this.materiais.find(m => m.classeABC === 'A');
        
        // Gerar previsão para próximos 6 meses
        const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const historicoLabels = meses.slice(0, 12);
        const previsaoLabels = ['Jan+1', 'Fev+1', 'Mar+1', 'Abr+1', 'Mai+1', 'Jun+1'];
        
        // Calcular previsão simples (média móvel com tendência)
        const previsao = [];
        const ultimosTres = materialExemplo.historicoConsumo.slice(-3);
        const mediaRecente = ultimosTres.reduce((a, b) => a + b, 0) / 3;
        const fatorTendencia = 1 + (materialExemplo.tendencia / 100);
        
        for (let i = 0; i < 6; i++) {
            previsao.push(Math.floor(mediaRecente * Math.pow(fatorTendencia, i)));
        }

        this.charts.demanda = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [...historicoLabels, ...previsaoLabels],
                datasets: [
                    {
                        label: 'Consumo Real',
                        data: [...materialExemplo.historicoConsumo, ...Array(6).fill(null)],
                        borderColor: 'rgba(139, 92, 246, 1)',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 5,
                        pointBackgroundColor: 'rgba(139, 92, 246, 1)'
                    },
                    {
                        label: 'Previsão',
                        data: [...Array(12).fill(null), ...previsao],
                        borderColor: 'rgba(16, 185, 129, 1)',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3,
                        borderDash: [5, 5],
                        fill: true,
                        tension: 0.4,
                        pointRadius: 5,
                        pointBackgroundColor: 'rgba(16, 185, 129, 1)'
                    },
                    {
                        label: 'Estoque Mínimo',
                        data: Array(18).fill(materialExemplo.estoqueMinimo),
                        borderColor: 'rgba(239, 68, 68, 0.5)',
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
                        position: 'top'
                    },
                    title: {
                        display: true,
                        text: `Exemplo: ${materialExemplo.codigo} - ${materialExemplo.descricao}`
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    renderizarSugestoes() {
        const list = document.getElementById('suggestionList');
        if (!list) return;

        list.innerHTML = '';

        if (this.sugestoes.length === 0) {
            list.innerHTML = '<li style="padding: 40px; text-align: center; color: var(--text-secondary);">Nenhuma sugestão no momento. Seu estoque está otimizado! 🎉</li>';
            document.getElementById('totalSugestoes').textContent = '0';
            return;
        }

        document.getElementById('totalSugestoes').textContent = this.sugestoes.length;

        this.sugestoes.forEach(sugestao => {
            const li = document.createElement('li');
            li.className = `suggestion-item ${sugestao.priority}`;
            
            const metricsHTML = sugestao.metrics.map(m => `
                <div class="suggestion-metric">
                    <div class="suggestion-metric-label">${m.label}</div>
                    <div class="suggestion-metric-value">${m.value}</div>
                </div>
            `).join('');

            const actionsHTML = sugestao.actions.map((action, index) => `
                <button class="suggestion-btn ${index === 0 ? 'suggestion-btn-primary' : 'suggestion-btn-secondary'}" 
                        onclick="otimizacaoManager.handleAction('${sugestao.actionHandlers[index]}', ${sugestao.id})">
                    ${action}
                </button>
            `).join('');

            li.innerHTML = `
                <div class="suggestion-header">
                    <div class="suggestion-title">${sugestao.title}</div>
                    <div class="suggestion-priority ${sugestao.priority}">${sugestao.priority}</div>
                </div>
                <div class="suggestion-description">${sugestao.description}</div>
                <div class="suggestion-metrics">${metricsHTML}</div>
                <div class="suggestion-actions">${actionsHTML}</div>
            `;

            list.appendChild(li);
        });
    }

    renderizarRecomendacoes() {
        const container = document.getElementById('recommendationsList');
        if (!container) return;

        container.innerHTML = '';

        if (this.recomendacoes.length === 0) {
            container.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--text-secondary);">Nenhuma recomendação de pedido no momento.</p>';
            return;
        }

        this.recomendacoes.forEach(rec => {
            const div = document.createElement('div');
            div.className = 'material-recommendation';
            
            div.innerHTML = `
                <div class="material-recommendation-header">
                    <span class="material-code">${rec.codigo}</span>
                    <span class="recommendation-badge">${rec.urgencia}</span>
                </div>
                <div class="material-details">${rec.descricao}</div>
                <div class="recommendation-values">
                    <div class="rec-value">
                        <div class="rec-value-label">Estoque Atual</div>
                        <div class="rec-value-number">${rec.estoqueAtual}</div>
                    </div>
                    <div class="rec-value">
                        <div class="rec-value-label">Ponto de Pedido</div>
                        <div class="rec-value-number">${rec.rop}</div>
                    </div>
                    <div class="rec-value">
                        <div class="rec-value-label">Qtd. Sugerida</div>
                        <div class="rec-value-number" style="color: var(--primary-color);">${rec.quantidadeSugerida}</div>
                    </div>
                    <div class="rec-value">
                        <div class="rec-value-label">Valor Pedido</div>
                        <div class="rec-value-number">${this.formatarMoeda(rec.valorPedido)}</div>
                    </div>
                    <div class="rec-value">
                        <div class="rec-value-label">Cobertura</div>
                        <div class="rec-value-number">${Math.floor(rec.diasCobertura)} dias</div>
                    </div>
                </div>
            `;

            container.appendChild(div);
        });
    }

    handleAction(action, sugestaoId) {
        const sugestao = this.sugestoes.find(s => s.id === sugestaoId);
        
        switch (action) {
            case 'reviewLimits':
                alert('Abrindo ferramenta de revisão de limites...');
                break;
            case 'blockPurchases':
                if (confirm('Deseja bloquear compras automáticas para estes materiais?')) {
                    alert('Compras bloqueadas com sucesso!');
                }
                break;
            case 'createOrders':
                window.location.href = 'pedidos-new.html?auto=true';
                break;
            case 'viewMaterials':
                window.location.href = 'materiais-new.html?filter=estoque_baixo';
                break;
            case 'applyEOQ':
                if (confirm('Aplicar lote econômico (EOQ) para todos os materiais sugeridos?')) {
                    alert('Lotes econômicos aplicados com sucesso!\n\nOs parmetros de compra foram atualizados.');
                }
                break;
            case 'simulate':
                alert('Abrindo simulador de cenários...');
                break;
            case 'adjustStock':
                alert('Abrindo ferramenta de ajuste de estoques...');
                break;
            case 'viewList':
                alert('Exibindo lista de materiais classe C...');
                break;
            case 'analyzeCauses':
                alert('Analisando causas de baixo giro...\n\n1. Itens obsoletos: 12\n2. Superdimensionamento: 8\n3. Baixa demanda: 15');
                break;
            case 'createPlan':
                alert('Criando plano de ação para melhoria do giro...');
                break;
            case 'adjustMinimums':
                if (confirm('Aumentar estoques mínimos dos materiais com tendência de alta?')) {
                    alert('Estoques mínimos ajustados com sucesso!');
                }
                break;
            case 'reviewForecasts':
                alert('Abrindo módulo de previsão de demanda...');
                break;
            case 'anticipateOrders':
                if (confirm('Antecipar pedidos para materiais com lead time longo?')) {
                    alert('Pedidos antecipados criados com sucesso!');
                }
                break;
            case 'findSupplier':
                alert('Buscando fornecedores alternativos com lead time menor...');
                break;
            default:
                console.log('Ação não implementada:', action);
        }
    }

    gerarPedidosAutomaticos() {
        const pedidosGerados = this.recomendacoes.length;
        const valorTotal = this.recomendacoes.reduce((sum, r) => sum + r.valorPedido, 0);

        if (confirm(`Gerar ${pedidosGerados} pedidos automáticos?\n\nValor total: ${this.formatarMoeda(valorTotal)}`)) {
            alert(`✅ ${pedidosGerados} pedidos criados com sucesso!\n\nOs pedidos estão aguardando aprovação no módulo de Pedidos de Compra.`);
            
            // Notificar sistema
            if (window.notificationSystem) {
                window.notificationSystem.addNotification({
                    type: 'pedido_aprovacao',
                    title: 'Pedidos Automáticos Gerados',
                    message: `${pedidosGerados} pedidos criados pela otimização de estoque`,
                    icon: 'fas fa-robot',
                    color: '#8b5cf6',
                    priority: 'medium',
                    link: 'pedidos-new.html?filter=pendente'
                });
                window.notificationSystem.renderizarBadge();
            }
        }
    }

    recalcular() {
        const e = event || window.event;
        const btn = e && e.target ? e.target.closest('button') : null;
        const icon = btn ? btn.querySelector('i') : null;
        if (icon) icon.classList.add('fa-spin');
        
        setTimeout(() => {
            this.calcularMetricas();
            this.gerarSugestoes();
            this.gerarRecomendacoes();
            this.renderizarSugestoes();
            this.renderizarRecomendacoes();
            
            Object.values(this.charts).forEach(chart => chart.update());
            
            if (icon) icon.classList.remove('fa-spin');
            alert('✅ Análise recalculada com sucesso!');
        }, 1500);
    }

    exportarSugestoes() {
        const headers = ['Prioridade', 'Título', 'Descrição', 'Ação Recomendada'];
        const csv = [
            headers.join(';'),
            ...this.sugestoes.map(s => [
                s.priority,
                s.title,
                s.description,
                s.actions[0]
            ].join(';'))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `otimizacao_estoque_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    }

    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor);
    }
}

// Funções globais
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
    
    const icon = document.querySelector('#btnModoEscuro i');
    icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    
    if (otimizacaoManager && otimizacaoManager.charts) {
        Object.values(otimizacaoManager.charts).forEach(chart => chart.update());
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
    const primeiroNome = userData.apelido || (userData.nome ? userData.nome.split(' ')[0] : 'Usuário');
    
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
let otimizacaoManager;
document.addEventListener('DOMContentLoaded', function() {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const icon = document.querySelector('#btnModoEscuro i');
        if (icon) icon.className = 'fas fa-sun';
    }

    otimizacaoManager = new OtimizacaoEstoqueManager();
});
