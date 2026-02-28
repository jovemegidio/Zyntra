/**
 * RECEBIMENTO - Módulo Compras
 * Controle de recebimento de materiais
 */

(function() {
    'use strict';

    let container;
    let recebimentos = [];

    function init() {
        container = document.getElementById('recebimentoContainer');
        if (container) {
            loadRecebimentos();
            render();
        }
    }

    function loadRecebimentos() {
        recebimentos = [
            { id: 1, pedido: 'PC-001', fornecedor: 'Alum Brasil Ltda', material: 'Alumínio 6061-T6', quantidade: 500, unidade: 'kg', dataRecebimento: '2025-01-20', nf: '12345', conferido: true, status: 'aprovado' },
            { id: 2, pedido: 'PC-002', fornecedor: 'Metal Line Indústria', material: 'Parafusos M8x20', quantidade: 1000, unidade: 'pç', dataRecebimento: '2025-01-18', nf: '12346', conferido: true, status: 'aprovado' },
            { id: 3, pedido: 'PC-003', fornecedor: 'Aço Forte Materiais', material: 'Aço 1020 Chapa', quantidade: 300, unidade: 'kg', dataRecebimento: '2025-01-22', nf: '12347', conferido: false, status: 'pendente' },
            { id: 4, pedido: 'PC-004', fornecedor: 'QuímicaBR Produtos', material: 'Tinta Epóxi Branca', quantidade: 200, unidade: 'L', dataRecebimento: '2025-01-19', nf: '12348', conferido: true, status: 'divergencia' },
            { id: 5, pedido: 'PC-005', fornecedor: 'Embalagens Master', material: 'Caixa Papelão 40x30x20', quantidade: 500, unidade: 'un', dataRecebimento: '2025-01-25', nf: '12349', conferido: false, status: 'pendente' }
        ];
    }

    function render() {
        const { formatDate } = window.ComprasModule.utils;

        const totalRecebimentos = recebimentos.length;
        const recebimentosPendentes = recebimentos.filter(r => r.status === 'pendente').length;
        const divergencias = recebimentos.filter(r => r.status === 'divergencia').length;

        container.innerHTML = `
            <div class="stats-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8);">
                        <i class="fas fa-truck-loading"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Total de Recebimentos</div>
                        <div class="stat-value">${totalRecebimentos}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #f59e0b, #d97706);">
                        <i class="fas fa-clock"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Pendentes Conferência</div>
                        <div class="stat-value">${recebimentosPendentes}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #ef4444, #dc2626);">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Com Divergência</div>
                        <div class="stat-value">${divergencias}</div>
                    </div>
                </div>
            </div>

            <div class="table-container">
                <table class="modern-table">
                    <thead>
                        <tr>
                            <th>Pedido</th>
                            <th>Fornecedor</th>
                            <th>Material</th>
                            <th>Quantidade</th>
                            <th>NF</th>
                            <th>Data Recebimento</th>
                            <th>Conferido</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recebimentos.map(r => `
                            <tr class="${r.status === 'divergencia' ? 'row-warning' : ''}">
                                <td><strong>${r.pedido}</strong></td>
                                <td>${r.fornecedor}</td>
                                <td>${r.material}</td>
                                <td>${r.quantidade} ${r.unidade}</td>
                                <td>#${r.nf}</td>
                                <td>${formatDate(r.dataRecebimento)}</td>
                                <td>
                                    ${r.conferido 
                                        ? '<span class="badge badge-success"><i class="fas fa-check"></i> Sim</span>'
                                        : '<span class="badge badge-warning"><i class="fas fa-clock"></i> Não</span>'}
                                </td>
                                <td>
                                    ${r.status === 'aprovado' ? '<span class="badge badge-success">Aprovado</span>' : ''}
                                    ${r.status === 'pendente' ? '<span class="badge badge-warning">Pendente</span>' : ''}
                                    ${r.status === 'divergencia' ? '<span class="badge badge-danger">Divergência</span>' : ''}
                                </td>
                                <td>
                                    <button class="btn-action btn-view" onclick="verRecebimento(${r.id})" title="Visualizar">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    ${!r.conferido ? `
                                        <button class="btn-action btn-success" onclick="conferirRecebimento(${r.id})" title="Conferir">
                                            <i class="fas fa-check"></i>
                                        </button>
                                    ` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    window.verRecebimento = function(id) {
        alert(`Visualizar recebimento #${id}`);
    };

    window.conferirRecebimento = function(id) {
        alert(`Conferir recebimento #${id}`);
    };

    const observer = new MutationObserver(() => {
        const section = document.getElementById('recebimento-section');
        if (section && section.classList.contains('active') && !container) {
            init();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('recebimento-section');
        if (section) {
            observer.observe(section, { attributes: true, attributeFilter: ['class'] });
            if (section.classList.contains('active')) {
                init();
            }
        }
    });
})();
