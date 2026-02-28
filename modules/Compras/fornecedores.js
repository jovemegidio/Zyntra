/**
 * GESTáO DE FORNECEDORES - ALUFORCE
 * Sistema completo de cadastro e gestão de fornecedores
 */

class FornecedoresManager {
    constructor() {
        this.fornecedores = [];
        this.filtroAtual = 'todos';
        this.termoBusca = '';
        this.viewMode = 'list';
        this.init();
    }

    async init() {
        await this.carregarFornecedores();
        this.renderizarTabela();
        this.inicializarUsuario();
    }

    getAuthToken() {
        return localStorage.getItem('token') || this.getCookie('token');
    }

    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    async carregarFornecedores() {
        try {
            const token = this.getAuthToken();
            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            const response = await fetch('/api/compras/fornecedores', { headers });
            if (!response.ok) throw new Error('Erro ao carregar fornecedores');
            
            const data = await response.json();
            console.log('[Fornecedores] Dados recebidos da API:', data);
            
            // Garantir que temos um array
            let fornecedoresArray = [];
            if (Array.isArray(data)) {
                fornecedoresArray = data;
            } else if (data && data.fornecedores && Array.isArray(data.fornecedores)) {
                fornecedoresArray = data.fornecedores;
            } else if (data && data.data && Array.isArray(data.data)) {
                fornecedoresArray = data.data;
            }
            
            console.log('[Fornecedores] Array de fornecedores:', fornecedoresArray.length, 'registros');
            
            // Mapear dados do banco para o formato esperado
            this.fornecedores = fornecedoresArray.map(f => ({
                id: f.id,
                nome: f.razao_social || f.nome_fantasia || f.nome || 'Sem nome',
                nomeFantasia: f.nome_fantasia || '',
                cnpj: f.cnpj || '',
                categoria: f.categoria || 'Geral',
                contato: f.telefone || f.contato || '',
                email: f.email || '',
                cidade: f.cidade || '',
                estado: f.estado || f.uf || '',
                endereco: f.endereco || '',
                cep: f.cep || '',
                contatoPrincipal: f.contato_principal || '',
                condicoesPagamento: f.condicoes_pagamento || '',
                prazoEntrega: f.prazo_entrega_padrao || 0,
                observacoes: f.observacoes || '',
                pedidos: f.total_pedidos || 0,
                totalComprado: f.valor_total_compras || 0,
                avaliacao: parseFloat(f.avaliacao) || 4.0,
                status: f.ativo == 1 || f.ativo === true || f.ativo === 'true' || f.ativo === '1' ? 'ativo' : 'inativo',
                ultimaCompra: f.ultima_compra || null,
                dataCadastro: f.data_cadastro || f.created_at || null
            }));
            
            console.log('[Fornecedores] Fornecedores mapeados:', this.fornecedores.length);
            
            this.atualizarEstatisticas();
        } catch (error) {
            console.error('Erro ao carregar fornecedores:', error);
            this.fornecedores = [];
            this.atualizarEstatisticas();
        }
    }
    
    atualizarEstatisticas() {
        const total = this.fornecedores.length;
        const ativos = this.fornecedores.filter(f => f.status === 'ativo').length;
        const inativos = this.fornecedores.filter(f => f.status === 'inativo').length;
        
        // Calcular novos do mês
        const inicioMes = new Date();
        inicioMes.setDate(1);
        inicioMes.setHours(0, 0, 0, 0);
        const novos = this.fornecedores.filter(f => {
            if (!f.dataCadastro) return false;
            return new Date(f.dataCadastro) >= inicioMes;
        }).length;
        
        // Avaliação média
        const comAvaliacao = this.fornecedores.filter(f => f.avaliacao > 0);
        const mediaAvaliacao = comAvaliacao.length > 0 
            ? (comAvaliacao.reduce((sum, f) => sum + f.avaliacao, 0) / comAvaliacao.length).toFixed(1)
            : '0.0';
        
        // Atualizar DOM
        const elTotal = document.getElementById('totalFornecedores');
        const elAtivos = document.getElementById('fornecedoresAtivos');
        const elNovos = document.getElementById('fornecedoresNovos');
        const elAvaliacao = document.getElementById('avaliacaoMedia');
        
        if (elTotal) elTotal.textContent = total;
        if (elAtivos) elAtivos.textContent = ativos;
        if (elNovos) elNovos.textContent = novos;
        if (elAvaliacao) elAvaliacao.textContent = mediaAvaliacao;
    }

    renderizarTabela() {
        const tbody = document.getElementById('fornecedoresTableBody');
        if (!tbody) return;

        const fornecedoresFiltrados = this.filtrarFornecedoresPorStatus();
        
        if (fornecedoresFiltrados.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: #666;">
                        <i class="fas fa-users" style="font-size: 48px; color: #ddd; margin-bottom: 16px; display: block;"></i>
                        Nenhum fornecedor encontrado
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = fornecedoresFiltrados.map(forn => {
            const cidadeUF = forn.cidade && forn.estado ? `${forn.cidade}/${forn.estado}` : (forn.cidade || forn.estado || '-');
            
            return `
            <tr>
                <td><input type="checkbox" class="row-checkbox" data-id="${forn.id}" title="Selecionar"></td>
                <td><strong>${this.escapeHtml(forn.nome)}</strong></td>
                <td><span class="cnpj-text">${this.formatarCNPJ(forn.cnpj)}</span></td>
                <td>${this.escapeHtml(forn.contato) || '-'}</td>
                <td>${this.escapeHtml(cidadeUF)}</td>
                <td><span class="badge badge-${this.getCategoriaColor(forn.categoria)}">${this.escapeHtml(forn.categoria)}</span></td>
                <td><span class="status-badge ${forn.status}">${this.getStatusLabel(forn.status)}</span></td>
                <td>
                    <button class="btn-action view" title="Ver detalhes" onclick="fornecedoresManager.verDetalhes(${forn.id})"><i class="fas fa-eye"></i></button>
                    <button class="btn-action edit" title="Editar" onclick="fornecedoresManager.editar(${forn.id})"><i class="fas fa-edit"></i></button>
                    <button class="btn-action delete" title="Excluir" onclick="fornecedoresManager.excluir(${forn.id})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `}).join('');
        
        // Atualizar info de paginação
        const paginationInfo = document.querySelector('.pagination-info');
        if (paginationInfo) {
            paginationInfo.innerHTML = `Mostrando <strong>1-${fornecedoresFiltrados.length}</strong> de <strong>${this.fornecedores.length}</strong>`;
        }
    }
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    formatarCNPJ(cnpj) {
        if (!cnpj) return '-';
        // Se já formatado, retorna
        if (cnpj.includes('.') || cnpj.includes('/')) return cnpj;
        // Formatar: 00.000.000/0000-00
        const clean = cnpj.replace(/\D/g, '');
        if (clean.length !== 14) return cnpj;
        return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }

    renderizarEstrelas(avaliacao) {
        const estrelas = Math.floor(avaliacao);
        const meia = avaliacao % 1 >= 0.5;
        let html = '';
        
        for (let i = 0; i < estrelas; i++) {
            html += '<i class="fas fa-star"></i>';
        }
        if (meia) {
            html += '<i class="fas fa-star-half-alt"></i>';
        }
        for (let i = estrelas + (meia ? 1 : 0); i < 5; i++) {
            html += '<i class="far fa-star"></i>';
        }
        
        return html;
    }

    getCategoriaColor(categoria) {
        const cores = {
            'Matéria Prima': 'blue',
            'Componentes': 'purple',
            'Embalagens': 'green',
            'Ferramentas': 'orange',
            'Químicos': 'red',
            'Logística': 'gray'
        };
        return cores[categoria] || 'gray';
    }

    getStatusLabel(status) {
        const labels = {
            'premium': 'Premium',
            'ativo': 'Ativo',
            'inativo': 'Inativo'
        };
        return labels[status] || status;
    }

    filtrarFornecedoresPorStatus() {
        let resultado = this.fornecedores;
        
        // Filtrar por status
        if (this.filtroAtual !== 'todos') {
            resultado = resultado.filter(f => f.status === this.filtroAtual);
        }
        
        // Filtrar por termo de busca
        if (this.termoBusca && this.termoBusca.length > 0) {
            const termo = this.termoBusca.toLowerCase();
            resultado = resultado.filter(f => 
                (f.nome && f.nome.toLowerCase().includes(termo)) ||
                (f.nomeFantasia && f.nomeFantasia.toLowerCase().includes(termo)) ||
                (f.cnpj && f.cnpj.includes(termo)) ||
                (f.email && f.email.toLowerCase().includes(termo)) ||
                (f.cidade && f.cidade.toLowerCase().includes(termo))
            );
        }
        
        return resultado;
    }

    verDetalhes(id) {
        if (typeof visualizarFornecedorModal === 'function') {
            visualizarFornecedorModal(id);
        }
    }

    editar(id) {
        if (typeof editarFornecedorModal === 'function') {
            editarFornecedorModal(id);
        }
    }

    excluir(id) {
        if (typeof excluirFornecedorAPI === 'function') {
            excluirFornecedorAPI(id);
        }
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

        if (userRole) {
            userRole.textContent = usuario.cargo;
        }

        if (userAvatar && usuario.avatar) {
            userAvatar.innerHTML = `<img src="${usuario.avatar}" alt="${usuario.nome}">`;
        }
    }

    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor);
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
        // Implementar vista em grade
    } else {
        btnList.classList.add('active');
        btnGrid.classList.remove('active');
        // Vista em lista (padrão)
    }
}

function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    if (!menu) return;
    menu.classList.toggle('show');
}

function filterByStatus(status, evt) {
    fornecedoresManager.filtroAtual = status;
    fornecedoresManager.renderizarTabela();
    
    // Atualizar botões ativos
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const e = evt || window.event;
    if (e && e.target) {
        const btn = e.target.closest('.filter-btn');
        if (btn) btn.classList.add('active');
    }
}

function filtrarFornecedores() {
    const searchTerm = document.getElementById('searchFornecedor').value.toLowerCase();
    const rows = document.querySelectorAll('#fornecedoresTableBody tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
}

function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
}

function openNovoFornecedorModal() {
    alert('Abrir modal de novo fornecedor\n\nFuncionalidade em desenvolvimento.');
}

function exportarFornecedores() {
    alert('Exportar fornecedores\n\nFuncionalidade em desenvolvimento.');
}

// Inicializar ao carregar a página
let fornecedoresManager;
document.addEventListener('DOMContentLoaded', () => {
    fornecedoresManager = new FornecedoresManager();
    
    // Verificar dark mode salvo
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('btnModoEscuro');
        if (btn) btn.querySelector('i').className = 'fas fa-sun';
    }
});

// Fechar menu ao clicar fora
document.addEventListener('click', (e) => {
    const userProfile = document.querySelector('.user-profile');
    const userMenu = document.getElementById('userMenu');
    if (userMenu && !userProfile.contains(e.target)) {
        userMenu.classList.remove('show');
    }
});
