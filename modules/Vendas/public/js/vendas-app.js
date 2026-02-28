/* ============================================
   ALUFORCE - MÓDULO VENDAS - JAVASCRIPT
   Versão: 2.0 | Data: 2025-12-18
   ============================================ */

// ==================== CONFIGURAÇÃO GLOBAL ====================
const API_BASE_URL = '/api/vendas';
let pedidoAtual = null;
let pedidos = [];
let empresas = [];

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Aluforce Vendas v2.0 - Inicializando...');
    
    initApp();
});

async function initApp() {
    try {
        // Verificar autenticação
        await verificarAuth();
        
        // Carregar dados iniciais
        await Promise.all([
            carregarDadosKanban(),
            carregarEmpresas()
        ]);
        
        // Inicializar componentes
        initDragAndDrop();
        initModais();
        initFiltros();
        initTabs();
        initEventListeners();
        
        console.log('✅ Sistema inicializado com sucesso');
    } catch (error) {
        console.error('❌ Erro na inicialização:', error);
        mostrarNotificacao('Erro ao carregar o sistema', 'error');
    }
}

// ==================== AUTENTICAÇÃO SSO (SINGLE SIGN-ON) ====================
// O usuário já está autenticado pelo sistema principal via cookie httpOnly
// Verificamos a autenticação chamando /api/me que valida o cookie automaticamente

let currentUser = null; // Armazena dados do usuário autenticado

async function verificarAuth() {
    try {
        // Verificar autenticação via cookie httpOnly (SSO com sistema principal)
        const response = await fetch('/api/me', { 
            credentials: 'include' // IMPORTANTE: envia cookies automaticamente
        });
        
        if (!response.ok) {
            throw new Error('Não autenticado');
        }
        
        const userData = await response.json();
        currentUser = userData;
        
        console.log('✅ SSO: Usuário autenticado via cookie:', userData.nome || userData.email);
        
        // Salvar dados localmente para uso no UI
        localStorage.setItem('userData', JSON.stringify(userData));
        
        atualizarUserUI(userData);
        return userData;
        
    } catch (error) {
        console.log('❌ SSO: Não autenticado - redirecionando para login principal...');
        
        // Limpar dados locais
        localStorage.removeItem('userData');
        localStorage.removeItem('vendas_token');
        localStorage.removeItem('vendas_user');
        
        // SSO: Preservar URL atual para retornar após login
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        
        // Redirecionar para login PRINCIPAL com returnTo
        window.location.href = `/login.html?returnTo=${returnTo}`;
        throw error;
    }
}

function atualizarUserUI(user) {
    const userAvatar = document.querySelector('.user-avatar');
    const userGreeting = document.querySelector('.user-greeting strong');
    
    if (userAvatar) {
        const img = userAvatar.querySelector('img');
        const span = userAvatar.querySelector('span');
        
        if (user.foto) {
            if (img) {
                img.src = user.foto;
                img.classList.add('visible');
            }
            if (span) span.style.display = 'none';
        } else if (span) {
            span.textContent = user.nome ? user.nome.charAt(0).toUpperCase() : 'U';
        }
    }
    
    if (userGreeting) {
        userGreeting.textContent = user.nome || 'Usuário';
    }
}

function logout() {
    // Limpar dados locais
    localStorage.removeItem('vendas_token');
    localStorage.removeItem('vendas_user');
    localStorage.removeItem('userData');
    
    // Fazer logout no sistema principal (invalida cookie)
    fetch('/api/logout', { 
        method: 'POST', 
        credentials: 'include' 
    }).finally(() => {
        // Redirecionar para login principal
        window.location.href = '/login.html';
    });
}

// ==================== API CALLS (COM SSO) ====================
async function apiRequest(endpoint, options = {}) {
    // Usar credentials: include para enviar cookie httpOnly automaticamente
    const config = {
        credentials: 'include', // SSO: envia cookie automaticamente
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    };
    
    // Remover header Authorization se existir (usamos cookie agora)
    delete config.headers['Authorization'];
    
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
        
        if (response.status === 401) {
            // Sessão expirada - redirecionar para login principal
            console.log('⚠️ Sessão expirada - redirecionando...');
            logout();
            throw new Error('Sessão expirada');
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error(`Erro na API ${endpoint}:`, error);
        throw error;
    }
}

// ==================== CARREGAR DADOS ====================
async function carregarDadosKanban() {
    try {
        mostrarLoading(true);
        
        // SSO: incluir credentials para enviar cookie automaticamente
        const response = await fetch('/api/vendas/kanban/pedidos', {
            credentials: 'include'
        });
        
        if (response.status === 401) {
            console.log('⚠️ Sessão expirada ao carregar Kanban');
            logout();
            return;
        }
        
        const data = await response.json();
        
        pedidos = Array.isArray(data) ? data : [];
        renderKanban(pedidos);
        
    } catch (error) {
        console.error('Erro ao carregar dados do Kanban:', error);
        mostrarNotificacao('Erro ao carregar pedidos', 'error');
    } finally {
        mostrarLoading(false);
    }
}

async function carregarEmpresas() {
    try {
        const data = await apiRequest('/empresas');
        empresas = Array.isArray(data) ? data : [];
        popularSelectEmpresas();
    } catch (error) {
        console.error('Erro ao carregar empresas:', error);
    }
}

function popularSelectEmpresas() {
    const selects = document.querySelectorAll('select[name="empresa_id"]');
    selects.forEach(select => {
        select.innerHTML = '<option value="">Selecione...</option>' + 
            empresas.map(e => `<option value="${e.id}">${e.nome}</option>`).join('');
    });
}

// ==================== KANBAN ====================
function renderKanban(pedidos) {
    const colunas = {
        'Orçamento': [],
        'Análise': [],
        'Aprovado': [],
        'Faturar': [],
        'Faturado': [],
        'Recibo': []
    };
    
    // Agrupar pedidos por etapa
    pedidos.forEach(pedido => {
        const etapa = pedido.etapa || 'Orçamento';
        if (colunas[etapa]) {
            colunas[etapa].push(pedido);
        } else {
            colunas['Orçamento'].push(pedido);
        }
    });
    
    // Renderizar cada coluna
    Object.keys(colunas).forEach(etapa => {
        renderColuna(etapa, colunas[etapa]);
    });
}

function renderColuna(etapa, pedidosColuna) {
    const coluna = document.querySelector(`[data-etapa="${etapa}"] .kanban-column-content`);
    if (!coluna) return;
    
    // Atualizar contador
    const contador = document.querySelector(`[data-etapa="${etapa}"] .column-count`);
    if (contador) {
        const total = pedidosColuna.reduce((sum, p) => sum + (parseFloat(p.valor_total) || 0), 0);
        contador.textContent = `${pedidosColuna.length} pedidos • ${formatarMoeda(total)}`;
    }
    
    // Limpar coluna
    coluna.innerHTML = '';
    
    // Renderizar cards
    if (pedidosColuna.length === 0) {
        coluna.innerHTML = `
            <div class="empty-column">
                <i class="fas fa-inbox"></i>
                <p>Nenhum pedido</p>
            </div>
        `;
        return;
    }
    
    pedidosColuna.forEach(pedido => {
        const card = criarCardPedido(pedido);
        coluna.appendChild(card);
    });
}

function criarCardPedido(pedido) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', pedido.id);
    
    const statusClass = getStatusClass(pedido);
    const statusText = getStatusText(pedido);
    
    card.innerHTML = `
        <div class="card-header">
            <span class="card-number">#${pedido.numero || pedido.id}</span>
            <button class="card-menu" onclick="event.stopPropagation(); abrirMenuCard(${pedido.id})">
                <i class="fas fa-ellipsis-v"></i>
            </button>
        </div>
        <div class="card-title">${pedido.cliente || 'Cliente não informado'}</div>
        <span class="card-status ${statusClass}">${statusText}</span>
        <div class="card-value">${formatarMoeda(pedido.valor_total || 0)}</div>
        <div class="card-meta">${pedido.itens_count || 0} ${(pedido.itens_count || 0) === 1 ? 'item' : 'itens'}</div>
        ${pedido.origem ? `
        <div class="card-origin">
            <i class="fas fa-check-circle"></i>
            ${pedido.origem}
        </div>
        ` : ''}
        ${pedido.nf_numero ? `
        <span class="card-badge nf">NF ${pedido.nf_numero}</span>
        ` : ''}
    `;
    
    // Event listener para abrir modal
    card.addEventListener('click', () => abrirModalPedido(pedido.id));
    
    return card;
}

function getStatusClass(pedido) {
    if (pedido.atrasado) return 'atrasado';
    if (pedido.etapa === 'Faturado') return 'faturado';
    return 'em-dia';
}

function getStatusText(pedido) {
    if (pedido.atrasado) return 'Atrasado';
    if (pedido.etapa === 'Faturado') return 'Faturado';
    return 'Em dia';
}

// ==================== DRAG AND DROP ====================
function initDragAndDrop() {
    // Event listeners para cards
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragend', handleDragEnd);
    
    // Event listeners para colunas
    const colunas = document.querySelectorAll('.kanban-column-content');
    colunas.forEach(coluna => {
        coluna.addEventListener('dragover', handleDragOver);
        coluna.addEventListener('dragleave', handleDragLeave);
        coluna.addEventListener('drop', handleDrop);
    });
}

function handleDragStart(e) {
    if (!e.target.classList.contains('kanban-card')) return;
    
    e.target.classList.add('dragging');
    e.dataTransfer.setData('text/plain', e.target.getAttribute('data-id'));
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    if (!e.target.classList.contains('kanban-card')) return;
    
    e.target.classList.remove('dragging');
    document.querySelectorAll('.kanban-column-content').forEach(col => {
        col.classList.remove('drag-over');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    const pedidoId = e.dataTransfer.getData('text/plain');
    const novaEtapa = e.currentTarget.closest('.kanban-column').getAttribute('data-etapa');
    
    if (!pedidoId || !novaEtapa) return;
    
    try {
        await apiRequest(`/pedidos/${pedidoId}`, {
            method: 'PUT',
            body: JSON.stringify({ etapa: novaEtapa })
        });
        
        // Atualizar no array local
        const pedido = pedidos.find(p => p.id == pedidoId);
        if (pedido) {
            pedido.etapa = novaEtapa;
            renderKanban(pedidos);
        }
        
        mostrarNotificacao(`Pedido movido para ${novaEtapa}`, 'success');
        
    } catch (error) {
        console.error('Erro ao mover pedido:', error);
        mostrarNotificacao('Erro ao mover pedido', 'error');
        renderKanban(pedidos);
    }
}

// ==================== MODAIS ====================
function initModais() {
    // Fechar modal ao clicar fora
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                fecharModal(modal.id);
            }
        });
    });
    
    // Fechar com ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modalAberto = document.querySelector('.modal-overlay.active');
            if (modalAberto) {
                fecharModal(modalAberto.id);
            }
        }
    });
}

function abrirModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function fecharModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// ==================== MODAL PEDIDO ====================
async function abrirModalPedido(pedidoId) {
    try {
        const pedido = await apiRequest(`/pedidos/${pedidoId}`);
        pedidoAtual = pedido;
        
        preencherFormPedido(pedido);
        await carregarItensPedido(pedidoId);
        
        abrirModal('modalEditarPedido');
        
    } catch (error) {
        console.error('Erro ao carregar pedido:', error);
        mostrarNotificacao('Erro ao carregar dados do pedido', 'error');
    }
}

function preencherFormPedido(pedido) {
    // Cliente
    const clienteInput = document.querySelector('#modalEditarPedido .cliente-nome-input');
    if (clienteInput) clienteInput.value = pedido.cliente || '';
    
    // Avatar
    const avatar = document.querySelector('#modalEditarPedido .cliente-avatar');
    if (avatar) {
        avatar.textContent = pedido.cliente ? pedido.cliente.charAt(0).toUpperCase() : 'C';
    }
    
    // Valores
    setInputValue('subtotal', formatarMoeda(pedido.subtotal || 0));
    setInputValue('ipi', formatarMoeda(pedido.ipi || 0));
    setInputValue('icms_st', formatarMoeda(pedido.icms_st || 0));
    setInputValue('frete', formatarMoeda(pedido.frete || 0));
    setInputValue('valor_total', formatarMoeda(pedido.valor_total || 0));
    
    // Info
    setInputValue('vendedor', pedido.vendedor || '');
    setInputValue('prazo_entrega', pedido.prazo_entrega || '');
    
    // Número do pedido no header
    const headerTitle = document.querySelector('#modalEditarPedido .modal-header-omie h2');
    if (headerTitle) {
        headerTitle.innerHTML = `<i class="fas fa-file-invoice"></i> Pedido #${pedido.numero || pedido.id}`;
    }
}

function setInputValue(name, value) {
    const input = document.querySelector(`#modalEditarPedido [name="${name}"]`);
    if (input) input.value = value;
}

async function carregarItensPedido(pedidoId) {
    try {
        const itens = await apiRequest(`/pedidos/${pedidoId}/itens`);
        renderizarTabelaItens(itens);
    } catch (error) {
        console.error('Erro ao carregar itens:', error);
    }
}

function renderizarTabelaItens(itens) {
    const tbody = document.querySelector('#modalEditarPedido .items-table tbody');
    if (!tbody) return;
    
    if (!itens || itens.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-text">
                    <i class="fas fa-box-open" style="font-size: 24px; color: #ddd; margin-bottom: 8px;"></i>
                    <p>Nenhum item adicionado</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = itens.map((item, index) => `
        <tr data-id="${item.id}">
            <td>${item.codigo || '-'}</td>
            <td>${item.descricao || '-'}</td>
            <td>${item.quantidade || 0}</td>
            <td>${item.unidade || 'UN'}</td>
            <td>${formatarMoeda(item.valor_unitario || 0)}</td>
            <td>${formatarMoeda(item.valor_total || 0)}</td>
            <td>
                <button class="btn-table-action success" onclick="editarItem(${item.id})">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-table-action danger" onclick="excluirItem(${item.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

async function salvarPedido() {
    if (!pedidoAtual) return;
    
    const form = document.querySelector('#modalEditarPedido');
    const dados = {
        cliente: form.querySelector('.cliente-nome-input')?.value || '',
        vendedor: form.querySelector('[name="vendedor"]')?.value || '',
        prazo_entrega: form.querySelector('[name="prazo_entrega"]')?.value || ''
    };
    
    try {
        await apiRequest(`/pedidos/${pedidoAtual.id}`, {
            method: 'PUT',
            body: JSON.stringify(dados)
        });
        
        mostrarNotificacao('Pedido salvo com sucesso!', 'success');
        fecharModal('modalEditarPedido');
        carregarDadosKanban();
        
    } catch (error) {
        console.error('Erro ao salvar pedido:', error);
        mostrarNotificacao('Erro ao salvar pedido', 'error');
    }
}

// ==================== MODAL NOVO ORÇAMENTO ====================
function abrirModalNovoOrcamento() {
    const modal = document.getElementById('modalNovoOrcamento');
    if (modal) {
        modal.querySelector('form')?.reset();
        abrirModal('modalNovoOrcamento');
    }
}

async function criarNovoOrcamento(e) {
    e.preventDefault();
    
    const form = e.target;
    const dados = {
        cliente: form.querySelector('[name="cliente"]')?.value || '',
        empresa_id: form.querySelector('[name="empresa_id"]')?.value || null,
        vendedor: form.querySelector('[name="vendedor"]')?.value || '',
        observacoes: form.querySelector('[name="observacoes"]')?.value || '',
        etapa: 'Orçamento'
    };
    
    try {
        await apiRequest('/pedidos', {
            method: 'POST',
            body: JSON.stringify(dados)
        });
        
        mostrarNotificacao('Orçamento criado com sucesso!', 'success');
        fecharModal('modalNovoOrcamento');
        carregarDadosKanban();
        
    } catch (error) {
        console.error('Erro ao criar orçamento:', error);
        mostrarNotificacao('Erro ao criar orçamento', 'error');
    }
}

// ==================== ITENS ====================
function abrirModalAdicionarItem() {
    const modal = document.getElementById('modalAdicionarItem');
    if (modal) {
        modal.querySelector('form')?.reset();
        abrirModal('modalAdicionarItem');
    }
}

async function salvarNovoItem(e) {
    e.preventDefault();
    
    if (!pedidoAtual) return;
    
    const form = e.target;
    const dados = {
        codigo: form.querySelector('[name="codigo"]')?.value || '',
        descricao: form.querySelector('[name="descricao"]')?.value || '',
        quantidade: parseFloat(form.querySelector('[name="quantidade"]')?.value) || 1,
        unidade: form.querySelector('[name="unidade"]')?.value || 'UN',
        valor_unitario: parseMoeda(form.querySelector('[name="valor_unitario"]')?.value) || 0
    };
    
    dados.valor_total = dados.quantidade * dados.valor_unitario;
    
    try {
        await apiRequest(`/pedidos/${pedidoAtual.id}/itens`, {
            method: 'POST',
            body: JSON.stringify(dados)
        });
        
        mostrarNotificacao('Item adicionado!', 'success');
        fecharModal('modalAdicionarItem');
        await carregarItensPedido(pedidoAtual.id);
        await atualizarTotaisPedido();
        
    } catch (error) {
        console.error('Erro ao adicionar item:', error);
        mostrarNotificacao('Erro ao adicionar item', 'error');
    }
}

async function excluirItem(itemId) {
    if (!confirm('Deseja excluir este item?')) return;
    
    try {
        await apiRequest(`/pedidos/${pedidoAtual.id}/itens/${itemId}`, {
            method: 'DELETE'
        });
        
        mostrarNotificacao('Item excluído!', 'success');
        await carregarItensPedido(pedidoAtual.id);
        await atualizarTotaisPedido();
        
    } catch (error) {
        console.error('Erro ao excluir item:', error);
        mostrarNotificacao('Erro ao excluir item', 'error');
    }
}

async function editarItem(itemId) {
    if (!pedidoAtual) return;
    
    try {
        const item = await apiRequest(`/pedidos/${pedidoAtual.id}/itens/${itemId}`);
        
        const modal = document.getElementById('modal-item-crud');
        if (modal) {
            modal.querySelector('[name="item-id"]').value = item.id;
            modal.querySelector('[name="codigo"]').value = item.codigo || '';
            modal.querySelector('[name="descricao"]').value = item.descricao || '';
            modal.querySelector('[name="quantidade"]').value = item.quantidade || 1;
            modal.querySelector('[name="unidade"]').value = item.unidade || 'UN';
            modal.querySelector('[name="valor_unitario"]').value = formatarMoeda(item.valor_unitario || 0);
            
            abrirModal('modal-item-crud');
        }
    } catch (error) {
        console.error('Erro ao carregar item:', error);
        mostrarNotificacao('Erro ao carregar item', 'error');
    }
}

async function salvarItemCRUD(e) {
    if (e) e.preventDefault();
    
    if (!pedidoAtual) return;
    
    const form = document.querySelector('#modal-item-crud');
    const itemId = form.querySelector('[name="item-id"]')?.value;
    
    const dados = {
        codigo: form.querySelector('[name="codigo"]')?.value || '',
        descricao: form.querySelector('[name="descricao"]')?.value || '',
        quantidade: parseFloat(form.querySelector('[name="quantidade"]')?.value) || 1,
        unidade: form.querySelector('[name="unidade"]')?.value || 'UN',
        valor_unitario: parseMoeda(form.querySelector('[name="valor_unitario"]')?.value) || 0
    };
    
    dados.valor_total = dados.quantidade * dados.valor_unitario;
    
    try {
        if (itemId) {
            await apiRequest(`/pedidos/${pedidoAtual.id}/itens/${itemId}`, {
                method: 'PUT',
                body: JSON.stringify(dados)
            });
            mostrarNotificacao('Item atualizado!', 'success');
        } else {
            await apiRequest(`/pedidos/${pedidoAtual.id}/itens`, {
                method: 'POST',
                body: JSON.stringify(dados)
            });
            mostrarNotificacao('Item adicionado!', 'success');
        }
        
        fecharModal('modal-item-crud');
        await carregarItensPedido(pedidoAtual.id);
        await atualizarTotaisPedido();
        
    } catch (error) {
        console.error('Erro ao salvar item:', error);
        mostrarNotificacao('Erro ao salvar item', 'error');
    }
}

async function atualizarTotaisPedido() {
    if (!pedidoAtual) return;
    
    try {
        const pedido = await apiRequest(`/pedidos/${pedidoAtual.id}`);
        pedidoAtual = pedido;
        
        setInputValue('subtotal', formatarMoeda(pedido.subtotal || 0));
        setInputValue('valor_total', formatarMoeda(pedido.valor_total || 0));
        
    } catch (error) {
        console.error('Erro ao atualizar totais:', error);
    }
}

// ==================== ANEXOS ====================
function abrirModalAnexos() {
    if (!pedidoAtual) return;
    abrirModal('modalAnexos');
    carregarAnexos();
}

async function carregarAnexos() {
    if (!pedidoAtual) return;
    
    try {
        const anexos = await apiRequest(`/pedidos/${pedidoAtual.id}/anexos`);
        renderizarAnexos(anexos);
    } catch (error) {
        console.error('Erro ao carregar anexos:', error);
    }
}

function renderizarAnexos(anexos) {
    const container = document.querySelector('#modalAnexos .anexos-lista');
    if (!container) return;
    
    if (!anexos || anexos.length === 0) {
        container.innerHTML = '<p class="empty-text">Nenhum anexo</p>';
        return;
    }
    
    container.innerHTML = anexos.map(anexo => `
        <div class="anexo-item">
            <i class="fas fa-file"></i>
            <span>${anexo.nome}</span>
            <button onclick="downloadAnexo(${anexo.id})">
                <i class="fas fa-download"></i>
            </button>
            <button onclick="excluirAnexo(${anexo.id})">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
}

async function uploadAnexo(input) {
    if (!pedidoAtual || !input.files.length) return;
    
    const formData = new FormData();
    formData.append('arquivo', input.files[0]);
    
    try {
        const token = localStorage.getItem('vendas_token');
        const response = await fetch(`${API_BASE_URL}/pedidos/${pedidoAtual.id}/anexos`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (!response.ok) throw new Error('Erro no upload');
        
        mostrarNotificacao('Anexo enviado!', 'success');
        carregarAnexos();
        
    } catch (error) {
        console.error('Erro no upload:', error);
        mostrarNotificacao('Erro ao enviar anexo', 'error');
    }
}

// ==================== HISTÓRICO ====================
function abrirModalHistorico() {
    if (!pedidoAtual) return;
    abrirModal('modalHistorico');
    carregarHistorico();
}

async function carregarHistorico() {
    if (!pedidoAtual) return;
    
    try {
        const historico = await apiRequest(`/pedidos/${pedidoAtual.id}/historico`);
        renderizarHistorico(historico);
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
    }
}

function renderizarHistorico(historico) {
    const container = document.querySelector('#modalHistorico .historico-timeline');
    if (!container) return;
    
    if (!historico || historico.length === 0) {
        container.innerHTML = '<p class="empty-text">Nenhum registro no histórico</p>';
        return;
    }
    
    container.innerHTML = historico.map(item => `
        <div class="historico-item">
            <div style="font-weight: 600; color: #333; margin-bottom: 4px;">
                ${item.acao}
            </div>
            <div style="font-size: 12px; color: #666;">
                ${item.usuario} • ${formatarData(item.data)}
            </div>
            ${item.detalhes ? `<p style="font-size: 12px; color: #888; margin-top: 8px;">${item.detalhes}</p>` : ''}
        </div>
    `).join('');
}

// ==================== FATURAR ====================
function abrirModalFaturar() {
    if (!pedidoAtual) return;
    
    // Preencher dados do modal
    const modal = document.getElementById('modalSefaz');
    if (modal) {
        modal.querySelector('.pedido-info').innerHTML = `
            <p><strong>Pedido:</strong> #${pedidoAtual.numero || pedidoAtual.id}</p>
            <p><strong>Cliente:</strong> ${pedidoAtual.cliente}</p>
            <p><strong>Valor:</strong> ${formatarMoeda(pedidoAtual.valor_total)}</p>
        `;
    }
    
    abrirModal('modalSefaz');
}

async function faturarPedido() {
    if (!pedidoAtual) return;
    
    if (!confirm('Confirma o faturamento deste pedido?')) return;
    
    try {
        await apiRequest(`/pedidos/${pedidoAtual.id}/faturar`, {
            method: 'POST'
        });
        
        mostrarNotificacao('Pedido faturado com sucesso!', 'success');
        fecharModal('modalSefaz');
        fecharModal('modalEditarPedido');
        carregarDadosKanban();
        
    } catch (error) {
        console.error('Erro ao faturar:', error);
        mostrarNotificacao('Erro ao faturar pedido', 'error');
    }
}

// ==================== TABS ====================
function initTabs() {
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            const modal = this.closest('.modal-content, .modal-content-omie');
            
            // Atualizar tabs
            modal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            // Atualizar conteúdo
            modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            modal.querySelector(`.tab-content[data-tab="${tabId}"]`)?.classList.add('active');
        });
    });
}

// ==================== FILTROS ====================
function initFiltros() {
    const searchInput = document.querySelector('.search-box input');
    if (searchInput) {
        let timeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => filtrarPedidos(e.target.value), 300);
        });
    }
    
    const selectEmpresa = document.querySelector('.filters-right select');
    if (selectEmpresa) {
        selectEmpresa.addEventListener('change', () => carregarDadosKanban());
    }
}

function filtrarPedidos(termo) {
    if (!termo) {
        renderKanban(pedidos);
        return;
    }
    
    termo = termo.toLowerCase();
    const filtrados = pedidos.filter(p => 
        (p.cliente && p.cliente.toLowerCase().includes(termo)) ||
        (p.numero && p.numero.toString().includes(termo)) ||
        (p.vendedor && p.vendedor.toLowerCase().includes(termo))
    );
    
    renderKanban(filtrados);
}

function abrirModalFiltros() {
    abrirModal('modalFiltros');
}

function aplicarFiltros() {
    // Implementar filtros avançados
    fecharModal('modalFiltros');
    carregarDadosKanban();
}

function limparFiltros() {
    document.querySelector('#modalFiltros form')?.reset();
}

// ==================== CONFIGURAR ETAPAS ====================
function abrirModalEtapas() {
    abrirModal('modalConfigurarEtapas');
}

async function salvarEtapas() {
    const form = document.getElementById('modalConfigurarEtapas');
    const etapas = [];
    
    form.querySelectorAll('.etapa-input').forEach((input, index) => {
        etapas.push({
            ordem: index + 1,
            nome: input.value,
            ativo: true
        });
    });
    
    try {
        await apiRequest('/configuracoes/etapas', {
            method: 'POST',
            body: JSON.stringify({ etapas })
        });
        
        mostrarNotificacao('Etapas salvas!', 'success');
        fecharModal('modalConfigurarEtapas');
        
    } catch (error) {
        console.error('Erro ao salvar etapas:', error);
        mostrarNotificacao('Erro ao salvar etapas', 'error');
    }
}

// ==================== EVENT LISTENERS ====================
function initEventListeners() {
    // Botão Novo Orçamento
    document.querySelectorAll('.btn-new-card').forEach(btn => {
        btn.addEventListener('click', abrirModalNovoOrcamento);
    });
    
    // Formulário novo orçamento
    const formNovoOrcamento = document.querySelector('#modalNovoOrcamento form');
    if (formNovoOrcamento) {
        formNovoOrcamento.addEventListener('submit', criarNovoOrcamento);
    }
    
    // Formulário adicionar item
    const formItem = document.querySelector('#modalAdicionarItem form');
    if (formItem) {
        formItem.addEventListener('submit', salvarNovoItem);
    }
    
    // Botão logout
    const btnLogout = document.querySelector('.sidebar-btn[title="Sair"]');
    if (btnLogout) {
        btnLogout.addEventListener('click', logout);
    }
}

// ==================== UTILITÁRIOS ====================
function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(valor || 0);
}

function parseMoeda(valor) {
    if (!valor) return 0;
    return parseFloat(valor.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
}

function formatarData(data) {
    if (!data) return '';
    const d = new Date(data);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function mostrarLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = show ? 'flex' : 'none';
    }
}

function mostrarNotificacao(mensagem, tipo = 'info') {
    // Remover notificações anteriores
    document.querySelectorAll('.notificacao').forEach(n => n.remove());
    
    const notificacao = document.createElement('div');
    notificacao.className = `notificacao notificacao-${tipo}`;
    notificacao.innerHTML = `
        <i class="fas ${tipo === 'success' ? 'fa-check-circle' : tipo === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
        <span>${mensagem}</span>
    `;
    
    // Estilos inline para a notificação
    Object.assign(notificacao.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '12px 20px',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '13px',
        fontWeight: '500',
        zIndex: '9999',
        animation: 'slideIn 0.3s ease',
        background: tipo === 'success' ? '#22c55e' : tipo === 'error' ? '#ef4444' : '#3b82f6',
        color: 'white',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
    });
    
    document.body.appendChild(notificacao);
    
    // Auto-remover
    setTimeout(() => {
        notificacao.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notificacao.remove(), 300);
    }, 3000);
}

// ==================== MENU DO CARD ====================
function abrirMenuCard(pedidoId) {
    // Implementar menu contextual
    console.log('Menu do pedido:', pedidoId);
}

// ==================== EXCLUIR PEDIDO ====================
async function excluirPedido() {
    if (!pedidoAtual) return;
    
    if (!confirm('Tem certeza que deseja excluir este pedido? Esta ação não pode ser desfeita.')) return;
    
    try {
        await apiRequest(`/pedidos/${pedidoAtual.id}`, {
            method: 'DELETE'
        });
        
        mostrarNotificacao('Pedido excluído!', 'success');
        fecharModal('modalEditarPedido');
        carregarDadosKanban();
        
    } catch (error) {
        console.error('Erro ao excluir pedido:', error);
        mostrarNotificacao('Erro ao excluir pedido', 'error');
    }
}

// ==================== IMPRIMIR ====================
function imprimirPedido() {
    if (!pedidoAtual) return;
    window.open(`/api/vendas/pedidos/${pedidoAtual.id}/pdf`, '_blank');
}

// ==================== DUPLICAR ====================
async function duplicarPedido() {
    if (!pedidoAtual) return;
    
    try {
        const resultado = await apiRequest(`/pedidos/${pedidoAtual.id}/duplicar`, {
            method: 'POST'
        });
        
        mostrarNotificacao('Pedido duplicado!', 'success');
        fecharModal('modalEditarPedido');
        carregarDadosKanban();
        
        // Abrir o novo pedido
        if (resultado && resultado.id) {
            setTimeout(() => abrirModalPedido(resultado.id), 500);
        }
        
    } catch (error) {
        console.error('Erro ao duplicar pedido:', error);
        mostrarNotificacao('Erro ao duplicar pedido', 'error');
    }
}

// ==================== FUNÇÕES DE FECHAR MODAIS ESPECÍFICOS ====================
function fecharModalHistorico() { fecharModal('modal-historico'); }
function fecharModalFaturar() { fecharModal('modal-faturar-todos'); }
function fecharModalSefaz() { fecharModal('modal-sefaz'); }
function fecharModalFiltros() { fecharModal('modal-filtros'); }
function fecharModalEtapas() { fecharModal('modal-configurar-etapas'); }
function fecharModalAnexos() { fecharModal('modal-anexos'); }
function fecharModalNovoOrcamento() { fecharModal('modal-novo-orcamento'); }
function fecharModalAdicionarItem() { fecharModal('modal-adicionar-item'); }
function fecharModalItemCRUD() { fecharModal('modal-item-crud'); }
function fecharModalPedido() { fecharModal('modal-editar-pedido'); }

function abrirModalNovoItem() { abrirModalAdicionarItem(); }
function abrirModalFiltrosKanban() { abrirModalFiltros(); }
function abrirModalConfigurarEtapas() { abrirModalEtapas(); }
function confirmarEtapas() { salvarEtapas(); }
function confirmarFaturarTodos() { faturarPedido(); }

// ==================== EXPORTAR ====================
window.vendas = {
    carregarDadosKanban,
    abrirModalPedido,
    abrirModalNovoOrcamento,
    abrirModalAdicionarItem,
    abrirModalAnexos,
    abrirModalHistorico,
    abrirModalFaturar,
    abrirModalFiltros,
    abrirModalEtapas,
    fecharModal,
    salvarPedido,
    excluirPedido,
    imprimirPedido,
    duplicarPedido,
    faturarPedido,
    aplicarFiltros,
    limparFiltros,
    salvarEtapas,
    logout
};

// Expor funções globalmente para os onclick inline
window.fecharModalHistorico = fecharModalHistorico;
window.fecharModalFaturar = fecharModalFaturar;
window.fecharModalSefaz = fecharModalSefaz;
window.fecharModalFiltros = fecharModalFiltros;
window.fecharModalEtapas = fecharModalEtapas;
window.fecharModalAnexos = fecharModalAnexos;
window.fecharModalNovoOrcamento = fecharModalNovoOrcamento;
window.fecharModalAdicionarItem = fecharModalAdicionarItem;
window.fecharModalItemCRUD = fecharModalItemCRUD;
window.fecharModalPedido = fecharModalPedido;
window.abrirModalNovoItem = abrirModalNovoItem;
window.abrirModalFiltrosKanban = abrirModalFiltrosKanban;
window.abrirModalConfigurarEtapas = abrirModalConfigurarEtapas;
window.abrirModalNovoOrcamento = abrirModalNovoOrcamento;
window.abrirModalAnexos = abrirModalAnexos;
window.abrirModalHistorico = abrirModalHistorico;
window.abrirModalFaturar = abrirModalFaturar;
window.confirmarEtapas = confirmarEtapas;
window.confirmarFaturarTodos = confirmarFaturarTodos;
window.salvarNovoItem = salvarNovoItem;
window.salvarNovoPedido = criarNovoOrcamento;
window.editarItem = editarItem;
window.excluirItem = excluirItem;
window.salvarPedido = salvarPedido;
window.excluirPedido = excluirPedido;
window.imprimirPedido = imprimirPedido;
window.duplicarPedido = duplicarPedido;
window.aplicarFiltros = aplicarFiltros;
window.limparFiltros = limparFiltros;
window.salvarItemCRUD = salvarItemCRUD;
window.logout = logout;

console.log('📦 Aluforce Vendas App carregado');
