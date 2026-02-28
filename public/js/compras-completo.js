/**
 * COMPRAS COMPLETO - ALUFORCE
 * Gestão completa de Pedidos de Compra e Fornecedores
 */

const ComprasCompleto = {
    // Configuração
    API_BASE: '/api/compras',
    
    // Estado
    pedidos: [],
    fornecedores: [],
    cotacoes: [],
    dashboard: null,
    filtros: {
        status: '',
        fornecedor_id: '',
        dataInicio: '',
        dataFim: '',
        busca: ''
    },
    paginacao: {
        pagina: 1,
        limite: 20,
        total: 0
    },

    // =====================================================
    // INICIALIZAÇÍO
    // =====================================================
    async init() {
        console.log('🛒 [Compras] Inicializando módulo completo...');
        
        try {
            await this.carregarDashboard();
            await this.carregarFornecedores();
            this.configurarEventos();
            console.log('✅ [Compras] Módulo inicializado com sucesso');
        } catch (error) {
            console.error('❌ [Compras] Erro na inicialização:', error);
        }
    },

    configurarEventos() {
        // Delegação de eventos para botões de ação
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-compras-action]');
            if (!btn) return;

            const action = btn.dataset.comprasAction;
            const id = btn.dataset.id;

            switch (action) {
                case 'ver-pedido':
                    this.visualizarPedido(id);
                    break;
                case 'editar-pedido':
                    this.abrirModalEdicao(id);
                    break;
                case 'aprovar':
                    this.aprovarPedido(id);
                    break;
                case 'cancelar':
                    this.cancelarPedido(id);
                    break;
                case 'receber':
                    this.registrarRecebimento(id);
                    break;
                case 'ver-fornecedor':
                    this.visualizarFornecedor(id);
                    break;
                case 'imprimir':
                    this.imprimirPedido(id);
                    break;
            }
        });
    },

    // =====================================================
    // DASHBOARD
    // =====================================================
    async carregarDashboard() {
        try {
            const resp = await fetch(`${this.API_BASE}/dashboard`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                this.dashboard = data.data;
                return this.dashboard;
            }
        } catch (error) {
            console.error('Erro ao carregar dashboard Compras:', error);
        }
        return null;
    },

    renderizarDashboard(container) {
        if (!container || !this.dashboard) return;

        const { stats, pedidosPorStatus, topFornecedores, pedidosAtrasados } = this.dashboard;

        container.innerHTML = `
            <div class="compras-dashboard">
                <!-- KPIs -->
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 24px;">
                    <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="width: 48px; height: 48px; background: #dbeafe; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-shopping-cart" style="color: #3b82f6; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">Pedidos do Mês</p>
                                <p style="font-size: 28px; font-weight: 700;">${stats?.total_pedidos_mes || 0}</p>
                            </div>
                        </div>
                    </div>
                    <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="width: 48px; height: 48px; background: #dcfce7; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-dollar-sign" style="color: #22c55e; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">Valor Total</p>
                                <p style="font-size: 24px; font-weight: 700; color: #22c55e;">R$ ${this.formatarMoeda(stats?.valor_total_mes)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="width: 48px; height: 48px; background: #fef3c7; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-clock" style="color: #d97706; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">Pendentes</p>
                                <p style="font-size: 28px; font-weight: 700; color: #d97706;">${stats?.pedidos_pendentes || 0}</p>
                            </div>
                        </div>
                    </div>
                    <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="width: 48px; height: 48px; background: #fee2e2; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-exclamation-triangle" style="color: #dc2626; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">Atrasados</p>
                                <p style="font-size: 28px; font-weight: 700; color: #dc2626;">${pedidosAtrasados?.length || 0}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Grid de conteúdo -->
                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px;">
                    <!-- Pedidos Atrasados -->
                    <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-exclamation-circle" style="color: #dc2626;"></i>
                            <h3 style="font-size: 14px; font-weight: 600;">Pedidos Atrasados</h3>
                        </div>
                        <div style="max-height: 300px; overflow-y: auto;">
                            ${pedidosAtrasados?.length > 0 ? pedidosAtrasados.map(p => `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">
                                    <div>
                                        <p style="font-weight: 500; font-size: 13px;">#${p.numero_pedido}</p>
                                        <p style="font-size: 11px; color: #64748b;">${p.fornecedor}</p>
                                    </div>
                                    <div style="text-align: right;">
                                        <span style="display: inline-block; padding: 4px 8px; background: #fee2e2; color: #dc2626; border-radius: 12px; font-size: 11px; font-weight: 600;">
                                            ${p.dias_atraso} dias
                                        </span>
                                    </div>
                                </div>
                            `).join('') : `
                                <div style="padding: 40px; text-align: center; color: #64748b;">
                                    <i class="fas fa-check-circle" style="font-size: 32px; color: #22c55e; margin-bottom: 12px; display: block;"></i>
                                    <p>Nenhum pedido atrasado!</p>
                                </div>
                            `}
                        </div>
                    </div>

                    <!-- Top Fornecedores -->
                    <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-building" style="color: #3b82f6;"></i>
                            <h3 style="font-size: 14px; font-weight: 600;">Top Fornecedores</h3>
                        </div>
                        <div style="max-height: 300px; overflow-y: auto;">
                            ${topFornecedores?.length > 0 ? topFornecedores.slice(0, 5).map((f, i) => `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">
                                    <div style="display: flex; align-items: center; gap: 12px;">
                                        <span style="width: 24px; height: 24px; background: ${['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4'][i]}; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600;">${i + 1}</span>
                                        <div>
                                            <p style="font-weight: 500; font-size: 13px;">${f.razao_social}</p>
                                            <p style="font-size: 11px; color: #64748b;">${f.cidade} - ${f.estado}</p>
                                        </div>
                                    </div>
                                    <div style="text-align: right;">
                                        <p style="font-weight: 600; color: #22c55e; font-size: 13px;">R$ ${this.formatarMoeda(f.total_compras)}</p>
                                        <p style="font-size: 11px; color: #64748b;">${f.total_pedidos} pedidos</p>
                                    </div>
                                </div>
                            `).join('') : `
                                <div style="padding: 40px; text-align: center; color: #64748b;">
                                    <p>Nenhum fornecedor encontrado</p>
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // =====================================================
    // FORNECEDORES
    // =====================================================
    async carregarFornecedores() {
        try {
            const resp = await fetch(`${this.API_BASE}/fornecedores`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                this.fornecedores = data.data || [];
            }
        } catch (error) {
            console.error('Erro ao carregar fornecedores:', error);
        }
    },

    async criarFornecedor(dados) {
        try {
            const resp = await fetch(`${this.API_BASE}/fornecedores`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(dados)
            });

            const result = await resp.json();
            if (resp.ok && result.success) {
                this.mostrarNotificacao('success', 'Fornecedor cadastrado com sucesso!');
                await this.carregarFornecedores();
                return result.data.id;
            } else {
                throw new Error(result.error || 'Erro ao cadastrar fornecedor');
            }
        } catch (error) {
            console.error('Erro ao criar fornecedor:', error);
            this.mostrarNotificacao('error', error.message);
            return null;
        }
    },

    abrirModalFornecedor(fornecedor = null) {
        const isEdicao = !!fornecedor;
        const titulo = isEdicao ? 'Editar Fornecedor' : 'Novo Fornecedor';

        const html = `
            <div class="modal-overlay active" id="modal-fornecedor-overlay">
                <div class="modal" style="max-width: 800px;">
                    <div class="modal-header" style="background: linear-gradient(135deg, #3b82f6, #2563eb);">
                        <div class="modal-header-content">
                            <div class="modal-header-left">
                                <div class="modal-header-icon">
                                    <i class="fas fa-building"></i>
                                </div>
                                <div class="modal-header-text">
                                    <h2>${titulo}</h2>
                                    <p>Dados do fornecedor</p>
                                </div>
                            </div>
                            <button class="modal-close" onclick="ComprasCompleto.fecharModal()">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    <div class="modal-body" style="padding: 24px; max-height: 70vh; overflow-y: auto;">
                        <form id="form-fornecedor">
                            <input type="hidden" name="id" value="${fornecedor?.id || ''}">
                            
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
                                <div class="form-group">
                                    <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">Razão Social *</label>
                                    <input type="text" name="razao_social" value="${fornecedor?.razao_social || ''}" required
                                           style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                </div>
                                <div class="form-group">
                                    <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">Nome Fantasia</label>
                                    <input type="text" name="nome_fantasia" value="${fornecedor?.nome_fantasia || ''}"
                                           style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 20px;">
                                <div class="form-group">
                                    <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">CNPJ *</label>
                                    <input type="text" name="cnpj" value="${fornecedor?.cnpj || ''}" required
                                           style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                </div>
                                <div class="form-group">
                                    <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">Telefone</label>
                                    <input type="text" name="telefone" value="${fornecedor?.telefone || ''}"
                                           style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                </div>
                                <div class="form-group">
                                    <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">E-mail</label>
                                    <input type="email" name="email" value="${fornecedor?.email || ''}"
                                           style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 16px; margin-bottom: 20px;">
                                <div class="form-group">
                                    <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">Endereço</label>
                                    <input type="text" name="endereco" value="${fornecedor?.endereco || ''}"
                                           style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                </div>
                                <div class="form-group">
                                    <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">Cidade</label>
                                    <input type="text" name="cidade" value="${fornecedor?.cidade || ''}"
                                           style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                </div>
                                <div class="form-group">
                                    <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">UF</label>
                                    <input type="text" name="estado" value="${fornecedor?.estado || ''}" maxlength="2"
                                           style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                </div>
                            </div>

                            <div class="form-group" style="margin-bottom: 20px;">
                                <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">Observações</label>
                                <textarea name="observacoes" rows="3" style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; resize: vertical;">${fornecedor?.observacoes || ''}</textarea>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 12px;">
                        <button onclick="ComprasCompleto.fecharModal()" style="padding: 10px 20px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; font-weight: 500;">
                            Cancelar
                        </button>
                        <button onclick="ComprasCompleto.salvarFornecedor()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                            <i class="fas fa-save"></i> Salvar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
    },

    async salvarFornecedor() {
        const form = document.getElementById('form-fornecedor');
        const formData = new FormData(form);
        const dados = Object.fromEntries(formData);
        const id = dados.id;
        delete dados.id;

        try {
            const url = id ? `${this.API_BASE}/fornecedores/${id}` : `${this.API_BASE}/fornecedores`;
            const method = id ? 'PUT' : 'POST';

            const resp = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(dados)
            });

            const result = await resp.json();
            if (resp.ok && result.success) {
                this.mostrarNotificacao('success', `Fornecedor ${id ? 'atualizado' : 'cadastrado'} com sucesso!`);
                this.fecharModal();
                await this.carregarFornecedores();
            } else {
                throw new Error(result.error || 'Erro ao salvar');
            }
        } catch (error) {
            console.error('Erro ao salvar fornecedor:', error);
            this.mostrarNotificacao('error', error.message);
        }
    },

    // =====================================================
    // PEDIDOS DE COMPRA
    // =====================================================
    async carregarPedidos() {
        try {
            const params = new URLSearchParams();
            if (this.filtros.status) params.append('status', this.filtros.status);
            if (this.filtros.fornecedor_id) params.append('fornecedor_id', this.filtros.fornecedor_id);
            params.append('limit', this.paginacao.limite);
            params.append('offset', (this.paginacao.pagina - 1) * this.paginacao.limite);

            const resp = await fetch(`${this.API_BASE}/pedidos?${params}`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                this.pedidos = data.data || [];
                this.paginacao.total = data.total || this.pedidos.length;
            }
        } catch (error) {
            console.error('Erro ao carregar pedidos:', error);
        }
    },

    async criarPedido(dados) {
        try {
            const resp = await fetch(`${this.API_BASE}/pedidos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(dados)
            });

            const result = await resp.json();
            if (resp.ok && result.success) {
                this.mostrarNotificacao('success', 'Pedido de compra criado!');
                await this.carregarPedidos();
                return result.data.id;
            } else {
                throw new Error(result.error || 'Erro ao criar pedido');
            }
        } catch (error) {
            console.error('Erro ao criar pedido:', error);
            this.mostrarNotificacao('error', error.message);
            return null;
        }
    },

    async aprovarPedido(id) {
        if (!confirm('Deseja aprovar este pedido de compra?')) return;

        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}/aprovar`, {
                method: 'POST',
                credentials: 'include'
            });

            if (resp.ok) {
                this.mostrarNotificacao('success', 'Pedido aprovado com sucesso!');
                await this.carregarPedidos();
            } else {
                this.mostrarNotificacao('error', 'Erro ao aprovar pedido');
            }
        } catch (error) {
            console.error('Erro ao aprovar:', error);
            this.mostrarNotificacao('error', 'Erro ao aprovar pedido');
        }
    },

    async cancelarPedido(id) {
        const motivo = prompt('Digite o motivo do cancelamento:');
        if (!motivo) return;

        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}/cancelar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ motivo })
            });

            if (resp.ok) {
                this.mostrarNotificacao('success', 'Pedido cancelado!');
                await this.carregarPedidos();
            } else {
                this.mostrarNotificacao('error', 'Erro ao cancelar pedido');
            }
        } catch (error) {
            console.error('Erro ao cancelar:', error);
            this.mostrarNotificacao('error', 'Erro ao cancelar pedido');
        }
    },

    async registrarRecebimento(id) {
        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}`, { credentials: 'include' });
            if (!resp.ok) throw new Error('Pedido não encontrado');

            const pedido = await resp.json();
            this.abrirModalRecebimento(pedido.data || pedido);
        } catch (error) {
            console.error('Erro ao carregar pedido:', error);
            this.mostrarNotificacao('error', 'Erro ao carregar pedido');
        }
    },

    abrirModalRecebimento(pedido) {
        const html = `
            <div class="modal-overlay active" id="modal-recebimento-overlay">
                <div class="modal" style="max-width: 600px;">
                    <div class="modal-header" style="background: linear-gradient(135deg, #22c55e, #16a34a);">
                        <div class="modal-header-content">
                            <div class="modal-header-left">
                                <div class="modal-header-icon">
                                    <i class="fas fa-truck-loading"></i>
                                </div>
                                <div class="modal-header-text">
                                    <h2>Registrar Recebimento</h2>
                                    <p>Pedido #${pedido.numero_pedido || pedido.id}</p>
                                </div>
                            </div>
                            <button class="modal-close" onclick="ComprasCompleto.fecharModalRecebimento()">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    <div class="modal-body" style="padding: 24px;">
                        <form id="form-recebimento">
                            <input type="hidden" name="pedido_id" value="${pedido.id}">
                            
                            <div class="form-group" style="margin-bottom: 16px;">
                                <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">Data do Recebimento</label>
                                <input type="date" name="data_recebimento" value="${new Date().toISOString().split('T')[0]}" required
                                       style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                            </div>

                            <div class="form-group" style="margin-bottom: 16px;">
                                <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">Número da NF-e</label>
                                <input type="text" name="nf_numero" placeholder="Número da nota fiscal"
                                       style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                            </div>

                            <div class="form-group" style="margin-bottom: 16px;">
                                <label style="font-size: 13px; font-weight: 500; margin-bottom: 6px; display: block;">Observações</label>
                                <textarea name="observacoes" rows="3" placeholder="Observações sobre o recebimento..."
                                          style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; resize: vertical;"></textarea>
                            </div>

                            <div class="form-group">
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="checkbox" name="conferido" style="width: 18px; height: 18px;">
                                    <span>Materiais conferidos e em conformidade</span>
                                </label>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 12px;">
                        <button onclick="ComprasCompleto.fecharModalRecebimento()" style="padding: 10px 20px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; font-weight: 500;">
                            Cancelar
                        </button>
                        <button onclick="ComprasCompleto.confirmarRecebimento()" style="padding: 10px 20px; background: #22c55e; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                            <i class="fas fa-check"></i> Confirmar Recebimento
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
    },

    fecharModalRecebimento() {
        const modal = document.getElementById('modal-recebimento-overlay');
        if (modal) modal.remove();
    },

    async confirmarRecebimento() {
        const form = document.getElementById('form-recebimento');
        const formData = new FormData(form);
        const dados = Object.fromEntries(formData);
        dados.conferido = form.querySelector('[name="conferido"]').checked;

        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${dados.pedido_id}/receber`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(dados)
            });

            if (resp.ok) {
                this.mostrarNotificacao('success', 'Recebimento registrado com sucesso!');
                this.fecharModalRecebimento();
                await this.carregarPedidos();
            } else {
                this.mostrarNotificacao('error', 'Erro ao registrar recebimento');
            }
        } catch (error) {
            console.error('Erro:', error);
            this.mostrarNotificacao('error', 'Erro ao registrar recebimento');
        }
    },

    // =====================================================
    // VISUALIZAÇÍO
    // =====================================================
    async visualizarPedido(id) {
        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}`, { credentials: 'include' });
            if (!resp.ok) throw new Error('Pedido não encontrado');

            const result = await resp.json();
            const pedido = result.data || result;
            this.renderizarModalPedido(pedido);
        } catch (error) {
            console.error('Erro ao visualizar pedido:', error);
            this.mostrarNotificacao('error', 'Erro ao carregar pedido');
        }
    },

    renderizarModalPedido(pedido) {
        const statusColor = this.getStatusColor(pedido.status);
        const itens = pedido.itens || [];

        const html = `
            <div class="modal-overlay active" id="modal-pedido-overlay">
                <div class="modal" style="max-width: 900px;">
                    <div class="modal-header" style="background: linear-gradient(135deg, ${statusColor}, ${statusColor}dd);">
                        <div class="modal-header-content">
                            <div class="modal-header-left">
                                <div class="modal-header-icon">
                                    <i class="fas fa-shopping-cart"></i>
                                </div>
                                <div class="modal-header-text">
                                    <h2>Pedido #${pedido.numero_pedido || pedido.id}</h2>
                                    <p>${pedido.fornecedor_nome || 'Fornecedor'}</p>
                                </div>
                            </div>
                            <button class="modal-close" onclick="ComprasCompleto.fecharModal()">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    <div class="modal-body" style="padding: 24px; max-height: 70vh; overflow-y: auto;">
                        <!-- Status e Valores -->
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
                            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">STATUS</p>
                                <span style="display: inline-block; padding: 6px 12px; border-radius: 20px; background: ${statusColor}22; color: ${statusColor}; font-weight: 600; font-size: 12px;">
                                    ${this.formatarStatus(pedido.status)}
                                </span>
                            </div>
                            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">VALOR TOTAL</p>
                                <p style="font-size: 20px; font-weight: 700; color: #22c55e;">R$ ${this.formatarMoeda(pedido.valor_total)}</p>
                            </div>
                            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">DATA DO PEDIDO</p>
                                <p style="font-size: 14px; font-weight: 600;">${this.formatarData(pedido.data_pedido)}</p>
                            </div>
                            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">ENTREGA PREVISTA</p>
                                <p style="font-size: 14px; font-weight: 600;">${this.formatarData(pedido.data_entrega_prevista)}</p>
                            </div>
                        </div>

                        <!-- Fornecedor -->
                        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                            <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-building" style="color: #3b82f6;"></i>
                                Fornecedor
                            </h4>
                            <p style="font-weight: 500;">${pedido.fornecedor_nome || '-'}</p>
                            <p style="font-size: 13px; color: #64748b;">${pedido.fornecedor_cnpj || ''}</p>
                        </div>

                        <!-- Itens -->
                        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                            <h4 style="font-size: 14px; font-weight: 600; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-box" style="color: #8b5cf6;"></i>
                                Itens do Pedido
                            </h4>
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="background: #f8fafc;">
                                        <th style="padding: 12px 16px; text-align: left; font-size: 11px; color: #64748b;">Produto</th>
                                        <th style="padding: 12px 16px; text-align: center; font-size: 11px; color: #64748b;">Qtd</th>
                                        <th style="padding: 12px 16px; text-align: right; font-size: 11px; color: #64748b;">Valor Unit.</th>
                                        <th style="padding: 12px 16px; text-align: right; font-size: 11px; color: #64748b;">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itens.length > 0 ? itens.map(i => `
                                        <tr style="border-bottom: 1px solid #f1f5f9;">
                                            <td style="padding: 12px 16px;">${i.descricao || i.produto_descricao || '-'}</td>
                                            <td style="padding: 12px 16px; text-align: center;">${i.quantidade}</td>
                                            <td style="padding: 12px 16px; text-align: right;">R$ ${this.formatarMoeda(i.valor_unitario)}</td>
                                            <td style="padding: 12px 16px; text-align: right; font-weight: 600;">R$ ${this.formatarMoeda(i.valor_total)}</td>
                                        </tr>
                                    `).join('') : `
                                        <tr>
                                            <td colspan="4" style="padding: 20px; text-align: center; color: #64748b;">Nenhum item no pedido</td>
                                        </tr>
                                    `}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 12px;">
                        <button onclick="ComprasCompleto.imprimirPedido(${pedido.id})" style="padding: 10px 16px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; font-weight: 500;">
                            <i class="fas fa-print"></i> Imprimir
                        </button>
                        <button onclick="ComprasCompleto.fecharModal()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                            Fechar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
    },

    fecharModal() {
        const modal = document.getElementById('modal-pedido-overlay') || document.getElementById('modal-fornecedor-overlay');
        if (modal) modal.remove();
    },

    // =====================================================
    // UTILITÁRIOS
    // =====================================================
    formatarMoeda(valor) {
        const num = parseFloat(valor) || 0;
        return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    formatarData(data) {
        if (!data) return '-';
        const d = new Date(data);
        return d.toLocaleDateString('pt-BR');
    },

    formatarStatus(status) {
        const statusMap = {
            'rascunho': 'Rascunho',
            'pendente': 'Pendente',
            'aprovado': 'Aprovado',
            'enviado': 'Enviado',
            'recebido': 'Recebido',
            'cancelado': 'Cancelado'
        };
        return statusMap[status] || status || '-';
    },

    getStatusColor(status) {
        const colorMap = {
            'rascunho': '#64748b',
            'pendente': '#f59e0b',
            'aprovado': '#22c55e',
            'enviado': '#3b82f6',
            'recebido': '#10b981',
            'cancelado': '#ef4444'
        };
        return colorMap[status] || '#64748b';
    },

    mostrarNotificacao(tipo, mensagem) {
        if (typeof showToast === 'function') {
            showToast(mensagem, tipo);
            return;
        }

        const colors = { success: '#22c55e', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };
        const toast = document.createElement('div');
        toast.innerHTML = `<i class="fas fa-${tipo === 'success' ? 'check-circle' : 'exclamation-circle'}"></i> <span>${mensagem}</span>`;
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; padding: 16px 24px;
            background: ${colors[tipo]}; color: white; border-radius: 8px;
            display: flex; align-items: center; gap: 10px; font-size: 14px;
            font-weight: 500; z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    },

    async imprimirPedido(id) {
        const pedido = this.pedidos.find(p => p.id == id);
        if (!pedido) return;

        // Buscar dados dinmicos da empresa
        let empresa = { nome_fantasia: 'ALUFORCE', razao_social: '', cnpj: '', endereco: '', cidade: '', estado: '', cep: '', telefone: '', logo_url: '' };
        try {
            if (window.EmpresaService) {
                empresa = await window.EmpresaService.getDados();
            }
        } catch (e) { console.warn('Erro ao buscar dados da empresa:', e); }

        const nomeEmpresa = empresa.nome_fantasia || empresa.razao_social || 'ALUFORCE';
        const logoUrl = empresa.logo_url || '/public/images/Logo Monocromatico - Azul - Aluforce.png';
        const cnpjFormatado = empresa.cnpj || '';
        const enderecoCompleto = [empresa.endereco, empresa.numero].filter(Boolean).join(', ');
        const cidadeEstado = [empresa.cidade, empresa.estado].filter(Boolean).join(' - ');

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Pedido de Compra #${pedido.numero_pedido || pedido.id}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
                    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #1a365d; padding-bottom: 15px; }
                    .header-logo { flex: 0 0 150px; }
                    .header-logo img { max-width: 150px; max-height: 60px; }
                    .header-empresa { flex: 1; margin-left: 20px; }
                    .header-empresa h1 { font-size: 16px; color: #1a365d; margin: 0 0 5px 0; }
                    .header-empresa p { font-size: 10px; color: #4a5568; margin: 2px 0; }
                    .header-doc { text-align: right; }
                    .header-doc h2 { font-size: 14px; color: #1a365d; margin: 0; }
                    .header-doc .numero { font-size: 18px; font-weight: bold; margin: 5px 0; }
                    .section { border: 1px solid #ddd; margin-bottom: 15px; padding: 15px; }
                    .section h3 { font-size: 12px; background: #f5f5f5; padding: 5px 10px; margin: -15px -15px 10px -15px; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background: #f5f5f5; }
                    .total { font-weight: bold; text-align: right; margin-top: 20px; font-size: 14px; }
                    .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #666; border-top: 1px solid #e2e8f0; padding-top: 15px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="header-logo">
                        <img src="${logoUrl}" alt="${nomeEmpresa}" onerror="this.style.display='none'">
                    </div>
                    <div class="header-empresa">
                        <h1>${nomeEmpresa}</h1>
                        ${cnpjFormatado ? `<p>CNPJ: ${cnpjFormatado}</p>` : ''}
                        ${enderecoCompleto ? `<p>${enderecoCompleto}${empresa.bairro ? ' - ' + empresa.bairro : ''}</p>` : ''}
                        ${cidadeEstado ? `<p>${cidadeEstado}${empresa.cep ? ' | CEP: ' + empresa.cep : ''}</p>` : ''}
                        ${empresa.telefone ? `<p>Tel: ${empresa.telefone}</p>` : ''}
                    </div>
                    <div class="header-doc">
                        <h2>PEDIDO DE COMPRA</h2>
                        <p class="numero">Nº ${pedido.numero_pedido || pedido.id}</p>
                    </div>
                </div>
                <div class="section">
                    <h3>FORNECEDOR</h3>
                    <p><strong>${pedido.fornecedor_nome || '-'}</strong></p>
                    <p>CNPJ: ${pedido.fornecedor_cnpj || '-'}</p>
                </div>
                <div class="section">
                    <h3>INFORMAÇÕES DO PEDIDO</h3>
                    <p>Data: ${this.formatarData(pedido.data_pedido)}</p>
                    <p>Entrega Prevista: ${this.formatarData(pedido.data_entrega_prevista)}</p>
                    <p>Status: ${this.formatarStatus(pedido.status)}</p>
                </div>
                <div class="total">VALOR TOTAL: R$ ${this.formatarMoeda(pedido.valor_total)}</div>
                <div class="footer">
                    <p>Documento gerado em ${new Date().toLocaleString('pt-BR')}</p>
                    <p>${nomeEmpresa} - Sistema de Gestão Empresarial</p>
                </div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    }
};

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('Compras') || window.location.pathname.includes('compras')) {
        ComprasCompleto.init();
    }
});

// Exportar para uso global
window.ComprasCompleto = ComprasCompleto;
