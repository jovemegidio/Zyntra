/**
 * ESTOQUE - Módulo Compras
 * Controle de estoque e inventário
 */

(function() {
    'use strict';

    let container;
    let estoque = [];

    function init() {
        container = document.getElementById('estoqueContainer');
        if (container) {
            loadEstoque();
            render();
        }
    }

    function loadEstoque() {
        estoque = [
            { id: 1, codigo: 'MAT-001', material: 'Alumínio 6061-T6', localizacao: 'A-01-01', estoqueAtual: 1250, estoqueMinimo: 500, estoqueMaximo: 2000, ultimaMovimentacao: '2025-01-20', tipo: 'entrada', quantidade: 500 },
            { id: 2, codigo: 'MAT-002', material: 'Parafuso Sextavado M8x20', localizacao: 'B-02-03', estoqueAtual: 2800, estoqueMinimo: 1000, estoqueMaximo: 5000, ultimaMovimentacao: '2025-01-18', tipo: 'entrada', quantidade: 1000 },
            { id: 3, codigo: 'MAT-003', material: 'Tinta Epóxi Branca RAL 9016', localizacao: 'C-01-02', estoqueAtual: 45, estoqueMinimo: 50, estoqueMaximo: 200, ultimaMovimentacao: '2025-01-19', tipo: 'saida', quantidade: 30 },
            { id: 4, codigo: 'MAT-004', material: 'Rolamento SKF 6205-2RS', localizacao: 'B-03-01', estoqueAtual: 120, estoqueMinimo: 50, estoqueMaximo: 300, ultimaMovimentacao: '2025-01-21', tipo: 'entrada', quantidade: 50 },
            { id: 5, codigo: 'MAT-005', material: 'Aço 1020 Chapa 3mm', localizacao: 'A-02-02', estoqueAtual: 890, estoqueMinimo: 300, estoqueMaximo: 1500, ultimaMovimentacao: '2025-01-22', tipo: 'entrada', quantidade: 300 },
            { id: 6, codigo: 'MAT-006', material: 'Caixa Papelão 40x30x20cm', localizacao: 'D-01-01', estoqueAtual: 350, estoqueMinimo: 200, estoqueMaximo: 1000, ultimaMovimentacao: '2025-01-17', tipo: 'saida', quantidade: 150 },
            { id: 7, codigo: 'MAT-007', material: 'Graxa Lubrificante EP2', localizacao: 'C-02-01', estoqueAtual: 25, estoqueMinimo: 30, estoqueMaximo: 100, ultimaMovimentacao: '2025-01-16', tipo: 'saida', quantidade: 15 },
            { id: 8, codigo: 'MAT-008', material: 'Rebite Alumínio 4.8x12mm', localizacao: 'B-01-02', estoqueAtual: 1500, estoqueMinimo: 500, estoqueMaximo: 3000, ultimaMovimentacao: '2025-01-23', tipo: 'entrada', quantidade: 800 }
        ];
    }

    function getEstoqueStatus(atual, minimo, maximo) {
        const percentual = (atual / maximo) * 100;
        if (atual < minimo) return { status: 'critico', classe: 'danger', icone: 'exclamation-triangle' };
        if (percentual < 30) return { status: 'baixo', classe: 'warning', icone: 'exclamation' };
        if (percentual > 80) return { status: 'alto', classe: 'info', icone: 'arrow-up' };
        return { status: 'normal', classe: 'success', icone: 'check' };
    }

    function render() {
        const { formatDate } = window.ComprasModule.utils;

        const totalItens = estoque.length;
        const itensCriticos = estoque.filter(e => e.estoqueAtual < e.estoqueMinimo).length;
        const itensBaixos = estoque.filter(e => {
            const percentual = (e.estoqueAtual / e.estoqueMaximo) * 100;
            return percentual < 30 && e.estoqueAtual >= e.estoqueMinimo;
        }).length;

        container.innerHTML = `
            <div class="stats-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8);">
                        <i class="fas fa-boxes"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Total de Itens</div>
                        <div class="stat-value">${totalItens}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #ef4444, #dc2626);">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Estoque Crítico</div>
                        <div class="stat-value">${itensCriticos}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #f59e0b, #d97706);">
                        <i class="fas fa-exclamation"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Estoque Baixo</div>
                        <div class="stat-value">${itensBaixos}</div>
                    </div>
                </div>
            </div>

            <div class="table-container">
                <table class="modern-table">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Material</th>
                            <th>Localização</th>
                            <th>Estoque Atual</th>
                            <th>Mín/Máx</th>
                            <th>Status</th>
                            <th>Última Movimentação</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${estoque.map(e => {
                            const status = getEstoqueStatus(e.estoqueAtual, e.estoqueMinimo, e.estoqueMaximo);
                            const percentual = ((e.estoqueAtual / e.estoqueMaximo) * 100).toFixed(0);
                            
                            return `
                                <tr class="${status.status === 'critico' ? 'row-danger' : ''}">
                                    <td><strong>${e.codigo}</strong></td>
                                    <td>${e.material}</td>
                                    <td><span class="badge badge-secondary">${e.localizacao}</span></td>
                                    <td>
                                        <strong class="text-${status.classe}">${e.estoqueAtual}</strong>
                                        <div class="progress" style="height: 8px; margin-top: 5px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                                            <div class="progress-bar bg-${status.classe}" style="width: ${percentual}%; background: ${
                                                status.classe === 'danger' ? '#ef4444' : 
                                                status.classe === 'warning' ? '#f59e0b' :
                                                status.classe === 'info' ? '#3b82f6' : '#10b981'
                                            }; height: 100%;"></div>
                                        </div>
                                    </td>
                                    <td>${e.estoqueMinimo}/${e.estoqueMaximo}</td>
                                    <td>
                                        <span class="badge badge-${status.classe}">
                                            <i class="fas fa-${status.icone}"></i>
                                            ${status.status.charAt(0).toUpperCase() + status.status.slice(1)}
                                        </span>
                                    </td>
                                    <td>
                                        ${formatDate(e.ultimaMovimentacao)}
                                        <br>
                                        <small class="text-${e.tipo === 'entrada' ? 'success' : 'danger'}">
                                            ${e.tipo === 'entrada' ? '↑' : '↓'} ${e.quantidade}
                                        </small>
                                    </td>
                                    <td>
                                        <button class="btn-action btn-view" onclick="verMovimentacoes(${e.id})" title="Ver Movimentações">
                                            <i class="fas fa-history"></i>
                                        </button>
                                        <button class="btn-action btn-edit" onclick="ajustarEstoque(${e.id})" title="Ajustar Estoque">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    window.verMovimentacoes = function(id) {
        alert(`Ver movimentações do item #${id}`);
    };

    window.ajustarEstoque = function(id) {
        alert(`Ajustar estoque do item #${id}`);
    };

    const observer = new MutationObserver(() => {
        const section = document.getElementById('estoque-section');
        if (section && section.classList.contains('active') && !container) {
            init();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('estoque-section');
        if (section) {
            observer.observe(section, { attributes: true, attributeFilter: ['class'] });
            if (section.classList.contains('active')) {
                init();
            }
        }
    });
})();
