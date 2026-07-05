/* ========================================
   PEDIDOS DE COMPRA
   ======================================== */

class PedidosCompras {
    constructor() {
        this.pedidos = [];
        this.filtroStatus = 'todos';
    }

    async init() {
        await this.loadPedidos();
        this.render();
        this.attachEventListeners();
    }

    async loadPedidos() {
        try {
            // Dados de demonstração - substituir por API real
            this.pedidos = [
                { 
                    id: 'PC-2025-045', 
                    fornecedor: 'Alumínio Brasil LTDA', 
                    valor: 45890.50, 
                    itens: 12,
                    status: 'pendente', 
                    data: '2025-12-11',
                    prazo: '2025-12-20',
                    observacao: 'Urgente - Produção parada'
                },
                { 
                    id: 'PC-2025-044', 
                    fornecedor: 'MetalPro Indústria', 
                    valor: 128350.00, 
                    itens: 24,
                    status: 'aprovado', 
                    data: '2025-12-10',
                    prazo: '2025-12-18',
                    observacao: ''
                },
                { 
                    id: 'PC-2025-043', 
                    fornecedor: 'Comércio Beta Ltda', 
                    valor: 23450.00, 
                    itens: 8,
                    status: 'em_transito', 
                    data: '2025-12-09',
                    prazo: '2025-12-15',
                    observacao: ''
                },
                { 
                    id: 'PC-2025-042', 
                    fornecedor: 'Fornecedor XYZ', 
                    valor: 67200.00, 
                    itens: 15,
                    status: 'recebido', 
                    data: '2025-12-08',
                    prazo: '2025-12-14',
                    observacao: 'Recebido parcialmente'
                },
                { 
                    id: 'PC-2025-041', 
                    fornecedor: 'Distribuidora Alpha', 
                    valor: 89500.00, 
                    itens: 18,
                    status: 'cancelado', 
                    data: '2025-12-07',
                    prazo: '2025-12-13',
                    observacao: 'Cancelado por divergência de preço'
                },
                { 
                    id: 'PC-2025-040', 
                    fornecedor: 'Insumos Industriais', 
                    valor: 34200.00, 
                    itens: 10,
                    status: 'aprovado', 
                    data: '2025-12-06',
                    prazo: '2025-12-12',
                    observacao: ''
                }
            ];
        } catch (error) {
            console.error('Erro ao carregar pedidos:', error);
        }
    }

    getStatusInfo(status) {
        const statusMap = {
            'pendente': { 
                label: 'Pendente', 
                color: '#f59e0b', 
                bg: '#fef3c7', 
                icon: 'clock' 
            },
            'aprovado': { 
                label: 'Aprovado', 
                color: '#10b981', 
                bg: '#d1fae5', 
                icon: 'check-circle' 
            },
            'em_transito': { 
                label: 'Em Trnsito', 
                color: '#3b82f6', 
                bg: '#dbeafe', 
                icon: 'truck' 
            },
            'recebido': { 
                label: 'Recebido', 
                color: '#059669', 
                bg: '#a7f3d0', 
                icon: 'check-double' 
            },
            'cancelado': { 
                label: 'Cancelado', 
                color: '#ef4444', 
                bg: '#fee2e2', 
                icon: 'times-circle' 
            }
        };
        return statusMap[status] || statusMap['pendente'];
    }

    filtrarPedidos() {
        if (this.filtroStatus === 'todos') {
            return this.pedidos;
        }
        return this.pedidos.filter(p => p.status === this.filtroStatus);
    }

    render() {
        const container = document.getElementById('pedidos-container');
        if (!container) return;

        const pedidosFiltrados = this.filtrarPedidos();
        const totalPedidos = pedidosFiltrados.length;
        const valorTotal = pedidosFiltrados.reduce((sum, p) => sum + p.valor, 0);

        container.innerHTML = `
            <!-- Toolbar -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <button class="filtro-btn ${this.filtroStatus === 'todos' ? 'active' : ''}" data-filtro="todos">
                        <i class="fas fa-list"></i> Todos (${this.pedidos.length})
                    </button>
                    <button class="filtro-btn ${this.filtroStatus === 'pendente' ? 'active' : ''}" data-filtro="pendente">
                        <i class="fas fa-clock"></i> Pendente
                    </button>
                    <button class="filtro-btn ${this.filtroStatus === 'aprovado' ? 'active' : ''}" data-filtro="aprovado">
                        <i class="fas fa-check-circle"></i> Aprovado
                    </button>
                    <button class="filtro-btn ${this.filtroStatus === 'em_transito' ? 'active' : ''}" data-filtro="em_transito">
                        <i class="fas fa-truck"></i> Em Trnsito
                    </button>
                    <button class="filtro-btn ${this.filtroStatus === 'recebido' ? 'active' : ''}" data-filtro="recebido">
                        <i class="fas fa-check-double"></i> Recebido
                    </button>
                </div>
                
                <button id="btn-novo-pedido" style="padding: 12px 24px; background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: all 0.2s;">
                    <i class="fas fa-plus-circle"></i> Novo Pedido
                </button>
            </div>

            <!-- Cards de Resumo -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; margin-bottom: 24px;">
                <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); padding: 20px; border-radius: 12px; border-left: 4px solid #3b82f6;">
                    <div style="font-size: 13px; color: #1e40af; font-weight: 600; margin-bottom: 8px;">TOTAL DE PEDIDOS</div>
                    <div style="font-size: 32px; font-weight: 800; color: #1e3a8a;">${totalPedidos}</div>
                </div>
                <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); padding: 20px; border-radius: 12px; border-left: 4px solid #10b981;">
                    <div style="font-size: 13px; color: #047857; font-weight: 600; margin-bottom: 8px;">VALOR TOTAL</div>
                    <div style="font-size: 32px; font-weight: 800; color: #065f46;">R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                </div>
            </div>

            <!-- Lista de Pedidos -->
            <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-bottom: 2px solid #e2e8f0;">
                                <th style="padding: 16px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Pedido</th>
                                <th style="padding: 16px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Fornecedor</th>
                                <th style="padding: 16px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Itens</th>
                                <th style="padding: 16px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Valor</th>
                                <th style="padding: 16px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Data</th>
                                <th style="padding: 16px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Prazo</th>
                                <th style="padding: 16px; text-align: center; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Status</th>
                                <th style="padding: 16px; text-align: center; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pedidosFiltrados.map((pedido, index) => {
                                const statusInfo = this.getStatusInfo(pedido.status);
                                return `
                                    <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" 
                                        onmouseover="this.style.background='#f8fafc'" 
                                        onmouseout="this.style.background='white'">
                                        <td style="padding: 16px;">
                                            <div style="font-weight: 700; color: #1e293b; font-size: 14px;">${pedido.id}</div>
                                            ${pedido.observacao ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;">${pedido.observacao}</div>` : ''}
                                        </td>
                                        <td style="padding: 16px;">
                                            <div style="font-weight: 600; color: #334155;">${pedido.fornecedor}</div>
                                        </td>
                                        <td style="padding: 16px;">
                                            <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #f1f5f9; border-radius: 6px; font-size: 13px; font-weight: 600; color: #475569;">
                                                <i class="fas fa-box"></i> ${pedido.itens}
                                            </div>
                                        </td>
                                        <td style="padding: 16px;">
                                            <div style="font-weight: 700; color: #10b981; font-size: 15px;">R$ ${pedido.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                        </td>
                                        <td style="padding: 16px;">
                                            <div style="font-size: 13px; color: #64748b;">${new Date(pedido.data).toLocaleDateString('pt-BR')}</div>
                                        </td>
                                        <td style="padding: 16px;">
                                            <div style="font-size: 13px; color: #64748b;">${new Date(pedido.prazo).toLocaleDateString('pt-BR')}</div>
                                        </td>
                                        <td style="padding: 16px; text-align: center;">
                                            <span style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: ${statusInfo.bg}; color: ${statusInfo.color}; border-radius: 8px; font-size: 12px; font-weight: 600;">
                                                <i class="fas fa-${statusInfo.icon}"></i> ${statusInfo.label}
                                            </span>
                                        </td>
                                        <td style="padding: 16px; text-align: center;">
                                            <div style="display: flex; gap: 8px; justify-content: center;">
                                                <button class="btn-action-view" data-id="${pedido.id}" title="Visualizar">
                                                    <i class="fas fa-eye"></i>
                                                </button>
                                                <button class="btn-action-edit" data-id="${pedido.id}" title="Editar">
                                                    <i class="fas fa-edit"></i>
                                                </button>
                                                <button class="btn-action-delete" data-id="${pedido.id}" title="Excluir">
                                                    <i class="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <style>
                .filtro-btn {
                    padding: 10px 18px;
                    background: white;
                    border: 2px solid #e2e8f0;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    color: #64748b;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .filtro-btn:hover {
                    background: #f8fafc;
                    border-color: #cbd5e1;
                }

                .filtro-btn.active {
                    background: linear-gradient(135deg, #10b981, #059669);
                    border-color: #10b981;
                    color: white;
                }

                .btn-action-view, .btn-action-edit, .btn-action-delete {
                    padding: 8px 12px;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-size: 14px;
                }

                .btn-action-view {
                    background: #dbeafe;
                    color: #1e40af;
                }

                .btn-action-view:hover {
                    background: #3b82f6;
                    color: white;
                }

                .btn-action-edit {
                    background: #fef3c7;
                    color: #78350f;
                }

                .btn-action-edit:hover {
                    background: #f59e0b;
                    color: white;
                }

                .btn-action-delete {
                    background: #fee2e2;
                    color: #991b1b;
                }

                .btn-action-delete:hover {
                    background: #ef4444;
                    color: white;
                }

                #btn-novo-pedido:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
                }
            </style>
        `;
    }

    attachEventListeners() {
        // Filtros
        document.querySelectorAll('.filtro-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.filtroStatus = e.currentTarget.dataset.filtro;
                this.render();
                this.attachEventListeners();
            });
        });

        // Novo pedido
        document.getElementById('btn-novo-pedido')?.addEventListener('click', () => {
            alert('Modal de novo pedido - Em desenvolvimento');
        });

        // Ações
        document.querySelectorAll('.btn-action-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                alert(`Visualizar pedido ${id} - Em desenvolvimento`);
            });
        });

        document.querySelectorAll('.btn-action-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                alert(`Editar pedido ${id} - Em desenvolvimento`);
            });
        });

        document.querySelectorAll('.btn-action-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                if (confirm(`Deseja realmente excluir o pedido ${id}?`)) {
                    alert(`Pedido ${id} excluído - Em desenvolvimento`);
                }
            });
        });
    }
}

window.pedidosCompras = new PedidosCompras();
