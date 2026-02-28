/**
 * ALUFORCE - Dashboard Compras
 * Dashboard profissional para módulo de Compras
 */

function renderDashboard() {
    const container = document.getElementById('dashboard-container');
    
    container.innerHTML = `
        <div class="dashboard-grid">
            <!-- Card: Total de Compras do Mês -->
            <div class="panel" style="background: white; border-radius: 20px; padding: 0; box-shadow: 0 8px 24px rgba(0,0,0,0.08); overflow: hidden; border-top: 5px solid #6366f1;">
                <div style="background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); padding: 24px; border-bottom: 1px solid #a5b4fc;">
                    <h2 style="margin: 0; color: #3730a3; font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 12px;">
                        <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);">
                            <i class="fas fa-shopping-cart" style="font-size: 20px; color: white;"></i>
                        </div>
                        <span>Compras do Mês</span>
                    </h2>
                    <p style="margin: 10px 0 0 56px; color: #4338ca; font-size: 13px; font-weight: 500;">Total de compras realizadas</p>
                </div>
                <div class="panel-body" style="padding: 28px;">
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <div style="font-size: 42px; font-weight: 800; color: #3730a3;" id="total-compras-mes">R$ 0</div>
                        <div style="display: flex; align-items: center; gap: 8px; padding: 12px; background: #eef2ff; border-radius: 10px; border-left: 4px solid #6366f1;">
                            <i class="fas fa-arrow-up" style="color: #6366f1; font-size: 16px;"></i>
                            <span style="color: #4338ca; font-weight: 600; font-size: 14px;">12% vs mês anterior</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;">
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Pedidos</div>
                                <div style="font-size: 24px; font-weight: 700; color: #334155;" id="pedidos-mes">0</div>
                            </div>
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Média</div>
                                <div style="font-size: 24px; font-weight: 700; color: #334155;" id="media-pedido">R$ 0</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Card: Pedidos Pendentes -->
            <div class="panel" style="background: white; border-radius: 20px; padding: 0; box-shadow: 0 8px 24px rgba(0,0,0,0.08); overflow: hidden; border-top: 5px solid #f59e0b;">
                <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 24px; border-bottom: 1px solid #fcd34d;">
                    <h2 style="margin: 0; color: #78350f; font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 12px;">
                        <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.25);">
                            <i class="fas fa-clock" style="font-size: 20px; color: white;"></i>
                        </div>
                        <span>Pedidos Pendentes</span>
                    </h2>
                    <p style="margin: 10px 0 0 56px; color: #92400e; font-size: 13px; font-weight: 500;">Aguardando aprovação/recebimento</p>
                </div>
                <div class="panel-body" style="padding: 28px;">
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; background: #fff7ed; border-radius: 12px; border-left: 4px solid #f59e0b;">
                            <div>
                                <div style="font-size: 11px; color: #9a3412; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Aprovação</div>
                                <div style="font-size: 28px; font-weight: 700; color: #78350f;" id="pedidos-aprovacao">0</div>
                            </div>
                            <div style="padding: 12px; background: #fef3c7; border-radius: 12px;">
                                <i class="fas fa-hourglass-half" style="font-size: 24px; color: #d97706;"></i>
                            </div>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #dbeafe; border-radius: 8px;">
                                <span style="color: #1e3a8a; font-weight: 600; font-size: 14px;"><i class="fas fa-truck" style="margin-right: 8px;"></i>Em Trnsito</span>
                                <span style="font-weight: 700; color: #1e3a8a;" id="pedidos-transito">0</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #dcfce7; border-radius: 8px;">
                                <span style="color: #14532d; font-weight: 600; font-size: 14px;"><i class="fas fa-check-circle" style="margin-right: 8px;"></i>Recebidos</span>
                                <span style="font-weight: 700; color: #14532d;" id="pedidos-recebidos">0</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Card: Fornecedores Ativos -->
            <div class="panel" style="background: white; border-radius: 20px; padding: 0; box-shadow: 0 8px 24px rgba(0,0,0,0.08); overflow: hidden; border-top: 5px solid #3b82f6;">
                <div style="background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); padding: 24px; border-bottom: 1px solid #93c5fd;">
                    <h2 style="margin: 0; color: #1e3a8a; font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 12px;">
                        <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);">
                            <i class="fas fa-truck" style="font-size: 20px; color: white;"></i>
                        </div>
                        <span>Fornecedores</span>
                    </h2>
                    <p style="margin: 10px 0 0 56px; color: #1e40af; font-size: 13px; font-weight: 500;">Base de fornecedores ativos</p>
                </div>
                <div class="panel-body" style="padding: 28px;">
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <div style="font-size: 42px; font-weight: 800; color: #1e3a8a;" id="fornecedores-ativos">0</div>
                        <div style="display: flex; align-items: center; gap: 8px; padding: 12px; background: #f0f9ff; border-radius: 10px; border-left: 4px solid #3b82f6;">
                            <i class="fas fa-plus-circle" style="color: #3b82f6; font-size: 16px;"></i>
                            <span style="color: #1e40af; font-weight: 600; font-size: 14px;">3 novos este mês</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;">
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Nacionais</div>
                                <div style="font-size: 24px; font-weight: 700; color: #334155;" id="fornecedores-nacionais">0</div>
                            </div>
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Import.</div>
                                <div style="font-size: 24px; font-weight: 700; color: #334155;" id="fornecedores-importacao">0</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Card: Materiais em Estoque -->
            <div class="panel" style="background: white; border-radius: 20px; padding: 0; box-shadow: 0 8px 24px rgba(0,0,0,0.08); overflow: hidden; border-top: 5px solid #8b5cf6;">
                <div style="background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%); padding: 24px; border-bottom: 1px solid #c4b5fd;">
                    <h2 style="margin: 0; color: #5b21b6; font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 12px;">
                        <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25);">
                            <i class="fas fa-cubes" style="font-size: 20px; color: white;"></i>
                        </div>
                        <span>Materiais</span>
                    </h2>
                    <p style="margin: 10px 0 0 56px; color: #6b21a8; font-size: 13px; font-weight: 500;">Itens gerenciados</p>
                </div>
                <div class="panel-body" style="padding: 28px;">
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <div style="font-size: 42px; font-weight: 800; color: #5b21b6;" id="total-materiais">0</div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #fef2f2; border-radius: 8px;">
                                <span style="color: #991b1b; font-weight: 600; font-size: 14px;"><i class="fas fa-exclamation-triangle" style="margin-right: 8px;"></i>Estoque Baixo</span>
                                <span style="font-weight: 700; color: #991b1b;" id="materiais-estoque-baixo">0</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #dcfce7; border-radius: 8px;">
                                <span style="color: #14532d; font-weight: 600; font-size: 14px;"><i class="fas fa-check-circle" style="margin-right: 8px;"></i>Disponível</span>
                                <span style="font-weight: 700; color: #14532d;" id="materiais-disponiveis">0</span>
                            </div>
                        </div>
                        <div style="margin-top: 8px;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 8px;">Valor Total em Estoque</div>
                            <div style="font-size: 20px; font-weight: 700; color: #5b21b6;" id="valor-estoque">R$ 0</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Quick Actions -->
            <div class="panel" style="background: white; border-radius: 20px; padding: 0; box-shadow: 0 8px 24px rgba(0,0,0,0.08); overflow: hidden; border-top: 5px solid #6366f1; grid-column: span 2;">
                <div style="background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); padding: 24px; border-bottom: 1px solid #a5b4fc;">
                    <h2 style="margin: 0; color: #3730a3; font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 12px;">
                        <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);">
                            <i class="fas fa-bolt" style="font-size: 20px; color: white;"></i>
                        </div>
                        <span>Ações Rápidas</span>
                    </h2>
                    <p style="margin: 10px 0 0 56px; color: #4338ca; font-size: 13px; font-weight: 500;">Acesso rápido às principais funcionalidades</p>
                </div>
                <div class="panel-body" style="padding: 28px;">
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;">
                        <button id="btn-novo-pedido-quick" class="btn-modern btn-modern-primary">
                            <span style="width: 48px; height: 48px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; background: rgba(255,255,255,0.2);">
                                <i class="fas fa-plus-circle"></i>
                            </span>
                            <div style="text-align: left; flex: 1;">
                                <div style="font-weight: 700; font-size: 15px;">Novo Pedido</div>
                                <div style="font-size: 12px; opacity: 0.9;">Criar pedido de compra</div>
                            </div>
                        </button>
                        <button id="btn-nova-cotacao-quick" class="btn-modern btn-modern-success">
                            <span style="width: 48px; height: 48px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; background: rgba(255,255,255,0.2);">
                                <i class="fas fa-file-invoice-dollar"></i>
                            </span>
                            <div style="text-align: left; flex: 1;">
                                <div style="font-weight: 700; font-size: 15px;">Nova Cotação</div>
                                <div style="font-size: 12px; opacity: 0.9;">Solicitar cotação</div>
                            </div>
                        </button>
                        <button id="btn-novo-fornecedor-quick" class="btn-modern btn-modern-secondary">
                            <span style="width: 48px; height: 48px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; background: rgba(255,255,255,0.2);">
                                <i class="fas fa-truck"></i>
                            </span>
                            <div style="text-align: left; flex: 1;">
                                <div style="font-weight: 700; font-size: 15px;">Novo Fornecedor</div>
                                <div style="font-size: 12px; opacity: 0.9;">Cadastrar fornecedor</div>
                            </div>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Últimas Cotações -->
            <div class="panel" style="background: white; border-radius: 20px; padding: 0; box-shadow: 0 8px 24px rgba(0,0,0,0.08); overflow: hidden; border-top: 5px solid #f59e0b; grid-column: span 2;">
                <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 24px; border-bottom: 1px solid #fcd34d; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h2 style="margin: 0; color: #78350f; font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 12px;">
                            <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.25);">
                                <i class="fas fa-file-invoice-dollar" style="font-size: 20px; color: white;"></i>
                            </div>
                            <span>Últimas Cotações</span>
                        </h2>
                        <p style="margin: 10px 0 0 56px; color: #92400e; font-size: 13px; font-weight: 500;">Cotações mais recentes</p>
                    </div>
                    <button class="btn btn-primary" id="btn-ver-todas-cotacoes" style="padding: 10px 20px; border-radius: 10px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; background: linear-gradient(135deg, #f59e0b, #d97706); color: white;">Ver Todas</button>
                </div>
                <div id="cotacoes-recentes-container" class="panel-body" style="padding: 28px;"></div>
            </div>
        </div>
    `;

    // Carregar dados do dashboard
    loadDashboardData();
    
    // Event listeners para quick actions
    document.getElementById('btn-novo-pedido-quick')?.addEventListener('click', () => {
        document.getElementById('btn-pedidos')?.click();
        setTimeout(() => {
            document.getElementById('btn-novo-pedido')?.click();
        }, 100);
    });
    
    document.getElementById('btn-nova-cotacao-quick')?.addEventListener('click', () => {
        document.getElementById('btn-cotacoes')?.click();
        setTimeout(() => {
            document.getElementById('btn-nova-cotacao')?.click();
        }, 100);
    });
    
    document.getElementById('btn-novo-fornecedor-quick')?.addEventListener('click', () => {
        document.getElementById('btn-fornecedores')?.click();
        setTimeout(() => {
            document.getElementById('btn-novo-fornecedor')?.click();
        }, 100);
    });
}

async function loadDashboardData() {
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch('/api/compras/dashboard', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const stats = data.dashboard || data || {};

        // Atualizar valores no dashboard
        const el = (id) => document.getElementById(id);
        const fmt = (v) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

        if (el('total-compras-mes')) el('total-compras-mes').textContent = fmt(stats.totalComprasMes || stats.total_compras_mes || 0);
        if (el('pedidos-mes')) el('pedidos-mes').textContent = stats.pedidosMes || stats.pedidos_mes || 0;
        if (el('media-pedido')) el('media-pedido').textContent = fmt(stats.mediaPedido || stats.media_pedido || 0);
        if (el('pedidos-aprovacao')) el('pedidos-aprovacao').textContent = stats.pedidosAprovacao || stats.pedidos_aprovacao || 0;
        if (el('pedidos-transito')) el('pedidos-transito').textContent = stats.pedidosTransito || stats.pedidos_transito || 0;
        if (el('pedidos-recebidos')) el('pedidos-recebidos').textContent = stats.pedidosRecebidos || stats.pedidos_recebidos || 0;
        if (el('fornecedores-ativos')) el('fornecedores-ativos').textContent = stats.fornecedoresAtivos || stats.fornecedores_ativos || 0;
        if (el('fornecedores-nacionais')) el('fornecedores-nacionais').textContent = stats.fornecedoresNacionais || stats.fornecedores_nacionais || 0;
        if (el('fornecedores-importacao')) el('fornecedores-importacao').textContent = stats.fornecedoresImportacao || stats.fornecedores_importacao || 0;
        if (el('total-materiais')) el('total-materiais').textContent = stats.totalMateriais || stats.total_materiais || 0;
        if (el('materiais-estoque-baixo')) el('materiais-estoque-baixo').textContent = stats.materiaisEstoqueBaixo || stats.materiais_estoque_baixo || 0;
        if (el('materiais-disponiveis')) el('materiais-disponiveis').textContent = stats.materiaisDisponiveis || stats.materiais_disponiveis || 0;
        if (el('valor-estoque')) el('valor-estoque').textContent = fmt(stats.valorEstoque || stats.valor_estoque || 0);

        // Carregar cotações recentes
        loadRecentCotacoes();
        
    } catch (error) {
        console.error('Erro ao carregar dados do dashboard:', error);
    }
}

async function loadRecentCotacoes() {
    const container = document.getElementById('cotacoes-recentes-container');
    if (!container) return;

    let cotacoes = [];
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch('/api/compras/cotacoes', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const data = await response.json();
            cotacoes = (data.cotacoes || data || []).slice(0, 5);
        }
    } catch (error) {
        console.error('Erro ao carregar cotações:', error);
    }

    if (cotacoes.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">Nenhuma cotação encontrada.</p>';
        return;
    }
    
    const statusColors = {
        'Pendente': { bg: '#fef3c7', color: '#78350f', icon: 'clock' },
        'Aprovada': { bg: '#dcfce7', color: '#14532d', icon: 'check-circle' },
        'Em Análise': { bg: '#dbeafe', color: '#1e3a8a', icon: 'hourglass-half' }
    };
    
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px;">
            ${cotacoes.map(cot => {
                const status = statusColors[cot.status];
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; background: #f8fafc; border-radius: 12px; border-left: 4px solid ${status.color}; cursor: pointer; transition: all 0.2s;" 
                         onmouseover="this.style.background='#f1f5f9'; this.style.transform='translateX(4px)';"
                         onmouseout="this.style.background='#f8fafc'; this.style.transform='translateX(0)';">
                        <div style="flex: 1;">
                            <div style="font-weight: 700; color: #1e293b; font-size: 15px; margin-bottom: 4px;">${cot.id}</div>
                            <div style="font-size: 13px; color: #64748b;">${cot.fornecedor}</div>
                        </div>
                        <div style="text-align: right; margin: 0 16px;">
                            <div style="font-weight: 700; color: #1e293b; font-size: 16px;">R$ ${cot.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                            <div style="font-size: 12px; color: #94a3b8;">${new Date(cot.data).toLocaleDateString('pt-BR')}</div>
                        </div>
                        <div style="padding: 6px 12px; background: ${status.bg}; border-radius: 6px; font-size: 12px; font-weight: 600; color: ${status.color}; display: flex; align-items: center; gap: 6px;">
                            <i class="fas fa-${status.icon}"></i>
                            ${cot.status}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// Inicializar dashboard quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('dashboard-section').classList.contains('active')) {
        renderDashboard();
    }
});
