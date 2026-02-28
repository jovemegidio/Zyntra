// API Compras - Integração com Backend
const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:${window.location.port || 3000}`;

// Obter token do localStorage ou cookie
function getAuthToken() {
    return localStorage.getItem('token') || getCookie('token');
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// Headers com autenticação
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
    };
}

// ========== FORNECEDORES ==========
async function listarFornecedores(filtros = {}) {
    try {
        const params = new URLSearchParams();
        if (filtros.search) params.append('search', filtros.search);
        if (filtros.ativo !== undefined) params.append('ativo', filtros.ativo);
        if (filtros.limit) params.append('limit', filtros.limit);
        if (filtros.offset) params.append('offset', filtros.offset);

        const url = `${API_BASE_URL}/api/compras/fornecedores?${params}`;
        const response = await fetch(url, {
            headers: getAuthHeaders()
        });

        if (!response.ok) throw new Error('Erro ao carregar fornecedores');
        return await response.json();
    } catch (error) {
        console.error('Erro ao listar fornecedores:', error);
        throw error;
    }
}

async function obterFornecedor(id) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/compras/fornecedores/${id}`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Fornecedor não encontrado');
        return await response.json();
    } catch (error) {
        console.error('Erro ao obter fornecedor:', error);
        throw error;
    }
}

async function criarFornecedor(dados) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/compras/fornecedores`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(dados)
        });
        if (!response.ok) throw new Error('Erro ao criar fornecedor');
        return await response.json();
    } catch (error) {
        console.error('Erro ao criar fornecedor:', error);
        throw error;
    }
}

async function atualizarFornecedor(id, dados) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/compras/fornecedores/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(dados)
        });
        if (!response.ok) throw new Error('Erro ao atualizar fornecedor');
        return await response.json();
    } catch (error) {
        console.error('Erro ao atualizar fornecedor:', error);
        throw error;
    }
}

async function excluirFornecedor(id) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/compras/fornecedores/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Erro ao excluir fornecedor');
        return await response.json();
    } catch (error) {
        console.error('Erro ao excluir fornecedor:', error);
        throw error;
    }
}

// ========== PEDIDOS ==========
async function listarPedidos(filtros = {}) {
    try {
        const params = new URLSearchParams();
        if (filtros.status) params.append('status', filtros.status);
        if (filtros.fornecedor_id) params.append('fornecedor_id', filtros.fornecedor_id);
        if (filtros.data_inicio) params.append('data_inicio', filtros.data_inicio);
        if (filtros.data_fim) params.append('data_fim', filtros.data_fim);
        if (filtros.limit) params.append('limit', filtros.limit);
        if (filtros.offset) params.append('offset', filtros.offset);

        const url = `${API_BASE_URL}/api/compras/pedidos?${params}`;
        const response = await fetch(url, {
            headers: getAuthHeaders()
        });

        if (!response.ok) throw new Error('Erro ao carregar pedidos');
        return await response.json();
    } catch (error) {
        console.error('Erro ao listar pedidos:', error);
        throw error;
    }
}

async function obterPedido(id) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/compras/pedidos/${id}`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Pedido não encontrado');
        return await response.json();
    } catch (error) {
        console.error('Erro ao obter pedido:', error);
        throw error;
    }
}

async function criarPedido(dados) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/compras/pedidos`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(dados)
        });
        if (!response.ok) throw new Error('Erro ao criar pedido');
        return await response.json();
    } catch (error) {
        console.error('Erro ao criar pedido:', error);
        throw error;
    }
}

async function aprovarPedido(id, dados) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/compras/pedidos/${id}/aprovar`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(dados)
        });
        if (!response.ok) throw new Error('Erro ao aprovar pedido');
        return await response.json();
    } catch (error) {
        console.error('Erro ao aprovar pedido:', error);
        throw error;
    }
}

async function cancelarPedido(id, motivo) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/compras/pedidos/${id}/cancelar`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ motivo })
        });
        if (!response.ok) throw new Error('Erro ao cancelar pedido');
        return await response.json();
    } catch (error) {
        console.error('Erro ao cancelar pedido:', error);
        throw error;
    }
}

async function receberPedido(id, dados) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/compras/pedidos/${id}/receber`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(dados)
        });
        if (!response.ok) throw new Error('Erro ao receber pedido');
        return await response.json();
    } catch (error) {
        console.error('Erro ao receber pedido:', error);
        throw error;
    }
}

// ========== DASHBOARD ==========
async function carregarDashboard() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/compras/dashboard`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Erro ao carregar dashboard');
        return await response.json();
    } catch (error) {
        console.error('Erro ao carregar dashboard:', error);
        throw error;
    }
}

async function carregarHistoricoPrecos(codigo_produto, fornecedor_id = null) {
    try {
        const params = new URLSearchParams({ codigo_produto });
        if (fornecedor_id) params.append('fornecedor_id', fornecedor_id);

        const url = `${API_BASE_URL}/api/compras/historico-precos?${params}`;
        const response = await fetch(url, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Erro ao carregar histórico de preços');
        return await response.json();
    } catch (error) {
        console.error('Erro ao carregar histórico de preços:', error);
        throw error;
    }
}

// ========== UI HELPERS ==========
function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(valor);
}

function formatarData(data) {
    return new Date(data).toLocaleDateString('pt-BR');
}

function formatarDataHora(data) {
    return new Date(data).toLocaleString('pt-BR');
}

function getStatusBadgeClass(status) {
    const classes = {
        'pendente': 'status-pendente',
        'aprovado': 'status-aprovado',
        'em_processo': 'status-processo',
        'recebido': 'status-entregue',
        'cancelado': 'status-cancelado',
        'parcialmente_recebido': 'status-parcial'
    };
    return classes[status] || 'status-pendente';
}

function getStatusLabel(status) {
    const labels = {
        'pendente': 'Pendente',
        'aprovado': 'Aprovado',
        'em_processo': 'Em Processo',
        'recebido': 'Recebido',
        'cancelado': 'Cancelado',
        'parcialmente_recebido': 'Parcialmente Recebido'
    };
    return labels[status] || status;
}

// ========== RENDERIZAÇáO ==========
async function renderizarDashboard() {
    try {
        const dados = await carregarDashboard();
        
        // Atualizar cards
        document.querySelector('.card-pedidos .card-value').textContent = dados.total_pedidos || 0;
        document.querySelector('.card-pendentes .card-value').textContent = 
            dados.pedidos_por_status.find(s => s.status === 'pendente')?.quantidade || 0;
        document.querySelector('.card-entregues .card-value').textContent = 
            dados.pedidos_por_status.find(s => s.status === 'recebido')?.quantidade || 0;
        document.querySelector('.card-valor .card-value').textContent = 
            formatarMoeda(dados.valor_total_pedidos || 0);

    } catch (error) {
        console.error('Erro ao renderizar dashboard:', error);
        mostrarNotificacao('Erro ao carregar dashboard', 'error');
    }
}

async function renderizarTabelaPedidos() {
    try {
        const { pedidos } = await listarPedidos({ limit: 10 });
        const tbody = document.querySelector('#pedidos-compras .compras-table tbody');
        
        if (!tbody) return;

        tbody.innerHTML = pedidos.map(pedido => `
            <tr>
                <td>${pedido.numero_pedido}</td>
                <td>${pedido.fornecedor_nome || 'N/A'}</td>
                <td>${formatarData(pedido.data_pedido)}</td>
                <td>${formatarMoeda(pedido.valor_total)}</td>
                <td><span class="status-badge ${getStatusBadgeClass(pedido.status)}">${getStatusLabel(pedido.status)}</span></td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn" onclick="verPedido(${pedido.id})" title="Ver">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="action-btn" onclick="editarPedido(${pedido.id})" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        ${pedido.status === 'pendente' ? `
                        <button class="action-btn" onclick="aprovarPedidoUI(${pedido.id})" title="Aprovar">
                            <i class="fas fa-check"></i>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Erro ao renderizar tabela de pedidos:', error);
    }
}

async function renderizarTabelaFornecedores() {
    try {
        const { fornecedores } = await listarFornecedores();
        const tbody = document.getElementById('fornecedores-list');
        
        if (!tbody) return;

        if (fornecedores.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 40px; color: #64748b;">
                        <i class="fas fa-box-open" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                        <p>Nenhum fornecedor cadastrado</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = fornecedores.map(f => `
            <tr>
                <td>#${f.id}</td>
                <td>
                    <strong>${f.razao_social || f.nome || 'N/A'}</strong>
                    ${f.nome_fantasia && f.nome_fantasia !== f.razao_social ? `<br><small style="color: #64748b;">${f.nome_fantasia}</small>` : ''}
                </td>
                <td>${f.cnpj || '-'}</td>
                <td>${f.telefone || '-'}</td>
                <td>${f.cidade || '-'}${f.estado ? `/${f.estado}` : ''}</td>
                <td><span class="status-badge ${f.ativo ? 'status-aprovado' : 'status-cancelado'}">${f.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td>
                    <div class="table-actions">
                        <button class="action-btn" onclick="verFornecedor(${f.id})" title="Ver">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="action-btn" onclick="editarFornecedor(${f.id})" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn" onclick="excluirFornecedorUI(${f.id})" title="Excluir" style="color: #dc2626;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Erro ao renderizar tabela de fornecedores:', error);
        const tbody = document.getElementById('fornecedores-list');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 40px; color: #dc2626;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px;"></i>
                        <p>Erro ao carregar fornecedores</p>
                        <button onclick="renderizarTabelaFornecedores()" style="margin-top: 16px;" class="btn btn-primary">
                            <i class="fas fa-sync"></i> Tentar novamente
                        </button>
                    </td>
                </tr>
            `;
        }
    }
}

// ========== AÇÕES DA UI ==========
async function verFornecedor(id) {
    try {
        const fornecedor = await obterFornecedor(id);
        console.log('Fornecedor:', fornecedor);
        alert(`Fornecedor: ${fornecedor.razao_social || fornecedor.nome}\nCNPJ: ${fornecedor.cnpj}\nTelefone: ${fornecedor.telefone || 'N/A'}`);
    } catch (error) {
        mostrarNotificacao('Erro ao carregar fornecedor', 'error');
    }
}

async function editarFornecedorUI(id) {
    try {
        const fornecedor = await obterFornecedor(id);
        // TODO: Abrir modal de edição
        console.log('Editar fornecedor:', fornecedor);
    } catch (error) {
        mostrarNotificacao('Erro ao carregar fornecedor', 'error');
    }
}

async function excluirFornecedorUI(id) {
    if (!confirm('Deseja realmente excluir este fornecedor?')) return;
    
    try {
        await excluirFornecedor(id);
        mostrarNotificacao('Fornecedor excluído com sucesso!', 'success');
        await renderizarTabelaFornecedores();
    } catch (error) {
        mostrarNotificacao('Erro ao excluir fornecedor', 'error');
    }
}

async function verPedido(id) {
    try {
        const pedido = await obterPedido(id);
        // TODO: Abrir modal com detalhes do pedido
        console.log('Pedido:', pedido);
    } catch (error) {
        mostrarNotificacao('Erro ao carregar pedido', 'error');
    }
}

async function editarPedido(id) {
    try {
        const pedido = await obterPedido(id);
        // TODO: Abrir modal de edição
        console.log('Editar pedido:', pedido);
    } catch (error) {
        mostrarNotificacao('Erro ao carregar pedido', 'error');
    }
}

async function aprovarPedidoUI(id) {
    if (!confirm('Deseja aprovar este pedido?')) return;
    
    try {
        await aprovarPedido(id, {
            aprovador_id: null, // Será obtido do token no backend
            observacoes: 'Aprovado via sistema'
        });
        mostrarNotificacao('Pedido aprovado com sucesso!', 'success');
        await renderizarTabelaPedidos();
        await renderizarDashboard();
    } catch (error) {
        mostrarNotificacao('Erro ao aprovar pedido', 'error');
    }
}

function mostrarNotificacao(mensagem, tipo = 'info') {
    // TODO: Implementar sistema de notificações
    console.log(`[${tipo.toUpperCase()}] ${mensagem}`);
    alert(mensagem);
}

// ========== INICIALIZAÇáO ==========
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 API Compras carregada');
    
    // Verificar autenticação
    if (!getAuthToken()) {
        console.warn('Token não encontrado. Usuário precisa fazer login.');
        // return;
    }

    // Carregar dados iniciais
    try {
        await renderizarDashboard();
        await renderizarTabelaPedidos();
        console.log('✅ Dashboard carregado com sucesso');
    } catch (error) {
        console.error('❌ Erro ao carregar dados iniciais:', error);
    }

    // Observer para detectar quando a página de fornecedores é aberta
    const observarPaginaFornecedores = () => {
        const fornecedoresPage = document.getElementById('fornecedores-page');
        if (!fornecedoresPage) return;

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'style') {
                    const isVisible = fornecedoresPage.style.display !== 'none';
                    if (isVisible) {
                        console.log('📋 Carregando fornecedores...');
                        renderizarTabelaFornecedores();
                    }
                }
            });
        });

        observer.observe(fornecedoresPage, { attributes: true });
    };

    // Iniciar observação após um pequeno delay
    setTimeout(observarPaginaFornecedores, 500);
});
