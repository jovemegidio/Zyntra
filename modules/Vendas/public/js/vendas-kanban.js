/**
 * VENDAS KANBAN - Sistema Omie Style
 * Gestão visual de orçamentos e pedidos
 */

// Variável global do usuário
let usuarioLogado = null;

// Fallback para VendasAuth caso não exista
const VendasAuth = window.VendasAuth || {
    isAdmin: (user) => user && (user.role === 'admin' || user.cargo === 'admin'),
    obterPrimeiroNome: (nome) => nome ? nome.split(' ')[0] : '',
    podeMoverPedido: () => true, // Por padrão permite mover
    inicializarAuth: async () => null
};

// Dados seed (usado na primeira carga ou para reset local)
const pedidosSeed = [
    // ORÇAMENTOS
    {
        id: 9,
        numero: 'Orçamento Nº 9',
        cliente: 'TIAO MATERIAIS PARA CONSTRUCAO LTDA',
        valor: 3700.0,
        status: 'orcamento',
        faturamento: 'Faturamento atrasado',
        origem: 'Omie',
        tipo: 'a vista',
        vendedor: 'Antonio',
        data: '2025-12-01'
    },
    {
        id: 8,
        numero: 'Orçamento Nº 8',
        cliente: 'COMERCIAL ELETRICA FABRO LTDA',
        valor: 13084.67,
        status: 'orcamento',
        faturamento: 'Faturamento atrasado',
        origem: 'Omie',
        tipo: 'em 3x',
        vendedor: 'Maria',
        data: '2025-12-02'
    },
    {
        id: 5,
        numero: 'Orçamento Nº 5',
        cliente: 'AFS ELETRICA',
        valor: 21615.0,
        status: 'orcamento',
        faturamento: 'Faturamento atrasado',
        origem: 'Omie',
        tipo: 'em 4x',
        vendedor: 'João',
        data: '2025-11-28'
    },
    {
        id: 10,
        numero: 'Orçamento Nº 10',
        cliente: 'COMERCIAL SILVA LTDA',
        valor: 5400.00,
        status: 'orcamento',
        faturamento: 'Aguardando aprovação',
        origem: 'Omie',
        tipo: 'a vista',
        vendedor: 'Antonio',
        data: '2025-12-04'
    },

    // ANÁLISE DE CRÉDITO
    {
        id: 1357,
        numero: 'Orçamento Nº 1357',
        cliente: 'GASPARZINHO DISTRIBUIDORA DE MATERIAIS ELETRICOS LTDA',
        valor: 7500.00,
        status: 'analise-credito',
        faturamento: 'Previsto para hoje',
        origem: 'Omie',
        transportadora: 'ACEVILLE TRANSPORTES LTDA',
        tipo: 'em 3x',
        vendedor: 'Maria',
        data: '2025-12-03'
    },
    {
        id: 1356,
        numero: 'Orçamento Nº 1356',
        cliente: 'CASA DAS CONEXOES',
        valor: 5970.00,
        status: 'analise-credito',
        faturamento: 'Aguardando faturamento',
        origem: 'Omie',
        tipo: 'em 4x',
        vendedor: 'João',
        data: '2025-12-04'
    },
    {
        id: 1345,
        numero: 'Orçamento Nº 1345',
        cliente: 'KCOAL TURISMO E LOCACAO',
        valor: 46410.00,
        status: 'analise-credito',
        faturamento: 'Aguardando faturamento',
        origem: 'Omie',
        tipo: 'em 4x',
        vendedor: 'Antonio',
        data: '2025-12-05'
    },

    // PEDIDO APROVADO
    {
        id: 1177,
        numero: 'Orçamento Nº 1177',
        cliente: 'COMERCIAL MARTINS LTDA',
        valor: 26092.00,
        status: 'pedido-aprovado',
        faturamento: 'Faturamento atrasado',
        origem: 'Omie',
        transportadora: 'TRANSVALENI TRANSPORTES LTDA',
        tipo: 'em 3x',
        vendedor: 'Antonio',
        data: '2025-12-02'
    },
    {
        id: 1185,
        numero: 'Orçamento Nº 1185',
        cliente: 'ELECTRASUL DISTRIBUIDORA DE MATERIAIS ELETRICOS',
        valor: 37910.00,
        status: 'pedido-aprovado',
        faturamento: 'Faturamento atrasado',
        origem: 'Omie',
        tipo: 'em 5x',
        vendedor: 'Maria',
        data: '2025-12-01'
    },
    {
        id: 1273,
        numero: 'Orçamento Nº 1273',
        cliente: 'COMERCIAL MARTINS LTDA',
        valor: 12450.00,
        status: 'pedido-aprovado',
        faturamento: 'Faturamento atrasado',
        origem: 'Omie',
        tipo: 'em 2x',
        vendedor: 'João',
        data: '2025-12-03'
    },

    // FATURAR
    {
        id: 3,
        numero: 'Orçamento Nº 3',
        cliente: 'ILUMINACAO PAULISTANA SPE S/A',
        valor: 529.00,
        status: 'faturar',
        faturamento: 'Faturamento atrasado',
        origem: 'Omie',
        vencimento: 'p/ 11/06 Qua',
        tipo: 'a vista',
        vendedor: 'Antonio',
        data: '2025-12-06'
    },
    {
        id: 56,
        numero: 'Orçamento Nº 56',
        cliente: 'BELLA ELETRICA E HIDRAULICA LTDA',
        valor: 7224.00,
        status: 'faturar',
        faturamento: 'Faturamento atrasado',
        origem: 'Omie',
        tipo: 'a vista',
        vendedor: 'Maria',
        data: '2025-12-06'
    },
    {
        id: 151,
        numero: 'Orçamento Nº 151',
        cliente: 'JAF PAINEIS',
        valor: 7991.71,
        status: 'faturar',
        faturamento: 'Faturamento atrasado',
        origem: 'Omie',
        tipo: 'em 3x',
        vendedor: 'João',
        data: '2025-12-07'
    },

    // FATURADO
    {
        id: 7513,
        numero: 'Orçamento Nº 751/3',
        cliente: 'ILUMINACAO PAULISTANA SPE S/A',
        valor: 12781.80,
        status: 'faturado',
        faturamento: 'Faturado',
        origem: 'Omie',
        notaFiscal: '00000237',
        manifestacao: 'Está ciente da operação',
        vencimento: 'p/ 08/01/26 Qui',
        tipo: 'parcelado',
        vendedor: 'Antonio',
        data: '2025-12-05'
    },
    {
        id: 4739,
        numero: 'Orçamento Nº 473/9',
        cliente: 'ILUMINACAO PAULISTANA SPE S/A',
        valor: 49863.60,
        status: 'faturado',
        faturamento: 'Faturado',
        origem: 'Omie',
        notaFiscal: '00000236',
        manifestacao: 'Está ciente da operação',
        vencimento: 'p/ 08/01/26 Qui',
        tipo: 'parcelado',
        vendedor: 'Maria',
        data: '2025-12-02'
    },
    {
        id: 1137,
        numero: 'Orçamento Nº 1137',
        cliente: 'COMERCIAL ELETRICA LTDA',
        valor: 8540.00,
        status: 'faturado',
        faturamento: 'Faturado',
        origem: 'Omie',
        notaFiscal: '00000235',
        tipo: 'em 4x',
        vendedor: 'João',
        data: '2025-12-01'
    }
];

let pedidos = [];

// Formatação de moeda
function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(valor);
}

// Mapas de exibição por status
const statusConfig = {
    orcamento: { label: 'Orç', classe: 'status-orcamento' },
    'analise-credito': { label: 'Crédito', classe: 'status-analise' },
    'pedido-aprovado': { label: 'Aprovado', classe: 'status-aprovado' },
    faturar: { label: 'Faturar', classe: 'status-faturar' },
    faturado: { label: 'Faturado', classe: 'status-faturado' },
    recibo: { label: 'Recibo', classe: 'status-recibo' }
};

// Data em dd/MM/yyyy
function formatarDataCurta(dataISO) {
    if (!dataISO) return '';
    const partes = dataISO.split('-');
    if (partes.length !== 3) return dataISO;
    const [ano, mes, dia] = partes;
    return `${dia}/${mes}/${ano}`;
}

// Bootstrap de dados via API
async function carregarPedidosDaAPI() {
    try {
        const resp = await fetch('/api/vendas/kanban/pedidos', {
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!resp.ok) throw new Error(`Erro ${resp.status}`);
        const data = await resp.json();
        let todosPedidos = (Array.isArray(data) && data.length ? data : [...pedidosSeed]).map(p => ({
            ...p,
            vendedor: p.vendedor_nome || p.vendedor || '',
            data: p.data_criacao ? p.data_criacao.slice(0, 10) : p.data || '',
            faturamento: p.faturamento || p.observacoes || '',
            // Priorizar valor_total (soma dos itens) sobre valor do pedido
            valor: p.valor_total || p.valor || 0
        }));
        
        // Filtrar pedidos por vendedor se não for admin
        if (usuarioLogado && !VendasAuth.isAdmin(usuarioLogado)) {
            const nomeVendedor = (usuarioLogado.nome ? usuarioLogado.nome.split(' ')[0] : '').toLowerCase();
            pedidos = todosPedidos.filter(p => {
                const vendedorPedido = (p.vendedor || '').toLowerCase();
                return vendedorPedido.includes(nomeVendedor) || 
                       nomeVendedor.includes(vendedorPedido.split(' ')[0]);
            });
        } else {
            pedidos = todosPedidos;
        }
    } catch (err) {
        console.error('Falha ao carregar pedidos do kanban', err);
        pedidos = [...pedidosSeed];
        mostrarNotificacao('Não foi possível carregar pedidos do servidor. Exibindo dados locais.', 'error');
    }
    renderizarKanban();
}

// Formatar valor estilo Omie (ex: "3.700,00")
function formatarValorOmie(valor) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(valor);
}

// Determinar classe do status de faturamento
function getFaturamentoClasse(faturamento) {
    if (!faturamento) return '';
    const lower = faturamento.toLowerCase();
    if (lower.includes('atrasado')) return 'atrasado';
    if (lower.includes('previsto')) return 'previsto';
    if (lower.includes('aguardando')) return 'aguardando';
    if (lower.includes('faturado')) return 'faturado-ok';
    return '';
}

// Criar HTML do card - Estilo Omie
function criarCardHTML(pedido) {
    // Linha do status de faturamento (vermelho se atrasado)
    const faturamentoClasse = getFaturamentoClasse(pedido.faturamento);
    const faturamentoHTML = pedido.faturamento 
        ? `<div class="card-faturamento ${faturamentoClasse}">${pedido.faturamento}</div>`
        : '';

    // Valor com cifrão e tipo de pagamento
    const valorFormatado = formatarValorOmie(pedido.valor);
    const tipoHTML = pedido.tipo ? ` ${pedido.tipo}` : '';

    // Vencimento (ex: "p/ 11/06 Qua")
    const vencimentoHTML = pedido.vencimento 
        ? `<div class="card-vencimento">$ ${valorFormatado} ${pedido.vencimento}</div>`
        : '';

    // Transportadora
    const transportadoraHTML = pedido.transportadora
        ? `<div class="card-transportadora">Transportadora: ${pedido.transportadora}</div>`
        : '';

    // Nota Fiscal (para faturados)
    const notaFiscalHTML = pedido.notaFiscal
        ? `<div class="card-nf">Nota Fiscal: ${pedido.notaFiscal}</div>`
        : '';

    // Manifestação do cliente
    const manifestacaoHTML = pedido.manifestacao
        ? `<div class="card-manifestacao"><i class="fas fa-clipboard-check"></i> Manifestação do cliente: "${pedido.manifestacao}"</div>`
        : '';

    // Origem (Omie)
    const origemHTML = pedido.origem 
        ? `<div class="card-origem">Origem: ${pedido.origem}</div>`
        : '';

    return `
        <div class="kanban-card" draggable="true" data-id="${pedido.id}" data-status="${pedido.status}">
            <div class="card-top">
                <div class="card-meta">
                    <span class="card-numero">${pedido.numero}</span>
                </div>
                <button class="card-menu-btn" title="Mais ações">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
            </div>
            <div class="card-cliente">${pedido.cliente}</div>
            ${faturamentoHTML}
            ${pedido.vencimento ? vencimentoHTML : `<div class="card-valor-row"><span class="card-valor-cifrao">$</span><span class="card-valor">${valorFormatado}</span><span class="card-tipo">${tipoHTML}</span></div>`}
            ${transportadoraHTML}
            ${notaFiscalHTML}
            ${manifestacaoHTML}
            ${origemHTML}
        </div>
    `;
}

// Renderizar pedidos nas colunas
function renderizarKanban() {
    const filtrados = filtrarPedidos(pedidos);

    // Limpar colunas
    document.getElementById('col-orcamento').innerHTML = '';
    document.getElementById('col-analise-credito').innerHTML = '';
    document.getElementById('col-pedido-aprovado').innerHTML = '';
    document.getElementById('col-faturar').innerHTML = '';
    document.getElementById('col-faturado').innerHTML = '';
    document.getElementById('col-recibo').innerHTML = '';

    // Contadores e totais
    const contadores = {
        orcamento: { qnt: 0, total: 0 },
        'analise-credito': { qnt: 0, total: 0 },
        'pedido-aprovado': { qnt: 0, total: 0 },
        faturar: { qnt: 0, total: 0 },
        faturado: { qnt: 0, total: 0 },
        recibo: { qnt: 0, total: 0 }
    };

    // Inserir cards
    filtrados.forEach(pedido => {
        const cardHTML = criarCardHTML(pedido);
        const colunaId = `col-${pedido.status}`;
        const coluna = document.getElementById(colunaId);
        
        if (coluna) {
            coluna.innerHTML += cardHTML;
            contadores[pedido.status].qnt++;
            contadores[pedido.status].total += Number(pedido.valor || 0);
        }
    });

    // Atualizar contadores nas colunas
    atualizarContadores(contadores);

    // Adicionar eventos de drag and drop
    configurarDragAndDrop();
}

// Atualizar contadores - Estilo Omie
function atualizarContadores(contadores) {
    // Mapeamento de status para IDs no HTML
    const statusParaId = {
        'orcamento': 'count-orcamento',
        'analise-credito': 'count-analise',
        'pedido-aprovado': 'count-aprovado',
        'faturar': 'count-faturar',
        'faturado': 'count-faturado',
        'recibo': 'count-recibo'
    };

    const colunas = [
        { status: 'orcamento', texto: 'Orçamento' },
        { status: 'analise-credito', texto: 'Análise de Crédito' },
        { status: 'pedido-aprovado', texto: 'Pedido Aprovado' },
        { status: 'faturar', texto: 'Faturar' },
        { status: 'faturado', texto: 'Faturado' },
        { status: 'recibo', texto: 'Recibo' }
    ];

    colunas.forEach(col => {
        const info = contadores[col.status] || { qnt: 0, total: 0 };
        const countId = statusParaId[col.status];
        const colunaCount = document.getElementById(countId);

        if (colunaCount) {
            if (info.qnt === 0) {
                colunaCount.textContent = 'Nenhum registro';
            } else {
                colunaCount.textContent = `${info.qnt} registro${info.qnt !== 1 ? 's' : ''}`;
            }
        }
    });
}

// Configurar Drag and Drop
let draggedCard = null;
let isDragging = false;
let clickTimeout = null;

function configurarDragAndDrop() {
    const cards = document.querySelectorAll('.kanban-card');
    const colunas = document.querySelectorAll('.kanban-column-content');

    cards.forEach(card => {
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
        
        // Clique simples abre o modal (com pequeno delay para não conflitar com drag)
        card.addEventListener('click', (e) => {
            // Ignorar se clicou no botão de menu
            if (e.target.closest('.card-menu-btn')) return;
            
            // Se estava arrastando, não abrir modal
            if (isDragging) return;
            
            const id = card.getAttribute('data-id');
            abrirModalEditarPedido(id);
        });
        
        // Manter dblclick como alternativa
        card.addEventListener('dblclick', () => {
            const id = card.getAttribute('data-id');
            abrirModalEditarPedido(id);
        });
    });

    colunas.forEach(coluna => {
        coluna.addEventListener('dragover', handleDragOver);
        coluna.addEventListener('drop', handleDrop);
        coluna.addEventListener('dragenter', handleDragEnter);
        coluna.addEventListener('dragleave', handleDragLeave);
    });
}

function handleDragStart(e) {
    isDragging = true;
    draggedCard = this;
    this.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
    this.style.opacity = '1';
    // Reset da flag de drag após um pequeno delay para não conflitar com o click
    setTimeout(() => {
        isDragging = false;
    }, 100);
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    this.style.background = '#f0f9ff';
}

function handleDragLeave(e) {
    this.style.background = '';
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    if (draggedCard) {
        const cardId = draggedCard.getAttribute('data-id');
        const novaColuna = this.id.replace('col-', '');
        const statusAnterior = draggedCard.dataset.status;
        
        // Verificar permissão de movimentação
        if (typeof VendasAuth.podeMoverPedido === 'function' && !VendasAuth.podeMoverPedido(usuarioLogado, statusAnterior, novaColuna)) {
            mostrarNotificacao('Você não tem permissão para mover este pedido para esta etapa.', 'error');
            this.style.background = '';
            return false;
        }
        
        // Remover card da posição original
        draggedCard.remove();
        
        // Adicionar card na nova coluna
        this.appendChild(draggedCard);
        
        // Atualizar status do pedido
        const pedido = pedidos.find(p => p.id == cardId);
        if (pedido) {
            pedido.status = novaColuna;
            renderizarKanban();
            salvarStatusPedido(cardId, novaColuna).catch(() => {
                // rollback visual
                pedido.status = statusAnterior || pedido.status;
                renderizarKanban();
                mostrarNotificacao('Falha ao salvar no servidor. Status revertido.', 'error');
            });
        }
        // Feedback visual
        mostrarNotificacao('Pedido movido com sucesso!', 'success');
    }

    this.style.background = '';
    return false;
}

// Mostrar notificação
function mostrarNotificacao(mensagem, tipo = 'info') {
    const notif = document.createElement('div');
    notif.className = 'toast';
    notif.textContent = mensagem;
    notif.dataset.tipo = tipo;
    document.body.appendChild(notif);

    requestAnimationFrame(() => notif.classList.add('show'));

    setTimeout(() => {
        notif.classList.remove('show');
        setTimeout(() => notif.remove(), 250);
    }, 2800);
}

// Persist status in backend
async function salvarStatusPedido(id, status) {
    const resp = await fetch(`/api/vendas/pedidos/${id}/status`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status })
    });
    if (!resp.ok) {
        throw new Error('Erro ao salvar status');
    }
}

// Excluir pedido atual do modal
async function excluirPedidoAtual() {
    const form = document.getElementById('form-novo-pedido');
    const id = form?.dataset.pedidoId;
    
    if (!id) {
        mostrarNotificacao('Nenhum pedido selecionado para excluir.', 'error');
        return;
    }
    
    // Confirmação
    const confirmar = confirm('Tem certeza que deseja excluir este pedido?Esta ação não pode ser desfeita.');
    if (!confirmar) return;
    
    try {
        const resp = await fetch(`/api/vendas/pedidos/${id}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!resp.ok) {
            const errorData = await resp.json().catch(() => ({}));
            throw new Error(errorData.message || 'Erro ao excluir pedido');
        }
        
        // Remover do array local
        const idx = pedidos.findIndex(p => p.id == id);
        if (idx !== -1) {
            pedidos.splice(idx, 1);
        }
        
        // Fechar modal e atualizar kanban
        fecharModalNovoPedido();
        renderizarKanban();
        mostrarNotificacao('Pedido excluído com sucesso!', 'success');
        
    } catch (err) {
        console.error('Erro ao excluir pedido:', err);
        mostrarNotificacao(err.message || 'Falha ao excluir pedido', 'error');
    }
}

// Novo pedido
function abrirModalNovoPedido(tipo = 'orcamento') {
    console.log('[Kanban] abrirModalNovoPedido - tipo:', tipo);
    const modal = document.getElementById('modal-novo-pedido');
    const form = document.getElementById('form-novo-pedido');
    
    console.log('[Kanban] Modal encontrado:', !!modal);
    console.log('[Kanban] Form encontrado:', !!form);
    
    if (form) {
        form.reset();
        form.dataset.modo = 'novo';
        form.dataset.pedidoId = '';
        form.dataset.tipo = tipo;
        
        // Define título baseado no tipo
        const tituloH3 = modal.querySelector('.modal-head h3');
        const eyebrow = modal.querySelector('.modal-eyebrow');
        
        if (tipo === 'venda') {
            if (tituloH3) tituloH3.textContent = 'Novo Pedido de Venda';
            if (eyebrow) eyebrow.textContent = 'Criar Pedido';
        } else {
            if (tituloH3) tituloH3.textContent = 'Novo Orçamento';
            if (eyebrow) eyebrow.textContent = 'Criar Orçamento';
        }
        
        // Limpa campo número e define data atual
        const numeroInput = form.querySelector('[name="numero"]');
        if (numeroInput) numeroInput.value = '';
        
        const hoje = new Date().toISOString().split('T')[0];
        const dataSpan = modal.querySelector('.modal-resumo-data');
        if (dataSpan) dataSpan.textContent = hoje;
        
        // Limpa status para orçamento por padrão
        const statusSelect = form.querySelector('[name="status"]');
        if (statusSelect) statusSelect.value = tipo === 'venda' ? 'analise' : 'orcamento';
    }
    
    preencherResumoModal({});
    
    if (modal) {
        modal.classList.add('aberto');
        console.log('[Kanban] Modal aberto com sucesso!');
    } else {
        console.error('[Kanban] Modal #modal-novo-pedido não encontrado no DOM!');
        alert('Erro: Modal não encontrado. Verifique o HTML.');
    }
}

// Atalho para novo orçamento
function abrirModalNovoOrcamento() {
    console.log('[Kanban] abrirModalNovoOrcamento chamado');
    abrirModalNovoPedido('orcamento');
}

// Atalho para novo pedido de venda
function abrirModalNovoPedidoVenda() {
    console.log('[Kanban] abrirModalNovoPedidoVenda chamado');
    abrirModalNovoPedido('venda');
}

function fecharModalNovoPedido() {
    const modal = document.getElementById('modal-novo-pedido');
    if (modal) modal.classList.remove('aberto');
}

function popularFormPedido(pedido) {
    const form = document.getElementById('form-novo-pedido');
    console.log('[Kanban] popularFormPedido - Form encontrado:', !!form);
    console.log('[Kanban] popularFormPedido - Dados recebidos:', pedido);
    
    if (!form) {
        console.error('[Kanban] Form não encontrado!');
        return;
    }
    
    // Definir IDs e modo
    form.dataset.pedidoId = pedido.id || '';
    form.dataset.modo = pedido.id ? 'editar' : 'novo';
    
    // Campos hidden
    const clienteIdInput = form.querySelector('[name="cliente_id"]');
    const empresaIdInput = form.querySelector('[name="empresa_id"]');
    if (clienteIdInput) clienteIdInput.value = pedido.cliente_id || '';
    if (empresaIdInput) empresaIdInput.value = pedido.empresa_id || '';
    
    // Campos do formulário - com verificação de existência
    const setInputValue = (name, value) => {
        const input = form.querySelector(`[name="${name}"]`);
        console.log(`[Kanban] setInputValue - ${name}:`, value, '- Input encontrado:', !!input);
        if (input) {
            input.value = value ?? '';
        }
    };
        if (input) input.value = value ?? '';
    };
    
    // Número do pedido
    const numeroStr = pedido.numero || '';
    setInputValue('numero', numeroStr.replace(/^(Pedido|Orçamento) Nº /i, ''));
    
    // Dados básicos
    setInputValue('cliente', pedido.cliente || pedido.cliente_nome || '');
    // Priorizar valor_total (soma dos itens) sobre valor do pedido
    setInputValue('valor', pedido.valor_total || pedido.valor || 0);
    setInputValue('status', pedido.status || 'orcamento');
    setInputValue('tipo', pedido.tipo || pedido.prioridade || '');
    setInputValue('faturamento', pedido.faturamento || '');
    setInputValue('vendedor', pedido.vendedor || pedido.vendedor_nome || '');
    setInputValue('origem', pedido.origem || 'Sistema');
    
    // Data
    let dataFormatada = pedido.data || '';
    if (pedido.created_at && !dataFormatada) {
        dataFormatada = new Date(pedido.created_at).toISOString().slice(0, 10);
    }
    setInputValue('data', dataFormatada);
    
    // Campos adicionais
    setInputValue('vencimento', pedido.vencimento || pedido.prazo_entrega || '');
    setInputValue('transportadora', pedido.transportadora || pedido.metodo_envio || '');
    setInputValue('manifestacao', pedido.manifestacao || '');
    setInputValue('notaFiscal', pedido.notaFiscal || '');
    setInputValue('observacoes', pedido.observacoes || pedido.observacao || pedido.descricao || '');
    setInputValue('frete', pedido.frete || 0);
    setInputValue('endereco_entrega', pedido.endereco_entrega || '');
    setInputValue('municipio_entrega', pedido.municipio_entrega || '');
    
    // Produtos
    const produtosInput = form.querySelector('[name="produtos"]');
    if (produtosInput) {
        const produtos = pedido.produtos || [];
        produtosInput.value = Array.isArray(produtos) && produtos.length > 0 
            ? JSON.stringify(produtos, null, 2) 
            : '';
    }
    
    // Atualizar tabela de produtos na aba de impressão
    atualizarTabelaProdutos(pedido.produtos || []);
    
    // Atualizar resumo do modal
    preencherResumoModal(pedido);
}

// Atualizar tabela de produtos na aba impressão
function atualizarTabelaProdutos(produtos) {
    const tbody = document.querySelector('#tab-impressao .resumo-table tbody');
    if (!tbody) return;
    
    if (!Array.isArray(produtos) || produtos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: #888;">Nenhum produto adicionado</td>
            </tr>
        `;
        return;
    }
    
    let total = 0;
    const rows = produtos.map(p => {
        const qty = parseFloat(p.quantidade) || 1;
        const preco = parseFloat(p.preco) || parseFloat(p.valor) || 0;
        const subtotal = qty * preco;
        total += subtotal;
        return `
            <tr>
                <td>${p.descricao || p.nome || 'Produto'}</td>
                <td>${qty}</td>
                <td>${formatarMoeda(preco)}</td>
                <td>${formatarMoeda(subtotal)}</td>
            </tr>
        `;
    }).join('');
    
    tbody.innerHTML = rows + `
        <tr>
            <td class="resumo-total-label" colspan="3">Valor Total</td>
            <td class="resumo-total-valor">${formatarMoeda(total)}</td>
        </tr>
    `;
}

function preencherResumoModal(pedido = {}) {
    const resumoCliente = document.querySelector('.modal-resumo-cliente');
    const resumoData = document.querySelector('.modal-resumo-data');
    const resumoStatus = document.querySelector('.modal-resumo-status');
    const resumoValor = document.querySelector('.modal-resumo-valor');
    const resumoOrigem = document.querySelector('.modal-resumo-origem');
    const resumoVendedor = document.querySelector('.modal-resumo-vendedor');

    if (resumoCliente) resumoCliente.textContent = pedido.cliente || 'Cliente';
    if (resumoData) resumoData.textContent = formatarDataCurta(pedido.data) || 'Data';
    if (resumoStatus) resumoStatus.textContent = (statusConfig[pedido.status]?.label) || 'Orçamento';
    // Priorizar valor_total (soma dos itens) sobre valor do pedido
    if (resumoValor) resumoValor.textContent = formatarMoeda(pedido.valor_total || pedido.valor || 0);
    if (resumoOrigem) resumoOrigem.textContent = pedido.origem || 'Origem';
    if (resumoVendedor) resumoVendedor.textContent = pedido.vendedor || 'Vendedor';
}

async function abrirModalEditarPedido(id) {
    try {
        console.log('[Kanban] Abrindo modal para pedido ID:', id);
        
        // Primeiro busca os dados locais do kanban (sempre disponíveis)
        const pedidoLocal = pedidos.find(p => p.id == id);
        console.log('[Kanban] Pedido local encontrado:', pedidoLocal);
        
        // Tenta buscar dados atualizados da API
        let pedidoDetalhe = pedidoLocal || {};
        
        try {
            const resp = await fetch(`/api/vendas/pedidos/${id}`, {
                credentials: 'include'
            });
            
            if (resp.ok) {
                const dados = await resp.json();
                console.log('[Kanban] Dados da API:', dados);
                
                // Se a API retornou dados válidos, usar eles
                if (dados && (dados.id || dados.valor_total || dados.valor || dados.cliente_nome)) {
                    pedidoDetalhe = {
                        ...pedidoLocal, // dados do kanban como base
                        ...dados,       // sobrescreve com dados da API
                        numero: dados.numero || `Pedido Nº ${id}`,
                        cliente: dados.cliente_nome || dados.cliente || pedidoLocal?.cliente || '',
                        // Priorizar valor_total (soma dos itens) sobre valor do pedido
                        valor: parseFloat(dados.valor_total) || parseFloat(dados.valor) || pedidoLocal?.valor_total || pedidoLocal?.valor || 0,
                        vendedor: dados.vendedor_nome || dados.vendedor || pedidoLocal?.vendedor || '',
                        produtos: safeParseJSON(dados.produtos_preview || dados.produtos, [])
                    };
                }
            }
        } catch (apiError) {
            console.warn('[Kanban] Erro ao buscar API, usando dados locais:', apiError);
        }
        
        console.log('[Kanban] Dados finais para o modal:', pedidoDetalhe);
        
        // IMPORTANTE: Primeiro abre o modal (que reseta o form), depois popula os dados
        const modal = document.getElementById('modal-novo-pedido');
        if (modal) modal.classList.add('aberto');
        
        // Agora popula o form com os dados do pedido
        popularFormPedido(pedidoDetalhe);
        
    } catch (err) {
        console.error('Erro ao abrir edição', err);
        mostrarNotificacao('Erro ao carregar pedido para edição', 'error');
    }
}

function safeParseJSON(txt, fallback) {
    try { return JSON.parse(txt); } catch (_) { return fallback; }
}

async function salvarPedidoAPI(payload, id) {
    const url = id ? `/api/vendas/pedidos/${id}` : '/api/vendas/pedidos';
    const method = id ? 'PUT' : 'POST';
    const resp = await fetch(url, {
        method,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    if (!resp.ok) {
        throw new Error('Erro ao salvar pedido');
    }
    return resp.json();
}

function salvarNovoPedido(event) {
    event.preventDefault();
    const form = event.target;
    const dados = Object.fromEntries(new FormData(form));
    const id = form.dataset.pedidoId || null;
    
    // Construir payload com campos corretos da tabela
    const payload = {
        cliente_id: dados.cliente_id ? Number(dados.cliente_id) : null,
        empresa_id: dados.empresa_id ? Number(dados.empresa_id) : null,
        valor: Number(dados.valor || 0),
        descricao: dados.observacoes || dados.faturamento || '',
        status: dados.status || 'orcamento',
        prioridade: dados.tipo || 'normal',
        frete: Number(dados.frete || 0),
        prazo_entrega: dados.vencimento || null,
        endereco_entrega: dados.endereco_entrega || null,
        municipio_entrega: dados.municipio_entrega || null,
        metodo_envio: dados.transportadora || null,
        produtos: dados.produtos ? safeParseJSON(dados.produtos, []) : []
    };

    if (!payload.valor) {
        mostrarNotificacao('Informe um valor válido.', 'error');
        return;
    }

    salvarPedidoAPI(payload, id)
        .then((result) => {
            // Atualizar o pedido no array local para sincronização imediata
            if (id) {
                const idx = pedidos.findIndex(p => p.id == id);
                if (idx !== -1) {
                    pedidos[idx] = {
                        ...pedidos[idx],
                        valor: payload.valor,
                        status: payload.status,
                        cliente: dados.cliente || pedidos[idx].cliente,
                        vendedor: dados.vendedor || pedidos[idx].vendedor,
                        faturamento: payload.descricao
                    };
                }
            }
            
            form.reset();
            form.dataset.pedidoId = '';
            form.dataset.modo = 'novo';
            fecharModalNovoPedido();
            
            // Recarregar dados do servidor para garantir sincronização
            carregarPedidosDaAPI();
            mostrarNotificacao(id ? 'Pedido atualizado com sucesso!' : 'Pedido criado com sucesso!', 'success');
        })
        .catch((err) => {
            console.error('Erro ao salvar:', err);
            mostrarNotificacao('Falha ao salvar no servidor', 'error');
        });
}

// Carregar dados do usuário
async function carregarUsuario() {
    // Usar o sistema de autenticação externo se disponível
    if (window.VendasAuth && typeof window.VendasAuth.inicializarAuth === 'function') {
        usuarioLogado = await window.VendasAuth.inicializarAuth();
        if (usuarioLogado) return;
    }
    
    // Buscar diretamente da API usando cookies
    try {
        const response = await fetch('/api/usuario/atual', { credentials: 'include' });
        if (response.ok) {
            const user = await response.json();
            usuarioLogado = user;
            const firstName = user.nome.split(' ')[0];
            const userNameElement = document.querySelector('.user-text');
            if (userNameElement) {
                userNameElement.textContent = firstName;
            }
        } else {
            console.warn('Usuário não autenticado, redirecionando para login');
            // Opcional: redirecionar para login se necessário
            // window.location.href = '/login';
        }
    } catch (error) {
        console.error('Erro ao carregar usuário:', error);
    }
}

// Filtros e busca
function filtrarPedidos(base) {
    // Usar IDs específicos da toolbar
    const buscaInput = document.getElementById('filtro-busca');
    const selectPeriodo = document.getElementById('filtro-periodo');
    const selectVendedor = document.getElementById('filtro-vendedor');

    const termo = (buscaInput?.value || '').toLowerCase().trim();
    const periodo = selectPeriodo?.value || '';
    const vendedor = selectVendedor?.value || '';

    return base.filter(p => {
        const matchTexto = !termo || 
            (p.cliente && p.cliente.toLowerCase().includes(termo)) || 
            (p.numero && p.numero.toLowerCase().includes(termo));
        const matchVendedor = !vendedor || (p.vendedor || '').toLowerCase().includes(vendedor.toLowerCase());
        const matchPeriodo = validarPeriodo(periodo, p.data);
        return matchTexto && matchVendedor && matchPeriodo;
    });
}

function validarPeriodo(periodo, dataISO) {
    if (!dataISO || !periodo || periodo === '') return true;
    const data = new Date(dataISO);
    const hoje = new Date();

    const dentroDosUltimosDias = (dias) => {
        const limite = new Date();
        limite.setDate(hoje.getDate() - dias);
        return data >= limite;
    };

    // Período agora é um número de dias (7, 15, 30, 60, 90)
    const dias = parseInt(periodo);
    if (!isNaN(dias)) {
        return dentroDosUltimosDias(dias);
    }

    // Fallback para compatibilidade
    switch (periodo) {
        case '7 dias':
            return dentroDosUltimosDias(7);
        case '15 dias':
            return dentroDosUltimosDias(15);
        case '30 dias':
            return dentroDosUltimosDias(30);
        case '60 dias':
            return dentroDosUltimosDias(60);
        case '90 dias':
            return dentroDosUltimosDias(90);
        case '1 ano':
            return dentroDosUltimosDias(365);
        default:
            return true;
    }
}

// Filtros
function aplicarFiltros() {
    renderizarKanban();
}

function limparFiltros() {
    // Limpar filtros na kanban-toolbar
    const periodoSelect = document.getElementById('filtro-periodo');
    const vendedorSelect = document.getElementById('filtro-vendedor');
    const buscaInput = document.getElementById('filtro-busca');
    
    if (periodoSelect) periodoSelect.selectedIndex = 0;
    if (vendedorSelect) vendedorSelect.selectedIndex = 0;
    if (buscaInput) buscaInput.value = '';
    
    // Também limpar em filtros-bar se existir
    const inputs = document.querySelectorAll('.filtros-bar input, .filtros-bar select, .kanban-toolbar input, .kanban-toolbar select');
    inputs.forEach(input => {
        if (input.tagName === 'SELECT') {
            input.selectedIndex = 0;
        } else {
            input.value = '';
        }
    });
    renderizarKanban();
    mostrarNotificacao('Filtros limpos', 'info');
}

// Animações CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    carregarUsuario();
    carregarPedidosDaAPI();

    // Event listeners para filtros
    const btnFiltrar = document.querySelector('.btn-filtrar');
    const btnLimpar = document.querySelector('.btn-limpar');
    const buscaInput = document.querySelector('.filtros-bar input[type="text"]');
    const selects = document.querySelectorAll('.filtros-bar select');
    
    if (btnFiltrar) btnFiltrar.addEventListener('click', aplicarFiltros);
    if (btnLimpar) btnLimpar.addEventListener('click', limparFiltros);
    if (buscaInput) buscaInput.addEventListener('input', aplicarFiltros);
    selects.forEach(sel => sel.addEventListener('change', aplicarFiltros));

    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => btn.addEventListener('click', () => {
        const alvo = btn.dataset.tab;
        tabButtons.forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const pane = document.getElementById(alvo);
        if (pane) pane.classList.add('active');
    }));

    // Event listener para botão novo orçamento
    const btnNovoOrcamento = document.querySelector('.btn-novo-orcamento');
    if (btnNovoOrcamento) btnNovoOrcamento.addEventListener('click', abrirModalNovoPedido);

    // Modal listeners
    const modal = document.getElementById('modal-novo-pedido');
    const modalForm = document.getElementById('form-novo-pedido');
    const modalClose = document.querySelector('#modal-novo-pedido .modal-close');
    if (modalForm) modalForm.addEventListener('submit', salvarNovoPedido);
    if (modalForm) {
        modalForm.addEventListener('input', () => {
            const dados = Object.fromEntries(new FormData(modalForm));
            preencherResumoModal({
                cliente: dados.cliente,
                data: dados.data,
                status: dados.status,
                valor: Number(dados.valor || 0),
                origem: dados.origem,
                vendedor: dados.vendedor
            });
        });
    }
    if (modalClose) modalClose.addEventListener('click', fecharModalNovoPedido);
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) fecharModalNovoPedido(); });
    
    // EXPOR FUNÇÕES PARA O ESCOPO GLOBAL (para onclick no HTML)
    window.abrirModalNovoOrcamento = abrirModalNovoOrcamento;
    window.abrirModalNovoPedidoVenda = abrirModalNovoPedidoVenda;
    window.abrirModalNovoPedido = abrirModalNovoPedido;
    window.fecharModalNovoPedido = fecharModalNovoPedido;
    window.abrirModalEditarPedido = abrirModalEditarPedido;
    window.excluirPedidoAtual = excluirPedidoAtual;
    window.mostrarNotificacao = mostrarNotificacao;
    window.aplicarFiltros = aplicarFiltros;
    window.limparFiltros = limparFiltros;
});

// Log de inicialização
console.log('✅ Módulo de Vendas Kanban Omie Style carregado com sucesso!');
