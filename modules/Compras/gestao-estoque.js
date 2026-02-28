/**
 * GESTÍO DE ESTOQUE - ALUFORCE
 * Controle completo de entrada e saída de materiais
 */

class EstoqueManager {
    constructor() {
        this.estoque = [];
        this.filtroAtual = 'todos';
        this.init();
    }

    getAuthHeaders() {
        const token = localStorage.getItem('token');
        return {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        };
    }

    async init() {
        await this.carregarEstoque();
        this.renderizarTabela();
        this.inicializarUsuario();
    }

    async carregarEstoque() {
        try {
            // Busca apenas materiais que tiveram entrada (movimentação de entrada registrada)
            const response = await fetch('/api/compras/estoque/materiais-com-entrada', {
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                const materiais = data.materiais || [];

                this.estoque = materiais.map(m => {
                    return {
                        id: m.codigo || `MAT-${m.id}`,
                        materialId: m.id,
                        descricao: m.descricao,
                        categoria: m.categoria || 'Geral',
                        unidade: m.unidade || 'UN',
                        qtdAtual: parseFloat(m.estoque_atual) || 0,
                        qtdMinima: parseFloat(m.estoque_min) || 0,
                        qtdMaxima: parseFloat(m.estoque_max) || 0,
                        localizacao: m.localizacao || '-',
                        ultimaMov: m.updated_at ? new Date(m.updated_at).toISOString().split('T')[0] : '-',
                        status: m.status || 'adequado'
                    };
                });

                // Atualizar contadores na tela
                this.atualizarContadores(data.stats);
            } else {
                throw new Error('Erro ao carregar estoque');
            }
        } catch (error) {
            console.error('Erro ao carregar estoque:', error);
            // Fallback para dados vazios
            this.estoque = [];
            this.mostrarToast('Erro ao carregar estoque do servidor', 'error');
        }
    }

    atualizarContadores(stats) {
        if (!stats) return;

        const totalEl = document.getElementById('stat-total');
        const adequadoEl = document.getElementById('stat-normal');
        const baixoEl = document.getElementById('stat-baixo');
        const criticoEl = document.getElementById('stat-critico');

        if (totalEl) totalEl.textContent = stats.total || 0;
        if (adequadoEl) adequadoEl.textContent = stats.adequado || 0;
        if (baixoEl) baixoEl.textContent = stats.baixo || 0;
        if (criticoEl) criticoEl.textContent = stats.critico || 0;
    }

    mostrarToast(mensagem, tipo = 'info') {
        const cores = {
            success: '#22c55e',
            error: '#ef4444',
            warning: '#f97316',
            info: '#38bdf8'
        };

        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 16px 24px;
            background: ${cores[tipo]};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10001;
            animation: slideIn 0.3s ease;
        `;
        toast.textContent = mensagem;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    renderizarTabela() {
        const tbody = document.getElementById('materiais-tbody');
        if (!tbody) {
            console.error('[ESTOQUE] tbody materiais-tbody não encontrado');
            return;
        }

        const estoqueFiltrado = this.filtrarEstoquePorStatus();

        if (estoqueFiltrado.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8">
                        <div class="empty-state">
                            <i class="fas fa-inbox"></i>
                            <h3>Nenhum material encontrado</h3>
                            <p>Registre entradas de materiais para visualizá-los aqui</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = estoqueFiltrado.map(item => `
            <tr>
                <td><span class="codigo-item">${item.id}</span></td>
                <td><strong>${item.descricao}</strong></td>
                <td><span class="badge badge-${this.getCategoriaColor(item.categoria)}">${item.categoria || '-'}</span></td>
                <td>${item.unidade}</td>
                <td><strong>${item.qtdAtual}</strong></td>
                <td>${item.qtdMinima}</td>
                <td><span class="status-badge status-${item.status}">${this.getStatusLabel(item.status)}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action" title="Entrada" onclick="estoqueManager.registrarEntrada('${item.materialId || item.id}')">
                            <i class="fas fa-arrow-down"></i>
                        </button>
                        <button class="btn-action" title="Histórico" onclick="estoqueManager.verHistorico('${item.id}')">
                            <i class="fas fa-history"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Atualizar contador de registros
        const totalRegistros = document.getElementById('total-registros');
        if (totalRegistros) {
            totalRegistros.textContent = `${estoqueFiltrado.length} registros`;
        }
    }

    getCategoriaColor(categoria) {
        const cores = {
            'Matéria Prima': 'blue',
            'Componentes': 'purple',
            'Embalagens': 'green',
            'Fixação': 'orange',
            'Acabamento': 'red',
            'Ferramentas': 'orange',
            'Químicos': 'red',
            'Lubrificantes': 'blue',
            'Consumíveis': 'purple',
            'Limpeza': 'green'
        };
        return cores[categoria] || 'gray';
    }

    getStatusLabel(status) {
        const labels = {
            'adequado': 'Adequado',
            'baixo': 'Estoque Baixo',
            'falta': 'Em Falta'
        };
        return labels[status] || status;
    }

    filtrarEstoquePorStatus() {
        if (this.filtroAtual === 'todos') {
            return this.estoque;
        }
        return this.estoque.filter(item => item.status === this.filtroAtual);
    }

    movimentar(id) {
        alert(`Registrar movimentação para item ${id}\n\nFuncionalidade em desenvolvimento.`);
    }

    registrarEntrada(materialId) {
        // Preencher modal de entrada com o material selecionado
        const item = this.estoque.find(e => e.materialId == materialId || e.id == materialId);
        if (item) {
            document.getElementById('entrada-id').value = item.materialId || item.id;
            document.getElementById('entrada-nome').value = item.descricao;
            document.getElementById('entrada-estoque-atual').value = item.qtdAtual;
            document.getElementById('entrada-qtd').value = '';
            document.getElementById('entrada-custo').value = '';
            document.getElementById('entrada-documento').value = '';
            document.getElementById('entrada-obs').value = '';
            document.getElementById('modal-entrada').style.display = 'flex';
        } else {
            abrirEntradaRapida();
        }
    }

    verHistorico(id) {
        const item = this.estoque.find(e => e.id === id);
        if (item) {
            alert(`Histórico de Movimentações\n\nItem: ${item.descricao}\nCódigo: ${item.id}\n\nFuncionalidade em desenvolvimento.`);
        }
    }

    editar(id) {
        alert(`Editar item ${id}\n\nFuncionalidade em desenvolvimento.`);
    }

    formatarData(data) {
        return new Date(data).toLocaleDateString('pt-BR');
    }

    inicializarUsuario() {
        const usuario = JSON.parse(localStorage.getItem('usuarioLogado')) || {
            nome: 'Administrador',
            cargo: 'Administrador',
            avatar: null
        };

        const userGreeting = document.getElementById('userGreeting');
        const userRole = document.getElementById('userRole');
        const userAvatar = document.getElementById('userAvatar');

        if (userGreeting) {
            const hora = new Date().getHours();
            let saudacao = 'Olá';
            if (hora < 12) saudacao = 'Bom dia';
            else if (hora < 18) saudacao = 'Boa tarde';
            else saudacao = 'Boa noite';

            userGreeting.textContent = `${saudacao}, ${usuario.nome.split(' ')[0]}`;
        }

        if (userRole) userRole.textContent = usuario.cargo;
        if (userAvatar && usuario.avatar) {
            userAvatar.innerHTML = `<img src="${usuario.avatar}" alt="${usuario.nome}">`;
        }
    }
}

// Funções globais
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
    const btn = document.getElementById('btnModoEscuro');
    btn.querySelector('i').className = isDark ? 'fas fa-sun' : 'fas fa-moon';
}

function toggleView(mode) {
    const btnGrid = document.getElementById('btnViewGrid');
    const btnList = document.getElementById('btnViewList');

    if (mode === 'grid') {
        btnGrid.classList.add('active');
        btnList.classList.remove('active');
    } else {
        btnList.classList.add('active');
        btnGrid.classList.remove('active');
    }
}

function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    if (!menu) return;
    menu.classList.toggle('show');
}

function filterByStatus(status, evt) {
    estoqueManager.filtroAtual = status;
    estoqueManager.renderizarTabela();

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const e = evt || window.event;
    if (e && e.target) {
        const btn = e.target.closest('.filter-btn');
        if (btn) btn.classList.add('active');
    }
}

function filtrarEstoque() {
    const searchTerm = document.getElementById('searchEstoque').value.toLowerCase();
    const rows = document.querySelectorAll('#estoqueTableBody tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
}

function openMovimentacaoModal() {
    alert('Abrir modal de movimentação\n\nFuncionalidade em desenvolvimento.');
}

function exportarEstoque() {
    alert('Exportar estoque\n\nFuncionalidade em desenvolvimento.');
}

function imprimirEstoque() {
    window.print();
}

// Inicializar - AGUARDA AUTENTICAÇÃO
let estoqueManager;

// Função para inicializar após autenticação
function inicializarEstoqueManager() {
    if (estoqueManager) return; // Já inicializado
    estoqueManager = new EstoqueManager();

    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('btnModoEscuro');
        if (btn) btn.querySelector('i').className = 'fas fa-sun';
    }
}

// Esperar evento de autenticação
window.addEventListener('authSuccess', () => {
    console.log('[Compras] authSuccess recebido, inicializando EstoqueManager...');
    inicializarEstoqueManager();
});

// Fallback: se já tem userData no localStorage, inicializar
document.addEventListener('DOMContentLoaded', () => {
    // Aguardar um pouco para o auth-unified processar
    setTimeout(() => {
        const userData = localStorage.getItem('userData');
        if (userData && !estoqueManager) {
            console.log('[Compras] Fallback: inicializando com userData existente');
            inicializarEstoqueManager();
        }
    }, 500);
});

document.addEventListener('click', (e) => {
    const userProfile = document.querySelector('.user-profile');
    const userMenu = document.getElementById('userMenu');
    if (userMenu && !userProfile.contains(e.target)) {
        userMenu.classList.remove('show');
    }
});

// ============================================
// FUNÇÕES DE AÇÃO RÁPIDA
// ============================================

// Abrir modal de Entrada Rápida
function abrirEntradaRapida() {
    // Limpar campos
    document.getElementById('entrada-id').value = '';
    document.getElementById('entrada-nome').value = '';
    document.getElementById('entrada-estoque-atual').value = '';
    document.getElementById('entrada-qtd').value = '';
    document.getElementById('entrada-custo').value = '';
    document.getElementById('entrada-documento').value = '';
    document.getElementById('entrada-obs').value = '';

    // Mostrar modal para selecionar material
    mostrarSeletorMaterial('entrada');
}

// Abrir modal de Saída Rápida
function abrirSaidaRapida() {
    // Limpar campos
    document.getElementById('saida-id').value = '';
    document.getElementById('saida-nome').value = '';
    document.getElementById('saida-disponivel').value = '';
    document.getElementById('saida-qtd').value = '';
    document.getElementById('saida-destino').value = '';
    document.getElementById('saida-documento').value = '';
    document.getElementById('saida-obs').value = '';

    // Mostrar modal para selecionar material
    mostrarSeletorMaterial('saida');
}

// Abrir modal de Ajuste de Inventário
function abrirAjusteInventario() {
    // Limpar campos
    document.getElementById('ajuste-id').value = '';
    document.getElementById('ajuste-nome').textContent = '-';
    document.getElementById('ajuste-estoque-sistema').textContent = '0';
    document.getElementById('ajuste-qtd-contada').value = '';
    document.getElementById('ajuste-motivo').value = '';
    document.getElementById('ajuste-documento').value = '';
    document.getElementById('ajuste-obs').value = '';
    document.getElementById('ajuste-diferenca-card').style.display = 'none';
    document.getElementById('btn-confirmar-ajuste').disabled = true;
    document.getElementById('btn-confirmar-ajuste').style.opacity = '0.6';

    // Mostrar modal para selecionar material
    mostrarSeletorMaterial('ajuste');
}

// Ver Histórico Geral de Movimentações
function verHistoricoGeral() {
    abrirModal('modal-historico');
    carregarHistoricoGeral();
}

// Função para mostrar seletor de material
function mostrarSeletorMaterial(tipo) {
    // Se não tem materiais carregados, mostrar mensagem
    if (!estoqueManager || estoqueManager.estoque.length === 0) {
        mostrarToast('Nenhum material disponível. Cadastre materiais primeiro.', 'warning');
        return;
    }

    // Criar modal de seleção
    const modalHtml = `
        <div class="modal active" id="modal-seletor-material" onclick="if(event.target === this) fecharModal('modal-seletor-material')">
            <div class="modal-content" style="max-width: 600px;">
                <div style="background: linear-gradient(135deg, #6366f1, #4f46e5); padding: 20px 24px; color: white;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 18px; font-weight: 600;">
                            <i class="fas fa-search" style="margin-right: 10px;"></i>
                            Selecionar Material
                        </h3>
                        <button onclick="fecharModal('modal-seletor-material')" style="border: none; background: rgba(255,255,255,0.2); width: 32px; height: 32px; border-radius: 8px; cursor: pointer; color: white;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div style="padding: 16px 24px; border-bottom: 1px solid #e5e7eb;">
                    <input type="text" id="busca-material-modal" placeholder="Buscar por código ou descrição..."
                        oninput="filtrarMateriaisModal()"
                        style="width: 100%; padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 10px; font-size: 14px;">
                </div>
                <div style="max-height: 400px; overflow-y: auto;" id="lista-materiais-modal">
                    ${estoqueManager.estoque.map(item => `
                        <div class="material-item-select" onclick="selecionarMaterial('${item.id}', '${tipo}')"
                            style="padding: 14px 24px; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;"
                            onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'"
                            data-codigo="${item.id.toLowerCase()}" data-descricao="${item.descricao.toLowerCase()}">
                            <div>
                                <div style="font-weight: 600; color: #1e293b; margin-bottom: 2px;">${item.descricao}</div>
                                <div style="font-size: 12px; color: #64748b;">${item.id} • ${item.categoria}</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-weight: 700; color: ${item.qtdAtual <= item.qtdMinima ? '#ef4444' : '#22c55e'};">${item.qtdAtual} ${item.unidade}</div>
                                <div style="font-size: 11px; color: #94a3b8;">Estoque atual</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.getElementById('busca-material-modal').focus();
}

// Filtrar materiais no modal de seleção
function filtrarMateriaisModal() {
    const termo = document.getElementById('busca-material-modal').value.toLowerCase();
    const itens = document.querySelectorAll('.material-item-select');

    itens.forEach(item => {
        const codigo = item.dataset.codigo;
        const descricao = item.dataset.descricao;
        item.style.display = (codigo.includes(termo) || descricao.includes(termo)) ? '' : 'none';
    });
}

// Selecionar material e abrir modal correspondente
function selecionarMaterial(id, tipo) {
    const item = estoqueManager.estoque.find(e => e.id === id);
    if (!item) return;

    fecharModal('modal-seletor-material');

    if (tipo === 'entrada') {
        document.getElementById('entrada-id').value = item.materialId;
        document.getElementById('entrada-nome').value = item.descricao;
        document.getElementById('entrada-estoque-atual').value = `${item.qtdAtual} ${item.unidade}`;
        abrirModal('modal-entrada');
    } else if (tipo === 'saida') {
        document.getElementById('saida-id').value = item.materialId;
        document.getElementById('saida-nome').value = item.descricao;
        document.getElementById('saida-disponivel').value = `${item.qtdAtual} ${item.unidade}`;
        abrirModal('modal-saida');
    } else if (tipo === 'ajuste') {
        document.getElementById('ajuste-id').value = item.materialId;
        document.getElementById('ajuste-nome').textContent = item.descricao;
        document.getElementById('ajuste-estoque-sistema').textContent = `${item.qtdAtual} ${item.unidade}`;
        abrirModal('modal-ajuste');
    }
}

// Carregar histórico geral de movimentações
async function carregarHistoricoGeral() {
    const container = document.getElementById('historico-content');
    container.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: #64748b;">
            <i class="fas fa-spinner fa-spin" style="font-size: 32px; margin-bottom: 12px;"></i>
            <p>Carregando histórico...</p>
        </div>
    `;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/compras/estoque/movimentacoes', {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            }
        });

        if (response.ok) {
            const data = await response.json();
            const movimentacoes = data.movimentacoes || [];

            if (movimentacoes.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px; color: #64748b;">
                        <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                        <p style="margin: 0; font-weight: 500;">Nenhuma movimentação registrada</p>
                        <p style="margin: 8px 0 0 0; font-size: 14px;">Registre entradas ou saídas para ver o histórico</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = movimentacoes.map(mov => `
                <div style="padding: 16px 24px; border-bottom: 1px solid #f1f5f9; display: flex; gap: 16px; align-items: flex-start;">
                    <div style="width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
                        background: ${mov.tipo === 'ENTRADA' ? '#dcfce7' : mov.tipo === 'SAIDA' ? '#fee2e2' : '#fef3c7'};
                        color: ${mov.tipo === 'ENTRADA' ? '#16a34a' : mov.tipo === 'SAIDA' ? '#dc2626' : '#d97706'};">
                        <i class="fas fa-${mov.tipo === 'ENTRADA' ? 'arrow-down' : mov.tipo === 'SAIDA' ? 'arrow-up' : 'sliders-h'}"></i>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">${mov.material_descricao || 'Material'}</div>
                        <div style="font-size: 13px; color: #64748b;">
                            <span style="color: ${mov.tipo === 'ENTRADA' ? '#16a34a' : '#dc2626'}; font-weight: 600;">
                                ${mov.tipo === 'ENTRADA' ? '+' : '-'}${mov.quantidade}
                            </span>
                            ${mov.destino ? ` • ${mov.destino}` : ''}
                            ${mov.documento ? ` • ${mov.documento}` : ''}
                        </div>
                        ${mov.observacao ? `<div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">${mov.observacao}</div>` : ''}
                    </div>
                    <div style="text-align: right; font-size: 12px; color: #94a3b8;">
                        ${new Date(mov.created_at).toLocaleDateString('pt-BR')}<br>
                        ${new Date(mov.created_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}
                    </div>
                </div>
            `).join('');
        } else {
            throw new Error('Erro ao carregar histórico');
        }
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: #ef4444;">
                <i class="fas fa-exclamation-circle" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p style="margin: 0; font-weight: 500;">Erro ao carregar histórico</p>
                <p style="margin: 8px 0 0 0; font-size: 14px; color: #64748b;">${error.message}</p>
            </div>
        `;
    }
}

// Funções de modal
function abrirModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = '';
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function fecharModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
        if (id === 'modal-seletor-material') {
            modal.remove();
        }
        document.body.style.overflow = '';
    }
}

// Calcular diferença no ajuste de inventário
function calcularDiferencaAjuste() {
    const qtdContada = parseFloat(document.getElementById('ajuste-qtd-contada').value) || 0;
    const estoqueTexto = document.getElementById('ajuste-estoque-sistema').textContent;
    const estoqueSistema = parseFloat(estoqueTexto) || 0;

    const diferenca = qtdContada - estoqueSistema;
    const card = document.getElementById('ajuste-diferenca-card');
    const texto = document.getElementById('ajuste-diferenca-texto');
    const valor = document.getElementById('ajuste-diferenca-valor');
    const btn = document.getElementById('btn-confirmar-ajuste');

    if (qtdContada > 0) {
        card.style.display = 'block';

        if (diferenca > 0) {
            card.style.background = '#dcfce7';
            card.style.borderColor = '#86efac';
            texto.textContent = 'Será registrada uma ENTRADA';
            valor.textContent = `+${diferenca.toFixed(3)}`;
            valor.style.color = '#16a34a';
        } else if (diferenca < 0) {
            card.style.background = '#fee2e2';
            card.style.borderColor = '#fecaca';
            texto.textContent = 'Será registrada uma SAÍDA';
            valor.textContent = diferenca.toFixed(3);
            valor.style.color = '#dc2626';
        } else {
            card.style.background = '#f3f4f6';
            card.style.borderColor = '#e5e7eb';
            texto.textContent = 'Estoque já está correto';
            valor.textContent = '0';
            valor.style.color = '#6b7280';
        }

        btn.disabled = diferenca === 0;
        btn.style.opacity = diferenca === 0 ? '0.6' : '1';
    } else {
        card.style.display = 'none';
        btn.disabled = true;
        btn.style.opacity = '0.6';
    }
}

// Validar quantidade de saída
function validarSaida() {
    const qtd = parseFloat(document.getElementById('saida-qtd').value) || 0;
    const disponivelTexto = document.getElementById('saida-disponivel').value;
    const disponivel = parseFloat(disponivelTexto) || 0;

    const aviso = document.getElementById('saida-aviso');
    const btn = document.getElementById('btn-confirmar-saida');

    if (qtd > disponivel) {
        aviso.style.display = 'block';
        btn.disabled = true;
        btn.style.opacity = '0.6';
    } else {
        aviso.style.display = 'none';
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

// Confirmar entrada
async function confirmarEntrada() {
    const materialId = document.getElementById('entrada-id').value;
    const quantidade = parseFloat(document.getElementById('entrada-qtd').value);
    const custo = parseFloat(document.getElementById('entrada-custo').value);
    const documento = document.getElementById('entrada-documento').value.trim();
    const observacao = document.getElementById('entrada-obs').value.trim();

    if (!materialId || !quantidade || quantidade <= 0) {
        mostrarToast('Preencha a quantidade corretamente', 'warning');
        return;
    }
    if (!custo || custo <= 0) {
        mostrarToast('Preencha o custo unitário', 'warning');
        return;
    }
    if (!documento) {
        mostrarToast('Preencha a nota fiscal / documento', 'warning');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/compras/estoque/entrada', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
                material_id: materialId,
                quantidade,
                custo_unitario: custo,
                documento,
                observacao
            })
        });

        if (response.ok) {
            mostrarToast('Entrada registrada com sucesso!', 'success');
            fecharModal('modal-entrada');
            estoqueManager.carregarEstoque().then(() => estoqueManager.renderizarTabela());
        } else {
            const error = await response.json();
            throw new Error(error.message || 'Erro ao registrar entrada');
        }
    } catch (error) {
        console.error('Erro:', error);
        mostrarToast(error.message, 'error');
    }
}

// Confirmar saída
async function confirmarSaida() {
    const materialId = document.getElementById('saida-id').value;
    const quantidade = parseFloat(document.getElementById('saida-qtd').value);
    const destino = document.getElementById('saida-destino').value;
    const documento = document.getElementById('saida-documento').value;
    const observacao = document.getElementById('saida-obs').value;

    if (!materialId || !quantidade || quantidade <= 0 || !destino) {
        mostrarToast('Preencha todos os campos obrigatórios', 'warning');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/compras/estoque/saida', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
                material_id: materialId,
                quantidade,
                destino,
                documento,
                observacao
            })
        });

        if (response.ok) {
            mostrarToast('Saída registrada com sucesso!', 'success');
            fecharModal('modal-saida');
            estoqueManager.carregarEstoque().then(() => estoqueManager.renderizarTabela());
        } else {
            const error = await response.json();
            throw new Error(error.message || 'Erro ao registrar saída');
        }
    } catch (error) {
        console.error('Erro:', error);
        mostrarToast(error.message, 'error');
    }
}

// Confirmar ajuste
async function confirmarAjuste() {
    const materialId = document.getElementById('ajuste-id').value;
    const qtdContada = parseFloat(document.getElementById('ajuste-qtd-contada').value);
    const motivo = document.getElementById('ajuste-motivo').value;
    const documento = document.getElementById('ajuste-documento').value;
    const observacao = document.getElementById('ajuste-obs').value;

    if (!materialId || qtdContada === undefined || !motivo) {
        mostrarToast('Preencha todos os campos obrigatórios', 'warning');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/compras/estoque/ajuste', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
                material_id: materialId,
                quantidade_contada: qtdContada,
                motivo,
                documento,
                observacao
            })
        });

        if (response.ok) {
            mostrarToast('Ajuste realizado com sucesso!', 'success');
            fecharModal('modal-ajuste');
            estoqueManager.carregarEstoque().then(() => estoqueManager.renderizarTabela());
        } else {
            const error = await response.json();
            throw new Error(error.message || 'Erro ao realizar ajuste');
        }
    } catch (error) {
        console.error('Erro:', error);
        mostrarToast(error.message, 'error');
    }
}

// Função global de toast
function mostrarToast(mensagem, tipo = 'info') {
    const cores = {
        success: '#22c55e',
        error: '#ef4444',
        warning: '#f97316',
        info: '#6366f1'
    };

    const icones = {
        success: 'check-circle',
        error: 'times-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle'
    };

    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${cores[tipo]};
        color: white;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        z-index: 10001;
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 14px;
        font-weight: 500;
        animation: slideInToast 0.3s ease;
    `;
    toast.innerHTML = `<i class="fas fa-${icones[tipo]}"></i> ${mensagem}`;

    // Adicionar animação CSS se não existir
    if (!document.getElementById('toast-animation-style')) {
        const style = document.createElement('style');
        style.id = 'toast-animation-style';
        style.textContent = `
            @keyframes slideInToast {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideInToast 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Função de filtro para a página
function filtrar() {
    const busca = document.getElementById('busca-input')?.value?.toLowerCase() || '';
    const tipo = document.getElementById('filtro-tipo')?.value || '';
    const status = document.getElementById('filtro-status')?.value || '';

    const rows = document.querySelectorAll('#estoqueTableBody tr');
    let count = 0;

    rows.forEach(row => {
        const texto = row.textContent.toLowerCase();
        const matchBusca = !busca || texto.includes(busca);
        const matchTipo = !tipo || texto.includes(tipo.toLowerCase());
        const matchStatus = !status || row.querySelector(`.status-${status}`);

        if (matchBusca && matchTipo && matchStatus) {
            row.style.display = '';
            count++;
        } else {
            row.style.display = 'none';
        }
    });

    const totalEl = document.getElementById('total-registros');
    if (totalEl) totalEl.textContent = `${count} registros`;
}

// ============================================
// INICIALIZAÇÃO DE TOOLTIPS
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Adicionar CSS para tooltips customizados
    if (!document.getElementById('tooltip-styles')) {
        const style = document.createElement('style');
        style.id = 'tooltip-styles';
        style.textContent = `
            /* Tooltips customizados */
            [data-tooltip] {
                position: relative;
            }

            [data-tooltip]::before,
            [data-tooltip]::after {
                position: absolute;
                opacity: 0;
                visibility: hidden;
                transition: all 0.2s ease;
                z-index: 10000;
                pointer-events: none;
            }

            [data-tooltip]::before {
                content: attr(data-tooltip);
                bottom: calc(100% + 8px);
                left: 50%;
                transform: translateX(-50%);
                padding: 8px 12px;
                background: #1e293b;
                color: white;
                font-size: 12px;
                font-weight: 500;
                border-radius: 6px;
                white-space: nowrap;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }

            [data-tooltip]::after {
                content: '';
                bottom: calc(100% + 2px);
                left: 50%;
                transform: translateX(-50%);
                border: 6px solid transparent;
                border-top-color: #1e293b;
            }

            [data-tooltip]:hover::before,
            [data-tooltip]:hover::after {
                opacity: 1;
                visibility: visible;
            }

            /* Tooltip para botões de ação */
            .btn[title],
            .btn-action[title],
            button[title] {
                position: relative;
            }

            /* Estilo nativo do title melhorado via CSS */
            .action-buttons .btn-action {
                position: relative;
            }
        `;
        document.head.appendChild(style);
    }

    // Converter atributos title para data-tooltip para tooltips customizados
    setTimeout(() => {
        document.querySelectorAll('.action-buttons button[title], .btn[title]').forEach(btn => {
            if (btn.title && !btn.dataset.tooltip) {
                btn.dataset.tooltip = btn.title;
                // Manter o title também para acessibilidade
            }
        });
    }, 1000);
});
