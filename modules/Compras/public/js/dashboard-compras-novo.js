/**
 * DASHBOARD - Módulo Compras
 * Visão geral do módulo de compras
 */

(function() {
    'use strict';

    let container;

    function init() {
        container = document.getElementById('dashboardContainer');
        if (container) {
            loadAndRender();
        }
    }

    async function loadAndRender() {
        const { formatCurrency, formatDate } = window.ComprasModule.utils;

        // Carregar dados reais da API
        let kpis = { comprasMes: 0, pedidosPendentes: 0, fornecedoresAtivos: 0, materiaisCadastrados: 0, cotacoesAbertas: 0, economiaGerada: 0 };
        let pedidosRecentes = [];
        let alertas = [];

        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const response = await fetch('/api/compras/dashboard', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                kpis = {
                    comprasMes: parseFloat(data.comprasMes || data.total_compras_mes || 0),
                    pedidosPendentes: parseInt(data.pedidosPendentes || data.pedidos_pendentes || 0),
                    fornecedoresAtivos: parseInt(data.fornecedoresAtivos || data.fornecedores_ativos || 0),
                    materiaisCadastrados: parseInt(data.materiaisCadastrados || data.materiais_cadastrados || 0),
                    cotacoesAbertas: parseInt(data.cotacoesAbertas || data.cotacoes_abertas || 0),
                    economiaGerada: parseFloat(data.economiaGerada || data.economia_gerada || 0)
                };
                pedidosRecentes = data.pedidosRecentes || data.pedidos_recentes || [];
                alertas = data.alertas || [];
            } else {
                console.error('Erro ao carregar dashboard-stats:', response.status);
            }
        } catch (error) {
            console.error('Erro ao carregar dados do dashboard:', error);
        }

        container.innerHTML = `
            <!-- KPIs Grid -->
            <div class="dashboard-kpis" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 30px;">
                
                <div class="kpi-card">
                    <div class="kpi-icon" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8);">
                        <i class="fas fa-shopping-cart"></i>
                    </div>
                    <div class="kpi-content">
                        <div class="kpi-label">Compras do Mês</div>
                        <div class="kpi-value">${formatCurrency(kpis.comprasMes)}</div>
                        <div class="kpi-trend up">
                            <i class="fas fa-arrow-up"></i> 12% vs mês anterior
                        </div>
                    </div>
                </div>

                <div class="kpi-card">
                    <div class="kpi-icon" style="background: linear-gradient(135deg, #f59e0b, #d97706);">
                        <i class="fas fa-file-invoice"></i>
                    </div>
                    <div class="kpi-content">
                        <div class="kpi-label">Pedidos Pendentes</div>
                        <div class="kpi-value">${kpis.pedidosPendentes}</div>
                        <div class="kpi-trend">
                            <i class="fas fa-clock"></i> Ação necessária
                        </div>
                    </div>
                </div>

                <div class="kpi-card">
                    <div class="kpi-icon" style="background: linear-gradient(135deg, #6366f1, #4f46e5);">
                        <i class="fas fa-truck"></i>
                    </div>
                    <div class="kpi-content">
                        <div class="kpi-label">Fornecedores Ativos</div>
                        <div class="kpi-value">${kpis.fornecedoresAtivos}</div>
                        <div class="kpi-trend up">
                            <i class="fas fa-arrow-up"></i> 3 novos este mês
                        </div>
                    </div>
                </div>

                <div class="kpi-card">
                    <div class="kpi-icon" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed);">
                        <i class="fas fa-cubes"></i>
                    </div>
                    <div class="kpi-content">
                        <div class="kpi-label">Materiais Cadastrados</div>
                        <div class="kpi-value">${kpis.materiaisCadastrados}</div>
                        <div class="kpi-trend">
                            <i class="fas fa-check"></i> Atualizado
                        </div>
                    </div>
                </div>

                <div class="kpi-card">
                    <div class="kpi-icon" style="background: linear-gradient(135deg, #ec4899, #db2777);">
                        <i class="fas fa-balance-scale"></i>
                    </div>
                    <div class="kpi-content">
                        <div class="kpi-label">Cotações Abertas</div>
                        <div class="kpi-value">${kpis.cotacoesAbertas}</div>
                        <div class="kpi-trend">
                            <i class="fas fa-clock"></i> Aguardando análise
                        </div>
                    </div>
                </div>

                <div class="kpi-card">
                    <div class="kpi-icon" style="background: linear-gradient(135deg, #14b8a6, #0d9488);">
                        <i class="fas fa-chart-line"></i>
                    </div>
                    <div class="kpi-content">
                        <div class="kpi-label">Economia Gerada</div>
                        <div class="kpi-value">${formatCurrency(kpis.economiaGerada)}</div>
                        <div class="kpi-trend up">
                            <i class="fas fa-arrow-up"></i> Via cotações
                        </div>
                    </div>
                </div>

            </div>

            <!-- Conteúdo Principal -->
            <div class="dashboard-content" style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px;">
                
                <!-- Pedidos Recentes -->
                <div class="dashboard-card">
                    <div class="card-header">
                        <h3><i class="fas fa-file-invoice"></i> Pedidos Recentes</h3>
                        <a href="#" onclick="navegarPara('pedidos'); return false;" class="btn-link">Ver todos</a>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="mini-table">
                                <thead>
                                    <tr>
                                        <th>Pedido</th>
                                        <th>Fornecedor</th>
                                        <th>Valor</th>
                                        <th>Data</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${pedidosRecentes.map(p => `
                                        <tr>
                                            <td><strong>${p.numero}</strong></td>
                                            <td>${p.fornecedor}</td>
                                            <td><strong>${formatCurrency(p.valor)}</strong></td>
                                            <td>${formatDate(p.data)}</td>
                                            <td>
                                                ${p.status === 'aprovado' ? '<span class="badge badge-success">Aprovado</span>' : ''}
                                                ${p.status === 'pendente' ? '<span class="badge badge-warning">Pendente</span>' : ''}
                                                ${p.status === 'processando' ? '<span class="badge badge-info">Processando</span>' : ''}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- Alertas -->
                <div class="dashboard-card">
                    <div class="card-header">
                        <h3><i class="fas fa-bell"></i> Alertas</h3>
                    </div>
                    <div class="card-body">
                        <div class="alertas-list">
                            ${alertas.map(a => `
                                <div class="alerta-item ${a.tipo}">
                                    <div class="alerta-icon">
                                        ${a.tipo === 'critico' ? '<i class="fas fa-exclamation-triangle"></i>' : ''}
                                        ${a.tipo === 'aviso' ? '<i class="fas fa-exclamation"></i>' : ''}
                                        ${a.tipo === 'info' ? '<i class="fas fa-info-circle"></i>' : ''}
                                    </div>
                                    <div class="alerta-texto">${a.mensagem}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

            </div>

            <style>
                .dashboard-kpis {
                    animation: fadeInUp 0.5s ease;
                }

                .kpi-card {
                    background: white;
                    border-radius: 16px;
                    padding: 24px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    transition: all 0.3s ease;
                }

                .kpi-card:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
                }

                .kpi-icon {
                    width: 64px;
                    height: 64px;
                    border-radius: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 28px;
                    flex-shrink: 0;
                }

                .kpi-content {
                    flex: 1;
                }

                .kpi-label {
                    font-size: 13px;
                    color: #6b7280;
                    font-weight: 500;
                    margin-bottom: 8px;
                }

                .kpi-value {
                    font-size: 28px;
                    font-weight: 700;
                    color: #1f2937;
                    margin-bottom: 6px;
                }

                .kpi-trend {
                    font-size: 13px;
                    color: #6b7280;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .kpi-trend.up {
                    color: #6366f1;
                }

                .kpi-trend.down {
                    color: #ef4444;
                }

                .dashboard-card {
                    background: white;
                    border-radius: 16px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                    overflow: hidden;
                }

                .card-header {
                    padding: 20px 24px;
                    border-bottom: 1px solid #e5e7eb;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .card-header h3 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 700;
                    color: #1f2937;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .card-body {
                    padding: 24px;
                }

                .btn-link {
                    color: #6366f1;
                    text-decoration: none;
                    font-size: 14px;
                    font-weight: 600;
                }

                .btn-link:hover {
                    color: #4f46e5;
                }

                .mini-table {
                    width: 100%;
                    border-collapse: collapse;
                }

                .mini-table th {
                    text-align: left;
                    padding: 12px 8px;
                    font-size: 13px;
                    font-weight: 600;
                    color: #6b7280;
                    border-bottom: 2px solid #e5e7eb;
                }

                .mini-table td {
                    padding: 12px 8px;
                    font-size: 14px;
                    color: #4b5563;
                    border-bottom: 1px solid #f3f4f6;
                }

                .alertas-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .alerta-item {
                    padding: 16px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .alerta-item.critico {
                    background: #fef2f2;
                    border-left: 4px solid #ef4444;
                }

                .alerta-item.aviso {
                    background: #fffbeb;
                    border-left: 4px solid #f59e0b;
                }

                .alerta-item.info {
                    background: #eff6ff;
                    border-left: 4px solid #3b82f6;
                }

                .alerta-icon {
                    font-size: 20px;
                }

                .alerta-item.critico .alerta-icon {
                    color: #ef4444;
                }

                .alerta-item.aviso .alerta-icon {
                    color: #f59e0b;
                }

                .alerta-item.info .alerta-icon {
                    color: #3b82f6;
                }

                .alerta-texto {
                    flex: 1;
                    font-size: 14px;
                    color: #374151;
                    font-weight: 500;
                }

                @keyframes fadeInUp {
                    from {
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            </style>
        `;
    }

    window.navegarPara = function(secao) {
        const navItem = document.querySelector(`.nav-item[data-section="${secao}"]`);
        if (navItem) {
            navItem.click();
        }
    };

    const observer = new MutationObserver(() => {
        const section = document.getElementById('dashboard-section');
        if (section && section.classList.contains('active') && !container) {
            init();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('dashboard-section');
        if (section) {
            observer.observe(section, { attributes: true, attributeFilter: ['class'] });
            if (section.classList.contains('active')) {
                init();
            }
        }
    });
})();
