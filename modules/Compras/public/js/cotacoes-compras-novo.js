/**
 * COTAÇÕES - Módulo Compras
 * Gestão de cotações de fornecedores
 */

(function() {
    'use strict';

    let container;
    let cotacoes = [];
    let filtroStatus = 'todos';

    function init() {
        container = document.getElementById('cotacoesContainer');
        if (container) {
            loadCotacoes();
            render();
        }
    }

    function loadCotacoes() {
        cotacoes = [
            { id: 1, numero: 'COT-2025-001', material: 'Alumínio 6061-T6', quantidade: 500, unidade: 'kg', dataAbertura: '2025-01-08', dataFechamento: '2025-01-15', fornecedores: 3, melhorOferta: 45.80, status: 'em_analise' },
            { id: 2, numero: 'COT-2025-002', material: 'Parafusos M8x20', quantidade: 1000, unidade: 'pç', dataAbertura: '2025-01-09', dataFechamento: '2025-01-16', fornecedores: 4, melhorOferta: 2.50, status: 'aprovada' },
            { id: 3, numero: 'COT-2025-003', material: 'Tinta Epóxi Branca', quantidade: 200, unidade: 'L', dataAbertura: '2025-01-10', dataFechamento: '2025-01-17', fornecedores: 2, melhorOferta: 89.90, status: 'pendente' },
            { id: 4, numero: 'COT-2025-004', material: 'Rolamento SKF 6205', quantidade: 50, unidade: 'pç', dataAbertura: '2025-01-05', dataFechamento: '2025-01-12', fornecedores: 5, melhorOferta: 34.20, status: 'aprovada' },
            { id: 5, numero: 'COT-2025-005', material: 'Aço 1020 Chapa', quantidade: 300, unidade: 'kg', dataAbertura: '2025-01-11', dataFechamento: '2025-01-18', fornecedores: 3, melhorOferta: 12.30, status: 'em_analise' },
            { id: 6, numero: 'COT-2025-006', material: 'Caixa Papelão 40x30x20', quantidade: 500, unidade: 'un', dataAbertura: '2025-01-07', dataFechamento: '2025-01-14', fornecedores: 2, melhorOferta: 3.80, status: 'rejeitada' }
        ];
    }

    function filtrarCotacoes() {
        if (filtroStatus === 'todos') return cotacoes;
        return cotacoes.filter(c => c.status === filtroStatus);
    }

    function render() {
        const { formatCurrency, formatDate, getStatusBadge } = window.ComprasModule.utils;
        const cotacoesFiltradas = filtrarCotacoes();

        const totalCotacoes = cotacoes.length;
        const cotacoesAbertas = cotacoes.filter(c => c.status === 'em_analise' || c.status === 'pendente').length;
        const economiaEstimada = cotacoes.reduce((sum, c) => sum + (c.melhorOferta * c.quantidade * 0.15), 0);

        container.innerHTML = `
            <div class="stats-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8);">
                        <i class="fas fa-file-invoice-dollar"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Total de Cotações</div>
                        <div class="stat-value">${totalCotacoes}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #f59e0b, #d97706);">
                        <i class="fas fa-clock"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Cotações Abertas</div>
                        <div class="stat-value">${cotacoesAbertas}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #6366f1, #4f46e5);">
                        <i class="fas fa-chart-line"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Economia Estimada</div>
                        <div class="stat-value">${formatCurrency(economiaEstimada)}</div>
                    </div>
                </div>
            </div>

            <div class="filter-bar" style="margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="btn-filter ${filtroStatus === 'todos' ? 'active' : ''}" onclick="filtrarPorStatus('todos')">
                    Todos (${cotacoes.length})
                </button>
                <button class="btn-filter ${filtroStatus === 'pendente' ? 'active' : ''}" onclick="filtrarPorStatus('pendente')">
                    Pendentes (${cotacoes.filter(c => c.status === 'pendente').length})
                </button>
                <button class="btn-filter ${filtroStatus === 'em_analise' ? 'active' : ''}" onclick="filtrarPorStatus('em_analise')">
                    Em Análise (${cotacoes.filter(c => c.status === 'em_analise').length})
                </button>
                <button class="btn-filter ${filtroStatus === 'aprovada' ? 'active' : ''}" onclick="filtrarPorStatus('aprovada')">
                    Aprovadas (${cotacoes.filter(c => c.status === 'aprovada').length})
                </button>
                <button class="btn-filter ${filtroStatus === 'rejeitada' ? 'active' : ''}" onclick="filtrarPorStatus('rejeitada')">
                    Rejeitadas (${cotacoes.filter(c => c.status === 'rejeitada').length})
                </button>
            </div>

            <div class="table-container">
                <table class="modern-table">
                    <thead>
                        <tr>
                            <th>Cotação</th>
                            <th>Material</th>
                            <th>Quantidade</th>
                            <th>Fornecedores</th>
                            <th>Melhor Oferta</th>
                            <th>Abertura</th>
                            <th>Fechamento</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cotacoesFiltradas.map(c => `
                            <tr>
                                <td><strong>${c.numero}</strong></td>
                                <td>${c.material}</td>
                                <td>${c.quantidade} ${c.unidade}</td>
                                <td><span class="badge badge-info">${c.fornecedores} fornecedores</span></td>
                                <td><strong class="text-success">${formatCurrency(c.melhorOferta)}/${c.unidade}</strong></td>
                                <td>${formatDate(c.dataAbertura)}</td>
                                <td>${formatDate(c.dataFechamento)}</td>
                                <td>${getStatusBadge(c.status)}</td>
                                <td>
                                    <button class="btn-action btn-view" onclick="verCotacao(${c.id})" title="Visualizar">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button class="btn-action btn-edit" onclick="compararOfertas(${c.id})" title="Comparar Ofertas">
                                        <i class="fas fa-balance-scale"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    window.filtrarPorStatus = function(status) {
        filtroStatus = status;
        render();
    };

    window.verCotacao = function(id) {
        alert(`Visualizar cotação #${id}`);
    };

    window.compararOfertas = function(id) {
        alert(`Comparar ofertas da cotação #${id}`);
    };

    const observer = new MutationObserver(() => {
        const section = document.getElementById('cotacoes-section');
        if (section && section.classList.contains('active') && !container) {
            init();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('cotacoes-section');
        if (section) {
            observer.observe(section, { attributes: true, attributeFilter: ['class'] });
            if (section.classList.contains('active')) {
                init();
            }
        }
    });
})();
