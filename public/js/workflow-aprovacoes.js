/**
 * Interface de Workflow de Aprovações
 * Cliente JavaScript para gestão de aprovações
 * @author Aluforce ERP
 * @version 1.0.0
 */

const WorkflowAprovacoes = {
    tiposAprovacao: {},
    filtroAtual: 'todos',

    /**
     * Inicializar módulo
     */
    async init() {
        await this.carregarTipos();
        await this.carregarPendentes();
        this.bindEvents();
    },

    /**
     * Bind de eventos
     */
    bindEvents() {
        // Filtros
        document.querySelectorAll('.filtro-tipo').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.filtroAtual = e.target.dataset.tipo || 'todos';
                document.querySelectorAll('.filtro-tipo').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.carregarPendentes();
            });
        });
    },

    /**
     * Carregar tipos de aprovação
     */
    async carregarTipos() {
        try {
            const response = await fetch('/api/workflow/tipos');
            const result = await response.json();
            
            if (result.success) {
                this.tiposAprovacao = result.data;
            }
        } catch (error) {
            console.error('Erro ao carregar tipos:', error);
        }
    },

    /**
     * Carregar aprovações pendentes
     */
    async carregarPendentes() {
        try {
            let url = '/api/workflow/pendentes';
            if (this.filtroAtual !== 'todos') {
                url += `?tipo=${this.filtroAtual}`;
            }
            
            const response = await fetch(url);
            const result = await response.json();
            
            if (result.success) {
                this.renderizarPendentes(result.data);
                this.atualizarContadores(result.data);
            }
        } catch (error) {
            console.error('Erro ao carregar pendentes:', error);
        }
    },

    /**
     * Renderizar lista de pendentes
     */
    renderizarPendentes(solicitacoes) {
        const container = document.getElementById('lista-aprovacoes-pendentes');
        if (!container) return;

        if (solicitacoes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <p>Nenhuma aprovação pendente</p>
                </div>
            `;
            return;
        }

        container.innerHTML = solicitacoes.map(s => `
            <div class="card-aprovacao" data-id="${s.id}">
                <div class="aprovacao-header">
                    <span class="tipo-badge tipo-${s.tipo}">${this.getNomeTipo(s.tipo)}</span>
                    <span class="data-solicitacao">${new Date(s.criado_em).toLocaleDateString('pt-BR')}</span>
                </div>
                
                <div class="aprovacao-body">
                    <div class="info-principal">
                        <h4>Solicitação #${s.id}</h4>
                        <p class="valor">
                            <strong>Valor:</strong> 
                            R$ ${parseFloat(s.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                        </p>
                    </div>
                    
                    <div class="info-solicitante">
                        <span><i class="fas fa-user"></i> ${s.solicitante_nome}</span>
                    </div>
                    
                    ${s.justificativa ? `
                        <div class="justificativa">
                            <small><strong>Justificativa:</strong> ${s.justificativa}</small>
                        </div>
                    ` : ''}
                </div>
                
                <div class="aprovacao-footer">
                    <button class="btn btn-success btn-aprovar" onclick="WorkflowAprovacoes.aprovar(${s.id})">
                        <i class="fas fa-check"></i> Aprovar
                    </button>
                    <button class="btn btn-danger btn-rejeitar" onclick="WorkflowAprovacoes.abrirModalRejeitar(${s.id})">
                        <i class="fas fa-times"></i> Rejeitar
                    </button>
                    <button class="btn btn-outline-secondary btn-detalhes" onclick="WorkflowAprovacoes.verDetalhes(${s.id}, '${s.tipo}', ${s.entidade_id})">
                        <i class="fas fa-eye"></i> Detalhes
                    </button>
                </div>
            </div>
        `).join('');
    },

    /**
     * Obter nome amigável do tipo
     */
    getNomeTipo(tipo) {
        const nomes = {
            'pedido_venda': 'Pedido de Venda',
            'pedido_compra': 'Pedido de Compra',
            'pagamento': 'Pagamento',
            'ordem_producao': 'Ordem de Produção',
            'desconto': 'Desconto',
            'devolucao': 'Devolução'
        };
        return nomes[tipo] || tipo;
    },

    /**
     * Atualizar contadores nos filtros
     */
    atualizarContadores(solicitacoes) {
        const contadores = {
            todos: solicitacoes.length,
            pedido_venda: 0,
            pedido_compra: 0,
            pagamento: 0,
            ordem_producao: 0
        };

        solicitacoes.forEach(s => {
            if (contadores[s.tipo] !== undefined) {
                contadores[s.tipo]++;
            }
        });

        Object.keys(contadores).forEach(tipo => {
            const badge = document.querySelector(`.filtro-tipo[data-tipo="${tipo}"] .contador`);
            if (badge) {
                badge.textContent = contadores[tipo];
                badge.style.display = contadores[tipo] > 0 ? 'inline' : 'none';
            }
        });
    },

    /**
     * Aprovar solicitação
     */
    async aprovar(solicitacaoId) {
        if (!confirm('Confirma a aprovação desta solicitação?')) return;

        try {
            const response = await fetch(`/api/workflow/aprovar/${solicitacaoId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ observacao: 'Aprovado' })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification('Solicitação aprovada com sucesso!', 'success');
                await this.carregarPendentes();
            } else {
                showNotification('Erro ao aprovar: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Erro ao aprovar:', error);
            showNotification('Erro ao processar aprovação', 'error');
        }
    },

    /**
     * Abrir modal de rejeição
     */
    abrirModalRejeitar(solicitacaoId) {
        const modalHtml = `
            <div class="modal fade" id="modal-rejeitar" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Rejeitar Solicitação</h5>
                            <button type="button" class="close" data-dismiss="modal">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="form-group">
                                <label>Motivo da Rejeição <span class="text-danger">*</span></label>
                                <textarea id="motivo-rejeicao" class="form-control" rows="3" 
                                          placeholder="Informe o motivo da rejeição..." required></textarea>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-dismiss="modal">Cancelar</button>
                            <button type="button" class="btn btn-danger" onclick="WorkflowAprovacoes.rejeitar(${solicitacaoId})">
                                Confirmar Rejeição
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Remover modal anterior se existir
        const existente = document.getElementById('modal-rejeitar');
        if (existente) existente.remove();
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        $('#modal-rejeitar').modal('show');
    },

    /**
     * Rejeitar solicitação
     */
    async rejeitar(solicitacaoId) {
        const motivo = document.getElementById('motivo-rejeicao').value.trim();
        
        if (!motivo) {
            showNotification('Informe o motivo da rejeição', 'warning');
            return;
        }

        try {
            const response = await fetch(`/api/workflow/rejeitar/${solicitacaoId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification('Solicitação rejeitada', 'success');
                $('#modal-rejeitar').modal('hide');
                await this.carregarPendentes();
            } else {
                showNotification('Erro ao rejeitar: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Erro ao rejeitar:', error);
            showNotification('Erro ao processar rejeição', 'error');
        }
    },

    /**
     * Ver detalhes da entidade
     */
    async verDetalhes(solicitacaoId, tipo, entidadeId) {
        // Redirecionar para a tela da entidade ou mostrar modal com detalhes
        const rotas = {
            'pedido_venda': `/vendas/pedido/${entidadeId}`,
            'pedido_compra': `/compras/pedido/${entidadeId}`,
            'pagamento': `/financeiro/conta-pagar/${entidadeId}`,
            'ordem_producao': `/pcp/ordem/${entidadeId}`
        };
        
        if (rotas[tipo]) {
            window.open(rotas[tipo], '_blank');
        } else {
            showNotification('Detalhes não disponíveis para este tipo', 'info');
        }
    },

    /**
     * Carregar histórico de aprovações
     */
    async carregarHistorico(pagina = 1) {
        try {
            const response = await fetch(`/api/workflow/historico?page=${pagina}&limit=20`);
            const result = await response.json();
            
            if (result.success) {
                this.renderizarHistorico(result.data);
            }
        } catch (error) {
            console.error('Erro ao carregar histórico:', error);
        }
    },

    /**
     * Renderizar histórico
     */
    renderizarHistorico(historico) {
        const container = document.getElementById('historico-aprovacoes');
        if (!container) return;

        container.innerHTML = `
            <table class="table table-hover">
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Tipo</th>
                        <th>Valor</th>
                        <th>Solicitante</th>
                        <th>Status</th>
                        <th>Aprovador</th>
                    </tr>
                </thead>
                <tbody>
                    ${historico.map(h => `
                        <tr>
                            <td>${new Date(h.criado_em).toLocaleDateString('pt-BR')}</td>
                            <td>${this.getNomeTipo(h.tipo)}</td>
                            <td>R$ ${parseFloat(h.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                            <td>${h.solicitante_nome}</td>
                            <td>
                                <span class="badge badge-${h.status === 'aprovado' ? 'success' : h.status === 'rejeitado' ? 'danger' : 'warning'}">
                                    ${h.status}
                                </span>
                            </td>
                            <td>${h.aprovador_nome || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
};

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('modulo-workflow')) {
        WorkflowAprovacoes.init();
    }
});
