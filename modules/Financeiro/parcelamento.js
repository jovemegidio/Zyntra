// ============================================================================
// SISTEMA DE PARCELAMENTO AUTOMÁTICO - Sistema Financeiro Aluforce
// ============================================================================

class SistemaParcelamento {
    constructor() {
        this.parcelas = [];
        this.modalAberto = false;
    }

    // ============================================================================
    // INTERFACE DO MODAL
    // ============================================================================

    abrirModal(dados = {}) {
        const modal = this.criarModal(dados);
        document.body.insertAdjacentHTML('beforeend', modal);
        this.modalAberto = true;
        this.configurarEventos();
        this.calcularParcelas();
    }

    criarModal(dados) {
        return `
            <div class="modal-overlay" id="modal-parcelamento">
                <div class="modal-parcelamento">
                    <div class="modal-header">
                        <h3><i class="fas fa-calculator"></i> Configurar Parcelamento</h3>
                        <button class="close-btn" onclick="sistemaParcelamento.fecharModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="modal-body">
                        <!-- Informações Principais -->
                        <div class="form-section">
                            <h4>Informações do Pagamento</h4>
                            <div class="form-grid">
                                <div class="form-group">
                                    <label>Tipo *</label>
                                    <select id="parcelamento-tipo">
                                        <option value="pagar">Conta a Pagar</option>
                                        <option value="receber">Conta a Receber</option>
                                    </select>
                                </div>

                                <div class="form-group">
                                    <label>Valor Total *</label>
                                    <input type="text" id="parcelamento-valor" 
                                           placeholder="R$ 0,00" 
                                           value="${dados.valor || ''}"
                                           oninput="sistemaParcelamento.formatarMoeda(this)">
                                </div>

                                <div class="form-group">
                                    <label>Número de Parcelas *</label>
                                    <input type="number" id="parcelamento-num-parcelas" 
                                           min="2" max="360" value="12"
                                           oninput="sistemaParcelamento.calcularParcelas()">
                                </div>

                                <div class="form-group">
                                    <label>Data Primeira Parcela *</label>
                                    <input type="date" id="parcelamento-data-inicio">
                                </div>

                                <div class="form-group full-width">
                                    <label>Descrição *</label>
                                    <input type="text" id="parcelamento-descrição" 
                                           placeholder="Ex: Compra de equipamento"
                                           value="${dados.descrição || ''}">
                                </div>
                            </div>
                        </div>

                        <!-- Configurações Avançadas -->
                        <div class="form-section">
                            <h4>Configurações Avançadas</h4>
                            <div class="form-grid">
                                <div class="form-group">
                                    <label>Periodicidade</label>
                                    <select id="parcelamento-periodicidade" onchange="sistemaParcelamento.calcularParcelas()">
                                        <option value="mensal">Mensal</option>
                                        <option value="quinzenal">Quinzenal (15 dias)</option>
                                        <option value="semanal">Semanal</option>
                                        <option value="bimestral">Bimestral</option>
                                        <option value="trimestral">Trimestral</option>
                                        <option value="semestral">Semestral</option>
                                        <option value="anual">Anual</option>
                                    </select>
                                </div>

                                <div class="form-group">
                                    <label>Tipo de Juros</label>
                                    <select id="parcelamento-tipo-juros" onchange="sistemaParcelamento.toggleJuros()">
                                        <option value="nenhum">Sem Juros</option>
                                        <option value="simples">Juros Simples</option>
                                        <option value="composto">Juros Compostos</option>
                                    </select>
                                </div>

                                <div class="form-group" id="grupo-taxa-juros" style="display: none;">
                                    <label>Taxa de Juros (% ao período)</label>
                                    <input type="number" id="parcelamento-taxa-juros" 
                                           min="0" max="100" step="0.01" value="2"
                                           oninput="sistemaParcelamento.calcularParcelas()">
                                </div>

                                <div class="form-group">
                                    <label>Categoria</label>
                                    <select id="parcelamento-categoria">
                                        <option value="">Selecione...</option>
                                        <option value="1">Compras</option>
                                        <option value="2">Serviços</option>
                                        <option value="3">Salários</option>
                                        <option value="4">Impostos</option>
                                        <option value="5">Vendas</option>
                                        <option value="6">Receitas Diversas</option>
                                    </select>
                                </div>

                                <div class="form-group">
                                    <label>Centro de Custo</label>
                                    <select id="parcelamento-centro-custo">
                                        <option value="">Selecione...</option>
                                        <option value="1">Administrativo</option>
                                        <option value="2">Comercial</option>
                                        <option value="3">Operacional</option>
                                        <option value="4">Financeiro</option>
                                    </select>
                                </div>

                                <div class="form-group">
                                    <label>Fornecedor/Cliente</label>
                                    <select id="parcelamento-entidade">
                                        <option value="">Selecione...</option>
                                    </select>
                                </div>

                                <div class="form-group">
                                    <label>Conta Bancária</label>
                                    <select id="parcelamento-conta-bancaria">
                                        <option value="">Selecione...</option>
                                    </select>
                                </div>

                                <div class="form-group">
                                    <label>Forma de Pagamento</label>
                                    <select id="parcelamento-forma-pagamento">
                                        <option value="boleto">Boleto</option>
                                        <option value="pix">PIX</option>
                                        <option value="ted">TED/DOC</option>
                                        <option value="cartao">Cartão de Crédito</option>
                                        <option value="dinheiro">Dinheiro</option>
                                        <option value="cheque">Cheque</option>
                                    </select>
                                </div>
                            </div>

                            <div class="form-group full-width">
                                <label>
                                    <input type="checkbox" id="parcelamento-entrada">
                                    Incluir entrada (parcela 0)
                                </label>
                            </div>
                        </div>

                        <!-- Pré-visualização das Parcelas -->
                        <div class="form-section">
                            <h4>Pré-visualização das Parcelas</h4>
                            
                            <div class="resumo-parcelamento">
                                <div class="resumo-item">
                                    <span>Total de Parcelas:</span>
                                    <strong id="resumo-total-parcelas">0</strong>
                                </div>
                                <div class="resumo-item">
                                    <span>Valor por Parcela:</span>
                                    <strong id="resumo-valor-parcela">R$ 0,00</strong>
                                </div>
                                <div class="resumo-item">
                                    <span>Total com Juros:</span>
                                    <strong id="resumo-total-juros" style="color: #ef4444;">R$ 0,00</strong>
                                </div>
                                <div class="resumo-item">
                                    <span>Primeira Parcela:</span>
                                    <strong id="resumo-data-primeira">-</strong>
                                </div>
                                <div class="resumo-item">
                                    <span>Última Parcela:</span>
                                    <strong id="resumo-data-última">-</strong>
                                </div>
                            </div>

                            <div class="tabela-parcelas-container">
                                <table class="tabela-parcelas" id="tabela-preview-parcelas">
                                    <thead>
                                        <tr>
                                            <th>Parcela</th>
                                            <th>Vencimento</th>
                                            <th>Valor Principal</th>
                                            <th>Juros</th>
                                            <th>Valor Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <!-- Parcelas serão inseridas aqui -->
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Observações -->
                        <div class="form-section">
                            <h4>Observações</h4>
                            <textarea id="parcelamento-observacoes" 
                                      rows="3" 
                                      placeholder="Observações adicionais sobre este parcelamento..."></textarea>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="sistemaParcelamento.fecharModal()">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                        <button class="btn btn-primary" onclick="sistemaParcelamento.confirmarParcelamento()">
                            <i class="fas fa-check"></i> Gerar Parcelas
                        </button>
                    </div>
                </div>
            </div>

            <style>
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    animation: fadeIn 0.2s;
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .modal-parcelamento {
                    background: white;
                    border-radius: 12px;
                    width: 95%;
                    max-width: 1000px;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    animation: slideUp 0.3s;
                }

                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }

                .modal-header {
                    padding: 24px;
                    border-bottom: 2px solid #e5e7eb;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .modal-header h3 {
                    margin: 0;
                    color: #1f2937;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 20px;
                }

                .close-btn {
                    background: none;
                    border: none;
                    font-size: 24px;
                    color: #9ca3af;
                    cursor: pointer;
                    padding: 0;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 6px;
                    transition: all 0.2s;
                }

                .close-btn:hover {
                    background: #f3f4f6;
                    color: #374151;
                }

                .modal-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 24px;
                }

                .form-section {
                    background: #f9fafb;
                    padding: 20px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                }

                .form-section h4 {
                    margin: 0 0 20px 0;
                    color: #374151;
                    font-size: 16px;
                    font-weight: 600;
                    padding-bottom: 12px;
                    border-bottom: 2px solid #e5e7eb;
                }

                .form-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 16px;
                }

                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .form-group.full-width {
                    grid-column: 1 / -1;
                }

                .form-group label {
                    font-size: 13px;
                    font-weight: 600;
                    color: #374151;
                }

                .form-group input,
                .form-group select,
                .form-group textarea {
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    transition: all 0.2s;
                }

                .form-group input:focus,
                .form-group select:focus,
                .form-group textarea:focus {
                    outline: none;
                    border-color: #10b981;
                    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
                }

                .resumo-parcelamento {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                    gap: 16px;
                    margin-bottom: 20px;
                }

                .resumo-item {
                    background: white;
                    padding: 16px;
                    border-radius: 8px;
                    border-left: 4px solid #10b981;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .resumo-item span {
                    font-size: 13px;
                    color: #6b7280;
                }

                .resumo-item strong {
                    font-size: 18px;
                    color: #1f2937;
                }

                .tabela-parcelas-container {
                    background: white;
                    border-radius: 8px;
                    overflow: hidden;
                    max-height: 300px;
                    overflow-y: auto;
                }

                .tabela-parcelas {
                    width: 100%;
                    border-collapse: collapse;
                }

                .tabela-parcelas th {
                    background: #f3f4f6;
                    padding: 12px;
                    text-align: left;
                    font-size: 13px;
                    font-weight: 600;
                    color: #374151;
                    position: sticky;
                    top: 0;
                }

                .tabela-parcelas td {
                    padding: 12px;
                    border-bottom: 1px solid #e5e7eb;
                    font-size: 14px;
                }

                .tabela-parcelas tr:hover {
                    background: #f9fafb;
                }

                .modal-footer {
                    padding: 20px 24px;
                    border-top: 2px solid #e5e7eb;
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                }

                .btn {
                    padding: 10px 20px;
                    border: none;
                    border-radius: 6px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transition: all 0.2s;
                    font-size: 14px;
                }

                .btn-primary {
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                    color: white;
                }

                .btn-primary:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
                }

                .btn-secondary {
                    background: #e5e7eb;
                    color: #374151;
                }

                .btn-secondary:hover {
                    background: #d1d5db;
                }

                @media (max-width: 768px) {
                    .modal-parcelamento {
                        width: 100%;
                        height: 100%;
                        max-height: 100vh;
                        border-radius: 0;
                    }

                    .form-grid {
                        grid-template-columns: 1fr;
                    }

                    .resumo-parcelamento {
                        grid-template-columns: 1fr;
                    }
                }
            </style>
        `;
    }

    // ============================================================================
    // EVENTOS
    // ============================================================================

    configurarEventos() {
        // Calcular ao mudar valores
        document.getElementById('parcelamento-valor').addEventListener('input', () => this.calcularParcelas());
        document.getElementById('parcelamento-num-parcelas').addEventListener('input', () => this.calcularParcelas());
        document.getElementById('parcelamento-data-inicio').addEventListener('change', () => this.calcularParcelas());
        document.getElementById('parcelamento-entrada').addEventListener('change', () => this.calcularParcelas());

        // Definir data padrão (hoje + 30 dias)
        const dataInicio = new Date();
        dataInicio.setDate(dataInicio.getDate() + 30);
        document.getElementById('parcelamento-data-inicio').value = this.formatarDataInput(dataInicio);

        // Carregar entidades
        this.carregarEntidades();
        this.carregarContasBancarias();
    }

    toggleJuros() {
        const tipoJuros = document.getElementById('parcelamento-tipo-juros').value;
        const grupoTaxa = document.getElementById('grupo-taxa-juros');
        
        if (tipoJuros === 'nenhum') {
            grupoTaxa.style.display = 'none';
        } else {
            grupoTaxa.style.display = 'block';
        }

        this.calcularParcelas();
    }

    // ============================================================================
    // CÁLCULOS
    // ============================================================================

    calcularParcelas() {
        const valorTotalStr = document.getElementById('parcelamento-valor').value.replace(/[^\d,]/g, '').replace(',', '.');
        const valorTotal = parseFloat(valorTotalStr) || 0;
        const numParcelas = parseInt(document.getElementById('parcelamento-num-parcelas').value) || 1;
        const dataInicio = document.getElementById('parcelamento-data-inicio').value;
        const periodicidade = document.getElementById('parcelamento-periodicidade').value;
        const tipoJuros = document.getElementById('parcelamento-tipo-juros').value;
        const taxaJuros = parseFloat(document.getElementById('parcelamento-taxa-juros').value) / 100 || 0;
        const incluirEntrada = document.getElementById('parcelamento-entrada').checked;

        if (!valorTotal || !numParcelas || !dataInicio) {
            return;
        }

        this.parcelas = [];
        let data = new Date(dataInicio + 'T00:00:00');
        let valorComJuros = valorTotal;
        let valorEntrada = 0;

        // Calcular entrada se habilitada
        if (incluirEntrada) {
            valorEntrada = valorTotal / (numParcelas + 1);
            valorComJuros = valorTotal - valorEntrada;

            this.parcelas.push({
                número: 0,
                vencimento: new Date(),
                valorPrincipal: valorEntrada,
                juros: 0,
                valorTotal: valorEntrada
            });
        }

        // Calcular juros
        if (tipoJuros === 'simples') {
            valorComJuros = valorTotal * (1 + (taxaJuros * numParcelas));
        } else if (tipoJuros === 'composto') {
            valorComJuros = valorTotal * Math.pow(1 + taxaJuros, numParcelas);
        }

        const valorParcela = valorComJuros / numParcelas;

        // Gerar parcelas
        for (let i = 1; i <= numParcelas; i++) {
            const valorPrincipal = valorTotal / numParcelas;
            const juros = valorParcela - valorPrincipal;

            this.parcelas.push({
                número: i,
                vencimento: new Date(data),
                valorPrincipal: valorPrincipal,
                juros: juros,
                valorTotal: valorParcela
            });

            // Avançar data conforme periodicidade
            data = this.avancarData(data, periodicidade);
        }

        this.renderizarPreview();
    }

    avancarData(data, periodicidade) {
        const novaData = new Date(data);

        switch (periodicidade) {
            case 'semanal':
                novaData.setDate(novaData.getDate() + 7);
                break;
            case 'quinzenal':
                novaData.setDate(novaData.getDate() + 15);
                break;
            case 'mensal':
                novaData.setMonth(novaData.getMonth() + 1);
                break;
            case 'bimestral':
                novaData.setMonth(novaData.getMonth() + 2);
                break;
            case 'trimestral':
                novaData.setMonth(novaData.getMonth() + 3);
                break;
            case 'semestral':
                novaData.setMonth(novaData.getMonth() + 6);
                break;
            case 'anual':
                novaData.setFullYear(novaData.getFullYear() + 1);
                break;
        }

        return novaData;
    }

    // ============================================================================
    // RENDERIZAÇÃO
    // ============================================================================

    renderizarPreview() {
        if (this.parcelas.length === 0) return;

        const totalParcelas = this.parcelas.length;
        const valorParcela = this.parcelas.filter(p => p.número > 0)[0]?.valorTotal || 0;
        const totalJuros = this.parcelas.reduce((sum, p) => sum + p.valorTotal, 0);
        const primeira = this.parcelas.find(p => p.número > 0);
        const última = this.parcelas[this.parcelas.length - 1];

        document.getElementById('resumo-total-parcelas').textContent = totalParcelas;
        document.getElementById('resumo-valor-parcela').textContent = this.formatarMoeda(valorParcela);
        document.getElementById('resumo-total-juros').textContent = this.formatarMoeda(totalJuros);
        document.getElementById('resumo-data-primeira').textContent = primeira ? this.formatarData(primeira.vencimento) : '-';
        document.getElementById('resumo-data-última').textContent = this.formatarData(última.vencimento);

        // Renderizar tabela
        const tbody = document.querySelector('#tabela-preview-parcelas tbody');
        tbody.innerHTML = this.parcelas.map(parcela => `
            <tr>
                <td><strong>${parcela.número === 0 ? 'Entrada' : parcela.número + '/' + (totalParcelas - (document.getElementById('parcelamento-entrada').checked ? 1 : 0))}</strong></td>
                <td>${this.formatarData(parcela.vencimento)}</td>
                <td>${this.formatarMoeda(parcela.valorPrincipal)}</td>
                <td style="color: ${parcela.juros > 0 ? '#ef4444' : '#6b7280'}">${this.formatarMoeda(parcela.juros)}</td>
                <td><strong>${this.formatarMoeda(parcela.valorTotal)}</strong></td>
            </tr>
        `).join('');
    }

    // ============================================================================
    // CONFIRMAÇÃO
    // ============================================================================

    async confirmarParcelamento() {
        // Validações
        const tipo = document.getElementById('parcelamento-tipo').value;
        const descrição = document.getElementById('parcelamento-descrição').value;

        if (!descrição.trim()) {
            alert('Preencha a descrição');
            return;
        }

        if (this.parcelas.length === 0) {
            alert('Configure o parcelamento corretamente');
            return;
        }

        const dados = {
            tipo: tipo,
            descrição: descrição,
            categoria_id: document.getElementById('parcelamento-categoria').value,
            centro_custo_id: document.getElementById('parcelamento-centro-custo').value,
            entidade_id: document.getElementById('parcelamento-entidade').value,
            conta_bancaria_id: document.getElementById('parcelamento-conta-bancaria').value,
            forma_pagamento: document.getElementById('parcelamento-forma-pagamento').value,
            observacoes: document.getElementById('parcelamento-observacoes').value,
            parcelas: this.parcelas.map(p => ({
                número: p.número,
                data_vencimento: p.vencimento.toISOString().split('T')[0],
                valor: p.valorTotal,
                valor_principal: p.valorPrincipal,
                valor_juros: p.juros
            }))
        };

        try {
            // TODO: Substituir por chamada real à API
            await this.salvarParcelamento(dados);

            this.fecharModal();
            alert(`✅ ${this.parcelas.length} parcelas geradas com sucesso!`);

            // Recarregar listagem se existir função
            if (typeof carregarDados === 'function') {
                carregarDados();
            }

        } catch (error) {
            console.error('Erro ao gerar parcelas:', error);
            alert('❌ Erro ao gerar parcelas: ' + error.message);
        }
    }

    async salvarParcelamento(dados) {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch('/api/financeiro/contas-pagar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(dados)
        });
        if (!response.ok) throw new Error('Erro ao salvar parcelamento');
        return await response.json();
    }

    // ============================================================================
    // AUXILIARES
    // ============================================================================

    async carregarEntidades() {
        const select = document.getElementById('parcelamento-entidade');
        select.innerHTML = '<option value="">Selecione...</option>';
        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const response = await fetch('/api/financeiro/clientes-fornecedores', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const entidades = await response.json();
                (Array.isArray(entidades) ? entidades : []).forEach(e => {
                    select.innerHTML += `<option value="${e.id}">${e.razao_social || e.nome}</option>`;
                });
            }
        } catch(err) { console.error('Erro ao carregar entidades:', err); }
    }

    async carregarContasBancarias() {
        const select = document.getElementById('parcelamento-conta-bancaria');
        select.innerHTML = '<option value="">Selecione...</option>';
        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const response = await fetch('/api/financeiro/contas-bancarias', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const contas = await response.json();
                (Array.isArray(contas) ? contas : []).forEach(c => {
                    select.innerHTML += `<option value="${c.id}">${c.banco} - ${c.agencia || ''}/${c.conta || c.numero_conta || ''}</option>`;
                });
            }
        } catch(err) { console.error('Erro ao carregar contas:', err); }
    }

    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor);
    }

    formatarData(data) {
        if (!data) return '-';
        return new Date(data).toLocaleDateString('pt-BR');
    }

    formatarDataInput(data) {
        const ano = data.getFullYear();
        const mes = String(data.getMonth() + 1).padStart(2, '0');
        const dia = String(data.getDate()).padStart(2, '0');
        return `${ano}-${mes}-${dia}`;
    }

    fecharModal() {
        const modal = document.getElementById('modal-parcelamento');
        if (modal) {
            modal.remove();
        }
        this.modalAberto = false;
    }
}

// Instância global
const sistemaParcelamento = new SistemaParcelamento();
