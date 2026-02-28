/**
 * FINANCEIRO COMPLETO - ALUFORCE
 * Gestão completa de Contas a Pagar/Receber, Baixas, Fluxo de Caixa e DRE
 */

const FinanceiroCompleto = {
    // Configuração
    API_BASE: '/api/financeiro',
    
    // Estado
    contasPagar: [],
    contasReceber: [],
    contasBancarias: [],
    categorias: [],
    permissoes: null,
    filtros: {
        status: '',
        dataInicio: '',
        dataFim: '',
        busca: ''
    },

    // =====================================================
    // INICIALIZAÇÍO
    // =====================================================
    async init() {
        console.log('🏦 [Financeiro] Inicializando módulo completo...');
        
        try {
            await this.carregarPermissoes();
            await this.carregarDadosIniciais();
            this.configurarEventos();
            console.log('✅ [Financeiro] Módulo inicializado com sucesso');
        } catch (error) {
            console.error('❌ [Financeiro] Erro na inicialização:', error);
        }
    },

    async carregarPermissoes() {
        try {
            const resp = await fetch(`${this.API_BASE}/permissoes`, { credentials: 'include' });
            if (resp.ok) {
                this.permissoes = await resp.json();
            }
        } catch (error) {
            console.warn('⚠️ Usando permissões padrão');
            this.permissoes = {
                contas_pagar: { visualizar: true, criar: true, editar: true, excluir: true },
                contas_receber: { visualizar: true, criar: true, editar: true, excluir: true }
            };
        }
    },

    async carregarDadosIniciais() {
        await Promise.all([
            this.carregarContasBancarias(),
            this.carregarCategorias()
        ]);
    },

    configurarEventos() {
        // Delegação de eventos para botões de baixa
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            const id = btn.dataset.id;
            const tipo = btn.dataset.tipo;

            switch (action) {
                case 'baixar':
                    this.abrirModalBaixa(tipo, id);
                    break;
                case 'estornar':
                    this.confirmarEstorno(tipo, id);
                    break;
                case 'visualizar':
                    this.visualizarConta(tipo, id);
                    break;
            }
        });
    },

    // =====================================================
    // CONTAS BANCÁRIAS
    // =====================================================
    async carregarContasBancarias() {
        try {
            const resp = await fetch(`${this.API_BASE}/contas-bancarias`, { credentials: 'include' });
            if (resp.ok) {
                this.contasBancarias = await resp.json();
            }
        } catch (error) {
            console.error('Erro ao carregar contas bancárias:', error);
        }
    },

    async carregarCategorias() {
        try {
            const resp = await fetch(`${this.API_BASE}/categorias`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                this.categorias = data.data || [];
            }
        } catch (error) {
            console.error('Erro ao carregar categorias:', error);
        }
    },

    // =====================================================
    // BAIXA DE CONTAS
    // =====================================================
    abrirModalBaixa(tipo, id) {
        const titulo = tipo === 'pagar' ? 'Registrar Pagamento' : 'Registrar Recebimento';
        const labelValor = tipo === 'pagar' ? 'Valor Pago' : 'Valor Recebido';
        const labelData = tipo === 'pagar' ? 'Data do Pagamento' : 'Data do Recebimento';
        const labelForma = tipo === 'pagar' ? 'Forma de Pagamento' : 'Forma de Recebimento';

        const optionsContas = this.contasBancarias
            .map(c => `<option value="${c.id}">${c.nome} - ${c.banco}</option>`)
            .join('');

        const html = `
            <div class="modal-overlay active" id="modal-baixa-overlay">
                <div class="modal" style="max-width: 600px;">
                    <div class="modal-header" style="background: linear-gradient(135deg, ${tipo === 'pagar' ? '#ef4444, #dc2626' : '#22c55e, #16a34a'});">
                        <div class="modal-header-content">
                            <div class="modal-header-left">
                                <div class="modal-header-icon">
                                    <i class="fas fa-${tipo === 'pagar' ? 'money-bill-wave' : 'hand-holding-usd'}"></i>
                                </div>
                                <div class="modal-header-text">
                                    <h2>${titulo}</h2>
                                    <p>Conta #${id}</p>
                                </div>
                            </div>
                            <button class="modal-close" onclick="FinanceiroCompleto.fecharModalBaixa()">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <form id="form-baixa" class="form-section">
                            <input type="hidden" name="tipo" value="${tipo}">
                            <input type="hidden" name="id" value="${id}">
                            
                            <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <div class="form-group">
                                    <label><i class="fas fa-dollar-sign"></i> ${labelValor} <span class="required">*</span></label>
                                    <input type="number" step="0.01" name="valor" id="baixa-valor" required 
                                           style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                </div>
                                <div class="form-group">
                                    <label><i class="fas fa-calendar"></i> ${labelData} <span class="required">*</span></label>
                                    <input type="date" name="data" id="baixa-data" value="${new Date().toISOString().split('T')[0]}" required
                                           style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                </div>
                            </div>

                            <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px;">
                                <div class="form-group">
                                    <label><i class="fas fa-credit-card"></i> ${labelForma}</label>
                                    <select name="forma" id="baixa-forma" style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                        <option value="pix">PIX</option>
                                        <option value="boleto">Boleto</option>
                                        <option value="transferencia">Transferência</option>
                                        <option value="dinheiro">Dinheiro</option>
                                        <option value="cartao_debito">Cartão Débito</option>
                                        <option value="cartao_credito">Cartão Crédito</option>
                                        <option value="cheque">Cheque</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label><i class="fas fa-university"></i> Conta Bancária</label>
                                    <select name="conta_bancaria" id="baixa-conta" style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                        <option value="">Selecione...</option>
                                        ${optionsContas}
                                    </select>
                                </div>
                            </div>

                            <div class="form-group" style="margin-top: 16px;">
                                <label><i class="fas fa-sticky-note"></i> Observações</label>
                                <textarea name="observacoes" id="baixa-obs" rows="3" 
                                          style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; resize: vertical;"></textarea>
                            </div>

                            <div class="form-group" style="margin-top: 16px;">
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="checkbox" name="baixa_parcial" id="baixa-parcial" style="width: 18px; height: 18px;">
                                    <span>Baixa parcial (valor menor que o total)</span>
                                </label>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="FinanceiroCompleto.fecharModalBaixa()">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                        <button class="btn btn-primary" onclick="FinanceiroCompleto.salvarBaixa()" 
                                style="background: ${tipo === 'pagar' ? '#ef4444' : '#22c55e'};">
                            <i class="fas fa-check"></i> Confirmar ${tipo === 'pagar' ? 'Pagamento' : 'Recebimento'}
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
    },

    fecharModalBaixa() {
        const modal = document.getElementById('modal-baixa-overlay');
        if (modal) modal.remove();
    },

    async salvarBaixa() {
        const form = document.getElementById('form-baixa');
        const tipo = form.querySelector('[name="tipo"]').value;
        const id = form.querySelector('[name="id"]').value;
        
        const dados = {
            valor_pago: parseFloat(document.getElementById('baixa-valor').value),
            valor_recebido: parseFloat(document.getElementById('baixa-valor').value),
            data_pagamento: document.getElementById('baixa-data').value,
            data_recebimento: document.getElementById('baixa-data').value,
            forma_pagamento: document.getElementById('baixa-forma').value,
            forma_recebimento: document.getElementById('baixa-forma').value,
            conta_bancaria_id: document.getElementById('baixa-conta').value || null,
            observacoes: document.getElementById('baixa-obs').value,
            baixa_parcial: document.getElementById('baixa-parcial').checked
        };

        try {
            const endpoint = tipo === 'pagar' 
                ? `${this.API_BASE}/contas-pagar/${id}/baixa`
                : `${this.API_BASE}/contas-receber/${id}/baixa`;

            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(dados)
            });

            const result = await resp.json();

            if (resp.ok && result.success) {
                this.mostrarNotificacao('success', result.message || 'Baixa registrada com sucesso!');
                this.fecharModalBaixa();
                
                // Recarregar dados
                if (typeof carregarContasPagar === 'function') carregarContasPagar();
                if (typeof carregarContasReceber === 'function') carregarContasReceber();
                if (typeof atualizarDashboard === 'function') atualizarDashboard();
            } else {
                this.mostrarNotificacao('error', result.error || 'Erro ao registrar baixa');
            }
        } catch (error) {
            console.error('Erro ao salvar baixa:', error);
            this.mostrarNotificacao('error', 'Erro ao conectar com o servidor');
        }
    },

    async confirmarEstorno(tipo, id) {
        if (!confirm('Tem certeza que deseja estornar esta baixa? Esta ação irá reverter o pagamento/recebimento.')) {
            return;
        }

        try {
            const endpoint = tipo === 'pagar' 
                ? `${this.API_BASE}/contas-pagar/${id}/estornar`
                : `${this.API_BASE}/contas-receber/${id}/estornar`;

            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });

            const result = await resp.json();

            if (resp.ok && result.success) {
                this.mostrarNotificacao('success', 'Estorno realizado com sucesso!');
                
                if (typeof carregarContasPagar === 'function') carregarContasPagar();
                if (typeof carregarContasReceber === 'function') carregarContasReceber();
                if (typeof atualizarDashboard === 'function') atualizarDashboard();
            } else {
                this.mostrarNotificacao('error', result.error || 'Erro ao estornar');
            }
        } catch (error) {
            console.error('Erro ao estornar:', error);
            this.mostrarNotificacao('error', 'Erro ao conectar com o servidor');
        }
    },

    // =====================================================
    // FLUXO DE CAIXA
    // =====================================================
    async carregarFluxoCaixa(dataInicio = null, dataFim = null) {
        try {
            const params = new URLSearchParams();
            if (dataInicio) params.append('dataInicio', dataInicio);
            if (dataFim) params.append('dataFim', dataFim);

            const resp = await fetch(`${this.API_BASE}/fluxo-caixa?${params}`, { credentials: 'include' });
            const data = await resp.json();

            if (data.success) {
                return data;
            }
            return null;
        } catch (error) {
            console.error('Erro ao carregar fluxo de caixa:', error);
            return null;
        }
    },

    renderizarFluxoCaixa(container, dados) {
        if (!container || !dados) return;

        const { saldoInicial, totalReceber, totalPagar, saldoProjetado, fluxoDiario } = dados;

        container.innerHTML = `
            <div class="fluxo-caixa-dashboard">
                <!-- Cards de Resumo -->
                <div class="fluxo-cards" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
                    <div class="fluxo-card" style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 48px; height: 48px; background: #dbeafe; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-wallet" style="color: #3b82f6; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">Saldo Atual</p>
                                <p style="font-size: 20px; font-weight: 700; color: #1e293b;">R$ ${this.formatarMoeda(saldoInicial)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="fluxo-card" style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 48px; height: 48px; background: #dcfce7; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-arrow-down" style="color: #22c55e; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">Entradas Previstas</p>
                                <p style="font-size: 20px; font-weight: 700; color: #22c55e;">R$ ${this.formatarMoeda(totalReceber)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="fluxo-card" style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 48px; height: 48px; background: #fee2e2; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-arrow-up" style="color: #ef4444; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">Saídas Previstas</p>
                                <p style="font-size: 20px; font-weight: 700; color: #ef4444;">R$ ${this.formatarMoeda(totalPagar)}</p>
                            </div>
                        </div>
                    </div>
                    <div class="fluxo-card" style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 48px; height: 48px; background: ${saldoProjetado >= 0 ? '#dcfce7' : '#fee2e2'}; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-chart-line" style="color: ${saldoProjetado >= 0 ? '#22c55e' : '#ef4444'}; font-size: 20px;"></i>
                            </div>
                            <div>
                                <p style="font-size: 12px; color: #64748b;">Saldo Projetado</p>
                                <p style="font-size: 20px; font-weight: 700; color: ${saldoProjetado >= 0 ? '#22c55e' : '#ef4444'};">R$ ${this.formatarMoeda(saldoProjetado)}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tabela de Fluxo Diário -->
                <div class="table-container" style="background: white; border-radius: 12px; overflow: hidden;">
                    <div class="table-header" style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0;">
                        <h3 style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-calendar-alt" style="color: #3b82f6;"></i>
                            Fluxo de Caixa Diário
                        </h3>
                    </div>
                    <table class="data-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f8fafc;">
                                <th style="padding: 12px 20px; text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">Data</th>
                                <th style="padding: 12px 20px; text-align: right; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">Entradas</th>
                                <th style="padding: 12px 20px; text-align: right; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">Saídas</th>
                                <th style="padding: 12px 20px; text-align: right; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">Saldo</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${fluxoDiario.map(dia => `
                                <tr style="border-bottom: 1px solid #f1f5f9;">
                                    <td style="padding: 14px 20px; font-size: 13px;">${this.formatarData(dia.data)}</td>
                                    <td style="padding: 14px 20px; font-size: 13px; text-align: right; color: #22c55e; font-weight: 500;">
                                        ${dia.entradas > 0 ? 'R$ ' + this.formatarMoeda(dia.entradas) : '-'}
                                    </td>
                                    <td style="padding: 14px 20px; font-size: 13px; text-align: right; color: #ef4444; font-weight: 500;">
                                        ${dia.saidas > 0 ? 'R$ ' + this.formatarMoeda(dia.saidas) : '-'}
                                    </td>
                                    <td style="padding: 14px 20px; font-size: 13px; text-align: right; font-weight: 600; color: ${dia.saldo >= 0 ? '#22c55e' : '#ef4444'};">
                                        R$ ${this.formatarMoeda(dia.saldo)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // =====================================================
    // DRE - DEMONSTRATIVO DE RESULTADOS
    // =====================================================
    async carregarDRE(mes = null, ano = null) {
        try {
            const params = new URLSearchParams();
            if (mes) params.append('mes', mes);
            if (ano) params.append('ano', ano);

            const resp = await fetch(`${this.API_BASE}/dre?${params}`, { credentials: 'include' });
            const data = await resp.json();

            if (data.success) {
                return data;
            }
            return null;
        } catch (error) {
            console.error('Erro ao carregar DRE:', error);
            return null;
        }
    },

    renderizarDRE(container, dados) {
        if (!container || !dados) return;

        const { periodo, receitas, despesas, resultado } = dados;
        const meses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                       'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

        container.innerHTML = `
            <div class="dre-container">
                <div class="dre-header" style="background: white; border-radius: 12px; padding: 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h2 style="font-size: 20px; font-weight: 700;">Demonstrativo de Resultado do Exercício</h2>
                        <p style="color: #64748b; font-size: 14px;">${meses[periodo.mes]} de ${periodo.ano}</p>
                    </div>
                    <div class="resultado-destaque" style="text-align: right; padding: 16px 24px; border-radius: 12px; background: ${resultado.tipo === 'lucro' ? '#dcfce7' : '#fee2e2'};">
                        <p style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Resultado do Período</p>
                        <p style="font-size: 28px; font-weight: 700; color: ${resultado.tipo === 'lucro' ? '#22c55e' : '#ef4444'};">
                            R$ ${this.formatarMoeda(resultado.valor)}
                        </p>
                        <p style="font-size: 12px; color: ${resultado.tipo === 'lucro' ? '#16a34a' : '#dc2626'};">
                            ${resultado.percentual}% sobre receitas
                        </p>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <!-- Receitas -->
                    <div class="dre-section" style="background: white; border-radius: 12px; overflow: hidden;">
                        <div style="padding: 16px 20px; background: #dcfce7; border-bottom: 1px solid #bbf7d0;">
                            <h3 style="font-size: 16px; font-weight: 600; color: #166534; display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-arrow-trend-up"></i>
                                Receitas
                            </h3>
                        </div>
                        <div style="padding: 0;">
                            ${receitas.categorias.length > 0 ? receitas.categorias.map(cat => `
                                <div style="display: flex; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">
                                    <span style="font-size: 13px;">${cat.categoria}</span>
                                    <span style="font-size: 13px; font-weight: 500; color: #22c55e;">R$ ${this.formatarMoeda(cat.valor)}</span>
                                </div>
                            `).join('') : '<div style="padding: 20px; text-align: center; color: #64748b;">Nenhuma receita no período</div>'}
                            <div style="display: flex; justify-content: space-between; padding: 16px 20px; background: #f0fdf4; font-weight: 600;">
                                <span>TOTAL RECEITAS</span>
                                <span style="color: #22c55e;">R$ ${this.formatarMoeda(receitas.total)}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Despesas -->
                    <div class="dre-section" style="background: white; border-radius: 12px; overflow: hidden;">
                        <div style="padding: 16px 20px; background: #fee2e2; border-bottom: 1px solid #fecaca;">
                            <h3 style="font-size: 16px; font-weight: 600; color: #991b1b; display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-arrow-trend-down"></i>
                                Despesas
                            </h3>
                        </div>
                        <div style="padding: 0;">
                            ${despesas.categorias.length > 0 ? despesas.categorias.map(cat => `
                                <div style="display: flex; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">
                                    <span style="font-size: 13px;">${cat.categoria}</span>
                                    <span style="font-size: 13px; font-weight: 500; color: #ef4444;">R$ ${this.formatarMoeda(cat.valor)}</span>
                                </div>
                            `).join('') : '<div style="padding: 20px; text-align: center; color: #64748b;">Nenhuma despesa no período</div>'}
                            <div style="display: flex; justify-content: space-between; padding: 16px 20px; background: #fef2f2; font-weight: 600;">
                                <span>TOTAL DESPESAS</span>
                                <span style="color: #ef4444;">R$ ${this.formatarMoeda(despesas.total)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // =====================================================
    // RELATÓRIOS
    // =====================================================
    async carregarRelatorioVencimentos() {
        try {
            const resp = await fetch(`${this.API_BASE}/relatorios/vencimentos`, { credentials: 'include' });
            return await resp.json();
        } catch (error) {
            console.error('Erro ao carregar relatório:', error);
            return null;
        }
    },

    async carregarRelatorioPorFornecedor() {
        try {
            const resp = await fetch(`${this.API_BASE}/relatorios/por-fornecedor`, { credentials: 'include' });
            return await resp.json();
        } catch (error) {
            console.error('Erro ao carregar relatório:', error);
            return null;
        }
    },

    async carregarRelatorioPorCliente() {
        try {
            const resp = await fetch(`${this.API_BASE}/relatorios/por-cliente`, { credentials: 'include' });
            return await resp.json();
        } catch (error) {
            console.error('Erro ao carregar relatório:', error);
            return null;
        }
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
        const d = new Date(data + 'T00:00:00');
        return d.toLocaleDateString('pt-BR');
    },

    mostrarNotificacao(tipo, mensagem) {
        // Usar toast existente ou criar simples
        if (typeof showToast === 'function') {
            showToast(mensagem, tipo);
            return;
        }

        const toast = document.createElement('div');
        toast.className = `toast-notification toast-${tipo}`;
        toast.innerHTML = `
            <i class="fas fa-${tipo === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            <span>${mensagem}</span>
        `;
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; padding: 16px 24px;
            background: ${tipo === 'success' ? '#22c55e' : '#ef4444'}; color: white;
            border-radius: 8px; display: flex; align-items: center; gap: 10px;
            font-size: 14px; font-weight: 500; z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    },

    // Método para adicionar botões de ação em tabelas
    gerarBotoesAcao(tipo, id, status) {
        const pago = status?.toLowerCase() === 'pago';
        const parcial = status?.toLowerCase() === 'parcial';

        return `
            <div class="action-buttons" style="display: flex; gap: 4px;">
                <button class="btn-action view" data-action="visualizar" data-tipo="${tipo}" data-id="${id}" title="Visualizar">
                    <i class="fas fa-eye"></i>
                </button>
                ${!pago ? `
                    <button class="btn-action pay" data-action="baixar" data-tipo="${tipo}" data-id="${id}" title="${tipo === 'pagar' ? 'Pagar' : 'Receber'}">
                        <i class="fas fa-${tipo === 'pagar' ? 'money-bill-wave' : 'hand-holding-usd'}"></i>
                    </button>
                ` : ''}
                ${(pago || parcial) ? `
                    <button class="btn-action edit" data-action="estornar" data-tipo="${tipo}" data-id="${id}" title="Estornar">
                        <i class="fas fa-undo"></i>
                    </button>
                ` : ''}
            </div>
        `;
    }
};

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    // Verificar se estamos no módulo financeiro
    if (window.location.pathname.includes('Financeiro') || window.location.pathname.includes('financeiro')) {
        FinanceiroCompleto.init();
    }
});

// Exportar para uso global
window.FinanceiroCompleto = FinanceiroCompleto;
