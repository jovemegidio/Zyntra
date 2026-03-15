/* ============================================
   PCP DASHBOARD JS - Funções do Dashboard
   ============================================ */

// Variáveis globais
let dashboardStats = {};
let ordensRecentes = [];
let estoqueCritico = [];

// Carregar estatísticas do dashboard
async function carregarEstatisticas() {
    try {
        const API_BASE = typeof getAPIBase === 'function' ? getAPIBase() : '';
        
        if (!token) {
            console.log('Token não encontrado para carregar estatísticas');
            dashboardStats = {
                totalProdutos: 0,
                ordensEmProducao: 0,
                estoqueBaixo: 0,
                totalMateriais: 0
            };
            atualizarCards();
            return;
        }
        
        const response = await fetch(`${API_BASE}/api/pcp/dashboard`, {
            credentials: 'include',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            console.log('Não autenticado');
            return;
        }
        
        if (response.ok) {
            dashboardStats = await response.json();
            atualizarCards();
        } else {
            // Fallback para dados zerados
            dashboardStats = {
                totalProdutos: 0,
                ordensEmProducao: 0,
                estoqueBaixo: 0,
                totalMateriais: 0
            };
            atualizarCards();
        }
    } catch (error) {
        console.error('Erro ao carregar estatísticas:', error);
        // Usar valores zerados em caso de erro
        dashboardStats = {
            totalProdutos: 0,
            ordensEmProducao: 0,
            estoqueBaixo: 0,
            totalMateriais: 0
        };
        atualizarCards();
    }
}

// Atualizar cards de estatísticas
function atualizarCards() {
    const statProdutos = document.getElementById('stat-produtos');
    const statOrdens = document.getElementById('stat-ordens');
    const statEstoqueBaixo = document.getElementById('stat-estoque-baixo');
    const statMateriais = document.getElementById('stat-materiais');
    
    if (statProdutos) statProdutos.textContent = dashboardStats.totalProdutos || 0;
    if (statOrdens) statOrdens.textContent = dashboardStats.ordensEmProducao || 0;
    if (statEstoqueBaixo) statEstoqueBaixo.textContent = dashboardStats.estoqueBaixo || 0;
    if (statMateriais) statMateriais.textContent = dashboardStats.totalMateriais || 0;
}

// Carregar ordens recentes
async function carregarOrdensRecentes() {
    try {
        const API_BASE = typeof getAPIBase === 'function' ? getAPIBase() : '';
        
        if (!token) {
            console.log('Token não encontrado para carregar ordens recentes');
            ordensRecentes = [];
            renderizarOrdensRecentes();
            return;
        }
        
        const response = await fetch(`${API_BASE}/api/pcp/ordens?limit=5&orderBy=created_at&order=DESC`, {
            credentials: 'include',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            console.log('Não autenticado');
            return;
        }
        
        if (response.ok) {
            ordensRecentes = await response.json();
            renderizarOrdensRecentes();
        } else {
            ordensRecentes = [];
            renderizarOrdensRecentes();
        }
    } catch (error) {
        console.error('Erro ao carregar ordens recentes:', error);
        ordensRecentes = [];
        renderizarOrdensRecentes();
    }
}

// Renderizar tabela de ordens recentes
function renderizarOrdensRecentes() {
    const tbody = document.getElementById('ordens-recentes-tbody');
    if (!tbody) return;
    
    if (ordensRecentes.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 40px;">
                    <i class="fas fa-clipboard-list" style="font-size: 32px; color: var(--gray-400); margin-bottom: 12px; display: block;"></i>
                    <p style="color: var(--gray-500);">Nenhuma ordem encontrada</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = ordensRecentes.map(ordem => `
        <tr>
            <td><strong>${ordem.numero_op || '#' + ordem.id}</strong></td>
            <td>${ordem.cliente || '-'}</td>
            <td>${ordem.produto || ordem.descricao || '-'}</td>
            <td>${renderizarStatusBadge(ordem.status)}</td>
            <td>${formatarData(ordem.created_at || ordem.data_criacao)}</td>
        </tr>
    `).join('');
}

// Carregar estoque crítico
async function carregarEstoqueCritico() {
    try {
        const API_BASE = typeof getAPIBase === 'function' ? getAPIBase() : '';
        
        if (!token) {
            console.log('Token não encontrado para carregar estoque crítico');
            return;
        }
        
        const response = await fetch(`${API_BASE}/api/pcp/produtos?estoque_critico=true&limit=5`, {
            credentials: 'include',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            console.log('Não autenticado');
            return;
        }
        
        if (response.ok) {
            estoqueCritico = await response.json();
            renderizarEstoqueCritico();
        } else {
            estoqueCritico = [];
            renderizarEstoqueCritico();
        }
    } catch (error) {
        console.error('Erro ao carregar estoque crítico:', error);
        estoqueCritico = [];
        renderizarEstoqueCritico();
    }
}

// Renderizar tabela de estoque crítico
function renderizarEstoqueCritico() {
    const tbody = document.getElementById('estoque-critico-tbody');
    if (!tbody) return;
    
    if (estoqueCritico.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 40px;">
                    <i class="fas fa-check-circle" style="font-size: 32px; color: #22c55e; margin-bottom: 12px; display: block;"></i>
                    <p style="color: var(--gray-500);">Nenhum produto com estoque crítico</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = estoqueCritico.map(produto => {
        const percentual = produto.estoque_minimo > 0 ? 
            Math.round((produto.estoque / produto.estoque_minimo) * 100) : 0;
        const statusClass = percentual < 50 ? 'danger' : 'warning';
        
        return `
            <tr>
                <td><strong>${produto.codigo || '-'}</strong></td>
                <td>${produto.nome || produto.descricao || '-'}</td>
                <td>${produto.estoque || 0}</td>
                <td>${produto.estoque_minimo || 0}</td>
                <td><span class="badge badge-${statusClass}">${percentual}%</span></td>
            </tr>
        `;
    }).join('');
}

// Renderizar badge de status
function renderizarStatusBadge(status) {
    const statusMap = {
        'pendente': { label: 'Pendente', class: 'warning' },
        'em_producao': { label: 'Em Produção', class: 'info' },
        'concluido': { label: 'Concluído', class: 'success' },
        'cancelado': { label: 'Cancelado', class: 'danger' },
        'aguardando': { label: 'Aguardando', class: 'secondary' }
    };
    
    const config = statusMap[status] || { label: status || '-', class: 'secondary' };
    return `<span class="badge badge-${config.class}">${config.label}</span>`;
}

// Formatar data (se não existir no pcp-common.js)
if (typeof formatarData !== 'function') {
    function formatarData(data) {
        if (!data) return '-';
        return new Date(data).toLocaleDateString('pt-BR');
    }
}

// Inicialização do Dashboard
function initDashboard() {
    // Carregar todos os dados
    carregarEstatisticas();
    carregarOrdensRecentes();
    carregarEstoqueCritico();
}

// Auto-inicializar quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
} else {
    // DOM já carregado
    initDashboard();
}
