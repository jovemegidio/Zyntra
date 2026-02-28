/**
 * REQUISIÇÕES DE COMPRA - Sistema Completo
 * Workflow de aprovação e gestão de requisições
 * Integrado com Ordens de Compra do PCP
 */

let requisicoes = [];
let ordensPCP = []; // Ordens de compra vindas do PCP
let itemReqCounter = 0;
let filtroAtual = 'todos';
let usuarioLogado = { nome: 'Admin', departamento: 'Compras', nivel: 'gerente' };

// Função para obter headers de autenticação
function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
}

// Mostrar toast de notificação
function mostrarToast(mensagem, tipo = 'info') {
    const toast = document.createElement('div');
    toast.innerHTML = `
        <i class="fas fa-${tipo === 'success' ? 'check-circle' : tipo === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${mensagem}</span>
    `;
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10000;
        background: ${tipo === 'success' ? '#22c55e' : tipo === 'error' ? '#ef4444' : '#3b82f6'};
        color: white; padding: 16px 24px; border-radius: 12px;
        display: flex; align-items: center; gap: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    inicializarSistemaRequisicoes();
});

async function inicializarSistemaRequisicoes() {
    console.log('🚀 Inicializando sistema de requisições...');
    
    // Carregar usuário logado
    const userData = localStorage.getItem('usuarioLogado');
    if (userData) {
        const user = JSON.parse(userData);
        usuarioLogado.nome = user.nome || 'Admin';
    }
    
    await carregarRequisicoes();
    await carregarOrdensPCP(); // Integração com PCP
    const dataReq = document.getElementById('dataRequisicao');
    const solicitante = document.getElementById('solicitante');
    if (dataReq) dataReq.valueAsDate = new Date();
    if (solicitante) solicitante.value = usuarioLogado.nome;
    gerarNumeroRequisicao();
    
    console.log('✅ Sistema de requisições inicializado');
}

// ============ INTEGRAÇÃO COM PCP ============

async function carregarOrdensPCP() {
    try {
        console.log('📦 Carregando ordens de compra do PCP...');
        
        // Usar a rota específica do módulo Compras para buscar ordens do PCP
        const response = await fetch('/api/compras/ordens-pcp', {
            headers: getAuthHeaders()
        });
        
        console.log('📡 Resposta da API Compras/Ordens-PCP:', response.status, response.statusText);
        
        if (!response.ok) {
            console.log('⚠️ Tentando rota alternativa /api/pcp/ordens-compra...');
            
            // Fallback: tentar rota do PCP diretamente
            const responsePCP = await fetch('/api/pcp/ordens-compra', {
                headers: getAuthHeaders()
            });
            
            if (responsePCP.ok) {
                const dataPCP = await responsePCP.json();
                ordensPCP = Array.isArray(dataPCP) ? dataPCP : (dataPCP.data || []);
                console.log(`✅ [Fallback PCP] Carregadas ${ordensPCP.length} ordens`);
                integrarOrdensPCPComRequisicoes();
                return;
            }
            
            console.log('⚠️ Nenhuma rota de ordens PCP disponível');
            return;
        }
        
        const data = await response.json();
        console.log('📦 Dados recebidos:', data);
        
        // Tratar diferentes formatos de resposta
        if (data.success && data.data) {
            ordensPCP = Array.isArray(data.data) ? data.data : [];
        } else if (Array.isArray(data)) {
            ordensPCP = data;
        } else if (data.data) {
            ordensPCP = Array.isArray(data.data) ? data.data : [];
        } else if (data.ordens) {
            ordensPCP = Array.isArray(data.ordens) ? data.ordens : [];
        } else {
            ordensPCP = [];
        }
        
        console.log(`✅ Carregadas ${ordensPCP.length} ordens de compra do PCP`);
        
        if (ordensPCP.length > 0) {
            console.log('📋 Exemplo de ordem:', JSON.stringify(ordensPCP[0], null, 2));
        }
        
        // Converter ordens PCP para formato de requisição e adicionar à lista
        integrarOrdensPCPComRequisicoes();
        
    } catch (error) {
        console.error('❌ Erro ao carregar ordens do PCP:', error);
        ordensPCP = [];
    }
}

function integrarOrdensPCPComRequisicoes() {
    // Converter ordens do PCP para formato de requisição
    ordensPCP.forEach(ordem => {
        // Verificar se já existe uma requisição com essa ordem PCP
        const jaExiste = requisicoes.some(r => r.origem_pcp_id === ordem.id);
        if (jaExiste) return;
        
        // Criar requisição a partir da ordem PCP
        const requisicaoPCP = {
            id: `PCP-${ordem.id}`,
            numero: `REQ-PCP-${String(ordem.id).padStart(4, '0')}`,
            data: ordem.data_pedido || new Date().toISOString().split('T')[0],
            solicitante: 'Sistema PCP',
            departamento: 'Produção',
            prioridade: 'normal',
            data_necessaria: ordem.previsao_entrega || ordem.data_entrega_prevista || null,
            justificativa: `Ordem de Compra gerada automaticamente pelo PCP para material: ${ordem.descricao || ordem.material_nome || 'Material'}`,
            status: converterStatusPCPParaRequisicao(ordem.status),
            valor_estimado: parseFloat(ordem.valor_total) || 0,
            itens: [{
                descricao: ordem.descricao || ordem.material_nome || `Material ${ordem.codigo_material || ''}`,
                quantidade: parseFloat(ordem.quantidade) || 1,
                unidade: ordem.unidade || 'UN',
                valor_estimado: parseFloat(ordem.valor_unitario) || 0,
                total_estimado: parseFloat(ordem.valor_total) || 0
            }],
            origem: 'pcp',
            origem_pcp_id: ordem.id,
            origem_pcp_numero: ordem.numero || `OC-${ordem.id}`,
            historico_aprovacao: [],
            created_at: ordem.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        // Adicionar ao início da lista
        requisicoes.unshift(requisicaoPCP);
    });
    
    // Re-renderizar tabela
    renderizarTabelaRequisicoes();
    atualizarCards();
}

function converterStatusPCPParaRequisicao(statusPCP) {
    const mapeamento = {
        'pendente': 'aguardando_aprovacao',
        'Pendente': 'aguardando_aprovacao',
        'aprovado': 'aprovada',
        'Aprovado': 'aprovada',
        'em_transito': 'aprovada',
        'Em Trnsito': 'aprovada',
        'recebido': 'convertida',
        'Recebido': 'convertida',
        'cancelado': 'cancelada',
        'Cancelado': 'cancelada'
    };
    return mapeamento[statusPCP] || 'aguardando_aprovacao';
}

// ============ GERENCIAMENTO DE DADOS ============

async function carregarRequisicoes() {
    try {
        // Tentar carregar do backend
        const response = await fetch('/api/compras/requisicoes', {
            headers: getAuthHeaders()
        });
        if (response.ok) {
            const data = await response.json();
            requisicoes = Array.isArray(data) ? data : (data.requisicoes || []);
            
            // Normalizar dados
            requisicoes = requisicoes.map(r => ({
                ...r,
                numero: r.numero || r.numero_requisicao,
                data: r.data || r.data_requisicao || r.created_at,
                solicitante: r.solicitante || r.solicitante_nome || 'Sistema',
                departamento: r.departamento || 'Compras',
                prioridade: r.prioridade || 'normal',
                status: r.status || 'rascunho',
                valor_estimado: r.valor_estimado || r.valor_total || 0,
                itens: r.itens || []
            }));
            
            renderizarTabelaRequisicoes();
            atualizarCards();
            return;
        }
    } catch (error) {
        console.log('Erro ao carregar requisições da API:', error);
    }
    
    // Fallback para localStorage
    const requisicoesLocal = localStorage.getItem('compras_requisicoes');
    if (requisicoesLocal) {
        requisicoes = JSON.parse(requisicoesLocal);
    } else {
        requisicoes = gerarRequisicoesExemplo();
        salvarRequisicoesLocal();
    }
    
    renderizarTabelaRequisicoes();
    atualizarCards();
}

// ============ MODAL NOVA/EDITAR ============

function abrirModalNovaRequisicao() {
    document.getElementById('requisicaoId').value = '';
    document.getElementById('formRequisicao').reset();
    document.getElementById('modalRequisicaoTitle').textContent = 'Nova Requisição de Compra';
    document.getElementById('dataRequisicao').valueAsDate = new Date();
    document.getElementById('solicitante').value = usuarioLogado.nome;
    document.getElementById('departamento').value = usuarioLogado.departamento;
    gerarNumeroRequisicao();
    limparItensRequisicao();
    adicionarItemRequisicao();
    calcularTotaisRequisicao();
    document.getElementById('modalRequisicao').classList.add('active');
}

function abrirModalEditarRequisicao(requisicaoId) {
    const req = requisicoes.find(r => r.id === requisicaoId);
    if (!req) return;
    
    // Só permite editar se estiver em rascunho ou aguardando aprovação
    if (req.status !== 'rascunho' && req.status !== 'aguardando_aprovacao') {
        alert('Não é possível editar requisições aprovadas ou rejeitadas!');
        return;
    }
    
    document.getElementById('modalRequisicaoTitle').textContent = 'Editar Requisição';
    document.getElementById('requisicaoId').value = req.id;
    document.getElementById('numeroRequisicao').value = req.numero;
    document.getElementById('dataRequisicao').value = req.data;
    document.getElementById('solicitante').value = req.solicitante;
    document.getElementById('departamento').value = req.departamento;
    document.getElementById('prioridade').value = req.prioridade;
    document.getElementById('dataNecessaria').value = req.data_necessaria || '';
    document.getElementById('justificativa').value = req.justificativa;
    
    limparItensRequisicao();
    if (req.itens && req.itens.length > 0) {
        req.itens.forEach(item => adicionarItemRequisicao(item));
    } else {
        adicionarItemRequisicao();
    }
    
    calcularTotaisRequisicao();
    document.getElementById('modalRequisicao').classList.add('active');
}

function fecharModalRequisicao() {
    document.getElementById('modalRequisicao').classList.remove('active');
}

// ============ GERENCIAMENTO DE ITENS ============

function adicionarItemRequisicao(itemData = null) {
    itemReqCounter++;
    const tbody = document.getElementById('itensRequisicaoBody');
    const tr = document.createElement('tr');
    tr.id = `itemReq-${itemReqCounter}`;
    
    tr.innerHTML = `
        <td>
            <input type="text" class="itemReq-descricao" 
                   value="${itemData?.descricao || ''}" 
                   placeholder="Descrição do item">
        </td>
        <td>
            <input type="number" class="itemReq-quantidade" 
                   value="${itemData?.quantidade || 1}" 
                   min="0.01" step="0.01"
                   onchange="calcularItemReqTotal(${itemReqCounter}); calcularTotaisRequisicao()">
        </td>
        <td>
            <select class="itemReq-unidade">
                <option value="UN" ${itemData?.unidade === 'UN' ? 'selected' : ''}>UN</option>
                <option value="KG" ${itemData?.unidade === 'KG' ? 'selected' : ''}>KG</option>
                <option value="M" ${itemData?.unidade === 'M' ? 'selected' : ''}>M</option>
                <option value="L" ${itemData?.unidade === 'L' ? 'selected' : ''}>L</option>
                <option value="CX" ${itemData?.unidade === 'CX' ? 'selected' : ''}>CX</option>
            </select>
        </td>
        <td>
            <input type="number" class="itemReq-valor" 
                   value="${itemData?.valor_estimado || 0}" 
                   min="0" step="0.01"
                   placeholder="0.00"
                   onchange="calcularItemReqTotal(${itemReqCounter}); calcularTotaisRequisicao()">
        </td>
        <td>
            <input type="number" class="itemReq-total" 
                   value="${itemData?.total_estimado || 0}" 
                   readonly 
                   style="background: #f9fafb; font-weight: 600;">
        </td>
        <td>
            <button type="button" class="btn-remove-item" onclick="removerItemRequisicao(${itemReqCounter})">
                <i class="fas fa-trash"></i>
            </button>
        </td>
    `;
    
    tbody.appendChild(tr);
    
    if (itemData) {
        calcularItemReqTotal(itemReqCounter);
    }
}

function removerItemRequisicao(itemId) {
    const item = document.getElementById(`itemReq-${itemId}`);
    if (item) {
        item.remove();
        calcularTotaisRequisicao();
    }
}

function limparItensRequisicao() {
    document.getElementById('itensRequisicaoBody').innerHTML = '';
    itemReqCounter = 0;
}

function calcularItemReqTotal(itemId) {
    const row = document.getElementById(`itemReq-${itemId}`);
    if (!row) return;
    
    const quantidade = parseFloat(row.querySelector('.itemReq-quantidade').value) || 0;
    const valor = parseFloat(row.querySelector('.itemReq-valor').value) || 0;
    const total = quantidade * valor;
    
    row.querySelector('.itemReq-total').value = total.toFixed(2);
}

function calcularTotaisRequisicao() {
    const rows = document.querySelectorAll('#itensRequisicaoBody tr');
    let total = 0;
    
    rows.forEach(row => {
        const itemTotal = parseFloat(row.querySelector('.itemReq-total').value) || 0;
        total += itemTotal;
    });
    
    document.getElementById('totalRequisicao').textContent = formatarMoeda(total);
}

// ============ SALVAR REQUISIÇÍO ============

async function salvarRequisicao(status) {
    const requisicaoId = document.getElementById('requisicaoId').value;
    const justificativa = document.getElementById('justificativa').value.trim();
    
    if (!justificativa) {
        alert('Informe a justificativa da requisição!');
        return;
    }
    
    const itens = coletarItensRequisicao();
    if (itens.length === 0) {
        alert('Adicione pelo menos um item!');
        return;
    }
    
    const total = itens.reduce((sum, item) => sum + item.total_estimado, 0);
    
    const requisicao = {
        id: requisicaoId || Date.now().toString(),
        numero: document.getElementById('numeroRequisicao').value,
        data: document.getElementById('dataRequisicao').value,
        solicitante: document.getElementById('solicitante').value,
        departamento: document.getElementById('departamento').value,
        prioridade: document.getElementById('prioridade').value,
        data_necessaria: document.getElementById('dataNecessaria').value || null,
        justificativa: justificativa,
        status: status,
        valor_estimado: total,
        itens: itens,
        historico_aprovacao: requisicaoId ? 
            requisicoes.find(r => r.id === requisicaoId)?.historico_aprovacao || [] : [],
        created_at: requisicaoId ? 
            requisicoes.find(r => r.id === requisicaoId)?.created_at : new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    try {
        // Tentar salvar no backend
        const url = requisicaoId ? `/api/compras/requisicoes/${requisicaoId}` : '/api/compras/requisicoes';
        const response = await fetch(url, {
            method: requisicaoId ? 'PUT' : 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(requisicao)
        });
        
        if (response.ok) {
            const result = await response.json();
            requisicao.id = result.id || requisicao.id;
            
            if (requisicaoId) {
                const index = requisicoes.findIndex(r => r.id === requisicaoId);
                if (index !== -1) requisicoes[index] = requisicao;
            } else {
                requisicoes.unshift(requisicao);
            }
            
            mostrarToast(status === 'rascunho' ? 'Requisição salva!' : 'Requisição enviada para aprovação!', 'success');
        } else {
            throw new Error('Erro na API');
        }
    } catch (error) {
        console.log('Salvando localmente...', error);
        
        if (requisicaoId) {
            const index = requisicoes.findIndex(r => r.id === requisicaoId);
            if (index !== -1) requisicoes[index] = requisicao;
        } else {
            requisicoes.unshift(requisicao);
        }
        
        salvarRequisicoesLocal();
    }
    
    renderizarTabelaRequisicoes();
    atualizarCards();
    fecharModalRequisicao();
}

function coletarItensRequisicao() {
    const rows = document.querySelectorAll('#itensRequisicaoBody tr');
    const itens = [];
    
    rows.forEach(row => {
        const descricao = row.querySelector('.itemReq-descricao').value.trim();
        if (!descricao) return;
        
        const quantidade = parseFloat(row.querySelector('.itemReq-quantidade').value) || 0;
        const valor = parseFloat(row.querySelector('.itemReq-valor').value) || 0;
        
        itens.push({
            descricao: descricao,
            quantidade: quantidade,
            unidade: row.querySelector('.itemReq-unidade').value,
            valor_estimado: valor,
            total_estimado: quantidade * valor
        });
    });
    
    return itens;
}

// ============ VISUALIZAR E APROVAR ============

function visualizarRequisicao(requisicaoId) {
    const req = requisicoes.find(r => r.id === requisicaoId);
    if (!req) return;
    
    const content = document.getElementById('detalhesRequisicaoContent');
    const footer = document.getElementById('detalhesRequisicaoFooter');
    
    // Banner de origem PCP
    let origemPCPHTML = '';
    if (req.origem === 'pcp') {
        origemPCPHTML = `
            <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 16px; border-radius: 12px; margin-bottom: 20px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <i class="fas fa-industry" style="font-size: 24px;"></i>
                    <div>
                        <p style="font-weight: 700; font-size: 14px; margin-bottom: 4px;">Requisição originada do PCP</p>
                        <p style="font-size: 12px; opacity: 0.9;">Ordem de Compra: ${req.origem_pcp_numero || req.id}</p>
                    </div>
                </div>
            </div>
        `;
    }
    
    // Workflow visual
    let workflowHTML = '';
    if (req.status !== 'rascunho') {
        workflowHTML = `
            <div class="workflow-steps">
                <div class="workflow-step completed">
                    <div class="step-circle"><i class="fas fa-file-alt"></i></div>
                    <div class="step-label">Criada</div>
                </div>
                <div class="workflow-step ${req.status === 'aguardando_aprovacao' || req.status === 'aprovada' ? 'active' : ''}">
                    <div class="step-circle"><i class="fas fa-clock"></i></div>
                    <div class="step-label">Em Aprovação</div>
                </div>
                <div class="workflow-step ${req.status === 'aprovada' ? 'completed' : ''}">
                    <div class="step-circle"><i class="fas fa-check"></i></div>
                    <div class="step-label">Aprovada</div>
                </div>
                <div class="workflow-step ${req.status === 'convertida' ? 'completed' : ''}">
                    <div class="step-circle"><i class="fas fa-shopping-cart"></i></div>
                    <div class="step-label">Convertida</div>
                </div>
            </div>
        `;
    }
    
    content.innerHTML = `
        ${origemPCPHTML}
        ${workflowHTML}
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Número</p>
                <p style="font-weight: 600; font-size: 16px;">${req.numero}</p>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Status</p>
                <span class="badge-status badge-${req.status}">${getStatusLabelReq(req.status)}</span>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Solicitante</p>
                <p style="font-weight: 600;">${req.solicitante}</p>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Departamento</p>
                <p style="font-weight: 600;">${req.departamento}</p>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Data</p>
                <p style="font-weight: 600;">${formatarData(req.data)}</p>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Prioridade</p>
                <span class="priority-badge priority-${req.prioridade}">${req.prioridade.toUpperCase()}</span>
            </div>
        </div>
        
        <div style="margin: 20px 0;">
            <p style="color: #64748b; font-size: 13px; margin-bottom: 8px;">Justificativa</p>
            <p style="background: #f9fafb; padding: 12px; border-radius: 8px;">${req.justificativa}</p>
        </div>
        
        <h4 style="margin: 24px 0 16px;"><i class="fas fa-list"></i> Itens Requisitados</h4>
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: #f9fafb; border-bottom: 2px solid #e5e7eb;">
                    <th style="padding: 12px; text-align: left;">Descrição</th>
                    <th style="padding: 12px; text-align: center;">Qtd</th>
                    <th style="padding: 12px; text-align: center;">Un.</th>
                    <th style="padding: 12px; text-align: right;">Valor Est.</th>
                    <th style="padding: 12px; text-align: right;">Total</th>
                </tr>
            </thead>
            <tbody>
                ${req.itens.map(item => `
                    <tr style="border-bottom: 1px solid #e5e7eb;">
                        <td style="padding: 12px;">${item.descricao}</td>
                        <td style="padding: 12px; text-align: center;">${item.quantidade}</td>
                        <td style="padding: 12px; text-align: center;">${item.unidade}</td>
                        <td style="padding: 12px; text-align: right;">${formatarMoeda(item.valor_estimado)}</td>
                        <td style="padding: 12px; text-align: right; font-weight: 600;">${formatarMoeda(item.total_estimado)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        
        <div style="background: #f9fafb; padding: 16px; border-radius: 12px; margin-top: 16px;">
            <div style="display: flex; justify-content: space-between; font-size: 18px; font-weight: 700; color: #8b5cf6;">
                <span>Valor Total Estimado:</span>
                <span>${formatarMoeda(req.valor_estimado)}</span>
            </div>
        </div>
        
        ${req.historico_aprovacao && req.historico_aprovacao.length > 0 ? `
            <div class="approval-timeline">
                <h4 style="margin-bottom: 16px;"><i class="fas fa-history"></i> Histórico de Aprovação</h4>
                ${req.historico_aprovacao.map(h => `
                    <div class="timeline-item ${h.acao}">
                        <div>
                            <p style="font-weight: 600; margin-bottom: 4px;">${h.aprovador}</p>
                            <p style="font-size: 13px; color: #64748b; margin-bottom: 8px;">${formatarDataHora(h.data)}</p>
                            <p style="font-size: 14px;">
                                <span class="badge-status badge-${h.acao === 'approved' ? 'aprovado' : 'cancelado'}">
                                    ${h.acao === 'approved' ? 'Aprovado' : 'Rejeitado'}
                                </span>
                            </p>
                            ${h.observacao ? `<p style="margin-top: 8px; font-size: 13px;">${h.observacao}</p>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;
    
    // Botões do footer
    if (req.status === 'aguardando_aprovacao') {
        footer.innerHTML = `
            <button type="button" class="btn-secondary" onclick="rejeitarRequisicao('${req.id}')">
                <i class="fas fa-times"></i> Rejeitar
            </button>
            <button type="button" class="btn-primary" onclick="aprovarRequisicao('${req.id}')">
                <i class="fas fa-check"></i> Aprovar
            </button>
        `;
    } else if (req.status === 'aprovada') {
        footer.innerHTML = `
            <button type="button" class="btn-secondary" onclick="fecharModalVisualizar()">Fechar</button>
            <button type="button" class="btn-primary" onclick="converterEmPedido('${req.id}')">
                <i class="fas fa-shopping-cart"></i> Converter em Pedido
            </button>
        `;
    } else {
        footer.innerHTML = `
            <button type="button" class="btn-secondary" onclick="fecharModalVisualizar()">Fechar</button>
        `;
    }
    
    document.getElementById('modalVisualizarRequisicao').classList.add('active');
}

function fecharModalVisualizar() {
    document.getElementById('modalVisualizarRequisicao').classList.remove('active');
}

function aprovarRequisicao(requisicaoId) {
    const observacao = prompt('Observações da aprovação (opcional):');
    
    const req = requisicoes.find(r => r.id === requisicaoId);
    if (req) {
        req.status = 'aprovada';
        req.historico_aprovacao = req.historico_aprovacao || [];
        req.historico_aprovacao.push({
            aprovador: usuarioLogado.nome,
            acao: 'approved',
            data: new Date().toISOString(),
            observacao: observacao
        });
        
        salvarRequisicoesLocal();
        renderizarTabelaRequisicoes();
        atualizarCards();
        fecharModalVisualizar();
        mostrarNotificacao('Requisição aprovada com sucesso!', 'success');
    }
}

function rejeitarRequisicao(requisicaoId) {
    const motivo = prompt('Motivo da rejeição:');
    if (!motivo) return;
    
    const req = requisicoes.find(r => r.id === requisicaoId);
    if (req) {
        req.status = 'rejeitada';
        req.historico_aprovacao = req.historico_aprovacao || [];
        req.historico_aprovacao.push({
            aprovador: usuarioLogado.nome,
            acao: 'rejected',
            data: new Date().toISOString(),
            observacao: motivo
        });
        
        salvarRequisicoesLocal();
        renderizarTabelaRequisicoes();
        atualizarCards();
        fecharModalVisualizar();
        mostrarNotificacao('Requisição rejeitada!', 'info');
    }
}

function converterEmPedido(requisicaoId) {
    if (!confirm('Converter esta requisição em pedido de compra?')) return;
    
    const req = requisicoes.find(r => r.id === requisicaoId);
    if (req) {
        req.status = 'convertida';
        salvarRequisicoesLocal();
        
        // Salvar dados para criar pedido
        localStorage.setItem('nova_pedido_da_requisicao', JSON.stringify(req));
        
        // Redirecionar para página de pedidos
        window.location.href = 'pedidos.html?from=requisicao';
    }
}

function excluirRequisicao(requisicaoId) {
    if (!confirm('Deseja realmente excluir esta requisição?')) return;
    
    requisicoes = requisicoes.filter(r => r.id !== requisicaoId);
    salvarRequisicoesLocal();
    renderizarTabelaRequisicoes();
    atualizarCards();
    mostrarNotificacao('Requisição excluída!', 'success');
}

// ============ RENDERIZAÇÍO ============

function renderizarTabelaRequisicoes() {
    const tbody = document.getElementById('requisicoesTableBody');
    
    let requisicoesFiltradas = requisicoes;
    
    // Filtro por status
    if (filtroAtual !== 'todos') {
        requisicoesFiltradas = requisicoesFiltradas.filter(r => r.status === filtroAtual);
    }
    
    // Filtro por origem (PCP)
    if (filtroOrigem) {
        requisicoesFiltradas = requisicoesFiltradas.filter(r => r.origem === filtroOrigem);
    }
    
    // Filtro por prioridade
    if (filtroPrioridade) {
        requisicoesFiltradas = requisicoesFiltradas.filter(r => 
            r.prioridade === filtroPrioridade || r.prioridade === 'alta'
        );
    }
    
    const searchTerm = document.getElementById('searchRequisicao')?.value?.toLowerCase();
    if (searchTerm) {
        requisicoesFiltradas = requisicoesFiltradas.filter(r =>
            r.numero.toLowerCase().includes(searchTerm) ||
            r.solicitante.toLowerCase().includes(searchTerm) ||
            r.departamento.toLowerCase().includes(searchTerm)
        );
    }
    
    if (requisicoesFiltradas.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: #64748b;">
                    <i class="fas fa-file-alt" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>Nenhuma requisição encontrada</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = requisicoesFiltradas.map(req => `
        <tr>
            <td>
                <strong>${req.numero}</strong>
                ${req.origem === 'pcp' ? `
                    <span style="display: block; font-size: 10px; color: #6366f1; background: #ede9fe; padding: 2px 6px; border-radius: 4px; margin-top: 4px; width: fit-content;">
                        <i class="fas fa-industry"></i> Origem: PCP
                    </span>
                ` : ''}
            </td>
            <td>${req.solicitante}</td>
            <td>${req.departamento}</td>
            <td>${formatarData(req.data)}</td>
            <td><span class="priority-badge priority-${req.prioridade}">${req.prioridade}</span></td>
            <td><strong>${formatarMoeda(req.valor_estimado)}</strong></td>
            <td><span class="badge-status badge-${req.status}">${getStatusLabelReq(req.status)}</span></td>
            <td>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-secondary-small" onclick="visualizarRequisicao('${req.id}')" title="Visualizar">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${(req.status === 'rascunho' || req.status === 'aguardando_aprovacao') && req.origem !== 'pcp' ? `
                    <button class="btn-secondary-small" onclick="abrirModalEditarRequisicao('${req.id}')" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    ` : ''}
                    ${req.status === 'rascunho' && req.origem !== 'pcp' ? `
                    <button class="btn-secondary-small" onclick="excluirRequisicao('${req.id}')" title="Excluir" style="color: #dc2626;">
                        <i class="fas fa-trash"></i>
                    </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

function atualizarCards() {
    const total = requisicoes.length;
    const aguardando = requisicoes.filter(r => r.status === 'aguardando_aprovacao').length;
    const aprovadas = requisicoes.filter(r => r.status === 'aprovada').length;
    const urgentes = requisicoes.filter(r => r.prioridade === 'urgente' || r.prioridade === 'alta').length;
    const doPCP = requisicoes.filter(r => r.origem === 'pcp').length;
    
    document.getElementById('totalRequisicoes').textContent = total;
    document.getElementById('requisicoesAguardando').textContent = aguardando;
    document.getElementById('requisicoesAprovadas').textContent = aprovadas;
    document.getElementById('requisicoesUrgentes').textContent = urgentes;
    
    // Se houver requisições do PCP, adicionar indicador visual
    const totalCard = document.getElementById('totalRequisicoes')?.parentElement;
    if (totalCard && doPCP > 0) {
        let pcpIndicator = totalCard.querySelector('.pcp-indicator');
        if (!pcpIndicator) {
            pcpIndicator = document.createElement('span');
            pcpIndicator.className = 'pcp-indicator';
            pcpIndicator.style.cssText = 'display: block; font-size: 11px; color: #6366f1; margin-top: 4px;';
            totalCard.appendChild(pcpIndicator);
        }
        pcpIndicator.innerHTML = `<i class="fas fa-industry"></i> ${doPCP} do PCP`;
    }
}

// ============ FILTROS ============

let filtroOrigem = null;
let filtroPrioridade = null;

function filtrarPorStatus(status, evt) {
    filtroAtual = status;
    filtroOrigem = null;
    filtroPrioridade = null;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const e = evt || window.event;
    if (e && e.target) {
        const btn = e.target.closest('.filter-btn');
        if (btn) btn.classList.add('active');
    }
    renderizarTabelaRequisicoes();
}

function filtrarPorOrigem(origem, evt) {
    filtroAtual = 'todos';
    filtroOrigem = origem;
    filtroPrioridade = null;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const e2 = evt || window.event;
    if (e2 && e2.target) {
        const btn = e2.target.closest('.filter-btn');
        if (btn) btn.classList.add('active');
    }
    renderizarTabelaRequisicoes();
}

function filtrarPorPrioridade(prioridade, evt) {
    filtroAtual = 'todos';
    filtroOrigem = null;
    filtroPrioridade = prioridade;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const e3 = evt || window.event;
    if (e3 && e3.target) {
        const btn = e3.target.closest('.filter-btn');
        if (btn) btn.classList.add('active');
    }
    renderizarTabelaRequisicoes();
}

function filtrarRequisicoes() {
    renderizarTabelaRequisicoes();
}

// ============ UTILITÁRIOS ============

function gerarNumeroRequisicao() {
    const ano = new Date().getFullYear();
    const maxNum = requisicoes.length > 0
        ? Math.max(...requisicoes.map(r => {
            const match = r.numero ? r.numero.match(/(\d+)$/) : null;
            return match ? parseInt(match[1]) : 0;
        }))
        : 0;
    const numero = (maxNum + 1).toString().padStart(4, '0');
    document.getElementById('numeroRequisicao').value = `REQ-${ano}-${numero}`;
}

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}

function formatarData(data) {
    return data ? new Date(data).toLocaleDateString('pt-BR') : '-';
}

function formatarDataHora(data) {
    return data ? new Date(data).toLocaleString('pt-BR') : '-';
}

function getStatusLabelReq(status) {
    const labels = {
        'rascunho': 'Rascunho',
        'aguardando_aprovacao': 'Aguardando',
        'aprovada': 'Aprovada',
        'rejeitada': 'Rejeitada',
        'convertida': 'Convertida'
    };
    return labels[status] || status;
}

function salvarRequisicoesLocal() {
    localStorage.setItem('compras_requisicoes', JSON.stringify(requisicoes));
}

function mostrarNotificacao(mensagem, tipo) {
    if (typeof mostrarToast === 'function') {
        mostrarToast(mensagem, tipo);
    } else {
        alert(mensagem);
    }
}

// ============ DADOS DE EXEMPLO ============

function gerarRequisicoesExemplo() {
    return [
        {
            id: '1',
            numero: 'REQ-2025-0001',
            data: '2025-12-10',
            solicitante: 'João Silva',
            departamento: 'Produção',
            prioridade: 'alta',
            data_necessaria: '2025-12-20',
            justificativa: 'Reposição de material para produção',
            status: 'aguardando_aprovacao',
            valor_estimado: 15000,
            itens: [
                { descricao: 'Cabo Triplex 10mm²', quantidade: 500, unidade: 'M', valor_estimado: 25, total_estimado: 12500 },
                { descricao: 'Conectores', quantidade: 100, unidade: 'UN', valor_estimado: 25, total_estimado: 2500 }
            ],
            historico_aprovacao: [],
            created_at: '2025-12-10T10:00:00Z'
        },
        {
            id: '2',
            numero: 'REQ-2025-0002',
            data: '2025-12-09',
            solicitante: 'Maria Santos',
            departamento: 'Manutenção',
            prioridade: 'normal',
            justificativa: 'Ferramentas para manutenção preventiva',
            status: 'aprovada',
            valor_estimado: 8500,
            itens: [
                { descricao: 'Jogo de chaves', quantidade: 5, unidade: 'UN', valor_estimado: 350, total_estimado: 1750 }
            ],
            historico_aprovacao: [
                {
                    aprovador: 'Admin',
                    acao: 'approved',
                    data: '2025-12-09T15:00:00Z',
                    observacao: 'Aprovado conforme orçamento'
                }
            ],
            created_at: '2025-12-09T09:00:00Z'
        }
    ];
}
