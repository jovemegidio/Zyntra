/**
 * Interface de Conciliação Bancária
 * Cliente JavaScript para gestão de extratos e conciliação
 * @author Aluforce ERP
 * @version 1.0.0
 */

const ConciliacaoBancaria = {
    contaAtual: null,
    importacaoAtual: null,

    /**
     * Inicializar módulo
     */
    init() {
        this.carregarContas();
        this.bindEvents();
    },

    /**
     * Bind de eventos
     */
    bindEvents() {
        // Upload de arquivo OFX
        const inputFile = document.getElementById('arquivo-ofx');
        if (inputFile) {
            inputFile.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        // Botão importar
        const btnImportar = document.getElementById('btn-importar-ofx');
        if (btnImportar) {
            btnImportar.addEventListener('click', () => this.importarOFX());
        }
    },

    /**
     * Carregar contas bancárias
     */
    async carregarContas() {
        try {
            const response = await fetch('/api/conciliacao/contas-bancarias');
            const result = await response.json();
            
            if (result.success) {
                this.renderizarContas(result.data);
            } else {
                showNotification('Erro ao carregar contas: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Erro ao carregar contas:', error);
        }
    },

    /**
     * Renderizar lista de contas
     */
    renderizarContas(contas) {
        const container = document.getElementById('lista-contas-bancarias');
        if (!container) return;

        if (contas.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-university"></i>
                    <p>Nenhuma conta bancária cadastrada</p>
                    <button class="btn btn-primary" onclick="ConciliacaoBancaria.abrirModalNovaConta()">
                        <i class="fas fa-plus"></i> Nova Conta
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = contas.map(conta => `
            <div class="conta-bancaria-card ${this.contaAtual?.id === conta.id ? 'ativa' : ''}" 
                 data-id="${conta.id}" 
                 onclick="ConciliacaoBancaria.selecionarConta(${conta.id})">
                <div class="conta-header">
                    <span class="banco-codigo">${conta.banco_codigo}</span>
                    <span class="banco-nome">${conta.banco_nome}</span>
                </div>
                <div class="conta-dados">
                    <span>Ag: ${conta.agencia}</span>
                    <span>CC: ${conta.conta}</span>
                </div>
                <div class="conta-saldo">
                    <span class="label">Saldo Atual:</span>
                    <span class="valor ${parseFloat(conta.saldo_atual) >= 0 ? 'positivo' : 'negativo'}">
                        R$ ${parseFloat(conta.saldo_atual).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                    </span>
                </div>
                ${conta.data_saldo_atual ? `
                    <div class="conta-ultima-atualizacao">
                        Atualizado em: ${new Date(conta.data_saldo_atual).toLocaleDateString('pt-BR')}
                    </div>
                ` : ''}
            </div>
        `).join('');
    },

    /**
     * Selecionar conta bancária
     */
    async selecionarConta(contaId) {
        this.contaAtual = { id: contaId };
        
        // Atualizar visual
        document.querySelectorAll('.conta-bancaria-card').forEach(card => {
            card.classList.remove('ativa');
            if (parseInt(card.dataset.id) === contaId) {
                card.classList.add('ativa');
            }
        });

        // Carregar transações pendentes
        await this.carregarTransacoesPendentes();
        
        // Carregar resumo
        await this.carregarResumo();
    },

    /**
     * Handle seleção de arquivo OFX
     */
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            document.getElementById('nome-arquivo-ofx').textContent = file.name;
            document.getElementById('btn-importar-ofx').disabled = false;
        }
    },

    /**
     * Importar arquivo OFX
     */
    async importarOFX() {
        if (!this.contaAtual) {
            showNotification('Selecione uma conta bancária primeiro', 'warning');
            return;
        }

        const fileInput = document.getElementById('arquivo-ofx');
        const file = fileInput.files[0];
        
        if (!file) {
            showNotification('Selecione um arquivo OFX', 'warning');
            return;
        }

        const formData = new FormData();
        formData.append('arquivo', file);
        formData.append('conta_id', this.contaAtual.id);

        try {
            const response = await fetch('/api/conciliacao/importar-ofx', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification(`Importadas ${result.data.transacoes} transações`, 'success');
                fileInput.value = '';
                document.getElementById('nome-arquivo-ofx').textContent = 'Nenhum arquivo selecionado';
                document.getElementById('btn-importar-ofx').disabled = true;
                await this.carregarTransacoesPendentes();
            } else {
                showNotification('Erro na importação: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Erro ao importar OFX:', error);
            showNotification('Erro ao importar arquivo', 'error');
        }
    },

    /**
     * Carregar transações pendentes de conciliação
     */
    async carregarTransacoesPendentes() {
        if (!this.contaAtual) return;

        try {
            const response = await fetch(`/api/conciliacao/transacoes-pendentes?conta_id=${this.contaAtual.id}`);
            const result = await response.json();
            
            if (result.success) {
                this.renderizarTransacoes(result.data);
            }
        } catch (error) {
            console.error('Erro ao carregar transações:', error);
        }
    },

    /**
     * Renderizar lista de transações
     */
    renderizarTransacoes(transacoes) {
        const container = document.getElementById('lista-transacoes-extrato');
        if (!container) return;

        if (transacoes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <p>Nenhuma transação pendente de conciliação</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <table class="table table-hover">
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>Tipo</th>
                        <th>Valor</th>
                        <th>Status</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${transacoes.map(t => `
                        <tr class="transacao-${t.tipo}">
                            <td>${new Date(t.data_transacao).toLocaleDateString('pt-BR')}</td>
                            <td>
                                <div class="transacao-descricao">${t.descricao || '-'}</div>
                                ${t.memo ? `<small class="text-muted">${t.memo}</small>` : ''}
                            </td>
                            <td>
                                <span class="badge badge-${t.tipo === 'credito' ? 'success' : 'danger'}">
                                    ${t.tipo === 'credito' ? 'Crédito' : 'Débito'}
                                </span>
                            </td>
                            <td class="valor-${t.tipo}">
                                ${t.tipo === 'credito' ? '+' : '-'} R$ ${parseFloat(t.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                            </td>
                            <td>
                                <span class="badge badge-${t.status_conciliacao === 'pendente' ? 'warning' : 'secondary'}">
                                    ${t.status_conciliacao}
                                </span>
                            </td>
                            <td>
                                <div class="btn-group btn-group-sm">
                                    <button class="btn btn-outline-primary" 
                                            onclick="ConciliacaoBancaria.buscarSugestoes(${t.id})"
                                            title="Buscar sugestões">
                                        <i class="fas fa-search"></i>
                                    </button>
                                    <button class="btn btn-outline-success" 
                                            onclick="ConciliacaoBancaria.abrirModalConciliar(${t.id})"
                                            title="Conciliar manualmente">
                                        <i class="fas fa-link"></i>
                                    </button>
                                    <button class="btn btn-outline-secondary" 
                                            onclick="ConciliacaoBancaria.ignorarTransacao(${t.id})"
                                            title="Ignorar">
                                        <i class="fas fa-eye-slash"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    },

    /**
     * Buscar sugestões de conciliação
     */
    async buscarSugestoes(transacaoId) {
        try {
            const response = await fetch(`/api/conciliacao/sugestoes-conciliacao/${transacaoId}`);
            const result = await response.json();
            
            if (result.success) {
                this.mostrarSugestoes(transacaoId, result.data);
            }
        } catch (error) {
            console.error('Erro ao buscar sugestões:', error);
        }
    },

    /**
     * Mostrar modal com sugestões
     */
    mostrarSugestoes(transacaoId, sugestoes) {
        const { contas_receber, contas_pagar } = sugestoes;
        const todas = [...contas_receber, ...contas_pagar];
        
        if (todas.length === 0) {
            showNotification('Nenhuma sugestão encontrada', 'info');
            return;
        }

        // Criar modal com sugestões
        const modalHtml = `
            <div class="modal fade" id="modal-sugestoes" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Sugestões de Conciliação</h5>
                            <button type="button" class="close" data-dismiss="modal">&times;</button>
                        </div>
                        <div class="modal-body">
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Tipo</th>
                                        <th>Descrição</th>
                                        <th>Vencimento</th>
                                        <th>Valor</th>
                                        <th>Ação</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${contas_receber.map(cr => `
                                        <tr>
                                            <td><span class="badge badge-success">A Receber</span></td>
                                            <td>${cr.descricao || cr.cliente_nome}</td>
                                            <td>${new Date(cr.data_vencimento).toLocaleDateString('pt-BR')}</td>
                                            <td>R$ ${parseFloat(cr.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                                            <td>
                                                <button class="btn btn-sm btn-primary" 
                                                        onclick="ConciliacaoBancaria.conciliar(${transacaoId}, 'receber', ${cr.id})">
                                                    Conciliar
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                    ${contas_pagar.map(cp => `
                                        <tr>
                                            <td><span class="badge badge-danger">A Pagar</span></td>
                                            <td>${cp.descricao || cp.fornecedor_nome}</td>
                                            <td>${new Date(cp.data_vencimento).toLocaleDateString('pt-BR')}</td>
                                            <td>R$ ${parseFloat(cp.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                                            <td>
                                                <button class="btn btn-sm btn-primary" 
                                                        onclick="ConciliacaoBancaria.conciliar(${transacaoId}, 'pagar', ${cp.id})">
                                                    Conciliar
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Remover modal anterior se existir
        const existente = document.getElementById('modal-sugestoes');
        if (existente) existente.remove();
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        $('#modal-sugestoes').modal('show');
    },

    /**
     * Conciliar transação
     */
    async conciliar(transacaoId, tipo, contaId) {
        try {
            const response = await fetch('/api/conciliacao/conciliar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transacao_id: transacaoId,
                    tipo_conta: tipo,
                    conta_id: contaId
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification('Transação conciliada com sucesso!', 'success');
                $('#modal-sugestoes').modal('hide');
                await this.carregarTransacoesPendentes();
                await this.carregarResumo();
            } else {
                showNotification('Erro ao conciliar: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Erro ao conciliar:', error);
            showNotification('Erro ao conciliar transação', 'error');
        }
    },

    /**
     * Ignorar transação
     */
    async ignorarTransacao(transacaoId) {
        if (!confirm('Deseja ignorar esta transação?')) return;
        
        try {
            const response = await fetch(`/api/conciliacao/ignorar/${transacaoId}`, {
                method: 'PUT'
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification('Transação ignorada', 'success');
                await this.carregarTransacoesPendentes();
            }
        } catch (error) {
            console.error('Erro ao ignorar:', error);
        }
    },

    /**
     * Carregar resumo da conciliação
     */
    async carregarResumo() {
        if (!this.contaAtual) return;

        try {
            const response = await fetch(`/api/conciliacao/resumo?conta_id=${this.contaAtual.id}`);
            const result = await response.json();
            
            if (result.success) {
                this.renderizarResumo(result.data);
            }
        } catch (error) {
            console.error('Erro ao carregar resumo:', error);
        }
    },

    /**
     * Renderizar resumo
     */
    renderizarResumo(resumo) {
        const container = document.getElementById('resumo-conciliacao');
        if (!container) return;

        container.innerHTML = `
            <div class="resumo-cards">
                <div class="resumo-card pendentes">
                    <div class="numero">${resumo.pendentes || 0}</div>
                    <div class="label">Pendentes</div>
                </div>
                <div class="resumo-card conciliadas">
                    <div class="numero">${resumo.conciliadas || 0}</div>
                    <div class="label">Conciliadas</div>
                </div>
                <div class="resumo-card ignoradas">
                    <div class="numero">${resumo.ignoradas || 0}</div>
                    <div class="label">Ignoradas</div>
                </div>
            </div>
            <div class="resumo-valores">
                <div class="valor-item">
                    <span class="label">Total Créditos:</span>
                    <span class="valor positivo">R$ ${parseFloat(resumo.total_creditos || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                </div>
                <div class="valor-item">
                    <span class="label">Total Débitos:</span>
                    <span class="valor negativo">R$ ${parseFloat(resumo.total_debitos || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                </div>
            </div>
        `;
    },

    /**
     * Abrir modal para nova conta bancária
     */
    abrirModalNovaConta() {
        // Implementar modal de cadastro de conta
        showNotification('Funcionalidade em desenvolvimento', 'info');
    },

    /**
     * Abrir modal de conciliação manual
     */
    abrirModalConciliar(transacaoId) {
        // Implementar modal de conciliação manual
        this.buscarSugestoes(transacaoId);
    }
};

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('modulo-conciliacao')) {
        ConciliacaoBancaria.init();
    }
});
