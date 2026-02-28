/**
 * MATERIAIS - Módulo Compras
 * Catálogo de materiais e insumos
 */

(function() {
    'use strict';

    let container;
    let materiais = [];
    let filtroCategoria = 'todos';

    function init() {
        container = document.getElementById('materiaisContainer');
        if (container) {
            loadMateriais();
            render();
        }
    }

    function loadMateriais() {
        materiais = [
            { id: 1, codigo: 'MAT-001', nome: 'Alumínio 6061-T6', categoria: 'Matéria-Prima', unidade: 'kg', estoqueAtual: 1250, estoqueMinimo: 500, estoqueMaximo: 2000, custoMedio: 45.80, fornecedorPrincipal: 'Alum Brasil Ltda', status: 'ativo' },
            { id: 2, codigo: 'MAT-002', nome: 'Parafuso Sextavado M8x20', categoria: 'Ferragens', unidade: 'pç', estoqueAtual: 2800, estoqueMinimo: 1000, estoqueMaximo: 5000, custoMedio: 2.50, fornecedorPrincipal: 'Ferragens Brasil', status: 'ativo' },
            { id: 3, codigo: 'MAT-003', nome: 'Tinta Epóxi Branca RAL 9016', categoria: 'Químicos', unidade: 'L', estoqueAtual: 45, estoqueMinimo: 50, estoqueMaximo: 200, custoMedio: 89.90, fornecedorPrincipal: 'QuímicaBR Produtos', status: 'critico' },
            { id: 4, codigo: 'MAT-004', nome: 'Rolamento SKF 6205-2RS', categoria: 'Componentes', unidade: 'pç', estoqueAtual: 120, estoqueMinimo: 50, estoqueMaximo: 300, custoMedio: 34.20, fornecedorPrincipal: 'Metal Line Indústria', status: 'ativo' },
            { id: 5, codigo: 'MAT-005', nome: 'Aço 1020 Chapa 3mm', categoria: 'Matéria-Prima', unidade: 'kg', estoqueAtual: 890, estoqueMinimo: 300, estoqueMaximo: 1500, custoMedio: 12.30, fornecedorPrincipal: 'Aço Forte Materiais', status: 'ativo' },
            { id: 6, codigo: 'MAT-006', nome: 'Caixa Papelão 40x30x20cm', categoria: 'Embalagens', unidade: 'un', estoqueAtual: 350, estoqueMinimo: 200, estoqueMaximo: 1000, custoMedio: 3.80, fornecedorPrincipal: 'Embalagens Master', status: 'ativo' },
            { id: 7, codigo: 'MAT-007', nome: 'Graxa Lubrificante EP2', categoria: 'Químicos', unidade: 'kg', estoqueAtual: 25, estoqueMinimo: 30, estoqueMaximo: 100, custoMedio: 28.50, fornecedorPrincipal: 'QuímicaBR Produtos', status: 'critico' },
            { id: 8, codigo: 'MAT-008', nome: 'Rebite Alumínio 4.8x12mm', categoria: 'Ferragens', unidade: 'pç', estoqueAtual: 1500, estoqueMinimo: 500, estoqueMaximo: 3000, custoMedio: 0.85, fornecedorPrincipal: 'Ferragens Brasil', status: 'ativo' }
        ];
    }

    function filtrarMateriais() {
        if (filtroCategoria === 'todos') return materiais;
        return materiais.filter(m => m.categoria === filtroCategoria);
    }

    function render() {
        const { formatCurrency } = window.ComprasModule.utils;
        const materiaisFiltrados = filtrarMateriais();

        const totalMateriais = materiais.length;
        const materiaisCriticos = materiais.filter(m => m.status === 'critico').length;
        const valorEstoque = materiais.reduce((sum, m) => sum + (m.estoqueAtual * m.custoMedio), 0);

        const categorias = [...new Set(materiais.map(m => m.categoria))];

        container.innerHTML = `
            <div class="stats-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8);">
                        <i class="fas fa-cubes"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Total de Materiais</div>
                        <div class="stat-value">${totalMateriais}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #ef4444, #dc2626);">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Materiais Críticos</div>
                        <div class="stat-value">${materiaisCriticos}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background: linear-gradient(135deg, #10b981, #059669);">
                        <i class="fas fa-dollar-sign"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Valor em Estoque</div>
                        <div class="stat-value">${formatCurrency(valorEstoque)}</div>
                    </div>
                </div>
            </div>

            <div class="filter-bar" style="margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="btn-filter ${filtroCategoria === 'todos' ? 'active' : ''}" onclick="filtrarPorCategoria('todos')">
                    Todos (${materiais.length})
                </button>
                ${categorias.map(cat => `
                    <button class="btn-filter ${filtroCategoria === cat ? 'active' : ''}" onclick="filtrarPorCategoria('${cat}')">
                        ${cat} (${materiais.filter(m => m.categoria === cat).length})
                    </button>
                `).join('')}
            </div>

            <div class="table-container">
                <table class="modern-table">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Material</th>
                            <th>Categoria</th>
                            <th>Estoque Atual</th>
                            <th>Mín/Máx</th>
                            <th>Custo Médio</th>
                            <th>Fornecedor Principal</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${materiaisFiltrados.map(m => `
                            <tr class="${m.status === 'critico' ? 'row-warning' : ''}">
                                <td><strong>${m.codigo}</strong></td>
                                <td>${m.nome}</td>
                                <td><span class="badge badge-info">${m.categoria}</span></td>
                                <td>
                                    <strong class="${m.estoqueAtual < m.estoqueMinimo ? 'text-danger' : 'text-success'}">
                                        ${m.estoqueAtual} ${m.unidade}
                                    </strong>
                                </td>
                                <td>${m.estoqueMinimo}/${m.estoqueMaximo} ${m.unidade}</td>
                                <td>${formatCurrency(m.custoMedio)}/${m.unidade}</td>
                                <td>${m.fornecedorPrincipal}</td>
                                <td>
                                    ${m.status === 'critico' 
                                        ? '<span class="badge badge-danger"><i class="fas fa-exclamation-triangle"></i> Crítico</span>'
                                        : '<span class="badge badge-success">Normal</span>'}
                                </td>
                                <td>
                                    <button class="btn-action btn-view" onclick="verMaterial(${m.id})" title="Visualizar">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button class="btn-action btn-edit" onclick="editarMaterial(${m.id})" title="Editar">
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

    window.filtrarPorCategoria = function(categoria) {
        filtroCategoria = categoria;
        render();
    };

    window.verMaterial = function(id) {
        alert(`Visualizar material #${id}`);
    };

    window.editarMaterial = function(id) {
        alert(`Editar material #${id}`);
    };

    const observer = new MutationObserver(() => {
        const section = document.getElementById('materiais-section');
        if (section && section.classList.contains('active') && !container) {
            init();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('materiais-section');
        if (section) {
            observer.observe(section, { attributes: true, attributeFilter: ['class'] });
            if (section.classList.contains('active')) {
                init();
            }
        }
    });
})();
