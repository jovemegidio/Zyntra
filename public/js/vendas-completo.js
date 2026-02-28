/**
 * VENDAS COMPLETO - ALUFORCE
 * Gestão completa de Pedidos, Orçamentos e Clientes
 */

const VendasCompleto = {
    // Configuração
    API_BASE: '/api/vendas',
    
    // Estado
    pedidos: [],
    clientes: [],
    produtos: [],
    vendedores: [],
    filtros: {
        status: '',
        cliente: '',
        vendedor: '',
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
        console.log('🛒 [Vendas] Inicializando módulo completo...');
        
        try {
            await this.carregarDadosIniciais();
            this.configurarEventos();
            console.log('✅ [Vendas] Módulo inicializado com sucesso');
        } catch (error) {
            console.error('❌ [Vendas] Erro na inicialização:', error);
        }
    },

    async carregarDadosIniciais() {
        await Promise.all([
            this.carregarPedidos(),
            this.carregarVendedores()
        ]);
    },

    configurarEventos() {
        // Delegação de eventos para botões de ação
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-vendas-action]');
            if (!btn) return;

            const action = btn.dataset.vendasAction;
            const id = btn.dataset.id;

            switch (action) {
                case 'ver-pedido':
                    this.abrirModalPedido(id);
                    break;
                case 'editar-pedido':
                    this.abrirModalEdicao(id);
                    break;
                case 'faturar':
                    this.faturarPedido(id);
                    break;
                case 'cancelar':
                    this.cancelarPedido(id);
                    break;
                case 'imprimir':
                    this.imprimirPedido(id);
                    break;
                case 'duplicar':
                    this.duplicarPedido(id);
                    break;
            }
        });

        // Filtros
        document.addEventListener('change', (e) => {
            if (e.target.closest('.vendas-filtro')) {
                this.aplicarFiltros();
            }
        });

        // Busca com debounce
        let buscaTimeout;
        document.addEventListener('input', (e) => {
            if (e.target.closest('.vendas-busca')) {
                clearTimeout(buscaTimeout);
                buscaTimeout = setTimeout(() => {
                    this.filtros.busca = e.target.value;
                    this.aplicarFiltros();
                }, 300);
            }
        });
    },

    // =====================================================
    // PEDIDOS
    // =====================================================
    async carregarPedidos() {
        try {
            const params = new URLSearchParams();
            if (this.filtros.status) params.append('status', this.filtros.status);
            if (this.filtros.dataInicio) params.append('dataInicio', this.filtros.dataInicio);
            if (this.filtros.dataFim) params.append('dataFim', this.filtros.dataFim);
            params.append('limit', this.paginacao.limite);
            params.append('offset', (this.paginacao.pagina - 1) * this.paginacao.limite);

            const resp = await fetch(`${this.API_BASE}/pedidos?${params}`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                this.pedidos = Array.isArray(data) ? data : (data.pedidos || []);
                this.paginacao.total = data.total || this.pedidos.length;
            }
        } catch (error) {
            console.error('Erro ao carregar pedidos:', error);
        }
    },

    async carregarVendedores() {
        try {
            const resp = await fetch('/api/usuarios?role=vendedor', { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                this.vendedores = data.usuarios || data || [];
            }
        } catch (error) {
            console.warn('Não foi possível carregar vendedores');
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
                this.mostrarNotificacao('success', 'Pedido criado com sucesso!');
                await this.carregarPedidos();
                return result.id;
            } else {
                throw new Error(result.message || 'Erro ao criar pedido');
            }
        } catch (error) {
            console.error('Erro ao criar pedido:', error);
            this.mostrarNotificacao('error', error.message);
            return null;
        }
    },

    async atualizarPedido(id, dados) {
        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(dados)
            });

            const result = await resp.json();
            if (resp.ok && result.success) {
                this.mostrarNotificacao('success', 'Pedido atualizado!');
                await this.carregarPedidos();
                return true;
            } else {
                throw new Error(result.message || 'Erro ao atualizar pedido');
            }
        } catch (error) {
            console.error('Erro ao atualizar pedido:', error);
            this.mostrarNotificacao('error', error.message);
            return false;
        }
    },

    async atualizarStatus(id, status) {
        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ status })
            });

            const result = await resp.json();
            if (resp.ok && result.success) {
                this.mostrarNotificacao('success', `Status alterado para: ${this.formatarStatus(status)}`);
                await this.carregarPedidos();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Erro ao atualizar status:', error);
            return false;
        }
    },

    async faturarPedido(id) {
        if (!confirm('Deseja faturar este pedido? Esta ação irá gerar uma NF-e.')) return;

        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}/faturar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });

            const result = await resp.json();
            if (resp.ok && result.success) {
                this.mostrarNotificacao('success', 'Pedido faturado com sucesso!');
                await this.carregarPedidos();
            } else {
                throw new Error(result.message || 'Erro ao faturar');
            }
        } catch (error) {
            console.error('Erro ao faturar:', error);
            this.mostrarNotificacao('error', error.message);
        }
    },

    async cancelarPedido(id) {
        if (!confirm('Tem certeza que deseja cancelar este pedido?')) return;

        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            const result = await resp.json();
            if (resp.ok && result.success) {
                this.mostrarNotificacao('success', 'Pedido cancelado!');
                await this.carregarPedidos();
            }
        } catch (error) {
            console.error('Erro ao cancelar:', error);
            this.mostrarNotificacao('error', 'Erro ao cancelar pedido');
        }
    },

    async duplicarPedido(id) {
        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}`, { credentials: 'include' });
            if (!resp.ok) throw new Error('Pedido não encontrado');

            const pedidoOriginal = await resp.json();
            
            const novoPedido = {
                cliente_id: pedidoOriginal.cliente_id,
                empresa_id: pedidoOriginal.empresa_id,
                produtos: pedidoOriginal.produtos || [],
                valor: pedidoOriginal.valor,
                descricao: `[CÓPIA] ${pedidoOriginal.descricao || ''}`,
                status: 'orcamento',
                frete: pedidoOriginal.frete,
                prioridade: pedidoOriginal.prioridade,
                endereco_entrega: pedidoOriginal.endereco_entrega,
                municipio_entrega: pedidoOriginal.municipio_entrega
            };

            const novoId = await this.criarPedido(novoPedido);
            if (novoId) {
                this.mostrarNotificacao('success', `Pedido duplicado! Novo ID: ${novoId}`);
            }
        } catch (error) {
            console.error('Erro ao duplicar:', error);
            this.mostrarNotificacao('error', 'Erro ao duplicar pedido');
        }
    },

    // =====================================================
    // MODAL DE PEDIDO
    // =====================================================
    async abrirModalPedido(id) {
        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}`, { credentials: 'include' });
            if (!resp.ok) throw new Error('Pedido não encontrado');

            const pedido = await resp.json();
            this.renderizarModalPedido(pedido);
        } catch (error) {
            console.error('Erro ao abrir pedido:', error);
            this.mostrarNotificacao('error', 'Erro ao carregar pedido');
        }
    },

    renderizarModalPedido(pedido) {
        const statusColor = this.getStatusColor(pedido.status);
        const produtos = pedido.produtos || [];
        const totalProdutos = produtos.reduce((acc, p) => acc + (parseFloat(p.valor_total || p.preco || 0)), 0);

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
                                    <h2>Pedido #${pedido.id}</h2>
                                    <p>${pedido.cliente || pedido.cliente_nome || 'Cliente não informado'}</p>
                                </div>
                            </div>
                            <button class="modal-close" onclick="VendasCompleto.fecharModal()">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    <div class="modal-body" style="padding: 24px; max-height: 70vh; overflow-y: auto;">
                        <!-- Status e Informações Principais -->
                        <div class="info-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
                            <div class="info-card" style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">STATUS</p>
                                <span class="status-badge" style="display: inline-block; padding: 6px 12px; border-radius: 20px; background: ${statusColor}22; color: ${statusColor}; font-weight: 600; font-size: 12px;">
                                    ${this.formatarStatus(pedido.status)}
                                </span>
                            </div>
                            <div class="info-card" style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">VALOR TOTAL</p>
                                <p style="font-size: 20px; font-weight: 700; color: #22c55e;">R$ ${this.formatarMoeda(pedido.valor || pedido.valor_total)}</p>
                            </div>
                            <div class="info-card" style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">DATA</p>
                                <p style="font-size: 14px; font-weight: 600;">${this.formatarData(pedido.data_pedido || pedido.data_criacao || pedido.created_at)}</p>
                            </div>
                            <div class="info-card" style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">VENDEDOR</p>
                                <p style="font-size: 14px; font-weight: 600;">${pedido.vendedor_nome || pedido.vendedor || '-'}</p>
                            </div>
                        </div>

                        <!-- Dados do Cliente -->
                        <div class="section" style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                            <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-user" style="color: #3b82f6;"></i>
                                Dados do Cliente
                            </h4>
                            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 16px;">
                                <div>
                                    <p style="font-size: 11px; color: #64748b;">Nome/Razão Social</p>
                                    <p style="font-weight: 500;">${pedido.cliente_nome || pedido.cliente || '-'}</p>
                                </div>
                                <div>
                                    <p style="font-size: 11px; color: #64748b;">E-mail</p>
                                    <p style="font-weight: 500;">${pedido.cliente_email || '-'}</p>
                                </div>
                                <div>
                                    <p style="font-size: 11px; color: #64748b;">Telefone</p>
                                    <p style="font-weight: 500;">${pedido.cliente_telefone || '-'}</p>
                                </div>
                            </div>
                        </div>

                        <!-- Produtos -->
                        <div class="section" style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 20px;">
                            <h4 style="font-size: 14px; font-weight: 600; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-box" style="color: #8b5cf6;"></i>
                                Produtos (${produtos.length} itens)
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
                                    ${produtos.length > 0 ? produtos.map(p => `
                                        <tr style="border-bottom: 1px solid #f1f5f9;">
                                            <td style="padding: 12px 16px;">
                                                <p style="font-weight: 500; font-size: 13px;">${p.descricao || p.nome || '-'}</p>
                                                <p style="font-size: 11px; color: #64748b;">${p.codigo || ''}</p>
                                            </td>
                                            <td style="padding: 12px 16px; text-align: center;">${p.quantidade || 1}</td>
                                            <td style="padding: 12px 16px; text-align: right;">R$ ${this.formatarMoeda(p.preco_unitario || p.preco || 0)}</td>
                                            <td style="padding: 12px 16px; text-align: right; font-weight: 600;">R$ ${this.formatarMoeda(p.valor_total || p.preco || 0)}</td>
                                        </tr>
                                    `).join('') : `
                                        <tr>
                                            <td colspan="4" style="padding: 20px; text-align: center; color: #64748b;">Nenhum produto no pedido</td>
                                        </tr>
                                    `}
                                </tbody>
                                <tfoot>
                                    <tr style="background: #f0fdf4;">
                                        <td colspan="3" style="padding: 12px 16px; text-align: right; font-weight: 600;">Subtotal:</td>
                                        <td style="padding: 12px 16px; text-align: right; font-weight: 700;">R$ ${this.formatarMoeda(totalProdutos)}</td>
                                    </tr>
                                    ${pedido.frete > 0 ? `
                                    <tr>
                                        <td colspan="3" style="padding: 8px 16px; text-align: right; font-size: 13px;">Frete:</td>
                                        <td style="padding: 8px 16px; text-align: right;">R$ ${this.formatarMoeda(pedido.frete)}</td>
                                    </tr>
                                    ` : ''}
                                    <tr style="background: #dcfce7;">
                                        <td colspan="3" style="padding: 14px 16px; text-align: right; font-weight: 700; font-size: 15px;">TOTAL:</td>
                                        <td style="padding: 14px 16px; text-align: right; font-weight: 700; font-size: 18px; color: #22c55e;">R$ ${this.formatarMoeda(pedido.valor || pedido.valor_total)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        ${pedido.observacao || pedido.descricao ? `
                        <div class="section" style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 12px; padding: 16px;">
                            <h4 style="font-size: 13px; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-sticky-note" style="color: #d97706;"></i>
                                Observações
                            </h4>
                            <p style="font-size: 13px; color: #92400e;">${pedido.observacao || pedido.descricao}</p>
                        </div>
                        ` : ''}
                    </div>
                    <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between;">
                        <div>
                            <button class="btn btn-secondary" onclick="VendasCompleto.imprimirPedido(${pedido.id})" style="padding: 10px 20px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; cursor: pointer; font-weight: 500;">
                                <i class="fas fa-print"></i> Imprimir
                            </button>
                        </div>
                        <div style="display: flex; gap: 12px;">
                            <button class="btn btn-secondary" onclick="VendasCompleto.fecharModal()" style="padding: 10px 20px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; cursor: pointer; font-weight: 500;">
                                Fechar
                            </button>
                            ${pedido.status !== 'faturado' && pedido.status !== 'cancelado' ? `
                            <button class="btn btn-primary" onclick="VendasCompleto.faturarPedido(${pedido.id})" style="padding: 10px 20px; border-radius: 8px; background: #22c55e; color: white; border: none; cursor: pointer; font-weight: 600;">
                                <i class="fas fa-file-invoice"></i> Faturar
                            </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
    },

    fecharModal() {
        const modal = document.getElementById('modal-pedido-overlay');
        if (modal) modal.remove();
    },

    // =====================================================
    // IMPRESSÍO
    // =====================================================
    async imprimirPedido(id) {
        try {
            const resp = await fetch(`${this.API_BASE}/pedidos/${id}`, { credentials: 'include' });
            if (!resp.ok) throw new Error('Pedido não encontrado');

            const pedido = await resp.json();
            const produtos = pedido.produtos || [];

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
                    <title>Pedido #${pedido.id}</title>
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
                        .info-row { display: flex; justify-content: space-between; margin-bottom: 15px; }
                        .info-box { border: 1px solid #ddd; padding: 10px; flex: 1; margin: 0 5px; }
                        .info-box h3 { font-size: 11px; color: #666; margin-bottom: 5px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background: #f5f5f5; font-size: 11px; }
                        .total-row { font-weight: bold; background: #e8f5e9; }
                        .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #666; border-top: 1px solid #e2e8f0; padding-top: 15px; }
                        @media print { body { padding: 0; } }
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
                            <h2>PEDIDO DE VENDA</h2>
                            <p class="numero">Nº ${pedido.id}</p>
                        </div>
                    </div>
                    
                    <div class="info-row">
                        <div class="info-box">
                            <h3>CLIENTE</h3>
                            <p><strong>${pedido.cliente_nome || pedido.cliente || '-'}</strong></p>
                            <p>Email: ${pedido.cliente_email || '-'}</p>
                            <p>Tel: ${pedido.cliente_telefone || '-'}</p>
                        </div>
                        <div class="info-box">
                            <h3>INFORMAÇÕES DO PEDIDO</h3>
                            <p>Data: ${this.formatarData(pedido.created_at)}</p>
                            <p>Status: ${this.formatarStatus(pedido.status)}</p>
                            <p>Vendedor: ${pedido.vendedor_nome || '-'}</p>
                        </div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 50%;">Produto</th>
                                <th style="width: 15%; text-align: center;">Qtd</th>
                                <th style="width: 15%; text-align: right;">Valor Unit.</th>
                                <th style="width: 20%; text-align: right;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${produtos.map(p => `
                                <tr>
                                    <td>${p.descricao || p.nome || '-'}</td>
                                    <td style="text-align: center;">${p.quantidade || 1}</td>
                                    <td style="text-align: right;">R$ ${this.formatarMoeda(p.preco_unitario || p.preco || 0)}</td>
                                    <td style="text-align: right;">R$ ${this.formatarMoeda(p.valor_total || p.preco || 0)}</td>
                                </tr>
                            `).join('')}
                            ${pedido.frete > 0 ? `
                            <tr>
                                <td colspan="3" style="text-align: right;">Frete:</td>
                                <td style="text-align: right;">R$ ${this.formatarMoeda(pedido.frete)}</td>
                            </tr>
                            ` : ''}
                            <tr class="total-row">
                                <td colspan="3" style="text-align: right;">TOTAL:</td>
                                <td style="text-align: right;">R$ ${this.formatarMoeda(pedido.valor || pedido.valor_total)}</td>
                            </tr>
                        </tbody>
                    </table>
                    
                    ${pedido.observacao ? `<p style="margin-top: 20px;"><strong>Observações:</strong> ${pedido.observacao}</p>` : ''}
                    
                    <div class="footer">
                        <p>Documento gerado em ${new Date().toLocaleString('pt-BR')}</p>
                        <p>${nomeEmpresa} - Sistema de Gestão Empresarial</p>
                    </div>
                </body>
                </html>
            `);
            printWindow.document.close();
            printWindow.print();
        } catch (error) {
            console.error('Erro ao imprimir:', error);
            this.mostrarNotificacao('error', 'Erro ao gerar impressão');
        }
    },

    // =====================================================
    // DASHBOARD
    // =====================================================
    async carregarDashboard() {
        try {
            const resp = await fetch(`${this.API_BASE}/dashboard`, { credentials: 'include' });
            if (resp.ok) {
                return await resp.json();
            }
        } catch (error) {
            console.error('Erro ao carregar dashboard:', error);
        }
        return null;
    },

    async renderizarDashboard(container) {
        const stats = await this.carregarDashboard();
        if (!container || !stats) return;

        container.innerHTML = `
            <div class="vendas-dashboard" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">
                <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <div style="width: 48px; height: 48px; background: #dbeafe; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-shopping-cart" style="color: #3b82f6; font-size: 20px;"></i>
                        </div>
                        <div>
                            <p style="font-size: 12px; color: #64748b;">Pedidos Ativos</p>
                            <p style="font-size: 28px; font-weight: 700;">${stats.pedidosAtivos || 0}</p>
                        </div>
                    </div>
                </div>
                <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <div style="width: 48px; height: 48px; background: #dcfce7; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-dollar-sign" style="color: #22c55e; font-size: 20px;"></i>
                        </div>
                        <div>
                            <p style="font-size: 12px; color: #64748b;">Vendas do Mês</p>
                            <p style="font-size: 28px; font-weight: 700; color: #22c55e;">R$ ${this.formatarMoeda(stats.vendasMes)}</p>
                        </div>
                    </div>
                </div>
                <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <div style="width: 48px; height: 48px; background: #fef3c7; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-users" style="color: #d97706; font-size: 20px;"></i>
                        </div>
                        <div>
                            <p style="font-size: 12px; color: #64748b;">Clientes Ativos</p>
                            <p style="font-size: 28px; font-weight: 700;">${stats.clientesAtivos || 0}</p>
                        </div>
                    </div>
                </div>
                <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <div style="width: 48px; height: 48px; background: #fce7f3; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-percent" style="color: #db2777; font-size: 20px;"></i>
                        </div>
                        <div>
                            <p style="font-size: 12px; color: #64748b;">Taxa de Conversão</p>
                            <p style="font-size: 28px; font-weight: 700;">${stats.taxaConversao || 0}%</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
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
            'orcamento': 'Orçamento',
            'pendente': 'Pendente',
            'aprovado': 'Aprovado',
            'em_producao': 'Em Produção',
            'faturado': 'Faturado',
            'enviado': 'Enviado',
            'entregue': 'Entregue',
            'cancelado': 'Cancelado'
        };
        return statusMap[status] || status || '-';
    },

    getStatusColor(status) {
        const colorMap = {
            'orcamento': '#64748b',
            'pendente': '#f59e0b',
            'aprovado': '#22c55e',
            'em_producao': '#3b82f6',
            'faturado': '#8b5cf6',
            'enviado': '#06b6d4',
            'entregue': '#10b981',
            'cancelado': '#ef4444'
        };
        return colorMap[status] || '#64748b';
    },

    aplicarFiltros() {
        // Implementar filtro local ou recarregar do servidor
        this.carregarPedidos();
    },

    mostrarNotificacao(tipo, mensagem) {
        if (typeof showToast === 'function') {
            showToast(mensagem, tipo);
            return;
        }

        const toast = document.createElement('div');
        toast.innerHTML = `
            <i class="fas fa-${tipo === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            <span>${mensagem}</span>
        `;
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; padding: 16px 24px;
            background: ${tipo === 'success' ? '#22c55e' : '#ef4444'}; color: white;
            border-radius: 8px; display: flex; align-items: center; gap: 10px;
            font-size: 14px; font-weight: 500; z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    },

    // Método para gerar linha de tabela de pedido
    gerarLinhaPedido(pedido) {
        const statusColor = this.getStatusColor(pedido.status);
        return `
            <tr data-id="${pedido.id}" style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 14px 16px;">
                    <span style="font-weight: 600;">#${pedido.id}</span>
                </td>
                <td style="padding: 14px 16px;">
                    <p style="font-weight: 500;">${pedido.cliente_nome || pedido.cliente || '-'}</p>
                </td>
                <td style="padding: 14px 16px;">
                    <span style="display: inline-block; padding: 4px 10px; border-radius: 12px; background: ${statusColor}22; color: ${statusColor}; font-size: 11px; font-weight: 600;">
                        ${this.formatarStatus(pedido.status)}
                    </span>
                </td>
                <td style="padding: 14px 16px; font-weight: 600; color: #22c55e;">
                    R$ ${this.formatarMoeda(pedido.valor || pedido.valor_total)}
                </td>
                <td style="padding: 14px 16px;">
                    ${this.formatarData(pedido.created_at || pedido.data_pedido)}
                </td>
                <td style="padding: 14px 16px;">
                    <div style="display: flex; gap: 4px;">
                        <button class="btn-action" data-vendas-action="ver-pedido" data-id="${pedido.id}" title="Visualizar" style="width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: #dbeafe; color: #3b82f6;">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-action" data-vendas-action="editar-pedido" data-id="${pedido.id}" title="Editar" style="width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: #fef3c7; color: #d97706;">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-action" data-vendas-action="imprimir" data-id="${pedido.id}" title="Imprimir" style="width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: #e0e7ff; color: #6366f1;">
                            <i class="fas fa-print"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }
};

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('Vendas') || window.location.pathname.includes('vendas')) {
        VendasCompleto.init();
    }
});

// Exportar para uso global
window.VendasCompleto = VendasCompleto;
