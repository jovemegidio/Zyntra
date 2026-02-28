/**
 * FORNECEDORES - Módulo Compras
 */

(function() {
    'use strict';

    let container;
    let fornecedores = [];

    function init() {
        container = document.getElementById('fornecedoresContainer');
        if (container) {
            loadFornecedores().then(() => render());
        }
    }

    async function loadFornecedores() {
        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const response = await fetch('/api/compras/fornecedores', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                fornecedores = data.fornecedores || data || [];
            } else {
                console.error('Erro ao carregar fornecedores:', response.status);
                fornecedores = [];
            }
        } catch (error) {
            console.error('Erro ao carregar fornecedores:', error);
            fornecedores = [];
        }
    }

    function render() {
        const { formatCurrency, formatDate, getStatusBadge } = window.ComprasModule.utils;

        const totalFornecedores = fornecedores.filter(f => f.status === 'ativo').length;
        const totalCompras = fornecedores.reduce((sum, f) => sum + f.totalCompras, 0);

        container.innerHTML = `
            <div class="stats-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #10b981, #059669);">
                        <i class="fas fa-truck"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Fornecedores Ativos</div>
                        <div class="stat-value">${totalFornecedores}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8);">
                        <i class="fas fa-dollar-sign"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Total em Compras</div>
                        <div class="stat-value">${formatCurrency(totalCompras)}</div>
                    </div>
                </div>
            </div>

            <div class="fornecedores-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 24px;">
                ${fornecedores.map(f => `
                    <div class="fornecedor-card">
                        <div class="fornecedor-header">
                            <div class="fornecedor-icon">
                                <i class="fas fa-truck"></i>
                            </div>
                            <div class="fornecedor-info">
                                <h3>${f.nome}</h3>
                                ${getStatusBadge(f.status)}
                            </div>
                        </div>
                        <div class="fornecedor-body">
                            <div class="info-item">
                                <i class="fas fa-id-card"></i>
                                <span>${f.cnpj}</span>
                            </div>
                            <div class="info-item">
                                <i class="fas fa-phone"></i>
                                <span>${f.telefone}</span>
                            </div>
                            <div class="info-item">
                                <i class="fas fa-envelope"></i>
                                <span>${f.email}</span>
                            </div>
                            <div class="info-item">
                                <i class="fas fa-map-marker-alt"></i>
                                <span>${f.cidade} - ${f.estado}</span>
                            </div>
                            <div class="info-item">
                                <i class="fas fa-tag"></i>
                                <span class="badge badge-info">${f.categoria}</span>
                            </div>
                            <div class="info-item">
                                <strong>Total em Compras:</strong>
                                <span class="text-success">${formatCurrency(f.totalCompras)}</span>
                            </div>
                            <div class="info-item">
                                <strong>Última Compra:</strong>
                                <span>${formatDate(f.ultimaCompra)}</span>
                            </div>
                        </div>
                        <div class="fornecedor-footer">
                            <button class="btn-action btn-view" onclick="verFornecedor(${f.id})" title="Visualizar">
                                <i class="fas fa-eye"></i> Ver
                            </button>
                            <button class="btn-action btn-edit" onclick="editarFornecedor(${f.id})" title="Editar">
                                <i class="fas fa-edit"></i> Editar
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    window.verFornecedor = function(id) {
        alert(`Visualizar fornecedor #${id}`);
    };

    window.editarFornecedor = function(id) {
        alert(`Editar fornecedor #${id}`);
    };

    // Inicializar quando seção estiver ativa
    const observer = new MutationObserver(() => {
        const section = document.getElementById('fornecedores-section');
        if (section && section.classList.contains('active') && !container) {
            init();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('fornecedores-section');
        if (section) {
            observer.observe(section, { attributes: true, attributeFilter: ['class'] });
            if (section.classList.contains('active')) {
                init();
            }
        }
    });
})();
