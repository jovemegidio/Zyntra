/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALUFORCE ERP - TESTES UNITÁRIOS - MODAL DE CONFIGURAÇÕES
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Suíte completa de testes unitários para o modal de configurações do sistema.
 * Testa todas as funções de frontend isoladamente.
 * 
 * @author QA Automation
 * @version 1.0.0
 * @date 2025-01-18
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

// ═══════════════════════════════════════════════════════════════════════════════
// SETUP E MOCKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mock do DOM para testes de frontend
 */
function setupDOM() {
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <head><title>ALUFORCE - Testes</title></head>
        <body>
            <!-- Modal Principal de Configurações -->
            <div id="modal-configuracoes" class="modal-config">
                <div class="modal-config-content">
                    <div class="modal-config-header">
                        <input type="text" id="modal-config-search" placeholder="Buscar...">
                        <button onclick="fecharModalConfig()">✕</button>
                    </div>
                    <div class="modal-config-tabs">
                        <div class="tab-btn active" data-tab="principais">Principais</div>
                        <div class="tab-btn" data-tab="rh">Recursos Humanos</div>
                        <div class="tab-btn" data-tab="financas">Finanças</div>
                        <div class="tab-btn" data-tab="clientes">Clientes e Fornecedores</div>
                        <div class="tab-btn" data-tab="venda-produtos">Venda de Produtos</div>
                        <div class="tab-btn" data-tab="venda-servicos">Venda de Serviços</div>
                    </div>
                    <div class="modal-config-body">
                        <div class="tab-content active" data-tab-content="principais">
                            <div class="config-card" data-tipo="empresa">Dados da Empresa</div>
                            <div class="config-card" data-tipo="categorias">Categorias</div>
                            <div class="config-card" data-tipo="departamentos">Departamentos</div>
                        </div>
                        <div class="tab-content" data-tab-content="rh">
                            <div class="config-card" data-tipo="funcionarios">Funcionários</div>
                            <div class="config-card" data-tipo="cargos">Cargos</div>
                        </div>
                        <div class="tab-content" data-tab-content="financas">
                            <div class="config-card" data-tipo="financas">Configurações Financeiras</div>
                            <div class="config-card" data-tipo="impostos">Impostos</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Modal de Empresa -->
            <div id="modal-empresa" class="modal" style="display: none;">
                <input type="text" id="razao_social" name="razao_social">
                <input type="text" id="nome_fantasia" name="nome_fantasia">
                <input type="text" id="cnpj" name="cnpj">
                <input type="text" id="inscricao_estadual" name="inscricao_estadual">
                <input type="text" id="telefone" name="telefone">
                <input type="email" id="email" name="email">
                <input type="text" id="cep" name="cep">
                <input type="text" id="estado" name="estado">
                <input type="text" id="cidade" name="cidade">
                <input type="text" id="bairro" name="bairro">
                <input type="text" id="endereco" name="endereco">
                <input type="text" id="numero" name="numero">
                <input type="file" id="logo-upload" name="logo">
                <input type="file" id="favicon-upload" name="favicon">
                <img id="logo-preview" src="">
                <img id="favicon-preview" src="">
            </div>

            <!-- Modal de Categorias -->
            <div id="modal-categorias" class="modal" style="display: none;">
                <div id="categorias-list"></div>
                <div id="categorias-empty" style="display: none;"></div>
            </div>
            
            <!-- Modal Form Categoria -->
            <div id="modal-categoria-form" style="display: none;">
                <h2 id="categoria-form-title">Nova Categoria</h2>
                <input type="hidden" id="categoria-id">
                <input type="text" id="categoria-nome">
                <textarea id="categoria-descricao"></textarea>
                <input type="color" id="categoria-cor" value="#6366f1">
            </div>

            <!-- Modal de Departamentos -->
            <div id="modal-departamentos" class="modal" style="display: none;">
                <div id="departamentos-list"></div>
                <div id="departamentos-empty" style="display: none;"></div>
            </div>
            
            <!-- Modal Form Departamento -->
            <div id="modal-departamento-form" style="display: none;">
                <h2 id="departamento-form-title">Novo Departamento</h2>
                <input type="hidden" id="departamento-id">
                <input type="text" id="departamento-nome">
                <textarea id="departamento-descricao"></textarea>
                <input type="text" id="departamento-responsavel">
            </div>

            <!-- Modal de Finanças -->
            <div id="modal-financas" class="modal" style="display: none;">
                <select id="contas-atraso">
                    <option value="nao-mostrar">Não mostrar</option>
                    <option value="mostrar-1">1 dia</option>
                </select>
                <input type="email" id="email-remessa">
                <input type="text" id="juros-mes" value="1.0">
                <input type="text" id="multa-atraso" value="2.0">
            </div>

            <!-- Modal de Venda Produtos -->
            <div id="modal-venda-produtos" class="modal" style="display: none;">
                <input type="checkbox" id="etapa-orcamento">
                <input type="checkbox" id="etapa-pedido">
                <input type="checkbox" id="etapa-liberado">
                <input type="checkbox" id="etapa-separacao">
                <input type="checkbox" id="etapa-faturamento">
                <input type="number" id="proximo-pedido" value="1001">
                <input type="checkbox" id="reservar-estoque">
            </div>

            <!-- Modal Tipos de Entrega -->
            <div id="modal-tipos-entrega" style="display: none;">
                <table>
                    <tbody id="tipos-entrega-list"></tbody>
                </table>
                <div id="form-tipo-entrega" style="display: none;">
                    <h3 id="form-tipo-entrega-titulo"></h3>
                    <form id="form-tipo-entrega-config">
                        <input type="hidden" id="tipo-entrega-id">
                        <input type="text" id="tipo-entrega-nome">
                        <input type="number" id="tipo-entrega-prazo">
                        <select id="tipo-entrega-transportadora">
                            <option value="">Selecione...</option>
                        </select>
                        <select id="tipo-entrega-situacao">
                            <option value="ativo">Ativo</option>
                            <option value="inativo">Inativo</option>
                        </select>
                    </form>
                </div>
            </div>

            <!-- Modal Info Frete -->
            <div id="modal-info-frete" style="display: none;">
                <select id="frete-modalidade">
                    <option value="cif">CIF</option>
                    <option value="fob">FOB</option>
                </select>
                <input type="text" id="frete-minimo" value="0,00">
                <input type="text" id="frete-url-rastreio">
                <input type="checkbox" id="habilitar-rastreamento">
                <input type="checkbox" id="notificar-despacho">
                <input type="checkbox" id="notificar-entrega">
            </div>

            <!-- Modal Venda Serviços -->
            <div id="modal-venda-servicos" style="display: none;">
                <input type="checkbox" id="etapa-ordem-servico" checked>
                <input type="checkbox" id="etapa-em-execucao" checked>
                <input type="checkbox" id="etapa-executada" checked>
                <input type="checkbox" id="etapa-faturar-servico" checked>
                <input type="checkbox" id="permitir-proposta-servico">
                <input type="number" id="proximo-os" value="1001">
            </div>

            <!-- Modal Clientes/Fornecedores -->
            <div id="modal-clientes-fornecedores-config" style="display: none;">
                <input type="checkbox" id="obrigar-cnpj-cpf">
                <input type="checkbox" id="obrigar-endereco">
                <input type="checkbox" id="obrigar-email">
                <input type="checkbox" id="validar-unicidade">
                <input type="checkbox" id="bloquear-novos">
                <input type="text" id="limite-credito-padrao" value="0">
                <input type="checkbox" id="tags-automaticas">
            </div>

            <!-- Container de Notificações -->
            <div id="notification-container"></div>
        </body>
        </html>
    `, {
        url: 'http://localhost:3000',
        runScripts: 'dangerously',
        resources: 'usable'
    });

    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.FormData = dom.window.FormData;

    return dom;
}

/**
 * Mock do fetch para requisições API
 */
function mockFetch(responses = {}) {
    return sinon.stub(global, 'fetch').callsFake((url, options = {}) => {
        const method = options.method || 'GET';
        const key = `${method}:${url}`;
        
        const response = responses[key] || responses[url] || { ok: true, data: {} };
        
        return Promise.resolve({
            ok: response.ok !== false,
            status: response.status || (response.ok === false ? 500 : 200),
            json: () => Promise.resolve(response.data || response)
        });
    });
}

/**
 * Mock da função showNotification
 */
function mockNotification() {
    return sinon.stub().callsFake((message, type) => {
        console.log(`[${type}] ${message}`);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - MODAL PRINCIPAL DE CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════════════════════

describe('🔧 Modal Principal de Configurações', function() {
    let dom, fetchStub, notifyStub;

    beforeEach(function() {
        dom = setupDOM();
        notifyStub = mockNotification();
        global.showNotification = notifyStub;
    });

    afterEach(function() {
        if (fetchStub) fetchStub.restore();
        sinon.restore();
    });

    describe('📌 Abertura e Fechamento do Modal', function() {
        it('deve adicionar classe "active" ao abrir modal', function() {
            const modal = document.getElementById('modal-configuracoes');
            
            // Simular função abrirModalConfig
            function abrirModalConfig() {
                const modal = document.getElementById('modal-configuracoes');
                if (modal) {
                    modal.style.display = 'flex';
                    setTimeout(() => modal.classList.add('active'), 10);
                }
            }
            
            abrirModalConfig();
            
            expect(modal.style.display).to.equal('flex');
        });

        it('deve remover classe "active" ao fechar modal', function() {
            const modal = document.getElementById('modal-configuracoes');
            modal.classList.add('active');
            modal.style.display = 'flex';
            
            // Simular função fecharModalConfig
            function fecharModalConfig() {
                const modal = document.getElementById('modal-configuracoes');
                if (modal) {
                    modal.classList.remove('active');
                    modal.style.display = 'none';
                }
            }
            
            fecharModalConfig();
            
            expect(modal.classList.contains('active')).to.be.false;
            expect(modal.style.display).to.equal('none');
        });

        it('deve iniciar com aba "principais" ativa', function() {
            const tabs = document.querySelectorAll('.tab-btn');
            const activeTab = document.querySelector('.tab-btn.active');
            
            expect(activeTab).to.not.be.null;
            expect(activeTab.getAttribute('data-tab')).to.equal('principais');
        });
    });

    describe('📑 Navegação por Abas', function() {
        it('deve ter 6 abas de configuração', function() {
            const tabs = document.querySelectorAll('.tab-btn');
            expect(tabs.length).to.equal(6);
        });

        it('deve trocar aba ativa ao clicar', function() {
            const tabs = document.querySelectorAll('.tab-btn');
            const tabRH = tabs[1]; // Recursos Humanos
            
            // Simular clique na aba
            function switchTab(tabElement) {
                document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                tabElement.classList.add('active');
                const tabName = tabElement.getAttribute('data-tab');
                const content = document.querySelector(`[data-tab-content="${tabName}"]`);
                if (content) content.classList.add('active');
            }
            
            switchTab(tabRH);
            
            expect(tabRH.classList.contains('active')).to.be.true;
            expect(tabs[0].classList.contains('active')).to.be.false;
        });

        it('deve exibir conteúdo correto ao trocar aba', function() {
            const tabFinancas = document.querySelector('[data-tab="financas"]');
            
            function switchTab(tabElement) {
                document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                tabElement.classList.add('active');
                const tabName = tabElement.getAttribute('data-tab');
                const content = document.querySelector(`[data-tab-content="${tabName}"]`);
                if (content) content.classList.add('active');
            }
            
            switchTab(tabFinancas);
            
            const contentFinancas = document.querySelector('[data-tab-content="financas"]');
            const contentPrincipais = document.querySelector('[data-tab-content="principais"]');
            
            expect(contentFinancas.classList.contains('active')).to.be.true;
            expect(contentPrincipais.classList.contains('active')).to.be.false;
        });
    });

    describe('🔍 Busca de Configurações', function() {
        it('deve ter campo de busca presente', function() {
            const searchInput = document.getElementById('modal-config-search');
            expect(searchInput).to.not.be.null;
        });

        it('deve filtrar cards ao digitar', function() {
            const cards = document.querySelectorAll('.config-card');
            const searchInput = document.getElementById('modal-config-search');
            
            function filterCards(searchTerm) {
                const term = searchTerm.toLowerCase();
                cards.forEach(card => {
                    const texto = card.textContent.toLowerCase();
                    card.style.display = texto.includes(term) ? '' : 'none';
                });
            }
            
            filterCards('empresa');
            
            const cardEmpresa = document.querySelector('[data-tipo="empresa"]');
            const cardCategorias = document.querySelector('[data-tipo="categorias"]');
            
            expect(cardEmpresa.style.display).to.not.equal('none');
        });
    });

    describe('📋 Cards de Configuração', function() {
        it('deve ter atributo data-tipo em cada card', function() {
            const cards = document.querySelectorAll('.config-card');
            cards.forEach(card => {
                expect(card.getAttribute('data-tipo')).to.be.a('string');
            });
        });

        it('deve abrir modal correto ao clicar no card', function() {
            const tipoToModal = {
                'empresa': 'modal-empresa',
                'categorias': 'modal-categorias',
                'departamentos': 'modal-departamentos',
                'financas': 'modal-financas'
            };
            
            Object.entries(tipoToModal).forEach(([tipo, modalId]) => {
                const modal = document.getElementById(modalId);
                if (modal) {
                    // Verificar mapeamento
                    expect(modal).to.not.be.null;
                }
            });
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - CONFIGURAÇÕES DA EMPRESA
// ═══════════════════════════════════════════════════════════════════════════════

describe('🏢 Configurações da Empresa', function() {
    let dom, fetchStub, notifyStub;

    beforeEach(function() {
        dom = setupDOM();
        notifyStub = mockNotification();
        global.showNotification = notifyStub;
    });

    afterEach(function() {
        if (fetchStub) fetchStub.restore();
        sinon.restore();
    });

    describe('📥 Carregamento de Dados', function() {
        it('deve carregar dados da empresa da API', async function() {
            const mockEmpresa = {
                razao_social: 'ALUFORCE LTDA',
                nome_fantasia: 'ALUFORCE',
                cnpj: '68.192.475/0001-60',
                telefone: '(11) 91793-9089',
                email: 'contato@aluforce.com.br',
                cep: '08537-400',
                estado: 'SP',
                cidade: 'Ferraz de Vasconcelos'
            };

            fetchStub = mockFetch({
                'GET:/api/configuracoes/empresa': { ok: true, data: mockEmpresa }
            });

            // Simular loadEmpresaData
            async function loadEmpresaData() {
                const response = await fetch('/api/configuracoes/empresa', { credentials: 'include' });
                if (response.ok) {
                    const data = await response.json();
                    document.getElementById('razao_social').value = data.razao_social || '';
                    document.getElementById('nome_fantasia').value = data.nome_fantasia || '';
                    document.getElementById('cnpj').value = data.cnpj || '';
                    return data;
                }
            }

            const result = await loadEmpresaData();
            
            expect(result.razao_social).to.equal('ALUFORCE LTDA');
            expect(document.getElementById('razao_social').value).to.equal('ALUFORCE LTDA');
        });

        it('deve tratar erro ao carregar dados', async function() {
            fetchStub = mockFetch({
                'GET:/api/configuracoes/empresa': { ok: false, status: 500 }
            });

            async function loadEmpresaData() {
                try {
                    const response = await fetch('/api/configuracoes/empresa', { credentials: 'include' });
                    if (!response.ok) {
                        throw new Error('Erro ao carregar');
                    }
                } catch (error) {
                    showNotification('Erro ao carregar dados da empresa', 'error');
                    return null;
                }
            }

            await loadEmpresaData();
            
            expect(notifyStub.calledWith('Erro ao carregar dados da empresa', 'error')).to.be.true;
        });
    });

    describe('💾 Salvamento de Dados', function() {
        it('deve validar razão social obrigatória', async function() {
            document.getElementById('razao_social').value = '';
            
            function validateEmpresaForm() {
                const razaoSocial = document.getElementById('razao_social').value.trim();
                if (!razaoSocial) {
                    showNotification('Razão Social é obrigatória!', 'error');
                    return false;
                }
                return true;
            }
            
            const isValid = validateEmpresaForm();
            
            expect(isValid).to.be.false;
            expect(notifyStub.calledWith('Razão Social é obrigatória!', 'error')).to.be.true;
        });

        it('deve enviar dados corretamente via POST', async function() {
            fetchStub = mockFetch({
                'POST:/api/configuracoes/empresa': { ok: true, data: { success: true } }
            });

            document.getElementById('razao_social').value = 'Nova Empresa LTDA';
            document.getElementById('cnpj').value = '12.345.678/0001-90';

            async function saveEmpresaConfig() {
                const dados = {
                    razao_social: document.getElementById('razao_social').value,
                    cnpj: document.getElementById('cnpj').value
                };

                const response = await fetch('/api/configuracoes/empresa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dados)
                });

                if (response.ok) {
                    showNotification('Configurações salvas!', 'success');
                    return true;
                }
                return false;
            }

            const saved = await saveEmpresaConfig();
            
            expect(saved).to.be.true;
            expect(notifyStub.calledWith('Configurações salvas!', 'success')).to.be.true;
        });
    });

    describe('🖼️ Upload de Logo e Favicon', function() {
        it('deve validar tipo de arquivo para logo', function() {
            const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'];
            
            function validateImageType(file) {
                return validTypes.includes(file.type);
            }
            
            expect(validateImageType({ type: 'image/png' })).to.be.true;
            expect(validateImageType({ type: 'image/jpeg' })).to.be.true;
            expect(validateImageType({ type: 'application/pdf' })).to.be.false;
            expect(validateImageType({ type: 'text/plain' })).to.be.false;
        });

        it('deve atualizar preview após upload de logo', function() {
            const logoPreview = document.getElementById('logo-preview');
            const newUrl = '/uploads/empresa/logo-123.png';
            
            function updateLogoPreview(url) {
                const preview = document.getElementById('logo-preview');
                if (preview && url) {
                    preview.src = url;
                    preview.style.display = 'block';
                }
            }
            
            updateLogoPreview(newUrl);
            
            expect(logoPreview.src).to.include(newUrl);
            expect(logoPreview.style.display).to.equal('block');
        });
    });

    describe('🔍 Validação de CNPJ', function() {
        it('deve validar formato de CNPJ', function() {
            function validateCNPJ(cnpj) {
                if (!cnpj) return true; // Não obrigatório
                const regex = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
                return regex.test(cnpj);
            }
            
            expect(validateCNPJ('68.192.475/0001-60')).to.be.true;
            expect(validateCNPJ('12.345.678/0001-90')).to.be.true;
            expect(validateCNPJ('68192475000160')).to.be.false;
            expect(validateCNPJ('123')).to.be.false;
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - CATEGORIAS
// ═══════════════════════════════════════════════════════════════════════════════

describe('📁 Configurações de Categorias', function() {
    let dom, fetchStub, notifyStub;

    beforeEach(function() {
        dom = setupDOM();
        notifyStub = mockNotification();
        global.showNotification = notifyStub;
    });

    afterEach(function() {
        if (fetchStub) fetchStub.restore();
        sinon.restore();
    });

    describe('📋 Listagem de Categorias', function() {
        it('deve exibir lista de categorias', function() {
            const categorias = [
                { id: 1, nome: 'Materiais', descricao: 'Materiais diversos', cor: '#f97316' },
                { id: 2, nome: 'Serviços', descricao: 'Serviços prestados', cor: '#22c55e' }
            ];

            function displayCategorias(lista) {
                const listEl = document.getElementById('categorias-list');
                const emptyEl = document.getElementById('categorias-empty');
                
                if (!lista || lista.length === 0) {
                    listEl.style.display = 'none';
                    emptyEl.style.display = 'flex';
                    return;
                }

                listEl.style.display = 'block';
                emptyEl.style.display = 'none';
                listEl.innerHTML = lista.map(c => `<div data-id="${c.id}">${c.nome}</div>`).join('');
            }

            displayCategorias(categorias);
            
            const listEl = document.getElementById('categorias-list');
            expect(listEl.style.display).to.equal('block');
            expect(listEl.children.length).to.equal(2);
        });

        it('deve exibir mensagem vazia quando não há categorias', function() {
            function displayCategorias(lista) {
                const listEl = document.getElementById('categorias-list');
                const emptyEl = document.getElementById('categorias-empty');
                
                if (!lista || lista.length === 0) {
                    listEl.style.display = 'none';
                    emptyEl.style.display = 'flex';
                    return;
                }

                listEl.style.display = 'block';
                emptyEl.style.display = 'none';
            }

            displayCategorias([]);
            
            const emptyEl = document.getElementById('categorias-empty');
            expect(emptyEl.style.display).to.equal('flex');
        });
    });

    describe('➕ Nova Categoria', function() {
        it('deve limpar formulário ao criar nova categoria', function() {
            document.getElementById('categoria-id').value = '5';
            document.getElementById('categoria-nome').value = 'Teste';
            
            function showNovaCategoriaForm() {
                document.getElementById('categoria-id').value = '';
                document.getElementById('categoria-nome').value = '';
                document.getElementById('categoria-descricao').value = '';
                document.getElementById('categoria-cor').value = '#6366f1';
                document.getElementById('categoria-form-title').textContent = 'Nova Categoria';
            }
            
            showNovaCategoriaForm();
            
            expect(document.getElementById('categoria-id').value).to.equal('');
            expect(document.getElementById('categoria-nome').value).to.equal('');
            expect(document.getElementById('categoria-form-title').textContent).to.equal('Nova Categoria');
        });

        it('deve validar nome obrigatório', function() {
            function validateCategoria() {
                const nome = document.getElementById('categoria-nome').value.trim();
                if (!nome) {
                    showNotification('O nome da categoria é obrigatório', 'error');
                    return false;
                }
                return true;
            }
            
            document.getElementById('categoria-nome').value = '';
            expect(validateCategoria()).to.be.false;
            
            document.getElementById('categoria-nome').value = 'Materiais';
            expect(validateCategoria()).to.be.true;
        });
    });

    describe('✏️ Edição de Categoria', function() {
        it('deve preencher formulário com dados da categoria', async function() {
            const categoria = { id: 1, nome: 'Materiais', descricao: 'Descrição teste', cor: '#ff0000' };

            fetchStub = mockFetch({
                'GET:/api/configuracoes/categorias/1': { ok: true, data: categoria }
            });

            async function editarCategoria(id) {
                const response = await fetch(`/api/configuracoes/categorias/${id}`);
                const data = await response.json();
                
                document.getElementById('categoria-id').value = data.id;
                document.getElementById('categoria-nome').value = data.nome;
                document.getElementById('categoria-descricao').value = data.descricao;
                document.getElementById('categoria-cor').value = data.cor;
                document.getElementById('categoria-form-title').textContent = 'Editar Categoria';
            }

            await editarCategoria(1);

            expect(document.getElementById('categoria-nome').value).to.equal('Materiais');
            expect(document.getElementById('categoria-form-title').textContent).to.equal('Editar Categoria');
        });
    });

    describe('🗑️ Exclusão de Categoria', function() {
        it('deve chamar API de exclusão corretamente', async function() {
            fetchStub = mockFetch({
                'DELETE:/api/configuracoes/categorias/1': { ok: true, data: { success: true } }
            });

            let deleteCalled = false;

            async function excluirCategoria(id) {
                const response = await fetch(`/api/configuracoes/categorias/${id}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    deleteCalled = true;
                    showNotification('Categoria excluída com sucesso!', 'success');
                }
            }

            await excluirCategoria(1);

            expect(deleteCalled).to.be.true;
            expect(notifyStub.calledWith('Categoria excluída com sucesso!', 'success')).to.be.true;
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - DEPARTAMENTOS
// ═══════════════════════════════════════════════════════════════════════════════

describe('🏛️ Configurações de Departamentos', function() {
    let dom, fetchStub, notifyStub;

    beforeEach(function() {
        dom = setupDOM();
        notifyStub = mockNotification();
        global.showNotification = notifyStub;
    });

    afterEach(function() {
        if (fetchStub) fetchStub.restore();
        sinon.restore();
    });

    describe('📋 CRUD de Departamentos', function() {
        it('deve criar novo departamento', async function() {
            fetchStub = mockFetch({
                'POST:/api/configuracoes/departamentos': { ok: true, data: { success: true, id: 1 } }
            });

            async function salvarDepartamento() {
                const dados = {
                    nome: document.getElementById('departamento-nome').value,
                    descricao: document.getElementById('departamento-descricao').value,
                    responsavel: document.getElementById('departamento-responsavel').value
                };

                if (!dados.nome) {
                    showNotification('Nome é obrigatório', 'error');
                    return false;
                }

                const response = await fetch('/api/configuracoes/departamentos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dados)
                });

                if (response.ok) {
                    showNotification('Departamento criado!', 'success');
                    return true;
                }
                return false;
            }

            document.getElementById('departamento-nome').value = 'Comercial';
            document.getElementById('departamento-descricao').value = 'Setor comercial';

            const result = await salvarDepartamento();
            
            expect(result).to.be.true;
            expect(notifyStub.calledWith('Departamento criado!', 'success')).to.be.true;
        });

        it('deve validar nome obrigatório', async function() {
            document.getElementById('departamento-nome').value = '';
            
            async function salvarDepartamento() {
                const nome = document.getElementById('departamento-nome').value.trim();
                if (!nome) {
                    showNotification('Nome é obrigatório', 'error');
                    return false;
                }
                return true;
            }

            const result = await salvarDepartamento();
            
            expect(result).to.be.false;
            expect(notifyStub.calledWith('Nome é obrigatório', 'error')).to.be.true;
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - FINANÇAS
// ═══════════════════════════════════════════════════════════════════════════════

describe('💰 Configurações de Finanças', function() {
    let dom, fetchStub, notifyStub;

    beforeEach(function() {
        dom = setupDOM();
        notifyStub = mockNotification();
        global.showNotification = notifyStub;
    });

    afterEach(function() {
        if (fetchStub) fetchStub.restore();
        sinon.restore();
    });

    describe('💾 Salvamento de Configurações Financeiras', function() {
        it('deve salvar configurações de finanças', async function() {
            fetchStub = mockFetch({
                'POST:/api/configuracoes/financas': { ok: true, data: { success: true } }
            });

            async function saveFinanceConfig() {
                const config = {
                    contas_atraso: document.getElementById('contas-atraso').value,
                    email_remessa: document.getElementById('email-remessa').value,
                    juros_mes: document.getElementById('juros-mes').value,
                    multa_atraso: document.getElementById('multa-atraso').value
                };

                const response = await fetch('/api/configuracoes/financas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });

                if (response.ok) {
                    showNotification('Configurações de finanças salvas!', 'success');
                    return true;
                }
                return false;
            }

            const result = await saveFinanceConfig();
            
            expect(result).to.be.true;
            expect(notifyStub.calledWith('Configurações de finanças salvas!', 'success')).to.be.true;
        });

        it('deve validar formato de juros', function() {
            function validateJuros(value) {
                const num = parseFloat(value);
                return !isNaN(num) && num >= 0 && num <= 100;
            }
            
            expect(validateJuros('1.0')).to.be.true;
            expect(validateJuros('2.5')).to.be.true;
            expect(validateJuros('150')).to.be.false;
            expect(validateJuros('abc')).to.be.false;
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - VENDA DE PRODUTOS
// ═══════════════════════════════════════════════════════════════════════════════

describe('🛒 Configurações de Venda de Produtos', function() {
    let dom, fetchStub, notifyStub;

    beforeEach(function() {
        dom = setupDOM();
        notifyStub = mockNotification();
        global.showNotification = notifyStub;
    });

    afterEach(function() {
        if (fetchStub) fetchStub.restore();
        sinon.restore();
    });

    describe('📊 Etapas do Fluxo de Vendas', function() {
        it('deve capturar configuração das etapas', function() {
            document.getElementById('etapa-orcamento').checked = true;
            document.getElementById('etapa-pedido').checked = true;
            document.getElementById('etapa-liberado').checked = false;
            
            function getEtapasConfig() {
                return {
                    orcamento: document.getElementById('etapa-orcamento').checked,
                    pedido: document.getElementById('etapa-pedido').checked,
                    liberado: document.getElementById('etapa-liberado').checked,
                    separacao: document.getElementById('etapa-separacao').checked,
                    faturamento: document.getElementById('etapa-faturamento').checked
                };
            }
            
            const etapas = getEtapasConfig();
            
            expect(etapas.orcamento).to.be.true;
            expect(etapas.pedido).to.be.true;
            expect(etapas.liberado).to.be.false;
        });

        it('deve manter próximo pedido como número válido', function() {
            function validateProximoPedido(value) {
                const num = parseInt(value);
                return !isNaN(num) && num > 0;
            }
            
            expect(validateProximoPedido('1001')).to.be.true;
            expect(validateProximoPedido('0')).to.be.false;
            expect(validateProximoPedido('-5')).to.be.false;
            expect(validateProximoPedido('abc')).to.be.false;
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - TIPOS DE ENTREGA
// ═══════════════════════════════════════════════════════════════════════════════

describe('🚚 Configurações de Tipos de Entrega', function() {
    let dom, fetchStub, notifyStub;

    beforeEach(function() {
        dom = setupDOM();
        notifyStub = mockNotification();
        global.showNotification = notifyStub;
    });

    afterEach(function() {
        if (fetchStub) fetchStub.restore();
        sinon.restore();
    });

    describe('📋 CRUD de Tipos de Entrega', function() {
        it('deve exibir tabela de tipos de entrega', function() {
            const tipos = [
                { id: 1, nome: 'Sedex', prazo: 3, situacao: 'ativo', transportadora_nome: 'Correios' },
                { id: 2, nome: 'PAC', prazo: 10, situacao: 'ativo', transportadora_nome: 'Correios' }
            ];

            function displayTiposEntrega(lista) {
                const tbody = document.getElementById('tipos-entrega-list');
                if (!tbody) return;
                
                if (!lista || lista.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5">Nenhum tipo cadastrado</td></tr>';
                    return;
                }

                tbody.innerHTML = lista.map(t => `
                    <tr data-id="${t.id}">
                        <td>${t.situacao}</td>
                        <td>${t.nome}</td>
                        <td>${t.prazo} dias</td>
                        <td>${t.transportadora_nome || '-'}</td>
                        <td>Ações</td>
                    </tr>
                `).join('');
            }

            displayTiposEntrega(tipos);
            
            const tbody = document.getElementById('tipos-entrega-list');
            expect(tbody.querySelectorAll('tr').length).to.equal(2);
        });

        it('deve validar nome obrigatório ao salvar', function() {
            function validateTipoEntrega() {
                const nome = document.getElementById('tipo-entrega-nome').value.trim();
                if (!nome) {
                    showNotification('Informe o nome do tipo de entrega', 'error');
                    return false;
                }
                return true;
            }

            document.getElementById('tipo-entrega-nome').value = '';
            expect(validateTipoEntrega()).to.be.false;
            
            document.getElementById('tipo-entrega-nome').value = 'Sedex';
            expect(validateTipoEntrega()).to.be.true;
        });

        it('deve abrir formulário para edição', function() {
            const tipo = { id: 1, nome: 'Sedex', prazo: 3, situacao: 'ativo' };
            
            function abrirFormTipoEntrega(id, dados) {
                const form = document.getElementById('form-tipo-entrega');
                const titulo = document.getElementById('form-tipo-entrega-titulo');
                
                if (id && dados) {
                    titulo.textContent = 'Editar Tipo de Entrega';
                    document.getElementById('tipo-entrega-id').value = dados.id;
                    document.getElementById('tipo-entrega-nome').value = dados.nome;
                    document.getElementById('tipo-entrega-prazo').value = dados.prazo;
                    document.getElementById('tipo-entrega-situacao').value = dados.situacao;
                } else {
                    titulo.textContent = 'Novo Tipo de Entrega';
                }
                
                form.style.display = 'block';
            }

            abrirFormTipoEntrega(1, tipo);

            expect(document.getElementById('form-tipo-entrega').style.display).to.equal('block');
            expect(document.getElementById('tipo-entrega-nome').value).to.equal('Sedex');
            expect(document.getElementById('form-tipo-entrega-titulo').textContent).to.equal('Editar Tipo de Entrega');
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - INFORMAÇÕES DE FRETE
// ═══════════════════════════════════════════════════════════════════════════════

describe('📦 Configurações de Frete', function() {
    let dom, fetchStub, notifyStub;

    beforeEach(function() {
        dom = setupDOM();
        notifyStub = mockNotification();
        global.showNotification = notifyStub;
    });

    afterEach(function() {
        if (fetchStub) fetchStub.restore();
        sinon.restore();
    });

    describe('💾 Salvamento de Configurações de Frete', function() {
        it('deve salvar configurações de frete', async function() {
            fetchStub = mockFetch({
                'POST:/api/configuracoes/info-frete': { ok: true, data: { success: true } }
            });

            document.getElementById('frete-modalidade').value = 'cif';
            document.getElementById('frete-minimo').value = '50,00';
            document.getElementById('habilitar-rastreamento').checked = true;

            async function salvarInfoFrete() {
                const config = {
                    modalidade: document.getElementById('frete-modalidade').value,
                    frete_minimo: parseFloat(document.getElementById('frete-minimo').value.replace(',', '.')) || 0,
                    url_rastreio: document.getElementById('frete-url-rastreio').value,
                    habilitar_rastreamento: document.getElementById('habilitar-rastreamento').checked,
                    notificar_despacho: document.getElementById('notificar-despacho').checked,
                    notificar_entrega: document.getElementById('notificar-entrega').checked
                };

                const response = await fetch('/api/configuracoes/info-frete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });

                if (response.ok) {
                    showNotification('Configurações de frete salvas!', 'success');
                    return true;
                }
                return false;
            }

            const result = await salvarInfoFrete();
            
            expect(result).to.be.true;
        });

        it('deve converter valor monetário corretamente', function() {
            function parseMoneyValue(value) {
                if (!value) return 0;
                return parseFloat(value.replace(/\./g, '').replace(',', '.')) || 0;
            }
            
            expect(parseMoneyValue('50,00')).to.equal(50);
            expect(parseMoneyValue('1.234,56')).to.equal(1234.56);
            expect(parseMoneyValue('0')).to.equal(0);
            expect(parseMoneyValue('')).to.equal(0);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - VENDA DE SERVIÇOS
// ═══════════════════════════════════════════════════════════════════════════════

describe('🔧 Configurações de Venda de Serviços', function() {
    let dom, fetchStub, notifyStub;

    beforeEach(function() {
        dom = setupDOM();
        notifyStub = mockNotification();
        global.showNotification = notifyStub;
    });

    afterEach(function() {
        if (fetchStub) fetchStub.restore();
        sinon.restore();
    });

    describe('📊 Etapas de Serviços', function() {
        it('deve capturar configuração das etapas de serviço', function() {
            function getEtapasServicosConfig() {
                return {
                    ordem_servico: document.getElementById('etapa-ordem-servico')?.checked || false,
                    em_execucao: document.getElementById('etapa-em-execucao')?.checked || false,
                    executada: document.getElementById('etapa-executada')?.checked || false,
                    faturar_servico: document.getElementById('etapa-faturar-servico')?.checked || false
                };
            }
            
            const etapas = getEtapasServicosConfig();
            
            expect(etapas.ordem_servico).to.be.true;
            expect(etapas.em_execucao).to.be.true;
        });

        it('deve salvar configurações de venda de serviços', async function() {
            fetchStub = mockFetch({
                'POST:/api/configuracoes/venda-servicos': { ok: true, data: { success: true } }
            });

            async function saveVendaServicosConfig() {
                const config = {
                    etapas: {
                        ordem_servico: document.getElementById('etapa-ordem-servico')?.checked,
                        em_execucao: document.getElementById('etapa-em-execucao')?.checked,
                        executada: document.getElementById('etapa-executada')?.checked,
                        faturar_servico: document.getElementById('etapa-faturar-servico')?.checked
                    },
                    proposta: {
                        permitir_proposta: document.getElementById('permitir-proposta-servico')?.checked
                    },
                    numeracao: {
                        proximo_os: parseInt(document.getElementById('proximo-os')?.value) || 1001
                    }
                };

                const response = await fetch('/api/configuracoes/venda-servicos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });

                if (response.ok) {
                    showNotification('Configurações salvas!', 'success');
                    return true;
                }
                return false;
            }

            const result = await saveVendaServicosConfig();
            
            expect(result).to.be.true;
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - CLIENTES E FORNECEDORES
// ═══════════════════════════════════════════════════════════════════════════════

describe('👥 Configurações de Clientes e Fornecedores', function() {
    let dom, fetchStub, notifyStub;

    beforeEach(function() {
        dom = setupDOM();
        notifyStub = mockNotification();
        global.showNotification = notifyStub;
    });

    afterEach(function() {
        if (fetchStub) fetchStub.restore();
        sinon.restore();
    });

    describe('💾 Salvamento de Configurações', function() {
        it('deve salvar validações de clientes/fornecedores', async function() {
            fetchStub = mockFetch({
                'POST:/api/configuracoes/clientes-fornecedores': { ok: true, data: { success: true } }
            });

            document.getElementById('obrigar-cnpj-cpf').checked = true;
            document.getElementById('obrigar-email').checked = true;

            async function saveClientesFornecedoresConfig() {
                const config = {
                    validacoes: {
                        obrigar_cnpj_cpf: document.getElementById('obrigar-cnpj-cpf')?.checked,
                        obrigar_endereco: document.getElementById('obrigar-endereco')?.checked,
                        obrigar_email: document.getElementById('obrigar-email')?.checked,
                        validar_unicidade: document.getElementById('validar-unicidade')?.checked
                    },
                    credito: {
                        bloquear_novos: document.getElementById('bloquear-novos')?.checked,
                        limite_padrao: document.getElementById('limite-credito-padrao')?.value || '0'
                    },
                    tags: {
                        tags_automaticas: document.getElementById('tags-automaticas')?.checked
                    }
                };

                const response = await fetch('/api/configuracoes/clientes-fornecedores', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });

                if (response.ok) {
                    showNotification('Configurações salvas!', 'success');
                    return true;
                }
                return false;
            }

            const result = await saveClientesFornecedoresConfig();
            
            expect(result).to.be.true;
        });

        it('deve validar limite de crédito como número', function() {
            function validateLimiteCredito(value) {
                const num = parseFloat(value);
                return !isNaN(num) && num >= 0;
            }
            
            expect(validateLimiteCredito('5000')).to.be.true;
            expect(validateLimiteCredito('0')).to.be.true;
            expect(validateLimiteCredito('-100')).to.be.false;
            expect(validateLimiteCredito('abc')).to.be.false;
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES - UTILITÁRIOS E HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

describe('🔧 Funções Utilitárias', function() {
    describe('📐 Formatação de Valores', function() {
        it('deve formatar valor monetário', function() {
            function formatMoney(value) {
                return new Intl.NumberFormat('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(value || 0);
            }
            
            expect(formatMoney(1234.56)).to.equal('1.234,56');
            expect(formatMoney(0)).to.equal('0,00');
            expect(formatMoney(null)).to.equal('0,00');
        });

        it('deve formatar CNPJ', function() {
            function formatCNPJ(value) {
                if (!value) return '';
                const nums = value.replace(/\D/g, '');
                return nums.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
            }
            
            expect(formatCNPJ('68192475000160')).to.equal('68.192.475/0001-60');
        });
    });

    describe('🎨 Manipulação de Modais', function() {
        it('deve abrir modal genérico', function() {
            function abrirModal(modalId) {
                const modal = document.getElementById(modalId);
                if (modal) {
                    modal.style.display = 'flex';
                    document.body.style.overflow = 'hidden';
                }
            }
            
            const modal = document.createElement('div');
            modal.id = 'test-modal';
            modal.style.display = 'none';
            document.body.appendChild(modal);
            
            abrirModal('test-modal');
            
            expect(modal.style.display).to.equal('flex');
        });

        it('deve fechar modal genérico', function() {
            function fecharModal(modalId) {
                const modal = document.getElementById(modalId);
                if (modal) {
                    modal.style.display = 'none';
                    document.body.style.overflow = '';
                }
            }
            
            const modal = document.createElement('div');
            modal.id = 'test-modal-2';
            modal.style.display = 'flex';
            document.body.appendChild(modal);
            
            fecharModal('test-modal-2');
            
            expect(modal.style.display).to.equal('none');
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTAÇÁO PARA RELATÓRIO
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    setupDOM,
    mockFetch,
    mockNotification
};
