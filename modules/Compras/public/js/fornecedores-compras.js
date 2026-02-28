/* ========================================
   FORNECEDORES - MÓDULO COMPRAS
   ======================================== */

class FornecedoresCompras {
    constructor() {
        this.fornecedores = [];
    }

    async init() {
        await this.loadFornecedores();
        this.render();
    }

    async loadFornecedores() {
        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const response = await fetch('/api/compras/fornecedores', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data.success) {
                this.fornecedores = data.fornecedores || [];
            } else {
                console.error('Erro ao carregar fornecedores:', data.message);
                this.fornecedores = [];
            }
        } catch (error) {
            console.error('Erro ao carregar fornecedores:', error);
            this.fornecedores = [];
        }
    }

    render() {
        const container = document.getElementById('fornecedores-container');
        if (!container) return;

        const ativos = this.fornecedores.filter(f => f.status === 'ativo').length;
        const totalCompras = this.fornecedores.reduce((sum, f) => sum + (f.totalCompras || 0), 0);

        container.innerHTML = `
            <!-- Toolbar -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
                <div style="display: flex; gap: 12px; flex: 1;">
                    <div style="position: relative; flex: 1; max-width: 400px;">
                        <i class="fas fa-search" style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #94a3b8;"></i>
                        <input type="text" id="busca-fornecedor" placeholder="Buscar fornecedor..." style="width: 100%; padding: 12px 12px 12px 40px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px;">
                    </div>
                </div>
                
                <button id="btn-novo-fornecedor" style="padding: 12px 24px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); transition: all 0.2s;">
                    <i class="fas fa-plus-circle"></i> Novo Fornecedor
                </button>
            </div>

            <!-- Cards de Resumo -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; margin-bottom: 24px;">
                <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); padding: 20px; border-radius: 12px; border-left: 4px solid #3b82f6;">
                    <div style="font-size: 13px; color: #1e40af; font-weight: 600; margin-bottom: 8px;">FORNECEDORES ATIVOS</div>
                    <div style="font-size: 32px; font-weight: 800; color: #1e3a8a;">${ativos}</div>
                </div>
                <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); padding: 20px; border-radius: 12px; border-left: 4px solid #10b981;">
                    <div style="font-size: 13px; color: #047857; font-weight: 600; margin-bottom: 8px;">TOTAL EM COMPRAS</div>
                    <div style="font-size: 32px; font-weight: 800; color: #065f46;">R$ ${totalCompras.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                </div>
            </div>

            <!-- Grid de Fornecedores -->
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px;">
                ${this.fornecedores.map(f => `
                    <div style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); transition: all 0.3s; border: 2px solid ${f.status === 'ativo' ? '#e2e8f0' : '#fee2e2'};"
                         onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 8px 24px rgba(0,0,0,0.12)'"
                         onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 16px rgba(0,0,0,0.06)'">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
                            <div style="flex: 1;">
                                <h3 style="margin: 0 0 8px 0; font-size: 17px; font-weight: 700; color: #1e293b;">${f.nome}</h3>
                                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                    <span style="padding: 4px 10px; background: ${f.status === 'ativo' ? '#d1fae5' : '#fee2e2'}; color: ${f.status === 'ativo' ? '#065f46' : '#991b1b'}; border-radius: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">
                                        ${f.status === 'ativo' ? 'Ativo' : 'Inativo'}
                                    </span>
                                    <span style="padding: 4px 10px; background: #f1f5f9; color: #475569; border-radius: 6px; font-size: 11px; font-weight: 600;">
                                        ${f.categoria}
                                    </span>
                                </div>
                            </div>
                            <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #3b82f6, #2563eb); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-size: 20px;">
                                <i class="fas fa-truck"></i>
                            </div>
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px;">
                            <div style="display: flex; align-items: center; gap: 10px; font-size: 13px; color: #64748b;">
                                <i class="fas fa-id-card" style="color: #94a3b8; width: 16px;"></i>
                                <span>${f.cnpj}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px; font-size: 13px; color: #64748b;">
                                <i class="fas fa-phone" style="color: #94a3b8; width: 16px;"></i>
                                <span>${f.telefone}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px; font-size: 13px; color: #64748b;">
                                <i class="fas fa-envelope" style="color: #94a3b8; width: 16px;"></i>
                                <span>${f.email}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px; font-size: 13px; color: #64748b;">
                                <i class="fas fa-map-marker-alt" style="color: #94a3b8; width: 16px;"></i>
                                <span>${f.cidade} - ${f.estado}</span>
                            </div>
                        </div>

                        <div style="padding: 12px; background: #f8fafc; border-radius: 8px; margin-bottom: 16px;">
                            <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">TOTAL EM COMPRAS</div>
                            <div style="font-size: 18px; font-weight: 700; color: #10b981;">R$ ${(f.totalCompras || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">Última compra: ${new Date(f.ultimaCompra).toLocaleDateString('pt-BR')}</div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                            <button class="btn-fornec-view" data-id="${f.id}" style="padding: 8px; background: #dbeafe; color: #1e40af; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s;"
                                    onmouseover="this.style.background='#3b82f6'; this.style.color='white'"
                                    onmouseout="this.style.background='#dbeafe'; this.style.color='#1e40af'">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn-fornec-edit" data-id="${f.id}" style="padding: 8px; background: #fef3c7; color: #78350f; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s;"
                                    onmouseover="this.style.background='#f59e0b'; this.style.color='white'"
                                    onmouseout="this.style.background='#fef3c7'; this.style.color='#78350f'">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-fornec-delete" data-id="${f.id}" style="padding: 8px; background: #fee2e2; color: #991b1b; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s;"
                                    onmouseover="this.style.background='#ef4444'; this.style.color='white'"
                                    onmouseout="this.style.background='#fee2e2'; this.style.color='#991b1b'">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>

            <style>
                #btn-novo-fornecedor:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
                }
            </style>
        `;

        this.attachEventListeners();
    }

    attachEventListeners() {
        document.getElementById('btn-novo-fornecedor')?.addEventListener('click', () => {
            alert('Modal de novo fornecedor - Em desenvolvimento');
        });

        document.querySelectorAll('.btn-fornec-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                alert(`Visualizar fornecedor ${id} - Em desenvolvimento`);
            });
        });

        document.querySelectorAll('.btn-fornec-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                alert(`Editar fornecedor ${id} - Em desenvolvimento`);
            });
        });

        document.querySelectorAll('.btn-fornec-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                if (confirm('Deseja realmente excluir este fornecedor?')) {
                    alert(`Fornecedor ${id} excluído - Em desenvolvimento`);
                }
            });
        });

        let html = '<div class="fornecedores-page">';
        
        // Header com ações
        html += '<div class="page-header">';
        html += '<div>';
        html += '<h2><i class="fas fa-truck"></i> Fornecedores</h2>';
        html += '<p>Gerencie seus fornecedores cadastrados</p>';
        html += '</div>';
        html += '<button class="btn btn-primary" onclick="fornecedoresCompras.novoFornecedor()">';
        html += '<i class="fas fa-plus"></i> Novo Fornecedor';
        html += '</button>';
        html += '</div>';

        // Filtros
        html += '<div class="filters-bar">';
        html += '<input type="text" placeholder="Buscar por nome, CNPJ..." class="search-input" />';
        html += '<select class="filter-select">';
        html += '<option value="">Todos os status</option>';
        html += '<option value="ativo">Ativo</option>';
        html += '<option value="inativo">Inativo</option>';
        html += '</select>';
        html += '</div>';

        // Tabela
        html += '<div class="fornecedores-table">';
        html += '<table>';
        html += '<thead><tr>';
        html += '<th>Nome</th>';
        html += '<th>CNPJ</th>';
        html += '<th>Telefone</th>';
        html += '<th>Email</th>';
        html += '<th>Status</th>';
        html += '<th>Ações</th>';
        html += '</tr></thead>';
        html += '<tbody>';

        this.fornecedores.forEach(f => {
            const statusClass = f.status === 'ativo' ? 'status-success' : 'status-secondary';
            html += `<tr>
                <td><strong>${f.nome}</strong></td>
                <td>${f.cnpj}</td>
                <td>${f.telefone}</td>
                <td>${f.email}</td>
                <td><span class="status-badge ${statusClass}">${f.status}</span></td>
                <td>
                    <button class="btn-icon" onclick="fornecedoresCompras.editar(${f.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon" onclick="fornecedoresCompras.verDetalhes(${f.id})" title="Ver Detalhes">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>`;
        });

        html += '</tbody></table></div></div>';

        container.innerHTML = html;
    }

    novoFornecedor() {
        alert('Modal de novo fornecedor será implementado aqui');
        // IMPORTANTE: Modal só abre quando o botão é clicado
        // Não há código de auto-abertura neste módulo
    }

    editar(id) {
        alert(`Editar fornecedor ${id}`);
    }

    verDetalhes(id) {
        alert(`Ver detalhes do fornecedor ${id}`);
    }
}

window.fornecedoresCompras = new FornecedoresCompras();
