/**
 * PEDIDOS DE COMPRA - Módulo Compras
 */

(function() {
    'use strict';

    let container;
    let pedidos = [];

    function init() {
        container = document.getElementById('pedidosContainer');
        if (container) {
            loadPedidos().then(() => render());
        }
    }

    async function loadPedidos() {
        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const response = await fetch('/api/compras/pedidos', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                pedidos = data.pedidos || data || [];
            } else {
                console.error('Erro ao carregar pedidos:', response.status);
                pedidos = [];
            }
        } catch (error) {
            console.error('Erro ao carregar pedidos:', error);
            pedidos = [];
        }
    }

    function render() {
        const { formatCurrency, formatDate, getStatusBadge } = window.ComprasModule.utils;

        const totalPedidos = pedidos.length;
        const valorTotal = pedidos.reduce((sum, p) => sum + p.valor, 0);

        container.innerHTML = `
            <div class="stats-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8);">
                        <i class="fas fa-shopping-cart"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Total de Pedidos</div>
                        <div class="stat-value">${totalPedidos}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #10b981, #059669);">
                        <i class="fas fa-dollar-sign"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Valor Total</div>
                        <div class="stat-value">${formatCurrency(valorTotal)}</div>
                    </div>
                </div>
            </div>

            <div class="table-container">
                <table class="modern-table">
                    <thead>
                        <tr>
                            <th>Pedido</th>
                            <th>Fornecedor</th>
                            <th>Itens</th>
                            <th>Valor</th>
                            <th>Data</th>
                            <th>Prazo</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pedidos.map(p => `
                            <tr>
                                <td><strong>${p.numero}</strong></td>
                                <td>${p.fornecedor}</td>
                                <td>${p.itens}</td>
                                <td>${formatCurrency(p.valor)}</td>
                                <td>${formatDate(p.data)}</td>
                                <td>${formatDate(p.prazo)}</td>
                                <td>${getStatusBadge(p.status)}</td>
                                <td>
                                    <button class="btn-action btn-view" onclick="verPedido(${p.id})" title="Visualizar">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button class="btn-action btn-edit" onclick="editarPedido(${p.id})" title="Editar">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    window.verPedido = function(id) {
        alert(`Visualizar pedido #${id}`);
    };

    window.editarPedido = function(id) {
        alert(`Editar pedido #${id}`);
    };

    // Inicializar quando seção estiver ativa
    const observer = new MutationObserver(() => {
        const section = document.getElementById('pedidos-section');
        if (section && section.classList.contains('active') && !container) {
            init();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('pedidos-section');
        if (section) {
            observer.observe(section, { attributes: true, attributeFilter: ['class'] });
            if (section.classList.contains('active')) {
                init();
            }
        }
    });
})();
