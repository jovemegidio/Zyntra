// ========================================
// MATERIAIS MANAGER - VERSÍO COM API REAL
// Sistema de Gestão de Materiais - ALUFORCE
// ========================================

class MateriaisManager {
    constructor() {
        this.materiais = [];
        this.materiaisFiltrados = [];
        this.fornecedores = [];
        this.categorias = [];
        this.paginaAtual = 1;
        this.itensPorPagina = 20;
        this.statusFiltro = 'todos';
        this.categoriaSelecionada = 'todos';
        this.termoBusca = '';
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
        await this.carregarDados();
        await this.carregarFornecedores();
        await this.carregarCategorias();
        this.configurarEventos();
        this.atualizarCards();
        this.renderizarTabela();
        this.preencherFiltrosCategorias();
        inicializarUsuario();
    }

    async carregarDados() {
        try {
            const response = await fetch('/api/compras/materiais', {
                headers: this.getAuthHeaders()
            });
            if (!response.ok) throw new Error('Erro ao carregar materiais');
            
            const data = await response.json();
            this.materiais = data.map(m => ({
                id: m.id,
                codigo: m.codigo,
                descricao: m.descricao,
                categoria: m.categoria || 'Geral',
                unidade: m.unidade || 'UN',
                especificacoes: m.especificacoes || '',
                ncm: m.ncm || '',
                cest: m.cest || '',
                codigoBarras: m.codigo_barras || '',
                estoqueMin: m.estoque_min || 0,
                estoqueMax: m.estoque_max || 0,
                estoqueAtual: m.estoque_atual || 0,
                leadTime: m.lead_time || 0,
                fornecedorId: m.fornecedor_id,
                fornecedorNome: m.fornecedor_nome || '',
                ultimoPreco: parseFloat(m.ultimo_preco) || 0,
                ativo: m.ativo == 1,
                sincPCP: m.sinc_pcp == 1,
                observacoes: m.observacoes || '',
                dataCadastro: m.data_cadastro,
                status: m.status || 'disponivel'
            }));
            
            this.materiaisFiltrados = [...this.materiais];
        } catch (error) {
            console.error('Erro ao carregar materiais:', error);
            this.materiais = [];
            this.materiaisFiltrados = [];
        }
    }

    async carregarFornecedores() {
        try {
            const response = await fetch('/api/compras/fornecedores?ativo=1', {
                headers: this.getAuthHeaders()
            });
            if (response.ok) {
                const data = await response.json();
                // Verificar se é array ou objeto com propriedade de dados
                this.fornecedores = Array.isArray(data) ? data : (data.data || data.fornecedores || []);
                this.preencherSelectFornecedores();
            }
        } catch (error) {
            console.error('Erro ao carregar fornecedores:', error);
            this.fornecedores = [];
        }
    }

    async carregarCategorias() {
        try {
            const response = await fetch('/api/compras/materiais-categorias', {
                headers: this.getAuthHeaders()
            });
            if (response.ok) {
                this.categorias = await response.json();
            }
        } catch (error) {
            console.error('Erro ao carregar categorias:', error);
            this.categorias = ['Matéria Prima', 'Componentes', 'Embalagens', 'Ferramentas', 'Químicos', 'Fixação', 'Vidros', 'Borrachas', 'Pintura'];
        }
    }

    preencherSelectFornecedores() {
        const select = document.getElementById('materialFornecedor');
        if (!select) return;
        
        select.innerHTML = '<option value="">Selecione...</option>';
        if (Array.isArray(this.fornecedores)) {
            this.fornecedores.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.id;
                opt.textContent = f.razao_social || f.nome_fantasia || f.nome;
                select.appendChild(opt);
            });
        }
    }

    preencherFiltrosCategorias() {
        const selectCategoria = document.getElementById('filterCategoria');
        if (!selectCategoria) return;
        
        selectCategoria.innerHTML = '<option value="todos">Todas</option>';
        this.categorias.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            selectCategoria.appendChild(opt);
        });
    }

    configurarEventos() {
        // Botão Novo Material
        const btnNovo = document.querySelector('.btn-primary');
        if (btnNovo && btnNovo.innerHTML.includes('Novo Material')) {
            btnNovo.addEventListener('click', () => this.abrirModalNovo());
        }

        // Botão Exportar
        const btnExportar = document.querySelector('.btn-secondary');
        if (btnExportar && btnExportar.innerHTML.includes('Exportar')) {
            btnExportar.addEventListener('click', () => this.exportar());
        }

        // Event delegation para botões de ação na tabela (CSP compliance)
        const tbody = document.getElementById('materiaisTableBody');
        if (tbody) {
            tbody.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-action');
                if (!btn) return;
                
                const tr = btn.closest('tr');
                const checkbox = tr?.querySelector('.material-checkbox');
                const id = checkbox?.dataset?.id;
                
                if (!id) return;
                
                if (btn.classList.contains('view')) {
                    this.visualizar(parseInt(id));
                } else if (btn.classList.contains('edit')) {
                    this.editar(parseInt(id));
                } else if (btn.classList.contains('delete')) {
                    this.excluir(parseInt(id));
                }
            });
        }

        // Event delegation para modais (CSP compliance)
        document.addEventListener('click', (e) => {
            if (e.target.closest('.modal-close')) {
                const modal = e.target.closest('.modal-overlay');
                if (modal) modal.style.display = 'none';
            }
        });

        // Botões específicos dos modais (CSP compliance)
        const btnFecharModal = document.getElementById('btnFecharModalMaterial');
        if (btnFecharModal) {
            btnFecharModal.addEventListener('click', () => this.fecharModal());
        }

        const btnCancelar = document.getElementById('btnCancelarMaterial');
        if (btnCancelar) {
            btnCancelar.addEventListener('click', () => this.fecharModal());
        }

        const btnSalvar = document.getElementById('btnSalvarMaterial');
        if (btnSalvar) {
            btnSalvar.addEventListener('click', () => this.salvar());
        }

        const btnFecharVisualizar = document.getElementById('btnFecharModalVisualizar');
        if (btnFecharVisualizar) {
            btnFecharVisualizar.addEventListener('click', () => this.fecharModalVisualizar());
        }

        // Campo de busca
        const searchInput = document.querySelector('.search-box input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.termoBusca = e.target.value;
                this.filtrar();
            });
        }

        // Botões de filtro por status
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const texto = btn.textContent.toLowerCase();
                if (texto.includes('todos')) this.statusFiltro = 'todos';
                else if (texto.includes('disponíveis') || texto.includes('disponiveis')) this.statusFiltro = 'disponivel';
                else if (texto.includes('baixo')) this.statusFiltro = 'baixo';
                else if (texto.includes('críticos') || texto.includes('criticos')) this.statusFiltro = 'critico';
                
                this.paginaAtual = 1;
                this.filtrar();
            });
        });
    }

    filtrar() {
        this.materiaisFiltrados = this.materiais.filter(m => {
            // Filtro por status
            if (this.statusFiltro !== 'todos' && m.status !== this.statusFiltro) {
                return false;
            }

            // Filtro por categoria
            if (this.categoriaSelecionada !== 'todos' && m.categoria !== this.categoriaSelecionada) {
                return false;
            }

            // Filtro por busca
            if (this.termoBusca) {
                const termo = this.termoBusca.toLowerCase();
                return (
                    m.codigo.toLowerCase().includes(termo) ||
                    m.descricao.toLowerCase().includes(termo) ||
                    (m.fornecedorNome && m.fornecedorNome.toLowerCase().includes(termo))
                );
            }

            return true;
        });

        this.paginaAtual = 1;
        this.renderizarTabela();
    }

    atualizarCards() {
        const total = this.materiais.length;
        const disponiveis = this.materiais.filter(m => m.status === 'disponivel').length;
        const baixo = this.materiais.filter(m => m.status === 'baixo').length;
        const criticos = this.materiais.filter(m => m.status === 'critico').length;

        document.getElementById('totalMateriais').textContent = total;
        document.getElementById('materiaisDisponiveis').textContent = disponiveis;
        document.getElementById('materiaisBaixo').textContent = baixo;
        document.getElementById('materiaisCriticos').textContent = criticos;
    }

    renderizarTabela() {
        const tbody = document.getElementById('materiaisTableBody');
        if (!tbody) return;

        const inicio = (this.paginaAtual - 1) * this.itensPorPagina;
        const fim = inicio + this.itensPorPagina;
        const materiaisPagina = this.materiaisFiltrados.slice(inicio, fim);

        if (materiaisPagina.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 40px; color: #666;">
                        <i class="fas fa-cubes" style="font-size: 48px; color: #ddd; margin-bottom: 16px; display: block;"></i>
                        Nenhum material encontrado
                    </td>
                </tr>
            `;
            this.atualizarPaginacao(0);
            return;
        }

        tbody.innerHTML = materiaisPagina.map(m => {
            const statusClass = m.status === 'disponivel' ? 'disponivel' : (m.status === 'baixo' ? 'baixo' : 'critico');
            const statusLabel = m.status === 'disponivel' ? 'Disponível' : (m.status === 'baixo' ? 'Estoque Baixo' : 'Crítico');
            
            return `
            <tr>
                <td><input type="checkbox" class="material-checkbox" data-id="${m.id}"></td>
                <td><strong>${this.escapeHtml(m.codigo)}</strong></td>
                <td>${this.escapeHtml(m.descricao)}</td>
                <td>${this.escapeHtml(m.categoria)}</td>
                <td>${this.escapeHtml(m.unidade)}</td>
                <td>${this.formatarNumero(m.estoqueAtual)}</td>
                <td>${this.formatarNumero(m.estoqueMin)}</td>
                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td>
                    <button class="btn-action view" title="Ver detalhes" data-id="${m.id}"><i class="fas fa-eye"></i></button>
                    <button class="btn-action edit" title="Editar" data-id="${m.id}"><i class="fas fa-edit"></i></button>
                    <button class="btn-action delete" title="Excluir" data-id="${m.id}"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `}).join('');

        this.atualizarPaginacao(this.materiaisFiltrados.length);
    }

    atualizarPaginacao(total) {
        const totalPaginas = Math.ceil(total / this.itensPorPagina);
        const inicio = ((this.paginaAtual - 1) * this.itensPorPagina) + 1;
        const fim = Math.min(this.paginaAtual * this.itensPorPagina, total);

        const paginationInfo = document.querySelector('.pagination-info');
        if (paginationInfo) {
            paginationInfo.innerHTML = total > 0 
                ? `Mostrando <strong>${inicio}-${fim}</strong> de <strong>${total}</strong>`
                : 'Nenhum registro';
        }

        const controls = document.querySelector('.pagination-controls');
        if (!controls) return;

        controls.innerHTML = '';

        const btnPrev = document.createElement('button');
        btnPrev.className = 'pagination-btn';
        btnPrev.innerHTML = '<i class="fas fa-chevron-left"></i>';
        btnPrev.disabled = this.paginaAtual === 1;
        btnPrev.onclick = () => {
            if (this.paginaAtual > 1) {
                this.paginaAtual--;
                this.renderizarTabela();
            }
        };
        controls.appendChild(btnPrev);

        for (let i = 1; i <= Math.min(totalPaginas, 5); i++) {
            const btnPage = document.createElement('button');
            btnPage.className = 'pagination-btn' + (i === this.paginaAtual ? ' active' : '');
            btnPage.textContent = i;
            btnPage.onclick = () => {
                this.paginaAtual = i;
                this.renderizarTabela();
            };
            controls.appendChild(btnPage);
        }

        const btnNext = document.createElement('button');
        btnNext.className = 'pagination-btn';
        btnNext.innerHTML = '<i class="fas fa-chevron-right"></i>';
        btnNext.disabled = this.paginaAtual === totalPaginas || totalPaginas === 0;
        btnNext.onclick = () => {
            if (this.paginaAtual < totalPaginas) {
                this.paginaAtual++;
                this.renderizarTabela();
            }
        };
        controls.appendChild(btnNext);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatarNumero(num) {
        if (typeof num !== 'number') return num;
        return num.toLocaleString('pt-BR');
    }

    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
    }

    abrirModalNovo() {
        document.getElementById('modalTitle').textContent = 'Novo Material';
        document.getElementById('formMaterial').reset();
        document.getElementById('materialId').value = '';
        document.getElementById('materialAtivo').checked = true;
        document.getElementById('modalMaterial').style.display = 'flex';
    }

    async editar(id) {
        try {
            const response = await fetch(`/api/compras/materiais/${id}`, {
                headers: this.getAuthHeaders()
            });
            if (!response.ok) throw new Error('Material não encontrado');
            
            const m = await response.json();

            document.getElementById('modalTitle').textContent = 'Editar Material';
            document.getElementById('materialId').value = m.id;
            document.getElementById('materialCodigo').value = m.codigo || '';
            document.getElementById('materialDescricao').value = m.descricao || '';
            document.getElementById('materialCategoria').value = m.categoria || '';
            document.getElementById('materialUnidade').value = m.unidade || '';
            document.getElementById('materialEspecificacao').value = m.especificacoes || '';
            document.getElementById('materialNCM').value = m.ncm || '';
            document.getElementById('materialCEST').value = m.cest || '';
            document.getElementById('materialCodigoBarras').value = m.codigo_barras || '';
            document.getElementById('materialEstoqueMin').value = m.estoque_min || '';
            document.getElementById('materialEstoqueMax').value = m.estoque_max || '';
            document.getElementById('materialEstoqueAtual').value = m.estoque_atual || '';
            document.getElementById('materialLeadTime').value = m.lead_time || '';
            document.getElementById('materialFornecedor').value = m.fornecedor_id || '';
            document.getElementById('materialUltimoPreco').value = m.ultimo_preco || '';
            document.getElementById('materialAtivo').checked = m.ativo == 1;
            document.getElementById('materialPCP').checked = m.sinc_pcp == 1;
            document.getElementById('materialObservacoes').value = m.observacoes || '';

            document.getElementById('modalMaterial').style.display = 'flex';
        } catch (error) {
            console.error('Erro ao carregar material:', error);
            alert('Erro ao carregar dados do material');
        }
    }

    async visualizar(id) {
        try {
            const response = await fetch(`/api/compras/materiais/${id}`, {
                headers: this.getAuthHeaders()
            });
            if (!response.ok) throw new Error('Material não encontrado');
            
            const m = await response.json();
            
            // Guardar material atual para funções auxiliares
            window.materialAtualVisualizacao = m;
            
            // Preencher header do modal
            document.getElementById('viewMaterialTitulo').textContent = m.descricao;
            document.getElementById('viewMaterialCodigo').textContent = m.codigo;
            
            // Preencher cards de estoque no header
            document.getElementById('viewEstoqueAtual').textContent = `${parseFloat(m.estoque_atual || 0).toLocaleString('pt-BR')} ${m.unidade || ''}`;
            document.getElementById('viewEstoqueMin').textContent = `${parseFloat(m.estoque_min || 0).toLocaleString('pt-BR')} ${m.unidade || ''}`;
            document.getElementById('viewEstoqueMax').textContent = `${parseFloat(m.estoque_max || 0).toLocaleString('pt-BR')} ${m.unidade || ''}`;
            document.getElementById('viewUltimoPreco').textContent = this.formatarMoeda(m.ultimo_preco || 0);
            
            // Aba Geral
            document.getElementById('viewDescricao').textContent = m.descricao || '-';
            document.getElementById('viewCategoria').textContent = m.categoria || '-';
            document.getElementById('viewUnidade').textContent = m.unidade || '-';
            document.getElementById('viewLeadTime').textContent = m.lead_time ? `${m.lead_time} dias` : '-';
            document.getElementById('viewEspecificacoes').textContent = m.especificacoes || '-';
            document.getElementById('viewObservacoes').textContent = m.observacoes || '-';
            
            // Status badge
            const statusEl = document.getElementById('viewStatusBadge');
            if (m.estoque_atual === 0 || m.estoque_atual < m.estoque_min) {
                statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Estoque Crítico';
                statusEl.style.background = '#fee2e2';
                statusEl.style.color = '#991b1b';
            } else if (m.estoque_atual <= m.estoque_min * 1.5) {
                statusEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Estoque Baixo';
                statusEl.style.background = '#fef3c7';
                statusEl.style.color = '#92400e';
            } else {
                statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Disponível';
                statusEl.style.background = '#dcfce7';
                statusEl.style.color = '#166534';
            }
            
            // Sincronização PCP
            const sincPCPEl = document.getElementById('viewSincPCP');
            if (m.sinc_pcp) {
                sincPCPEl.style.display = 'inline-flex';
            } else {
                sincPCPEl.style.display = 'none';
            }
            
            // Aba Fiscal
            document.getElementById('viewNCM').textContent = m.ncm || '-';
            document.getElementById('viewCEST').textContent = m.cest || '-';
            document.getElementById('viewCodigoBarras').textContent = m.codigo_barras || '-';
            document.getElementById('viewOrigem').textContent = '0 - Nacional';
            
            // Aba Fornecedor
            document.getElementById('viewFornecedorNome').textContent = m.fornecedor_nome || 'Não definido';
            document.getElementById('viewFornecedorCNPJ').textContent = m.fornecedor_cnpj || '-';
            document.getElementById('viewFornecedorTelefone').textContent = m.fornecedor_telefone || '-';
            document.getElementById('viewFornecedorEmail').textContent = m.fornecedor_email || '-';
            document.getElementById('viewFornecedorPrazo').textContent = m.lead_time ? `${m.lead_time} dias úteis` : '-';
            
            // Resetar para aba geral
            mudarAbaVisualizacao('geral');
            
            document.getElementById('modalVisualizarMaterial').style.display = 'flex';
        } catch (error) {
            console.error('Erro ao visualizar material:', error);
            alert('Erro ao carregar detalhes do material');
        }
    }

    async excluir(id) {
        if (!confirm('Deseja realmente excluir este material?')) return;
        
        try {
            const response = await fetch(`/api/compras/materiais/${id}`, {
                method: 'DELETE',
                headers: this.getAuthHeaders()
            });
            if (!response.ok) throw new Error('Erro ao excluir');
            
            alert('Material desativado com sucesso!');
            await this.carregarDados();
            this.atualizarCards();
            this.renderizarTabela();
        } catch (error) {
            console.error('Erro ao excluir material:', error);
            alert('Erro ao excluir material');
        }
    }

    async salvar() {
        const id = document.getElementById('materialId').value;
        const dados = {
            codigo: document.getElementById('materialCodigo').value,
            descricao: document.getElementById('materialDescricao').value,
            categoria: document.getElementById('materialCategoria').value,
            unidade: document.getElementById('materialUnidade').value,
            especificacoes: document.getElementById('materialEspecificacao').value,
            ncm: document.getElementById('materialNCM').value,
            cest: document.getElementById('materialCEST').value,
            codigo_barras: document.getElementById('materialCodigoBarras').value,
            estoque_min: parseFloat(document.getElementById('materialEstoqueMin').value) || 0,
            estoque_max: parseFloat(document.getElementById('materialEstoqueMax').value) || 0,
            estoque_atual: parseFloat(document.getElementById('materialEstoqueAtual').value) || 0,
            lead_time: parseInt(document.getElementById('materialLeadTime').value) || 0,
            fornecedor_id: document.getElementById('materialFornecedor').value || null,
            ultimo_preco: parseFloat(document.getElementById('materialUltimoPreco').value) || 0,
            ativo: document.getElementById('materialAtivo').checked ? 1 : 0,
            sinc_pcp: document.getElementById('materialPCP').checked ? 1 : 0,
            observacoes: document.getElementById('materialObservacoes').value
        };

        if (!dados.codigo || !dados.descricao) {
            alert('Código e descrição são obrigatórios!');
            return;
        }

        try {
            const url = id ? `/api/compras/materiais/${id}` : '/api/compras/materiais';
            const method = id ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method,
                headers: this.getAuthHeaders(),
                body: JSON.stringify(dados)
            });

            const result = await response.json();
            
            if (response.ok) {
                alert(id ? 'Material atualizado com sucesso!' : 'Material cadastrado com sucesso!');
                this.fecharModal();
                await this.carregarDados();
                this.atualizarCards();
                this.renderizarTabela();
            } else {
                alert(result.message || 'Erro ao salvar material');
            }
        } catch (error) {
            console.error('Erro ao salvar material:', error);
            alert('Erro ao salvar material');
        }
    }

    fecharModal() {
        document.getElementById('modalMaterial').style.display = 'none';
    }

    fecharModalVisualizar() {
        document.getElementById('modalVisualizarMaterial').style.display = 'none';
    }

    exportar() {
        const headers = ['Código', 'Descrição', 'Categoria', 'Unidade', 'Último Preço', 'Estoque Atual', 'Estoque Mín', 'Fornecedor', 'Status'];
        const csv = [
            headers.join(';'),
            ...this.materiaisFiltrados.map(m => [
                m.codigo,
                m.descricao,
                m.categoria,
                m.unidade,
                m.ultimoPreco,
                m.estoqueAtual,
                m.estoqueMin,
                m.fornecedorNome,
                m.status === 'disponivel' ? 'Disponível' : (m.status === 'baixo' ? 'Estoque Baixo' : 'Crítico')
            ].join(';'))
        ].join('\n');

        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `materiais_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    }
}

// Função de inicialização do usuário
function inicializarUsuario() {
    const agora = new Date();
    const hora = agora.getHours();
    let saudacao = 'Bom dia';
    
    if (hora >= 5 && hora < 12) saudacao = 'Bom dia';
    else if (hora >= 12 && hora < 18) saudacao = 'Boa tarde';
    else saudacao = 'Boa noite';

    const greetingEl = document.getElementById('greeting-text');
    if (greetingEl) greetingEl.textContent = saudacao;
    
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    const nome = userData.apelido || (userData.nome ? userData.nome.split(' ')[0] : 'Usuário');
    
    const userNameEl = document.getElementById('user-name');
    if (userNameEl) userNameEl.textContent = nome;
    
    const userInitialEl = document.getElementById('user-initial');
    if (userInitialEl) userInitialEl.textContent = nome.charAt(0).toUpperCase();
}

// Inicializar ao carregar
let materiaisManager;
document.addEventListener('DOMContentLoaded', function() {
    materiaisManager = new MateriaisManager();
});

// ============================================
// FUNÇÕES DO MODAL DE VISUALIZAÇÍO PROFISSIONAL
// ============================================

function mudarAbaVisualizacao(aba, evt) {
    // Remover classe active de todas as abas e conteúdos
    document.querySelectorAll('.view-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.view-tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });
    
    // Ativar a aba clicada
    const e = evt || window.event;
    if (e && e.target) {
        const btn = e.target.closest('.view-tab-btn');
        if (btn) btn.classList.add('active');
    }
    
    // Mostrar o conteúdo correspondente
    const tabContent = document.getElementById('viewTab-' + aba);
    if (tabContent) {
        tabContent.classList.add('active');
        tabContent.style.display = 'block';
    }
}

function fecharModalVisualizarMaterial() {
    document.getElementById('modalVisualizarMaterial').style.display = 'none';
}

function imprimirMaterial() {
    const material = window.materialAtualVisualizacao;
    if (!material) return;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Material - ${material.codigo}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                h1 { color: #38bdf8; border-bottom: 2px solid #38bdf8; padding-bottom: 10px; }
                .info-row { display: flex; gap: 30px; margin: 10px 0; }
                .info-item { flex: 1; }
                .info-item label { font-size: 11px; color: #666; display: block; }
                .info-item span { font-size: 14px; font-weight: 500; }
            </style>
        </head>
        <body>
            <h1>${material.descricao}</h1>
            <p><strong>Código:</strong> ${material.codigo}</p>
            <div class="info-row">
                <div class="info-item"><label>Categoria</label><span>${material.categoria || '-'}</span></div>
                <div class="info-item"><label>Unidade</label><span>${material.unidade || '-'}</span></div>
                <div class="info-item"><label>NCM</label><span>${material.ncm || '-'}</span></div>
            </div>
            <div class="info-row">
                <div class="info-item"><label>Estoque Atual</label><span>${material.estoque_atual || 0}</span></div>
                <div class="info-item"><label>Estoque Mín.</label><span>${material.estoque_min || 0}</span></div>
                <div class="info-item"><label>Estoque Máx.</label><span>${material.estoque_max || 0}</span></div>
            </div>
            <script>window.print(); window.close();</script>
        </body>
        </html>
    `);
}

function exportarMaterialPDF() {
    alert('Funcionalidade de exportação para PDF em desenvolvimento');
}

function editarMaterialAtual() {
    const material = window.materialAtualVisualizacao;
    if (material && material.id) {
        fecharModalVisualizarMaterial();
        materiaisManager.editar(material.id);
    }
}

// Fechar modal ao clicar fora
document.getElementById('modalVisualizarMaterial')?.addEventListener('click', function(e) {
    if (e.target === this) {
        fecharModalVisualizarMaterial();
    }
});
