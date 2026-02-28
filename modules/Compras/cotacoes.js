// ========================================
// COTAÇÕES MANAGER
// Sistema de Gestão de Cotações - Integrado com API
// ========================================

class CotacoesManager {
    constructor() {
        this.cotacoes = [];
        this.cotacoesFiltradas = [];
        this.materiais = [];
        this.fornecedores = [];
        this.cotacaoAtual = null;
        this.paginaAtual = 1;
        this.itensPorPagina = 15;
        this.statusFiltro = 'todos';
        this.loading = false;
        this.init();
    }

    async init() {
        await this.carregarDependencias();
        await this.carregarDados();
        this.atualizarCards();
        this.renderizarTabela();
        if (typeof inicializarUsuario === 'function') inicializarUsuario();
        this.setDataAtual();
    }

    setDataAtual() {
        const hoje = new Date().toISOString().split('T')[0];
        const inputData = document.getElementById('cotacaoData');
        if (inputData) {
            inputData.value = hoje;
        }
    }

    getAuthHeaders() {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        return {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        };
    }

    async carregarDependencias() {
        try {
            // Carregar fornecedores da API
            const respForn = await fetch('/api/compras/fornecedores', {
                headers: this.getAuthHeaders()
            });
            if (respForn.ok) {
                const data = await respForn.json();
                this.fornecedores = Array.isArray(data) ? data : (data.fornecedores || []);
            }
        } catch (e) {
            console.error('Erro ao carregar fornecedores:', e);
            this.fornecedores = [];
        }

        // Carregar materiais da API
        try {
            const respMat = await fetch('/api/pcp/materiais', {
                headers: this.getAuthHeaders()
            });
            if (respMat.ok) {
                const data = await respMat.json();
                this.materiais = Array.isArray(data) ? data : (data.materiais || []);
            }
        } catch (e) {
            console.error('Erro ao carregar materiais:', e);
            this.materiais = [];
        }
    }

    async carregarDados() {
        this.loading = true;
        try {
            const response = await fetch('/api/compras/cotacoes', {
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                this.cotacoes = Array.isArray(data) ? data : (data.cotacoes || []);

                // Normalizar dados para o formato esperado
                this.cotacoes = this.cotacoes.map(c => ({
                    id: c.id,
                    numero: c.numero,
                    data: c.data_abertura || c.created_at,
                    solicitante: c.criado_por_nome || 'Sistema',
                    descricao: c.descricao,
                    prazoResposta: c.data_validade,
                    status: this.mapStatus(c.status),
                    materiais: c.itens || [],
                    fornecedores: c.fornecedores_ids || [],
                    propostas: c.propostas || [],
                    melhorProposta: c.melhor_preco ? { total: c.melhor_preco } : null,
                    total_fornecedores: c.total_fornecedores || 0
                }));
            }
        } catch (error) {
            console.error('Erro ao carregar cotações:', error);
            this.cotacoes = [];
        }

        this.cotacoesFiltradas = [...this.cotacoes];
        this.loading = false;
    }

    mapStatus(status) {
        const statusMap = {
            'aberta': 'Rascunho',
            'analise': 'Em Análise',
            'finalizada': 'Aprovada',
            'cancelada': 'Cancelada'
        };
        return statusMap[status] || status || 'Rascunho';
    }

    async salvarCotacao(dados) {
        try {
            const response = await fetch('/api/compras/cotacoes', {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(dados)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Erro ao salvar cotação');
            }

            await this.carregarDados();
            this.atualizarCards();
            this.renderizarTabela();
            return await response.json();
        } catch (error) {
            console.error('Erro ao salvar cotação:', error);
            throw error;
        }
    }

    async excluirCotacao(id) {
        if (!confirm('Deseja realmente excluir esta cotação?')) return;

        try {
            const response = await fetch(`/api/compras/cotacoes/${id}`, {
                method: 'DELETE',
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                await this.carregarDados();
                this.atualizarCards();
                this.renderizarTabela();
                this.mostrarToast('Cotação excluída com sucesso', 'success');
            } else {
                throw new Error('Erro ao excluir');
            }
        } catch (error) {
            console.error('Erro ao excluir cotação:', error);
            this.mostrarToast('Erro ao excluir cotação', 'error');
        }
    }

    mostrarToast(mensagem, tipo = 'info') {
        if (typeof showToast === 'function') {
            showToast(mensagem, tipo);
        } else {
            console.log(`[${tipo.toUpperCase()}] ${mensagem}`);
        }
    }

    gerarDataFutura(dias, dataBase = null) {
        const base = dataBase ? new Date(dataBase) : new Date();
        base.setDate(base.getDate() + dias);
        return base.toISOString().split('T')[0];
    }

    atualizarCards() {
        const total = this.cotacoes.length;
        const emAnalise = this.cotacoes.filter(c => c.status === 'Em Análise').length;
        const aprovadas = this.cotacoes.filter(c => c.status === 'Aprovada' || c.status === 'finalizada').length;

        // Calcular economia média (se houver propostas)
        const cotacoesComPropostas = this.cotacoes.filter(c => c.propostas && c.propostas.length > 1);
        let economiaTotal = 0;

        cotacoesComPropostas.forEach(cot => {
            if (cot.propostas && cot.propostas.length > 0) {
                const precoMaisAlto = Math.max(...cot.propostas.map(p => p.total || 0));
                const precoMaisBaixo = Math.min(...cot.propostas.map(p => p.total || 0));
                if (precoMaisAlto > 0) {
                    const economia = ((precoMaisAlto - precoMaisBaixo) / precoMaisAlto) * 100;
                    economiaTotal += economia;
                }
            }
        });

        const economiaMedia = cotacoesComPropostas.length > 0
            ? (economiaTotal / cotacoesComPropostas.length).toFixed(1)
            : 0;

        const elTotal = document.getElementById('totalCotacoes');
        const elAnalise = document.getElementById('cotacoesAnalise');
        const elAprovadas = document.getElementById('cotacoesAprovadas');
        const elEconomia = document.getElementById('economiaMedia');

        if (elTotal) elTotal.textContent = total;
        if (elAnalise) elAnalise.textContent = emAnalise;
        if (elAprovadas) elAprovadas.textContent = aprovadas;
        if (elEconomia) elEconomia.textContent = `${economiaMedia}%`;
    }

    filtrar() {
        const busca = document.getElementById('searchCotacao').value.toLowerCase();

        this.cotacoesFiltradas = this.cotacoes.filter(cotacao => {
            const numero = cotacao.numero || '';
            const solicitante = cotacao.solicitante || '';
            const descricao = cotacao.descricao || '';
            const materiais = cotacao.materiais || [];

            const matchBusca = !busca ||
                numero.toLowerCase().includes(busca) ||
                solicitante.toLowerCase().includes(busca) ||
                descricao.toLowerCase().includes(busca) ||
                materiais.some(m =>
                    (m.materialCodigo || '').toLowerCase().includes(busca) ||
                    (m.materialDescricao || m.descricao || '').toLowerCase().includes(busca)
                );

            const matchStatus =
                this.statusFiltro === 'todos' ||
                cotacao.status === this.statusFiltro;

            return matchBusca && matchStatus;
        });

        this.paginaAtual = 1;
        this.renderizarTabela();
    }

    filtrarPorStatus(status, evt) {
        this.statusFiltro = status;

        // Atualizar botões ativos
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const e = evt || window.event;
        if (e && e.target) {
            const btn = e.target.closest('.filter-btn');
            if (btn) btn.classList.add('active');
        }

        this.filtrar();
    }

    renderizarTabela() {
        const tbody = document.getElementById('cotacoesTableBody');
        if (!tbody) return;

        const inicio = (this.paginaAtual - 1) * this.itensPorPagina;
        const fim = inicio + this.itensPorPagina;
        const cotacoesPagina = this.cotacoesFiltradas.slice(inicio, fim);

        tbody.innerHTML = '';

        if (cotacoesPagina.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 40px; color: #6b7280;">
                        <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 10px; display: block;"></i>
                        Nenhuma cotação encontrada
                    </td>
                </tr>
            `;
            return;
        }

        cotacoesPagina.forEach(cotacao => {
            const tr = document.createElement('tr');

            // Badge de status
            let statusBadge = '';
            const status = cotacao.status || 'Rascunho';
            switch (status) {
                case 'Rascunho':
                    statusBadge = '<span class="badge badge-secondary"><i class="fas fa-edit"></i> Rascunho</span>';
                    break;
                case 'Enviada':
                    statusBadge = '<span class="badge badge-info"><i class="fas fa-paper-plane"></i> Enviada</span>';
                    break;
                case 'Em Análise':
                    statusBadge = '<span class="badge badge-warning"><i class="fas fa-search-dollar"></i> Em Análise</span>';
                    break;
                case 'Aprovada':
                    statusBadge = '<span class="badge badge-success"><i class="fas fa-check"></i> Aprovada</span>';
                    break;
                case 'Cancelada':
                    statusBadge = '<span class="badge badge-danger"><i class="fas fa-times"></i> Cancelada</span>';
                    break;
                default:
                    statusBadge = `<span class="badge badge-secondary">${status}</span>`;
            }

            // Contagem de materiais e fornecedores
            const numMateriais = (cotacao.materiais || []).length;
            const numFornecedores = cotacao.total_fornecedores || (cotacao.fornecedores || []).length;
            const numPropostas = (cotacao.propostas || []).length;

            // Melhor oferta
            const melhorOferta = cotacao.melhorProposta
                ? this.formatarMoeda(cotacao.melhorProposta.total)
                : '-';

            tr.innerHTML = `
                <td><input type="checkbox" class="cotacao-checkbox" data-id="${cotacao.id}"></td>
                <td><strong>${cotacao.numero || '-'}</strong></td>
                <td>${this.formatarData(cotacao.data)}</td>
                <td>${cotacao.solicitante || '-'}</td>
                <td>
                    <span class="badge badge-info">${numMateriais} ${numMateriais === 1 ? 'material' : 'materiais'}</span>
                </td>
                <td>
                    <span class="badge badge-purple">${numFornecedores} selecionados</span>
                    ${numPropostas > 0 ? `<br><span class="badge badge-success" style="margin-top: 3px;">${numPropostas} ${numPropostas === 1 ? 'proposta' : 'propostas'}</span>` : ''}
                </td>
                <td><strong>${melhorOferta}</strong></td>
                <td>${statusBadge}</td>
                <td class="table-actions">
                    <button class="btn-icon" onclick="cotacoesManager.visualizar(${cotacao.id})" title="Visualizar">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${status === 'Rascunho' ? `
                    <button class="btn-icon" onclick="cotacoesManager.editar(${cotacao.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    ` : ''}
                    ${status === 'Em Análise' || status === 'Enviada' ? `
                    <button class="btn-icon btn-success" onclick="cotacoesManager.registrarProposta(${cotacao.id})" title="Registrar Proposta">
                        <i class="fas fa-plus"></i>
                    </button>
                    ` : ''}
                    ${numPropostas >= 2 ? `
                    <button class="btn-icon btn-info" onclick="cotacoesManager.compararPropostas(${cotacao.id})" title="Comparar Propostas">
                        <i class="fas fa-balance-scale"></i>
                    </button>
                    ` : ''}
                    ${(status === 'Em Análise' || status === 'Enviada') && numPropostas >= 1 && cotacao.melhorProposta ? `
                    <button class="btn-icon" onclick="cotacoesManager.aprovarCotacao(${cotacao.id})" title="Aprovar e Gerar Pedido" style="background: #dcfce7; color: #16a34a;">
                        <i class="fas fa-check-circle"></i>
                    </button>
                    ` : ''}
                    ${status === 'Aprovada' && cotacao.pedidoGerado ? `
                    <button class="btn-icon btn-primary" onclick="cotacoesManager.verPedidoGerado('${cotacao.pedidoGerado}')" title="Ver Pedido Gerado: ${cotacao.pedidoGerado}">
                        <i class="fas fa-shopping-cart"></i>
                    </button>
                    ` : ''}
                    <button class="btn-icon btn-danger" onclick="cotacoesManager.excluirCotacao(${cotacao.id})" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;

            tbody.appendChild(tr);
        });

        this.atualizarPaginacao();
    }

    atualizarPaginacao() {
        const total = this.cotacoesFiltradas.length;
        const totalPaginas = Math.ceil(total / this.itensPorPagina);
        const inicio = (this.paginaAtual - 1) * this.itensPorPagina + 1;
        const fim = Math.min(inicio + this.itensPorPagina - 1, total);

        document.getElementById('paginacaoInicio').textContent = inicio;
        document.getElementById('paginacaoFim').textContent = fim;
        document.getElementById('paginacaoTotal').textContent = total;

        const controls = document.getElementById('paginationControls');
        controls.innerHTML = '';

        // Botão Anterior
        const btnPrev = document.createElement('button');
        btnPrev.className = 'btn-pagination';
        btnPrev.innerHTML = '<i class="fas fa-chevron-left"></i>';
        btnPrev.disabled = this.paginaAtual === 1;
        btnPrev.onclick = () => {
            if (this.paginaAtual > 1) {
                this.paginaAtual--;
                this.renderizarTabela();
            }
        };
        controls.appendChild(btnPrev);

        // Páginas
        for (let i = 1; i <= totalPaginas; i++) {
            if (
                i === 1 ||
                i === totalPaginas ||
                (i >= this.paginaAtual - 2 && i <= this.paginaAtual + 2)
            ) {
                const btnPage = document.createElement('button');
                btnPage.className = 'btn-pagination' + (i === this.paginaAtual ? ' active' : '');
                btnPage.textContent = i;
                btnPage.onclick = () => {
                    this.paginaAtual = i;
                    this.renderizarTabela();
                };
                controls.appendChild(btnPage);
            } else if (
                i === this.paginaAtual - 3 ||
                i === this.paginaAtual + 3
            ) {
                const span = document.createElement('span');
                span.textContent = '...';
                span.style.padding = '0 5px';
                controls.appendChild(span);
            }
        }

        // Botão Próximo
        const btnNext = document.createElement('button');
        btnNext.className = 'btn-pagination';
        btnNext.innerHTML = '<i class="fas fa-chevron-right"></i>';
        btnNext.disabled = this.paginaAtual === totalPaginas;
        btnNext.onclick = () => {
            if (this.paginaAtual < totalPaginas) {
                this.paginaAtual++;
                this.renderizarTabela();
            }
        };
        controls.appendChild(btnNext);
    }

    toggleSelectAll() {
        const checkboxes = document.querySelectorAll('.cotacao-checkbox');
        const selectAll = document.getElementById('selectAll');
        checkboxes.forEach(cb => cb.checked = selectAll.checked);
    }

    abrirModalNova() {
        document.getElementById('modalTitle').textContent = 'Nova Cotação';
        document.getElementById('formCotacao').reset();
        document.getElementById('cotacaoId').value = '';

        // Gerar próximo número
        const proximoNumero = this.cotacoes.length + 1;
        document.getElementById('cotacaoNumero').value = `COT-2024-${String(proximoNumero).padStart(4, '0')}`;

        this.setDataAtual();

        // Definir prazo padrão (15 dias)
        const prazo = new Date();
        prazo.setDate(prazo.getDate() + 15);
        document.getElementById('cotacaoPrazoResposta').value = prazo.toISOString().split('T')[0];

        // Limpar materiais
        document.getElementById('materiaisCotacaoBody').innerHTML = '';

        // Renderizar checkboxes de fornecedores
        this.renderizarFornecedoresCheckbox();

        document.getElementById('modalCotacao').style.display = 'flex';
    }

    renderizarFornecedoresCheckbox() {
        const container = document.getElementById('fornecedoresCheckboxes');
        container.innerHTML = '';

        this.fornecedores.forEach(fornecedor => {
            const div = document.createElement('div');
            div.className = 'checkbox-item';
            div.innerHTML = `
                <label>
                    <input type="checkbox" class="fornecedor-checkbox" value="${fornecedor.id}">
                    ${fornecedor.nome}
                </label>
            `;
            container.appendChild(div);
        });
    }

    adicionarMaterial() {
        const html = `
            <tr>
                <td>
                    <select class="form-control material-select">
                        <option value="">Selecione um material...</option>
                        ${this.materiais.map(m => `<option value="${m.id}" data-unidade="${m.unidade}">${m.codigo} - ${m.descricao}</option>`).join('')}
                    </select>
                </td>
                <td><input type="number" class="form-control material-quantidade" min="1" value="1"></td>
                <td><input type="text" class="form-control material-unidade" readonly></td>
                <td><input type="text" class="form-control material-especificacao" placeholder="Especificações adicionais"></td>
                <td><button type="button" class="btn-icon btn-danger" onclick="cotacoesManager.removerMaterial(this)"><i class="fas fa-trash"></i></button></td>
            </tr>
        `;
        document.getElementById('materiaisCotacaoBody').insertAdjacentHTML('beforeend', html);

        // Adicionar evento onChange ao select
        const tbody = document.getElementById('materiaisCotacaoBody');
        const ultimoSelect = tbody.querySelector('tr:last-child .material-select');
        ultimoSelect.addEventListener('change', function() {
            const option = this.options[this.selectedIndex];
            const tr = this.closest('tr');
            const inputUnidade = tr.querySelector('.material-unidade');
            inputUnidade.value = option.dataset.unidade || '';
        });
    }

    removerMaterial(btn) {
        btn.closest('tr').remove();
    }

    editar(id) {
        const cotacao = this.cotacoes.find(c => c.id === id);
        if (!cotacao || cotacao.status !== 'Rascunho') {
            this.mostrarToast('Apenas cotações em rascunho podem ser editadas!', 'warning');
            return;
        }

        document.getElementById('modalTitle').textContent = 'Editar Cotação';
        document.getElementById('cotacaoId').value = cotacao.id;
        document.getElementById('cotacaoNumero').value = cotacao.numero;
        document.getElementById('cotacaoData').value = cotacao.data;
        document.getElementById('cotacaoPrazoResposta').value = cotacao.prazoResposta;
        document.getElementById('cotacaoSolicitante').value = cotacao.solicitante;
        document.getElementById('cotacaoDescricao').value = cotacao.descricao || '';
        document.getElementById('cotacaoPrazoEntrega').value = cotacao.prazoEntrega || '';
        document.getElementById('cotacaoFormaPagamento').value = cotacao.formaPagamento || '';
        document.getElementById('cotacaoLocalEntrega').value = cotacao.localEntrega || '';
        document.getElementById('cotacaoObservacoes').value = cotacao.observacoes || '';

        // Carregar materiais
        const tbody = document.getElementById('materiaisCotacaoBody');
        tbody.innerHTML = '';

        cotacao.materiais.forEach(mat => {
            const html = `
                <tr>
                    <td>
                        <select class="form-control material-select">
                            ${this.materiais.map(m => `<option value="${m.id}" data-unidade="${m.unidade}" ${m.id === mat.materialId ? 'selected' : ''}>${m.codigo} - ${m.descricao}</option>`).join('')}
                        </select>
                    </td>
                    <td><input type="number" class="form-control material-quantidade" min="1" value="${mat.quantidade}"></td>
                    <td><input type="text" class="form-control material-unidade" value="${mat.unidade}" readonly></td>
                    <td><input type="text" class="form-control material-especificacao" value="${mat.especificacoes || ''}" placeholder="Especificações adicionais"></td>
                    <td><button type="button" class="btn-icon btn-danger" onclick="cotacoesManager.removerMaterial(this)"><i class="fas fa-trash"></i></button></td>
                </tr>
            `;
            tbody.insertAdjacentHTML('beforeend', html);
        });

        // Carregar fornecedores selecionados
        this.renderizarFornecedoresCheckbox();
        cotacao.fornecedores.forEach(fornId => {
            const checkbox = document.querySelector(`.fornecedor-checkbox[value="${fornId}"]`);
            if (checkbox) checkbox.checked = true;
        });

        document.getElementById('modalCotacao').style.display = 'flex';
    }

    visualizar(id) {
        const cotacao = this.cotacoes.find(c => c.id === id);
        if (!cotacao) return;

        this.mostrarToast(`Cotação ${cotacao.numero} — ${cotacao.solicitante} | Status: ${cotacao.status} | ${cotacao.materiais.length} materiais, ${cotacao.fornecedores.length} fornecedores, ${cotacao.propostas.length} propostas`, 'info');
    }

    registrarProposta(cotacaoId) {
        this.cotacaoAtual = this.cotacoes.find(c => c.id === cotacaoId);
        if (!this.cotacaoAtual) return;

        // Mostrar seleção de fornecedor
        const fornecedoresSemProposta = this.cotacaoAtual.fornecedores.filter(fornId => {
            return !this.cotacaoAtual.propostas.some(p => p.fornecedorId === fornId);
        });

        if (fornecedoresSemProposta.length === 0) {
            this.mostrarToast('Todos os fornecedores já enviaram suas propostas!', 'info');
            return;
        }

        const fornecedorId = fornecedoresSemProposta[0]; // Simplificado: pegar primeiro
        const fornecedor = this.fornecedores.find(f => f.id === fornecedorId);

        document.getElementById('propostaFornecedorId').value = fornecedor.id;
        document.getElementById('propostaFornecedorNome').value = fornecedor.nome;
        document.getElementById('propostaDataRecebimento').value = new Date().toISOString().split('T')[0];
        document.getElementById('propostaPrazoEntrega').value = '';
        document.getElementById('propostaValidade').value = this.gerarDataFutura(30);
        document.getElementById('propostaObservacoes').value = '';

        // Renderizar itens
        const tbody = document.getElementById('itensPropostaBody');
        tbody.innerHTML = '';

        this.cotacaoAtual.materiais.forEach(mat => {
            const html = `
                <tr>
                    <td>${mat.materialDescricao}</td>
                    <td>${mat.quantidade} ${mat.unidade}</td>
                    <td><input type="number" class="form-control item-preco" min="0" step="0.01" data-quantidade="${mat.quantidade}" onchange="cotacoesManager.calcularTotalProposta()"></td>
                    <td class="item-total">R$ 0,00</td>
                </tr>
            `;
            tbody.insertAdjacentHTML('beforeend', html);
        });

        document.getElementById('modalProposta').style.display = 'flex';
    }

    calcularTotalProposta() {
        const tbody = document.getElementById('itensPropostaBody');
        const rows = tbody.querySelectorAll('tr');
        let total = 0;

        rows.forEach(row => {
            const input = row.querySelector('.item-preco');
            const quantidade = parseFloat(input.dataset.quantidade);
            const preco = parseFloat(input.value) || 0;
            const itemTotal = quantidade * preco;

            row.querySelector('.item-total').textContent = this.formatarMoeda(itemTotal);
            total += itemTotal;
        });

        document.getElementById('propostaTotal').textContent = this.formatarMoeda(total);
    }

    async salvarProposta() {
        if (!this.cotacaoAtual) return;

        const fornecedorId = parseInt(document.getElementById('propostaFornecedorId').value);
        const fornecedor = this.fornecedores.find(f => f.id === fornecedorId);

        const tbody = document.getElementById('itensPropostaBody');
        const rows = tbody.querySelectorAll('tr');
        const itens = [];
        let totalProposta = 0;

        rows.forEach((row, index) => {
            const material = this.cotacaoAtual.materiais[index];
            const preco = parseFloat(row.querySelector('.item-preco').value) || 0;
            const quantidade = material.quantidade;
            const total = quantidade * preco;

            itens.push({
                materialId: material.materialId,
                materialDescricao: material.materialDescricao,
                quantidade: quantidade,
                unidade: material.unidade,
                precoUnitario: preco.toFixed(2),
                total: total
            });

            totalProposta += total;
        });

        const novaProposta = {
            fornecedorId: fornecedorId,
            fornecedorNome: fornecedor ? (fornecedor.razao_social || fornecedor.nome) : 'Fornecedor',
            dataRecebimento: document.getElementById('propostaDataRecebimento').value,
            prazoEntrega: document.getElementById('propostaPrazoEntrega').value,
            validade: document.getElementById('propostaValidade').value,
            itens: itens,
            total: totalProposta,
            observacoes: document.getElementById('propostaObservacoes').value
        };

        // Salvar proposta via API (PUT na cotação)
        try {
            const cotacaoAtualizada = { ...this.cotacaoAtual };
            if (!cotacaoAtualizada.propostas) cotacaoAtualizada.propostas = [];
            cotacaoAtualizada.propostas.push(novaProposta);
            cotacaoAtualizada.status = 'Em Análise';
            cotacaoAtualizada.propostas.sort((a, b) => a.total - b.total);
            cotacaoAtualizada.melhorProposta = cotacaoAtualizada.propostas[0];

            const response = await fetch(`/api/compras/cotacoes/${this.cotacaoAtual.id}`, {
                method: 'PUT',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(cotacaoAtualizada)
            });
            if (response.ok) {
                this.mostrarToast('Proposta registrada com sucesso!', 'success');
                await this.carregarDados();
            } else {
                // Fallback local
                this.cotacaoAtual.propostas.push(novaProposta);
                this.cotacaoAtual.status = 'Em Análise';
                this.cotacaoAtual.propostas.sort((a, b) => a.total - b.total);
                this.cotacaoAtual.melhorProposta = this.cotacaoAtual.propostas[0];
                this.mostrarToast('Proposta salva localmente', 'warning');
            }
        } catch (error) {
            console.error('Erro ao salvar proposta:', error);
            this.cotacaoAtual.propostas.push(novaProposta);
            this.cotacaoAtual.status = 'Em Análise';
            this.mostrarToast('Proposta salva localmente', 'warning');
        }

        this.fecharModalProposta();
        this.filtrar();
        this.atualizarCards();
    }

    // Aprovar cotação diretamente e gerar pedido de compra
    // FLUXO: Cotação → Fornecedor → Pedido de Compra
    async aprovarCotacao(id) {
        const cotacao = this.cotacoes.find(c => c.id === id);

        if (!cotacao) {
            this.mostrarToast('Erro: Cotação não encontrada!', 'error');
            return;
        }

        if (!cotacao.melhorProposta) {
            this.mostrarToast('Esta cotação não possui propostas registradas.', 'warning');
            return;
        }

        const fornecedorNome = cotacao.melhorProposta.fornecedorNome;
        const valorTotal = this.formatarMoeda(cotacao.melhorProposta.total);

        if (!confirm(
            `FLUXO: Cotação → Fornecedor → Pedido de Compra\n\n` +
            `Cotação: ${cotacao.numero}\n` +
            `Fornecedor: ${fornecedorNome}\n` +
            `Valor: ${valorTotal}\n\n` +
            `Deseja aprovar esta proposta e gerar o pedido de compra automaticamente?`
        )) {
            return;
        }

        try {
            const response = await fetch(`/api/compras/cotacoes/${cotacao.id}/aprovar-proposta`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify({
                    proposta_id: cotacao.melhorProposta.id || null,
                    fornecedor_id: cotacao.melhorProposta.fornecedorId,
                    observacoes: `Aprovação direta da cotação ${cotacao.numero}`
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                // Atualizar a cotação na lista
                const idx = this.cotacoes.findIndex(c => c.id === cotacao.id);
                if (idx > -1) {
                    this.cotacoes[idx].status = 'Aprovada';
                    this.cotacoes[idx].pedidoGerado = result.pedido.numero_pedido;
                }

                // Atualizar interface
                this.filtrar();
                this.atualizarCards();

                // Mostrar sucesso
                this.mostrarToast(`Cotação ${result.cotacao.numero} aprovada! Pedido ${result.pedido.numero_pedido} gerado.`, 'success');

                const irParaPedido = confirm(
                    `Cotação: ${result.cotacao.numero} → APROVADA\n` +
                    `Fornecedor: ${result.pedido.fornecedor}\n` +
                    `Pedido Gerado: ${result.pedido.numero_pedido}\n\n` +
                    `Deseja ir para a página de Pedidos?`
                );

                if (irParaPedido) {
                    window.location.href = 'pedidos.html';
                }
            } else {
                this.mostrarToast('Erro ao aprovar: ' + (result.error || 'Erro desconhecido'), 'error');
            }

        } catch (error) {
            console.error('Erro ao aprovar cotação:', error);
            this.mostrarToast('Erro ao processar. Verifique a conexão e tente novamente.', 'error');
        }
    }

    // Navegar para o pedido gerado
    verPedidoGerado(numeroPedido) {
        if (confirm(`Pedido: ${numeroPedido}\n\nDeseja ir para a página de Pedidos?`)) {
            window.location.href = `pedidos.html?pedido=${numeroPedido}`;
        }
    }

    compararPropostas(id) {
        const cotacao = this.cotacoes.find(c => c.id === id);
        if (!cotacao || cotacao.propostas.length < 2) {
            this.mostrarToast('É necessário ter ao menos 2 propostas para comparar!', 'warning');
            return;
        }

        document.getElementById('comparacaoNumero').textContent = cotacao.numero;

        let html = `
            <div class="comparacao-header">
                <h4>Informações da Cotação</h4>
                <p><strong>Solicitante:</strong> ${cotacao.solicitante} | <strong>Data:</strong> ${this.formatarData(cotacao.data)}</p>
            </div>

            <div class="comparacao-tabela">
                <table class="data-table comparison-table">
                    <thead>
                        <tr>
                            <th width="30%">Material</th>
                            <th width="10%">Qtd.</th>
                            ${cotacao.propostas.map(p => `<th width="${60/cotacao.propostas.length}%">${p.fornecedorNome}<br><small>${this.formatarData(p.dataRecebimento)}</small></th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${cotacao.materiais.map((mat, idx) => `
                            <tr>
                                <td><strong>${mat.materialCodigo}</strong><br>${mat.materialDescricao}</td>
                                <td>${mat.quantidade} ${mat.unidade}</td>
                                ${cotacao.propostas.map(p => {
                                    const item = p.itens[idx];
                                    const preco = parseFloat(item.precoUnitario);
                                    const precos = cotacao.propostas.map(prop => parseFloat(prop.itens[idx].precoUnitario));
                                    const menorPreco = Math.min(...precos);
                                    const isMelhor = preco === menorPreco;
                                    return `<td class="${isMelhor ? 'melhor-preco' : ''}">${this.formatarMoeda(preco)}<br><small>Total: ${this.formatarMoeda(item.total)}</small></td>`;
                                }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                    <tfoot>
                        <tr class="total-row">
                            <td colspan="2"><strong>TOTAL GERAL</strong></td>
                            ${cotacao.propostas.map(p => {
                                const isMelhor = p === cotacao.melhorProposta;
                                return `<td class="${isMelhor ? 'melhor-total' : ''}"><strong>${this.formatarMoeda(p.total)}</strong></td>`;
                            }).join('')}
                        </tr>
                        <tr>
                            <td colspan="2">Prazo de Entrega</td>
                            ${cotacao.propostas.map(p => `<td>${p.prazoEntrega}</td>`).join('')}
                        </tr>
                        <tr>
                            <td colspan="2">Validade</td>
                            ${cotacao.propostas.map(p => `<td>${this.formatarData(p.validade)}</td>`).join('')}
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div class="comparacao-footer">
                <div class="alert alert-success">
                    <i class="fas fa-trophy"></i> <strong>Melhor Proposta:</strong> ${cotacao.melhorProposta.fornecedorNome} - ${this.formatarMoeda(cotacao.melhorProposta.total)}
                </div>
            </div>
        `;

        document.getElementById('comparacaoConteudo').innerHTML = html;
        document.getElementById('modalComparacao').style.display = 'flex';
    }

    async aprovarMelhorProposta() {
        // Buscar a cotação atual do modal
        const cotacaoNumero = document.getElementById('comparacaoNumero').textContent;
        const cotacao = this.cotacoes.find(c => c.numero === cotacaoNumero);

        if (!cotacao) {
            this.mostrarToast('Erro: Cotação não encontrada!', 'error');
            return;
        }

        if (!cotacao.melhorProposta) {
            this.mostrarToast('Nenhuma proposta disponível para aprovar!', 'warning');
            return;
        }

        const fornecedorNome = cotacao.melhorProposta.fornecedorNome;
        const valorTotal = this.formatarMoeda(cotacao.melhorProposta.total);

        if (!confirm(`Deseja aprovar a proposta do fornecedor "${fornecedorNome}" no valor de ${valorTotal} e gerar o pedido de compra?`)) {
            return;
        }

        try {
            // Mostrar loading
            const btnAprovar = document.querySelector('#modalComparacao .btn-primary');
            if (btnAprovar) {
                btnAprovar.disabled = true;
                btnAprovar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';
            }

            // Chamar API para aprovar e gerar pedido
            const response = await fetch(`/api/compras/cotacoes/${cotacao.id}/aprovar-proposta`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify({
                    proposta_id: cotacao.melhorProposta.id || null,
                    fornecedor_id: cotacao.melhorProposta.fornecedorId,
                    observacoes: `Aprovação da melhor proposta da cotação ${cotacao.numero}`
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                // Sucesso! Mostrar modal com detalhes do pedido gerado
                this.fecharModalComparacao();

                // Atualizar a cotação na lista
                const idx = this.cotacoes.findIndex(c => c.id === cotacao.id);
                if (idx > -1) {
                    this.cotacoes[idx].status = 'Aprovada';
                    this.cotacoes[idx].pedidoGerado = result.pedido.numero_pedido;
                }

                // Atualizar interface
                this.filtrar();
                this.atualizarCards();

                // Mostrar sucesso com opção de ir para o pedido
                this.mostrarToast(`Proposta aprovada! Pedido ${result.pedido.numero_pedido} gerado.`, 'success');

                const irParaPedido = confirm(
                    `Cotação: ${result.cotacao.numero}\n` +
                    `Fornecedor: ${result.pedido.fornecedor}\n` +
                    `Pedido Gerado: ${result.pedido.numero_pedido}\n\n` +
                    `Deseja ir para a página de Pedidos?`
                );

                if (irParaPedido) {
                    window.location.href = 'pedidos.html';
                }
            } else {
                this.mostrarToast('Erro ao aprovar proposta: ' + (result.error || 'Erro desconhecido'), 'error');
            }

        } catch (error) {
            console.error('Erro ao aprovar proposta:', error);
            this.mostrarToast('Erro ao processar aprovação. Verifique a conexão e tente novamente.', 'error');
        } finally {
            // Restaurar botão
            const btnAprovar = document.querySelector('#modalComparacao .btn-primary');
            if (btnAprovar) {
                btnAprovar.disabled = false;
                btnAprovar.innerHTML = '<i class="fas fa-check"></i> Aprovar Melhor Proposta';
            }
        }
    }

    salvarRascunho() {
        this.salvarCotacao('Rascunho');
    }

    enviarCotacao() {
        this.salvarCotacao('Enviada');
    }

    async salvarCotacao(status) {
        const solicitante = document.getElementById('cotacaoSolicitante').value;

        if (!solicitante) {
            this.mostrarToast('Preencha o solicitante!', 'warning');
            return;
        }

        // Validar materiais
        const tbody = document.getElementById('materiaisCotacaoBody');
        const rows = tbody.querySelectorAll('tr');

        if (rows.length === 0) {
            this.mostrarToast('Adicione ao menos um material!', 'warning');
            return;
        }

        const materiais = [];
        let valid = true;

        rows.forEach(row => {
            const materialId = parseInt(row.querySelector('.material-select').value);
            const quantidade = parseFloat(row.querySelector('.material-quantidade').value);

            if (!materialId || !quantidade) {
                valid = false;
                return;
            }

            const material = this.materiais.find(m => m.id === materialId);
            const especificacoes = row.querySelector('.material-especificacao').value;

            materiais.push({
                materialId: materialId,
                materialCodigo: material.codigo,
                materialDescricao: material.descricao,
                quantidade: quantidade,
                unidade: material.unidade,
                especificacoes: especificacoes || 'Conforme especificação técnica padrão'
            });
        });

        if (!valid) {
            this.mostrarToast('Preencha todos os campos dos materiais!', 'warning');
            return;
        }

        // Validar fornecedores
        const fornecedoresSelecionados = Array.from(document.querySelectorAll('.fornecedor-checkbox:checked')).map(cb => parseInt(cb.value));

        if (fornecedoresSelecionados.length === 0) {
            this.mostrarToast('Selecione ao menos um fornecedor!', 'warning');
            return;
        }

        const id = document.getElementById('cotacaoId').value;

        const cotacao = {
            numero: document.getElementById('cotacaoNumero').value,
            data: document.getElementById('cotacaoData').value,
            solicitante: solicitante,
            descricao: document.getElementById('cotacaoDescricao').value,
            prazoResposta: document.getElementById('cotacaoPrazoResposta').value,
            status: status,
            materiais: materiais,
            fornecedores: fornecedoresSelecionados,
            propostas: [],
            melhorProposta: null,
            prazoEntrega: document.getElementById('cotacaoPrazoEntrega').value,
            formaPagamento: document.getElementById('cotacaoFormaPagamento').value,
            localEntrega: document.getElementById('cotacaoLocalEntrega').value,
            observacoes: document.getElementById('cotacaoObservacoes').value,
            pedidoGerado: null
        };

        if (id) {
            // Editar via API
            try {
                const response = await fetch(`/api/compras/cotacoes/${id}`, {
                    method: 'PUT',
                    headers: this.getAuthHeaders(),
                    body: JSON.stringify(cotacao)
                });
                if (response.ok) {
                    this.mostrarToast(`Cotação ${status === 'Rascunho' ? 'salva' : 'enviada'} com sucesso!`, 'success');
                    await this.carregarDados();
                } else {
                    const err = await response.json().catch(() => ({}));
                    this.mostrarToast(err.message || 'Erro ao atualizar cotação', 'error');
                }
            } catch (error) {
                console.error('Erro ao atualizar cotação:', error);
                this.mostrarToast('Erro ao atualizar cotação', 'error');
            }
        } else {
            // Nova via API
            try {
                const response = await fetch('/api/compras/cotacoes', {
                    method: 'POST',
                    headers: this.getAuthHeaders(),
                    body: JSON.stringify(cotacao)
                });
                if (response.ok) {
                    this.mostrarToast(`Cotação ${status === 'Rascunho' ? 'salva' : 'enviada'} com sucesso!`, 'success');
                    await this.carregarDados();
                } else {
                    const err = await response.json().catch(() => ({}));
                    this.mostrarToast(err.message || 'Erro ao criar cotação', 'error');
                }
            } catch (error) {
                console.error('Erro ao criar cotação:', error);
                this.mostrarToast('Erro ao criar cotação', 'error');
            }
        }

        this.fecharModal();
        this.filtrar();
        this.atualizarCards();
    }

    fecharModal() {
        document.getElementById('modalCotacao').style.display = 'none';
    }

    fecharModalComparacao() {
        document.getElementById('modalComparacao').style.display = 'none';
    }

    fecharModalProposta() {
        document.getElementById('modalProposta').style.display = 'none';
    }

    exportar() {
        const headers = ['Número', 'Data', 'Solicitante', 'Status', 'Materiais', 'Fornecedores', 'Propostas', 'Melhor Oferta'];
        const csv = [
            headers.join(';'),
            ...this.cotacoesFiltradas.map(c => [
                c.numero,
                c.data,
                c.solicitante,
                c.status,
                c.materiais.length,
                c.fornecedores.length,
                c.propostas.length,
                c.melhorProposta ? c.melhorProposta.total.toFixed(2) : '0'
            ].join(';'))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `cotacoes_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    }

    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor);
    }

    formatarData(data) {
        if (!data) return '-';
        const [ano, mes, dia] = data.split('-');
        return `${dia}/${mes}/${ano}`;
    }
}

// Funções globais (header)
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);

    const icon = document.querySelector('#btnModoEscuro i');
    icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
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
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function inicializarUsuario() {
    const agora = new Date();
    const hora = agora.getHours();
    let saudacao = 'Olá';

    if (hora < 12) saudacao = 'Bom dia';
    else if (hora < 18) saudacao = 'Boa tarde';
    else saudacao = 'Boa noite';

    const userName = localStorage.getItem('userName') || 'Usuário';
    const greetingEl = document.getElementById('userGreeting');
    if (greetingEl) {
        greetingEl.textContent = `${saudacao}, ${userName}`;
    }
}

// Fechar menu ao clicar fora
document.addEventListener('click', function(event) {
    const userProfile = document.querySelector('.user-profile');
    const userMenu = document.getElementById('userMenu');

    if (userProfile && userMenu && !userProfile.contains(event.target)) {
        userMenu.style.display = 'none';
    }
});

// Inicializar ao carregar
let cotacoesManager;
document.addEventListener('DOMContentLoaded', function() {
    // Carregar modo escuro
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const icon = document.querySelector('#btnModoEscuro i');
        if (icon) icon.className = 'fas fa-sun';
    }

    cotacoesManager = new CotacoesManager();
});
