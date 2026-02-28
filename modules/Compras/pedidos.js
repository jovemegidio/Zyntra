/**
 * PEDIDOS DE COMPRA - Gerenciamento Completo
 * Sistema completo de criação, edição, aprovação e acompanhamento de pedidos
 */

let pedidos = [];
let fornecedores = [];
let produtos = [];
let itemCounter = 0;
let filtroAtual = 'todos';

// Função para obter headers de autenticação
function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
}

// Mostrar toast de notificação (usa ComprasUtils se disponível)
function mostrarToast(mensagem, tipo = 'info') {
    // Usar utilitário centralizado se disponível
    if (typeof ComprasUtils !== 'undefined' && ComprasUtils.toast) {
        return ComprasUtils.toast.show(mensagem, tipo);
    }

    // Fallback: implementação local (retrocompatibilidade)
    const existingToasts = document.querySelectorAll('.toast-notification-pedidos');
    if (existingToasts.length > 3) {
        existingToasts[0].remove();
    }

    if (!document.getElementById('toast-animation-style')) {
        const style = document.createElement('style');
        style.id = 'toast-animation-style';
        style.textContent = `
            @keyframes toastSlideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes toastSlideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    const cores = {
        success: 'var(--success, #22c55e)',
        error: 'var(--danger, #ef4444)',
        info: 'var(--info, #3b82f6)',
        warning: 'var(--warning, #f59e0b)'
    };

    const icones = {
        success: 'check-circle',
        error: 'exclamation-circle',
        info: 'info-circle',
        warning: 'exclamation-triangle'
    };

    const toast = document.createElement('div');
    toast.className = 'toast-notification-pedidos';
    toast.innerHTML = `
        <i class="fas fa-${icones[tipo] || 'info-circle'}"></i>
        <span>${mensagem}</span>
    `;
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10000;
        background: ${cores[tipo] || cores.info};
        color: white; padding: 16px 24px; border-radius: 12px;
        display: flex; align-items: center; gap: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        animation: toastSlideIn 0.3s ease forwards;
        max-width: 350px;
        font-size: 14px;
        font-weight: 500;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    inicializarSistema();

    // ATUALIZAÇÃO EM TEMPO REAL: Recarregar dados quando a janela receber foco
    // Isso garante que valores editados em outras abas sejam atualizados
    window.addEventListener('focus', async () => {
        console.log('[Pedidos] Janela recebeu foco - atualizando dados...');
        await carregarPedidos();
    });

    // Também verificar quando a aba ficar visível novamente
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
            console.log('[Pedidos] Aba ficou visível - atualizando dados...');
            await carregarPedidos();
        }
    });
});

async function inicializarSistema() {
    console.log('🚀 Inicializando sistema de pedidos...');

    // Carregar dados
    await carregarFornecedores();
    await carregarProdutos();
    await carregarPedidos();

    // Configurar data padrão
    const dataPedido = document.getElementById('dataPedido');
    if (dataPedido) dataPedido.valueAsDate = new Date();

    // Gerar número do pedido
    gerarNumeroPedido();

    console.log('✅ Sistema inicializado');
}

// ============ GERENCIAMENTO DE DADOS ============

async function carregarPedidos() {
    try {
        // Tentar carregar do backend
        const response = await fetch('/api/compras/pedidos', {
            headers: getAuthHeaders()
        });
        if (response.ok) {
            const data = await response.json();
            pedidos = Array.isArray(data) ? data : (data.pedidos || []);

            // Normalizar dados
            pedidos = pedidos.map(p => ({
                ...p,
                numero_pedido: p.numero_pedido || p.numero,
                fornecedor_id: p.fornecedor_id || p.fornecedorId,
                fornecedor_nome: p.fornecedor_nome || p.fornecedor,
                data_pedido: p.data_pedido || p.dataPedido || p.created_at,
                data_entrega_prevista: p.data_entrega_prevista || p.dataEntrega,
                status: p.status || 'Pendente',
                origem: p.origem || 'COMPRAS',
                itens: p.itens || []
            }));

            renderizarTabelaPedidos();
            atualizarCards();
            return;
        }
    } catch (error) {
        console.log('Erro ao carregar pedidos da API:', error);
    }

    // Fallback: localStorage
    const pedidosLocal = localStorage.getItem('compras_pedidos');
    if (pedidosLocal) {
        pedidos = JSON.parse(pedidosLocal);
    } else {
        pedidos = [];
    }

    renderizarTabelaPedidos();
    atualizarCards();
}

async function carregarFornecedores() {
    try {
        const response = await fetch('/api/compras/fornecedores', {
            headers: getAuthHeaders()
        });
        if (response.ok) {
            const data = await response.json();
            fornecedores = Array.isArray(data) ? data : (data.fornecedores || []);
            preencherSelectFornecedores();
            preencherSelectCompradores();
            return;
        }
    } catch (error) {
        console.log('Erro ao carregar fornecedores:', error);
    }

    const fornecedoresLocal = localStorage.getItem('compras_fornecedores');
    if (fornecedoresLocal) {
        fornecedores = JSON.parse(fornecedoresLocal);
    } else {
        fornecedores = [];
    }

    preencherSelectFornecedores();
    preencherSelectCompradores();
}

async function carregarProdutos() {
    try {
        const response = await fetch('/api/produtos', {
            headers: getAuthHeaders()
        });
        if (response.ok) {
            const data = await response.json();
            produtos = Array.isArray(data) ? data : (data.produtos || []);
            return;
        }
    } catch (error) {
        console.log('Carregando produtos do localStorage...');
    }

    // Tentar também da API de materiais do PCP
    try {
        const response = await fetch('/api/pcp/materiais', {
            headers: getAuthHeaders()
        });
        if (response.ok) {
            const data = await response.json();
            produtos = Array.isArray(data) ? data : (data.materiais || []);
            return;
        }
    } catch (error) {
        console.log('Erro ao carregar materiais:', error);
    }

    const produtosLocal = localStorage.getItem('produtos');
    if (produtosLocal) {
        produtos = JSON.parse(produtosLocal);
    } else {
        produtos = [];
    }
}

// ============ MODAL NOVO/EDITAR PEDIDO ============

function abrirModalNovoPedido() {
    document.getElementById('pedidoId').value = '';
    document.getElementById('formPedido').reset();
    document.getElementById('modalPedidoTitle').textContent = 'Novo Pedido de Compra';
    document.getElementById('dataPedido').valueAsDate = new Date();
    gerarNumeroPedido();
    limparItens();
    adicionarItem(); // Adiciona primeira linha
    calcularTotais();
    document.getElementById('modalPedido').classList.add('active');
}

async function abrirModalEditarPedido(pedidoId) {
    let pedido = pedidos.find(p => p.id == pedidoId);

    // Se não tiver itens ou itens vazio, buscar da API
    if (!pedido || !pedido.itens || pedido.itens.length === 0) {
        try {
            const response = await fetch(`/api/compras/pedidos/${pedidoId}`, {
                headers: getAuthHeaders()
            });
            if (response.ok) {
                pedido = await response.json();
            }
        } catch (error) {
            console.error('Erro ao buscar pedido:', error);
        }
    }

    if (!pedido) {
        mostrarToast('Pedido não encontrado', 'error');
        return;
    }

    document.getElementById('modalPedidoTitle').textContent = 'Editar Pedido de Compra';
    document.getElementById('pedidoId').value = pedido.id;
    document.getElementById('numeroPedido').value = pedido.numero_pedido || '';
    document.getElementById('dataPedido').value = pedido.data_pedido ? pedido.data_pedido.split('T')[0] : '';
    document.getElementById('fornecedorId').value = pedido.fornecedor_id || '';
    document.getElementById('compradorId').value = pedido.comprador_id || '';
    document.getElementById('dataEntregaPrevista').value = pedido.data_entrega_prevista ? pedido.data_entrega_prevista.split('T')[0] : '';
    document.getElementById('statusPedido').value = pedido.status || 'pendente';
    document.getElementById('condicoesPagamento').value = pedido.condicoes_pagamento || '';
    document.getElementById('observacoes').value = pedido.observacoes || '';
    document.getElementById('desconto').value = pedido.desconto || 0;
    document.getElementById('frete').value = pedido.frete || 0;

    limparItens();
    if (pedido.itens && pedido.itens.length > 0) {
        pedido.itens.forEach(item => {
            adicionarItem({
                descricao: item.descricao || item.material || '',
                quantidade: item.quantidade || 1,
                preco_unitario: item.preco_unitario || 0,
                unidade: item.unidade || 'UN'
            });
        });
    } else {
        adicionarItem();
    }

    calcularTotais();
    document.getElementById('modalPedido').classList.add('active');
}

function fecharModalPedido() {
    document.getElementById('modalPedido').classList.remove('active');
}

// ============ GERENCIAMENTO DE ITENS ============

function adicionarItem(itemData = null) {
    itemCounter++;
    const tbody = document.getElementById('itensTableBody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.id = `item-${itemCounter}`;

    const unidadeAtual = itemData?.unidade || 'UN';

    tr.innerHTML = `
        <td>
            <input type="text" class="item-descricao"
                   value="${itemData?.descricao || ''}"
                   placeholder="Descrição do item"
                   style="width: 100%; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px;"
                   onchange="calcularTotais()">
        </td>
        <td>
            <input type="number" class="item-quantidade"
                   value="${itemData?.quantidade || 1}"
                   min="0.01" step="0.01"
                   style="width: 100%; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; text-align: center;"
                   onchange="calcularItemTotal(${itemCounter}); calcularTotais()">
        </td>
        <td>
            <select class="item-unidade" style="width: 100%; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px;">
                <option value="UN" ${unidadeAtual === 'UN' ? 'selected' : ''}>UN</option>
                <option value="M" ${unidadeAtual === 'M' ? 'selected' : ''}>M</option>
                <option value="KG" ${unidadeAtual === 'KG' ? 'selected' : ''}>KG</option>
                <option value="PC" ${unidadeAtual === 'PC' ? 'selected' : ''}>PC</option>
                <option value="CX" ${unidadeAtual === 'CX' ? 'selected' : ''}>CX</option>
                <option value="L" ${unidadeAtual === 'L' ? 'selected' : ''}>L</option>
            </select>
        </td>
        <td>
            <input type="number" class="item-preco"
                   value="${itemData?.preco_unitario || 0}"
                   min="0" step="0.01"
                   placeholder="0.00"
                   style="width: 100%; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; text-align: right;"
                   onchange="calcularItemTotal(${itemCounter}); calcularTotais()">
        </td>
        <td style="text-align: right;">
            <input type="number" class="item-total"
                   value="${itemData?.preco_total || 0}"
                   readonly
                   style="width: 100%; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; font-weight: 600; text-align: right;">
        </td>
        <td style="text-align: center;">
            <button type="button" onclick="removerItem(${itemCounter})" style="width: 32px; height: 32px; border: none; background: #fee2e2; color: #dc2626; border-radius: 6px; cursor: pointer;">
                <i class="fas fa-trash"></i>
            </button>
        </td>
    `;

    tbody.appendChild(tr);

    if (itemData) {
        calcularItemTotal(itemCounter);
    }
}

function removerItem(itemId) {
    const item = document.getElementById(`item-${itemId}`);
    if (item) {
        item.remove();
        calcularTotais();
    }
}

function limparItens() {
    document.getElementById('itensTableBody').innerHTML = '';
    itemCounter = 0;
}

function calcularItemTotal(itemId) {
    const row = document.getElementById(`item-${itemId}`);
    if (!row) return;

    const quantidade = parseFloat(row.querySelector('.item-quantidade').value) || 0;
    const preco = parseFloat(row.querySelector('.item-preco').value) || 0;
    const total = quantidade * preco;

    row.querySelector('.item-total').value = total.toFixed(2);
}

function calcularTotais() {
    const rows = document.querySelectorAll('#itensTableBody tr');
    let subtotal = 0;

    rows.forEach(row => {
        const total = parseFloat(row.querySelector('.item-total')?.value) || 0;
        subtotal += total;
    });

    const desconto = parseFloat(document.getElementById('desconto').value) || 0;
    const frete = parseFloat(document.getElementById('frete').value) || 0;

    const totalFinal = subtotal - desconto + frete;

    // Atualizar elementos de exibição
    const subtotalEl = document.getElementById('subtotal') || document.getElementById('subtotalPedido');
    const descontoValorEl = document.getElementById('descontoValor');
    const freteValorEl = document.getElementById('freteValor');
    const totalPedidoEl = document.getElementById('totalPedido');

    if (subtotalEl) subtotalEl.textContent = formatarMoeda(subtotal);
    if (descontoValorEl) descontoValorEl.textContent = '- ' + formatarMoeda(desconto);
    if (freteValorEl) freteValorEl.textContent = '+ ' + formatarMoeda(frete);
    if (totalPedidoEl) totalPedidoEl.textContent = formatarMoeda(totalFinal);
}

// ============ SALVAR PEDIDO ============

async function salvarPedido() {
    const pedidoId = document.getElementById('pedidoId').value;
    const fornecedorId = document.getElementById('fornecedorId').value;
    const compradorId = document.getElementById('compradorId').value;

    if (!fornecedorId) {
        alert('Selecione um fornecedor!');
        return;
    }

    if (!compradorId) {
        alert('Selecione um comprador!');
        return;
    }

    const itens = coletarItens();
    if (itens.length === 0) {
        alert('Adicione pelo menos um item ao pedido!');
        return;
    }

    const subtotal = itens.reduce((sum, item) => sum + item.preco_total, 0);
    const desconto = parseFloat(document.getElementById('desconto').value) || 0;
    const frete = parseFloat(document.getElementById('frete').value) || 0;
    const valorDesconto = subtotal * (desconto / 100);
    const valorFinal = subtotal - valorDesconto + frete;

    const fornecedor = fornecedores.find(f => f.id == fornecedorId);

    const pedido = {
        id: pedidoId || Date.now().toString(),
        numero_pedido: document.getElementById('numeroPedido').value,
        fornecedor_id: parseInt(fornecedorId),
        fornecedor_nome: fornecedor?.nome || fornecedor?.razao_social || 'N/A',
        comprador_id: parseInt(compradorId),
        data_pedido: document.getElementById('dataPedido').value,
        data_entrega_prevista: document.getElementById('dataEntregaPrevista').value || null,
        status: document.getElementById('statusPedido').value,
        condicoes_pagamento: document.getElementById('condicoesPagamento').value,
        observacoes: document.getElementById('observacoes').value,
        valor_total: subtotal,
        desconto: desconto,
        frete: frete,
        valor_final: valorFinal,
        itens: itens,
        created_at: pedidoId ? pedidos.find(p => p.id === pedidoId)?.created_at : new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    try {
        // Tentar salvar no backend
        const url = pedidoId ? `/api/compras/pedidos/${pedidoId}` : '/api/compras/pedidos';
        const response = await fetch(url, {
            method: pedidoId ? 'PUT' : 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(pedido)
        });

        if (response.ok) {
            const result = await response.json();
            pedido.id = result.id || pedido.id;

            // ATUALIZAR ARRAY LOCAL EM TEMPO REAL
            if (pedidoId) {
                const index = pedidos.findIndex(p => p.id == pedidoId);
                if (index !== -1) {
                    pedidos[index] = { ...pedidos[index], ...pedido };
                }
            } else {
                pedidos.unshift(pedido);
            }

            mostrarToast(pedidoId ? 'Pedido atualizado com sucesso!' : 'Pedido criado com sucesso!', 'success');
        } else {
            throw new Error('Erro na API');
        }
    } catch (error) {
        console.log('Salvando localmente...', error);
        // Salvar localmente como fallback
        if (pedidoId) {
            const index = pedidos.findIndex(p => p.id === pedidoId);
            if (index !== -1) {
                pedidos[index] = pedido;
            }
        } else {
            pedidos.unshift(pedido);
        }
        salvarPedidosLocal();
    }

    // Atualizar interface em tempo real
    renderizarTabelaPedidos();
    atualizarCards();
    fecharModalPedido();

    mostrarNotificacao(pedidoId ? 'Pedido atualizado com sucesso!' : 'Pedido criado com sucesso!', 'success');
}

function coletarItens() {
    const rows = document.querySelectorAll('#itensTableBody tr');
    const itens = [];

    rows.forEach(row => {
        const descricaoEl = row.querySelector('.item-descricao');
        if (!descricaoEl) return;

        const descricao = descricaoEl.value.trim();
        if (!descricao) return;

        const quantidade = parseFloat(row.querySelector('.item-quantidade')?.value) || 0;
        const preco = parseFloat(row.querySelector('.item-preco')?.value) || 0;
        const unidadeEl = row.querySelector('.item-unidade');
        const unidade = unidadeEl ? unidadeEl.value : 'UN';

        itens.push({
            descricao: descricao,
            quantidade: quantidade,
            unidade: unidade,
            preco_unitario: preco,
            preco_total: quantidade * preco
        });
    });

    return itens;
}

// ============ RENDERIZAÇÍO ============

function renderizarTabelaPedidos() {
    const tbody = document.getElementById('pedidosTableBody');

    let pedidosFiltrados = pedidos;

    // Filtro por status
    if (filtroAtual !== 'todos') {
        pedidosFiltrados = pedidos.filter(p => p.status === filtroAtual);
    }

    // Filtro por busca
    const searchTerm = document.getElementById('searchInput')?.value?.toLowerCase();
    if (searchTerm) {
        pedidosFiltrados = pedidosFiltrados.filter(p =>
            (p.numero_pedido && p.numero_pedido.toLowerCase().includes(searchTerm)) ||
            (p.fornecedor_nome && p.fornecedor_nome.toLowerCase().includes(searchTerm))
        );
    }

    // Atualizar info de paginação
    const paginationInfo = document.getElementById('paginationInfo');
    const totalPedidosCount = document.getElementById('totalPedidosCount');
    if (paginationInfo) paginationInfo.textContent = pedidosFiltrados.length;
    if (totalPedidosCount) totalPedidosCount.textContent = pedidos.length;

    if (pedidosFiltrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: #64748b;">
                    <i class="fas fa-shopping-cart" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>Nenhum pedido encontrado</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = pedidosFiltrados.map(pedido => {
        // Calcular valor exibido em tempo real
        const valorExibir = parseFloat(pedido.valor_final) || parseFloat(pedido.valor_total) || 0;

        return `
        <tr data-id="${pedido.id}">
            <td><input type="checkbox" class="pedido-checkbox" data-id="${pedido.id}" onchange="atualizarSelecao()"></td>
            <td>
                <strong>${pedido.numero_pedido || '-'}</strong>
                ${pedido.origem === 'PCP' ? '<span style="background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px; font-weight: 600;">PCP</span>' : ''}
            </td>
            <td>${pedido.fornecedor_nome || '-'}</td>
            <td>${formatarData(pedido.data_pedido)}</td>
            <td><strong>${formatarMoeda(valorExibir)}</strong></td>
            <td>${pedido.data_entrega_prevista ? formatarData(pedido.data_entrega_prevista) : '-'}</td>
            <td><span class="badge-status badge-${pedido.status}">${getStatusLabel(pedido.status)}</span></td>
            <td>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-secondary-small" onclick="visualizarPedido('${pedido.id}')" title="Visualizar">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-secondary-small" onclick="abrirModalEditarPedido('${pedido.id}')" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${pedido.status === 'pendente' ? `
                    <button class="btn-secondary-small" onclick="aprovarPedido('${pedido.id}')" title="Aprovar" style="color: #6366f1;">
                        <i class="fas fa-check"></i>
                    </button>
                    ` : ''}
                    <button class="btn-secondary-small" onclick="excluirPedido('${pedido.id}')" title="Excluir" style="color: #dc2626;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function atualizarCards() {
    const total = pedidos.length;
    const pendentes = pedidos.filter(p => p.status === 'pendente').length;
    const aprovados = pedidos.filter(p => p.status === 'aprovado').length;
    const recebidos = pedidos.filter(p => p.status === 'recebido').length;

    const mesAtual = new Date().getMonth();
    const valorMesAtual = pedidos
        .filter(p => new Date(p.data_pedido).getMonth() === mesAtual)
        .reduce((sum, p) => sum + (parseFloat(p.valor_final) || parseFloat(p.valor_total) || 0), 0);

    const totalPedidosEl = document.getElementById('totalPedidos');
    const pedidosPendentesEl = document.getElementById('pedidosPendentes');
    const pedidosAprovadosEl = document.getElementById('pedidosAprovados');
    const pedidosRecebidosEl = document.getElementById('pedidosRecebidos');

    if (totalPedidosEl) totalPedidosEl.textContent = total;
    if (pedidosPendentesEl) pedidosPendentesEl.textContent = pendentes;
    if (pedidosAprovadosEl) pedidosAprovadosEl.textContent = aprovados;
    if (pedidosRecebidosEl) pedidosRecebidosEl.textContent = recebidos;
}

// ============ AÇÕES ============

async function visualizarPedido(pedidoId) {
    let pedido = pedidos.find(p => p.id == pedidoId);

    // Se não tiver itens ou itens vazio, buscar da API
    if (!pedido || !pedido.itens || pedido.itens.length === 0) {
        try {
            const response = await fetch(`/api/compras/pedidos/${pedidoId}`, {
                headers: getAuthHeaders()
            });
            if (response.ok) {
                pedido = await response.json();
            }
        } catch (error) {
            console.error('Erro ao buscar pedido:', error);
        }
    }

    if (!pedido) {
        mostrarToast('Pedido não encontrado', 'error');
        return;
    }

    // Garantir que itens seja um array
    const itens = pedido.itens || [];

    const content = document.getElementById('detalhesContent');
    content.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Número do Pedido</p>
                <p style="font-weight: 600; font-size: 16px;">${pedido.numero_pedido || '-'}</p>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Status</p>
                <span class="badge-status badge-${pedido.status}">${getStatusLabel(pedido.status)}</span>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Fornecedor</p>
                <p style="font-weight: 600;">${pedido.fornecedor_nome || '-'}</p>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Data do Pedido</p>
                <p style="font-weight: 600;">${formatarData(pedido.data_pedido)}</p>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Entrega Prevista</p>
                <p style="font-weight: 600;">${pedido.data_entrega_prevista ? formatarData(pedido.data_entrega_prevista) : '-'}</p>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Condições de Pagamento</p>
                <p style="font-weight: 600;">${pedido.condicoes_pagamento || '-'}</p>
            </div>
        </div>

        <h4 style="margin: 24px 0 16px; font-size: 16px;"><i class="fas fa-list"></i> Itens do Pedido</h4>
        ${itens.length > 0 ? `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: #f9fafb; border-bottom: 2px solid #e5e7eb;">
                    <th style="padding: 12px; text-align: left;">Descrição</th>
                    <th style="padding: 12px; text-align: center;">Qtd</th>
                    <th style="padding: 12px; text-align: center;">Un.</th>
                    <th style="padding: 12px; text-align: right;">Preço Unit.</th>
                    <th style="padding: 12px; text-align: right;">Total</th>
                </tr>
            </thead>
            <tbody>
                ${itens.map(item => `
                    <tr style="border-bottom: 1px solid #e5e7eb;">
                        <td style="padding: 12px;">${item.descricao || item.material || '-'}</td>
                        <td style="padding: 12px; text-align: center;">${item.quantidade || 0}</td>
                        <td style="padding: 12px; text-align: center;">${item.unidade || 'UN'}</td>
                        <td style="padding: 12px; text-align: right;">${formatarMoeda(item.preco_unitario || 0)}</td>
                        <td style="padding: 12px; text-align: right; font-weight: 600;">${formatarMoeda(item.preco_total || item.subtotal || 0)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        ` : '<p style="text-align: center; color: #64748b; padding: 20px;">Nenhum item cadastrado</p>'}

        <div style="background: #f9fafb; padding: 20px; border-radius: 12px; margin-top: 20px;">
            <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                <span>Subtotal:</span>
                <span style="font-weight: 600;">${formatarMoeda(pedido.valor_total || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                <span>Desconto (${pedido.desconto || 0}%):</span>
                <span style="font-weight: 600;">- ${formatarMoeda((pedido.valor_total || 0) * (pedido.desconto || 0) / 100)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                <span>Frete:</span>
                <span style="font-weight: 600;">${formatarMoeda(pedido.frete || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-top: 2px solid #e5e7eb; margin-top: 8px; font-size: 18px; color: #38bdf8;">
                <span style="font-weight: 700;">Total:</span>
                <span style="font-weight: 700;">${formatarMoeda(pedido.valor_final || pedido.valor_total || 0)}</span>
            </div>
        </div>

        ${pedido.observacoes ? `
            <div style="margin-top: 20px;">
                <p style="color: #64748b; font-size: 13px; margin-bottom: 8px;">Observações</p>
                <p style="background: #f9fafb; padding: 12px; border-radius: 8px;">${pedido.observacoes}</p>
            </div>
        ` : ''}
    `;

    document.getElementById('modalVisualizarPedido').classList.add('active');
}

function fecharModalVisualizar() {
    document.getElementById('modalVisualizarPedido').classList.remove('active');
}

async function aprovarPedido(pedidoId) {
    if (!confirm('Deseja aprovar este pedido?')) return;

    try {
        const response = await fetch(`/api/compras/pedidos/${pedidoId}/aprovar`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (response.ok) {
            mostrarNotificacao('Pedido aprovado com sucesso!', 'success');
            await carregarPedidos();
            return;
        }
        const err = await response.json().catch(() => ({}));
        mostrarNotificacao(err.message || 'Erro ao aprovar pedido', 'error');
    } catch (error) {
        console.error('Erro ao aprovar pedido:', error);
        // Fallback local
        const pedido = pedidos.find(p => p.id === pedidoId);
        if (pedido) {
            pedido.status = 'aprovado';
            pedido.data_aprovacao = new Date().toISOString();
            salvarPedidosLocal();
            renderizarTabelaPedidos();
            atualizarCards();
            mostrarNotificacao('Pedido aprovado localmente', 'warning');
        }
    }
}

async function excluirPedido(pedidoId) {
    if (!confirm('Deseja realmente excluir este pedido?')) return;

    try {
        const response = await fetch(`/api/compras/pedidos/${pedidoId}/cancelar`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (response.ok) {
            mostrarNotificacao('Pedido cancelado com sucesso!', 'success');
            await carregarPedidos();
            return;
        }
    } catch (error) {
        console.error('Erro ao cancelar pedido:', error);
    }

    // Fallback local
    pedidos = pedidos.filter(p => p.id !== pedidoId);
    salvarPedidosLocal();
    renderizarTabelaPedidos();
    atualizarCards();
    mostrarNotificacao('Pedido removido localmente', 'warning');
}

function imprimirPedido() {
    window.print();
}

function exportarPedidos() {
    const csv = gerarCSV(pedidos);
    baixarArquivo(csv, 'pedidos-compra.csv', 'text/csv');
    mostrarNotificacao('Pedidos exportados com sucesso!', 'success');
}

// ============ FILTROS ============

function setFiltro(status, btn) {
    filtroAtual = status;

    // Atualizar botões
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active');
    });
    if (btn) btn.classList.add('active');

    renderizarTabelaPedidos();
}

function filtrarPorStatus(status, evt) {
    filtroAtual = status;

    // Atualizar botões
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const e = evt || window.event;
    if (e && e.target) {
        const btn = e.target.closest('.filter-btn');
        if (btn) btn.classList.add('active');
    }

    renderizarTabelaPedidos();
}

function filtrarPedidos() {
    renderizarTabelaPedidos();
}

// ============ MULTI-SELEÇÍO ============

function toggleSelectAll(checkbox) {
    const checkboxes = document.querySelectorAll('.pedido-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checkbox.checked;
    });
    atualizarSelecao();
}

function atualizarSelecao() {
    const checkboxes = document.querySelectorAll('.pedido-checkbox:checked');
    const totalSelected = checkboxes.length;

    // Atualizar estado do "Selecionar Todos"
    const selectAllCb = document.getElementById('selectAllPedidos');
    const allCheckboxes = document.querySelectorAll('.pedido-checkbox');
    if (selectAllCb) {
        selectAllCb.checked = totalSelected === allCheckboxes.length && totalSelected > 0;
        selectAllCb.indeterminate = totalSelected > 0 && totalSelected < allCheckboxes.length;
    }
}

function excluirSelecionados() {
    const checkboxes = document.querySelectorAll('.pedido-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.getAttribute('data-id'));

    if (ids.length === 0) {
        mostrarToast('Selecione pelo menos um pedido para excluir.', 'error');
        return;
    }

    if (!confirm(`Deseja realmente excluir ${ids.length} pedido(s)?`)) return;

    pedidos = pedidos.filter(p => !ids.includes(p.id));
    salvarPedidosLocal();
    renderizarTabelaPedidos();
    atualizarCards();

    // Desmarcar "Selecionar Todos"
    const selectAllCb = document.getElementById('selectAllPedidos');
    if (selectAllCb) selectAllCb.checked = false;

    mostrarToast(`${ids.length} pedido(s) excluído(s) com sucesso!`, 'success');
}

// ============ PAGINAÇÍO ============

let paginaAtual = 1;
const itensPorPagina = 10;

function paginaAnterior() {
    if (paginaAtual > 1) {
        paginaAtual--;
        renderizarTabelaPedidos();
        atualizarPaginacao();
    }
}

function proximaPagina() {
    const totalPaginas = Math.ceil(pedidos.length / itensPorPagina);
    if (paginaAtual < totalPaginas) {
        paginaAtual++;
        renderizarTabelaPedidos();
        atualizarPaginacao();
    }
}

function atualizarPaginacao() {
    const btn = document.getElementById('paginaAtualBtn');
    if (btn) btn.textContent = paginaAtual;
}

// ============ UTILITÁRIOS ============

function gerarNumeroPedido() {
    const ano = new Date().getFullYear();
    const maxNum = pedidos.length > 0
        ? Math.max(...pedidos.map(p => {
            const match = p.numero_pedido ? p.numero_pedido.match(/(\d+)$/) : null;
            return match ? parseInt(match[1]) : 0;
        }))
        : 0;
    const numero = (maxNum + 1).toString().padStart(4, '0');
    document.getElementById('numeroPedido').value = `PC-${ano}-${numero}`;
}

function preencherSelectFornecedores() {
    const select = document.getElementById('fornecedorId');
    select.innerHTML = '<option value="">Selecione...</option>';

    fornecedores.forEach(f => {
        const option = document.createElement('option');
        option.value = f.id;
        option.textContent = f.razao_social || f.nome;
        select.appendChild(option);
    });
}

function preencherSelectCompradores() {
    const select = document.getElementById('compradorId');
    if (!select) return;

    select.innerHTML = '<option value="">Selecione o comprador...</option>';

    // Buscar compradores da API
    fetch('/api/configuracoes/compradores')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.data) {
                data.data.forEach(c => {
                    const option = document.createElement('option');
                    option.value = c.id;
                    option.textContent = c.nome;
                    select.appendChild(option);
                });
            }
        })
        .catch(error => console.error('Erro ao carregar compradores:', error));
}

function carregarProdutosFornecedor() {
    // Implementar filtro de produtos por fornecedor se necessário
}

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(valor || 0);
}

function formatarData(data) {
    if (!data) return '-';
    return new Date(data).toLocaleDateString('pt-BR');
}

function getStatusLabel(status) {
    const labels = {
        'pendente': 'Pendente',
        'aprovado': 'Aprovado',
        'recebido': 'Recebido',
        'parcial': 'Parcial',
        'cancelado': 'Cancelado',
        'aguardando_cotacao': '⏳ Aguardando Cotação',
        'em_cotacao': '📋 Em Cotação',
        'cotado': 'Cotado'
    };
    return labels[status] || status;
}

function salvarPedidosLocal() {
    localStorage.setItem('compras_pedidos', JSON.stringify(pedidos));
}

function mostrarNotificacao(mensagem, tipo) {
    mostrarToast(mensagem, tipo);
}

function gerarCSV(data) {
    const headers = ['Número', 'Fornecedor', 'Data', 'Valor', 'Status'];
    const rows = data.map(p => [
        p.numero_pedido,
        p.fornecedor_nome,
        p.data_pedido,
        p.valor_final,
        p.status
    ]);

    return [headers, ...rows].map(row => row.join(';')).join('\n');
}

function baixarArquivo(conteudo, nomeArquivo, tipo) {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    a.click();
    URL.revokeObjectURL(url);
}

// ============ DADOS DE EXEMPLO ============

// Funções de exemplo removidas — todas as páginas usam dados reais da API
