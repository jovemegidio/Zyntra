// ============================================================================
// GESTÃO DE CENTROS DE CUSTO E CATEGORIAS - Sistema Financeiro Aluforce
// ============================================================================

let centrosCusto = [];
let categorias = [];
let tabAtual = 'centros-custo';

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    // Verificar sistema de autenticação
    if (typeof auth !== 'undefined') {
        // Proteger página - verificar permissão
        if (!auth.protegerPagina(['centros_custo.visualizar', 'categorias.visualizar'])) {
            return;
        }
    }
    
    inicializar();
});

async function inicializar() {
    await carregarCentrosCusto();
    await carregarCategorias();
    renderizarCentrosCusto();
    renderizarCategorias();
}

// ============================================================================
// TABS
// ============================================================================

function trocarTab(tab, evt) {
    tabAtual = tab;

    // Atualizar botões
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    if (evt && evt.target) {
        evt.target.classList.add('active');
    }

    // Mostrar/esconder conteúdo
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
}

// ============================================================================
// CENTROS DE CUSTO - CARREGAMENTO
// ============================================================================

async function carregarCentrosCusto() {
    try {
        centrosCusto = await buscarCentrosCusto();
    } catch (error) {
        console.error('Erro ao carregar centros de custo:', error);
        mostrarMensagem('Erro ao carregar centros de custo', 'error');
    }
}

async function buscarCentrosCusto() {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch('/api/financeiro/centros-custo', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Erro ao buscar centros de custo');
    return await response.json();
}

// ============================================================================
// CENTROS DE CUSTO - RENDERIZAÇÃO
// ============================================================================

function renderizarCentrosCusto() {
    const lista = document.getElementById('lista-centros-custo');

    if (centrosCusto.length === 0) {
        lista.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999; padding: 40px;">Nenhum centro de custo cadastrado</p>';
        return;
    }

    lista.innerHTML = centrosCusto.map(centro => criarCardCentroCusto(centro)).join('');
}

function criarCardCentroCusto(centro) {
    const saldoLiquido = centro.total_receitas - centro.total_despesas;

    return `
        <div class="card">
            <div class="card-header">
                <div>
                    <h3 class="card-title">${centro.nome}</h3>
                    ${centro.código ? `<small style="color: #6b7280;">${centro.código}</small>` : ''}
                </div>
                <div class="card-actions">
                    <button class="icon-btn edit" onclick="editarCentroCusto(${centro.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="icon-btn delete" onclick="excluirCentroCusto(${centro.id})" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>

            <div class="card-info">
                ${centro.descrição ? `<p style="color: #6b7280; font-size: 14px; margin: 0 0 12px 0;">${centro.descrição}</p>` : ''}
                
                <div class="info-row">
                    <span class="info-label">Responsável:</span>
                    <span class="info-value">${centro.responsavel || '-'}</span>
                </div>

                <div class="info-row">
                    <span class="info-label">Status:</span>
                    <span class="badge ${centro.status}">${centro.status === 'ativo' ? 'Ativo' : 'Inativo'}</span>
                </div>

                <div class="info-row">
                    <span class="info-label">Total Despesas:</span>
                    <span class="info-value" style="color: #ef4444;">R$ ${formatarMoeda(centro.total_despesas)}</span>
                </div>

                <div class="info-row">
                    <span class="info-label">Total Receitas:</span>
                    <span class="info-value" style="color: #10b981;">R$ ${formatarMoeda(centro.total_receitas)}</span>
                </div>

                <div class="info-row">
                    <span class="info-label">Saldo Líquido:</span>
                    <span class="info-value" style="color: ${saldoLiquido >= 0 ? '#10b981' : '#ef4444'};">R$ ${formatarMoeda(Math.abs(saldoLiquido))}</span>
                </div>

                ${centro.centro_pai_id ? `
                    <div class="info-row">
                        <span class="info-label">Vinculado a:</span>
                        <span class="info-value">${obterNomeCentro(centro.centro_pai_id)}</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

// ============================================================================
// CENTROS DE CUSTO - FORMULÁRIO
// ============================================================================

function abrirModalCentro(id = null) {
    document.getElementById('modal-centro-titulo').textContent = id ? 'Editar Centro de Custo' : 'Novo Centro de Custo';
    document.getElementById('form-centro-custo').reset();
    document.getElementById('centro-id').value = '';

    // Carregar lista de centros pai
    const selectPai = document.getElementById('centro-pai');
    selectPai.innerHTML = '<option value="">Nenhum (nível raiz)</option>';
    
    centrosCusto.filter(c => c.id !== id).forEach(centro => {
        selectPai.innerHTML += `<option value="${centro.id}">${centro.nome}</option>`;
    });

    if (id) {
        const centro = centrosCusto.find(c => c.id === id);
        if (centro) {
            document.getElementById('centro-id').value = centro.id;
            document.getElementById('centro-nome').value = centro.nome;
            document.getElementById('centro-código').value = centro.código || '';
            document.getElementById('centro-status').value = centro.status;
            document.getElementById('centro-pai').value = centro.centro_pai_id || '';
            document.getElementById('centro-responsavel').value = centro.responsavel || '';
            document.getElementById('centro-descrição').value = centro.descrição || '';
        }
    }

    mostrarModal('modal-centro-custo');
}

async function salvarCentroCusto(event) {
    event.preventDefault();

    const id = document.getElementById('centro-id').value;
    const dados = {
        nome: document.getElementById('centro-nome').value,
        código: document.getElementById('centro-código').value,
        status: document.getElementById('centro-status').value,
        centro_pai_id: document.getElementById('centro-pai').value || null,
        responsavel: document.getElementById('centro-responsavel').value,
        descrição: document.getElementById('centro-descrição').value
    };

    try {
        if (id) {
            await atualizarCentroCusto(id, dados);
            mostrarMensagem('Centro de custo atualizado com sucesso!', 'success');
        } else {
            await criarCentroCusto(dados);
            mostrarMensagem('Centro de custo criado com sucesso!', 'success');
        }

        fecharModal('modal-centro-custo');
        await carregarCentrosCusto();
        renderizarCentrosCusto();
    } catch (error) {
        console.error('Erro ao salvar:', error);
        mostrarMensagem('Erro ao salvar centro de custo', 'error');
    }
}

async function criarCentroCusto(dados) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch('/api/financeiro/centros-custo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(dados)
    });
    if (!response.ok) throw new Error('Erro ao criar centro de custo');
    return await response.json();
}

async function atualizarCentroCusto(id, dados) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch(`/api/financeiro/centros-custo/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(dados)
    });
    if (!response.ok) throw new Error('Erro ao atualizar centro de custo');
    return await response.json();
}

function editarCentroCusto(id) {
    abrirModalCentro(id);
}

async function excluirCentroCusto(id) {
    if (!confirm('Deseja realmente excluir este centro de custo?')) return;

    try {
        await deletarCentroCusto(id);
        await carregarCentrosCusto();
        renderizarCentrosCusto();
        mostrarMensagem('Centro de custo excluído com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir:', error);
        mostrarMensagem('Erro ao excluir centro de custo', 'error');
    }
}

async function deletarCentroCusto(id) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch(`/api/financeiro/centros-custo/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Erro ao excluir centro de custo');
    return await response.json();
}

function buscarCentros(termo) {
    const cards = document.querySelectorAll('#lista-centros-custo .card');
    termo = termo.toLowerCase();

    cards.forEach(card => {
        const texto = card.textContent.toLowerCase();
        card.style.display = texto.includes(termo) ? 'block' : 'none';
    });
}

// ============================================================================
// CATEGORIAS - CARREGAMENTO
// ============================================================================

async function carregarCategorias() {
    try {
        categorias = await buscarCategorias();
    } catch (error) {
        console.error('Erro ao carregar categorias:', error);
        mostrarMensagem('Erro ao carregar categorias', 'error');
    }
}

async function buscarCategorias() {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch('/api/financeiro/categorias', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Erro ao buscar categorias');
    return await response.json();
}

// ============================================================================
// CATEGORIAS - RENDERIZAÇÃO
// ============================================================================

function renderizarCategorias() {
    const lista = document.getElementById('lista-categorias');

    if (categorias.length === 0) {
        lista.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999; padding: 40px;">Nenhuma categoria cadastrada</p>';
        return;
    }

    lista.innerHTML = categorias.map(cat => criarCardCategoria(cat)).join('');
}

function criarCardCategoria(cat) {
    return `
        <div class="card" style="border-left-color: ${cat.cor};">
            <div class="card-header">
                <div>
                    <h3 class="card-title">
                        ${cat.icone ? `<i class="fas ${cat.icone}" style="color: ${cat.cor};"></i>` : ''}
                        ${cat.nome}
                    </h3>
                    <small style="color: #6b7280;">${cat.tipo === 'receita' ? 'Receita' : cat.tipo === 'despesa' ? 'Despesa' : 'Ambos'}</small>
                </div>
                <div class="card-actions">
                    <button class="icon-btn edit" onclick="editarCategoria(${cat.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="icon-btn delete" onclick="excluirCategoria(${cat.id})" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>

            <div class="card-info">
                ${cat.descrição ? `<p style="color: #6b7280; font-size: 14px; margin: 0 0 12px 0;">${cat.descrição}</p>` : ''}
                
                <div class="info-row">
                    <span class="info-label">Status:</span>
                    <span class="badge ${cat.status}">${cat.status === 'ativo' ? 'Ativo' : 'Inativo'}</span>
                </div>

                <div class="info-row">
                    <span class="info-label">Total de Movimentações:</span>
                    <span class="info-value">${cat.total_movimentacoes || 0}</span>
                </div>

                <div class="info-row">
                    <span class="info-label">Valor Total:</span>
                    <span class="info-value" style="color: ${cat.tipo === 'receita' ? '#10b981' : '#ef4444'};">R$ ${formatarMoeda(cat.valor_total)}</span>
                </div>

                ${cat.categoria_pai_id ? `
                    <div class="info-row">
                        <span class="info-label">Vinculado a:</span>
                        <span class="info-value">${obterNomeCategoria(cat.categoria_pai_id)}</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

// ============================================================================
// CATEGORIAS - FORMULÁRIO
// ============================================================================

function abrirModalCategoria(id = null) {
    document.getElementById('modal-categoria-titulo').textContent = id ? 'Editar Categoria' : 'Nova Categoria';
    document.getElementById('form-categoria').reset();
    document.getElementById('categoria-id').value = '';

    // Carregar lista de categorias pai
    const selectPai = document.getElementById('categoria-pai');
    selectPai.innerHTML = '<option value="">Nenhuma (nível raiz)</option>';
    
    categorias.filter(c => c.id !== id).forEach(cat => {
        selectPai.innerHTML += `<option value="${cat.id}">${cat.nome}</option>`;
    });

    if (id) {
        const cat = categorias.find(c => c.id === id);
        if (cat) {
            document.getElementById('categoria-id').value = cat.id;
            document.getElementById('categoria-nome').value = cat.nome;
            document.getElementById('categoria-tipo').value = cat.tipo;
            document.getElementById('categoria-status').value = cat.status;
            document.getElementById('categoria-pai').value = cat.categoria_pai_id || '';
            document.getElementById('categoria-cor').value = cat.cor;
            document.getElementById('categoria-icone').value = cat.icone || '';
            document.getElementById('categoria-descrição').value = cat.descrição || '';
        }
    }

    mostrarModal('modal-categoria');
}

async function salvarCategoria(event) {
    event.preventDefault();

    const id = document.getElementById('categoria-id').value;
    const dados = {
        nome: document.getElementById('categoria-nome').value,
        tipo: document.getElementById('categoria-tipo').value,
        status: document.getElementById('categoria-status').value,
        categoria_pai_id: document.getElementById('categoria-pai').value || null,
        cor: document.getElementById('categoria-cor').value,
        icone: document.getElementById('categoria-icone').value,
        descrição: document.getElementById('categoria-descrição').value
    };

    try {
        if (id) {
            await atualizarCategoria(id, dados);
            mostrarMensagem('Categoria atualizada com sucesso!', 'success');
        } else {
            await criarCategoria(dados);
            mostrarMensagem('Categoria criada com sucesso!', 'success');
        }

        fecharModal('modal-categoria');
        await carregarCategorias();
        renderizarCategorias();
    } catch (error) {
        console.error('Erro ao salvar:', error);
        mostrarMensagem('Erro ao salvar categoria', 'error');
    }
}

async function criarCategoria(dados) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch('/api/financeiro/categorias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(dados)
    });
    if (!response.ok) throw new Error('Erro ao criar categoria');
    return await response.json();
}

async function atualizarCategoria(id, dados) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch(`/api/financeiro/categorias/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(dados)
    });
    if (!response.ok) throw new Error('Erro ao atualizar categoria');
    return await response.json();
}

function editarCategoria(id) {
    abrirModalCategoria(id);
}

async function excluirCategoria(id) {
    if (!confirm('Deseja realmente excluir esta categoria?')) return;

    try {
        await deletarCategoria(id);
        await carregarCategorias();
        renderizarCategorias();
        mostrarMensagem('Categoria excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao excluir:', error);
        mostrarMensagem('Erro ao excluir categoria', 'error');
    }
}

async function deletarCategoria(id) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch(`/api/financeiro/categorias/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Erro ao excluir categoria');
    return await response.json();
}

function buscarCategorias(termo) {
    const cards = document.querySelectorAll('#lista-categorias .card');
    termo = termo.toLowerCase();

    cards.forEach(card => {
        const texto = card.textContent.toLowerCase();
        card.style.display = texto.includes(termo) ? 'block' : 'none';
    });
}

// ============================================================================
// UTILITÁRIOS
// ============================================================================

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(valor || 0);
}

function obterNomeCentro(id) {
    const centro = centrosCusto.find(c => c.id == id);
    return centro ? centro.nome : '-';
}

function obterNomeCategoria(id) {
    const cat = categorias.find(c => c.id == id);
    return cat ? cat.nome : '-';
}

function mostrarModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function fecharModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function mostrarMensagem(mensagem, tipo) {
    console.log(`[${tipo.toUpperCase()}] ${mensagem}`);
    
    if (tipo === 'error') {
        alert('❌ ' + mensagem);
    } else if (tipo === 'success') {
        alert('✅ ' + mensagem);
    }
}
