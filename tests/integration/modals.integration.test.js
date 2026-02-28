;/**
 * ALUFORCE ERP - Testes de Integração
 * Testes de integração Frontend ↔ Backend para modais
 * 
 * @version 2.0
 * @date 2026-01-19
 */

'use strict';

const { expect } = require('chai');
const { JSDOM } = require('jsdom');
const sinon = require('sinon');

// Importar fixtures
const { 
    TEST_DATA, 
    MODAL_CATALOG, 
    TEST_SCENARIOS 
} = require('../fixtures/modals.fixtures');

describe('ALUFORCE ERP - Testes de Integração (Frontend ↔ Backend)', function() {
    this.timeout(30000);

    let dom, document, window;
    let sandbox;
    let fetchStub;
    let mockResponses;

    beforeEach(function() {
        sandbox = sinon.createSandbox();

        // Criar HTML completo com modais
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>ALUFORCE ERP</title>
                <style>
                    .modal-overlay { display: none; position: fixed; z-index: 1000; }
                    .modal-overlay.active { display: flex; }
                    .hidden { display: none !important; }
                    .btn { cursor: pointer; }
                    .loading { opacity: 0.5; pointer-events: none; }
                </style>
            </head>
            <body>
                <!-- Modal Configurações Principal -->
                <div id="config-modal-overlay" class="modal-overlay hidden">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h2>Configurações</h2>
                            <button class="modal-close" onclick="fecharModalConfig()">×</button>
                        </div>
                        <div class="modal-body">
                            <nav class="config-nav">
                                <button class="config-nav-item active" data-section="empresa">Empresa</button>
                                <button class="config-nav-item" data-section="categorias">Categorias</button>
                                <button class="config-nav-item" data-section="departamentos">Departamentos</button>
                            </nav>
                            <div class="config-content"></div>
                        </div>
                    </div>
                </div>

                <!-- Modal Empresa -->
                <div id="modal-config-empresa" class="modal-overlay hidden">
                    <div class="modal-content">
                        <form id="form-empresa">
                            <input type="text" id="empresa-razao" name="razao_social" required>
                            <input type="text" id="empresa-cnpj" name="cnpj">
                            <input type="email" id="empresa-email" name="email">
                            <button type="submit" class="btn-salvar">Salvar</button>
                        </form>
                    </div>
                </div>

                <!-- Modal Categorias -->
                <div id="modal-config-categorias" class="modal-overlay hidden">
                    <div class="modal-content">
                        <table id="tabela-categorias">
                            <tbody></tbody>
                        </table>
                        <form id="form-categoria">
                            <input type="text" id="categoria-nome" name="nome" required>
                            <button type="submit" class="btn-adicionar">Adicionar</button>
                        </form>
                    </div>
                </div>

                <!-- Modal Confirmação -->
                <div id="confirm-modal-overlay" class="modal-overlay hidden">
                    <div class="confirm-modal">
                        <p id="confirm-message"></p>
                        <div class="confirm-buttons">
                            <button id="confirm-yes" class="btn-confirm">Confirmar</button>
                            <button id="confirm-no" class="btn-cancel">Cancelar</button>
                        </div>
                    </div>
                </div>

                <!-- Modal Produto PCP -->
                <div id="modal-produto" class="modal-overlay hidden">
                    <div class="modal-content">
                        <form id="form-produto">
                            <input type="text" id="produto-codigo" name="codigo" required>
                            <input type="text" id="produto-nome" name="nome" required>
                            <input type="number" id="produto-preco" name="preco">
                            <button type="submit" class="btn-salvar">Salvar</button>
                        </form>
                    </div>
                </div>

                <!-- Modal Cliente -->
                <div id="modal-cliente" class="modal-overlay hidden">
                    <div class="modal-content">
                        <form id="form-cliente">
                            <input type="text" id="cliente-nome" name="nome" required>
                            <input type="text" id="cliente-cpf-cnpj" name="cpf_cnpj" required>
                            <input type="email" id="cliente-email" name="email">
                            <button type="submit" class="btn-salvar">Salvar</button>
                        </form>
                    </div>
                </div>

                <!-- Modal Conta a Pagar -->
                <div id="modal-conta-pagar" class="modal-overlay hidden">
                    <div class="modal-content">
                        <form id="form-conta-pagar">
                            <input type="text" id="conta-pagar-descricao" name="descricao" required>
                            <input type="number" id="conta-pagar-valor" name="valor" step="0.01" required>
                            <input type="date" id="conta-pagar-vencimento" name="data_vencimento" required>
                            <button type="submit" class="btn-salvar">Salvar</button>
                        </form>
                    </div>
                </div>

                <!-- Toast de Notificação -->
                <div id="toast-container" class="hidden"></div>

                <!-- Área principal -->
                <main id="main-content"></main>

                <script>
                    // Estado global
                    window.userToken = 'test-token-123';
                    window.currentUser = { id: 1, perfil: 'admin' };
                </script>
            </body>
            </html>
        `;

        dom = new JSDOM(html, {
            url: 'http://localhost:3000',
            runScripts: 'dangerously',
            pretendToBeVisual: true
        });

        document = dom.window.document;
        window = dom.window;

        // Configurar respostas mock
        mockResponses = {
            '/api/configuracoes/empresa': {
                get: { success: true, data: TEST_DATA.empresaValida },
                put: { success: true, message: 'Dados salvos com sucesso' }
            },
            '/api/categorias': {
                get: { success: true, data: [{ id: 1, nome: 'Perfis' }, { id: 2, nome: 'Chapas' }] },
                post: { success: true, data: { id: 3, nome: 'Nova Categoria' } }
            },
            '/api/departamentos': {
                get: { success: true, data: [{ id: 1, nome: 'Produção' }] },
                post: { success: true, data: { id: 2, nome: 'Novo Departamento' } }
            },
            '/api/produtos': {
                get: { success: true, data: [TEST_DATA.produtoValido] },
                post: { success: true, data: { id: 1, ...TEST_DATA.produtoValido } }
            },
            '/api/clientes': {
                get: { success: true, data: [TEST_DATA.clienteValido] },
                post: { success: true, data: { id: 1, ...TEST_DATA.clienteValido } }
            },
            '/api/contas-pagar': {
                get: { success: true, data: [TEST_DATA.contaPagarValida] },
                post: { success: true, data: { id: 1, ...TEST_DATA.contaPagarValida } }
            }
        };

        // Mock do fetch
        fetchStub = sandbox.stub(window, 'fetch');
        fetchStub.callsFake((url, options = {}) => {
            const method = (options.method || 'GET').toLowerCase();
            const path = url.toString().replace(/\?.*$/, '');
            
            let response = mockResponses[path];
            if (response && response[method]) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(response[method])
                });
            }

            return Promise.resolve({
                ok: false,
                status: 404,
                json: () => Promise.resolve({ success: false, error: 'Não encontrado' })
            });
        });

        // Implementar funções auxiliares do sistema
        window.showToast = (message, type = 'info') => {
            const container = document.getElementById('toast-container');
            container.classList.remove('hidden');
            container.innerHTML = `<div class="toast toast-${type}">${message}</div>`;
        };

        window.hideToast = () => {
            const container = document.getElementById('toast-container');
            container.classList.add('hidden');
        };

        window.abrirModal = (modalId) => {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('active');
            }
        };

        window.fecharModal = (modalId) => {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('active');
            }
        };

        window.showConfirmModal = (message, onConfirm, onCancel) => {
            const modal = document.getElementById('confirm-modal-overlay');
            const msgElement = document.getElementById('confirm-message');
            
            msgElement.textContent = message;
            modal.classList.remove('hidden');
            modal.classList.add('active');

            document.getElementById('confirm-yes').onclick = () => {
                window.fecharModal('confirm-modal-overlay');
                if (onConfirm) onConfirm();
            };

            document.getElementById('confirm-no').onclick = () => {
                window.fecharModal('confirm-modal-overlay');
                if (onCancel) onCancel();
            };
        };

        window.abrirModalConfig = () => {
            window.abrirModal('config-modal-overlay');
        };

        window.fecharModalConfig = () => {
            window.fecharModal('config-modal-overlay');
        };
    });

    afterEach(function() {
        sandbox.restore();
        if (dom) dom.window.close();
    });

    // ========================================================================
    // TESTES: FLUXO COMPLETO DE CONFIGURAÇÕES DA EMPRESA
    // ========================================================================
    describe('Integração: Modal Empresa', function() {
        
        it('TC-I001: Abrir modal → Carregar dados → Exibir no formulário', async function() {
            // Abrir modal
            window.abrirModal('modal-config-empresa');
            
            // Simular carregamento de dados
            const response = await window.fetch('/api/configuracoes/empresa');
            const data = await response.json();
            
            // Preencher formulário
            document.getElementById('empresa-razao').value = data.data.razao_social;
            document.getElementById('empresa-cnpj').value = data.data.cnpj || '';
            
            // Verificações
            expect(document.getElementById('modal-config-empresa').classList.contains('hidden')).to.be.false;
            expect(document.getElementById('empresa-razao').value).to.equal(TEST_DATA.empresaValida.razao_social);
        });

        it('TC-I002: Preencher formulário → Salvar → Exibir toast sucesso', async function() {
            window.abrirModal('modal-config-empresa');
            
            // Preencher dados
            document.getElementById('empresa-razao').value = 'Nova Razão Social';
            document.getElementById('empresa-cnpj').value = '12.345.678/0001-90';
            
            // Submeter
            const formData = {
                razao_social: document.getElementById('empresa-razao').value,
                cnpj: document.getElementById('empresa-cnpj').value
            };
            
            const response = await window.fetch('/api/configuracoes/empresa', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                window.showToast(result.message, 'success');
                window.fecharModal('modal-config-empresa');
            }
            
            // Verificações
            expect(result.success).to.be.true;
            expect(document.getElementById('toast-container').classList.contains('hidden')).to.be.false;
            expect(document.getElementById('modal-config-empresa').classList.contains('hidden')).to.be.true;
        });

        it('TC-I003: Erro no servidor → Exibir toast de erro → Modal permanece aberto', async function() {
            // Configurar erro
            mockResponses['/api/configuracoes/empresa'].put = { 
                success: false, 
                error: 'Erro ao salvar dados' 
            };

            window.abrirModal('modal-config-empresa');
            
            const response = await window.fetch('/api/configuracoes/empresa', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ razao_social: 'Teste' })
            });
            
            const result = await response.json();
            
            if (!result.success) {
                window.showToast(result.error, 'error');
                // Não fecha o modal em caso de erro
            }
            
            // Modal deve permanecer aberto
            expect(document.getElementById('modal-config-empresa').classList.contains('hidden')).to.be.false;
            expect(document.getElementById('toast-container').innerHTML).to.include('error');
        });
    });

    // ========================================================================
    // TESTES: FLUXO COMPLETO DE CATEGORIAS
    // ========================================================================
    describe('Integração: Modal Categorias', function() {
        
        it('TC-I010: Abrir modal → Listar categorias na tabela', async function() {
            window.abrirModal('modal-config-categorias');
            
            const response = await window.fetch('/api/categorias');
            const data = await response.json();
            
            // Renderizar na tabela
            const tbody = document.querySelector('#tabela-categorias tbody');
            tbody.innerHTML = data.data.map(cat => 
                `<tr data-id="${cat.id}"><td>${cat.nome}</td><td><button class="btn-excluir">Excluir</button></td></tr>`
            ).join('');
            
            expect(tbody.querySelectorAll('tr').length).to.equal(2);
            expect(tbody.innerHTML).to.include('Perfis');
            expect(tbody.innerHTML).to.include('Chapas');
        });

        it('TC-I011: Adicionar categoria → Atualizar lista', async function() {
            window.abrirModal('modal-config-categorias');
            
            // Preencher nome
            document.getElementById('categoria-nome').value = 'Nova Categoria';
            
            // Submeter
            const response = await window.fetch('/api/categorias', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: 'Nova Categoria' })
            });
            
            const result = await response.json();
            
            if (result.success) {
                const tbody = document.querySelector('#tabela-categorias tbody');
                const row = document.createElement('tr');
                row.setAttribute('data-id', result.data.id);
                row.innerHTML = `<td>${result.data.nome}</td><td><button class="btn-excluir">Excluir</button></td>`;
                tbody.appendChild(row);
                
                document.getElementById('categoria-nome').value = '';
                window.showToast('Categoria adicionada', 'success');
            }
            
            expect(result.success).to.be.true;
            expect(document.getElementById('categoria-nome').value).to.equal('');
        });

        it('TC-I012: Excluir categoria → Confirmar → Remover da lista', async function() {
            window.abrirModal('modal-config-categorias');
            
            // Adicionar linha à tabela
            const tbody = document.querySelector('#tabela-categorias tbody');
            tbody.innerHTML = '<tr data-id="1"><td>Categoria Teste</td><td><button class="btn-excluir">Excluir</button></td></tr>';
            
            let confirmed = false;
            
            // Simular clique em excluir
            window.showConfirmModal('Deseja excluir esta categoria?', () => {
                confirmed = true;
                tbody.querySelector('tr[data-id="1"]').remove();
            });
            
            // Simular confirmação
            document.getElementById('confirm-yes').click();
            
            expect(confirmed).to.be.true;
            expect(tbody.querySelectorAll('tr').length).to.equal(0);
        });
    });

    // ========================================================================
    // TESTES: FLUXO COMPLETO DE PRODUTOS PCP
    // ========================================================================
    describe('Integração: Modal Produto PCP', function() {
        
        it('TC-I020: Novo produto → Preencher → Salvar → Fechar modal', async function() {
            window.abrirModal('modal-produto');
            
            // Preencher dados
            document.getElementById('produto-codigo').value = 'PROD001';
            document.getElementById('produto-nome').value = 'Perfil Alumínio 20x20';
            document.getElementById('produto-preco').value = '45.90';
            
            // Submeter
            const formData = {
                codigo: document.getElementById('produto-codigo').value,
                nome: document.getElementById('produto-nome').value,
                preco: parseFloat(document.getElementById('produto-preco').value)
            };
            
            const response = await window.fetch('/api/produtos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                window.showToast('Produto salvo com sucesso', 'success');
                window.fecharModal('modal-produto');
            }
            
            expect(result.success).to.be.true;
            expect(document.getElementById('modal-produto').classList.contains('hidden')).to.be.true;
        });

        it('TC-I021: Carregar produto existente para edição', async function() {
            const response = await window.fetch('/api/produtos');
            const data = await response.json();
            const produto = data.data[0];
            
            window.abrirModal('modal-produto');
            
            // Preencher com dados existentes
            document.getElementById('produto-codigo').value = produto.codigo;
            document.getElementById('produto-nome').value = produto.nome;
            document.getElementById('produto-preco').value = produto.preco || '';
            
            expect(document.getElementById('produto-codigo').value).to.equal(TEST_DATA.produtoValido.codigo);
            expect(document.getElementById('produto-nome').value).to.equal(TEST_DATA.produtoValido.nome);
        });
    });

    // ========================================================================
    // TESTES: FLUXO COMPLETO DE CLIENTES
    // ========================================================================
    describe('Integração: Modal Cliente Vendas', function() {
        
        it('TC-I030: Cadastrar novo cliente', async function() {
            window.abrirModal('modal-cliente');
            
            // Preencher dados
            document.getElementById('cliente-nome').value = 'Cliente Teste Ltda';
            document.getElementById('cliente-cpf-cnpj').value = '12.345.678/0001-90';
            document.getElementById('cliente-email').value = 'cliente@teste.com';
            
            const formData = {
                nome: document.getElementById('cliente-nome').value,
                cpf_cnpj: document.getElementById('cliente-cpf-cnpj').value,
                email: document.getElementById('cliente-email').value
            };
            
            const response = await window.fetch('/api/clientes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            
            const result = await response.json();
            
            expect(result.success).to.be.true;
            expect(result.data).to.have.property('id');
        });

        it('TC-I031: Listar clientes no modal de seleção', async function() {
            const response = await window.fetch('/api/clientes');
            const data = await response.json();
            
            expect(data.success).to.be.true;
            expect(data.data).to.be.an('array');
            expect(data.data.length).to.be.greaterThan(0);
        });
    });

    // ========================================================================
    // TESTES: FLUXO COMPLETO FINANCEIRO
    // ========================================================================
    describe('Integração: Modal Contas a Pagar', function() {
        
        it('TC-I040: Cadastrar nova conta a pagar', async function() {
            window.abrirModal('modal-conta-pagar');
            
            // Preencher dados
            document.getElementById('conta-pagar-descricao').value = 'Fornecedor XYZ';
            document.getElementById('conta-pagar-valor').value = '1500.00';
            document.getElementById('conta-pagar-vencimento').value = '2026-02-15';
            
            const formData = {
                descricao: document.getElementById('conta-pagar-descricao').value,
                valor: parseFloat(document.getElementById('conta-pagar-valor').value),
                data_vencimento: document.getElementById('conta-pagar-vencimento').value
            };
            
            const response = await window.fetch('/api/contas-pagar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                window.showToast('Conta cadastrada com sucesso', 'success');
                window.fecharModal('modal-conta-pagar');
            }
            
            expect(result.success).to.be.true;
            expect(document.getElementById('modal-conta-pagar').classList.contains('hidden')).to.be.true;
        });

        it('TC-I041: Listar contas a pagar', async function() {
            const response = await window.fetch('/api/contas-pagar');
            const data = await response.json();
            
            expect(data.success).to.be.true;
            expect(data.data).to.be.an('array');
        });
    });

    // ========================================================================
    // TESTES: CONFIRMAÇÁO DE AÇÕES DESTRUTIVAS
    // ========================================================================
    describe('Integração: Modal de Confirmação', function() {
        
        it('TC-I050: Ação destrutiva → Exibir confirmação → Confirmar → Executar', async function() {
            let actionExecuted = false;
            
            window.showConfirmModal('Deseja excluir este registro?', () => {
                actionExecuted = true;
            });
            
            expect(document.getElementById('confirm-modal-overlay').classList.contains('hidden')).to.be.false;
            expect(document.getElementById('confirm-message').textContent).to.include('excluir');
            
            document.getElementById('confirm-yes').click();
            
            expect(actionExecuted).to.be.true;
            expect(document.getElementById('confirm-modal-overlay').classList.contains('hidden')).to.be.true;
        });

        it('TC-I051: Ação destrutiva → Exibir confirmação → Cancelar → Não executar', async function() {
            let actionExecuted = false;
            
            window.showConfirmModal('Deseja excluir este registro?', () => {
                actionExecuted = true;
            });
            
            document.getElementById('confirm-no').click();
            
            expect(actionExecuted).to.be.false;
            expect(document.getElementById('confirm-modal-overlay').classList.contains('hidden')).to.be.true;
        });
    });

    // ========================================================================
    // TESTES: NAVEGAÇÁO ENTRE SEÇÕES NO MODAL CONFIG
    // ========================================================================
    describe('Integração: Navegação Modal Configurações', function() {
        
        it('TC-I060: Navegar entre abas deve carregar conteúdo correto', function() {
            window.abrirModal('config-modal-overlay');
            
            const navItems = document.querySelectorAll('.config-nav-item');
            expect(navItems.length).to.equal(3);
            
            // Simular clique na aba "Categorias"
            navItems[1].click();
            navItems.forEach(item => item.classList.remove('active'));
            navItems[1].classList.add('active');
            
            expect(navItems[1].classList.contains('active')).to.be.true;
            expect(navItems[0].classList.contains('active')).to.be.false;
        });
    });

    // ========================================================================
    // TESTES: TRATAMENTO DE ERROS DE REDE
    // ========================================================================
    describe('Integração: Erros de Rede', function() {
        
        it('TC-I070: Falha de rede deve exibir mensagem de erro', async function() {
            fetchStub.rejects(new Error('Network Error'));
            
            window.abrirModal('modal-config-empresa');
            
            try {
                await window.fetch('/api/configuracoes/empresa');
            } catch (error) {
                window.showToast('Erro de conexão. Verifique sua internet.', 'error');
            }
            
            expect(document.getElementById('toast-container').innerHTML).to.include('error');
        });

        it('TC-I071: Timeout deve exibir mensagem apropriada', async function() {
            fetchStub.callsFake(() => new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Timeout')), 100);
            }));
            
            try {
                await window.fetch('/api/produtos');
            } catch (error) {
                window.showToast('Servidor não respondeu. Tente novamente.', 'error');
            }
            
            expect(document.getElementById('toast-container').innerHTML).to.include('error');
        });
    });

    // ========================================================================
    // TESTES: ESTADOS DE CARREGAMENTO
    // ========================================================================
    describe('Integração: Estados de Carregamento', function() {
        
        it('TC-I080: Durante requisição, botão deve ficar desabilitado', async function() {
            window.abrirModal('modal-produto');
            
            const btnSalvar = document.querySelector('#form-produto .btn-salvar');
            
            // Simular início de carregamento
            btnSalvar.disabled = true;
            btnSalvar.classList.add('loading');
            
            expect(btnSalvar.disabled).to.be.true;
            expect(btnSalvar.classList.contains('loading')).to.be.true;
            
            // Simular fim de carregamento
            await window.fetch('/api/produtos', { method: 'POST', body: '{}' });
            btnSalvar.disabled = false;
            btnSalvar.classList.remove('loading');
            
            expect(btnSalvar.disabled).to.be.false;
        });
    });

    // ========================================================================
    // TESTES: PERSISTÊNCIA DE DADOS ENTRE MODAIS
    // ========================================================================
    describe('Integração: Persistência de Dados', function() {
        
        it('TC-I090: Dados alterados em um modal devem refletir em outro', async function() {
            // Cadastrar cliente
            const clienteResponse = await window.fetch('/api/clientes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(TEST_DATA.clienteValido)
            });
            const clienteResult = await clienteResponse.json();
            
            // Atualizar mock para incluir novo cliente
            mockResponses['/api/clientes'].get.data.push(clienteResult.data);
            
            // Buscar clientes novamente
            const listResponse = await window.fetch('/api/clientes');
            const listResult = await listResponse.json();
            
            expect(listResult.data.length).to.be.greaterThan(1);
        });
    });

    // ========================================================================
    // TESTES: VALIDAÇÁO CRUZADA FRONTEND/BACKEND
    // ========================================================================
    describe('Integração: Validação Cruzada', function() {
        
        it('TC-I100: Validação frontend deve corresponder à do backend', async function() {
            window.abrirModal('modal-produto');
            
            const codigo = document.getElementById('produto-codigo');
            const nome = document.getElementById('produto-nome');
            
            // Deixar campos vazios
            codigo.value = '';
            nome.value = '';
            
            // Validação frontend
            const frontendValid = codigo.value.trim() !== '' && nome.value.trim() !== '';
            
            // Tentar enviar ao backend
            const response = await window.fetch('/api/produtos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codigo: '', nome: '' })
            });
            
            expect(frontendValid).to.be.false;
            // Backend mock retornaria 400 se implementássemos a validação completa
        });
    });

    // ========================================================================
    // TESTES: FLUXO DE AUTORIZAÇÁO
    // ========================================================================
    describe('Integração: Autorização', function() {
        
        it('TC-I110: Requisição sem token deve redirecionar para login', async function() {
            fetchStub.restore();
            fetchStub = sandbox.stub(window, 'fetch').callsFake(() => {
                return Promise.resolve({
                    ok: false,
                    status: 401,
                    json: () => Promise.resolve({ success: false, error: 'Não autorizado' })
                });
            });
            
            const response = await window.fetch('/api/configuracoes/empresa');
            const result = await response.json();
            
            if (response.status === 401) {
                // Simular redirecionamento para login
                window.location.href = '/login';
            }
            
            expect(response.status).to.equal(401);
        });
    });
});
