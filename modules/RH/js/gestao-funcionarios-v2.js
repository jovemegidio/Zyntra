// Módulo de Gestão de Funcionários - RH Admin v2.0
// Sistema completo de CRUD e gerenciamento

class GestãoFuncionarios {
    constructor() {
        this.funcionarios = [];
        this.departamentos = [
            { id: 1, nome: 'Produção', cor: '#3b82f6' },
            { id: 2, nome: 'Administração', cor: '#8b5cf6' },
            { id: 3, nome: 'Vendas', cor: '#10b981' },
            { id: 4, nome: 'TI', cor: '#f59e0b' },
            { id: 5, nome: 'RH', cor: '#ef4444' },
            { id: 6, nome: 'Financeiro', cor: '#06b6d4' },
            { id: 7, nome: 'Compras', cor: '#84cc16' },
            { id: 8, nome: 'Qualidade', cor: '#f97316' }
        ];
        this.init();
    }

    init() {
        console.log('🏢 Iniciando Gestão de Funcionários v2.0...');
        this.carregarFuncionarios();
        this.setupEventListeners();
        this.renderizarLista();
    }

    carregarFuncionarios() {
        // Dados simulados - em produção viriam da API
        this.funcionarios = [
            {
                id: 1,
                nome: 'João Silva',
                email: 'joao.silva@aluforce.com',
                telefone: '(11) 99999-1111',
                cpf: '123.456.789-01',
                cargo: 'Operador de Produção',
                departamento_id: 1,
                salario: 3850.00,
                data_admissao: '2023-01-15',
                status: 'ativo',
                foto: null,
                endereco: {
                    cep: '01234-567',
                    rua: 'Rua das Flores, 123',
                    bairro: 'Centro',
                    cidade: 'São Paulo',
                    uf: 'SP'
                },
                beneficios: ['vr', 'vt', 'plano_saude'],
                observacoes: 'Funcionário exemplar, pontual e dedicado.'
            },
            {
                id: 2,
                nome: 'Maria Santos',
                email: 'maria.santos@aluforce.com',
                telefone: '(11) 99999-2222',
                cpf: '987.654.321-09',
                cargo: 'Analista Administrativo',
                departamento_id: 2,
                salario: 4200.00,
                data_admissao: '2022-08-20',
                status: 'ativo',
                foto: null,
                endereco: {
                    cep: '09876-543',
                    rua: 'Av. Principal, 456',
                    bairro: 'Jardim América',
                    cidade: 'São Paulo',
                    uf: 'SP'
                },
                beneficios: ['vr', 'vt', 'plano_saude', 'plano_odonto'],
                observacoes: 'Excelente desempenho, candidata a promoção.'
            },
            {
                id: 3,
                nome: 'Carlos Oliveira',
                email: 'carlos.oliveira@aluforce.com',
                telefone: '(11) 99999-3333',
                cpf: '456.789.123-45',
                cargo: 'Vendedor',
                departamento_id: 3,
                salario: 2800.00,
                data_admissao: '2024-03-10',
                status: 'ativo',
                foto: null,
                endereco: {
                    cep: '12345-678',
                    rua: 'Rua do Comércio, 789',
                    bairro: 'Vila Nova',
                    cidade: 'São Paulo',
                    uf: 'SP'
                },
                beneficios: ['vr', 'vt'],
                observacoes: 'Novo funcionário, em período de experiência.'
            }
        ];
    }

    setupEventListeners() {
        // Eventos dos botões principais
        document.addEventListener('click', (e) => {
            if (e.target.id === 'btn-novo-funcionario') {
                this.abrirModalCadastro();
            }
            if (e.target.id === 'btn-exportar-funcionarios') {
                this.exportarFuncionarios();
            }
            if (e.target.id === 'btn-importar-funcionarios') {
                this.importarFuncionarios();
            }
            
            // Eventos da tabela
            if (e.target.classList.contains('btn-editar')) {
                const id = parseInt(e.target.dataset.id);
                this.editarFuncionario(id);
            }
            if (e.target.classList.contains('btn-excluir')) {
                const id = parseInt(e.target.dataset.id);
                this.excluirFuncionario(id);
            }
            if (e.target.classList.contains('btn-visualizar')) {
                const id = parseInt(e.target.dataset.id);
                this.visualizarFuncionario(id);
            }
        });

        // Filtros e busca
        const searchInput = document.getElementById('search-funcionarios');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.filtrarFuncionarios();
            });
        }

        const filterDepartamento = document.getElementById('filter-departamento');
        if (filterDepartamento) {
            filterDepartamento.addEventListener('change', () => {
                this.filtrarFuncionarios();
            });
        }

        const filterStatus = document.getElementById('filter-status');
        if (filterStatus) {
            filterStatus.addEventListener('change', () => {
                this.filtrarFuncionarios();
            });
        }
    }

    renderizarLista() {
        const container = document.getElementById('lista-funcionarios');
        if (!container) return;

        const funcionariosFiltrados = this.obterFuncionariosFiltrados();
        
        container.innerHTML = `
            <div class="funcionarios-header">
                <div class="funcionarios-stats">
                    <div class="stat-card">
                        <div class="stat-value">${this.funcionarios.filter(f => f.status === 'ativo').length}</div>
                        <div class="stat-label">Ativos</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${this.funcionarios.filter(f => f.status === 'inativo').length}</div>
                        <div class="stat-label">Inativos</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${this.departamentos.length}</div>
                        <div class="stat-label">Departamentos</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">R$ ${this.calcularFolhaTotal().toLocaleString('pt-BR')}</div>
                        <div class="stat-label">Folha Total</div>
                    </div>
                </div>
                
                <div class="funcionarios-filters">
                    <div class="filter-group">
                        <input type="text" id="search-funcionarios" placeholder="Buscar funcionário..." class="filter-input">
                        <select id="filter-departamento" class="filter-select">
                            <option value="">Todos os departamentos</option>
                            ${this.departamentos.map(dep => `<option value="${dep.id}">${dep.nome}</option>`).join('')}
                        </select>
                        <select id="filter-status" class="filter-select">
                            <option value="">Todos os status</option>
                            <option value="ativo">Ativos</option>
                            <option value="inativo">Inativos</option>
                        </select>
                    </div>
                    
                    <div class="action-buttons">
                        <button id="btn-novo-funcionario" class="btn btn-primary">
                            <i class="fas fa-plus"></i>
                            Novo Funcionário
                        </button>
                        <button id="btn-exportar-funcionarios" class="btn btn-secondary">
                            <i class="fas fa-download"></i>
                            Exportar
                        </button>
                        <button id="btn-importar-funcionarios" class="btn btn-secondary">
                            <i class="fas fa-upload"></i>
                            Importar
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="funcionarios-table-container">
                <table class="funcionarios-table">
                    <thead>
                        <tr>
                            <th>Funcionário</th>
                            <th>Cargo</th>
                            <th>Departamento</th>
                            <th>Admissão</th>
                            <th>Salário</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${funcionariosFiltrados.map(funcionario => this.renderizarLinhaFuncionario(funcionario)).join('')}
                    </tbody>
                </table>
            </div>
        `;

        // Re-setup dos event listeners após renderização
        this.setupEventListeners();
    }

    renderizarLinhaFuncionario(funcionario) {
        const departamento = this.departamentos.find(d => d.id === funcionario.departamento_id);
        const dataAdmissao = new Date(funcionario.data_admissao).toLocaleDateString('pt-BR');
        
        return `
            <tr class="funcionario-row">
                <td>
                    <div class="funcionario-info">
                        <div class="funcionario-avatar">
                            ${funcionario.foto ? 
                                `<img src="${funcionario.foto}" alt="${funcionario.nome}">` :
                                `<div class="avatar-placeholder">${funcionario.nome.split(' ').map(n => n[0]).join('')}</div>`
                            }
                        </div>
                        <div class="funcionario-dados">
                            <div class="funcionario-nome">${funcionario.nome}</div>
                            <div class="funcionario-email">${funcionario.email}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="funcionario-cargo">${funcionario.cargo}</div>
                </td>
                <td>
                    <div class="departamento-badge" style="background-color: ${departamento?.cor || '#6b7280'}20; color: ${departamento?.cor || '#6b7280'};">
                        ${departamento?.nome || 'N/A'}
                    </div>
                </td>
                <td>
                    <div class="data-admissao">${dataAdmissao}</div>
                </td>
                <td>
                    <div class="salario">R$ ${funcionario.salario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                </td>
                <td>
                    <div class="status-badge ${funcionario.status}">
                        ${funcionario.status === 'ativo' ? 'Ativo' : 'Inativo'}
                    </div>
                </td>
                <td>
                    <div class="acoes-funcionario">
                        <button class="btn-acao btn-visualizar" data-id="${funcionario.id}" title="Visualizar">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-acao btn-editar" data-id="${funcionario.id}" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-acao btn-excluir" data-id="${funcionario.id}" title="Excluir">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    obterFuncionariosFiltrados() {
        let funcionarios = [...this.funcionarios];
        
        const search = document.getElementById('search-funcionarios')?.value.toLowerCase() || '';
        const departamento = document.getElementById('filter-departamento')?.value || '';
        const status = document.getElementById('filter-status')?.value || '';
        
        if (search) {
            funcionarios = funcionarios.filter(f => 
                f.nome.toLowerCase().includes(search) ||
                f.email.toLowerCase().includes(search) ||
                f.cargo.toLowerCase().includes(search)
            );
        }
        
        if (departamento) {
            funcionarios = funcionarios.filter(f => f.departamento_id == departamento);
        }
        
        if (status) {
            funcionarios = funcionarios.filter(f => f.status === status);
        }
        
        return funcionarios;
    }

    filtrarFuncionarios() {
        this.renderizarLista();
    }

    calcularFolhaTotal() {
        return this.funcionarios
            .filter(f => f.status === 'ativo')
            .reduce((total, f) => total + f.salario, 0);
    }

    abrirModalCadastro(funcionario = null) {
        const isEdicao = funcionario !== null;
        const titulo = isEdicao ? 'Editar Funcionário' : 'Novo Funcionário';
        
        const modal = this.criarModal(titulo, this.gerarFormularioFuncionario(funcionario));
        
        // Event listener para o formulário
        const form = modal.querySelector('#form-funcionario');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            
            if (isEdicao) {
                this.atualizarFuncionario(funcionario.id, this.obterDadosFormulario(form));
            } else {
                this.adicionarFuncionario(this.obterDadosFormulario(form));
            }
            
            this.fecharModal();
        });
    }

    gerarFormularioFuncionario(funcionario = null) {
        const dados = funcionario || {
            nome: '',
            email: '',
            telefone: '',
            cpf: '',
            cargo: '',
            departamento_id: '',
            salario: '',
            data_admissao: '',
            status: 'ativo',
            endereco: {
                cep: '',
                rua: '',
                bairro: '',
                cidade: '',
                uf: ''
            },
            observacoes: ''
        };

        return `
            <form id="form-funcionario" class="form-funcionario">
                <div class="form-tabs">
                    <button type="button" class="tab-button active" data-tab="dados-pessoais">Dados Pessoais</button>
                    <button type="button" class="tab-button" data-tab="dados-profissionais">Dados Profissionais</button>
                    <button type="button" class="tab-button" data-tab="endereco">Endereço</button>
                    <button type="button" class="tab-button" data-tab="observacoes">Observações</button>
                </div>
                
                <div class="tab-content">
                    <div id="dados-pessoais" class="tab-panel active">
                        <div class="form-row">
                            <div class="form-group">
                                <label for="nome">Nome Completo *</label>
                                <input type="text" id="nome" name="nome" value="${dados.nome}" required>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="email">E-mail *</label>
                                <input type="email" id="email" name="email" value="${dados.email}" required>
                            </div>
                            <div class="form-group">
                                <label for="telefone">Telefone</label>
                                <input type="tel" id="telefone" name="telefone" value="${dados.telefone}">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="cpf">CPF *</label>
                                <input type="text" id="cpf" name="cpf" value="${dados.cpf}" required>
                            </div>
                            <div class="form-group">
                                <label for="data_admissao">Data de Admissão *</label>
                                <input type="date" id="data_admissao" name="data_admissao" value="${dados.data_admissao}" required>
                            </div>
                        </div>
                    </div>
                    
                    <div id="dados-profissionais" class="tab-panel">
                        <div class="form-row">
                            <div class="form-group">
                                <label for="cargo">Cargo *</label>
                                <input type="text" id="cargo" name="cargo" value="${dados.cargo}" required>
                            </div>
                            <div class="form-group">
                                <label for="departamento_id">Departamento *</label>
                                <select id="departamento_id" name="departamento_id" required>
                                    <option value="">Selecione...</option>
                                    ${this.departamentos.map(dep => 
                                        `<option value="${dep.id}" ${dados.departamento_id == dep.id ? 'selected' : ''}>${dep.nome}</option>`
                                    ).join('')}
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="salario">Salário *</label>
                                <input type="number" id="salario" name="salario" value="${dados.salario}" step="0.01" min="0" required>
                            </div>
                            <div class="form-group">
                                <label for="status">Status</label>
                                <select id="status" name="status">
                                    <option value="ativo" ${dados.status === 'ativo' ? 'selected' : ''}>Ativo</option>
                                    <option value="inativo" ${dados.status === 'inativo' ? 'selected' : ''}>Inativo</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <div id="endereco" class="tab-panel">
                        <div class="form-row">
                            <div class="form-group">
                                <label for="cep">CEP</label>
                                <input type="text" id="cep" name="cep" value="${dados.endereco?.cep || ''}">
                            </div>
                            <div class="form-group">
                                <label for="uf">UF</label>
                                <select id="uf" name="uf">
                                    <option value="">Selecione...</option>
                                    <option value="SP" ${dados.endereco?.uf === 'SP' ? 'selected' : ''}>São Paulo</option>
                                    <option value="RJ" ${dados.endereco?.uf === 'RJ' ? 'selected' : ''}>Rio de Janeiro</option>
                                    <option value="MG" ${dados.endereco?.uf === 'MG' ? 'selected' : ''}>Minas Gerais</option>
                                    <!-- Adicionar mais estados conforme necessário -->
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="cidade">Cidade</label>
                                <input type="text" id="cidade" name="cidade" value="${dados.endereco?.cidade || ''}">
                            </div>
                            <div class="form-group">
                                <label for="bairro">Bairro</label>
                                <input type="text" id="bairro" name="bairro" value="${dados.endereco?.bairro || ''}">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="rua">Endereço</label>
                                <input type="text" id="rua" name="rua" value="${dados.endereco?.rua || ''}" placeholder="Rua, número, complemento">
                            </div>
                        </div>
                    </div>
                    
                    <div id="observacoes" class="tab-panel">
                        <div class="form-group">
                            <label for="observacoes_text">Observações</label>
                            <textarea id="observacoes_text" name="observacoes" rows="6" placeholder="Informações adicionais sobre o funcionário...">${dados.observacoes || ''}</textarea>
                        </div>
                    </div>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="gestãoFuncionarios.fecharModal()">Cancelar</button>
                    <button type="submit" class="btn btn-primary">
                        ${funcionario ? 'Atualizar' : 'Cadastrar'} Funcionário
                    </button>
                </div>
            </form>
        `;
    }

    obterDadosFormulario(form) {
        const formData = new FormData(form);
        const dados = {};
        
        for (let [key, value] of formData.entries()) {
            if (key.startsWith('endereco_')) {
                if (!dados.endereco) dados.endereco = {};
                dados.endereco[key.replace('endereco_', '')] = value;
            } else {
                dados[key] = value;
            }
        }
        
        // Processar campos específicos
        if (dados.salario) dados.salario = parseFloat(dados.salario);
        if (dados.departamento_id) dados.departamento_id = parseInt(dados.departamento_id);
        
        return dados;
    }

    adicionarFuncionario(dados) {
        const novoId = Math.max(...this.funcionarios.map(f => f.id), 0) + 1;
        const novoFuncionario = {
            id: novoId,
            ...dados,
            endereco: dados.endereco || {},
            beneficios: [],
            foto: null
        };
        
        this.funcionarios.push(novoFuncionario);
        this.renderizarLista();
        
        console.log('✅ Funcionário adicionado:', novoFuncionario);
        this.mostrarNotificacao('Funcionário cadastrado com sucesso!', 'success');
    }

    atualizarFuncionario(id, dados) {
        const index = this.funcionarios.findIndex(f => f.id === id);
        if (index !== -1) {
            this.funcionarios[index] = { ...this.funcionarios[index], ...dados };
            this.renderizarLista();
            
            console.log('✅ Funcionário atualizado:', this.funcionarios[index]);
            this.mostrarNotificacao('Funcionário atualizado com sucesso!', 'success');
        }
    }

    editarFuncionario(id) {
        const funcionario = this.funcionarios.find(f => f.id === id);
        if (funcionario) {
            this.abrirModalCadastro(funcionario);
        }
    }

    excluirFuncionario(id) {
        const funcionario = this.funcionarios.find(f => f.id === id);
        if (funcionario && confirm(`Tem certeza que deseja excluir ${funcionario.nome}?`)) {
            this.funcionarios = this.funcionarios.filter(f => f.id !== id);
            this.renderizarLista();
            
            console.log('🗑️ Funcionário excluído:', funcionario);
            this.mostrarNotificacao('Funcionário excluído com sucesso!', 'success');
        }
    }

    visualizarFuncionario(id) {
        const funcionario = this.funcionarios.find(f => f.id === id);
        if (!funcionario) return;
        
        const departamento = this.departamentos.find(d => d.id === funcionario.departamento_id);
        
        const conteudo = `
            <div class="funcionario-detalhes">
                <div class="funcionario-header">
                    <div class="funcionario-avatar-grande">
                        ${funcionario.foto ? 
                            `<img src="${funcionario.foto}" alt="${funcionario.nome}">` :
                            `<div class="avatar-placeholder-grande">${funcionario.nome.split(' ').map(n => n[0]).join('')}</div>`
                        }
                    </div>
                    <div class="funcionario-info-principal">
                        <h2>${funcionario.nome}</h2>
                        <p class="cargo-departamento">${funcionario.cargo} - ${departamento?.nome || 'N/A'}</p>
                        <div class="status-badge ${funcionario.status}">${funcionario.status === 'ativo' ? 'Ativo' : 'Inativo'}</div>
                    </div>
                </div>
                
                <div class="funcionario-dados-grid">
                    <div class="dados-grupo">
                        <h4><i class="fas fa-user"></i> Dados Pessoais</h4>
                        <div class="dados-lista">
                            <div class="dado-item">
                                <span class="dado-label">E-mail:</span>
                                <span class="dado-valor">${funcionario.email}</span>
                            </div>
                            <div class="dado-item">
                                <span class="dado-label">Telefone:</span>
                                <span class="dado-valor">${funcionario.telefone || 'Não informado'}</span>
                            </div>
                            <div class="dado-item">
                                <span class="dado-label">CPF:</span>
                                <span class="dado-valor">${funcionario.cpf}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="dados-grupo">
                        <h4><i class="fas fa-briefcase"></i> Dados Profissionais</h4>
                        <div class="dados-lista">
                            <div class="dado-item">
                                <span class="dado-label">Data de Admissão:</span>
                                <span class="dado-valor">${new Date(funcionario.data_admissao).toLocaleDateString('pt-BR')}</span>
                            </div>
                            <div class="dado-item">
                                <span class="dado-label">Salário:</span>
                                <span class="dado-valor">R$ ${funcionario.salario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div class="dado-item">
                                <span class="dado-label">Tempo de Empresa:</span>
                                <span class="dado-valor">${this.calcularTempoEmpresa(funcionario.data_admissao)}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="dados-grupo">
                        <h4><i class="fas fa-map-marker-alt"></i> Endereço</h4>
                        <div class="dados-lista">
                            <div class="dado-item">
                                <span class="dado-label">CEP:</span>
                                <span class="dado-valor">${funcionario.endereco?.cep || 'Não informado'}</span>
                            </div>
                            <div class="dado-item">
                                <span class="dado-label">Cidade/UF:</span>
                                <span class="dado-valor">${funcionario.endereco?.cidade || 'Não informado'}${funcionario.endereco?.uf ? '/' + funcionario.endereco.uf : ''}</span>
                            </div>
                            <div class="dado-item">
                                <span class="dado-label">Endereço:</span>
                                <span class="dado-valor">${funcionario.endereco?.rua || 'Não informado'}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="dados-grupo">
                        <h4><i class="fas fa-gift"></i> Benefícios</h4>
                        <div class="beneficios-lista">
                            ${funcionario.beneficios?.length ? 
                                funcionario.beneficios.map(b => `<span class="beneficio-tag">${this.formatarBeneficio(b)}</span>`).join('') :
                                '<span class="sem-beneficios">Nenhum benefício cadastrado</span>'
                            }
                        </div>
                    </div>
                </div>
                
                ${funcionario.observacoes ? `
                    <div class="observacoes-funcionario">
                        <h4><i class="fas fa-sticky-note"></i> Observações</h4>
                        <p>${funcionario.observacoes}</p>
                    </div>
                ` : ''}
            </div>
        `;
        
        this.criarModal(`Funcionário: ${funcionario.nome}`, conteudo, 'modal-grande');
    }

    calcularTempoEmpresa(dataAdmissao) {
        const hoje = new Date();
        const admissao = new Date(dataAdmissao);
        const diffTime = Math.abs(hoje - admissao);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        const anos = Math.floor(diffDays / 365);
        const meses = Math.floor((diffDays % 365) / 30);
        
        if (anos > 0) {
            return `${anos} ano(s) e ${meses} mês(es)`;
        } else {
            return `${meses} mês(es)`;
        }
    }

    formatarBeneficio(beneficio) {
        const beneficios = {
            'vr': 'Vale Refeição',
            'cs_saude': 'CS Saúde',
            'plano_saude': 'Plano de Saúde',
            'plano_odonto': 'Plano Odontológico',
            'seguro_vida': 'Seguro de Vida'
        };
        
        return beneficios[beneficio] || beneficio;
    }

    exportarFuncionarios() {
        console.log('📤 Exportando funcionários...');
        
        const csvContent = this.gerarCSVFuncionarios();
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `funcionarios_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.mostrarNotificacao('Relatório exportado com sucesso!', 'success');
    }

    // Função utilitária para mascarar CPF (ex: 123.***.***-01)
    maskCPF(cpf) {
        if (!cpf) return '';
        // Remove não dígitos
        const digits = cpf.replace(/\D/g, '');
        if (digits.length !== 11) return cpf;
        return `${digits.substr(0,3)}.***.***-${digits.substr(9,2)}`;
    }

    // Função utilitária para mascarar salário (ex: R$ ***,00)
    maskSalario(salario) {
        if (!salario && salario !== 0) return '';
        return 'R$ ***,**';
    }

    gerarCSVFuncionarios() {
        const headers = ['ID', 'Nome', 'Email', 'Telefone', 'CPF', 'Cargo', 'Departamento', 'Salário', 'Data Admissão', 'Status'];

        const rows = this.funcionarios.map(f => {
            const departamento = this.departamentos.find(d => d.id === f.departamento_id);
            return [
                f.id,
                f.nome,
                f.email,
                f.telefone || '',
                this.maskCPF(f.cpf),
                f.cargo,
                departamento?.nome || '',
                this.maskSalario(f.salario),
                f.data_admissao,
                f.status
            ];
        });

        const csvContent = [headers, ...rows]
            .map(row => row.map(field => `"${field}"`).join(','))
            .join('\n');

        return csvContent;
    }

    importarFuncionarios() {
        console.log('📥 Importando funcionários...');
        
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        this.processarCSVImportacao(e.target.result);
                        this.mostrarNotificacao('Funcionários importados com sucesso!', 'success');
                    } catch (error) {
                        console.error('Erro na importação:', error);
                        this.mostrarNotificacao('Erro ao importar arquivo. Verifique o formato.', 'error');
                    }
                };
                reader.readAsText(file);
            }
        };
        
        input.click();
    }

    processarCSVImportacao(csvContent) {
        const lines = csvContent.split('\n');
        const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
        
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim()) {
                const values = lines[i].split(',').map(v => v.replace(/"/g, ''));
                const funcionario = {};
                
                headers.forEach((header, index) => {
                    funcionario[header.toLowerCase().replace(' ', '_')] = values[index];
                });
                
                // Processar e adicionar funcionário
                if (funcionario.nome && funcionario.email) {
                    this.adicionarFuncionario(funcionario);
                }
            }
        }
        
        this.renderizarLista();
    }

    // Funções auxiliares para modais e notificações
    criarModal(titulo, conteudo, tamanho = 'modal-normal') {
        const modal = document.createElement('div');
        modal.className = `modal ${tamanho}`;
        modal.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-container">
                <div class="modal-header">
                    <h3 class="modal-title">${titulo}</h3>
                    <button class="modal-close" onclick="gestãoFuncionarios.fecharModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-content">
                    ${conteudo}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'flex';
        
        // Setup tab functionality
        this.setupTabFunctionality(modal);
        
        return modal;
    }

    setupTabFunctionality(modal) {
        const tabButtons = modal.querySelectorAll('.tab-button');
        const tabPanels = modal.querySelectorAll('.tab-panel');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.dataset.tab;
                
                // Remove active class from all buttons and panels
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanels.forEach(panel => panel.classList.remove('active'));
                
                // Add active class to clicked button and corresponding panel
                button.classList.add('active');
                modal.querySelector(`#${targetTab}`).classList.add('active');
            });
        });
    }

    fecharModal() {
        const modal = document.querySelector('.modal');
        if (modal) {
            document.body.removeChild(modal);
        }
    }

    mostrarNotificacao(mensagem, tipo = 'info') {
        const notificação = document.createElement('div');
        notificação.className = `notificação notificação-${tipo}`;
        notificação.innerHTML = `
            <div class="notificação-content">
                <i class="fas ${tipo === 'success' ? 'fa-check-circle' : tipo === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
                <span>${mensagem}</span>
            </div>
            <button class="notificação-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        document.body.appendChild(notificação);
        
        // Auto-remove após 5 segundos
        setTimeout(() => {
            if (notificação.parentElement) {
                notificação.remove();
            }
        }, 5000);
    }
}

// Inicializar o sistema quando o DOM estiver pronto
let gestãoFuncionarios;

document.addEventListener('DOMContentLoaded', function() {
    gestãoFuncionarios = new GestãoFuncionarios();
});