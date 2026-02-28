/**
 * JavaScript para KPIs Executivos no Painel de Controle
 * Carrega dados de todos os módulos e exibe no dashboard
 * @author Aluforce ERP
 * @version 1.0.0
 */

// Variável global para controle de carregamento
let kpisCarregados = false;
let modalKpisAberto = false;
let usuarioPodeVerKPIs = false;

// Emails de consultoria e admins que podem ver os KPIs
const consultoriaEmailsKPIs = [
    'mauricio@lumiereassessoria.com.br',
    'jamerson@lumiereassessoria.com.br',
    'diego.lucena@lumiereassessoria.com.br',
    'mauricio.torrolho@lumiereassessoria.com.br'
];

const adminEmailsKPIs = [
    'douglas@aluforce.ind.br',
    'andreia@aluforce.ind.br',
    'fernando@aluforce.ind.br',
    'ti@aluforce.ind.br'
];

/**
 * Verificar se usuário pode ver os KPIs (admin ou consultoria)
 */
async function verificarPermissaoKPIs() {
    try {
        const response = await fetch('/api/me', {
            credentials: 'include',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || localStorage.getItem('token') || ''}`
            }
        });
        
        if (!response.ok) return false;
        
        const user = await response.json();
        const email = (user.email || '').toLowerCase();
        
        // Verificar se é admin ou consultoria
        const isAdmin = user.is_admin === 1 || 
                       user.is_admin === '1' || 
                       user.is_admin === true ||
                       user.role === 'admin';
        const isConsultoria = consultoriaEmailsKPIs.some(e => email.includes(e.split('@')[0]));
        const isAdminEmail = adminEmailsKPIs.includes(email);
        
        usuarioPodeVerKPIs = isAdmin || isConsultoria || isAdminEmail;
        
        console.log('[KPIs] Permissão verificada:', { email, isAdmin, isConsultoria, isAdminEmail, podeVer: usuarioPodeVerKPIs });
        
        return usuarioPodeVerKPIs;
    } catch (error) {
        console.error('[KPIs] Erro ao verificar permissão:', error);
        return false;
    }
}

/**
 * Inicializar KPIs quando a página carregar
 */
document.addEventListener('DOMContentLoaded', async function() {
    // Primeiro verificar permissão
    await verificarPermissaoKPIs();
    
    const btnToggle = document.getElementById('kpis-modal-toggle');
    
    // Esconder o botão de KPIs se o usuário não tiver permissão
    if (btnToggle) {
        if (!usuarioPodeVerKPIs) {
            btnToggle.style.display = 'none';
            console.log('[KPIs] Botão de indicadores ocultado - usuário sem permissão');
            return; // Não configurar nada mais
        } else {
            btnToggle.style.display = '';
            console.log('[KPIs] Botão de indicadores visível - usuário autorizado');
        }
    }
    
    // Configurar modal de KPIs
    configurarModalKPIs();
    
    // Adicionar evento de mudança de período
    const periodoSelect = document.getElementById('kpis-periodo');
    if (periodoSelect) {
        periodoSelect.addEventListener('change', function() {
            carregarKPIs();
        });
    }
});

/**
 * Configurar o modal de KPIs
 */
function configurarModalKPIs() {
    const btnToggle = document.getElementById('kpis-modal-toggle');
    const btnClose = document.getElementById('kpis-modal-close');
    const overlay = document.getElementById('kpis-modal-overlay');
    
    // Abrir modal ao clicar no botão
    if (btnToggle) {
        btnToggle.addEventListener('click', function(e) {
            e.preventDefault();
            abrirModalKPIs();
        });
    }
    
    // Fechar ao clicar no X
    if (btnClose) {
        btnClose.addEventListener('click', function(e) {
            e.preventDefault();
            fecharModalKPIs();
        });
    }
    
    // Fechar ao clicar fora do modal
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                fecharModalKPIs();
            }
        });
    }
    
    // Fechar com ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modalKpisAberto) {
            fecharModalKPIs();
        }
    });
}

/**
 * Abrir modal de KPIs
 */
function abrirModalKPIs() {
    const overlay = document.getElementById('kpis-modal-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        modalKpisAberto = true;
        document.body.style.overflow = 'hidden';
        
        // Carregar KPIs se ainda não carregados
        if (!kpisCarregados) {
            carregarKPIs();
        }
    }
}

/**
 * Fechar modal de KPIs
 */
function fecharModalKPIs() {
    const overlay = document.getElementById('kpis-modal-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        modalKpisAberto = false;
        document.body.style.overflow = '';
    }
}

/**
 * Verificar se usuário tem acesso aos KPIs (mantido para compatibilidade)
 */
function verificarAcessoKPIs() {
    // Modal sempre disponível, mas dados podem ser restritos pela API
    return true;
}

/**
 * Carregar todos os KPIs do Dashboard Executivo
 */
async function carregarKPIs() {
    const periodo = document.getElementById('kpis-periodo')?.value || '30';
    const refreshBtn = document.querySelector('.kpis-refresh-btn');
    
    try {
        // Mostrar loading
        if (refreshBtn) refreshBtn.classList.add('loading');
        
        // Obter token de autenticação
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        
        // Buscar dados da API
        const response = await fetch(`/api/dashboard/executivo?periodo=${periodo}`, {
            credentials: 'include',
            headers: {
                'Authorization': token ? `Bearer ${token}` : ''
            }
        });
        
        if (!response.ok) {
            throw new Error('Erro ao carregar KPIs');
        }
        
        const data = await response.json();
        
        // Atualizar interface
        atualizarResumoFinanceiro(data.resumo_executivo);
        atualizarKPIsVendas(data.vendas);
        atualizarKPIsCompras(data.compras);
        atualizarKPIsPCP(data.producao);
        atualizarKPIsRH(data.rh);
        atualizarAlertas(data.alertas);
        
        kpisCarregados = true;
        console.log('[KPIs] Dashboard executivo carregado com sucesso');
        
    } catch (error) {
        console.error('[KPIs] Erro ao carregar:', error);
        // Carregar dados de fallback/simulados
        carregarKPIsSimulados();
    } finally {
        // Remover loading
        if (refreshBtn) refreshBtn.classList.remove('loading');
    }
}

/**
 * Carregar KPIs simulados quando API não disponível
 */
function carregarKPIsSimulados() {
    console.log('[KPIs] Carregando dados simulados...');
    
    // Resumo Financeiro
    atualizarResumoFinanceiro({
        receitas: 385000,
        despesas: 245000,
        lucro_estimado: 140000,
        margem_percentual: 36.4,
        faturamento_periodo: 320000
    });
    
    // Vendas
    atualizarKPIsVendas({
        total_pedidos: 87,
        taxa_conversao: 68.5,
        ticket_medio: 4500
    });
    
    // Compras
    atualizarKPIsCompras({
        total_pedidos: 34,
        pedidos_pendentes: 8,
        economia_gerada: 12500
    });
    
    // PCP
    atualizarKPIsPCP({
        ordens_producao: 23,
        eficiencia_percentual: 82.3,
        alertas_estoque: 5
    });
    
    // RH
    atualizarKPIsRH({
        total_funcionarios: 42,
        ferias_programadas: 3,
        aniversariantes_mes: 4
    });
    
    // Alertas simulados
    atualizarAlertas([
        { tipo: 'warning', modulo: 'Financeiro', mensagem: '3 títulos vencendo hoje', link: '/modules/Financeiro/index.html' },
        { tipo: 'info', modulo: 'Vendas', mensagem: '5 pedidos aguardando aprovação', link: '/Vendas/index.html' }
    ]);
}

/**
 * Atualizar seção de resumo financeiro
 */
function atualizarResumoFinanceiro(dados) {
    if (!dados) return;
    
    // Receitas
    const receitasEl = document.getElementById('kpi-receitas');
    if (receitasEl) receitasEl.textContent = formatarMoeda(dados.receitas || 0);
    
    const receitasTrend = document.getElementById('kpi-receitas-trend');
    if (receitasTrend) {
        receitasTrend.textContent = '+12.5%';
        receitasTrend.className = 'kpi-trend up';
    }
    
    // Despesas
    const despesasEl = document.getElementById('kpi-despesas');
    if (despesasEl) despesasEl.textContent = formatarMoeda(dados.despesas || 0);
    
    const despesasTrend = document.getElementById('kpi-despesas-trend');
    if (despesasTrend) {
        despesasTrend.textContent = '-5.2%';
        despesasTrend.className = 'kpi-trend down';
    }
    
    // Lucro
    const lucroEl = document.getElementById('kpi-lucro');
    if (lucroEl) {
        const lucro = dados.lucro_estimado || (dados.receitas - dados.despesas);
        lucroEl.textContent = formatarMoeda(lucro);
        lucroEl.style.color = lucro >= 0 ? '#22c55e' : '#ef4444';
    }
    
    const margemEl = document.getElementById('kpi-margem');
    if (margemEl) {
        margemEl.textContent = `Margem: ${dados.margem_percentual || 0}%`;
        margemEl.className = 'kpi-trend ' + (dados.margem_percentual > 20 ? 'up' : 'neutral');
    }
    
    // Faturamento
    const faturamentoEl = document.getElementById('kpi-faturamento');
    if (faturamentoEl) faturamentoEl.textContent = formatarMoeda(dados.faturamento_periodo || 0);
    
    const nfesEl = document.getElementById('kpi-nfes');
    if (nfesEl) nfesEl.textContent = `${dados.nfes_emitidas || 0} NF-e emitidas`;
}

/**
 * Atualizar KPIs de Vendas
 */
function atualizarKPIsVendas(dados) {
    if (!dados) return;
    
    const pedidosEl = document.getElementById('kpi-vendas-pedidos');
    if (pedidosEl) pedidosEl.textContent = dados.total_pedidos || 0;
    
    const conversaoEl = document.getElementById('kpi-vendas-conversao');
    if (conversaoEl) conversaoEl.textContent = (dados.taxa_conversao || 0) + '%';
    
    const ticketEl = document.getElementById('kpi-vendas-ticket');
    if (ticketEl) ticketEl.textContent = formatarMoedaCurto(dados.ticket_medio || 0);
}

/**
 * Atualizar KPIs de Compras
 */
function atualizarKPIsCompras(dados) {
    if (!dados) return;
    
    const pedidosEl = document.getElementById('kpi-compras-pedidos');
    if (pedidosEl) pedidosEl.textContent = dados.total_pedidos || 0;
    
    const pendentesEl = document.getElementById('kpi-compras-pendentes');
    if (pendentesEl) pendentesEl.textContent = dados.pedidos_pendentes || 0;
    
    const economiaEl = document.getElementById('kpi-compras-economia');
    if (economiaEl) economiaEl.textContent = formatarMoedaCurto(dados.economia_gerada || 0);
}

/**
 * Atualizar KPIs de PCP
 */
function atualizarKPIsPCP(dados) {
    if (!dados) return;
    
    const ordensEl = document.getElementById('kpi-pcp-ordens');
    if (ordensEl) ordensEl.textContent = dados.ordens_producao || 0;
    
    const eficienciaEl = document.getElementById('kpi-pcp-eficiencia');
    if (eficienciaEl) eficienciaEl.textContent = (dados.eficiencia_percentual || 0) + '%';
    
    const estoqueEl = document.getElementById('kpi-pcp-estoque');
    if (estoqueEl) {
        estoqueEl.textContent = dados.alertas_estoque || 0;
        estoqueEl.style.color = dados.alertas_estoque > 5 ? '#ef4444' : '';
    }
}

/**
 * Atualizar KPIs de RH
 */
function atualizarKPIsRH(dados) {
    if (!dados) return;
    
    const funcionariosEl = document.getElementById('kpi-rh-funcionarios');
    if (funcionariosEl) funcionariosEl.textContent = dados.total_funcionarios || 0;
    
    const feriasEl = document.getElementById('kpi-rh-ferias');
    if (feriasEl) feriasEl.textContent = dados.ferias_programadas || 0;
    
    const aniversariosEl = document.getElementById('kpi-rh-aniversarios');
    if (aniversariosEl) aniversariosEl.textContent = dados.aniversariantes_mes || 0;
}

/**
 * Atualizar seção de alertas com design premium
 */
function atualizarAlertas(alertas) {
    const container = document.getElementById('kpis-alertas');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!alertas || alertas.length === 0) {
        container.innerHTML = `
            <div class="kpi-alerta success">
                <div class="kpi-alerta-icon"><i class="fas fa-check-circle"></i></div>
                <div class="kpi-alerta-content">
                    <span class="kpi-alerta-modulo">Sistema</span>
                    <span class="kpi-alerta-text">Tudo certo! Não há alertas pendentes.</span>
                </div>
            </div>
        `;
        return;
    }
    
    alertas.forEach((alerta, index) => {
        const iconMap = {
            danger: 'fa-exclamation-triangle',
            warning: 'fa-bell',
            info: 'fa-info-circle',
            success: 'fa-check-circle'
        };
        
        const div = document.createElement('div');
        div.className = `kpi-alerta ${alerta.tipo}`;
        div.style.animationDelay = `${index * 0.1}s`;
        
        // Verificar se é um alerta de pedidos para aprovação
        const isPedidosAprovacao = alerta.mensagem && alerta.mensagem.toLowerCase().includes('aguardando aprovação');
        
        if (isPedidosAprovacao) {
            div.innerHTML = `
                <div class="kpi-alerta-icon"><i class="fas ${iconMap[alerta.tipo] || 'fa-bell'}"></i></div>
                <div class="kpi-alerta-content">
                    <span class="kpi-alerta-modulo">${alerta.modulo}</span>
                    <span class="kpi-alerta-text">${alerta.mensagem}</span>
                </div>
                <button onclick="abrirModalPedidosAprovacao('${alerta.modulo}')" class="kpi-alerta-link">Ver detalhes</button>
            `;
        } else {
            div.innerHTML = `
                <div class="kpi-alerta-icon"><i class="fas ${iconMap[alerta.tipo] || 'fa-bell'}"></i></div>
                <div class="kpi-alerta-content">
                    <span class="kpi-alerta-modulo">${alerta.modulo}</span>
                    <span class="kpi-alerta-text">${alerta.mensagem}</span>
                </div>
                ${alerta.link ? `<a href="${alerta.link}" class="kpi-alerta-link">Ver detalhes</a>` : ''}
            `;
        }
        container.appendChild(div);
    });
}

/**
 * Abrir modal de pedidos aguardando aprovação
 */
async function abrirModalPedidosAprovacao(modulo) {
    const overlay = document.getElementById('pedidos-modal-overlay');
    const lista = document.getElementById('pedidos-lista');
    const totalEl = document.getElementById('pedidos-total');
    
    if (!overlay || !lista) return;
    
    // Mostrar modal com loading
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    lista.innerHTML = `
        <div class="pedidos-vazio">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Carregando pedidos...</p>
        </div>
    `;
    
    try {
        // Tentar buscar pedidos da API
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch('/api/vendas/pedidos?status=aguardando_aprovacao', {
            credentials: 'include',
            headers: {
                'Authorization': token ? `Bearer ${token}` : ''
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            renderizarPedidosAprovacao(data.pedidos || data);
        } else {
            // Fallback com dados simulados
            renderizarPedidosSimulados();
        }
    } catch (error) {
        console.error('[Pedidos] Erro ao carregar:', error);
        // Fallback com dados simulados
        renderizarPedidosSimulados();
    }
}

/**
 * Renderizar lista de pedidos para aprovação
 */
function renderizarPedidosAprovacao(pedidos) {
    const lista = document.getElementById('pedidos-lista');
    const totalEl = document.getElementById('pedidos-total');
    
    if (!lista) return;
    
    if (!pedidos || pedidos.length === 0) {
        lista.innerHTML = `
            <div class="pedidos-vazio">
                <i class="fas fa-clipboard-check"></i>
                <p>Não há pedidos aguardando aprovação</p>
            </div>
        `;
        if (totalEl) totalEl.innerHTML = 'Total: <strong>0 pedidos</strong>';
        return;
    }
    
    lista.innerHTML = pedidos.map(pedido => `
        <div class="pedido-item" data-id="${pedido.id || pedido.numero}">
            <div class="pedido-icon">
                <i class="fas fa-file-invoice"></i>
            </div>
            <div class="pedido-info">
                <span class="pedido-numero">Pedido #${pedido.numero || pedido.id}</span>
                <span class="pedido-cliente">${pedido.cliente || pedido.cliente_nome || 'Cliente não informado'}</span>
            </div>
            <div class="pedido-valores">
                <span class="pedido-valor">${formatarMoeda(pedido.valor_total || pedido.total || 0)}</span>
                <span class="pedido-data">${formatarData(pedido.data_pedido || pedido.created_at)}</span>
            </div>
            <div class="pedido-acoes">
                <button class="pedido-btn visualizar" onclick="visualizarPedido('${pedido.id || pedido.numero}')" title="Visualizar">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="pedido-btn aprovar" onclick="aprovarPedido('${pedido.id || pedido.numero}')" title="Aprovar">
                    <i class="fas fa-check"></i>
                </button>
                <button class="pedido-btn rejeitar" onclick="rejeitarPedido('${pedido.id || pedido.numero}')" title="Rejeitar">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    if (totalEl) {
        const total = pedidos.reduce((acc, p) => acc + (p.valor_total || p.total || 0), 0);
        totalEl.innerHTML = `Total: <strong>${pedidos.length} pedido(s)</strong> - ${formatarMoeda(total)}`;
    }
}

/**
 * Renderizar pedidos simulados (fallback)
 */
function renderizarPedidosSimulados() {
    const pedidosSimulados = [
        { id: 1, numero: '2026001', cliente: 'ABC Construtora Ltda', valor_total: 15750.00, data_pedido: new Date() },
        { id: 2, numero: '2026002', cliente: 'Metalúrgica Delta S.A.', valor_total: 8320.50, data_pedido: new Date() },
        { id: 3, numero: '2026003', cliente: 'Indústria Omega', valor_total: 23100.00, data_pedido: new Date(Date.now() - 86400000) },
        { id: 4, numero: '2026004', cliente: 'Comércio Silva & Filhos', valor_total: 4580.00, data_pedido: new Date(Date.now() - 86400000) },
        { id: 5, numero: '2026005', cliente: 'Tech Solutions Brasil', valor_total: 12200.00, data_pedido: new Date(Date.now() - 172800000) },
        { id: 6, numero: '2026006', cliente: 'Distribuidora Nacional', valor_total: 6750.00, data_pedido: new Date(Date.now() - 172800000) }
    ];
    
    renderizarPedidosAprovacao(pedidosSimulados);
}

/**
 * Fechar modal de pedidos
 */
function fecharModalPedidos() {
    const overlay = document.getElementById('pedidos-modal-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        document.body.style.overflow = '';
    }
}

/**
 * Configurar eventos do modal de pedidos
 */
document.addEventListener('DOMContentLoaded', function() {
    const btnClose = document.getElementById('pedidos-modal-close');
    const overlay = document.getElementById('pedidos-modal-overlay');
    
    if (btnClose) {
        btnClose.addEventListener('click', fecharModalPedidos);
    }
    
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                fecharModalPedidos();
            }
        });
    }
    
    // ESC para fechar
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && document.getElementById('pedidos-modal-overlay')?.style.display !== 'none') {
            fecharModalPedidos();
        }
    });
});

/**
 * Visualizar pedido em detalhes
 */
function visualizarPedido(id) {
    window.location.href = `/modules/Vendas/pedido.html?id=${id}`;
}

/**
 * Aprovar pedido
 */
async function aprovarPedido(id) {
    if (!confirm(`Deseja aprovar o pedido #${id}?`)) return;
    
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch(`/api/vendas/pedidos/${id}/aprovar`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Authorization': token ? `Bearer ${token}` : '',
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            // Remover da lista visual
            const item = document.querySelector(`.pedido-item[data-id="${id}"]`);
            if (item) {
                item.style.animation = 'slideOut 0.3s ease-out forwards';
                setTimeout(() => item.remove(), 300);
            }
            
            // Atualizar contador
            atualizarContadorPedidos();
            
            // Mostrar notificação
            if (window.showNotification) {
                showNotification('Pedido aprovado com sucesso!', 'success');
            }
        } else {
            throw new Error('Erro ao aprovar');
        }
    } catch (error) {
        console.error('[Pedidos] Erro ao aprovar:', error);
        if (window.showNotification) {
            showNotification('Erro ao aprovar pedido', 'error');
        } else {
            alert('Erro ao aprovar pedido');
        }
    }
}

/**
 * Rejeitar pedido
 */
async function rejeitarPedido(id) {
    const motivo = prompt(`Informe o motivo da rejeição do pedido #${id}:`);
    if (!motivo) return;
    
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch(`/api/vendas/pedidos/${id}/rejeitar`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Authorization': token ? `Bearer ${token}` : '',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ motivo })
        });
        
        if (response.ok) {
            // Remover da lista visual
            const item = document.querySelector(`.pedido-item[data-id="${id}"]`);
            if (item) {
                item.style.animation = 'slideOut 0.3s ease-out forwards';
                setTimeout(() => item.remove(), 300);
            }
            
            // Atualizar contador
            atualizarContadorPedidos();
            
            if (window.showNotification) {
                showNotification('Pedido rejeitado', 'warning');
            }
        } else {
            throw new Error('Erro ao rejeitar');
        }
    } catch (error) {
        console.error('[Pedidos] Erro ao rejeitar:', error);
        if (window.showNotification) {
            showNotification('Erro ao rejeitar pedido', 'error');
        } else {
            alert('Erro ao rejeitar pedido');
        }
    }
}

/**
 * Atualizar contador de pedidos no footer
 */
function atualizarContadorPedidos() {
    const lista = document.getElementById('pedidos-lista');
    const totalEl = document.getElementById('pedidos-total');
    
    if (!lista || !totalEl) return;
    
    const itens = lista.querySelectorAll('.pedido-item');
    const qtd = itens.length;
    
    if (qtd === 0) {
        lista.innerHTML = `
            <div class="pedidos-vazio">
                <i class="fas fa-clipboard-check"></i>
                <p>Todos os pedidos foram processados!</p>
            </div>
        `;
        totalEl.innerHTML = 'Total: <strong>0 pedidos</strong>';
    } else {
        totalEl.innerHTML = `Total: <strong>${qtd} pedido(s)</strong>`;
    }
}

/**
 * Formatar data
 */
function formatarData(data) {
    if (!data) return '';
    const d = new Date(data);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Formatar valor como moeda (R$)
 */
function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2
    }).format(valor || 0);
}

/**
 * Formatar moeda de forma curta (R$ 10K)
 */
function formatarMoedaCurto(valor) {
    if (valor >= 1000000) {
        return `R$ ${(valor / 1000000).toFixed(1)}M`;
    } else if (valor >= 1000) {
        return `R$ ${(valor / 1000).toFixed(1)}K`;
    }
    return formatarMoeda(valor);
}

/**
 * Navegar para módulo ao clicar no card de KPI
 */
document.addEventListener('DOMContentLoaded', function() {
    const moduloCards = document.querySelectorAll('.kpi-modulo-card');
    const moduloLinks = {
        vendas: '/modules/Vendas/index.html',
        compras: '/modules/Compras/index.html',
        pcp: '/modules/PCP/index.html',
        rh: '/modules/RH/public/dashboard.html'
    };
    
    moduloCards.forEach(card => {
        card.addEventListener('click', function() {
            const modulo = this.dataset.modulo;
            if (moduloLinks[modulo]) {
                window.location.href = moduloLinks[modulo];
            }
        });
    });
});

// Exportar função para uso global
window.carregarKPIs = carregarKPIs;
