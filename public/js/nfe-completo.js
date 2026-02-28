/**
 * NF-E COMPLETO - ALUFORCE
 * Gestão completa de Notas Fiscais Eletrônicas
 */

const NFeCompleto = {
    // Configuração
    API_BASE: '/api/nfe',
    
    // Estado
    notas: [],
    dashboard: null,
    filtros: {
        status: '',
        cliente_id: '',
        dataInicio: '',
        dataFim: ''
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
        console.log('📄 [NF-e] Inicializando módulo completo...');
        
        try {
            await this.carregarDashboard();
            await this.carregarNotas();
            this.configurarEventos();
            console.log('✅ [NF-e] Módulo inicializado com sucesso');
        } catch (error) {
            console.error('❌ [NF-e] Erro na inicialização:', error);
        }
    },

    configurarEventos() {
        // Delegação de eventos para botões de ação
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-nfe-action]');
            if (!btn) return;

            const action = btn.dataset.nfeAction;
            const id = btn.dataset.id;

            switch (action) {
                case 'visualizar':
                    this.visualizarNFe(id);
                    break;
                case 'baixar-danfe':
                    this.baixarDANFE(id);
                    break;
                case 'baixar-xml':
                    this.baixarXML(id);
                    break;
                case 'enviar-email':
                    this.enviarPorEmail(id);
                    break;
                case 'cancelar':
                    this.cancelarNFe(id);
                    break;
                case 'imprimir':
                    this.imprimirNFe(id);
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
            console.error('Erro ao carregar dashboard NF-e:', error);
        }
        return null;
    },

    renderizarDashboard(container) {
        if (!container || !this.dashboard) return;

        const { resumo_mes, impostos_mes } = this.dashboard;

        container.innerHTML = `
            <div class="nfe-dashboard" style="margin-bottom: 24px;">
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">
                    <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="width: 48px; height: 48px; background: #dbeafe; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-file-invoice" style="color: #3b82f6; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">NF-e do Mês</p>
                                <p style="font-size: 28px; font-weight: 700;">${resumo_mes?.total_nfes || 0}</p>
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
                                <p style="font-size: 24px; font-weight: 700; color: #22c55e;">R$ ${this.formatarMoeda(resumo_mes?.valor_total)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="width: 48px; height: 48px; background: #fef3c7; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-percent" style="color: #d97706; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">Total ISS</p>
                                <p style="font-size: 24px; font-weight: 700; color: #d97706;">R$ ${this.formatarMoeda(impostos_mes?.total_iss)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="kpi-card" style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="width: 48px; height: 48px; background: #fce7f3; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-calculator" style="color: #db2777; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">Impostos Totais</p>
                                <p style="font-size: 20px; font-weight: 700; color: #db2777;">R$ ${this.formatarMoeda(
                                    (impostos_mes?.total_iss || 0) + 
                                    (impostos_mes?.total_pis || 0) + 
                                    (impostos_mes?.total_cofins || 0) + 
                                    (impostos_mes?.total_irrf || 0)
                                )}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // =====================================================
    // NOTAS FISCAIS
    // =====================================================
    async carregarNotas() {
        try {
            const params = new URLSearchParams();
            params.append('page', this.paginacao.pagina);
            params.append('limit', this.paginacao.limite);
            if (this.filtros.status) params.append('status', this.filtros.status);
            if (this.filtros.cliente_id) params.append('cliente_id', this.filtros.cliente_id);
            if (this.filtros.dataInicio) params.append('data_inicio', this.filtros.dataInicio);
            if (this.filtros.dataFim) params.append('data_fim', this.filtros.dataFim);

            const resp = await fetch(`${this.API_BASE}/notas?${params}`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                this.notas = data.data?.notas || [];
            }
        } catch (error) {
            console.error('Erro ao carregar notas:', error);
        }
    },

    renderizarListaNotas(container) {
        if (!container) return;

        container.innerHTML = `
            <div class="table-container" style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div class="table-header" style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-file-invoice" style="color: #3b82f6;"></i>
                        Notas Fiscais Emitidas
                    </h3>
                    <button class="btn btn-primary" onclick="NFeCompleto.abrirModalEmissao()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                        <i class="fas fa-plus"></i> Nova NF-e
                    </button>
                </div>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f8fafc;">
                            <th style="padding: 14px 20px; text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">Número</th>
                            <th style="padding: 14px 20px; text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">Cliente</th>
                            <th style="padding: 14px 20px; text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">Status</th>
                            <th style="padding: 14px 20px; text-align: right; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">Valor</th>
                            <th style="padding: 14px 20px; text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">Data Emissão</th>
                            <th style="padding: 14px 20px; text-align: center; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.notas.length > 0 ? this.notas.map(nota => this.renderizarLinhaNota(nota)).join('') : `
                            <tr>
                                <td colspan="6" style="padding: 40px; text-align: center; color: #64748b;">
                                    <i class="fas fa-file-invoice" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px; display: block;"></i>
                                    <p>Nenhuma nota fiscal encontrada</p>
                                </td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        `;
    },

    renderizarLinhaNota(nota) {
        const statusColor = this.getStatusColor(nota.status);
        return `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 16px 20px;">
                    <span style="font-weight: 600; color: #3b82f6;">${nota.numero || '-'}</span>
                </td>
                <td style="padding: 16px 20px;">
                    <p style="font-weight: 500;">${nota.cliente_nome || '-'}</p>
                    <p style="font-size: 11px; color: #64748b;">${nota.cliente_cnpj || ''}</p>
                </td>
                <td style="padding: 16px 20px;">
                    <span style="display: inline-block; padding: 4px 12px; border-radius: 20px; background: ${statusColor}22; color: ${statusColor}; font-size: 11px; font-weight: 600;">
                        ${this.formatarStatus(nota.status)}
                    </span>
                </td>
                <td style="padding: 16px 20px; text-align: right; font-weight: 600; color: #22c55e;">
                    R$ ${this.formatarMoeda(nota.valor)}
                </td>
                <td style="padding: 16px 20px;">
                    ${this.formatarData(nota.data_emissao)}
                </td>
                <td style="padding: 16px 20px; text-align: center;">
                    <div style="display: flex; justify-content: center; gap: 4px;">
                        <button data-nfe-action="visualizar" data-id="${nota.id}" title="Visualizar" 
                                style="width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: #dbeafe; color: #3b82f6;">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button data-nfe-action="baixar-danfe" data-id="${nota.id}" title="Baixar DANFE" 
                                style="width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: #fee2e2; color: #dc2626;">
                            <i class="fas fa-file-pdf"></i>
                        </button>
                        <button data-nfe-action="baixar-xml" data-id="${nota.id}" title="Baixar XML" 
                                style="width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: #dcfce7; color: #16a34a;">
                            <i class="fas fa-file-code"></i>
                        </button>
                        <button data-nfe-action="enviar-email" data-id="${nota.id}" title="Enviar por E-mail" 
                                style="width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: #fef3c7; color: #d97706;">
                            <i class="fas fa-envelope"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    },

    // =====================================================
    // AÇÕES
    // =====================================================
    async visualizarNFe(id) {
        try {
            const nota = this.notas.find(n => n.id == id);
            if (!nota) {
                this.mostrarNotificacao('error', 'Nota não encontrada');
                return;
            }

            this.abrirModalVisualizacao(nota);
        } catch (error) {
            console.error('Erro ao visualizar NF-e:', error);
        }
    },

    abrirModalVisualizacao(nota) {
        const statusColor = this.getStatusColor(nota.status);
        const totalImpostos = (parseFloat(nota.iss) || 0) + (parseFloat(nota.pis) || 0) + 
                             (parseFloat(nota.cofins) || 0) + (parseFloat(nota.irrf) || 0);

        const html = `
            <div class="modal-overlay active" id="modal-nfe-overlay">
                <div class="modal" style="max-width: 800px;">
                    <div class="modal-header" style="background: linear-gradient(135deg, #3b82f6, #2563eb);">
                        <div class="modal-header-content">
                            <div class="modal-header-left">
                                <div class="modal-header-icon">
                                    <i class="fas fa-file-invoice"></i>
                                </div>
                                <div class="modal-header-text">
                                    <h2>NF-e ${nota.numero}</h2>
                                    <p>${nota.cliente_nome || 'Cliente'}</p>
                                </div>
                            </div>
                            <button class="modal-close" onclick="NFeCompleto.fecharModal()">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    <div class="modal-body" style="padding: 24px; max-height: 70vh; overflow-y: auto;">
                        <!-- Status e Valor -->
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px;">
                            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">STATUS</p>
                                <span style="display: inline-block; padding: 6px 12px; border-radius: 20px; background: ${statusColor}22; color: ${statusColor}; font-weight: 600;">
                                    ${this.formatarStatus(nota.status)}
                                </span>
                            </div>
                            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">VALOR BRUTO</p>
                                <p style="font-size: 24px; font-weight: 700; color: #22c55e;">R$ ${this.formatarMoeda(nota.valor)}</p>
                            </div>
                            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">DATA EMISSÍO</p>
                                <p style="font-size: 16px; font-weight: 600;">${this.formatarData(nota.data_emissao)}</p>
                            </div>
                        </div>

                        <!-- Dados do Cliente -->
                        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                            <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-user" style="color: #3b82f6;"></i>
                                Dados do Cliente
                            </h4>
                            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 16px;">
                                <div>
                                    <p style="font-size: 11px; color: #64748b;">Nome/Razão Social</p>
                                    <p style="font-weight: 500;">${nota.cliente_nome || '-'}</p>
                                </div>
                                <div>
                                    <p style="font-size: 11px; color: #64748b;">CNPJ/CPF</p>
                                    <p style="font-weight: 500;">${nota.cliente_cnpj || '-'}</p>
                                </div>
                            </div>
                        </div>

                        <!-- Descrição do Serviço -->
                        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                            <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-file-alt" style="color: #8b5cf6;"></i>
                                Descrição do Serviço
                            </h4>
                            <p style="font-size: 13px; line-height: 1.6;">${nota.descricao_servico || nota.descricao || '-'}</p>
                        </div>

                        <!-- Impostos -->
                        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
                            <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-percent" style="color: #d97706;"></i>
                                Impostos Retidos
                            </h4>
                            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;">
                                <div style="text-align: center; padding: 12px; background: #fef3c7; border-radius: 8px;">
                                    <p style="font-size: 10px; color: #92400e;">ISS</p>
                                    <p style="font-weight: 600; color: #d97706;">R$ ${this.formatarMoeda(nota.iss)}</p>
                                </div>
                                <div style="text-align: center; padding: 12px; background: #dbeafe; border-radius: 8px;">
                                    <p style="font-size: 10px; color: #1e40af;">PIS</p>
                                    <p style="font-weight: 600; color: #3b82f6;">R$ ${this.formatarMoeda(nota.pis)}</p>
                                </div>
                                <div style="text-align: center; padding: 12px; background: #dcfce7; border-radius: 8px;">
                                    <p style="font-size: 10px; color: #166534;">COFINS</p>
                                    <p style="font-weight: 600; color: #22c55e;">R$ ${this.formatarMoeda(nota.cofins)}</p>
                                </div>
                                <div style="text-align: center; padding: 12px; background: #fce7f3; border-radius: 8px;">
                                    <p style="font-size: 10px; color: #9d174d;">IRRF</p>
                                    <p style="font-weight: 600; color: #db2777;">R$ ${this.formatarMoeda(nota.irrf)}</p>
                                </div>
                                <div style="text-align: center; padding: 12px; background: #e0e7ff; border-radius: 8px;">
                                    <p style="font-size: 10px; color: #3730a3;">TOTAL</p>
                                    <p style="font-weight: 700; color: #6366f1;">R$ ${this.formatarMoeda(totalImpostos)}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between;">
                        <div style="display: flex; gap: 8px;">
                            <button onclick="NFeCompleto.baixarDANFE(${nota.id})" style="padding: 10px 16px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                                <i class="fas fa-file-pdf" style="color: #dc2626;"></i> DANFE
                            </button>
                            <button onclick="NFeCompleto.baixarXML(${nota.id})" style="padding: 10px 16px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                                <i class="fas fa-file-code" style="color: #16a34a;"></i> XML
                            </button>
                        </div>
                        <button onclick="NFeCompleto.fecharModal()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                            Fechar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
    },

    fecharModal() {
        const modal = document.getElementById('modal-nfe-overlay');
        if (modal) modal.remove();
    },

    async baixarDANFE(id) {
        try {
            this.mostrarNotificacao('info', 'Gerando DANFE...');
            
            // Simular download (em produção, isso chamaria a API real)
            const resp = await fetch(`${this.API_BASE}/notas/${id}/danfe`, { credentials: 'include' });
            
            if (resp.ok) {
                const blob = await resp.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `DANFE_${id}.pdf`;
                a.click();
                window.URL.revokeObjectURL(url);
                this.mostrarNotificacao('success', 'DANFE baixado com sucesso!');
            } else {
                // Fallback: gerar PDF local
                this.mostrarNotificacao('info', 'DANFE será gerado localmente');
                this.imprimirNFe(id);
            }
        } catch (error) {
            console.error('Erro ao baixar DANFE:', error);
            this.mostrarNotificacao('error', 'Erro ao baixar DANFE');
        }
    },

    async baixarXML(id) {
        try {
            this.mostrarNotificacao('info', 'Baixando XML...');
            
            const resp = await fetch(`${this.API_BASE}/notas/${id}/xml`, { credentials: 'include' });
            
            if (resp.ok) {
                const blob = await resp.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `NFe_${id}.xml`;
                a.click();
                window.URL.revokeObjectURL(url);
                this.mostrarNotificacao('success', 'XML baixado com sucesso!');
            } else {
                this.mostrarNotificacao('error', 'XML não disponível');
            }
        } catch (error) {
            console.error('Erro ao baixar XML:', error);
            this.mostrarNotificacao('error', 'Erro ao baixar XML');
        }
    },

    async enviarPorEmail(id) {
        const email = prompt('Digite o e-mail para envio:');
        if (!email) return;

        try {
            const resp = await fetch(`${this.API_BASE}/notas/${id}/enviar-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email })
            });

            if (resp.ok) {
                this.mostrarNotificacao('success', `NF-e enviada para ${email}`);
            } else {
                this.mostrarNotificacao('error', 'Erro ao enviar e-mail');
            }
        } catch (error) {
            console.error('Erro ao enviar:', error);
            this.mostrarNotificacao('error', 'Erro ao enviar e-mail');
        }
    },

    async cancelarNFe(id) {
        const motivo = prompt('Digite o motivo do cancelamento:');
        if (!motivo) return;

        if (!confirm('Tem certeza que deseja cancelar esta NF-e? Esta ação não pode ser desfeita.')) return;

        try {
            const resp = await fetch(`${this.API_BASE}/notas/${id}/cancelar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ motivo })
            });

            if (resp.ok) {
                this.mostrarNotificacao('success', 'NF-e cancelada com sucesso');
                await this.carregarNotas();
            } else {
                this.mostrarNotificacao('error', 'Erro ao cancelar NF-e');
            }
        } catch (error) {
            console.error('Erro ao cancelar:', error);
            this.mostrarNotificacao('error', 'Erro ao cancelar NF-e');
        }
    },

    async imprimirNFe(id) {
        const nota = this.notas.find(n => n.id == id);
        if (!nota) return;

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
                <title>NF-e ${nota.numero}</title>
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
                    .header-doc h2 { font-size: 12px; color: #1a365d; margin: 0; }
                    .header-doc .numero { font-size: 16px; font-weight: bold; margin: 5px 0; }
                    .section { border: 1px solid #ddd; margin-bottom: 15px; padding: 15px; }
                    .section h3 { font-size: 12px; background: #f5f5f5; padding: 5px 10px; margin: -15px -15px 10px -15px; }
                    .row { display: flex; justify-content: space-between; margin-bottom: 8px; }
                    .row span:first-child { color: #666; }
                    .total { font-size: 16px; font-weight: bold; text-align: right; margin-top: 20px; }
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
                        <h2>DOCUMENTO AUXILIAR DE NOTA FISCAL ELETRÔNICA</h2>
                        <p class="numero">NF-e Nº ${nota.numero}</p>
                    </div>
                </div>
                
                <div class="section">
                    <h3>DADOS DO EMITENTE</h3>
                    <p><strong>${nomeEmpresa}</strong></p>
                    ${cnpjFormatado ? `<p>CNPJ: ${cnpjFormatado}</p>` : ''}
                </div>
                
                <div class="section">
                    <h3>DADOS DO DESTINATÁRIO</h3>
                    <div class="row"><span>Nome/Razão Social:</span> <span>${nota.cliente_nome || '-'}</span></div>
                    <div class="row"><span>CNPJ/CPF:</span> <span>${nota.cliente_cnpj || '-'}</span></div>
                </div>
                
                <div class="section">
                    <h3>DESCRIÇÍO DO SERVIÇO</h3>
                    <p>${nota.descricao_servico || nota.descricao || '-'}</p>
                </div>
                
                <div class="section">
                    <h3>IMPOSTOS</h3>
                    <div class="row"><span>ISS:</span> <span>R$ ${this.formatarMoeda(nota.iss)}</span></div>
                    <div class="row"><span>PIS:</span> <span>R$ ${this.formatarMoeda(nota.pis)}</span></div>
                    <div class="row"><span>COFINS:</span> <span>R$ ${this.formatarMoeda(nota.cofins)}</span></div>
                    <div class="row"><span>IRRF:</span> <span>R$ ${this.formatarMoeda(nota.irrf)}</span></div>
                </div>
                
                <div class="total">
                    VALOR TOTAL: R$ ${this.formatarMoeda(nota.valor)}
                </div>
                
                <div class="footer">
                    <p>Emitido em ${this.formatarData(nota.data_emissao)}</p>
                    <p>${nomeEmpresa} - Sistema de Gestão Empresarial</p>
                </div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
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
            'autorizada': 'Autorizada',
            'cancelada': 'Cancelada',
            'pendente': 'Pendente',
            'rejeitada': 'Rejeitada',
            'processando': 'Processando'
        };
        return statusMap[status] || status || '-';
    },

    getStatusColor(status) {
        const colorMap = {
            'autorizada': '#22c55e',
            'cancelada': '#ef4444',
            'pendente': '#f59e0b',
            'rejeitada': '#dc2626',
            'processando': '#3b82f6'
        };
        return colorMap[status] || '#64748b';
    },

    mostrarNotificacao(tipo, mensagem) {
        if (typeof showToast === 'function') {
            showToast(mensagem, tipo);
            return;
        }

        const colors = {
            success: '#22c55e',
            error: '#ef4444',
            info: '#3b82f6',
            warning: '#f59e0b'
        };

        const toast = document.createElement('div');
        toast.innerHTML = `
            <i class="fas fa-${tipo === 'success' ? 'check-circle' : tipo === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${mensagem}</span>
        `;
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; padding: 16px 24px;
            background: ${colors[tipo] || colors.info}; color: white;
            border-radius: 8px; display: flex; align-items: center; gap: 10px;
            font-size: 14px; font-weight: 500; z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }
};

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('NFe') || window.location.pathname.includes('nfe')) {
        NFeCompleto.init();
    }
});

// Exportar para uso global
window.NFeCompleto = NFeCompleto;
