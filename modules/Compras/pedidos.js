/**
 * PEDIDOS DE COMPRA - Gerenciamento Completo
 * Sistema completo de criação, edição, aprovação e acompanhamento de pedidos
 */

let pedidos = [];
let fornecedores = [];
let produtos = [];
let itemCounter = 0;
let filtroAtual = 'todos';
let salvandoPedido = false;

// Escape HTML para prevenir XSS
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// Função para obter headers de autenticação
function getAuthHeaders() {
    return { 'Content-Type': 'application/json' };
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
    var icon = document.createElement('i');
    icon.className = 'fas fa-' + (icones[tipo] || 'info-circle');
    var span = document.createElement('span');
    span.textContent = mensagem;
    toast.appendChild(icon);
    toast.appendChild(span);
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
        // Carregar do backend — única fonte de dados (BE-002: sem fallback localStorage)
        const response = await fetch('/api/compras/pedidos', { credentials: 'include' });
        if (response.status === 401) {
            // Sessão expirada — auth-unified.js vai redirecionar; mostrar estado vazio
            pedidos = [];
            renderizarTabelaPedidos();
            atualizarCards();
            return;
        }
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
                status: (p.status || 'pendente').toLowerCase(),
                origem: p.origem || 'COMPRAS',
                itens: p.itens || []
            }));

            renderizarTabelaPedidos();
            atualizarCards();
            return;
        }
        throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        console.error('[Pedidos] Erro ao carregar pedidos da API:', error);
        // BE-002: Sem fallback localStorage — mostrar estado de erro claro ao usuário
        pedidos = [];
        const tbody = document.getElementById('pedidosTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align:center;padding:40px;color:#64748b;">
                        <i class="fas fa-exclamation-triangle" style="font-size:32px;margin-bottom:12px;display:block;color:#f59e0b;"></i>
                        <p style="font-weight:600;margin-bottom:8px;">Não foi possível carregar os pedidos</p>
                        <p style="font-size:13px;margin-bottom:16px;">Verifique sua conexão e tente novamente.</p>
                        <button class="btn btn-sm btn-secondary" onclick="carregarPedidos()"><i class="fas fa-sync-alt"></i> Tentar Novamente</button>
                    </td>
                </tr>`;
        }
        atualizarCards();
    }
}

async function carregarFornecedores() {
    try {
        const response = await fetch('/api/compras/fornecedores', { credentials: 'include' });
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

    // BE-002: Sem fallback localStorage para fornecedores
    fornecedores = [];
    preencherSelectFornecedores();
    preencherSelectCompradores();
}

async function carregarProdutos() {
    // Primary: Compras materiais API
    try {
        const response = await fetch('/api/compras/materiais?limit=1000', { credentials: 'include' });
        if (response.ok) {
            const data = await response.json();
            const raw = data.materiais || data.produtos || (Array.isArray(data) ? data : []);
            produtos = raw.map(m => ({ ...m, nome: m.descricao || m.nome || '', codigo: m.codigo_material || m.codigo || '' }));
            if (produtos.length > 0) return;
        }
    } catch (error) {
        console.log('Erro ao carregar materiais de compras:', error);
    }

    // Fallback: PCP materiais
    try {
        const response = await fetch('/api/pcp/materiais', { credentials: 'include' });
        if (response.ok) {
            const data = await response.json();
            produtos = Array.isArray(data) ? data : (data.materiais || []);
            if (produtos.length > 0) return;
        }
    } catch (error) {
        console.log('Erro ao carregar materiais PCP:', error);
    }

    // BE-002: Sem fallback localStorage para produtos
    produtos = [];
}

// ============ MODAL NOVO/EDITAR PEDIDO ============

function abrirModalNovoPedido() {
    document.getElementById('pedidoId').value = '';
    document.getElementById('formPedido').reset();
    document.getElementById('modalPedidoTitle').textContent = 'Novo Pedido de Compra';
    document.getElementById('dataPedido').valueAsDate = new Date();
    // Clear autocomplete fields
    const fornBusca = document.getElementById('fornecedorBusca');
    if (fornBusca) fornBusca.value = '';
    document.getElementById('fornecedorId').value = '';
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
            const response = await fetch(`/api/compras/pedidos/${pedidoId}`, { credentials: 'include' });
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
    // Set the fornecedor search input text
    const forn = fornecedores.find(f => f.id == pedido.fornecedor_id);
    const fornBusca = document.getElementById('fornecedorBusca');
    if (fornBusca) fornBusca.value = forn ? (forn.razao_social || forn.nome) : (pedido.fornecedor || pedido.fornecedor_nome || '');
    const compradorEl = document.getElementById('compradorId');
    if (compradorEl) compradorEl.value = pedido.comprador_id || '';
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

function filtrarProdutosItem(itemId, termo) {
    const dropdown = document.getElementById(`prod-dropdown-${itemId}`);
    if (!dropdown) return;
    if (!termo || termo.length < 1) { dropdown.style.display = 'none'; return; }
    const termoLower = termo.toLowerCase();
    const filtrados = produtos.filter(p => {
        const nome = (p.nome || p.descricao || p.nome_material || '').toLowerCase();
        const codigo = (p.codigo || p.cod || '').toLowerCase();
        return nome.includes(termoLower) || codigo.includes(termoLower);
    }).slice(0, 8);
    if (filtrados.length === 0) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = filtrados.map(p => {
        const nome = escapeHtml(p.nome || p.descricao || p.nome_material || '');
        const preco = p.preco_custo || p.preco || p.valor || 0;
        const codigo = escapeHtml(p.codigo || p.cod || '');
        // CV-001: carregar o id do material para vincular o item ao estoque (FK), não só texto
        const materialId = p.id || p.material_id || '';
        return `<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:0.82rem;display:flex;justify-content:space-between;align-items:center;"
                     onmouseover="this.style.background='#f0f9ff'" onmouseout="this.style.background='#fff'"
                     onclick="selecionarProdutoItem(${itemId}, '${nome.replace(/'/g,"\\'")}', ${preco}, '${materialId}')">
            <span>${codigo ? '<span style=\'color:#94a3b8;margin-right:6px;\'>' + codigo + '</span>' : ''}${nome}</span>
            ${preco > 0 ? '<span style="color:#22c55e;font-weight:600;">R$ ' + Number(preco).toFixed(2) + '</span>' : ''}
        </div>`;
    }).join('');
    dropdown.style.display = 'block';
}

function selecionarProdutoItem(itemId, nome, preco, materialId) {
    const row = document.getElementById(`item-${itemId}`);
    if (!row) return;
    const descEl = row.querySelector('.item-descricao');
    descEl.value = nome;
    // CV-001: guardar o material_id na própria linha para enviar no payload do pedido
    if (materialId) descEl.dataset.materialId = materialId;
    if (preco > 0) row.querySelector('.item-preco').value = Number(preco).toFixed(2);
    const dropdown = document.getElementById(`prod-dropdown-${itemId}`);
    if (dropdown) dropdown.style.display = 'none';
    calcularItemTotal(itemId);
    calcularTotais();
}

function adicionarItem(itemData = null) {
    itemCounter++;
    const tbody = document.getElementById('itensTableBody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.id = `item-${itemCounter}`;

    const unidadeAtual = itemData?.unidade || 'UN';
    const currentId = itemCounter;

    tr.innerHTML = `
        <td style="position:relative;">
            <input type="text" class="item-descricao"
                   value="${escapeHtml(itemData?.descricao || '')}"
                   placeholder="Digite para buscar produto/material..."
                   autocomplete="off"
                   style="width: 100%; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px;"
                   oninput="filtrarProdutosItem(${currentId}, this.value)"
                   onchange="calcularTotais()"
                   onfocus="filtrarProdutosItem(${currentId}, this.value)"
                   onblur="setTimeout(()=>{ const d=document.getElementById('prod-dropdown-${currentId}'); if(d)d.style.display='none'; }, 200)">
            <div id="prod-dropdown-${currentId}"
                 style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);max-height:180px;overflow-y:auto;z-index:9999;"></div>
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
    if (salvandoPedido) return;
    salvandoPedido = true;
    // SECURITY FIX: Disable button to prevent double-click
    const _btnSalvar = document.querySelector('[onclick="salvarPedido()"]');
    if (_btnSalvar) _btnSalvar.disabled = true;
    try {
    const pedidoId = document.getElementById('pedidoId').value;
    const fornecedorId = document.getElementById('fornecedorId').value;

    if (!fornecedorId) {
        mostrarToast('Selecione um fornecedor!', 'error');
        const selForn = document.getElementById('fornecedorId') || document.getElementById('fornecedorSelect');
        if (selForn) { selForn.style.borderColor = '#ef4444'; setTimeout(() => { selForn.style.borderColor = ''; }, 3000); }
        return;
    }

    const itens = coletarItens();
    if (itens.length === 0) {
        mostrarToast('Adicione pelo menos um item ao pedido!', 'error');
        return;
    }

    // BUG-005: Validar preço e quantidade de cada item
    for (let i = 0; i < itens.length; i++) {
        const item = itens[i];
        if (!item.preco_unitario || parseFloat(item.preco_unitario) <= 0) {
            alert('Preço unitário deve ser maior que zero.');
            return;
        }
        if (!item.quantidade || parseFloat(item.quantidade) <= 0) {
            alert('Quantidade deve ser maior que zero.');
            return;
        }
    }

    const subtotal = itens.reduce((sum, item) => sum + item.preco_total, 0);
    const desconto = parseFloat(document.getElementById('desconto').value) || 0;
    const frete = parseFloat(document.getElementById('frete').value) || 0;
    const valorFinal = subtotal - desconto + frete;

    // DB-002: Bloquear pedido com valor total zero ou negativo
    if (valorFinal <= 0) {
        mostrarToast('Valor total do pedido deve ser maior que zero.', 'error');
        return;
    }

    const fornecedor = fornecedores.find(f => f.id == fornecedorId);

    // DB-001: Nunca gerar ID no cliente (Date.now()) — usar apenas ID atribuído pelo servidor
    const pedido = {
        ...(pedidoId ? { id: pedidoId } : {}),
        numero_pedido: document.getElementById('numeroPedido').value,
        fornecedor_id: parseInt(fornecedorId),
        fornecedor_nome: fornecedor?.nome || fornecedor?.razao_social || 'N/A',
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
            credentials: 'include',
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
        // BE-002: Sem fallback localStorage — exibir erro claro
        console.error('[Pedidos] Erro ao salvar pedido na API:', error);
        mostrarToast('Erro ao salvar pedido. Verifique sua conexão e tente novamente.', 'error');
        return; // Não fechar o modal para o usuário não perder os dados digitados
    }

    // Atualizar interface em tempo real
    renderizarTabelaPedidos();
    atualizarCards();
    fecharModalPedido();
    } finally {
        salvandoPedido = false;
        if (_btnSalvar) _btnSalvar.disabled = false;
    }
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
        // CV-001: enviar o material_id vinculado (quando o item foi escolhido do catálogo)
        const materialId = descricaoEl.dataset.materialId || null;

        itens.push({
            descricao: descricao,
            material_id: materialId ? parseInt(materialId) : null,
            quantidade: quantidade,
            unidade: unidade,
            preco_unitario: preco,
            preco_total: quantidade * preco
        });
    });

    return itens;
}

// ============ RENDERIZAÇÃO ============

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
        // [FIX A11] Pedidos cancelados: linha esmaecida + texto tachado para distinção visual
        const isCancelado = pedido.status === 'cancelado';
        const rowStyle = isCancelado ? 'opacity:0.55;text-decoration:line-through;color:#94a3b8;' : '';
        const isAtrasado = !['recebido', 'cancelado'].includes(pedido.status)
            && !!pedido.data_entrega_prevista
            && new Date(pedido.data_entrega_prevista) < new Date(new Date().toDateString());

        return `
        <tr data-id="${pedido.id}" style="${rowStyle}">
            <td><input type="checkbox" class="pedido-checkbox" data-id="${pedido.id}" onchange="atualizarSelecao()" ${isCancelado ? 'disabled' : ''}></td>
            <td>
                <strong>${escapeHtml(pedido.numero_pedido) || '-'}</strong>
                ${pedido.origem === 'PCP' ? '<span style="background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px; font-weight: 600;">PCP</span>' : ''}
            </td>
            <td>${escapeHtml(pedido.fornecedor_nome) || '-'}</td>
            <td>${formatarData(pedido.data_pedido)}</td>
            <td><strong>${formatarMoeda(valorExibir)}</strong></td>
            <td>${pedido.data_entrega_prevista ? formatarData(pedido.data_entrega_prevista) : '-'}${isAtrasado ? ' <span class="badge-atrasado"><i class="fas fa-exclamation-circle"></i> Atrasado</span>' : ''}</td>
            <td><span class="badge-status badge-${pedido.status}">${getStatusLabel(pedido.status)}</span></td>
            <td class="table-actions">
                    <button class="btn-action view" onclick="visualizarPedido('${pedido.id}')" title="Visualizar">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${['pendente', 'rascunho', 'em_analise'].includes(pedido.status) ? `
                    <button class="btn-action edit" onclick="abrirModalEditarPedido('${pedido.id}')" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>` : ''}
                    ${pedido.status === 'pendente' ? `
                    <button class="btn-action success" onclick="aprovarPedido('${pedido.id}')" title="Aprovar">
                        <i class="fas fa-check"></i>
                    </button>
                    ` : ''}
                    <button class="btn-action delete" onclick="excluirPedido('${pedido.id}')" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
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

// [FIX C4] Guarda do último pedidoId solicitado para invalidar respostas obsoletas
let _visualizarPedidoSeq = 0;

async function visualizarPedido(pedidoId) {
    // [FIX C4] Limpa o modal antes de carregar para não exibir dados do pedido anterior
    const content = document.getElementById('detalhesContent');
    if (content) content.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;"><i class="fas fa-spinner fa-spin" style="font-size:24px;"></i><p style="margin-top:8px;">Carregando pedido...</p></div>';
    const modalVis = document.getElementById('modalVisualizarPedido');
    if (modalVis) modalVis.classList.add('active');

    const seq = ++_visualizarPedidoSeq;
    let pedido = pedidos.find(p => String(p.id) === String(pedidoId));

    // Sempre buscar da API para garantir dados completos (condicoes_pagamento, etc.)
    try {
        const response = await fetch(`/api/compras/pedidos/${encodeURIComponent(pedidoId)}`, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (response.ok) {
            const fresh = await response.json();
            // [FIX C4] Se o usuário clicou em outro pedido enquanto este request estava pendente,
            // descarta esta resposta para não mostrar dados do pedido errado.
            if (seq !== _visualizarPedidoSeq) return;
            // [FIX C4] Validar que o pedido retornado é mesmo o solicitado
            if (fresh && (String(fresh.id) === String(pedidoId) || String(fresh.numero_pedido) === String(pedidoId))) {
                pedido = fresh;
            } else {
                console.warn('[Compras] API retornou pedido diferente do solicitado:', fresh?.id, '!=', pedidoId);
            }
        } else {
            console.warn('[Compras] /api/compras/pedidos/' + pedidoId + ' status', response.status);
        }
    } catch (error) {
        console.error('Erro ao buscar pedido:', error);
    }

    if (seq !== _visualizarPedidoSeq) return;

    if (!pedido) {
        if (content) content.innerHTML = '<div style="text-align:center;padding:40px;color:#dc2626;"><i class="fas fa-exclamation-triangle" style="font-size:24px;"></i><p style="margin-top:8px;">Pedido não encontrado</p></div>';
        mostrarToast('Pedido não encontrado', 'error');
        return;
    }

    // Garantir que itens seja um array
    const itens = pedido.itens || [];

    // [FIX #013] 'content' já declarado no início da função (linha ~728) — reusar, não redeclarar
    content.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Número do Pedido</p>
                <p style="font-weight: 600; font-size: 16px;">${escapeHtml(pedido.numero_pedido) || '-'}</p>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Status</p>
                <span class="badge-status badge-${escapeHtml(pedido.status)}">${escapeHtml(getStatusLabel(pedido.status))}</span>
            </div>
            <div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 4px;">Fornecedor</p>
                <p style="font-weight: 600;">${escapeHtml(pedido.fornecedor_nome) || '-'}</p>
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
                        <td style="padding: 12px;">${escapeHtml(item.descricao || item.material) || '-'}</td>
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
                <span>Desconto:</span>
                <span style="font-weight: 600;">- ${formatarMoeda(pedido.desconto || 0)}</span>
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
                <p style="background: #f9fafb; padding: 12px; border-radius: 8px;">${escapeHtml(pedido.observacoes)}</p>
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

    // BUG-009: Avisar se data de entrega não estiver preenchida
    const pedido = pedidos.find(p => p.id === pedidoId || p.id == pedidoId);
    if (pedido && !pedido.data_entrega_prevista) {
        if (!confirm('Data de entrega prevista recomendada para rastreamento de SLA.\nDeseja prosseguir sem a data de entrega?')) return;
    }

    try {
        const response = await fetch(`/api/compras/pedidos/${pedidoId}/aprovar`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }
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
        // BE-002: Sem fallback localStorage — mostrar erro claro
        mostrarToast('Erro de conexão ao aprovar pedido. Tente novamente.', 'error');
    }
}

async function excluirPedido(pedidoId) {
    if (!confirm('Deseja realmente excluir este pedido?')) return;

    try {
        const response = await fetch(`/api/compras/pedidos/${pedidoId}`, {
            method: 'DELETE',
            credentials: 'include', headers: getAuthHeaders()
        });
        if (response.ok) {
            mostrarNotificacao('Pedido excluído com sucesso!', 'success');
            await carregarPedidos();
            return;
        }
        // Tratar erros HTTP (ex: 409 Conflict)
        const errData = await response.json().catch(() => ({}));
        mostrarToast(errData.message || errData.error || `Erro ao excluir pedido (${response.status})`, 'error');
        await carregarPedidos();
    } catch (error) {
        console.error('Erro ao excluir pedido:', error);
        mostrarToast('Erro de conexão ao excluir pedido', 'error');
    }
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

// ============ MULTI-SELEÇÃO ============

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

    const btnExcluir = document.getElementById('btn-excluir-selecionados');
    if (btnExcluir) btnExcluir.style.display = totalSelected > 0 ? '' : 'none';
}

async function excluirSelecionados() {
    const checkboxes = document.querySelectorAll('.pedido-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.getAttribute('data-id'));

    if (ids.length === 0) {
        mostrarToast('Selecione pelo menos um pedido para excluir.', 'error');
        return;
    }

    if (!confirm(`Deseja realmente excluir ${ids.length} pedido(s)?`)) return;

    let sucesso = 0;
    let erros = 0;

    for (const id of ids) {
        try {
            const response = await fetch(`/api/compras/pedidos/${id}`, {
                method: 'DELETE',
                credentials: 'include', headers: getAuthHeaders()
            });
            if (response.ok) {
                sucesso++;
            } else {
                erros++;
            }
        } catch (error) {
            console.error(`Erro ao excluir pedido ${id}:`, error);
            erros++;
        }
    }

    // Recarregar dados da API
    await carregarPedidos();

    // Desmarcar "Selecionar Todos"
    const selectAllCb = document.getElementById('selectAllPedidos');
    if (selectAllCb) selectAllCb.checked = false;

    if (erros === 0) {
        mostrarToast(`${sucesso} pedido(s) cancelado(s) com sucesso!`, 'success');
    } else {
        mostrarToast(`${sucesso} cancelado(s), ${erros} falha(s)`, erros > sucesso ? 'error' : 'warning');
    }
}

// ============ PAGINAÇÃO ============

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
    // Preencher select com options de fornecedores
    const select = document.getElementById('fornecedorId');
    if (select) {
        const valorAtual = select.value;
        select.innerHTML = '<option value="">Selecione o fornecedor...</option>';
        fornecedores.forEach(f => {
            const nome = escapeHtml(f.razao_social || f.nome || f.nome_fantasia || '');
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = nome;
            select.appendChild(opt);
        });
        if (valorAtual) select.value = valorAtual;
    }
    // Autocomplete input (se existir)
    const input = document.getElementById('fornecedorBusca');
    if (input) input.placeholder = `Digite para buscar (${fornecedores.length} fornecedores)...`;
}

function filtrarFornecedoresAutocomplete(termo) {
    const dropdown = document.getElementById('fornecedorDropdown');
    if (!dropdown) return;

    if (!termo || termo.length < 1) {
        dropdown.style.display = 'none';
        return;
    }

    const termoLower = termo.toLowerCase();
    const filtrados = fornecedores.filter(f => {
        const nome = (f.razao_social || f.nome || '').toLowerCase();
        const cnpj = (f.cnpj || '').toLowerCase();
        return nome.includes(termoLower) || cnpj.includes(termoLower);
    }).slice(0, 10);

    if (filtrados.length === 0) {
        dropdown.innerHTML = '<div style="padding:12px;color:#94a3b8;font-size:0.85rem;text-align:center;">Nenhum fornecedor encontrado</div>';
        dropdown.style.display = 'block';
        return;
    }

    dropdown.innerHTML = filtrados.map(f => `
        <div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:0.85rem;display:flex;align-items:center;gap:10px;"
             onmouseover="this.style.background='#f0f9ff'" onmouseout="this.style.background='#fff'"
             onclick="selecionarFornecedor(${f.id}, '${(f.razao_social || f.nome || '').replace(/'/g, "\\'")}')">
            <i class="fas fa-building" style="color:#6366f1;"></i>
            <div>
                <div style="font-weight:600;color:#1e293b;">${f.razao_social || f.nome}</div>
                ${f.cnpj ? '<div style="font-size:0.75rem;color:#94a3b8;">' + f.cnpj + '</div>' : ''}
            </div>
        </div>
    `).join('');
    dropdown.style.display = 'block';
}

function selecionarFornecedor(id, nome) {
    document.getElementById('fornecedorId').value = id;
    document.getElementById('fornecedorBusca').value = nome;
    document.getElementById('fornecedorDropdown').style.display = 'none';
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('fornecedorDropdown');
    const input = document.getElementById('fornecedorBusca');
    if (dropdown && input && !input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

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
        'enviado': 'Enviado',
        'recebido': 'Recebido',
        'parcial': 'Parcial',
        'cancelado': 'Cancelado',
        'aguardando_cotacao': '⏳ Aguardando Cotação',
        'em_cotacao': '📋 Em Cotação',
        'cotado': 'Cotado'
    };
    if (labels[status]) return labels[status];
    if (!status) return '-';
    // AUDIT #013: capitaliza qualquer status não mapeado (evita ex.: "enviado" minúsculo)
    return String(status).charAt(0).toUpperCase() + String(status).slice(1);
}

// BE-002: salvarPedidosLocal() removido — toda persistência é feita pela API do servidor
function salvarPedidosLocal() {
    console.warn('[Pedidos] salvarPedidosLocal() foi chamado mas está desabilitado (BE-002: sem localStorage)');
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
